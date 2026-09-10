#!/usr/bin/env node
// ============================================================================
// runner.js: CLI Runner độc lập cho Fastdo Automation Test
//
// Chạy 1 case : node src/runner.js EVAL_017 [--round=1]
// Chạy nhiều  : node src/runner.js EVAL_019 EVAL_020 EVAL_021 --round=3
// Cờ khác     : [--no-record] [--no-upload] [--no-sheet] [--row=N] [--auth-only]
//
// Chạy nhiều case trong 1 lệnh sẽ dùng chung Chrome + session + tab Google Sheet
// nên tiết kiệm được ~8-10 giây MỖI case so với gọi lệnh riêng lẻ.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { initBrowser } = require('./core/browser');
const { ensureAuthenticated, performFullLogin } = require('./core/session');
const { humanClick, humanType, waitXPath, clickUntil } = require('./core/cursor_motion');
const { TestRecorder } = require('./core/recorder');
const { uploadToCatbox } = require('./core/catbox');
const { setFlatpickrField } = require('./core/datetime_picker');
const { updateSheetResult, getOrOpenSheetPage } = require('./core/sheet_service');
const { attachCollectors, createStepLog, writeFailReport } = require('./core/diagnostics');
const { digestToFile } = require('./core/dom_digest');

// Đo thời gian từng chặng để biết đang chậm ở đâu
let timings = [];
async function phase(label, fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ label, seconds: (Date.now() - t0) / 1000 });
  }
}

/**
 * Chạy 1 testcase với hạn giờ. Hết giờ thì ném lỗi để runner chuyển sang case kế
 * tiếp, thay vì để cả batch đứng im chờ một case treo.
 * Lưu ý: promise của testcase vẫn chạy nền (JS không kill được promise), nhưng
 * runner không còn chờ nó và bước bringToFront ở case sau sẽ dựng lại tab app.
 */
function withWatchdog(promise, timeoutMs, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Watchdog: ${label} vượt quá ${timeoutMs / 1000}s, huỷ để chạy case kế tiếp`)),
      timeoutMs
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    testcaseIds: [],
    round: 1,
    row: null,
    record: true,
    upload: true,
    sheet: true,
    authOnly: false,
    // Hạn giờ mỗi case. Case nặng nhất đo được ~48s, để 150s là thoải mái mà
    // vẫn cắt sớm hơn nhiều so với việc chờ CDP timeout.
    caseTimeout: 150000,
  };

  for (const arg of args) {
    if (arg === '--auth-only') options.authOnly = true;
    else if (arg === '--no-record') options.record = false;
    else if (arg === '--no-upload') options.upload = false;
    else if (arg === '--no-sheet') options.sheet = false;
    else if (arg.startsWith('--round=')) options.round = parseInt(arg.split('=')[1], 10) || 1;
    else if (arg.startsWith('--row=')) options.row = parseInt(arg.split('=')[1], 10) || null;
    else if (arg.startsWith('--case-timeout='))
      options.caseTimeout = (parseInt(arg.split('=')[1], 10) || 150) * 1000;
    else if (!arg.startsWith('--')) options.testcaseIds.push(arg.toUpperCase());
  }

  return options;
}

function findTestcaseModule(testcaseId) {
  const testcasesDir = path.join(__dirname, 'testcases');
  const possibleNames = [
    `${testcaseId.toLowerCase()}.test.js`,
    `${testcaseId}.test.js`,
    `${testcaseId.toLowerCase()}_record.js`,
  ];

  for (const name of possibleNames) {
    const filePath = path.join(testcasesDir, name);
    if (fs.existsSync(filePath)) return require(filePath);
  }

  // Nếu không thấy trong src/testcases, thử tìm trong thư mục scripts cũ
  const oldScriptPath = path.join(
    config.ROOT_DIR,
    '.claude',
    'skills',
    'fastdo-eval-runner',
    'scripts',
    `${testcaseId}_record.js`
  );
  if (fs.existsSync(oldScriptPath)) {
    console.log(`[RUNNER] Sử dụng testcase từ script cũ: ${oldScriptPath}`);
    return require(oldScriptPath);
  }

  return null;
}

/**
 * Chạy trọn vẹn 1 testcase trên trình duyệt đã sẵn sàng.
 * Trả về bản ghi kết quả để in bảng tổng hợp ở cuối.
 */
async function runOneTestcase(testcaseId, { browser, page, options }) {
  const startedAt = Date.now();
  const record = {
    testcaseId,
    pass: null,
    resultText: '',
    videoPath: null,
    videoUrl: null,
    sheetCell: null,
    sheetStatus: null,
    error: null,
    failReport: null,
    seconds: 0,
  };

  const testModule = findTestcaseModule(testcaseId);
  if (!testModule) {
    record.error = `Không tìm thấy định nghĩa testcase cho mã "${testcaseId}"`;
    record.seconds = (Date.now() - startedAt) / 1000;
    console.error(`[RUNNER] ${record.error}`);
    return record;
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`[RUNNER] ▶ ${testcaseId} (Vòng test: LẦN ${options.round})`);
  console.log('-'.repeat(70));

  let recorder = null;
  let collector = null;
  let dumpCount = 0;
  const stepLog = createStepLog();

  try {
    // Bắt console error + request lỗi để dựng báo cáo chẩn đoán khi case chết.
    // attachCollectors chỉ gắn listener 1 lần cho page dùng chung; reset() để log
    // của case trước không lẫn sang case sau trong cùng 1 lệnh.
    collector = attachCollectors(page);
    collector.reset();

    // 0. Kéo tab app trở lại foreground.
    //    Bước ghi Google Sheet đưa tab Sheets lên trước, đẩy tab app xuống nền.
    //    Chrome bóp cổ tab nền tới mức mọi lệnh CDP trên nó treo vô hạn - đã làm
    //    EVAL_020/021/022 treo hơn 300 giây mỗi case ở đúng page.evaluateHandle.
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 300));

    // 1. Quay video
    if (options.record) {
      recorder = new TestRecorder(page);
      record.videoPath = await recorder.start(testcaseId);
    }

    // 2. Context thực thi cho testcase
    const ctx = {
      page,
      browser,
      click: (p, el, opt) => humanClick(p || page, el, opt),
      type: (p, el, txt, opt) => humanType(p || page, el, txt, opt),
      waitXPath: (p, xp, to) => waitXPath(p || page, xp, to),
      clickUntil: (p, getEl, chk, opt) => clickUntil(p || page, getEl, chk, opt),
      setFlatpickr: (p, ph, d, h, m) => setFlatpickrField(p || page, ph, d, h, m),

      // Bọc 1 bước để nhật ký bước vào được báo cáo lỗi. KHÔNG bắt buộc: case
      // không dùng vẫn chạy y nguyên, chỉ là nhật ký thô hơn.
      step: (label, fn) => stepLog.step(label, fn),

      // Dump DOM ra text ngay tại dòng đang bí, thay cho chụp màn hình.
      // Không dừng test, không ném lỗi.
      dump: async (label) => {
        dumpCount += 1;
        const slug =
          String(label || 'dump')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'dump';
        try {
          const { filePath } = await digestToFile(
            page,
            `${testcaseId}_dump_${dumpCount}_${slug}.txt`,
            { label, tables: true }
          );
          console.log(`[DUMP] ${label || ''} → ${path.relative(config.ROOT_DIR, filePath)}`);
          return filePath;
        } catch (err) {
          console.warn(`[DUMP] thất bại: ${err.message}`);
          return null;
        }
      },
    };

    // 3. Chạy logic testcase, có watchdog để 1 case treo không giữ cả batch
    console.log('[RUNNER] Đang thực thi các bước kiểm thử...');
    const result = await phase(`${testcaseId} · các bước kiểm thử`, () =>
      withWatchdog(testModule.run(ctx), options.caseTimeout, testcaseId)
    );
    record.pass = result.pass;
    record.resultText = result.resultText;
    console.log(`[RUNNER] Kết quả test: ${result.pass ? '✅ PASS' : '❌ FAIL'}`);
  } catch (err) {
    record.error = err.message;
    record.pass = false;
    record.resultText = `LỖI KHI CHẠY TEST: ${err.message}`;
    console.error(`[ERROR] ${testcaseId} thất bại:`, err.message);
  } finally {
    if (recorder) {
      try {
        record.videoPath = await phase(`${testcaseId} · lưu video`, () => recorder.stop());
      } catch (err) {
        console.error('[ERROR] Lưu video thất bại:', err.message);
      }
    }
  }

  // Test crash vì lỗi hạ tầng (timeout CDP, mất kết nối...) KHÔNG phải là kết quả
  // kiểm thử. Ghi "Fail" kèm stack trace vào Sheet là bịa kết quả QC - nên khi
  // gặp lỗi harness thì bỏ qua toàn bộ bước ghi Sheet, chỉ báo trên terminal.
  const harnessCrashed = !!record.error;
  if (harnessCrashed) {
    console.warn(
      `[RUNNER] ${testcaseId} dừng vì lỗi hạ tầng, KHÔNG ghi Sheet ` +
        '(lỗi chạy máy không phải kết quả test). Cần chạy lại case này.'
    );
  }

  // Ghi báo cáo chẩn đoán cho CẢ crash và fail nghiệp vụ: case FAIL đúng thì báo
  // cáo là bằng chứng cho QC, còn FAIL sai thì đây chính là thứ cần để sửa.
  // Phải chạy TRƯỚC bước mở tab Google Sheet, vì tab Sheet đẩy tab app xuống nền
  // và lúc đó không đọc được DOM của app nữa.
  if (harnessCrashed || record.pass === false) {
    record.failReport = await writeFailReport({
      testcaseId,
      verdict: harnessCrashed ? 'CRASH' : 'FAIL',
      page,
      collector,
      steps: stepLog.steps,
      errorMessage: record.error,
      resultText: record.resultText,
      videoPath: record.videoPath,
      seconds: (Date.now() - startedAt) / 1000,
    });
    if (record.failReport) {
      console.log(`[DIAG] Báo cáo lỗi: ${path.relative(config.ROOT_DIR, record.failReport)}`);
    }
  }

  // 4. Mở sẵn tab Google Sheet để load song song với lúc upload Catbox.
  //    Chỉ mở sau khi đã dừng quay để tab Sheet không lọt vào video.
  let sheetPagePromise = null;
  if (options.sheet && options.upload && record.videoPath && !harnessCrashed) {
    sheetPagePromise = getOrOpenSheetPage(browser).catch((err) => {
      console.warn('[SHEET] Mở sẵn tab Sheet thất bại:', err.message);
      return null;
    });
  }

  // 5. Upload Catbox
  if (options.upload && record.videoPath) {
    try {
      record.videoUrl = await phase(`${testcaseId} · upload Catbox`, () =>
        uploadToCatbox(record.videoPath, `${testcaseId}_AutoRecord.mp4`)
      );
    } catch (err) {
      console.error('[ERROR] Upload Catbox thất bại:', err.message);
    }
  }

  // 6. Ghi Trạng thái + Kết quả thực hiện + link video vào Google Sheet
  if (options.sheet && record.videoUrl && !harnessCrashed) {
    try {
      const sheetPage = sheetPagePromise ? await sheetPagePromise : null;
      const info = await phase(`${testcaseId} · ghi Google Sheet`, () =>
        updateSheetResult(browser, {
          testcaseId,
          row: options.row,
          roundNumber: options.round,
          videoUrl: record.videoUrl,
          resultText: record.resultText,
          pass: record.pass,
          page: sheetPage,
        })
      );
      record.sheetCell = info.cell;
      record.sheetStatus = info.status;
    } catch (err) {
      console.error('[ERROR] Cập nhật Google Sheet thất bại:', err.message);
    }
  }

  record.seconds = (Date.now() - startedAt) / 1000;
  return record;
}

async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('='.repeat(70));
  console.log('       FASTDO TEST AUTOMATION RUNNER (SPEED & CURSOR EDITION)       ');
  console.log('='.repeat(70));

  let browserInstance = null;

  try {
    if (!options.authOnly && options.testcaseIds.length === 0) {
      console.error('[ERROR] Vui lòng truyền mã testcase cần chạy! Ví dụ: node src/runner.js EVAL_017');
      console.log('\nCác testcase có sẵn trong src/testcases:');
      const files = fs.readdirSync(path.join(__dirname, 'testcases')).filter((f) => f.endsWith('.js'));
      files.forEach((f) => console.log(' -', f.replace('.test.js', '').toUpperCase()));
      process.exit(1);
    }

    browserInstance = await phase('Khởi tạo Chrome', () => initBrowser());
    const { browser, page } = browserInstance;

    // Chế độ chỉ đăng nhập
    if (options.authOnly) {
      console.log('[RUNNER] Đang chạy chế độ tạo mới Session Auth...');
      await performFullLogin(page);
      console.log('[RUNNER] Hoàn tất tạo session auth!');
      return;
    }

    // Đăng nhập 1 lần, dùng chung cho mọi case trong lệnh
    await phase('Đăng nhập / phục hồi session', () => ensureAuthenticated(page));

    console.log(
      `[RUNNER] Hàng đợi ${options.testcaseIds.length} testcase: ${options.testcaseIds.join(', ')}`
    );

    const records = [];
    for (const testcaseId of options.testcaseIds) {
      records.push(await runOneTestcase(testcaseId, { browser, page, options }));
    }

    // Báo cáo tổng hợp
    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '='.repeat(70));
    console.log('                          BÁO CÁO KẾT QUẢ                          ');
    console.log('='.repeat(70));

    for (const r of records) {
      console.log(`\n▸ ${r.testcaseId}  —  ${r.pass ? 'PASS (ĐẠT)' : 'FAIL (KHÔNG ĐẠT)'}  (${r.seconds.toFixed(1)}s)`);
      console.log(`   Chi tiết     : ${r.resultText}`);
      console.log(`   Link Catbox  : ${r.videoUrl || 'Chưa có'}`);
      console.log(
        `   Google Sheet : ${
          r.sheetCell
            ? `ô ${r.sheetCell}` + (r.sheetStatus ? ` | Trạng thái = "${r.sheetStatus}"` : '')
            : 'Chưa cập nhật'
        }`
      );
      if (r.failReport) {
        console.log(`   Báo cáo lỗi  : ${path.relative(config.ROOT_DIR, r.failReport)}`);
      }
    }

    const passed = records.filter((r) => r.pass).length;
    console.log('\n' + '-'.repeat(70));
    console.log(`  Tổng: ${records.length} case | PASS ${passed} | FAIL ${records.length - passed}`);
    console.log(`  Tổng thời gian: ${durationSeconds} giây`);
    console.log('-'.repeat(70));
    console.log('  Thời gian từng chặng:');
    timings.forEach((t) => console.log(`   - ${t.label.padEnd(38)} ${t.seconds.toFixed(1)}s`));
    console.log('='.repeat(70) + '\n');

    // Exit code để script hoá / chạy chuỗi được: 0 = tất cả đạt, 1 = có case
    // không đạt hoặc chết. Trước đây chỉ lỗi fatal mới exit 1, nên `npm test &&
    // <lệnh sau>` vẫn chạy tiếp dù case FAIL.
    if (passed !== records.length) process.exitCode = 1;
  } catch (error) {
    console.error('\n[FATAL ERROR] Quá trình test thất bại:', error.message);
    process.exitCode = 1;
  } finally {
    if (browserInstance) {
      await browserInstance.close();
    }
  }
}

main();
