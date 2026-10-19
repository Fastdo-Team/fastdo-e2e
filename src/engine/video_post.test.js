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

test('toAss có khung 1280×816 (dải 96px dưới hình) và thoát ký tự điều khiển của ASS', () => {
  const ass = V.toAss([{ startMs: 0, endMs: 1000, text: 'a {b} \\c' }]);
  assert.match(ass, /PlayResX: 1280/);
  assert.match(ass, /PlayResY: 816/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Buoc,,0,0,0,,a \(b\) \/c/);
});

test('phụ đề thao tác: hiện tới thao tác kế tiếp, tắt khi sang bước mới; thao tác lỗi có ✗; trừ phần khởi động', () => {
  const actions = [
    { ms: 3200, text: 'Bấm «Mở tab»', ok: true },
    { ms: 4000, text: 'Chọn «Ngày nghỉ» ở «Chọn thời điểm»', ok: true },
    { ms: 6000, text: 'Bấm «Kích hoạt»', ok: false },
    { ms: 1000, text: 'trong phần khởi động — vẫn giữ, mốc âm thành 0', ok: true },
    { ms: 7000, text: '', ok: true },
  ];
  const cues = V.buildActionCaptions({ actions, steps, trimMs: 2000, durationMs: 12000 });
  assert.deepStrictEqual(cues, [
    { startMs: 0, endMs: 1000, text: 'trong phần khởi động — vẫn giữ, mốc âm thành 0' },
    { startMs: 1200, endMs: 2000, text: 'Bấm «Mở tab»' },
    { startMs: 2000, endMs: 3000, text: 'Chọn «Ngày nghỉ» ở «Chọn thời điểm»' },
    { startMs: 4000, endMs: 10000, text: 'Bấm «Kích hoạt» ✗' },
  ]);
});

test('toAss: bước dùng style Buoc, thao tác dùng style ThaoTac (dòng dưới)', () => {
  const ass = V.toAss([{ startMs: 0, endMs: 2000, text: 'C1 · B1' }], [{ startMs: 500, endMs: 1500, text: 'Bấm «Lưu»' }]);
  assert.match(ass, /Style: ThaoTac,Arial,28/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.00,Buoc,,0,0,0,,C1 · B1/);
  assert.match(ass, /Dialogue: 0,0:00:00\.50,0:00:01\.50,ThaoTac,,0,0,0,,Bấm «Lưu»/);
});

test('độ dài webm đọc từ mốc time= cuối của ffmpeg; độ trễ bắt đầu quay = closeMs − độ dài, kẹp trong [0, trimMs]', () => {
  assert.strictEqual(V.parseFfmpegTime('frame= 10 time=00:00:01.00 x\rframe= 463 time=00:00:18.52 bitrate=N/A'), 18520);
  assert.strictEqual(V.parseFfmpegTime('không có'), null);
  assert.strictEqual(V.videoStartDelayMs({ closeMs: 19100, durationMs: 18520, trimMs: 2000 }), 580);
  assert.strictEqual(V.videoStartDelayMs({ closeMs: 19100, durationMs: 15000, trimMs: 2000 }), 2000);
  assert.strictEqual(V.videoStartDelayMs({ closeMs: 18000, durationMs: 18520, trimMs: 2000 }), 0);
  assert.strictEqual(V.videoStartDelayMs({ closeMs: null, durationMs: 18520, trimMs: 2000 }), 0);
  assert.strictEqual(V.videoStartDelayMs({ closeMs: 19100, durationMs: null, trimMs: 2000 }), 0);
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
