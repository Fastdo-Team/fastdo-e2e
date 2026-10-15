#!/usr/bin/env node
// ============================================================================
// sheet-dump.js: kéo TOÀN BỘ danh sách testcase từ Google Sheet về một file cache.
//
//   npm run sheet:dump
//   node src/tools/sheet-dump.js --out=runs/.sheet-cache.json
//
// Vì sao cần: giao diện chỉ biết 8 case có kịch bản trong src/testcases/, trong khi
// Sheet có ~120 mã. QC muốn nhìn thấy hết, tìm kiếm và lọc, rồi mới quyết chạy cái
// nào. Nhưng đọc Sheet cần Chrome đã đăng nhập (~15s), không thể làm mỗi lần tải
// trang — nên đọc một lần, ghi ra cache, giao diện đọc cache và có nút làm mới.
//
// Cache nằm trong runs/ nên vừa được .gitignore, vừa nằm trong thư mục server đang
// theo dõi: ghi xong là mọi trang đang mở tự cập nhật.
// ============================================================================

const fs = require('fs');
const path = require('path');

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
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
const G = require('../core/sheet_grid');

const DEFAULT_OUT = path.join('runs', '.sheet-cache.json');

function parseArgs() {
  const o = { out: DEFAULT_OUT };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--out=')) o.out = arg.slice('--out='.length);
    else if (arg.startsWith('--account=')) continue; // config.js đã đọc lúc nạp
    else if (arg.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${arg}". Cờ hợp lệ: --out=<đường dẫn>  --account=N`);
      process.exit(1);
    }
  }
  return o;
}

/** Giống các tool khác: chỉ cho ghi trong runs/, đường dẫn tự do là đi đâu cũng được */
function resolveOut(raw) {
  const target = path.resolve(ROOT_DIR, raw);
  const rel = path.relative(path.join(ROOT_DIR, 'runs'), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`[ERROR] "${raw}" phải nằm trong thư mục runs/ của repo.`);
    process.exit(1);
  }
  if (!target.toLowerCase().endsWith('.json')) {
    console.error(`[ERROR] "${raw}" phải có đuôi .json.`);
    process.exit(1);
  }
  return target;
}

/** Mã case nào đã có kịch bản trong src/testcases/ */
function scriptedIds() {
  const dir = path.join(ROOT_DIR, 'src', 'testcases');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.test.js'))
      .map((f) => f.replace('.test.js', '').toUpperCase())
  );
}

async function main() {
  const opts = parseArgs();
  const out = resolveOut(opts.out);

  console.log('='.repeat(74));
  console.log('  SHEET DUMP — kéo toàn bộ danh sách testcase về cache (qua API, không mở Chrome)');
  console.log('='.repeat(74));

  try {
    config.assertReady();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const sheet = await openSheet();
    sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
    const grid = await sheet.readGrid();
    if (!grid.length) {
      throw new Error(`Tab "${showSpaces(sheet.tab.title)}" trống — kiểm SHEET_GID / SHEET_TAB trong .env.`);
    }

    const firstRoundCol = G.findFirstRoundColumn(grid[0] || []);
    // Nhãn các cột đặc tả, lấy từ chính Sheet chứ không viết cứng — Sheet đổi cột
    // thì giao diện đổi theo, không phải sửa code.
    // Bỏ cột 0: đó là cột mã, đã nằm sẵn ở trường `id` của từng case. Giữ lại sẽ
    // thành hai cột trùng nhau trên bảng (Sheet đặt tên cột này là "ID").
    const specColumns = [];
    for (let c = 1; c < firstRoundCol; c += 1) {
      specColumns.push({ index: c, label: G.columnLabel(grid, c) });
    }

    const scripted = scriptedIds();
    const roundNumbers = G.listRoundNumbers(grid);
    const cases = [];

    for (let r = 1; r < grid.length; r += 1) {
      const id = ((grid[r] || [])[0] || '').trim().toUpperCase();
      if (!/^EVAL_[A-Z0-9_]+$/.test(id)) continue;

      const spec = {};
      for (const { index, label } of specColumns) {
        const v = ((grid[r] || [])[index] || '').trim();
        if (v) spec[label] = v;
      }

      const info = G.suggestNextRound(grid, r);
      cases.push({
        id,
        row: r + 1,
        spec,
        hasScript: scripted.has(id),
        rounds: G.roundsOfCase(grid, r)
          .filter((x) => x.hasData)
          .map((x) => ({ n: x.number, status: x.status || '(trống)' })),
        nextRound: info.next,
        nextRoundHasColumn: info.columnExists,
      });
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      sheetId: config.SHEET_ID,
      sheetGid: sheet.tab.gid,
      sheetTab: sheet.tab.title,
      specColumns: specColumns.map((c) => c.label),
      roundNumbers,
      cases,
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

    const coKichBan = cases.filter((c) => c.hasScript).length;
    console.log('');
    console.log(`  Tab          : ${showSpaces(sheet.tab.title)} (gid ${sheet.tab.gid})`);
    console.log(`  Cột đặc tả   : ${payload.specColumns.join(' · ')}`);
    console.log(`  Vòng test    : ${roundNumbers.join(', ') || '(không có)'}`);
    console.log(`  Tổng số case : ${cases.length} (${coKichBan} đã có kịch bản, ${cases.length - coKichBan} chưa)`);
    console.log(`  Đã ghi cache : ${path.relative(ROOT_DIR, out).replace(/\\/g, '/')}`);
    console.log('='.repeat(74));
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    process.exitCode = 1;
  }
}

main();
