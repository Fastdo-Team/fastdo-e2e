const test = require('node:test');
const assert = require('node:assert');
const V = require('./video_post');

const steps = [
  { label: 'B1 Mở tab', startMs: 3000, endMs: 5000, ok: true },
  { label: 'B2 Bấm Kích hoạt', startMs: 5000, endMs: 9000, ok: false },
];

test('phụ đề trừ phần khởi động bị cắt đầu video; có đoạn "chuẩn bị" trước bước 1', () => {
  const cues = V.buildCaptions({ caseId: 'EVAL_021', steps, trimMs: 2000, durationMs: 12000 });
  assert.deepStrictEqual(cues, [
    { startMs: 0, endMs: 1000, text: 'EVAL_021 · chuẩn bị' },
    { startMs: 1000, endMs: 3000, text: 'EVAL_021 · B1 Mở tab · 00:01' },
    { startMs: 3000, endMs: 10000, text: 'EVAL_021 · B2 Bấm Kích hoạt · 00:03 ✗' },
  ]);
});

test('không có bước (kịch bản cũ) → 1 phụ đề mã case suốt video', () => {
  assert.deepStrictEqual(V.buildCaptions({ caseId: 'EVAL_017', steps: [], trimMs: 0, durationMs: 5000 }), [
    { startMs: 0, endMs: 5000, text: 'EVAL_017' },
  ]);
});

test('định dạng thời gian ASS / VTT / mm:ss', () => {
  assert.strictEqual(V.assTime(3723450), '1:02:03.45');
  assert.strictEqual(V.vttTime(3723450), '01:02:03.450');
  assert.strictEqual(V.mmss(83000), '01:23');
});

test('toAss có khung 1280×780 (dải 60px dưới hình) và thoát ký tự điều khiển của ASS', () => {
  const ass = V.toAss([{ startMs: 0, endMs: 1000, text: 'a {b} \\c' }]);
  assert.match(ass, /PlayResX: 1280/);
  assert.match(ass, /PlayResY: 780/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Buoc,,0,0,0,,a \(b\) \/c/);
});

test('toVtt đúng chuẩn WebVTT', () => {
  const vtt = V.toVtt([{ startMs: 0, endMs: 1500, text: 'x' }]);
  assert.strictEqual(vtt, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nx\n');
});

test('bộ giới hạn chạy tối đa N việc cùng lúc', async () => {
  const limit = V.createLimiter(2);
  let active = 0;
  let peak = 0;
  const job = () =>
    limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
    });
  await Promise.all([job(), job(), job(), job(), job()]);
  assert.strictEqual(peak, 2);
});
