// ============================================================================
// valid_snapshot.js: giữ bản kịch bản của lần CHẠY NHÁP HỢP LỆ gần nhất mỗi case trong 1 phiên tái hiện AI-QC.
//
// Ticket 1308 (server, 2026-10-16): AI01 chạy nháp lượt 7 ra Không đạt hợp lệ, AI sửa tiếp làm hỏng ở lượt 8 rồi hết lượt →
// chưa đánh dấu ready → agent không chạy chính thức case chính → kết luận nhầm «không tái hiện được». Nay mỗi lần chạy nháp ra
// kết quả hợp lệ, runner chép kịch bản vào <sổ chạy nháp>.valid/; hết phiên, agent gọi `aiqc restore-valid` để case chưa sẵn
// sàng dùng lại bản đó (đặt ready: true — bản đó đúng là đã chạy nháp ra kết quả hợp lệ).
// Chỉ hoạt động khi có AIQC_DRY_LEDGER (agent đặt cho phiên tái hiện) — QC chạy tay không bị ảnh hưởng.
// ============================================================================

const fs = require('fs');
const path = require('path');

const READY_FALSE_RE = /(^|[{,\s])(ready\s*:\s*)false\b/;
const EXPORTS_RE = /module\.exports\s*=\s*\{/;

/**
 * Kết quả chạy nháp HỢP LỆ — cùng luật với verdict hiệu lực của agent (QcRules.EffectiveResult), chặt hơn ở chỗ mọi bước phải
 * đạt cả khi Đạt: không lỗi / huỷ, mọi bước ok; Đạt cần ≥1 phép kiểm, Không đạt cần ≥1 phép kiểm sai.
 */
function isValidResult(record) {
  if (!record || record.error || record.cancelled) return false;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (steps.some((step) => step.ok !== true)) return false;
  const checks = Array.isArray(record.checks) ? record.checks : [];
  if (record.verdict === 'DAT') return checks.length > 0;
  if (record.verdict === 'KHONG_DAT') return checks.some((check) => !check.ok);
  return false;
}

/** Thư mục giữ bản hợp lệ của 1 phiên: <sổ>.valid (cạnh file sổ chạy nháp) */
function snapshotDirOf(ledger) {
  return String(ledger).replace(/\.json$/i, '') + '.valid';
}

function readIndex(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Sau 1 lệnh chạy nháp: chép kịch bản của các case ra kết quả hợp lệ vào thư mục bản hợp lệ của phiên.
 * @param {object[]} records  kết quả runBatch
 * @param {Object<string, number>} counts  số lần chạy nháp mỗi case (dry_budget) — ghi lại lượt nào hợp lệ
 * @param {(caseId: string) => string|null} findFile  đường dẫn file kịch bản theo mã case
 * @returns {{id: string, run: number|null, verdict: string}[]} các case vừa lưu
 */
function saveValidSnapshots(records, counts, findFile, env = process.env) {
  const ledger = String(env.AIQC_DRY_LEDGER || '').trim();
  if (!ledger) return [];
  const dir = snapshotDirOf(ledger);
  const index = readIndex(dir);
  const saved = [];
  for (const record of records || []) {
    if (!isValidResult(record)) continue;
    const id = String(record.testcaseId || '').toUpperCase();
    const file = id && findFile(id);
    if (!file || !fs.existsSync(file)) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, path.basename(file)));
    index[id] = { run: (counts && counts[id]) || null, verdict: record.verdict, file: path.basename(file), savedAt: new Date().toISOString() };
    saved.push({ id, run: index[id].run, verdict: record.verdict });
  }
  if (saved.length) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  return saved;
}

/** Đặt ready: true trong mã nguồn kịch bản (đổi ready: false, hoặc thêm ngay sau `module.exports = {` nếu chưa có) */
function markReady(source) {
  if (READY_FALSE_RE.test(source)) return source.replace(READY_FALSE_RE, '$1$2true');
  if (/(^|[{,\s])ready\s*:\s*true\b/.test(source)) return source;
  return source.replace(EXPORTS_RE, (head) => `${head}\n  ready: true, // agent: dùng bản chạy nháp hợp lệ gần nhất\n`);
}

/**
 * Hết phiên tái hiện: case chưa sẵn sàng (ready khác true hoặc sai khai báo) mà có bản hợp lệ trong phiên → chép bản đó đè lên
 * kịch bản hiện tại + ready: true.
 * @param {{id: string, ready: boolean, problems: string[]}[]} scripts  listTicketScripts của ticket
 * @param {string} ledger  file sổ chạy nháp của phiên
 * @param {string} ticketsDir  thư mục src/testcases/tickets
 * @returns {{id: string, run: number|null, verdict: string}[]} các case đã khôi phục
 */
function restoreValidSnapshots(scripts, ledger, ticketsDir) {
  const dir = snapshotDirOf(ledger);
  const index = readIndex(dir);
  const restored = [];
  for (const script of scripts || []) {
    if (script.ready && !(script.problems || []).length) continue;
    const entry = index[script.id];
    const snapshot = entry && path.join(dir, entry.file || `${script.id.toLowerCase()}.test.js`);
    if (!snapshot || !fs.existsSync(snapshot)) continue;
    const target = path.join(ticketsDir, path.basename(snapshot));
    fs.writeFileSync(target, markReady(fs.readFileSync(snapshot, 'utf8')), 'utf8');
    restored.push({ id: script.id, run: entry.run || null, verdict: entry.verdict || '' });
  }
  return restored;
}

module.exports = { isValidResult, snapshotDirOf, saveValidSnapshots, restoreValidSnapshots, markReady };
