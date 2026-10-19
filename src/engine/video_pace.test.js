const test = require('node:test');
const assert = require('node:assert');
const { videoPace, paceFor, MAX_MS } = require('./video_pace');
const { createStepLog } = require('./steps');

const NONE = { slowMoMs: 0, stepPauseMs: 0, endHoldMs: 0, cursorMs: 0, actionPauseMs: 0 };

test('nhịp video: đọc 5 biến, sai / âm → 0, chặn trên MAX_MS', () => {
  assert.deepStrictEqual(
    videoPace({
      VIDEO_SLOWMO_MS: '500',
      VIDEO_STEP_PAUSE_MS: '1200',
      VIDEO_END_HOLD_MS: '99999',
      VIDEO_CURSOR_MS: '600',
      VIDEO_ACTION_PAUSE_MS: '400',
    }),
    { slowMoMs: 500, stepPauseMs: 1200, endHoldMs: MAX_MS, cursorMs: 600, actionPauseMs: 400 }
  );
  assert.deepStrictEqual(videoPace({ VIDEO_SLOWMO_MS: 'abc', VIDEO_STEP_PAUSE_MS: '-5', VIDEO_CURSOR_MS: '' }), NONE);
});

test('không quay video → không làm chậm, kể cả khi có biến', () => {
  assert.deepStrictEqual(paceFor(false, { VIDEO_SLOWMO_MS: '500', VIDEO_CURSOR_MS: '600' }), NONE);
  assert.strictEqual(paceFor(true, { VIDEO_SLOWMO_MS: '500' }).slowMoMs, 500);
  assert.strictEqual(paceFor(true, { VIDEO_CURSOR_MS: '600' }).cursorMs, 600);
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
