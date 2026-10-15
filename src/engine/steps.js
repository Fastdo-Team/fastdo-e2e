// ============================================================================
// steps.js: nhật ký bước của 1 case — thành dòng ✓/✗ trong ô Kết quả và mốc phụ đề video.
//
//   ctx.mark('B2 Mở mẫu Nháp')        mở bước mới ngay tại dòng này (đóng bước trước là ✓)
//   await ctx.step('B3 …', async fn)  bước bọc quanh 1 hàm; hàm ném lỗi → bước ✗
//   ctx.check('Banner chỉ xem', ok, { expected, actual })   ghi nhận 1 phép kiểm
//
// mark() dùng để port kịch bản cũ mà không phải bọc code vào hàm (bọc sẽ đổi phạm vi biến).
// Bước là PHẲNG — không lồng step trong step.
// ============================================================================

/**
 * @param {object} o
 * @param {number} [o.stepPauseMs] dừng hình sau mỗi bước ctx.step ĐẠT (video_pace — chỉ khi quay video); không tính vào thời gian bước
 */
function createStepLog({
  t0 = Date.now(),
  clock = () => Date.now(),
  onEvent = () => {},
  print = console.log,
  stepPauseMs = 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const steps = [];
  const checks = [];
  let open = null;

  const now = () => clock() - t0;

  function closeOpen(ok, error) {
    if (!open) return;
    open.endMs = now();
    open.ok = ok;
    open.seconds = (open.endMs - open.startMs) / 1000;
    if (error) open.error = String(error);
    onEvent({ ev: 'case.step', index: open.index, label: open.label, status: ok ? 'ok' : 'fail', ms: open.endMs });
    print(`   ${ok ? '✓' : '✗'} ${open.label}  ${open.seconds.toFixed(1)}s${error ? `  ← ${error}` : ''}`);
    open = null;
  }

  function mark(label) {
    closeOpen(true);
    open = { index: steps.length + 1, label: String(label), startMs: now(), endMs: null, ok: null, seconds: 0 };
    steps.push(open);
    onEvent({ ev: 'case.step', index: open.index, label: open.label, status: 'start', ms: open.startMs });
  }

  async function step(label, fn) {
    mark(label);
    try {
      const result = await fn();
      closeOpen(true);
      if (stepPauseMs > 0) await sleep(stepPauseMs);
      return result;
    } catch (err) {
      closeOpen(false, err && err.message ? err.message : String(err));
      throw err;
    }
  }

  function check(label, ok, detail = {}) {
    const item = { label: String(label), ok: Boolean(ok), expected: detail.expected, actual: detail.actual };
    checks.push(item);
    print(`   ${item.ok ? '✓' : '✗'} kiểm: ${item.label}`);
    return item.ok;
  }

  /** Kết thúc case: bước còn mở là ✓ nếu không có lỗi, ✗ nếu có */
  function finish(error) {
    if (open) closeOpen(!error, error);
  }

  const failedChecks = () => checks.filter((c) => !c.ok);

  return { steps, checks, mark, step, check, finish, failedChecks };
}

module.exports = { createStepLog };
