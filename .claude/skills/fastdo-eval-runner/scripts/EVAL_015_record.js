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
const TESTCASE_ID = 'EVAL_015';

// ==== SỬA #2: viết thao tác riêng của case này ====
// EVAL_015: Bug - Nhân bản mẫu Active không copy Tên nhóm.
// B1: Bấm "Thêm hành động" -> "Nhân bản" trên Mẫu đánh giá thực tập sinh (Active).
// B2: Mở bản sao vừa tạo ở chế độ Sửa.
// B3: So sánh Tên nhóm giữa bản gốc và bản sao.
async function runCustomSteps(ctx) {
  const { page, humanClick, waitXPath } = ctx;

  await page.goto('https://lp3svsq4-5112.asse.devtunnels.ms/evaluation?tab=template', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await new Promise((r) => setTimeout(r, 3500));

  const rowXPath = './/tr[contains(., "Mẫu đánh giá thực tập sinh")][contains(., "Đang dùng")]';
  const row = await waitXPath(page, rowXPath, 8000);
  if (!row) {
    return { pass: false, resultText: 'FAIL: không tìm thấy Mẫu đánh giá thực tập sinh đang ở trạng thái Đang dùng (Active) để test.' };
  }

  // B1a: mở bản gốc ở chế độ xem để đọc Tên nhóm gốc trước khi Nhân bản
  const nameLink = await row.$('a.has-text-weight-semibold');
  await humanClick(page, nameLink);
  await new Promise((r) => setTimeout(r, 2500));

  if (!page.url().includes('view=readonly')) {
    return { pass: false, resultText: `FAIL: bấm vào tên Mẫu đánh giá thực tập sinh không mở được màn hình xem chi tiết. URL hiện tại: ${page.url()}` };
  }

  const originalGroupNames = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,b,div,span,p'));
    const seen = new Set();
    const res = [];
    for (const el of all) {
      const t = el.textContent.trim();
      const m = t.match(/^(.*?)\s*\(Trọng số nhóm: \d+\)$/);
      if (m && t.length < 80 && !seen.has(t)) {
        seen.add(t);
        res.push(m[1].trim());
      }
    }
    return res;
  });
  console.log('STEP: Tên nhóm bản gốc =', JSON.stringify(originalGroupNames));

  if (originalGroupNames.length < 2) {
    return {
      pass: false,
      resultText: `FAIL: không đọc được đủ Tên nhóm của bản gốc (đọc được: ${JSON.stringify(originalGroupNames)}), không thể so sánh với bản sao.`,
    };
  }

  // B1b: bấm nút "Nhân bản" trên màn hình xem chi tiết
  const cloneBtn = await waitXPath(page, './/button[contains(., "Nhân bản")] | .//a[contains(., "Nhân bản")]', 5000);
  if (!cloneBtn) {
    return { pass: false, resultText: 'FAIL: không tìm thấy nút "Nhân bản" trên màn hình xem chi tiết Mẫu đánh giá thực tập sinh.' };
  }
  await humanClick(page, cloneBtn);
  console.log('STEP: đã bấm Nhân bản');
  await new Promise((r) => setTimeout(r, 2500));

  // B2: xác nhận đã mở bản sao ở chế độ Sửa (editor)
  if (!page.url().includes('view=editor')) {
    return {
      pass: false,
      resultText: `FAIL: sau khi bấm Nhân bản, không tự động mở bản sao ở chế độ Sửa. URL hiện tại: ${page.url()}`,
    };
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3000));

  const cloneGroupNames = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[placeholder="Tên nhóm"]'));
    return inputs.map((el) => el.value);
  });
  console.log('STEP: Tên nhóm bản sao (sau reload) =', JSON.stringify(cloneGroupNames));

  // B3: So sánh Tên nhóm giữa bản gốc và bản sao
  const allNonEmpty = cloneGroupNames.length === originalGroupNames.length &&
    cloneGroupNames.every((v) => v && v.trim().length > 0);
  const matchesOriginal = allNonEmpty && originalGroupNames.every((name, i) => cloneGroupNames[i] === name);

  // Verify độc lập bổ sung: quay lại danh sách, xác nhận bản sao có xuất hiện (đối chiếu ghi chú TEST LẦN 2 trước đó)
  await page.goto('https://lp3svsq4-5112.asse.devtunnels.ms/evaluation?tab=template', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await new Promise((r) => setTimeout(r, 3000));
  const cloneRowInList = await page.$(
    'xpath/.//tr[contains(., "Mẫu đánh giá thực tập sinh - Bản sao")][contains(., "Nháp")]'
  );
  const appearsInList = !!cloneRowInList;
  console.log('STEP: bản sao xuất hiện trong danh sách =', appearsInList);

  const pass = matchesOriginal && appearsInList;
  const resultText = pass
    ? `PASS: Nhân bản đã copy đúng Tên nhóm — bản gốc ${JSON.stringify(originalGroupNames)} khớp hoàn toàn với bản sao ${JSON.stringify(cloneGroupNames)}. Bản sao "Mẫu đánh giá thực tập sinh - Bản sao" (Nháp) cũng xuất hiện đúng trong danh sách.`
    : `FAIL: Tên nhóm bản gốc = ${JSON.stringify(originalGroupNames)}, Tên nhóm bản sao = ${JSON.stringify(cloneGroupNames)} (khớp: ${matchesOriginal}). Bản sao xuất hiện trong danh sách: ${appearsInList}.`;

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
