const puppeteer = require('puppeteer-core');
const config = require('./config');
const { getOrOpenSheetPage } = require('./sheet_writer');

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await getOrOpenSheetPage(browser);

  // Hủy edit đang dở (nếu U22 đang mid-edit, uncommitted) - Escape không lưu gì cả.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'fix1_after_escape.png' });
  console.log('STEP: đã Escape - xem fix1_after_escape.png');

  await browser.disconnect();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
