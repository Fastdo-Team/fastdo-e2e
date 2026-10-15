// ============================================================================
// sheet_grid.test.js: chạy bằng `npm run test:unit` (node --test).
//
// Không cần trình duyệt, không cần .env, không chạm Google Sheet — chạy trong
// chớp mắt. Đây là lưới an toàn cho phần dễ hỏng dữ liệu nhất của cả bộ: sai một
// offset cột là ghi đè kết quả vòng khác của QC, và không ai nhìn ra bằng mắt.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const G = require('./sheet_grid');

// --- Dựng lưới giả lập giống Sheet thật -------------------------------------
const R = ['Ưu tiên', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV/QC NOTE', 'Test Date'];
const SPEC = ['Mã', 'Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];

const round = (status, result, date) => ['Cao', 'Dev', status, result, '', date];
const blank = ['', '', '', '', '', ''];

function makeGrid(roundLabels = ['TEST LẦN 1', 'TEST LẦN 2', 'TEST LẦN 3'], subFor = () => R) {
  const header = [...SPEC];
  const sub = ['', '', '', '', ''];
  roundLabels.forEach((label, i) => {
    header.push(label, '', '', '', '', '');
    sub.push(...subFor(i));
  });
  return [
    header,
    sub,
    ['EVAL_021', 'Đánh giá', 'Tiêu đề 21', 'B1: mở\nB2: bấm', 'Web',
      ...round('DONE', 'kq1', '01/09'), ...round('DONE', 'kq2', '05/09'), ...blank],
    ['EVAL_022', 'Đánh giá', 'Tiêu đề 22', 'mô tả', 'Web', ...blank, ...blank, ...blank],
    ['EVAL_023', 'Đánh giá', 'Tiêu đề 23', 'mô tả', 'Web',
      ...round('DONE', 'kq', '01/09'), ...round('Fail', 'kq', '05/09'), ...round('DONE', 'kq', '09/09')],
    ['EVAL_024', 'Đánh giá', 'Tiêu đề 24', 'mô tả', 'Web',
      ...['', '', '', 'chỉ có kết quả, Trạng thái trống', '', ''], ...blank, ...blank],
  ];
}

const grid = makeGrid();

// --- Đọc bố cục --------------------------------------------------------------
test('mốc TEST LẦN 1 nằm ngay sau khối đặc tả', () => {
  assert.strictEqual(G.findFirstRoundColumn(grid[0]), 5);
});

test('liệt kê đúng các vòng và cột bắt đầu', () => {
  assert.deepStrictEqual(
    G.listRounds(grid).map((r) => [r.number, r.startCol]),
    [[1, 5], [2, 11], [3, 17]]
  );
  assert.deepStrictEqual(G.listRoundNumbers(grid), [1, 2, 3]);
});

test('phân biệt TEST LẦN 1 với TEST LẦN 10 (tiền tố trùng nhau)', () => {
  const g = makeGrid(['TEST LẦN 1', 'TEST LẦN 10']);
  assert.deepStrictEqual(G.listRoundNumbers(g), [1, 10]);
  assert.strictEqual(G.findRoundStart(g, 1), 5);
  assert.strictEqual(G.findRoundStart(g, 10), 11);
});

test('nhãn vòng bỏ qua hoa/thường và khoảng trắng thừa, nhưng không nhận chữ thừa', () => {
  assert.ok(G.ROUND_LABEL_RE.test('test  lần  3'));
  assert.ok(G.ROUND_LABEL_RE.test('TEST LẦN 3'));
  assert.ok(!G.ROUND_LABEL_RE.test('TEST LẦN 3 (cũ)'));
  assert.ok(!G.ROUND_LABEL_RE.test('TEST LẦN'));
});

test('normalizeLabel gộp khoảng trắng và bỏ hoa/thường', () => {
  assert.strictEqual(G.normalizeLabel('  Kết quả   thực hiện '), G.normalizeLabel('KẾT QUẢ THỰC HIỆN'));
});

// --- Tìm dòng ----------------------------------------------------------------
test('tìm dòng theo mã, không phân biệt hoa thường', () => {
  assert.strictEqual(G.findRowIndex(grid, 'EVAL_021'), 2);
  assert.strictEqual(G.findRowIndex(grid, 'eval_023'), 4);
  assert.strictEqual(G.findRowIndex(grid, 'EVAL_999'), -1);
});

test('liệt kê mã case bỏ qua ô rỗng và ô không phải EVAL_', () => {
  assert.deepStrictEqual(G.listCaseIds(grid), ['EVAL_021', 'EVAL_022', 'EVAL_023', 'EVAL_024']);
});

// --- Cột ghi: phần dễ hỏng dữ liệu nhất -------------------------------------
test('roundColumns trả đúng offset Trạng thái +2 / Kết quả +3', () => {
  assert.deepStrictEqual(G.roundColumns(grid, 2), { startIdx: 11, statusIdx: 13, resultIdx: 14 });
});

test('roundColumns trả null khi Sheet KHÔNG có vòng đó — tín hiệu phải DỪNG', () => {
  assert.strictEqual(G.roundColumns(grid, 9), null);
  assert.strictEqual(G.roundColumns(grid, 0), null);
  assert.strictEqual(G.findRoundStart(grid, 9), -1);
});

test('roundsOfCase đọc đúng ô Trạng thái và Kết quả của từng vòng', () => {
  const rows = G.roundsOfCase(grid, 2);
  assert.strictEqual(rows[0].status, 'DONE');
  assert.strictEqual(rows[1].result, 'kq2');
  assert.strictEqual(rows[2].hasData, false);
});

// --- Chốt nhãn dòng 2 --------------------------------------------------------
test('checkRoundLabels đạt khi nhãn dòng 2 đúng kỳ vọng', () => {
  assert.deepStrictEqual(G.checkRoundLabels(grid, 2), { ok: true, problems: [] });
});

test('checkRoundLabels đạt khi dòng 2 để trống (Sheet thật có cột không điền tên)', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['', '', '', '', '', '']);
  assert.strictEqual(G.checkRoundLabels(g, 1).ok, true);
});

test('checkRoundLabels CHẶN khi bố cục vòng bị xê dịch', () => {
  // Sheet có thêm 1 cột chen vào, đẩy Trạng thái/Kết quả lệch khỏi +2/+3
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', '']);
  const r = G.checkRoundLabels(g, 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.problems.length, 2);
  assert.match(r.problems[0], /Ghi chú thêm/);
});

test('checkRoundLabels CHẶN khi khối vòng hẹp hơn chuẩn (cột lấn sang vòng sau)', () => {
  // Vòng 1 chỉ chiếm 3 cột rồi tới vòng 2, và dòng 2 để TRỐNG nên phép so nhãn mù.
  // Không có chốt "cột đích còn thuộc vòng này" thì kết quả vòng 1 ghi thẳng vào
  // cột đầu của vòng 2 mà không ai biết.
  const header = [...SPEC, 'TEST LẦN 1', '', '', 'TEST LẦN 2', '', '', '', '', ''];
  const sub = new Array(header.length).fill('');
  const g = [header, sub, ['EVAL_021', '', '', '', '', '', '', '', '', '', '', '', '', '']];
  const r = G.checkRoundLabels(g, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems.join(' | '), /lấn sang khối vòng khác/);
});

test('checkRoundLabels CHẶN khi Sheet không có vòng đó', () => {
  const r = G.checkRoundLabels(grid, 9);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /TEST LẦN 9/);
});

test('nhãn kỳ vọng suy ra từ ROUND_LAYOUT, không phải bản chép thứ hai', () => {
  assert.strictEqual(G.STATUS_LABEL, G.ROUND_LAYOUT[G.STATUS_OFFSET]);
  assert.strictEqual(G.RESULT_LABEL, G.ROUND_LAYOUT[G.RESULT_OFFSET]);
});

// --- Suy ra vòng kế tiếp -----------------------------------------------------
test('đã chạy vòng 1-2 thì kế tiếp là 3, và Sheet đã có sẵn cột', () => {
  const r = G.suggestNextRound(grid, 2);
  assert.strictEqual(r.next, 3);
  assert.deepStrictEqual(r.done.map((d) => d.number), [1, 2]);
  assert.strictEqual(r.columnExists, true);
});

test('chưa chạy vòng nào thì kế tiếp là 1', () => {
  const r = G.suggestNextRound(grid, 3);
  assert.strictEqual(r.next, 1);
  assert.strictEqual(r.done.length, 0);
});

test('đã chạy hết 3 vòng thì kế tiếp là 4 và Sheet CHƯA có cột', () => {
  const r = G.suggestNextRound(grid, 4);
  assert.strictEqual(r.next, 4);
  assert.strictEqual(r.columnExists, false);
  assert.strictEqual(r.maxRoundColumn, 3);
});

test('Trạng thái trống nhưng Kết quả có nội dung vẫn tính là đã chạy', () => {
  const r = G.suggestNextRound(grid, 5);
  assert.strictEqual(r.next, 2);
  assert.deepStrictEqual(r.done.map((d) => d.number), [1]);
});

// --- Đặc tả ------------------------------------------------------------------
test('readSpec chỉ lấy cột bên trái mốc vòng đầu tiên', () => {
  assert.deepStrictEqual(G.readSpec(grid, 2).map((s) => s.label), SPEC);
});

test('columnLabel ưu tiên dòng 2, không có thì lùi về dòng 1', () => {
  assert.strictEqual(G.columnLabel(grid, 13), 'Trạng thái');
  assert.strictEqual(G.columnLabel(grid, 2), 'Tiêu đề');
  assert.strictEqual(G.roundOf(grid, 13), 'TEST LẦN 2');
});

// --- Lưới méo mó không được làm sập ------------------------------------------
test('lưới rỗng hoặc thiếu dòng không làm ném lỗi', () => {
  assert.deepStrictEqual(G.listRounds([]), []);
  assert.deepStrictEqual(G.listRoundNumbers([[]]), []);
  assert.strictEqual(G.roundColumns([[]], 1), null);
  assert.strictEqual(G.findRowIndex([], 'EVAL_001'), -1);
  assert.deepStrictEqual(G.readSpec([['Mã']], 5), []);
});

// --- Engine v2: tìm cột theo NHÃN — dữ liệu mẫu = tiêu đề THẬT của tab V1/HUY ------
// Lấy từ Sheet thật ngày 2026-09-28: vòng 1–5 rộng 7 cột (có FIXED), vòng 6+ rộng 6
// cột, vòng 1 có FEEDBACK AI thay DEV /QC NOTE, nhãn có khoảng trắng thừa ở đầu.
const V1_R1 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'FEEDBACK AI', 'FIXED', 'Test Date'];
const V1_R2_5 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'FIXED', 'Test Date'];
const V1_R6 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'Test Date'];

function makeV1Grid(rounds = 7) {
  const header = ['DONE25', '', '', '', ''];
  const sub = ['ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];
  for (let n = 1; n <= rounds; n += 1) {
    const block = n === 1 ? V1_R1 : n <= 5 ? V1_R2_5 : V1_R6;
    header.push(`TEST LẦN ${n}`, ...new Array(block.length - 1).fill(''));
    sub.push(...block);
  }
  // Sheets API cắt ô trống ở đuôi dòng — dòng 1 ngắn hơn dòng 2
  while (header.length && header[header.length - 1] === '') header.pop();
  return [header, sub, ['TÊN TICKET'], ['EVAL_V1_001', 'Phân quyền', 'Tiêu đề', 'Mô tả', 'Web'], ['EVAL_V1_002']];
}

const letters = (cols) => Object.fromEntries(
  Object.entries(cols).map(([k, v]) => [k, v === null ? null : G.colLetter(v)])
);

test('colLetter đổi chỉ số 0-based ra chữ cái cột', () => {
  assert.deepStrictEqual([0, 7, 25, 26, 51, 701, 702].map(G.colLetter), ['A', 'H', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
});

test('V1 thật, vòng 1 (7 cột, có FEEDBACK AI): Môi trường G, Trạng thái H, Kết quả I, Test Date L', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 1);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(letters(r.cols), { status: 'H', result: 'I', env: 'G', testDate: 'L' });
});

test('V1 thật, vòng 3: đúng các ô đã đọc trên Sheet (U, V, W, Z)', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 3);
  assert.deepStrictEqual(letters(r.cols), { status: 'V', result: 'W', env: 'U', testDate: 'Z' });
});

test('V1 thật, vòng 6 rộng 6 cột: Test Date ở +5, không phải +6', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 6);
  assert.strictEqual(r.block.startIdx, 40);
  assert.strictEqual(r.cols.status, 42);
  assert.strictEqual(r.cols.testDate, 45);
});

test('vòng cuối kéo tới hết chiều rộng dòng 2 dù dòng 1 bị cắt ô trống ở đuôi', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(7), 7);
  assert.deepStrictEqual(r.block, { startIdx: 46, endIdx: 52 });
  assert.strictEqual(r.cols.testDate, 51);
});

test('HUY thật: mọi vòng rộng 6 cột, cột "QC" thừa sau vòng 10 không ảnh hưởng', () => {
  const block = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'Test Date'];
  const header = [']]]', '', '', '', ''];
  const sub = ['ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];
  for (let n = 1; n <= 10; n += 1) {
    header.push(`TEST LẦN ${n}`, '', '', '', '', '');
    sub.push(...block);
  }
  header.push('0');
  sub.push('QC');
  const r = G.findRoundColumnsByLabel([header, sub, ['TÊN TICKET'], ['EVAL_021']], 10);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.block.startIdx, 59);
  assert.deepStrictEqual(r.cols, { status: 61, result: 62, env: 60, testDate: 64 });
});

test('cột chen thêm trong khối không làm lệch — tìm theo nhãn vẫn đúng cột', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', 'Test Date']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cols.status, 8);
  assert.strictEqual(r.cols.result, 9);
});

test('DỪNG khi khối vòng không có nhãn Trạng thái / Kết quả ở dòng 2', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['', '', '', '', '', '']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems.join(' | '), /không có cột "Trạng thái"/);
  assert.match(r.problems.join(' | '), /không có cột "Kết quả thực hiện"/);
});

test('DỪNG khi khối vòng có 2 cột Trạng thái', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Trạng thái', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', '', 'Test Date']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /2 cột "Trạng thái" \(F, H\)/);
});

test('thiếu Môi trường / Test Date chỉ cảnh báo, vẫn ghi được 2 cột chính', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', '', 'Trạng thái', 'Kết quả thực hiện', '', '']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cols.env, null);
  assert.strictEqual(r.cols.testDate, null);
  assert.strictEqual(r.warnings.length, 2);
});

test('không mượn nhãn của vòng khác (chỉ tìm trong khối của đúng vòng)', () => {
  let i = 0;
  const g = makeGrid(['TEST LẦN 1', 'TEST LẦN 2'], () =>
    (i++ === 0 ? ['Ưu tiên', 'Môi trường', '', 'Kết quả thực hiện', '', ''] : R));
  assert.strictEqual(G.findRoundColumnsByLabel(g, 1).ok, false);
  assert.strictEqual(G.findRoundColumnsByLabel(g, 2).ok, true);
});

test('findRoundColumnsByLabel trả ok=false khi Sheet không có vòng đó', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 99);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.block, null);
  assert.match(r.problems[0], /TEST LẦN 99/);
});

test('findRowIndices trả mọi dòng trùng mã — để chặn ghi khi mã xuất hiện 2 lần', () => {
  const g = [...grid, ['EVAL_021', 'bản trùng']];
  assert.deepStrictEqual(G.findRowIndices(g, 'EVAL_021'), [2, 6]);
  assert.deepStrictEqual(G.findRowIndices(g, 'eval_022'), [3]);
  assert.deepStrictEqual(G.findRowIndices(g, 'EVAL_999'), []);
});

test('roundsOfCase đọc theo nhãn: đúng ô cả khi khối có cột chen thêm', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', 'Test Date']);
  g[2][7] = 'ghi chú';
  g[2][8] = 'DONE';
  g[2][9] = 'kết quả thật';
  const r = G.roundsOfCase(g, 2)[0];
  assert.strictEqual(r.status, 'DONE');
  assert.strictEqual(r.result, 'kết quả thật');
});

test('khối có 2 bộ cột vì ô tiêu đề vòng kế tiếp bị trống → DỪNG kèm gợi ý đúng ô cần điền', () => {
  // Đúng lỗi thật của tab V1 (2026-09-29): ô AU1 lẽ ra là "TEST LẦN 7" nhưng để trống,
  // nên khối vòng 6 nuốt luôn các cột của vòng 7.
  const g = makeV1Grid(8);
  const at = g[0].indexOf('TEST LẦN 7');
  g[0][at] = '';
  const r = G.findRoundColumnsByLabel(g, 6);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems.join(' | '), /2 cột "Trạng thái" \(AQ, AW\)/);
  assert.match(r.problems.join(' | '), /ô AU1 đang thiếu nhãn "TEST LẦN 7"/);
});
