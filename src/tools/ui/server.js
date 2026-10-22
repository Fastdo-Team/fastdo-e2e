#!/usr/bin/env node
// ============================================================================
// server.js: giao diện cục bộ cho QC.  `npm run ui`
//
// Chạy trên MÁY CỦA TỪNG QC, chỉ nghe 127.0.0.1. Không đăng nhập, không hàng đợi,
// không dùng chung qua mạng — đó là quyết định thiết kế, không phải thiếu sót:
// Chrome và video phải nằm ngay trên máy người đang xem.
//
// Không thêm thư viện nào: dùng module `http` có sẵn, log chảy về bằng SSE.
//
// RANH GIỚI AN TOÀN (đọc trước khi sửa file này):
//   · Chỉ listen 127.0.0.1. Mọi POST phải kèm token sinh lúc khởi động.
//   · DANH SÁCH KHOÁ ĐƯỢC ĐỌC, không phải danh sách cấm — biến mới thêm vào .env
//     sau này mặc định là bí mật, không mặc định lộ.
//   · Không có endpoint nào nhận đường dẫn file tự do từ trình duyệt.
//   · spawn luôn shell:false, mọi tham số số ép về số nguyên.
//   · TARGET_URL phải qua whitelist: session.js gõ email và mật khẩu THẬT vào bất
//     cứ trang nào URL đó trỏ tới.
//   · Vá .env từng dòng + giữ bản .env.bak; .env không nằm trong git.
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { parseEnvLabels } = require('../../sheets/env_label');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'dotenv'))) {
  console.error('\n✗ Chưa cài thư viện cho repo này. Chạy 1 lần: npm install\n');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
  console.error('\n✗ Chưa có file .env ở gốc repo. Tạo từ mẫu: cp .env.example .env\n');
  process.exit(1);
}

const RUNS_DIR = path.join(ROOT_DIR, 'runs');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const TOKEN = crypto.randomBytes(24).toString('hex');
const PORT = parseInt(process.env.UI_PORT, 10) || 7788;

// Biến được phép hiện GIÁ TRỊ ra trình duyệt. Mọi biến khác chỉ trả có/không.
const READABLE_ENV = ['TARGET_URL', 'SHEET_ID', 'SHEET_TAB', 'SHEET_GID', 'ORG_NAME', 'RECORD_FPS', 'CDP_PORT',
  'ENV_LABELS', 'QC_NAME', 'CLAUDE_AUTO_RUN', 'CLAUDE_MODEL', 'CLAUDE_SLOTS', 'CLAUDE_AUTO_SWITCH'];
// Biến được phép SỬA từ trình duyệt. Mật khẩu, DRIVE_* (token Google Drive), GOOGLE_SA_KEY_FILE cố ý không có ở đây.
// CLAUDE_AUTO_RUN vẫn KHÔNG sửa được từ trang: nó mới là công tắc cho phép một nút
// web khởi động agent. CLAUDE_SLOTS/CLAUDE_AUTO_SWITCH chỉ chọn trong số tài khoản
// mà người dùng đã tự đăng nhập, không cấp thêm quyền gì.
const EDITABLE_ENV = ['TARGET_URL', 'SHEET_ID', 'SHEET_TAB', 'SHEET_GID', 'ORG_NAME', 'RECORD_FPS', 'ENV_LABELS',
  'QC_NAME', 'CLAUDE_MODEL', 'CLAUDE_SLOTS', 'CLAUDE_AUTO_SWITCH'];

const CASE_ID_RE = /^EVAL_[A-Z0-9_]+$/;

const SHEET_CACHE = path.join(RUNS_DIR, '.sheet-cache.json');
const QUEUE_FILE = path.join(RUNS_DIR, '.claude-queue.json');

/**
 * Chế độ tự gọi Claude. CỐ Ý chỉ bật được bằng cách sửa .env bằng tay — không có
 * công tắc nào trên trình duyệt, vì bật nó nghĩa là một nút web khởi động được
 * agent có quyền chạy lệnh trên máy. Đọc lại mỗi lần để đổi xong không phải khởi
 * động lại server.
 */
function claudeAutoEnabled() {
  return readEnvFile().CLAUDE_AUTO_RUN === '1';
}

// ---------------------------------------------------------------------------
// .env: đọc và vá từng dòng
// ---------------------------------------------------------------------------

/** Parse .env thành object. Đọc lại mỗi lần để không bao giờ hiển thị giá trị cũ. */
function readEnvFile() {
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Vá từng dòng, giữ nguyên comment và thứ tự. KHÔNG ghi đè cả file: .env không
 * nằm trong git nên ghi hỏng là mất mật khẩu vĩnh viễn.
 */
function patchEnvFile(updates) {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();

  const lines = raw.split(/\r?\n/).map((line) => {
    const m = /^(\s*)([A-Z_][A-Z0-9_]*)(\s*)=/.exec(line);
    if (!m) return line;
    const key = m[2];
    if (!Object.prototype.hasOwnProperty.call(updates, key)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) lines.push(`${k}=${v}`);
  }

  fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
  fs.writeFileSync(ENV_PATH, lines.join(eol), 'utf8');
}

// ---------------------------------------------------------------------------
// Kiểm tra giá trị người dùng nhập
// ---------------------------------------------------------------------------

/**
 * TARGET_URL trỏ đâu thì session.js gõ email + mật khẩu thật vào đó. Whitelist
 * cứng, chặn chứ không cảnh báo. Mở rộng bằng biến TARGET_URL_ALLOW trong .env
 * (các hậu tố tên miền, cách nhau bằng dấu phẩy) chứ không phải bằng cách sửa file này.
 */
function validTargetUrl(value, env) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'không phải URL hợp lệ';
  }
  if (url.protocol !== 'https:') return 'phải là https';
  const extra = String(env.TARGET_URL_ALLOW || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allow = ['.devtunnels.ms', '.fastdo.vn', ...extra];
  const host = url.hostname.toLowerCase();
  const ok = allow.some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix));
  return ok ? null : `tên miền "${host}" không nằm trong danh sách cho phép (${allow.join(', ')})`;
}

/** Nhận cả id trần lẫn link Sheet đầy đủ — QC thường dán nguyên link. */
function extractSheetId(value) {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(value);
  const id = m ? m[1] : value.trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : null;
}

function validateConfig(body, env) {
  const updates = {};
  const errors = [];

  if (body.TARGET_URL !== undefined) {
    const v = String(body.TARGET_URL).trim();
    const err = validTargetUrl(v, env);
    if (err) errors.push(`TARGET_URL: ${err}`);
    else updates.TARGET_URL = v;
  }

  let linkGid = null;
  if (body.SHEET_ID !== undefined) {
    const id = extractSheetId(String(body.SHEET_ID));
    if (!id) errors.push('SHEET_ID: không nhận ra id — dán link Sheet hoặc id đầy đủ');
    else updates.SHEET_ID = id;
    // Dán nguyên link từ thanh địa chỉ thì link có "gid=…" của đúng tab đang xem —
    // lấy luôn, QC khỏi phải biết gid là gì.
    const g = /[#?&]gid=(\d+)/.exec(String(body.SHEET_ID));
    if (g) linkGid = g[1];
    if (g && body.SHEET_GID === undefined) updates.SHEET_GID = g[1];
  }

  if (body.SHEET_GID !== undefined) {
    const v = String(body.SHEET_GID).trim();
    if (v && !/^\d+$/.test(v)) errors.push('SHEET_GID: phải là số (số sau "gid=" trên link Sheet)');
    else updates.SHEET_GID = v;
  }

  // gid chỉ có nghĩa trong 1 Sheet: đổi sang Sheet khác mà gid vẫn là gid cũ (link không
  // có "gid=") thì gần như chắc chắn sai tab — bắt dán link có gid hoặc điền gid mới.
  const sheetChanged = updates.SHEET_ID && updates.SHEET_ID !== String(env.SHEET_ID || '');
  const gidAfter = updates.SHEET_GID !== undefined ? updates.SHEET_GID : String(env.SHEET_GID || '');
  if (sheetChanged && !linkGid && gidAfter && gidAfter === String(env.SHEET_GID || '')) {
    errors.push(
      'SHEET_GID: vừa đổi sang Sheet khác nhưng link không có "gid=" và gid vẫn là gid của Sheet cũ — ' +
        'mở đúng tab của Sheet mới rồi copy link trên thanh địa chỉ (có #gid=…), hoặc điền gid mới'
    );
  }

  if (body.ENV_LABELS !== undefined) {
    const v = String(body.ENV_LABELS).trim();
    try {
      parseEnvLabels(v);
      updates.ENV_LABELS = v;
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (body.QC_NAME !== undefined) {
    const v = String(body.QC_NAME).trim();
    if (/[\r\n]/.test(v) || v.length > 60) errors.push('QC_NAME: tối đa 60 ký tự, không xuống dòng');
    else updates.QC_NAME = v;
  }

  if (body.SHEET_TAB !== undefined) {
    const v = String(body.SHEET_TAB).trim();
    // Có gid thì tên tab chỉ để dự phòng — để trống được (cách khuyên dùng).
    const gidAfterTab = updates.SHEET_GID !== undefined ? updates.SHEET_GID : String(env.SHEET_GID || '');
    if (!v && !gidAfterTab) errors.push('SHEET_TAB: không được để trống khi chưa có gid của tab');
    else if (/[\r\n]/.test(v)) errors.push('SHEET_TAB: không được chứa xuống dòng');
    else updates.SHEET_TAB = v;
  }

  if (body.ORG_NAME !== undefined) {
    const v = String(body.ORG_NAME).trim();
    if (/[\r\n]/.test(v)) errors.push('ORG_NAME: không được chứa xuống dòng');
    else updates.ORG_NAME = v;
  }

  if (body.CLAUDE_MODEL !== undefined) {
    const v = String(body.CLAUDE_MODEL).trim();
    // Rỗng = để Claude Code tự dùng mặc định của máy. Có giá trị thì phải là alias
    // ('opus', 'sonnet', 'haiku'…) hoặc tên đầy đủ ('claude-opus-5') — không nhận
    // chuỗi tự do vì nó đi thẳng vào dòng lệnh.
    if (v && !/^[a-z0-9][a-z0-9.\-]{1,60}$/i.test(v)) {
      errors.push('CLAUDE_MODEL: chỉ nhận alias (opus, sonnet, haiku) hoặc tên đầy đủ (claude-opus-5)');
    } else updates.CLAUDE_MODEL = v;
  }

  if (body.CLAUDE_SLOTS !== undefined) {
    const n = Number(body.CLAUDE_SLOTS);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) errors.push(`CLAUDE_SLOTS: phải là số nguyên 1–${MAX_SLOTS}`);
    else updates.CLAUDE_SLOTS = String(n);
  }

  if (body.CLAUDE_AUTO_SWITCH !== undefined) {
    const v = String(body.CLAUDE_AUTO_SWITCH).trim();
    if (v !== '0' && v !== '1') errors.push('CLAUDE_AUTO_SWITCH: chỉ nhận 0 hoặc 1');
    else updates.CLAUDE_AUTO_SWITCH = v;
  }

  if (body.RECORD_FPS !== undefined) {
    const n = Number(body.RECORD_FPS);
    if (!Number.isInteger(n) || n < 1 || n > 60) errors.push('RECORD_FPS: phải là số nguyên 1–60');
    else updates.RECORD_FPS = String(n);
  }

  for (const k of Object.keys(body)) {
    if (!EDITABLE_ENV.includes(k)) errors.push(`${k}: không được sửa từ giao diện`);
  }

  return { updates, errors };
}

// ---------------------------------------------------------------------------
// Đọc trạng thái repo
// ---------------------------------------------------------------------------

/**
 * Danh sách case có kịch bản. Đọc bằng regex chứ KHÔNG require(): require sẽ thực
 * thi file, và một file lỗi cú pháp sẽ giết luôn giao diện.
 */
function listCases() {
  const dir = path.join(ROOT_DIR, 'src', 'testcases');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .map((file) => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const pick = (re) => {
        const m = re.exec(src);
        return m ? m[1] : '';
      };
      const id = (pick(/\bid:\s*['"]([^'"]+)['"]/) || file.replace('.test.js', '')).toUpperCase();
      return {
        id,
        title: pick(/\btitle:\s*['"]([^'"]+)['"]/),
        targetPath: pick(/\btargetPath:\s*['"]([^'"]+)['"]/),
        file: `src/testcases/${file}`,
      };
    })
    .filter((c) => CASE_ID_RE.test(c.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Các lần chạy gần đây, mới nhất trước. Quét thẳng thư mục, không có file chỉ mục. */
function listRuns(limit = 60) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const file = path.join(RUNS_DIR, name, 'result.json');
      let result = null;
      try {
        result = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return { dir: name, broken: true };
      }
      return {
        dir: name,
        testcaseId: result.testcaseId,
        round: result.round,
        account: result.account,
        pass: result.pass,
        resultText: result.resultText,
        videoUrl: result.videoUrl,
        sheet: result.sheet || {},
        error: result.error,
        seconds: result.seconds,
        startedAt: result.startedAt,
        hasFailReport: fs.existsSync(path.join(RUNS_DIR, name, `${result.testcaseId}.fail.md`)),
      };
    });
}

function readSheetCache() {
  try {
    return JSON.parse(fs.readFileSync(SHEET_CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function readQueue() {
  try {
    const q = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(q.items) ? q : { items: [] };
  } catch {
    return { items: [] };
  }
}

function writeQueue(q) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2), 'utf8');
}

/** Sửa đúng một mục trong hàng đợi, đọc lại từ đĩa để không đè thay đổi khác. */
function patchQueueItem(id, fields) {
  const q = readQueue();
  const it = q.items.find((i) => i.id === id);
  if (!it) return;
  Object.assign(it, fields);
  writeQueue(q);
}

/**
 * Việc "running" mà server vừa khởi động lại thì tiến trình con đã chết theo từ
 * đời trước — không bao giờ có ai đổi trạng thái cho nó nữa. Để nguyên thì hàng
 * đợi đầy việc ma và huy hiệu đếm sai (đã thấy 3 mục treo như vậy). Dọn lúc mở.
 */
function healQueue() {
  const q = readQueue();
  const stale = q.items.filter((i) => i.status === 'running');
  if (!stale.length) return;
  for (const it of stale) {
    it.status = 'interrupted';
    it.note = it.note || 'server khởi động lại — không rõ kết quả';
  }
  writeQueue(q);
  console.log(`[UI] Dọn ${stale.length} việc Claude còn treo "running" từ lần chạy trước.`);
}

/**
 * shell:true nghĩa là con TRỰC TIẾP là cmd.exe, còn `claude` chỉ là cháu.
 * child.kill() giết mỗi cmd.exe, claude sống tiếp — nút "Dừng" coi như không có
 * tác dụng. Trên Windows phải taskkill cả cây.
 */
function killTree(child, opts = {}) {
  if (!child) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* không taskkill được thì thử cách thường bên dưới */
      try {
        child.kill();
      } catch {
        /* đã chết rồi thì thôi */
      }
    }
  } else {
    try {
      child.kill();
    } catch {
      /* đã chết rồi thì thôi */
    }
  }

  // Quét dọn bổ sung — CHỈ cho job kind:'claude'.
  //
  // Đã xác nhận thực tế (không phải suy đoán): khi Claude tự chạy lệnh qua Bash
  // tool của nó, tiến trình con trên Windows đi qua Git Bash và liên kết cha-con
  // trong bảng tiến trình BỊ ĐỨT khỏi claude.exe — `taskkill /PID <claude> /T /F`
  // duyệt đúng cây nhưng KHÔNG BAO GIỜ thấy nhánh bash.exe đó, nên node/Chrome nó
  // mở ra (ví dụ `npm run probe -- ... --keep-open` bị treo) vẫn sống sau khi bấm
  // Dừng. Quét lại theo NỘI DUNG dòng lệnh (chứa đường dẫn repo) thay vì theo
  // liên kết cha-con, vì đó là cách duy nhất tìm ra nhánh bị đứt này.
  //
  // Không áp dụng cho job kind khác: những job đó server.js tự spawn trực tiếp
  // (shell:false, không qua Git Bash) nên cây tiến trình của chúng vẫn nguyên
  // vẹn, taskkill /T ở trên là đủ — quét thêm chỉ tổ có nguy cơ giết nhầm một
  // Chrome đang được QC dùng thật ở terminal khác.
  if (opts.sweep && process.platform === 'win32') {
    const self = process.pid;
    // PowerShell chuỗi single-quote không cần escape backslash — chỉ escape dấu
    // nháy đơn. Nhân đôi backslash (bản trước) làm sai lệch chuỗi so khớp, khiến
    // quét không tìm thấy gì — đã tự bắt lỗi này bằng kiểm thử trước khi tin.
    const needle = ROOT_DIR.replace(/'/g, "''");
    const ps =
      `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') ` +
      `-and $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne ${self} } | ` +
      `ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null }`;
    try {
      spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 20000 });
    } catch {
      /* quét bổ sung là best-effort, không chặn phần chính đã kill xong */
    }
  }
}

// ---------------------------------------------------------------------------
// Nhiều tài khoản Claude ("slot")
//
// CLAUDE_CONFIG_DIR tách hoàn toàn phiên đăng nhập của Claude Code: mỗi slot một
// thư mục, đăng nhập độc lập, giữ song song. Nhờ vậy slot 1 hết hạn mức 5 tiếng
// thì vẫn chạy tiếp được bằng slot 2 thay vì ngồi chờ tới giờ reset.
//
// Slot 1 CỐ Ý không đặt biến này: nó dùng chung phiên đăng nhập của cả máy, nên
// đăng xuất slot 1 là đụng tới mọi chỗ khác đang dùng Claude Code, không riêng
// repo này. Slot >= 2 nằm trong .claude-auth/ (đã cho vào .gitignore).
// ---------------------------------------------------------------------------

const AUTH_DIR = path.join(ROOT_DIR, '.claude-auth');
const MAX_SLOTS = 4;

function claudeSlotCount() {
  const n = parseInt(readEnvFile().CLAUDE_SLOTS, 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS ? n : 2;
}

/** Mặc định BẬT. Chỉ tắt khi .env ghi rõ CLAUDE_AUTO_SWITCH=0. */
function claudeAutoSwitch() {
  return readEnvFile().CLAUDE_AUTO_SWITCH !== '0';
}

function slotDir(n) {
  return n <= 1 ? null : path.join(AUTH_DIR, `slot${n}`);
}

function slotEnv(n) {
  const e = { ...process.env };
  // Windows coi tên biến môi trường không phân biệt hoa thường, nhưng object của
  // Node thì có. Còn sót một biến thể là cái cũ của tiến trình cha vẫn thắng.
  for (const k of Object.keys(e)) if (k.toUpperCase() === 'CLAUDE_CONFIG_DIR') delete e[k];
  const dir = slotDir(n);
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    e.CLAUDE_CONFIG_DIR = dir;
  }
  return e;
}

/**
 * `claude auth status` mất 1-2 giây mỗi slot, mà buildState() chạy mỗi lần trang
 * hỏi trạng thái — gọi thẳng ở đó là treo giao diện. Cache lại, chỉ đọc mới lúc
 * mở server, khi QC bấm ⟳, hoặc ngay sau khi đăng nhập/đăng xuất.
 */
let authCache = {};

function readAuthSlot(n) {
  const rong = { slot: n, loggedIn: false, email: '', orgName: '', subscriptionType: '' };
  try {
    const r = spawnSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf8', shell: true, timeout: 25000, env: slotEnv(n),
    });
    const s = JSON.parse(String(r.stdout).trim());
    return {
      slot: n,
      loggedIn: Boolean(s.loggedIn),
      email: s.email || '',
      orgName: s.orgName || '',
      subscriptionType: s.subscriptionType || '',
      authMethod: s.authMethod || '',
    };
  } catch {
    return { ...rong, unreadable: true };
  }
}

function refreshAuth() {
  const out = {};
  for (let n = 1; n <= claudeSlotCount(); n++) out[n] = readAuthSlot(n);
  authCache = out;
  return out;
}

function claudeSlots() {
  const list = [];
  for (let n = 1; n <= claudeSlotCount(); n++) {
    list.push(authCache[n] || { slot: n, loggedIn: false, email: '', orgName: '', subscriptionType: '', chuaDoc: true });
  }
  return list;
}

/** Slot kế còn đăng nhập, bỏ qua các slot đã thử trong chính lượt chạy này. */
function nextLoggedInSlot(daThu) {
  for (const s of claudeSlots()) if (s.loggedIn && !daThu.has(s.slot)) return s.slot;
  return null;
}

const shortId = (s) => String(s || '').slice(0, 8);

function oneLine(v, max = 140) {
  const s = typeof v === 'string' ? v : JSON.stringify(v === undefined ? '' : v);
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/**
 * Đổi một dòng NDJSON của `claude --output-format stream-json` thành dòng người
 * đọc được. Trả về mảng (có thể rỗng = bỏ qua dòng nhiễu).
 *
 * Vì sao phải có: `claude -p` trơn KHÔNG in gì cho tới khi chạy xong. Một lần
 * viết kịch bản mất nhiều phút, suốt thời gian đó khung log trống trơn còn đồng
 * hồ vẫn chạy — QC không thể phân biệt "đang làm" với "treo". Đó chính là lỗi
 * EVAL_V1_210 ngày 18/09: agent chạy thật 3 phút 53 giây rồi chết vì hết hạn mức,
 * mà trang không hiện lấy một chữ.
 *
 * Dòng không phải JSON thì trả nguyên văn — bản Claude Code sau có đổi định dạng
 * thì QC vẫn thấy chữ, không mất trắng.
 */
function claudeLine(line, stream, seen) {
  const t = String(line).trim();
  if (!t) return [];
  if (stream === 'err') return [t];
  if (t[0] !== '{') return [t];

  let ev;
  try {
    ev = JSON.parse(t);
  } catch {
    return [t];
  }

  if (ev.type === 'system') {
    if (ev.subtype === 'init') {
      return [`[Claude] Bắt đầu · phiên ${shortId(ev.session_id)} · ${(ev.tools || []).length} tool`];
    }
    if (ev.subtype === 'hook_response' && ev.exit_code) {
      return [`[Claude] hook ${ev.hook_name} lỗi (exit ${ev.exit_code})`];
    }
    return [];
  }

  // Claude Code báo hết hạn mức bằng sự kiện riêng — bắt lấy để nói thẳng ra,
  // thay vì để QC đoán từ exit code 1.
  if (ev.type === 'rate_limit_event') {
    const i = ev.rate_limit_info || {};
    if (i.status !== 'rejected') return [];
    let when = '';
    try {
      if (i.resetsAt) when = new Date(i.resetsAt * 1000).toLocaleTimeString('vi-VN');
    } catch {
      /* múi giờ lạ thì bỏ qua giờ mở lại */
    }
    const msg = `Hết hạn mức Claude (${i.rateLimitType || 'không rõ'})${when ? ' — mở lại lúc ' + when : ''}`;
    seen.limit = msg;
    return [`[Claude] ⛔ ${msg}. KHÔNG phải treo: tài khoản bị chặn nên không chạy tiếp được.`];
  }

  if (ev.type === 'assistant') {
    const out = [];
    for (const c of (ev.message && ev.message.content) || []) {
      if (c.type === 'text' && String(c.text || '').trim()) out.push(`[Claude] ${String(c.text).trim()}`);
      else if (c.type === 'tool_use') out.push(`[Claude] → ${c.name} ${oneLine(c.input)}`);
      else if (c.type === 'thinking') out.push('[Claude] (đang suy nghĩ…)');
    }
    return out;
  }

  // Kết quả tool có thể dài hàng nghìn dòng — chỉ báo đạt/lỗi, đừng đổ vào log QC.
  if (ev.type === 'user') {
    for (const c of (ev.message && ev.message.content) || []) {
      if (c.type === 'tool_result') return [`[Claude] ← ${c.is_error ? 'tool LỖI' : 'tool xong'}`];
    }
    return [];
  }

  if (ev.type === 'result' || ev.terminal_reason !== undefined) {
    const giay = ev.duration_ms ? ` · ${Math.round(ev.duration_ms / 1000)}s` : '';
    // BẪY: subtype vẫn là "success" cả khi chạy hỏng — lần hết hạn mức 429 cũng
    // báo "success". `is_error` mới là cờ đúng. Đừng đọc subtype để kết luận.
    if (ev.is_error) {
      const vi = ev.terminal_reason || 'lỗi';
      seen.hardFail = ev.api_error_status ? `${vi} (HTTP ${ev.api_error_status})` : vi;
      return [`[Claude] ✗ Kết thúc LỖI: ${seen.hardFail}${giay}`];
    }
    return [`[Claude] ✓ Kết thúc: ${ev.subtype || ev.terminal_reason || 'xong'}${giay}`];
  }

  return [];
}

/**
 * Câu nhắc gửi cho Claude. Dựng từ mẫu cố định + mã case đã kiểm, không ghép chuỗi
 * tự do từ trình duyệt.
 */
function buildPrompt(kind, ids, round) {
  const list = ids.join(' ');
  if (kind === 'diagnose') {
    return (
      `Dùng skill fastdo-eval-runner. Các case sau vừa chạy KHÔNG ĐẠT: ${list}. ` +
      'Đọc báo cáo chẩn đoán mới nhất của từng case trong runs/ (hoặc diagnostics/<mã>.fail.md), ' +
      'phân loại theo bảng chẩn đoán trong SKILL.md, rồi nói rõ từng case là bug app hay lỗi kịch bản. ' +
      'Lỗi kịch bản thì sửa và chạy nháp lại. TUYỆT ĐỐI KHÔNG ghi Google Sheet, và không sửa ' +
      'testcase cho pass khi chẩn đoán là KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT.'
    );
  }
  return (
    `Dùng skill fastdo-eval-runner. Viết kịch bản cho các case chưa có: ${list}. ` +
    `Chạy "npm run plan -- ${list}" để lấy đặc tả từ Sheet, bám đúng mục "Các bước" và ` +
    '"Kết quả mong muốn", đừng tự nghĩ tiêu chí khác. Viết xong thì chạy nháp ' +
    `("npm test -- ${list} --no-record --no-sheet") cho tới khi đạt. Nếu có file .ui-token ` +
    'ở gốc repo thì chạy qua "node src/tools/ui-run.js" để QC xem log trực tiếp. ' +
    `TUYỆT ĐỐI KHÔNG ghi Google Sheet ở bước này (vòng dự kiến là ${round}, QC sẽ tự chạy thật sau).`
  );
}

/**
 * Trên Windows, `claude` là file .cmd do npm tạo. Node TỪ CHỐI spawn .cmd khi
 * shell:false (ENOENT với 'claude', EINVAL với 'claude.cmd') — đó chính là lỗi
 * "spawn claude ENOENT". Nên bắt buộc shell:true.
 *
 * Bù lại, dòng lệnh phải KHÔNG chứa gì động: câu nhắc đi qua stdin, chỉ các cờ cố
 * định mới nằm trên dòng lệnh. Nhờ vậy vẫn không có chỗ nào để chèn lệnh.
 */
let claudeVersionCache = null;
function claudeVersion() {
  if (claudeVersionCache !== null) return claudeVersionCache;
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true, timeout: 15000 });
    claudeVersionCache = r.status === 0 ? String(r.stdout).trim() : '';
  } catch {
    claudeVersionCache = '';
  }
  return claudeVersionCache;
}

function claudeInfo() {
  const env = readEnvFile();
  return {
    auto: env.CLAUDE_AUTO_RUN === '1',
    model: (env.CLAUDE_MODEL || '').trim(),
    version: claudeVersion(),
    available: Boolean(claudeVersion()),
  };
}

function ffmpegAvailable() {
  try {
    return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', shell: true }).status === 0;
  } catch {
    return false;
  }
}

function buildState() {
  const env = readEnvFile();
  const config = {};
  for (const k of READABLE_ENV) config[k] = env[k] || '';

  // Bí mật: chỉ có/không, không bao giờ giá trị.
  const secrets = {};
  for (const k of Object.keys(env)) {
    if (!READABLE_ENV.includes(k)) secrets[k] = Boolean(env[k]);
  }

  const required = ['FASTDO_EMAIL', 'FASTDO_PASSWORD', 'DRIVE_CLIENT_ID', 'DRIVE_CLIENT_SECRET', 'DRIVE_REFRESH_TOKEN', 'TARGET_URL', 'SHEET_ID',
    'GOOGLE_SA_KEY_FILE'];
  const missing = required.filter((k) => !env[k]);
  if (!env.SHEET_GID && !env.SHEET_TAB) missing.push('SHEET_GID');
  return {
    config,
    secrets,
    editable: EDITABLE_ENV,
    missing,
    hasSlot2: Boolean(env.FASTDO_EMAIL_2 && env.FASTDO_PASSWORD_2),
    ffmpeg: ffmpegAvailable(),
    claudeAuto: claudeAutoEnabled(),
    claude: claudeInfo(),
    claudeSlots: claudeSlots(),
    claudeAutoSwitch: claudeAutoSwitch(),
    sheet: readSheetCache(),
    queue: readQueue().items,
    sheetUrl: env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/edit` : '',
    cases: listCases(),
    runs: listRuns(),
  };
}

// ---------------------------------------------------------------------------
// Tiến trình con + luồng log
// ---------------------------------------------------------------------------

const jobs = new Map();
const MAX_LINES = 3000;

function startJob(label, args, meta = {}) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    shell: false, // tuyệt đối không bật: tham số đến từ trình duyệt
    env: process.env,
  });
  return adoptChild(child, label, args, meta);
}

/** Gắn một tiến trình con đã spawn vào hệ thống job + luồng log */
function adoptChild(child, label, args, meta = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, label, args, child, lines: [], done: false, code: null, listeners: new Set(), ...meta };
  jobs.set(id, job);
  // Báo cho mọi trang đang mở — kể cả job do Claude khởi động qua API, để QC thấy
  // log chảy về mà không phải làm gì.
  notifyChanged(`bắt đầu: ${label}`);
  broadcast('job', { jobId: id, label });

  const emit = (text, stream) => {
    const entry = { stream, text };
    job.lines.push(entry);
    if (job.lines.length > MAX_LINES) job.lines.shift();
    job.lastLineAt = Date.now();
    for (const res of job.listeners) send(res, 'line', entry);
  };

  // Một dòng có thể bị cắt làm đôi giữa hai chunk. Với log thường thì chỉ xấu,
  // nhưng NDJSON của Claude mà đứt giữa chừng là parse hỏng — nên giữ phần đuôi
  // dở lại, ghép vào chunk sau.
  const tail = { out: '', err: '' };

  const push = (chunk, stream) => {
    const parts = (tail[stream] + String(chunk)).split(/\r?\n/);
    tail[stream] = parts.pop();
    for (const line of parts) {
      if (!line) continue;
      const outs = job.transform ? job.transform(line, stream) : [line];
      for (const text of outs) if (text) emit(text, stream);
    }
  };

  const flush = (stream) => {
    const rest = tail[stream];
    if (!rest) return;
    tail[stream] = '';
    const outs = job.transform ? job.transform(rest, stream) : [rest];
    for (const text of outs) if (text) emit(text, stream);
  };

  // Claude im lặng rất lâu trong lúc suy nghĩ hoặc chạy một tool dài. Không có
  // nhịp tim thì QC nhìn khung log trống + đồng hồ chạy và tưởng treo — đó đúng
  // là lỗi đã gặp với EVAL_V1_210.
  let beat = null;
  if (meta.heartbeat) {
    const t0 = Date.now();
    job.lastLineAt = t0;
    beat = setInterval(() => {
      const im = Date.now() - job.lastLineAt;
      if (im < 25000) return;
      const entry = {
        stream: 'out',
        text: `[UI] vẫn đang chạy — ${Math.round((Date.now() - t0) / 1000)}s, ${Math.round(im / 1000)}s chưa có dòng mới.`,
      };
      job.lines.push(entry);
      if (job.lines.length > MAX_LINES) job.lines.shift();
      for (const res of job.listeners) send(res, 'line', entry);
    }, 15000);
    beat.unref();
  }

  // Một job có thể chạy qua NHIỀU tiến trình con nối tiếp: slot 1 hết hạn mức thì
  // meta.onExit trả về tiến trình mới chạy bằng slot 2, và job vẫn là job cũ.
  // Nhờ vậy trang QC không đứt luồng log giữa chừng, khung nhật ký đang xem vẫn
  // chảy tiếp thay vì biến mất rồi hiện lại.
  const wire = (c) => {
    job.child = c;
    c.stdout.on('data', (x) => push(x, 'out'));
    c.stderr.on('data', (x) => push(x, 'err'));
    c.on('error', (err) => push(`[UI] không chạy được tiến trình: ${err.message}`, 'err'));
    c.on('close', (code) => {
      flush('out');
      flush('err');
      tail.out = '';
      tail.err = '';

      let ke = null;
      try {
        ke = meta.onExit ? meta.onExit(code, job, emit) : null;
      } catch (err) {
        emit(`[UI] không chuyển được tiến trình kế: ${err.message}`, 'err');
      }
      if (ke) return wire(ke);

      if (beat) clearInterval(beat);
      job.done = true;
      job.code = code;
      try {
        if (meta.onDone) meta.onDone(code, job);
      } catch (err) {
        console.error('[UI] onDone lỗi:', err);
      }
      notifyChanged(`xong: ${job.label}`);
      for (const res of job.listeners) {
        send(res, 'done', { code });
        res.end();
      }
      job.listeners.clear();
    });
  };
  wire(child);

  return job;
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('body quá lớn'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`body không phải JSON hợp lệ: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Chặn trang web khác trong cùng trình duyệt gọi sang server này. Token là lớp
 * chính; Origin là lớp hai.
 */
function authorized(req, tokenFromQuery) {
  const token = req.headers['x-fastdo-token'] || tokenFromQuery;
  if (token !== TOKEN) return false;

  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return false;

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;

  return true;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** Chỉ nhận thư mục nằm trong runs/, và phải là tên thư mục trần (không có dấu /) */
function safeRunDir(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const target = path.join(RUNS_DIR, name);
  if (!fs.existsSync(path.join(target, 'result.json'))) return null;
  return target;
}

const HTML_PATH = path.join(__dirname, 'index.html');

async function handle(req, res, url) {
  const q = url.searchParams;

  // --- trang ---
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(HTML_PATH, 'utf8').replace('__UI_TOKEN__', TOKEN);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }

  // --- trạng thái ---
  if (req.method === 'GET' && url.pathname === '/api/state') {
    if (!authorized(req, q.get('token'))) return json(res, 403, { error: 'token sai' });
    return json(res, 200, buildState());
  }

  // --- log trực tiếp (SSE) ---
  if (req.method === 'GET' && url.pathname.startsWith('/api/log/')) {
    if (!authorized(req, q.get('token'))) return json(res, 403, { error: 'token sai' });
    const job = jobs.get(url.pathname.slice('/api/log/'.length));
    if (!job) return json(res, 404, { error: 'không có job này' });

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    job.lines.forEach((l) => send(res, 'line', l));
    if (job.done) {
      send(res, 'done', { code: job.code });
      return res.end();
    }
    job.listeners.add(res);
    req.on('close', () => job.listeners.delete(res));
    return undefined;
  }

  // --- cache danh sách case từ Sheet ---
  if (req.method === 'GET' && url.pathname === '/api/sheet') {
    if (!authorized(req, q.get('token'))) return json(res, 403, { error: 'token sai' });
    return json(res, 200, readSheetCache() || { empty: true });
  }

  // --- luồng sự kiện: có gì đổi trên đĩa, có job nào mới ---
  if (req.method === 'GET' && url.pathname === '/api/events') {
    if (!authorized(req, q.get('token'))) return json(res, 403, { error: 'token sai' });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    send(res, 'hello', { jobs: [...jobs.values()].filter((j) => !j.done).map((j) => ({ jobId: j.id, label: j.label })) });
    watchers.add(res);
    req.on('close', () => watchers.delete(res));
    return undefined;
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'không có route này' });
  if (!authorized(req, q.get('token'))) return json(res, 403, { error: 'token sai' });

  const body = await readBody(req);

  // --- chạy test ---
  if (url.pathname === '/api/run') {
    const known = new Set(listCases().map((c) => c.id));
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((v) => String(v).toUpperCase())
      .filter((v) => CASE_ID_RE.test(v) && known.has(v));
    if (!ids.length) return json(res, 400, { error: 'không có mã case hợp lệ nào' });

    const round = positiveInt(body.round, 1);
    // Engine v2: FAIL phải qua duyệt (xem video) — "ghi mọi kết quả" không còn.
    if (body.sheetOn === 'always') {
      return json(res, 400, { error: 'Không còn chế độ "ghi mọi kết quả": case KHÔNG ĐẠT phải được QC xem video rồi duyệt.' });
    }
    const sheetOn = ['pass', 'never'].includes(body.sheetOn) ? body.sheetOn : 'pass';
    const account = positiveInt(body.account, 1);

    // Hai lần chạy cùng slot dùng chung cổng CDP và chung profile Chrome — lần sau
    // sẽ nối vào Chrome của lần trước và phá tab của nó. Chặn ở đây, đừng để xảy ra.
    const dangChay = [...jobs.values()].find((j) => !j.done && j.kind === 'run' && j.account === account);
    if (dangChay) {
      return json(res, 409, {
        error: `Slot ${account} đang chạy "${dangChay.label}". Chờ xong hoặc bấm Dừng, hoặc dùng slot khác.`,
      });
    }

    const args = [path.join('src', 'runner.js'), ...ids, `--round=${round}`, `--sheet-on=${sheetOn}`];
    if (body.record === false) args.push('--no-record');
    if (body.upload === false) args.push('--no-upload');
    if (account > 1) args.push(`--account=${account}`);
    args.push(`--report-json=runs/ui-${Date.now()}.json`);

    const job = startJob(`test ${ids.join(' ')}`, args, { kind: 'run', account });
    return json(res, 200, { jobId: job.id, args });
  }

  // --- chuẩn bị (plan) ---
  if (url.pathname === '/api/plan') {
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((v) => String(v).toUpperCase())
      .filter((v) => CASE_ID_RE.test(v));
    if (!ids.length) return json(res, 400, { error: 'không có mã case hợp lệ nào' });
    const args = [path.join('src', 'tools', 'plan.js'), ...ids];
    const account = positiveInt(body.account, 1);
    if (account > 1) args.push(`--account=${account}`);
    const job = startJob(`plan ${ids.join(' ')}`, args);
    return json(res, 200, { jobId: job.id, args });
  }

  // --- duyệt & ghi Sheet một lần chạy đang chờ ---
  if (url.pathname === '/api/commit') {
    const dir = safeRunDir(body.dir);
    if (!dir) return json(res, 400, { error: 'thư mục run không hợp lệ' });
    const args = [path.join('src', 'tools', 'commit-result.js'), path.join('runs', body.dir)];
    if (body.dry) args.push('--dry');
    const job = startJob(`commit ${body.dir}`, args);
    return json(res, 200, { jobId: job.id, args });
  }

  // --- làm mới danh sách case từ Sheet (mở Chrome, ~15s) ---
  if (url.pathname === '/api/sheet/refresh') {
    const dangDump = [...jobs.values()].find((j) => !j.done && j.kind === 'sheet');
    if (dangDump) return json(res, 409, { error: 'Đang làm mới danh sách, chờ chút.' });
    const args = [path.join('src', 'tools', 'sheet-dump.js')];
    const account = positiveInt(body.account, 1);
    if (account > 1) args.push(`--account=${account}`);
    const job = startJob('làm mới danh sách từ Sheet', args, { kind: 'sheet' });
    return json(res, 200, { jobId: job.id, args });
  }

  // --- giao việc cho Claude ---
  if (url.pathname === '/api/claude') {
    const kind = body.kind === 'diagnose' ? 'diagnose' : 'write-script';
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((v) => String(v).toUpperCase())
      .filter((v) => CASE_ID_RE.test(v));
    if (!ids.length) return json(res, 400, { error: 'không có mã case hợp lệ nào' });

    const round = positiveInt(body.round, 1);
    const prompt = buildPrompt(kind, ids, round);

    const queue = readQueue();
    const item = {
      id: `q${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      kind,
      ids,
      round,
      prompt,
      status: 'pending',
      jobId: null,
    };

    // Mặc định: chỉ xếp hàng. Trang hiện câu nhắc để dán vào phiên chat.
    if (!claudeAutoEnabled()) {
      queue.items.unshift(item);
      writeQueue(queue);
      notifyChanged('có việc mới cho Claude');
      return json(res, 200, { queued: true, item });
    }

    // Chế độ tự gọi: chỉ bật được bằng CLAUDE_AUTO_RUN=1 trong .env.
    const info = claudeInfo();
    if (!info.available) {
      return json(res, 500, {
        error:
          'Không tìm thấy lệnh `claude` trong PATH của server. Cài Claude Code CLI, ' +
          'hoặc bỏ CLAUDE_AUTO_RUN=1 trong .env để quay về chế độ hàng đợi.',
      });
    }

    // Dòng lệnh CHỈ chứa cờ cố định. Câu nhắc đi qua stdin, nên dù shell:true
    // (bắt buộc trên Windows vì `claude` là .cmd) vẫn không có gì để chèn lệnh.
    // --output-format stream-json + --verbose: BẮT BUỘC, đừng bỏ đi.
    // `claude -p` trơn không in một chữ nào cho tới lúc chạy xong, nên trang chỉ
    // hiện đồng hồ đếm trên khung log trống — không phân biệt được đang làm hay
    // treo. Có stream-json thì từng bước Claude làm chảy về ngay.
    const cliArgs = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
    if (info.model) cliArgs.push('--model', info.model);

    // Slot do trình duyệt chọn, nhưng ép về số nguyên trong khoảng — nó CHỈ quyết
    // định biến môi trường CLAUDE_CONFIG_DIR dựng ở server, không bao giờ đi vào
    // dòng lệnh. Dòng lệnh vẫn thuần cờ cố định như trước.
    let slot = positiveInt(body.slot, 0);
    if (slot < 1 || slot > claudeSlotCount()) slot = (claudeSlots().find((s) => s.loggedIn) || {}).slot || 1;

    const daDangNhap = claudeSlots().find((s) => s.slot === slot && s.loggedIn);
    if (!daDangNhap) {
      return json(res, 400, {
        error: `Slot ${slot} chưa đăng nhập tài khoản Claude. Vào tab "Việc cho Claude" bấm "Đăng nhập" cho slot đó.`,
      });
    }

    const moChild = (n) => {
      const c = spawn('claude', cliArgs, {
        cwd: ROOT_DIR,
        shell: true,
        env: slotEnv(n),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      c.stdin.write(prompt);
      c.stdin.end();
      return c;
    };

    let child;
    try {
      child = moChild(slot);
    } catch (err) {
      return json(res, 500, { error: `không chạy được Claude CLI: ${err.message}` });
    }

    // `seen` gom lại những gì đọc được từ luồng NDJSON của LƯỢT hiện tại. Đổi slot
    // là lượt mới, phải thay hộp mới — không thì cờ "đã hết hạn mức" của slot cũ
    // dính sang, và lượt sau bị ghi nhầm là hỏng.
    const box = { seen: {}, tried: new Set([slot]) };

    const nhan = `claude${info.model ? ' (' + info.model + ')' : ''}: ${kind} ${ids.join(' ')}`;
    const job = adoptChild(child, nhan, ['claude', ...cliArgs, '< (câu nhắc qua stdin)'], {
      kind: 'claude',
      heartbeat: true,
      slot,
      transform: (line, stream) => claudeLine(line, stream, box.seen),

      // Hết hạn mức thì tự nhảy sang slot còn đăng nhập, ngay trong cùng một job.
      onExit: (code, j, emit) => {
        // QC bấm Dừng thì dừng hẳn. Không có dòng này, một lượt đã kịp dính hết hạn
        // mức rồi mới bị dừng tay sẽ tự nhảy sang slot khác và chạy tiếp — đúng cái
        // người bấm Dừng muốn tránh.
        if (j.stoppedByUser) return null;
        if (!box.seen.limit || !claudeAutoSwitch()) return null;
        const ke = nextLoggedInSlot(box.tried);
        if (!ke) {
          emit('[UI] Không còn slot nào khác đang đăng nhập — dừng ở đây.', 'err');
          return null;
        }
        box.tried.add(ke);
        emit(`[UI] ⇄ slot ${j.slot} hết hạn mức — chuyển sang slot ${ke} và chạy lại từ đầu…`, 'out');
        j.slot = ke;
        box.seen = {};
        j.transform = (line, stream) => claudeLine(line, stream, box.seen);
        return moChild(ke);
      },

      // Không có chỗ này thì mục hàng đợi đứng "running" vĩnh viễn, kể cả khi
      // Claude đã chết từ lâu — huy hiệu "Việc cho Claude" đếm toàn việc ma.
      onDone: (code, j) => {
        const bihuy = Boolean(j.stoppedByUser);
        patchQueueItem(item.id, {
          status: bihuy ? 'stopped' : code === 0 ? 'done' : 'failed',
          exitCode: code,
          slot: j.slot,
          endedAt: new Date().toISOString(),
          note: bihuy
            ? 'QC bấm Dừng — không phải lỗi'
            : box.seen.limit || box.seen.hardFail || (code === 0 ? '' : `Claude thoát với exit code ${code}`),
        });
        notifyChanged('Claude chạy xong');
      },
    });
    item.jobId = job.id;
    item.status = 'running';
    item.slot = slot;
    queue.items.unshift(item);
    writeQueue(queue);

    return json(res, 200, { queued: false, jobId: job.id, item });
  }

  // --- tài khoản Claude: xem lại / đăng nhập / đăng xuất từng slot ---
  if (url.pathname === '/api/claude/auth') {
    const act = String(body.action || 'refresh');

    if (act === 'refresh') {
      refreshAuth();
      return json(res, 200, { slots: claudeSlots() });
    }

    const slot = positiveInt(body.slot, 0);
    if (slot < 1 || slot > claudeSlotCount()) return json(res, 400, { error: 'slot không hợp lệ' });

    if (act === 'logout') {
      const r = spawnSync('claude', ['auth', 'logout'], {
        encoding: 'utf8', shell: true, timeout: 30000, env: slotEnv(slot),
      });
      refreshAuth();
      if (r.status !== 0) {
        const vi = String(r.stderr || r.stdout || '').trim().slice(0, 300);
        return json(res, 500, { error: `đăng xuất slot ${slot} không xong: ${vi}`, slots: claudeSlots() });
      }
      return json(res, 200, { ok: true, slots: claudeSlots() });
    }

    if (act === 'login') {
      // `claude auth login` BẮT BUỘC tương tác: nó mở trình duyệt chạy OAuth và
      // cần một cửa sổ dòng lệnh thật. Một nút web KHÔNG thể đăng nhập hộ, và
      // server cũng không bao giờ chạm vào mật khẩu hay token — chỉ mở cửa sổ ra
      // để QC tự bấm, xong thì bấm ⟳ trên trang.
      if (process.platform !== 'win32') {
        return json(res, 400, {
          error: 'Chỉ tự mở được cửa sổ đăng nhập trên Windows. Chạy tay: CLAUDE_CONFIG_DIR=<thư mục slot> claude auth login',
        });
      }
      try {
        const c = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', 'claude', 'auth', 'login'], {
          cwd: ROOT_DIR,
          env: slotEnv(slot),
          detached: true,
          stdio: 'ignore',
        });
        c.unref();
      } catch (err) {
        return json(res, 500, { error: `không mở được cửa sổ đăng nhập: ${err.message}` });
      }
      return json(res, 200, {
        ok: true,
        slot,
        dir: slotDir(slot) || 'mặc định của máy (~/.claude)',
      });
    }

    return json(res, 400, { error: 'action không hợp lệ' });
  }

  // --- đánh dấu một việc trong hàng đợi đã xong ---
  if (url.pathname === '/api/queue/resolve') {
    const queue = readQueue();
    const item = queue.items.find((i) => i.id === String(body.id || ''));
    if (!item) return json(res, 404, { error: 'không có việc này trong hàng đợi' });
    item.status = 'done';
    item.resolvedAt = new Date().toISOString();
    writeQueue(queue);
    notifyChanged('hàng đợi đổi');
    return json(res, 200, { ok: true });
  }

  // --- dừng tiến trình ---
  if (url.pathname === '/api/stop') {
    const job = jobs.get(String(body.jobId || ''));
    if (!job) return json(res, 404, { error: 'không có job này' });
    // Đánh dấu TRƯỚC khi giết: nếu không, lượt chạy bị QC chủ động dừng sẽ đóng
    // với exit code 1 y hệt một lần chết thật, và hàng đợi ghi "THẤT BẠI" đỏ lòm
    // cho một việc chỉ đơn giản là bị huỷ.
    if (!job.done) {
      job.stoppedByUser = true;
      killTree(job.child, { sweep: job.kind === 'claude' });
    }
    return json(res, 200, { ok: true });
  }

  // --- đọc báo cáo lỗi của một lần chạy ---
  if (url.pathname === '/api/failreport') {
    const dir = safeRunDir(body.dir);
    if (!dir) return json(res, 400, { error: 'thư mục run không hợp lệ' });
    const file = fs
      .readdirSync(dir)
      .find((f) => f.endsWith('.fail.md'));
    if (!file) return json(res, 404, { error: 'lần chạy này không có báo cáo lỗi' });
    return json(res, 200, { text: fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 200000) });
  }

  // --- sửa cấu hình ---
  if (url.pathname === '/api/config') {
    const env = readEnvFile();
    const { updates, errors } = validateConfig(body, env);
    if (errors.length) return json(res, 400, { error: errors.join(' · ') });
    if (!Object.keys(updates).length) return json(res, 400, { error: 'không có gì để đổi' });
    patchEnvFile(updates);
    return json(res, 200, { ok: true, updated: Object.keys(updates), state: buildState() });
  }

  return json(res, 404, { error: 'không có route này' });
}

// ---------------------------------------------------------------------------
// .ui-token — để công cụ khác TRÊN CÙNG MÁY gọi được API này.
//
// Nhờ nó, Claude (hoặc bất cứ script nào) chạy test qua giao diện thay vì spawn
// thẳng, và QC đang mở trang thấy log chảy về theo thời gian thực thay vì phải F5.
// File nằm trong .gitignore và bị xoá khi server tắt.
// ---------------------------------------------------------------------------
const TOKEN_FILE = path.join(ROOT_DIR, '.ui-token');

function writeTokenFile() {
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ port: PORT, token: TOKEN, url: `http://127.0.0.1:${PORT}`, pid: process.pid }, null, 2),
    'utf8'
  );
}

function removeTokenFile() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    /* đã xoá rồi thì thôi */
  }
}

// ---------------------------------------------------------------------------
// Theo dõi thay đổi trên đĩa -> đẩy sự kiện về trang đang mở
// ---------------------------------------------------------------------------
const watchers = new Set();
let watchTimer = null;

function broadcast(event, data) {
  for (const res of watchers) send(res, event, data);
}

/**
 * Gộp nhiều thay đổi liên tiếp làm một. Claude viết một file testcase có thể sinh
 * ra vài sự kiện fs liền nhau; QC không cần biết điều đó.
 */
function notifyChanged(reason) {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => broadcast('state', { reason }), 300);
}

function startWatching() {
  const targets = [
    { dir: path.join(ROOT_DIR, 'src', 'testcases'), reason: 'kịch bản' },
    { dir: RUNS_DIR, reason: 'lần chạy' },
  ];
  for (const { dir, reason } of targets) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.watch(dir, { recursive: true }, (_evt, filename) => {
        // Nói đúng tên thứ vừa đổi. Cache Sheet và hàng đợi cùng nằm trong runs/
        // nên nếu chỉ báo "lần chạy" thì QC đọc xong vẫn không hiểu chuyện gì.
        const f = String(filename || '');
        if (f.endsWith('.sheet-cache.json')) return notifyChanged('danh sách case từ Sheet');
        if (f.endsWith('.claude-queue.json')) return notifyChanged('hàng đợi Claude');
        notifyChanged(reason);
      });
    } catch (err) {
      console.warn(`[UI] Không theo dõi được ${dir}: ${err.message} — trang sẽ không tự cập nhật.`);
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  handle(req, res, url).catch((err) => {
    console.error('[UI]', err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Cổng ${PORT} đang bị chiếm. Chạy lại với cổng khác:  UI_PORT=7799 npm run ui\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  writeTokenFile();
  healQueue();
  startWatching();
  // Đọc trạng thái đăng nhập từng slot ở nhịp sau, đừng chặn lúc mở cổng:
  // mỗi slot mất 1-2 giây.
  setTimeout(() => {
    refreshAuth();
    notifyChanged('đọc xong tài khoản Claude');
  }, 50).unref();
  const link = `http://127.0.0.1:${PORT}/?token=${TOKEN}`;
  console.log('='.repeat(74));
  console.log('  GIAO DIỆN QC — Fastdo Eval Runner');
  console.log('='.repeat(74));
  console.log('  Mở link này trong trình duyệt (token đổi mỗi lần khởi động):');
  console.log(`  ${link}`);
  console.log('');
  console.log('  Chỉ nghe 127.0.0.1 — không ai ngoài máy này vào được.');
  console.log('  Trang tự cập nhật khi có kịch bản mới hoặc lần chạy mới — không cần F5.');
  console.log('  Claude chạy test qua: node src/tools/ui-run.js EVAL_xxx --round=N');
  console.log('  Ctrl+C để tắt.');
  console.log('='.repeat(74));
});

// Tắt sạch: đừng để tiến trình test mồ côi còn đang giữ Chrome.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    removeTokenFile();
    for (const job of jobs.values()) if (!job.done) killTree(job.child);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
