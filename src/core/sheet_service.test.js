// ============================================================================
// sheet_service.test.js: chứng minh các chốt AN TOÀN thật sự chặn được.
//
// Chạy `updateSheetResult` thật với một `page` giả lập chỉ trả về lưới CSV —
// không Chrome, không mạng, không Google Sheet. Cả ba nhánh từ chối dưới đây đều
// xảy ra TRƯỚC khi hàm chạm tới ô nào, nên page giả chỉ cần đúng một method.
//
// Vì sao phải có test này: bản cũ, khi không xác định được cột của vòng test, đã
// âm thầm `return 'I'` — tức nối kết quả vòng 9 vào ô vòng 1 và ghi đè Trạng thái
// vòng 1. Không log lỗi, không dừng. Đó là kiểu hỏng dữ liệu không ai nhìn ra.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const { updateSheetResult, resolveRoundColumnsFromGrid } = require('./sheet_service');

const SPEC = ['Mã', 'Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];
const ROUND_COLS = ['Ưu tiên', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV/QC NOTE', 'Test Date'];

/**
 * Dựng CSV giống hệt thứ endpoint gviz trả về.
 * @param {string[]} roundLabels nhãn dòng 1 của từng vòng
 * @param {string[]} subCols     nhãn dòng 2 lặp cho mỗi vòng
 */
function buildCsv(roundLabels = ['TEST LẦN 1', 'TEST LẦN 2', 'TEST LẦN 3'], subCols = ROUND_COLS) {
  const header = [...SPEC];
  const sub = ['', '', '', '', ''];
  for (const label of roundLabels) {
    header.push(label, '', '', '', '', '');
    sub.push(...subCols);
  }
  const body = (id, title) => [id, 'Đánh giá', title, 'mô tả', 'Web', ...roundLabels.flatMap(() => ['', '', '', '', '', ''])];
  return [header, sub, body('EVAL_021', 'Tiêu đề 21'), body('EVAL_022', 'Tiêu đề 22')]
    .map((row) => row.map((v) => `"${v}"`).join(','))
    .join('\n');
}

/** page giả: chỉ cần trả lưới CSV cho fetchGrid */
function fakePage(csv) {
  return {
    evaluate: async () => csv,
    $: async () => {
      throw new Error('KHÔNG ĐƯỢC chạm tới ô nào — lẽ ra phải dừng trước bước này');
    },
  };
}

/**
 * page giả đầy đủ hơn: mô phỏng được Name Box + formula bar, để kiểm CHỐT SỐNG
 * (đọc thật ô cột A trên trang sắp ghi).
 */
function fakeSheetPage(csv, liveCells = {}, visited = []) {
  let pending = '';
  let current = null;
  const nameBox = { click: async () => { pending = ''; } };
  const formulaBar = {};
  return {
    keyboard: {
      type: async (t) => { pending += t; },
      press: async (k) => { if (k === 'Enter') { current = pending; visited.push(current); pending = ''; } },
    },
    $: async (sel) => (sel === '#t-name-box' ? nameBox : sel === '#t-formula-bar-input' ? formulaBar : null),
    // fetchGrid gọi evaluate(fn, sheetId, tab) -> 2 tham số phụ;
    // readCellText gọi evaluate(fn, el) -> 1 tham số phụ.
    evaluate: async (fn, ...args) => (args.length === 2 ? csv : liveCells[current] || ''),
  };
}

const baseArgs = {
  testcaseId: 'EVAL_021',
  videoUrl: 'https://files.catbox.moe/abc.mp4',
  resultText: 'kết quả thử',
  pass: true,
};

// --- Chốt cột vòng ----------------------------------------------------------
test('DỪNG khi Sheet không có cột của vòng được yêu cầu (bug ghi đè vòng 1)', async () => {
  const page = fakePage(buildCsv());
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, roundNumber: 9, page }),
    (err) => {
      assert.match(err.message, /AN TOÀN/);
      assert.match(err.message, /TEST LẦN 9/);
      assert.match(err.message, /Sheet đang có vòng: 1, 2, 3/);
      return true;
    }
  );
});

test('vòng hợp lệ thì KHÔNG bị chặn ở bước xác định cột', async () => {
  const page = fakePage(buildCsv());
  // Qua được phần xác định cột thì mới đụng tới ô -> page giả ném lỗi "KHÔNG ĐƯỢC chạm".
  // Đó chính là bằng chứng nó đã đi qua mọi chốt an toàn.
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, roundNumber: 2, page }),
    /KHÔNG ĐƯỢC chạm tới ô nào/
  );
});

// --- Chốt nhãn dòng 2 -------------------------------------------------------
test('DỪNG khi bố cục vòng bị xê dịch so với +2/+3', async () => {
  // Chèn thêm 1 cột, Trạng thái/Kết quả không còn nằm đúng offset giả định
  const lech = ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', ''];
  const page = fakePage(buildCsv(['TEST LẦN 1'], lech));
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, roundNumber: 1, page }),
    (err) => {
      assert.match(err.message, /AN TOÀN/);
      assert.match(err.message, /Ghi chú thêm/);
      return true;
    }
  );
});

// --- Chốt dòng --------------------------------------------------------------
test('DỪNG khi --row trỏ vào dòng của case khác', async () => {
  const page = fakePage(buildCsv());
  // EVAL_021 ở dòng 3, EVAL_022 ở dòng 4. Ép ghi EVAL_021 vào dòng 4.
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, roundNumber: 1, row: 4, page }),
    (err) => {
      assert.match(err.message, /Sai dòng/);
      assert.match(err.message, /EVAL_022/);
      return true;
    }
  );
});

test('DỪNG khi mã case không có trong Sheet', async () => {
  const page = fakePage(buildCsv());
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, testcaseId: 'EVAL_999', roundNumber: 1, page }),
    /Không tìm thấy mã testcase EVAL_999/
  );
});

// --- Ánh xạ cột: chỉ số 0-based sang chữ cái cột ----------------------------
test('vòng nào ra đúng cặp cột Trạng thái / Kết quả của vòng đó', () => {
  const grid = buildCsv()
    .split('\n')
    .map((line) => line.split(',').map((v) => v.replace(/^"|"$/g, '')));

  // Vòng 1 bắt đầu ở cột thứ 6 (F) -> Trạng thái H, Kết quả I
  assert.deepStrictEqual(resolveRoundColumnsFromGrid(grid, 1), { statusCol: 'H', resultCol: 'I' });
  // Vòng 2 bắt đầu ở L -> N / O
  assert.deepStrictEqual(resolveRoundColumnsFromGrid(grid, 2), { statusCol: 'N', resultCol: 'O' });
  // Vòng 3 bắt đầu ở R -> T / U
  assert.deepStrictEqual(resolveRoundColumnsFromGrid(grid, 3), { statusCol: 'T', resultCol: 'U' });
  // Vòng không có cột -> null, tín hiệu DỪNG
  assert.strictEqual(resolveRoundColumnsFromGrid(grid, 4), null);
});

// --- Chốt sống: đọc thật ô cột A trên trang sắp ghi ------------------------
test('DỪNG khi ô cột A trên trang thật khác lưới (sub-tab sai, hoặc lưới đã cũ)', async () => {
  // EVAL_021 nằm ở dòng 3 theo lưới, nhưng trang đang mở cho ra mã khác — đúng
  // tình huống Name Box ghi vào sub-tab khác với tab mà gviz đã đọc.
  const page = fakeSheetPage(buildCsv(), { A3: 'EVAL_099' });
  await assert.rejects(
    () => updateSheetResult(null, { ...baseArgs, roundNumber: 1, page }),
    (err) => {
      assert.match(err.message, /AN TOÀN/);
      assert.match(err.message, /trên trang đang mở/);
      assert.match(err.message, /EVAL_099/);
      return true;
    }
  );
});

test('chốt sống thật sự có đọc ô cột A trước khi ghi (không chặn oan khi khớp)', async () => {
  const visited = [];
  const page = fakeSheetPage(buildCsv(), { A3: 'EVAL_021' }, visited);
  await updateSheetResult(null, { ...baseArgs, roundNumber: 1, page }).catch(() => {});
  assert.ok(visited.includes('A3'), `phải đọc ô A3 trước khi ghi, các ô đã tới: ${visited.join(', ')}`);
});
