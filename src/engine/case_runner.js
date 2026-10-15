// ============================================================================
// case_runner.js: vòng đời MỘT case trên một BrowserContext mới.
//
//   context mới (phiên hồ sơ, video webm, trace) → khởi động (vào app, đúng tổ chức — bị
//   cắt khỏi đầu video) → run(ctx) dưới watchdog + huỷ → kiểm hợp đồng → báo cáo lỗi khi
//   FAIL/lỗi (TRƯỚC khi đóng context, còn đọc được DOM) → trace (giữ khi không ĐẠT) →
//   đóng context (video hoàn tất) → result.
// Hết giờ hoặc bị huỷ = ĐÓNG CONTEXT: mọi thao tác đang treo của case chết ngay, không đụng
// context của case khác — thay cho watchdog cũ chỉ "thôi chờ" mà promise vẫn điều khiển page.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { CURSOR_CSS_AND_JS } = require('../core/cursor_motion');
const { attachCollectors, writeFailReport } = require('../core/diagnostics');
const { guardPage, contractError } = require('./page_guard');
const { warmUp, VIEWPORT } = require('./app_session');
const { createStepLog } = require('./steps');
const { paceFor } = require('./video_pace');
const { createCtx } = require('./ctx');
const { createRecord, verdictOf } = require('./result_v2');

const errMsg = (err) => (err && err.message ? String(err.message) : String(err));

function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Chạy promise với hạn giờ + huỷ. Ném lỗi mang code CASE_TIMEOUT / CASE_CANCELLED. */
function guardRun(promise, { timeoutMs, signal, label = 'case' }) {
  promise.catch(() => {}); // promise bị bỏ rơi sau khi đóng context — không để thành unhandled
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(`Watchdog: ${label} vượt quá ${timeoutMs / 1000}s — đóng context để chạy tiếp`);
      e.code = 'CASE_TIMEOUT';
      reject(e);
    }, timeoutMs);
    const onAbort = () => {
      const e = new Error('ĐÃ HUỶ theo yêu cầu');
      e.code = 'CASE_CANCELLED';
      reject(e);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      });
  });
}

/** Kiểm hợp đồng kết quả; vi phạm → ném lỗi HỢP ĐỒNG KỊCH BẢN (không bao giờ thành kết quả kiểm thử) */
function checkContract(result, stepLog) {
  if (typeof (result && result.pass) !== 'boolean') {
    throw contractError(`kịch bản trả về pass = ${JSON.stringify(result && result.pass)}, phải là true hoặc false.`);
  }
  const bad = stepLog.failedChecks();
  if (result.pass && bad.length) {
    throw contractError(`pass = true nhưng có phép kiểm ✗: ${bad.map((c) => c.label).join(', ')}.`);
  }
}

/**
 * @param {object} o
 * @param {import('playwright-core').Browser} o.browser
 * @param {{meta, module, hash}} o.script      từ script_meta.loadScript
 * @param {{name, org}} o.profile
 * @param {string} [o.storagePath]             file phiên của hồ sơ (bỏ trống = context trắng)
 * @param {string} o.runDir
 * @param {object} o.opts                      { mode, round, record(video), caseTimeoutSec, trace, warmUp }
 * @param {Function} [o.onEvent]
 * @param {AbortSignal} [o.signal]
 */
async function runCase({
  browser,
  script,
  profile,
  storagePath,
  runDir,
  opts,
  runId,
  batchId,
  envLabel,
  attempt = 1,
  onEvent = () => {},
  signal,
  print = console.log,
}) {
  const caseId = script.meta.id;
  const startedAt = Date.now();
  const record = createRecord({
    caseId,
    title: script.meta.title,
    runId,
    batchId,
    mode: opts.mode,
    round: opts.round,
    profile: profile.name,
    account: opts.account || 1,
    envLabel,
    targetUrl: config.TARGET_URL,
    scriptHash: script.hash,
    attempt,
    runDir,
    flags: { record: Boolean(opts.record), upload: Boolean(opts.upload), sheet: Boolean(opts.sheet), row: opts.row || null },
  });
  fs.mkdirSync(runDir, { recursive: true });
  const emit = (e) => onEvent({ ...e, caseId });
  emit({ ev: 'case.started', attempt, profile: profile.name, runDir });

  let context = null;
  let page = null;
  let collector = null;
  let stepLog = createStepLog({ print });
  const pace = paceFor(opts.record);
  const timeoutMs = (opts.caseTimeoutSec || script.meta.timeoutSec) * 1000;
  const traceOn = opts.trace !== false;
  const tracePath = path.join(runDir, 'trace.zip');

  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      storageState: storagePath && fs.existsSync(storagePath) ? storagePath : undefined,
      recordVideo: opts.record ? { dir: runDir, size: VIEWPORT } : undefined,
    });
    await context.addInitScript({ content: CURSOR_CSS_AND_JS });
    if (traceOn) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = guardPage(await context.newPage());
    page.__fastdoOrg = profile.org;
    const videoT0 = Date.now();
    collector = attachCollectors(page);
    collector.reset();

    // Khởi động (vào app, đúng tổ chức) — phần này bị cắt khỏi đầu video.
    const doWarmUp = opts.warmUp || warmUp;
    await guardRun(Promise.resolve().then(() => doWarmUp(page, profile)), { timeoutMs: 60000, signal, label: 'khởi động (vào app)' });
    record.trimMs = Date.now() - videoT0;

    stepLog = createStepLog({ t0: videoT0, onEvent: emit, print, stepPauseMs: pace.stepPauseMs });
    const ctx = createCtx({ page, context, browser, profile, signal, stepLog, runDir, caseId, log: print });
    const result = await guardRun(Promise.resolve().then(() => script.module.run(ctx)), { timeoutMs, signal });
    checkContract(result, stepLog);
    record.pass = result.pass;
    record.resultText = String(result.resultText == null ? '' : result.resultText);
    stepLog.finish();
  } catch (err) {
    const msg = errMsg(err);
    stepLog.finish(msg);
    record.pass = false;
    record.errorCode = (err && err.code) || null;
    if (err && err.code === 'CASE_CANCELLED') {
      record.cancelled = true;
      record.error = msg;
      record.resultText = 'ĐÃ HUỶ theo yêu cầu — không phải kết quả kiểm thử';
    } else {
      record.error = msg;
      record.resultText = `LỖI KHI CHẠY TEST: ${msg}`;
    }
  }

  // Giữ khung cuối trong video (video_pace) — người xem kịp thấy kết quả trước khi video kết thúc
  if (page && pace.endHoldMs > 0 && !record.cancelled) {
    await page.waitForTimeout(pace.endHoldMs).catch(() => {});
  }

  record.steps = stepLog.steps.map((s) => ({
    index: s.index,
    label: s.label,
    ok: s.ok,
    startMs: s.startMs,
    endMs: s.endMs,
    seconds: s.seconds,
    error: s.error,
  }));
  record.checks = stepLog.checks.slice();
  record.verdict = verdictOf(record);

  // Báo cáo lỗi TRƯỚC khi đóng context: còn đọc được DOM lúc chết.
  if (page && record.verdict !== 'DAT' && record.verdict !== 'DA_HUY') {
    record.failReport = await withTimeout(
      writeFailReport({
        testcaseId: caseId,
        verdict: record.error ? 'CRASH' : 'FAIL',
        page,
        collector,
        steps: record.steps,
        errorMessage: record.error,
        resultText: record.resultText,
        videoPath: null,
        tracePath: traceOn ? tracePath : null,
        seconds: (Date.now() - startedAt) / 1000,
        outDir: runDir,
        diagnosisOut: record,
      }),
      15000
    );
  }

  if (context) {
    const keepTrace = traceOn && record.verdict !== 'DAT' && record.verdict !== 'DA_HUY';
    if (traceOn) await withTimeout(context.tracing.stop(keepTrace ? { path: tracePath } : undefined).catch(() => {}), 20000);
    if (keepTrace && fs.existsSync(tracePath)) record.trace = tracePath;
    const video = page && opts.record ? page.video() : null;
    await withTimeout(context.close().catch(() => {}), 20000);
    if (video) {
      const raw = await withTimeout(video.path().catch(() => null), 10000);
      if (raw && fs.existsSync(raw)) {
        const webm = path.join(runDir, 'video.webm');
        if (path.resolve(raw) !== path.resolve(webm)) fs.renameSync(raw, webm);
        record.video.webm = webm;
        record.videoPath = webm;
      }
    }
  }

  record.durationMs = Date.now() - startedAt;
  record.seconds = record.durationMs / 1000;
  emit({ ev: 'case.finished', verdict: record.verdict, seconds: record.seconds, diagnosis: record.diagnosis });
  return record;
}

module.exports = { runCase, guardRun, checkContract, withTimeout };
