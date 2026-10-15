const test = require('node:test');
const assert = require('node:assert');
const { createSheetWriter } = require('./sheet_writer');
const { makeV1Sheet, baseEntry, memoryAudit, insertRowAt, deleteColumnAt, insertColumnAt, swapRows } = require('./testkit');
const { toSheetsDateSerial } = require('../engine/result_text');

const setup = () => {
  const s = makeV1Sheet();
  const audit = memoryAudit();
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: audit });
  return { s, audit, w };
};

test('ghi đủ 4 ô vòng 1: Trạng thái, Kết quả nối thêm giữ link cũ, Môi trường, Test Date là số ngày', async () => {
  const { s, audit, w } = setup();
  const info = await w.writeResult(baseEntry({ pass: false, reviewCause: 'app', resultText: 'Nút Lưu bị mờ.' }));
  assert.strictEqual(info.state, 'written');
  assert.strictEqual(info.already, false);
  assert.deepStrictEqual(info.cells, { status: 'H4', result: 'I4', env: 'G4', testDate: 'L4' });
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'Fail');
  assert.strictEqual(s.get('G4').userEnteredValue.stringValue, 'Localhost');
  assert.strictEqual(s.get('L4').userEnteredValue.numberValue, toSheetsDateSerial(new Date(2026, 8, 28)));
  const text = s.get('I4').userEnteredValue.stringValue;
  assert.ok(text.startsWith('Link: https://jam.dev/c/1\n[Tự động] 28/09/2026 10:15 · vòng 1 · hồ sơ default · #a1b2c3d4'));
  assert.ok(text.includes('Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — Nút Lưu bị mờ.'));
  const runs = s.get('I4').textFormatRuns;
  assert.deepStrictEqual(runs[1], { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } });
  assert.ok(runs.some((r) => r.format.link && r.format.link.uri === 'https://files.catbox.moe/abc.mp4'));
  // Nhật ký: dòng "write" (trước khi gửi) + dòng "verify" (sau khi đọc lại)
  assert.deepStrictEqual(audit.entries.map((x) => x.kind), ['write', 'verify']);
  assert.strictEqual(audit.entries[0].auditId, info.auditId);
  assert.strictEqual(audit.entries[0].id.a1, 'A4');
  assert.strictEqual(audit.entries[0].cells.find((c) => c.key === 'status').before.userEnteredValue.stringValue, 'DONE');
  assert.strictEqual(audit.entries[0].cells.find((c) => c.key === 'status').sent.userEnteredValue.stringValue, 'Fail');
  assert.strictEqual(audit.entries[1].verifyOf, info.auditId);
  assert.strictEqual(audit.entries[1].verified, true);
});

test('ghi lại đúng lần chạy đó thì không nhân đôi (chống ghi trùng #runId)', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry());
  const once = s.get('I4').userEnteredValue.stringValue;
  const again = await w.writeResult(baseEntry());
  assert.strictEqual(again.already, true);
  assert.strictEqual(s.get('I4').userEnteredValue.stringValue, once);
  assert.strictEqual(s.calls.batchUpdate.length, 1);
});

test('vòng 2 còn trống: ô Kết quả không có dòng trống thừa ở đầu', async () => {
  const { s, w } = setup();
  const info = await w.writeResult(baseEntry({ round: 2 }));
  assert.deepStrictEqual(info.cells, { status: 'O4', result: 'P4', env: 'N4', testDate: 'S4' });
  assert.ok(s.get('P4').userEnteredValue.stringValue.startsWith('[Tự động]'));
  assert.strictEqual(s.get('O4').userEnteredValue.stringValue, 'DONE');
});

test('[AN TOÀN] mã xuất hiện 2 lần ở cột A → DỪNG, không ghi gì', async () => {
  const { s, w } = setup();
  s.set('A6', { userEnteredValue: { stringValue: 'EVAL_V1_001' } });
  await assert.rejects(() => w.writeResult(baseEntry()), /xuất hiện 2 lần.*dòng 4, 6/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('--row chọn đúng 1 trong các dòng trùng thì ghi đúng dòng đó', async () => {
  const { s, w } = setup();
  s.set('A6', { userEnteredValue: { stringValue: 'EVAL_V1_001' } });
  const info = await w.writeResult(baseEntry({ row: 6 }));
  assert.strictEqual(info.cells.status, 'H6');
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'DONE');
});

test('[AN TOÀN] --row trỏ dòng của mã khác → DỪNG', async () => {
  const { w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ row: 5 })), /Sai dòng!.*--row=5/);
});

test('[AN TOÀN] vòng không có cột → DỪNG, nêu các vòng đang có', async () => {
  const { s, w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ round: 9 })), /TEST LẦN 9.*Sheet đang có vòng: 1, 2/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('Sheet chèn dòng giữa lúc đọc lưới và lúc đọc sống → làm mới lưới 1 lần rồi ghi đúng dòng mới', async () => {
  const { s, w } = setup();
  s.hooks.beforeReadCells = (n) => {
    if (n === 1) insertRowAt(s, 3);
  };
  const info = await w.writeResult(baseEntry());
  assert.strictEqual(info.cells.status, 'H5');
  assert.strictEqual(s.get('H5').userEnteredValue.stringValue, 'DONE');
  assert.deepStrictEqual(s.get('H4'), {});
});

test('[AN TOÀN] dòng dời liên tục → DỪNG, không ghi', async () => {
  const { s, w } = setup();
  s.hooks.beforeReadCells = (n) => {
    if (n <= 2) insertRowAt(s, 3);
  };
  await assert.rejects(() => w.writeResult(baseEntry()), /Sai vị trí!.*chèn\/xoá\/sắp xếp dòng/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('[AN TOÀN] Trạng thái không nằm trong danh sách chọn → DỪNG trước khi ghi', async () => {
  const { s, w } = setup();
  const h4 = s.get('H4');
  h4.dataValidation.condition.values = [{ userEnteredValue: 'Doing' }];
  s.set('H4', h4);
  await assert.rejects(() => w.writeResult(baseEntry()), /chỉ nhận Doing/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('nhãn Môi trường không có trong danh sách chọn → bỏ qua cột đó + cảnh báo', async () => {
  const { s, w } = setup();
  const info = await w.writeResult(baseEntry({ envLabel: 'Staging' }));
  assert.strictEqual(info.cells.env, undefined);
  assert.match(info.warnings.join(' | '), /Staging/);
  assert.strictEqual(s.get('G4').userEnteredValue.stringValue, 'Localhost');
});

test('không có nhãn Môi trường (host lạ) → bỏ qua cột Môi trường', async () => {
  const { w } = setup();
  const info = await w.writeResult(baseEntry({ envLabel: null }));
  assert.strictEqual(info.cells.env, undefined);
  assert.match(info.warnings.join(' | '), /chưa có nhãn Môi trường/);
});

test('[AN TOÀN] ô Kết quả đang là công thức → DỪNG', async () => {
  const { s, w } = setup();
  s.set('I4', { userEnteredValue: { formulaValue: '=HYPERLINK("https://x")' } });
  await assert.rejects(() => w.writeResult(baseEntry()), /công thức/);
});

test('ô Test Date chưa có định dạng ngày thì đặt thêm định dạng dd/mm/yyyy', async () => {
  const { s, w } = setup();
  s.set('L4', {});
  await w.writeResult(baseEntry());
  assert.strictEqual(s.get('L4').userEnteredFormat.numberFormat.pattern, 'dd/mm/yyyy');
});

test('đọc lại sau khi ghi không khớp → lỗi có auditId, nhật ký verified=false', async () => {
  const { s, audit, w } = setup();
  s.hooks.afterUpdate = () => {
    const h4 = s.get('H4');
    h4.userEnteredValue = { stringValue: 'Doing' };
    s.set('H4', h4);
  };
  await assert.rejects(
    () => w.writeResult(baseEntry()),
    (err) => {
      assert.match(err.message, /không khớp ở H4/);
      assert.strictEqual(err.auditId, audit.entries[0].auditId);
      return true;
    }
  );
  assert.deepStrictEqual(audit.entries.map((x) => [x.kind, x.verified]), [['write', null], ['verify', false]]);
});

test('[AN TOÀN] QC xoá 1 cột trong lúc lưới còn trong bộ nhớ → nhãn lệch, làm mới lưới, ghi đúng cột mới', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry()); // lưới được nhớ 60s
  deleteColumnAt(s, 9); // xoá cột J (FEEDBACK AI) → vòng 2 dời sang trái 1 cột
  const reads = s.calls.readGrid;
  const info = await w.writeResult(baseEntry({ round: 2, runId: 'c1c2c3c4-0000' }));
  assert.strictEqual(s.calls.readGrid, reads + 1);
  assert.deepStrictEqual(info.cells, { status: 'N4', result: 'O4', env: 'M4', testDate: 'R4' });
  assert.strictEqual(s.get('N4').userEnteredValue.stringValue, 'DONE');
  assert.ok(s.get('O4').userEnteredValue.stringValue.startsWith('[Tự động]'));
  assert.deepStrictEqual(s.get('P4'), {}); // cột DEV /QC NOTE không bị đụng
});

test('[AN TOÀN] QC chèn 1 cột trước khối vòng → làm mới lưới, ghi đúng cột mới', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry());
  insertColumnAt(s, 12); // chèn trước "TEST LẦN 2"
  const info = await w.writeResult(baseEntry({ round: 2, runId: 'c1c2c3c4-0001' }));
  assert.deepStrictEqual(info.cells, { status: 'P4', result: 'Q4', env: 'O4', testDate: 'T4' });
  assert.deepStrictEqual(s.get('M4'), {});
});

test('[AN TOÀN] QC sắp xếp lại dòng trong lúc lưới còn trong bộ nhớ → ghi đúng dòng mới của mã', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry({ caseId: 'EVAL_V1_002', runId: 'd1d2d3d4-0000' }));
  swapRows(s, 3, 4); // EVAL_V1_001 giờ ở dòng 5
  const info = await w.writeResult(baseEntry({ round: 2, runId: 'd1d2d3d4-0001' }));
  assert.strictEqual(info.cells.status, 'O5');
  assert.strictEqual(s.get('O5').userEnteredValue.stringValue, 'DONE');
});

test('[AN TOÀN] tên tab giờ thuộc tab khác (vừa đổi tên) → DỪNG, không ghi', async () => {
  const { s, w } = setup();
  s.hooks.servedGid = 99;
  await assert.rejects(() => w.writeResult(baseEntry()), /AN TOÀN.*đổi tên/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('[AN TOÀN] ô Kết quả đang là số → DỪNG (nối chữ sẽ làm mất số)', async () => {
  const { s, w } = setup();
  s.set('I4', { userEnteredValue: { numberValue: 12345 } });
  await assert.rejects(() => w.writeResult(baseEntry()), /số \/ đúng-sai/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('[AN TOÀN] ô Kết quả đã có kết quả tự động MỚI HƠN → không ghi kết quả cũ đè lên', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry({ runId: 'e1e2e3e4-new', startedAt: new Date(2026, 8, 28, 11, 0).toISOString() }));
  await assert.rejects(
    () => w.writeResult(baseEntry({ runId: 'e9e8e7e6-old', pass: false, startedAt: new Date(2026, 8, 28, 10, 15).toISOString() })),
    /MỚI HƠN.*28\/09\/2026 11:00 #e1e2e3e4/
  );
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'DONE');
  assert.strictEqual(s.calls.batchUpdate.length, 1);
});

test('mất mạng khi gửi (không rõ đã ghi chưa) → lỗi có auditId, nhật ký còn bản chụp "trước"', async () => {
  const { s, audit, w } = setup();
  s.hooks.failUpdate = new Error('ECONNRESET');
  await assert.rejects(
    () => w.writeResult(baseEntry()),
    (err) => {
      assert.match(err.message, /Không chắc lần ghi đã vào Sheet/);
      assert.strictEqual(err.uncertain, true);
      assert.strictEqual(err.auditId, audit.entries[0].auditId);
      return true;
    }
  );
  assert.deepStrictEqual(audit.entries.map((x) => x.kind), ['write']);
});

test('API từ chối cả lượt (400) → nhật ký "abort", lỗi không có auditId', async () => {
  const { s, audit, w } = setup();
  const e400 = new Error('[SHEET] ghi Sheet: HTTP 400 — Invalid requests');
  e400.status = 400;
  s.hooks.failUpdate = e400;
  await assert.rejects(() => w.writeResult(baseEntry()), (err) => err === e400 && err.auditId === undefined);
  assert.deepStrictEqual(audit.entries.map((x) => x.kind), ['write', 'abort']);
  assert.strictEqual(audit.entries[1].abortOf, audit.entries[0].auditId);
});

test('ghi xong nhưng đọc lại hỏng → lỗi có auditId (vẫn hoàn tác được)', async () => {
  const { s, audit, w } = setup();
  // readCells lần 1 = đọc sống, lần 2 = đọc lại sau khi ghi
  s.hooks.failReadCells = { n: 2, error: new Error('socket hang up') };
  await assert.rejects(
    () => w.writeResult(baseEntry()),
    (err) => /Đã ghi nhưng không đọc lại được/.test(err.message) && err.auditId === audit.entries[0].auditId
  );
  assert.strictEqual(s.calls.readCells, 2);
  assert.ok(s.get('I4').userEnteredValue.stringValue.includes('#a1b2c3d4'));
  assert.deepStrictEqual(audit.entries.map((x) => x.kind), ['write']);
});

test('ghi lại lần chạy đã ghi mà lần đó đọc lại lệch → trả auditId cũ + priorVerified=false + ô lệch', async () => {
  const { s, audit, w } = setup();
  s.hooks.afterUpdate = () => {
    s.hooks.afterUpdate = null;
    s.set('H4', { ...s.get('H4'), userEnteredValue: { stringValue: 'Doing' } });
  };
  const first = await w.writeResult(baseEntry({ pass: false })).catch((err) => err);
  const again = await w.writeResult(baseEntry({ pass: false }));
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.auditId, first.auditId);
  assert.strictEqual(again.priorVerified, false);
  assert.match(again.mismatched.join(' | '), /H4 = "Doing" \(mong đợi "Fail"\)/);
  assert.strictEqual(audit.entries.filter((x) => x.kind === 'write').length, 1);
});

test('lần chạy đã ghi rồi có lần chạy mới hơn nối sau → superseded, không báo lệch', async () => {
  const { w } = setup();
  await w.writeResult(baseEntry({ runId: 'f1f2f3f4-a', pass: false }));
  await w.writeResult(baseEntry({ runId: 'f5f6f7f8-b', pass: true }));
  const again = await w.writeResult(baseEntry({ runId: 'f1f2f3f4-a', pass: false }));
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.superseded, true);
  assert.deepStrictEqual(again.mismatched, []);
});

test('[AN TOÀN] thiếu link video / pass không phải boolean / vòng sai → DỪNG', async () => {
  const { w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ videoUrl: '' })), /thiếu link video/);
  await assert.rejects(() => w.writeResult(baseEntry({ pass: 'yes' })), /pass phải là true hoặc false/);
  await assert.rejects(() => w.writeResult(baseEntry({ round: 0 })), /vòng/);
});

test('enqueue ghi tuần tự: 2 lần ghi cùng lúc không chồng lên nhau', async () => {
  const { s, w } = setup();
  const [a, b] = await Promise.all([w.enqueue(baseEntry()), w.enqueue(baseEntry({ round: 2, runId: 'b1b2c3d4-0000' }))]);
  assert.strictEqual(a.cells.status, 'H4');
  assert.strictEqual(b.cells.status, 'O4');
  assert.strictEqual(s.calls.batchUpdate.length, 2);
});

test('lỗi ở lần ghi trước không làm kẹt hàng đợi', async () => {
  const { w } = setup();
  await assert.rejects(() => w.enqueue(baseEntry({ round: 9 })));
  const ok = await w.enqueue(baseEntry());
  assert.strictEqual(ok.state, 'written');
});
