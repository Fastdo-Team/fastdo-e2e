// ============================================================================
// page_guard.js: chặn thói quen Puppeteer trên page Playwright — lỗi ồn thay vì sai im lặng.
//
// Playwright ÂM THẦM BỎ tham số thứ 2 trở đi của page.evaluate(fn, a, b): hàm trong trang
// nhận b = undefined và kịch bản chạy tiếp với dữ liệu sai. waitForFunction đảo thứ tự
// (Puppeteer: fn, {timeout}, arg — Playwright: fn, arg, {timeout}); XPath là 'xpath=' chứ
// không phải 'xpath/'. Bọc các hàm đó để lần chạy nháp đầu tiên đã báo lỗi rõ ràng.
// ============================================================================

function contractError(msg) {
  const e = new Error(`[HỢP ĐỒNG KỊCH BẢN] ${msg}`);
  e.code = 'SCRIPT_CONTRACT';
  return e;
}

function checkSelector(method, selector) {
  if (typeof selector === 'string' && selector.startsWith('xpath/')) {
    throw contractError(`page.${method}("xpath/…") là cú pháp Puppeteer — Playwright dùng "xpath=…".`);
  }
}

const looksLikeOptions = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && ('polling' in v || 'timeout' in v);

function guardPage(page) {
  if (!page || page.__fastdoGuarded) return page;
  page.__fastdoGuarded = true;

  for (const m of ['evaluate', 'evaluateHandle']) {
    const orig = page[m].bind(page);
    page[m] = (fn, ...args) => {
      if (args.length > 1) {
        throw contractError(`page.${m} của Playwright chỉ nhận 1 tham số — gộp lại: page.${m}(([a, b]) => …, [a, b]).`);
      }
      return orig(fn, ...args);
    };
  }

  const wff = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, ...rest) => {
    if (rest.length >= 1 && looksLikeOptions(rest[0])) {
      throw contractError('page.waitForFunction(fn, {timeout}, arg) là thứ tự Puppeteer — Playwright là (fn, arg, {timeout}).');
    }
    return wff(fn, ...rest);
  };

  for (const m of ['$', '$$', 'waitForSelector']) {
    const orig = page[m].bind(page);
    page[m] = (selector, ...rest) => {
      checkSelector(m, selector);
      return orig(selector, ...rest);
    };
  }
  for (const m of ['$eval', '$$eval']) {
    const orig = page[m].bind(page);
    page[m] = (selector, fn, ...args) => {
      checkSelector(m, selector);
      if (args.length > 1) throw contractError(`page.${m} của Playwright chỉ nhận 1 tham số cho hàm.`);
      return orig(selector, fn, ...args);
    };
  }
  return page;
}

module.exports = { guardPage, contractError };
