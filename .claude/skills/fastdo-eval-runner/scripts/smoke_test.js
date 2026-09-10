const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const config = require('./config');
const { uploadToCatbox } = require('./catbox_upload');

const CURSOR_SRC = fs.readFileSync(path.join(__dirname, 'cursor_overlay.js'), 'utf8');

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(CURSOR_SRC);
  await page.bringToFront();

  const videoPath = path.join(__dirname, 'smoke_test_record.mp4');
  const recorder = new PuppeteerScreenRecorder(page, {
    fps: 30,
    videoFrame: { width: 1280, height: 720 },
  });
  await recorder.start(videoPath);

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.mouse.move(400, 300, { steps: 10 });
  await new Promise((r) => setTimeout(r, 1500));

  await recorder.stop();
  console.log('STEP: đã quay xong smoke test ->', videoPath);

  const stats = fs.statSync(videoPath);
  console.log('STEP: kích thước file video:', stats.size, 'bytes');
  if (stats.size < 1000) throw new Error('File video quá nhỏ, có thể quay lỗi');

  const url = await uploadToCatbox(videoPath, 'smoke_test.mp4');
  console.log('SMOKE_TEST_RESULT: OK, video url =', url);

  fs.unlinkSync(videoPath);
  await page.close();
  await browser.disconnect();
}

main().catch((e) => {
  console.error('SMOKE_TEST_RESULT: FAIL -', e.message);
  process.exit(1);
});
