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
 * Khởi tạo hoặc kết nối tới Chrome
 */
async function initBrowser(options = {}) {
  let browser = null;
  let isConnected = false;

  // 1. Thử kết nối tới Chrome debug port 9222 đang mở
  try {
    browser = await puppeteer.connect({
      browserURL: config.CDP_URL,
      defaultViewport: null,
      // Thấp hơn mặc định 180s: lệnh CDP treo thì phải chết nhanh để watchdog
      // cấp case còn kịp cứu batch. Đặt 300s từng biến 3 case treo thành 15 phút.
      protocolTimeout: 90000,
    });
    console.log('[BROWSER] Đã kết nối tới Chrome đang chạy tại', config.CDP_URL);
    isConnected = true;
  } catch (err) {
    console.log('[BROWSER] Không thấy Chrome debug port 9222, đang tự động khởi chạy Chrome...');
  }

  // 2. Nếu chưa có, tự động tìm và khởi chạy Chrome thật
  if (!browser) {
    const chromePath = getStandardChromePath();
    if (!chromePath) {
      throw new Error(
        'Không tìm thấy Google Chrome trên máy tính và không kết nối được port 9222.\n' +
        'Vui lòng mở Chrome với flag: chrome.exe --remote-debugging-port=9222'
      );
    }

    const userDataDir = path.join(config.ROOT_DIR, '.chrome_profile');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: null,
      protocolTimeout: 90000,
      userDataDir,
      args: [
        '--remote-debugging-port=9222',
        '--window-size=1300,800',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    console.log('[BROWSER] Đã tự khởi chạy Google Chrome thành công');
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
