const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./valid_snapshot');

const ok = (verdict, checks, steps = [{ ok: true }]) => ({ testcaseId: '1308-AI01', verdict, checks, steps, error: null });

test('isValidResult: cùng luật verdict hiệu lực — Đạt cần phép kiểm, Không đạt cần phép kiểm sai, mọi bước đạt', () => {
  assert.strictEqual(V.isValidResult(ok('KHONG_DAT', [{ ok: false }])), true);
  assert.strictEqual(V.isValidResult(ok('DAT', [{ ok: true }])), true);
  assert.strictEqual(V.isValidResult(ok('KHONG_DAT', [])), false); // kịch bản dò, không check
  assert.strictEqual(V.isValidResult(ok('KHONG_DAT', [{ ok: true }])), false);
  assert.strictEqual(V.isValidResult(ok('DAT', [])), false);
  assert.strictEqual(V.isValidResult(ok('KHONG_DAT', [{ ok: false }], [{ ok: false, label: 'B0 Chuẩn bị' }])), false);
  assert.strictEqual(V.isValidResult({ ...ok('KHONG_DAT', [{ ok: false }]), error: 'Timeout' }), false);
});

test('markReady: ready: false → true; chưa có thì thêm sau module.exports = {', () => {
  assert.match(V.markReady("module.exports = {\n  id: 'X',\n  ready: false,\n};"), /ready: true,/);
  assert.match(V.markReady("module.exports = { id: 'X', run() {} };"), /module\.exports = \{\n {2}ready: true,/);
  assert.strictEqual(V.markReady("module.exports = { ready: true };"), "module.exports = { ready: true };");
});

test('lưu bản hợp lệ rồi khôi phục cho case chưa sẵn sàng; case đã sẵn sàng / không có bản hợp lệ giữ nguyên', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-valid-'));
  const tickets = path.join(root, 'tickets');
  fs.mkdirSync(tickets);
  const file = (id) => path.join(tickets, `${id.toLowerCase()}.test.js`);
  fs.writeFileSync(file('1308-AI01'), "module.exports = { id: '1308-AI01', ready: false, step: 'luot 7' };");
  fs.writeFileSync(file('1308-AI02'), "module.exports = { id: '1308-AI02', ready: false, step: 'luot 3' };");
  const env = { AIQC_DRY_LEDGER: path.join(root, 'runs', 'aiqc', 'dry-1308-x.json') };

  const saved = V.saveValidSnapshots(
    [ok('KHONG_DAT', [{ ok: false }]), { ...ok('KHONG_DAT', []), testcaseId: '1308-AI02' }],
    { '1308-AI01': 7, '1308-AI02': 3 },
    (id) => file(id),
    env
  );
  assert.deepStrictEqual(saved, [{ id: '1308-AI01', run: 7, verdict: 'KHONG_DAT' }]);

  // AI sửa tiếp làm hỏng kịch bản sau lượt hợp lệ
  fs.writeFileSync(file('1308-AI01'), "module.exports = { id: '1308-AI01', ready: false, step: 'luot 8 hong' };");
  const restored = V.restoreValidSnapshots(
    [
      { id: '1308-AI01', ready: false, problems: [] },
      { id: '1308-AI02', ready: false, problems: [] },
    ],
    env.AIQC_DRY_LEDGER,
    tickets
  );
  assert.deepStrictEqual(restored, [{ id: '1308-AI01', run: 7, verdict: 'KHONG_DAT' }]);
  assert.strictEqual(fs.readFileSync(file('1308-AI01'), 'utf8'), "module.exports = { id: '1308-AI01', ready: true, step: 'luot 7' };");
  assert.match(fs.readFileSync(file('1308-AI02'), 'utf8'), /luot 3/);

  // đã sẵn sàng thì không đè
  fs.writeFileSync(file('1308-AI01'), "module.exports = { id: '1308-AI01', ready: true, step: 'ban moi' };");
  assert.deepStrictEqual(V.restoreValidSnapshots([{ id: '1308-AI01', ready: true, problems: [] }], env.AIQC_DRY_LEDGER, tickets), []);
});

test('không có AIQC_DRY_LEDGER → không lưu gì (QC chạy tay)', () => {
  assert.deepStrictEqual(V.saveValidSnapshots([ok('KHONG_DAT', [{ ok: false }])], {}, () => __filename, {}), []);
});

test('restoreValidSnapshots: case ghi blocker «Môi trường thử không chạy …» không bị khôi phục; blocker khác vẫn khôi phục', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-valid-env-'));
  const tickets = path.join(root, 'tickets');
  fs.mkdirSync(tickets);
  const file = (id) => path.join(tickets, `${id.toLowerCase()}.test.js`);
  const env = { AIQC_DRY_LEDGER: path.join(root, 'runs', 'aiqc', 'dry-1338-x.json') };
  for (const id of ['1338-AI01', '1338-AI02']) fs.writeFileSync(file(id), `module.exports = { id: '${id}', ready: false };`);
  V.saveValidSnapshots(
    [
      { ...ok('KHONG_DAT', [{ ok: false }]), testcaseId: '1338-AI01' },
      { ...ok('KHONG_DAT', [{ ok: false }]), testcaseId: '1338-AI02' },
    ],
    { '1338-AI01': 2, '1338-AI02': 5 },
    (id) => file(id),
    env
  );
  const restored = V.restoreValidSnapshots(
    [
      { id: '1338-AI01', ready: false, blocker: 'Môi trường thử không chạy job nhắc việc — QC kiểm tay', problems: [] },
      { id: '1338-AI02', ready: false, blocker: 'Hết lượt chạy nháp', problems: [] },
    ],
    env.AIQC_DRY_LEDGER,
    tickets
  );
  assert.deepStrictEqual(restored.map((item) => item.id), ['1338-AI02']);
  assert.match(fs.readFileSync(file('1338-AI01'), 'utf8'), /ready: false/);
});
