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
      background: rgba(255, 45, 85, 0.95); border: 2.5px solid #ffffff;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFakeCursorOverlay);
} else {
  initFakeCursorOverlay();
}
`;

let lastMouse = { x: 100, y: 100 };

/**
 * Di chuyển con trỏ mượt mà tới toạ độ đích (8-10 steps, ~80-100ms)
 * Đủ mượt để video 30fps bắt trọn chuyển động, nhưng không làm chậm test.
 */
async function smoothMove(page, targetX, targetY, steps = 8) {
  const { x: sx, y: sy } = lastMouse;
  for (let i = 1; i <= steps; i++) {
    const ix = sx + (targetX - sx) * (i / steps);
    const iy = sy + (targetY - sy) * (i / steps);
    await page.mouse.move(ix, iy);
    await new Promise((r) => setTimeout(r, 10));
  }
  lastMouse = { x: targetX, y: targetY };
}

/**
 * Click chuột có con trỏ ảo di chuyển tới và hiệu ứng sóng tỏa ra
 */
async function humanClick(page, elementOrSelector, opts = {}) {
  let element = elementOrSelector;
  if (typeof elementOrSelector === 'string') {
    if (elementOrSelector.startsWith('//') || elementOrSelector.startsWith('.//')) {
      element = await waitXPath(page, elementOrSelector, opts.timeout || 10000);
    } else {
      await page.waitForSelector(elementOrSelector, { timeout: opts.timeout || 10000 });
      element = await page.$(elementOrSelector);
    }
  }

  if (!element) {
    throw new Error(`Không tìm thấy phần tử để click: ${elementOrSelector}`);
  }

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
  await humanClick(page, elementOrSelector, { pauseAfter: 80 });
  await page.keyboard.type(text, { delay: opts.delay ?? 15 });
  await new Promise((r) => setTimeout(r, 80));
}

/**
 * Chờ phần tử XPath xuất hiện với polling tối ưu
 */
async function waitXPath(page, xpath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const cleanXpath = xpath.startsWith('xpath/') ? xpath.replace('xpath/', '') : xpath;

  while (Date.now() < deadline) {
    const [el] = await page.$$('xpath/' + cleanXpath);
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
