#!/usr/bin/env node
// ============================================================================
// preflight.js: Kiểm tra hạ tầng + tiền điều kiện TRƯỚC khi chạy test.
//
//   node src/tools/preflight.js
//   npm run preflight
//
// Ý tưởng lấy từ mẫu "chạy check rẻ trước, fail thì bỏ qua E2E đắt": mỗi case
// mất 20-50 giây, nên phát hiện "mẫu sandbox đã bị xoá" ở giây thứ 5 tốt hơn là
// nhìn 3 case lần lượt chết sau 60 giây.
//
// Exit 0 = chạy test được. Exit 1 = có thứ chắc chắn làm test chết.
// ============================================================================

const fs = require('fs');
const { spawnSync } = require('child_process');
const fetch = require('node-fetch');
const config = require('../config');
const { humanClick } = require('../core/cursor_motion');
// Engine v2 (Playwright): mở app bằng hồ sơ tài khoản, file phiên .auth/<hồ sơ>.json.
const { createBrowserPool } = require('../engine/browser_pool');
const { openAppPage } = require('../engine/app_session');
const { getProfile, profileForAccount, storagePathOf } = require('../engine/profiles');
const { waitForSettle } = require('../core/page_ready');
const H = require('../core/evaluation_helpers');
const F = require('./lib/fixtures');
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');

const results = [];

/** hard = true nghĩa là fail thì exit 1; false chỉ là cảnh báo */
function record(ok, label, detail, hard = true) {
  results.push({ ok, label, detail, hard });
  const icon = ok ? '✓' : hard ? '✗' : '⚠';
  console.log(`${icon} ${label}${detail ? ' — ' + detail : ''}`);
}

function checkEnv() {
  const missing = config.missingRequired();
  record(
    missing.length === 0,
    'Biến môi trường',
    missing.length
      ? `thiếu: ${missing.join(', ')} (xem .env.example)`
      : `đủ ${config.REQUIRED_ENV.length} biến bắt buộc`
  );
}

function checkFfmpeg() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', shell: true });
    const line = String(r.stdout || '').split('\n')[0];
    record(
      r.status === 0,
      'ffmpeg trong PATH',
      r.status === 0 ? line.slice(0, 50) : 'không gọi được — video vẫn quay nhưng không có dải phụ đề bước (giữ webm gốc)',
      false
    );
  } catch (err) {
    record(false, 'ffmpeg trong PATH', err.message, false);
  }
}

const PROFILE_NAME = profileForAccount(config.ACCOUNT);

function checkSessionFile() {
  const file = storagePathOf({ name: PROFILE_NAME });
  const exists = fs.existsSync(file);
  let age = '';
  if (exists) {
    const hours = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
    age = `hồ sơ ${PROFILE_NAME}, lưu cách đây ${hours.toFixed(1)} giờ`;
  }
  record(
    exists,
    'File phiên đăng nhập',
    exists ? age : `chưa có .auth/${PROFILE_NAME}.json — lần chạy đầu sẽ tự đăng nhập`,
    false
  );
}

/** Chrome mở được qua Playwright (không cần tunnel) */
async function checkChrome() {
  const pool = createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    record(true, 'Chrome (Playwright)', `Chrome ${browser.version()}`);
  } catch (err) {
    record(false, 'Chrome (Playwright)', err.message);
  } finally {
    await pool.close();
  }
}

async function checkTunnel() {
  try {
    const res = await fetch(config.TARGET_URL, { timeout: 15000 });
    record(
      res.status === 200,
      'Dev tunnel TARGET_URL',
      `HTTP ${res.status} — ${config.TARGET_URL}`
    );
  } catch (err) {
    record(false, 'Dev tunnel TARGET_URL', `${err.message} — kiểm tra TARGET_URL trong .env`);
  }
}

async function checkAppAndFixtures() {
  let instance = null;
  let pool = null;

  try {
    pool = createBrowserPool({ headless: true });
    instance = await openAppPage(await pool.get(), getProfile(PROFILE_NAME));
    const { page } = instance;
    record(true, 'Đăng nhập / phiên', `vào được app bằng hồ sơ ${PROFILE_NAME}`);

    await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const settle = await waitForSettle(page, 30000, null, config.TARGET_URL);
    record(
      settle.settled,
      'App render được',
      settle.settled
        ? `ổn định sau ${settle.seconds.toFixed(1)}s, ${settle.count} element`
        : `hết hạn chờ ${settle.seconds.toFixed(1)}s, chỉ ${settle.count} element` +
            (settle.overlay ? ` (${settle.overlay})` : '') +
            ' — circuit Blazor có thể chưa kết nối, thử lại'
    );

    const wanted = F.scanFixtureNames();
    if (wanted.size === 0) {
      record(true, 'Mẫu sandbox testcase cần', 'không testcase nào khai báo tên mẫu', false);
      return;
    }

    const click = (p, el, o) => humanClick(p || page, el, o);
    await H.openEvaluationTab(page, click, 'template');
    const rows = await F.readTemplateRows(page);

    for (const r of F.matchFixtures(wanted, rows)) {
      record(r.ok, `Mẫu "${r.name}"`, r.detail);
    }

    const drafts = F.listDraftNames(rows);
    if (drafts.length) {
      console.log(`
  Mẫu Nháp đang có trên tunnel: ${drafts.join(' | ')}`);
    }
  } catch (err) {
    record(false, 'Kiểm tra app & fixture', err.message);
  } finally {
    if (instance) await instance.close();
    if (pool) await pool.close();
  }
}

async function checkSheet() {
  try {
    const sheet = await openSheet();
    for (const w of sheet.tab.warnings) record(false, 'Tab Sheet', w, false);
    const grid = await sheet.readGrid();
    record(true, 'Google Sheet (API)', `tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid}), ${grid.length} dòng`);
    const canEdit = await sheet.client.canEdit();
    if (canEdit === true) record(true, 'Quyền ghi Sheet', `service account ${sheet.client.saEmail} có quyền sửa`);
    else if (canEdit === false) record(false, 'Quyền ghi Sheet', `CHƯA có quyền sửa — Share Sheet quyền Editor cho ${sheet.client.saEmail}`);
    else record(false, 'Quyền ghi Sheet', 'không kiểm được qua Drive API', false);
  } catch (err) {
    record(false, 'Google Sheet (API)', err.message);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('  PREFLIGHT — kiểm tra trước khi đốt 20-50s mỗi testcase');
  console.log('='.repeat(70));

  checkEnv();
  await checkSheet();
  checkFfmpeg();
  await checkChrome();
  checkSessionFile();
  await checkTunnel();

  const tunnelOk = results.some((r) => r.label === 'Dev tunnel TARGET_URL' && r.ok);
  if (tunnelOk) {
    await checkAppAndFixtures();
  } else {
    record(false, 'Kiểm tra app & fixture', 'bỏ qua vì tunnel không phản hồi');
  }

  const hardFails = results.filter((r) => !r.ok && r.hard);
  const warnings = results.filter((r) => !r.ok && !r.hard);

  console.log('');
  console.log('-'.repeat(70));
  if (hardFails.length === 0) {
    console.log(`  SẴN SÀNG CHẠY TEST${warnings.length ? ` (${warnings.length} cảnh báo)` : ''}`);
  } else {
    console.log(`  CHƯA CHẠY ĐƯỢC — ${hardFails.length} hạng mục cần xử lý:`);
    hardFails.forEach((r) => console.log(`   ✗ ${r.label}: ${r.detail}`));
    process.exitCode = 1;
  }
  console.log('-'.repeat(70));
}

main();
