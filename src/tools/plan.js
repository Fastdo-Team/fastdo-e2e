#!/usr/bin/env node
// ============================================================================
// plan.js: MỘT lệnh chuẩn bị trước khi chạy test — gộp preflight + case-info.
//
//   node src/tools/plan.js EVAL_021 EVAL_022
//   npm run plan -- EVAL_021 EVAL_022 --full
//
// Vì sao có tool này: quy trình cũ tốn 4 lần khởi động Chrome cho 1 case
// (preflight → case-info → chạy nháp → chạy thật). Mỗi lần boot + đăng nhập lại
// mất 2.5-8 giây, chưa kể mỗi lệnh là một lượt chờ của người đang ngồi xem.
// plan.js dùng ĐÚNG MỘT phiên Chrome để trả lời trọn bộ câu hỏi cần biết trước
// khi chạy:
//
//   1. Hạ tầng có sống không?          (thư viện, .env, ffmpeg, tunnel, đăng nhập)
//   2. Case này có trong Sheet không?  (đặc tả: điều kiện, các bước, kết quả mong muốn)
//   3. Đã có kịch bản chưa?            (src/testcases/eval_xxx.test.js)
//   4. Mẫu dữ liệu case cần còn không? (chỉ kiểm mẫu của ĐÚNG các case được hỏi)
//   5. Nên ghi vào vòng test thứ mấy?  (đọc các vòng đã có kết quả rồi +1)
//
// Exit code — để xâu chuỗi lệnh được:
//   0 = mọi case sẵn sàng chạy
//   1 = có thứ chặn hẳn (thiếu thư viện/.env, tunnel chết, case không có trong
//       Sheet, mẫu dữ liệu đã mất) — chạy tiếp là chết oan
//   2 = hạ tầng OK nhưng có case chưa có kịch bản, cần viết trước
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Kiểm tra thư viện TRƯỚC mọi require nặng. Máy mới clone repo về chưa chạy
// `npm install` thì mọi tool trong repo đều chết bằng "Cannot find module
// 'dotenv'" — thông báo đó không nói cho QC biết phải làm gì.
if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'dotenv'))) {
  console.error('');
  console.error('✗ Chưa cài thư viện cho repo này.');
  console.error('  Chạy 1 lần duy nhất:  npm install');
  console.error('');
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
  console.error('');
  console.error('✗ Chưa có file .env ở gốc repo.');
  console.error('  Tạo từ mẫu rồi điền giá trị thật:');
  console.error('      cp .env.example .env');
  console.error('  Bắt buộc: FASTDO_EMAIL, FASTDO_PASSWORD, CATBOX_USERHASH, TARGET_URL, SHEET_ID');
  console.error('');
  process.exit(1);
}

const { spawnSync } = require('child_process');
const fetch = require('node-fetch');
const config = require('../config');
const { initBrowser } = require('../core/browser');
const { ensureAuthenticated } = require('../core/session');
const { humanClick } = require('../core/cursor_motion');
const { waitForSettle } = require('../core/page_ready');
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
const H = require('../core/evaluation_helpers');
const G = require('../core/sheet_grid');
const F = require('./lib/fixtures');

const LINE = '='.repeat(74);
const THIN = '-'.repeat(74);

// ---------------------------------------------------------------------------
// Thu kết quả kiểm tra hạ tầng. hard = true nghĩa là chặn hẳn (exit 1).
// ---------------------------------------------------------------------------
const checks = [];
function record(ok, label, detail, hard = true) {
  checks.push({ ok, label, detail, hard });
  console.log(`${ok ? '✓' : hard ? '✗' : '⚠'} ${label}${detail ? ' — ' + detail : ''}`);
}

function parseArgs() {
  const opts = { caseIds: [], full: false, round: null, noApp: false, split: 1 };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--full') opts.full = true;
    else if (arg === '--no-app') opts.noApp = true;
    else if (arg.startsWith('--round=')) opts.round = parseInt(arg.split('=')[1], 10) || null;
    else if (arg.startsWith('--split=')) opts.split = Math.max(1, parseInt(arg.split('=')[1], 10) || 1);
    else if (arg.startsWith('--account=')) continue; // config.js đã đọc, bỏ qua ở đây
    else if (arg.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${arg}"`);
      console.error('        Cờ hợp lệ: --full  --no-app  --round=N  --split=N  --account=N');
      process.exit(1);
    } else opts.caseIds.push(arg.toUpperCase());
  }

  return opts;
}

/**
 * Kiểm tra .env đã khai báo đủ tài khoản cho số slot muốn chạy song song chưa.
 * Bảo QC mở terminal thứ hai rồi mới phát hiện thiếu FASTDO_EMAIL_2 là phí một
 * vòng thử — nên chặn ngay ở đây.
 */
function checkParallelSlots(split) {
  if (split < 2) return true;

  const missing = [];
  for (let slot = 2; slot <= split; slot += 1) {
    if (!process.env[`FASTDO_EMAIL_${slot}`]) missing.push(`FASTDO_EMAIL_${slot}`);
    if (!process.env[`FASTDO_PASSWORD_${slot}`]) missing.push(`FASTDO_PASSWORD_${slot}`);
  }

  record(
    missing.length === 0,
    `Tài khoản cho ${split} slot song song`,
    missing.length ? `thiếu trong .env: ${missing.join(', ')}` : `đủ tài khoản cho slot 1..${split}`
  );
  return missing.length === 0;
}

/** Chia danh sách case thành n phần xen kẽ, để 2 slot về đích gần nhau */
function splitEvenly(items, n) {
  const groups = Array.from({ length: n }, () => []);
  items.forEach((item, i) => groups[i % n].push(item));
  return groups.filter((g) => g.length);
}

/** Đường dẫn file kịch bản của case, null nếu chưa có */
function findTestcaseFile(caseId) {
  const dir = path.join(ROOT_DIR, 'src', 'testcases');
  for (const name of [`${caseId.toLowerCase()}.test.js`, `${caseId}.test.js`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return path.relative(ROOT_DIR, p).replace(/\\/g, '/');
  }
  return null;
}

function checkEnvVars() {
  // Lấy thẳng từ config để không có bản chép thứ hai: thêm biến bắt buộc mà quên
  // sửa ở đây thì plan báo "đủ biến" rồi runner mới từ chối — cổng chuẩn bị nói
  // sẵn sàng còn lệnh thật thì không chạy.
  const missing = config.missingRequired();
  record(
    missing.length === 0,
    'Biến môi trường',
    missing.length
      ? `thiếu: ${missing.join(', ')} (xem .env.example)`
      : `đủ ${config.REQUIRED_ENV.length} biến bắt buộc`
  );
}

function checkFfmpeg() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', shell: true });
    record(
      r.status === 0,
      'ffmpeg trong PATH',
      r.status === 0
        ? String(r.stdout || '').split('\n')[0].slice(0, 50)
        : 'không gọi được — chạy được nhưng phải thêm --no-record (không có video nộp QC)',
      false
    );
  } catch (err) {
    record(false, 'ffmpeg trong PATH', err.message, false);
  }
}

function checkSessionFile() {
  const exists = fs.existsSync(config.AUTH_STATE_PATH);
  const age = exists
    ? `lưu cách đây ${((Date.now() - fs.statSync(config.AUTH_STATE_PATH).mtimeMs) / 3600000).toFixed(1)} giờ`
    : 'chưa có .auth/user_state.json — lần chạy đầu sẽ tự đăng nhập bằng .env';
  record(exists, 'File session', age, false);
}

async function checkTunnel() {
  try {
    const res = await fetch(config.TARGET_URL, { timeout: 15000 });
    record(res.status === 200, 'Dev tunnel TARGET_URL', `HTTP ${res.status} — ${config.TARGET_URL}`);
  } catch (err) {
    record(false, 'Dev tunnel TARGET_URL', `${err.message} — TARGET_URL trong .env đã đổi/hết hạn?`);
  }
}

/** In đặc tả: đầy đủ khi cần viết kịch bản, tóm tắt khi chỉ chạy lại */
function printSpecBlock(spec, full) {
  if (!spec.length) {
    console.log('  (mọi cột đặc tả đều rỗng — kiểm tra lại tab Sheet)');
    return;
  }

  if (full) {
    G.printSpec(spec, '  ');
    return;
  }

  for (const { label, value } of spec) {
    const oneLine = value.replace(/\s+/g, ' ');
    console.log(`  ${label}: ${oneLine.length > 110 ? oneLine.slice(0, 109) + '…' : oneLine}`);
  }
}

function printRoundsBlock(info, overrideRound) {
  if (info.done.length) {
    const summary = info.done
      .map((r) => `LẦN ${r.number}${r.status ? ` (${r.status})` : ''}`)
      .join(', ');
    console.log(`  Vòng đã chạy : ${summary}`);
  } else {
    console.log('  Vòng đã chạy : (chưa vòng nào có kết quả)');
  }

  const chosen = overrideRound || info.next;
  const source = overrideRound ? 'do bạn chỉ định' : 'suy ra từ Sheet';
  console.log(`  → Vòng sẽ ghi: LẦN ${chosen}  (${source})`);

  // Cảnh báo cả khi user tự chỉ định --round: đó chính là lúc dễ gõ quá số cột
  // Sheet đang có, và runner thì upload video xong mới phát hiện không ghi được.
  const columnExists = overrideRound ? chosen <= info.maxRoundColumn : info.columnExists;

  if (!columnExists) {
    console.log(
      `  ⚠ Sheet mới có cột tới TEST LẦN ${info.maxRoundColumn} — phải thêm cột cho LẦN ${chosen} ` +
        'trước, không thì chạy xong mới phát hiện không ghi được'
    );
  }
}

/**
 * Đọc lưới qua Sheets API — không cần Chrome, không phụ thuộc tab đang mở trên trình
 * duyệt. Kèm kiểm quyền SỬA của service account (hỏi Drive, không ghi thử).
 * @returns {Promise<{grid: string[][], tabTitle: string}>}
 */
async function readSheetGrid() {
  const sheet = await openSheet();
  for (const w of sheet.tab.warnings) record(false, 'Tab Sheet', w, false);
  const grid = await sheet.readGrid();
  record(true, 'Google Sheet (API)', `tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid}) — ${grid.length} dòng`);
  const canEdit = await sheet.client.canEdit();
  if (canEdit === true) {
    record(true, 'Quyền ghi Sheet', `service account ${sheet.client.saEmail} có quyền sửa`);
  } else if (canEdit === false) {
    record(false, 'Quyền ghi Sheet', `service account ${sheet.client.saEmail} CHƯA có quyền sửa — Share Sheet quyền Editor cho email này`);
  } else {
    record(false, 'Quyền ghi Sheet', 'không kiểm được qua Drive API — lần ghi đầu tiên sẽ biết', false);
  }
  return { grid, tabTitle: sheet.tab.title };
}

async function main() {
  const opts = parseArgs();

  console.log(LINE);
  console.log('  PLAN — chuẩn bị chạy test (1 phiên Chrome cho tất cả)');
  console.log(LINE);

  if (opts.caseIds.length === 0) {
    console.error('[ERROR] Thiếu mã testcase. Ví dụ: npm run plan -- EVAL_021 EVAL_022');
    process.exitCode = 1;
    return;
  }

  // --- Kiểm tra cục bộ: không cần mạng, không cần Chrome ---
  checkEnvVars();
  const slotsOk = checkParallelSlots(opts.split);
  checkFfmpeg();
  checkSessionFile();
  await checkTunnel();

  const tunnelOk = checks.some((c) => c.label === 'Dev tunnel TARGET_URL' && c.ok);
  const envOk = checks.some((c) => c.label === 'Biến môi trường' && c.ok);

  if (!tunnelOk || !envOk) {
    console.log('');
    console.log(THIN);
    console.log('  DỪNG — hạ tầng chưa chạy được, chưa cần mở Chrome.');
    checks.filter((c) => !c.ok && c.hard).forEach((c) => console.log(`   ✗ ${c.label}: ${c.detail}`));
    console.log(THIN);
    process.exitCode = 1;
    return;
  }

  // File kịch bản kiểm tra được ngay, không tốn giây nào
  const scripts = new Map(opts.caseIds.map((id) => [id, findTestcaseFile(id)]));
  const haveScript = opts.caseIds.filter((id) => scripts.get(id));

  // Chỉ kiểm mẫu dữ liệu của ĐÚNG các case được hỏi mà đã có kịch bản. Quét cả
  // thư mục như preflight là kiểm luôn mẫu của case không liên quan — vừa chậm
  // vừa báo đỏ những thứ không cản lần chạy này.
  const wantedFixtures = F.scanFixtureNames(haveScript);
  const needAppCheck = wantedFixtures.size > 0 && !opts.noApp;

  // Sheet đọc qua API, độc lập với phiên Chrome bên dưới.
  let grid = null;
  let tabTitle = config.SHEET_TAB;
  try {
    ({ grid, tabTitle } = await readSheetGrid());
  } catch (err) {
    record(false, 'Google Sheet (API)', err.message);
  }

  let instance = null;
  let fixtureResults = [];
  let draftNames = [];

  try {
    instance = await initBrowser();
    const { page } = instance;

    await ensureAuthenticated(page);
    record(true, 'Đăng nhập / session', 'vào được app bằng session sẵn có');

    // Kiểm app + mẫu TRƯỚC khi mở tab Sheet: tab Sheet lên foreground sẽ đẩy tab
    // app xuống nền, và Chrome bóp cổ tab nền tới mức lệnh CDP treo vô hạn.
    if (needAppCheck) {
      await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const settle = await waitForSettle(page, 30000);
      record(
        settle.settled,
        'App render được',
        settle.settled
          ? `ổn định sau ${settle.seconds.toFixed(1)}s, ${settle.count} element`
          : `hết hạn chờ ${settle.seconds.toFixed(1)}s, chỉ ${settle.count} element` +
              (settle.overlay ? ` (${settle.overlay})` : '') +
              ' — circuit Blazor chưa kết nối, thử lại'
      );

      const click = (p, el, o) => humanClick(p || page, el, o);
      await H.openEvaluationTab(page, click, 'template');
      const rows = await F.readTemplateRows(page);
      fixtureResults = F.matchFixtures(wantedFixtures, rows);
      draftNames = F.listDraftNames(rows);
      fixtureResults.forEach((r) => record(r.ok, `Mẫu "${r.name}"`, r.detail));
    } else {
      record(
        true,
        'Mẫu dữ liệu',
        opts.noApp
          ? 'bỏ qua theo --no-app'
          : 'các case này không phụ thuộc mẫu nào — bỏ qua bước mở app (nhanh hơn ~8s)',
        false
      );
    }

  } catch (err) {
    record(false, 'Chuẩn bị phiên Chrome', err.message);
  } finally {
    if (instance) await instance.close();
  }

  if (!grid) {
    console.log('');
    console.log(THIN);
    console.log('  DỪNG — chưa đọc được Sheet nên chưa chốt được vòng test.');
    console.log(THIN);
    process.exitCode = 1;
    return;
  }

  // --- Từng case ---
  const ready = [];
  const missingScript = [];
  const blocked = [];
  const allCaseIds = G.listCaseIds(grid);
  const blockedByFixture = new Set(fixtureResults.filter((r) => !r.ok).flatMap((r) => r.cases));

  for (const caseId of opts.caseIds) {
    console.log('');
    console.log(THIN);

    const rowIdx = G.findRowIndex(grid, caseId);
    if (rowIdx === -1) {
      console.log(`  ${caseId} — ✗ KHÔNG có trong cột A của tab "${showSpaces(tabTitle)}"`);
      const prefix = caseId.replace(/\d+.*$/, '');
      const near = allCaseIds.filter((v) => v.toUpperCase().startsWith(prefix)).slice(0, 12);
      console.log(THIN);
      console.log(`  Sheet đang có ${allCaseIds.length} mã. Cùng tiền tố "${prefix}": ${near.join(', ') || '(không có)'}`);
      blocked.push(caseId);
      continue;
    }

    const scriptFile = scripts.get(caseId);
    const spec = G.readSpec(grid, rowIdx);
    const roundInfo = G.suggestNextRound(grid, rowIdx);
    const title = (spec.find((s) => /tiêu đề|title/i.test(s.label)) || spec[1] || {}).value || '';

    console.log(`  ${caseId} — dòng ${rowIdx + 1}${title ? ' | ' + title.replace(/\s+/g, ' ').slice(0, 60) : ''}`);
    console.log(THIN);
    console.log(`  Kịch bản     : ${scriptFile ? '✓ ' + scriptFile : '✗ CHƯA CÓ — cần viết src/testcases/' + caseId.toLowerCase() + '.test.js'}`);

    if (blockedByFixture.has(caseId)) {
      console.log('  Mẫu dữ liệu  : ✗ mẫu case này cần đã mất — xem dòng ✗ ở trên');
    }

    printRoundsBlock(roundInfo, opts.round);

    console.log('');
    // Case chưa có kịch bản thì đặc tả chính là input để viết — phải in đủ.
    // Case đã có kịch bản thì kịch bản đã bám đặc tả rồi, in tóm tắt là đủ để
    // QC đối chiếu, khỏi đẩy hàng chục dòng vào màn hình mỗi lần chạy lại.
    printSpecBlock(spec, opts.full || !scriptFile);

    if (blockedByFixture.has(caseId)) blocked.push(caseId);
    else if (!scriptFile) missingScript.push(caseId);
    else ready.push({ caseId, round: opts.round || roundInfo.next });
  }

  // --- Kết luận ---
  console.log('');
  console.log(LINE);
  console.log('  KẾT LUẬN');
  console.log(LINE);

  if (ready.length) {
    const sameRound = new Set(ready.map((r) => r.round));
    console.log(`  Sẵn sàng chạy : ${ready.map((r) => `${r.caseId} (vòng ${r.round})`).join(', ')}`);
    console.log('');

    if (sameRound.size === 1) {
      // Chạy chung 1 lệnh dùng chung Chrome + session + tab Sheet: tiết kiệm
      // ~8-10 giây MỖI case so với gọi từng lệnh rời.
      const ids = ready.map((r) => r.caseId).join(' ');
      const round = [...sameRound][0];
      console.log(`  Chạy nháp (không video, không ghi Sheet — cứ chạy, an toàn):`);
      console.log(`      npm test -- ${ids} --no-record --no-sheet`);
      console.log('');
      console.log(`  Chạy thật (quay video + upload Catbox + GHI SHEET):`);
      console.log(`      npm test -- ${ids} --round=${round}`);

      if (opts.split > 1 && slotsOk) {
        const groups = splitEvenly(
          ready.map((r) => r.caseId),
          opts.split
        );
        console.log('');
        console.log(`  Hoặc chạy song song ${groups.length} slot — mỗi nhóm MỘT cửa sổ terminal riêng,`);
        console.log('  mở cùng lúc (mỗi slot có Chrome + tài khoản + file session riêng):');
        groups.forEach((ids2, i) => {
          const acc = i === 0 ? '' : ` --account=${i + 1}`;
          console.log(`      [Terminal ${i + 1}] npm test -- ${ids2.join(' ')}${acc} --round=${round}`);
        });
        console.log('');
        console.log('  Không đưa cùng một mã cho 2 slot: hai lần chạy sẽ ghi đè lẫn nhau trên');
        console.log('  cùng một ô Sheet, và kết quả giữ lại là của lần về đích sau, không phải');
        console.log('  lần đúng.');
      } else if (opts.split > 1 && !slotsOk) {
        console.log('');
        console.log('  ✗ Chưa chạy song song được — xem dòng ✗ "Tài khoản cho ... slot" ở trên.');
      }
    } else {
      console.log('  Các case lệch vòng nhau nên phải tách lệnh:');
      for (const r of ready) console.log(`      npm test -- ${r.caseId} --round=${r.round}`);
    }
  } else {
    console.log('  Sẵn sàng chạy : (không case nào)');
  }

  if (missingScript.length) {
    console.log('');
    console.log(`  Cần viết kịch bản trước: ${missingScript.join(', ')}`);
    console.log('      Khám phá DOM: npm run probe -- "/evaluation?tab=template" --tables');
    if (draftNames.length) {
      console.log(`      Mẫu Nháp đang có trên tunnel: ${draftNames.join(' | ')}`);
    }
  }

  if (blocked.length) {
    console.log('');
    console.log(`  ✗ CHẶN, đừng chạy: ${blocked.join(', ')}`);
    console.log('      Mã sai / không có trong Sheet, hoặc mẫu dữ liệu case cần đã bị xoá khỏi tunnel.');
    if (draftNames.length) {
      console.log(`      Mẫu Nháp đang có trên tunnel: ${draftNames.join(' | ')}`);
    }
  }

  console.log(LINE);

  // Dòng gọn cho việc xâu lệnh / đọc nhanh, không phải đọc lại cả màn hình
  console.log(
    `PLAN_RESULT ready=${ready.map((r) => `${r.caseId}:${r.round}`).join(',') || '-'}` +
      ` missing=${missingScript.join(',') || '-'}` +
      ` blocked=${blocked.join(',') || '-'}`
  );

  if (blocked.length) process.exitCode = 1;
  else if (missingScript.length) process.exitCode = 2;
}

main();
