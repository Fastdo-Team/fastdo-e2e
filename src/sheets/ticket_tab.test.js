const test = require('node:test');
const assert = require('node:assert');
const T = require('./ticket_tab');

// Lưới giống tab "_Mẫu" của AI-QC-Testcase-Ticket.xlsx (2 vòng là đủ để kiểm khối vòng 1)
const HEADER = [
  ['', '', '', '', '', 'TEST LẦN 1', '', '', '', '', '', '', 'TEST LẦN 2'],
  ['ID', 'Function', 'Tiêu đề', 'Mô tả', 'Nền tảng',
    'Ưu tiên', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'FEEDBACK AI', 'FIXED', 'Test Date',
    'Ưu tiên', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV/QC NOTE', 'FIXED', 'Test Date'],
  ['TÊN TICKET: [mã] Tên ticket — sửa dòng này sau khi nhân bản tab'],
];
const grid = (...rows) => [...HEADER.map((r) => [...r]), ...rows];
const aiCase = (n) => ({ function: 'Todolist', title: `Case AI ${n}`, description: `Điều kiện: …\nCác bước:\nB1: …\nKết quả mong muốn: ${n}`, platform: 'Web', priority: 'Quan trọng' });

test('tab mới: thêm case AI từ dòng 4, gán ID <mã>-AInn, sửa dòng 3 thành [mã] tiêu đề', () => {
  const p = T.planPrepare(grid(), { ticket: '1295', title: 'Không gõ được', aiCases: [aiCase(1), aiCase(2)] });
  assert.deepStrictEqual(p.cases.map((c) => [c.id, c.row, c.source]), [['1295-AI01', 3, 'AI'], ['1295-AI02', 4, 'AI']]);
  assert.ok(p.writes.some((w) => w.row === 3 && w.col === 0 && w.value === '1295-AI01'));
  assert.ok(p.writes.some((w) => w.row === 3 && w.col === 5 && w.value === 'Quan trọng'), 'ưu tiên ghi vào cột Ưu tiên của TEST LẦN 1');
  assert.ok(p.writes.some((w) => w.row === 2 && w.col === 0 && w.value === '[1295] Không gõ được'));
});

test('QC đã viết case: dòng chưa có ID được gán <mã>-QCnn, case AI thêm SAU dòng cuối', () => {
  const g = grid(['1295-QC01', 'F', 'Case QC 1', 'Mô tả 1', 'Web'], ['', 'F', 'Case QC 2 (quên ID)', 'Mô tả 2', 'Web']);
  g[2] = ['[1295] Tên QC đã ghi'];
  const p = T.planPrepare(g, { ticket: '1295', title: 'x', aiCases: [aiCase(1)] });
  assert.deepStrictEqual(p.cases.map((c) => [c.id, c.row, c.source]), [['1295-QC01', 3, 'QC'], ['1295-QC02', 4, 'QC'], ['1295-AI01', 5, 'AI']]);
  assert.ok(!p.writes.some((w) => w.row === 2), 'không ghi đè tiêu đề QC đã ghi');
});

test('lượt sau (tab đã có case AI): vẫn nhận case AI MỚI, bỏ case trùng tiêu đề, giới hạn maxAiCases', () => {
  const g = grid(['1295-AI01', 'F', '[Tái hiện] Case AI 1', 'Mô tả', 'Web']);
  const p = T.planPrepare(g, { ticket: '1295', title: 'x', aiCases: [aiCase(1), aiCase(2), aiCase(2)] });
  assert.deepStrictEqual(p.cases.map((c) => c.id), ['1295-AI01', '1295-AI02'], 'Case AI 1 trùng (bỏ tiền tố), Case AI 2 gửi 2 lần chỉ ghi 1');
  assert.strictEqual(T.planPrepare(grid(), { ticket: '1295', title: 'x', aiCases: [1, 2, 3, 4, 5].map(aiCase), maxAiCases: 3 }).cases.length, 3);
});

test('case AI: tiêu đề có tiền tố loại, Mô tả thêm dòng Nguồn; loại đọc lại đúng từ tiêu đề', () => {
  const p = T.planPrepare(grid(), {
    ticket: '1295',
    title: 'x',
    aiCases: [
      { ...aiCase(1), type: 'repro', source: 'Ticket: «Có thể gõ chữ»' },
      { ...aiCase(2), type: 'regression', title: '[Hồi quy] Case AI 2', source: '_TypeInput.razor:620' },
    ],
  });
  const at = (row, col) => p.writes.find((w) => w.row === row && w.col === col).value;
  assert.strictEqual(at(3, 2), '[Tái hiện] Case AI 1');
  assert.strictEqual(at(4, 2), '[Hồi quy] Case AI 2', 'không ghi tiền tố 2 lần');
  assert.ok(at(3, 3).endsWith('\nNguồn: Ticket: «Có thể gõ chữ»'));
  assert.deepStrictEqual(p.cases.map((c) => c.type), ['repro', 'regression']);
  assert.strictEqual(T.caseType('[Hồi quy] Giữ nguyên dán'), 'regression');
  assert.strictEqual(T.caseType('Luồng chuẩn: gõ chữ'), 'repro', 'case QC không ghi loại = Tái hiện');
});

test('nút «AI soạn thêm testcase» ở dòng 3: bỏ tích → tắt; tab cũ không có nút → bật', () => {
  const withToggle = (value) => {
    const g = grid();
    g[2] = ['[1295] Tên', '', '', '', '', 'AI soạn thêm testcase', value];
    return g;
  };
  assert.strictEqual(T.readAiToggle(withToggle('FALSE')), false);
  assert.strictEqual(T.readAiToggle(withToggle('TRUE')), true);
  assert.strictEqual(T.readAiToggle(grid()), true);
});

test('setup-template: ô AI vào dòng hồng (nhãn D3, hộp kiểm E3) + mục 11 cuối Hướng dẫn', () => {
  const guide = [['FILE TESTCASE AI-QC'], [], ['10. DÀNH CHO NGƯỜI QUẢN TRỊ'], ['5', 'Gửi link']];
  const first = T.planSetupTemplate(grid(), guide);
  assert.strictEqual(first.toggle, 'add');
  assert.strictEqual(first.guide[0].row, 5, 'cách dòng cuối (index 3) 1 dòng trống');

  const req = T.toggleRequests(7, first);
  assert.ok(req.some((r) => r.mergeCells && r.mergeCells.range.endColumnIndex === 3), 'tên ticket gộp lại A3:C3');
  const cells = req.find((r) => r.updateCells && r.updateCells.start).updateCells;
  assert.strictEqual(cells.start.columnIndex, 3);
  assert.strictEqual(cells.rows[0].values[1].userEnteredValue.boolValue, true, 'E3 mặc định tích');
  assert.ok(!cells.fields.split(',').includes('userEnteredFormat'), 'không ghi đè cả định dạng → giữ nền hồng');
});

test('setup-template: ô AI đang ở F3 / G3 (bản đầu) → dời vào D3 / E3; đã đúng chỗ + đủ Hướng dẫn → không đổi gì', () => {
  const oldTemplate = grid();
  oldTemplate[2] = ['TÊN TICKET', '', '', '', '', 'AI soạn thêm testcase', 'TRUE'];
  const moved = T.planSetupTemplate(oldTemplate, []);
  assert.deepStrictEqual([moved.toggle, moved.oldCol], ['move', 5]);
  const clear = T.toggleRequests(7, moved)[0].updateCells;
  assert.deepStrictEqual([clear.range.startColumnIndex, clear.range.endColumnIndex, clear.rows], [5, 7, undefined], 'xoá sạch F3:G3');

  const newTemplate = grid();
  newTemplate[2] = ['TÊN TICKET', '', '', 'AI soạn thêm testcase:', 'TRUE'];
  const guide = [['10. QUẢN TRỊ'], [], ...T.planSetupTemplate(newTemplate, [['10. QUẢN TRỊ']]).guide.map((w) => [w.value])];
  const again = T.planSetupTemplate(newTemplate, guide);
  assert.deepStrictEqual([again.toggle, again.guide.length, T.toggleRequests(7, again).length], ['ok', 0, 0]);
  assert.strictEqual(T.readAiToggle(newTemplate), true);
});

test('setup-template: mục 11 đã có nhưng chữ cũ → ghi lại đúng dòng đó, không thêm mục mới', () => {
  const guide = [['10. QUẢN TRỊ'], [], ['11. AI SOẠN THÊM TESTCASE (TỪ 15/10/2026)'], ['• chữ cũ nói ô G3']];
  const plan = T.planSetupTemplate(grid(), guide);
  assert.ok(plan.guide.length > 0 && plan.guide.every((w) => w.row >= 3), 'ghi từ dòng của mục 11 trở xuống');
  assert.ok(plan.guide[0].value.includes('E3'));
});

test('mã ticket sai dạng → từ chối (tên tab = mã ticket, chống ghi nhầm tab)', () => {
  assert.throws(() => T.planPrepare(grid(), { ticket: '12a', title: 'x' }), /không hợp lệ/);
  assert.throws(() => T.planSummary([[], [], ['Mã ticket']], { ticket: '../x' }), /không hợp lệ/);
});

test('ô Kết quả: 2 phần trước / sau, link video bấm được đúng vị trí, nối sau chữ cũ', () => {
  const old = { userEnteredValue: { stringValue: 'lần trước' } };
  const cell = T.buildResultCell(old, [
    { label: 'Trước khi sửa · production a1b2c3d', text: 'Trường rỗng. Kết quả: Không đạt (đúng lỗi ticket).', videoLabel: 'Video trước khi sửa', videoUrl: 'https://files.catbox.moe/a.mp4' },
    { label: 'Sau khi sửa · feat/ticket_1295 e7f8a9b', text: 'Trường hiện đúng. Kết quả: Đạt.', videoLabel: 'Video Test Record', videoUrl: 'https://files.catbox.moe/b.mp4' },
  ]);
  const text = cell.userEnteredValue.stringValue;
  assert.ok(text.startsWith('lần trước\n[Trước khi sửa'));
  assert.ok(text.includes('- Video Test Record: https://files.catbox.moe/b.mp4'));
  const links = cell.textFormatRuns.filter((r) => r.format.link);
  assert.deepStrictEqual(links.map((r) => text.substr(r.startIndex, r.format.link.uri.length)), ['https://files.catbox.moe/a.mp4', 'https://files.catbox.moe/b.mp4']);
  assert.ok(cell.textFormatRuns.every((r) => (r.startIndex || 0) < text.length), 'API từ chối run bắt đầu ở cuối chữ');
});

test('kết quả: ghi đúng cột theo nhãn TEST LẦN 1, case không có trên tab → dừng', () => {
  const g = grid(['1295-QC01', 'F', 'T', 'M', 'Web']);
  const { writes } = T.planResults(g, {
    cases: [{ id: '1295-QC01', status: 'DONE', feedback: 'Tái hiện: Có', parts: [{ label: 'x', text: 'y', videoLabel: 'Video', videoUrl: 'https://v' }] }],
    testDateSerial: 46309,
  });
  const at = (col) => writes.find((w) => w.row === 3 && w.col === col);
  assert.strictEqual(at(6).value, 'Localhost');
  assert.strictEqual(at(7).value, 'DONE');
  assert.ok(at(8).value.userEnteredValue.stringValue.includes('https://v'));
  assert.strictEqual(at(9).value, 'Tái hiện: Có');
  assert.strictEqual(at(11).value, 46309);
  assert.ok(!writes.some((w) => w.col >= 12), 'không đụng vòng của QC');
  assert.throws(() => T.planResults(g, { cases: [{ id: '1295-QC09', status: 'DONE' }] }), /Không thấy case/);
  assert.throws(() => T.planResults(g, { cases: [{ id: '1295-QC01', status: 'OK' }] }), /danh sách chọn/);
});

test('Tổng hợp: cập nhật đúng dòng của ticket, chưa có thì lấy dòng trống đầu tiên; tab là link', () => {
  const header = ['Mã ticket', 'Tên ticket', 'Tab', 'Nguồn testcase', 'Case QC', 'Case AI', 'Đạt', 'Không đạt', 'Bỏ qua', 'Chưa xong', 'Tái hiện lỗi', 'Trạng thái AI-QC', 'Vòng sửa', 'Pull Request', 'Lần test cuối'];
  const g = [['TỔNG HỢP'], ['ghi chú'], header, ['9999', 'Ví dụ'], ['1295', 'Cũ']];
  const upd = T.planSummary(g, { ticket: '1295', state: 'Đang tái hiện', repro: 'Có', rounds: 1 });
  assert.strictEqual(upd.row, 4);
  assert.deepStrictEqual(upd.writes.find((w) => w.col === 11).value, 'Đang tái hiện');
  const add = T.planSummary(g, { ticket: '1300', name: 'Mới', tabUrl: 'https://docs.google.com/x#gid=5' });
  assert.strictEqual(add.row, 5);
  const tab = add.writes.find((w) => w.col === 2).value;
  assert.strictEqual(tab.textFormatRuns[0].format.link.uri, 'https://docs.google.com/x#gid=5');
  assert.throws(() => T.planSummary(g, { ticket: '1295', state: 'Xong' }), /không hợp lệ/);
});

test('writeRequests: ô có link ghi kèm textFormatRuns, ô thường chỉ userEnteredValue', () => {
  const reqs = T.writeRequests(9, [{ row: 3, col: 7, value: 'DONE' }, { row: 3, col: 11, value: 46309 }, { row: 3, col: 8, value: T.buildResultCell({}, [{ label: 'a', text: 'b', videoLabel: 'V', videoUrl: 'https://v' }]) }]);
  assert.deepStrictEqual(reqs.map((r) => r.updateCells.fields), ['userEnteredValue', 'userEnteredValue', 'userEnteredValue,textFormatRuns']);
  assert.deepStrictEqual(reqs[1].updateCells.rows[0].values[0].userEnteredValue, { numberValue: 46309 });
  assert.strictEqual(reqs[0].updateCells.start.sheetId, 9);
});
