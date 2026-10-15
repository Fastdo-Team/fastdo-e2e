// ============================================================================
// smoke_test.js: Thử đường ống quay video + upload Catbox, KHÔNG đụng tới app.
//
//   npm run smoke-test
//
// Dùng khi runner báo "Lưu video thất bại" hoặc "Upload Catbox thất bại" và cần
// biết lỗi nằm ở app hay ở đường ống ghi hình: smoke test chỉ mở example.com,
// quay 1.5 giây rồi upload. Chạy OK nghĩa là ffmpeg + CATBOX_USERHASH đều sống,
// lỗi nằm ở phía testcase.
//
// Dùng chung module với runner (src/core/*) nên không có bản sao cấu hình riêng
// nào để lệch nữa.
// ============================================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

const ROOT_DIR = path.join(__dirname, '..', '..', '..', '..');
const config = require(path.join(ROOT_DIR, 'src', 'config'));
const { uploadToCatbox } = require(path.join(ROOT_DIR, 'src', 'core', 'catbox'));
const { CURSOR_CSS_AND_JS } = require(path.join(ROOT_DIR, 'src', 'core', 'cursor_motion'));

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(CURSOR_CSS_AND_JS);
  await page.bringToFront();

  const videoPath = path.join(__dirname, 'smoke_test_record.mp4');
  const recorder = new PuppeteerScreenRecorder(page, config.RECORDER_CONFIG);
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
