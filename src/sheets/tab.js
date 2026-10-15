// ============================================================================
// tab.js: chọn tab của Sheet. SHEET_GID là khoá chính; chỉ có SHEET_TAB thì tên phải
// khớp CHÍNH XÁC. Không bao giờ lùi về tab đầu tiên như endpoint gviz — đã thử thật
// ngày 2026-09-28: gviz trả tab đầu cho MỌI tên không khớp, kể cả tên bịa.
// ============================================================================

const { showSpaces } = require('./a1');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** "Tên␠" (gid 123), … — thông báo lỗi phải nói đúng tên thật */
function formatTabList(tabs) {
  return tabs.map((t) => `"${showSpaces(t.title)}" (gid ${t.gid})`).join(', ');
}

/**
 * @param {{tabs: {gid:number, title:string}[]}} meta  từ client.getMeta()
 * @param {{gid?: string, title?: string}} want       SHEET_GID / SHEET_TAB
 * @returns {{gid:number, title:string, warnings:string[]}}
 */
function resolveTab(meta, { gid, title } = {}) {
  const tabs = (meta && meta.tabs) || [];

  if (gid !== undefined && gid !== null && String(gid).trim() !== '') {
    const hit = tabs.find((t) => String(t.gid) === String(gid).trim());
    if (!hit) {
      throw new Error(`[AN TOÀN] Sheet không có tab nào có gid=${gid}. Các tab đang có: ${formatTabList(tabs)}.`);
    }
    const warnings = [];
    if (title && title !== hit.title) {
      warnings.push(
        `SHEET_TAB="${showSpaces(title)}" khác tên thật "${showSpaces(hit.title)}" — ` +
          `đang dùng tab theo SHEET_GID=${hit.gid}.`
      );
    }
    return { gid: hit.gid, title: hit.title, warnings };
  }

  if (!title) {
    throw new Error(
      '[AN TOÀN] Chưa chọn tab Sheet: khai SHEET_GID (khuyên dùng — số sau "gid=" trên link) ' +
        'hoặc SHEET_TAB trong .env.'
    );
  }

  const exact = tabs.find((t) => t.title === title);
  if (exact) return { gid: exact.gid, title: exact.title, warnings: [] };

  const near = tabs.filter((t) => norm(t.title) === norm(title) || norm(t.title).includes(norm(title)));
  throw new Error(
    `[AN TOÀN] Không có tab nào tên đúng "${showSpaces(title)}". Các tab đang có: ${formatTabList(tabs)}.` +
      (near.length
        ? ` Gần giống: ${near.map((t) => `"${showSpaces(t.title)}" → khai SHEET_GID=${t.gid}`).join('; ')}.`
        : '')
  );
}

module.exports = { resolveTab, formatTabList };
