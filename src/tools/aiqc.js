#!/usr/bin/env node
// ============================================================================
// aiqc.js: lệnh cho agent AI Code (AI-QC) — ghi Sheet testcase tổng theo ticket, đẩy video lên Google Drive.
//
//   npm run aiqc -- prepare --ticket 1295 --title "Tiêu đề" [--cases-file f.json] [--max-ai 3]
//   npm run aiqc -- results --ticket 1295 --file results.json
//   npm run aiqc -- state   --ticket 1295 --state "Đang tái hiện" [--repro Có] [--rounds 1] [--pr <url>]
//   npm run aiqc -- upload  --file video.mp4 --name aiqc-1295-truoc.mp4
//   npm run aiqc -- scripts --ticket 1295       kịch bản của ticket: { id, ready, blocker, problems } (agent chỉ chạy case ready)
//   npm run aiqc -- reset-ready --ticket 1295   bỏ «ready: true» trước phiên tái hiện — lượt nào cũng phải chạy nháp lại
//   npm run aiqc -- restore-valid --ticket 1295 --ledger <sổ chạy nháp>   case chưa sẵn sàng → dùng bản chạy nháp hợp lệ gần nhất
//   npm run aiqc -- helpers                     hàm tạo dữ liệu dùng chung (testcases/tickets/lib) cho prompt tái hiện
//   npm run aiqc -- profiles                    tài khoản thử KHÁC cùng tổ chức (tên + vai trò, không email / mật khẩu) cho ctx.as
//   npm run aiqc -- setup-template      (1 lần: thêm ô «AI soạn thêm testcase» vào _Mẫu + mục 11 tab Hướng dẫn)
//
// Dòng CUỐI luôn là `AIQC_JSON {...}` — agent chỉ đọc dòng này (thư viện khác có thể in thêm log).
// Sheet tổng đọc từ AIQC_SHEET_ID (KHÁC SHEET_ID của Sheet QC Đánh giá), key Google từ GOOGLE_SA_KEY_FILE.
// Chỉ agent gọi lệnh này; phiên Claude không có quyền chạy nó.
// ============================================================================

const fs = require('fs');
const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const T = require('../sheets/ticket_tab');
const path = require('path');
const { listTicketScripts, resetTicketReady, listHelpers, TESTCASE_DIR } = require('../engine/script_meta');
const { restoreValidSnapshots } = require('../engine/valid_snapshot');
const { listProfiles, profileForAccount } = require('../engine/profiles');

class UsageError extends Error {}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new UsageError(`Tham số lạ: "${a}"`);
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`Thiếu giá trị cho --${key}`);
    flags[key] = value;
    i += 1;
  }
  return flags;
}

const need = (flags, key) => {
  if (!flags[key]) throw new UsageError(`Thiếu --${key}`);
  return flags[key];
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function sheetsClient() {
  const spreadsheetId = (process.env.AIQC_SHEET_ID || '').trim();
  if (!spreadsheetId) throw new UsageError('Chưa đặt AIQC_SHEET_ID (id Sheet testcase tổng của AI-QC).');
  return createSheetsClient({ spreadsheetId, keyFile: config.GOOGLE_SA_KEY_FILE });
}

/** Hồ sơ tài khoản khác cùng tổ chức với hồ sơ chính (FASTDO_ACCOUNT), đủ email + mật khẩu — chỉ tên, tổ chức, vai trò. */
function otherProfiles(env = process.env, account = config.ACCOUNT) {
  const all = [...listProfiles(env).values()];
  const main = profileForAccount(account);
  const mainOrg = (all.find((p) => p.name === main) || {}).org;
  return {
    main,
    profiles: all
      .filter((p) => p.name !== main && p.email && p.password && (!mainOrg || p.org === mainOrg))
      .map((p) => ({ name: p.name, org: p.org, note: p.note || '' })),
  };
}

async function run(command, flags) {
  switch (command) {
    case 'prepare': {
      const input = flags['cases-file'] ? readJson(flags['cases-file']) : {};
      return T.prepare(sheetsClient(), {
        ticket: need(flags, 'ticket'),
        title: flags.title || '',
        aiCases: Array.isArray(input.aiCases) ? input.aiCases : [],
        maxAiCases: flags['max-ai'] ? Number(flags['max-ai']) : 3,
      });
    }
    case 'results': {
      const input = readJson(need(flags, 'file'));
      return T.writeResults(sheetsClient(), {
        ticket: need(flags, 'ticket'),
        cases: Array.isArray(input.cases) ? input.cases : [],
        summary: input.summary || {},
      });
    }
    case 'state': {
      await T.setState(sheetsClient(), {
        ticket: need(flags, 'ticket'),
        state: need(flags, 'state'),
        repro: flags.repro,
        rounds: flags.rounds !== undefined ? Number(flags.rounds) : undefined,
        prUrl: flags.pr,
      });
      return {};
    }
    case 'upload': {
      // Nạp muộn: drive kéo node-fetch, các lệnh Sheet không cần. Catbox chết server 2026-10-22 → Google Drive.
      const { uploadToDrive } = require('../core/drive');
      const file = need(flags, 'file');
      if (!fs.existsSync(file)) throw new UsageError(`Không thấy file video: ${file}`);
      const url = await uploadToDrive(file, flags.name || 'aiqc.mp4');
      if (!url) throw new Error('Google Drive không trả link (xem log [DRIVE] ở trên).');
      return { url };
    }
    case 'scripts':
      return { scripts: listTicketScripts(need(flags, 'ticket')) };
    case 'reset-ready':
      return { reset: resetTicketReady(need(flags, 'ticket')) };
    case 'helpers':
      return { helpers: listHelpers() };
    case 'restore-valid': {
      const ticket = need(flags, 'ticket');
      return {
        restored: restoreValidSnapshots(listTicketScripts(ticket), need(flags, 'ledger'), path.join(TESTCASE_DIR, 'tickets')),
      };
    }
    case 'profiles':
      return otherProfiles();
    default:
      if (command === 'setup-template') return T.setupTemplate(sheetsClient());
      throw new UsageError(
        `Lệnh không hợp lệ: "${command}" — prepare | results | state | upload | scripts | reset-ready | restore-valid | helpers | profiles | setup-template`
      );
  }
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  try {
    const out = await run(command, parseFlags(rest));
    console.log(`AIQC_JSON ${JSON.stringify({ ok: true, ...out })}`);
  } catch (err) {
    console.log(`AIQC_JSON ${JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) })}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseFlags, otherProfiles, UsageError };
