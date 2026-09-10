const { SHEET_ID } = require('./config');

// Tìm tab Google Sheet đang mở khớp SHEET_ID; nếu chưa có, mở tab mới.
async function getOrOpenSheetPage(browser, sheetId = SHEET_ID) {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes('docs.google.com/spreadsheets') && p.url().includes(sheetId));
  if (page) {
    await page.bringToFront();
    return page;
  }
  page = await browser.newPage();
  await page.goto(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 4000));
  return page;
}

// Nhảy tới 1 ô cụ thể qua Name Box (VD "I15").
async function gotoCell(page, cellAddress) {
  const nameBox = await page.$('#t-name-box');
  if (!nameBox) throw new Error('không tìm thấy Name Box (#t-name-box) — có đúng đang ở tab Google Sheet không?');
  await nameBox.click({ clickCount: 3 });
  await page.keyboard.type(cellAddress, { delay: 60 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 800));
}

// Đọc nội dung THẬT của ô đang chọn qua formula bar (#t-formula-bar-input) — đáng tin hơn
// nhìn ảnh chụp, vì đây là giá trị Google Sheets đang thật sự hiển thị cho ô đó.
async function readCellText(page) {
  const el = await page.$('#t-formula-bar-input');
  if (!el) throw new Error('không tìm thấy formula bar (#t-formula-bar-input)');
  const text = await page.evaluate((e) => e.innerText, el);
  return text.replace(/\n$/, '');
}

// Kiểm tra CỨNG (không phải nhìn ảnh) trước khi ghi: nhảy tới ô cột ID của đúng dòng định
// ghi kết quả, đọc giá trị thật, so với expectedId. Sai → NÉM LỖI ngay, không ghi gì cả.
// Đây là hàng rào bắt buộc để tránh ghi nhầm dòng (đã từng xảy ra thật, gây tốn công làm lại).
async function verifyRowMatchesId(page, idColumn, row, expectedId) {
  await gotoCell(page, `${idColumn}${row}`);
  const actual = await readCellText(page);
  if (actual !== expectedId) {
    throw new Error(
      `SAI DÒNG: mong ${idColumn}${row} = "${expectedId}", thực tế = "${actual}". ` +
        `DỪNG lại — không ghi kết quả, kiểm tra lại số dòng trước khi thử lại.`
    );
  }
  return actual;
}

// Nối thêm 1 dòng vào CUỐI nội dung hiện có của ô đang chọn — CHƯA lưu (chưa bấm Enter).
// Luôn giữ nguyên nội dung cũ, không ghi đè. Chụp màn hình nếu truyền screenshotPath.
async function typeAppendDraft(page, textToAppend, screenshotPath) {
  await page.keyboard.press('F2');
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.down('Alt');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Alt');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.type(textToAppend, { delay: 15 });
  await new Promise((r) => setTimeout(r, 300));
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath });
  }
}

// Bấm Enter để LƯU THẬT nội dung đã gõ ở typeAppendDraft. Chỉ gọi sau khi đã xem
// screenshotPath của typeAppendDraft và xác nhận nội dung đúng.
async function commitCell(page, screenshotPath) {
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath });
  }
}

module.exports = { getOrOpenSheetPage, gotoCell, readCellText, verifyRowMatchesId, typeAppendDraft, commitCell };
