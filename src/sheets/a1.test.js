const test = require('node:test');
const assert = require('node:assert');
const { quoteTab, cellRange, a1Of, showSpaces } = require('./a1');

test('quoteTab bọc nháy đơn và nhân đôi nháy đơn bên trong', () => {
  assert.strictEqual(quoteTab('V1 - fEvaluation - VIBE '), "'V1 - fEvaluation - VIBE '");
  assert.strictEqual(quoteTab("Tab của QC's"), "'Tab của QC''s'");
});

test('a1Of + cellRange', () => {
  assert.strictEqual(a1Of(255, 7), 'H256');
  assert.strictEqual(a1Of(0, 26), 'AA1');
  assert.strictEqual(cellRange('V1 ', 'H256'), "'V1 '!H256");
});

test('showSpaces hiện dấu cách đầu/cuối thành ␠', () => {
  assert.strictEqual(showSpaces('V1 - fEvaluation - VIBE '), 'V1 - fEvaluation - VIBE␠');
  assert.strictEqual(showSpaces('  a b '), '␠␠a b␠');
  assert.strictEqual(showSpaces('abc'), 'abc');
  assert.strictEqual(showSpaces('  '), '␠␠');
  assert.strictEqual(showSpaces(''), '');
});
