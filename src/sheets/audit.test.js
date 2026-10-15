const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { createAuditLog, undoWrite, writeStatus } = require('./audit');
const { createSheetWriter } = require('./sheet_writer');
const { makeV1Sheet, baseEntry, tmpFile, swapRows } = require('./testkit');

async function written(entry = baseEntry()) {
  const s = makeV1Sheet();
  const log = createAuditLog(tmpFile());
  const before = Object.fromEntries(['G4', 'H4', 'I4', 'L4'].map((a) => [a, s.get(a)]));
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: log });
  const info = await w.writeResult(entry);
  return { s, log, before, info, w };
}

const undo = (s, log, auditId) => undoWrite({ client: s.client, auditLog: log, auditId, tabTitle: s.title });

test('hoàn tác trả 4 ô về y như trước, kể cả link cũ', async () => {
  const { s, log, before, info } = await written();
  const r = await undo(s, log, info.auditId);
  assert.deepStrictEqual(r.restored.slice().sort(), ['G4', 'H4', 'I4', 'L4']);
  assert.deepStrictEqual(r.refused, []);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.verified, true);
  for (const a1 of Object.keys(before)) {
    assert.deepStrictEqual(s.get(a1).userEnteredValue, before[a1].userEnteredValue, a1);
  }
  assert.deepStrictEqual(s.get('I4').textFormatRuns, before.I4.textFormatRuns);
  assert.strictEqual(log.list().filter((e) => e.kind === 'undo').length, 1);
});

test('1 ô đã bị người khác sửa sau lần ghi → KHÔNG hoàn tác ô nào (không để dòng nửa vời)', async () => {
  const { s, log, info } = await written(baseEntry({ pass: false }));
  s.set('I4', { userEnteredValue: { stringValue: 'QC sửa tay' } });
  const r = await undo(s, log, info.auditId);
  assert.strictEqual(r.blocked, true);
  assert.deepStrictEqual(r.restored, []);
  assert.deepStrictEqual(r.refused.map((x) => x.a1), ['I4']);
  assert.match(r.refused[0].reason, /QC sửa tay/);
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'Fail'); // không bị trả về
  assert.strictEqual(log.list().filter((e) => e.kind === 'undo').length, 0); // thử lại được sau khi sửa tay
});

test('[AN TOÀN] dòng đã bị sắp xếp lại: ô giờ thuộc case khác → không hoàn tác ô nào', async () => {
  const { s, log, info, w } = await written();
  await w.writeResult(baseEntry({ caseId: 'EVAL_V1_002', runId: 'b2b2b2b2-0000' }));
  swapRows(s, 3, 4); // dòng 4 giờ là EVAL_V1_002
  const h4 = s.get('H4');
  await assert.rejects(() => undo(s, log, info.auditId), /AN TOÀN.*A4 hiện là "EVAL_V1_002"/);
  assert.deepStrictEqual(s.get('H4'), h4);
});

test('[AN TOÀN] còn lần ghi mới hơn vào cùng ô → phải hoàn tác lần mới nhất trước', async () => {
  const { s, log, before, info, w } = await written(baseEntry({ runId: 'aaaaaaaa-1' }));
  const second = await w.writeResult(baseEntry({ runId: 'bbbbbbbb-2', pass: false }));
  await assert.rejects(() => undo(s, log, info.auditId), /mới hơn.*Hoàn tác từ lần MỚI NHẤT trước/);
  const r2 = await undo(s, log, second.auditId);
  assert.strictEqual(r2.blocked, false);
  const r1 = await undo(s, log, info.auditId);
  assert.strictEqual(r1.blocked, false);
  for (const a1 of Object.keys(before)) {
    assert.deepStrictEqual(s.get(a1).userEnteredValue, before[a1].userEnteredValue, a1);
  }
});

test('lần ghi chưa đọc lại được (mất mạng) vẫn hoàn tác được — so theo giá trị đã gửi', async () => {
  const s = makeV1Sheet();
  const log = createAuditLog(tmpFile());
  const before = s.get('H4');
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: log });
  s.hooks.failReadCells = { n: 2, error: new Error('socket hang up') };
  const err = await w.writeResult(baseEntry({ pass: false })).catch((x) => x);
  assert.ok(err.auditId);
  assert.strictEqual(writeStatus(log.list(), err.auditId).verified, null);
  const r = await undo(s, log, err.auditId);
  assert.strictEqual(r.blocked, false);
  assert.deepStrictEqual(s.get('H4').userEnteredValue, before.userEnteredValue);
});

test('lần ghi bị API từ chối (abort) → không có gì để hoàn tác', async () => {
  const s = makeV1Sheet();
  const log = createAuditLog(tmpFile());
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: log });
  const e400 = new Error('HTTP 400');
  e400.status = 400;
  s.hooks.failUpdate = e400;
  await assert.rejects(() => w.writeResult(baseEntry()));
  const id = log.list().find((e) => e.kind === 'write').auditId;
  await assert.rejects(() => undo(s, log, id), /bị API từ chối/);
});

test('không hoàn tác 2 lần; auditId lạ thì báo lỗi', async () => {
  const { s, log, info } = await written();
  await undo(s, log, info.auditId);
  await assert.rejects(() => undo(s, log, info.auditId), /đã được hoàn tác/);
  await assert.rejects(() => undo(s, log, 'w-khong-co'), /Không có lần ghi/);
});

test('nhật ký kiểu cũ (after + verified trong dòng write) vẫn hoàn tác được', async () => {
  const { s, log, before, info } = await written();
  // Dựng lại đúng dòng nhật ký kiểu kỳ 1: 1 dòng write có sẵn after, không có verify.
  const all = log.list();
  const w = all.find((e) => e.kind === 'write');
  const v = all.find((e) => e.kind === 'verify');
  const old = { ...w, verified: true, cells: w.cells.map((c) => ({ ...c, sent: undefined, after: v.cells.find((x) => x.a1 === c.a1).after })) };
  delete old.id;
  const log2 = createAuditLog(tmpFile());
  log2.append(old);
  const r = await undo(s, log2, info.auditId);
  assert.strictEqual(r.blocked, false);
  assert.deepStrictEqual(s.get('I4').textFormatRuns, before.I4.textFormatRuns);
});

test('nhật ký NDJSON đọc lại được sau khi khởi động lại, bỏ qua dòng hỏng', () => {
  const file = tmpFile();
  const a = createAuditLog(file);
  a.append({ kind: 'write', auditId: 'w1', cells: [] });
  fs.appendFileSync(file, '{hỏng\n', 'utf8');
  a.append({ kind: 'write', auditId: 'w2', cells: [] });
  const b = createAuditLog(file);
  assert.deepStrictEqual(b.list().map((e) => e.auditId), ['w1', 'w2']);
  assert.strictEqual(b.find('w2').auditId, 'w2');
  assert.strictEqual(b.find('w9'), null);
});
