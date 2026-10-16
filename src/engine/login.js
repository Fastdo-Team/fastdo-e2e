// ============================================================================
// login.js: đăng nhập Fastdo + cảnh báo dev tunnel + chọn tổ chức trên page Playwright.
//
// Port từ core/session.js (Puppeteer, file cũ giữ nguyên): cùng các bước, nhận HỒ SƠ tài
// khoản làm tham số thay vì biến toàn cục của slot. Mật khẩu chỉ đi vào ô nhập, không log.
// Thêm so với bản cũ: tunnel tắt / app treo "Loading data" báo lỗi nói rõ nguyên nhân thay
// vì để case chạy tiếp rồi hết giờ ở một selector vô can.
// ============================================================================

const config = require('../config');
const { humanClick, humanType, waitXPath } = require('../core/cursor_motion');
const { dismissOrgPickerIfPresent } = require('../core/page_ready');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN_LINK_XP = './/a[contains(., "Đăng nhập") or contains(., "Log in")]';
const orgXPath = (org) => `.//a[contains(., "${org}")]`;
const short = (msg) => String(msg || '').split('\n')[0].slice(0, 160);

/** Mở URL của app; tunnel tắt / trả 5xx → lỗi nói rõ nguyên nhân */
async function gotoApp(page, url = config.TARGET_URL) {
  let res;
  try {
    res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    throw new Error(`Không mở được ${url} (${short(err.message)}) — dev tunnel đang tắt hoặc đã đổi URL?`);
  }
  if (res && res.status() >= 500) {
    throw new Error(`Không mở được ${url} (HTTP ${res.status()}) — app / dev tunnel đang lỗi hoặc chưa chạy.`);
  }
  return res;
}

/** Trang cảnh báo dev tunnel do server render sẵn — có thì bấm Continue */
async function passTunnelWarning(page) {
  try {
    const btn = await page.$('#continue');
    if (!btn) return false;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      btn.click(),
    ]);
    await sleep(2000);
    return true;
  } catch {
    return false;
  }
}

/** Chờ Blazor qua màn "Loading data". false = app không render trong hạn. */
async function waitAppRendered(page, timeout = 20000) {
  return page
    .waitForFunction(
      () => document.body && !document.body.innerText.includes('Loading data') && document.body.innerText.trim().length > 20,
      null,
      { timeout }
    )
    .then(() => true)
    .catch(() => false);
}

async function detectState(page, org) {
  for (let i = 0; i < 30; i += 1) {
    try {
      if (await page.$('#continue')) return 'tunnel-warning';
      if (await page.$('xpath=' + orgXPath(org))) return 'org-selection';
      if (await page.$('input[type="email"], input[placeholder*="email" i]')) return 'login-form';
      if (await page.$('xpath=' + LOGIN_LINK_XP)) return 'landing';
    } catch {
      /* đang chuyển trang — thử lại nhịp sau */
    }
    await sleep(800);
  }
  return null;
}

/**
 * Sau khi bấm Đăng nhập: 'org' = màn chọn tổ chức có đúng tổ chức của hồ sơ; 'app' = đã vào thẳng app (tài khoản chỉ thuộc
 * 1 tổ chức); null = hết hạn chờ (sai email / mật khẩu…). Dò theo nhịp thay vì đua 2 lệnh chờ — không để lại promise bị bỏ rơi.
 */
async function waitAfterLogin(page, org, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await page.$('xpath=' + orgXPath(org))) return 'org';
      const inApp = await page.evaluate(
        () =>
          !location.pathname.toLowerCase().includes('login') &&
          !document.querySelector('input[type="password"]') &&
          !document.body.innerText.includes('Loading data') &&
          document.body.innerText.trim().length > 200
      );
      // màn chọn tổ chức render dần — chờ thêm 1 nhịp rồi kiểm lại trước khi kết luận đã vào thẳng app
      if (inApp) {
        await sleep(1200);
        return (await page.$('xpath=' + orgXPath(org))) ? 'org' : 'app';
      }
    } catch {
      /* đang chuyển trang — thử lại nhịp sau */
    }
    await sleep(500);
  }
  return null;
}

async function performFullLogin(page, profile) {
  await gotoApp(page);
  await passTunnelWarning(page);
  await waitAppRendered(page);
  await sleep(1500);

  let state = await detectState(page, profile.org);
  if (state === 'tunnel-warning') {
    await passTunnelWarning(page);
    await waitAppRendered(page);
    state = await detectState(page, profile.org);
  }
  console.log(`[AUTH] ${profile.name}: trang đăng nhập đang ở trạng thái ${state || 'chưa rõ'}`);
  if (!state || state === 'tunnel-warning') {
    throw new Error(`Không nhận ra trang đăng nhập tại ${config.TARGET_URL} — app chưa chạy hoặc tunnel đổi URL?`);
  }

  if (state === 'landing') {
    const link = await waitXPath(page, LOGIN_LINK_XP, 8000);
    if (link) {
      await humanClick(page, link);
      await sleep(1500);
      state = 'login-form';
    }
  }
  if (state === 'login-form') {
    const emailSel = 'input[type="email"], input[placeholder*="email" i], input[placeholder*="số điện thoại" i]';
    const passSel = 'input[type="password"], input[placeholder*="mật khẩu" i], input[placeholder*="password" i]';
    await page.waitForSelector(emailSel, { timeout: 15000, state: 'attached' });
    await humanType(page, await page.$(emailSel), profile.email);
    await humanType(page, await page.$(passSel), profile.password);
    let submit = await page.$('button[type="submit"]');
    if (!submit) submit = await page.$('xpath=.//button[contains(., "Đăng nhập") or contains(., "Log in")]');
    if (!submit) throw new Error('Không tìm thấy nút gửi form Đăng nhập');
    console.log(`[AUTH] ${profile.name}: đã gửi thông tin đăng nhập, chờ màn chọn tổ chức…`);
    await humanClick(page, submit);
    const after = await waitAfterLogin(page, profile.org);
    if (!after) {
      throw new Error(`Đăng nhập xong không thấy tổ chức "${profile.org}" — sai email/mật khẩu, hoặc sai ORG của hồ sơ ${profile.name}?`);
    }
    if (after === 'app') {
      // Tài khoản chỉ thuộc 1 công ty (vd tài khoản tạm ctx.db.createAccount) → Fastdo vào thẳng app, không qua màn chọn
      console.log(`[AUTH] ${profile.name}: vào thẳng app (chỉ thuộc 1 tổ chức)`);
      return;
    }
    state = 'org-selection';
  }
  if (state === 'org-selection') {
    const link = await waitXPath(page, orgXPath(profile.org), 10000);
    if (!link) throw new Error(`Không thấy tổ chức "${profile.org}" — kiểm ORG của hồ sơ ${profile.name}`);
    console.log(`[AUTH] ${profile.name}: chọn tổ chức ${profile.org}`);
    await humanClick(page, link);
    await sleep(3000);
  }
}

/** Còn đăng nhập không (đang ở form đăng nhập / trang landing = không) */
async function isLoggedIn(page) {
  if (!(await waitAppRendered(page))) {
    throw new Error(`App tại ${config.TARGET_URL} không render sau 20s (vẫn "Loading data" hoặc trang trắng).`);
  }
  await sleep(1500);
  if (page.url().includes('login')) return false;
  const form = await page.$('input[type="password"]').catch(() => null);
  const landing = await page.$('xpath=' + LOGIN_LINK_XP).catch(() => null);
  return !form && !landing;
}

/** Bảo đảm không còn đứng ở màn chọn tổ chức (lựa chọn tổ chức là theo TỪNG TAB phía server) */
async function ensureOrgSelected(page, org) {
  for (let i = 0; i < 6; i += 1) {
    const still = await page.$('xpath=' + orgXPath(org)).catch(() => null);
    if (!still) return;
    const dismissed = await dismissOrgPickerIfPresent(page);
    if (!dismissed) return;
    await sleep(600);
  }
}

module.exports = { gotoApp, passTunnelWarning, waitAppRendered, detectState, performFullLogin, isLoggedIn, ensureOrgSelected };
