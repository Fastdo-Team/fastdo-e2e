// ============================================================================
// result_v2.js: result.json phiên bản 2 — giữ MỌI trường v1 (giao diện cũ + commit đọc),
// thêm verdict, bước, phép kiểm, video, trace, mã băm, hồ sơ, lần thử.
// ============================================================================

const fs = require('fs');
const path = require('path');

const VERDICT = { DAT: 'DAT', KHONG_DAT: 'KHONG_DAT', LOI_HA_TANG: 'LOI_HA_TANG', DA_HUY: 'DA_HUY' };

function createRecord({
  caseId,
  title,
  runId,
  batchId,
  mode,
  round,
  profile,
  account = 1,
  envLabel,
  targetUrl,
  scriptHash,
  attempt = 1,
  runDir,
  flags,
}) {
  return {
    schema: 2,
    testcaseId: caseId,
    title: title || '',
    runId,
    batchId: batchId || null,
    mode,
    round: round || null,
    account,
    profile,
    envLabel: envLabel || null,
    targetUrl: targetUrl || '',
    scriptHash: scriptHash || null,
    attempt,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runDir,
    flags: flags || {},
    verdict: null,
    cancelled: false,
    pass: null,
    resultText: '',
    error: null,
    errorCode: null,
    diagnosis: null,
    steps: [],
    actions: [],
    checks: [],
    trimMs: 0,
    videoEndMs: null,
    videoCloseMs: null,
    cleanup: [],
    videoPath: null,
    videoUrl: null,
    video: { webm: null, mp4: null, url: null, vtt: null },
    trace: null,
    sheetCell: null,
    sheetStatus: null,
    sheet: { state: 'skipped', reason: 'chưa chạy tới bước ghi Sheet' },
    review: null,
    failReport: null,
    seconds: 0,
  };
}

function verdictOf(r) {
  if (r.cancelled) return VERDICT.DA_HUY;
  if (r.error) return VERDICT.LOI_HA_TANG;
  return r.pass === true ? VERDICT.DAT : VERDICT.KHONG_DAT;
}

function runDirName({ stamp, caseId, mode, round, profile, pid, attempt = 1 }) {
  return `${stamp}-${caseId}-${mode === 'nhap' ? 'nhap' : `v${round}`}-${profile}-${pid}-a${attempt}`;
}

function writeRecord(r) {
  r.finishedAt = r.finishedAt || new Date().toISOString();
  fs.mkdirSync(r.runDir, { recursive: true });
  fs.writeFileSync(path.join(r.runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');
  return r;
}

module.exports = { VERDICT, createRecord, verdictOf, runDirName, writeRecord };
