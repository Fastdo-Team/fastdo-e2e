const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./result_v2');

test('verdictOf: huỷ > lỗi hạ tầng > đạt/không đạt', () => {
  assert.strictEqual(R.verdictOf({ cancelled: true, error: 'x' }), 'DA_HUY');
  assert.strictEqual(R.verdictOf({ error: 'x', pass: false }), 'LOI_HA_TANG');
  assert.strictEqual(R.verdictOf({ pass: true }), 'DAT');
  assert.strictEqual(R.verdictOf({ pass: false }), 'KHONG_DAT');
});

test('tên thư mục run: nháp ghi "nhap", thật ghi "v<vòng>", kèm hồ sơ, pid, lần thử', () => {
  assert.strictEqual(
    R.runDirName({ stamp: '20260929-101500', caseId: 'EVAL_021', mode: 'nhap', round: 3, profile: 'default', pid: 42, attempt: 1 }),
    '20260929-101500-EVAL_021-nhap-default-42-a1'
  );
  assert.strictEqual(
    R.runDirName({ stamp: '20260929-101500', caseId: 'EVAL_021', mode: 'that', round: 3, profile: 'slot2', pid: 42, attempt: 2 }),
    '20260929-101500-EVAL_021-v3-slot2-42-a2'
  );
});

test('createRecord giữ đủ trường v1 mà giao diện cũ và commit đang đọc', () => {
  const r = R.createRecord({ caseId: 'EVAL_1', runId: 'abcdefgh', mode: 'that', round: 2, profile: 'default', runDir: 'x' });
  for (const k of ['testcaseId', 'round', 'account', 'pass', 'resultText', 'videoPath', 'videoUrl', 'sheet', 'sheetCell', 'sheetStatus', 'error', 'failReport', 'seconds', 'startedAt', 'targetUrl', 'flags']) {
    assert.ok(k in r, k);
  }
  assert.strictEqual(r.schema, 2);
});

test('writeRecord ghi result.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-rec-'));
  const r = R.createRecord({ caseId: 'EVAL_1', runId: 'abcdefgh', mode: 'nhap', profile: 'default', runDir: dir });
  R.writeRecord(r);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')).testcaseId, 'EVAL_1');
});
