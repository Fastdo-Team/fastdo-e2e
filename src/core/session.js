// ============================================================================
// session.js: Quản lý Auth State, lưu & nạp cookie để bỏ qua bước Login
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { humanClick, humanType, waitXPath } = require('./cursor_motion');

/**
 * Kiểm tra xem session đã lưu trong file có tồn tại không
 */
function hasSavedSession() {
  return fs.existsSync(config.AUTH_STATE_PATH);
}

/**
 * Lưu cookies & localStorage vào file .auth/user_state.json
 */
async function saveSession(page) {
  if (!fs.existsSync(config.AUTH_DIR)) {
    fs.mkdirSync(config.AUTH_DIR, { recursive: true });
  }

  const cookies = await page.cookies();
  const localStorageData = await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  });

  const sessionData = {
    savedAt: new Date().toISOString(),
    cookies,
    localStorage: localStorageData,
  };

  fs.writeFileSync(config.AUTH_STATE_PATH, JSON.stringify(sessionData, null, 2), 'utf8');
  console.log('[AUTH] Đã lưu session đăng nhập vào', config.AUTH_STATE_PATH);
}

/**
 * Nạp cookies & localStorage từ file vào trình duyệt
 */
async function restoreSession(page) {
  if (!hasSavedSession()) return false;

  try {
    const raw = fs.readFileSync(config.AUTH_STATE_PATH, 'utf8');
    const session = JSON.parse(raw);

    if (session.cookies && session.cookies.length > 0) {
      await page.setCookie(...session.cookies);
    }

    // Mở trang gốc để nạp localStorage
    await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle dev tunnel nếu có.
    // Trang cảnh báo này do server render sẵn nên nếu có thì đã nằm trong DOM ngay
    // lúc domcontentloaded. Trước đây dùng waitForSelector timeout 3000 -> đốt
    // trọn 3 giây MỖI lần chạy trong trường hợp phổ biến là không có cảnh báo.
    try {
      const continueBtn = await page.$('#continue');
      if (continueBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          continueBtn.click(),
        ]);
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {}

    if (session.localStorage) {
      await page.evaluate((storage) => {
        for (const [key, value] of Object.entries(storage)) {
          localStorage.setItem(key, value);
        }
      }, session.localStorage);
    }

    console.log('[AUTH] Đã phục hồi session thành công');
    return true;
  } catch (err) {
    console.warn('[AUTH] Không thể nạp session cũ:', err.message);
    return false;
  }
}

/**
 * Đăng nhập đầy đủ từ đầu và chọn tổ chức
 */
async function performFullLogin(page) {
  console.log('[AUTH] Đang mở trang gốc:', config.TARGET_URL);
  await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 1. Vượt qua trang cảnh báo dev tunnel nếu có
  try {
    const continueBtn = await page.waitForSelector('#continue', { timeout: 4000 });
    if (continueBtn) {
      console.log('[AUTH] Thấy trang cảnh báo dev tunnel, đang bấm Continue...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        continueBtn.click(),
      ]);
      await new Promise((r) => setTimeout(r, 2500));
    }
  } catch (e) {}

  // 2. Chờ Blazor hết màn hình "Loading data"
  console.log('[AUTH] Đang đợi ứng dụng Fastdo sẵn sàng...');
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading data'),
      { timeout: 20000 }
    );
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 1500));

  const orgXPath = `.//a[contains(., "${config.ORG_NAME}")]`;
  const loginLinkXPath = './/a[contains(., "Đăng nhập") or contains(., "Log in")]';

  // 3. Nhận diện trạng thái trang (bọc try-catch chống navigation context destroyed)
  let state = null;
  for (let i = 0; i < 30 && !state; i++) {
    try {
      if (await page.$('xpath/' + orgXPath)) {
        state = 'org-selection';
      } else if (await page.$('input[type="email"], input[placeholder*="email" i]')) {
        state = 'login-form';
      } else if (await page.$('xpath/' + loginLinkXPath)) {
        state = 'landing';
      }
    } catch (err) {
      // Trang đang render hoặc chuyển hướng, bỏ qua và thử lại nhịp sau
    }
    if (!state) await new Promise((r) => setTimeout(r, 800));
  }

  console.log('[AUTH] Trạng thái phát hiện được:', state || 'chưa rõ');

  // 4. Nếu ở Landing page, bấm nút Đăng nhập
  if (state === 'landing') {
    const loginLink = await waitXPath(page, loginLinkXPath, 8000);
    if (loginLink) {
      console.log('[AUTH] Đang click liên kết Đăng nhập...');
      await humanClick(page, loginLink);
      await new Promise((r) => setTimeout(r, 1500));
      state = 'login-form';
    }
  }

  // 5. Điền form đăng nhập nếu đang ở form đăng nhập
  if (state === 'login-form') {
    console.log('[AUTH] Đang điền email và mật khẩu...');
    const emailSelector = 'input[type="email"], input[placeholder*="email" i], input[placeholder*="số điện thoại" i]';
    const passSelector = 'input[type="password"], input[placeholder*="mật khẩu" i], input[placeholder*="password" i]';

    await page.waitForSelector(emailSelector, { timeout: 15000 });
    const emailInput = await page.$(emailSelector);
    const passInput = await page.$(passSelector);

    await humanType(page, emailInput, config.EMAIL);
    await humanType(page, passInput, config.PASSWORD);

    let submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      submitBtn = await page.$('xpath/.//button[contains(., "Đăng nhập") or contains(., "Log in")]');
    }
    if (!submitBtn) throw new Error('Không tìm thấy nút bấm gửi form Đăng nhập');
    
    console.log('[AUTH] Đã gửi thông tin đăng nhập, đang chờ chuyển trang...');
    await humanClick(page, submitBtn);

    // Chờ màn hình chọn tổ chức
    await page.waitForSelector('xpath/' + orgXPath, { timeout: 25000 });
    state = 'org-selection';
  }

  // 6. Chọn tổ chức
  if (state === 'org-selection') {
    console.log('[AUTH] Đang chọn tổ chức:', config.ORG_NAME);
    const orgLink = await waitXPath(page, orgXPath, 10000);
    if (orgLink) {
      await humanClick(page, orgLink);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // 7. Lưu lại session sau khi đăng nhập thành công
  await saveSession(page);
  console.log('[AUTH] Quy trình đăng nhập hoàn tất thành công!');
}

/**
 * Đảm bảo trình duyệt đã đăng nhập (dùng session cũ nếu còn hạn, hoặc login mới)
 */
async function ensureAuthenticated(page) {
  const restored = await restoreSession(page);
  if (restored) {
    // Kiểm tra xem session còn hợp lệ không bằng cách kiểm tra URL hoặc nội dung
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('login') || (await page.$('xpath/.//a[contains(., "Đăng nhập") or contains(., "Log in")]'));
    if (!isLoginPage) {
      console.log('[AUTH] Session còn hiệu lực, bỏ qua đăng nhập!');
      return;
    }
    console.log('[AUTH] Session đã hết hạn, đăng nhập lại...');
  }

  await performFullLogin(page);
}

module.exports = {
  hasSavedSession,
  saveSession,
  restoreSession,
  performFullLogin,
  ensureAuthenticated,
};
