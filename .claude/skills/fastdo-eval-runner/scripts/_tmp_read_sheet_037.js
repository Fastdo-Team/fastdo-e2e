const puppeteer = require('puppeteer-core');
const config = require('./config');
const { getOrOpenSheetPage } = require('./sheet_writer');

async function findAndGetNameBox(page, query, tag) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.down('Control');
  await page.keyboard.press('f');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.type(query, { delay: 60 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `_tmp_find_${tag}.png` });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 800));
  const nameBoxVal = await page.evaluate(() => {
    const el = document.querySelector('#t-name-box');
    return el ? el.value || el.innerText : null;
  });
  await page.screenshot({ path: `_tmp_after_${tag}.png` });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  return nameBoxVal;
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await getOrOpenSheetPage(browser, config.SHEET_ID);
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 2000));

  const idCellAddr = await findAndGetNameBox(page, 'EVAL_037', 'id');
  console.log('EVAL_037 found at cell:', idCellAddr);

  const headerCellAddr = await findAndGetNameBox(page, 'TEST LẦN 4', 'hdr');
  console.log('TEST LẦN 4 header found at cell:', headerCellAddr);

  await browser.disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
