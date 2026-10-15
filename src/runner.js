#!/usr/bin/env node
// ============================================================================
// runner.js: CLI chạy test — lớp mỏng gọi engine v2 (src/engine/, Playwright).
//
//   npm test -- EVAL_021 --nhap                 chạy nháp: không upload, không ghi Sheet
//   npm test -- EVAL_021 EVAL_022 --round=3      chạy thật: video + Catbox + Sheet
//   Cờ khác: --video --headless --profile=<tên> --account=N --no-sheet --row=N
//            --case-timeout=<giây> --report-json=runs/<tên>.json --sheet-on=pass|never
//            --auth-only (đăng nhập lại hồ sơ)
//   Tương thích cũ: --no-record --no-sheet / --no-upload --no-sheet = chạy nháp.
//
// Quy trình (spec engine v2, mục 6):
//   · chạy thật LUÔN quay + upload video (video là bằng chứng) — --no-record / --no-upload
//     mà không kèm --no-sheet bị từ chối;
//   · chạy thật có ghi Sheet phải chỉ rõ --round=N (không còn mặc định vòng 1);
//   · ĐẠT thì ghi ngay, KHÔNG ĐẠT chờ QC xem video rồi duyệt — "--sheet-on=always" bị từ chối.
// Bản Puppeteer cũ của file này: runs/.backup/src-truoc-ky2/runner.js (và git).
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { runBatch, relogin } = require('./engine');
const { profileForAccount, NAME_RE } = require('./engine/profiles');
const { findScriptFile } = require('./engine/script_meta');

const KNOWN_FLAGS = [
  '--nhap',
  '--dry',
  '--video',
  '--headless',
  '--profile=<tên>',
  '--auth-only',
  '--no-record',
  '--no-upload',
  '--no-sheet',
  '--round=N',
  '--row=N',
  '--case-timeout=<giây>',
  '--account=N',
  '--report-json=<đường dẫn>',
  '--sheet-on=pass|never',
];
// Mã case đi thẳng vào path.join() rồi require(), nên chuỗi tự do ở đây là thực thi mã
// tuỳ ý. Chỉ nhận đúng dạng mã (engine/case_id.js): EVAL_… hoặc case theo ticket 1295-QC01.
const { isCaseId } = require('./engine/case_id');

class ArgError extends Error {}

function die(msg) {
  throw new ArgError(msg);
}

/**
 * Cờ dạng --x=<số nguyên dương>. Sai thì DỪNG, không lặng lẽ lấy mặc định — `--round=`
 * rỗng xuất hiện thật khi script bọc ngoài khai triển biến chưa set, và rơi về vòng 1
 * là ghi đè lên vòng cũ nhất.
 */
function positiveInt(arg) {
  const raw = arg.split('=')[1];
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isInteger(n) || n < 1) {
    die(`"${arg}" không hợp lệ — phải là số nguyên dương.`);
  }
  return n;
}

/** @returns {object} tuỳ chọn đã kiểm; sai cờ thì ném ArgError (main in ra rồi thoát 1) */
function parseArgs(argv = process.argv.slice(2), account = config.ACCOUNT) {
  const o = {
    caseIds: [],
    round: null,
    row: null,
    record: true,
    upload: true,
    sheet: true,
    authOnly: false,
    dry: false,
    video: false,
    headless: false,
    profile: null,
    reportJson: null,
    sheetOn: 'pass',
    caseTimeoutSec: null,
    account,
  };
  for (const arg of argv) {
    if (arg === '--auth-only') o.authOnly = true;
    else if (arg === '--nhap' || arg === '--dry') o.dry = true;
    else if (arg === '--video') o.video = true;
    else if (arg === '--headless') o.headless = true;
    else if (arg === '--no-record') o.record = false;
    else if (arg === '--no-upload') o.upload = false;
    else if (arg === '--no-sheet') o.sheet = false;
    else if (arg.startsWith('--round=')) o.round = positiveInt(arg);
    else if (arg.startsWith('--row=')) o.row = positiveInt(arg);
    else if (arg.startsWith('--case-timeout=')) o.caseTimeoutSec = positiveInt(arg);
    // Giá trị thật do config.js đọc lúc nạp module; ở đây chỉ để KIỂM — không kiểm thì
    // `--account=hai` âm thầm chạy slot 1.
    else if (arg.startsWith('--account=')) positiveInt(arg);
    else if (arg.startsWith('--profile=')) {
      o.profile = arg.slice('--profile='.length).trim().toLowerCase();
      if (!NAME_RE.test(o.profile)) die(`"${arg}" không hợp lệ — tên hồ sơ chỉ gồm a-z, 0-9, _.`);
    } else if (arg.startsWith('--report-json=')) {
      const raw = arg.slice('--report-json='.length);
      if (!raw) die(`"${arg}" không hợp lệ — thiếu đường dẫn.`);
      const target = path.resolve(raw);
      const rel = path.relative(path.join(config.ROOT_DIR, 'runs'), target);
      // Bắt buộc trong runs/: bản kê ghi đè không hỏi — "trong repo" từng xoá sổ package.json.
      if (rel.startsWith('..') || path.isAbsolute(rel)) die(`"${arg}" không hợp lệ — phải nằm trong thư mục runs/ của repo.`);
      if (!target.toLowerCase().endsWith('.json')) die(`"${arg}" không hợp lệ — phải có đuôi .json.`);
      o.reportJson = target;
    } else if (arg.startsWith('--sheet-on=')) {
      o.sheetOn = arg.slice('--sheet-on='.length);
      if (o.sheetOn === 'always') {
        die('"--sheet-on=always" không còn dùng được — case KHÔNG ĐẠT phải được QC xem video rồi duyệt (npm run commit).');
      }
      if (!['pass', 'never'].includes(o.sheetOn)) die(`"${arg}" không hợp lệ — chỉ nhận pass hoặc never.`);
    } else if (arg.startsWith('--')) {
      die(`Cờ không hợp lệ: "${arg}"\n        Cờ hợp lệ: ${KNOWN_FLAGS.join('  ')}`);
    } else {
      const id = arg.toUpperCase();
      if (!isCaseId(id)) die(`"${arg}" không phải mã testcase hợp lệ (dạng đúng: EVAL_017, EVAL_V1_045, 1295-QC01).`);
      o.caseIds.push(id);
    }
  }
  // Trùng mã trong cùng lệnh → cùng tên thư mục run; chạy 2 lần thì gọi 2 lệnh.
  o.caseIds = [...new Set(o.caseIds)];
  if (!o.profile && account > 1) o.profile = profileForAccount(account);
  if (o.authOnly) return o;

  // Chế độ chạy
  const noSheet = !o.sheet || o.sheetOn === 'never';
  if (o.dry || (noSheet && (!o.upload || !o.record))) {
    o.mode = 'nhap';
    if (o.dry) o.record = o.video;
    o.upload = false;
    o.sheet = false;
  } else {
    o.mode = 'that';
    if (!o.record || !o.upload) {
      die('Chạy thật luôn quay và upload video (video là bằng chứng). Muốn chạy không video thì dùng --nhap.');
    }
    if (!noSheet && !o.round) {
      die('Chạy thật có ghi Sheet phải chỉ rõ vòng: --round=N (số N của "TEST LẦN N" trên Sheet). Chạy thử thì dùng --nhap.');
    }
  }
  if (o.round === null) o.round = 1; // chỉ để đặt tên thư mục khi không ghi Sheet
  return o;
}

const VERDICT_LABEL = { DAT: 'PASS (ĐẠT)', KHONG_DAT: 'FAIL (KHÔNG ĐẠT)', LOI_HA_TANG: 'LỖI HẠ TẦNG', DA_HUY: 'ĐÃ HUỶ' };

function printSummary(records, seconds, timings) {
  const rel = (p) => path.relative(config.ROOT_DIR, p);
  console.log('\n' + '='.repeat(70));
  console.log('                          BÁO CÁO KẾT QUẢ                          ');
  console.log('='.repeat(70));
  for (const r of records) {
    console.log(`\n▸ ${r.testcaseId}  —  ${VERDICT_LABEL[r.verdict] || r.verdict}  (${(r.seconds || 0).toFixed(1)}s) · hồ sơ ${r.profile}`);
    console.log(`   Chi tiết     : ${r.resultText}`);
    if (r.diagnosis) console.log(`   Chẩn đoán    : ${r.diagnosis.kind}`);
    console.log(`   Video        : ${r.videoUrl || (r.videoPath ? rel(r.videoPath) : 'không quay')}`);
    const sh = r.sheet || {};
    const sheetLine =
      sh.state === 'written'
        ? `đã ghi ${Object.values(sh.cells || {}).join(', ') || r.sheetCell}` + (r.sheetStatus ? ` | Trạng thái = "${r.sheetStatus}"` : '')
        : sh.state === 'pending'
        ? `CHỜ DUYỆT — ${sh.reason}`
        : sh.state === 'waiting-upload'
        ? `CHỜ UPLOAD — ${sh.reason}`
        : sh.state === 'failed'
        ? `KHÔNG GHI ĐƯỢC — ${sh.reason}`
        : `chưa ghi — ${sh.reason || 'không rõ lý do'}`;
    console.log(`   Google Sheet : ${sheetLine}`);
    if (r.failReport) console.log(`   Báo cáo lỗi  : ${rel(r.failReport)}`);
    if (r.trace) console.log(`   Trace        : ${rel(r.trace)}  (npx playwright-core show-trace "${r.trace}")`);
    if (r.runDir) console.log(`   Thư mục run  : ${rel(r.runDir)}`);
  }
  const passed = records.filter((r) => r.verdict === 'DAT').length;
  console.log('\n' + '-'.repeat(70));
  console.log(`  Tổng: ${records.length} case | PASS ${passed} | KHÔNG ĐẠT/LỖI ${records.length - passed}`);
  console.log(`  Tổng thời gian: ${seconds.toFixed(1)} giây`);
  console.log('-'.repeat(70));
  console.log('  Thời gian từng chặng:');
  timings.forEach((t) => console.log(`   - ${t.label.padEnd(38)} ${t.seconds.toFixed(1)}s`));
  console.log('='.repeat(70) + '\n');
}

async function main() {
  let o;
  try {
    o = parseArgs();
  } catch (err) {
    if (!(err instanceof ArgError)) throw err;
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('='.repeat(70));
  console.log('        FASTDO TEST AUTOMATION RUNNER — ENGINE V2 (PLAYWRIGHT)        ');
  console.log('='.repeat(70));

  if (o.authOnly) {
    const name = o.profile || 'default';
    try {
      const file = await relogin(name, { headless: o.headless });
      console.log(`[RUNNER] Đã đăng nhập lại hồ sơ "${name}" — phiên lưu ở ${path.relative(config.ROOT_DIR, file)}`);
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (!o.caseIds.length) {
    console.error('[ERROR] Vui lòng truyền mã testcase cần chạy! Ví dụ: npm test -- EVAL_021 --nhap');
    process.exitCode = 1;
    return;
  }
  // Mã chưa có kịch bản thì báo NGAY, đừng mở Chrome rồi mới phát hiện.
  const missing = o.caseIds.filter((id) => !findScriptFile(id));
  if (missing.length) {
    console.error(`[ERROR] Chưa có kịch bản cho: ${missing.join(', ')}`);
    console.error('        Các mã đang có trong src/testcases:');
    fs.readdirSync(path.join(__dirname, 'testcases'))
      .filter((f) => f.endsWith('.test.js'))
      .forEach((f) => console.error(`          - ${f.replace('.test.js', '').toUpperCase()}`));
    process.exitCode = 1;
    return;
  }
  // Thiếu biến bắt buộc thì dừng NGAY, đừng để lỗi nổ sau khi đã quay xong video.
  try {
    config.assertReady();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[RUNNER] ${o.mode === 'nhap' ? 'CHẠY NHÁP (không upload, không ghi Sheet)' : `CHẠY THẬT · vòng ${o.round}`} · ` +
      `${o.caseIds.length} case: ${o.caseIds.join(', ')}`
  );

  // Ctrl+C: huỷ case đang chạy (đóng context) — result.json vẫn được ghi.
  const ac = new AbortController();
  const onSigint = () => {
    if (ac.signal.aborted) process.exit(130);
    console.log('\n[RUNNER] Nhận Ctrl+C — huỷ case đang chạy (bấm lần nữa để thoát ngay)…');
    ac.abort();
  };
  process.on('SIGINT', onSigint);

  let out;
  try {
    out = await runBatch(o, { signal: ac.signal });
  } catch (err) {
    console.error(`\n[FATAL ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  printSummary(out.records, out.seconds, out.timings);

  // Bản kê của cả lệnh: giao diện đọc file này để biết lệnh vừa rồi chạy những case nào.
  if (o.reportJson) {
    try {
      fs.mkdirSync(path.dirname(o.reportJson), { recursive: true });
      fs.writeFileSync(
        o.reportJson,
        JSON.stringify(
          {
            startedAt: new Date(Date.now() - out.seconds * 1000).toISOString(),
            finishedAt: new Date().toISOString(),
            batchId: out.batchId,
            account: config.ACCOUNT,
            targetUrl: config.TARGET_URL,
            sheetId: config.SHEET_ID,
            sheetGid: config.SHEET_GID,
            sheetTab: config.SHEET_TAB,
            mode: o.mode,
            round: o.round,
            flags: { record: o.record, upload: o.upload, sheet: o.sheet, row: o.row },
            cases: out.records,
          },
          null,
          2
        ),
        'utf8'
      );
      console.log(`  Bản kê JSON  : ${path.relative(config.ROOT_DIR, o.reportJson)}`);
    } catch (err) {
      console.error('[ERROR] Ghi bản kê JSON thất bại:', err.message);
    }
  }

  const pending = out.records.filter((r) => r.sheet && r.sheet.state === 'pending');
  if (pending.length) {
    console.log(`  ⏸ ${pending.length} case chờ QC duyệt trước khi ghi Sheet:`);
    pending.forEach((r) => console.log(`      npm run commit -- ${path.relative(config.ROOT_DIR, r.runDir)}`));
  }
  const writeFailed = out.records.filter((r) => r.sheet && ['failed', 'waiting-upload'].includes(r.sheet.state));
  if (writeFailed.length) {
    console.log(`  ⚠ ${writeFailed.length} case chạy xong nhưng CHƯA ghi được Sheet — xem lý do ở trên.`);
  }
  // 0 = mọi case ĐẠT (và đã ghi nếu chạy thật có ghi Sheet); 1 = còn lại.
  if (out.records.some((r) => r.verdict !== 'DAT') || writeFailed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[FATAL ERROR] ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, ArgError };
