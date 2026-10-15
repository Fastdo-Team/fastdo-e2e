// ============================================================================
// cell_values.js: đọc/dựng giá trị 1 ô cho bộ ghi Sheet.
//
// Ô "Kết quả thực hiện" của QC là rich-text: chữ + các đoạn định dạng (textFormatRuns),
// trong đó có link. Ghi đè bằng giá trị thường sẽ xoá mất link. Nên phần nối thêm:
//   · giữ NGUYÊN chữ cũ từng ký tự (chỉ số các đoạn cũ tính theo chữ đó),
//   · gửi lại nguyên các đoạn cũ,
//   · thêm 1 đoạn định dạng trống ngay chỗ nối — không có nó, link cuối của nội dung cũ
//     "loang" sang cả phần mới,
//   · gắn link thật cho URL video.
// ============================================================================

const DATE_TYPES = new Set(['DATE', 'DATE_TIME']);

/** Danh sách giá trị cho phép của ô có danh sách chọn; null nếu ô không giới hạn */
function allowedValues(cell) {
  const dv = cell && cell.dataValidation;
  if (!dv || !dv.condition || dv.condition.type !== 'ONE_OF_LIST') return null;
  return (dv.condition.values || []).map((v) => String(v.userEnteredValue == null ? '' : v.userEnteredValue));
}

/** Chữ đang gõ trong ô ('' nếu ô trống, là số/bool/công thức) */
function cellText(cell) {
  const v = cell && cell.userEnteredValue;
  return v && v.stringValue !== undefined ? String(v.stringValue) : '';
}

function isFormula(cell) {
  return Boolean(cell && cell.userEnteredValue && cell.userEnteredValue.formulaValue !== undefined);
}

/** Ô đang chứa số / đúng-sai / lỗi (không phải chữ) — nối chữ vào sẽ làm mất giá trị đó */
function hasNonTextValue(cell) {
  const v = cell && cell.userEnteredValue;
  return Boolean(v && (v.numberValue !== undefined || v.boolValue !== undefined || v.errorValue !== undefined));
}

function hasChips(cell) {
  return Boolean(cell && Array.isArray(cell.chipRuns) && cell.chipRuns.length);
}

function hasDateFormat(cell) {
  const nf = cell && cell.userEnteredFormat && cell.userEnteredFormat.numberFormat;
  return Boolean(nf && DATE_TYPES.has(nf.type));
}

/** Định dạng của 1 đoạn, bỏ màu kiểu cũ khi đã có màu kiểu mới (API không nhận cả hai) */
function cleanFormat(format) {
  const f = { ...(format || {}) };
  if (f.foregroundColorStyle && f.foregroundColor) delete f.foregroundColor;
  return f;
}

/** Các đoạn định dạng để gửi lại: chỉ startIndex (bỏ khi = 0) + format */
function cleanRuns(runs) {
  return (runs || []).map((r) => {
    const out = {};
    if (r.startIndex) out.startIndex = r.startIndex;
    out.format = cleanFormat(r.format);
    return out;
  });
}

/**
 * Ô Kết quả mới = chữ cũ nguyên vẹn + dòng mới.
 * @returns {{ text: string, runs: object[], appendedAt: number, videoAt: number }}
 */
function buildAppendedResultCell(existingCell, entryText, videoUrl) {
  const oldText = cellText(existingCell);
  const sep = oldText && !oldText.endsWith('\n') ? '\n' : '';
  const appendedAt = oldText.length;
  const text = oldText + sep + entryText;
  const runs = cleanRuns(existingCell && existingCell.textFormatRuns);
  if (oldText) runs.push({ startIndex: appendedAt, format: {} });

  let videoAt = -1;
  if (videoUrl) {
    const rel = entryText.lastIndexOf(videoUrl);
    if (rel !== -1) {
      videoAt = appendedAt + sep.length + rel;
      runs.push({ startIndex: videoAt, format: { link: { uri: videoUrl } } });
      const end = videoAt + videoUrl.length;
      if (end < text.length) runs.push({ startIndex: end, format: {} });
    }
  }
  return { text, runs, appendedAt, videoAt };
}

/** Các link (vị trí + uri) trong 1 ô — để kiểm link cũ còn nguyên sau khi ghi */
function linkRuns(cell) {
  return ((cell && cell.textFormatRuns) || [])
    .filter((r) => r.format && r.format.link && r.format.link.uri)
    .map((r) => ({ at: r.startIndex || 0, uri: r.format.link.uri }));
}

/** Bản chụp 1 ô để ghi nhật ký / hoàn tác */
function snapshot(cell) {
  const out = {};
  if (cell && cell.userEnteredValue) out.userEnteredValue = cell.userEnteredValue;
  if (cell && cell.textFormatRuns && cell.textFormatRuns.length) out.textFormatRuns = cleanRuns(cell.textFormatRuns);
  const nf = cell && cell.userEnteredFormat && cell.userEnteredFormat.numberFormat;
  if (nf) out.numberFormat = nf;
  return out;
}

/** Hai ô có cùng giá trị gõ vào không (so cả kiểu: chữ '46280' khác số 46280) */
function sameValue(a, b) {
  const x = (a && a.userEnteredValue) || {};
  const y = (b && b.userEnteredValue) || {};
  return ['stringValue', 'numberValue', 'boolValue', 'formulaValue'].every((k) => x[k] === y[k]);
}

/** CellData để ghi lại từ 1 bản chụp (dùng cho hoàn tác) */
function valueFromSnapshot(snap) {
  const value = {};
  if (snap && snap.userEnteredValue) value.userEnteredValue = snap.userEnteredValue;
  if (snap && snap.textFormatRuns) value.textFormatRuns = snap.textFormatRuns;
  if (snap && snap.numberFormat) value.userEnteredFormat = { numberFormat: snap.numberFormat };
  return value;
}

module.exports = {
  allowedValues,
  cellText,
  isFormula,
  hasNonTextValue,
  hasChips,
  hasDateFormat,
  cleanRuns,
  buildAppendedResultCell,
  linkRuns,
  snapshot,
  sameValue,
  valueFromSnapshot,
};
