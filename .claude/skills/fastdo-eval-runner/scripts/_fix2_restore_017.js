const puppeteer = require('puppeteer-core');
const config = require('./config');
const { getOrOpenSheetPage, gotoCell, verifyRowMatchesId } = require('./sheet_writer');

// Khôi phục nguyên văn nội dung gốc của U21 (EVAL_018 - TEST LẦN 3) đã bị ghi đè nhầm,
// lấy đúng từ kết quả sheet_read TRƯỚC KHI xảy ra lỗi (đã lưu trong transcript).
const ORIGINAL_U21_LINES = [
  '',
  'Retest lần 3: Bấm Kích hoạt khi mẫu có nhóm rỗng (chưa có tiêu chí nào) - hệ thống chặn đúng, hiển thị lỗi "Nhóm phải có ít nhất một tiêu chí" (khớp rule BR-14/GroupCriterionRequired). Reload lại danh sách xác nhận mẫu vừa tạo vẫn ở trạng thái "Nháp", không chuyển "Đang dùng". Tiền điều kiện "+ Thêm nhóm" (2 lần trước bị chặn do nút không bấm được qua tự động hoá) lần này đã bấm thành công.',
  '- Video Test Record: https://files.catbox.moe/nhnbp4.mp4',
];

// Gõ nhiều dòng AN TOÀN vào 1 ô: dùng Alt+Enter giữa các dòng thay vì ký tự '\n' thô
// (page.keyboard.type sẽ gửi '\n' thành phím Enter thật -> chốt ô + nhảy dòng, đã gây lỗi thật).
async function typeMultilineSafe(page, lines) {
  await page.keyboard.press('Delete');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('F2');
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.down('Alt');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Alt');
      await new Promise((r) => setTimeout(r, 150));
    }
    if (lines[i].length > 0) {
      await page.keyboard.type(lines[i], { delay: 8 });
    }
  }
  await new Promise((r) => setTimeout(r, 300));
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await getOrOpenSheetPage(browser);

  await verifyRowMatchesId(page, config.SHEET_ID_COLUMN, 21, 'EVAL_018');
  console.log('STEP: verify dòng 21 = EVAL_018 OK');

  await gotoCell(page, 'U21');
  await typeMultilineSafe(page, ORIGINAL_U21_LINES);
  await page.screenshot({ path: 'fix2_restore_draft.png' });
  console.log('STEP: đã gõ lại nội dung gốc U21 (CHƯA lưu) - xem fix2_restore_draft.png');

  await browser.disconnect();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
