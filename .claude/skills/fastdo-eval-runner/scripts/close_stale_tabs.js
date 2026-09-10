// Đóng hết tab Fastdo cũ trước khi chạy 1 case mới — tránh lỗi Blazor circuit chết
// ("The circuit associated with this dispatcher is no longer available") do tái dùng
// tab qua nhiều lần điều hướng rời rạc.
const puppeteer = require('puppeteer-core');
const { CDP_URL, TARGET_URL } = require('./config');

async function closeStaleTabs() {
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const pages = await browser.pages();
  const origin = new URL(TARGET_URL).origin;
  let closed = 0;
  for (const p of pages) {
    if (p.url().startsWith(origin)) {
      console.log('đóng tab cũ:', p.url());
      await p.close();
      closed++;
    }
  }
  await browser.disconnect();
  console.log(`đã đóng ${closed} tab cũ`);
  return closed;
}

if (require.main === module) {
  closeStaleTabs().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
}

module.exports = { closeStaleTabs };
