const test = require('node:test');
const assert = require('node:assert');
const { createStepLog } = require('./steps');

function clockAt(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('mark() đóng bước đang mở và mở bước mới; mốc ms tính từ t0 (lúc bắt đầu quay)', () => {
  const events = [];
  const log = createStepLog({ t0: 1000, clock: clockAt([1100, 1500, 1500, 2600]), onEvent: (e) => events.push(e), print: () => {} });
  log.mark('B1 Mở trang');
  log.mark('B2 Bấm nút');
  log.finish();
  assert.deepStrictEqual(log.steps.map((s) => [s.index, s.label, s.ok, s.startMs, s.endMs]), [
    [1, 'B1 Mở trang', true, 100, 500],
    [2, 'B2 Bấm nút', true, 500, 1600],
  ]);
  assert.deepStrictEqual(events.map((e) => e.status), ['start', 'ok', 'start', 'ok']);
});

test('step(label, fn) lỗi → bước ✗ kèm lỗi, ném lại nguyên trạng', async () => {
  const log = createStepLog({ print: () => {} });
  await assert.rejects(
    () =>
      log.step('B3 Kích hoạt', async () => {
        throw new Error('nút mờ');
      }),
    /nút mờ/
  );
  assert.strictEqual(log.steps[0].ok, false);
  assert.strictEqual(log.steps[0].error, 'nút mờ');
});

test('finish(lỗi) đánh dấu bước đang mở là ✗ — kịch bản ném lỗi giữa bước dùng mark()', () => {
  const log = createStepLog({ print: () => {} });
  log.mark('B1 Mở mẫu');
  log.finish('không tìm thấy mẫu');
  assert.strictEqual(log.steps[0].ok, false);
  assert.strictEqual(log.steps[0].error, 'không tìm thấy mẫu');
});

test('check() ghi nhận phép kiểm, trả boolean, không ném lỗi', () => {
  const log = createStepLog({ print: () => {} });
  assert.strictEqual(log.check('Banner chỉ xem', false, { expected: 'có', actual: 'không' }), false);
  assert.deepStrictEqual(log.checks, [{ label: 'Banner chỉ xem', ok: false, expected: 'có', actual: 'không' }]);
  assert.strictEqual(log.failedChecks().length, 1);
});
