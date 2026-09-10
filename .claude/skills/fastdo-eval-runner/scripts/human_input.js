// Helper mô phỏng thao tác người dùng thật: di chuyển chuột mượt tới toạ độ
// (để cursor_overlay.js chạy theo), dừng lại, rồi mới click/gõ phím.
let lastMouse = { x: 0, y: 0 };

async function moveMouseTo(page, x, y, steps = 22) {
  const { x: sx, y: sy } = lastMouse;
  for (let i = 1; i <= steps; i++) {
    const ix = sx + (x - sx) * (i / steps);
    const iy = sy + (y - sy) * (i / steps);
    await page.mouse.move(ix, iy);
    await new Promise((r) => setTimeout(r, 10));
  }
  lastMouse = { x, y };
}

async function humanClick(page, elementHandle, opts = {}) {
  await elementHandle.scrollIntoViewIfNeeded();
  await new Promise((r) => setTimeout(r, 200));
  const box = await elementHandle.boundingBox();
  if (!box) throw new Error('Không lấy được boundingBox để click (element có thể đang ẩn)');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await moveMouseTo(page, x, y);
  await new Promise((r) => setTimeout(r, opts.pauseBefore ?? 150));
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 90));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, opts.pauseAfter ?? 200));
}

async function humanType(page, elementHandle, text, opts = {}) {
  await humanClick(page, elementHandle, { pauseAfter: 150 });
  await page.keyboard.type(text, { delay: opts.delay ?? 45 });
  await new Promise((r) => setTimeout(r, 150));
}

// Chờ 1 phần tử khớp XPath xuất hiện, tối đa timeoutMs, poll mỗi 400ms.
async function waitXPath(page, xpath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [el] = await page.$$('xpath/' + xpath);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

// Click 1 phần tử (lấy lại qua getElement mỗi lần vì element có thể bị re-render),
// chờ checkFn() true; nếu chưa, click lại tối đa maxAttempts lần.
// Dùng khi 1 click không chắc phản hồi ngay lần đầu (đã gặp với nút "Sửa"/tab "Thiết lập").
async function clickUntil(page, getElement, checkFn, opts = {}) {
  const { maxAttempts = 3, checkTimeoutMs = 4000, label = '' } = opts;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const el = await getElement();
    if (!el) throw new Error(`không tìm thấy phần tử để click: ${label}`);
    await humanClick(page, el);
    console.log(`STEP: đã click ${label} (lần ${attempt})`);
    const deadline = Date.now() + checkTimeoutMs;
    while (Date.now() < deadline) {
      if (await checkFn()) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`STEP: chưa thấy kết quả mong đợi sau khi click ${label}, thử lại...`);
  }
  throw new Error(`click ${label} không tạo ra kết quả mong đợi sau ${maxAttempts} lần thử`);
}

module.exports = { moveMouseTo, humanClick, humanType, waitXPath, clickUntil };
