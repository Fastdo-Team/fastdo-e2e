#!/usr/bin/env node
// ============================================================================
// case-info.js: Đọc mô tả testcase từ Google Sheet ra terminal.
//
//   node src/tools/case-info.js EVAL_025
//   node src/tools/case-info.js EVAL_025 --full        (in cả kết quả các vòng cũ)
//   node src/tools/case-info.js EVAL_025 --round=2     (kèm kết quả vòng 2)
//
// Có tool này thì không phải mở Sheet trên trình duyệt rồi đọc bằng mắt/ảnh chụp
// nữa: toàn bộ lưới được kéo về bằng 1 request CSV gviz trong tab Sheet đang
// đăng nhập, rồi tra dòng trong RAM.
//
// Cột bên trái mốc "TEST LẦN 1" là ĐẶC TẢ case (mã, tiêu đề, các bước, kết quả
// mong muốn...) - in đầy đủ. Cột từ mốc đó về sau là KẾT QUẢ tích luỹ qua các
// vòng, thường rất dài nên chỉ in tóm tắt, trừ khi có --full.
// ============================================================================

const config = require('../config');
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
const G = require('../core/sheet_grid');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { testcaseId: null, full: false, round: null };

  for (const arg of args) {
    if (arg === '--full') opts.full = true;
    else if (arg.startsWith('--round=')) opts.round = parseInt(arg.split('=')[1], 10) || null;
    else if (!arg.startsWith('--') && !opts.testcaseId) opts.testcaseId = arg.toUpperCase();
  }

  return opts;
}

function printSpec(grid, rowIdx) {
  console.log('');
  console.log('-'.repeat(74));
  console.log('  ĐẶC TẢ CASE (theo Sheet)');
  console.log('-'.repeat(74));

  G.printSpec(G.readSpec(grid, rowIdx));
}

function printRounds(grid, rowIdx, firstRoundCol, opts) {
  const row = grid[rowIdx];
  console.log('');
  console.log('-'.repeat(74));
  console.log(`  KẾT QUẢ CÁC VÒNG${opts.full ? ' (đầy đủ)' : ' (tóm tắt - thêm --full để xem hết)'}`);
  console.log('-'.repeat(74));

  let printed = 0;

  for (let c = firstRoundCol; c < row.length; c += 1) {
    const value = (row[c] || '').trim();
    if (!value) continue;

    const round = G.roundOf(grid, c);
    const label = G.columnLabel(grid, c);
    const wantThisRound = opts.round ? round === `TEST LẦN ${opts.round}`.toUpperCase() : false;
    const showFull = opts.full || wantThisRound;

    printed += 1;

    if (showFull) {
      console.log(`\n[${round}] ${label}:`);
      value.split('\n').forEach((l) => console.log(`    ${l.trim()}`));
    } else {
      const oneLine = value.replace(/\s+/g, ' ');
      const shown = oneLine.length > 110 ? oneLine.slice(0, 109) + '…' : oneLine;
      console.log(`[${round}] ${label}: ${shown}`);
    }
  }

  if (printed === 0) console.log('(chưa có vòng test nào được ghi kết quả)');
}

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(74));
  console.log('  CASE INFO — đọc mô tả testcase từ Google Sheet (qua API, không mở Chrome)');
  console.log('='.repeat(74));

  if (!opts.testcaseId) {
    console.error('[ERROR] Thiếu mã testcase. Ví dụ: node src/tools/case-info.js EVAL_025');
    process.exitCode = 1;
    return;
  }

  try {
    const sheet = await openSheet();
    sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
    const grid = await sheet.readGrid();
    const tabName = showSpaces(sheet.tab.title);
    const rowIdx = G.findRowIndex(grid, opts.testcaseId);

    if (rowIdx === -1) {
      const available = G.listCaseIds(grid);
      // Sheet có hàng trăm mã; in hết ra 1 dòng là rác. Chỉ gợi ý mã gần giống.
      const prefix = opts.testcaseId.replace(/\d+$/, '');
      const near = available.filter((v) => v.toUpperCase().startsWith(prefix)).slice(0, 12);
      console.error(`\n[ERROR] Không thấy "${opts.testcaseId}" ở cột A của tab "${tabName}".`);
      console.error(`        Tab đang có ${available.length} mã, từ ${available[0]} tới ${available[available.length - 1]}.`);
      if (near.length) {
        console.error(`        Cùng tiền tố "${prefix}": ${near.join(', ')}${available.length > near.length ? ' …' : ''}`);
      }
      process.exitCode = 1;
      return;
    }

    const firstRoundCol = G.findFirstRoundColumn(grid[0] || []);
    console.log(`[CASE] ${opts.testcaseId} — dòng ${rowIdx + 1} của tab "${tabName}" (gid ${sheet.tab.gid})`);

    printSpec(grid, rowIdx);
    printRounds(grid, rowIdx, firstRoundCol, opts);

    console.log('');
    console.log('-'.repeat(74));
    console.log(`  Chạy test: npm test -- ${opts.testcaseId} --round=<N>`);
    console.log('-'.repeat(74));
  } catch (error) {
    console.error(`\n[CASE INFO] Thất bại: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
