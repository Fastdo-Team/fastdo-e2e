#!/usr/bin/env node
// ============================================================================
// sheet-tabs.js: liệt kê các tab của Google Sheet — tên THẬT (dấu cách cuối hiện ␠),
// gid, số mã case — và tab nào đang được chọn theo .env.
//
//   npm run sheet:tabs
//
// Chọn tab bằng SHEET_GID=<gid> trong .env (hoặc dán link Sheet ở tab Cấu hình của
// giao diện — link có sẵn "gid=…").
// ============================================================================

const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { resolveTab } = require('../sheets/tab');
const { showSpaces } = require('../sheets/a1');
const G = require('../core/sheet_grid');

const LINE = '='.repeat(74);

async function main() {
  console.log(LINE);
  console.log('  SHEET TABS — các tab trong Google Sheet');
  console.log(LINE);

  if (!config.SHEET_ID) {
    console.error('[ERROR] Chưa khai SHEET_ID trong .env.');
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({ spreadsheetId: config.SHEET_ID, keyFile: config.GOOGLE_SA_KEY_FILE });
  const meta = await client.getMeta();
  let active = null;
  let activeErr = null;
  try {
    active = resolveTab(meta, { gid: config.SHEET_GID, title: config.SHEET_TAB });
  } catch (err) {
    activeErr = err.message;
  }

  console.log(`  Sheet: ${meta.title}`);
  console.log('');
  for (const t of meta.tabs) {
    const grid = await client.readGrid(t.title);
    const ids = G.listCaseIds(grid);
    const mark = active && active.gid === t.gid ? '▶' : ' ';
    console.log(
      `  ${mark} "${showSpaces(t.title)}"  gid=${t.gid}${t.hidden ? ' (ẩn)' : ''}  ` +
        `${ids.length} mã${ids.length ? ` (${ids[0]} … ${ids[ids.length - 1]})` : ''}`
    );
  }
  console.log('');
  if (active) {
    console.log(`  Đang dùng: "${showSpaces(active.title)}" (gid ${active.gid})`);
    active.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  } else {
    console.log(`  ✗ ${activeErr}`);
  }
  const canEdit = await client.canEdit();
  console.log(
    `  Quyền sửa của ${client.saEmail || 'service account'}: ` +
      (canEdit === true ? 'CÓ' : canEdit === false ? 'KHÔNG — Share Sheet quyền Editor' : 'không kiểm được')
  );
  console.log('  Đổi tab: khai SHEET_GID=<gid> trong .env.');
  console.log(LINE);
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
