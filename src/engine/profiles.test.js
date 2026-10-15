const test = require('node:test');
const assert = require('node:assert');
const P = require('./profiles');

const ENV = {
  FASTDO_EMAIL: 'a@x',
  FASTDO_PASSWORD: 'pa',
  ORG_NAME: 'Org A',
  FASTDO_EMAIL_2: 'b@x',
  FASTDO_PASSWORD_2: 'pb',
  PROFILE_NHANVIEN_EMAIL: 'nv@x',
  PROFILE_NHANVIEN_PASSWORD: 'pn',
  PROFILE_NHANVIEN_ORG: 'WATER QUALITY - TEAM 1ST',
  PROFILE_QUAN_LY_EMAIL: 'ql@x',
  PROFILE_QUAN_LY_PASSWORD: 'pq',
};

test('đọc đủ hồ sơ default, slot2 (tương thích --account=2) và hồ sơ có tên', () => {
  const all = P.listProfiles(ENV);
  assert.deepStrictEqual([...all.keys()].sort(), ['default', 'nhanvien', 'quan_ly', 'slot2']);
  assert.strictEqual(all.get('slot2').org, 'Org A');
  assert.strictEqual(all.get('nhanvien').org, 'WATER QUALITY - TEAM 1ST');
  assert.strictEqual(all.get('quan_ly').org, 'Org A');
});

test('getProfile báo đúng biến cần khai khi thiếu hồ sơ / thiếu mật khẩu', () => {
  assert.throws(() => P.getProfile('ketoan', ENV), /PROFILE_KETOAN_EMAIL/);
  assert.throws(() => P.getProfile('slot3', ENV), /FASTDO_EMAIL_3/);
  assert.throws(() => P.getProfile('default', { FASTDO_EMAIL: 'a@x' }), /thiếu mật khẩu/);
  assert.strictEqual(P.getProfile('nhanvien', ENV).email, 'nv@x');
});

test('--account=N → tên hồ sơ', () => {
  assert.strictEqual(P.profileForAccount(1), 'default');
  assert.strictEqual(P.profileForAccount('2'), 'slot2');
});

test('publicProfile không bao giờ có mật khẩu', () => {
  const pub = P.publicProfile(P.getProfile('default', ENV));
  assert.strictEqual(pub.password, undefined);
  assert.strictEqual(pub.hasPassword, true);
  assert.ok(!JSON.stringify(pub).includes('"pa"'));
});

test('file phiên theo tên hồ sơ, không đụng file Puppeteer cũ', () => {
  assert.match(P.storagePathOf({ name: 'nhanvien' }), /[\\/]\.auth[\\/]nhanvien\.json$/);
});
