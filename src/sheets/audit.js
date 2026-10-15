// ============================================================================
// audit.js: nhật ký mọi lần ghi Sheet (runs/.sheet-audit.ndjson) + hoàn tác.
//
// Một lần ghi = nhiều dòng NDJSON (file chỉ nối thêm, không sửa dòng cũ):
//   write   ghi TRƯỚC khi gửi lên API: bản chụp "trước" + giá trị định gửi của từng ô —
//           mất mạng giữa chừng vẫn còn đường hoàn tác;
//   verify  sau khi đọc lại: bản chụp "sau" thật + khớp/lệch;
//   abort   API từ chối cả lượt (HTTP 400 — batchUpdate là nguyên khối, không ô nào bị ghi);
//   undo    đã hoàn tác.
// Hoàn tác chỉ chạy khi: đúng mã case vẫn ở dòng đó (cột A), MỌI ô vẫn đúng bằng giá trị
// tool đã ghi, và không còn lần ghi mới hơn chạm cùng ô chưa hoàn tác (hoàn tác từ mới về
// cũ). Thiếu 1 điều kiện là không ghi ô nào — không bao giờ để dòng ở trạng thái nửa vời.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cellRange, a1Of } = require('./a1');
const C = require('./cell_values');

function newAuditId(date = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  const d = new Date(date);
  return (
    `w${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-` +
    `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-` +
    crypto.randomBytes(3).toString('hex')
  );
}

function createAuditLog(filePath) {
  return {
    filePath,
    append(entry) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      return entry;
    },
    list() {
      if (!fs.existsSync(filePath)) return [];
      return fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    find(auditId) {
      return this.list().find((e) => e.auditId === auditId) || null;
    },
  };
}

/**
 * Trạng thái gộp của 1 lần ghi. verified: true/false theo lần đọc lại, null = chưa đọc
 * lại được (mất mạng sau khi gửi) hoặc bị từ chối.
 */
function writeStatus(list, auditId) {
  let write = null;
  let verify = null;
  let abort = null;
  let undo = null;
  for (const e of list) {
    if (e.kind === 'write' && e.auditId === auditId) write = e;
    else if (e.kind === 'verify' && e.verifyOf === auditId) verify = e;
    else if (e.kind === 'abort' && e.abortOf === auditId) abort = e;
    else if (e.kind === 'undo' && e.undoOf === auditId) undo = e;
  }
  let verified = null;
  if (verify) verified = verify.verified;
  else if (write && typeof write.verified === 'boolean') verified = write.verified; // nhật ký kiểu cũ
  return { write, verify, abort, undo, verified };
}

/** Lần ghi gần nhất (không bị API từ chối) của 1 runId trên 1 tab — cho nhánh "đã ghi từ trước" */
function latestWriteFor(list, { runId, gid }) {
  const writes = list.filter((e) => e.kind === 'write' && e.runId === runId && e.tab && e.tab.gid === gid);
  for (let i = writes.length - 1; i >= 0; i -= 1) {
    const st = writeStatus(list, writes[i].auditId);
    if (!st.abort) return st;
  }
  return null;
}

/** Giá trị "sau khi ghi" của 1 ô: bản đọc lại (chính xác) hoặc giá trị đã gửi (chỉ so giá trị) */
function afterOf(status, cell) {
  if (status.verify) {
    const v = (status.verify.cells || []).find((x) => x.a1 === cell.a1);
    if (v) return { snap: v.after || {}, exact: true };
  }
  if (cell.after) return { snap: cell.after, exact: true }; // nhật ký kiểu cũ
  return { snap: cell.sent || {}, exact: false };
}

const shortText = (cell) => {
  const t = C.cellText(cell) || String((cell && cell.formattedValue) || '');
  const flat = t.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
};

const sameRuns = (a, b) =>
  JSON.stringify((a && a.textFormatRuns) || []) === JSON.stringify((b && b.textFormatRuns) || []);

// Nhật ký cũ không có spreadsheetId: coi như cùng Sheet (chặn thừa còn hơn bỏ sót).
const sameSheet = (a, b) => !a.spreadsheetId || !b.spreadsheetId || a.spreadsheetId === b.spreadsheetId;

/** Các lần ghi SAU `entry` chạm cùng ô hoặc cùng case + vòng, chưa hoàn tác, không bị từ chối */
function laterWritesBlocking(list, entry) {
  const idx = list.indexOf(entry);
  const cells = new Set(entry.cells.map((c) => c.a1));
  return list.slice(idx + 1).filter((e) => {
    if (e.kind !== 'write' || !e.tab || e.tab.gid !== entry.tab.gid || !sameSheet(e, entry)) return false;
    const touches = (e.caseId === entry.caseId && e.round === entry.round) || e.cells.some((c) => cells.has(c.a1));
    if (!touches) return false;
    const st = writeStatus(list, e.auditId);
    return !st.abort && !st.undo;
  });
}

/**
 * Hoàn tác 1 lần ghi — tất cả hoặc không ô nào.
 * @param {object} o
 * @param {object} o.client
 * @param {object} o.auditLog
 * @param {string} o.auditId
 * @param {string} o.tabTitle  tên HIỆN TẠI của tab (tra theo gid trong nhật ký — tab có thể đã đổi tên)
 * @returns {Promise<{undoId, restored: string[], refused: {a1, reason}[], verified: boolean|null, blocked: boolean, runDir}>}
 *   blocked = true: không ghi ô nào (có ô đã bị sửa sau lần ghi) — `refused` nói ô nào.
 */
async function undoWrite({ client, auditLog, auditId, tabTitle, reviewer = null, now = () => new Date() }) {
  const list = auditLog.list();
  const st = writeStatus(list, auditId);
  const entry = st.write;
  if (!entry) {
    const other = list.find((e) => e.auditId === auditId);
    if (other) throw new Error(`${auditId} không phải một lần ghi (là "${other.kind}").`);
    throw new Error(`Không có lần ghi ${auditId} trong nhật ký ${auditLog.filePath}.`);
  }
  if (st.abort) {
    throw new Error(`Lần ghi ${auditId} đã bị API từ chối (${st.abort.reason}) — Sheet không bị ghi, không có gì để hoàn tác.`);
  }
  if (st.undo) throw new Error(`Lần ghi ${auditId} đã được hoàn tác lúc ${st.undo.at} (${st.undo.auditId}).`);

  const blockers = laterWritesBlocking(list, entry);
  if (blockers.length) {
    throw new Error(
      `[AN TOÀN] Sau lần ghi ${auditId} còn ${blockers.length} lần ghi mới hơn vào cùng ô / cùng case + vòng ` +
        `chưa hoàn tác: ${blockers.map((b) => `${b.auditId} (${b.at})`).join(', ')}. Hoàn tác từ lần MỚI NHẤT trước.`
    );
  }

  const title = tabTitle || entry.tab.title;
  const gid = entry.tab.gid;
  const idA1 = entry.id && entry.id.a1 ? entry.id.a1 : a1Of(entry.row - 1, 0);
  const live = await client.readCells([cellRange(title, idA1), ...entry.cells.map((c) => cellRange(title, c.a1))], { gid });

  // Dòng đã bị chèn / xoá / sắp xếp lại: các ô đó giờ thuộc case khác — không đụng vào.
  const liveId = (C.cellText(live[0]) || String((live[0] && live[0].formattedValue) || '')).trim();
  if (liveId.toUpperCase() !== String(entry.caseId).trim().toUpperCase()) {
    throw new Error(
      `[AN TOÀN] Ô ${idA1} hiện là "${liveId}", không phải ${entry.caseId} — dòng đã bị chèn/xoá/sắp xếp lại ` +
        'sau lần ghi. Không hoàn tác ô nào; nếu cần thì sửa tay theo nhật ký.'
    );
  }

  const refused = [];
  entry.cells.forEach((c, i) => {
    const cur = C.snapshot(live[i + 1]);
    const exp = afterOf(st, c);
    const same = C.sameValue(cur, exp.snap) && (!exp.exact || sameRuns(cur, exp.snap));
    if (!same) refused.push({ a1: c.a1, reason: `ô đã bị sửa sau lần ghi (hiện: "${shortText(live[i + 1])}")` });
  });
  if (refused.length) {
    return { undoId: null, restored: [], refused, verified: null, blocked: true, runDir: entry.runDir || null };
  }

  await client.batchUpdate(
    entry.cells.map((c) => ({
      updateCells: {
        start: { sheetId: gid, rowIndex: entry.row - 1, columnIndex: c.col },
        rows: [{ values: [C.valueFromSnapshot(c.before)] }],
        fields: c.fields,
      },
    }))
  );

  let verified = null;
  let readError = null;
  try {
    const back = await client.readCells(entry.cells.map((c) => cellRange(title, c.a1)), { gid });
    verified = entry.cells.every((c, i) => C.sameValue(C.snapshot(back[i]), c.before));
  } catch (err) {
    readError = err;
  }

  const undo = auditLog.append({
    kind: 'undo',
    auditId: newAuditId(now()),
    undoOf: auditId,
    at: now().toISOString(),
    reviewer,
    spreadsheetId: entry.spreadsheetId || null,
    runId: entry.runId,
    runDir: entry.runDir || null,
    caseId: entry.caseId,
    round: entry.round,
    tab: { gid, title },
    row: entry.row,
    cells: entry.cells.map((c) => ({ key: c.key, a1: c.a1, col: c.col, fields: c.fields, before: afterOf(st, c).snap, after: c.before })),
    verified,
  });

  if (readError) {
    const err = new Error(`Đã trả các ô về như cũ nhưng không đọc lại được để kiểm (${readError.message}) — mở Sheet kiểm tay.`);
    err.undoId = undo.auditId;
    throw err;
  }
  return {
    undoId: undo.auditId,
    restored: entry.cells.map((c) => c.a1),
    refused: [],
    verified,
    blocked: false,
    runDir: entry.runDir || null,
  };
}

module.exports = { createAuditLog, undoWrite, newAuditId, writeStatus, latestWriteFor, laterWritesBlocking };
