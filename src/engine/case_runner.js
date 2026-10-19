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
const { warmUp, ensureProfileSession, VIEWPORT } = require('./app_session');
const { getProfile, storagePathOf } = require('./profiles');
const { createQcDb } = require('./qc_db');
const { createStepLog } = require('./steps');
const { paceFor } = require('./video_pace');
const { createActionTrace, installActionHooks } = require('./action_trace');
const { createCtx } = require('./ctx');
const { createRecord, verdictOf } = require('./result_v2');
const { ticketOf } = require('./case_id');

const CLEANUP_TIMEOUT_MS = 90000;
const VIDEO_CLOSE_TIMEOUT_MS = 300000;

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

/** Trang đích để khởi động case: kịch bản AI-QC theo ticket bắt đầu ngay ở targetPath; kịch bản khác giữ trang chủ như cũ */
function warmUpUrl(script, caseId) {
  if (!ticketOf(caseId) || typeof script.module.getTargetUrl !== 'function') return undefined;
  try {
    return script.module.getTargetUrl();
  } catch {
    return undefined;
  }
}

/** Chạy các việc ctx.cleanup theo thứ tự ngược, mỗi việc có hạn giờ riêng; không ném lỗi */
async function runCleanups(cleanups, { print = console.log, timeoutMs = CLEANUP_TIMEOUT_MS } = {}) {
  const out = [];
  for (const item of cleanups.slice().reverse()) {
    const started = Date.now();
    try {
      await guardRun(Promise.resolve().then(() => item.fn()), { timeoutMs, label: `dọn «${item.label}»` });
      out.push({ label: item.label, ok: true, seconds: (Date.now() - started) / 1000 });
      print(`   ↺ dọn: ${item.label}`);
    } catch (err) {
      out.push({ label: item.label, ok: false, error: errMsg(err), seconds: (Date.now() - started) / 1000 });
      print(`   ⚠ dọn lỗi: ${item.label} ← ${errMsg(err)}`);
    }
  }
  return out;
}

/**
 * Đổi tên webm Playwright vừa ghi thành video.webm. File còn bị giữ (Playwright / phần mềm quét chưa nhả) thì thử lại; vẫn không
 * được thì dùng nguyên file cũ (cùng thư mục run). Không bao giờ ném lỗi — lỗi video không được làm mất kết quả kiểm thử.
 */
async function moveVideo(raw, target, { print = console.log, attempts = 10, waitMs = 3000, rename = fs.renameSync } = {}) {
  if (path.resolve(raw) === path.resolve(target)) return target;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rename(raw, target);
      return target;
    } catch (err) {
      if (attempt === attempts) {
        print(`   ⚠ không đổi tên được video (${err.code || err.message}) — dùng nguyên file ${path.basename(raw)}`);
        return raw;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return raw;
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
  const cleanups = [];
  const extraContexts = [];
  const tempProfiles = [];
  const qcDb = createQcDb({ profile, targetUrl: config.TARGET_URL, print });
  let videoT0 = null;
  let trace = null;
  const pace = paceFor(opts.record);
  const timeoutMs = (opts.caseTimeoutSec || script.meta.timeoutSec) * 1000;
  // E2E_TRACE=0: phiên tái hiện AI-QC chạy nháp hàng chục lần, chỉ đọc *.fail.md + dump — trace làm chậm mỗi lần
  const traceOn = opts.trace !== false && process.env.E2E_TRACE !== '0';
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
    videoT0 = Date.now();
    collector = attachCollectors(page);
    collector.reset();

    // Khởi động (vào app, đúng tổ chức) — phần này bị cắt khỏi đầu video.
    const doWarmUp = opts.warmUp || warmUp;
    const warmUrl = warmUpUrl(script, caseId);
    await guardRun(Promise.resolve().then(() => doWarmUp(page, profile, warmUrl)), { timeoutMs: 60000, signal, label: 'khởi động (vào app)' });
    record.trimMs = Date.now() - videoT0;

    // Lượt quay video: mỗi thao tác trên trang chính thành 1 dòng chú thích dưới video, con trỏ lướt chậm tới trước (action_trace)
    if (opts.record) {
      if (!(await installActionHooks(page))) print('   ⚠ không bật được chú thích thao tác — video chỉ có phụ đề bước');
      trace = createActionTrace({ page, t0: videoT0, cursorMs: pace.cursorMs, pauseMs: pace.actionPauseMs });
      page.__fastdoTrace = trace;
    }

    stepLog = createStepLog({ t0: videoT0, onEvent: emit, print, stepPauseMs: pace.stepPauseMs });
    // ctx.as(tên hồ sơ): thêm 1 trang của tài khoản khác cùng lúc — dữ liệu cần nhiều vai trò (người tạo ≠ người duyệt…)
    const openAs = async (name, { url } = {}) => {
      // tài khoản vừa tạo bằng ctx.db.createAccount → hồ sơ tạm (file phiên xoá khi case xong); còn lại = hồ sơ trong .env
      const temp = name && typeof name === 'object';
      const other = temp
        ? { name: String(name.name), email: String(name.email), password: String(name.password), org: name.org || profile.org }
        : getProfile(String(name || '').trim().toLowerCase());
      if (temp) tempProfiles.push(other);
      const storageState = await ensureProfileSession(browser, other);
      const extra = await browser.newContext({ viewport: VIEWPORT, storageState });
      extraContexts.push(extra);
      await extra.addInitScript({ content: CURSOR_CSS_AND_JS });
      const otherPage = guardPage(await extra.newPage());
      otherPage.__fastdoOrg = other.org;
      await warmUp(otherPage, other, url);
      print(`   ⇄ mở thêm trang của hồ sơ ${other.name}`);
      return { page: otherPage, profile: { name: other.name, org: other.org }, close: () => extra.close().catch(() => {}) };
    };
    const ctx = createCtx({ page, context, browser, profile, signal, stepLog, runDir, caseId, log: print, cleanups, openAs, db: qcDb.api });
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
  // Video dừng ở đây — phần báo lỗi / dọn dẹp phía sau bị cắt khỏi video (video_post)
  if (videoT0 != null) record.videoEndMs = Date.now() - videoT0;
  if (page) page.__fastdoTrace = null;
  record.actions = trace ? trace.actions.filter((a) => a.text) : [];

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

  // Dọn sau case (trả lại cài đặt đã đổi ở B0…) — sau báo lỗi để báo lỗi còn thấy đúng màn hình lúc hỏng
  if (page && cleanups.length) record.cleanup = await runCleanups(cleanups, { print });
  for (const extra of extraContexts) await withTimeout(extra.close().catch(() => {}), 10000);
  // Hoàn tác dữ liệu ctx.db đã ghi vào Mongo QC (xoá bản tạo, khôi phục bản sửa, xoá tài khoản tạm)
  if (qcDb.used()) {
    const restored = await withTimeout(qcDb.restoreAll(), CLEANUP_TIMEOUT_MS, [
      { label: 'Mongo QC: hoàn tác', ok: false, error: `quá ${CLEANUP_TIMEOUT_MS / 1000}s` },
    ]);
    record.cleanup = [...(record.cleanup || []), ...restored];
    restored.filter((item) => !item.ok).forEach((item) => print(`   ⚠ ${item.label} ← ${item.error}`));
  }
  for (const temp of tempProfiles) {
    try {
      fs.unlinkSync(storagePathOf(temp));
    } catch {
      // chưa đăng nhập được thì chưa có file phiên
    }
  }

  if (context) {
    const keepTrace = traceOn && record.verdict !== 'DAT' && record.verdict !== 'DA_HUY';
    if (traceOn) await withTimeout(context.tracing.stop(keepTrace ? { path: tracePath } : undefined).catch(() => {}), 20000);
    if (keepTrace && fs.existsSync(tracePath)) record.trace = tracePath;
    const video = page && opts.record ? page.video() : null;
    // mốc đóng context (= hết video) — video_post đo độ trễ bắt đầu quay của webm theo mốc này
    if (videoT0 != null) record.videoCloseMs = Date.now() - videoT0;
    // Có quay video: đóng context = Playwright mã hoá nốt khung hình còn đợi. Case đứng yên lâu (chờ giờ nhắc ~11 phút, ticket 1338)
    // dồn cả chục nghìn khung — 20s không đủ, file webm còn bị giữ lúc đổi tên → EBUSY làm chết cả lượt chạy, không có bản kê
    await withTimeout(context.close().catch(() => {}), video ? VIDEO_CLOSE_TIMEOUT_MS : 20000);
    if (video) {
      const raw = await withTimeout(video.path().catch(() => null), 10000);
      if (raw && fs.existsSync(raw)) {
        const webm = await moveVideo(raw, path.join(runDir, 'video.webm'), { print });
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

module.exports = { runCase, guardRun, checkContract, withTimeout, runCleanups, warmUpUrl, moveVideo };
