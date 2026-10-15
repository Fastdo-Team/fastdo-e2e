// ============================================================================
// video_pace.js: nhịp quay video cho người xem — CHỈ áp dụng khi lượt chạy có quay video.
//
//   VIDEO_SLOWMO_MS      Playwright chờ thêm sau MỖI thao tác (bấm, gõ, chọn…) — thao tác chậm lại, dễ theo dõi
//   VIDEO_STEP_PAUSE_MS  dừng hình sau mỗi bước ctx.step(…) — kịp nhìn kết quả từng bước
//   VIDEO_END_HOLD_MS    giữ khung cuối trước khi đóng video — kịp nhìn kết quả cuối cùng
//
// Mặc định 0 = như cũ (không làm chậm). Agent AI-QC đặt các biến này qua E2E.Env của agent-settings.json.
// Chặn trên 5000 ms để cấu hình nhầm không kéo 1 case thành nhiều phút.
// ============================================================================

const MAX_MS = 5000;

function readMs(env, name) {
  const n = parseInt(env[name], 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_MS) : 0;
}

/** @returns {{ slowMoMs: number, stepPauseMs: number, endHoldMs: number }} */
function videoPace(env = process.env) {
  return {
    slowMoMs: readMs(env, 'VIDEO_SLOWMO_MS'),
    stepPauseMs: readMs(env, 'VIDEO_STEP_PAUSE_MS'),
    endHoldMs: readMs(env, 'VIDEO_END_HOLD_MS'),
  };
}

/** Nhịp thật của 1 lượt: không quay video thì không làm chậm gì */
function paceFor(record, env = process.env) {
  return record ? videoPace(env) : { slowMoMs: 0, stepPauseMs: 0, endHoldMs: 0 };
}

module.exports = { videoPace, paceFor, MAX_MS };
