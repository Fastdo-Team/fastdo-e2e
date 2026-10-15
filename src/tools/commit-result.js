#!/usr/bin/env node
// ============================================================================
// commit-result.js: ghi một lần chạy ĐANG CHỜ DUYỆT (hoặc lần ghi trước bị hỏng) vào
// Google Sheet — qua Sheets API, không mở Chrome.
//
//   npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680
//   node src/tools/commit-result.js runs/<thư mục> --dry
//
// Chính sách "PASS tự ghi, FAIL chờ duyệt": case không đạt có thể là bug app, mà cũng có
// thể chỉ là kịch bản sai selector — người phân biệt được là QC sau khi xem video. Tool
// này là bước "sau khi xem": commit một FAIL nghĩa là QC xác nhận đó là lỗi app.
//
// KHÔNG chạy lại test, KHÔNG bịa dữ liệu: mọi thứ lấy nguyên từ result.json, rồi đi qua
// đúng bộ ghi src/sheets/sheet_writer.js — tức đúng mọi chốt [AN TOÀN]. Dấu #runId trong
// ô Kết quả chống ghi trùng, nên thử ghi lại lần hỏng trước là an toàn.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');

if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'dotenv'))) {
  console.error('\n✗ Chưa cài thư viện cho repo này. Chạy 1 lần: npm install\n');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
  console.error('\n✗ Chưa có file .env ở gốc repo. Tạo từ mẫu: cp .env.example .env\n');
  process.exit(1);
}

const config = require('../config');
const G = require('../core/sheet_grid');
const { openSheet } = require('../sheets');
const { parseEnvLabels, resolveEnvLabel } = require('../sheets/env_label');
const { showSpaces } = require('../sheets/a1');
const { buildResultEntry } = require('../engine/result_text');

const LINE = '='.repeat(74);
const COMMITTABLE = ['pending', 'failed'];

function parseArgs() {
  const opts = { runDir: null, dry: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry') opts.dry = true;
    else if (arg.startsWith('--account=')) continue; // config.js đã đọc lúc nạp
    else if (arg.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${arg}". Cờ hợp lệ: --dry  --account=N`);
      process.exit(1);
    } else if (!opts.runDir) opts.runDir = arg;
  }
  return opts;
}

/** Chỉ nhận thư mục nằm trong runs/ — tham số này còn đến từ giao diện */
function resolveRunDir(raw) {
  const target = path.resolve(raw);
  const rel = path.relative(path.join(ROOT_DIR, 'runs'), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`[ERROR] "${raw}" không nằm trong thư mục runs/ của repo.`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(target, 'result.json'))) {
    console.error(`[ERROR] Không thấy result.json trong ${rel}.`);
    process.exit(1);
  }
  return target;
}

function readResult(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
  } catch (err) {
    console.error(`[ERROR] result.json hỏng, không đọc được: ${err.message}`);
    process.exit(1);
  }
}

/** Dữ liệu ghi Sheet dựng từ result.json. Lần chạy cũ chưa có runId → suy cố định từ tên thư mục. */
function entryFromResult(r, runDir) {
  const runId = r.runId || crypto.createHash('sha1').update(path.basename(runDir)).digest('hex');
  return {
    caseId: r.testcaseId,
    round: Number(r.round),
    pass: r.pass === true,
    runId,
    startedAt: r.startedAt,
    envLabel: r.envLabel || resolveEnvLabel(r.targetUrl, parseEnvLabels(config.ENV_LABELS)),
    profile: r.profile || (Number(r.account) > 1 ? `slot${r.account}` : 'default'),
    steps: (r.steps || []).map((s) => ({ label: s.label, ok: s.ok, error: s.error })),
    checks: r.checks || [],
    resultText: r.resultText,
    videoUrl: r.videoUrl,
    runDir,
    reviewer: config.QC_NAME || null,
    // Commit một lần KHÔNG ĐẠT = QC đã xem video và xác nhận là lỗi app.
    reviewCause: r.pass === true ? undefined : 'app',
  };
}

async function main() {
  const opts = parseArgs();

  console.log(LINE);
  console.log('  COMMIT — ghi một lần chạy đang chờ duyệt vào Google Sheet (qua API)');
  console.log(LINE);

  if (!opts.runDir) {
    console.error('[ERROR] Thiếu thư mục run. Ví dụ:');
    console.error('        npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680');
    process.exitCode = 1;
    return;
  }

  const runDir = resolveRunDir(opts.runDir);
  const rel = path.relative(ROOT_DIR, runDir).replace(/\\/g, '/');
  const r = readResult(runDir);
  const sheetState = r.sheet || {};

  console.log(`  Lần chạy   : ${rel}`);
  console.log(`  Case       : ${r.testcaseId} · vòng ${r.round} · hồ sơ ${r.profile || `slot ${r.account}`}`);
  console.log(`  Kết quả    : ${r.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'}`);
  console.log(`  Video      : ${r.videoUrl || '(không có)'}`);
  console.log(`  Trạng thái Sheet hiện tại: ${sheetState.state}${sheetState.reason ? ' — ' + sheetState.reason : ''}`);
  console.log('');

  // Chỉ ghi thứ đang CHỜ hoặc lần ghi trước HỎNG. Không ghi lại thứ đã ghi, không ghi
  // thứ bị bỏ qua vì lỗi hạ tầng (đó không phải kết quả kiểm thử).
  if (!COMMITTABLE.includes(sheetState.state)) {
    console.error(
      `[ERROR] Lần chạy này ở trạng thái "${sheetState.state}", không phải ${COMMITTABLE.join(' / ')} — không ghi.\n` +
        '        "written" = đã ghi rồi · "skipped" = cố ý không ghi (lỗi hạ tầng, tắt bằng cờ…)'
    );
    process.exitCode = 1;
    return;
  }

  const thieu = ['testcaseId', 'round', 'videoUrl', 'startedAt'].filter((k) => !r[k]);
  if (thieu.length) {
    console.error(`[ERROR] result.json thiếu trường bắt buộc: ${thieu.join(', ')} — không đủ dữ liệu để ghi.`);
    process.exitCode = 1;
    return;
  }

  const entry = entryFromResult(r, runDir);

  let sheet;
  try {
    sheet = await openSheet();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));

  // Duyệt phải ghi vào ĐÚNG tab lúc chạy — .env có thể đã đổi sang tab/Sheet khác từ đó.
  const target = sheetState.target;
  if (!target || !target.spreadsheetId || target.gid === undefined || target.gid === null) {
    console.error(
      '[ERROR] result.json không lưu tab đích lúc chạy (bản chạy cũ) — không biết lần chạy này thuộc tab nào, không ghi.\n' +
        '        Chạy lại case để có lần chạy mới.'
    );
    process.exitCode = 1;
    return;
  }
  if (target.spreadsheetId !== sheet.client.spreadsheetId || Number(target.gid) !== Number(sheet.tab.gid)) {
    console.error(
      `[ERROR] [AN TOÀN] Lần chạy này chạy cho tab "${showSpaces(target.title || '?')}" (gid ${target.gid}) của Sheet ` +
        `${target.spreadsheetId}, nhưng .env đang trỏ tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid}) của Sheet ` +
        `${sheet.client.spreadsheetId}. Không ghi — đổi SHEET_ID / SHEET_GID về đúng tab lúc chạy rồi duyệt lại.`
    );
    process.exitCode = 1;
    return;
  }

  if (opts.dry) {
    const grid = await sheet.readGrid();
    const rows = G.findRowIndices(grid, entry.caseId);
    const found = G.findRoundColumnsByLabel(grid, entry.round);
    console.log(`  --dry: chỉ xem trước, KHÔNG ghi gì. Tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid})`);
    console.log(`  Dòng       : ${rows.length ? rows.map((x) => x + 1).join(', ') : '(không thấy mã)'}`);
    console.log(
      `  Cột vòng ${entry.round} : ${
        found.ok
          ? Object.entries(found.cols).filter(([, c]) => c !== null).map(([k, c]) => `${k} ${G.colLetter(c)}`).join(', ')
          : found.problems.join('; ')
      }`
    );
    console.log(`  Trạng thái : ${entry.pass ? 'DONE' : 'Fail'} · Môi trường: ${entry.envLabel || '(không có nhãn — bỏ qua cột)'}`);
    console.log('  Nối vào Kết quả thực hiện:');
    buildResultEntry(entry).split('\n').forEach((l) => console.log(`      ${l}`));
    return;
  }

  try {
    config.assertReady();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const info = await sheet.writer().writeResult(entry);
    (info.warnings || []).forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));

    // "Đã có từ trước" (dấu #runId trong ô) mà các ô khác lệch lần ghi đó → chưa xong, để QC kiểm tay.
    const stillBad = info.already && info.mismatched && info.mismatched.length > 0;
    const auditId = info.auditId || sheetState.auditId || null;
    r.runId = entry.runId;
    r.envLabel = entry.envLabel;
    r.sheet = {
      state: stillBad ? 'failed' : 'written',
      reason: stillBad ? `ô Kết quả đã có lần ghi này nhưng lệch: ${info.mismatched.join('; ')} — kiểm tay` : undefined,
      target,
      cell: info.cells.result,
      cells: info.cells,
      status: info.status,
      auditId,
      already: info.already,
      superseded: info.superseded || false,
      warnings: info.warnings,
      tab: { gid: sheet.tab.gid, title: sheet.tab.title },
      committedAt: new Date().toISOString(),
      committedBy: `commit-result (${config.QC_NAME || 'không rõ'})`,
    };
    r.sheetCell = info.cells.result;
    r.sheetStatus = info.status;
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');

    console.log('');
    console.log(LINE);
    console.log(
      `  ${stillBad ? 'ĐÃ CÓ TỪ TRƯỚC NHƯNG LỆCH' : info.already ? 'ĐÃ CÓ TỪ TRƯỚC' : 'ĐÃ GHI'} — ` +
        `${Object.entries(info.cells).map(([k, a1]) => `${k} ${a1}`).join(', ')}` +
        (info.status ? ` | Trạng thái = "${info.status}"` : '')
    );
    if (auditId) console.log(`  Hoàn tác nếu cần: npm run undo -- ${auditId}`);
    console.log(`  result.json đã cập nhật: ${rel}/result.json`);
    console.log(LINE);
    if (stillBad) process.exitCode = 1;
  } catch (err) {
    console.error(`\n[ERROR] Ghi Sheet thất bại: ${err.message}`);
    if (err.auditId) {
      // Đã gửi lên Sheet (hoặc không chắc) mà đọc lại lệch / hỏng — không còn là "chờ duyệt"
      // nữa, đánh dấu để QC xem; auditId giữ lại để hoàn tác.
      r.sheet = { ...sheetState, state: 'failed', reason: err.message, auditId: err.auditId };
      fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');
    }
    process.exitCode = 1;
  }
}

main();
