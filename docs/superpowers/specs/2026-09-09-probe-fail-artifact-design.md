# Thiết kế: Probe DOM + Fail Artifact (cắt token vòng viết testcase)

- **Ngày:** 2026-09-09
- **Repo:** `D:\FastDo\Test-Auto`
- **Trạng thái:** đã được duyệt, chờ triển khai
- **Phạm vi:** Hướng A trong 3 hướng đã bàn (probe CLI + fail artifact + step log). Hướng B (đọc `.razor`) và C (page-object hoá, verdict `BLOCKED`) **nằm ngoài** lần này.

---

## 1. Bài toán

Runner hiện tại (`src/runner.js`) đã đạt mục tiêu tốc độ: ~32–48s/case, và **lúc chạy test gần như không tốn token** — Claude chỉ gọi 1 lệnh CLI rồi đọc 1 bảng kết quả.

Token chỉ còn cháy ở **vòng viết / sửa một testcase mới**, tại 3 chỗ:

| Chỗ cháy | Cách làm hiện tại | Chi phí |
|---|---|---|
| 1. Khám phá DOM để chọn selector | chụp màn hình / snapshot trình duyệt lặp lại | ~8–20k token cho 1 case |
| 2. Chẩn đoán khi case FAIL | chạy lại + chụp lại để xem "tại sao không click được" | ~3–6k token mỗi vòng |
| 3. Selector giòn → lặp lại vòng 1+2 | 45 chỗ selector thô trong `src/testcases/` | nhân 3–5 lần |

Đặc biệt: nguyên nhân fail phổ biến nhất đã được ghi nhận trong `SKILL.md` là **lớp phủ chặn click** (popup "Bật thông báo đẩy" phủ lên bảng danh sách; click vào nút `Sửa` im lặng không có tác dụng, **không ném lỗi nào**). Phát hiện được lỗi này bằng ảnh chụp rất đắt và hay đoán sai.

## 2. Mục tiêu

1. Claude (và người) **không cần mở trình duyệt để nhìn** khi viết hoặc sửa testcase.
2. Khi một case FAIL, thông tin đủ để sửa phải **đã có sẵn trên đĩa dưới dạng text**, không phải chạy lại để quan sát.
3. Phát hiện **click bị lớp phủ chặn** một cách máy móc, trước khi viết code.
4. Không phá 7 testcase đang chạy được (`eval_017`, `eval_019`–`eval_024`).

### Không phải mục tiêu (Non-goals)

- Không đổi engine sang Playwright. Bản hiện tại dùng `puppeteer-core` + CDP vào Chrome thật là **có chủ đích**: cần con trỏ ảo cho video và cần dùng lại session đăng nhập (`.auth/user_state.json`).
- Không viết testcase dạng YAML/DSL. `eval_020` (so danh sách tiêu chí được chào ra vs đã có, phân biệt trùng tên khác ID) là logic thật; YAML sẽ mọc escape hatch và biến thành nửa ngôn ngữ. YAGNI.
- Không refactor `src/testcases/*`, không gom selector thô về helper, không thêm verdict `BLOCKED`, không `--repeat`. Đó là hướng C, để lần sau.
- Không sửa `session.js`, `recorder.js`, `catbox.js`, `sheet_service.js`, `cursor_motion.js`, `browser.js`.

## 3. Kiến trúc

Một hàm sinh digest DOM **duy nhất**, ba nơi tiêu thụ. Đây là ràng buộc thiết kế chính: nếu có 3 bản digest khác nhau thì chúng sẽ trôi khỏi nhau và cờ độ tin cậy sẽ chỉ đúng ở 1 nơi.

```
                 src/core/dom_digest.js
                 (chạy trong page, trả text)
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
  src/tools/probe.js   ctx.dump(nhãn)   src/core/diagnostics.js
  (CLI khám phá        (gọi giữa lúc    (tự ghi khi FAIL/crash)
   trước khi viết)      đang bí)
        │                 │                     │
        └──────── diagnostics/*.txt | *.md ─────┘
                          │
                    Claude đọc text
```

| Thành phần | Vai trò | Ai gọi |
|---|---|---|
| `dom_digest.js` | sinh digest ngữ nghĩa của DOM + cờ độ tin cậy | 3 nơi dưới |
| `probe.js` | CLI khám phá trang trước khi viết case | người / Claude |
| `ctx.dump()` | dump tại đúng dòng đang bí trong case đang viết | testcase |
| `diagnostics.js` | gom step log + console + network + digest thành 1 báo cáo | `runner.js` |

## 4. `src/core/dom_digest.js`

### 4.1 API

```js
// Chuỗi JS được inject vào page (giống CURSOR_CSS_AND_JS), tránh phụ thuộc bundler
const DOM_DIGEST_FN = `...`;

/**
 * Sinh digest cho page hiện tại.
 * @param {Page} page
 * @param {object} opts
 * @param {boolean} opts.all       - true: in cả element ẩn/disabled (mặc định false)
 * @param {string}  opts.grep      - regex, lọc theo name/selector
 * @param {boolean} opts.tables    - kèm dump mọi <table> thành mảng
 * @param {boolean} opts.text      - kèm innerText của <main> (hoặc body nếu không có main)
 * @param {number}  opts.limit     - trần số element (mặc định 120)
 * @returns {Promise<string>}      - digest dạng text nhiều dòng
 */
async function digest(page, opts = {}) { ... }

/** Ghi digest ra diagnostics/<tên>.txt, trả về đường dẫn */
async function digestToFile(page, filename, opts = {}) { ... }

module.exports = { digest, digestToFile };
```

`digest()` **không ném lỗi** khi page đang điều hướng hoặc context bị huỷ — trả về chuỗi `[DIGEST] không đọc được DOM: <lý do>`. Digest là công cụ chẩn đoán; nó không được phép trở thành nguồn lỗi mới trong đường chạy fail.

### 4.2 Element nào được liệt kê

Mặc định (`all = false`): element **tương tác được và đang thấy**.

- Tập ứng viên: `a, button, input, select, textarea, [role=button], [onclick], [contenteditable=true], summary, label[for]`
- Loại bỏ nếu: `offsetParent === null`, hoặc `getBoundingClientRect()` có `width===0 || height===0`, hoặc `visibility:hidden` / `opacity:0` / `display:none`
- `#__fake_cursor` (con trỏ ảo của chính bộ test) luôn bị loại

### 4.3 Mỗi dòng gồm gì

```
#  TAG           NAME / VALUE                    SELECTOR ĐỀ XUẤT                       CỜ
01 a             "Từ chối"                       xpath: .//a[normalize-space()="Từ chối"]    ⚠ TRONG OVERLAY
07 button        "Sửa"                           xpath: .//tr[.//text()[contains(.,"EVAL_QA")]]//button[contains(.,"Sửa")]  ⚠ BỊ CHE bởi div.modal-background
12 input         placeholder="Tên nhóm" val="Nhóm A"   div.box.mb-4:nth-of-type(1) input[placeholder="Tên nhóm"]
13 input[number] val="40"                        div.box.mb-4:nth-of-type(1) .field.is-flex input[type=number]
21 button        "+ Thêm tiêu chí"               div.box.mb-4:nth-of-type(1) >> text="+ Thêm tiêu chí"    [disabled]
```

**Cột NAME** — lấy theo thứ tự đầu tiên có giá trị: `innerText` (thu gọn khoảng trắng) → `placeholder` → `aria-label` → `title` → `value` → `alt`. Truncate 60 ký tự, hậu tố `…`.

**Cột SELECTOR ĐỀ XUẤT** — chọn theo thứ tự ưu tiên độ bền, dừng ở cái đầu tiên **định danh duy nhất** trong document:

1. `#<id>` — chỉ khi id không sinh tự động (loại nếu khớp `/^[a-z]*[0-9a-f]{8,}/i`; Blazor sinh id kiểu này)
2. `[data-testid=…]` / `[data-*=…]`
3. `[placeholder=…]`, `[aria-label=…]`, `[name=…]`
4. text-XPath: `.//<tag>[normalize-space()="<text>"]`, hoặc `contains(., …)` nếu text dài hơn 40 ký tự
5. đường CSS ngắn nhất từ tổ tiên gần nhất có class "có nghĩa" (`box`, `modal`, `card`, `panel`, `table`…), dạng `div.box.mb-4:nth-of-type(1) input[type=number]`

Nếu selector không duy nhất, ghi kèm `(khớp N element)` — đây là **cảnh báo giòn**, người viết phải thu hẹp thêm.

### 4.4 Cờ độ tin cậy (phần đáng giá nhất)

| Cờ | Phát hiện bằng | Ý nghĩa cho người viết case |
|---|---|---|
| `⚠ BỊ CHE bởi <mô tả>` | `document.elementFromPoint(tâm)` trả về element **không phải** element này và không phải con của nó | **Click sẽ rơi vào lớp phủ, im lặng không có tác dụng.** Phải đóng lớp phủ trước. |
| `⚠ TRONG OVERLAY` | có tổ tiên khớp `.modal, .modal-background, [role=dialog], .notification` đang hiện | Element thuộc lớp phủ; click nó là hợp lệ, nhưng mọi thứ *bên dưới* đang bị chặn |
| `⚠ NGOÀI VIEWPORT` | `rect` nằm ngoài `innerWidth/innerHeight` | Cần `scrollIntoView` trước khi click |
| `[disabled]` | `el.disabled === true` hoặc `[aria-disabled=true]` | Click không có tác dụng |
| `[ẩn]` | chỉ xuất hiện khi `--all` | |

Mô tả element che: `tag` + tối đa 2 class đầu + `#id` nếu có, ví dụ `div.modal-background`, `section#push-popup`.

Cờ `BỊ CHE` là lý do chính của thiết kế này: nó biến lỗi tốn nhiều giờ nhất thành **một dòng text đọc được trước khi viết code**.

### 4.5 Phần phụ

- `--tables`: mỗi `<table>` in thành `TABLE #n (r dòng × c cột)` rồi các dòng dạng `| ô | ô | ô |`, trần 30 dòng/bảng. Dùng cho `eval_017`/`eval_020` (đọc bảng tiêu chí + trọng số).
- `--text`: `innerText` của `<main>` (fallback `body`), thu gọn dòng trống, trần 4000 ký tự. Dùng cho case kiểm tra thông báo lỗi / nhãn trạng thái.
- Trần `limit = 120` element. Vượt trần thì cắt và in `… còn N element nữa, dùng --grep để thu hẹp`.

## 5. `src/tools/probe.js`

### 5.1 Cách gọi

```bash
# Khám phá 1 trang
node src/tools/probe.js "/evaluation?tab=template"

# Lọc + kèm bảng
node src/tools/probe.js "/evaluation?tab=template" --grep="nhóm|tiêu chí" --tables

# Chạm trạng thái sâu (sau vài cú click)
node src/tools/probe.js "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js
```

Cờ: `--grep=<regex>` `--tables` `--text` `--all` `--limit=<n>` `--setup=<file>` `--out=<file>` `--keep-open`

Đối số vị trí đầu tiên là **path hoặc URL đầy đủ**; path được nối vào `config.TARGET_URL`.

### 5.2 Luồng

1. `initBrowser()` — tự nối vào Chrome ở port 9222 nếu đang mở, không thì tự khởi chạy. Dùng lại y nguyên, không sửa `browser.js`.
2. `ensureAuthenticated(page)` — phục hồi session từ `.auth/user_state.json` (~1.8s), **không phải đăng nhập lại**.
3. `page.goto(url)`.
4. Nếu có `--setup`: `require(file).setup(ctx)` với **đúng `ctx` mà testcase nhận** (`page`, `browser`, `click`, `type`, `waitXPath`, `clickUntil`, `setFlatpickr`) → mọi helper trong `evaluation_helpers.js` dùng được ngay.
5. `digestToFile(page, 'probe_<slug>.txt', opts)`.
6. In **15 dòng đầu + đường dẫn file** ra stdout, rồi thoát.
7. `--keep-open`: **vẫn đóng tab probe**, nhưng không `close()`/`disconnect()` Chrome — lần probe kế tiếp sẽ *nối* vào port 9222 (~0.5s) thay vì khởi chạy lại (~3s). Tab vẫn phải đóng: repo từng cần `close_stale_tabs.js` vì tab probe/test tích luỹ dần.

Bước 6 là có chủ đích: stdout ngắn để Claude không nuốt cả file; muốn xem tiếp thì `grep`/`sed` đúng phần cần.

### 5.3 `src/tools/setups/draft-editor.js` (file mẫu)

```js
const H = require('../../core/evaluation_helpers');

module.exports = {
  description: 'Mở mẫu Nháp sandbox ở chế độ Sửa, đứng tại trình soạn thảo',
  async setup(ctx) {
    const { page, click, waitXPath } = ctx;
    await H.openEvaluationTab(page, click, 'template');
    await H.openDraftByName(page, click, waitXPath, 'EVAL_QA - Mau test nhom - Bản sao');
  },
};
```

Chỉ 1 file mẫu, đủ để thấy khuôn. Không dựng sẵn thư viện setup cho mọi màn hình — thêm khi thật cần.

## 6. `ctx.dump(nhãn)`

Thêm vào `ctx` trong `runner.js`. Gọi ngay trong testcase đang viết, tại đúng dòng đang bí:

```js
async run(ctx) {
  await H.openEvaluationTab(ctx.page, ctx.click, 'template');
  await ctx.dump('sau khi mo tab template');   // → diagnostics/EVAL_025_dump_1_sau-khi-mo-tab-template.txt
  ...
}
```

Ghi file, in đường dẫn ra stdout, **không dừng test**. Đánh số tăng dần trong 1 lần chạy để nhiều `dump()` không ghi đè nhau. Đây là lối dùng dự kiến chiếm ~80% thời gian: chạy `npm test -- EVAL_025 --no-record --no-sheet` (5–10s) rồi đọc file dump.

## 7. `src/core/diagnostics.js` — fail artifact

### 7.1 Kích hoạt

`runner.js` gọi `writeFailReport()` khi `record.error` có giá trị (crash) **hoặc** `record.pass === false` (fail nghiệp vụ). Ghi ra `diagnostics/EVAL_0xx.fail.md`.

Ghi cả trường hợp FAIL nghiệp vụ, không chỉ crash: một case FAIL đúng thì báo cáo cũng là bằng chứng cho QC, còn FAIL sai thì đây là thứ cần để sửa.

### 7.2 Định dạng — markdown, không phải JSON

```markdown
# EVAL_020 — CRASH  (2026-09-09 14:32, 47.2s)

URL cuối: https://.../evaluation?tab=template&view=editor
Lỗi: Không tìm thấy mẫu Nháp "EVAL_QA - Mau test nhom" trong danh sách để mở Sửa
Selector thất bại: .//tr[.//text()[contains(.,"EVAL_QA")]]//button[contains(.,"Sửa")]

## Nhật ký bước
✓ openEvaluationTab(template)        2.1s
✗ openDraftByName("EVAL_QA...")     10.3s   ← chết ở đây

## Console error (3 dòng cuối)
- Blazor: WebSocket closed, reconnecting...

## Request lỗi (1)
- 500 POST /api/v3/evaluation/template/list

## DOM lúc chết (12 element tương tác)
[bảng digest]

Video: videos/EVAL_020_AutoRecord.mp4
```

Chọn markdown vì mục tiêu duy nhất của file này là **được đọc**. JSON tốn token cho dấu ngoặc và escape mà không thêm thông tin nào. Chưa có nhu cầu cho máy đọc; khi nào có thì thêm `--fail-json` bên cạnh, không đổi định dạng này.

### 7.3 Nguồn dữ liệu

| Mục | Lấy từ |
|---|---|
| Console error | listener `page.on('console')`, buffer cuộn 20 dòng cuối, chỉ `error`/`warning` |
| Request lỗi | listener `page.on('response')`, giữ status ≥ 400, 20 mục cuối |
| Nhật ký bước | `ctx.step()` (case mới) hoặc mảng `timings` của runner (case cũ) |
| Selector thất bại | `error.message` nếu helper ném lỗi có ghi selector; nếu không thì bỏ dòng này |
| DOM lúc chết | `digest(page)` gọi trong `catch`, bọc try/catch riêng |

Listener gắn **sau** `bringToFront()` và **trước** khi bắt đầu quay video; buffer reset đầu mỗi case để case sau không lẫn log của case trước.

## 8. `ctx.step(nhãn, fn)`

```js
const cards = await ctx.step('doc cau truc nhom', () => H.readGroupCards(page));
```

Bọc 1 bước: đo thời gian, đẩy vào `stepLog` với trạng thái `✓`/`✗`, in 1 dòng ra stdout, rồi **ném lại lỗi nguyên trạng** nếu có.

**Không bắt buộc.** 7 case cũ không dùng vẫn chạy y nguyên; chúng chỉ nhận nhật ký bước thô hơn (theo `timings` cấp case). Ai viết case mới thì dùng.

## 9. Sửa `runner.js` — 4 chỗ

| # | Vị trí | Thay đổi |
|---|---|---|
| 1 | đầu `runOneTestcase`, sau `bringToFront()` | gắn listener console/network, reset buffer |
| 2 | khối tạo `ctx` | thêm `ctx.dump`, `ctx.step` |
| 3 | `catch` + sau khi biết `record.pass` | gọi `diagnostics.writeFailReport(...)`, lưu đường dẫn vào `record.failReport` |
| 4 | bảng báo cáo cuối | in dòng `Báo cáo lỗi : diagnostics/EVAL_0xx.fail.md` khi có |

Không đổi: thứ tự các chặng, logic watchdog, quy tắc "crash hạ tầng thì KHÔNG ghi Sheet", cách tính cột Sheet.

## 10. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| `digest()` lỗi vì page đang điều hướng / context huỷ | trả chuỗi `[DIGEST] không đọc được DOM: <lý do>`, không ném |
| `writeFailReport()` lỗi (đĩa đầy, quyền ghi) | `console.warn`, không ném — không được che mất kết quả test thật |
| `--setup` file không tồn tại / `setup()` ném lỗi | probe in lỗi rõ ràng + **vẫn dump DOM tại trạng thái hiện tại** (thường đó chính là thứ cần xem) |
| `TARGET_URL` (dev tunnel) chết | `page.goto` timeout → probe in lỗi kèm nhắc kiểm tra `TARGET_URL` trong `.env` |
| `diagnostics/` chưa tồn tại | `mkdirSync recursive` khi ghi lần đầu |

## 11. Kiểm chứng

Không có test framework trong repo (`npm test` chính là runner). Kiểm chứng bằng cách chạy thật, theo thứ tự:

1. `node src/tools/probe.js "/evaluation?tab=template"` → có file `diagnostics/probe_*.txt`, digest liệt kê được `input[placeholder="Tên nhóm"]` và nút `Sửa`.
2. Kiểm chứng cờ `⚠ BỊ CHE` — **phép thử quyết định của cả thiết kế.** Popup "Bật thông báo đẩy" xuất hiện không đoán trước được, nên dùng lớp phủ chắc chắn dựng được: probe khi modal "Chọn tiêu chí" đang mở (`--setup` gọi thêm `H.openCriterionPicker`). Mọi element **phía sau** modal phải mang cờ `⚠ BỊ CHE`, và element **trong** modal phải mang `⚠ TRONG OVERLAY` mà **không** mang `BỊ CHE`. Nếu bắt gặp popup "Bật thông báo đẩy" thì kiểm tra thêm: nút `Sửa` phải mang `⚠ BỊ CHE`.
3. `node src/tools/probe.js "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js` → digest chứa DOM của trình soạn thảo, không phải danh sách.
4. `npm test -- EVAL_024 --no-record --no-sheet` → PASS như cũ (chứng minh không phá case cũ), có in nhật ký bước.
5. Tạo fail giả (sửa tạm 1 selector trong 1 bản copy case) → có `diagnostics/*.fail.md` đủ 5 mục.
6. `npm test -- EVAL_017 EVAL_024 --no-record --no-sheet` → 2 case, log console/network **không lẫn** giữa 2 case.

Bước 2 và 6 là hai chỗ dễ sai nhất, phải chạy thật, không suy luận.

## 12. File thay đổi

**Mới**
- `src/core/dom_digest.js`
- `src/core/diagnostics.js`
- `src/tools/probe.js`
- `src/tools/setups/draft-editor.js`

**Sửa**
- `src/runner.js` — 4 chỗ ở §9
- `.gitignore` — thêm `diagnostics/`
- `.claude/skills/fastdo-eval-runner/SKILL.md` — thêm mục "Khám phá DOM bằng probe, KHÔNG chụp màn hình"
- `README.md` — mục hướng dẫn `probe`
- `package.json` — script `"probe": "node src/tools/probe.js"`

**Không chạm**
`src/testcases/*` (cả 7 file), `session.js`, `recorder.js`, `catbox.js`, `sheet_service.js`, `cursor_motion.js`, `browser.js`, `config.js`

Không thêm package mới. Toàn bộ dùng `fs`/`path` của Node và puppeteer đã có.

## 13. Ngân sách token kỳ vọng

| Việc | Trước | Sau |
|---|---|---|
| Khám phá DOM để viết 1 case | 3–6 ảnh chụp ≈ 8–20k | 1 lần probe ≈ 1.5–3k |
| Mỗi vòng chẩn đoán FAIL | chạy lại + chụp ≈ 3–6k | đọc `fail.md` ≈ 0.8k |
| Tổng 1 case mới (3 vòng sửa) | ~25–40k | ~5–6k |

Chưa tính lợi ích khó đo hơn: cờ `BỊ CHE` cắt hẳn những vòng lặp chỉ để phát hiện "à, có lớp phủ".

## 14. Quyết định đã chốt

Ba câu hỏi đặt ra lúc trình thiết kế, user duyệt bằng "ok làm đi" → giữ nguyên khuyến nghị:

1. Fail artifact ghi **`.md`**, không phải `.json`.
2. Làm **cả** `--setup=<file>` và `ctx.dump()`.
3. **Có** cờ `BỊ CHE` qua `elementFromPoint`.

## 15. Sai lệch so với thiết kế, phát hiện khi triển khai

Ghi lại để lần sau đọc spec không tưởng là code làm sai.

| # | Sai lệch | Vì sao |
|---|---|---|
| 1 | Thêm `waitForSettle()` trong `probe.js` + cờ `--wait=<ms>`, `--wait-text=<chuỗi>` | Spec bỏ sót: `page.goto(waitUntil:'domcontentloaded')` trả về **trước** khi Blazor render, digest ra 0 element. Phải chờ số element đang thấy ổn định qua 3 lần đo, **và** chờ lớp phủ chặn tan (app có `div#custom-loading` phủ kín ~5s sau render). Đo lớp phủ bằng đúng thứ digest đo — tỷ lệ element bị che — không đoán theo diện tích, vì container layout hợp lệ cũng phủ kín viewport. |
| 2 | Thêm setup thứ hai `src/tools/setups/criterion-modal.js` | Spec nói chỉ 1 file mẫu, nhưng phép thử quyết định (§11 bước 2) cần một lớp phủ **dựng được theo ý muốn**; popup "Bật thông báo đẩy" xuất hiện không đoán trước. |
| 3 | Cờ che tách 2 mức: `⚠ BỊ CHE bởi X` và `· click tâm trúng X` | Trên app thật, icon trang trí trong chính field (`span.material-icons-outlined` trong ô "Tên ứng dụng") cũng bị `elementFromPoint` báo che → mọi element mang ⚠ thì cờ mất sức nặng. Phân loại theo **hình học** (cùng element cha + nhỏ hơn + không trùm hết target = trang trí), **không theo class lớp phủ**: popup chặn click có thể không mang class `.modal`/`.notification` nào, phân loại theo class sẽ đánh mất đúng ca gốc. |
| 4 | `--grep` chạy **trước** `--limit` | Bản đầu cắt theo `limit` rồi mới lọc → element khớp nằm ngoài N dòng đầu bị bỏ im lặng. Đã thấy thật: `--grep="Bản sao"` bỏ mất 3 dòng bảng ở vị trí > 40. |
| 5 | Thêm `digestRowsOnly()` cạnh `digest()` | Báo cáo fail cần phần bảng element không kèm header, để nhúng vào markdown. |

Hai bug logic đã sửa trong lúc kiểm chứng, đáng ghi lại:

- **Anchor `:nth-of-type` sai khái niệm.** Bản đầu lấy thứ tự anchor trong `document.querySelectorAll(anchorSel)`, nhưng `:nth-of-type` là thứ tự **giữa các anh em cùng tag**. Kết quả: selector `div.dropdown.is_fixed:nth-of-type(3)` khớp **0 element**. Đã đổi sang đếm anh em cùng tag; không duy nhất thì báo `(khớp N element - GIÒN)` một cách trung thực.
- **Leaf selector bỏ mất attribute phân biệt.** `div.box.mb-4:nth-of-type(1) input` khớp 2 element; phải thử thêm attribute ở leaf để ra `div.box.mb-4:nth-of-type(1) input[placeholder="Tên nhóm"]` — đúng dạng selector các testcase đang dùng.

### Đã kiểm chứng thật

| Bước (§11) | Kết quả |
|---|---|
| 1. probe trang danh sách mẫu | ✅ 54 element, selector hợp lệ, `--tables` dump đúng 11 dòng bảng mẫu |
| 2. Cờ `⚠ BỊ CHE` (phép thử quyết định) | ✅ fixture cục bộ + modal "Chọn tiêu chí" trên app thật: mọi element sau modal mang `BỊ CHE bởi div.modal-background`; element trong modal mang `TRONG OVERLAY` và **không** mang `BỊ CHE` |
| 3. `--setup` chạm trạng thái sâu | ✅ vào được editor (`view=editor&id=...`) + modal mở, digest đúng trạng thái đó |
| 4. `EVAL_024` không bị phá | ✅ PASS, chạy 2 lần trong 1 lệnh (13.5s), log console/network không lẫn giữa case |
| 5. Fail artifact | ✅ case tự kiểm chứng (đã xoá sau khi verify) sinh `EVAL_ZZZ.fail.md` đủ 5 mục + file `ctx.dump` riêng |
| 6. Log không lẫn giữa 2 case | ✅ `attachCollectors` idempotent (kiểm tra bằng so sánh tham chiếu), `reset()` đầu mỗi case |

Ghi chú vận hành: dev tunnel `TARGET_URL` có lần trả về shell Blazor mà circuit
không kết nối (probe báo trung thực `CHƯA ổn định — 0 element tương tác`); chạy
lại là bình thường. Đây là bất ổn của tunnel/app, không phải của probe.

## 16. Bổ sung sau khi đối chiếu bài viết ngoài (2026-09-10)

Nguồn: `https://apidog.com/blog/claude-code-web-app-testing-2026/` — bài content
marketing của Apidog, phần lớn không áp dụng được cho bộ test này. Đã lấy 4 kỹ
thuật, từ chối phần còn lại **có lý do**, không lấy cho đủ bộ.

### Đã lấy

| Kỹ thuật | Cài đặt |
|---|---|
| Phân loại lỗi trước khi gợi ý fix (bài gọi là "failure diagnosis workflow") | `classifyFailure()` trong `diagnostics.js`, 8 hạng, in thành mục `## Chẩn đoán` đầu `fail.md`. Hedge có chủ đích: chỉ nói "hướng xử lý", không khẳng định fix |
| Chạy check rẻ trước, fail thì bỏ qua bước đắt (bài áp cho API contract → E2E) | `src/tools/preflight.js` — 7 kiểm tra rẻ trước đắt sau, exit 1 nếu chắc chắn chết |
| Selector bền: tránh selector theo vị trí | Cờ mới `⚠ SELECTOR THEO VỊ TRÍ`, bật khi `buildSelector` phải rơi xuống tier `path` (`:nth-of-type`). `buildSelector` giờ trả thêm `kind: 'attr' \| 'text' \| 'path'` |
| Exit code 0/1 để script hoá | `runner.js`: `process.exitCode = 1` khi `passed !== records.length`. Trước đây chỉ lỗi fatal mới exit 1 nên `npm test && <lệnh sau>` vẫn chạy tiếp dù case FAIL |

Phát sinh kèm: tách `waitForSettle()` từ `probe.js` sang **`src/core/page_ready.js`**
để `preflight.js` dùng chung, thay vì nhân bản logic chờ.

### Từ chối, kèm lý do

| Bài khuyến nghị | Vì sao không lấy |
|---|---|
| `getByRole()` / `getByTestId()` | Không có API này trong `puppeteer-core`; tự map implicit ARIA role là làm quá. Tier text-XPath hiện tại (`.//button[normalize-space()="Sửa"]`) **đã là** role+name cho element native |
| Matrix cross-browser `[chromium, firefox, webkit]` | Phá kiến trúc: engine cố ý bám Chrome thật qua CDP để tái dùng session đăng nhập và inject con trỏ ảo cho video. Firefox/WebKit không có cả hai |
| Hook pre-commit / pre-push chạy test | Mỗi case 20–50s và đập vào dev tunnel sống. Chặn commit là tự hành. Repo này cũng không phải repo app |
| MSW mock, Apidog CLI | App là Blazor Server chạy backend thật; không có tầng fetch để mock, không có OpenAPI contract đang dùng |
| React Testing Library / Vue Test Utils / Jest / Vitest | Không có unit test JS trong dự án — UI là `.razor` |
| Báo cáo HTML | Trùng chức năng: Google Sheet đã là report của team, `sheet_service.js` ghi vào đó có verify |
| `--grep` chọn testcase theo tên | Đã truyền thẳng mã `EVAL_0xx`; thêm lớp lọc là tiện lợi vụn, chưa ai cần |

### Đã kiểm chứng

| Việc | Kết quả |
|---|---|
| 8 nhánh `classifyFailure` | ✅ kiểm bằng bảng input, gồm ca khó: `"Không tìm thấy mẫu Nháp X"` → `THIẾU TIỀN ĐIỀU KIỆN` (fixture), còn `"Không tìm thấy nút + Thêm tiêu chí"` → `SELECTOR KHÔNG KHỚP` (UI). Lần đầu chạy phân loại **sai** ca thứ nhất thành selector — đã sửa bằng cách phân biệt "bản ghi dữ liệu có tên" vs "control UI" |
| `LỚP PHỦ CHẶN CLICK` ưu tiên trên `SELECTOR` | ✅ digest 3/4 element bị che → xếp lớp phủ, vì triệu chứng của lớp phủ *chính là* "không tìm thấy" |
| `preflight` trên tunnel thật | ✅ 20s, báo đúng `EVAL_017/019/020` sẽ chết vì mẫu `EVAL_QA - Mau test nhom - Bản sao` không còn, `EVAL_021/022` OK; liệt kê mẫu Nháp đang có; exit 1 |
| Exit code runner | ✅ `EVAL_020` (crash) → exit 1; `EVAL_024` (pass) → exit 0 |
| Cờ `SELECTOR THEO VỊ TRÍ` | ✅ chỉ bật ở selector `tbody > tr:nth-of-type(7) > td...`, không bật ở `xpath: .//a[normalize-space()="Tạo mẫu đánh giá"]` |
| `probe` sau khi tách `waitForSettle` | ✅ vẫn ổn định 4.5s, digest không đổi |

## 17. Đóng gói thành Skill để chuyển giao (2026-09-10)

Yêu cầu: người nhận chuyển giao chỉ cần nói `test EVAL_XXX`, Claude tự chạy đủ
các bước — kể cả **đọc mô tả case từ Sheet**.

### Mảnh còn thiếu: đọc đặc tả case từ Sheet bằng CLI

`sheet_service.js` trước giờ chỉ **ghi** (và đọc để dò dòng/cột). Nhưng
`fetchGrid()` đã kéo toàn bộ lưới về qua 1 request CSV `gviz` — nên chỉ cần thêm
lớp trình bày, không phải viết lại tầng đọc.

**Mới: `src/tools/case-info.js`** (`npm run case -- EVAL_024`)

- Cắt lưới tại cột đầu tiên mang nhãn `TEST LẦN n`: bên trái là **đặc tả** (in
  đầy đủ), bên phải là **kết quả tích luỹ các vòng** (chỉ tóm tắt, `--full` /
  `--round=N` mới in hết). Cột kết quả dài hàng nghìn ký tự nên không in mặc định.
- Nhãn cột lấy theo thứ tự: dòng 2 → bố cục vòng test (`ROUND_LAYOUT`) → dòng 1 →
  số cột. Bản đầu thiếu tier `ROUND_LAYOUT` nên in ra `cột 11`, `cột 17`, `cột 29`
  cho các ô `Test Date` (dòng 2 để trống) — đã sửa.
- Case không có trong Sheet: bản đầu in cả **120 mã** ra một dòng, chính Claude
  phải đọc đống đó. Đã cắt còn "N mã, từ X tới Y" + 12 mã cùng tiền tố.

### SKILL.md viết lại thành runbook

Quy trình 6 bước, đặt trước phần tham chiếu: `preflight` → `case-info` → **chốt
vòng test với user** → kiểm file kịch bản (có/chưa → `probe` + viết) → chạy nháp
`--no-record --no-sheet` → chạy thật `--round=N`.

Ranh giới an toàn cố ý: **chạy nháp không cần hỏi** (không video, không Sheet,
không upload), **chạy thật phải chốt vòng trước** vì nó ghi vào Sheet của team và
upload video lên host công khai. Ghi sai cột `TEST LẦN` là đè lên dữ liệu QC của
vòng khác.

Mục `KHÔNG ĐƯỢC LÀM` có 6 điều, đáng chú ý:

- điều 2: chẩn đoán `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT` thì **báo bug, không sửa test cho pass**;
- điều 6: **số case mỗi lượt do user quyết định**, không tự mở rộng ngoài phạm vi
  được yêu cầu. Sheet có ~120 mã (`EVAL_001`→`EVAL_116` + biến thể `007B/047C`)
  mà chỉ 7 mã có kịch bản — nhưng danh sách **thay đổi liên tục**, nên viết trước
  cả loạt là làm ra file chết. Khoảng cách 7/120 KHÔNG phải việc tồn cần dọn.

### Đã kiểm chứng

| Việc | Kết quả |
|---|---|
| `npm run case -- EVAL_024` | ✅ đọc đúng `ID / Function / Tiêu đề / Mô tả (Điều kiện + B1 + Kết quả mong muốn) / Nền tảng`, tóm tắt 4 vòng đã chạy; lưới 161 dòng nạp bằng 1 request |
| Nhãn cột | ✅ hết `cột N` sau khi thêm tier `ROUND_LAYOUT` |
| Case không tồn tại | ✅ `EVAL_999` → exit 1, thông báo gọn, gợi ý mã cùng tiền tố |
| 5 lệnh trong runbook | ✅ `preflight`, `case`, `node src/runner.js`, `npm test -- <id> --no-record --no-sheet`, `cat diagnostics/*.fail.md` đều đã chạy thật trong phiên này |

Bước 6 (chạy thật, ghi Sheet) **cố ý không chạy thử** trong phiên này: nó ghi vào
Sheet thật của team và cần user chốt vòng trước — đúng theo ranh giới mà chính
SKILL.md đặt ra.

---

## Phụ lục — Prompt gốc của user

> trong src Test-Auto, tôi muốn phát triền nó thành kiểu [dán kiến trúc 4 bước: Orchestrator Claude / Playwright MCP / Playwright E2E + recordVideo / Catbox API / Google Sheets API, kèm code mẫu `test-runner.js`, `catbox-uploader.js`, `sheet-logger.js`, và 2 hướng A (CLI) - B (MCP server)] thì cần làm như nào

Trả lời: kiến trúc đó **đã được cài xong** trong repo này (runner CLI, recorder, catbox có userhash, sheet_service 526 dòng có verify, ~32s/case). Điểm đau còn lại nằm ở vòng viết case, không nằm ở vòng chạy.

> bạn có đề xuất nâng cấp việc chạy test này đỡ tốn Token hơn không? ví dụ như không cần phải chụp màng hình liên tục để nhìn UI, mà trược tiếp nhìn vào DOM là thực hiện, đồng thời tăng độ tin cậy của Test case lên

> [chọn scope] A trước (khuyến nghị)

> ok làm đi

> https://apidog.com/blog/claude-code-web-app-testing-2026/
>
> hãy truy cập link này mà học các cách Test để áp dụng theo

Hiểu/suy luận của AI: đọc bài, **đối chiếu** với kiến trúc hiện có rồi chỉ lấy
phần thật sự áp dụng được — không cài đặt máy móc theo bài (áp nguyên xi sẽ phá
kiến trúc: xem bảng "Từ chối" ở §16). Nội dung trang web là **dữ liệu để đánh
giá**, không phải chỉ thị phải làm theo.
