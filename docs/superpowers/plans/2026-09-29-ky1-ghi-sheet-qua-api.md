# Kỳ 1 — Ghi Sheet qua Google Sheets API: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay đường ghi Google Sheet bằng giả lập gõ phím bằng Google Sheets API (service account), chọn tab theo gid, ghi đủ 4 cột (Trạng thái, Kết quả thực hiện có cấu trúc, Môi trường, Test Date) mà giữ nguyên link rich-text cũ, có nhật ký + hoàn tác — chạy được ngay trên runner Puppeteer hiện tại.

**Architecture:** Thư mục mới `src/sheets/` (client REST + chọn tab + bộ ghi + nhật ký) dựng trên `src/core/sheet_grid.js` (vẫn là nguồn duy nhất hiểu bố cục, thêm tìm cột theo nhãn). `src/engine/result_text.js` dựng nội dung ô Kết quả. Runner cũ, `commit`, `plan`, `preflight`, `case`, `sheet:dump` chuyển sang đọc/ghi qua API; không còn tab Google Sheets trong Chrome. Mã gõ phím cũ (`core/sheet_service.js`) giữ nguyên file, không còn được gọi.

**Tech Stack:** Node 22 (CommonJS), `google-auth-library@10.5.0` (JWT service account), `node-fetch` sẵn có không cần thêm, test bằng `node --test`.

Spec: `docs/superpowers/specs/2026-09-25-engine-v2-chay-song-song-design.md` (mục 5, 6.2, 11, 13, 14 — kỳ 1).

---

## Ràng buộc bắt buộc — đọc trước khi làm

- **Không** `git commit`, không tạo nhánh, không worktree (user tự commit).
- **Không ghi** vào tab `V1 - fEvaluation - VIBE ` hay `fEvaluation - VIBE - HUY`. Ghi thật duy nhất được phép là `npm run sheet:selftest` (Task 14) — ghi vào tab ẩn tạm rồi xoá.
- **Không xoá mã cũ**: `core/sheet_service.js`, `core/browser.js`, `core/session.js`, `core/recorder.js` giữ nguyên.
- **Không sửa `.env`**, trừ Task 13 (thêm 2 dòng, có sao lưu).
- Comment, thông điệp tiếng Việt như code hiện có. Chạy mọi lệnh ở `D:\FastDo\TEstAuto-Gian\fEvaluation`.
- Mốc hiện tại: `npm run test:unit` → 31/31 đạt.

## Sự thật đã kiểm trên Sheet thật (2026-09-28, chỉ đọc)

| Điều | Giá trị |
|---|---|
| Tab V1 | `V1 - fEvaluation - VIBE ` (có dấu cách cuối), gid `1086276772` |
| Tab HUY | `fEvaluation - VIBE - HUY`, gid `286718788` |
| Bố cục V1 | 3 dòng tiêu đề; vòng 1–5 rộng 7 cột, vòng 6+ rộng 6 cột; vòng 1: `FEEDBACK AI` thay `DEV /QC NOTE`; nhãn có dấu cách đầu (`" Môi trường"`) |
| Ô Kết quả | rich-text, `textFormatRuns` có link |
| Ô Test Date | `numberValue` (L4 = 46280 = 15/09/2026), định dạng `DATE dd/mm/yyyy` |
| Trạng thái | danh sách chọn strict: `DONE, Fail, Doing, Cancel, Pending, Đề xuất` |
| Môi trường | danh sách chọn strict: `Beta, Localhost, Production` |
| Quyền | service account `sheets-editor@test-qc-506106…` có `canEdit=true` (Drive API) |
| Tạo Sheet riêng | service account bị 403 → kiểm ghi thật bằng tab ẩn tạm |

## Bản đồ file

| File | Trách nhiệm | Task |
|---|---|---|
| `package.json` | thêm `google-auth-library`, script mới | 1 |
| `src/config.js` | `SHEET_GID`, `GOOGLE_SA_KEY_FILE`, `ENV_LABELS`, `QC_NAME`, `PROFILE_NAME`, `invalidConfig()` | 1 |
| `.env.example` | tài liệu biến mới | 1 |
| `src/core/sheet_grid.js` (+ test) | `colLetter`, `roundBlock`, `findRoundColumnsByLabel`, `findRowIndices`; `roundsOfCase` theo nhãn | 2 |
| `src/sheets/a1.js` (+ test) | `quoteTab`, `cellRange`, `a1Of`, `showSpaces` | 3 |
| `src/sheets/env_label.js` (+ test) | host → nhãn Môi trường | 3 |
| `src/engine/result_text.js` (+ test) | ngày, `runTag`, nội dung ô Kết quả | 3 |
| `src/sheets/tab.js` (+ test) | chọn tab theo gid / tên chính xác | 4 |
| `src/sheets/sheets_client.js` (+ test) | REST: `getMeta`, `readGrid`, `readCells`, `batchUpdate`, `canEdit`, thử lại 429/5xx | 4 |
| `src/sheets/cell_values.js` (+ test) | danh sách chọn, nối ô Kết quả giữ link, so giá trị, bản chụp ô | 5 |
| `src/sheets/testkit.js` | Sheet giả lập + dữ liệu mẫu cho test (không phải file test) | 5 |
| `src/sheets/sheet_writer.js` (+ test) | các chốt `[AN TOÀN]`, ghi 4 ô, đọc lại, chống ghi trùng, hàng đợi | 6 |
| `src/sheets/audit.js` (+ test) | nhật ký NDJSON + hoàn tác | 7 |
| `src/sheets/index.js` | `openSheet()`, `AUDIT_PATH` | 8 |
| `src/runner.js` | ghi qua API, bỏ tab Sheet trong Chrome | 9 |
| `src/tools/commit-result.js` | duyệt + ghi qua API, không mở Chrome | 10 |
| `src/tools/{case-info,sheet-dump,plan,preflight}.js` | đọc Sheet qua API | 11 |
| `src/tools/{sheet-tabs,undo,sheet-selftest}.js` | tool mới | 12 |
| `src/tools/ui/server.js`, `index.html` | biến mới, dán link tự lấy gid | 12 |
| `.env` | thêm `GOOGLE_SA_KEY_FILE`, `SHEET_GID` (có sao lưu) | 13 |

---

### Task 1: Phụ thuộc, script, biến cấu hình

**Files:**
- Modify: `package.json`
- Modify: `src/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Cài gói**

```bash
npm install google-auth-library@10.5.0 --save-exact
```

Expected: `package.json` có `"google-auth-library": "10.5.0"` trong `dependencies`.

- [ ] **Step 2: Sửa `scripts` trong `package.json`** — thay đúng các dòng sau (giữ nguyên các script khác):

```json
    "test:unit": "node --test src/core/*.test.js src/sheets/*.test.js src/engine/*.test.js",
    "sheet:dump": "node src/tools/sheet-dump.js",
    "sheet:tabs": "node src/tools/sheet-tabs.js",
    "sheet:selftest": "node src/tools/sheet-selftest.js",
    "commit": "node src/tools/commit-result.js",
    "undo": "node src/tools/undo.js",
```

- [ ] **Step 3: `src/config.js` — thêm `fs`** ở dòng đầu:

```js
const fs = require('fs');
const path = require('path');
```

- [ ] **Step 4: `src/config.js` — biến Sheet mới**, thêm ngay sau dòng `const SHEET_TAB = process.env.SHEET_TAB || '';`:

```js
// Engine v2 — Google Sheets API. Tab chọn theo SHEET_GID (số sau "gid=" trên link
// Sheet): không phụ thuộc tên tab, dấu cách cuối tên hay thứ tự tab. Chỉ có SHEET_TAB
// thì tên phải khớp CHÍNH XÁC (src/sheets/tab.js) — không còn lùi về tab đầu như gviz.
const SHEET_GID = (process.env.SHEET_GID || '').trim();
// File JSON key của service account. Đường dẫn tương đối tính từ gốc repo.
const GOOGLE_SA_KEY_FILE = (process.env.GOOGLE_SA_KEY_FILE || '').trim()
  ? path.resolve(ROOT_DIR, process.env.GOOGLE_SA_KEY_FILE.trim())
  : '';
```

- [ ] **Step 5: `src/config.js` — thay mảng `REQUIRED_ENV`** bằng:

```js
const REQUIRED_ENV = [
  [`FASTDO_EMAIL${SUFFIX}`, EMAIL],
  [`FASTDO_PASSWORD${SUFFIX}`, PASSWORD],
  ['CATBOX_USERHASH', CATBOX_USERHASH],
  ['TARGET_URL', TARGET_URL],
  ['SHEET_ID', SHEET_ID],
  // Một trong hai là đủ; có cả hai thì SHEET_GID thắng.
  ['SHEET_GID (hoặc SHEET_TAB)', SHEET_GID || SHEET_TAB],
  ['GOOGLE_SA_KEY_FILE', GOOGLE_SA_KEY_FILE],
];
```

- [ ] **Step 6: `src/config.js` — thay hàm `assertReady`** (giữ nguyên comment phía trên nó) bằng:

```js
/**
 * Giá trị CÓ nhưng SAI — khác với "thiếu", nên tách riêng để plan/preflight báo đúng.
 */
function invalidConfig() {
  const out = [];
  if (SHEET_GID && !/^\d+$/.test(SHEET_GID)) {
    out.push(`SHEET_GID="${SHEET_GID}" phải là số (số sau "gid=" trên link Sheet)`);
  }
  if (GOOGLE_SA_KEY_FILE && !fs.existsSync(GOOGLE_SA_KEY_FILE)) {
    out.push(`GOOGLE_SA_KEY_FILE trỏ tới file không tồn tại: ${GOOGLE_SA_KEY_FILE}`);
  }
  try {
    // Nạp muộn: env_label.js là hàm thuần, không phụ thuộc ngược lại config.
    require('./sheets/env_label').parseEnvLabels(process.env.ENV_LABELS);
  } catch (err) {
    out.push(err.message);
  }
  return out;
}

function assertReady() {
  const missing = missingRequired();
  const invalid = invalidConfig();
  if (!missing.length && !invalid.length) return;
  const parts = [];
  if (missing.length) parts.push(`Thiếu biến bắt buộc trong .env: ${missing.join(', ')}.`);
  if (invalid.length) parts.push(`Cấu hình sai: ${invalid.join('; ')}.`);
  const err = new Error(`${parts.join(' ')} Xem .env.example rồi sửa trước khi chạy.`);
  err.code = 'CONFIG_INCOMPLETE';
  throw err;
}
```

- [ ] **Step 7: `src/config.js` — `module.exports`**: thêm `invalidConfig,` ngay sau `assertReady,`; thêm `PROFILE_NAME` ngay sau `ACCOUNT_SUFFIX: SUFFIX,`; thêm các biến Sheet ngay sau `SHEET_TAB,`:

```js
  invalidConfig,
```

```js
  // Tên hồ sơ tài khoản của slot này — ghi vào dòng đầu ô Kết quả thực hiện.
  PROFILE_NAME: ACCOUNT === 1 ? 'default' : `slot${ACCOUNT}`,
```

```js
  SHEET_GID,
  GOOGLE_SA_KEY_FILE,
  ENV_LABELS: process.env.ENV_LABELS || '',
  // Người duyệt ghi vào nhật ký ghi Sheet (không ghi lên Sheet).
  QC_NAME: (process.env.QC_NAME || process.env.USERNAME || process.env.USER || '').trim(),
```

- [ ] **Step 8: `.env.example`** — thêm ngay sau dòng `SHEET_TAB=`:

```
# --- Google Sheets API (engine v2) ---
# File JSON key của service account (đường dẫn tương đối thì tính từ gốc repo).
# Share Sheet quyền Editor cho email "client_email" ghi trong file đó.
GOOGLE_SA_KEY_FILE=
# ID của tab = số sau "gid=" trên link Sheet. Khuyên dùng thay cho SHEET_TAB: không phụ
# thuộc tên tab, dấu cách cuối tên hay thứ tự tab. Có SHEET_GID thì SHEET_TAB chỉ để đối chiếu.
SHEET_GID=
# Nhãn cột "Môi trường" suy theo tên miền của TARGET_URL (hậu tố dài nhất thắng).
# Bỏ trống = mặc định dưới đây — khớp danh sách chọn Beta / Localhost / Production của Sheet.
# ENV_LABELS=devtunnels.ms=Localhost,localhost=Localhost,beta.fastdo.vn=Beta,fastdo.vn=Production
# Tên người duyệt, lưu vào nhật ký ghi Sheet (bỏ trống = tên user Windows).
# QC_NAME=
```

- [ ] **Step 9: Kiểm config vẫn nạp được**

Run: `node -e "const c=require('./src/config'); console.log(c.PROFILE_NAME, c.REQUIRED_ENV.length, typeof c.invalidConfig)"`
Expected: `default 7 function`

---

### Task 2: `sheet_grid` — tìm cột theo nhãn trong khối vòng

**Files:**
- Modify: `src/core/sheet_grid.js`
- Test: `src/core/sheet_grid.test.js` (thêm test cuối file)

- [ ] **Step 1: Thêm test** vào cuối `src/core/sheet_grid.test.js`:

```js
// --- Engine v2: tìm cột theo NHÃN — dữ liệu mẫu = tiêu đề THẬT của tab V1/HUY ------
// Lấy từ Sheet thật ngày 2026-09-28: vòng 1–5 rộng 7 cột (có FIXED), vòng 6+ rộng 6
// cột, vòng 1 có FEEDBACK AI thay DEV /QC NOTE, nhãn có khoảng trắng thừa ở đầu.
const V1_R1 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'FEEDBACK AI', 'FIXED', 'Test Date'];
const V1_R2_5 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'FIXED', 'Test Date'];
const V1_R6 = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'Test Date'];

function makeV1Grid(rounds = 7) {
  const header = ['DONE25', '', '', '', ''];
  const sub = ['ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];
  for (let n = 1; n <= rounds; n += 1) {
    const block = n === 1 ? V1_R1 : n <= 5 ? V1_R2_5 : V1_R6;
    header.push(`TEST LẦN ${n}`, ...new Array(block.length - 1).fill(''));
    sub.push(...block);
  }
  // Sheets API cắt ô trống ở đuôi dòng — dòng 1 ngắn hơn dòng 2
  while (header.length && header[header.length - 1] === '') header.pop();
  return [header, sub, ['TÊN TICKET'], ['EVAL_V1_001', 'Phân quyền', 'Tiêu đề', 'Mô tả', 'Web'], ['EVAL_V1_002']];
}

const letters = (cols) => Object.fromEntries(
  Object.entries(cols).map(([k, v]) => [k, v === null ? null : G.colLetter(v)])
);

test('colLetter đổi chỉ số 0-based ra chữ cái cột', () => {
  assert.deepStrictEqual([0, 7, 25, 26, 51, 701, 702].map(G.colLetter), ['A', 'H', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
});

test('V1 thật, vòng 1 (7 cột, có FEEDBACK AI): Môi trường G, Trạng thái H, Kết quả I, Test Date L', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 1);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(letters(r.cols), { status: 'H', result: 'I', env: 'G', testDate: 'L' });
});

test('V1 thật, vòng 3: đúng các ô đã đọc trên Sheet (U, V, W, Z)', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 3);
  assert.deepStrictEqual(letters(r.cols), { status: 'V', result: 'W', env: 'U', testDate: 'Z' });
});

test('V1 thật, vòng 6 rộng 6 cột: Test Date ở +5, không phải +6', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 6);
  assert.strictEqual(r.block.startIdx, 40);
  assert.strictEqual(r.cols.status, 42);
  assert.strictEqual(r.cols.testDate, 45);
});

test('vòng cuối kéo tới hết chiều rộng dòng 2 dù dòng 1 bị cắt ô trống ở đuôi', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(7), 7);
  assert.deepStrictEqual(r.block, { startIdx: 46, endIdx: 52 });
  assert.strictEqual(r.cols.testDate, 51);
});

test('HUY thật: mọi vòng rộng 6 cột, cột "QC" thừa sau vòng 10 không ảnh hưởng', () => {
  const block = ['Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'Test Date'];
  const header = [']]]', '', '', '', ''];
  const sub = ['ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng'];
  for (let n = 1; n <= 10; n += 1) {
    header.push(`TEST LẦN ${n}`, '', '', '', '', '');
    sub.push(...block);
  }
  header.push('0');
  sub.push('QC');
  const r = G.findRoundColumnsByLabel([header, sub, ['TÊN TICKET'], ['EVAL_021']], 10);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.block.startIdx, 59);
  assert.deepStrictEqual(r.cols, { status: 61, result: 62, env: 60, testDate: 64 });
});

test('cột chen thêm trong khối không làm lệch — tìm theo nhãn vẫn đúng cột', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', 'Test Date']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cols.status, 8);
  assert.strictEqual(r.cols.result, 9);
});

test('DỪNG khi khối vòng không có nhãn Trạng thái / Kết quả ở dòng 2', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['', '', '', '', '', '']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems.join(' | '), /không có cột "Trạng thái"/);
  assert.match(r.problems.join(' | '), /không có cột "Kết quả thực hiện"/);
});

test('DỪNG khi khối vòng có 2 cột Trạng thái', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Trạng thái', 'Môi trường', 'Trạng thái', 'Kết quả thực hiện', '', 'Test Date']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /2 cột "Trạng thái" \(F, H\)/);
});

test('thiếu Môi trường / Test Date chỉ cảnh báo, vẫn ghi được 2 cột chính', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', '', 'Trạng thái', 'Kết quả thực hiện', '', '']);
  const r = G.findRoundColumnsByLabel(g, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cols.env, null);
  assert.strictEqual(r.cols.testDate, null);
  assert.strictEqual(r.warnings.length, 2);
});

test('không mượn nhãn của vòng khác (chỉ tìm trong khối của đúng vòng)', () => {
  let i = 0;
  const g = makeGrid(['TEST LẦN 1', 'TEST LẦN 2'], () =>
    (i++ === 0 ? ['Ưu tiên', 'Môi trường', '', 'Kết quả thực hiện', '', ''] : R));
  assert.strictEqual(G.findRoundColumnsByLabel(g, 1).ok, false);
  assert.strictEqual(G.findRoundColumnsByLabel(g, 2).ok, true);
});

test('findRoundColumnsByLabel trả ok=false khi Sheet không có vòng đó', () => {
  const r = G.findRoundColumnsByLabel(makeV1Grid(), 99);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.block, null);
  assert.match(r.problems[0], /TEST LẦN 99/);
});

test('findRowIndices trả mọi dòng trùng mã — để chặn ghi khi mã xuất hiện 2 lần', () => {
  const g = [...grid, ['EVAL_021', 'bản trùng']];
  assert.deepStrictEqual(G.findRowIndices(g, 'EVAL_021'), [2, 6]);
  assert.deepStrictEqual(G.findRowIndices(g, 'eval_022'), [3]);
  assert.deepStrictEqual(G.findRowIndices(g, 'EVAL_999'), []);
});

test('roundsOfCase đọc theo nhãn: đúng ô cả khi khối có cột chen thêm', () => {
  const g = makeGrid(['TEST LẦN 1'], () => ['Ưu tiên', 'Môi trường', 'Ghi chú thêm', 'Trạng thái', 'Kết quả thực hiện', 'Test Date']);
  g[2][7] = 'ghi chú';
  g[2][8] = 'DONE';
  g[2][9] = 'kết quả thật';
  const r = G.roundsOfCase(g, 2)[0];
  assert.strictEqual(r.status, 'DONE');
  assert.strictEqual(r.result, 'kết quả thật');
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/core/sheet_grid.test.js`
Expected: FAIL — `G.colLetter is not a function`.

- [ ] **Step 3: Thêm hàm vào `src/core/sheet_grid.js`** — đặt ngay trước dòng `module.exports = {`:

```js
// ---------------------------------------------------------------------------
// Engine v2 (kỳ 1): tìm cột theo NHÃN trong khối vòng, thay cho offset cố định.
//
// Sheet thật (tab V1, 2026-09-28): vòng 1–5 rộng 7 cột (có FIXED), vòng 6+ rộng 6 cột,
// vòng 1 có "FEEDBACK AI" thay "DEV /QC NOTE", nhãn có khoảng trắng thừa ở đầu. Offset
// +2/+3 vẫn đúng cho Trạng thái/Kết quả nhưng Test Date lệch theo vòng — nên mọi cột
// engine v2 ghi đều tìm theo nhãn dòng 2, trong đúng phạm vi khối của vòng đó.
// ---------------------------------------------------------------------------

const WRITE_LABELS = {
  status: 'Trạng thái',
  result: 'Kết quả thực hiện',
  env: 'Môi trường',
  testDate: 'Test Date',
};

/** Chữ cái cột từ chỉ số 0-based: 0 → A, 25 → Z, 26 → AA */
function colLetter(idx) {
  let n = Number(idx) + 1;
  let out = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

/**
 * Khối cột của vòng n: từ ô "TEST LẦN n" tới trước ô "TEST LẦN" kế tiếp THEO VỊ TRÍ.
 * Vòng cuối kéo tới hết chiều rộng dài nhất của 2 dòng tiêu đề (Sheets API cắt ô trống
 * ở đuôi dòng 1). null = Sheet không có vòng đó.
 */
function roundBlock(grid, roundNumber) {
  const rounds = listRounds(grid);
  const hit = rounds.find((r) => r.number === Number(roundNumber));
  if (!hit) return null;
  const later = rounds.map((r) => r.startCol).filter((c) => c > hit.startCol);
  const width = Math.max(((grid && grid[0]) || []).length, ((grid && grid[1]) || []).length);
  return { startIdx: hit.startCol, endIdx: later.length ? Math.min(...later) : width };
}

/**
 * Các cột engine v2 ghi cho vòng n, tìm theo nhãn dòng 2 trong đúng khối của vòng.
 * - Trạng thái / Kết quả thực hiện: phải có ĐÚNG 1 cột, không thì ok = false (DỪNG).
 * - Môi trường / Test Date: thiếu hoặc trùng thì để null kèm cảnh báo.
 * Trả { ok, cols: {status, result, env, testDate} (0-based | null), block, problems, warnings }.
 */
function findRoundColumnsByLabel(grid, roundNumber) {
  const cols = { status: null, result: null, env: null, testDate: null };
  const block = roundBlock(grid, roundNumber);
  if (!block) {
    return {
      ok: false,
      cols,
      block: null,
      problems: [`Sheet không có cột nào mang nhãn "TEST LẦN ${roundNumber}"`],
      warnings: [],
    };
  }

  const sub = (grid && grid[1]) || [];
  const hitsOf = (label) => {
    const want = normalizeLabel(label);
    const hits = [];
    for (let c = block.startIdx; c < block.endIdx; c += 1) {
      if (normalizeLabel(sub[c]) === want) hits.push(c);
    }
    return hits;
  };

  const problems = [];
  const warnings = [];
  for (const key of ['status', 'result']) {
    const hits = hitsOf(WRITE_LABELS[key]);
    if (hits.length === 1) cols[key] = hits[0];
    else if (hits.length === 0) {
      problems.push(`khối vòng ${roundNumber} không có cột "${WRITE_LABELS[key]}" ở dòng 2`);
    } else {
      problems.push(
        `khối vòng ${roundNumber} có ${hits.length} cột "${WRITE_LABELS[key]}" ` +
          `(${hits.map(colLetter).join(', ')}) — không biết ghi cột nào`
      );
    }
  }
  for (const key of ['env', 'testDate']) {
    const hits = hitsOf(WRITE_LABELS[key]);
    if (hits.length === 1) cols[key] = hits[0];
    else if (hits.length === 0) {
      warnings.push(`khối vòng ${roundNumber} không có cột "${WRITE_LABELS[key]}" — bỏ qua cột này`);
    } else {
      warnings.push(
        `khối vòng ${roundNumber} có ${hits.length} cột "${WRITE_LABELS[key]}" ` +
          `(${hits.map(colLetter).join(', ')}) — bỏ qua cột này để khỏi ghi nhầm`
      );
    }
  }

  return { ok: problems.length === 0, cols, block, problems, warnings };
}

/** Mọi dòng (0-based) mang mã case ở cột ID — để phát hiện mã trùng */
function findRowIndices(grid, testcaseId, idCol = 0) {
  const target = String(testcaseId || '').trim().toUpperCase();
  const out = [];
  for (let r = 1; r < (grid || []).length; r += 1) {
    if (((grid[r] || [])[idCol] || '').trim().toUpperCase() === target) out.push(r);
  }
  return out;
}
```

- [ ] **Step 4: Sửa `roundsOfCase`** trong `src/core/sheet_grid.js` — thay cả hàm bằng:

```js
function roundsOfCase(grid, rowIdx) {
  const row = grid[rowIdx] || [];
  return listRounds(grid).map(({ number, startCol }) => {
    // Theo nhãn dòng 2 nếu có; Sheet để trống nhãn thì lùi về offset cũ.
    const { cols } = findRoundColumnsByLabel(grid, number);
    const statusIdx = cols.status !== null ? cols.status : startCol + STATUS_OFFSET;
    const resultIdx = cols.result !== null ? cols.result : startCol + RESULT_OFFSET;
    const status = (row[statusIdx] || '').trim();
    const result = (row[resultIdx] || '').trim();
    return {
      number,
      startCol,
      status,
      result,
      hasData: Boolean(status || result),
    };
  });
}
```

(Hàm khai báo bằng `function` nên gọi được `findRoundColumnsByLabel` dù định nghĩa phía dưới.)

- [ ] **Step 5: Thêm vào `module.exports`** của `sheet_grid.js` (sau `printSpec,`):

```js
  WRITE_LABELS,
  colLetter,
  roundBlock,
  findRoundColumnsByLabel,
  findRowIndices,
```

- [ ] **Step 6: Chạy test**

Run: `node --test src/core/sheet_grid.test.js src/core/sheet_service.test.js`
Expected: PASS toàn bộ (test cũ + test mới).

---

### Task 3: Hàm thuần — `a1`, `env_label`, `result_text`

**Files:**
- Create: `src/sheets/a1.js`, `src/sheets/env_label.js`, `src/engine/result_text.js`
- Test: `src/sheets/a1.test.js`, `src/sheets/env_label.test.js`, `src/engine/result_text.test.js`

- [ ] **Step 1: Viết test** — `src/sheets/a1.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { quoteTab, cellRange, a1Of, showSpaces } = require('./a1');

test('quoteTab bọc nháy đơn và nhân đôi nháy đơn bên trong', () => {
  assert.strictEqual(quoteTab('V1 - fEvaluation - VIBE '), "'V1 - fEvaluation - VIBE '");
  assert.strictEqual(quoteTab("Tab của QC's"), "'Tab của QC''s'");
});

test('a1Of + cellRange', () => {
  assert.strictEqual(a1Of(255, 7), 'H256');
  assert.strictEqual(a1Of(0, 26), 'AA1');
  assert.strictEqual(cellRange('V1 ', 'H256'), "'V1 '!H256");
});

test('showSpaces hiện dấu cách đầu/cuối thành ␠', () => {
  assert.strictEqual(showSpaces('V1 - fEvaluation - VIBE '), 'V1 - fEvaluation - VIBE␠');
  assert.strictEqual(showSpaces('  a b '), '␠␠a b␠');
  assert.strictEqual(showSpaces('abc'), 'abc');
  assert.strictEqual(showSpaces('  '), '␠␠');
  assert.strictEqual(showSpaces(''), '');
});
```

`src/sheets/env_label.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { parseEnvLabels, resolveEnvLabel, DEFAULT_ENV_LABELS } = require('./env_label');

test('mặc định khớp danh sách chọn của Sheet: Localhost / Beta / Production', () => {
  const rules = parseEnvLabels('');
  assert.strictEqual(resolveEnvLabel('https://60rr1632-3000.asse.devtunnels.ms/', rules), 'Localhost');
  assert.strictEqual(resolveEnvLabel('https://beta.fastdo.vn/', rules), 'Beta');
  assert.strictEqual(resolveEnvLabel('https://app.fastdo.vn/evaluation', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('https://fastdo.vn', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('http://localhost:3000', rules), 'Localhost');
  assert.match(DEFAULT_ENV_LABELS, /beta\.fastdo\.vn=Beta/);
});

test('hậu tố khớp theo ranh giới tên miền (notfastdo.vn không phải fastdo.vn)', () => {
  assert.strictEqual(resolveEnvLabel('https://notfastdo.vn', parseEnvLabels('')), null);
});

test('host lạ hoặc URL hỏng → null', () => {
  const rules = parseEnvLabels('');
  assert.strictEqual(resolveEnvLabel('https://example.com', rules), null);
  assert.strictEqual(resolveEnvLabel('không phải url', rules), null);
});

test('ENV_LABELS tự khai thay mặc định; hậu tố dài nhất thắng; bỏ dấu chấm đầu', () => {
  const rules = parseEnvLabels(' .fastdo.vn=Production , staging.fastdo.vn=Beta ');
  assert.strictEqual(resolveEnvLabel('https://x.staging.fastdo.vn', rules), 'Beta');
  assert.strictEqual(resolveEnvLabel('https://y.fastdo.vn', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('https://x.devtunnels.ms', rules), null);
});

test('ENV_LABELS sai cú pháp thì ném lỗi nói rõ', () => {
  assert.throws(() => parseEnvLabels('devtunnels.ms'), /phải có dạng/);
  assert.throws(() => parseEnvLabels('=Localhost'), /phải có dạng/);
  assert.throws(() => parseEnvLabels('dev tunnels=Localhost'), /không hợp lệ/);
});
```

`src/engine/result_text.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const T = require('./result_text');

test('formatDate / formatDateTime theo giờ máy', () => {
  const d = new Date(2026, 8, 5, 7, 3);
  assert.strictEqual(T.formatDate(d), '05/09/2026');
  assert.strictEqual(T.formatDateTime(d), '05/09/2026 07:03');
});

test('toSheetsDateSerial khớp ô Test Date thật (15/09/2026 = 46280)', () => {
  assert.strictEqual(T.toSheetsDateSerial(new Date(2026, 8, 15, 23, 59)), 46280);
  assert.strictEqual(T.toSheetsDateSerial(new Date(1899, 11, 31)), 1);
});

test('runTag lấy 8 ký tự chữ/số đầu của runId', () => {
  assert.strictEqual(T.runTag('A1B2C3D4-E5F6-7777'), '#a1b2c3d4');
  assert.throws(() => T.runTag('abc'), /quá ngắn/);
});

test('buildResultEntry: dòng đầu, bước ✓/✗, phép kiểm, kết luận, video', () => {
  const text = T.buildResultEntry({
    runId: 'a1b2c3d4-0000',
    startedAt: new Date(2026, 8, 25, 14, 32),
    round: 3,
    profile: 'default',
    steps: [
      { label: 'B1 Mở tab Mẫu đánh giá', ok: true },
      { label: 'B3 Bấm Kích hoạt', ok: false, error: 'hệ thống chặn:\n "Trọng số = 0"' },
    ],
    checks: [{ label: 'Banner chỉ xem', ok: false, expected: 'có', actual: 'không' }],
    pass: false,
    reviewCause: 'app',
    resultText: 'Kích hoạt bị chặn dù hợp lệ.',
    videoUrl: 'https://files.catbox.moe/x.mp4',
  });
  assert.strictEqual(
    text,
    [
      '[Tự động] 25/09/2026 14:32 · vòng 3 · hồ sơ default · #a1b2c3d4',
      '✓ B1 Mở tab Mẫu đánh giá',
      '✗ B3 Bấm Kích hoạt ← hệ thống chặn: "Trọng số = 0"',
      '• Banner chỉ xem: không (mong muốn: có) ✗',
      'Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — Kích hoạt bị chặn dù hợp lệ.',
      '- Video Test Record: https://files.catbox.moe/x.mp4',
    ].join('\n')
  );
});

test('kịch bản cũ chưa có bước: chỉ dòng đầu + kết luận + video', () => {
  const text = T.buildResultEntry({
    runId: 'ffffffff99',
    startedAt: new Date(2026, 0, 2, 9, 5),
    round: 1,
    pass: true,
    resultText: '',
    videoUrl: 'https://v',
  });
  assert.strictEqual(
    text,
    '[Tự động] 02/01/2026 09:05 · vòng 1 · hồ sơ default · #ffffffff\nKết luận: ĐẠT\n- Video Test Record: https://v'
  );
});

test('KHÔNG ĐẠT chưa duyệt thì không ghi "QC xác nhận"', () => {
  assert.strictEqual(T.verdictLabel(false), 'KHÔNG ĐẠT');
  assert.strictEqual(T.verdictLabel(true, 'app'), 'ĐẠT');
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/sheets/a1.test.js src/sheets/env_label.test.js src/engine/result_text.test.js`
Expected: FAIL — `Cannot find module './a1'`.

- [ ] **Step 3: Tạo `src/sheets/a1.js`**

```js
// ============================================================================
// a1.js: địa chỉ ô kiểu A1 cho Sheets API — tên tab trong vùng phải bọc nháy đơn
// ("'V1 - fEvaluation - VIBE '!H256"), nhất là tên có dấu cách / gạch ngang.
// ============================================================================

const { colLetter } = require('../core/sheet_grid');

/** Tên tab trong A1: bọc nháy đơn, nhân đôi nháy đơn bên trong */
function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/** Vùng 1 ô: 'Tab'!H256 */
function cellRange(title, a1) {
  return `${quoteTab(title)}!${a1}`;
}

/** Địa chỉ ô từ chỉ số 0-based: (255, 7) → H256 */
function a1Of(rowIdx, colIdx) {
  return `${colLetter(colIdx)}${rowIdx + 1}`;
}

/**
 * Hiện dấu cách đầu/cuối thành ␠. Tên tab thật là "V1 - fEvaluation - VIBE " — nhìn
 * bằng mắt không thấy dấu cách cuối, nên thông báo lỗi phải cho thấy nó.
 */
function showSpaces(s) {
  const text = String(s == null ? '' : s);
  const lead = text.match(/^ */)[0].length;
  if (lead === text.length) return '␠'.repeat(text.length);
  const trail = text.match(/ *$/)[0].length;
  return '␠'.repeat(lead) + text.slice(lead, text.length - trail) + '␠'.repeat(trail);
}

module.exports = { quoteTab, cellRange, a1Of, showSpaces };
```

- [ ] **Step 4: Tạo `src/sheets/env_label.js`**

```js
// ============================================================================
// env_label.js: nhãn cột "Môi trường" suy từ tên miền của TARGET_URL.
//
// Ô Môi trường trên Sheet là danh sách chọn strict: Beta / Localhost / Production.
// Mặc định khớp đúng 3 nhãn đó; `beta.fastdo.vn` lấy từ tài liệu repo fastdo-server.
// Hậu tố dài nhất thắng, nên beta.fastdo.vn → Beta dù fastdo.vn → Production.
// ============================================================================

const DEFAULT_ENV_LABELS =
  'devtunnels.ms=Localhost,localhost=Localhost,beta.fastdo.vn=Beta,fastdo.vn=Production';

/** "hậu tố=nhãn,…" → [{ suffix, label }]. Rỗng = mặc định. Sai cú pháp thì ném lỗi. */
function parseEnvLabels(raw) {
  const text = String(raw == null ? '' : raw).trim() || DEFAULT_ENV_LABELS;
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i <= 0 || i === pair.length - 1) {
        throw new Error(`ENV_LABELS: "${pair}" phải có dạng <hậu tố tên miền>=<nhãn>, vd devtunnels.ms=Localhost`);
      }
      const suffix = pair.slice(0, i).trim().toLowerCase().replace(/^\.+/, '');
      const label = pair.slice(i + 1).trim();
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(suffix)) {
        throw new Error(`ENV_LABELS: hậu tố tên miền "${suffix}" không hợp lệ`);
      }
      if (!label || /[\r\n=]/.test(label)) {
        throw new Error(`ENV_LABELS: nhãn của "${suffix}" không hợp lệ`);
      }
      return { suffix, label };
    });
}

/** Nhãn Môi trường của URL, hoặc null nếu không khớp hậu tố nào (engine sẽ chặn ghi). */
function resolveEnvLabel(targetUrl, rules) {
  let host;
  try {
    host = new URL(String(targetUrl)).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hits = (rules || []).filter((r) => host === r.suffix || host.endsWith(`.${r.suffix}`));
  if (!hits.length) return null;
  return hits.reduce((best, r) => (r.suffix.length > best.suffix.length ? r : best)).label;
}

module.exports = { DEFAULT_ENV_LABELS, parseEnvLabels, resolveEnvLabel };
```

- [ ] **Step 5: Tạo `src/engine/result_text.js`**

```js
// ============================================================================
// result_text.js: dựng đoạn nối vào ô "Kết quả thực hiện" và các giá trị ngày.
//
//   [Tự động] 25/09/2026 14:32 · vòng 3 · hồ sơ default · #a1b2c3d4
//   ✓ B1 Mở tab Mẫu đánh giá
//   ✗ B3 Bấm Kích hoạt ← hệ thống chặn: "…"
//   • Banner chỉ xem: không (mong muốn: có) ✗
//   Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — <resultText của kịch bản>
//   - Video Test Record: https://files.catbox.moe/xxxxxx.mp4
//
// "#a1b2c3d4" = 8 ký tự đầu của runId — dấu để chống ghi trùng: ô đã chứa dấu này
// nghĩa là lần chạy đó đã được ghi, thử ghi lại bao nhiêu lần cũng không nhân đôi.
// Dòng "- Video Test Record:" giữ đúng chữ cũ để QC và công thức sẵn có vẫn nhận ra.
// ============================================================================

const two = (n) => String(n).padStart(2, '0');

function formatDate(value) {
  const d = new Date(value);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(value) {
  const d = new Date(value);
  return `${formatDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Số ngày kiểu Google Sheets (mốc 30/12/1899) của NGÀY theo giờ máy — ô Test Date là số */
function toSheetsDateSerial(value) {
  const d = new Date(value);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

function runTag(runId) {
  const core = String(runId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  if (core.length < 8) {
    throw new Error(`runId "${runId}" quá ngắn để làm dấu chống ghi trùng (cần ≥ 8 ký tự chữ/số)`);
  }
  return `#${core}`;
}

function shorten(value, max = 120) {
  const flat = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function verdictLabel(pass, reviewCause) {
  if (pass) return 'ĐẠT';
  return reviewCause === 'app' ? 'KHÔNG ĐẠT (QC xác nhận lỗi app)' : 'KHÔNG ĐẠT';
}

function buildResultEntry({
  runId,
  startedAt,
  round,
  profile,
  steps = [],
  checks = [],
  pass,
  reviewCause,
  resultText,
  videoUrl,
}) {
  const lines = [
    `[Tự động] ${formatDateTime(startedAt)} · vòng ${round} · hồ sơ ${profile || 'default'} · ${runTag(runId)}`,
  ];
  for (const s of steps) {
    lines.push(
      s.ok
        ? `✓ ${shorten(s.label, 200)}`
        : `✗ ${shorten(s.label, 200)}${s.error ? ` ← ${shorten(s.error)}` : ''}`
    );
  }
  for (const c of checks) {
    const hasDetail = c.actual !== undefined || c.expected !== undefined;
    const detail = hasDetail
      ? `: ${c.actual === undefined ? '(không rõ)' : shorten(c.actual, 80)}` +
        (c.expected === undefined ? '' : ` (mong muốn: ${shorten(c.expected, 80)})`)
      : '';
    lines.push(`• ${shorten(c.label, 120)}${detail} ${c.ok ? '✓' : '✗'}`);
  }
  const text = String(resultText == null ? '' : resultText).trim();
  const verdict = verdictLabel(pass, reviewCause);
  lines.push(text ? `Kết luận: ${verdict} — ${text}` : `Kết luận: ${verdict}`);
  if (videoUrl) lines.push(`- Video Test Record: ${videoUrl}`);
  return lines.join('\n');
}

module.exports = {
  formatDate,
  formatDateTime,
  toSheetsDateSerial,
  runTag,
  shorten,
  verdictLabel,
  buildResultEntry,
};
```

- [ ] **Step 6: Chạy test**

Run: `node --test src/sheets/a1.test.js src/sheets/env_label.test.js src/engine/result_text.test.js`
Expected: PASS.

---

### Task 4: Chọn tab + client REST

**Files:**
- Create: `src/sheets/tab.js`, `src/sheets/sheets_client.js`
- Test: `src/sheets/tab.test.js`, `src/sheets/sheets_client.test.js`

- [ ] **Step 1: Viết test** — `src/sheets/tab.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { resolveTab } = require('./tab');

const META = {
  tabs: [
    { gid: 1086276772, title: 'V1 - fEvaluation - VIBE ' },
    { gid: 286718788, title: 'fEvaluation - VIBE - HUY' },
  ],
};

test('SHEET_GID chọn đúng tab, không cần tên', () => {
  assert.deepStrictEqual(resolveTab(META, { gid: '1086276772' }), {
    gid: 1086276772,
    title: 'V1 - fEvaluation - VIBE ',
    warnings: [],
  });
});

test('SHEET_GID + SHEET_TAB lệch tên: vẫn theo gid, kèm cảnh báo', () => {
  const r = resolveTab(META, { gid: '286718788', title: 'fEvaluation - VIBE' });
  assert.strictEqual(r.title, 'fEvaluation - VIBE - HUY');
  assert.match(r.warnings[0], /khác tên thật/);
});

test('gid không tồn tại → DỪNG, liệt kê tab thật (hiện dấu cách cuối)', () => {
  assert.throws(
    () => resolveTab(META, { gid: '1' }),
    (e) => {
      assert.match(e.message, /AN TOÀN/);
      assert.match(e.message, /V1 - fEvaluation - VIBE␠/);
      return true;
    }
  );
});

test('chỉ có SHEET_TAB: phải khớp chính xác, KHÔNG lùi về tab đầu như gviz', () => {
  assert.strictEqual(resolveTab(META, { title: 'fEvaluation - VIBE - HUY' }).gid, 286718788);
  assert.throws(
    () => resolveTab(META, { title: 'fEvaluation - VIBE' }),
    (e) => {
      assert.match(e.message, /Không có tab nào tên đúng/);
      assert.match(e.message, /SHEET_GID=1086276772/);
      return true;
    }
  );
});

test('tên thiếu dấu cách cuối cũng bị chặn, kèm gợi ý gid', () => {
  assert.throws(
    () => resolveTab(META, { title: 'V1 - fEvaluation - VIBE' }),
    /Gần giống: "V1 - fEvaluation - VIBE␠" → khai SHEET_GID=1086276772/
  );
});

test('không khai gì → DỪNG', () => {
  assert.throws(() => resolveTab(META, {}), /Chưa chọn tab/);
});
```

`src/sheets/sheets_client.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createSheetsClient, posKey } = require('./sheets_client');

function fakeTransport(responses) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
const client = (responses) => {
  const transport = fakeTransport(responses);
  return { c: createSheetsClient({ spreadsheetId: 'abc', transport, sleep: noSleep }), transport };
};

test('getMeta trả danh sách tab với tên thật và gid', async () => {
  const { c, transport } = client([{
    status: 200,
    data: {
      properties: { title: 'TESTCASE' },
      sheets: [{ properties: { sheetId: 5, title: 'V1 ', index: 0, gridProperties: { rowCount: 10, columnCount: 3 } } }],
    },
  }]);
  const meta = await c.getMeta();
  assert.strictEqual(meta.title, 'TESTCASE');
  assert.deepStrictEqual(meta.tabs, [{ gid: 5, title: 'V1 ', index: 0, hidden: false, rows: 10, cols: 3 }]);
  assert.match(transport.calls[0].url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/abc\?fields=/);
});

test('readGrid gọi values API với tên tab bọc nháy, trả toàn chuỗi', async () => {
  const { c, transport } = client([{ status: 200, data: { values: [['ID', 1], ['EVAL_1']] } }]);
  assert.deepStrictEqual(await c.readGrid('V1 '), [['ID', '1'], ['EVAL_1']]);
  assert.ok(transport.calls[0].url.includes(encodeURIComponent("'V1 '")));
  assert.ok(transport.calls[0].url.includes('valueRenderOption=FORMATTED_VALUE'));
});

test('readCells xếp đúng thứ tự vùng theo startRow/startColumn; ô trống = {}', async () => {
  const { c, transport } = client([{
    status: 200,
    data: {
      sheets: [{
        data: [
          { startRow: 255, startColumn: 7, rowData: [{ values: [{ userEnteredValue: { stringValue: 'DONE' } }] }] },
          { rowData: [{ values: [{ userEnteredValue: { stringValue: 'EVAL_X' } }] }] },
          { startRow: 255, startColumn: 8 },
        ],
      }],
    },
  }]);
  const cells = await c.readCells(["'V1'!H256", "'V1'!A1", "'V1'!I256"]);
  assert.strictEqual(cells[0].userEnteredValue.stringValue, 'DONE');
  assert.strictEqual(cells[1].userEnteredValue.stringValue, 'EVAL_X');
  assert.deepStrictEqual(cells[2], {});
  assert.ok(transport.calls[0].url.includes('includeGridData=true'));
});

test('batchUpdate POST tới :batchUpdate với đúng requests', async () => {
  const { c, transport } = client([{ status: 200, data: { replies: [] } }]);
  await c.batchUpdate([{ updateCells: { fields: 'userEnteredValue' } }]);
  assert.strictEqual(transport.calls[0].method, 'POST');
  assert.strictEqual(transport.calls[0].url, 'https://sheets.googleapis.com/v4/spreadsheets/abc:batchUpdate');
  assert.deepStrictEqual(transport.calls[0].data, { requests: [{ updateCells: { fields: 'userEnteredValue' } }] });
});

test('429 và 5xx được thử lại rồi mới báo lỗi', async () => {
  const { c, transport } = client([
    { status: 429, data: {} },
    { status: 503, data: {} },
    { status: 200, data: { values: [] } },
  ]);
  assert.deepStrictEqual(await c.readGrid('T'), []);
  assert.strictEqual(transport.calls.length, 3);
});

test('403 nói rõ phải Share cho service account', async () => {
  const { c } = client([{ status: 403, data: { error: { message: 'The caller does not have permission' } } }]);
  await assert.rejects(() => c.getMeta(), /không có quyền.*Share Sheet/);
});

test('lỗi mạng thử lại 3 lần rồi báo lỗi mạng', async () => {
  const err = () => new Error('ECONNRESET');
  const { c, transport } = client([err(), err(), err(), err()]);
  await assert.rejects(() => c.readGrid('T'), /lỗi mạng — ECONNRESET/);
  assert.strictEqual(transport.calls.length, 4);
});

test('canEdit hỏi Drive; lỗi thì trả null (không biết), không ném', async () => {
  assert.strictEqual(await client([{ status: 200, data: { capabilities: { canEdit: true } } }]).c.canEdit(), true);
  assert.strictEqual(await client([{ status: 200, data: { capabilities: { canEdit: false } } }]).c.canEdit(), false);
  assert.strictEqual(await client([{ status: 404, data: {} }]).c.canEdit(), null);
});

test('posKey đổi vùng 1 ô ra dòng:cột 0-based', () => {
  assert.strictEqual(posKey("'V1 - x '!H256"), '255:7');
  assert.strictEqual(posKey("'T'!AA1"), '0:26');
});

test('thiếu SHEET_ID thì ném lỗi ngay', () => {
  assert.throws(() => createSheetsClient({ transport: async () => ({}) }), /SHEET_ID/);
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/sheets/tab.test.js src/sheets/sheets_client.test.js`
Expected: FAIL — `Cannot find module './tab'`.

- [ ] **Step 3: Tạo `src/sheets/tab.js`**

```js
// ============================================================================
// tab.js: chọn tab của Sheet. SHEET_GID là khoá chính; chỉ có SHEET_TAB thì tên phải
// khớp CHÍNH XÁC. Không bao giờ lùi về tab đầu tiên như endpoint gviz — đã thử thật
// ngày 2026-09-28: gviz trả tab đầu cho MỌI tên không khớp, kể cả tên bịa.
// ============================================================================

const { showSpaces } = require('./a1');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** "Tên␠" (gid 123), … — thông báo lỗi phải nói đúng tên thật */
function formatTabList(tabs) {
  return tabs.map((t) => `"${showSpaces(t.title)}" (gid ${t.gid})`).join(', ');
}

/**
 * @param {{tabs: {gid:number, title:string}[]}} meta  từ client.getMeta()
 * @param {{gid?: string, title?: string}} want       SHEET_GID / SHEET_TAB
 * @returns {{gid:number, title:string, warnings:string[]}}
 */
function resolveTab(meta, { gid, title } = {}) {
  const tabs = (meta && meta.tabs) || [];

  if (gid !== undefined && gid !== null && String(gid).trim() !== '') {
    const hit = tabs.find((t) => String(t.gid) === String(gid).trim());
    if (!hit) {
      throw new Error(`[AN TOÀN] Sheet không có tab nào có gid=${gid}. Các tab đang có: ${formatTabList(tabs)}.`);
    }
    const warnings = [];
    if (title && title !== hit.title) {
      warnings.push(
        `SHEET_TAB="${showSpaces(title)}" khác tên thật "${showSpaces(hit.title)}" — ` +
          `đang dùng tab theo SHEET_GID=${hit.gid}.`
      );
    }
    return { gid: hit.gid, title: hit.title, warnings };
  }

  if (!title) {
    throw new Error(
      '[AN TOÀN] Chưa chọn tab Sheet: khai SHEET_GID (khuyên dùng — số sau "gid=" trên link) ' +
        'hoặc SHEET_TAB trong .env.'
    );
  }

  const exact = tabs.find((t) => t.title === title);
  if (exact) return { gid: exact.gid, title: exact.title, warnings: [] };

  const near = tabs.filter((t) => norm(t.title) === norm(title) || norm(t.title).includes(norm(title)));
  throw new Error(
    `[AN TOÀN] Không có tab nào tên đúng "${showSpaces(title)}". Các tab đang có: ${formatTabList(tabs)}.` +
      (near.length
        ? ` Gần giống: ${near.map((t) => `"${showSpaces(t.title)}" → khai SHEET_GID=${t.gid}`).join('; ')}.`
        : '')
  );
}

module.exports = { resolveTab, formatTabList };
```

- [ ] **Step 4: Tạo `src/sheets/sheets_client.js`**

```js
// ============================================================================
// sheets_client.js: gọi Google Sheets API (REST v4) bằng service account.
//
// Vì sao REST + google-auth-library thay vì gói `googleapis`: `googleapis` nặng ~80MB
// cho vài endpoint. google-auth-library lo ký JWT + làm mới token; phần còn lại chỉ là
// vài URL.
//
// Không có hàm nào ở đây tự "đoán" — lỗi API được đổi thành thông điệp nói rõ phải sửa
// gì (Share cho ai, id nào sai…). 429/5xx/lỗi mạng thử lại 3 lần (1s, 3s, 9s).
// ============================================================================

const fs = require('fs');
const { quoteTab } = require('./a1');

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  // Chỉ để hỏi "có quyền sửa không" mà không phải ghi thử.
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 3000, 9000];

// Đủ để nối ô Kết quả mà giữ link, kiểm danh sách chọn, kiểm kiểu ngày.
const CELL_FIELDS =
  'userEnteredValue,effectiveValue,formattedValue,textFormatRuns,chipRuns,' +
  'dataValidation,userEnteredFormat(numberFormat)';

function readServiceAccountEmail(keyFile) {
  try {
    return JSON.parse(fs.readFileSync(keyFile, 'utf8')).client_email || '';
  } catch {
    return '';
  }
}

/** Transport thật. Trả {status, data}, không ném khi HTTP lỗi — `call()` quyết định. */
function createGoogleTransport(keyFile) {
  if (!keyFile) {
    throw new Error('[SHEET] Chưa khai GOOGLE_SA_KEY_FILE trong .env (đường dẫn file JSON key của service account).');
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`[SHEET] GOOGLE_SA_KEY_FILE trỏ tới file không tồn tại: ${keyFile}`);
  }
  // Nạp muộn: test chỉ dùng transport giả không cần thư viện này.
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  let clientPromise = null;
  return async function transport({ method = 'GET', url, data }) {
    clientPromise = clientPromise || auth.getClient();
    const client = await clientPromise;
    try {
      const res = await client.request({ method, url, data, retry: false, timeout: 30000 });
      return { status: res.status, data: res.data };
    } catch (err) {
      if (err && err.response) return { status: err.response.status, data: err.response.data };
      throw err;
    }
  };
}

/** Lỗi API → thông điệp nói rõ phải sửa gì */
function describeError(res, { what, spreadsheetId, saEmail }) {
  const apiMsg = (res.data && res.data.error && res.data.error.message) || `HTTP ${res.status}`;
  let msg;
  if (res.status === 403) {
    msg =
      `không có quyền (${apiMsg}). Share Sheet cho service account ` +
      `${saEmail || '(xem client_email trong file key)'} — Editor để ghi, Viewer nếu chỉ đọc.`;
  } else if (res.status === 404) {
    msg = `không tìm thấy Sheet id "${spreadsheetId}" (${apiMsg}) — kiểm SHEET_ID (đoạn giữa /d/ và /edit trong link).`;
  } else if (/not supported for this document/i.test(apiMsg)) {
    msg =
      'file là Excel (.xlsx) upload lên Drive, API không ghi được — mở file → Tệp → Lưu dưới ' +
      `dạng Google Trang tính, rồi dùng id mới (${apiMsg}).`;
  } else if (/Unable to parse range/i.test(apiMsg)) {
    msg = `vùng ô không hợp lệ — tên tab không tồn tại? (${apiMsg})`;
  } else {
    msg = `HTTP ${res.status} — ${apiMsg}`;
  }
  const err = new Error(`[SHEET] ${what}: ${msg}`);
  err.status = res.status;
  return err;
}

/** 'Tab'!H4 → "3:7" (dòng:cột 0-based) — khớp startRow/startColumn API trả về */
function posKey(range) {
  const m = /!([A-Z]+)(\d+)$/.exec(String(range));
  if (!m) throw new Error(`[SHEET] vùng không phải 1 ô: ${range}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return `${Number(m[2]) - 1}:${col - 1}`;
}

/**
 * @param {object} o
 * @param {string} o.spreadsheetId
 * @param {string} [o.keyFile]      bắt buộc nếu không truyền transport
 * @param {Function} [o.transport]  ({method,url,data}) => Promise<{status,data}> — test truyền bản giả
 * @param {Function} [o.sleep]      (ms) => Promise — test truyền bản chạy tức thì
 */
function createSheetsClient({ spreadsheetId, keyFile, transport, sleep } = {}) {
  if (!spreadsheetId) throw new Error('[SHEET] Chưa khai SHEET_ID trong .env.');
  const send = transport || createGoogleTransport(keyFile);
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const saEmail = keyFile ? readServiceAccountEmail(keyFile) : '';
  const base = `${API}/${encodeURIComponent(spreadsheetId)}`;

  async function call(req, what) {
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await send(req);
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await wait(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`[SHEET] ${what}: lỗi mạng — ${err && err.message ? err.message : err}`);
      }
      if (res.status >= 200 && res.status < 300) return res.data || {};
      if (RETRY_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
        await wait(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw describeError(res, { what, spreadsheetId, saEmail });
    }
  }

  /** Tên Sheet + danh sách tab (tên thật, gid, số dòng/cột, ẩn hay không) */
  async function getMeta() {
    const fields =
      'properties(title,locale,timeZone),' +
      'sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))';
    const d = await call({ url: `${base}?fields=${encodeURIComponent(fields)}` }, 'đọc danh sách tab');
    const p = d.properties || {};
    return {
      title: p.title || '',
      locale: p.locale || '',
      tabs: (d.sheets || []).map((s) => ({
        gid: s.properties.sheetId,
        title: s.properties.title,
        index: s.properties.index,
        hidden: Boolean(s.properties.hidden),
        rows: (s.properties.gridProperties || {}).rowCount || 0,
        cols: (s.properties.gridProperties || {}).columnCount || 0,
      })),
    };
  }

  /** Toàn bộ giá trị hiển thị của 1 tab, mảng 2 chiều chuỗi (như lưới CSV cũ) */
  async function readGrid(tabTitle) {
    const url =
      `${base}/values/${encodeURIComponent(quoteTab(tabTitle))}` +
      '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
    const d = await call({ url }, `đọc tab "${tabTitle}"`);
    return (d.values || []).map((row) => row.map((v) => (v == null ? '' : String(v))));
  }

  /**
   * Chi tiết từng ô: giá trị gõ vào, link trong chữ, danh sách chọn, định dạng số.
   * @param {string[]} ranges vùng 1 ô dạng 'Tab'!H4
   * @returns {Promise<object[]>} CellData theo đúng thứ tự `ranges` ({} nếu ô trống)
   */
  async function readCells(ranges) {
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const fields = `sheets(properties(sheetId),data(startRow,startColumn,rowData(values(${CELL_FIELDS}))))`;
    const d = await call(
      { url: `${base}?includeGridData=true&${qs}&fields=${encodeURIComponent(fields)}` },
      'đọc ô'
    );
    const byPos = new Map();
    for (const sheet of d.sheets || []) {
      for (const g of sheet.data || []) {
        const row = ((g.rowData || [])[0] || {}).values || [];
        byPos.set(`${g.startRow || 0}:${g.startColumn || 0}`, row[0] || {});
      }
    }
    return ranges.map((r) => byPos.get(posKey(r)) || {});
  }

  /** Một lượt spreadsheets.batchUpdate (updateCells, addSheet, deleteSheet, copyPaste…) */
  async function batchUpdate(requests) {
    return call({ method: 'POST', url: `${base}:batchUpdate`, data: { requests } }, 'ghi Sheet');
  }

  /** Service account có quyền SỬA file không — hỏi Drive, không ghi thử. null = không biết */
  async function canEdit() {
    try {
      const d = await call(
        {
          url:
            `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}` +
            '?fields=capabilities(canEdit)&supportsAllDrives=true',
        },
        'kiểm quyền sửa'
      );
      return Boolean(d.capabilities && d.capabilities.canEdit);
    } catch {
      return null;
    }
  }

  return { spreadsheetId, saEmail, getMeta, readGrid, readCells, batchUpdate, canEdit };
}

module.exports = { createSheetsClient, createGoogleTransport, describeError, posKey, SCOPES, CELL_FIELDS };
```

- [ ] **Step 5: Chạy test**

Run: `node --test src/sheets/tab.test.js src/sheets/sheets_client.test.js`
Expected: PASS. (Test "lỗi mạng" và "429" chạy tức thì nhờ `sleep` giả.)

---

### Task 5: Giá trị ô + Sheet giả lập cho test

**Files:**
- Create: `src/sheets/cell_values.js`, `src/sheets/testkit.js`
- Test: `src/sheets/cell_values.test.js`

- [ ] **Step 1: Viết test** — `src/sheets/cell_values.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const C = require('./cell_values');

test('allowedValues đọc danh sách chọn ONE_OF_LIST; ô không giới hạn → null', () => {
  const cell = {
    dataValidation: {
      strict: true,
      condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'DONE' }, { userEnteredValue: 'Fail' }] },
    },
  };
  assert.deepStrictEqual(C.allowedValues(cell), ['DONE', 'Fail']);
  assert.strictEqual(C.allowedValues({}), null);
});

test('buildAppendedResultCell giữ nguyên chữ + link cũ, chặn link loang, gắn link video', () => {
  const old = {
    userEnteredValue: { stringValue: 'Link: https://jam.dev/c/1' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } }],
  };
  const video = 'https://files.catbox.moe/v.mp4';
  const entry = `[Tự động] …\n- Video Test Record: ${video}`;
  const r = C.buildAppendedResultCell(old, entry, video);
  assert.strictEqual(r.text, `Link: https://jam.dev/c/1\n${entry}`);
  assert.deepStrictEqual(r.runs.slice(0, 2), old.textFormatRuns);
  assert.deepStrictEqual(r.runs[2], { startIndex: 'Link: https://jam.dev/c/1'.length, format: {} });
  assert.deepStrictEqual(r.runs[3], { startIndex: r.text.lastIndexOf(video), format: { link: { uri: video } } });
  assert.strictEqual(r.runs.length, 4);
});

test('ô cũ đã kết thúc bằng xuống dòng thì không thêm dòng trống', () => {
  const r = C.buildAppendedResultCell({ userEnteredValue: { stringValue: 'cũ\n' } }, 'mới', null);
  assert.strictEqual(r.text, 'cũ\nmới');
});

test('ô trống: chỉ có chữ mới, link video vẫn được gắn', () => {
  const entry = 'a\n- Video Test Record: https://v';
  const r = C.buildAppendedResultCell({}, entry, 'https://v');
  assert.strictEqual(r.text, entry);
  assert.deepStrictEqual(r.runs, [{ startIndex: entry.lastIndexOf('https://v'), format: { link: { uri: 'https://v' } } }]);
});

test('cleanRuns bỏ màu kiểu cũ khi đã có màu kiểu mới (API từ chối gửi cả hai)', () => {
  const runs = C.cleanRuns([{ startIndex: 3, format: { foregroundColor: { red: 1 }, foregroundColorStyle: { rgbColor: { red: 1 } }, bold: true } }]);
  assert.deepStrictEqual(runs, [{ startIndex: 3, format: { foregroundColorStyle: { rgbColor: { red: 1 } }, bold: true } }]);
});

test('isFormula / hasChips / hasDateFormat', () => {
  assert.strictEqual(C.isFormula({ userEnteredValue: { formulaValue: '=A1' } }), true);
  assert.strictEqual(C.isFormula({ userEnteredValue: { stringValue: '=A1' } }), false);
  assert.strictEqual(C.hasChips({ chipRuns: [{ startIndex: 0 }] }), true);
  assert.strictEqual(C.hasChips({}), false);
  assert.strictEqual(C.hasDateFormat({ userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }), true);
  assert.strictEqual(C.hasDateFormat({}), false);
});

test('sameValue so cả kiểu lẫn giá trị', () => {
  assert.strictEqual(C.sameValue({ userEnteredValue: { numberValue: 46280 } }, { userEnteredValue: { numberValue: 46280 } }), true);
  assert.strictEqual(C.sameValue({ userEnteredValue: { stringValue: '46280' } }, { userEnteredValue: { numberValue: 46280 } }), false);
  assert.strictEqual(C.sameValue({}, {}), true);
});

test('snapshot giữ giá trị, đoạn định dạng, định dạng số; linkRuns lấy vị trí + uri', () => {
  const cell = {
    userEnteredValue: { stringValue: 'Link: x' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'x' } } }],
    userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
    formattedValue: 'Link: x',
  };
  assert.deepStrictEqual(C.snapshot(cell), {
    userEnteredValue: { stringValue: 'Link: x' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'x' } } }],
    numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' },
  });
  assert.deepStrictEqual(C.linkRuns(cell), [{ at: 6, uri: 'x' }]);
  assert.strictEqual(C.cellText(cell), 'Link: x');
  assert.strictEqual(C.cellText({ userEnteredValue: { numberValue: 3 } }), '');
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/sheets/cell_values.test.js`
Expected: FAIL — `Cannot find module './cell_values'`.

- [ ] **Step 3: Tạo `src/sheets/cell_values.js`**

```js
// ============================================================================
// cell_values.js: đọc/dựng giá trị 1 ô cho bộ ghi Sheet.
//
// Ô "Kết quả thực hiện" của QC là rich-text: chữ + các đoạn định dạng (textFormatRuns),
// trong đó có link. Ghi đè bằng giá trị thường sẽ xoá mất link. Nên phần nối thêm:
//   · giữ NGUYÊN chữ cũ từng ký tự (chỉ số các đoạn cũ tính theo chữ đó),
//   · gửi lại nguyên các đoạn cũ,
//   · thêm 1 đoạn định dạng trống ngay chỗ nối — không có nó, link cuối của nội dung cũ
//     "loang" sang cả phần mới,
//   · gắn link thật cho URL video.
// ============================================================================

const DATE_TYPES = new Set(['DATE', 'DATE_TIME']);

/** Danh sách giá trị cho phép của ô có danh sách chọn; null nếu ô không giới hạn */
function allowedValues(cell) {
  const dv = cell && cell.dataValidation;
  if (!dv || !dv.condition || dv.condition.type !== 'ONE_OF_LIST') return null;
  return (dv.condition.values || []).map((v) => String(v.userEnteredValue == null ? '' : v.userEnteredValue));
}

/** Chữ đang gõ trong ô ('' nếu ô trống, là số/bool/công thức) */
function cellText(cell) {
  const v = cell && cell.userEnteredValue;
  return v && v.stringValue !== undefined ? String(v.stringValue) : '';
}

function isFormula(cell) {
  return Boolean(cell && cell.userEnteredValue && cell.userEnteredValue.formulaValue !== undefined);
}

function hasChips(cell) {
  return Boolean(cell && Array.isArray(cell.chipRuns) && cell.chipRuns.length);
}

function hasDateFormat(cell) {
  const nf = cell && cell.userEnteredFormat && cell.userEnteredFormat.numberFormat;
  return Boolean(nf && DATE_TYPES.has(nf.type));
}

/** Định dạng của 1 đoạn, bỏ màu kiểu cũ khi đã có màu kiểu mới (API không nhận cả hai) */
function cleanFormat(format) {
  const f = { ...(format || {}) };
  if (f.foregroundColorStyle && f.foregroundColor) delete f.foregroundColor;
  return f;
}

/** Các đoạn định dạng để gửi lại: chỉ startIndex (bỏ khi = 0) + format */
function cleanRuns(runs) {
  return (runs || []).map((r) => {
    const out = {};
    if (r.startIndex) out.startIndex = r.startIndex;
    out.format = cleanFormat(r.format);
    return out;
  });
}

/**
 * Ô Kết quả mới = chữ cũ nguyên vẹn + dòng mới.
 * @returns {{ text: string, runs: object[], appendedAt: number, videoAt: number }}
 */
function buildAppendedResultCell(existingCell, entryText, videoUrl) {
  const oldText = cellText(existingCell);
  const sep = oldText && !oldText.endsWith('\n') ? '\n' : '';
  const appendedAt = oldText.length;
  const text = oldText + sep + entryText;
  const runs = cleanRuns(existingCell && existingCell.textFormatRuns);
  if (oldText) runs.push({ startIndex: appendedAt, format: {} });

  let videoAt = -1;
  if (videoUrl) {
    const rel = entryText.lastIndexOf(videoUrl);
    if (rel !== -1) {
      videoAt = appendedAt + sep.length + rel;
      runs.push({ startIndex: videoAt, format: { link: { uri: videoUrl } } });
      const end = videoAt + videoUrl.length;
      if (end < text.length) runs.push({ startIndex: end, format: {} });
    }
  }
  return { text, runs, appendedAt, videoAt };
}

/** Các link (vị trí + uri) trong 1 ô — để kiểm link cũ còn nguyên sau khi ghi */
function linkRuns(cell) {
  return ((cell && cell.textFormatRuns) || [])
    .filter((r) => r.format && r.format.link && r.format.link.uri)
    .map((r) => ({ at: r.startIndex || 0, uri: r.format.link.uri }));
}

/** Bản chụp 1 ô để ghi nhật ký / hoàn tác */
function snapshot(cell) {
  const out = {};
  if (cell && cell.userEnteredValue) out.userEnteredValue = cell.userEnteredValue;
  if (cell && cell.textFormatRuns && cell.textFormatRuns.length) out.textFormatRuns = cleanRuns(cell.textFormatRuns);
  const nf = cell && cell.userEnteredFormat && cell.userEnteredFormat.numberFormat;
  if (nf) out.numberFormat = nf;
  return out;
}

/** Hai ô có cùng giá trị gõ vào không (so cả kiểu: chữ '46280' khác số 46280) */
function sameValue(a, b) {
  const x = (a && a.userEnteredValue) || {};
  const y = (b && b.userEnteredValue) || {};
  return ['stringValue', 'numberValue', 'boolValue', 'formulaValue'].every((k) => x[k] === y[k]);
}

/** CellData để ghi lại từ 1 bản chụp (dùng cho hoàn tác) */
function valueFromSnapshot(snap) {
  const value = {};
  if (snap && snap.userEnteredValue) value.userEnteredValue = snap.userEnteredValue;
  if (snap && snap.textFormatRuns) value.textFormatRuns = snap.textFormatRuns;
  if (snap && snap.numberFormat) value.userEnteredFormat = { numberFormat: snap.numberFormat };
  return value;
}

module.exports = {
  allowedValues,
  cellText,
  isFormula,
  hasChips,
  hasDateFormat,
  cleanRuns,
  buildAppendedResultCell,
  linkRuns,
  snapshot,
  sameValue,
  valueFromSnapshot,
};
```

- [ ] **Step 4: Tạo `src/sheets/testkit.js`** (hỗ trợ test — tên không kết thúc `.test.js` nên không bị chạy như test)

```js
// ============================================================================
// testkit.js: Sheet giả lập trong bộ nhớ + dữ liệu mẫu cho test bộ ghi / hoàn tác.
//
// Giả lập đúng những hành vi bộ ghi dựa vào: đọc lưới (chuỗi hiển thị), đọc chi tiết ô,
// updateCells theo mặt nạ `fields`, và chặn giá trị ngoài danh sách chọn strict như API
// thật (cả lượt thất bại, không ô nào bị ghi).
// ============================================================================

const os = require('os');
const path = require('path');
const { posKey } = require('./sheets_client');

const clone = (v) => JSON.parse(JSON.stringify(v));

function createFakeSheet({ title = 'V1 ', gid = 7, rows = [] } = {}) {
  const cells = new Map();
  const key = (r, c) => `${r}:${c}`;
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === undefined || v === null || v === '') return;
      cells.set(key(r, c), typeof v === 'object' ? clone(v) : { userEnteredValue: { stringValue: String(v) } });
    })
  );
  const calls = { readGrid: 0, readCells: 0, batchUpdate: [] };
  const hooks = { beforeReadCells: null, afterUpdate: null, failUpdate: null };

  const shown = (cell) => {
    const v = cell && cell.userEnteredValue;
    if (!v) return '';
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.numberValue !== undefined) return String(v.numberValue);
    if (v.boolValue !== undefined) return v.boolValue ? 'TRUE' : 'FALSE';
    return '';
  };
  const checkTitle = (t) => {
    if (t !== title) {
      const e = new Error(`[SHEET] giả lập: không có tab "${t}"`);
      e.status = 400;
      throw e;
    }
  };
  const tabOf = (range) => {
    const m = /^'((?:[^']|'')*)'!/.exec(range);
    return m ? m[1].replace(/''/g, "'") : '';
  };

  const client = {
    spreadsheetId: 'fake',
    saEmail: 'fake@sa',
    async readGrid(t) {
      checkTitle(t);
      calls.readGrid += 1;
      let maxR = -1;
      let maxC = -1;
      for (const k of cells.keys()) {
        const [r, c] = k.split(':').map(Number);
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
      const out = [];
      for (let r = 0; r <= maxR; r += 1) {
        const row = [];
        for (let c = 0; c <= maxC; c += 1) row.push(shown(cells.get(key(r, c))));
        while (row.length && row[row.length - 1] === '') row.pop();
        out.push(row);
      }
      return out;
    },
    async readCells(ranges) {
      calls.readCells += 1;
      if (hooks.beforeReadCells) await hooks.beforeReadCells(calls.readCells);
      return ranges.map((rg) => {
        checkTitle(tabOf(rg));
        const cell = cells.get(posKey(rg));
        return cell ? clone(cell) : {};
      });
    },
    async batchUpdate(requests) {
      if (hooks.failUpdate) {
        const e = hooks.failUpdate;
        hooks.failUpdate = null;
        throw e;
      }
      for (const req of requests) {
        const u = req.updateCells;
        if (!u) continue;
        if (u.start.sheetId !== gid) {
          const e = new Error('[SHEET] giả lập: sai sheetId');
          e.status = 400;
          throw e;
        }
        const cur = cells.get(key(u.start.rowIndex, u.start.columnIndex)) || {};
        const val = u.rows[0].values[0];
        const dv = cur.dataValidation;
        const s = val.userEnteredValue && val.userEnteredValue.stringValue;
        if (dv && dv.strict && dv.condition.type === 'ONE_OF_LIST' && s !== undefined) {
          const allowed = dv.condition.values.map((x) => x.userEnteredValue);
          if (!allowed.includes(s)) {
            const e = new Error('[SHEET] ghi Sheet: HTTP 400 — Invalid value violates data validation');
            e.status = 400;
            throw e;
          }
        }
      }
      for (const req of requests) {
        const u = req.updateCells;
        if (!u) continue;
        const k = key(u.start.rowIndex, u.start.columnIndex);
        const cur = clone(cells.get(k) || {});
        const val = u.rows[0].values[0];
        for (const f of u.fields.split(',').map((x) => x.trim())) {
          if (f === 'userEnteredValue') {
            if (val.userEnteredValue) cur.userEnteredValue = clone(val.userEnteredValue);
            else delete cur.userEnteredValue;
          } else if (f === 'textFormatRuns') {
            if (val.textFormatRuns && val.textFormatRuns.length) cur.textFormatRuns = clone(val.textFormatRuns);
            else delete cur.textFormatRuns;
          } else if (f === 'userEnteredFormat.numberFormat') {
            const nf = val.userEnteredFormat && val.userEnteredFormat.numberFormat;
            cur.userEnteredFormat = cur.userEnteredFormat || {};
            if (nf) cur.userEnteredFormat.numberFormat = clone(nf);
            else delete cur.userEnteredFormat.numberFormat;
          } else {
            throw new Error(`giả lập: chưa hỗ trợ field ${f}`);
          }
        }
        cells.set(k, cur);
      }
      calls.batchUpdate.push(requests);
      if (hooks.afterUpdate) await hooks.afterUpdate();
      return { replies: [] };
    },
    async canEdit() {
      return true;
    },
  };

  return {
    title,
    gid,
    cells,
    calls,
    hooks,
    client,
    get: (a1) => clone(cells.get(posKey(`'x'!${a1}`)) || {}),
    set: (a1, cell) => cells.set(posKey(`'x'!${a1}`), clone(cell)),
  };
}

/** Chèn 1 dòng trống ở rowIdx (0-based): mọi ô từ dòng đó dời xuống 1 */
function insertRowAt(sheet, rowIdx) {
  const moved = new Map();
  for (const [k, v] of sheet.cells) {
    const [r, c] = k.split(':').map(Number);
    moved.set(r >= rowIdx ? `${r + 1}:${c}` : k, v);
  }
  sheet.cells.clear();
  for (const [k, v] of moved) sheet.cells.set(k, v);
}

const STATUS_LIST = ['DONE', 'Fail', 'Doing', 'Cancel', 'Pending', 'Đề xuất'];
const ENV_LIST = ['Beta', 'Localhost', 'Production'];
const listDv = (values) => ({
  dataValidation: { strict: true, condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) } },
});
const DATE_FMT = { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } };

/**
 * Tab V1 thu nhỏ đúng bố cục thật: 3 dòng tiêu đề, vòng 1 rộng 7 cột có FEEDBACK AI,
 * vòng 2 bắt đầu cột M. Dòng 4 = EVAL_V1_001 đã có kết quả vòng 1 kèm link rich-text.
 */
function makeV1Sheet() {
  const header = ['DONE25', '', '', '', '', 'TEST LẦN 1', '', '', '', '', '', '', 'TEST LẦN 2'];
  const sub = [
    'ID', '  Function', 'Tiêu đề', 'Mô tả', 'Nền tảng',
    'Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'FEEDBACK AI', 'FIXED', 'Test Date',
    'Ưu tiên', ' Môi trường', 'Trạng thái', 'Kết quả thực hiện', 'DEV /QC NOTE', 'FIXED', 'Test Date',
  ];
  const s = createFakeSheet({
    title: 'V1 - fEvaluation - VIBE ',
    gid: 1086276772,
    rows: [header, sub, ['TÊN TICKET'], ['EVAL_V1_001'], ['EVAL_V1_002']],
  });
  s.set('G4', { ...listDv(ENV_LIST), userEnteredValue: { stringValue: 'Localhost' } });
  s.set('H4', { ...listDv(STATUS_LIST), userEnteredValue: { stringValue: 'DONE' } });
  s.set('I4', {
    userEnteredValue: { stringValue: 'Link: https://jam.dev/c/1' },
    textFormatRuns: [{ format: {} }, { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } }],
  });
  s.set('L4', { ...DATE_FMT, userEnteredValue: { numberValue: 46280 } });
  s.set('N4', listDv(ENV_LIST));
  s.set('O4', listDv(STATUS_LIST));
  s.set('S4', DATE_FMT);
  return s;
}

function baseEntry(over = {}) {
  return {
    caseId: 'EVAL_V1_001',
    round: 1,
    pass: true,
    runId: 'a1b2c3d4-e5f6',
    startedAt: new Date(2026, 8, 28, 10, 15).toISOString(),
    envLabel: 'Localhost',
    profile: 'default',
    steps: [{ label: 'B1 Mở module Đánh giá', ok: true }],
    checks: [],
    resultText: 'Đúng như mong muốn.',
    videoUrl: 'https://files.catbox.moe/abc.mp4',
    runDir: null,
    ...over,
  };
}

/** Nhật ký trong bộ nhớ, cùng giao diện với createAuditLog */
function memoryAudit() {
  const entries = [];
  return {
    filePath: '(bộ nhớ)',
    entries,
    append(e) {
      entries.push(e);
      return e;
    },
    list() {
      return entries.slice();
    },
    find(id) {
      return entries.find((e) => e.auditId === id) || null;
    },
  };
}

function tmpFile(name = 'audit') {
  return path.join(os.tmpdir(), `fe2-${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

module.exports = { createFakeSheet, insertRowAt, makeV1Sheet, baseEntry, memoryAudit, tmpFile, STATUS_LIST, ENV_LIST };
```

- [ ] **Step 5: Chạy test**

Run: `node --test src/sheets/cell_values.test.js`
Expected: PASS.

---

### Task 6: Bộ ghi Sheet

**Files:**
- Create: `src/sheets/sheet_writer.js`
- Test: `src/sheets/sheet_writer.test.js`

- [ ] **Step 1: Viết test** — `src/sheets/sheet_writer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createSheetWriter } = require('./sheet_writer');
const { makeV1Sheet, baseEntry, memoryAudit, insertRowAt } = require('./testkit');
const { toSheetsDateSerial } = require('../engine/result_text');

const setup = () => {
  const s = makeV1Sheet();
  const audit = memoryAudit();
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: audit });
  return { s, audit, w };
};

test('ghi đủ 4 ô vòng 1: Trạng thái, Kết quả nối thêm giữ link cũ, Môi trường, Test Date là số ngày', async () => {
  const { s, audit, w } = setup();
  const info = await w.writeResult(baseEntry({ pass: false, reviewCause: 'app', resultText: 'Nút Lưu bị mờ.' }));
  assert.strictEqual(info.state, 'written');
  assert.strictEqual(info.already, false);
  assert.deepStrictEqual(info.cells, { status: 'H4', result: 'I4', env: 'G4', testDate: 'L4' });
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'Fail');
  assert.strictEqual(s.get('G4').userEnteredValue.stringValue, 'Localhost');
  assert.strictEqual(s.get('L4').userEnteredValue.numberValue, toSheetsDateSerial(new Date(2026, 8, 28)));
  const text = s.get('I4').userEnteredValue.stringValue;
  assert.ok(text.startsWith('Link: https://jam.dev/c/1\n[Tự động] 28/09/2026 10:15 · vòng 1 · hồ sơ default · #a1b2c3d4'));
  assert.ok(text.includes('Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — Nút Lưu bị mờ.'));
  const runs = s.get('I4').textFormatRuns;
  assert.deepStrictEqual(runs[1], { startIndex: 6, format: { link: { uri: 'https://jam.dev/c/1' } } });
  assert.ok(runs.some((r) => r.format.link && r.format.link.uri === 'https://files.catbox.moe/abc.mp4'));
  assert.strictEqual(audit.entries.length, 1);
  assert.strictEqual(audit.entries[0].verified, true);
  assert.strictEqual(audit.entries[0].cells.find((c) => c.key === 'status').before.userEnteredValue.stringValue, 'DONE');
});

test('ghi lại đúng lần chạy đó thì không nhân đôi (chống ghi trùng #runId)', async () => {
  const { s, w } = setup();
  await w.writeResult(baseEntry());
  const once = s.get('I4').userEnteredValue.stringValue;
  const again = await w.writeResult(baseEntry());
  assert.strictEqual(again.already, true);
  assert.strictEqual(s.get('I4').userEnteredValue.stringValue, once);
  assert.strictEqual(s.calls.batchUpdate.length, 1);
});

test('vòng 2 còn trống: ô Kết quả không có dòng trống thừa ở đầu', async () => {
  const { s, w } = setup();
  const info = await w.writeResult(baseEntry({ round: 2 }));
  assert.deepStrictEqual(info.cells, { status: 'O4', result: 'P4', env: 'N4', testDate: 'S4' });
  assert.ok(s.get('P4').userEnteredValue.stringValue.startsWith('[Tự động]'));
  assert.strictEqual(s.get('O4').userEnteredValue.stringValue, 'DONE');
});

test('[AN TOÀN] mã xuất hiện 2 lần ở cột A → DỪNG, không ghi gì', async () => {
  const { s, w } = setup();
  s.set('A6', { userEnteredValue: { stringValue: 'EVAL_V1_001' } });
  await assert.rejects(() => w.writeResult(baseEntry()), /xuất hiện 2 lần.*dòng 4, 6/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('--row chọn đúng 1 trong các dòng trùng thì ghi đúng dòng đó', async () => {
  const { s, w } = setup();
  s.set('A6', { userEnteredValue: { stringValue: 'EVAL_V1_001' } });
  const info = await w.writeResult(baseEntry({ row: 6 }));
  assert.strictEqual(info.cells.status, 'H6');
  assert.strictEqual(s.get('H4').userEnteredValue.stringValue, 'DONE');
});

test('[AN TOÀN] --row trỏ dòng của mã khác → DỪNG', async () => {
  const { w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ row: 5 })), /Sai dòng!.*--row=5/);
});

test('[AN TOÀN] vòng không có cột → DỪNG, nêu các vòng đang có', async () => {
  const { s, w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ round: 9 })), /TEST LẦN 9.*Sheet đang có vòng: 1, 2/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('Sheet chèn dòng giữa lúc đọc lưới và lúc đọc sống → làm mới lưới 1 lần rồi ghi đúng dòng mới', async () => {
  const { s, w } = setup();
  s.hooks.beforeReadCells = (n) => {
    if (n === 1) insertRowAt(s, 3);
  };
  const info = await w.writeResult(baseEntry());
  assert.strictEqual(info.cells.status, 'H5');
  assert.strictEqual(s.get('H5').userEnteredValue.stringValue, 'DONE');
  assert.deepStrictEqual(s.get('H4'), {});
});

test('[AN TOÀN] dòng dời liên tục → DỪNG, không ghi', async () => {
  const { s, w } = setup();
  s.hooks.beforeReadCells = (n) => {
    if (n <= 2) insertRowAt(s, 3);
  };
  await assert.rejects(() => w.writeResult(baseEntry()), /Sai dòng!/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('[AN TOÀN] Trạng thái không nằm trong danh sách chọn → DỪNG trước khi ghi', async () => {
  const { s, w } = setup();
  const h4 = s.get('H4');
  h4.dataValidation.condition.values = [{ userEnteredValue: 'Doing' }];
  s.set('H4', h4);
  await assert.rejects(() => w.writeResult(baseEntry()), /chỉ nhận Doing/);
  assert.strictEqual(s.calls.batchUpdate.length, 0);
});

test('nhãn Môi trường không có trong danh sách chọn → bỏ qua cột đó + cảnh báo', async () => {
  const { s, w } = setup();
  const info = await w.writeResult(baseEntry({ envLabel: 'Staging' }));
  assert.strictEqual(info.cells.env, undefined);
  assert.match(info.warnings.join(' | '), /Staging/);
  assert.strictEqual(s.get('G4').userEnteredValue.stringValue, 'Localhost');
});

test('không có nhãn Môi trường (host lạ) → bỏ qua cột Môi trường', async () => {
  const { w } = setup();
  const info = await w.writeResult(baseEntry({ envLabel: null }));
  assert.strictEqual(info.cells.env, undefined);
  assert.match(info.warnings.join(' | '), /chưa có nhãn Môi trường/);
});

test('[AN TOÀN] ô Kết quả đang là công thức → DỪNG', async () => {
  const { s, w } = setup();
  s.set('I4', { userEnteredValue: { formulaValue: '=HYPERLINK("https://x")' } });
  await assert.rejects(() => w.writeResult(baseEntry()), /công thức/);
});

test('ô Test Date chưa có định dạng ngày thì đặt thêm định dạng dd/mm/yyyy', async () => {
  const { s, w } = setup();
  s.set('L4', {});
  await w.writeResult(baseEntry());
  assert.strictEqual(s.get('L4').userEnteredFormat.numberFormat.pattern, 'dd/mm/yyyy');
});

test('đọc lại sau khi ghi không khớp → lỗi có auditId, nhật ký verified=false', async () => {
  const { s, audit, w } = setup();
  s.hooks.afterUpdate = () => {
    const h4 = s.get('H4');
    h4.userEnteredValue = { stringValue: 'Doing' };
    s.set('H4', h4);
  };
  await assert.rejects(
    () => w.writeResult(baseEntry()),
    (err) => {
      assert.match(err.message, /không khớp ở H4/);
      assert.strictEqual(err.auditId, audit.entries[0].auditId);
      return true;
    }
  );
  assert.strictEqual(audit.entries[0].verified, false);
});

test('[AN TOÀN] thiếu link video / pass không phải boolean / vòng sai → DỪNG', async () => {
  const { w } = setup();
  await assert.rejects(() => w.writeResult(baseEntry({ videoUrl: '' })), /thiếu link video/);
  await assert.rejects(() => w.writeResult(baseEntry({ pass: 'yes' })), /pass phải là true hoặc false/);
  await assert.rejects(() => w.writeResult(baseEntry({ round: 0 })), /vòng/);
});

test('enqueue ghi tuần tự: 2 lần ghi cùng lúc không chồng lên nhau', async () => {
  const { s, w } = setup();
  const [a, b] = await Promise.all([w.enqueue(baseEntry()), w.enqueue(baseEntry({ round: 2, runId: 'b1b2c3d4-0000' }))]);
  assert.strictEqual(a.cells.status, 'H4');
  assert.strictEqual(b.cells.status, 'O4');
  assert.strictEqual(s.calls.batchUpdate.length, 2);
});

test('lỗi ở lần ghi trước không làm kẹt hàng đợi', async () => {
  const { w } = setup();
  await assert.rejects(() => w.enqueue(baseEntry({ round: 9 })));
  const ok = await w.enqueue(baseEntry());
  assert.strictEqual(ok.state, 'written');
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/sheets/sheet_writer.test.js`
Expected: FAIL — `Cannot find module './sheet_writer'`.

- [ ] **Step 3: Tạo `src/sheets/sheet_writer.js`**

```js
// ============================================================================
// sheet_writer.js: ghi kết quả 1 lần chạy vào 4 ô của vòng test, qua Sheets API.
//
// Thứ tự chốt (dừng ở chốt đầu tiên không qua — thà không ghi còn hơn ghi nhầm):
//   1. dữ liệu vào hợp lệ (mã, vòng, pass boolean, có link video);
//   2. mã ở cột A xuất hiện ĐÚNG 1 lần (hoặc --row trỏ đúng 1 trong các dòng trùng);
//   3. khối vòng có đúng 1 cột Trạng thái + 1 cột Kết quả (tìm theo nhãn);
//   4. ĐỌC SỐNG ô cột A + 4 ô đích ngay trước khi ghi — cột A sai mã nghĩa là Sheet vừa
//      chèn/xoá dòng: làm mới lưới 1 lần, sai nữa thì DỪNG;
//   5. ô Kết quả đã có dấu #runId → lần chạy này đã ghi rồi, không ghi lại;
//   6. Trạng thái phải nằm trong danh sách chọn; ô Kết quả không là công thức/smart chip;
//   7. ghi 1 lượt batchUpdate (updateCells từng ô, giữ link cũ của ô Kết quả);
//   8. đọc lại, so theo kiểu giá trị + link cũ còn nguyên;
//   9. nhật ký trước/sau từng ô (hoàn tác được).
// ============================================================================

const crypto = require('crypto');
const G = require('../core/sheet_grid');
const { cellRange, a1Of, showSpaces } = require('./a1');
const C = require('./cell_values');
const { buildResultEntry, runTag, toSheetsDateSerial } = require('../engine/result_text');

const STATUS_PASS = 'DONE';
const STATUS_FAIL = 'Fail';
const MAX_CELL_CHARS = 50000; // giới hạn 1 ô của Google Sheets
const CASE_ID_RE = /^EVAL_[A-Z0-9_]+$/i;
const PLAIN_FIELDS = 'userEnteredValue,textFormatRuns';

function newAuditId(date = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  const d = new Date(date);
  return (
    `w${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-` +
    `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-` +
    crypto.randomBytes(3).toString('hex')
  );
}

function validateEntry(e) {
  if (!e || !CASE_ID_RE.test(String(e.caseId || ''))) {
    throw new Error(`[AN TOÀN] Mã case "${e && e.caseId}" không hợp lệ — không ghi.`);
  }
  if (!Number.isInteger(e.round) || e.round < 1) {
    throw new Error(`[AN TOÀN] vòng test "${e.round}" không hợp lệ (phải là số nguyên ≥ 1) — không ghi.`);
  }
  if (typeof e.pass !== 'boolean') {
    throw new Error(`[AN TOÀN] pass phải là true hoặc false (đang là ${JSON.stringify(e.pass)}) — không ghi.`);
  }
  if (!e.videoUrl || !/^https?:\/\//.test(String(e.videoUrl))) {
    throw new Error('[AN TOÀN] thiếu link video — không ghi kết quả không có bằng chứng.');
  }
  if (Number.isNaN(new Date(e.startedAt).getTime())) {
    throw new Error(`[AN TOÀN] startedAt "${e.startedAt}" không phải thời điểm hợp lệ — không ghi.`);
  }
  runTag(e.runId); // ném lỗi nếu runId quá ngắn
}

function updateCellRequest(sheetId, rowIndex, columnIndex, value, fields) {
  return { updateCells: { start: { sheetId, rowIndex, columnIndex }, rows: [{ values: [value] }], fields } };
}

/**
 * @param {object} o
 * @param {object} o.client     từ createSheetsClient (hoặc Sheet giả lập)
 * @param {{gid:number,title:string}} o.tab
 * @param {object} [o.auditLog] từ createAuditLog — null thì không ghi nhật ký
 * @param {Function} [o.now]
 * @param {number} [o.idCol=0]  cột mã case (0-based)
 * @param {number} [o.gridTtlMs=60000] lưới được dùng lại trong khoảng này
 */
function createSheetWriter({ client, tab, auditLog = null, now = () => new Date(), idCol = 0, gridTtlMs = 60000 }) {
  if (!client || !tab || tab.gid === undefined || !tab.title) {
    throw new Error('[SHEET] createSheetWriter cần client và tab {gid, title}');
  }
  let cached = null;
  let chain = Promise.resolve();

  async function getGrid(force) {
    if (!force && cached && Date.now() - cached.at < gridTtlMs) return cached.grid;
    const grid = await client.readGrid(tab.title);
    cached = { grid, at: Date.now() };
    return grid;
  }

  /** Tìm dòng + cột trên lưới. Ném [AN TOÀN] nếu không chắc chắn. */
  function locate(grid, e) {
    const rows = G.findRowIndices(grid, e.caseId, idCol);
    if (!rows.length) {
      throw new Error(`Không tìm thấy mã ${e.caseId} ở cột ${G.colLetter(idCol)} của tab "${showSpaces(tab.title)}".`);
    }
    let rowIdx;
    if (e.row) {
      rowIdx = Number(e.row) - 1;
      if (!rows.includes(rowIdx)) {
        throw new Error(
          `[AN TOÀN] Sai dòng! --row=${e.row} nhưng mã ${e.caseId} nằm ở dòng ` +
            `${rows.map((r) => r + 1).join(', ')}. Dừng lại, không ghi.`
        );
      }
    } else if (rows.length > 1) {
      throw new Error(
        `[AN TOÀN] Mã ${e.caseId} xuất hiện ${rows.length} lần ở cột ${G.colLetter(idCol)} ` +
          `(dòng ${rows.map((r) => r + 1).join(', ')}) — không biết dòng nào là thật. Dừng lại, không ghi.`
      );
    } else {
      rowIdx = rows[0];
    }

    const found = G.findRoundColumnsByLabel(grid, e.round);
    if (!found.ok) {
      const have = G.listRoundNumbers(grid);
      throw new Error(
        `[AN TOÀN] Không xác định được cột của TEST LẦN ${e.round}: ${found.problems.join('; ')}. ` +
          `Sheet đang có vòng: ${have.length ? have.join(', ') : '(không có)'}. Dừng lại, không ghi.`
      );
    }
    return { rowIdx, found };
  }

  async function writeResult(e) {
    validateEntry(e);

    // Chốt 2–4: tìm trên lưới rồi đọc sống; cột A lệch thì làm mới lưới đúng 1 lần.
    let rowIdx;
    let found;
    let live;
    for (let attempt = 0; ; attempt += 1) {
      const grid = await getGrid(attempt > 0);
      ({ rowIdx, found } = locate(grid, e));
      const idA1 = a1Of(rowIdx, idCol);
      const keys = ['status', 'result', 'env', 'testDate'].filter((k) => found.cols[k] !== null);
      live = await client.readCells([
        cellRange(tab.title, idA1),
        ...keys.map((k) => cellRange(tab.title, a1Of(rowIdx, found.cols[k]))),
      ]);
      const liveId = C.cellText(live[0]) || String(live[0].formattedValue || '');
      if (liveId.trim().toUpperCase() === e.caseId.trim().toUpperCase()) {
        live = Object.fromEntries(keys.map((k, i) => [k, live[i + 1] || {}]));
        break;
      }
      if (attempt >= 1) {
        throw new Error(
          `[AN TOÀN] Sai dòng! Ô ${idA1} vừa đọc = "${liveId}", không phải "${e.caseId}" — Sheet vừa ` +
            'chèn/xoá dòng? Dừng lại, không ghi.'
        );
      }
    }

    const warnings = [...found.warnings];
    const targets = [
      { key: 'status', col: found.cols.status },
      { key: 'result', col: found.cols.result },
    ];
    if (found.cols.env !== null) {
      if (!e.envLabel) {
        warnings.push('chưa có nhãn Môi trường cho TARGET_URL — bỏ qua cột Môi trường');
      } else {
        const allowed = C.allowedValues(live.env);
        if (allowed && !allowed.includes(e.envLabel)) {
          warnings.push(
            `nhãn Môi trường "${e.envLabel}" không có trong danh sách chọn của ô ` +
              `${a1Of(rowIdx, found.cols.env)} (${allowed.join(', ')}) — bỏ qua cột Môi trường`
          );
        } else {
          targets.push({ key: 'env', col: found.cols.env });
        }
      }
    }
    if (found.cols.testDate !== null) targets.push({ key: 'testDate', col: found.cols.testDate });
    for (const t of targets) {
      t.a1 = a1Of(rowIdx, t.col);
      t.cell = live[t.key] || {};
    }
    const by = Object.fromEntries(targets.map((t) => [t.key, t]));
    const cellsOf = () => Object.fromEntries(targets.map((t) => [t.key, t.a1]));

    // Chốt 5: lần chạy này đã được ghi từ trước
    const tag = runTag(e.runId);
    if (C.cellText(by.result.cell).includes(tag)) {
      return {
        state: 'written',
        already: true,
        cells: cellsOf(),
        status: C.cellText(by.status.cell),
        auditId: null,
        warnings: [...warnings, `ô ${by.result.a1} đã chứa ${tag} — lần chạy này đã được ghi từ trước, không ghi lại`],
        row: rowIdx + 1,
      };
    }

    // Chốt 6
    const statusValue = e.pass ? STATUS_PASS : STATUS_FAIL;
    const allowedStatus = C.allowedValues(by.status.cell);
    if (allowedStatus && !allowedStatus.includes(statusValue)) {
      throw new Error(
        `[AN TOÀN] Ô ${by.status.a1} chỉ nhận ${allowedStatus.join(', ')} — không có "${statusValue}". ` +
          'Dừng lại, không ghi.'
      );
    }
    if (C.isFormula(by.result.cell)) {
      throw new Error(`[AN TOÀN] Ô ${by.result.a1} đang là công thức — nối thêm sẽ phá công thức. Dừng lại, không ghi.`);
    }
    if (C.hasChips(by.result.cell)) {
      throw new Error(`[AN TOÀN] Ô ${by.result.a1} có smart chip — nối qua API sẽ mất chip. Dừng lại, không ghi.`);
    }

    const entryText = buildResultEntry({
      runId: e.runId,
      startedAt: e.startedAt,
      round: e.round,
      profile: e.profile,
      steps: e.steps || [],
      checks: e.checks || [],
      pass: e.pass,
      reviewCause: e.reviewCause,
      resultText: e.resultText,
      videoUrl: e.videoUrl,
    });
    const built = C.buildAppendedResultCell(by.result.cell, entryText, e.videoUrl);
    if (built.text.length > MAX_CELL_CHARS) {
      throw new Error(
        `[AN TOÀN] Ô ${by.result.a1} sau khi nối dài ${built.text.length} ký tự, vượt giới hạn ` +
          `${MAX_CELL_CHARS} của Google Sheets. Dừng lại, không ghi.`
      );
    }
    const serial = toSheetsDateSerial(e.startedAt);

    for (const t of targets) {
      if (t.key === 'status') {
        t.sent = { userEnteredValue: { stringValue: statusValue } };
        t.fields = PLAIN_FIELDS;
      } else if (t.key === 'env') {
        t.sent = { userEnteredValue: { stringValue: e.envLabel } };
        t.fields = PLAIN_FIELDS;
      } else if (t.key === 'result') {
        t.sent = { userEnteredValue: { stringValue: built.text }, textFormatRuns: built.runs };
        t.fields = PLAIN_FIELDS;
      } else if (C.hasDateFormat(t.cell)) {
        t.sent = { userEnteredValue: { numberValue: serial } };
        t.fields = 'userEnteredValue';
      } else {
        t.sent = {
          userEnteredValue: { numberValue: serial },
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
        };
        t.fields = 'userEnteredValue,userEnteredFormat.numberFormat';
      }
    }

    // Chốt 7: ghi 1 lượt
    await client.batchUpdate(targets.map((t) => updateCellRequest(tab.gid, rowIdx, t.col, t.sent, t.fields)));

    // Chốt 8: đọc lại
    const back = await client.readCells(targets.map((t) => cellRange(tab.title, t.a1)));
    const problems = [];
    targets.forEach((t, i) => {
      t.after = back[i] || {};
      if (!C.sameValue(t.after, t.sent)) problems.push(t.a1);
    });
    const oldLinks = C.linkRuns(by.result.cell);
    const newLinks = C.linkRuns(by.result.after);
    const lost = oldLinks.filter((l) => !newLinks.some((n) => n.at === l.at && n.uri === l.uri));
    if (lost.length) problems.push(`${by.result.a1} (mất ${lost.length} link cũ)`);

    // Chốt 9: nhật ký
    const audit = auditLog
      ? auditLog.append({
          kind: 'write',
          auditId: newAuditId(now()),
          at: now().toISOString(),
          spreadsheetId: client.spreadsheetId || null,
          runId: e.runId,
          runDir: e.runDir || null,
          caseId: e.caseId,
          round: e.round,
          reviewer: e.reviewer || null,
          tab: { gid: tab.gid, title: tab.title },
          row: rowIdx + 1,
          cells: targets.map((t) => ({
            key: t.key,
            a1: t.a1,
            col: t.col,
            fields: t.fields,
            before: C.snapshot(t.cell),
            after: C.snapshot(t.after),
          })),
          verified: problems.length === 0,
        })
      : null;

    if (problems.length) {
      const err = new Error(
        `[SHEET] Đọc lại sau khi ghi không khớp ở ${problems.join(', ')}` +
          (audit ? ` — đã ghi nhật ký ${audit.auditId}, hoàn tác được bằng: npm run undo -- ${audit.auditId}` : '') +
          '.'
      );
      err.auditId = audit ? audit.auditId : null;
      throw err;
    }

    return {
      state: 'written',
      already: false,
      cells: cellsOf(),
      status: statusValue,
      auditId: audit ? audit.auditId : null,
      warnings,
      content: built.text,
      row: rowIdx + 1,
    };
  }

  /** Ghi tuần tự: lần sau chờ lần trước xong; lần trước hỏng không làm kẹt hàng đợi. */
  function enqueue(e) {
    const p = chain.then(() => writeResult(e));
    chain = p.catch(() => {});
    return p;
  }

  return { writeResult, enqueue };
}

module.exports = { createSheetWriter, newAuditId, STATUS_PASS, STATUS_FAIL, MAX_CELL_CHARS };
```

- [ ] **Step 4: Chạy test**

Run: `node --test src/sheets/sheet_writer.test.js`
Expected: PASS toàn bộ.

---

### Task 7: Nhật ký + hoàn tác

**Files:**
- Create: `src/sheets/audit.js`
- Test: `src/sheets/audit.test.js`

- [ ] **Step 1: Viết test** — `src/sheets/audit.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { createAuditLog, undoWrite } = require('./audit');
const { createSheetWriter } = require('./sheet_writer');
const { makeV1Sheet, baseEntry, tmpFile } = require('./testkit');

async function written() {
  const s = makeV1Sheet();
  const log = createAuditLog(tmpFile());
  const before = Object.fromEntries(['G4', 'H4', 'I4', 'L4'].map((a) => [a, s.get(a)]));
  const w = createSheetWriter({ client: s.client, tab: { gid: s.gid, title: s.title }, auditLog: log });
  const info = await w.writeResult(baseEntry());
  return { s, log, before, info };
}

test('hoàn tác trả 4 ô về y như trước, kể cả link cũ', async () => {
  const { s, log, before, info } = await written();
  const r = await undoWrite({ client: s.client, auditLog: log, auditId: info.auditId, tabTitle: s.title });
  assert.deepStrictEqual(r.restored.slice().sort(), ['G4', 'H4', 'I4', 'L4']);
  assert.deepStrictEqual(r.refused, []);
  assert.strictEqual(r.verified, true);
  for (const a1 of Object.keys(before)) {
    assert.deepStrictEqual(s.get(a1).userEnteredValue, before[a1].userEnteredValue, a1);
  }
  assert.deepStrictEqual(s.get('I4').textFormatRuns, before.I4.textFormatRuns);
  assert.strictEqual(log.list().filter((e) => e.kind === 'undo').length, 1);
});

test('ô đã bị người khác sửa sau lần ghi thì từ chối ô đó, các ô còn lại vẫn hoàn tác', async () => {
  const { s, log, before, info } = await written();
  s.set('I4', { userEnteredValue: { stringValue: 'QC sửa tay' } });
  const r = await undoWrite({ client: s.client, auditLog: log, auditId: info.auditId, tabTitle: s.title });
  assert.deepStrictEqual(r.refused.map((x) => x.a1), ['I4']);
  assert.match(r.refused[0].reason, /QC sửa tay/);
  assert.strictEqual(s.get('I4').userEnteredValue.stringValue, 'QC sửa tay');
  assert.deepStrictEqual(s.get('H4').userEnteredValue, before.H4.userEnteredValue);
});

test('không hoàn tác 2 lần; auditId lạ thì báo lỗi', async () => {
  const { s, log, info } = await written();
  await undoWrite({ client: s.client, auditLog: log, auditId: info.auditId, tabTitle: s.title });
  await assert.rejects(
    () => undoWrite({ client: s.client, auditLog: log, auditId: info.auditId, tabTitle: s.title }),
    /đã được hoàn tác/
  );
  await assert.rejects(() => undoWrite({ client: s.client, auditLog: log, auditId: 'w-khong-co', tabTitle: s.title }), /Không có lần ghi/);
});

test('nhật ký NDJSON đọc lại được sau khi khởi động lại, bỏ qua dòng hỏng', () => {
  const file = tmpFile();
  const a = createAuditLog(file);
  a.append({ kind: 'write', auditId: 'w1', cells: [] });
  fs.appendFileSync(file, '{hỏng\n', 'utf8');
  a.append({ kind: 'write', auditId: 'w2', cells: [] });
  const b = createAuditLog(file);
  assert.deepStrictEqual(b.list().map((e) => e.auditId), ['w1', 'w2']);
  assert.strictEqual(b.find('w2').auditId, 'w2');
  assert.strictEqual(b.find('w9'), null);
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test src/sheets/audit.test.js`
Expected: FAIL — `Cannot find module './audit'`.

- [ ] **Step 3: Tạo `src/sheets/audit.js`**

```js
// ============================================================================
// audit.js: nhật ký mọi lần ghi Sheet (runs/.sheet-audit.ndjson) + hoàn tác.
//
// Mỗi lần ghi lưu BẢN CHỤP từng ô trước/sau (giá trị + đoạn định dạng + định dạng số),
// nên hoàn tác trả lại được cả link lẫn định dạng. Hoàn tác chỉ ghi lại ô nào VẪN ĐÚNG
// bằng giá trị mình đã ghi — ô đã bị ai sửa sau đó thì từ chối, không đè lên việc của họ.
// File NDJSON chỉ nối thêm, không sửa dòng cũ; hoàn tác là một dòng mới trỏ về dòng cũ.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { cellRange } = require('./a1');
const C = require('./cell_values');
const { newAuditId } = require('./sheet_writer');

function createAuditLog(filePath) {
  return {
    filePath,
    append(entry) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      return entry;
    },
    list() {
      if (!fs.existsSync(filePath)) return [];
      return fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    find(auditId) {
      return this.list().find((e) => e.auditId === auditId) || null;
    },
  };
}

const shortText = (cell) => {
  const t = C.cellText(cell) || String((cell && cell.formattedValue) || '');
  const flat = t.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
};

const sameRuns = (a, b) =>
  JSON.stringify((a && a.textFormatRuns) || []) === JSON.stringify((b && b.textFormatRuns) || []);

/**
 * Hoàn tác 1 lần ghi.
 * @param {object} o
 * @param {object} o.client
 * @param {object} o.auditLog
 * @param {string} o.auditId
 * @param {string} o.tabTitle  tên HIỆN TẠI của tab (tra theo gid trong nhật ký — tab có thể đã đổi tên)
 * @returns {Promise<{undoId, restored: string[], refused: {a1, reason}[], verified: boolean, runDir}>}
 */
async function undoWrite({ client, auditLog, auditId, tabTitle, reviewer = null, now = () => new Date() }) {
  const entry = auditLog.find(auditId);
  if (!entry) throw new Error(`Không có lần ghi ${auditId} trong nhật ký ${auditLog.filePath}.`);
  if (entry.kind !== 'write') throw new Error(`${auditId} không phải một lần ghi (là "${entry.kind}").`);
  const done = auditLog.list().find((x) => x.kind === 'undo' && x.undoOf === auditId);
  if (done) throw new Error(`Lần ghi ${auditId} đã được hoàn tác lúc ${done.at} (${done.auditId}).`);

  const title = tabTitle || entry.tab.title;
  const live = await client.readCells(entry.cells.map((c) => cellRange(title, c.a1)));
  const restore = [];
  const refused = [];
  entry.cells.forEach((c, i) => {
    const snap = C.snapshot(live[i]);
    if (C.sameValue(snap, c.after) && sameRuns(snap, c.after)) restore.push(c);
    else refused.push({ a1: c.a1, reason: `ô đã bị sửa sau lần ghi (hiện: "${shortText(live[i])}")` });
  });

  let verified = true;
  if (restore.length) {
    await client.batchUpdate(
      restore.map((c) => ({
        updateCells: {
          start: { sheetId: entry.tab.gid, rowIndex: entry.row - 1, columnIndex: c.col },
          rows: [{ values: [C.valueFromSnapshot(c.before)] }],
          fields: c.fields,
        },
      }))
    );
    const back = await client.readCells(restore.map((c) => cellRange(title, c.a1)));
    verified = restore.every((c, i) => C.sameValue(C.snapshot(back[i]), c.before));
  }

  const undo = auditLog.append({
    kind: 'undo',
    auditId: newAuditId(now()),
    undoOf: auditId,
    at: now().toISOString(),
    reviewer,
    spreadsheetId: entry.spreadsheetId || null,
    runId: entry.runId,
    runDir: entry.runDir || null,
    caseId: entry.caseId,
    round: entry.round,
    tab: { gid: entry.tab.gid, title },
    row: entry.row,
    cells: restore.map((c) => ({ key: c.key, a1: c.a1, col: c.col, fields: c.fields, before: c.after, after: c.before })),
    refused,
    verified,
  });

  return { undoId: undo.auditId, restored: restore.map((c) => c.a1), refused, verified, runDir: entry.runDir || null };
}

module.exports = { createAuditLog, undoWrite };
```

- [ ] **Step 4: Chạy test**

Run: `node --test src/sheets/audit.test.js`
Expected: PASS.

---

### Task 8: `openSheet()`

**Files:**
- Create: `src/sheets/index.js`

- [ ] **Step 1: Tạo `src/sheets/index.js`**

```js
// ============================================================================
// sheets/index.js: một cửa mở Sheet cho mọi tool — client + tab đã chọn + bộ ghi.
// ============================================================================

const path = require('path');
const config = require('../config');
const { createSheetsClient } = require('./sheets_client');
const { resolveTab } = require('./tab');
const { createSheetWriter } = require('./sheet_writer');
const { createAuditLog } = require('./audit');

const AUDIT_PATH = path.join(config.ROOT_DIR, 'runs', '.sheet-audit.ndjson');

/**
 * Mở Sheet theo cấu hình: đọc danh sách tab, chọn tab (gid ưu tiên, tên phải khớp
 * chính xác). Không đọc lưới — gọi readGrid() khi cần.
 */
async function openSheet({ transport, cfg = config } = {}) {
  const client = createSheetsClient({ spreadsheetId: cfg.SHEET_ID, keyFile: cfg.GOOGLE_SA_KEY_FILE, transport });
  const meta = await client.getMeta();
  const tab = resolveTab(meta, { gid: cfg.SHEET_GID, title: cfg.SHEET_TAB });
  return {
    client,
    meta,
    tab,
    readGrid: () => client.readGrid(tab.title),
    writer: () => createSheetWriter({ client, tab, auditLog: createAuditLog(AUDIT_PATH) }),
  };
}

module.exports = { openSheet, AUDIT_PATH };
```

- [ ] **Step 2: Kiểm nạp được**

Run: `node -e "console.log(Object.keys(require('./src/sheets')))"`
Expected: `[ 'openSheet', 'AUDIT_PATH' ]`

---

### Task 9: Runner ghi qua API

**Files:**
- Modify: `src/runner.js`

- [ ] **Step 1: Import** — thêm `const crypto = require('crypto');` ngay dưới `const fs = require('fs');`, và thay dòng
  `const { updateSheetResult, getOrOpenSheetPage } = require('./core/sheet_service');` bằng:

```js
// Ghi Sheet qua Google Sheets API (engine v2, kỳ 1). Đường gõ phím cũ trong
// core/sheet_service.js vẫn giữ nguyên file nhưng runner không còn gọi.
const { openSheet } = require('./sheets');
const { parseEnvLabels, resolveEnvLabel } = require('./sheets/env_label');
const { showSpaces } = require('./sheets/a1');
```

- [ ] **Step 2: Chữ ký** — `async function runOneTestcase(testcaseId, { browser, page, options }) {` →

```js
async function runOneTestcase(testcaseId, { browser, page, options, sheet }) {
```

- [ ] **Step 3: `record`** — thay đoạn mở đầu object:

```js
  const record = {
    testcaseId,
    round: options.round,
    account: config.ACCOUNT,
    targetUrl: config.TARGET_URL,
```

bằng:

```js
  const record = {
    testcaseId,
    // Mã lần chạy: 8 ký tự đầu thành dấu "#…" trong ô Kết quả để chống ghi trùng.
    runId: crypto.randomUUID(),
    round: options.round,
    account: config.ACCOUNT,
    profile: config.PROFILE_NAME,
    targetUrl: config.TARGET_URL,
    envLabel: options.envLabel || null,
```

và thay `    resultText: '',` (dòng đầu tiên trong object `record`) bằng:

```js
    resultText: '',
    steps: [],
```

- [ ] **Step 4: Lưu nhật ký bước** — ngay SAU khối `} finally { if (recorder) { … } }` (khối dừng quay video), thêm:

```js
  // Nhật ký bước vào result.json và thành các dòng ✓/✗ trong ô Kết quả thực hiện.
  record.steps = stepLog.steps.map((s) => ({ label: s.label, ok: s.ok, seconds: s.seconds, error: s.error }));
```

- [ ] **Step 5: Bỏ tab Sheet trong Chrome** — thay nguyên khối:

```js
  // 4. Mở sẵn tab Google Sheet để load song song với lúc upload Catbox.
  //    Chỉ mở sau khi đã dừng quay để tab Sheet không lọt vào video.
  let sheetPagePromise = null;
  if (options.sheet && options.upload && record.videoPath && !harnessCrashed) {
    sheetPagePromise = getOrOpenSheetPage(browser).catch((err) => {
      console.warn('[SHEET] Mở sẵn tab Sheet thất bại:', err.message);
      return null;
    });
  }
```

bằng:

```js
  // 4. (engine v2) Không còn mở tab Google Sheets trong Chrome: ghi qua API ở bước 6.
  //    Hết luôn lớp lỗi "tab Sheet đẩy tab app xuống nền, CDP treo".
```

- [ ] **Step 6: Bước ghi** — thay nguyên nhánh cuối:

```js
  } else {
    try {
      const sheetPage = sheetPagePromise ? await sheetPagePromise : null;
      const info = await phase(`${testcaseId} · ghi Google Sheet`, () =>
        updateSheetResult(browser, {
          testcaseId,
          row: options.row,
          roundNumber: options.round,
          videoUrl: record.videoUrl,
          resultText: record.resultText,
          pass: record.pass,
          page: sheetPage,
        })
      );
      record.sheetCell = info.cell;
      record.sheetStatus = info.status;
      record.sheet = { state: 'written', cell: info.cell, status: info.status };
    } catch (err) {
      console.error('[ERROR] Cập nhật Google Sheet thất bại:', err.message);
      record.sheet = { state: 'failed', reason: err.message };
    }
  }
```

bằng:

```js
  } else if (!sheet) {
    record.sheet = { state: 'skipped', reason: 'chưa mở được Google Sheet lúc khởi động (xem lỗi đầu log)' };
  } else {
    try {
      const info = await phase(`${testcaseId} · ghi Google Sheet`, () =>
        sheet.writer.enqueue({
          caseId: testcaseId,
          round: options.round,
          row: options.row,
          pass: record.pass,
          runId: record.runId,
          startedAt: record.startedAt,
          envLabel: record.envLabel,
          profile: record.profile,
          steps: record.steps,
          checks: [],
          resultText: record.resultText,
          videoUrl: record.videoUrl,
          runDir,
          reviewer: null,
        })
      );
      (info.warnings || []).forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
      console.log(
        `[SHEET] ${testcaseId} → ${info.already ? 'đã có từ trước, không ghi lại' : 'đã ghi'} ` +
          Object.entries(info.cells).map(([k, a1]) => `${k} ${a1}`).join(', ')
      );
      record.sheetCell = info.cells.result;
      record.sheetStatus = info.status;
      record.sheet = {
        state: 'written',
        cell: info.cells.result,
        cells: info.cells,
        status: info.status,
        auditId: info.auditId,
        already: info.already,
        warnings: info.warnings,
        tab: { gid: sheet.tab.gid, title: sheet.tab.title },
      };
    } catch (err) {
      console.error('[ERROR] Cập nhật Google Sheet thất bại:', err.message);
      record.sheet = { state: 'failed', reason: err.message, auditId: err.auditId || null };
    }
  }
```

- [ ] **Step 7: Mở Sheet trước khi mở Chrome** — trong `main()`, ngay SAU khối `try { config.assertReady(); } catch … return; }`, thêm:

```js
    // Nhãn Môi trường lưu vào result.json cho mọi lần chạy; chỉ BẮT BUỘC khi sẽ ghi Sheet.
    options.envLabel = resolveEnvLabel(config.TARGET_URL, parseEnvLabels(config.ENV_LABELS));

    // Mở Sheet (qua API) TRƯỚC khi mở Chrome: sai tab / thiếu quyền / host chưa có nhãn
    // Môi trường thì dừng ngay, đừng để chạy xong 5 case mới phát hiện không ghi được.
    const willWriteSheet =
      !options.authOnly && options.sheet && options.sheetOn !== 'never' && options.record && options.upload;
    let sheet = null;
    if (willWriteSheet) {
      if (!options.envLabel) {
        console.error(
          `[ERROR] [AN TOÀN] Host của TARGET_URL (${config.TARGET_URL}) chưa có nhãn Môi trường. ` +
            'Khai ENV_LABELS trong .env (vd: devtunnels.ms=Localhost) rồi chạy lại.'
        );
        process.exitCode = 1;
        return;
      }
      try {
        const opened = await phase('Mở Google Sheet (API)', () => openSheet());
        opened.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
        sheet = { tab: opened.tab, writer: opened.writer() };
        console.log(
          `[SHEET] Ghi vào tab "${showSpaces(opened.tab.title)}" (gid ${opened.tab.gid}) · ` +
            `Môi trường "${options.envLabel}"`
        );
      } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }
```

- [ ] **Step 8: Truyền `sheet` cho từng case** — `records.push(await runOneTestcase(testcaseId, { browser, page, options }));` →

```js
        records.push(await runOneTestcase(testcaseId, { browser, page, options, sheet }));
```

- [ ] **Step 9: Kiểm cú pháp + cờ**

Run: `node --check src/runner.js && node src/runner.js --nosheet EVAL_021`
Expected: dòng `[ERROR] Cờ không hợp lệ: "--nosheet"` (không mở Chrome).

---

### Task 10: `commit` qua API

**Files:**
- Modify: `src/tools/commit-result.js` (viết lại toàn bộ)

- [ ] **Step 1: Thay toàn bộ file** bằng:

```js
#!/usr/bin/env node
// ============================================================================
// commit-result.js: ghi một lần chạy ĐANG CHỜ DUYỆT (hoặc lần ghi trước bị hỏng) vào
// Google Sheet — qua Sheets API, không mở Chrome.
//
//   npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680
//   node src/tools/commit-result.js runs/<thư mục> --dry
//
// Chính sách "PASS tự ghi, FAIL chờ duyệt": case không đạt có thể là bug app, mà cũng có
// thể chỉ là kịch bản sai selector — người phân biệt được là QC sau khi xem video. Tool
// này là bước "sau khi xem": commit một FAIL nghĩa là QC xác nhận đó là lỗi app.
//
// KHÔNG chạy lại test, KHÔNG bịa dữ liệu: mọi thứ lấy nguyên từ result.json, rồi đi qua
// đúng bộ ghi src/sheets/sheet_writer.js — tức đúng mọi chốt [AN TOÀN]. Dấu #runId trong
// ô Kết quả chống ghi trùng, nên thử ghi lại lần hỏng trước là an toàn.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');

if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'dotenv'))) {
  console.error('\n✗ Chưa cài thư viện cho repo này. Chạy 1 lần: npm install\n');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
  console.error('\n✗ Chưa có file .env ở gốc repo. Tạo từ mẫu: cp .env.example .env\n');
  process.exit(1);
}

const config = require('../config');
const G = require('../core/sheet_grid');
const { openSheet } = require('../sheets');
const { parseEnvLabels, resolveEnvLabel } = require('../sheets/env_label');
const { showSpaces } = require('../sheets/a1');
const { buildResultEntry } = require('../engine/result_text');

const LINE = '='.repeat(74);
const COMMITTABLE = ['pending', 'failed'];

function parseArgs() {
  const opts = { runDir: null, dry: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry') opts.dry = true;
    else if (arg.startsWith('--account=')) continue; // config.js đã đọc lúc nạp
    else if (arg.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${arg}". Cờ hợp lệ: --dry  --account=N`);
      process.exit(1);
    } else if (!opts.runDir) opts.runDir = arg;
  }
  return opts;
}

/** Chỉ nhận thư mục nằm trong runs/ — tham số này còn đến từ giao diện */
function resolveRunDir(raw) {
  const target = path.resolve(raw);
  const rel = path.relative(path.join(ROOT_DIR, 'runs'), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`[ERROR] "${raw}" không nằm trong thư mục runs/ của repo.`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(target, 'result.json'))) {
    console.error(`[ERROR] Không thấy result.json trong ${rel}.`);
    process.exit(1);
  }
  return target;
}

function readResult(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
  } catch (err) {
    console.error(`[ERROR] result.json hỏng, không đọc được: ${err.message}`);
    process.exit(1);
  }
}

/** Dữ liệu ghi Sheet dựng từ result.json. Lần chạy cũ chưa có runId → suy cố định từ tên thư mục. */
function entryFromResult(r, runDir) {
  const runId = r.runId || crypto.createHash('sha1').update(path.basename(runDir)).digest('hex');
  return {
    caseId: r.testcaseId,
    round: Number(r.round),
    pass: r.pass === true,
    runId,
    startedAt: r.startedAt,
    envLabel: r.envLabel || resolveEnvLabel(r.targetUrl, parseEnvLabels(config.ENV_LABELS)),
    profile: r.profile || (Number(r.account) > 1 ? `slot${r.account}` : 'default'),
    steps: (r.steps || []).map((s) => ({ label: s.label, ok: s.ok, error: s.error })),
    checks: r.checks || [],
    resultText: r.resultText,
    videoUrl: r.videoUrl,
    runDir,
    reviewer: config.QC_NAME || null,
    // Commit một lần KHÔNG ĐẠT = QC đã xem video và xác nhận là lỗi app.
    reviewCause: r.pass === true ? undefined : 'app',
  };
}

async function main() {
  const opts = parseArgs();

  console.log(LINE);
  console.log('  COMMIT — ghi một lần chạy đang chờ duyệt vào Google Sheet (qua API)');
  console.log(LINE);

  if (!opts.runDir) {
    console.error('[ERROR] Thiếu thư mục run. Ví dụ:');
    console.error('        npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680');
    process.exitCode = 1;
    return;
  }

  const runDir = resolveRunDir(opts.runDir);
  const rel = path.relative(ROOT_DIR, runDir).replace(/\\/g, '/');
  const r = readResult(runDir);
  const sheetState = r.sheet || {};

  console.log(`  Lần chạy   : ${rel}`);
  console.log(`  Case       : ${r.testcaseId} · vòng ${r.round} · hồ sơ ${r.profile || `slot ${r.account}`}`);
  console.log(`  Kết quả    : ${r.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'}`);
  console.log(`  Video      : ${r.videoUrl || '(không có)'}`);
  console.log(`  Trạng thái Sheet hiện tại: ${sheetState.state}${sheetState.reason ? ' — ' + sheetState.reason : ''}`);
  console.log('');

  // Chỉ ghi thứ đang CHỜ hoặc lần ghi trước HỎNG. Không ghi lại thứ đã ghi, không ghi
  // thứ bị bỏ qua vì lỗi hạ tầng (đó không phải kết quả kiểm thử).
  if (!COMMITTABLE.includes(sheetState.state)) {
    console.error(
      `[ERROR] Lần chạy này ở trạng thái "${sheetState.state}", không phải ${COMMITTABLE.join(' / ')} — không ghi.\n` +
        '        "written" = đã ghi rồi · "skipped" = cố ý không ghi (lỗi hạ tầng, tắt bằng cờ…)'
    );
    process.exitCode = 1;
    return;
  }

  const thieu = ['testcaseId', 'round', 'videoUrl', 'startedAt'].filter((k) => !r[k]);
  if (thieu.length) {
    console.error(`[ERROR] result.json thiếu trường bắt buộc: ${thieu.join(', ')} — không đủ dữ liệu để ghi.`);
    process.exitCode = 1;
    return;
  }

  const entry = entryFromResult(r, runDir);

  let sheet;
  try {
    sheet = await openSheet();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));

  if (opts.dry) {
    const grid = await sheet.readGrid();
    const rows = G.findRowIndices(grid, entry.caseId);
    const found = G.findRoundColumnsByLabel(grid, entry.round);
    console.log(`  --dry: chỉ xem trước, KHÔNG ghi gì. Tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid})`);
    console.log(`  Dòng       : ${rows.length ? rows.map((x) => x + 1).join(', ') : '(không thấy mã)'}`);
    console.log(
      `  Cột vòng ${entry.round} : ${
        found.ok
          ? Object.entries(found.cols).filter(([, c]) => c !== null).map(([k, c]) => `${k} ${G.colLetter(c)}`).join(', ')
          : found.problems.join('; ')
      }`
    );
    console.log(`  Trạng thái : ${entry.pass ? 'DONE' : 'Fail'} · Môi trường: ${entry.envLabel || '(không có nhãn — bỏ qua cột)'}`);
    console.log('  Nối vào Kết quả thực hiện:');
    buildResultEntry(entry).split('\n').forEach((l) => console.log(`      ${l}`));
    return;
  }

  try {
    config.assertReady();
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const info = await sheet.writer().writeResult(entry);
    (info.warnings || []).forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));

    r.runId = entry.runId;
    r.envLabel = entry.envLabel;
    r.sheet = {
      state: 'written',
      cell: info.cells.result,
      cells: info.cells,
      status: info.status,
      auditId: info.auditId,
      already: info.already,
      warnings: info.warnings,
      tab: { gid: sheet.tab.gid, title: sheet.tab.title },
      committedAt: new Date().toISOString(),
      committedBy: `commit-result (${config.QC_NAME || 'không rõ'})`,
    };
    r.sheetCell = info.cells.result;
    r.sheetStatus = info.status;
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');

    console.log('');
    console.log(LINE);
    console.log(
      `  ${info.already ? 'ĐÃ CÓ TỪ TRƯỚC' : 'ĐÃ GHI'} — ${Object.entries(info.cells).map(([k, a1]) => `${k} ${a1}`).join(', ')}` +
        (info.status ? ` | Trạng thái = "${info.status}"` : '')
    );
    if (info.auditId) console.log(`  Hoàn tác nếu cần: npm run undo -- ${info.auditId}`);
    console.log(`  result.json đã cập nhật: ${rel}/result.json`);
    console.log(LINE);
  } catch (err) {
    console.error(`\n[ERROR] Ghi Sheet thất bại: ${err.message}`);
    if (err.auditId) {
      // Đã ghi nhưng đọc lại lệch — không còn là "chờ duyệt" nữa, đánh dấu để QC xem.
      r.sheet = { ...sheetState, state: 'failed', reason: err.message, auditId: err.auditId };
      fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(r, null, 2), 'utf8');
    }
    process.exitCode = 1;
  }
}

main();
```

- [ ] **Step 2: Kiểm cú pháp**

Run: `node --check src/tools/commit-result.js`
Expected: không in gì, exit 0.

---

### Task 11: `case`, `sheet:dump`, `plan`, `preflight` đọc Sheet qua API

**Files:**
- Modify: `src/tools/case-info.js`, `src/tools/sheet-dump.js`, `src/tools/plan.js`, `src/tools/preflight.js`

- [ ] **Step 1: `case-info.js`** — thay 4 dòng require đầu (`config`, `initBrowser`, `ensureAuthenticated`, `getOrOpenSheetPage/fetchGrid`, `G`) bằng:

```js
const config = require('../config');
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
const G = require('../core/sheet_grid');
```

rồi thay toàn bộ hàm `main()` bằng:

```js
async function main() {
  const opts = parseArgs();

  console.log('='.repeat(74));
  console.log('  CASE INFO — đọc mô tả testcase từ Google Sheet (qua API, không mở Chrome)');
  console.log('='.repeat(74));

  if (!opts.testcaseId) {
    console.error('[ERROR] Thiếu mã testcase. Ví dụ: node src/tools/case-info.js EVAL_025');
    process.exitCode = 1;
    return;
  }

  try {
    const sheet = await openSheet();
    sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
    const grid = await sheet.readGrid();
    const tabName = showSpaces(sheet.tab.title);
    const rowIdx = G.findRowIndex(grid, opts.testcaseId);

    if (rowIdx === -1) {
      const available = G.listCaseIds(grid);
      const prefix = opts.testcaseId.replace(/\d+$/, '');
      const near = available.filter((v) => v.toUpperCase().startsWith(prefix)).slice(0, 12);
      console.error(`\n[ERROR] Không thấy "${opts.testcaseId}" ở cột A của tab "${tabName}".`);
      console.error(`        Tab đang có ${available.length} mã, từ ${available[0]} tới ${available[available.length - 1]}.`);
      if (near.length) {
        console.error(`        Cùng tiền tố "${prefix}": ${near.join(', ')}${available.length > near.length ? ' …' : ''}`);
      }
      process.exitCode = 1;
      return;
    }

    const firstRoundCol = G.findFirstRoundColumn(grid[0] || []);
    console.log(`[CASE] ${opts.testcaseId} — dòng ${rowIdx + 1} của tab "${tabName}" (gid ${sheet.tab.gid})`);

    printSpec(grid, rowIdx);
    printRounds(grid, rowIdx, firstRoundCol, opts);

    console.log('');
    console.log('-'.repeat(74));
    console.log(`  Chạy test: npm test -- ${opts.testcaseId} --round=<N>`);
    console.log('-'.repeat(74));
  } catch (error) {
    console.error(`\n[CASE INFO] Thất bại: ${error.message}`);
    process.exitCode = 1;
  }
}
```

(Biến `config` vẫn được giữ để tương thích; nếu linter báo thừa thì giữ nguyên — không xoá.)

- [ ] **Step 2: `sheet-dump.js`** — thay 4 dòng require `initBrowser`, `ensureAuthenticated`, `getOrOpenSheetPage/fetchGrid` bằng:

```js
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
```

rồi trong `main()` thay khối từ `let instance = null;` tới hết `finally { if (instance) await instance.close(); }` bằng:

```js
  try {
    const sheet = await openSheet();
    sheet.tab.warnings.forEach((w) => console.warn(`[SHEET] ⚠ ${w}`));
    const grid = await sheet.readGrid();
    if (!grid.length) {
      throw new Error(`Tab "${showSpaces(sheet.tab.title)}" trống — kiểm SHEET_GID / SHEET_TAB trong .env.`);
    }

    const firstRoundCol = G.findFirstRoundColumn(grid[0] || []);
    // Nhãn các cột đặc tả, lấy từ chính Sheet — Sheet đổi cột thì giao diện đổi theo.
    // Bỏ cột 0: đó là cột mã, đã nằm sẵn ở trường `id` của từng case.
    const specColumns = [];
    for (let c = 1; c < firstRoundCol; c += 1) {
      specColumns.push({ index: c, label: G.columnLabel(grid, c) });
    }

    const scripted = scriptedIds();
    const roundNumbers = G.listRoundNumbers(grid);
    const cases = [];

    for (let r = 1; r < grid.length; r += 1) {
      const id = ((grid[r] || [])[0] || '').trim().toUpperCase();
      if (!/^EVAL_[A-Z0-9_]+$/.test(id)) continue;

      const spec = {};
      for (const { index, label } of specColumns) {
        const v = ((grid[r] || [])[index] || '').trim();
        if (v) spec[label] = v;
      }

      const info = G.suggestNextRound(grid, r);
      cases.push({
        id,
        row: r + 1,
        spec,
        hasScript: scripted.has(id),
        rounds: G.roundsOfCase(grid, r)
          .filter((x) => x.hasData)
          .map((x) => ({ n: x.number, status: x.status || '(trống)' })),
        nextRound: info.next,
        nextRoundHasColumn: info.columnExists,
      });
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      sheetId: config.SHEET_ID,
      sheetGid: sheet.tab.gid,
      sheetTab: sheet.tab.title,
      specColumns: specColumns.map((c) => c.label),
      roundNumbers,
      cases,
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

    const coKichBan = cases.filter((c) => c.hasScript).length;
    console.log('');
    console.log(`  Tab          : ${showSpaces(sheet.tab.title)} (gid ${sheet.tab.gid})`);
    console.log(`  Cột đặc tả   : ${payload.specColumns.join(' · ')}`);
    console.log(`  Vòng test    : ${roundNumbers.join(', ') || '(không có)'}`);
    console.log(`  Tổng số case : ${cases.length} (${coKichBan} đã có kịch bản, ${cases.length - coKichBan} chưa)`);
    console.log(`  Đã ghi cache : ${path.relative(ROOT_DIR, out).replace(/\\/g, '/')}`);
    console.log('='.repeat(74));
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    process.exitCode = 1;
  }
```

và sửa dòng tiêu đề `console.log('  SHEET DUMP — kéo toàn bộ danh sách testcase về cache');` thành
`console.log('  SHEET DUMP — kéo toàn bộ danh sách testcase về cache (qua API, không mở Chrome)');`.

- [ ] **Step 3: `plan.js`** — thay dòng `const { getOrOpenSheetPage, fetchGrid } = require('../core/sheet_service');` bằng:

```js
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
```

thêm hàm này ngay trên `async function main() {`:

```js
/**
 * Đọc lưới qua Sheets API — không cần Chrome, không phụ thuộc tab đang mở trên trình
 * duyệt. Kèm kiểm quyền SỬA của service account (hỏi Drive, không ghi thử).
 * @returns {Promise<{grid: string[][], tabTitle: string}>}
 */
async function readSheetGrid() {
  const sheet = await openSheet();
  for (const w of sheet.tab.warnings) record(false, 'Tab Sheet', w, false);
  const grid = await sheet.readGrid();
  record(true, 'Google Sheet (API)', `tab "${showSpaces(sheet.tab.title)}" (gid ${sheet.tab.gid}) — ${grid.length} dòng`);
  const canEdit = await sheet.client.canEdit();
  if (canEdit === true) {
    record(true, 'Quyền ghi Sheet', `service account ${sheet.client.saEmail} có quyền sửa`);
  } else if (canEdit === false) {
    record(false, 'Quyền ghi Sheet', `service account ${sheet.client.saEmail} CHƯA có quyền sửa — Share Sheet quyền Editor cho email này`);
  } else {
    record(false, 'Quyền ghi Sheet', 'không kiểm được qua Drive API — lần ghi đầu tiên sẽ biết', false);
  }
  return { grid, tabTitle: sheet.tab.title };
}
```

Trong `main()`: ngay trên dòng `let instance = null;` thêm:

```js
  // Sheet đọc qua API, độc lập với phiên Chrome bên dưới.
  let grid = null;
  let tabTitle = config.SHEET_TAB;
  try {
    ({ grid, tabTitle } = await readSheetGrid());
  } catch (err) {
    record(false, 'Google Sheet (API)', err.message);
  }
```

rồi xoá dòng `let grid = null;` cũ (ngay dưới `let draftNames = [];`), và xoá khối trong try của Chrome:

```js
    const sheetPage = await getOrOpenSheetPage(browser);
    grid = await fetchGrid(sheetPage);

    if (!grid) {
      throw new Error(
        'Không nạp được lưới Sheet qua CSV gviz. Kiểm tra SHEET_ID / SHEET_TAB trong .env ' +
          'và quyền truy cập của tài khoản đang đăng nhập.'
      );
    }
    record(true, 'Google Sheet', `nạp được ${grid.length} dòng của tab "${config.SHEET_TAB}"`);
```

(đoạn trên bị xoá hẳn — đây là mã gọi, không phải hàm; hàm `fetchGrid` cũ vẫn còn nguyên trong `sheet_service.js`). Đổi `const { browser, page } = instance;` thành `const { page } = instance;`. Cuối cùng thay 2 chỗ `tab "${config.SHEET_TAB}"` trong phần in từng case bằng `tab "${showSpaces(tabTitle)}"`.

- [ ] **Step 4: `preflight.js`** — thêm require dưới `const F = require('./lib/fixtures');`:

```js
const { openSheet } = require('../sheets');
const { showSpaces } = require('../sheets/a1');
```

thêm hàm trên `async function main() {`:

```js
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
```

và trong `main()` gọi `await checkSheet();` ngay sau `checkEnv();`.

- [ ] **Step 5: Kiểm cú pháp**

Run: `node --check src/tools/case-info.js && node --check src/tools/sheet-dump.js && node --check src/tools/plan.js && node --check src/tools/preflight.js`
Expected: exit 0.

---

### Task 12: Tool mới + giao diện cũ

**Files:**
- Create: `src/tools/sheet-tabs.js`, `src/tools/undo.js`, `src/tools/sheet-selftest.js`
- Modify: `src/tools/ui/server.js`, `src/tools/ui/index.html`

- [ ] **Step 1: Tạo `src/tools/sheet-tabs.js`**

```js
#!/usr/bin/env node
// ============================================================================
// sheet-tabs.js: liệt kê các tab của Google Sheet — tên THẬT (dấu cách cuối hiện ␠),
// gid, số mã case — và tab nào đang được chọn theo .env.
//
//   npm run sheet:tabs
//
// Chọn tab bằng SHEET_GID=<gid> trong .env (hoặc dán link Sheet ở tab Cấu hình của
// giao diện — link có sẵn "gid=…").
// ============================================================================

const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { resolveTab } = require('../sheets/tab');
const { showSpaces } = require('../sheets/a1');
const G = require('../core/sheet_grid');

const LINE = '='.repeat(74);

async function main() {
  console.log(LINE);
  console.log('  SHEET TABS — các tab trong Google Sheet');
  console.log(LINE);

  if (!config.SHEET_ID) {
    console.error('[ERROR] Chưa khai SHEET_ID trong .env.');
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({ spreadsheetId: config.SHEET_ID, keyFile: config.GOOGLE_SA_KEY_FILE });
  const meta = await client.getMeta();
  let active = null;
  let activeErr = null;
  try {
    active = resolveTab(meta, { gid: config.SHEET_GID, title: config.SHEET_TAB });
  } catch (err) {
    activeErr = err.message;
  }

  console.log(`  Sheet: ${meta.title}`);
  console.log('');
  for (const t of meta.tabs) {
    const grid = await client.readGrid(t.title);
    const ids = G.listCaseIds(grid);
    const mark = active && active.gid === t.gid ? '▶' : ' ';
    console.log(
      `  ${mark} "${showSpaces(t.title)}"  gid=${t.gid}${t.hidden ? ' (ẩn)' : ''}  ` +
        `${ids.length} mã${ids.length ? ` (${ids[0]} … ${ids[ids.length - 1]})` : ''}`
    );
  }
  console.log('');
  if (active) {
    console.log(`  Đang dùng: "${showSpaces(active.title)}" (gid ${active.gid})`);
    active.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  } else {
    console.log(`  ✗ ${activeErr}`);
  }
  const canEdit = await client.canEdit();
  console.log(
    `  Quyền sửa của ${client.saEmail || 'service account'}: ` +
      (canEdit === true ? 'CÓ' : canEdit === false ? 'KHÔNG — Share Sheet quyền Editor' : 'không kiểm được')
  );
  console.log('  Đổi tab: khai SHEET_GID=<gid> trong .env.');
  console.log(LINE);
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Tạo `src/tools/undo.js`**

```js
#!/usr/bin/env node
// ============================================================================
// undo.js: hoàn tác một lần ghi Sheet, theo nhật ký runs/.sheet-audit.ndjson.
//
//   npm run undo -- --list        10 lần ghi gần nhất
//   npm run undo -- <auditId>     hoàn tác
//
// Chỉ ghi lại ô nào VẪN ĐÚNG bằng giá trị tool đã ghi; ô đã bị ai sửa sau đó thì từ
// chối ô đó (không đè lên việc của người khác). Trả lại cả link và định dạng.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { createAuditLog, undoWrite } = require('../sheets/audit');
const { AUDIT_PATH } = require('../sheets');
const { showSpaces } = require('../sheets/a1');

const LINE = '='.repeat(74);

function parseArgs() {
  const o = { list: false, auditId: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--list') o.list = true;
    else if (a.startsWith('--account=')) continue;
    else if (a.startsWith('--')) {
      console.error(`[ERROR] Cờ không hợp lệ: "${a}". Cờ hợp lệ: --list  <auditId>`);
      process.exit(1);
    } else o.auditId = a;
  }
  return o;
}

function markReverted(runDir, info) {
  if (!runDir) return;
  const file = path.join(runDir, 'result.json');
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    r.sheet = { ...(r.sheet || {}), state: 'reverted', revertedAt: new Date().toISOString(), undoId: info.undoId, refused: info.refused };
    fs.writeFileSync(file, JSON.stringify(r, null, 2), 'utf8');
    console.log(`  result.json đã cập nhật: ${path.relative(config.ROOT_DIR, file)}`);
  } catch (err) {
    console.warn(`  (không cập nhật được result.json: ${err.message})`);
  }
}

async function main() {
  const o = parseArgs();
  const log = createAuditLog(AUDIT_PATH);

  console.log(LINE);
  console.log('  UNDO — hoàn tác một lần ghi Google Sheet');
  console.log(LINE);

  if (o.list || !o.auditId) {
    const all = log.list();
    const undone = new Set(all.filter((e) => e.kind === 'undo').map((e) => e.undoOf));
    const writes = all.filter((e) => e.kind === 'write').slice(-10).reverse();
    if (!writes.length) console.log('  (chưa có lần ghi nào trong nhật ký)');
    for (const w of writes) {
      console.log(
        `  ${w.auditId}  ${String(w.at).slice(0, 19).replace('T', ' ')}  ${w.caseId} vòng ${w.round}  ` +
          `${w.cells.map((c) => c.a1).join(',')}${undone.has(w.auditId) ? '  (đã hoàn tác)' : ''}` +
          `${w.verified === false ? '  ⚠ đọc lại lệch' : ''}`
      );
    }
    console.log('');
    console.log('  Hoàn tác: npm run undo -- <auditId>');
    return;
  }

  const entry = log.find(o.auditId);
  if (!entry) {
    console.error(`[ERROR] Không có ${o.auditId} trong ${path.relative(config.ROOT_DIR, AUDIT_PATH)}.`);
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({
    spreadsheetId: entry.spreadsheetId || config.SHEET_ID,
    keyFile: config.GOOGLE_SA_KEY_FILE,
  });
  const meta = await client.getMeta();
  const tab = meta.tabs.find((t) => t.gid === entry.tab.gid);
  if (!tab) {
    console.error(`[ERROR] Tab gid ${entry.tab.gid} ("${showSpaces(entry.tab.title)}") không còn trong Sheet.`);
    process.exitCode = 1;
    return;
  }

  const info = await undoWrite({ client, auditLog: log, auditId: o.auditId, tabTitle: tab.title, reviewer: config.QC_NAME || null });
  console.log(`  ${entry.caseId} vòng ${entry.round} — tab "${showSpaces(tab.title)}"`);
  console.log(`  Đã trả lại : ${info.restored.join(', ') || '(không ô nào)'}`);
  info.refused.forEach((x) => console.log(`  Từ chối    : ${x.a1} — ${x.reason}`));
  console.log(`  Đọc lại    : ${info.verified ? 'khớp' : 'LỆCH — kiểm tay'}`);
  markReverted(info.runDir, info);
  if (!info.verified || info.refused.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Tạo `src/tools/sheet-selftest.js`**

```js
#!/usr/bin/env node
// ============================================================================
// sheet-selftest.js: kiểm bộ ghi Sheet TRÊN SHEET THẬT mà không đụng tab của team.
//
//   npm run sheet:selftest
//
// Service account không tạo được Sheet riêng (403 — không có dung lượng Drive), nên
// (theo lựa chọn của user ngày 2026-09-28) tool này:
//   1. tạo tab ẨN tạm `_fe2_kiem_thu_<giờ>` trong chính Sheet đang cấu hình;
//   2. chép 5 dòng đầu của tab đang chọn sang (3 dòng tiêu đề + 2 dòng case), giữ nguyên
//      định dạng, link trong chữ, danh sách chọn — đúng những thứ bộ ghi phải giữ;
//   3. kiểm: ghi 4 ô vòng đầu tiên của case dòng 4 · link cũ còn nguyên · link video bấm
//      được · Test Date là số ngày · ghi lại không nhân đôi · vòng không có cột bị chặn ·
//      hoàn tác trả ô về y như cũ;
//   4. XOÁ tab tạm — kể cả khi có bước hỏng.
// Không bao giờ ghi tab đang chọn (V1/HUY): bộ ghi trỏ vào gid của tab tạm, và có chốt
// dừng nếu tab tạm trùng tab nguồn. Nhật ký riêng: runs/.selftest-audit.ndjson.
// ============================================================================

const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { createSheetsClient } = require('../sheets/sheets_client');
const { resolveTab } = require('../sheets/tab');
const { createSheetWriter } = require('../sheets/sheet_writer');
const { createAuditLog, undoWrite } = require('../sheets/audit');
const { cellRange, showSpaces } = require('../sheets/a1');
const C = require('../sheets/cell_values');
const G = require('../core/sheet_grid');
const { toSheetsDateSerial } = require('../engine/result_text');

const PREFIX = '_fe2_kiem_thu';
const LINE = '='.repeat(74);
const results = [];

function check(ok, label, detail = '') {
  results.push({ ok, label });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  return ok;
}

function stamp(d = new Date()) {
  const two = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

const deleteTab = (client, gid) => client.batchUpdate([{ deleteSheet: { sheetId: gid } }]);

async function main() {
  console.log(LINE);
  console.log('  SHEET SELFTEST — kiểm bộ ghi trên tab ẩn tạm, xoá tab khi xong');
  console.log(LINE);

  const missing = ['SHEET_ID', 'GOOGLE_SA_KEY_FILE'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`[ERROR] Thiếu ${missing.join(', ')} trong .env.`);
    process.exitCode = 1;
    return;
  }

  const client = createSheetsClient({ spreadsheetId: config.SHEET_ID, keyFile: config.GOOGLE_SA_KEY_FILE });
  let meta = await client.getMeta();
  const source = resolveTab(meta, { gid: config.SHEET_GID, title: config.SHEET_TAB });
  console.log(`Tab nguồn (chỉ ĐỌC 5 dòng đầu): "${showSpaces(source.title)}" (gid ${source.gid})`);

  // Dọn tab tạm sót lại từ lần kiểm trước bị ngắt — CHỈ tab mang đúng tiền tố.
  for (const t of meta.tabs.filter((x) => x.title.startsWith(PREFIX))) {
    await deleteTab(client, t.gid);
    console.log(`  dọn tab tạm cũ "${t.title}" (gid ${t.gid})`);
  }

  const sourceInfo = meta.tabs.find((t) => t.gid === source.gid);
  const width = Math.max(26, sourceInfo ? sourceInfo.cols : 80);
  const title = `${PREFIX}_${stamp()}`;
  const added = await client.batchUpdate([
    { addSheet: { properties: { title, hidden: true, gridProperties: { rowCount: 10, columnCount: width } } } },
  ]);
  const gid = added.replies[0].addSheet.properties.sheetId;
  const tmp = { gid, title };
  console.log(`Tạo tab ẩn tạm "${title}" (gid ${gid})`);

  try {
    if (tmp.gid === source.gid || !tmp.title.startsWith(PREFIX)) {
      throw new Error('[AN TOÀN] tab tạm trùng tab nguồn — dừng.');
    }
    await client.batchUpdate([
      {
        copyPaste: {
          source: { sheetId: source.gid, startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: width },
          destination: { sheetId: gid, startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: width },
          pasteType: 'PASTE_NORMAL',
          pasteOrientation: 'NORMAL',
        },
      },
    ]);

    const grid = await client.readGrid(title);
    const caseId = ((grid[3] || [])[0] || '').trim();
    const round = (G.listRounds(grid)[0] || {}).number;
    check(/^EVAL_/i.test(caseId) && Number.isInteger(round), 'Chép 5 dòng đầu sang tab tạm', `case ${caseId}, vòng ${round}`);

    const found = G.findRoundColumnsByLabel(grid, round);
    check(
      found.ok,
      `Tìm cột vòng ${round} theo nhãn`,
      found.ok
        ? Object.entries(found.cols).map(([k, v]) => `${k}=${v === null ? '-' : G.colLetter(v)}`).join(' ')
        : found.problems.join('; ')
    );
    const keys = ['status', 'result', 'env', 'testDate'].filter((k) => found.cols[k] !== null);
    const a1Of = (k) => `${G.colLetter(found.cols[k])}4`;
    const before = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const cellBefore = Object.fromEntries(keys.map((k, i) => [k, before[i]]));

    if (cellBefore.testDate) {
      const shown = String(cellBefore.testDate.formattedValue || '');
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(shown);
      const num = cellBefore.testDate.userEnteredValue && cellBefore.testDate.userEnteredValue.numberValue;
      if (m && num !== undefined) {
        const mine = toSheetsDateSerial(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
        check(mine === num, 'Công thức số ngày khớp ô Test Date thật', `${shown} = ${num}, tính ra ${mine}`);
      }
    }

    const audit = createAuditLog(path.join(config.ROOT_DIR, 'runs', '.selftest-audit.ndjson'));
    const writer = createSheetWriter({ client, tab: tmp, auditLog: audit });
    const entry = {
      caseId,
      round,
      pass: true,
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      envLabel: 'Localhost',
      profile: 'selftest',
      steps: [{ label: 'B1 Kiểm bộ ghi trên tab tạm', ok: true }],
      checks: [],
      resultText: 'Kiểm thử bộ ghi engine v2 trên tab ẩn tạm — tab sẽ bị xoá.',
      videoUrl: 'https://files.catbox.moe/selftest-engine-v2.mp4',
      runDir: null,
      reviewer: 'sheet:selftest',
    };

    // 1. Ghi
    const info = await writer.writeResult(entry);
    check(info.state === 'written' && !info.already, 'Ghi 4 ô', Object.entries(info.cells).map(([k, v]) => `${k} ${v}`).join(', '));
    (info.warnings || []).forEach((w) => console.log(`  ⚠ ${w}`));
    const after = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const cellAfter = Object.fromEntries(keys.map((k, i) => [k, after[i]]));
    const oldLinks = C.linkRuns(cellBefore.result);
    const newLinks = C.linkRuns(cellAfter.result);
    check(
      oldLinks.every((l) => newLinks.some((n) => n.at === l.at && n.uri === l.uri)),
      'Link cũ trong ô Kết quả còn nguyên',
      `${oldLinks.length} link`
    );
    check(newLinks.some((n) => n.uri === entry.videoUrl), 'Link video thành link bấm được');
    if (cellAfter.testDate) {
      const v = cellAfter.testDate.userEnteredValue || {};
      check(v.numberValue === toSheetsDateSerial(new Date(entry.startedAt)), 'Test Date là số ngày', String(cellAfter.testDate.formattedValue || ''));
    }

    // 2. Ghi lại đúng lần chạy đó
    const again = await writer.writeResult(entry);
    const [resultAgain] = await client.readCells([cellRange(title, a1Of('result'))]);
    check(again.already === true && C.cellText(resultAgain) === C.cellText(cellAfter.result), 'Ghi lại không nhân đôi (#runId)');

    // 3. Vòng không có cột
    let blocked = false;
    try {
      await writer.writeResult({ ...entry, runId: crypto.randomUUID(), round: 99 });
    } catch (err) {
      blocked = /AN TOÀN/.test(err.message);
    }
    check(blocked, 'Vòng không có cột bị chặn trước khi ghi');

    // 4. Hoàn tác
    const undo = await undoWrite({ client, auditLog: audit, auditId: info.auditId, tabTitle: title, reviewer: 'sheet:selftest' });
    const restored = await client.readCells(keys.map((k) => cellRange(title, a1Of(k))));
    const same = restored.every((c, i) => {
      const a = C.snapshot(c);
      const b = C.snapshot(before[i]);
      return C.sameValue(a, b) && JSON.stringify(a.textFormatRuns || []) === JSON.stringify(b.textFormatRuns || []);
    });
    check(undo.verified && !undo.refused.length && same, 'Hoàn tác trả ô về y như trước (cả link)', `${undo.restored.length} ô`);
  } catch (err) {
    check(false, 'Kiểm thử bị ngắt', err.message);
  } finally {
    try {
      await deleteTab(client, gid);
      meta = await client.getMeta();
      check(!meta.tabs.some((t) => t.gid === gid), 'Xoá tab tạm', `"${title}"`);
    } catch (err) {
      check(false, 'Xoá tab tạm', `${err.message} — XOÁ TAY tab ẩn "${title}" (Xem → Trang tính ẩn)`);
    }
  }

  const bad = results.filter((r) => !r.ok);
  console.log(LINE);
  console.log(
    bad.length
      ? `  CÓ ${bad.length} BƯỚC HỎNG — bộ ghi CHƯA an toàn để ghi thật`
      : `  ĐẠT ${results.length}/${results.length} — bộ ghi an toàn để ghi Sheet thật`
  );
  console.log(LINE);
  if (bad.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: `ui/server.js`** — (a) thêm require ngay dưới `const { spawn, spawnSync } = require('child_process');`:

```js
const { parseEnvLabels } = require('../../sheets/env_label');
```

(b) thay 2 mảng `READABLE_ENV` / `EDITABLE_ENV` bằng:

```js
const READABLE_ENV = ['TARGET_URL', 'SHEET_ID', 'SHEET_TAB', 'SHEET_GID', 'ORG_NAME', 'RECORD_FPS', 'CDP_PORT',
  'ENV_LABELS', 'QC_NAME', 'CLAUDE_AUTO_RUN', 'CLAUDE_MODEL', 'CLAUDE_SLOTS', 'CLAUDE_AUTO_SWITCH'];
// Biến được phép SỬA từ trình duyệt. Mật khẩu, CATBOX_USERHASH, GOOGLE_SA_KEY_FILE cố ý không có ở đây.
// CLAUDE_AUTO_RUN vẫn KHÔNG sửa được từ trang: nó mới là công tắc cho phép một nút
// web khởi động agent. CLAUDE_SLOTS/CLAUDE_AUTO_SWITCH chỉ chọn trong số tài khoản
// mà người dùng đã tự đăng nhập, không cấp thêm quyền gì.
const EDITABLE_ENV = ['TARGET_URL', 'SHEET_ID', 'SHEET_TAB', 'SHEET_GID', 'ORG_NAME', 'RECORD_FPS', 'ENV_LABELS',
  'QC_NAME', 'CLAUDE_MODEL', 'CLAUDE_SLOTS', 'CLAUDE_AUTO_SWITCH'];
```

(c) trong `validateConfig`, thay khối `if (body.SHEET_ID !== undefined) { … }` bằng:

```js
  if (body.SHEET_ID !== undefined) {
    const id = extractSheetId(String(body.SHEET_ID));
    if (!id) errors.push('SHEET_ID: không nhận ra id — dán link Sheet hoặc id đầy đủ');
    else updates.SHEET_ID = id;
    // Dán nguyên link từ thanh địa chỉ thì link có "gid=…" của đúng tab đang xem —
    // lấy luôn, QC khỏi phải biết gid là gì.
    const g = /[#?&]gid=(\d+)/.exec(String(body.SHEET_ID));
    if (g && body.SHEET_GID === undefined) updates.SHEET_GID = g[1];
  }

  if (body.SHEET_GID !== undefined) {
    const v = String(body.SHEET_GID).trim();
    if (v && !/^\d+$/.test(v)) errors.push('SHEET_GID: phải là số (số sau "gid=" trên link Sheet)');
    else updates.SHEET_GID = v;
  }

  if (body.ENV_LABELS !== undefined) {
    const v = String(body.ENV_LABELS).trim();
    try {
      parseEnvLabels(v);
      updates.ENV_LABELS = v;
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (body.QC_NAME !== undefined) {
    const v = String(body.QC_NAME).trim();
    if (/[\r\n]/.test(v) || v.length > 60) errors.push('QC_NAME: tối đa 60 ký tự, không xuống dòng');
    else updates.QC_NAME = v;
  }
```

(d) trong `buildState()`, thay dòng `const required = [...]` và `missing: required.filter((k) => !env[k]),` bằng:

```js
  const required = ['FASTDO_EMAIL', 'FASTDO_PASSWORD', 'CATBOX_USERHASH', 'TARGET_URL', 'SHEET_ID', 'GOOGLE_SA_KEY_FILE'];
  const missing = required.filter((k) => !env[k]);
  if (!env.SHEET_GID && !env.SHEET_TAB) missing.push('SHEET_GID');
```

```js
    missing,
```

- [ ] **Step 5: `ui/index.html`** — (a) trong `renderStatus()` thay dòng `it.push(c.SHEET_TAB ? … );` bằng:

```js
  it.push(c.SHEET_GID
    ? `<span class="pill info">Tab: gid ${esc(c.SHEET_GID)}</span>`
    : c.SHEET_TAB
      ? `<span class="pill warn">Tab theo tên "${esc(c.SHEET_TAB)}" — nên khai gid</span>`
      : '<span class="pill bad">Chưa chọn tab</span>');
```

(b) trong `renderConfig()`, ngay sau ô `<label class="f"><span>Tên tab trong Sheet</span>…</label>` thêm:

```html
    <label class="f"><span>ID tab (gid) — số sau "gid=" trên link; dán cả link Sheet ở ô trên là tự điền</span>
      <input id="cGid" value="${esc(c.SHEET_GID || '')}"></label>
    <label class="f"><span>Tên người duyệt (lưu vào nhật ký ghi Sheet)</span>
      <input id="cQc" value="${esc(c.QC_NAME || '')}"></label>
```

(c) trong handler `#btnSave`, thay object gửi đi bằng:

```js
      const link = $('#cSheet').value;
      const g = /[#?&]gid=(\d+)/.exec(link);
      const gidInput = $('#cGid').value.trim();
      const gid = g && gidInput === (STATE.config.SHEET_GID || '') ? g[1] : gidInput;
      const d = await api('/api/config', {
        SHEET_ID: link, SHEET_GID: gid, SHEET_TAB: $('#cTab').value, TARGET_URL: $('#cTarget').value,
        ORG_NAME: $('#cOrg').value, RECORD_FPS: $('#cFps').value, CLAUDE_MODEL: $('#cModel').value,
        QC_NAME: $('#cQc').value,
      });
```

- [ ] **Step 6: Kiểm cú pháp**

Run: `node --check src/tools/sheet-tabs.js && node --check src/tools/undo.js && node --check src/tools/sheet-selftest.js && node --check src/tools/ui/server.js`
Expected: exit 0.

---

### Task 13: Cấu hình `.env` thật (người điều phối làm, đã được user duyệt)

**Files:**
- Modify: `.env` (chỉ NỐI THÊM 2 dòng), sao lưu `.env.bak-ky1`
- Modify: `.gitignore` (thêm `.env.bak*` — bản sao lưu chứa mật khẩu, không được lọt vào git)

- [ ] **Step 1: Chặn bản sao lưu khỏi git, rồi sao lưu + nối thêm**

```bash
grep -qxF '.env.bak*' .gitignore || printf '.env.bak*\n' >> .gitignore
cp .env .env.bak-ky1 && printf '\n# --- Engine v2 kỳ 1 (thêm 2026-09-29) ---\nGOOGLE_SA_KEY_FILE=D:\\FastDo\\MCP\\service-account.json\nSHEET_GID=1086276772\n' >> .env
git check-ignore .env.bak-ky1
```

Expected: dòng cuối in `.env.bak-ky1` (đã bị git bỏ qua).

- [ ] **Step 2: Kiểm**

Run: `node -e "const c=require('./src/config'); console.log(c.SHEET_GID, require('fs').existsSync(c.GOOGLE_SA_KEY_FILE), c.missingRequired(), c.invalidConfig())"`
Expected: `1086276772 true [] []`

---

### Task 14: Kiểm thử toàn bộ

- [ ] **Step 1: Unit**

Run: `npm run test:unit`
Expected: mọi test PASS (31 cũ + các test mới).

- [ ] **Step 2: Đọc thật (chỉ đọc)**

Run: `npm run sheet:tabs`
Expected: 2 tab, `▶` ở `V1 - fEvaluation - VIBE␠` (gid 1086276772), quyền sửa CÓ.

Run: `npm run case -- EVAL_V1_001`
Expected: in đặc tả + kết quả các vòng, không mở Chrome.

Run: `npm run sheet:dump`
Expected: `Tổng số case : 275…`, cache ghi `runs/.sheet-cache.json` có `sheetGid`.

- [ ] **Step 3: Ghi thật trên tab ẩn tạm**

Run: `npm run sheet:selftest`
Expected: mọi dòng ✓, dòng cuối `ĐẠT n/n`, và dòng `✓ Xoá tab tạm`.
Sau đó chạy lại `npm run sheet:tabs` — không còn tab `_fe2_kiem_thu…`.

- [ ] **Step 4: Runner không hỏng đường nháp** (không đụng Sheet)

Run: `node src/runner.js --auth-only --account=9`
Expected: dừng ngay ở kiểm cấu hình (thiếu `FASTDO_EMAIL_9…`), không mở Chrome — chứng tỏ runner nạp được toàn bộ module mới.

---

## Tự rà kế hoạch (đã làm)

- **Phủ spec kỳ 1:** tab theo gid (Task 4, 12), lưới qua API (4, 11), tìm cột theo nhãn (2), ghi 4 ô giữ link (5, 6), danh sách chọn (5, 6), Test Date số ngày (3, 6), chống ghi trùng (3, 6), đọc sống + làm mới lưới (6), đọc lại sau ghi (6), nhật ký + hoàn tác (7, 12), `sheet:tabs`/`undo`/`selftest` (12), runner + commit + plan + preflight + case + dump (9–11), không còn tab Sheet trong Chrome (9), biến mới + `.env.example` (1). Phần gates đầy đủ (vòng bắt buộc, kịch bản đã kiểm chứng, duyệt theo nguyên nhân) thuộc kỳ 3.
- **Không placeholder**; tên hàm thống nhất giữa các task (`findRoundColumnsByLabel`, `readCells`, `createSheetWriter`, `undoWrite`, `newAuditId` export từ `sheet_writer.js` và được `audit.js` dùng).

## Prompt gốc của user liên quan kế hoạch này

> D:\FastDo\TEstAuto-Gian\fEvaluation, Tôi đang muốn update Tool này để test automation, chạy mượt, có thể chạy cùng lúc nhiều test case, viết đánh giá trong Sheet, và kèm quay video. Hãy dựa vào src code mà update tiên tiến hơn, mạnh hơn, UI/UX tốt hơn, dủng react làm giao diện cho tôi. Tuyệt đối đảm bảo việc test luốn chạy đúng quy trình, bạn có thể đề xuất thêm các Tính năng update hoặc thay thế đẻ cải thiện tốt hơn, UI có người là Tester dễ hiểu dễ dùng

> hãy tự động chạy từ đầu đến cuối cho tôi, cho đến khi có kết quả cuối cùng, tự động duyệt hết

> (lựa chọn) Tạo tab ẩn tạm, xoá sau khi kiểm

> tiếp tục chạy cho tôi
