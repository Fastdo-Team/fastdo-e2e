const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isFreshSession } = require('./app_session');

test('isFreshSession: file phiên vừa kiểm trong khoảng tin cậy (mặc định 30 phút); 0 = tắt; thiếu file = không', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-sess-')), 'slot3.json');
  assert.strictEqual(isFreshSession(file, { env: {} }), false);
  fs.writeFileSync(file, '{}');
  const now = fs.statSync(file).mtimeMs;
  assert.strictEqual(isFreshSession(file, { env: {}, now: now + 29 * 60000 }), true);
  assert.strictEqual(isFreshSession(file, { env: {}, now: now + 31 * 60000 }), false);
  assert.strictEqual(isFreshSession(file, { env: { SESSION_TRUST_MINUTES: '0' }, now }), false);
  assert.strictEqual(isFreshSession(file, { env: { SESSION_TRUST_MINUTES: '5' }, now: now + 6 * 60000 }), false);
});
