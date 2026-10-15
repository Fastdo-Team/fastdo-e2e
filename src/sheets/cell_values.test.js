const test = require('node:test');
const assert = require('node:assert');
const C = require('./cell_values');

test('allowedValues đọc danh sách chọn ONE_OF_LIST; ô không giới hạn → null', () => {
  const cell = {
    dataValidation: {
      strict: true,
      condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'DONE' }, { userEnteredValue: 'Fail' }] },
    },
  };
  assert.deepStrictEqual(C.allowedValues(cell), ['DONE', 'Fail']);
  assert.strictEqual(C.allowedValues({}), null);
});

test('buildAppendedResultCell giữ nguyên chữ + link cũ, chặn link loang, gắn link video', () => {
  const old = {
    userEnteredValue: { stringValue: 'Link: https://jam.dev/c/1' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } }],
  };
  const video = 'https://files.catbox.moe/v.mp4';
  const entry = `[Tự động] …\n- Video Test Record: ${video}`;
  const r = C.buildAppendedResultCell(old, entry, video);
  assert.strictEqual(r.text, `Link: https://jam.dev/c/1\n${entry}`);
  assert.deepStrictEqual(r.runs.slice(0, 2), old.textFormatRuns);
  assert.deepStrictEqual(r.runs[2], { startIndex: 'Link: https://jam.dev/c/1'.length, format: {} });
  assert.deepStrictEqual(r.runs[3], { startIndex: r.text.lastIndexOf(video), format: { link: { uri: video } } });
  assert.strictEqual(r.runs.length, 4);
});

test('ô cũ đã kết thúc bằng xuống dòng thì không thêm dòng trống', () => {
  const r = C.buildAppendedResultCell({ userEnteredValue: { stringValue: 'cũ\n' } }, 'mới', null);
  assert.strictEqual(r.text, 'cũ\nmới');
});

test('ô trống: chỉ có chữ mới, link video vẫn được gắn', () => {
  const entry = 'a\n- Video Test Record: https://v';
  const r = C.buildAppendedResultCell({}, entry, 'https://v');
  assert.strictEqual(r.text, entry);
  assert.deepStrictEqual(r.runs, [{ startIndex: entry.lastIndexOf('https://v'), format: { link: { uri: 'https://v' } } }]);
});

test('cleanRuns bỏ màu kiểu cũ khi đã có màu kiểu mới (API từ chối gửi cả hai)', () => {
  const runs = C.cleanRuns([{ startIndex: 3, format: { foregroundColor: { red: 1 }, foregroundColorStyle: { rgbColor: { red: 1 } }, bold: true } }]);
  assert.deepStrictEqual(runs, [{ startIndex: 3, format: { foregroundColorStyle: { rgbColor: { red: 1 } }, bold: true } }]);
});

test('isFormula / hasChips / hasDateFormat', () => {
  assert.strictEqual(C.isFormula({ userEnteredValue: { formulaValue: '=A1' } }), true);
  assert.strictEqual(C.isFormula({ userEnteredValue: { stringValue: '=A1' } }), false);
  assert.strictEqual(C.hasChips({ chipRuns: [{ startIndex: 0 }] }), true);
  assert.strictEqual(C.hasChips({}), false);
  assert.strictEqual(C.hasDateFormat({ userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }), true);
  assert.strictEqual(C.hasDateFormat({}), false);
});

test('sameValue so cả kiểu lẫn giá trị', () => {
  assert.strictEqual(C.sameValue({ userEnteredValue: { numberValue: 46280 } }, { userEnteredValue: { numberValue: 46280 } }), true);
  assert.strictEqual(C.sameValue({ userEnteredValue: { stringValue: '46280' } }, { userEnteredValue: { numberValue: 46280 } }), false);
  assert.strictEqual(C.sameValue({}, {}), true);
});

test('snapshot giữ giá trị, đoạn định dạng, định dạng số; linkRuns lấy vị trí + uri', () => {
  const cell = {
    userEnteredValue: { stringValue: 'Link: x' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'x' } } }],
    userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
    formattedValue: 'Link: x',
  };
  assert.deepStrictEqual(C.snapshot(cell), {
    userEnteredValue: { stringValue: 'Link: x' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'x' } } }],
    numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' },
  });
  assert.deepStrictEqual(C.linkRuns(cell), [{ at: 6, uri: 'x' }]);
  assert.strictEqual(C.cellText(cell), 'Link: x');
  assert.strictEqual(C.cellText({ userEnteredValue: { numberValue: 3 } }), '');
});
