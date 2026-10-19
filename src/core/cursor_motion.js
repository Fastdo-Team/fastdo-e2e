// ============================================================================
// cursor_motion.js: Điều khiển con trỏ ảo trực quan trên video + thao tác mượt
// ============================================================================

const CURSOR_CSS_AND_JS = `
function initFakeCursorOverlay() {
  if (window.__fakeCursorInit) return;
  window.__fakeCursorInit = true;

  const style = document.createElement('style');
  style.textContent = \`
    #__fake_cursor {
      position: fixed; width: 22px; height: 22px; border-radius: 50%;
      background: rgba(255, 45, 85, 0.55); border: 2.5px solid #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.6);
      pointer-events: none; z-index: 2147483647;
      transform: translate(-50%, -50%);
      transition: left 0.02s linear, top 0.02s linear;
      left: -100px; top: -100px;
    }
    #__fake_cursor.__click { animation: __cursor_pulse 0.35s ease-out; }
    @keyframes __cursor_pulse {
      0% { box-shadow: 0 0 0 0 rgba(255,45,85,0.8); }
      100% { box-shadow: 0 0 0 28px rgba(255,45,85,0); }
    }
  \`;
  document.documentElement.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = '__fake_cursor';
  document.documentElement.appendChild(cursor);

  document.addEventListener(
    'mousemove',
    (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    },
    true
  );
  document.addEventListener(
    'mousedown',
    () => {
      cursor.classList.remove('__click');
      void cursor.offsetWidth;
      cursor.classList.add('__click');
    },
    true
  );
}

// Con trỏ ảo lướt từ (fx, fy) tới (tx, ty) trong ms (nhanh dần rồi chậm dần) — chỉ con trỏ vẽ, không đụng chuột thật.
// Dùng khi quay video (engine/action_trace.js) để người xem thấy con trỏ đi tới chỗ sắp thao tác.
window.__fastdoGlide = function (fx, fy, tx, ty, ms) {
  return new Promise(function (resolve) {
    var cursor = document.getElementById('__fake_cursor');
    if (!cursor) return resolve();
    var place = function (x, y) { cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; };
    var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
    var start = performance.now();
    var finished = false;
    var finish = function () { if (finished) return; finished = true; place(tx, ty); resolve(); };
    // trang không vẽ khung (rAF bị dừng) vẫn kết thúc đúng hạn
    setTimeout(finish, ms + 150);
    place(fx, fy);
    var frame = function (now) {
      if (finished) return;
      var t = Math.min(1, (now - start) / ms);
      var k = ease(t);
      place(fx + (tx - fx) * k, fy + (ty - fy) * k);
      if (t < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFakeCursorOverlay);
} else {
  initFakeCursorOverlay();
}
`;

/**
 * Di chuyển con trỏ mượt mà tới toạ độ đích (8-10 steps, ~80-100ms)
 * Đủ mượt để video 30fps bắt trọn chuyển động, nhưng không làm chậm test.
 * Vị trí chuột lưu THEO TỪNG PAGE: chạy song song nhiều page thì mỗi page có con trỏ
 * riêng, không nhảy theo vị trí của page khác.
 */
async function smoothMove(page, targetX, targetY, steps = 8) {
  const { x: sx, y: sy } = page.__fastdoMouse || { x: 100, y: 100 };
  // chuột thật đã ở đích (action_trace vừa lướt con trỏ tới) — không lặp 8 nhịp tại chỗ
  if (Math.abs(targetX - sx) < 1 && Math.abs(targetY - sy) < 1) return;
  for (let i = 1; i <= steps; i++) {
    const ix = sx + (targetX - sx) * (i / steps);
    const iy = sy + (targetY - sy) * (i / steps);
    await page.mouse.move(ix, iy);
    await new Promise((r) => setTimeout(r, 10));
  }
  page.__fastdoMouse = { x: targetX, y: targetY };
  page.__fastdoCursor = page.__fastdoMouse;
}

/**
 * Click chuột có con trỏ ảo di chuyển tới và hiệu ứng sóng tỏa ra.
 * Trang đang quay video (page.__fastdoTrace — engine/action_trace.js): ghi dòng chú thích «Bấm …», con trỏ lướt chậm tới trước.
 */
async function humanClick(page, elementOrSelector, opts = {}) {
  let element = elementOrSelector;
  if (typeof elementOrSelector === 'string') {
    if (elementOrSelector.startsWith('//') || elementOrSelector.startsWith('.//')) {
      element = await waitXPath(page, elementOrSelector, opts.timeout || 10000);
    } else {
      // 'attached' = đúng nghĩa waitForSelector của Puppeteer cũ (Playwright mặc định chờ 'visible')
      await page.waitForSelector(elementOrSelector, { timeout: opts.timeout || 10000, state: 'attached' });
      element = await page.$(elementOrSelector);
    }
  }

  if (!element) {
    throw new Error(`Không tìm thấy phần tử để click: ${elementOrSelector}`);
  }

  if (page.__fastdoTrace) return page.__fastdoTrace.run('click', element, {}, () => clickElement(page, element, opts));
  return clickElement(page, element, opts);
}

async function clickElement(page, element, opts) {
  await element.scrollIntoViewIfNeeded();
  await new Promise((r) => setTimeout(r, 80));

  const box = await element.boundingBox();
  if (!box) {
    throw new Error('Không lấy được boundingBox để click (element có thể đang ẩn)');
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await smoothMove(page, x, y, opts.steps || 8);
  await new Promise((r) => setTimeout(r, opts.pauseBefore ?? 80));

  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 60));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, opts.pauseAfter ?? 120));
}

/**
 * Nhập văn bản nhanh nhưng tự nhiên (delay 15ms/ký tự)
 */
async function humanType(page, elementOrSelector, text, opts = {}) {
  const typeInto = async () => {
    await humanClick(page, elementOrSelector, { pauseAfter: 80 });
    await page.keyboard.type(text, { delay: opts.delay ?? 15 });
    await new Promise((r) => setTimeout(r, 80));
  };
  // đang quay video: 1 dòng «Gõ … vào …» cho cả bấm + gõ (thao tác lồng bên trong không ghi thêm)
  if (page.__fastdoTrace) return page.__fastdoTrace.run('type', elementOrSelector, { value: text, pointer: true }, typeInto);
  return typeInto();
}

/**
 * Chờ phần tử XPath xuất hiện với polling tối ưu. Nhận XPath trần (".//a[…]") hoặc có
 * tiền tố "xpath=" / "xpath/" (cú pháp cũ) — luôn gọi Playwright bằng "xpath=".
 */
async function waitXPath(page, xpath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const cleanXpath = String(xpath).replace(/^xpath[=/]/, '');

  while (Date.now() < deadline) {
    const [el] = await page.$$('xpath=' + cleanXpath);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/**
 * Click cho đến khi điều kiện checkFn trả về true (tối đa maxAttempts lần)
 * Hữu ích cho các nút trong Blazor cần trigger nhiều lần (như nút Sửa, Chuyển tab)
 */
async function clickUntil(page, getElement, checkFn, opts = {}) {
  const { maxAttempts = 3, checkTimeoutMs = 4000, label = '' } = opts;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const el = typeof getElement === 'function' ? await getElement() : getElement;
    if (!el) throw new Error(`Không tìm thấy phần tử để click: ${label}`);
    
    await humanClick(page, el);
    console.log(`[ACTION] Đã click ${label} (lần thử ${attempt})`);
    
    const deadline = Date.now() + checkTimeoutMs;
    while (Date.now() < deadline) {
      if (await checkFn()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`[WAIT] Chưa thấy kết quả mong đợi sau khi click ${label}, thử lại...`);
  }
  throw new Error(`Click ${label} không tạo ra kết quả mong đợi sau ${maxAttempts} lần thử`);
}

module.exports = {
  CURSOR_CSS_AND_JS,
  smoothMove,
  humanClick,
  humanType,
  waitXPath,
  clickUntil,
};
