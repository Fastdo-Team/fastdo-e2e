const test = require('node:test');
const assert = require('node:assert');
const { videoPace, paceFor, MAX_MS } = require('./video_pace');
const { createStepLog } = require('./steps');

test('nhịp video: đọc 3 biến, sai / âm → 0, chặn trên MAX_MS', () => {
  assert.deepStrictEqual(videoPace({ VIDEO_SLOWMO_MS: '500', VIDEO_STEP_PAUSE_MS: '1200', VIDEO_END_HOLD_MS: '99999' }), {
    slowMoMs: 500,
    stepPauseMs: 1200,
    endHoldMs: MAX_MS,
  });
  assert.deepStrictEqual(videoPace({ VIDEO_SLOWMO_MS: 'abc', VIDEO_STEP_PAUSE_MS: '-5' }), { slowMoMs: 0, stepPauseMs: 0, endHoldMs: 0 });
});

test('không quay video → không làm chậm, kể cả khi có biến', () => {
  assert.deepStrictEqual(paceFor(false, { VIDEO_SLOWMO_MS: '500' }), { slowMoMs: 0, stepPauseMs: 0, endHoldMs: 0 });
  assert.strictEqual(paceFor(true, { VIDEO_SLOWMO_MS: '500' }).slowMoMs, 500);
});

test('step: có stepPauseMs thì dừng sau bước ĐẠT, không dừng khi bước lỗi; mốc kết thúc bước không tính phần dừng', async () => {
  const sleeps = [];
  let clock = 0;
  const log = createStepLog({ t0: 0, clock: () => clock, print: () => {}, stepPauseMs: 800, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  await log.step('B1', async () => { clock += 100; });
  await assert.rejects(log.step('B2', async () => { throw new Error('hỏng'); }));
  assert.deepStrictEqual(sleeps, [800]);
  assert.strictEqual(log.steps[0].endMs, 100);
});
