#!/usr/bin/env node
// ============================================================================
// probe.js: Khám phá DOM của 1 trang bằng TEXT, thay cho chụp màn hình.
//
//   node src/tools/probe.js "/evaluation?tab=template"
//   node src/tools/probe.js "/evaluation?tab=template" --grep="nhóm|tiêu chí" --tables
//   node src/tools/probe.js "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js
//
// Cờ: --grep=<regex> --tables --text --all --limit=<n> --setup=<file>
//     --out=<tên file> --keep-open --wait=<ms> --wait-text=<chuỗi>
//
// Dùng CHUNG phiên đăng nhập với engine v2 (Playwright, .auth/<hồ sơ>.json, cùng hồ sơ mà `npm run e2e:dry` dùng theo
// FASTDO_ACCOUNT): phiên còn hạn thì vào thẳng, hết hạn thì tự đăng nhập lại, chọn đúng tổ chức. Bản cũ dùng engine v1
// (Puppeteer, .auth/user_state.json) báo «Session còn hiệu lực» rồi trả về màn đăng nhập — 6/9 lần gọi trong phiên tái hiện
// AI-QC 14–16/10, AI phải dùng lượt chạy nháp để dò giao diện thay cho probe.
// Chrome chạy ẩn (thêm --headed để xem); --keep-open không còn tác dụng (Chrome do Playwright mở luôn đóng theo lệnh).
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createBrowserPool } = require('../engine/browser_pool');
const { getProfile, profileForAccount } = require('../engine/profiles');
const { ensureProfileSession, warmUp, VIEWPORT } = require('../engine/app_session');
const { guardPage } = require('../engine/page_guard');
const { humanClick, humanType, waitXPath, clickUntil } = require('../core/cursor_motion');
const { setFlatpickrField } = require('../core/datetime_picker');
const { digestToFile } = require('../core/dom_digest');
const { waitForSettle } = require('../core/page_ready');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    target: null,
    grep: null,
    tables: false,
    text: false,
    all: false,
    limit: 120,
    setup: null,
    out: null,
    keepOpen: false,
    headed: false,
    wait: 15000,
    waitText: null,
  };

  for (const arg of args) {
    if (arg === '--tables') opts.tables = true;
    else if (arg === '--text') opts.text = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--keep-open') opts.keepOpen = true;
    else if (arg === '--headed') opts.headed = true;
    else if (arg.startsWith('--grep=')) opts.grep = arg.slice('--grep='.length);
    else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.split('=')[1], 10) || 120;
    else if (arg.startsWith('--wait=')) opts.wait = parseInt(arg.split('=')[1], 10) || 15000;
    else if (arg.startsWith('--wait-text=')) opts.waitText = arg.slice('--wait-text='.length);
    else if (arg.startsWith('--setup=')) opts.setup = arg.slice('--setup='.length);
    else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
    else if (!arg.startsWith('--') && !opts.target) opts.target = arg;
  }

  return opts;
}

function resolveUrl(target) {
  if (!target) return config.TARGET_URL;
  if (/^https?:\/\//i.test(target)) return target;
  return new URL(target, config.TARGET_URL).toString();
}

function slugify(target, setupFile) {
  const base = (target || 'home')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'home';
  const suffix = setupFile ? '_' + path.basename(setupFile, '.js') : '';
  return `probe_${base}${suffix}.txt`;
}

/**
 * Mọi bước trong probe (goto/waitForSettle/digest) đều tự khai có hạn chờ riêng,
 * nhưng nếu một bước nào đó trong tương lai không tự bảo vệ được (hoặc CDP tự
 * treo ở tầng dưới — đã gặp thật: page.evaluate() không tự bung dù
 * protocolTimeout đặt 90s), lệnh vẫn phải TỰ CHẾT thay vì treo mãi. Không có
 * watchdog thì người dùng chỉ có cách tự vào Task Manager tìm và giết tiến
 * trình — đúng thứ đã xảy ra thật, khiến QC nhìn thấy Chrome trắng trơn không rõ
 * lý do và nút "Dừng" trên giao diện không có gì để hiểu là phải dừng cái gì.
 */
function withWatchdog(promise, timeoutMs) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      console.error('');
      console.error(`[PROBE] ✗ TỰ HUỶ sau ${(timeoutMs / 1000).toFixed(0)}s — probe treo, không rõ ở bước nào.`);
      console.error('        Nguyên nhân thường gặp: session .auth/user_state.json đã cũ (kiểm tra tuổi file),');
      console.error('        hoặc trang app đang trong trạng thái dở dang chưa từng gặp.');
      console.error('        Dọn Chrome còn sót lại (nếu có):  npm run chrome:kill');
      reject(new Error(`probe treo quá ${(timeoutMs / 1000).toFixed(0)}s`));
    }, timeoutMs);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function main() {
  const opts = parseArgs();
  const url = resolveUrl(opts.target);

  console.log('='.repeat(70));
  console.log('  PROBE DOM — đọc DOM bằng text, không chụp màn hình');
  console.log('='.repeat(70));
  console.log(`[PROBE] URL: ${url}`);

  if (opts.keepOpen) console.log('[PROBE] Bỏ qua --keep-open: probe dùng Chrome của Playwright, luôn đóng khi xong');

  const pool = createBrowserPool({ headless: !opts.headed });
  let context = null;

  /** Context đã có phiên đăng nhập của hồ sơ, vào thẳng trang cần dò (đúng tổ chức). Phiên hết hạn → đăng nhập lại 1 lần. */
  async function openTarget(browser, profile) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const storageState = await ensureProfileSession(browser, profile, { force: attempt > 1 });
      context = await browser.newContext({ viewport: VIEWPORT, storageState });
      const page = guardPage(await context.newPage());
      page.__fastdoOrg = profile.org;
      try {
        await warmUp(page, profile, url);
        return page;
      } catch (err) {
        await context.close().catch(() => {});
        context = null;
        if (err.code !== 'SESSION_EXPIRED' || attempt > 1) {
          console.error(
            `[PROBE] Không vào được ${url}: ${err.message}\n` +
              '        Kiểm tra TARGET_URL trong .env (bản test đã bật chưa / dev tunnel còn hạn) và tài khoản của hồ sơ.'
          );
          throw err;
        }
        console.log(`[PROBE] Phiên của hồ sơ ${profile.name} hết hạn — đăng nhập lại`);
      }
    }
    throw new Error('không vào được trang');
  }

  async function run() {
    const browser = await pool.get();
    const profile = getProfile(config.ACCOUNT > 1 ? profileForAccount(config.ACCOUNT) : 'default');
    const page = await openTarget(browser, profile);
    console.log(`[PROBE] Hồ sơ ${profile.name} · đang ở ${page.url()}`);

    const settle = await waitForSettle(page, opts.wait, opts.waitText, url);
    console.log(
      `[PROBE] DOM ${settle.settled ? 'đã ổn định' : 'CHƯA ổn định (hết hạn chờ)'} ` +
        `sau ${settle.seconds.toFixed(1)}s — ${settle.count} element tương tác` +
        (settle.overlay ? ` — CÒN LỚP PHỦ CHẶN: ${settle.overlay}` : '')
    );

    // Chạm trạng thái sâu (sau vài cú click) nếu có --setup
    if (opts.setup) {
      const setupPath = path.isAbsolute(opts.setup)
        ? opts.setup
        : path.join(config.ROOT_DIR, opts.setup);

      if (!fs.existsSync(setupPath)) {
        console.error(`[PROBE] Không tìm thấy file setup: ${setupPath}`);
      } else {
        const ctx = {
          page,
          browser,
          click: (p, el, o) => humanClick(p || page, el, o),
          type: (p, el, txt, o) => humanType(p || page, el, txt, o),
          waitXPath: (p, xp, to) => waitXPath(p || page, xp, to),
          clickUntil: (p, getEl, chk, o) => clickUntil(p || page, getEl, chk, o),
          setFlatpickr: (p, ph, d, h, m) => setFlatpickrField(p || page, ph, d, h, m),
        };

        try {
          const mod = require(setupPath);
          if (typeof mod.setup !== 'function') {
            throw new Error('file setup phải export { async setup(ctx) }');
          }
          console.log(`[PROBE] Chạy setup: ${mod.description || path.basename(setupPath)}`);
          await mod.setup(ctx);
          console.log('[PROBE] Setup xong, đang ở trạng thái cần khám phá');
        } catch (err) {
          // Vẫn dump DOM: trạng thái lúc setup chết thường CHÍNH LÀ thứ cần xem
          console.error(`[PROBE] Setup thất bại: ${err.message}`);
          console.error('[PROBE] Vẫn dump DOM tại trạng thái hiện tại để chẩn đoán.');
        }
      }
    }

    const filename = opts.out || slugify(opts.target, opts.setup);
    const { filePath, text } = await digestToFile(page, filename, {
      grep: opts.grep,
      tables: opts.tables,
      text: opts.text,
      all: opts.all,
      limit: opts.limit,
      label: opts.setup ? `setup=${path.basename(opts.setup)}` : null,
    });

    // In 15 dòng đầu để không nuốt cả file vào context; muốn xem tiếp thì grep
    const preview = text.split('\n').slice(0, 15);
    console.log('');
    console.log(preview.join('\n'));
    const totalLines = text.split('\n').length;
    if (totalLines > 15) console.log(`… (còn ${totalLines - 15} dòng)`);
    console.log('');
    console.log('-'.repeat(70));
    console.log(`[PROBE] Digest đầy đủ: ${path.relative(config.ROOT_DIR, filePath)}`);
    console.log('-'.repeat(70));
  }

  let timedOut = false;

  try {
    await withWatchdog(run(), 90000);
  } catch (error) {
    console.error(`\n[PROBE] Thất bại: ${error.message}`);
    process.exitCode = 1;
    timedOut = /probe treo quá/.test(error.message);
  } finally {
    // Watchdog bắn thì kênh tới Chrome chính là nghi phạm — bước dọn có thể treo tiếp: cho tối đa 5 giây rồi thoát hẳn
    // (JS không huỷ được 1 await đang chờ — đừng để tiến trình giữ terminal mãi vì một promise mồ côi).
    const cleanup = (async () => {
      if (context) await context.close().catch(() => {});
      await pool.close();
    })();
    if (timedOut) {
      await Promise.race([cleanup, new Promise((r) => setTimeout(r, 5000))]);
      process.exit(process.exitCode);
    }
    await cleanup;
  }
}

main();
