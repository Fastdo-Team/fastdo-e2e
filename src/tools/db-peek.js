#!/usr/bin/env node
// ============================================================================
// db-peek.js: XEM nhanh (chỉ đọc) bản ghi trong Mongo QC để viết ctx.db cho đúng cấu trúc — phiên tái hiện AI-QC được chạy.
//
//   npm run db:peek -- --list                         collection của DB công ty thử + số bản ghi
//   npm run db:peek -- hrm_form                       3 bản ghi mới nhất của collection (DB công ty thử)
//   npm run db:peek -- hrm_form is_confirm=false      lọc kiểu tên=giá trị (true/false/null/số tự đổi kiểu)
//   npm run db:peek -- hrm_form '{"user":"ABC"}'      lọc bằng JSON
//   npm run db:peek -- hrm_rules --limit=1            --limit 1–5
//   npm run db:peek -- --tester                       bản ghi tài khoản thử chính + công ty thử ở DB chung
//
// Cùng 2 chốt với ctx.db (localhost + bản ghi đánh dấu aiqc_guard.marker). Che trường mật khẩu / phiên / token, cắt chuỗi và
// mảng dài; DB chung chỉ xem được bản ghi của chính tài khoản thử và công ty thử.
// ============================================================================

const config = require('../config');
const { getProfile, profileForAccount } = require('../engine/profiles');
const { openQc, forDisplay } = require('../engine/qc_db');

class UsageError extends Error {}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw) && raw.length < 16) return Number(raw);
  return raw;
}

/** Tham số dòng lệnh → { list, tester, collection, filter, limit } */
function parseArgs(argv) {
  const out = { list: false, tester: false, collection: null, filter: {}, limit: 3 };
  for (const arg of argv) {
    if (arg === '--list') out.list = true;
    else if (arg === '--tester') out.tester = true;
    else if (arg.startsWith('--limit=')) out.limit = Math.min(5, Math.max(1, Number(arg.slice(8)) || 3));
    else if (arg.startsWith('--')) throw new UsageError(`Cờ lạ: ${arg}`);
    else if (!out.collection) {
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(arg)) throw new UsageError(`Tên collection không hợp lệ: ${arg}`);
      out.collection = arg;
    } else if (arg.trim().startsWith('{')) {
      try {
        Object.assign(out.filter, JSON.parse(arg));
      } catch (err) {
        throw new UsageError(`Bộ lọc JSON hỏng: ${err.message} — hoặc dùng dạng tên=giá trị`);
      }
    } else {
      const eq = arg.indexOf('=');
      if (eq <= 0) throw new UsageError(`Bộ lọc "${arg}" phải là tên=giá trị hoặc JSON`);
      out.filter[arg.slice(0, eq)] = parseValue(arg.slice(eq + 1));
    }
  }
  if (!out.list && !out.tester && !out.collection) throw new UsageError('Thiếu tên collection (hoặc --list / --tester)');
  return out;
}

const print = (value) => console.log(JSON.stringify(forDisplay(value), null, 2));

async function main(argv = process.argv.slice(2)) {
  let qc = null;
  try {
    const args = parseArgs(argv);
    qc = await openQc({ profile: getProfile(profileForAccount(config.ACCOUNT)) });
    console.log(`[DB] Mongo QC · DB công ty thử fastdo_${qc.company._id} («${qc.company.name}»)`);
    if (args.tester) {
      print({ tester: qc.tester, company: qc.company });
      return;
    }
    if (args.list) {
      const names = (await qc.data.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
      for (const name of names) console.log(`  ${name}  (${await qc.data.collection(name).estimatedDocumentCount()} bản ghi)`);
      return;
    }
    const docs = await qc.data
      .collection(args.collection)
      .find(args.filter)
      .sort({ _id: -1 })
      .limit(args.limit)
      .toArray();
    console.log(`[DB] ${args.collection} · lọc ${JSON.stringify(forDisplay(args.filter))} · ${docs.length} bản ghi (mới nhất trước)`);
    print(docs);
  } catch (err) {
    console.error(`[DB] ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  } finally {
    if (qc) await qc.client.close().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { parseArgs, parseValue, UsageError };
