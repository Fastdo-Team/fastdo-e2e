// ============================================================================
// app_session.js: phiên đăng nhập theo hồ sơ + mở trang app.
//
// Mỗi hồ sơ đăng nhập 1 lần / lượt chạy: nạp file phiên → vào app kiểm còn đăng nhập →
// không thì đăng nhập đầy đủ → lưu phiên. Hai luồng cùng hồ sơ dùng chung MỘT Promise nên
// không bao giờ cùng đăng nhập một lúc.
// ============================================================================

const fs = require('fs');
const config = require('../config');
const { storagePathOf } = require('./profiles');
const { gotoApp, passTunnelWarning, waitAppRendered, performFullLogin, isLoggedIn, ensureOrgSelected } = require('./login');
const { CURSOR_CSS_AND_JS } = require('../core/cursor_motion');
const { guardPage } = require('./page_guard');

const VIEWPORT = { width: 1280, height: 720 };
const sessions = new Map();

async function establish(browser, profile, force) {
  const storagePath = storagePathOf(profile);
  fs.mkdirSync(config.AUTH_DIR, { recursive: true });
  let useSaved = !force && fs.existsSync(storagePath);
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const context = await browser.newContext({ viewport: VIEWPORT, storageState: useSaved ? storagePath : undefined });
    try {
      const page = guardPage(await context.newPage());
      page.__fastdoOrg = profile.org;
      await gotoApp(page);
      await passTunnelWarning(page);
      if (useSaved && (await isLoggedIn(page))) {
        await ensureOrgSelected(page, profile.org);
        console.log(`[AUTH] ${profile.name}: dùng lại phiên đã lưu`);
      } else {
        console.log(`[AUTH] ${profile.name}: đăng nhập đầy đủ bằng ${profile.email}`);
        await performFullLogin(page, profile);
      }
      await context.storageState({ path: storagePath });
      return storagePath;
    } catch (err) {
      lastError = err;
      useSaved = false; // lần 2 đăng nhập lại từ đầu
    } finally {
      await context.close().catch(() => {});
    }
  }
  const e = new Error(`ĐĂNG NHẬP HỒ SƠ ${profile.name} THẤT BẠI: ${lastError && lastError.message ? lastError.message : lastError}`);
  e.code = 'LOGIN_FAILED';
  throw e;
}

/** Đường dẫn file phiên hợp lệ của hồ sơ (đăng nhập nếu cần). force = đăng nhập lại từ đầu. */
function ensureProfileSession(browser, profile, { force = false } = {}) {
  if (!force && sessions.has(profile.name)) return sessions.get(profile.name);
  const p = establish(browser, profile, force);
  sessions.set(profile.name, p);
  p.catch(() => sessions.delete(profile.name));
  return p;
}

function resetSessions() {
  sessions.clear();
}

/**
 * Vào app trên 1 page đã có phiên: qua cảnh báo tunnel, chờ app render, chọn đúng tổ chức.
 * Phiên hết hạn giữa lượt → lỗi code SESSION_EXPIRED (không để kịch bản chạy trên trang đăng nhập).
 */
async function warmUp(page, profile) {
  await gotoApp(page);
  await passTunnelWarning(page);
  if (!(await waitAppRendered(page))) {
    throw new Error(`App tại ${config.TARGET_URL} không render sau 20s (vẫn "Loading data" hoặc trang trắng).`);
  }
  if (!(await isLoggedIn(page))) {
    const e = new Error(`Phiên đăng nhập của hồ sơ ${profile.name} đã hết hạn giữa lượt — chạy lại case (phiên sẽ được đăng nhập lại).`);
    e.code = 'SESSION_EXPIRED';
    throw e;
  }
  await ensureOrgSelected(page, profile.org);
}

/** Cho tool (plan/preflight/probe): context không quay video, đã vào app, đúng tổ chức */
async function openAppPage(browser, profile, { cursor = true } = {}) {
  const storageState = await ensureProfileSession(browser, profile);
  const context = await browser.newContext({ viewport: VIEWPORT, storageState });
  if (cursor) await context.addInitScript({ content: CURSOR_CSS_AND_JS });
  const page = guardPage(await context.newPage());
  page.__fastdoOrg = profile.org;
  await warmUp(page, profile);
  return { context, page, close: () => context.close().catch(() => {}) };
}

module.exports = { ensureProfileSession, resetSessions, warmUp, openAppPage, VIEWPORT };
