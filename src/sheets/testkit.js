// ============================================================================
// testkit.js: Sheet giả lập trong bộ nhớ + dữ liệu mẫu cho test bộ ghi / hoàn tác.
//
// Giả lập đúng những hành vi bộ ghi dựa vào: đọc lưới (chuỗi hiển thị), đọc chi tiết ô,
// updateCells theo mặt nạ `fields`, và chặn giá trị ngoài danh sách chọn strict như API
// thật (cả lượt thất bại, không ô nào bị ghi).
// ============================================================================

const os = require('os');
const path = require('path');
const { posKey, gidMismatchError } = require('./sheets_client');

const clone = (v) => JSON.parse(JSON.stringify(v));

function createFakeSheet({ title = 'V1 ', gid = 7, rows = [] } = {}) {
  const cells = new Map();
  const key = (r, c) => `${r}:${c}`;
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === undefined || v === null || v === '') return;
      cells.set(key(r, c), typeof v === 'object' ? clone(v) : { userEnteredValue: { stringValue: String(v) } });
    })
  );
  const calls = { readGrid: 0, readCells: 0, batchUpdate: [] };
  // servedGid: gid của tab mà TÊN `title` đang trỏ tới (khác gid = tab vừa bị đổi tên).
  // failReadCells: lỗi ném ở lần readCells thứ n ({ n, error }).
  const hooks = { beforeReadCells: null, afterUpdate: null, failUpdate: null, servedGid: null, failReadCells: null };

  const shown = (cell) => {
    const v = cell && cell.userEnteredValue;
    if (!v) return '';
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.numberValue !== undefined) return String(v.numberValue);
    if (v.boolValue !== undefined) return v.boolValue ? 'TRUE' : 'FALSE';
    return '';
  };
  const checkTitle = (t) => {
    if (t !== title) {
      const e = new Error(`[SHEET] giả lập: không có tab "${t}"`);
      e.status = 400;
      throw e;
    }
  };
  const tabOf = (range) => {
    const m = /^'((?:[^']|'')*)'!/.exec(range);
    return m ? m[1].replace(/''/g, "'") : '';
  };

  const client = {
    spreadsheetId: 'fake',
    saEmail: 'fake@sa',
    async readGrid(t) {
      checkTitle(t);
      calls.readGrid += 1;
      let maxR = -1;
      let maxC = -1;
      for (const k of cells.keys()) {
        const [r, c] = k.split(':').map(Number);
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
      const out = [];
      for (let r = 0; r <= maxR; r += 1) {
        const row = [];
        for (let c = 0; c <= maxC; c += 1) row.push(shown(cells.get(key(r, c))));
        while (row.length && row[row.length - 1] === '') row.pop();
        out.push(row);
      }
      return out;
    },
    async readCells(ranges, opts = {}) {
      calls.readCells += 1;
      if (hooks.beforeReadCells) await hooks.beforeReadCells(calls.readCells);
      if (hooks.failReadCells && hooks.failReadCells.n === calls.readCells) throw hooks.failReadCells.error;
      const served = hooks.servedGid === null ? gid : hooks.servedGid;
      if (opts.gid !== undefined && Number(opts.gid) !== served) throw gidMismatchError(Number(opts.gid), served);
      return ranges.map((rg) => {
        checkTitle(tabOf(rg));
        const cell = cells.get(posKey(rg));
        return cell ? clone(cell) : {};
      });
    },
    async batchUpdate(requests) {
      if (hooks.failUpdate) {
        const e = hooks.failUpdate;
        hooks.failUpdate = null;
        throw e;
      }
      for (const req of requests) {
        const u = req.updateCells;
        if (!u) continue;
        if (u.start.sheetId !== gid) {
          const e = new Error('[SHEET] giả lập: sai sheetId');
          e.status = 400;
          throw e;
        }
        const cur = cells.get(key(u.start.rowIndex, u.start.columnIndex)) || {};
        const val = u.rows[0].values[0];
        const dv = cur.dataValidation;
        const s = val.userEnteredValue && val.userEnteredValue.stringValue;
        if (dv && dv.strict && dv.condition.type === 'ONE_OF_LIST' && s !== undefined) {
          const allowed = dv.condition.values.map((x) => x.userEnteredValue);
          if (!allowed.includes(s)) {
            const e = new Error('[SHEET] ghi Sheet: HTTP 400 — Invalid value violates data validation');
            e.status = 400;
            throw e;
          }
        }
      }
      for (const req of requests) {
        const u = req.updateCells;
        if (!u) continue;
        const k = key(u.start.rowIndex, u.start.columnIndex);
        const cur = clone(cells.get(k) || {});
        const val = u.rows[0].values[0];
        for (const f of u.fields.split(',').map((x) => x.trim())) {
          if (f === 'userEnteredValue') {
            if (val.userEnteredValue) cur.userEnteredValue = clone(val.userEnteredValue);
            else delete cur.userEnteredValue;
          } else if (f === 'textFormatRuns') {
            if (val.textFormatRuns && val.textFormatRuns.length) cur.textFormatRuns = clone(val.textFormatRuns);
            else delete cur.textFormatRuns;
          } else if (f === 'userEnteredFormat.numberFormat') {
            const nf = val.userEnteredFormat && val.userEnteredFormat.numberFormat;
            cur.userEnteredFormat = cur.userEnteredFormat || {};
            if (nf) cur.userEnteredFormat.numberFormat = clone(nf);
            else delete cur.userEnteredFormat.numberFormat;
          } else {
            throw new Error(`giả lập: chưa hỗ trợ field ${f}`);
          }
        }
        cells.set(k, cur);
      }
      calls.batchUpdate.push(requests);
      if (hooks.afterUpdate) await hooks.afterUpdate();
      return { replies: [] };
    },
    async canEdit() {
      return true;
    },
  };

  return {
    title,
    gid,
    cells,
    calls,
    hooks,
    client,
    get: (a1) => clone(cells.get(posKey(`'x'!${a1}`)) || {}),
    set: (a1, cell) => cells.set(posKey(`'x'!${a1}`), clone(cell)),
  };
}

/** Chèn 1 dòng trống ở rowIdx (0-based): mọi ô từ dòng đó dời xuống 1 */
function insertRowAt(sheet, rowIdx) {
  const moved = new Map();
  for (const [k, v] of sheet.cells) {
    const [r, c] = k.split(':').map(Number);
    moved.set(r >= rowIdx ? `${r + 1}:${c}` : k, v);
  }
  sheet.cells.clear();
  for (const [k, v] of moved) sheet.cells.set(k, v);
}

/** Xoá cột colIdx (0-based): mọi ô bên phải dời sang trái 1 */
function deleteColumnAt(sheet, colIdx) {
  const moved = new Map();
  for (const [k, v] of sheet.cells) {
    const [r, c] = k.split(':').map(Number);
    if (c === colIdx) continue;
    moved.set(c > colIdx ? `${r}:${c - 1}` : k, v);
  }
  sheet.cells.clear();
  for (const [k, v] of moved) sheet.cells.set(k, v);
}

/** Chèn 1 cột trống ở colIdx (0-based): mọi ô từ cột đó dời sang phải 1 */
function insertColumnAt(sheet, colIdx) {
  const moved = new Map();
  for (const [k, v] of sheet.cells) {
    const [r, c] = k.split(':').map(Number);
    moved.set(c >= colIdx ? `${r}:${c + 1}` : k, v);
  }
  sheet.cells.clear();
  for (const [k, v] of moved) sheet.cells.set(k, v);
}

/** Đổi chỗ 2 dòng (QC sort lại) */
function swapRows(sheet, a, b) {
  const moved = new Map();
  for (const [k, v] of sheet.cells) {
    const [r, c] = k.split(':').map(Number);
    moved.set(r === a ? `${b}:${c}` : r === b ? `${a}:${c}` : k, v);
  }
  sheet.cells.clear();
  for (const [k, v] of moved) sheet.cells.set(k, v);
}

const STATUS_LIST = ['DONE', 'Fail', 'Doing', 'Cancel', 'Pending', 'Đề xuất'];
const ENV_LIST = ['Beta', 'Localhost', 'Production'];
const listDv = (values) => ({
  dataValidation: { strict: true, condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) } },
});
const DATE_FMT = { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } };

/**
 * Tab V1 thu nhỏ đúng bố cục thật: 3 dòng tiêu đề, vòng 1 rộng 7 cột có FEEDBACK AI,
 * vòng 2 bắt đầu cột M. Dòng 4 = EVAL_V1_001 đã có kết quả vòng 1 kèm link rich-text.
 */
function makeV1Sheet() {
  const header = ['DONE25', '', '', '', '', 'TEST LẦN 1', '', '', '', '', '', '', 'TEST LẦN 2'];
  const sub = [
    'ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng',
    'Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'FEEDBACK AI', 'FIXED', 'Test Date',
    'Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'FIXED', 'Test Date',
  ];
  const s = createFakeSheet({
    title: 'V1 - fEvaluation - VIBE ',
    gid: 1086276772,
    rows: [header, sub, ['TÊN TICKET'], ['EVAL_V1_001'], ['EVAL_V1_002']],
  });
  s.set('G4', { ...listDv(ENV_LIST), userEnteredValue: { stringValue: 'Localhost' } });
  s.set('H4', { ...listDv(STATUS_LIST), userEnteredValue: { stringValue: 'DONE' } });
  s.set('I4', {
    userEnteredValue: { stringValue: 'Link: https://jam.dev/c/1' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } }],
  });
  s.set('L4', { ...DATE_FMT, userEnteredValue: { numberValue: 46280 } });
  s.set('N4', listDv(ENV_LIST));
  s.set('O4', listDv(STATUS_LIST));
  s.set('S4', DATE_FMT);
  return s;
}

function baseEntry(over = {}) {
  return {
    caseId: 'EVAL_V1_001',
    round: 1,
    pass: true,
    runId: 'a1b2c3d4-e5f6',
    startedAt: new Date(2026, 8, 28, 10, 15).toISOString(),
    envLabel: 'Localhost',
    profile: 'default',
    steps: [{ label: 'B1 Mở module Đánh giá', ok: true }],
    checks: [],
    resultText: 'Đúng như mong muốn.',
    videoUrl: 'https://files.catbox.moe/abc.mp4',
    runDir: null,
    ...over,
  };
}

/** Nhật ký trong bộ nhớ, cùng giao diện với createAuditLog */
function memoryAudit() {
  const entries = [];
  return {
    filePath: '(bộ nhớ)',
    entries,
    append(e) {
      entries.push(e);
      return e;
    },
    list() {
      return entries.slice();
    },
    find(id) {
      return entries.find((e) => e.auditId === id) || null;
    },
  };
}

function tmpFile(name = 'audit') {
  return path.join(os.tmpdir(), `fe2-${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

module.exports = {
  createFakeSheet,
  insertRowAt,
  deleteColumnAt,
  insertColumnAt,
  swapRows,
  makeV1Sheet,
  baseEntry,
  memoryAudit,
  tmpFile,
  STATUS_LIST,
  ENV_LIST,
};
