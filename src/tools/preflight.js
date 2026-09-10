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
const path = require('path');
const { spawnSync } = require('child_process');
const fetch = require('node-fetch');
const config = require('../config');
const { initBrowser } = require('../core/browser');
const { ensureAuthenticated } = require('../core/session');
const { humanClick } = require('../core/cursor_motion');
const { waitForSettle } = require('../core/page_ready');
const H = require('../core/evaluation_helpers');

const results = [];

/** hard = true nghĩa là fail thì exit 1; false chỉ là cảnh báo */
function record(ok, label, detail, hard = true) {
  results.push({ ok, label, detail, hard });
  const icon = ok ? '✓' : hard ? '✗' : '⚠';
  console.log(`${icon} ${label}${detail ? ' — ' + detail : ''}`);
}

function checkEnv() {
  const required = {
    FASTDO_EMAIL: config.EMAIL,
    FASTDO_PASSWORD: config.PASSWORD,
    CATBOX_USERHASH: config.CATBOX_USERHASH,
    TARGET_URL: config.TARGET_URL,
    SHEET_ID: config.SHEET_ID,
  };
  const missing = Object.keys(required).filter((k) => !required[k]);
  record(
    missing.length === 0,
    'Biến môi trường',
    missing.length ? `thiếu: ${missing.join(', ')} (xem .env.example)` : 'đủ 5 biến bắt buộc'
  );
}

function checkFfmpeg() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', shell: true });
    const line = String(r.stdout || '').split('\n')[0];
    record(
      r.status === 0,
      'ffmpeg trong PATH',
      r.status === 0 ? line.slice(0, 50) : 'không gọi được — chạy sẽ phải dùng --no-record',
      false
    );
  } catch (err) {
    record(false, 'ffmpeg trong PATH', err.message, false);
  }
}

function checkSessionFile() {
  const exists = fs.existsSync(config.AUTH_STATE_PATH);
  let age = '';
  if (exists) {
    const hours = (Date.now() - fs.statSync(config.AUTH_STATE_PATH).mtimeMs) / 3600000;
    age = `lưu cách đây ${hours.toFixed(1)} giờ`;
  }
  record(
    exists,
    'File session',
    exists ? age : 'chưa có .auth/user_state.json — lần chạy đầu sẽ tự đăng nhập',
    false
  );
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

/**
 * Quét hằng số tên mẫu trong các testcase. Không sửa testcase để khai báo
 * `requires` — quét source là cách không xâm lấn để biết case nào phụ thuộc mẫu nào.
 */
function scanFixtureNames() {
  const dir = path.join(config.ROOT_DIR, 'src', 'testcases');
  const wanted = new Map(); // tên mẫu -> [file]

  if (!fs.existsSync(dir)) return wanted;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /(?:DRAFT_)?TEMPLATE_NAME\s*=\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!wanted.has(name)) wanted.set(name, []);
      wanted.get(name).push(file.replace('.test.js', '').toUpperCase());
    }
  }

  return wanted;
}

function readTemplateRows(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('table tbody tr'))
      .map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          name: ((tds[0] || {}).innerText || '').replace(/\s+/g, ' ').trim(),
          status: ((tds[1] || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((r) => r.name)
  );
}

async function checkAppAndFixtures() {
  let instance = null;

  try {
    instance = await initBrowser();
    const { page } = instance;

    await ensureAuthenticated(page);
    record(true, 'Đăng nhập / session', 'vào được app bằng session sẵn có');

    await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const settle = await waitForSettle(page, 30000);
    record(
      settle.settled,
      'App render được',
      settle.settled
        ? `ổn định sau ${settle.seconds.toFixed(1)}s, ${settle.count} element`
        : `hết hạn chờ ${settle.seconds.toFixed(1)}s, chỉ ${settle.count} element` +
            (settle.overlay ? ` (${settle.overlay})` : '') +
            ' — circuit Blazor có thể chưa kết nối, thử lại'
    );

    const wanted = scanFixtureNames();
    if (wanted.size === 0) {
      record(true, 'Mẫu sandbox testcase cần', 'không testcase nào khai báo tên mẫu', false);
      return;
    }

    const click = (p, el, o) => humanClick(p || page, el, o);
    await H.openEvaluationTab(page, click, 'template');
    const rows = await readTemplateRows(page);

    for (const [name, cases] of wanted) {
      const hits = rows.filter((r) => r.name === name);
      if (hits.length === 0) {
        record(
          false,
          `Mẫu "${name}"`,
          `KHÔNG còn trên tunnel này → ${cases.join(', ')} sẽ chết ở openDraftByName`
        );
      } else if (!hits.some((r) => r.status === 'Nháp')) {
        record(
          false,
          `Mẫu "${name}"`,
          `có nhưng không mẫu nào ở trạng thái Nháp (đang: ${[
            ...new Set(hits.map((r) => r.status)),
          ].join(', ')}) → ${cases.join(', ')} cần mẫu Nháp để bấm Sửa`
        );
      } else {
        record(true, `Mẫu "${name}"`, `có ${hits.length} bản, có Nháp → ${cases.join(', ')} OK`);
      }
    }

    const drafts = rows.filter((r) => r.status === 'Nháp').map((r) => r.name);
    if (drafts.length) {
      console.log(`\n  Mẫu Nháp đang có trên tunnel: ${[...new Set(drafts)].join(' | ')}`);
    }
  } catch (err) {
    record(false, 'Kiểm tra app & fixture', err.message);
  } finally {
    if (instance) await instance.close();
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('  PREFLIGHT — kiểm tra trước khi đốt 20-50s mỗi testcase');
  console.log('='.repeat(70));

  checkEnv();
  checkFfmpeg();
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
