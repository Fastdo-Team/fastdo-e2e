const test = require('node:test');
const assert = require('node:assert');
const Q = require('./qc_db');
const { parseArgs } = require('../tools/db-peek');

// ---- Mongo giả tối thiểu (đúng các lệnh qc_db dùng) ----
const matches = (doc, filter) =>
  Object.entries(filter || {}).every(([key, value]) =>
    value && typeof value === 'object' && Array.isArray(value.$in) ? value.$in.includes(doc[key]) : doc[key] === value
  );
function fakeCollection(rows) {
  const cursor = (items) => ({ sort: () => cursor(items), limit: (n) => cursor(items.slice(0, n)), toArray: async () => items });
  return {
    rows,
    // Mongo thật trả bản sao — giả lập đúng để bắt lỗi giữ tham chiếu
    findOne: async (filter) => structuredClone(rows.find((doc) => matches(doc, filter)) || null),
    find: (filter) => cursor(structuredClone(rows.filter((doc) => matches(doc, filter)))),
    insertOne: async (doc) => rows.push(doc),
    insertMany: async (docs) => rows.push(...docs),
    deleteOne: async (filter) => {
      const i = rows.findIndex((doc) => matches(doc, filter));
      if (i >= 0) rows.splice(i, 1);
    },
    deleteMany: async (filter) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], filter)) rows.splice(i, 1);
    },
    replaceOne: async (filter, doc) => {
      const i = rows.findIndex((item) => matches(item, filter));
      rows[i] = doc;
    },
    updateOne: async (filter, update) => {
      const doc = rows.find((item) => matches(item, filter));
      if (update.$set) for (const [key, value] of Object.entries(update.$set)) doc[key] = value;
      if (update.$addToSet) for (const [key, value] of Object.entries(update.$addToSet)) if (!doc[key].includes(value)) doc[key].push(value);
      if (update.$pull) for (const [key, value] of Object.entries(update.$pull)) doc[key] = doc[key].filter((item) => item !== value);
    },
  };
}
function fakeMongo({ marker = true } = {}) {
  const dbs = {
    aiqc_guard: { marker: fakeCollection(marker ? [{ _id: 'qc' }] : []) },
    fastdo: {
      users: fakeCollection([
        { _id: 'T1', email: 'tester@x.vn', delete: false, FullName: 'Tester', session: 'S', device_token: 'D', companys: [{ _id: 'C1', name: 'Cty QC' }], role: 1 },
      ]),
      companys: fakeCollection([{ _id: 'C1', name: 'Cty QC', delete: false, users: ['T1'] }]),
    },
    fastdo_C1: { users: fakeCollection([]), hrm_form: fakeCollection([{ _id: 'F1', user: 'T1', note: 'mẫu', form: { type: 2 } }]), hrm_rules: fakeCollection([{ _id: 'C1', overtime: { is_allow_overday: false } }]) },
  };
  return {
    dbs,
    client: {
      db: (name) => ({ collection: (c) => (dbs[name][c] = dbs[name][c] || fakeCollection([])) }),
      close: async () => {},
    },
  };
}
const profile = { name: 'slot3', email: 'Tester@x.vn', org: 'Cty QC' };
const env = { AIQC_MONGO_URI: 'mongodb://127.0.0.1:27017/', AIQC_CACHE_SECRET: 'k' };

test('randomId: 12 số giờ UTC + 20 ký tự [0-9A-Z] = 32 ký tự; md5Upper giống AppHelper.CreateMD5', () => {
  const id = Q.randomId(new Date(Date.UTC(2026, 9, 15, 8, 8, 10)));
  assert.match(id, /^261015080810[0-9A-Z]{20}$/);
  assert.strictEqual(Q.md5Upper('abc'), '900150983CD24FB0D6963F7D28E17F72');
});

test('ticks: DateTime.Now.Ticks (giờ máy) dạng BigInt', () => {
  const d = new Date(0);
  assert.strictEqual(Q.ticks(d), BigInt(-d.getTimezoneOffset() * 60000) * 10000n + 621355968000000000n);
});

test('assertLocalUri: chỉ nhận Mongo trên máy này', () => {
  for (const ok of ['mongodb://127.0.0.1:27017/', 'mongodb://localhost/', 'mongodb://u:p@[::1]:27017/x']) assert.doesNotThrow(() => Q.assertLocalUri(ok));
  for (const bad of ['mongodb://mongo.fastdo.vn:27017/', 'mongodb://127.0.0.1,10.0.0.5/', 'mongodb+srv://x.mongodb.net/', '']) {
    assert.throws(() => Q.assertLocalUri(bad));
  }
});

test('applyChanges theo đường dẫn có dấu chấm, không sửa bản gốc; stripSecrets bỏ phiên / thiết bị / mật khẩu', () => {
  const original = { overtime: { is_allow_overday: false, max: 4 } };
  const out = Q.applyChanges(original, { 'overtime.is_allow_overday': true, note: 'x' });
  assert.deepStrictEqual(out, { overtime: { is_allow_overday: true, max: 4 }, note: 'x' });
  assert.strictEqual(original.overtime.is_allow_overday, false);
  assert.deepStrictEqual(Object.keys(Q.stripSecrets({ a: 1, password: 'p', session: 's', device_token: 't' })), ['a']);
});

test('chốt an toàn: thiếu AIQC_MONGO_URI / bản ghi đánh dấu → từ chối', async () => {
  const mongo = fakeMongo({ marker: false });
  await assert.rejects(Q.createQcDb({ profile, env: {} }).api.info(), /AIQC_MONGO_URI/);
  await assert.rejects(Q.createQcDb({ profile, env, connect: async () => mongo.client }).api.info(), /đánh dấu/);
});

test('clone / set / remove / createAccount → restoreAll hoàn tác hết, làm mới cache bằng khoá của bản test', async () => {
  const mongo = fakeMongo();
  const calls = [];
  const fetchFn = async (url, init) => calls.push([url, init.body || '']) && { ok: true };
  const db = Q.createQcDb({ profile, env, targetUrl: 'http://localhost:5200/', connect: async () => mongo.client, fetchFn, print: () => {} });
  const { dbs } = mongo;

  assert.deepStrictEqual(await db.api.info(), { companyId: 'C1', companyName: 'Cty QC', testerId: 'T1', testerName: 'Tester' });
  const form = await db.api.clone('hrm_form', { _id: 'F1' }, { note: 'AI-QC 1309', 'form.type': 3 });
  assert.notStrictEqual(form._id, 'F1');
  assert.deepStrictEqual([form.note, form.form.type, dbs.fastdo_C1.hrm_form.rows.length], ['AI-QC 1309', 3, 2]);
  await db.api.set('hrm_rules', { _id: 'C1' }, { overtime: { is_allow_overday: true } });
  assert.strictEqual(dbs.fastdo_C1.hrm_rules.rows[0].overtime.is_allow_overday, true);
  assert.strictEqual(await db.api.remove('hrm_form', { _id: 'F1' }), 1);

  const account = await db.api.createAccount({ name: 'Người duyệt', role: 3 });
  assert.match(account.email, /^aiqc-[0-9a-z]{8}@aiqc\.test$/);
  const stored = dbs.fastdo.users.rows.find((doc) => doc._id === account.id);
  assert.deepStrictEqual(
    [stored.password, stored.session, stored.device_token, stored.FullName, stored.role, stored.companys],
    [Q.md5Upper(account.password), undefined, undefined, 'AI-QC Người duyệt', 3, [{ _id: 'C1', name: 'Cty QC' }]]
  );
  assert.ok(dbs.fastdo.companys.rows[0].users.includes(account.id));
  assert.ok(dbs.fastdo_C1.users.rows.some((doc) => doc._id === account.id));
  assert.match(calls[0][0], /\/GlobalService\/SetUsers\?company=C1_k$/);
  assert.deepStrictEqual(JSON.parse(calls[1][1]), { Company: 'C1', Secret: 'k' });

  const restored = await db.restoreAll();
  assert.ok(restored.every((item) => item.ok), JSON.stringify(restored));
  assert.deepStrictEqual(dbs.fastdo_C1.hrm_form.rows.map((doc) => doc._id), ['F1']);
  assert.strictEqual(dbs.fastdo_C1.hrm_rules.rows[0].overtime.is_allow_overday, false);
  assert.deepStrictEqual([dbs.fastdo.users.rows.length, dbs.fastdo.companys.rows[0].users, dbs.fastdo_C1.users.rows.length], [1, ['T1'], 0]);
});

test('DB chung chỉ cho đọc users / companys', async () => {
  const mongo = fakeMongo();
  const db = Q.createQcDb({ profile, env, connect: async () => mongo.client, print: () => {} });
  await assert.rejects(db.api.find('sessions', {}, { main: true }), /chỉ cho đọc/);
  assert.strictEqual((await db.api.find('users', { _id: 'T1' }, { main: true })).length, 1);
});

test('forDisplay che bí mật, Int64 → chuỗi; db:peek đọc bộ lọc tên=giá trị / JSON', () => {
  assert.deepStrictEqual(Q.forDisplay({ password: 'x', created: 5n, list: [1, 2, 3, 4, 5, 6] }), {
    password: '***',
    created: '5n',
    list: [1, 2, 3, 4, 5, '…(+1 phần tử)'],
  });
  assert.deepStrictEqual(parseArgs(['hrm_form', 'is_confirm=false', 'value=2', '{"user":"T1"}', '--limit=9']), {
    list: false,
    tester: false,
    collection: 'hrm_form',
    filter: { is_confirm: false, value: 2, user: 'T1' },
    limit: 5,
  });
});
