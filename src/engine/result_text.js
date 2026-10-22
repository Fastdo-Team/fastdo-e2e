// ============================================================================
// result_text.js: dựng đoạn nối vào ô "Kết quả thực hiện" và các giá trị ngày.
//
//   [Tự động] 25/09/2026 14:32 · vòng 3 · hồ sơ default · #a1b2c3d4
//   ✓ B1 Mở tab Mẫu đánh giá
//   ✗ B3 Bấm Kích hoạt ← hệ thống chặn: "…"
//   • Banner chỉ xem: không (mong muốn: có) ✗
//   Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — <resultText của kịch bản>
//   - Video Test Record: https://drive.google.com/file/d/xxxxxx/view
//
// "#a1b2c3d4" = 8 ký tự đầu của runId — dấu để chống ghi trùng: ô đã chứa dấu này
// nghĩa là lần chạy đó đã được ghi, thử ghi lại bao nhiêu lần cũng không nhân đôi.
// Dòng "- Video Test Record:" giữ đúng chữ cũ để QC và công thức sẵn có vẫn nhận ra.
// ============================================================================

const two = (n) => String(n).padStart(2, '0');

function formatDate(value) {
  const d = new Date(value);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(value) {
  const d = new Date(value);
  return `${formatDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Số ngày kiểu Google Sheets (mốc 30/12/1899) của NGÀY theo giờ máy — ô Test Date là số */
function toSheetsDateSerial(value) {
  const d = new Date(value);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

function runTag(runId) {
  const core = String(runId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  if (core.length < 8) {
    throw new Error(`runId "${runId}" quá ngắn để làm dấu chống ghi trùng (cần ≥ 8 ký tự chữ/số)`);
  }
  return `#${core}`;
}

function shorten(value, max = 120) {
  const flat = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function verdictLabel(pass, reviewCause) {
  if (pass) return 'ĐẠT';
  return reviewCause === 'app' ? 'KHÔNG ĐẠT (QC xác nhận lỗi app)' : 'KHÔNG ĐẠT';
}

function buildResultEntry({
  runId,
  startedAt,
  round,
  profile,
  steps = [],
  checks = [],
  pass,
  reviewCause,
  resultText,
  videoUrl,
}) {
  const lines = [
    `[Tự động] ${formatDateTime(startedAt)} · vòng ${round} · hồ sơ ${profile || 'default'} · ${runTag(runId)}`,
  ];
  for (const s of steps) {
    lines.push(
      s.ok
        ? `✓ ${shorten(s.label, 200)}`
        : `✗ ${shorten(s.label, 200)}${s.error ? ` ← ${shorten(s.error)}` : ''}`
    );
  }
  for (const c of checks) {
    const hasDetail = c.actual !== undefined || c.expected !== undefined;
    const detail = hasDetail
      ? `: ${c.actual === undefined ? '(không rõ)' : shorten(c.actual, 80)}` +
        (c.expected === undefined ? '' : ` (mong muốn: ${shorten(c.expected, 80)})`)
      : '';
    lines.push(`• ${shorten(c.label, 120)}${detail} ${c.ok ? '✓' : '✗'}`);
  }
  const text = String(resultText == null ? '' : resultText).trim();
  const verdict = verdictLabel(pass, reviewCause);
  lines.push(text ? `Kết luận: ${verdict} — ${text}` : `Kết luận: ${verdict}`);
  if (videoUrl) lines.push(`- Video Test Record: ${videoUrl}`);
  return lines.join('\n');
}

const AUTO_HEADER_RE = /\[Tự động\] (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})([^\n]*)/g;

/**
 * Các đoạn "[Tự động] …" đã có trong 1 ô Kết quả: thời điểm chạy (theo phút, giờ máy)
 * + dấu #runId. Dùng để biết ô đã có kết quả của lần chạy MỚI HƠN chưa.
 */
function parseAutoEntries(text) {
  const out = [];
  const re = new RegExp(AUTO_HEADER_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text == null ? '' : text))) !== null) {
    const [, dd, mm, yyyy, hh, mi, rest] = m;
    const tag = (/#[a-z0-9]{8}\b/.exec(rest) || [null])[0];
    out.push({ at: new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)), tag, index: m.index });
  }
  return out;
}

/** Phút tuyệt đối của 1 thời điểm — so "mới hơn" đúng độ chính xác của dòng [Tự động] */
const minuteOf = (value) => Math.floor(new Date(value).getTime() / 60000);

module.exports = {
  formatDate,
  formatDateTime,
  toSheetsDateSerial,
  runTag,
  shorten,
  verdictLabel,
  buildResultEntry,
  parseAutoEntries,
  minuteOf,
};
