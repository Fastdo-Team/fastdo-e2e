# Kỳ 2 — Engine Playwright (1 luồng): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay Puppeteer bằng Playwright (`playwright-core@1.62.1`, Chrome đã cài): mỗi case một BrowserContext mới (phiên theo hồ sơ tài khoản, video webm, trace), hợp đồng ctx v2 (`step`/`mark`/`check`), video mp4 có dải phụ đề bước, trace giữ khi lỗi, huỷ case bằng đóng context — port toàn bộ helper, 8 kịch bản và các tool mở trình duyệt; chạy tuần tự 1 luồng (song song là kỳ 3).

**Architecture:** `src/engine/` chứa các khối nhỏ, mỗi file một việc: `browser_pool` (1 Chrome), `profiles` (hồ sơ từ .env), `login` + `app_session` (đăng nhập 1 lần/hồ sơ, mở trang app), `page_guard` (chặn cú pháp Puppeteer), `steps` + `ctx` (hợp đồng kịch bản), `case_runner` (vòng đời 1 case), `video_post` (webm → mp4 + phụ đề), `script_meta` (khai báo + mã băm), `result_v2`, `sheet_step` (chính sách ghi Sheet của kỳ 1), `index.runBatch`. `src/runner.js` thành CLI mỏng. Helper trong `src/core/` port tại chỗ, file Puppeteer cũ giữ nguyên.

**Tech Stack:** Node 22 CommonJS, `playwright-core@1.62.1` (channel `chrome`, ffmpeg-1011 có sẵn trong `%LOCALAPPDATA%\ms-playwright`), ffmpeg hệ thống (libx264 + libass), `node --test`.

Spec: `docs/superpowers/specs/2026-09-25-engine-v2-chay-song-song-design.md` mục 3, 4, 8, 10, 11, 14 (kỳ 2).

---

## Ràng buộc bắt buộc

- Không `git commit`, không nhánh, không worktree. Trước khi sửa: chụp `src/` vào `runs/.backup/src-truoc-ky2/` (runs/ đã gitignore) — cây làm việc đang có thay đổi chưa commit của user.
- Không xoá file cũ: `core/browser.js`, `core/session.js`, `core/recorder.js`, `core/sheet_service.js` giữ nguyên, thêm 1 dòng ghi chú đầu file.
- Không ghi Google Sheet, không upload Catbox trong lúc kiểm (dùng `--nhap`, `--no-upload`).
- **Logic kiểm và tiêu chí đạt của 8 kịch bản giữ nguyên từng chữ** — chỉ đổi cú pháp API, thêm khai báo, thêm `mark()`/nhãn bước.
- Dev tunnel đang tắt (2026-09-29): kiểm engine bằng trang HTML cục bộ; chạy nháp với app thật khi tunnel bật.

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `src/engine/page_guard.js` (+test) | bọc page: chặn `evaluate` nhiều tham số, `waitForFunction` thứ tự Puppeteer, `xpath/` |
| `src/engine/profiles.js` (+test) | hồ sơ tài khoản từ .env; file phiên `.auth/<hồ sơ>.json` |
| `src/engine/browser_pool.js` | 1 Chrome qua Playwright, dựng lại khi chết |
| `src/engine/login.js` | port `session.js`: đăng nhập, cảnh báo tunnel, chọn tổ chức — theo hồ sơ |
| `src/engine/app_session.js` | đăng nhập 1 lần/hồ sơ/lượt; `warmUp`; `openAppPage` cho tool |
| `src/engine/steps.js` (+test) | nhật ký bước: `mark`, `step`, `check`, mốc ms |
| `src/engine/ctx.js` | hợp đồng ctx v2 (giữ chữ ký cũ) |
| `src/engine/video_post.js` (+test) | phụ đề ASS/VTT, ffmpeg webm → mp4, giới hạn 2 việc |
| `src/engine/script_meta.js` (+test) | nạp kịch bản, khai báo, `resources` suy từ hằng số, mã băm |
| `src/engine/result_v2.js` (+test) | `result.json` v2 (giữ trường v1), tên thư mục run |
| `src/engine/case_runner.js` | vòng đời 1 case: context, khởi động, watchdog, huỷ, hợp đồng, báo cáo lỗi, trace, video |
| `src/engine/sheet_step.js` | chính sách ghi Sheet kỳ 1 (always/pass/never) tách khỏi runner |
| `src/engine/index.js` | `runBatch` (tuần tự), `relogin` |
| `src/engine/integration/engine.itest.js` | Playwright thật + trang HTML cục bộ: video, phụ đề, trace, watchdog, huỷ, 3 case đồng thời |
| `src/core/{cursor_motion,page_ready,datetime_picker,evaluation_helpers,diagnostics}.js` | port Playwright |
| `src/testcases/*.test.js` (8 file) | khai báo + `mark()` + sửa cú pháp |
| `src/runner.js` | CLI mỏng gọi `runBatch` |
| `src/tools/{plan,preflight,probe}.js`, `setups/cycle-view.js`, skill `smoke_test.js` | chuyển sang Playwright |

---

### Task 0: Chụp lại src/ + cài Playwright

- [ ] **Step 1:**

```bash
mkdir -p runs/.backup && cp -r src runs/.backup/src-truoc-ky2 && cp package.json runs/.backup/package-truoc-ky2.json
npm install playwright-core@1.62.1 --save-exact
```

- [ ] **Step 2: Thêm script** vào `package.json`: `"test:engine": "node --test src/engine/integration/"`

- [ ] **Step 3: Kiểm Playwright mở được Chrome đã cài**

Run: `node -e "require('playwright-core').chromium.launch({channel:'chrome',headless:true}).then(async b=>{console.log('Chrome', b.version()); await b.close()})"`
Expected: `Chrome 154.x…`

---

### Task 1: `page_guard` — chặn cú pháp Puppeteer

**Files:** Create `src/engine/page_guard.js`, `src/engine/page_guard.test.js`

- [ ] **Step 1: Test**

```js
const test = require('node:test');
const assert = require('node:assert');
const { guardPage } = require('./page_guard');

function fakePage() {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push([name, args.length]); return name; };
  return { calls, evaluate: rec('evaluate'), evaluateHandle: rec('evaluateHandle'), waitForFunction: rec('waitForFunction'),
    $: rec('$'), $$: rec('$$'), waitForSelector: rec('waitForSelector'), $eval: rec('$eval'), $$eval: rec('$$eval') };
}

test('evaluate / evaluateHandle nhiều tham số → lỗi HỢP ĐỒNG KỊCH BẢN (Playwright âm thầm bỏ tham số thứ 2)', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.evaluate((a, b) => a + b, 1, 2), /HỢP ĐỒNG KỊCH BẢN.*chỉ nhận 1 tham số/);
  assert.throws(() => p.evaluateHandle((a, b) => a, 1, 2), /HỢP ĐỒNG KỊCH BẢN/);
});

test('evaluate 0 hoặc 1 tham số đi thẳng qua', async () => {
  const p = guardPage(fakePage());
  assert.strictEqual(await p.evaluate(() => 1), 'evaluate');
  assert.strictEqual(await p.evaluate(([a, b]) => a + b, [1, 2]), 'evaluate');
});

test('waitForFunction kiểu Puppeteer (fn, {timeout}, arg) hoặc (fn, {timeout}) → lỗi', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.waitForFunction(() => true, { timeout: 5, polling: 200 }, 'x'), /thứ tự Puppeteer/);
  assert.throws(() => p.waitForFunction(() => true, { timeout: 5, polling: 200 }), /thứ tự Puppeteer/);
});

test('waitForFunction kiểu Playwright (fn, arg, {timeout}) đi thẳng qua', async () => {
  const p = guardPage(fakePage());
  assert.strictEqual(await p.waitForFunction((n) => n, 3, { timeout: 5 }), 'waitForFunction');
  assert.strictEqual(await p.waitForFunction(() => true, null, { timeout: 5 }), 'waitForFunction');
});

test('selector "xpath/…" (Puppeteer) → lỗi chỉ đúng cú pháp "xpath=…"', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.$('xpath/.//a'), /xpath=/);
  assert.throws(() => p.$$('xpath/.//a'), /xpath=/);
  assert.throws(() => p.waitForSelector('xpath/.//a'), /xpath=/);
  assert.throws(() => p.$eval('xpath/.//a', (e) => e), /xpath=/);
});

test('bọc 2 lần không bọc chồng', () => {
  const inner = fakePage();
  const p = guardPage(guardPage(inner));
  assert.strictEqual(p, inner);
});
```

- [ ] **Step 2:** Run `node --test src/engine/page_guard.test.js` → FAIL (thiếu module).

- [ ] **Step 3: Implement** `src/engine/page_guard.js`

```js
// ============================================================================
// page_guard.js: chặn thói quen Puppeteer trên page Playwright — lỗi ồn thay vì sai im lặng.
//
// Playwright ÂM THẦM BỎ tham số thứ 2 trở đi của page.evaluate(fn, a, b): hàm trong trang
// nhận b = undefined và kịch bản chạy tiếp với dữ liệu sai. waitForFunction đảo thứ tự
// (Puppeteer: fn, {timeout}, arg — Playwright: fn, arg, {timeout}); XPath là 'xpath=' chứ
// không phải 'xpath/'. Bọc các hàm đó để lần chạy nháp đầu tiên đã báo lỗi rõ ràng.
// ============================================================================

function contractError(msg) {
  const e = new Error(`[HỢP ĐỒNG KỊCH BẢN] ${msg}`);
  e.code = 'SCRIPT_CONTRACT';
  return e;
}

function checkSelector(method, selector) {
  if (typeof selector === 'string' && selector.startsWith('xpath/')) {
    throw contractError(`page.${method}("xpath/…") là cú pháp Puppeteer — Playwright dùng "xpath=…".`);
  }
}

const looksLikeOptions = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && ('polling' in v || 'timeout' in v);

function guardPage(page) {
  if (!page || page.__fastdoGuarded) return page;
  page.__fastdoGuarded = true;

  for (const m of ['evaluate', 'evaluateHandle']) {
    const orig = page[m].bind(page);
    page[m] = (fn, ...args) => {
      if (args.length > 1) {
        throw contractError(`page.${m} của Playwright chỉ nhận 1 tham số — gộp lại: page.${m}(([a, b]) => …, [a, b]).`);
      }
      return orig(fn, ...args);
    };
  }

  const wff = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, ...rest) => {
    if (rest.length >= 1 && looksLikeOptions(rest[0])) {
      throw contractError('page.waitForFunction(fn, {timeout}, arg) là thứ tự Puppeteer — Playwright là (fn, arg, {timeout}).');
    }
    return wff(fn, ...rest);
  };

  for (const m of ['$', '$$', 'waitForSelector']) {
    const orig = page[m].bind(page);
    page[m] = (selector, ...rest) => {
      checkSelector(m, selector);
      return orig(selector, ...rest);
    };
  }
  for (const m of ['$eval', '$$eval']) {
    const orig = page[m].bind(page);
    page[m] = (selector, fn, ...args) => {
      checkSelector(m, selector);
      if (args.length > 1) throw contractError(`page.${m} của Playwright chỉ nhận 1 tham số cho hàm.`);
      return orig(selector, fn, ...args);
    };
  }
  return page;
}

module.exports = { guardPage, contractError };
```

- [ ] **Step 4:** Run lại → PASS.

---

### Task 2: `profiles` — hồ sơ tài khoản

**Files:** Create `src/engine/profiles.js`, `src/engine/profiles.test.js`

- [ ] **Step 1: Test**

```js
const test = require('node:test');
const assert = require('node:assert');
const P = require('./profiles');

const ENV = {
  FASTDO_EMAIL: 'a@x', FASTDO_PASSWORD: 'pa', ORG_NAME: 'Org A',
  FASTDO_EMAIL_2: 'b@x', FASTDO_PASSWORD_2: 'pb',
  PROFILE_NHANVIEN_EMAIL: 'nv@x', PROFILE_NHANVIEN_PASSWORD: 'pn', PROFILE_NHANVIEN_ORG: 'WATER QUALITY - TEAM 1ST',
  PROFILE_QUAN_LY_EMAIL: 'ql@x', PROFILE_QUAN_LY_PASSWORD: 'pq',
};

test('đọc đủ hồ sơ default, slot2 (tương thích --account=2) và hồ sơ có tên', () => {
  const all = P.listProfiles(ENV);
  assert.deepStrictEqual([...all.keys()].sort(), ['default', 'nhanvien', 'quan_ly', 'slot2']);
  assert.strictEqual(all.get('slot2').org, 'Org A');
  assert.strictEqual(all.get('nhanvien').org, 'WATER QUALITY - TEAM 1ST');
  assert.strictEqual(all.get('quan_ly').org, 'Org A');
});

test('getProfile báo đúng biến cần khai khi thiếu hồ sơ / thiếu mật khẩu', () => {
  assert.throws(() => P.getProfile('ketoan', ENV), /PROFILE_KETOAN_EMAIL/);
  assert.throws(() => P.getProfile('slot3', ENV), /FASTDO_EMAIL_3/);
  assert.throws(() => P.getProfile('default', { FASTDO_EMAIL: 'a@x' }), /thiếu mật khẩu/);
  assert.strictEqual(P.getProfile('nhanvien', ENV).email, 'nv@x');
});

test('--account=N → tên hồ sơ', () => {
  assert.strictEqual(P.profileForAccount(1), 'default');
  assert.strictEqual(P.profileForAccount('2'), 'slot2');
});

test('publicProfile không bao giờ có mật khẩu', () => {
  const pub = P.publicProfile(P.getProfile('default', ENV));
  assert.strictEqual(pub.password, undefined);
  assert.strictEqual(pub.hasPassword, true);
  assert.ok(!JSON.stringify(pub).includes('pa'));
});

test('file phiên theo tên hồ sơ, không đụng file Puppeteer cũ', () => {
  assert.match(P.storagePathOf({ name: 'nhanvien' }), /[\\/]\.auth[\\/]nhanvien\.json$/);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `src/engine/profiles.js`

```js
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
      name: 'default', email: val('FASTDO_EMAIL'), password: env.FASTDO_PASSWORD || '', org: baseOrg, source: 'FASTDO_EMAIL',
    });
  }
  for (const key of Object.keys(env).sort()) {
    const slot = /^FASTDO_EMAIL_(\d+)$/.exec(key);
    if (!slot) continue;
    const n = slot[1];
    out.set(`slot${n}`, {
      name: `slot${n}`, email: val(key), password: env[`FASTDO_PASSWORD_${n}`] || '',
      org: val(`ORG_NAME_${n}`) || baseOrg, source: key,
    });
  }
  for (const key of Object.keys(env).sort()) {
    const named = /^PROFILE_([A-Za-z0-9_]+)_EMAIL$/.exec(key);
    if (!named) continue;
    const raw = named[1];
    const name = raw.toLowerCase();
    if (!NAME_RE.test(name)) continue;
    out.set(name, {
      name, email: val(key), password: env[`PROFILE_${raw}_PASSWORD`] || '',
      org: val(`PROFILE_${raw}_ORG`) || baseOrg, source: key,
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
```

- [ ] **Step 4:** Run → PASS.

---

### Task 3: Port helper sang Playwright

**Files:** Modify `src/core/cursor_motion.js`, `page_ready.js`, `datetime_picker.js`, `evaluation_helpers.js`; ghi chú đầu `browser.js`, `session.js`, `recorder.js`, `sheet_service.js`

- [ ] **Step 1: `cursor_motion.js`** — thay hàm `smoothMove` và `waitXPath`, và dòng `waitForSelector` trong `humanClick`:

```js
/**
 * Di chuyển con trỏ mượt mà tới toạ độ đích (8-10 steps, ~80-100ms).
 * Vị trí chuột lưu THEO TỪNG PAGE: chạy song song nhiều page thì mỗi page có con trỏ
 * riêng, không nhảy theo vị trí của page khác.
 */
async function smoothMove(page, targetX, targetY, steps = 8) {
  const { x: sx, y: sy } = page.__fastdoMouse || { x: 100, y: 100 };
  for (let i = 1; i <= steps; i++) {
    const ix = sx + (targetX - sx) * (i / steps);
    const iy = sy + (targetY - sy) * (i / steps);
    await page.mouse.move(ix, iy);
    await new Promise((r) => setTimeout(r, 10));
  }
  page.__fastdoMouse = { x: targetX, y: targetY };
}
```

trong `humanClick`: `await page.waitForSelector(elementOrSelector, { timeout: opts.timeout || 10000 });` →

```js
      // 'attached' = đúng nghĩa waitForSelector của Puppeteer cũ (Playwright mặc định chờ 'visible')
      await page.waitForSelector(elementOrSelector, { timeout: opts.timeout || 10000, state: 'attached' });
```

và thay `waitXPath`:

```js
/**
 * Chờ phần tử XPath xuất hiện với polling tối ưu. Nhận XPath trần (".//a[…]") hoặc có
 * tiền tố "xpath=" / "xpath/" (cú pháp cũ) — luôn gọi Playwright bằng "xpath=".
 */
async function waitXPath(page, xpath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const cleanXpath = String(xpath).replace(/^xpath[=/]/, '');

  while (Date.now() < deadline) {
    const [el] = await page.$$('xpath=' + cleanXpath);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
```

bỏ dòng `let lastMouse = { x: 100, y: 100 };`.

- [ ] **Step 2: `page_ready.js`** — trong `dismissOrgPickerIfPresent` thay 2 dòng đầu thân hàm:

```js
  // Tổ chức theo HỒ SƠ đang chạy (engine gắn page.__fastdoOrg); page cũ thì dùng ORG_NAME.
  const org = page.__fastdoOrg || config.ORG_NAME;
  const orgXPath = `.//a[contains(., "${org}")]`;
  try {
    const orgLink = await page.$('xpath=' + orgXPath);
```

và dòng log `config.ORG_NAME` → `org`.

- [ ] **Step 3: `datetime_picker.js`** — `page.$(\`xpath/.//input[@placeholder="${placeholder}"]\`)` → `page.$(\`xpath=.//input[@placeholder="${placeholder}"]\`)`.

- [ ] **Step 4: `evaluation_helpers.js`** — trong `waitFor`: `await page.waitForFunction(fn, { timeout, polling: 200 }, arg);` → `await page.waitForFunction(fn, arg, { timeout, polling: 200 });`. Trong `setCriterionWeight`: `(i, j) => {` → `([i, j]) => {` và `groupIndex,\n    rowIndex` → `[groupIndex, rowIndex]`.

- [ ] **Step 5: Ghi chú đầu 4 file cũ** (`browser.js`, `session.js`, `recorder.js`, `sheet_service.js`), dòng 1:

```js
// [ENGINE V1 — PUPPETEER] Từ 2026-09-29 engine v2 (src/engine/, Playwright + Sheets API) không còn gọi file này. Giữ nguyên, không xoá (theo lệ repo).
```

- [ ] **Step 6:** Run `node --check` cả 8 file + `npm run test:unit` → PASS (test cũ không phụ thuộc Puppeteer).

---

### Task 4: `login` + `app_session` + `browser_pool`

**Files:** Create `src/engine/browser_pool.js`, `src/engine/login.js`, `src/engine/app_session.js`

- [ ] **Step 1: `browser_pool.js`**

```js
// ============================================================================
// browser_pool.js: một tiến trình Chrome (qua Playwright) dùng chung cho cả lượt chạy.
//
// channel "chrome" = Google Chrome đã cài trên máy, không tải trình duyệt riêng. Playwright
// tự bật --disable-background-timer-throttling, --disable-backgrounding-occluded-windows,
// --disable-renderer-backgrounding: cửa sổ chồng nhau vẫn chạy và quay đủ khung hình.
// Cờ --fastdo-eval-runner=<gốc repo> Chrome bỏ qua — chỉ để `npm run chrome:kill` nhận ra
// Chrome do repo này mở (lọc theo dòng lệnh).
// ============================================================================

const config = require('../config');

function defaultLaunch(options) {
  // Nạp muộn: test đơn vị không cần playwright-core.
  const { chromium } = require('playwright-core');
  return chromium.launch(options);
}

function createBrowserPool({ headless = false, launch = defaultLaunch, extraArgs = [] } = {}) {
  let current = null;

  async function start() {
    try {
      return await launch({
        channel: 'chrome',
        headless,
        args: [`--fastdo-eval-runner=${config.ROOT_DIR}`, '--window-size=1320,900', ...extraArgs],
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/distribution 'chrome' is not found|Executable doesn't exist/i.test(msg)) {
        throw new Error('Không tìm thấy Google Chrome trên máy. Cài Chrome (bản thường) rồi chạy lại.');
      }
      throw err;
    }
  }

  /** Chrome đang sống; chết (crash / bị đóng) thì dựng lại */
  async function get() {
    if (current) {
      const b = await current.catch(() => null);
      if (b && b.isConnected()) return b;
    }
    current = start();
    return current;
  }

  async function close() {
    const p = current;
    current = null;
    const b = p ? await p.catch(() => null) : null;
    if (b) await b.close().catch(() => {});
  }

  return { get, close };
}

module.exports = { createBrowserPool };
```

- [ ] **Step 2: `login.js`**

```js
// ============================================================================
// login.js: đăng nhập Fastdo + cảnh báo dev tunnel + chọn tổ chức trên page Playwright.
// Port từ core/session.js (Puppeteer, file cũ giữ nguyên): cùng các bước, nhận HỒ SƠ tài
// khoản làm tham số thay vì biến toàn cục của slot. Mật khẩu chỉ đi vào ô nhập, không log.
// ============================================================================

const config = require('../config');
const { humanClick, humanType, waitXPath } = require('../core/cursor_motion');
const { dismissOrgPickerIfPresent } = require('../core/page_ready');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN_LINK_XP = './/a[contains(., "Đăng nhập") or contains(., "Log in")]';
const orgXPath = (org) => `.//a[contains(., "${org}")]`;

/** Trang cảnh báo dev tunnel do server render sẵn — có thì bấm Continue */
async function passTunnelWarning(page) {
  try {
    const btn = await page.$('#continue');
    if (!btn) return false;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      btn.click(),
    ]);
    await sleep(2000);
    return true;
  } catch {
    return false;
  }
}

async function waitAppRendered(page, timeout = 20000) {
  await page
    .waitForFunction(
      () => document.body && !document.body.innerText.includes('Loading data') && document.body.innerText.trim().length > 20,
      null,
      { timeout }
    )
    .catch(() => {});
}

async function detectState(page, org) {
  for (let i = 0; i < 30; i += 1) {
    try {
      if (await page.$('xpath=' + orgXPath(org))) return 'org-selection';
      if (await page.$('input[type="email"], input[placeholder*="email" i]')) return 'login-form';
      if (await page.$('xpath=' + LOGIN_LINK_XP)) return 'landing';
    } catch {
      /* đang chuyển trang */
    }
    await sleep(800);
  }
  return null;
}

async function performFullLogin(page, profile) {
  await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await passTunnelWarning(page);
  await waitAppRendered(page);
  await sleep(1500);

  let state = await detectState(page, profile.org);
  console.log(`[AUTH] ${profile.name}: trang đăng nhập đang ở trạng thái ${state || 'chưa rõ'}`);
  if (!state) throw new Error(`Không nhận ra trang đăng nhập tại ${config.TARGET_URL} — tunnel đổi URL?`);

  if (state === 'landing') {
    const link = await waitXPath(page, LOGIN_LINK_XP, 8000);
    if (link) {
      await humanClick(page, link);
      await sleep(1500);
      state = 'login-form';
    }
  }
  if (state === 'login-form') {
    const emailSel = 'input[type="email"], input[placeholder*="email" i], input[placeholder*="số điện thoại" i]';
    const passSel = 'input[type="password"], input[placeholder*="mật khẩu" i], input[placeholder*="password" i]';
    await page.waitForSelector(emailSel, { timeout: 15000 });
    await humanType(page, await page.$(emailSel), profile.email);
    await humanType(page, await page.$(passSel), profile.password);
    let submit = await page.$('button[type="submit"]');
    if (!submit) submit = await page.$('xpath=.//button[contains(., "Đăng nhập") or contains(., "Log in")]');
    if (!submit) throw new Error('Không tìm thấy nút gửi form Đăng nhập');
    await humanClick(page, submit);
    await page.waitForSelector('xpath=' + orgXPath(profile.org), { timeout: 25000 });
    state = 'org-selection';
  }
  if (state === 'org-selection') {
    const link = await waitXPath(page, orgXPath(profile.org), 10000);
    if (!link) throw new Error(`Không thấy tổ chức "${profile.org}" sau khi đăng nhập — kiểm ORG của hồ sơ ${profile.name}`);
    await humanClick(page, link);
    await sleep(3000);
  }
}

/** Còn đăng nhập không (đang ở form đăng nhập / trang landing = không) */
async function isLoggedIn(page) {
  await waitAppRendered(page);
  await sleep(1500);
  if (page.url().includes('login')) return false;
  const form = await page.$('input[type="password"]').catch(() => null);
  const landing = await page.$('xpath=' + LOGIN_LINK_XP).catch(() => null);
  return !form && !landing;
}

/** Bảo đảm không còn đứng ở màn chọn tổ chức (lựa chọn tổ chức là theo TỪNG TAB phía server) */
async function ensureOrgSelected(page, org) {
  for (let i = 0; i < 6; i += 1) {
    const still = await page.$('xpath=' + orgXPath(org)).catch(() => null);
    if (!still) return;
    const dismissed = await dismissOrgPickerIfPresent(page);
    if (!dismissed) return;
    await sleep(600);
  }
}

module.exports = { passTunnelWarning, waitAppRendered, detectState, performFullLogin, isLoggedIn, ensureOrgSelected };
```

- [ ] **Step 3: `app_session.js`**

```js
// ============================================================================
// app_session.js: phiên đăng nhập theo hồ sơ + mở trang app.
//
// Mỗi hồ sơ đăng nhập 1 lần / lượt chạy: nạp file phiên → vào app kiểm còn đăng nhập →
// không thì đăng nhập đầy đủ → lưu phiên. Hai luồng cùng hồ sơ dùng chung MỘT Promise nên
// không bao giờ cùng đăng nhập một lúc.
// ============================================================================

const fs = require('fs');
const config = require('../config');
const { storagePathOf } = require('./profiles');
const { passTunnelWarning, waitAppRendered, performFullLogin, isLoggedIn, ensureOrgSelected } = require('./login');
const { CURSOR_CSS_AND_JS } = require('../core/cursor_motion');
const { guardPage } = require('./page_guard');

const VIEWPORT = { width: 1280, height: 720 };
const sessions = new Map();

async function establish(browser, profile, force) {
  const storagePath = storagePathOf(profile);
  fs.mkdirSync(config.AUTH_DIR, { recursive: true });
  let useSaved = !force && fs.existsSync(storagePath);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const context = await browser.newContext({ viewport: VIEWPORT, storageState: useSaved ? storagePath : undefined });
    try {
      const page = guardPage(await context.newPage());
      page.__fastdoOrg = profile.org;
      await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await passTunnelWarning(page);
      if (useSaved && (await isLoggedIn(page))) {
        await ensureOrgSelected(page, profile.org);
        console.log(`[AUTH] ${profile.name}: dùng lại phiên đã lưu`);
      } else {
        console.log(`[AUTH] ${profile.name}: đăng nhập đầy đủ bằng ${profile.email}`);
        await performFullLogin(page, profile);
      }
      await context.storageState({ path: storagePath });
      return storagePath;
    } catch (err) {
      if (attempt >= 2) {
        const e = new Error(`ĐĂNG NHẬP HỒ SƠ ${profile.name} THẤT BẠI: ${err && err.message ? err.message : err}`);
        e.code = 'LOGIN_FAILED';
        throw e;
      }
      useSaved = false; // lần 2 đăng nhập lại từ đầu
    } finally {
      await context.close().catch(() => {});
    }
  }
  return storagePath;
}

/** Đường dẫn file phiên hợp lệ của hồ sơ (đăng nhập nếu cần). force = đăng nhập lại từ đầu. */
function ensureProfileSession(browser, profile, { force = false } = {}) {
  if (!force && sessions.has(profile.name)) return sessions.get(profile.name);
  const p = establish(browser, profile, force);
  sessions.set(profile.name, p);
  p.catch(() => sessions.delete(profile.name));
  return p;
}

function resetSessions() {
  sessions.clear();
}

/** Vào app trên 1 page đã có phiên: qua cảnh báo tunnel, chờ app render, chọn đúng tổ chức */
async function warmUp(page, profile) {
  await page.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await passTunnelWarning(page);
  await waitAppRendered(page);
  await ensureOrgSelected(page, profile.org);
}

/** Cho tool (plan/preflight/probe): context không quay video, đã vào app, đúng tổ chức */
async function openAppPage(browser, profile, { cursor = true } = {}) {
  const storageState = await ensureProfileSession(browser, profile);
  const context = await browser.newContext({ viewport: VIEWPORT, storageState });
  if (cursor) await context.addInitScript({ content: CURSOR_CSS_AND_JS });
  const page = guardPage(await context.newPage());
  page.__fastdoOrg = profile.org;
  await warmUp(page, profile);
  return { context, page, close: () => context.close().catch(() => {}) };
}

module.exports = { ensureProfileSession, resetSessions, warmUp, openAppPage, VIEWPORT };
```

- [ ] **Step 4:** Run `node -e "require('./src/engine/app_session'); require('./src/engine/browser_pool'); console.log('ok')"` → `ok`.

---

### Task 5: `steps` + `ctx`

**Files:** Create `src/engine/steps.js`, `src/engine/steps.test.js`, `src/engine/ctx.js`

- [ ] **Step 1: Test** `src/engine/steps.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { createStepLog } = require('./steps');

function clockAt(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('mark() đóng bước đang mở và mở bước mới; mốc ms tính từ t0 (lúc bắt đầu quay)', () => {
  const events = [];
  const log = createStepLog({ t0: 1000, clock: clockAt([1100, 1500, 1500, 2600]), onEvent: (e) => events.push(e), print: () => {} });
  log.mark('B1 Mở trang');
  log.mark('B2 Bấm nút');
  log.finish();
  assert.deepStrictEqual(log.steps.map((s) => [s.index, s.label, s.ok, s.startMs, s.endMs]), [
    [1, 'B1 Mở trang', true, 100, 500],
    [2, 'B2 Bấm nút', true, 500, 1600],
  ]);
  assert.deepStrictEqual(events.map((e) => e.status), ['start', 'ok', 'start', 'ok']);
});

test('step(label, fn) lỗi → bước ✗ kèm lỗi, ném lại nguyên trạng', async () => {
  const log = createStepLog({ print: () => {} });
  await assert.rejects(() => log.step('B3 Kích hoạt', async () => { throw new Error('nút mờ'); }), /nút mờ/);
  assert.strictEqual(log.steps[0].ok, false);
  assert.strictEqual(log.steps[0].error, 'nút mờ');
});

test('finish(lỗi) đánh dấu bước đang mở là ✗ — kịch bản ném lỗi giữa bước dùng mark()', () => {
  const log = createStepLog({ print: () => {} });
  log.mark('B1 Mở mẫu');
  log.finish('không tìm thấy mẫu');
  assert.strictEqual(log.steps[0].ok, false);
  assert.strictEqual(log.steps[0].error, 'không tìm thấy mẫu');
});

test('check() ghi nhận phép kiểm, trả boolean, không ném lỗi', () => {
  const log = createStepLog({ print: () => {} });
  assert.strictEqual(log.check('Banner chỉ xem', false, { expected: 'có', actual: 'không' }), false);
  assert.deepStrictEqual(log.checks, [{ label: 'Banner chỉ xem', ok: false, expected: 'có', actual: 'không' }]);
  assert.strictEqual(log.failedChecks().length, 1);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `src/engine/steps.js`

```js
// ============================================================================
// steps.js: nhật ký bước của 1 case — thành dòng ✓/✗ trong ô Kết quả và mốc phụ đề video.
//
//   ctx.mark('B2 Mở mẫu Nháp')        mở bước mới ngay tại dòng này (đóng bước trước là ✓)
//   await ctx.step('B3 …', async fn)  bước bọc quanh 1 hàm; hàm ném lỗi → bước ✗
//   ctx.check('Banner chỉ xem', ok, { expected, actual })   ghi nhận 1 phép kiểm
//
// mark() dùng để port kịch bản cũ mà không phải bọc code vào hàm (bọc sẽ đổi phạm vi biến).
// Bước là PHẲNG — không lồng step trong step.
// ============================================================================

function createStepLog({ t0 = Date.now(), clock = () => Date.now(), onEvent = () => {}, print = console.log } = {}) {
  const steps = [];
  const checks = [];
  let open = null;

  const now = () => clock() - t0;

  function closeOpen(ok, error) {
    if (!open) return;
    open.endMs = now();
    open.ok = ok;
    open.seconds = (open.endMs - open.startMs) / 1000;
    if (error) open.error = String(error);
    onEvent({ ev: 'case.step', index: open.index, label: open.label, status: ok ? 'ok' : 'fail', ms: open.endMs });
    print(`   ${ok ? '✓' : '✗'} ${open.label}  ${open.seconds.toFixed(1)}s${error ? `  ← ${error}` : ''}`);
    open = null;
  }

  function mark(label) {
    closeOpen(true);
    open = { index: steps.length + 1, label: String(label), startMs: now(), endMs: null, ok: null, seconds: 0 };
    steps.push(open);
    onEvent({ ev: 'case.step', index: open.index, label: open.label, status: 'start', ms: open.startMs });
  }

  async function step(label, fn) {
    mark(label);
    try {
      const result = await fn();
      closeOpen(true);
      return result;
    } catch (err) {
      closeOpen(false, err && err.message ? err.message : String(err));
      throw err;
    }
  }

  function check(label, ok, detail = {}) {
    const item = { label: String(label), ok: Boolean(ok), expected: detail.expected, actual: detail.actual };
    checks.push(item);
    print(`   ${item.ok ? '✓' : '✗'} kiểm: ${item.label}`);
    return item.ok;
  }

  /** Kết thúc case: bước còn mở là ✓ nếu không có lỗi, ✗ nếu có */
  function finish(error) {
    if (open) closeOpen(!error, error);
  }

  const failedChecks = () => checks.filter((c) => !c.ok);

  return { steps, checks, mark, step, check, finish, failedChecks };
}

module.exports = { createStepLog };
```

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5: `src/engine/ctx.js`**

```js
// ============================================================================
// ctx.js: hợp đồng ctx v2 truyền cho run(ctx) của kịch bản.
//
// Giữ ĐÚNG chữ ký cũ click(p, el, opt) / type(p, el, text) / waitXPath(p, xp, to) /
// clickUntil / setFlatpickr (p bỏ trống = page) để kịch bản cũ port ít đổi nhất; thêm
// step / mark / check / log / signal / profile.
// ============================================================================

const path = require('path');
const config = require('../config');
const { humanClick, humanType, waitXPath, clickUntil } = require('../core/cursor_motion');
const { setFlatpickrField } = require('../core/datetime_picker');
const { digestToFile } = require('../core/dom_digest');

function createCtx({ page, context, browser, profile, signal, stepLog, runDir, caseId, log = console.log }) {
  let dumpCount = 0;
  return {
    page,
    context,
    browser,
    signal,
    profile: { name: profile.name, org: profile.org },
    click: (p, el, opt) => humanClick(p || page, el, opt),
    type: (p, el, txt, opt) => humanType(p || page, el, txt, opt),
    waitXPath: (p, xp, to) => waitXPath(p || page, xp, to),
    clickUntil: (p, getEl, chk, opt) => clickUntil(p || page, getEl, chk, opt),
    setFlatpickr: (p, ph, d, h, m) => setFlatpickrField(p || page, ph, d, h, m),
    step: (label, fn) => stepLog.step(label, fn),
    mark: (label) => stepLog.mark(label),
    check: (label, ok, detail) => stepLog.check(label, ok, detail),
    log: (text) => log(`[${caseId}] ${text}`),
    // Dump DOM ra text ngay tại dòng đang bí — không dừng test, không ném lỗi.
    dump: async (label) => {
      dumpCount += 1;
      const slug = String(label || 'dump').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dump';
      try {
        const { filePath } = await digestToFile(page, `${caseId}_dump_${dumpCount}_${slug}.txt`, { label, tables: true, dir: runDir });
        log(`[DUMP] ${label || ''} → ${path.relative(config.ROOT_DIR, filePath)}`);
        return filePath;
      } catch (err) {
        log(`[DUMP] thất bại: ${err.message}`);
        return null;
      }
    },
  };
}

module.exports = { createCtx };
```

---

### Task 6: `video_post`

**Files:** Create `src/engine/video_post.js`, `src/engine/video_post.test.js`

- [ ] **Step 1: Test**

```js
const test = require('node:test');
const assert = require('node:assert');
const V = require('./video_post');

const steps = [
  { label: 'B1 Mở tab', startMs: 3000, endMs: 5000, ok: true },
  { label: 'B2 Bấm Kích hoạt', startMs: 5000, endMs: 9000, ok: false },
];

test('phụ đề trừ phần khởi động bị cắt đầu video; có đoạn "chuẩn bị" trước bước 1', () => {
  const cues = V.buildCaptions({ caseId: 'EVAL_021', steps, trimMs: 2000, durationMs: 12000 });
  assert.deepStrictEqual(cues, [
    { startMs: 0, endMs: 1000, text: 'EVAL_021 · chuẩn bị' },
    { startMs: 1000, endMs: 3000, text: 'EVAL_021 · B1 Mở tab · 00:01' },
    { startMs: 3000, endMs: 10000, text: 'EVAL_021 · B2 Bấm Kích hoạt · 00:03 ✗' },
  ]);
});

test('không có bước (kịch bản cũ) → 1 phụ đề mã case suốt video', () => {
  assert.deepStrictEqual(V.buildCaptions({ caseId: 'EVAL_017', steps: [], trimMs: 0, durationMs: 5000 }), [
    { startMs: 0, endMs: 5000, text: 'EVAL_017' },
  ]);
});

test('định dạng thời gian ASS / VTT / mm:ss', () => {
  assert.strictEqual(V.assTime(3723450), '1:02:03.45');
  assert.strictEqual(V.vttTime(3723450), '01:02:03.450');
  assert.strictEqual(V.mmss(83000), '01:23');
});

test('toAss có khung 1280×780 (dải 60px dưới hình) và thoát ký tự điều khiển của ASS', () => {
  const ass = V.toAss([{ startMs: 0, endMs: 1000, text: 'a {b} \\c' }]);
  assert.match(ass, /PlayResX: 1280/);
  assert.match(ass, /PlayResY: 780/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Buoc,,0,0,0,,a \(b\) \/c/);
});

test('toVtt đúng chuẩn WebVTT', () => {
  const vtt = V.toVtt([{ startMs: 0, endMs: 1500, text: 'x' }]);
  assert.strictEqual(vtt, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nx\n');
});

test('bộ giới hạn chạy tối đa N việc cùng lúc', async () => {
  const limit = V.createLimiter(2);
  let active = 0;
  let peak = 0;
  const job = () => limit(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active -= 1;
  });
  await Promise.all([job(), job(), job(), job(), job()]);
  assert.strictEqual(peak, 2);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `src/engine/video_post.js`

```js
// ============================================================================
// video_post.js: hậu kỳ video 1 case — webm (Playwright) → mp4 H.264 có DẢI PHỤ ĐỀ BƯỚC
// đặt DƯỚI khung hình (đệm 60px, không đè lên app), kèm steps.vtt cho trình phát của UI.
//
// Phần "khởi động" (vào app, chọn tổ chức) được cắt khỏi đầu video như video cũ vốn
// không có bước đăng nhập. ffmpeg chạy với cwd = thư mục run và tên file tương đối — tránh
// lỗi thoát ký tự đường dẫn Windows trong filter `subtitles`. Tối đa 2 việc ffmpeg cùng lúc.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WIDTH = 1280;
const HEIGHT = 720;
const BAND = 60;
const two = (n) => String(n).padStart(2, '0');

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function assTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${two(m)}:${two(s)}.${two(cs % 100)}`;
}

function vttTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${two(h)}:${two(m)}:${two(s)}.${String(t % 1000).padStart(3, '0')}`;
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const assText = (t) => String(t).replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\\/g, '/').replace(/\r?\n/g, ' ');

/** Phụ đề theo bước; mốc thời gian đã trừ phần khởi động bị cắt đầu video */
function buildCaptions({ caseId, steps = [], trimMs = 0, durationMs = 0 }) {
  const end = Math.max(1000, durationMs - trimMs);
  const list = steps
    .map((s) => ({ ...s, start: Math.max(0, (s.startMs || 0) - trimMs) }))
    .filter((s) => s.start < end)
    .sort((a, b) => a.start - b.start);
  if (!list.length) return [{ startMs: 0, endMs: end, text: caseId }];
  const cues = [];
  if (list[0].start > 0) cues.push({ startMs: 0, endMs: list[0].start, text: `${caseId} · chuẩn bị` });
  list.forEach((s, i) => {
    const stop = list[i + 1] ? list[i + 1].start : end;
    if (stop <= s.start) return;
    cues.push({
      startMs: s.start,
      endMs: stop,
      text: `${caseId} · ${cut(String(s.label), 80)} · ${mmss(s.start)}${s.ok === false ? ' ✗' : ''}`,
    });
  });
  return cues;
}

function toAss(cues) {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT + BAND}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, ' +
      'Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, ' +
      'MarginR, MarginV, Encoding',
    'Style: Buoc,Arial,26,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,20,20,17,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Buoc,,0,0,0,,${assText(c.text)}`);
  return `${[...head, ...lines].join('\n')}\n`;
}

function toVtt(cues) {
  const body = cues.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.text}\n`);
  return `WEBVTT\n\n${body.join('\n')}`;
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

const limit = createLimiter(2);

function runFfmpeg(args, { cwd, timeoutMs = 180000, ffmpeg = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { cwd, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ffmpeg quá ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`không chạy được ffmpeg: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thoát mã ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/**
 * webm → mp4 + dải phụ đề bước. Ghi steps.ass + steps.vtt cạnh video.
 * @returns {Promise<{mp4: string, vtt: string, ass: string}>}
 */
function renderCaseVideo({ runDir, webmName = 'video.webm', mp4Name, caseId, steps, trimMs = 0, durationMs = 0 }) {
  return limit(async () => {
    const cues = buildCaptions({ caseId, steps, trimMs, durationMs });
    fs.writeFileSync(path.join(runDir, 'steps.ass'), toAss(cues), 'utf8');
    fs.writeFileSync(path.join(runDir, 'steps.vtt'), toVtt(cues), 'utf8');
    await runFfmpeg(
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', (Math.max(0, trimMs) / 1000).toFixed(3),
        '-i', webmName,
        '-vf', `pad=${WIDTH}:${HEIGHT + BAND}:0:0:black,subtitles=steps.ass`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-an',
        mp4Name,
      ],
      { cwd: runDir }
    );
    return { mp4: path.join(runDir, mp4Name), vtt: path.join(runDir, 'steps.vtt'), ass: path.join(runDir, 'steps.ass') };
  });
}

module.exports = { buildCaptions, toAss, toVtt, mmss, assTime, vttTime, createLimiter, runFfmpeg, renderCaseVideo, WIDTH, HEIGHT, BAND };
```

- [ ] **Step 4:** Run → PASS.

---

### Task 7: `script_meta` + `result_v2`

**Files:** Create `src/engine/script_meta.js`, `script_meta.test.js`, `result_v2.js`, `result_v2.test.js`

- [ ] **Step 1: Test** `script_meta.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./script_meta');

const run = async () => ({ pass: true, resultText: '' });

test('mặc định: hồ sơ default, chạy một mình, 150s; resources suy từ DRAFT_TEMPLATE_NAME', () => {
  const src = "const DRAFT_TEMPLATE_NAME = 'Mẫu TTS - Bản sao';";
  const m = M.readMeta({ id: 'EVAL_021', run }, 'eval_021.test.js', src);
  assert.deepStrictEqual(
    { profile: m.profile, parallel: m.parallel, timeoutSec: m.timeoutSec, resources: m.resources, problems: m.problems },
    { profile: 'default', parallel: false, timeoutSec: 150, resources: ['mau:Mẫu TTS - Bản sao'], problems: [] }
  );
});

test('consumes luôn được gộp vào resources (thứ bị tiêu hao cũng phải khoá)', () => {
  const m = M.readMeta({ id: 'EVAL_037', run, parallel: true, consumes: ['phieu:DRYRUN040'] }, 'x.js', '');
  assert.deepStrictEqual(m.resources, ['phieu:DRYRUN040']);
  assert.deepStrictEqual(m.consumes, ['phieu:DRYRUN040']);
  assert.strictEqual(m.parallel, true);
});

test('khai báo sai → problems (engine báo HỢP ĐỒNG KỊCH BẢN, không chạy)', () => {
  const m = M.readMeta({ id: 'EVAL_X', profile: 'Nhân Viên', resources: 'mau:a', timeoutSec: 5 }, 'x.js', '');
  assert.strictEqual(m.problems.length, 4);
});

test('mã băm đổi khi file kịch bản đổi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-meta-'));
  const f = path.join(dir, 'eval_x.test.js');
  fs.writeFileSync(f, 'a');
  const h1 = M.scriptHash(f, dir, []);
  fs.writeFileSync(f, 'b');
  const h2 = M.scriptHash(f, dir, []);
  assert.match(h1, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(h1, h2);
});
```

`result_v2.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./result_v2');

test('verdictOf: huỷ > lỗi hạ tầng > đạt/không đạt', () => {
  assert.strictEqual(R.verdictOf({ cancelled: true, error: 'x' }), 'DA_HUY');
  assert.strictEqual(R.verdictOf({ error: 'x', pass: false }), 'LOI_HA_TANG');
  assert.strictEqual(R.verdictOf({ pass: true }), 'DAT');
  assert.strictEqual(R.verdictOf({ pass: false }), 'KHONG_DAT');
});

test('tên thư mục run: nháp ghi "nhap", thật ghi "v<vòng>", kèm hồ sơ, pid, lần thử', () => {
  assert.strictEqual(
    R.runDirName({ stamp: '20260929-101500', caseId: 'EVAL_021', mode: 'nhap', round: 3, profile: 'default', pid: 42, attempt: 1 }),
    '20260929-101500-EVAL_021-nhap-default-42-a1'
  );
  assert.strictEqual(
    R.runDirName({ stamp: '20260929-101500', caseId: 'EVAL_021', mode: 'that', round: 3, profile: 'slot2', pid: 42, attempt: 2 }),
    '20260929-101500-EVAL_021-v3-slot2-42-a2'
  );
});

test('createRecord giữ đủ trường v1 mà giao diện cũ và commit đang đọc', () => {
  const r = R.createRecord({ caseId: 'EVAL_1', runId: 'abcdefgh', mode: 'that', round: 2, profile: 'default', runDir: 'x' });
  for (const k of ['testcaseId', 'round', 'account', 'pass', 'resultText', 'videoPath', 'videoUrl', 'sheet', 'sheetCell', 'sheetStatus', 'error', 'failReport', 'seconds', 'startedAt', 'targetUrl', 'flags']) {
    assert.ok(k in r, k);
  }
  assert.strictEqual(r.schema, 2);
});

test('writeRecord ghi result.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-rec-'));
  const r = R.createRecord({ caseId: 'EVAL_1', runId: 'abcdefgh', mode: 'nhap', profile: 'default', runDir: dir });
  R.writeRecord(r);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')).testcaseId, 'EVAL_1');
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `script_meta.js`

```js
// ============================================================================
// script_meta.js: nạp kịch bản, đọc khai báo v2, tính mã băm.
//
//   profile   hồ sơ cần dùng (mặc định 'default')
//   resources dữ liệu dùng chung → không chạy cùng lúc; tự suy thêm từ hằng số
//             DRAFT_TEMPLATE_NAME / TEMPLATE_NAME (tiền tố "mau:")
//   consumes  dữ liệu bị tiêu hao mỗi lần chạy → cảnh báo cần thêm bản; luôn gộp vào resources
//   parallel  true = tự nhận an toàn khi chạy song song; bỏ trống = chạy một mình
//   timeoutSec hạn giờ (10–1800, mặc định 150)
// Mã băm = file kịch bản + các helper thao tác: sửa bất kỳ file nào → phải chạy nháp lại.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { NAME_RE } = require('./profiles');

const TESTCASE_DIR = path.join(config.ROOT_DIR, 'src', 'testcases');
const FIXTURE_CONST_RE = /(?:DRAFT_)?TEMPLATE_NAME\s*=\s*['"]([^'"]+)['"]/g;
const HASH_FILES = [
  'src/engine/ctx.js',
  'src/engine/steps.js',
  'src/core/evaluation_helpers.js',
  'src/core/cursor_motion.js',
  'src/core/page_ready.js',
  'src/core/datetime_picker.js',
];
const DEFAULT_TIMEOUT_SEC = 150;

function findScriptFile(caseId, dir = TESTCASE_DIR) {
  for (const name of [`${caseId.toLowerCase()}.test.js`, `${caseId}.test.js`, `${caseId.toLowerCase()}_record.js`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function derivedResources(source) {
  const out = [];
  const re = new RegExp(FIXTURE_CONST_RE.source, 'g');
  let m;
  while ((m = re.exec(source)) !== null) out.push(`mau:${m[1]}`);
  return out;
}

function readMeta(mod, file, source = '') {
  const problems = [];
  const id = String(mod.id || path.basename(file).replace(/\.test\.js$|_record\.js$/i, '')).toUpperCase();
  const profile = mod.profile === undefined ? 'default' : String(mod.profile);
  if (!NAME_RE.test(profile)) problems.push(`profile "${profile}" không hợp lệ (chỉ a-z, 0-9, _)`);

  const list = (v, name) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
      problems.push(`${name} phải là mảng chuỗi`);
      return [];
    }
    return v.map((x) => x.trim());
  };
  const consumes = list(mod.consumes, 'consumes');
  const resources = [...new Set([...list(mod.resources, 'resources'), ...consumes, ...derivedResources(source)])];

  const t = mod.timeoutSec === undefined ? DEFAULT_TIMEOUT_SEC : Number(mod.timeoutSec);
  const timeoutOk = Number.isInteger(t) && t >= 10 && t <= 1800;
  if (!timeoutOk) problems.push(`timeoutSec "${mod.timeoutSec}" phải là số nguyên 10–1800`);
  if (typeof mod.run !== 'function') problems.push('thiếu hàm async run(ctx)');

  return {
    id,
    title: String(mod.title || ''),
    profile,
    resources,
    consumes,
    parallel: mod.parallel === true,
    timeoutSec: timeoutOk ? t : DEFAULT_TIMEOUT_SEC,
    problems,
  };
}

function scriptHash(file, root = config.ROOT_DIR, extra = HASH_FILES) {
  const h = crypto.createHash('sha256');
  const add = (p) => {
    h.update(path.relative(root, p).replace(/\\/g, '/'));
    h.update('\0');
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));
    h.update('\0');
  };
  add(file);
  for (const rel of extra) add(path.join(root, rel));
  const libDir = path.join(root, 'src', 'testcases', 'lib');
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js')).sort()) add(path.join(libDir, f));
  }
  return h.digest('hex').slice(0, 12);
}

/** null nếu chưa có kịch bản */
function loadScript(caseId) {
  const file = findScriptFile(caseId);
  if (!file) return null;
  const source = fs.readFileSync(file, 'utf8');
  const mod = require(file);
  return { file, module: mod, meta: readMeta(mod, file, source), hash: scriptHash(file) };
}

module.exports = { findScriptFile, derivedResources, readMeta, scriptHash, loadScript, HASH_FILES, DEFAULT_TIMEOUT_SEC, TESTCASE_DIR };
```

`result_v2.js`:

```js
// ============================================================================
// result_v2.js: result.json phiên bản 2 — giữ MỌI trường v1 (giao diện cũ + commit đọc),
// thêm verdict, bước, phép kiểm, video, trace, mã băm, hồ sơ, lần thử.
// ============================================================================

const fs = require('fs');
const path = require('path');

const VERDICT = { DAT: 'DAT', KHONG_DAT: 'KHONG_DAT', LOI_HA_TANG: 'LOI_HA_TANG', DA_HUY: 'DA_HUY' };

function createRecord({
  caseId, title, runId, batchId, mode, round, profile, account = 1, envLabel, targetUrl,
  scriptHash, attempt = 1, runDir, flags,
}) {
  return {
    schema: 2,
    testcaseId: caseId,
    title: title || '',
    runId,
    batchId: batchId || null,
    mode,
    round: round || null,
    account,
    profile,
    envLabel: envLabel || null,
    targetUrl: targetUrl || '',
    scriptHash: scriptHash || null,
    attempt,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runDir,
    flags: flags || {},
    verdict: null,
    cancelled: false,
    pass: null,
    resultText: '',
    error: null,
    diagnosis: null,
    steps: [],
    checks: [],
    trimMs: 0,
    videoPath: null,
    videoUrl: null,
    video: { webm: null, mp4: null, url: null, vtt: null },
    trace: null,
    sheetCell: null,
    sheetStatus: null,
    sheet: { state: 'skipped', reason: 'chưa chạy tới bước ghi Sheet' },
    review: null,
    failReport: null,
    seconds: 0,
  };
}

function verdictOf(r) {
  if (r.cancelled) return VERDICT.DA_HUY;
  if (r.error) return VERDICT.LOI_HA_TANG;
  return r.pass === true ? VERDICT.DAT : VERDICT.KHONG_DAT;
}

function runDirName({ stamp, caseId, mode, round, profile, pid, attempt = 1 }) {
  return `${stamp}-${caseId}-${mode === 'nhap' ? 'nhap' : `v${round}`}-${profile}-${pid}-a${attempt}`;
}

function writeRecord(r) {
  r.finishedAt = r.finishedAt || new Date().toISOString();
  fs.mkdirSync(r.runDir, { recursive: true });
  fs.writeFileSync(path.join(r.runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');
  return r;
}

module.exports = { VERDICT, createRecord, verdictOf, runDirName, writeRecord };
```

- [ ] **Step 4:** Run → PASS.

---

### Task 8: `diagnostics` — 3 hạng chẩn đoán mới + đường dẫn trace

**Files:** Modify `src/core/diagnostics.js`; Create `src/core/diagnostics.test.js`

- [ ] **Step 1: Test**

```js
const test = require('node:test');
const assert = require('node:assert');
const { classifyFailure } = require('./diagnostics');

test('HỢP ĐỒNG KỊCH BẢN xếp trước mọi hạng khác', () => {
  assert.strictEqual(classifyFailure({ errorMessage: '[HỢP ĐỒNG KỊCH BẢN] pass phải là boolean', verdict: 'CRASH' }).kind, 'HỢP ĐỒNG KỊCH BẢN');
});

test('ĐĂNG NHẬP HỒ SƠ THẤT BẠI', () => {
  assert.strictEqual(classifyFailure({ errorMessage: 'ĐĂNG NHẬP HỒ SƠ nhanvien THẤT BẠI: timeout', verdict: 'CRASH' }).kind, 'ĐĂNG NHẬP HỒ SƠ THẤT BẠI');
});

test('PHIÊN BỊ APP CHẶN nhận từ chữ trên trang, trước cả LỚP PHỦ', () => {
  const bodyText = 'Tài khoản của bạn vừa được đăng nhập ở một nơi khác, mã xác thực hiện tại là 1234';
  const domText = Array.from({ length: 6 }, (_, i) => `0${i} button ⚠ BỊ CHE bởi div.modal`).join('\n');
  assert.strictEqual(classifyFailure({ errorMessage: 'Waiting failed', verdict: 'CRASH', bodyText, domText }).kind, 'PHIÊN BỊ APP CHẶN');
});

test('hạng cũ không đổi', () => {
  assert.strictEqual(classifyFailure({ errorMessage: 'Watchdog: quá 150s', verdict: 'CRASH' }).kind, 'HẾT HẠN CHỜ');
  assert.strictEqual(classifyFailure({ errorMessage: '', verdict: 'FAIL' }).kind, 'KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT');
});
```

- [ ] **Step 2:** Run → FAIL (3 test đầu).

- [ ] **Step 3: Sửa `classifyFailure`** — đổi chữ ký thành `function classifyFailure({ errorMessage, collector, domText, verdict, bodyText })` và thêm ngay sau dòng `const consoleErrors = …`:

```js
  // Ba hạng của engine v2 — xếp trước: chúng không phải lỗi app, không phải lỗi selector.
  if (/HỢP ĐỒNG KỊCH BẢN/.test(msg)) {
    return {
      kind: 'HỢP ĐỒNG KỊCH BẢN',
      hint:
        'Kịch bản vi phạm hợp đồng (pass không phải boolean, có phép kiểm ✗ mà pass = true, hoặc dùng cú ' +
        'pháp Puppeteer trên Playwright). Sửa kịch bản — đây KHÔNG phải kết quả kiểm thử.',
    };
  }
  if (/ĐĂNG NHẬP HỒ SƠ .+ THẤT BẠI/.test(msg)) {
    return {
      kind: 'ĐĂNG NHẬP HỒ SƠ THẤT BẠI',
      hint: 'Không đăng nhập được bằng hồ sơ này — kiểm email / mật khẩu / tổ chức trong .env, hoặc tunnel đã đổi URL.',
    };
  }
  if (/đăng nhập ở một nơi khác|Mã xác thực được gửi đến/i.test(String(bodyText || ''))) {
    return {
      kind: 'PHIÊN BỊ APP CHẶN',
      hint:
        'App báo tài khoản đăng nhập ở nơi khác / đòi mã xác thực — app đã bật lại chặn đăng nhập song ' +
        'song. Giảm số luồng (PARALLEL=1) cho hồ sơ này. Chạy lại không tự khỏi.',
    };
  }
```

- [ ] **Step 4: `writeFailReport`** — ngay sau `dom = await digestRowsOnly(p.page, { limit: 40 });` thêm:

```js
      // Chữ trên trang (cắt ngắn) chỉ để phân loại — bắt popup "đăng nhập ở nơi khác".
      bodyText = await p.page
        .evaluate(() => (document.body ? document.body.innerText.slice(0, 5000) : ''))
        .catch(() => '');
```

(khai báo `let bodyText = '';` ngay trên `let dom = null;`), truyền `bodyText` vào `classifyFailure({ …, bodyText })`, gán `if (p.diagnosisOut) p.diagnosisOut.diagnosis = { kind: cls.kind, hint: cls.hint };` ngay sau khi có `cls`, và trước khối `if (p.videoPath …)` thêm:

```js
    if (p.tracePath) {
      lines.push('');
      lines.push(`Trace: ${path.relative(path.join(__dirname, '..', '..'), p.tracePath)} — mở: npx playwright show-trace "${p.tracePath}"`);
    }
```

- [ ] **Step 5:** Run `node --test src/core/diagnostics.test.js` → PASS.

---

### Task 9: `case_runner` + `sheet_step` + `index.runBatch`

**Files:** Create `src/engine/case_runner.js`, `src/engine/sheet_step.js`, `src/engine/index.js`

- [ ] **Step 1: `case_runner.js`**

```js
// ============================================================================
// case_runner.js: vòng đời MỘT case trên một BrowserContext mới.
//
//   context mới (phiên hồ sơ, video webm, trace) → khởi động (vào app, đúng tổ chức — bị
//   cắt khỏi đầu video) → run(ctx) dưới watchdog + huỷ → kiểm hợp đồng → báo cáo lỗi khi
//   FAIL/lỗi (TRƯỚC khi đóng context, còn đọc được DOM) → trace (giữ khi không ĐẠT) →
//   đóng context (video hoàn tất) → result.
// Hết giờ hoặc bị huỷ = ĐÓNG CONTEXT: mọi thao tác đang treo của case chết ngay, không đụng
// context của case khác — thay cho watchdog cũ chỉ "thôi chờ" mà promise vẫn điều khiển page.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { CURSOR_CSS_AND_JS } = require('../core/cursor_motion');
const { attachCollectors, writeFailReport } = require('../core/diagnostics');
const { guardPage, contractError } = require('./page_guard');
const { warmUp, VIEWPORT } = require('./app_session');
const { createStepLog } = require('./steps');
const { createCtx } = require('./ctx');
const { createRecord, verdictOf } = require('./result_v2');

const errMsg = (err) => (err && err.message ? String(err.message) : String(err));

function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Chạy run(ctx) với hạn giờ + huỷ. Ném lỗi mang code CASE_TIMEOUT / CASE_CANCELLED. */
function guardRun(promise, { timeoutMs, signal }) {
  promise.catch(() => {}); // promise bị bỏ rơi sau khi đóng context — không để thành unhandled
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(`Watchdog: case vượt quá ${timeoutMs / 1000}s — đóng context để chạy tiếp`);
      e.code = 'CASE_TIMEOUT';
      reject(e);
    }, timeoutMs);
    const onAbort = () => {
      const e = new Error('ĐÃ HUỶ theo yêu cầu');
      e.code = 'CASE_CANCELLED';
      reject(e);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      });
  });
}

/** Kiểm hợp đồng kết quả; vi phạm → ném lỗi HỢP ĐỒNG KỊCH BẢN (không bao giờ thành kết quả kiểm thử) */
function checkContract(result, stepLog) {
  if (typeof (result && result.pass) !== 'boolean') {
    throw contractError(`kịch bản trả về pass = ${JSON.stringify(result && result.pass)}, phải là true hoặc false.`);
  }
  const bad = stepLog.failedChecks();
  if (result.pass && bad.length) {
    throw contractError(`pass = true nhưng có phép kiểm ✗: ${bad.map((c) => c.label).join(', ')}.`);
  }
}

/**
 * @param {object} o
 * @param {import('playwright-core').Browser} o.browser
 * @param {{meta, module, hash}} o.script      từ script_meta.loadScript
 * @param {{name, org}} o.profile
 * @param {string} [o.storagePath]             file phiên của hồ sơ (bỏ trống = context trắng)
 * @param {string} o.runDir
 * @param {object} o.opts                      { mode, round, record(video), caseTimeoutSec, trace }
 * @param {Function} [o.onEvent]
 * @param {AbortSignal} [o.signal]
 */
async function runCase({ browser, script, profile, storagePath, runDir, opts, runId, batchId, envLabel, attempt = 1, onEvent = () => {}, signal, print = console.log }) {
  const caseId = script.meta.id;
  const startedAt = Date.now();
  const record = createRecord({
    caseId, title: script.meta.title, runId, batchId, mode: opts.mode, round: opts.round, profile: profile.name,
    account: opts.account || 1, envLabel, targetUrl: config.TARGET_URL, scriptHash: script.hash, attempt, runDir,
    flags: { record: Boolean(opts.record), upload: Boolean(opts.upload), sheet: Boolean(opts.sheet), row: opts.row || null },
  });
  fs.mkdirSync(runDir, { recursive: true });
  const emit = (e) => onEvent({ ...e, caseId });
  emit({ ev: 'case.started', attempt, profile: profile.name, runDir });

  let context = null;
  let page = null;
  let stepLog = createStepLog({ print });
  const timeoutMs = (opts.caseTimeoutSec || script.meta.timeoutSec) * 1000;
  const tracePath = path.join(runDir, 'trace.zip');

  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      storageState: storagePath && fs.existsSync(storagePath) ? storagePath : undefined,
      recordVideo: opts.record ? { dir: runDir, size: VIEWPORT } : undefined,
    });
    await context.addInitScript({ content: CURSOR_CSS_AND_JS });
    if (opts.trace !== false) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = guardPage(await context.newPage());
    page.__fastdoOrg = profile.org;
    const videoT0 = Date.now();
    const collector = attachCollectors(page);
    collector.reset();
    record.__collector = collector;

    await guardRun(warmUp(page, profile), { timeoutMs: 60000, signal });
    record.trimMs = Date.now() - videoT0;

    stepLog = createStepLog({ t0: videoT0, onEvent: emit, print });
    const ctx = createCtx({ page, context, browser, profile, signal, stepLog, runDir, caseId, log: print });
    const result = await guardRun(Promise.resolve().then(() => script.module.run(ctx)), { timeoutMs, signal });
    checkContract(result, stepLog);
    record.pass = result.pass;
    record.resultText = String(result.resultText == null ? '' : result.resultText);
    stepLog.finish();
  } catch (err) {
    const msg = errMsg(err);
    stepLog.finish(msg);
    record.pass = false;
    if (err && err.code === 'CASE_CANCELLED') {
      record.cancelled = true;
      record.error = msg;
      record.resultText = 'ĐÃ HUỶ theo yêu cầu — không phải kết quả kiểm thử';
    } else {
      record.error = msg;
      record.resultText = `LỖI KHI CHẠY TEST: ${msg}`;
    }
  }

  record.steps = stepLog.steps.map((s) => ({ index: s.index, label: s.label, ok: s.ok, startMs: s.startMs, endMs: s.endMs, seconds: s.seconds, error: s.error }));
  record.checks = stepLog.checks.slice();
  record.verdict = verdictOf(record);

  // Báo cáo lỗi TRƯỚC khi đóng context: còn đọc được DOM lúc chết.
  if (page && record.verdict !== 'DAT' && record.verdict !== 'DA_HUY') {
    record.failReport = await withTimeout(
      writeFailReport({
        testcaseId: caseId,
        verdict: record.error ? 'CRASH' : 'FAIL',
        page,
        collector: record.__collector,
        steps: record.steps,
        errorMessage: record.error,
        resultText: record.resultText,
        videoPath: null,
        tracePath: opts.trace !== false ? tracePath : null,
        seconds: (Date.now() - startedAt) / 1000,
        outDir: runDir,
        diagnosisOut: record,
      }),
      15000
    );
  }
  delete record.__collector;

  if (context) {
    const keepTrace = opts.trace !== false && record.verdict !== 'DAT';
    await withTimeout(context.tracing.stop(keepTrace ? { path: tracePath } : undefined).catch(() => {}), 20000);
    if (keepTrace && fs.existsSync(tracePath)) record.trace = tracePath;
    const video = page && opts.record ? page.video() : null;
    await withTimeout(context.close().catch(() => {}), 20000);
    if (video) {
      const raw = await withTimeout(video.path().catch(() => null), 10000);
      if (raw && fs.existsSync(raw)) {
        const webm = path.join(runDir, 'video.webm');
        if (path.resolve(raw) !== path.resolve(webm)) fs.renameSync(raw, webm);
        record.video.webm = webm;
        record.videoPath = webm;
      }
    }
  }

  record.durationMs = Date.now() - startedAt;
  record.seconds = record.durationMs / 1000;
  emit({ ev: 'case.finished', verdict: record.verdict, seconds: record.seconds, diagnosis: record.diagnosis });
  return record;
}

module.exports = { runCase, guardRun, checkContract, withTimeout };
```

- [ ] **Step 2: `sheet_step.js`** (chính sách ghi Sheet của kỳ 1, tách khỏi runner cũ — kỳ 3 thay bằng chốt quy trình)

```js
// ============================================================================
// sheet_step.js: quyết định + ghi Sheet cho 1 record theo cờ --sheet-on (kỳ 1).
// Lỗi hạ tầng / bị huỷ KHÔNG BAO GIỜ ghi; không có link video KHÔNG ghi.
// ============================================================================

async function writeSheetForRecord(record, { sheet, opts, print = console.log }) {
  if (!opts.sheet || opts.sheetOn === 'never') {
    return { state: 'skipped', reason: opts.sheetOn === 'never' ? 'tắt bằng --sheet-on=never' : 'tắt (chạy nháp / --no-sheet)' };
  }
  if (record.verdict === 'DA_HUY') return { state: 'skipped', reason: 'case bị huỷ — không phải kết quả kiểm thử' };
  if (record.error) {
    return { state: 'skipped', reason: 'lỗi hạ tầng — lỗi chạy máy không phải kết quả kiểm thử, cần chạy lại case' };
  }
  if (opts.sheetOn === 'pass' && record.pass !== true) {
    return { state: 'pending', reason: 'case KHÔNG ĐẠT — chờ QC xem video rồi duyệt (npm run commit -- <thư mục run>)' };
  }
  if (!record.videoUrl) {
    return { state: 'skipped', reason: record.videoPath ? 'upload Catbox thất bại nên chưa có link video' : 'không có video' };
  }
  if (!sheet) return { state: 'skipped', reason: 'chưa mở được Google Sheet lúc khởi động (xem lỗi đầu log)' };

  try {
    const info = await sheet.writer.enqueue({
      caseId: record.testcaseId,
      round: record.round,
      row: opts.row || null,
      pass: record.pass,
      runId: record.runId,
      startedAt: record.startedAt,
      envLabel: record.envLabel,
      profile: record.profile,
      steps: record.steps,
      checks: record.checks,
      resultText: record.resultText,
      videoUrl: record.videoUrl,
      runDir: record.runDir,
      reviewer: null,
    });
    (info.warnings || []).forEach((w) => print(`[SHEET] ⚠ ${w}`));
    print(
      `[SHEET] ${record.testcaseId} → ${info.already ? 'đã có từ trước, không ghi lại' : 'đã ghi'} ` +
        Object.entries(info.cells).map(([k, a1]) => `${k} ${a1}`).join(', ')
    );
    record.sheetCell = info.cells.result;
    record.sheetStatus = info.status;
    return {
      state: 'written', cell: info.cells.result, cells: info.cells, status: info.status, auditId: info.auditId,
      already: info.already, warnings: info.warnings, tab: { gid: sheet.tab.gid, title: sheet.tab.title },
    };
  } catch (err) {
    print(`[ERROR] Cập nhật Google Sheet thất bại: ${err.message}`);
    return { state: 'failed', reason: err.message, auditId: err.auditId || null };
  }
}

module.exports = { writeSheetForRecord };
```

- [ ] **Step 3: `index.js`**

```js
// ============================================================================
// engine/index.js: hàm thư viện cho CLI (runner.js) và server giao diện.
// Kỳ 2: chạy TUẦN TỰ 1 luồng; kỳ 3 thay vòng for bằng bộ lập lịch song song + chốt quy trình.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { uploadToCatbox } = require('../core/catbox');
const { openSheet } = require('../sheets');
const { parseEnvLabels, resolveEnvLabel } = require('../sheets/env_label');
const { showSpaces } = require('../sheets/a1');
const { createBrowserPool } = require('./browser_pool');
const { getProfile } = require('./profiles');
const { ensureProfileSession } = require('./app_session');
const { loadScript } = require('./script_meta');
const { runCase } = require('./case_runner');
const { renderCaseVideo } = require('./video_post');
const { createRecord, verdictOf, runDirName, writeRecord } = require('./result_v2');
const { writeSheetForRecord } = require('./sheet_step');

const RUNS_DIR = path.join(config.ROOT_DIR, 'runs');

function stamp(date = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/** Ghi lại một case không chạy được (thiếu hồ sơ, sai khai báo, đăng nhập hỏng) */
function blockedRecord({ caseId, title, opts, profileName, envLabel, error, batchId }) {
  const runDir = path.join(RUNS_DIR, runDirName({ stamp: stamp(), caseId, mode: opts.mode, round: opts.round, profile: profileName, pid: process.pid, attempt: 1 }));
  const r = createRecord({ caseId, title, runId: crypto.randomUUID(), batchId, mode: opts.mode, round: opts.round, profile: profileName, account: opts.account || 1, envLabel, targetUrl: config.TARGET_URL, runDir });
  r.error = error;
  r.pass = false;
  r.resultText = `LỖI KHI CHẠY TEST: ${error}`;
  r.verdict = verdictOf(r);
  r.sheet = { state: 'skipped', reason: 'case không chạy được — không phải kết quả kiểm thử' };
  return writeRecord(r);
}

/**
 * Chạy một lượt. opts: { caseIds, mode: 'nhap'|'that', round, record, upload, sheet, sheetOn, row,
 * caseTimeoutSec, headless, profile (ép hồ sơ), account, trace }.
 * @returns {Promise<{records, timings, seconds, batchId}>}
 */
async function runBatch(opts, { print = console.log, onEvent = () => {} } = {}) {
  const t0 = Date.now();
  const timings = [];
  const phase = async (label, fn) => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      timings.push({ label, seconds: (Date.now() - s) / 1000 });
    }
  };
  const batchId = `${stamp()}-lot-${process.pid}`;
  const envLabel = resolveEnvLabel(config.TARGET_URL, parseEnvLabels(config.ENV_LABELS));

  let sheet = null;
  if (opts.mode === 'that' && opts.sheet && opts.sheetOn !== 'never') {
    if (!envLabel) {
      throw new Error(`[AN TOÀN] Host của TARGET_URL (${config.TARGET_URL}) chưa có nhãn Môi trường. Khai ENV_LABELS trong .env rồi chạy lại.`);
    }
    const opened = await phase('Mở Google Sheet (API)', () => openSheet());
    opened.tab.warnings.forEach((w) => print(`[SHEET] ⚠ ${w}`));
    sheet = { tab: opened.tab, writer: opened.writer() };
    print(`[SHEET] Ghi vào tab "${showSpaces(opened.tab.title)}" (gid ${opened.tab.gid}) · Môi trường "${envLabel}"`);
  }

  const pool = createBrowserPool({ headless: Boolean(opts.headless) });
  const records = [];
  onEvent({ ev: 'batch.started', batchId, mode: opts.mode, round: opts.round, parallel: 1, cases: opts.caseIds });
  try {
    for (const caseId of opts.caseIds) {
      const script = loadScript(caseId);
      const profileName = opts.profile || (script ? script.meta.profile : 'default');
      if (!script) {
        records.push(blockedRecord({ caseId, opts, profileName, envLabel, batchId, error: `Chưa có kịch bản cho mã "${caseId}"` }));
        continue;
      }
      if (script.meta.problems.length) {
        records.push(blockedRecord({ caseId, title: script.meta.title, opts, profileName, envLabel, batchId, error: `[HỢP ĐỒNG KỊCH BẢN] ${script.meta.problems.join('; ')}` }));
        continue;
      }
      let profile;
      let storagePath;
      try {
        profile = getProfile(profileName);
        const browser = await phase('Khởi tạo Chrome (Playwright)', () => pool.get());
        storagePath = await phase(`Đăng nhập hồ sơ ${profileName}`, () => ensureProfileSession(browser, profile));
      } catch (err) {
        records.push(blockedRecord({ caseId, title: script.meta.title, opts, profileName, envLabel, batchId, error: err.message }));
        continue;
      }

      print('\n' + '-'.repeat(70));
      print(`[RUNNER] ▶ ${caseId} (${opts.mode === 'nhap' ? 'CHẠY NHÁP' : `Vòng test: LẦN ${opts.round}`}) · hồ sơ ${profile.name}`);
      print('-'.repeat(70));

      const runDir = path.join(RUNS_DIR, runDirName({ stamp: stamp(), caseId, mode: opts.mode, round: opts.round, profile: profile.name, pid: process.pid, attempt: 1 }));
      const browser = await pool.get();
      const record = await phase(`${caseId} · các bước kiểm thử`, () =>
        runCase({ browser, script, profile, storagePath, runDir, opts, runId: crypto.randomUUID(), batchId, envLabel, onEvent, print })
      );
      print(`[RUNNER] Kết quả test: ${record.verdict === 'DAT' ? '✅ PASS' : record.verdict === 'KHONG_DAT' ? '❌ FAIL' : `⚠ ${record.verdict}`}`);

      if (record.video.webm) {
        try {
          const out = await phase(`${caseId} · hậu kỳ video`, () =>
            renderCaseVideo({ runDir, mp4Name: `${caseId}_AutoRecord.mp4`, caseId, steps: record.steps, trimMs: record.trimMs, durationMs: record.durationMs })
          );
          record.video.mp4 = out.mp4;
          record.video.vtt = out.vtt;
          record.videoPath = out.mp4;
          fs.unlinkSync(record.video.webm);
          record.video.webm = null;
        } catch (err) {
          print(`[VIDEO] ⚠ Hậu kỳ hỏng, dùng bản webm gốc: ${err.message}`);
        }
        onEvent({ ev: 'case.video', caseId, mp4: record.videoPath });
      }

      if (opts.upload && record.videoPath && record.verdict !== 'DA_HUY') {
        try {
          record.videoUrl = await phase(`${caseId} · upload Catbox`, () =>
            uploadToCatbox(record.videoPath, `${caseId}_AutoRecord${path.extname(record.videoPath)}`)
          );
          record.video.url = record.videoUrl;
        } catch (err) {
          print(`[ERROR] Upload Catbox thất bại: ${err.message}`);
        }
      }

      record.sheet = await phase(`${caseId} · ghi Google Sheet`, () => writeSheetForRecord(record, { sheet, opts, print }));
      onEvent({ ev: 'case.sheet', caseId, state: record.sheet.state, cells: record.sheet.cells || null, reason: record.sheet.reason || null });
      writeRecord(record);
      records.push(record);
    }
  } finally {
    await pool.close();
  }
  const seconds = (Date.now() - t0) / 1000;
  onEvent({ ev: 'batch.finished', batchId, seconds, counts: countVerdicts(records) });
  return { records, timings, seconds, batchId };
}

function countVerdicts(records) {
  const out = { DAT: 0, KHONG_DAT: 0, LOI_HA_TANG: 0, DA_HUY: 0 };
  for (const r of records) out[r.verdict] = (out[r.verdict] || 0) + 1;
  return out;
}

/** Đăng nhập lại từ đầu cho hồ sơ (npm run test:auth) */
async function relogin(profileName, { headless = false } = {}) {
  const profile = getProfile(profileName);
  const pool = createBrowserPool({ headless });
  try {
    return await ensureProfileSession(await pool.get(), profile, { force: true });
  } finally {
    await pool.close();
  }
}

module.exports = { runBatch, relogin, countVerdicts, RUNS_DIR, stamp };
```

- [ ] **Step 4:** `node -e "require('./src/engine'); console.log('ok')"` → `ok`.

---

### Task 10: Runner CLI mỏng

**Files:** Modify `src/runner.js` (viết lại toàn bộ; bản trước đã chụp ở Task 0)

- [ ] **Step 1: Thay toàn bộ `src/runner.js`**

```js
#!/usr/bin/env node
// ============================================================================
// runner.js: CLI chạy test — lớp mỏng gọi engine v2 (src/engine/, Playwright).
//
//   npm test -- EVAL_021 --nhap                 chạy nháp: không upload, không ghi Sheet
//   npm test -- EVAL_021 EVAL_022 --round=3      chạy thật: video + Catbox + Sheet
//   Cờ khác: --video --headless --profile=<tên> --account=N --no-sheet --row=N
//            --case-timeout=<giây> --report-json=runs/<tên>.json --sheet-on=always|pass|never
//            --auth-only (đăng nhập lại hồ sơ)
//   Tương thích cũ: --no-record --no-sheet / --no-upload --no-sheet = chạy nháp.
// Chạy thật LUÔN quay + upload video (video là bằng chứng): --no-record hoặc --no-upload
// mà không kèm --no-sheet thì bị từ chối.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { runBatch, relogin } = require('./engine');
const { profileForAccount, NAME_RE } = require('./engine/profiles');
const { findScriptFile } = require('./engine/script_meta');

const KNOWN_FLAGS = [
  '--nhap', '--dry', '--video', '--headless', '--profile=<tên>', '--auth-only', '--no-record', '--no-upload',
  '--no-sheet', '--round=N', '--row=N', '--case-timeout=<giây>', '--account=N', '--report-json=<đường dẫn>',
  '--sheet-on=always|pass|never',
];
const CASE_ID_RE = /^EVAL_[A-Z0-9_]+$/;

function die(msg) {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
}

function positiveInt(arg, fallback) {
  const raw = arg.split('=')[1];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) die(`"${arg}" không hợp lệ — phải là số nguyên dương.`);
  return n;
}

function parseArgs(argv = process.argv.slice(2)) {
  const o = {
    caseIds: [], round: 1, row: null, record: true, upload: true, sheet: true, authOnly: false, dry: false,
    video: false, headless: false, profile: null, reportJson: null, sheetOn: 'always', caseTimeoutSec: null,
    account: config.ACCOUNT,
  };
  for (const arg of argv) {
    if (arg === '--auth-only') o.authOnly = true;
    else if (arg === '--nhap' || arg === '--dry') o.dry = true;
    else if (arg === '--video') o.video = true;
    else if (arg === '--headless') o.headless = true;
    else if (arg === '--no-record') o.record = false;
    else if (arg === '--no-upload') o.upload = false;
    else if (arg === '--no-sheet') o.sheet = false;
    else if (arg.startsWith('--round=')) o.round = positiveInt(arg, 1);
    else if (arg.startsWith('--row=')) o.row = positiveInt(arg, null);
    else if (arg.startsWith('--case-timeout=')) o.caseTimeoutSec = positiveInt(arg, 150);
    else if (arg.startsWith('--account=')) positiveInt(arg, 1); // config.js đã đọc; ở đây chỉ kiểm
    else if (arg.startsWith('--profile=')) {
      o.profile = arg.slice('--profile='.length).trim().toLowerCase();
      if (!NAME_RE.test(o.profile)) die(`"${arg}" không hợp lệ — tên hồ sơ chỉ gồm a-z, 0-9, _.`);
    } else if (arg.startsWith('--report-json=')) {
      const raw = arg.slice('--report-json='.length);
      if (!raw) die(`"${arg}" không hợp lệ — thiếu đường dẫn.`);
      const target = path.resolve(raw);
      const rel = path.relative(path.join(config.ROOT_DIR, 'runs'), target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) die(`"${arg}" không hợp lệ — phải nằm trong thư mục runs/ của repo.`);
      if (!target.toLowerCase().endsWith('.json')) die(`"${arg}" không hợp lệ — phải có đuôi .json.`);
      o.reportJson = target;
    } else if (arg.startsWith('--sheet-on=')) {
      o.sheetOn = arg.slice('--sheet-on='.length);
      if (!['always', 'pass', 'never'].includes(o.sheetOn)) die(`"${arg}" không hợp lệ — chỉ nhận always, pass hoặc never.`);
    } else if (arg.startsWith('--')) {
      die(`Cờ không hợp lệ: "${arg}"\n        Cờ hợp lệ: ${KNOWN_FLAGS.join('  ')}`);
    } else {
      const id = arg.toUpperCase();
      if (!CASE_ID_RE.test(id)) die(`"${arg}" không phải mã testcase hợp lệ (dạng đúng: EVAL_017, EVAL_V1_045).`);
      o.caseIds.push(id);
    }
  }
  o.caseIds = [...new Set(o.caseIds)];

  // Chế độ chạy
  const noSheet = !o.sheet || o.sheetOn === 'never';
  if (o.dry || (noSheet && (!o.upload || !o.record))) {
    o.mode = 'nhap';
    if (o.dry) o.record = o.video;
    o.upload = false;
    o.sheet = false;
  } else {
    o.mode = 'that';
    if (!o.record || !o.upload) {
      die('Chạy thật luôn quay và upload video (video là bằng chứng). Muốn chạy không video thì dùng --nhap.');
    }
  }
  if (!o.profile && config.ACCOUNT > 1) o.profile = profileForAccount(config.ACCOUNT);
  return o;
}

function printSummary(records, seconds, timings) {
  console.log('\n' + '='.repeat(70));
  console.log('                          BÁO CÁO KẾT QUẢ                          ');
  console.log('='.repeat(70));
  for (const r of records) {
    const label = { DAT: 'PASS (ĐẠT)', KHONG_DAT: 'FAIL (KHÔNG ĐẠT)', LOI_HA_TANG: 'LỖI HẠ TẦNG', DA_HUY: 'ĐÃ HUỶ' }[r.verdict] || r.verdict;
    console.log(`\n▸ ${r.testcaseId}  —  ${label}  (${(r.seconds || 0).toFixed(1)}s) · hồ sơ ${r.profile}`);
    console.log(`   Chi tiết     : ${r.resultText}`);
    if (r.diagnosis) console.log(`   Chẩn đoán    : ${r.diagnosis.kind}`);
    console.log(`   Video        : ${r.videoUrl || (r.videoPath ? path.relative(config.ROOT_DIR, r.videoPath) : 'không quay')}`);
    const sh = r.sheet || {};
    console.log(
      `   Google Sheet : ${
        sh.state === 'written'
          ? `đã ghi ${Object.values(sh.cells || {}).join(', ') || r.sheetCell}` + (r.sheetStatus ? ` | Trạng thái = "${r.sheetStatus}"` : '')
          : sh.state === 'pending'
          ? `CHỜ DUYỆT — ${sh.reason}`
          : sh.state === 'failed'
          ? `KHÔNG GHI ĐƯỢC — ${sh.reason}`
          : `chưa ghi — ${sh.reason || 'không rõ lý do'}`
      }`
    );
    if (r.failReport) console.log(`   Báo cáo lỗi  : ${path.relative(config.ROOT_DIR, r.failReport)}`);
    if (r.trace) console.log(`   Trace        : ${path.relative(config.ROOT_DIR, r.trace)}`);
    if (r.runDir) console.log(`   Thư mục run  : ${path.relative(config.ROOT_DIR, r.runDir)}`);
  }
  const passed = records.filter((r) => r.verdict === 'DAT').length;
  console.log('\n' + '-'.repeat(70));
  console.log(`  Tổng: ${records.length} case | PASS ${passed} | KHÔNG ĐẠT/LỖI ${records.length - passed}`);
  console.log(`  Tổng thời gian: ${seconds.toFixed(1)} giây`);
  console.log('-'.repeat(70));
  console.log('  Thời gian từng chặng:');
  timings.forEach((t) => console.log(`   - ${t.label.padEnd(38)} ${t.seconds.toFixed(1)}s`));
  console.log('='.repeat(70) + '\n');
}

async function main() {
  const o = parseArgs();
  console.log('='.repeat(70));
  console.log('        FASTDO TEST AUTOMATION RUNNER — ENGINE V2 (PLAYWRIGHT)        ');
  console.log('='.repeat(70));

  if (o.authOnly) {
    const name = o.profile || 'default';
    const file = await relogin(name, { headless: o.headless });
    console.log(`[RUNNER] Đã đăng nhập lại hồ sơ "${name}" — phiên lưu ở ${path.relative(config.ROOT_DIR, file)}`);
    return;
  }

  if (!o.caseIds.length) {
    console.error('[ERROR] Vui lòng truyền mã testcase cần chạy! Ví dụ: npm test -- EVAL_021 --nhap');
    process.exitCode = 1;
    return;
  }
  const missing = o.caseIds.filter((id) => !findScriptFile(id));
  if (missing.length) {
    console.error(`[ERROR] Chưa có kịch bản cho: ${missing.join(', ')}`);
    fs.readdirSync(path.join(__dirname, 'testcases')).filter((f) => f.endsWith('.test.js'))
      .forEach((f) => console.error(`          - ${f.replace('.test.js', '').toUpperCase()}`));
    process.exitCode = 1;
    return;
  }
  try {
    config.assertReady();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let out;
  try {
    out = await runBatch(o);
  } catch (err) {
    console.error(`\n[FATAL ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  printSummary(out.records, out.seconds, out.timings);

  if (o.reportJson) {
    fs.mkdirSync(path.dirname(o.reportJson), { recursive: true });
    fs.writeFileSync(o.reportJson, JSON.stringify({
      startedAt: new Date(Date.now() - out.seconds * 1000).toISOString(), finishedAt: new Date().toISOString(),
      batchId: out.batchId, account: config.ACCOUNT, targetUrl: config.TARGET_URL, sheetId: config.SHEET_ID,
      sheetGid: config.SHEET_GID, mode: o.mode, round: o.round,
      flags: { record: o.record, upload: o.upload, sheet: o.sheet, row: o.row }, cases: out.records,
    }, null, 2), 'utf8');
    console.log(`  Bản kê JSON  : ${path.relative(config.ROOT_DIR, o.reportJson)}`);
  }

  const pending = out.records.filter((r) => r.sheet && r.sheet.state === 'pending');
  pending.forEach((r) => console.log(`  ⏸ chờ duyệt: npm run commit -- ${path.relative(config.ROOT_DIR, r.runDir)}`));
  const writeFailed = out.records.filter((r) => r.sheet && r.sheet.state === 'failed');
  if (out.records.some((r) => r.verdict !== 'DAT') || writeFailed.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseArgs };
```

- [ ] **Step 2: Test cờ** — `src/engine/runner_args.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('../runner');

test('--nhap = không upload, không ghi Sheet, không quay (trừ khi --video)', () => {
  const o = parseArgs(['EVAL_021', '--nhap']);
  assert.deepStrictEqual([o.mode, o.record, o.upload, o.sheet], ['nhap', false, false, false]);
  assert.strictEqual(parseArgs(['EVAL_021', '--nhap', '--video']).record, true);
});

test('tương thích cũ: --no-record --no-sheet là chạy nháp', () => {
  assert.strictEqual(parseArgs(['EVAL_021', '--no-record', '--no-sheet']).mode, 'nhap');
  const o = parseArgs(['EVAL_021', '--no-upload', '--no-sheet']);
  assert.deepStrictEqual([o.mode, o.record], ['nhap', true]);
});

test('mặc định là chạy thật, đủ video + upload + Sheet', () => {
  const o = parseArgs(['eval_021', '--round=3']);
  assert.deepStrictEqual([o.mode, o.record, o.upload, o.sheet, o.round, o.caseIds[0]], ['that', true, true, true, 3, 'EVAL_021']);
});
```

(Test chỉ gọi các tổ hợp hợp lệ — nhánh `die()` thoát tiến trình nên kiểm bằng tay ở Step 3.)

- [ ] **Step 3: Kiểm tay**

Run: `node src/runner.js EVAL_021 --no-record` → `[ERROR] Chạy thật luôn quay và upload video…`
Run: `node src/runner.js --nosheet EVAL_021` → `[ERROR] Cờ không hợp lệ: "--nosheet"`
Run: `node --test src/engine/runner_args.test.js` → PASS.

---

### Task 11: Port 8 kịch bản

**Files:** Modify `src/testcases/eval_017|019|020|021|022|023|024|037.test.js`

Quy tắc chung cho mọi file: thêm khai báo ngay dưới `targetPath`; thêm `mark` vào dòng `const { … } = ctx;`; chèn `mark('Bn …')` ngay trên mỗi khối `// Bước n` (không đổi dòng nào khác trong khối).

- [ ] **Step 1: EVAL_017** — khai báo `profile: 'default', parallel: true, timeoutSec: 150,`; trong `waitFor`: `page.waitForFunction(fn, arg, { timeout, polling: 200 })`; 3 lời gọi `page.waitForFunction(fn, {…}[, arg])` → `page.waitForFunction(fn, DRAFT_TEMPLATE_NAME, { timeout: 25000, polling: 200 })` (lời gọi đầu) và `page.waitForFunction(fn, null, { timeout: 25000, polling: 200 })` (2 lời gọi sau); `const { page, click, type, waitXPath, mark } = ctx;`; mark: `B0 Mở danh sách Mẫu đánh giá` · `B1 Mở mẫu Nháp ở chế độ Sửa` · `B2 Chuẩn hoá: 1 nhóm hợp lệ + 1 nhóm rỗng` · `B3 Bấm Kích hoạt` · `B4 Kiểm text thô group.ErrorSummary` · `B5 Reload — mẫu vẫn Nháp` · `B6 Dọn dẹp nhóm rỗng + Lưu nháp`.
- [ ] **Step 2: EVAL_019** — `profile: 'default', parallel: true,`; mark: `B1 Mở mẫu Nháp ở chế độ Sửa` · `B2 Chuẩn hoá: bỏ nhóm rỗng` · `B3 Điền Trọng số nhóm = 0` · `B4 Bấm Kích hoạt` · `B5 Reload — mẫu vẫn Nháp` · `B6 Dọn dẹp: trả trọng số cũ`.
- [ ] **Step 3: EVAL_020** — `profile: 'default', parallel: true,`; mark: `B1 Mở mẫu Nháp ở chế độ Sửa` · `B2 Tìm nhóm đã có tiêu chí` · `B3 Mở "Chọn tiêu chí" của chính nhóm đó` · `B4 Mẫu vẫn Nháp`.
- [ ] **Step 4: EVAL_021** — `profile: 'default', parallel: true, consumes: [\`mau:${DRAFT_TEMPLATE_NAME}\`],`; mark: `B1 Mở mẫu Nháp ở chế độ Sửa` · `B2 Chuẩn hoá mẫu hợp lệ` · `B3 Bấm Kích hoạt` · `B4 Reload — banner chỉ xem, ẩn thao tác sửa` · `B5 Đối chiếu danh sách: "Đang dùng"`.
- [ ] **Step 5: EVAL_022** — như EVAL_021 (`consumes` theo `DRAFT_TEMPLATE_NAME`); mark: `B1 Mở mẫu Nháp ở chế độ Sửa` · `B2 Chuẩn hoá: bỏ nhóm rỗng` · `B3 Ép tổng trọng số khác 100` · `B4 Bấm Kích hoạt` · `B5 Reload + đối chiếu danh sách`.
- [ ] **Step 6: EVAL_023** — `profile: 'default', parallel: true,`; lời gọi `page.evaluate((createLabel, blockedSrc) => { … }, s.createLabel, BLOCKED_PATTERN.source)` → `page.evaluate(([createLabel, blockedSrc]) => { … }, [s.createLabel, BLOCKED_PATTERN.source])`; mark: `B1 Tab Kỳ đánh giá` · rồi trong vòng lặp `mark(\`B2 Thiết lập > ${s.label}\`)`.
- [ ] **Step 7: EVAL_024** — `profile: 'default', parallel: true,`; mark: `B1 Mở module Đánh giá nhân sự` · `B2 Đọc các mục sidebar`.
- [ ] **Step 8: EVAL_037** — `profile: 'default', parallel: true, consumes: ['phieu:DRYRUN040'],`; trong `scoreCriterion`: `(gi, val) => {` → `([gi, val]) => {` và `groupIndex,\n    score` → `[groupIndex, score]`; đổi nhãn 7 `step(...)` sang tiếng Việt có dấu, có số bước: `B1 Mở danh sách Đánh giá của tôi` · `B2 Mở phiếu "${TARGET_ASSIGNMENT_NAME}" Chưa bắt đầu` · `B3 Vào trang chi tiết phiếu (URL + form đã render)` · `B4 Chấm điểm ${totalCriteria} tiêu chí (mức ${SCORE_TO_SET}/5) + nhận xét` · `B5 Bấm Lưu nháp` · `B6 Quay lại danh sách, đọc lại trạng thái` · `B7 Tải lại chính phiếu vừa lưu, kiểm dữ liệu còn nguyên`.
- [ ] **Step 9: Kiểm khai báo 8 file**

Run: `node -e "const M=require('./src/engine/script_meta'); for (const id of ['EVAL_017','EVAL_019','EVAL_020','EVAL_021','EVAL_022','EVAL_023','EVAL_024','EVAL_037']) { const s=M.loadScript(id); console.log(id, s.meta.parallel, JSON.stringify(s.meta.resources), JSON.stringify(s.meta.consumes), s.meta.problems.join(';')||'OK') }"`
Expected: 8 dòng `OK`; 017/019/020 khoá `mau:EVAL_QA - Mau test nhom - Bản sao`; 021/022 khoá + tiêu hao `mau:Mẫu đánh giá Thực tập sinh - Bản sao`; 037 `phieu:DRYRUN040`.

Run: `node "C:/…/scratchpad/scan_eval.js" src/testcases src/core src/tools` (bộ dò `evaluate` nhiều tham số) → không còn dòng nào ngoài `dom_digest.js` (`document.evaluate` của DOM, không phải Playwright).

---

### Task 12: Tool mở trình duyệt

**Files:** Modify `src/tools/plan.js`, `preflight.js`, `probe.js`, `setups/cycle-view.js`, `.claude/skills/fastdo-eval-runner/scripts/smoke_test.js`

- [ ] **Step 1: `plan.js` và `preflight.js`** — bỏ require `initBrowser`, `ensureAuthenticated`; thêm:

```js
const { createBrowserPool } = require('../engine/browser_pool');
const { openAppPage } = require('../engine/app_session');
const { getProfile, profileForAccount } = require('../engine/profiles');
```

thay `instance = await initBrowser(); const { page } = instance; await ensureAuthenticated(page);` bằng:

```js
    pool = createBrowserPool({ headless: true });
    instance = await openAppPage(await pool.get(), getProfile(profileForAccount(config.ACCOUNT)));
    const { page } = instance;
```

(khai báo `let pool = null;` cạnh `let instance = null;`), và trong `finally` thay `await instance.close()` bằng `if (instance) await instance.close(); if (pool) await pool.close();`. Dòng `await page.goto(config.TARGET_URL …)` + `waitForSettle` giữ nguyên.

- [ ] **Step 2: `probe.js`** — cùng thay thế như Step 1, `headless: !opts.keepOpen && !opts.show` (thêm cờ `--show`); `ctx` của setup dựng bằng `createCtx({ page, context: instance.context, browser: await pool.get(), profile, signal: null, stepLog: createStepLog({ print: () => {} }), runDir: DIAGNOSTICS_DIR, caseId: 'PROBE' })` (require `createCtx`, `createStepLog`, `DIAGNOSTICS_DIR` từ `dom_digest`); `--keep-open`: truyền `extraArgs: [\`--remote-debugging-port=${config.CDP_PORT}\`]` vào pool, in `[PROBE] Chrome giữ mở ở cổng ${config.CDP_PORT} — Ctrl+C để đóng.` rồi `await new Promise(() => {})` (chờ Ctrl+C), không đóng; nhánh watchdog giữ nguyên nhưng gọi `pool.close()`.

- [ ] **Step 3: `setups/cycle-view.js`** — `page.evaluate((el, lbl) => { … }, selEl, STATUS)` → `page.evaluate(([el, lbl]) => { … }, [selEl, STATUS])`.

- [ ] **Step 4: `smoke_test.js`** — viết lại:

```js
// ============================================================================
// smoke_test.js: Thử đường ống quay video (Playwright) + phụ đề + upload Catbox, KHÔNG đụng app.
//
//   npm run smoke-test                    quay example.com 2s → mp4 có phụ đề → upload
//   npm run smoke-test -- --no-upload     chỉ kiểm quay + hậu kỳ, không upload
// OK = Chrome, ffmpeg của Playwright, ffmpeg hệ thống (libass) và Catbox đều sống.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..', '..');
const { uploadToCatbox } = require(path.join(ROOT_DIR, 'src', 'core', 'catbox'));
const { CURSOR_CSS_AND_JS } = require(path.join(ROOT_DIR, 'src', 'core', 'cursor_motion'));
const { createBrowserPool } = require(path.join(ROOT_DIR, 'src', 'engine', 'browser_pool'));
const { renderCaseVideo } = require(path.join(ROOT_DIR, 'src', 'engine', 'video_post'));
const { VIEWPORT } = require(path.join(ROOT_DIR, 'src', 'engine', 'app_session'));

async function main() {
  const noUpload = process.argv.includes('--no-upload');
  const dir = path.join(ROOT_DIR, 'runs', `smoke-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const pool = createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir, size: VIEWPORT } });
    await context.addInitScript({ content: CURSOR_CSS_AND_JS });
    const page = await context.newPage();
    const t0 = Date.now();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.mouse.move(400, 300, { steps: 10 });
    await new Promise((r) => setTimeout(r, 2000));
    const video = page.video();
    await context.close();
    const raw = await video.path();
    fs.renameSync(raw, path.join(dir, 'video.webm'));
    const out = await renderCaseVideo({
      runDir: dir, mp4Name: 'smoke_test.mp4', caseId: 'SMOKE',
      steps: [{ label: 'B1 Mở example.com', startMs: 0, endMs: Date.now() - t0, ok: true }], trimMs: 0, durationMs: Date.now() - t0,
    });
    const size = fs.statSync(out.mp4).size;
    console.log('STEP: mp4 có phụ đề ->', out.mp4, `(${size} bytes)`);
    if (size < 5000) throw new Error('File video quá nhỏ, có thể quay lỗi');
    if (noUpload) {
      console.log('SMOKE_TEST_RESULT: OK (không upload), video =', out.mp4);
      return;
    }
    const url = await uploadToCatbox(out.mp4, 'smoke_test.mp4');
    console.log('SMOKE_TEST_RESULT: OK, video url =', url);
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error('SMOKE_TEST_RESULT: FAIL -', e.message);
  process.exit(1);
});
```

- [ ] **Step 5:** `node --check` 5 file → exit 0.

---

### Task 13: Tích hợp Playwright thật (không cần Fastdo)

**Files:** Create `src/engine/integration/engine.itest.js`

- [ ] **Step 1: Viết test** — dựng server HTML cục bộ TRƯỚC khi nạp config (dotenv không đè biến đã có), 5 kịch bản giả trong bộ nhớ, chạy qua `runCase` thật:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fastdo giả</title></head><body>
<nav id="navbar-overall-need-to-guidelines"><ul><li><a href="#">Kỳ đánh giá</a></li></ul></nav>
<h1>Trang thử</h1><button id="go" onclick="document.getElementById('out').textContent='Đã bấm'">Bấm thử</button>
<div id="out"></div></body></html>`;

let server;
let base;
let engine;

test.before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  process.env.TARGET_URL = base; // PHẢI đặt trước khi nạp config
  engine = {
    ...require('../case_runner'),
    ...require('../browser_pool'),
    ...require('../video_post'),
  };
});

test.after(() => server && server.close());

const profile = { name: 'default', org: 'Tổ chức giả' };
const script = (id, run, extra = {}) => ({ meta: { id, title: id, timeoutSec: 20, ...extra }, module: { run }, hash: 'itest' });
const tmpRun = (id) => fs.mkdtempSync(path.join(os.tmpdir(), `fe2-${id}-`));

async function runOne(browser, sc, opts = {}, signal) {
  return engine.runCase({
    browser, script: sc, profile, storagePath: null, runDir: tmpRun(sc.meta.id),
    opts: { mode: 'nhap', record: true, trace: true, ...opts }, runId: 'itest-0001', signal, print: () => {},
  });
}

const PASS = script('EVAL_IT_PASS', async (ctx) => {
  ctx.mark('B1 Mở trang thử');
  await ctx.page.goto(base, { waitUntil: 'domcontentloaded' });
  ctx.mark('B2 Bấm nút qua XPath tương đối');
  await ctx.click(null, './/button[contains(., "Bấm thử")]');
  const text = await ctx.page.$eval('#out', (e) => e.textContent);
  ctx.check('Chữ sau khi bấm', text === 'Đã bấm', { expected: 'Đã bấm', actual: text });
  return { pass: text === 'Đã bấm', resultText: 'ok' };
});

test('3 case chạy ĐỒNG THỜI trên 3 context: video riêng, ĐẠT bỏ trace, KHÔNG ĐẠT giữ trace + báo cáo', async () => {
  const pool = engine.createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const FAIL = script('EVAL_IT_FAIL', async (ctx) => { ctx.mark('B1 Kết luận không đạt'); return { pass: false, resultText: 'sai' }; });
    const [a, b, c] = await Promise.all([runOne(browser, PASS), runOne(browser, FAIL), runOne(browser, { ...PASS, meta: { ...PASS.meta, id: 'EVAL_IT_PASS2' } })]);
    assert.deepStrictEqual([a.verdict, b.verdict, c.verdict], ['DAT', 'KHONG_DAT', 'DAT']);
    for (const r of [a, b, c]) assert.ok(r.video.webm && fs.statSync(r.video.webm).size > 1000, `video ${r.testcaseId}`);
    assert.strictEqual(a.trace, null);
    assert.ok(b.trace && fs.existsSync(b.trace));
    assert.ok(b.failReport && fs.existsSync(b.failReport));
    assert.deepStrictEqual(a.steps.map((s) => [s.label, s.ok]), [['B1 Mở trang thử', true], ['B2 Bấm nút qua XPath tương đối', true]]);
    assert.ok(a.trimMs >= 0);

    const out = await engine.renderCaseVideo({ runDir: a.runDir, mp4Name: 'EVAL_IT_PASS_AutoRecord.mp4', caseId: a.testcaseId, steps: a.steps, trimMs: a.trimMs, durationMs: a.durationMs });
    assert.ok(fs.statSync(out.mp4).size > 5000);
    assert.match(fs.readFileSync(out.vtt, 'utf8'), /EVAL_IT_PASS · B2 Bấm nút qua XPath tương đối/);
  } finally {
    await pool.close();
  }
});

test('watchdog: case treo bị đóng context đúng hạn → LỖI HẠ TẦNG "HẾT HẠN CHỜ", có trace', async () => {
  const pool = engine.createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const HANG = script('EVAL_IT_HANG', async (ctx) => { ctx.mark('B1 Treo'); await new Promise(() => {}); }, { timeoutSec: 10 });
    const t0 = Date.now();
    const r = await runOne(browser, HANG);
    assert.ok(Date.now() - t0 < 60000);
    assert.strictEqual(r.verdict, 'LOI_HA_TANG');
    assert.strictEqual(r.diagnosis.kind, 'HẾT HẠN CHỜ');
    assert.ok(r.trace);
  } finally {
    await pool.close();
  }
});

test('huỷ giữa chừng → ĐÃ HUỶ, không báo cáo lỗi', async () => {
  const pool = engine.createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const ac = new AbortController();
    const SLOW = script('EVAL_IT_SLOW', async (ctx) => { ctx.mark('B1 Chờ lâu'); await ctx.page.waitForTimeout(15000); return { pass: true }; });
    setTimeout(() => ac.abort(), 3000);
    const r = await runOne(browser, SLOW, {}, ac.signal);
    assert.strictEqual(r.verdict, 'DA_HUY');
    assert.strictEqual(r.failReport, null);
  } finally {
    await pool.close();
  }
});

test('cú pháp Puppeteer (evaluate 2 tham số) → HỢP ĐỒNG KỊCH BẢN, không thành kết quả kiểm thử', async () => {
  const pool = engine.createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const BAD = script('EVAL_IT_BAD', async (ctx) => { await ctx.page.evaluate((a, b) => a + b, 1, 2); return { pass: true }; });
    const r = await runOne(browser, BAD, { record: false });
    assert.strictEqual(r.verdict, 'LOI_HA_TANG');
    assert.strictEqual(r.diagnosis.kind, 'HỢP ĐỒNG KỊCH BẢN');
  } finally {
    await pool.close();
  }
});

test('pass = true mà có phép kiểm ✗ → HỢP ĐỒNG KỊCH BẢN', async () => {
  const pool = engine.createBrowserPool({ headless: true });
  try {
    const browser = await pool.get();
    const LIE = script('EVAL_IT_LIE', async (ctx) => { ctx.check('điều kiện', false); return { pass: true }; });
    const r = await runOne(browser, LIE, { record: false });
    assert.strictEqual(r.diagnosis.kind, 'HỢP ĐỒNG KỊCH BẢN');
  } finally {
    await pool.close();
  }
});
```

- [ ] **Step 2:** Run `npm run test:engine` → PASS (≈ 1–2 phút).

---

### Task 14: Kiểm thử toàn bộ + tài liệu nhanh

- [ ] **Step 1:** `npm run test:unit` → PASS.
- [ ] **Step 2:** `npm run test:engine` → PASS.
- [ ] **Step 3:** `npm run smoke-test -- --no-upload` → `SMOKE_TEST_RESULT: OK (không upload)` (Chrome + ffmpeg thật trên example.com).
- [ ] **Step 4:** Mở `runs/smoke-*/smoke_test.mp4` bằng `ffprobe -v error -show_entries stream=width,height -of csv=p=0 <mp4>` → `1280,780`.
- [ ] **Step 5:** Khi dev tunnel sống (`curl -s -o /dev/null -w "%{http_code}" $TARGET_URL` = 200): `npm test -- EVAL_024 EVAL_023 --nhap --video` → cả 2 chạy hết không LỖI HẠ TẦNG; so kết luận với lần chạy engine cũ gần nhất trong `runs/`. Tunnel tắt thì ghi rõ "chưa kiểm với app thật".
- [ ] **Step 6:** `node src/runner.js --auth-only --headless` khi tunnel sống → `.auth/default.json` được tạo.

---

## Tự rà

- Phủ spec kỳ 2: Playwright + Chrome đã cài (T0, T4), mỗi case 1 context + phiên hồ sơ + video + trace (T4, T9), hồ sơ tài khoản (T2), đăng nhập 1 lần/hồ sơ có khoá tự nhiên (T4), ctx v2 giữ chữ ký cũ + step/mark/check/signal (T5), hợp đồng kịch bản (T9), watchdog đóng context + huỷ (T9, T13), phụ đề dưới khung + VTT + cắt phần khởi động (T6, T13), trace chỉ giữ khi không ĐẠT (T9, T13), 3 hạng chẩn đoán mới (T8), result.json v2 giữ trường v1 (T7), port helper (T3) + 8 kịch bản (T11) + tool (T12), mã cũ giữ nguyên (T3.5). Thêm so với spec: `page_guard` (T1) chặn cú pháp Puppeteer.
- Để sang kỳ 3: song song N luồng + khoá, chốt quy trình (vòng bắt buộc, kịch bản đã kiểm chứng), sổ đã kiểm chứng, duyệt theo nguyên nhân, tự chạy lại lỗi hạ tầng, sự kiện ra stdout + events.ndjson, điều khiển stdin.

## Prompt gốc của user liên quan kế hoạch này

> D:\FastDo\TEstAuto-Gian\fEvaluation, Tôi đang muốn update Tool này để test automation, chạy mượt, có thể chạy cùng lúc nhiều test case, viết đánh giá trong Sheet, và kèm quay video. Hãy dựa vào src code mà update tiên tiến hơn, mạnh hơn, UI/UX tốt hơn, dủng react làm giao diện cho tôi. Tuyệt đối đảm bảo việc test luốn chạy đúng quy trình, bạn có thể đề xuất thêm các Tính năng update hoặc thay thế đẻ cải thiện tốt hơn, UI có người là Tester dễ hiểu dễ dùng

> hãy tự động chạy từ đầu đến cuối cho tôi, cho đến khi có kết quả cuối cùng, tự động duyệt hết

> tiếp tục chạy cho tôi
