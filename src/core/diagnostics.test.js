const test = require('node:test');
const assert = require('node:assert');
const { classifyFailure } = require('./diagnostics');

test('HỢP ĐỒNG KỊCH BẢN xếp trước mọi hạng khác', () => {
  assert.strictEqual(
    classifyFailure({ errorMessage: '[HỢP ĐỒNG KỊCH BẢN] pass phải là boolean — Timeout 5ms exceeded', verdict: 'CRASH' }).kind,
    'HỢP ĐỒNG KỊCH BẢN'
  );
});

test('ĐĂNG NHẬP HỒ SƠ THẤT BẠI', () => {
  assert.strictEqual(
    classifyFailure({ errorMessage: 'ĐĂNG NHẬP HỒ SƠ nhanvien THẤT BẠI: timeout', verdict: 'CRASH' }).kind,
    'ĐĂNG NHẬP HỒ SƠ THẤT BẠI'
  );
});

test('PHIÊN BỊ APP CHẶN nhận từ chữ trên trang, trước cả LỚP PHỦ', () => {
  const bodyText = 'Tài khoản của bạn vừa được đăng nhập ở một nơi khác, mã xác thực hiện tại là 1234';
  const domText = Array.from({ length: 6 }, (_, i) => `0${i} button ⚠ BỊ CHE bởi div.modal`).join('\n');
  assert.strictEqual(classifyFailure({ errorMessage: 'Waiting failed', verdict: 'CRASH', bodyText, domText }).kind, 'PHIÊN BỊ APP CHẶN');
});

test('lỗi kiểu Playwright được phân loại đúng', () => {
  assert.strictEqual(
    classifyFailure({ errorMessage: 'page.evaluate: Target page, context or browser has been closed', verdict: 'CRASH' }).kind,
    'HẠ TẦNG CDP'
  );
  assert.strictEqual(
    classifyFailure({ errorMessage: 'page.waitForFunction: Timeout 25000ms exceeded.', verdict: 'CRASH' }).kind,
    'HẾT HẠN CHỜ'
  );
});

test('hạng cũ không đổi', () => {
  assert.strictEqual(classifyFailure({ errorMessage: 'Watchdog: case vượt quá 150s', verdict: 'CRASH' }).kind, 'HẾT HẠN CHỜ');
  assert.strictEqual(classifyFailure({ errorMessage: '', verdict: 'FAIL' }).kind, 'KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT');
});

test('mọi bước qua + kịch bản trả pass:false trong modal → KẾT QUẢ NGHIỆP VỤ, không phải lớp phủ (P0 ticket 1295)', () => {
  // Popup chi tiết che trang nền: digest đánh dấu gần hết phần tử "⚠ BỊ CHE" dù thao tác trong popup vẫn chạy đúng.
  const domText = Array.from({ length: 10 }, (_, i) => `${String(i).padStart(2, '0')} button "x" ⚠ BỊ CHE`).join('\n');
  assert.strictEqual(classifyFailure({ errorMessage: '', verdict: 'FAIL', domText }).kind, 'KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT');
  // Bước bị lỗi (có thông điệp) mà trang bị che → vẫn là lớp phủ
  assert.strictEqual(
    classifyFailure({ errorMessage: 'locator.click: Timeout 5000ms exceeded', verdict: 'CRASH', domText }).kind,
    'LỚP PHỦ CHẶN CLICK'
  );
});
