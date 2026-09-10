const puppeteer = require('puppeteer-core');
const config = require('./config');
const { getOrOpenSheetPage, gotoCell, readCellText } = require('./sheet_writer');

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await getOrOpenSheetPage(browser);

  // Cell U21 hiện đang mid-edit (draft đã gõ ở bước trước) - commit bằng Enter.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'fix3_after_commit.png' });
  console.log('STEP: đã lưu U21');

  // Đọc lại độc lập qua Puppeteer để xác nhận đúng nội dung đã khôi phục.
  await gotoCell(page, 'U21');
  const text = await readCellText(page);
  console.log('U21_TEXT_AFTER_RESTORE:', JSON.stringify(text));

  await browser.disconnect();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
