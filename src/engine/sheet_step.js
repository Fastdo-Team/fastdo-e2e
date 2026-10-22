// ============================================================================
// sheet_step.js: quyết định + ghi Sheet cho 1 record sau khi chạy (chạy thật).
//
//   ĐẠT + có link video       → ghi ngay (qua mọi chốt của sheet_writer)
//   KHÔNG ĐẠT                 → pending: chờ QC xem video rồi duyệt (npm run commit)
//   ĐẠT mà upload hỏng        → waiting-upload: không có bằng chứng thì không ghi
//   LỖI HẠ TẦNG / ĐÃ HUỶ      → không bao giờ ghi (không phải kết quả kiểm thử)
// Mọi trạng thái đều lưu `target` = đúng Sheet + tab lúc chạy: duyệt sau này phải ghi vào
// đúng tab đó, kể cả khi .env đã đổi sang tab khác.
// ============================================================================

function targetOf(sheet) {
  return sheet ? { spreadsheetId: sheet.spreadsheetId, gid: sheet.tab.gid, title: sheet.tab.title } : null;
}

async function writeSheetForRecord(record, { sheet, opts, print = console.log }) {
  if (!opts.sheet || opts.sheetOn === 'never') {
    return { state: 'skipped', reason: opts.sheetOn === 'never' ? 'tắt bằng --sheet-on=never' : 'tắt (chạy nháp / --no-sheet)' };
  }
  if (record.verdict === 'DA_HUY') return { state: 'skipped', reason: 'case bị huỷ — không phải kết quả kiểm thử' };
  if (record.error) {
    return { state: 'skipped', reason: 'lỗi hạ tầng — lỗi chạy máy không phải kết quả kiểm thử, cần chạy lại case' };
  }
  if (!sheet) return { state: 'skipped', reason: 'chưa mở được Google Sheet lúc khởi động (xem lỗi đầu log)' };
  const target = targetOf(sheet);

  if (record.pass !== true) {
    return {
      state: 'pending',
      target,
      reason: 'case KHÔNG ĐẠT — chờ QC xem video rồi duyệt nguyên nhân (npm run commit -- <thư mục run>)',
    };
  }
  if (!record.videoUrl) {
    return {
      state: 'waiting-upload',
      target,
      reason: record.videoPath ? 'upload Google Drive thất bại nên chưa có link video — chưa ghi' : 'không có video — chưa ghi',
    };
  }

  try {
    const info = await sheet.writer.enqueue({
      caseId: record.testcaseId,
      round: record.round,
      row: opts.row || null,
      pass: record.pass,
      runId: record.runId,
      startedAt: record.startedAt,
      envLabel: record.envLabel,
      profile: record.profile,
      steps: record.steps,
      checks: record.checks,
      resultText: record.resultText,
      videoUrl: record.videoUrl,
      runDir: record.runDir,
      reviewer: null,
    });
    (info.warnings || []).forEach((w) => print(`[SHEET] ⚠ ${w}`));
    print(
      `[SHEET] ${record.testcaseId} → ${info.already ? 'đã có từ trước, không ghi lại' : 'đã ghi'} ` +
        Object.entries(info.cells)
          .map(([k, a1]) => `${k} ${a1}`)
          .join(', ')
    );
    record.sheetCell = info.cells.result;
    record.sheetStatus = info.status;
    const stillBad = info.already && info.mismatched && info.mismatched.length > 0;
    return {
      state: stillBad ? 'failed' : 'written',
      reason: stillBad ? `ô Kết quả đã có lần ghi này nhưng lệch: ${info.mismatched.join('; ')} — kiểm tay` : undefined,
      target,
      cell: info.cells.result,
      cells: info.cells,
      status: info.status,
      auditId: info.auditId,
      already: info.already,
      warnings: info.warnings,
      tab: { gid: sheet.tab.gid, title: sheet.tab.title },
    };
  } catch (err) {
    print(`[ERROR] Cập nhật Google Sheet thất bại: ${err.message}`);
    return { state: 'failed', target, reason: err.message, auditId: err.auditId || null };
  }
}

module.exports = { writeSheetForRecord, targetOf };
