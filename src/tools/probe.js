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
// Dùng lại y nguyên session đăng nhập trong .auth/user_state.json nên chạy mất
// ~3-4 giây, không phải gõ lại email/mật khẩu.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { initBrowser } = require('../core/browser');
const { ensureAuthenticated } = require('../core/session');
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
    wait: 15000,
    waitText: null,
  };

  for (const arg of args) {
    if (arg === '--tables') opts.tables = true;
    else if (arg === '--text') opts.text = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--keep-open') opts.keepOpen = true;
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

async function main() {
  const opts = parseArgs();
  const url = resolveUrl(opts.target);

  console.log('='.repeat(70));
  console.log('  PROBE DOM — đọc DOM bằng text, không chụp màn hình');
  console.log('='.repeat(70));
  console.log(`[PROBE] URL: ${url}`);

  let browserInstance = null;

  try {
    browserInstance = await initBrowser();
    const { browser, page } = browserInstance;

    await ensureAuthenticated(page);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
      console.error(
        `[PROBE] Không mở được ${url}: ${err.message}\n` +
          '        Kiểm tra TARGET_URL trong .env - dev tunnel có thể đã hết hạn hoặc đổi URL.'
      );
      throw err;
    }

    const settle = await waitForSettle(page, opts.wait, opts.waitText);
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
  } catch (error) {
    console.error(`\n[PROBE] Thất bại: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browserInstance) {
      if (opts.keepOpen) {
        // Đóng tab probe nhưng giữ Chrome sống: lần probe sau sẽ NỐI vào port
        // 9222 (~0.5s) thay vì khởi chạy lại (~3s). Tab vẫn phải đóng, không thì
        // tab tích luỹ dần đúng như hồi phải viết close_stale_tabs.js.
        try {
          if (!browserInstance.page.isClosed()) await browserInstance.page.close();
        } catch (e) {}
        try {
          browserInstance.browser.disconnect();
        } catch (e) {}
        console.log('[PROBE] Giữ Chrome sống cho lần probe kế tiếp (--keep-open)');
      } else {
        await browserInstance.close();
      }
    }
  }
}

main();
