const test = require('node:test');
const assert = require('node:assert');
const { runCleanups, warmUpUrl } = require('./case_runner');

const quiet = () => {};

test('runCleanups: chạy ngược thứ tự đăng ký; lỗi / quá giờ chỉ ghi lại, việc sau vẫn chạy', async () => {
  const order = [];
  const out = await runCleanups(
    [
      { label: 'A', fn: async () => order.push('A') },
      { label: 'B', fn: async () => { throw new Error('hỏng'); } },
      { label: 'C', fn: () => new Promise(() => {}) },
    ],
    { print: quiet, timeoutMs: 50 }
  );
  assert.deepStrictEqual(order, ['A']);
  assert.deepStrictEqual(out.map((x) => [x.label, x.ok]), [['C', false], ['B', false], ['A', true]]);
  assert.match(out[1].error, /hỏng/);
});

test('warmUpUrl: chỉ kịch bản theo ticket mới khởi động ở targetPath', () => {
  const module = { targetPath: '/hrm/form', getTargetUrl() { return `http://localhost:5200${this.targetPath}`; } };
  assert.strictEqual(warmUpUrl({ module }, '1309-AI01'), 'http://localhost:5200/hrm/form');
  assert.strictEqual(warmUpUrl({ module }, 'EVAL_017'), undefined);
  assert.strictEqual(warmUpUrl({ module: {} }, '1309-AI01'), undefined);
});
