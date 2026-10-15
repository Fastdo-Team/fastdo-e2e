// ============================================================================
// a1.js: địa chỉ ô kiểu A1 cho Sheets API — tên tab trong vùng phải bọc nháy đơn
// ("'V1 - fEvaluation - VIBE '!H256"), nhất là tên có dấu cách / gạch ngang.
// ============================================================================

const { colLetter } = require('../core/sheet_grid');

/** Tên tab trong A1: bọc nháy đơn, nhân đôi nháy đơn bên trong */
function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/** Vùng 1 ô: 'Tab'!H256 */
function cellRange(title, a1) {
  return `${quoteTab(title)}!${a1}`;
}

/** Địa chỉ ô từ chỉ số 0-based: (255, 7) → H256 */
function a1Of(rowIdx, colIdx) {
  return `${colLetter(colIdx)}${rowIdx + 1}`;
}

/**
 * Hiện dấu cách đầu/cuối thành ␠. Tên tab thật là "V1 - fEvaluation - VIBE " — nhìn
 * bằng mắt không thấy dấu cách cuối, nên thông báo lỗi phải cho thấy nó.
 */
function showSpaces(s) {
  const text = String(s == null ? '' : s);
  const lead = text.match(/^ */)[0].length;
  if (lead === text.length) return '␠'.repeat(text.length);
  const trail = text.match(/ *$/)[0].length;
  return '␠'.repeat(lead) + text.slice(lead, text.length - trail) + '␠'.repeat(trail);
}

module.exports = { quoteTab, cellRange, a1Of, showSpaces };
