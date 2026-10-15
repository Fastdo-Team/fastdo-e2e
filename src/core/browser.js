// [ENGINE V1 — PUPPETEER] Từ 2026-09-29 engine v2 (src/engine/, Playwright + Sheets API) không còn gọi file này. Giữ nguyên, không xoá (theo lệ repo).
// ============================================================================
// browser.js: Quản lý kết nối & khởi chạy Chrome tối ưu
// ============================================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const config = require('../config');
const { CURSOR_CSS_AND_JS } = require('./cursor_motion');

function getStandardChromePath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * In rõ đang chạy bằng tài khoản nào. Chạy nhầm slot là ghi kết quả của tài
 * khoản này vào vòng test của tài khoản kia — sai âm thầm, nên phải thấy được.
 */
function logSlot() {
  console.log(
    `[BROWSER] Slot ${config.ACCOUNT} · ${config.EMAIL || '(chưa có email)'}` +
      ` · CDP ${config.CDP_PORT} · profile ${path.basename(config.CHROME_PROFILE_DIR)}`
  );
}

/**
 * Khởi tạo hoặc kết nối tới Chrome
 */
async function initBrowser(options = {}) {
  let browser = null;
  let isConnected = false;

  // 1. Thử kết nối tới Chrome debug đang mở ở cổng của slot này
  //    (slot 1 = 9222, slot 2 = 9223... xem config.js)
  try {
    browser = await puppeteer.connect({
      browserURL: config.CDP_URL,
      defaultViewport: null,
      // Thấp hơn mặc định 180s: lệnh CDP treo thì phải chết nhanh để watchdog
      // cấp case còn kịp cứu batch. Đặt 300s từng biến 3 case treo thành 15 phút.
      protocolTimeout: 90000,
    });
    console.log('[BROWSER] Đã kết nối tới Chrome đang chạy tại', config.CDP_URL);
    logSlot();
    isConnected = true;
  } catch (err) {
    console.log(`[BROWSER] Không thấy Chrome debug ở cổng ${config.CDP_PORT}, đang tự động khởi chạy Chrome...`);
  }

  // 2. Nếu chưa có, tự động tìm và khởi chạy Chrome thật
  if (!browser) {
    const chromePath = getStandardChromePath();
    if (!chromePath) {
      throw new Error(
        `Không tìm thấy Google Chrome trên máy tính và không kết nối được cổng ${config.CDP_PORT}.\n` +
        `Vui lòng mở Chrome với flag: chrome.exe --remote-debugging-port=${config.CDP_PORT}`
      );
    }

    // Profile riêng theo slot: Chrome KHÔNG mở được 2 tiến trình trên cùng một
    // user-data-dir, nên dùng chung profile là slot thứ hai chết ngay lúc khởi chạy.
    const userDataDir = config.CHROME_PROFILE_DIR;
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      executablePath: chromePath,
      // BROWSER_HEADLESS=1: Chrome ẩn — agent AI-QC chạy dưới Windows Service (không có màn hình) đặt biến này cho probe.
      headless: process.env.BROWSER_HEADLESS === '1',
      defaultViewport: null,
      protocolTimeout: 90000,
      userDataDir,
      args: [
        `--remote-debugging-port=${config.CDP_PORT}`,
        '--window-size=1300,800',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    console.log('[BROWSER] Đã tự khởi chạy Google Chrome thành công');
    logSlot();
  }

  // Tạo page mới và cấu hình
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(CURSOR_CSS_AND_JS);
  await page.bringToFront();

  return {
    browser,
    page,
    isConnected,
    async close() {
      try {
        if (!page.isClosed()) await page.close();
      } catch (e) { }

      try {
        if (isConnected) {
          await browser.disconnect();
        } else {
          await browser.close();
        }
      } catch (e) { }
    }
  };
}

module.exports = { initBrowser };
