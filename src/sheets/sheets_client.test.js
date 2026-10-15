const test = require('node:test');
const assert = require('node:assert');
const { createSheetsClient, posKey } = require('./sheets_client');

function fakeTransport(responses) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
const client = (responses) => {
  const transport = fakeTransport(responses);
  return { c: createSheetsClient({ spreadsheetId: 'abc', transport, sleep: noSleep }), transport };
};

test('getMeta trả danh sách tab với tên thật và gid', async () => {
  const { c, transport } = client([{
    status: 200,
    data: {
      properties: { title: 'TESTCASE' },
      sheets: [{ properties: { sheetId: 5, title: 'V1 ', index: 0, gridProperties: { rowCount: 10, columnCount: 3 } } }],
    },
  }]);
  const meta = await c.getMeta();
  assert.strictEqual(meta.title, 'TESTCASE');
  assert.deepStrictEqual(meta.tabs, [{ gid: 5, title: 'V1 ', index: 0, hidden: false, rows: 10, cols: 3 }]);
  assert.match(transport.calls[0].url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/abc\?fields=/);
});

test('readGrid gọi values API với tên tab bọc nháy, trả toàn chuỗi', async () => {
  const { c, transport } = client([{ status: 200, data: { values: [['ID', 1], ['EVAL_1']] } }]);
  assert.deepStrictEqual(await c.readGrid('V1 '), [['ID', '1'], ['EVAL_1']]);
  assert.ok(transport.calls[0].url.includes(encodeURIComponent("'V1 '")));
  assert.ok(transport.calls[0].url.includes('valueRenderOption=FORMATTED_VALUE'));
});

test('readCells xếp đúng thứ tự vùng theo startRow/startColumn; ô trống = {}', async () => {
  const { c, transport } = client([{
    status: 200,
    data: {
      sheets: [{
        data: [
          { startRow: 255, startColumn: 7, rowData: [{ values: [{ userEnteredValue: { stringValue: 'DONE' } }] }] },
          { rowData: [{ values: [{ userEnteredValue: { stringValue: 'EVAL_X' } }] }] },
          { startRow: 255, startColumn: 8 },
        ],
      }],
    },
  }]);
  const cells = await c.readCells(["'V1'!H256", "'V1'!A1", "'V1'!I256"]);
  assert.strictEqual(cells[0].userEnteredValue.stringValue, 'DONE');
  assert.strictEqual(cells[1].userEnteredValue.stringValue, 'EVAL_X');
  assert.deepStrictEqual(cells[2], {});
  assert.ok(transport.calls[0].url.includes('includeGridData=true'));
});

test('readCells kèm gid: ô thuộc tab khác (tab vừa đổi tên) → [AN TOÀN]; thiếu sheetId nghĩa là gid 0', async () => {
  const data = (sheetId) => ({
    status: 200,
    data: { sheets: [{ properties: sheetId === undefined ? {} : { sheetId }, data: [{ rowData: [{ values: [{}] }] }] }] },
  });
  await assert.rejects(() => client([data(9)]).c.readCells(["'V1'!A1"], { gid: 5 }), /AN TOÀN.*gid 9.*gid 5/);
  assert.deepStrictEqual(await client([data(5)]).c.readCells(["'V1'!A1"], { gid: 5 }), [{}]);
  assert.deepStrictEqual(await client([data(undefined)]).c.readCells(["'V1'!A1"], { gid: 0 }), [{}]);
  await assert.rejects(() => client([data(undefined)]).c.readCells(["'V1'!A1"], { gid: 5 }), /gid 0/);
});

test('batchUpdate POST tới :batchUpdate với đúng requests', async () => {
  const { c, transport } = client([{ status: 200, data: { replies: [] } }]);
  await c.batchUpdate([{ updateCells: { fields: 'userEnteredValue' } }]);
  assert.strictEqual(transport.calls[0].method, 'POST');
  assert.strictEqual(transport.calls[0].url, 'https://sheets.googleapis.com/v4/spreadsheets/abc:batchUpdate');
  assert.deepStrictEqual(transport.calls[0].data, { requests: [{ updateCells: { fields: 'userEnteredValue' } }] });
});

test('429 và 5xx được thử lại rồi mới báo lỗi', async () => {
  const { c, transport } = client([
    { status: 429, data: {} },
    { status: 503, data: {} },
    { status: 200, data: { values: [] } },
  ]);
  assert.deepStrictEqual(await c.readGrid('T'), []);
  assert.strictEqual(transport.calls.length, 3);
});

test('403 nói rõ phải Share cho service account', async () => {
  const { c } = client([{ status: 403, data: { error: { message: 'The caller does not have permission' } } }]);
  await assert.rejects(() => c.getMeta(), /không có quyền.*Share Sheet/);
});

test('lỗi mạng thử lại 3 lần rồi báo lỗi mạng', async () => {
  const err = () => new Error('ECONNRESET');
  const { c, transport } = client([err(), err(), err(), err()]);
  await assert.rejects(() => c.readGrid('T'), /lỗi mạng — ECONNRESET/);
  assert.strictEqual(transport.calls.length, 4);
});

test('canEdit hỏi Drive; lỗi thì trả null (không biết), không ném', async () => {
  assert.strictEqual(await client([{ status: 200, data: { capabilities: { canEdit: true } } }]).c.canEdit(), true);
  assert.strictEqual(await client([{ status: 200, data: { capabilities: { canEdit: false } } }]).c.canEdit(), false);
  assert.strictEqual(await client([{ status: 404, data: {} }]).c.canEdit(), null);
});

test('posKey đổi vùng 1 ô ra dòng:cột 0-based', () => {
  assert.strictEqual(posKey("'V1 - x '!H256"), '255:7');
  assert.strictEqual(posKey("'T'!AA1"), '0:26');
});

test('thiếu SHEET_ID thì ném lỗi ngay', () => {
  assert.throws(() => createSheetsClient({ transport: async () => ({}) }), /SHEET_ID/);
});
