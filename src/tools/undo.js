#!/usr/bin/env node
// ============================================================================
// undo.js: hoàn tác một lần ghi Sheet, theo nhật ký runs/.sheet-audit.ndjson.
//
//   npm run undo -- --list        10 lần ghi gần nhất
//   npm run undo -- <auditId>     hoàn tác
//
// Tất cả hoặc không ô nào: chỉ hoàn tác khi đúng mã case vẫn ở dòng đó, MỌI ô vẫn đúng
// bằng giá trị tool đã ghi (không đè lên việc của người khác), và không còn lần ghi mới
// hơn vào cùng ô chưa hoàn tác. Trả lại cả link và định dạng.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { createAuditLog, undoWrite, writeStatus } = require('../sheets/audit');
const { AUDIT_PATH } = require('../sheets');
const { showSpaces } = require('../sheets/a1');

const LINE = '='.repeat(74);

function parseArgs() {
  const o = { list: false, auditId: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--list') o.list = true;
    else if (a.startsWith('--account=')) continue;
    else if (a.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${a}". Cờ hợp lệ: --list  <auditId>`);
      process.exit(1);
    } else o.auditId = a;
  }
  return o;
}

function markReverted(runDir, info) {
  if (!runDir) return;
  const file = path.join(runDir, 'result.json');
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    r.sheet = { ...(r.sheet || {}), state: 'reverted', revertedAt: new Date().toISOString(), undoId: info.undoId, refused: info.refused };
    fs.writeFileSync(file, JSON.stringify(r, null, 2), 'utf8');
    console.log(`  result.json đã cập nhật: ${path.relative(config.ROOT_DIR, file)}`);
  } catch (err) {
    console.warn(`  (không cập nhật được result.json: ${err.message})`);
  }
}

async function main() {
  const o = parseArgs();
  const log = createAuditLog(AUDIT_PATH);

  console.log(LINE);
  console.log('  UNDO — hoàn tác một lần ghi Google Sheet');
  console.log(LINE);

  if (o.list || !o.auditId) {
    const all = log.list();
    const writes = all.filter((e) => e.kind === 'write').slice(-10).reverse();
    if (!writes.length) console.log('  (chưa có lần ghi nào trong nhật ký)');
    for (const w of writes) {
      const st = writeStatus(all, w.auditId);
      const note = st.abort
        ? '  (API từ chối — không ghi ô nào)'
        : st.undo
        ? '  (đã hoàn tác)'
        : st.verified === false
        ? '  ⚠ đọc lại lệch'
        : st.verified === null
        ? '  ⚠ chưa đọc lại được — kiểm tay'
        : '';
      console.log(
        `  ${w.auditId}  ${String(w.at).slice(0, 19).replace('T', ' ')}  ${w.caseId} vòng ${w.round}  ` +
          `${w.cells.map((c) => c.a1).join(',')}${note}`
      );
    }
    console.log('');
    console.log('  Hoàn tác: npm run undo -- <auditId>');
    return;
  }

  const entry = log.find(o.auditId);
  if (!entry) {
    console.error(`[ERROR] Không có ${o.auditId} trong ${path.relative(config.ROOT_DIR, AUDIT_PATH)}.`);
    process.exitCode = 1;
    return;
  }
  if (entry.kind !== 'write') {
    console.error(`[ERROR] ${o.auditId} là dòng "${entry.kind}", không phải một lần ghi — xem mã lần ghi bằng: npm run undo -- --list`);
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({
    spreadsheetId: entry.spreadsheetId || config.SHEET_ID,
    keyFile: config.GOOGLE_SA_KEY_FILE,
  });
  const meta = await client.getMeta();
  const tab = meta.tabs.find((t) => t.gid === entry.tab.gid);
  if (!tab) {
    console.error(`[ERROR] Tab gid ${entry.tab.gid} ("${showSpaces(entry.tab.title)}") không còn trong Sheet.`);
    process.exitCode = 1;
    return;
  }

  const info = await undoWrite({ client, auditLog: log, auditId: o.auditId, tabTitle: tab.title, reviewer: config.QC_NAME || null });
  console.log(`  ${entry.caseId} vòng ${entry.round} — tab "${showSpaces(tab.title)}"`);
  if (info.blocked) {
    console.log('  KHÔNG hoàn tác ô nào — có ô đã bị sửa sau lần ghi (không đè lên việc của người khác):');
    info.refused.forEach((x) => console.log(`    ${x.a1} — ${x.reason}`));
    console.log('  Sửa tay các ô đó nếu cần; nhật ký giữ nguyên nên thử lại được.');
    process.exitCode = 1;
    return;
  }
  console.log(`  Đã trả lại : ${info.restored.join(', ')}`);
  console.log(`  Đọc lại    : ${info.verified ? 'khớp' : 'LỆCH — kiểm tay'}`);
  markReverted(info.runDir, info);
  if (!info.verified) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
