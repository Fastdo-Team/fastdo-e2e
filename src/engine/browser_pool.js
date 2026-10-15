// ============================================================================
// browser_pool.js: một tiến trình Chrome (qua Playwright) dùng chung cho cả lượt chạy.
//
// channel "chrome" = Google Chrome đã cài trên máy, không tải trình duyệt riêng. Playwright
// tự bật --disable-background-timer-throttling, --disable-backgrounding-occluded-windows,
// --disable-renderer-backgrounding: cửa sổ chồng nhau vẫn chạy và quay đủ khung hình.
// Cờ --fastdo-eval-runner=<gốc repo> Chrome bỏ qua — chỉ để `npm run chrome:kill` nhận ra
// Chrome do repo này mở (lọc theo dòng lệnh).
// ============================================================================

const config = require('../config');

function defaultLaunch(options) {
  // Nạp muộn: test đơn vị không cần playwright-core.
  const { chromium } = require('playwright-core');
  return chromium.launch(options);
}

/** @param {number} [slowMo] ms Playwright chờ thêm sau mỗi thao tác — chỉ đặt khi quay video (video_pace) */
function createBrowserPool({ headless = false, launch = defaultLaunch, extraArgs = [], slowMo = 0 } = {}) {
  let current = null;

  async function start() {
    try {
      return await launch({
        channel: 'chrome',
        headless,
        ...(slowMo > 0 ? { slowMo } : {}),
        args: [`--fastdo-eval-runner=${config.ROOT_DIR}`, '--window-size=1320,900', ...extraArgs],
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/distribution 'chrome' is not found|Executable doesn't exist/i.test(msg)) {
        throw new Error('Không tìm thấy Google Chrome trên máy. Cài Chrome (bản thường) rồi chạy lại.');
      }
      throw err;
    }
  }

  /** Chrome đang sống; chết (crash / bị đóng) thì dựng lại */
  async function get() {
    if (current) {
      const b = await current.catch(() => null);
      if (b && b.isConnected()) return b;
    }
    current = start();
    return current;
  }

  async function close() {
    const p = current;
    current = null;
    const b = p ? await p.catch(() => null) : null;
    if (b) await b.close().catch(() => {});
  }

  return { get, close };
}

module.exports = { createBrowserPool };
