// ============================================================================
// ctx.js: hợp đồng ctx v2 truyền cho run(ctx) của kịch bản.
//
// Giữ ĐÚNG chữ ký cũ click(p, el, opt) / type(p, el, text) / waitXPath(p, xp, to) /
// clickUntil / setFlatpickr (p bỏ trống = page) để kịch bản cũ port ít đổi nhất; thêm
// step / mark / check / log / signal / profile.
// ============================================================================

const path = require('path');
const config = require('../config');
const { humanClick, humanType, waitXPath, clickUntil } = require('../core/cursor_motion');
const { setFlatpickrField } = require('../core/datetime_picker');
const { digestToFile } = require('../core/dom_digest');

function createCtx({ page, context, browser, profile, signal, stepLog, runDir, caseId, log = console.log }) {
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
