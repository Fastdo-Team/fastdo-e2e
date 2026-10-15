#!/usr/bin/env node
// ============================================================================
// sheet-selftest.js: kiểm bộ ghi Sheet TRÊN SHEET THẬT mà không đụng tab của team.
//
//   npm run sheet:selftest
//
// Service account không tạo được Sheet riêng (403 — không có dung lượng Drive), nên
// (theo lựa chọn của user ngày 2026-09-28) tool này:
//   1. tạo tab ẨN tạm `_fe2_kiem_thu_<giờ>` trong chính Sheet đang cấu hình;
//   2. chép 5 dòng đầu của tab đang chọn sang (3 dòng tiêu đề + 2 dòng case), giữ nguyên
//      định dạng, link trong chữ, danh sách chọn — đúng những thứ bộ ghi phải giữ;
//   3. kiểm: ghi 4 ô vòng đầu tiên của case dòng 4 · link cũ còn nguyên · link video bấm
//      được · Test Date là số ngày · ghi lại không nhân đôi · vòng không có cột bị chặn ·
//      hoàn tác trả ô về y như cũ · chèn cột giữa chừng thì ghi đúng cột mới;
//   4. XOÁ tab tạm — kể cả khi có bước hỏng.
// Không bao giờ ghi tab đang chọn (V1/HUY): bộ ghi trỏ vào gid của tab tạm, và có chốt
// dừng nếu tab tạm trùng tab nguồn. Nhật ký riêng: runs/.selftest-audit.ndjson.
// ============================================================================

const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { resolveTab } = require('../sheets/tab');
const { createSheetWriter } = require('../sheets/sheet_writer');
const { createAuditLog, undoWrite } = require('../sheets/audit');
const { cellRange, showSpaces } = require('../sheets/a1');
const C = require('../sheets/cell_values');
const G = require('../core/sheet_grid');
const { toSheetsDateSerial } = require('../engine/result_text');

const PREFIX = '_fe2_kiem_thu';
const LINE = '='.repeat(74);
const results = [];

function check(ok, label, detail = '') {
  results.push({ ok, label });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  return ok;
}

function stamp(d = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

const deleteTab = (client, gid) => client.batchUpdate([{ deleteSheet: { sheetId: gid } }]);

async function main() {
  console.log(LINE);
  console.log('  SHEET SELFTEST — kiểm bộ ghi trên tab ẩn tạm, xoá tab khi xong');
  console.log(LINE);

  const missing = ['SHEET_ID', 'GOOGLE_SA_KEY_FILE'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`[ERROR] Thiếu ${missing.join(', ')} trong .env.`);
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({ spreadsheetId: config.SHEET_ID, keyFile: config.GOOGLE_SA_KEY_FILE });
  let meta = await client.getMeta();
  const source = resolveTab(meta, { gid: config.SHEET_GID, title: config.SHEET_TAB });
  console.log(`Tab nguồn (chỉ ĐỌC 5 dòng đầu): "${showSpaces(source.title)}" (gid ${source.gid})`);

  // Dọn tab tạm sót lại từ lần kiểm trước bị ngắt — CHỈ tab mang đúng tiền tố.
  for (const t of meta.tabs.filter((x) => x.title.startsWith(PREFIX))) {
    await deleteTab(client, t.gid);
    console.log(`  dọn tab tạm cũ "${t.title}" (gid ${t.gid})`);
  }

  const sourceInfo = meta.tabs.find((t) => t.gid === source.gid);
  const width = Math.max(26, sourceInfo ? sourceInfo.cols : 80);
  const title = `${PREFIX}_${stamp()}`;
  const added = await client.batchUpdate([
    { addSheet: { properties: { title, hidden: true, gridProperties: { rowCount: 10, columnCount: width } } } },
  ]);
  const gid = added.replies[0].addSheet.properties.sheetId;
  const tmp = { gid, title };
  console.log(`Tạo tab ẩn tạm "${title}" (gid ${gid})`);

  try {
    if (tmp.gid === source.gid || !tmp.title.startsWith(PREFIX)) {
      throw new Error('[AN TOÀN] tab tạm trùng tab nguồn — dừng.');
    }
    await client.batchUpdate([
      {
        copyPaste: {
          source: { sheetId: source.gid, startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: width },
          destination: { sheetId: gid, startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: width },
          pasteType: 'PASTE_NORMAL',
          pasteOrientation: 'NORMAL',
        },
      },
    ]);

    const grid = await client.readGrid(title);
    const caseId = ((grid[3] || [])[0] || '').trim();
    const round = (G.listRounds(grid)[0] || {}).number;
    check(/^EVAL_/i.test(caseId) && Number.isInteger(round), 'Chép 5 dòng đầu sang tab tạm', `case ${caseId}, vòng ${round}`);

    const found = G.findRoundColumnsByLabel(grid, round);
    check(
      found.ok,
      `Tìm cột vòng ${round} theo nhãn`,
      found.ok
        ? Object.entries(found.cols).map(([k, v]) => `${k}=${v === null ? '-' : G.colLetter(v)}`).join(' ')
        : found.problems.join('; ')
    );
    const keys = ['status', 'result', 'env', 'testDate'].filter((k) => found.cols[k] !== null);
    const a1Of = (k) => `${G.colLetter(found.cols[k])}4`;
    const before = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const cellBefore = Object.fromEntries(keys.map((k, i) => [k, before[i]]));

    if (cellBefore.testDate) {
      const shown = String(cellBefore.testDate.formattedValue || '');
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(shown);
      const num = cellBefore.testDate.userEnteredValue && cellBefore.testDate.userEnteredValue.numberValue;
      if (m && num !== undefined) {
        const mine = toSheetsDateSerial(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
        check(mine === num, 'Công thức số ngày khớp ô Test Date thật', `${shown} = ${num}, tính ra ${mine}`);
      }
    }

    const audit = createAuditLog(path.join(config.ROOT_DIR, 'runs', '.selftest-audit.ndjson'));
    const writer = createSheetWriter({ client, tab: tmp, auditLog: audit });
    const entry = {
      caseId,
      round,
      pass: true,
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      envLabel: 'Localhost',
      profile: 'selftest',
      steps: [{ label: 'B1 Kiểm bộ ghi trên tab tạm', ok: true }],
      checks: [],
      resultText: 'Kiểm thử bộ ghi engine v2 trên tab ẩn tạm — tab sẽ bị xoá.',
      videoUrl: 'https://files.catbox.moe/selftest-engine-v2.mp4',
      runDir: null,
      reviewer: 'sheet:selftest',
    };

    // 1. Ghi
    const info = await writer.writeResult(entry);
    check(info.state === 'written' && !info.already, 'Ghi 4 ô', Object.entries(info.cells).map(([k, v]) => `${k} ${v}`).join(', '));
    (info.warnings || []).forEach((w) => console.log(`  ⚠ ${w}`));
    const after = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const cellAfter = Object.fromEntries(keys.map((k, i) => [k, after[i]]));
    const oldLinks = C.linkRuns(cellBefore.result);
    const newLinks = C.linkRuns(cellAfter.result);
    check(
      oldLinks.every((l) => newLinks.some((n) => n.at === l.at && n.uri === l.uri)),
      'Link cũ trong ô Kết quả còn nguyên',
      `${oldLinks.length} link`
    );
    check(newLinks.some((n) => n.uri === entry.videoUrl), 'Link video thành link bấm được');
    if (cellAfter.testDate) {
      const v = cellAfter.testDate.userEnteredValue || {};
      check(v.numberValue === toSheetsDateSerial(new Date(entry.startedAt)), 'Test Date là số ngày', String(cellAfter.testDate.formattedValue || ''));
    }

    // 2. Ghi lại đúng lần chạy đó
    const again = await writer.writeResult(entry);
    const [resultAgain] = await client.readCells([cellRange(title, a1Of('result'))]);
    check(again.already === true && C.cellText(resultAgain) === C.cellText(cellAfter.result), 'Ghi lại không nhân đôi (#runId)');

    // 3. Vòng không có cột
    let blocked = false;
    try {
      await writer.writeResult({ ...entry, runId: crypto.randomUUID(), round: 99 });
    } catch (err) {
      blocked = /AN TOÀN/.test(err.message);
    }
    check(blocked, 'Vòng không có cột bị chặn trước khi ghi');

    // 4. Hoàn tác
    const undo = await undoWrite({ client, auditLog: audit, auditId: info.auditId, tabTitle: title, reviewer: 'sheet:selftest' });
    const restored = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const same = restored.every((c, i) => {
      const a = C.snapshot(c);
      const b = C.snapshot(before[i]);
      return C.sameValue(a, b) && JSON.stringify(a.textFormatRuns || []) === JSON.stringify(b.textFormatRuns || []);
    });
    check(undo.verified && !undo.refused.length && same, 'Hoàn tác trả ô về y như trước (cả link)', `${undo.restored.length} ô`);

    // 5. Chèn 1 cột trước khối vòng TRONG LÚC bộ ghi còn nhớ lưới cũ: chốt đọc sống phải
    //    thấy nhãn lệch, tự làm mới lưới và ghi đúng cột mới — không ghi vào cột cũ.
    await client.batchUpdate([
      {
        insertDimension: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: found.block.startIdx, endIndex: found.block.startIdx + 1 },
          inheritFromBefore: false,
        },
      },
    ]);
    const shifted = await writer.writeResult({ ...entry, runId: crypto.randomUUID() });
    const wantStatus = `${G.colLetter(found.cols.status + 1)}4`;
    check(shifted.cells.status === wantStatus, 'Sheet chèn cột giữa chừng → ghi đúng cột mới', `Trạng thái ${shifted.cells.status} (đúng: ${wantStatus})`);
    const undo2 = await undoWrite({ client, auditLog: audit, auditId: shifted.auditId, tabTitle: title, reviewer: 'sheet:selftest' });
    check(undo2.verified === true && !undo2.blocked, 'Hoàn tác lần ghi sau khi chèn cột', `${undo2.restored.join(', ')}`);
  } catch (err) {
    check(false, 'Kiểm thử bị ngắt', err.message);
  } finally {
    try {
      await deleteTab(client, gid);
      meta = await client.getMeta();
      check(!meta.tabs.some((t) => t.gid === gid), 'Xoá tab tạm', `"${title}"`);
    } catch (err) {
      check(false, 'Xoá tab tạm', `${err.message} — XOÁ TAY tab ẩn "${title}" (Xem → Trang tính ẩn)`);
    }
  }

  const bad = results.filter((r) => !r.ok);
  console.log(LINE);
  console.log(
    bad.length
      ? `  CÓ ${bad.length} BƯỚC HỎNG — bộ ghi CHƯA an toàn để ghi thật`
      : `  ĐẠT ${results.length}/${results.length} — bộ ghi an toàn để ghi Sheet thật`
  );
  console.log(LINE);
  if (bad.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
