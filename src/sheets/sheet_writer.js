// ============================================================================
// sheet_writer.js: ghi kết quả 1 lần chạy vào 4 ô của vòng test, qua Sheets API.
//
// Thứ tự chốt (dừng ở chốt đầu tiên không qua — thà không ghi còn hơn ghi nhầm):
//   1. dữ liệu vào hợp lệ (mã, vòng, pass boolean, có link video);
//   2. mã ở cột A xuất hiện ĐÚNG 1 lần (hoặc --row trỏ đúng 1 trong các dòng trùng);
//   3. khối vòng có đúng 1 cột Trạng thái + 1 cột Kết quả (tìm theo nhãn);
//   4. ĐỌC SỐNG ngay trước khi ghi, trong 1 lượt: ô mã ở cột A, ô "TEST LẦN n" ở dòng 1,
//      nhãn dòng 2 của từng cột đích, và 4 ô đích — tất cả phải thuộc đúng tab (gid).
//      Mã hoặc nhãn lệch nghĩa là Sheet vừa chèn/xoá/sắp xếp dòng hoặc cột: làm mới lưới
//      1 lần, lệch nữa thì DỪNG;
//   5. ô Kết quả đã có dấu #runId → lần chạy này đã ghi rồi, không ghi lại;
//      ô Kết quả đã có kết quả tự động MỚI HƠN → lần chạy này đã cũ, không ghi đè;
//   6. Trạng thái phải nằm trong danh sách chọn; ô Kết quả phải là chữ (không công thức,
//      smart chip, số, đúng/sai);
//   7. ghi nhật ký (bản chụp trước + giá trị định gửi) → gửi 1 lượt batchUpdate;
//   8. đọc lại, so theo kiểu giá trị + link cũ còn nguyên → ghi nhật ký kết quả đọc lại.
// ============================================================================

const G = require('../core/sheet_grid');
const { cellRange, a1Of, showSpaces } = require('./a1');
const C = require('./cell_values');
const { newAuditId, latestWriteFor } = require('./audit');
const {
  buildResultEntry,
  runTag,
  toSheetsDateSerial,
  parseAutoEntries,
  minuteOf,
  formatDateTime,
} = require('../engine/result_text');

const STATUS_PASS = 'DONE';
const STATUS_FAIL = 'Fail';
const MAX_CELL_CHARS = 50000; // giới hạn 1 ô của Google Sheets
const CASE_ID_RE = /^EVAL_[A-Z0-9_]+$/i;
const PLAIN_FIELDS = 'userEnteredValue,textFormatRuns';
const KEYS = ['status', 'result', 'env', 'testDate'];

const textOf = (cell) => (C.cellText(cell) || String((cell && cell.formattedValue) || '')).trim();

function validateEntry(e) {
  if (!e || !CASE_ID_RE.test(String(e.caseId || ''))) {
    throw new Error(`[AN TOÀN] Mã case "${e && e.caseId}" không hợp lệ — không ghi.`);
  }
  if (!Number.isInteger(e.round) || e.round < 1) {
    throw new Error(`[AN TOÀN] vòng test "${e.round}" không hợp lệ (phải là số nguyên ≥ 1) — không ghi.`);
  }
  if (typeof e.pass !== 'boolean') {
    throw new Error(`[AN TOÀN] pass phải là true hoặc false (đang là ${JSON.stringify(e.pass)}) — không ghi.`);
  }
  if (!e.videoUrl || !/^https?:\/\//.test(String(e.videoUrl))) {
    throw new Error('[AN TOÀN] thiếu link video — không ghi kết quả không có bằng chứng.');
  }
  if (Number.isNaN(new Date(e.startedAt).getTime())) {
    throw new Error(`[AN TOÀN] startedAt "${e.startedAt}" không phải thời điểm hợp lệ — không ghi.`);
  }
  runTag(e.runId); // ném lỗi nếu runId quá ngắn
}

function updateCellRequest(sheetId, rowIndex, columnIndex, value, fields) {
  return { updateCells: { start: { sheetId, rowIndex, columnIndex }, rows: [{ values: [value] }], fields } };
}

/**
 * @param {object} o
 * @param {object} o.client     từ createSheetsClient (hoặc Sheet giả lập)
 * @param {{gid:number,title:string}} o.tab
 * @param {object} [o.auditLog] từ createAuditLog — null thì không ghi nhật ký
 * @param {Function} [o.now]
 * @param {number} [o.idCol=0]  cột mã case (0-based)
 * @param {number} [o.gridTtlMs=60000] lưới được dùng lại trong khoảng này (an toàn vì chốt 4
 *   kiểm sống cả dòng lẫn cột trước mỗi lần ghi)
 */
function createSheetWriter({ client, tab, auditLog = null, now = () => new Date(), idCol = 0, gridTtlMs = 60000 }) {
  if (!client || !tab || tab.gid === undefined || !tab.title) {
    throw new Error('[SHEET] createSheetWriter cần client và tab {gid, title}');
  }
  let cached = null;
  let chain = Promise.resolve();

  async function getGrid(force) {
    if (!force && cached && Date.now() - cached.at < gridTtlMs) return cached.grid;
    const grid = await client.readGrid(tab.title);
    cached = { grid, at: Date.now() };
    return grid;
  }

  /** Tìm dòng + cột trên lưới. Ném [AN TOÀN] nếu không chắc chắn. */
  function locate(grid, e) {
    const rows = G.findRowIndices(grid, e.caseId, idCol);
    if (!rows.length) {
      throw new Error(`Không tìm thấy mã ${e.caseId} ở cột ${G.colLetter(idCol)} của tab "${showSpaces(tab.title)}".`);
    }
    let rowIdx;
    if (e.row) {
      rowIdx = Number(e.row) - 1;
      if (!rows.includes(rowIdx)) {
        throw new Error(
          `[AN TOÀN] Sai dòng! --row=${e.row} nhưng mã ${e.caseId} nằm ở dòng ` +
            `${rows.map((r) => r + 1).join(', ')}. Dừng lại, không ghi.`
        );
      }
    } else if (rows.length > 1) {
      throw new Error(
        `[AN TOÀN] Mã ${e.caseId} xuất hiện ${rows.length} lần ở cột ${G.colLetter(idCol)} ` +
          `(dòng ${rows.map((r) => r + 1).join(', ')}) — không biết dòng nào là thật. Dừng lại, không ghi.`
      );
    } else {
      rowIdx = rows[0];
    }

    const found = G.findRoundColumnsByLabel(grid, e.round);
    if (!found.ok) {
      const have = G.listRoundNumbers(grid);
      throw new Error(
        `[AN TOÀN] Không xác định được cột của TEST LẦN ${e.round}: ${found.problems.join('; ')}. ` +
          `Sheet đang có vòng: ${have.length ? have.join(', ') : '(không có)'}. Dừng lại, không ghi.`
      );
    }
    return { rowIdx, found };
  }

  /**
   * Chốt 4: đọc sống ô mã + tiêu đề vòng + nhãn cột + 4 ô đích trong 1 lượt.
   * @returns {{ok: true, live: object} | {ok: false, why: string}}
   */
  async function readLive(rowIdx, found, e) {
    const keys = KEYS.filter((k) => found.cols[k] !== null);
    const idA1 = a1Of(rowIdx, idCol);
    const headA1 = a1Of(0, found.block.startIdx);
    const labelA1s = keys.map((k) => a1Of(1, found.cols[k]));
    const targetA1s = keys.map((k) => a1Of(rowIdx, found.cols[k]));
    const cells = await client.readCells(
      [idA1, headA1, ...labelA1s, ...targetA1s].map((a1) => cellRange(tab.title, a1)),
      { gid: tab.gid }
    );

    const liveId = textOf(cells[0]);
    if (liveId.toUpperCase() !== e.caseId.trim().toUpperCase()) {
      return { ok: false, why: `Ô ${idA1} vừa đọc = "${liveId}", không phải "${e.caseId}" — Sheet vừa chèn/xoá/sắp xếp dòng?` };
    }
    const wantHead = `TEST LẦN ${e.round}`;
    if (G.normalizeLabel(textOf(cells[1])) !== G.normalizeLabel(wantHead)) {
      return { ok: false, why: `Ô ${headA1} vừa đọc = "${textOf(cells[1])}", không phải "${wantHead}" — Sheet vừa chèn/xoá cột?` };
    }
    for (let i = 0; i < keys.length; i += 1) {
      const want = G.WRITE_LABELS[keys[i]];
      const got = textOf(cells[2 + i]);
      if (G.normalizeLabel(got) !== G.normalizeLabel(want)) {
        return { ok: false, why: `Ô ${labelA1s[i]} vừa đọc = "${got}", không phải "${want}" — Sheet vừa chèn/xoá cột?` };
      }
    }
    const offset = 2 + keys.length;
    return { ok: true, live: Object.fromEntries(keys.map((k, i) => [k, cells[offset + i] || {}])) };
  }

  async function writeResult(e) {
    validateEntry(e);

    // Chốt 2–4: tìm trên lưới rồi đọc sống; lệch thì làm mới lưới đúng 1 lần.
    let rowIdx;
    let found;
    let live;
    for (let attempt = 0; ; attempt += 1) {
      const grid = await getGrid(attempt > 0);
      ({ rowIdx, found } = locate(grid, e));
      const r = await readLive(rowIdx, found, e);
      if (r.ok) {
        live = r.live;
        break;
      }
      if (attempt >= 1) throw new Error(`[AN TOÀN] Sai vị trí! ${r.why} Dừng lại, không ghi.`);
    }

    const warnings = [...found.warnings];
    const targets = [
      { key: 'status', col: found.cols.status },
      { key: 'result', col: found.cols.result },
    ];
    if (found.cols.env !== null) {
      if (!e.envLabel) {
        warnings.push('chưa có nhãn Môi trường cho TARGET_URL — bỏ qua cột Môi trường');
      } else {
        const allowed = C.allowedValues(live.env);
        if (allowed && !allowed.includes(e.envLabel)) {
          warnings.push(
            `nhãn Môi trường "${e.envLabel}" không có trong danh sách chọn của ô ` +
              `${a1Of(rowIdx, found.cols.env)} (${allowed.join(', ')}) — bỏ qua cột Môi trường`
          );
        } else {
          targets.push({ key: 'env', col: found.cols.env });
        }
      }
    }
    if (found.cols.testDate !== null) targets.push({ key: 'testDate', col: found.cols.testDate });
    for (const t of targets) {
      t.a1 = a1Of(rowIdx, t.col);
      t.cell = live[t.key] || {};
    }
    const by = Object.fromEntries(targets.map((t) => [t.key, t]));
    const cellsOf = () => Object.fromEntries(targets.map((t) => [t.key, t.a1]));
    const statusValue = e.pass ? STATUS_PASS : STATUS_FAIL;
    const serial = toSheetsDateSerial(e.startedAt);

    // Chốt 5: lần chạy này đã được ghi từ trước
    const tag = runTag(e.runId);
    const resultNow = C.cellText(by.result.cell);
    const autos = parseAutoEntries(resultNow);
    if (resultNow.includes(tag)) {
      const mine = autos.find((x) => x.tag === tag);
      // Có lần chạy khác nối SAU mình → Trạng thái hiện tại là của lần đó, lệch là đúng.
      const superseded = Boolean(mine) && autos.some((x) => x.tag !== tag && x.index > mine.index);
      const mismatched = [];
      if (!superseded) {
        if (textOf(by.status.cell) !== statusValue) {
          mismatched.push(`${by.status.a1} = "${textOf(by.status.cell)}" (mong đợi "${statusValue}")`);
        }
        if (by.env && textOf(by.env.cell) !== e.envLabel) {
          mismatched.push(`${by.env.a1} = "${textOf(by.env.cell)}" (mong đợi "${e.envLabel}")`);
        }
        const d = by.testDate && (by.testDate.cell.userEnteredValue || {}).numberValue;
        if (by.testDate && d !== serial) {
          mismatched.push(`${by.testDate.a1} = "${textOf(by.testDate.cell)}" (mong đợi ngày ${formatDateTime(e.startedAt).slice(0, 10)})`);
        }
      }
      const prior = auditLog ? latestWriteFor(auditLog.list(), { runId: e.runId, gid: tab.gid }) : null;
      return {
        state: 'written',
        already: true,
        cells: cellsOf(),
        status: textOf(by.status.cell),
        auditId: prior ? prior.write.auditId : null,
        priorVerified: prior ? prior.verified : null,
        superseded,
        mismatched,
        warnings: [
          ...warnings,
          `ô ${by.result.a1} đã chứa ${tag} — lần chạy này đã được ghi từ trước, không ghi lại`,
          ...(mismatched.length ? [`nhưng các ô khác không khớp lần ghi đó: ${mismatched.join('; ')} — kiểm tay`] : []),
        ],
        row: rowIdx + 1,
      };
    }
    const newer = autos.filter((x) => minuteOf(x.at) > minuteOf(e.startedAt));
    if (newer.length) {
      const last = newer[newer.length - 1];
      throw new Error(
        `[AN TOÀN] Ô ${by.result.a1} đã có kết quả tự động của lần chạy MỚI HƠN ` +
          `(${formatDateTime(last.at)}${last.tag ? ` ${last.tag}` : ''}) so với lần này (${formatDateTime(e.startedAt)}) — ` +
          'kết quả cũ không được ghi đè Trạng thái mới. Dừng lại, không ghi. Cần thì chạy lại case.'
      );
    }

    // Chốt 6
    const allowedStatus = C.allowedValues(by.status.cell);
    if (allowedStatus && !allowedStatus.includes(statusValue)) {
      throw new Error(
        `[AN TOÀN] Ô ${by.status.a1} chỉ nhận ${allowedStatus.join(', ')} — không có "${statusValue}". ` +
          'Dừng lại, không ghi.'
      );
    }
    if (C.isFormula(by.result.cell)) {
      throw new Error(`[AN TOÀN] Ô ${by.result.a1} đang là công thức — nối thêm sẽ phá công thức. Dừng lại, không ghi.`);
    }
    if (C.hasChips(by.result.cell)) {
      throw new Error(`[AN TOÀN] Ô ${by.result.a1} có smart chip — nối qua API sẽ mất chip. Dừng lại, không ghi.`);
    }
    if (C.hasNonTextValue(by.result.cell)) {
      throw new Error(
        `[AN TOÀN] Ô ${by.result.a1} đang chứa số / đúng-sai ("${textOf(by.result.cell)}"), không phải chữ — ` +
          'nối thêm sẽ làm mất giá trị đó. Dừng lại, không ghi.'
      );
    }

    const entryText = buildResultEntry({
      runId: e.runId,
      startedAt: e.startedAt,
      round: e.round,
      profile: e.profile,
      steps: e.steps || [],
      checks: e.checks || [],
      pass: e.pass,
      reviewCause: e.reviewCause,
      resultText: e.resultText,
      videoUrl: e.videoUrl,
    });
    const built = C.buildAppendedResultCell(by.result.cell, entryText, e.videoUrl);
    if (built.text.length > MAX_CELL_CHARS) {
      throw new Error(
        `[AN TOÀN] Ô ${by.result.a1} sau khi nối dài ${built.text.length} ký tự, vượt giới hạn ` +
          `${MAX_CELL_CHARS} của Google Sheets. Dừng lại, không ghi.`
      );
    }

    for (const t of targets) {
      if (t.key === 'status') {
        t.sent = { userEnteredValue: { stringValue: statusValue } };
        t.fields = PLAIN_FIELDS;
      } else if (t.key === 'env') {
        t.sent = { userEnteredValue: { stringValue: e.envLabel } };
        t.fields = PLAIN_FIELDS;
      } else if (t.key === 'result') {
        t.sent = { userEnteredValue: { stringValue: built.text }, textFormatRuns: built.runs };
        t.fields = PLAIN_FIELDS;
      } else if (C.hasDateFormat(t.cell)) {
        t.sent = { userEnteredValue: { numberValue: serial } };
        t.fields = 'userEnteredValue';
      } else {
        t.sent = {
          userEnteredValue: { numberValue: serial },
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
        };
        t.fields = 'userEnteredValue,userEnteredFormat.numberFormat';
      }
    }

    // Chốt 7: nhật ký TRƯỚC khi gửi — mất mạng giữa chừng vẫn còn bản chụp "trước".
    const idA1 = a1Of(rowIdx, idCol);
    const auditId = auditLog ? newAuditId(now()) : null;
    if (auditLog) {
      auditLog.append({
        kind: 'write',
        auditId,
        at: now().toISOString(),
        spreadsheetId: client.spreadsheetId || null,
        runId: e.runId,
        runDir: e.runDir || null,
        caseId: e.caseId,
        round: e.round,
        startedAt: e.startedAt,
        reviewer: e.reviewer || null,
        tab: { gid: tab.gid, title: tab.title },
        row: rowIdx + 1,
        id: { a1: idA1, col: idCol },
        cells: targets.map((t) => ({ key: t.key, a1: t.a1, col: t.col, fields: t.fields, before: C.snapshot(t.cell), sent: C.snapshot(t.sent) })),
        verified: null,
      });
    }
    const undoHint = auditId ? ` Hoàn tác được bằng: npm run undo -- ${auditId}` : '';

    try {
      await client.batchUpdate(targets.map((t) => updateCellRequest(tab.gid, rowIdx, t.col, t.sent, t.fields)));
    } catch (err) {
      // 4xx = API từ chối cả lượt (batchUpdate nguyên khối) → chắc chắn chưa ghi ô nào.
      if (err && err.status >= 400 && err.status < 500) {
        if (auditLog) {
          auditLog.append({ kind: 'abort', auditId: newAuditId(now()), abortOf: auditId, at: now().toISOString(), reason: err.message });
        }
        throw err;
      }
      const e2 = new Error(
        `[SHEET] Không chắc lần ghi đã vào Sheet hay chưa (${err && err.message ? err.message : err}) — ` +
          `kiểm tay ô ${targets.map((t) => t.a1).join(', ')}.${undoHint}`
      );
      e2.auditId = auditId;
      e2.uncertain = true;
      throw e2;
    }

    // Chốt 8: đọc lại (kèm ô mã — dòng dời NGAY lúc ghi cũng phải biết)
    let back;
    try {
      back = await client.readCells([idA1, ...targets.map((t) => t.a1)].map((a1) => cellRange(tab.title, a1)), { gid: tab.gid });
    } catch (err) {
      const e2 = new Error(`[SHEET] Đã ghi nhưng không đọc lại được để kiểm (${err.message}) — kiểm tay ô ${targets.map((t) => t.a1).join(', ')}.${undoHint}`);
      e2.auditId = auditId;
      throw e2;
    }
    const problems = [];
    if (textOf(back[0]).toUpperCase() !== e.caseId.trim().toUpperCase()) {
      problems.push(`${idA1} (dòng vừa dời trong lúc ghi — giờ là "${textOf(back[0])}")`);
    }
    targets.forEach((t, i) => {
      t.after = back[i + 1] || {};
      if (!C.sameValue(t.after, t.sent)) problems.push(t.a1);
    });
    const oldLinks = C.linkRuns(by.result.cell);
    const newLinks = C.linkRuns(by.result.after);
    const lost = oldLinks.filter((l) => !newLinks.some((n) => n.at === l.at && n.uri === l.uri));
    if (lost.length) problems.push(`${by.result.a1} (mất ${lost.length} link cũ)`);

    if (auditLog) {
      auditLog.append({
        kind: 'verify',
        auditId: newAuditId(now()),
        verifyOf: auditId,
        at: now().toISOString(),
        verified: problems.length === 0,
        problems,
        cells: targets.map((t) => ({ key: t.key, a1: t.a1, after: C.snapshot(t.after) })),
      });
    }

    if (problems.length) {
      const err = new Error(`[SHEET] Đọc lại sau khi ghi không khớp ở ${problems.join(', ')}.${undoHint}`);
      err.auditId = auditId;
      throw err;
    }

    return {
      state: 'written',
      already: false,
      cells: cellsOf(),
      status: statusValue,
      auditId,
      priorVerified: null,
      superseded: false,
      mismatched: [],
      warnings,
      content: built.text,
      row: rowIdx + 1,
    };
  }

  /** Ghi tuần tự: lần sau chờ lần trước xong; lần trước hỏng không làm kẹt hàng đợi. */
  function enqueue(e) {
    const p = chain.then(() => writeResult(e));
    chain = p.catch(() => {});
    return p;
  }

  return { writeResult, enqueue };
}

module.exports = { createSheetWriter, newAuditId, STATUS_PASS, STATUS_FAIL, MAX_CELL_CHARS };
