// ============================================================================
// "1 FORM" — khung sườn dùng chung cho MỌI testcase.
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

const TESTCASE_ID = 'EVAL_001';
const SCALE_NAME = 'Đánh giá nhân viên chính thức';
const MUC_DESCRIPTIONS = [
  'Chưa đáp ứng yêu cầu công việc, cần cải thiện nhiều mặt.',
  'Đáp ứng một phần yêu cầu công việc, còn thiếu sót cần khắc phục.',
  'Đáp ứng đầy đủ yêu cầu công việc ở mức tiêu chuẩn.',
  'Đáp ứng tốt, vượt một số yêu cầu công việc.',
  'Vượt trội, vượt mong đợi ở hầu hết các yêu cầu công việc.',
];

// EVAL_001: Tạo mới Thang điểm hợp lệ (đủ tên và 5 mức mô tả hành vi).
// B1: Bấm "Tạo thang điểm". B2: Nhập Tên. B3: Nhập đủ Mô tả hành vi 5 mức. B4: Bấm "Lưu".
// Kỳ vọng: Lưu thành công; Thang điểm mới ở trạng thái Khả dụng, không bị khóa Sửa/Ngừng sử dụng;
// cột Quy đổi tự động đúng 0/25/50/75/100.
async function runCustomSteps(ctx) {
  const { page, humanClick, humanType, waitXPath, clickUntil } = ctx;

  await page.goto(config.SCALE_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));

  // Đóng popup "Bật thông báo đẩy" nếu có, không chặn thao tác.
  const denyNotif = await page.$('xpath/.//button[contains(., "Từ chối")]');
  if (denyNotif) {
    await humanClick(page, denyNotif);
    await new Promise((r) => setTimeout(r, 500));
    console.log('STEP: đã đóng popup thông báo đẩy');
  }

  // B1: Bấm "Tạo thang điểm" — dùng clickUntil vì lần click đầu đôi khi chỉ đổi active state,
  // chưa thực sự chuyển sang form (giống lỗi đã gặp với nút "Sửa" ở case khác).
  const createBtnXPath = './/button[contains(., "Tạo thang điểm")] | .//a[contains(., "Tạo thang điểm")]';
  const found = await waitXPath(page, createBtnXPath, 8000);
  if (!found) {
    return { pass: false, resultText: 'FAIL: không tìm thấy nút "Tạo thang điểm" trên danh sách Thang điểm.' };
  }
  await clickUntil(
    page,
    async () => waitXPath(page, createBtnXPath, 3000),
    async () => page.url().includes('view=editor'),
    { label: 'Tạo thang điểm', maxAttempts: 3, checkTimeoutMs: 4000 }
  );
  await new Promise((r) => setTimeout(r, 1500));
  console.log('STEP: đã bấm Tạo thang điểm, URL =', page.url());

  // Đóng lại popup thông báo nếu nó xuất hiện sau khi vào form
  const denyNotif2 = await page.$('xpath/.//button[contains(., "Từ chối")]');
  if (denyNotif2) {
    await humanClick(page, denyNotif2);
    await new Promise((r) => setTimeout(r, 500));
  }

  // Chờ form xuất hiện đủ 6 input text (Tên + 5 Mô tả hành vi), đánh dấu thứ tự theo vị trí trên màn hình.
  const deadline = Date.now() + 10000;
  let formCount = 0;
  while (Date.now() < deadline) {
    formCount = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).filter(
        (el) => el.type === 'text' && el.placeholder !== 'Tên ứng dụng'
      );
      inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      inputs.forEach((el, i) => el.setAttribute('data-auto-idx', String(i)));
      return inputs.length;
    });
    if (formCount >= 6) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (formCount < 6) {
    return { pass: false, resultText: `FAIL: form Tạo thang điểm không hiển thị đủ input (chỉ thấy ${formCount}, cần 6: Tên + 5 mức).` };
  }

  const tenInput = await page.$('input[data-auto-idx="0"]');
  await humanType(page, tenInput, SCALE_NAME);
  console.log('STEP: đã nhập Tên =', SCALE_NAME);

  for (let i = 0; i < 5; i++) {
    const mucInput = await page.$(`input[data-auto-idx="${i + 1}"]`);
    await humanType(page, mucInput, MUC_DESCRIPTIONS[i]);
  }
  console.log('STEP: đã nhập đủ Mô tả hành vi cho 5 mức');

  // Đọc cột Quy đổi ngay trên form (0/25/50/75/100) trước khi Lưu.
  const quyDoiValues = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr'));
    const vals = [];
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length >= 3) {
        const last = cells[cells.length - 1].textContent.trim();
        if (/^\d+$/.test(last)) vals.push(last);
      }
    }
    return vals;
  });
  console.log('STEP: cột Quy đổi đọc được trên form =', JSON.stringify(quyDoiValues));

  // B4: Bấm "Lưu"
  const saveBtn = await waitXPath(page, './/a[contains(@class,"button")][contains(., "Lưu")] | .//button[contains(., "Lưu")]', 5000);
  if (!saveBtn) {
    return { pass: false, resultText: 'FAIL: không tìm thấy nút "Lưu" trên form Tạo thang điểm.' };
  }
  await humanClick(page, saveBtn);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('STEP: đã bấm Lưu, URL =', page.url());

  // Verify độc lập: quay lại danh sách, reload, đọc lại toàn bảng.
  await page.goto(config.SCALE_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3000));

  const rows = await page.$$eval('table tr', (trs) => trs.map((tr) => tr.innerText.replace(/\n/g, ' | ')));
  console.log('STEP: danh sách Thang điểm sau khi Lưu =', JSON.stringify(rows));

  const targetRow = rows.find((r) => r.includes(SCALE_NAME));
  const quyDoiOk = quyDoiValues.join(',') === '0,25,50,75,100';

  if (!targetRow) {
    return { pass: false, resultText: `FAIL: sau khi Lưu, không thấy Thang điểm "${SCALE_NAME}" trong danh sách. Danh sách hiện tại: ${JSON.stringify(rows)}` };
  }

  const isKhaDung = targetRow.includes('Khả dụng');
  const isLocked = targetRow.includes('Đang bị khóa');
  const pass = isKhaDung && !isLocked && quyDoiOk;

  const resultText = pass
    ? `PASS: Lưu thành công. Thang điểm "${SCALE_NAME}" xuất hiện trong danh sách ở trạng thái Khả dụng, không bị khóa Sửa/Ngừng sử dụng. Cột Quy đổi trên form đúng 0/25/50/75/100 tương ứng Mức 1-5. Dòng: "${targetRow}"`
    : `FAIL: Trạng thái Khả dụng=${isKhaDung}, Đang bị khóa=${isLocked}, Quy đổi đúng 0/25/50/75/100=${quyDoiOk} (đọc được: ${JSON.stringify(quyDoiValues)}). Dòng: "${targetRow}"`;

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
