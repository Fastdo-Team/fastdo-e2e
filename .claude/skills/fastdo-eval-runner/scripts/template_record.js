// ============================================================================
// "1 FORM" — khung sườn dùng chung cho MỌI testcase.
// Copy file này thành <TESTCASE_ID>_record.js rồi CHỈ sửa 2 chỗ đánh dấu bên dưới:
//   1. Hằng số TESTCASE_ID
//   2. Hàm runCustomSteps(ctx)
// Phần còn lại (login, chọn tổ chức, quay video, upload Catbox) đã kiểm chứng ổn định,
// KHÔNG sửa — để mọi case chạy đồng nhất theo đúng 1 cách.
// ============================================================================
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const config = require('./config');
const { humanClick, humanType, waitXPath, clickUntil } = require('./human_input');
const { setFlatpickrField } = require('./datetime_picker');
const { uploadToCatbox } = require('./catbox_upload');

const CURSOR_SRC = fs.readFileSync(path.join(__dirname, 'cursor_overlay.js'), 'utf8');

const recorderConfig = {
  followNewTab: false,
  fps: 30,
  videoFrame: { width: 1280, height: 720 },
  videoCrf: 18,
  videoCodec: 'libx264',
  videoPreset: 'ultrafast',
  videoBitrate: 1500,
  autopad: { color: 'black' },
  aspectRatio: '16:9',
};

// ==== SỬA #1: đổi đúng mã testcase ====
const TESTCASE_ID = 'EVAL_XXX';

// ==== SỬA #2: viết thao tác riêng của case này ====
// ctx = { page, humanClick, humanType, waitXPath, clickUntil, setFlatpickrField }
// Viết đúng theo "Các bước" ở cột Mô tả của Sheet. Trả về { pass, resultText } —
// resultText sẽ được dùng làm nội dung nối vào cột I của Sheet (ghi Sheet là bước RIÊNG,
// xem SKILL.md — không thực hiện trong file này).
async function runCustomSteps(ctx) {
  throw new Error(
    'CHƯA VIẾT runCustomSteps() cho ' + TESTCASE_ID + ' — sửa hàm này trước khi chạy.'
  );
}
// ==== HẾT PHẦN CẦN SỬA ====

async function loginAndSelectOrg(page) {
  await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForSelector('#continue', { timeout: 5000 });
    const continueBtn = await page.$('#continue');
    await humanClick(page, continueBtn);
    console.log('STEP: đã click #continue (dev tunnel warning)');
  } catch (e) {
    console.log('STEP: không thấy trang chắn dev tunnel, bỏ qua');
  }

  const orgXPath = `.//a[contains(., "${config.ORG_NAME}")]`;
  const loginLinkXPath = './/a[contains(., "Đăng nhập")]';

  let state = null;
  for (let i = 0; i < 20 && !state; i++) {
    if (await page.$('xpath/' + orgXPath)) state = 'org-selection';
    else if (await page.$('xpath/' + loginLinkXPath)) state = 'landing';
    else await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('STEP: trạng thái phát hiện =', state);

  if (state === 'landing') {
    const loginLink = await page.$('xpath/' + loginLinkXPath);
    await humanClick(page, loginLink);
    await page.waitForSelector('input[placeholder="Nhập email hoặc số điện thoại"]', { timeout: 15000 });
    const emailInput = await page.$('input[placeholder="Nhập email hoặc số điện thoại"]');
    const passInput = await page.$('input[placeholder="Nhập mật khẩu"]');
    await humanType(page, emailInput, config.EMAIL);
    await humanType(page, passInput, config.PASSWORD);
    console.log('STEP: đã nhập email + mật khẩu');
    const submitBtn = await page.$('xpath/.//button[contains(., "Đăng nhập")]');
    await humanClick(page, submitBtn);
    console.log('STEP: đã bấm nút Đăng nhập');
    await page.waitForSelector('xpath/' + orgXPath, { timeout: 20000 });
  } else if (state !== 'org-selection') {
    throw new Error(
      'Không nhận diện được trạng thái trang sau khi mở URL (không phải landing, không phải chọn tổ chức)'
    );
  }

  const orgLink = await page.$('xpath/' + orgXPath);
  await humanClick(page, orgLink);
  console.log('STEP: đã chọn tổ chức', config.ORG_NAME);
  await new Promise((r) => setTimeout(r, 3500));
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(CURSOR_SRC);
  await page.bringToFront();

  const videoPath = path.join(__dirname, `${TESTCASE_ID}_AutoRecord.mp4`);
  const recorder = new PuppeteerScreenRecorder(page, recorderConfig);
  await recorder.start(videoPath);
  console.log('STEP: bắt đầu quay video ->', videoPath);

  let result = { pass: false, resultText: '' };
  try {
    await loginAndSelectOrg(page);

    const ctx = { page, humanClick, humanType, waitXPath, clickUntil, setFlatpickrField };
    result = await runCustomSteps(ctx);

    await new Promise((r) => setTimeout(r, 2000));
    console.log('RESULT_STATUS:', result.pass ? 'PASS' : 'FAIL', '-', result.resultText);
  } catch (err) {
    result = { pass: false, resultText: `Lỗi khi chạy: ${err.message}` };
    console.log('RESULT_STATUS: FAIL -', err.message);
  } finally {
    await recorder.stop();
    console.log('STEP: đã dừng quay video');
  }

  let videoUrl = null;
  try {
    videoUrl = await uploadToCatbox(videoPath, `${TESTCASE_ID}_TestRecord.mp4`);
    console.log('STEP: đã upload Catbox ->', videoUrl);
  } catch (err) {
    console.log('STEP: upload Catbox thất bại -', err.message);
  }

  console.log(
    'SUMMARY_JSON:',
    JSON.stringify({
      testcaseId: TESTCASE_ID,
      pass: result.pass,
      resultText: result.resultText,
      videoPath,
      videoUrl,
    })
  );

  await browser.disconnect();
}

main().catch((e) => {
  console.error('SCRIPT_ERROR:', e);
  process.exit(1);
});
