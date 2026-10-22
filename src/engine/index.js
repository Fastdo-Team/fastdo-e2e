// ============================================================================
// engine/index.js: hàm thư viện cho CLI (runner.js) và server giao diện.
//
// Kỳ 2: chạy TUẦN TỰ 1 luồng; kỳ 3 thay vòng for bằng bộ lập lịch song song + chốt quy trình.
// Phiên đăng nhập hết hạn giữa lượt → đăng nhập lại hồ sơ đó rồi chạy lại case đúng 1 lần
// (thư mục -a2); mọi lỗi hạ tầng khác chưa tự chạy lại ở kỳ này.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { uploadToDrive } = require('../core/drive');
const { openSheet } = require('../sheets');
const { parseEnvLabels, resolveEnvLabel } = require('../sheets/env_label');
const { showSpaces } = require('../sheets/a1');
const { createBrowserPool } = require('./browser_pool');
const { paceFor } = require('./video_pace');
const { getProfile } = require('./profiles');
const { ensureProfileSession } = require('./app_session');
const { loadScript } = require('./script_meta');
const { runCase } = require('./case_runner');
const { renderCaseVideo } = require('./video_post');
const { createRecord, verdictOf, runDirName, writeRecord } = require('./result_v2');
const { writeSheetForRecord } = require('./sheet_step');

const RUNS_DIR = path.join(config.ROOT_DIR, 'runs');

function stamp(date = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

function countVerdicts(records) {
  const out = { DAT: 0, KHONG_DAT: 0, LOI_HA_TANG: 0, DA_HUY: 0 };
  for (const r of records) out[r.verdict] = (out[r.verdict] || 0) + 1;
  return out;
}

/** Ghi lại một case không chạy được (thiếu kịch bản / hồ sơ, sai khai báo, đăng nhập hỏng) */
function blockedRecord({ caseId, title, opts, profileName, envLabel, error, batchId }) {
  const runDir = path.join(
    RUNS_DIR,
    runDirName({ stamp: stamp(), caseId, mode: opts.mode, round: opts.round, profile: profileName, pid: process.pid, attempt: 1 })
  );
  const r = createRecord({
    caseId,
    title,
    runId: crypto.randomUUID(),
    batchId,
    mode: opts.mode,
    round: opts.round,
    profile: profileName,
    account: opts.account || 1,
    envLabel,
    targetUrl: config.TARGET_URL,
    runDir,
  });
  r.error = error;
  r.pass = false;
  r.resultText = `LỖI KHI CHẠY TEST: ${error}`;
  r.verdict = verdictOf(r);
  r.sheet = { state: 'skipped', reason: 'case không chạy được — không phải kết quả kiểm thử' };
  return writeRecord(r);
}

/**
 * Chạy một lượt. opts: { caseIds, mode: 'nhap'|'that', round, record, upload, sheet, sheetOn, row,
 * caseTimeoutSec, headless, profile (ép hồ sơ), account, trace }.
 * @returns {Promise<{records, timings, seconds, batchId}>}
 */
async function runBatch(opts, { print = console.log, onEvent = () => {}, signal } = {}) {
  const t0 = Date.now();
  const timings = [];
  const phase = async (label, fn) => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      timings.push({ label, seconds: (Date.now() - s) / 1000 });
    }
  };
  const batchId = `${stamp()}-lot-${process.pid}`;
  const envLabel = resolveEnvLabel(config.TARGET_URL, parseEnvLabels(config.ENV_LABELS));

  let sheet = null;
  if (opts.mode === 'that' && opts.sheet && opts.sheetOn !== 'never') {
    if (!envLabel) {
      throw new Error(
        `[AN TOÀN] Host của TARGET_URL (${config.TARGET_URL}) chưa có nhãn Môi trường. Khai ENV_LABELS trong .env rồi chạy lại.`
      );
    }
    const opened = await phase('Mở Google Sheet (API)', () => openSheet());
    opened.tab.warnings.forEach((w) => print(`[SHEET] ⚠ ${w}`));
    sheet = { tab: opened.tab, writer: opened.writer(), spreadsheetId: opened.client.spreadsheetId };
    print(`[SHEET] Ghi vào tab "${showSpaces(opened.tab.title)}" (gid ${opened.tab.gid}) · Môi trường "${envLabel}"`);
  }

  const pool = createBrowserPool({ headless: Boolean(opts.headless), slowMo: paceFor(opts.record).slowMoMs });
  const records = [];
  onEvent({ ev: 'batch.started', batchId, mode: opts.mode, round: opts.round, parallel: 1, cases: opts.caseIds });

  async function runOnce(script, profile, storagePath, attempt) {
    const runDir = path.join(
      RUNS_DIR,
      runDirName({ stamp: stamp(), caseId: script.meta.id, mode: opts.mode, round: opts.round, profile: profile.name, pid: process.pid, attempt })
    );
    const browser = await pool.get();
    return phase(`${script.meta.id} · các bước kiểm thử${attempt > 1 ? ` (lần ${attempt})` : ''}`, () =>
      runCase({ browser, script, profile, storagePath, runDir, opts, runId: crypto.randomUUID(), batchId, envLabel, attempt, onEvent, signal, print })
    );
  }

  /** Chạy trọn 1 case (nạp kịch bản → đăng nhập → chạy → hậu kỳ video → upload → Sheet → result.json); trả record của case */
  async function runOneCase(caseId) {
    const script = loadScript(caseId);
    const profileName = opts.profile || (script ? script.meta.profile : 'default');
    if (!script) {
      return blockedRecord({ caseId, opts, profileName, envLabel, batchId, error: `Chưa có kịch bản cho mã "${caseId}"` });
    }
    if (script.meta.problems.length) {
      return blockedRecord({
        caseId,
        title: script.meta.title,
        opts,
        profileName,
        envLabel,
        batchId,
        error: `[HỢP ĐỒNG KỊCH BẢN] ${script.meta.problems.join('; ')}`,
      });
    }
    let profile;
    let storagePath;
    try {
      profile = getProfile(profileName);
      const browser = await phase('Khởi tạo Chrome (Playwright)', () => pool.get());
      storagePath = await phase(`Đăng nhập hồ sơ ${profileName}`, () => ensureProfileSession(browser, profile));
    } catch (err) {
      return blockedRecord({ caseId, title: script.meta.title, opts, profileName, envLabel, batchId, error: err.message });
    }

    print('\n' + '-'.repeat(70));
    print(`[RUNNER] ▶ ${caseId} (${opts.mode === 'nhap' ? 'CHẠY NHÁP' : `Vòng test: LẦN ${opts.round}`}) · hồ sơ ${profile.name}`);
    print('-'.repeat(70));

    let record = await runOnce(script, profile, storagePath, 1);
    if (record.errorCode === 'SESSION_EXPIRED' && !(signal && signal.aborted)) {
      print(`[AUTH] Phiên của hồ sơ ${profile.name} hết hạn giữa lượt — đăng nhập lại rồi chạy lại ${caseId} (lần 2)`);
      writeRecord(record);
      try {
        storagePath = await phase(`Đăng nhập lại hồ sơ ${profile.name}`, async () =>
          ensureProfileSession(await pool.get(), profile, { force: true })
        );
        const first = record;
        record = await runOnce(script, profile, storagePath, 2);
        first.retriedAs = record.runDir;
        writeRecord(first);
      } catch (err) {
        record.error = `${record.error} · đăng nhập lại cũng hỏng: ${err.message}`;
      }
    }
    const label = { DAT: '✅ PASS', KHONG_DAT: '❌ FAIL', LOI_HA_TANG: '⚠ LỖI HẠ TẦNG', DA_HUY: '⏹ ĐÃ HUỶ' }[record.verdict];
    print(`[RUNNER] Kết quả test: ${label}${record.error ? ` — ${record.error}` : ''}`);

    if (record.video.webm) {
      try {
        const out = await phase(`${caseId} · hậu kỳ video`, () =>
          renderCaseVideo({
            runDir: record.runDir,
            // thường là video.webm; đổi tên lỗi (file còn bị giữ) thì case_runner giữ nguyên tên Playwright đặt
            webmName: path.basename(record.video.webm),
            mp4Name: `${caseId}_AutoRecord.mp4`,
            caseId,
            steps: record.steps,
            actions: record.actions,
            trimMs: record.trimMs,
            durationMs: record.durationMs,
            endMs: record.videoEndMs,
            closeMs: record.videoCloseMs,
          })
        );
        record.video.mp4 = out.mp4;
        record.video.vtt = out.vtt;
        record.videoPath = out.mp4;
      } catch (err) {
        print(`[VIDEO] ⚠ Hậu kỳ hỏng, dùng bản webm gốc: ${err.message}`);
      }
      if (record.video.mp4) {
        // mp4 đã có thì webm chỉ là bản thô — xoá lỗi (file còn bị giữ) không phải hậu kỳ hỏng
        try {
          fs.unlinkSync(record.video.webm);
          record.video.webm = null;
        } catch (err) {
          print(`[VIDEO] ⚠ Không xoá được bản webm thô (${err.code || err.message}) — giữ lại, video dùng bản mp4`);
        }
      }
      onEvent({ ev: 'case.video', caseId, mp4: record.videoPath, url: null });
    }

    // Chỉ upload video của kết quả kiểm thử thật (ĐẠT / KHÔNG ĐẠT) — video lỗi hạ tầng
    // hay bị huỷ không bao giờ lên Sheet, không đưa lên host công khai.
    const uploadable = record.verdict === 'DAT' || record.verdict === 'KHONG_DAT';
    if (opts.upload && record.videoPath && uploadable) {
      try {
        record.videoUrl = await phase(`${caseId} · upload Google Drive`, () =>
          uploadToDrive(record.videoPath, `${caseId}_AutoRecord${path.extname(record.videoPath)}`)
        );
        record.video.url = record.videoUrl;
        onEvent({ ev: 'case.video', caseId, mp4: record.videoPath, url: record.videoUrl });
      } catch (err) {
        print(`[ERROR] Upload Google Drive thất bại: ${err.message}`);
      }
    }

    record.sheet = await phase(`${caseId} · ghi Google Sheet`, () => writeSheetForRecord(record, { sheet, opts, print }));
    onEvent({ ev: 'case.sheet', caseId, state: record.sheet.state, cells: record.sheet.cells || null, reason: record.sheet.reason || null });
    writeRecord(record);
    return record;
  }

  try {
    for (const caseId of opts.caseIds) {
      if (signal && signal.aborted) break;
      try {
        records.push(await runOneCase(caseId));
      } catch (err) {
        // Lỗi ngoài dự kiến của 1 case (nạp kịch bản, mở lại Chrome, ghi result.json…) không được làm sập cả lượt: case sau vẫn chạy,
        // bản kê vẫn được ghi. Trước đây runBatch ném lỗi → runner không ghi bản kê → agent mất kết quả MỌI case của lượt.
        const message = err && err.message ? err.message : String(err);
        print(`[RUNNER] ✗ ${caseId}: lỗi khi chạy — ${message}`);
        try {
          records.push(
            blockedRecord({ caseId, opts, profileName: opts.profile || 'default', envLabel, batchId, error: `Lỗi khi chạy: ${message}` })
          );
        } catch (writeErr) {
          print(`[RUNNER] ✗ ${caseId}: không ghi được kết quả — ${writeErr && writeErr.message ? writeErr.message : writeErr}`);
        }
      }
    }
  } finally {
    await pool.close();
  }
  const seconds = (Date.now() - t0) / 1000;
  onEvent({ ev: 'batch.finished', batchId, seconds, counts: countVerdicts(records) });
  return { records, timings, seconds, batchId };
}

/** Đăng nhập lại từ đầu cho hồ sơ (npm run test:auth) */
async function relogin(profileName, { headless = false } = {}) {
  const profile = getProfile(profileName);
  const pool = createBrowserPool({ headless });
  try {
    return await ensureProfileSession(await pool.get(), profile, { force: true });
  } finally {
    await pool.close();
  }
}

module.exports = { runBatch, relogin, countVerdicts, RUNS_DIR, stamp };
