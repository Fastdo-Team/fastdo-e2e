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
const { initBrowser } = require('../core/browser');
const { ensureAuthenticated } = require('../core/session');
const { getOrOpenSheetPage, fetchGrid } = require('../core/sheet_service');

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

/** Chỉ số cột đầu tiên mang nhãn "TEST LẦN n" ở dòng 1 - mốc chia đặc tả / kết quả */
function findFirstRoundColumn(headerRow) {
  for (let c = 0; c < headerRow.length; c += 1) {
    if (/^TEST\s+LẦN\s+\d+$/i.test((headerRow[c] || '').trim())) return c;
  }
  return headerRow.length;
}

// Bố cục cố định của mỗi vòng test, tính từ cột mang nhãn "TEST LẦN n".
// Dùng làm nhãn dự phòng vì vài cột (Test Date) để trống ở dòng 2.
const ROUND_LAYOUT = [
  'Ưu tiên',
  'Môi trường',
  'Trạng thái',
  'Kết quả thực hiện',
  'DEV/QC NOTE',
  'Test Date',
];

/** Cột mang nhãn "TEST LẦN n" gần nhất về bên trái của cột c (-1 nếu chưa có) */
function roundStartOf(grid, c) {
  const header = grid[0] || [];
  let start = -1;
  for (let i = 0; i <= c && i < header.length; i += 1) {
    if (/^TEST\s+LẦN\s+\d+$/i.test((header[i] || '').trim())) start = i;
  }
  return start;
}

/** Nhóm vòng test mà cột c thuộc về, để biết "Trạng thái" này là của LẦN mấy */
function roundOf(grid, c) {
  const start = roundStartOf(grid, c);
  return start === -1 ? '' : ((grid[0] || [])[start] || '').trim().toUpperCase();
}

/**
 * Nhãn của cột c: ưu tiên dòng 2 (tên cột) → bố cục vòng test → dòng 1 → số cột.
 */
function columnLabel(grid, c) {
  const sub = ((grid[1] || [])[c] || '').replace(/\s+/g, ' ').trim();
  if (sub) return sub;

  const start = roundStartOf(grid, c);
  if (start !== -1 && ROUND_LAYOUT[c - start]) return ROUND_LAYOUT[c - start];

  const group = ((grid[0] || [])[c] || '').replace(/\s+/g, ' ').trim();
  return group || `cột ${c + 1}`;
}

function printSpec(grid, rowIdx, firstRoundCol) {
  console.log('');
  console.log('-'.repeat(74));
  console.log('  ĐẶC TẢ CASE (theo Sheet)');
  console.log('-'.repeat(74));

  const row = grid[rowIdx];
  let printed = 0;

  for (let c = 0; c < firstRoundCol; c += 1) {
    const value = (row[c] || '').trim();
    if (!value) continue;
    printed += 1;
    const label = columnLabel(grid, c);
    // Giá trị nhiều dòng thì thụt lề cho dễ đọc, không nhồi vào 1 dòng
    if (value.includes('\n')) {
      console.log(`\n${label}:`);
      value.split('\n').forEach((l) => console.log(`    ${l.trim()}`));
    } else {
      console.log(`${label}: ${value}`);
    }
  }

  if (printed === 0) console.log('(mọi cột đặc tả đều rỗng - kiểm tra lại tab Sheet)');
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

    const round = roundOf(grid, c);
    const label = columnLabel(grid, c);
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
  console.log('  CASE INFO — đọc mô tả testcase từ Google Sheet');
  console.log('='.repeat(74));

  if (!opts.testcaseId) {
    console.error('[ERROR] Thiếu mã testcase. Ví dụ: node src/tools/case-info.js EVAL_025');
    process.exitCode = 1;
    return;
  }

  let instance = null;

  try {
    instance = await initBrowser();
    const { browser, page } = instance;

    await ensureAuthenticated(page);

    const sheetPage = await getOrOpenSheetPage(browser);
    const grid = await fetchGrid(sheetPage);

    if (!grid) {
      throw new Error(
        'Không nạp được lưới Sheet qua CSV gviz. Kiểm tra SHEET_ID / SHEET_TAB trong .env ' +
          'và quyền truy cập của tài khoản đang đăng nhập.'
      );
    }

    const idCol = 0; // config.SHEET_ID_COLUMN = 'A'
    let rowIdx = -1;
    for (let r = 1; r < grid.length; r += 1) {
      if ((grid[r][idCol] || '').trim() === opts.testcaseId) {
        rowIdx = r;
        break;
      }
    }

    if (rowIdx === -1) {
      const available = grid
        .slice(1)
        .map((r) => (r[idCol] || '').trim())
        .filter((v) => /^EVAL_/i.test(v));
      // Sheet có ~120 mã; in hết ra 1 dòng là rác. Chỉ gợi ý mã gần giống.
      const prefix = opts.testcaseId.replace(/\d+$/, '');
      const near = available.filter((v) => v.startsWith(prefix)).slice(0, 12);
      console.error(`\n[ERROR] Không thấy "${opts.testcaseId}" ở cột A của tab "${config.SHEET_TAB}".`);
      console.error(`        Sheet đang có ${available.length} mã, từ ${available[0]} tới ${available[available.length - 1]}.`);
      if (near.length) {
        console.error(`        Cùng tiền tố "${prefix}": ${near.join(', ')}${available.length > near.length ? ' …' : ''}`);
      }
      process.exitCode = 1;
      return;
    }

    const firstRoundCol = findFirstRoundColumn(grid[0] || []);
    console.log(`[CASE] ${opts.testcaseId} — dòng ${rowIdx + 1} của tab "${config.SHEET_TAB}"`);

    printSpec(grid, rowIdx, firstRoundCol);
    printRounds(grid, rowIdx, firstRoundCol, opts);

    console.log('');
    console.log('-'.repeat(74));
    console.log(`  Chạy test: npm test -- ${opts.testcaseId} --round=<N>`);
    console.log('-'.repeat(74));
  } catch (error) {
    console.error(`\n[CASE INFO] Thất bại: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (instance) await instance.close();
  }
}

main();
