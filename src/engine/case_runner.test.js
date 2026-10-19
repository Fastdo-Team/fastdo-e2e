const test = require('node:test');
const assert = require('node:assert');
const { runCleanups, warmUpUrl, moveVideo } = require('./case_runner');

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

test('moveVideo: file còn bị giữ thì thử lại; mãi không được thì dùng nguyên file cũ, không ném lỗi', async () => {
  const busy = () => Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
  let calls = 0;
  const flaky = () => {
    calls += 1;
    if (calls < 3) throw busy();
  };
  assert.strictEqual(await moveVideo('C:/r/page@1.webm', 'C:/r/video.webm', { print: quiet, waitMs: 1, rename: flaky }), 'C:/r/video.webm');
  assert.strictEqual(calls, 3);

  const lines = [];
  const locked = () => {
    throw busy();
  };
  const kept = await moveVideo('C:/r/page@1.webm', 'C:/r/video.webm', { print: (l) => lines.push(l), attempts: 2, waitMs: 1, rename: locked });
  assert.strictEqual(kept, 'C:/r/page@1.webm');
  assert.match(lines[0], /EBUSY/);

  assert.strictEqual(await moveVideo('C:/r/video.webm', 'C:/r/video.webm', { rename: locked }), 'C:/r/video.webm');
});
