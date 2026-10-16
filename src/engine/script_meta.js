// ============================================================================
// script_meta.js: nạp kịch bản, đọc khai báo v2, tính mã băm.
//
//   profile   hồ sơ cần dùng (mặc định 'default')
//   resources dữ liệu dùng chung → không chạy cùng lúc; tự suy thêm từ hằng số
//             DRAFT_TEMPLATE_NAME / TEMPLATE_NAME (tiền tố "mau:")
//   consumes  dữ liệu bị tiêu hao mỗi lần chạy → cảnh báo cần thêm bản; luôn gộp vào resources
//   parallel  true = tự nhận an toàn khi chạy song song; bỏ trống = chạy một mình
//   timeoutSec hạn giờ (10–1800, mặc định 150)
//   ready     (kịch bản AI-QC theo ticket) true = đã chạy nháp ra kết quả hợp lệ trên bản đang test → agent mới chạy chính thức
//   blocker   (AI-QC) lý do chưa sẵn sàng, vd «cần tài khoản người duyệt khác người tạo đơn»
// Mã băm = file kịch bản + các helper thao tác + hàm dùng chung (testcases/lib, testcases/tickets/lib): sửa bất kỳ file nào →
// phải chạy nháp lại.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { NAME_RE } = require('./profiles');
const { ticketOf } = require('./case_id');

const TESTCASE_DIR = path.join(config.ROOT_DIR, 'src', 'testcases');
const FIXTURE_CONST_RE = /(?:DRAFT_)?TEMPLATE_NAME\s*=\s*['"]([^'"]+)['"]/g;
const HASH_FILES = [
  'src/engine/ctx.js',
  'src/engine/steps.js',
  'src/core/evaluation_helpers.js',
  'src/core/cursor_motion.js',
  'src/core/page_ready.js',
  'src/core/datetime_picker.js',
];
const DEFAULT_TIMEOUT_SEC = 150;
const MAX_BLOCKER = 300;
// «ready: true» ở đầu dòng hoặc sau { , — kịch bản AI viết gọn nhiều thuộc tính trên 1 dòng
const READY_TRUE_RE = /(^|[{,\s])(ready\s*:\s*)true\b/g;

function findScriptFile(caseId, dir = TESTCASE_DIR) {
  // Case AI-QC theo ticket để riêng thư mục tickets/ — kho kịch bản Đánh giá không lẫn với kịch bản ticket.
  if (ticketOf(caseId)) {
    const p = path.join(dir, 'tickets', `${caseId.toLowerCase()}.test.js`);
    return fs.existsSync(p) ? p : null;
  }
  for (const name of [`${caseId.toLowerCase()}.test.js`, `${caseId}.test.js`, `${caseId.toLowerCase()}_record.js`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function derivedResources(source) {
  const out = [];
  const re = new RegExp(FIXTURE_CONST_RE.source, 'g');
  let m;
  while ((m = re.exec(source)) !== null) out.push(`mau:${m[1]}`);
  return out;
}

function readMeta(mod, file, source = '') {
  const problems = [];
  const id = String(mod.id || path.basename(file).replace(/\.test\.js$|_record\.js$/i, '')).toUpperCase();
  const profile = mod.profile === undefined ? 'default' : String(mod.profile);
  if (!NAME_RE.test(profile)) problems.push(`profile "${profile}" không hợp lệ (chỉ a-z, 0-9, _)`);

  const list = (v, name) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
      problems.push(`${name} phải là mảng chuỗi`);
      return [];
    }
    return v.map((x) => x.trim());
  };
  const consumes = list(mod.consumes, 'consumes');
  const resources = [...new Set([...list(mod.resources, 'resources'), ...consumes, ...derivedResources(source)])];

  const t = mod.timeoutSec === undefined ? DEFAULT_TIMEOUT_SEC : Number(mod.timeoutSec);
  const timeoutOk = Number.isInteger(t) && t >= 10 && t <= 1800;
  if (!timeoutOk) problems.push(`timeoutSec "${mod.timeoutSec}" phải là số nguyên 10–1800`);
  if (typeof mod.run !== 'function') problems.push('thiếu hàm async run(ctx)');

  return {
    id,
    title: String(mod.title || ''),
    profile,
    resources,
    consumes,
    parallel: mod.parallel === true,
    timeoutSec: timeoutOk ? t : DEFAULT_TIMEOUT_SEC,
    ready: mod.ready === true,
    blocker: typeof mod.blocker === 'string' ? mod.blocker.trim().slice(0, MAX_BLOCKER) : '',
    problems,
  };
}

function scriptHash(file, root = config.ROOT_DIR, extra = HASH_FILES) {
  const h = crypto.createHash('sha256');
  const add = (p) => {
    h.update(path.relative(root, p).replace(/\\/g, '/'));
    h.update('\0');
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));
    h.update('\0');
  };
  add(file);
  for (const rel of extra) add(path.join(root, rel));
  for (const libDir of [path.join(root, 'src', 'testcases', 'lib'), path.join(root, 'src', 'testcases', 'tickets', 'lib')]) {
    if (!fs.existsSync(libDir)) continue;
    for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js')).sort()) add(path.join(libDir, f));
  }
  return h.digest('hex').slice(0, 12);
}

/** null nếu chưa có kịch bản */
function loadScript(caseId) {
  const file = findScriptFile(caseId);
  if (!file) return null;
  const source = fs.readFileSync(file, 'utf8');
  const mod = require(file);
  return { file, module: mod, meta: readMeta(mod, file, source), hash: scriptHash(file) };
}

/** File kịch bản AI-QC của 1 ticket: tickets/<ticket>-*.test.js, theo tên. */
function ticketScriptFiles(ticket, dir = TESTCASE_DIR) {
  const folder = path.join(dir, 'tickets');
  if (!fs.existsSync(folder)) return [];
  const prefix = `${String(ticket).toLowerCase()}-`;
  return fs
    .readdirSync(folder)
    .filter((name) => name.toLowerCase().startsWith(prefix) && name.toLowerCase().endsWith('.test.js'))
    .sort()
    .map((name) => path.join(folder, name));
}

/**
 * Kịch bản AI-QC của 1 ticket cho agent: mã case theo TÊN FILE (runner tìm kịch bản theo tên file), sẵn sàng hay chưa, lý do,
 * lỗi khai báo. File nạp hỏng / id trong file khác tên file → problems (agent không chạy).
 * @returns {{id: string, ready: boolean, blocker: string, problems: string[]}[]}
 */
function listTicketScripts(ticket, dir = TESTCASE_DIR) {
  return ticketScriptFiles(ticket, dir).map((file) => {
    const id = path.basename(file).replace(/\.test\.js$/i, '').toUpperCase();
    try {
      delete require.cache[require.resolve(file)];
      const meta = readMeta(require(file), file, fs.readFileSync(file, 'utf8'));
      const problems = meta.problems.slice();
      if (meta.id !== id) problems.push(`id trong file "${meta.id}" khác tên file (phải là '${id}')`);
      return { id, ready: meta.ready, blocker: meta.blocker, problems };
    } catch (err) {
      return { id, ready: false, blocker: '', problems: [`không nạp được kịch bản: ${err && err.message ? err.message : err}`] };
    }
  });
}

// JSDoc ngay trên 1 hàm: /** dòng mô tả … */ (async) function tên(tham số)
const HELPER_RE = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;

/** Dòng mô tả đầu tiên của 1 khối JSDoc (bỏ dấu *, bỏ dòng @param…) */
function firstDocLine(block) {
  const line = block
    .split('\n')
    .map((x) => x.replace(/^\s*\*\s?/, '').trim())
    .find((x) => x && !x.startsWith('@'));
  return line || '';
}

/**
 * Hàm tạo dữ liệu / cấu hình dùng chung giữa các ticket (testcases/tickets/lib/*.js) cho prompt tái hiện AI-QC: chỉ hàm được
 * export và có JSDoc ngay trên. File nạp hỏng → 1 dòng báo lỗi để phiên tái hiện biết mà sửa.
 * @returns {{file: string, name: string, doc: string}[]}
 */
function listHelpers(dir = TESTCASE_DIR) {
  const folder = path.join(dir, 'tickets', 'lib');
  if (!fs.existsSync(folder)) return [];
  const out = [];
  for (const name of fs.readdirSync(folder).filter((x) => x.endsWith('.js')).sort()) {
    const file = path.join(folder, name);
    let exported;
    try {
      delete require.cache[require.resolve(file)];
      exported = require(file);
    } catch (err) {
      out.push({ file: name, name: '(nạp lỗi)', doc: `không nạp được: ${err && err.message ? err.message : err}` });
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    const re = new RegExp(HELPER_RE.source, 'g');
    let m;
    while ((m = re.exec(source)) !== null) {
      if (!exported || typeof exported[m[2]] !== 'function') continue;
      const params = m[3].replace(/\s+/g, ' ').trim();
      out.push({ file: name, name: `${m[2]}(${params})`, doc: firstDocLine(m[1]) });
    }
  }
  return out;
}

/** Đặt mọi «ready: true» của kịch bản ticket thành false — lượt AI-QC nào cũng phải chạy nháp lại trên bản đang test rồi mới
 * đánh dấu lại. Trả mã các case vừa bỏ đánh dấu. */
function resetTicketReady(ticket, dir = TESTCASE_DIR) {
  const changed = [];
  for (const file of ticketScriptFiles(ticket, dir)) {
    const source = fs.readFileSync(file, 'utf8');
    const next = source.replace(READY_TRUE_RE, '$1$2false');
    if (next === source) continue;
    fs.writeFileSync(file, next, 'utf8');
    changed.push(path.basename(file).replace(/\.test\.js$/i, '').toUpperCase());
  }
  return changed;
}

module.exports = {
  findScriptFile,
  derivedResources,
  readMeta,
  scriptHash,
  loadScript,
  listTicketScripts,
  resetTicketReady,
  listHelpers,
  HASH_FILES,
  DEFAULT_TIMEOUT_SEC,
  TESTCASE_DIR,
};
