const test = require('node:test');
const assert = require('node:assert');
const { otherProfiles } = require('./aiqc');

test('aiqc profiles: chỉ hồ sơ KHÁC hồ sơ chính, cùng tổ chức, đủ email + mật khẩu — không lộ email / mật khẩu', () => {
  const env = {
    FASTDO_EMAIL_3: 'tester@x.vn', FASTDO_PASSWORD_3: 'p', ORG_NAME_3: 'Cty QC',
    PROFILE_NHANVIEN_EMAIL: 'nv@x.vn', PROFILE_NHANVIEN_PASSWORD: 'p', PROFILE_NHANVIEN_ORG: 'Cty QC', PROFILE_NHANVIEN_NOTE: 'Nhân viên',
    PROFILE_THIEUMK_EMAIL: 'x@x.vn', PROFILE_THIEUMK_ORG: 'Cty QC',
    PROFILE_KHAC_EMAIL: 'k@x.vn', PROFILE_KHAC_PASSWORD: 'p', PROFILE_KHAC_ORG: 'Cty khác',
  };
  assert.deepStrictEqual(otherProfiles(env, 3), {
    main: 'slot3',
    profiles: [{ name: 'nhanvien', org: 'Cty QC', note: 'Nhân viên' }],
  });
});
