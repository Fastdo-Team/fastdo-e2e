// ============================================================================
// qc_db.js: ctx.db — kịch bản AI-QC ghi dữ liệu thử THẲNG vào Mongo QC thay vì tạo qua giao diện (bản 1.8.0).
//
//   AIQC_MONGO_URI      Mongo mà bản test đang dùng (agent đặt = E2E.QcMongoUri) — chỉ nhận localhost
//   AIQC_CACHE_SECRET   khoá API làm mới cache của bản test (agent đặt ngẫu nhiên mỗi lần bật bản test)
//
// Chốt an toàn: Mongo phải là localhost VÀ có bản ghi đánh dấu aiqc_guard.marker {_id:"qc"} (giống agent) — thiếu thì từ
// chối, không bao giờ ghi vào Mongo dữ liệu thật. Chỉ ghi DB của công ty thử (fastdo_<mã>); DB chung chỉ được chạm qua
// createAccount (users + companys.users). Mọi thứ tạo / sửa / xoá được ghi sổ và tự hoàn tác khi case kết thúc (restoreAll)
// — DB sạch, case sau không bị ảnh hưởng.
// Cấu trúc Fastdo: DB chung "fastdo" (users, companys), mỗi công ty 1 DB "fastdo_<mã công ty>"; _id là chuỗi; ngày giờ là
// ticks .NET (Int64) — đọc / ghi bằng BigInt (useBigInt64) để không mất chính xác.
// ============================================================================

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const MAIN_DB = 'fastdo';
const GUARD = { db: 'aiqc_guard', collection: 'marker', id: 'qc' };
const MAIN_READABLE = new Set(['users', 'companys']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
// Trường không được chép sang tài khoản tạo mới (phiên, thiết bị, liên kết đăng nhập ngoài…) và bị che khi xem bản ghi
const SECRET_KEY_RE = /pass|token|secret|session|otp|fcm|device|refresh|api_?key|google|social|wiseeye|verify|last_login|online/i;
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TICKS_AT_EPOCH = 621355968000000000n;

const p2 = (n) => String(n).padStart(2, '0');

/** Mã bản ghi kiểu Fastdo (SystemHelper.RandomId): yyMMddHHmmss UTC + 20 ký tự [0-9a-z], viết hoa — 32 ký tự */
function randomId(now = new Date(), rand = crypto.randomInt) {
  const head =
    p2(now.getUTCFullYear() % 100) + p2(now.getUTCMonth() + 1) + p2(now.getUTCDate()) +
    p2(now.getUTCHours()) + p2(now.getUTCMinutes()) + p2(now.getUTCSeconds());
  let tail = '';
  for (let i = 0; i < 20; i += 1) tail += ID_CHARS[rand(ID_CHARS.length)];
  return (head + tail).toUpperCase();
}

/** DateTime.Now.Ticks của .NET (theo giờ máy — Fastdo ghi created / created_at bằng giờ máy) dạng BigInt (Int64) */
function ticks(date = new Date()) {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return BigInt(localMs) * 10000n + TICKS_AT_EPOCH;
}

/** Mật khẩu Fastdo: MD5 của byte ASCII, hex viết hoa (AppHelper.CreateMD5) */
function md5Upper(text) {
  return crypto.createHash('md5').update(Buffer.from(String(text), 'ascii')).digest('hex').toUpperCase();
}

/** Chỉ nhận mongodb://localhost / 127.0.0.1 / ::1 — mọi host khác là từ chối */
function assertLocalUri(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(String(uri || '').trim());
  if (!m) throw new Error('AIQC_MONGO_URI không hợp lệ — chỉ nhận dạng mongodb://localhost:27017/');
  const hosts = m[1].split(',').map((host) => host.trim().replace(/:\d+$/, '').toLowerCase());
  if (!hosts.length || hosts.some((host) => !LOCAL_HOSTS.has(host))) {
    throw new Error(`[AN TOÀN] ctx.db chỉ ghi Mongo QC trên chính máy này (localhost) — từ chối "${m[1]}"`);
  }
}

/** Gán giá trị theo đường dẫn có dấu chấm ("overtime.is_allow_overday") — chép lại các object trên đường đi, không sửa bản gốc */
function setPath(target, dotted, value) {
  const keys = String(dotted).split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const current = node[keys[i]];
    node[keys[i]] = current && typeof current === 'object' ? (Array.isArray(current) ? current.slice() : { ...current }) : {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  return target;
}

function applyChanges(doc, changes = {}) {
  const out = { ...doc };
  for (const [key, value] of Object.entries(changes)) setPath(out, key, value);
  return out;
}

function stripSecrets(doc) {
  const out = { ...doc };
  for (const key of Object.keys(out)) if (SECRET_KEY_RE.test(key)) delete out[key];
  return out;
}

/** Bản ghi để XEM (db:peek / log): che trường bí mật, cắt chuỗi / mảng dài, Int64 → "123n" */
function forDisplay(value, depth = 0) {
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…(${value.length} ký tự)` : value;
  if (Array.isArray(value)) {
    const head = value.slice(0, 5).map((item) => forDisplay(item, depth + 1));
    return value.length > 5 ? [...head, `…(+${value.length - 5} phần tử)`] : head;
  }
  if (value && typeof value === 'object') {
    if (depth > 6) return '{…}';
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._bsontype) return String(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY_RE.test(key) ? '***' : forDisplay(item, depth + 1);
    return out;
  }
  return value;
}

/** Tài khoản thử chính + công ty thử trong DB chung (theo email + tên tổ chức của hồ sơ đang chạy) */
async function resolveCompany(client, profile) {
  const email = String((profile && profile.email) || '').trim().toLowerCase();
  if (!email) throw new Error('ctx.db: hồ sơ đang chạy không có email — không xác định được công ty thử');
  const main = client.db(MAIN_DB);
  const tester = await main.collection('users').findOne({ email, delete: false });
  if (!tester) throw new Error(`ctx.db: không thấy tài khoản thử ${email} trong Mongo QC`);
  const ids = (tester.companys || []).map((item) => item._id || item.id).filter(Boolean);
  const companies = await main.collection('companys').find({ _id: { $in: ids }, delete: false }).toArray();
  const company = companies.find((item) => item.name === profile.org) || (companies.length === 1 ? companies[0] : null);
  if (!company) throw new Error(`ctx.db: tài khoản thử không thuộc công ty "${profile.org}" trong Mongo QC`);
  return { tester, company };
}

/** Mở Mongo QC sau khi qua 2 chốt (localhost + bản ghi đánh dấu). Dùng chung cho ctx.db và lệnh db:peek. */
async function openQc({ env = process.env, profile, connect = (uri) => MongoClient.connect(uri, CLIENT_OPTIONS) } = {}) {
  const uri = String(env.AIQC_MONGO_URI || '').trim();
  if (!uri) throw new Error('ctx.db chỉ dùng trong lượt AI-QC — chưa đặt AIQC_MONGO_URI (agent đặt khi chạy)');
  assertLocalUri(uri);
  const client = await connect(uri);
  try {
    const marker = await client.db(GUARD.db).collection(GUARD.collection).findOne({ _id: GUARD.id });
    if (!marker) {
      throw new Error('[AN TOÀN] Mongo không có bản ghi đánh dấu aiqc_guard.marker {_id:"qc"} — không phải Mongo QC, từ chối');
    }
    const { tester, company } = await resolveCompany(client, profile);
    return { client, main: client.db(MAIN_DB), data: client.db(`fastdo_${company._id}`), tester, company };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

const CLIENT_OPTIONS = { serverSelectionTimeoutMS: 5000, useBigInt64: true };

/**
 * ctx.db của 1 case: nối Mongo QC khi dùng lần đầu, ghi sổ mọi thay đổi để restoreAll hoàn tác.
 * @param {object} o
 * @param {{name, email, org}} o.profile  hồ sơ đang chạy case (tài khoản thử chính)
 * @param {string} o.targetUrl            địa chỉ bản test (làm mới cache)
 */
function createQcDb({ profile, targetUrl, env = process.env, print = console.log, connect, fetchFn = globalThis.fetch } = {}) {
  let opening = null;
  let state = null;
  let cacheDirty = false;
  const undo = [];

  const open = async () => {
    if (state) return state;
    if (!opening) opening = openQc({ env, profile, connect });
    state = await opening;
    return state;
  };
  const collection = async (name, { main = false } = {}) => {
    const st = await open();
    if (main && !MAIN_READABLE.has(name)) throw new Error(`ctx.db: DB chung chỉ cho đọc users / companys (không phải "${name}")`);
    return (main ? st.main : st.data).collection(String(name));
  };
  const remember = (label, fn) => undo.push({ label, fn });

  async function refreshCache() {
    const st = await open();
    const secret = String(env.AIQC_CACHE_SECRET || '').trim();
    if (!secret || !targetUrl || typeof fetchFn !== 'function') {
      print('   ⚠ ctx.db.refreshCache: thiếu AIQC_CACHE_SECRET / địa chỉ bản test — bỏ qua làm mới cache');
      return false;
    }
    const base = String(targetUrl).replace(/\/+$/, '');
    const id = String(st.company._id);
    // Có hạn chờ: bản test treo thì B0 báo lỗi rõ sau 15 giây thay vì chờ tới hết thời gian của cả case
    const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined);
    let users;
    let all;
    try {
      users = await fetchFn(`${base}/GlobalService/SetUsers?company=${encodeURIComponent(`${id}_${secret}`)}`, { method: 'POST', signal: signal() });
      all = await fetchFn(`${base}/GlobalService/Update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Company: id, Secret: secret }),
        signal: signal(),
      });
    } catch (err) {
      // không chép địa chỉ vào lỗi: chuỗi truy vấn có khoá làm mới cache
      const why = err && err.name === 'TimeoutError' ? 'quá 15 giây' : err && err.message ? err.message : String(err);
      throw new Error(`ctx.db.refreshCache: không gọi được bản test để làm mới cache (${why})`);
    }
    cacheDirty = false;
    const ok = Boolean(users && users.ok && all && all.ok);
    // Trước đây trả false lặng lẽ: giao diện không thấy dữ liệu vừa ghi, kịch bản báo «không thấy bản ghi» sai chỗ
    if (!ok) {
      print(
        `   ⚠ ctx.db.refreshCache: bản test trả SetUsers ${users && users.status}, Update ${all && all.status} — ` +
          'giao diện có thể chưa thấy dữ liệu vừa ghi (cache thành viên / phòng ban / ca làm)'
      );
    }
    return ok;
  }

  const api = {
    newId: () => randomId(),
    ticks,
    /** Mã + tên công ty thử, mã + tên tài khoản thử chính */
    async info() {
      const st = await open();
      return {
        companyId: String(st.company._id),
        companyName: st.company.name,
        testerId: String(st.tester._id),
        testerName: st.tester.FullName || [st.tester.first_name, st.tester.last_name].filter(Boolean).join(' '),
      };
    },
    /** Đọc (DB công ty thử; { main: true } = DB chung, chỉ users / companys) */
    async find(name, filter = {}, { limit = 20, sort, main = false } = {}) {
      const cursor = (await collection(name, { main })).find(filter);
      if (sort) cursor.sort(sort);
      return cursor.limit(Math.min(Math.max(1, limit), 200)).toArray();
    },
    async findOne(name, filter = {}, { main = false } = {}) {
      return (await collection(name, { main })).findOne(filter);
    },
    /** Thêm 1 bản ghi vào DB công ty thử (_id tự sinh nếu thiếu); tự xoá khi case xong */
    async insert(name, doc) {
      const target = await collection(name);
      const record = { _id: randomId(), ...doc };
      await target.insertOne(record);
      remember(`xoá ${name}/${record._id}`, () => target.deleteOne({ _id: record._id }));
      cacheDirty = true;
      return record;
    },
    /** Nhân bản 1 bản ghi thật cùng loại làm khuôn (đúng cấu trúc) + đổi các trường (đường dẫn có dấu chấm được) */
    async clone(name, filter, changes = {}) {
      const target = await collection(name);
      const template = await target.findOne(filter || {});
      if (!template) throw new Error(`ctx.db.clone: không có bản ghi mẫu trong ${name} khớp ${JSON.stringify(forDisplay(filter || {}))}`);
      const record = applyChanges({ ...template, _id: randomId() }, changes);
      await target.insertOne(record);
      remember(`xoá ${name}/${record._id}`, () => target.deleteOne({ _id: record._id }));
      cacheDirty = true;
      return record;
    },
    /** Sửa 1 bản ghi có sẵn (vd cấu hình hrm_rules) — tự khôi phục nguyên bản khi case xong */
    async set(name, filter, changes) {
      const target = await collection(name);
      const original = await target.findOne(filter || {});
      if (!original) throw new Error(`ctx.db.set: không có bản ghi trong ${name} khớp ${JSON.stringify(forDisplay(filter || {}))}`);
      await target.updateOne({ _id: original._id }, { $set: changes });
      remember(`khôi phục ${name}/${original._id}`, () => target.replaceOne({ _id: original._id }, original));
      cacheDirty = true;
      return target.findOne({ _id: original._id });
    },
    /** Xoá bản ghi có sẵn (vd thử trạng thái rỗng, tối đa 50) — tự thêm lại khi case xong */
    async remove(name, filter) {
      const target = await collection(name);
      const docs = await target.find(filter || {}).limit(51).toArray();
      if (docs.length > 50) throw new Error(`ctx.db.remove: ${name} khớp hơn 50 bản ghi — thu hẹp điều kiện`);
      if (!docs.length) return 0;
      await target.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
      remember(`thêm lại ${docs.length} bản ghi ${name}`, () => target.insertMany(docs));
      cacheDirty = true;
      return docs.length;
    },
    /**
     * Tạo thẳng 1 tài khoản thành viên công ty thử (DB chung users + companys.users + bản thành viên trong DB công ty), dựng từ
     * bản ghi của tài khoản thử chính (bỏ phiên / thiết bị). Dùng với ctx.as(tài khoản) khi ticket cần vai trò khác xác nhận
     * trên giao diện. Tự xoá khi case xong.
     * @param {{name?: string, role?: number, changes?: object}} o role: 1 Admin, 2 QLHT, 3 Nhân viên; changes: trường khác
     *   (vd { departments_id: [...], title: 3 })
     * @returns {Promise<{name, email, password, org, id, fullName}>}
     */
    async createAccount({ name = 'Nhân viên', role = 3, changes = {} } = {}) {
      const st = await open();
      const id = randomId();
      const email = `aiqc-${id.slice(-8).toLowerCase()}@aiqc.test`;
      let password = '';
      for (let i = 0; i < 14; i += 1) password += PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)];
      const now = ticks();
      const fullName = `AI-QC ${name}`;
      const companyRef = { _id: st.company._id, name: st.company.name };
      const account = applyChanges(stripSecrets(st.tester), {
        _id: id,
        email,
        phone: '',
        code: '',
        first_name: 'AI-QC',
        last_name: String(name),
        FullName: fullName,
        password: md5Upper(password),
        active: true,
        delete: false,
        is_admin: false,
        is_customer: false,
        role,
        companys: [companyRef],
        company_id: st.company._id,
        created_at: now,
        updated_at: now,
        ...changes,
      });

      const users = st.main.collection('users');
      const companys = st.main.collection('companys');
      const members = st.data.collection('users');
      await users.insertOne(account);
      remember(`xoá tài khoản ${email}`, () => users.deleteOne({ _id: id }));
      await companys.updateOne({ _id: st.company._id }, { $addToSet: { users: id } });
      remember(`gỡ ${email} khỏi công ty`, () => companys.updateOne({ _id: st.company._id }, { $pull: { users: id } }));
      await members.insertOne(account);
      remember(`xoá thành viên ${email}`, () => members.deleteOne({ _id: id }));
      cacheDirty = true;
      await refreshCache();
      return { name: `aiqc_${id.slice(-6).toLowerCase()}`, email, password, org: st.company.name, id, fullName };
    },
    /** Làm mới cache danh sách thành viên / phòng ban / ca làm… của bản test (gọi sau khi ghi dữ liệu mà giao diện đọc từ cache) */
    refreshCache,
  };

  return {
    api,
    used: () => Boolean(opening),
    /** Hoàn tác mọi thay đổi theo thứ tự ngược, làm mới cache nếu có ghi, đóng kết nối; không ném lỗi */
    async restoreAll() {
      const out = [];
      if (!opening) return out;
      for (const item of undo.splice(0).reverse()) {
        try {
          await item.fn();
          out.push({ label: `Mongo QC: ${item.label}`, ok: true });
        } catch (err) {
          out.push({ label: `Mongo QC: ${item.label}`, ok: false, error: err && err.message ? err.message : String(err) });
        }
      }
      try {
        if (state && cacheDirty) await refreshCache();
      } catch (err) {
        out.push({ label: 'Mongo QC: làm mới cache', ok: false, error: err && err.message ? err.message : String(err) });
      }
      try {
        const st = state || (await opening.catch(() => null));
        if (st) await st.client.close();
      } catch {
        // đóng kết nối lỗi không ảnh hưởng kết quả
      }
      return out;
    },
  };
}

module.exports = {
  createQcDb,
  openQc,
  randomId,
  ticks,
  md5Upper,
  assertLocalUri,
  applyChanges,
  stripSecrets,
  forDisplay,
  SECRET_KEY_RE,
};
