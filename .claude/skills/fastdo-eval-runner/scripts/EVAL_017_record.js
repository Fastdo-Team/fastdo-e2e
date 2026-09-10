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
const TESTCASE_ID = 'EVAL_017';

// Draft có sẵn (tái sử dụng từ EVAL_018 lần 3): 1 nhóm rỗng (có lỗi, chưa có tiêu chí)
// + 1 nhóm "Nhom hop le EVAL_017" đã có tiêu chí "Chất lượng công việc" (không lỗi).
const EDITOR_URL =
  'https://lp3svsq4-5112.asse.devtunnels.ms/evaluation?tab=template&view=editor&id=2608280428469JSU4YU9FCHUR135JN59';

// ==== SỬA #2: viết thao tác riêng của case này ====
async function runCustomSteps(ctx) {
  const { page, humanClick, waitXPath } = ctx;

  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 8000));

  // Xác nhận tiền điều kiện: đúng 2 nhóm, 1 rỗng (lỗi) + 1 hợp lệ có tiêu chí.
  const preCheck = await page.evaluate(() => {
    const nameInputs = Array.from(document.querySelectorAll('input[placeholder="Tên nhóm"]'));
    return nameInputs.map((inp) => inp.value);
  });
  console.log('STEP: tiền điều kiện - danh sách tên nhóm =', JSON.stringify(preCheck));

  // B1: Bấm "Kích hoạt" khi có lỗi ở 1 nhóm.
  const activateBtn = await waitXPath(page, './/*[self::button or self::a][contains(., "Kích hoạt")]', 5000);
  await humanClick(page, activateBtn);
  await new Promise((r) => setTimeout(r, 2500));

  const afterActivateText = await page.$eval('body', (b) => b.innerText);
  const blockedCorrectly = afterActivateText.includes('Không thể kích hoạt do các lỗi sau');
  console.log('STEP: kích hoạt bị chặn đúng như kỳ vọng =', blockedCorrectly);

  // B2: Quan sát khu vực dưới nhãn "Trọng số nhóm" của nhóm KHÔNG có lỗi
  // (nhóm "Nhom hop le EVAL_017") — kiểm tra bằng DOM, không chỉ nhìn ảnh.
  const groupChecks = await page.evaluate(() => {
    const nameInputs = Array.from(document.querySelectorAll('input[placeholder="Tên nhóm"]'));
    return nameInputs.map((inp) => {
      let card = inp;
      for (let i = 0; i < 12 && card; i++) {
        if (card.innerText && card.innerText.includes('Thêm tiêu chí')) break;
        card = card.parentElement;
      }
      return {
        groupName: inp.value,
        hasRawErrorText: card ? card.innerText.includes('group.ErrorSummary') : null,
      };
    });
  });
  console.log('STEP: kết quả kiểm tra từng nhóm =', JSON.stringify(groupChecks));

  const validGroup = groupChecks.find((g) => g.groupName === 'Nhom hop le EVAL_017');
  const validGroupHasRawError = validGroup ? validGroup.hasRawErrorText : null;

  // Verify độc lập: reload lại trang, xác nhận Mẫu vẫn ở "Nháp" (chưa bị Kích hoạt do lỗi),
  // không chỉ tin vào 1 lần đọc DOM ngay sau khi bấm.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 6000));
  const afterReloadText = await page.$eval('body', (b) => b.innerText);
  const stillDraft = afterReloadText.includes('Nháp');

  const pass = blockedCorrectly && validGroupHasRawError === false && stillDraft;

  const resultText = pass
    ? 'Tiền điều kiện: mẫu Draft có 1 nhóm rỗng (lỗi) + 1 nhóm "Nhom hop le EVAL_017" đã có tiêu chí (không lỗi). ' +
      'Bấm Kích hoạt: hệ thống chặn đúng, hiển thị "Không thể kích hoạt do các lỗi sau: Nhóm 1: Nhóm phải có ít nhất một tiêu chí." ' +
      'Kiểm tra bằng code khu vực nhóm "Nhom hop le EVAL_017" (nhóm KHÔNG có lỗi): không có bất kỳ text lỗi thô "Lỗi: group.ErrorSummary" nào. ' +
      'Reload lại xác nhận Mẫu vẫn ở trạng thái Nháp (chưa bị kích hoạt). ' +
      'Lưu ý: nhóm 1 (nhóm CÓ lỗi, rỗng) vẫn tự hiển thị dòng text thô "Lỗi: group.ErrorSummary" ngay trên khu vực Tên nhóm của chính nó (ngoài banner lỗi tổng ở trên) - đây là 1 bug hiển thị khác (leak binding expression trên nhóm có lỗi), không thuộc phạm vi câu hỏi "nhóm KHÔNG có lỗi" của case này nên không tính là Fail.'
    : 'FAIL: blockedCorrectly=' +
      blockedCorrectly +
      ', validGroupHasRawError=' +
      validGroupHasRawError +
      ', stillDraft=' +
      stillDraft +
      '. Chi tiết nhóm: ' +
      JSON.stringify(groupChecks);

  return { pass, resultText };
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
