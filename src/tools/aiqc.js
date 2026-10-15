#!/usr/bin/env node
// ============================================================================
// aiqc.js: lệnh cho agent AI Code (AI-QC) — ghi Sheet testcase tổng theo ticket, đẩy video Catbox.
//
//   npm run aiqc -- prepare --ticket 1295 --title "Tiêu đề" [--cases-file f.json] [--max-ai 3]
//   npm run aiqc -- results --ticket 1295 --file results.json
//   npm run aiqc -- state   --ticket 1295 --state "Đang tái hiện" [--repro Có] [--rounds 1] [--pr <url>]
//   npm run aiqc -- upload  --file video.mp4 --name aiqc-1295-truoc.mp4
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
      // Nạp muộn: catbox kéo node-fetch, các lệnh Sheet không cần.
      const { uploadToCatbox } = require('../core/catbox');
      const file = need(flags, 'file');
      if (!fs.existsSync(file)) throw new UsageError(`Không thấy file video: ${file}`);
      const url = await uploadToCatbox(file, flags.name || 'aiqc.mp4');
      if (!url) throw new Error('Catbox không trả link (xem log [CATBOX] ở trên).');
      return { url };
    }
    default:
      if (command === 'setup-template') return T.setupTemplate(sheetsClient());
      throw new UsageError(`Lệnh không hợp lệ: "${command}" — prepare | results | state | upload | setup-template`);
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

module.exports = { parseFlags, UsageError };
