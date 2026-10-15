const test = require('node:test');
const assert = require('node:assert');
const T = require('./result_text');

test('formatDate / formatDateTime theo giờ máy', () => {
  const d = new Date(2026, 8, 5, 7, 3);
  assert.strictEqual(T.formatDate(d), '05/09/2026');
  assert.strictEqual(T.formatDateTime(d), '05/09/2026 07:03');
});

test('toSheetsDateSerial khớp ô Test Date thật (15/09/2026 = 46280)', () => {
  assert.strictEqual(T.toSheetsDateSerial(new Date(2026, 8, 15, 23, 59)), 46280);
  assert.strictEqual(T.toSheetsDateSerial(new Date(1899, 11, 31)), 1);
});

test('runTag lấy 8 ký tự chữ/số đầu của runId', () => {
  assert.strictEqual(T.runTag('A1B2C3D4-E5F6-7777'), '#a1b2c3d4');
  assert.throws(() => T.runTag('abc'), /quá ngắn/);
});

test('buildResultEntry: dòng đầu, bước ✓/✗, phép kiểm, kết luận, video', () => {
  const text = T.buildResultEntry({
    runId: 'a1b2c3d4-0000',
    startedAt: new Date(2026, 8, 25, 14, 32),
    round: 3,
    profile: 'default',
    steps: [
      { label: 'B1 Mở tab Mẫu đánh giá', ok: true },
      { label: 'B3 Bấm Kích hoạt', ok: false, error: 'hệ thống chặn:\n "Trọng số = 0"' },
    ],
    checks: [{ label: 'Banner chỉ xem', ok: false, expected: 'có', actual: 'không' }],
    pass: false,
    reviewCause: 'app',
    resultText: 'Kích hoạt bị chặn dù hợp lệ.',
    videoUrl: 'https://files.catbox.moe/x.mp4',
  });
  assert.strictEqual(
    text,
    [
      '[Tự động] 25/09/2026 14:32 · vòng 3 · hồ sơ default · #a1b2c3d4',
      '✓ B1 Mở tab Mẫu đánh giá',
      '✗ B3 Bấm Kích hoạt ← hệ thống chặn: "Trọng số = 0"',
      '• Banner chỉ xem: không (mong muốn: có) ✗',
      'Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — Kích hoạt bị chặn dù hợp lệ.',
      '- Video Test Record: https://files.catbox.moe/x.mp4',
    ].join('\n')
  );
});

test('kịch bản cũ chưa có bước: chỉ dòng đầu + kết luận + video', () => {
  const text = T.buildResultEntry({
    runId: 'ffffffff99',
    startedAt: new Date(2026, 0, 2, 9, 5),
    round: 1,
    pass: true,
    resultText: '',
    videoUrl: 'https://v',
  });
  assert.strictEqual(
    text,
    '[Tự động] 02/01/2026 09:05 · vòng 1 · hồ sơ default · #ffffffff\nKết luận: ĐẠT\n- Video Test Record: https://v'
  );
});

test('KHÔNG ĐẠT chưa duyệt thì không ghi "QC xác nhận"', () => {
  assert.strictEqual(T.verdictLabel(false), 'KHÔNG ĐẠT');
  assert.strictEqual(T.verdictLabel(true, 'app'), 'ĐẠT');
});
