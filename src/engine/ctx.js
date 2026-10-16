// ============================================================================
// ctx.js: hợp đồng ctx v2 truyền cho run(ctx) của kịch bản.
//
// Giữ ĐÚNG chữ ký cũ click(p, el, opt) / type(p, el, text) / waitXPath(p, xp, to) /
// clickUntil / setFlatpickr (p bỏ trống = page) để kịch bản cũ port ít đổi nhất; thêm
// step / mark / check / log / signal / profile / cleanup / as / db.
// ============================================================================

const path = require('path');
const config = require('../config');
const { humanClick, humanType, waitXPath, clickUntil } = require('../core/cursor_motion');
const { setFlatpickrField } = require('../core/datetime_picker');
const { digestToFile } = require('../core/dom_digest');

function createCtx({
  page,
  context,
  browser,
  profile,
  signal,
  stepLog,
  runDir,
  caseId,
  log = console.log,
  cleanups = [],
  openAs = null,
  db = null,
}) {
  let dumpCount = 0;
  return {
    page,
    context,
    browser,
    signal,
    profile: { name: profile.name, org: profile.org },
    click: (p, el, opt) => humanClick(p || page, el, opt),
    type: (p, el, txt, opt) => humanType(p || page, el, txt, opt),
    waitXPath: (p, xp, to) => waitXPath(p || page, xp, to),
    clickUntil: (p, getEl, chk, opt) => clickUntil(p || page, getEl, chk, opt),
    setFlatpickr: (p, ph, d, h, m) => setFlatpickrField(p || page, ph, d, h, m),
    step: (label, fn) => stepLog.step(label, fn),
    mark: (label) => stepLog.mark(label),
    check: (label, ok, detail) => stepLog.check(label, ok, detail),
    log: (text) => log(`[${caseId}] ${text}`),
    // Việc dọn sau case (trả lại cài đặt công ty đã đổi ở B0, xoá dữ liệu tạm): engine chạy SAU khi case kết thúc — kể cả khi
    // lỗi — theo thứ tự ngược lúc đăng ký, ngoài phần video. Lỗi khi dọn không đổi kết quả case, chỉ ghi vào result.cleanup.
    // Dữ liệu thử ghi thẳng Mongo QC (qc_db.js): clone / insert / set / remove / createAccount / refreshCache — tự hoàn tác
    // khi case kết thúc. Chỉ có trong lượt AI-QC (agent đặt AIQC_MONGO_URI).
    db,
    // Mở thêm 1 trang đăng nhập bằng tài khoản khác — tên hồ sơ trong .env hoặc tài khoản từ ctx.db.createAccount — khi ticket
    // cần vai trò khác xác nhận trên giao diện: { page, profile, close }. Engine tự đóng khi case kết thúc. Trang phụ KHÔNG
    // được quay video — thao tác chính + phần kiểm để ở ctx.page.
    as: (name, opts) => {
      if (!openAs) throw new Error('ctx.as không dùng được ở chế độ này');
      return openAs(name, opts);
    },
    cleanup: (label, fn) => {
      if (typeof fn !== 'function') throw new Error('ctx.cleanup(label, fn): fn phải là hàm');
      cleanups.push({ label: String(label || 'dọn dẹp'), fn });
    },
    // Dump DOM ra text ngay tại dòng đang bí — không dừng test, không ném lỗi.
    dump: async (label) => {
      dumpCount += 1;
      const slug =
        String(label || 'dump')
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'dump';
      try {
        const { filePath } = await digestToFile(page, `${caseId}_dump_${dumpCount}_${slug}.txt`, { label, tables: true, dir: runDir });
        log(`[DUMP] ${label || ''} → ${path.relative(config.ROOT_DIR, filePath)}`);
        return filePath;
      } catch (err) {
        log(`[DUMP] thất bại: ${err.message}`);
        return null;
      }
    },
  };
}

module.exports = { createCtx };
