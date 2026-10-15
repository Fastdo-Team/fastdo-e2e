const test = require('node:test');
const assert = require('node:assert');
const { resolveTab } = require('./tab');

const META = {
  tabs: [
    { gid: 1086276772, title: 'V1 - fEvaluation - VIBE ' },
    { gid: 286718788, title: 'fEvaluation - VIBE - HUY' },
  ],
};

test('SHEET_GID chọn đúng tab, không cần tên', () => {
  assert.deepStrictEqual(resolveTab(META, { gid: '1086276772' }), {
    gid: 1086276772,
    title: 'V1 - fEvaluation - VIBE ',
    warnings: [],
  });
});

test('SHEET_GID + SHEET_TAB lệch tên: vẫn theo gid, kèm cảnh báo', () => {
  const r = resolveTab(META, { gid: '286718788', title: 'fEvaluation - VIBE' });
  assert.strictEqual(r.title, 'fEvaluation - VIBE - HUY');
  assert.match(r.warnings[0], /khác tên thật/);
});

test('gid không tồn tại → DỪNG, liệt kê tab thật (hiện dấu cách cuối)', () => {
  assert.throws(
    () => resolveTab(META, { gid: '1' }),
    (e) => {
      assert.match(e.message, /AN TOÀN/);
      assert.match(e.message, /V1 - fEvaluation - VIBE␠/);
      return true;
    }
  );
});

test('chỉ có SHEET_TAB: phải khớp chính xác, KHÔNG lùi về tab đầu như gviz', () => {
  assert.strictEqual(resolveTab(META, { title: 'fEvaluation - VIBE - HUY' }).gid, 286718788);
  assert.throws(
    () => resolveTab(META, { title: 'fEvaluation - VIBE' }),
    (e) => {
      assert.match(e.message, /Không có tab nào tên đúng/);
      assert.match(e.message, /SHEET_GID=1086276772/);
      return true;
    }
  );
});

test('tên thiếu dấu cách cuối cũng bị chặn, kèm gợi ý gid', () => {
  assert.throws(
    () => resolveTab(META, { title: 'V1 - fEvaluation - VIBE' }),
    /Gần giống: "V1 - fEvaluation - VIBE␠" → khai SHEET_GID=1086276772/
  );
});

test('không khai gì → DỪNG', () => {
  assert.throws(() => resolveTab(META, {}), /Chưa chọn tab/);
});
