// ============================================================================
// profiles.js: hồ sơ tài khoản (ai đăng nhập) đọc từ .env.
//
//   FASTDO_EMAIL / FASTDO_PASSWORD / ORG_NAME         → hồ sơ "default"
//   FASTDO_EMAIL_N / FASTDO_PASSWORD_N / ORG_NAME_N   → hồ sơ "slotN" (tương thích --account=N)
//   PROFILE_<TÊN>_EMAIL / _PASSWORD / _ORG            → hồ sơ "<tên>" (viết thường)
//
// Số luồng và hồ sơ độc lập nhau: nhiều luồng dùng chung 1 hồ sơ được. Hồ sơ chỉ cần
// thêm khi có case đòi tài khoản / quyền / tổ chức khác. Mật khẩu KHÔNG bao giờ ra log.
// ============================================================================

const path = require('path');
const config = require('../config');

const FALLBACK_ORG = 'Water Quality - NH3T TEAM'; // cùng mặc định cũ của config.js
const NAME_RE = /^[a-z0-9_]{1,40}$/;

function listProfiles(env = process.env) {
  const out = new Map();
  const val = (k) => String(env[k] || '').trim();
  const baseOrg = val('ORG_NAME') || FALLBACK_ORG;

  if (env.FASTDO_EMAIL || env.FASTDO_PASSWORD) {
    out.set('default', {
      name: 'default',
      email: val('FASTDO_EMAIL'),
      password: env.FASTDO_PASSWORD || '',
      org: baseOrg,
      source: 'FASTDO_EMAIL',
    });
  }
  for (const key of Object.keys(env).sort()) {
    const slot = /^FASTDO_EMAIL_(\d+)$/.exec(key);
    if (!slot) continue;
    const n = slot[1];
    out.set(`slot${n}`, {
      name: `slot${n}`,
      email: val(key),
      password: env[`FASTDO_PASSWORD_${n}`] || '',
      org: val(`ORG_NAME_${n}`) || baseOrg,
      source: key,
    });
  }
  for (const key of Object.keys(env).sort()) {
    const named = /^PROFILE_([A-Za-z0-9_]+)_EMAIL$/.exec(key);
    if (!named) continue;
    const raw = named[1];
    const name = raw.toLowerCase();
    if (!NAME_RE.test(name)) continue;
    out.set(name, {
      name,
      email: val(key),
      password: env[`PROFILE_${raw}_PASSWORD`] || '',
      org: val(`PROFILE_${raw}_ORG`) || baseOrg,
      source: key,
    });
  }
  return out;
}

function hintFor(name) {
  if (name === 'default') return 'FASTDO_EMAIL / FASTDO_PASSWORD';
  const slot = /^slot(\d+)$/.exec(name);
  if (slot) return `FASTDO_EMAIL_${slot[1]} / FASTDO_PASSWORD_${slot[1]}`;
  return `PROFILE_${name.toUpperCase()}_EMAIL / PROFILE_${name.toUpperCase()}_PASSWORD`;
}

/** Hồ sơ theo tên; không có hoặc thiếu email/mật khẩu thì ném lỗi nói đúng biến cần khai */
function getProfile(name, env = process.env) {
  const all = listProfiles(env);
  const p = all.get(name);
  if (!p) {
    throw new Error(
      `Chưa khai hồ sơ tài khoản "${name}" — thêm ${hintFor(name)} vào .env. ` +
        `Đang có: ${[...all.keys()].join(', ') || '(không có)'}.`
    );
  }
  if (!p.email || !p.password) {
    throw new Error(`Hồ sơ "${name}" thiếu ${!p.email ? 'email' : 'mật khẩu'} trong .env (${hintFor(name)}).`);
  }
  return p;
}

function profileForAccount(n) {
  return Number(n) > 1 ? `slot${Number(n)}` : 'default';
}

/** File phiên Playwright của hồ sơ. File cũ .auth/user_state*.json (Puppeteer) để nguyên. */
function storagePathOf(profile) {
  return path.join(config.AUTH_DIR, `${profile.name}.json`);
}

/** Bản an toàn để hiển thị / ghi log — không bao giờ có mật khẩu */
function publicProfile(p) {
  return { name: p.name, email: p.email, org: p.org, source: p.source, hasPassword: Boolean(p.password) };
}

module.exports = { listProfiles, getProfile, profileForAccount, storagePathOf, publicProfile, NAME_RE, FALLBACK_ORG };
