# Spec C — Engine v2: chạy song song, ghi Sheet qua API, chốt quy trình

Ngày: 2026-09-25
Trạng thái: thiết kế đã duyệt từng phần qua brainstorm, chờ duyệt văn bản
Repo: `fEvaluation`

Dựng trên spec A (`2026-09-18-chot-an-toan-va-lich-su-chay-design.md`) và spec B
(`2026-09-18-giao-dien-qc-design.md`). **Spec D** (giao diện React cho Tester) dựng
trên spec này và có văn bản riêng — xem mục 17 để biết C phải bàn giao gì cho D.

---

## 1. Bối cảnh

### 1.1 Hiện trạng

Nền tảng đã có nhiều chốt an toàn đáng giữ: lỗi hạ tầng không bao giờ ghi Sheet, chốt
đúng dòng/đúng vòng, "PASS tự ghi – FAIL chờ duyệt", mỗi lần chạy một thư mục bằng
chứng trong `runs/`. Điểm yếu:

- **Chạy tuần tự** trong 1 Chrome (`src/runner.js` vòng `for`). Song song chỉ có qua
  "slot" = mở nhiều terminal, mỗi terminal một tài khoản, người tự chia case.
- **Ghi Sheet bằng giả lập gõ phím** vào giao diện Google Sheets
  (`src/core/sheet_service.js`): ~5s/case, từng rớt/nhân đôi ký tự, bắt Chrome đăng
  nhập Google, và kéo tab app xuống nền làm CDP treo (đã từng 300s/case).
- **Watchdog không huỷ được case bị bỏ rơi** (mục "Còn tồn" của spec A): promise cũ vẫn
  điều khiển đúng cái `page` mà case kế tiếp đang dùng.
- Chỉ 1/8 kịch bản dùng `ctx.step()`, nên không có dữ liệu bước cho video hay Sheet.
- Giao diện là 1 file HTML ~800 dòng, tách log theo case bằng regex trên dòng chữ.

### 1.2 Phát hiện khi khảo sát (2026-09-25, kiểm tra chỉ đọc)

1. **`SHEET_TAB` trong `.env` không khớp tab nào.** `.env` ghi `fEvaluation - VIBE`;
   Sheet hiện có đúng 2 tab:

   | Tab | gid | Mã case |
   |---|---|---|
   | `V1 - fEvaluation - VIBE ` (có dấu cách ở cuối) | 1086276772 | 275 mã `EVAL_V1_001…275` |
   | `fEvaluation - VIBE - HUY` | 286718788 | 141 mã `EVAL_001…138` (+ biến thể 007B…) |

   Endpoint gviz khi sai tên tab lặng lẽ trả **tab đầu tiên** — đã thử ngày 2026-09-28:
   `sheet=fEvaluation - VIBE` và cả tên bịa `sheet=ten-tab-khong-ton-tai-xyz` đều trả dữ
   liệu tab V1; chỉ `sheet=fEvaluation - VIBE - HUY` mới ra tab HUY. Tức là tool **đang đọc
   đúng tab V1, nhưng chỉ vì V1 đang đứng đầu**: kéo tab khác lên đầu (hoặc chèn tab mới ở
   đầu) là tool lặng lẽ đọc tab khác, không báo lỗi; và với cấu hình này tool không bao giờ
   đọc được tab HUY của 8 kịch bản cũ. Chưa ghi nhầm là nhờ chốt "đọc sống cột A" của spec A.
   Dotenv cắt dấu cách cuối của giá trị không có ngoặc kép, nên không thể khai đúng tên tab
   có dấu cách cuối bằng `SHEET_TAB` kiểu cũ — thêm lý do để chọn tab theo gid (mục 5.2).
2. **8 kịch bản sẵn có (`EVAL_017…037`) là mã của tab HUY**; tab V1 chưa có kịch bản nào.
3. **Service account `sheets-editor@test-qc-506106.iam.gserviceaccount.com`** (key ở dự
   án `D:\FastDo\MCP`) **đọc được** Sheet này qua Sheets API (liệt kê được tab, đọc
   được dòng), và **đã có quyền sửa**: Drive API trả `capabilities.canEdit = true`
   (2026-09-28, chỉ đọc metadata, không ghi thử). Drive API đang bật trong project
   `test-qc-506106`, nên preflight kiểm được quyền sửa mà không phải ghi thử.
   Tab HUY cũng có đủ nhãn cột ở cả 10 vòng (khối 6 cột).
4. **Fastdo đang cho một tài khoản đăng nhập song song.** Popup "Tài khoản của bạn vừa
   được đăng nhập ở một nơi khác" (`FastdoServer.Blazor/Components/Layout/LayoutMain.razor:90`)
   chỉ hiện khi `auth` có giá trị, mà lệnh nạp `auth` đang bị comment (`:527`). Luồng
   "truy cập bất thường" cũng đang tắt (`Login.razor:811`, `LayoutMain.razor:564`).
5. **Bố cục thật của tab V1** (3 dòng tiêu đề, dữ liệu từ dòng 4):
   - Dòng 1: nhãn `TEST LẦN n`. Dòng 2: tên cột. Dòng 3: `TÊN TICKET`.
   - Vòng 1–5 rộng **7 cột**: `Ưu tiên | Môi trường | Trạng thái | Kết quả thực hiện |
     FEEDBACK AI (vòng 1) hoặc DEV /QC NOTE | FIXED | Test Date`.
   - Vòng 6 trở đi rộng **6 cột** (không có `FIXED`).
   - Nhãn có khoảng trắng thừa ở đầu (`" Môi trường"`, `"  Function"`).
   - Giá trị đang có: `Môi trường` = `Localhost` / `Production`, `Test Date` = `15/09/2026`.

   Offset `+2/+3` của `Trạng thái`/`Kết quả thực hiện` vẫn đúng, nhưng `Test Date` lệch
   theo vòng, và `ROUND_LAYOUT` trong `src/core/sheet_grid.js` đã lạc hậu (thiếu `FIXED`).

---

## 2. Quyết định đã chốt với user

| Câu hỏi | Chốt |
|---|---|
| Phạm vi | Tách 2 spec: **C** (engine) trước, **D** (React UI) sau |
| Chạy song song | **Hồ sơ tài khoản + khoá dữ liệu** |
| Nội dung ghi Sheet | **4 cột**: Trạng thái, Kết quả thực hiện có cấu trúc, Môi trường, Test Date |
| Mức chặt quy trình | **Chặt vừa**: chỉ bắt nháp khi kịch bản mới/đã sửa/đổi môi trường; FAIL phải duyệt kèm nguyên nhân; lỗi hạ tầng tự chạy lại 1 lần |
| Engine | **Playwright** (`playwright-core`) + bộ lập lịch và quy trình tự viết |
| Tiến trình | 1 lượt chạy / máy, N luồng trong lượt, mỗi case 1 BrowserContext mới |
| Mặc định song song | **Opt-in**: chỉ kịch bản khai `parallel: true` mới chạy song song |
| Ánh xạ Môi trường | `devtunnels.ms → Localhost`, `fastdo.vn → Production` (sửa được) |
| Duyệt FAIL | Bắt buộc chọn nguyên nhân **và** đã mở phát video |
| Phụ đề video | Dải phụ đề riêng **dưới** khung hình, không đè lên app |
| Trace | Chỉ giữ khi FAIL / LỖI HẠ TẦNG |
| Mã cũ | Giữ các file Puppeteer, không xoá, không còn được gọi |
| Phụ thuộc mới | `playwright-core@1.62.1`, `google-auth-library` |
| Làm việc trên UI | Tester làm **mọi** việc trên UI, không gõ lệnh — C cung cấp hàm thư viện, D làm giao diện + file nhấp đúp để mở |

---

## 3. Kiến trúc

### 3.1 Tổng quan

```
Lượt chạy (CLI `npm test` hoặc UI qua server)
   │
   ▼
Chốt quy trình (gates.js) ── chặn case không hợp lệ, nói rõ vì sao + lệnh sửa
   │
   ▼
Bộ lập lịch (scheduler.js) ── N luồng, khoá mã case + khoá dữ liệu, case chạy một mình
   │
   ├─ Luồng 1 ─┐   mỗi case: context mới (phiên của hồ sơ, video, trace)
   ├─ Luồng 2 ─┤   dùng chung 1 tiến trình Chrome (Playwright, channel "chrome")
   └─ Luồng 3 ─┘
         │
         ▼
Hậu kỳ video (video_post.js) ── webm → mp4 + dải phụ đề bước, tối đa 2 việc ffmpeg
         │
         ▼
Catbox (core/catbox.js, giữ nguyên)
         │
         ▼
Hàng đợi ghi Sheet (sheets/sheet_writer.js) ── 1 luồng, Sheets API, nhật ký, hoàn tác

Sự kiện JSON ở mọi bước → stdout + runs/<lượt>/events.ndjson (hợp đồng cho Spec D)
```

### 3.2 Tiến trình, khoá, huỷ

- **Mỗi lượt chạy = 1 tiến trình runner.** Bên trong, N luồng là các tác vụ async dùng
  chung một tiến trình Chrome. `PARALLEL` mặc định 3, tối đa 4.
- **Mỗi case một BrowserContext mới**: cookie/localStorage nạp từ file phiên của hồ sơ,
  video riêng, trace riêng. **Huỷ một case = đóng context của nó** → mọi thao tác đang
  treo của case đó bị huỷ ngay, không đụng context của case khác. Đây là lời giải cho
  lỗi watchdog còn tồn ở spec A.
- **Một lượt / máy**: file `runs/.runner.lock` (`pid`, `startedAt`, thư mục lượt). Lượt
  thứ hai bị từ chối kèm thông báo lượt nào đang chạy. Khoá của tiến trình đã chết
  (pid không còn sống) tự bị dọn.
- **Khoá mã case liên tiến trình**: `runs/.locks/<mã>.lock` trong suốt thời gian case
  chạy, để `npm run commit` (tiến trình khác) không ghi cùng case đó cùng lúc.
- **Khoá dữ liệu (`resources`) nằm trong bộ nhớ** của runner — đủ, vì mỗi máy chỉ có
  một runner.
- **Không còn tab Google Sheets trong Chrome.** Chrome chỉ chạy app, nên hết lớp lỗi
  "tab nền bị bóp, CDP treo". Playwright tự bật `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`
  (đã kiểm trong `playwright-core` 1.62.1), nên các cửa sổ chồng nhau vẫn chạy và quay đủ.
- **Chế độ chạy ẩn**: `HEADLESS=1` (hoặc tuỳ chọn của lượt). Mặc định hiện cửa sổ.

### 3.3 Bố cục mã nguồn

```
src/
├── runner.js                 CLI mỏng: đọc cờ → gọi engine.runBatch()
├── engine/
│   ├── index.js              runBatch, plan, preflight… (hàm thư viện cho CLI + server)
│   ├── browser_pool.js       khởi chạy Chrome qua Playwright, dựng lại khi Chrome chết
│   ├── context_factory.js    context cho 1 case: phiên hồ sơ, recordVideo, tracing, init script
│   ├── ctx.js                hợp đồng ctx v2 (mục 3.4)
│   ├── case_runner.js        vòng đời 1 case (mục 3.5)
│   ├── scheduler.js          hàng đợi, N luồng, khoá, case chạy một mình, chạy lại
│   ├── locks.js              runs/.runner.lock, runs/.locks/<mã>.lock
│   ├── gates.js              chốt quy trình — logic thuần, test được không cần trình duyệt
│   ├── verified_store.js     sổ "kịch bản đã kiểm chứng" (runs/.verified.json)
│   ├── script_meta.js        nạp kịch bản, đọc khai báo, suy resources, tính mã băm
│   ├── profiles.js           hồ sơ tài khoản từ .env, file phiên, đăng nhập 1 lần/hồ sơ
│   ├── events.js             phát sự kiện + nhận lệnh điều khiển qua stdin
│   ├── video_post.js         ffmpeg: webm → mp4 + dải phụ đề (.ass), steps.vtt
│   ├── result_v2.js          dựng result.json v2 (giữ mọi trường v1)
│   └── result_text.js        dựng nội dung "Kết quả thực hiện" (mục 5.5)
├── sheets/
│   ├── sheets_client.js      google-auth-library + REST: listTabs, readGrid, readCells, batchWrite
│   ├── sheet_writer.js       hàng đợi ghi, chốt [AN TOÀN], chống ghi trùng, đọc lại sau ghi
│   ├── audit.js              runs/.sheet-audit.ndjson + hoàn tác
│   └── env_label.js          host của TARGET_URL → nhãn Môi trường
├── core/
│   ├── sheet_grid.js         VẪN là nguồn duy nhất hiểu bố cục Sheet — mở rộng tìm cột theo nhãn
│   ├── evaluation_helpers.js port sang Playwright (giữ tên hàm, giữ hành vi)
│   ├── page_ready.js, datetime_picker.js, cursor_motion.js, dom_digest.js, diagnostics.js
│   │                         port sang Playwright
│   ├── catbox.js             giữ nguyên
│   └── browser.js, recorder.js, session.js, sheet_service.js
│                             GIỮ NGUYÊN, không còn được gọi (mục 11.3)
├── testcases/                8 kịch bản port sang ctx v2
└── tools/                    plan, preflight, case-info, sheet-dump, probe, commit-result… port
```

### 3.4 Hợp đồng kịch bản v2

```js
module.exports = {
  id: 'EVAL_V1_045',
  title: 'Tiêu đề lấy từ Sheet',
  profile: 'nhanvien',                   // hồ sơ cần dùng; bỏ trống = 'default'
  resources: ['mau:Mẫu TTS - Bản sao'],  // dữ liệu dùng chung → không chạy cùng lúc
  consumes: ['mau:Mẫu TTS - Bản sao'],   // bị tiêu hao mỗi lần chạy → cảnh báo cần thêm bản
  parallel: true,                        // tự nhận an toàn khi chạy song song; bỏ trống = chạy một mình
  timeoutSec: 150,                       // bỏ trống = 150

  async run(ctx) {
    const { page, click, step, check } = ctx;
    await step('B1 Mở tab Mẫu đánh giá', () => H.openEvaluationTab(page, click, 'template'));
    // …
    check('Banner chỉ xem hiển thị', hasBanner, { expected: 'có', actual: hasBanner ? 'có' : 'không' });
    return { pass: true, resultText: 'Mô tả cho người đọc Sheet' };
  },
};
```

`ctx` v2:

| Thành phần | Ghi chú |
|---|---|
| `page`, `context` | Playwright |
| `click(p, el, opt)`, `type(p, el, text, opt)`, `waitXPath(p, xp, to)`, `clickUntil(…)`, `setFlatpickr(…)` | **giữ đúng chữ ký cũ** để port kịch bản ít đổi nhất; `p` bỏ trống = `page` |
| `step(label, fn)` | mỗi bước → 1 dòng ✓/✗ trong Sheet + 1 mốc phụ đề video. **Bắt buộc với kịch bản mới** |
| `check(label, ok, { expected, actual })` | ghi nhận 1 phép kiểm, không ném lỗi |
| `dump(label)` | như cũ |
| `log(text)` | log có gắn mã case (song song vẫn đọc được) |
| `signal` | `AbortSignal`, bật khi case bị huỷ/hết giờ |
| `profile` | `{ name, org }` của hồ sơ đang dùng |

Luật hợp đồng (engine kiểm, sai là LỖI HẠ TẦNG loại `HỢP ĐỒNG KỊCH BẢN`, không bao giờ
thành kết quả kiểm thử):
- `pass` phải là boolean (giữ từ spec A).
- **Có `check` nào `ok = false` mà `pass = true` → vi phạm.** Chặn kiểu "sửa test cho pass".
- Kịch bản ném lỗi = LỖI HẠ TẦNG (giữ nguyên nguyên tắc cũ: lỗi chạy máy không phải kết quả).

### 3.5 Vòng đời một case

1. **Chờ khoá**: mã case + `resources`; case chạy một mình chờ mọi luồng rảnh.
2. **Hồ sơ**: bảo đảm hồ sơ đã có phiên hợp lệ trong lượt này (mục 4).
3. **Tạo context**: nạp phiên, bật `recordVideo` (1280×720), `tracing.start({ screenshots, snapshots })`,
   init script con trỏ ảo.
4. **Mở trang, bảo đảm đúng tổ chức** (`ensureOrgSelected` port lại — lựa chọn tổ chức là
   theo từng tab phía server, context mới phải chọn lại).
5. **`run(ctx)`** dưới watchdog `timeoutSec`. Hết giờ → đóng context → LỖI HẠ TẦNG `HẾT HẠN CHỜ`.
6. **Chốt kết quả**: kiểm hợp đồng; FAIL/LỖI → dựng `*.fail.md` (giữ bộ phân loại 8 hạng, thêm
   đường dẫn trace) **trước khi đóng context** để còn đọc DOM.
7. **Đóng context**: trace — giữ `trace.zip` nếu FAIL/LỖI, bỏ nếu ĐẠT; video webm hoàn tất.
8. **Hậu kỳ video** (song song với case kế tiếp): mp4 + dải phụ đề; `steps.vtt`.
9. **Catbox** (chỉ chạy thật).
10. **Quyết định ghi Sheet** theo mục 6.2; đưa vào hàng đợi ghi nếu cần.
11. **`result.json` v2** + sự kiện `case.finished`.

---

## 4. Hồ sơ tài khoản

```env
# Hồ sơ "default": giữ nguyên tên biến cũ — .env hiện tại không phải sửa
FASTDO_EMAIL=…
FASTDO_PASSWORD=…
ORG_NAME=…

# Hồ sơ có tên: PROFILE_<TÊN>_EMAIL / _PASSWORD / _ORG (ORG bỏ trống = ORG_NAME)
PROFILE_NHANVIEN_EMAIL=…
PROFILE_NHANVIEN_PASSWORD=…
PROFILE_NHANVIEN_ORG=WATER QUALITY - TEAM 1ST
```

- **Số luồng và hồ sơ độc lập nhau.** `PARALLEL` quyết định số luồng; nhiều luồng dùng
  chung một hồ sơ cùng lúc được (phát hiện 1.2.4). Hồ sơ chỉ cần thêm khi có case đòi
  **tài khoản/quyền/tổ chức khác**, và mỗi hồ sơ khai **một lần**.
- Tên hồ sơ = `<TÊN>` viết thường, chỉ `[a-z0-9_]`.
- Tương thích: `FASTDO_EMAIL_N` / `FASTDO_PASSWORD_N` / `ORG_NAME_N` cũ tự thành hồ sơ
  `slotN`; cờ `--account=N` = `--profile=slotN` (`--account=1` = `default`).
- File phiên: `.auth/<hồ sơ>.json` (Playwright `storageState`). File cũ
  `.auth/user_state*.json` (định dạng Puppeteer) **không dùng lại** — lần chạy đầu mỗi hồ sơ
  tự đăng nhập đầy đủ bằng `.env`, một lần; file cũ để nguyên.
- **Đăng nhập 1 lần / hồ sơ / lượt**, có mutex để hai luồng không cùng đăng nhập một hồ sơ:
  nạp phiên → kiểm đã vào app (không ở trang đăng nhập, đã qua màn chọn tổ chức) → nếu
  không thì đăng nhập đầy đủ (luồng của `session.js` port lại) → lưu phiên. Đăng nhập
  hỏng 2 lần → mọi case của hồ sơ đó là LỖI HẠ TẦNG `ĐĂNG NHẬP HỒ SƠ <tên> THẤT BẠI`.
- Phát hiện popup "đăng nhập ở một nơi khác" hoặc trang "truy cập bất thường" → chẩn đoán
  riêng `PHIÊN BỊ APP CHẶN` (không tự chạy lại), gợi ý giảm `PARALLEL`.
- Mật khẩu không bao giờ xuất hiện trong log, sự kiện, `result.json`.

---

## 5. Ghi Sheet qua API

### 5.1 Kết nối

- `.env`: `GOOGLE_SA_KEY_FILE=<đường dẫn file JSON key>` — bí mật, không bao giờ trả về
  trình duyệt; chỉ hiện email service account.
- Việc của user (1 lần): Share Sheet quyền **Editor** cho
  `sheets-editor@test-qc-506106.iam.gserviceaccount.com`. Chưa share thì đọc vẫn được,
  ghi trả 403 với thông báo nói rõ phải share cho email nào.
- Xác thực bằng `google-auth-library` (JWT, scope `spreadsheets`); gọi REST
  `sheets.googleapis.com/v4` bằng `node-fetch` có sẵn.

### 5.2 Chọn tab

- **Khoá chính là `SHEET_GID`** (id của tab), tên chỉ để hiển thị. Đổi tên tab không vỡ.
- Có `SHEET_GID`: dùng nó; tên tab thật khác `SHEET_TAB` → cảnh báo, vẫn chạy.
- Chỉ có `SHEET_TAB`: tên phải **khớp chính xác**. Không khớp → dừng, liệt kê tab thật,
  hiện dấu cách cuối thành `␠` (`V1 - fEvaluation - VIBE␠`). **Không còn đường lùi về tab đầu.**
- Tool `sheet:tabs` (và UI ở Spec D) liệt kê tab để chọn rồi ghi `SHEET_GID` vào `.env`.

### 5.3 Đọc lưới và tìm cột

- **Đọc cả tab bằng 1 request** `values.get` (`FORMATTED_VALUE`), thay cho CSV gviz.
  `plan`, `sheet:dump`, `case` không cần mở Chrome để đọc Sheet nữa.
- `core/sheet_grid.js` giữ vai "nguồn duy nhất" và thêm **tìm cột theo nhãn trong khối
  vòng**: khối của vòng N chạy từ ô `TEST LẦN N` ở dòng 1 tới trước ô `TEST LẦN` kế tiếp;
  trong khối, cột mang nhãn dòng 2 (sau chuẩn hoá khoảng trắng + hoa/thường) là
  `TRẠNG THÁI`, `KẾT QUẢ THỰC HIỆN`, `MÔI TRƯỜNG`, `TEST DATE`.
- Mỗi nhãn phải có **đúng 1 cột** trong khối. Thiếu hoặc trùng `Trạng thái` /
  `Kết quả thực hiện` → **DỪNG `[AN TOÀN]`**. Thiếu `Môi trường` / `Test Date` → vẫn ghi
  2 cột chính, `result.json` ghi cảnh báo.
- Các chốt cũ vẫn giữ: `TEST LẦN 1` ≠ `TEST LẦN 10`; vòng không có khối → dừng và nêu
  các vòng đang có; mã case phải khớp cột A.
- Mới: **mã xuất hiện hơn 1 lần ở cột A → DỪNG** (không biết dòng nào là thật).

### 5.4 Ghi

Kiểm tra ô thật trên tab V1 (2026-09-28, chỉ đọc) cho thấy ba điều quyết định cách ghi:

- Ô **Kết quả thực hiện** là rich-text: có `textFormatRuns` mang link (vd `Link: https://jam.dev/…`).
  Ghi đè bằng `values.update` sẽ **xoá mất các link đó** — cách gõ phím cũ không bị vì nối
  trong trình soạn ô.
- Ô **Test Date** là **số ngày thật** (`numberValue`, định dạng `DATE` mẫu `dd/mm/yyyy`),
  không phải chữ.
- Ô **Trạng thái** và **Môi trường** có data validation `ONE_OF_LIST`, **strict**:
  Trạng thái ∈ `DONE, Fail, Doing, Cancel, Pending, Đề xuất`; Môi trường ∈
  `Beta, Localhost, Production`.

Nên bộ ghi **không dùng values API** mà đọc ô bằng `spreadsheets.get` (`includeGridData`)
và ghi bằng **một** `spreadsheets.batchUpdate` gồm các yêu cầu `updateCells` từng ô:

| Cột | Cách ghi |
|---|---|
| Trạng thái | `stringValue` `DONE` / `Fail`. Ô có danh sách chọn mà giá trị không nằm trong danh sách → **DỪNG** |
| Kết quả thực hiện | **nối thêm** (mục 5.5): `stringValue` = nội dung cũ + `\n` + đoạn mới; `textFormatRuns` = **nguyên các đoạn cũ** + 1 đoạn định dạng trống cho phần nối thêm (để link cuối của nội dung cũ không "loang" sang) + 1 đoạn link cho URL video. Ô đang là **công thức** → **DỪNG** (nối vào sẽ phá công thức) |
| Môi trường | `stringValue` nhãn của **lượt chạy** (lưu trong `result.json`, suy từ `TARGET_URL` lúc chạy — mục 5.6). Nhãn không có trong danh sách chọn của ô → bỏ qua cột này + cảnh báo |
| Test Date | `numberValue` = số ngày (tính từ 30/12/1899) của ngày case **bắt đầu chạy**, giờ máy. Ô chưa có định dạng ngày thì đặt thêm `numberFormat DATE dd/mm/yyyy` |

Ghi muộn qua duyệt (`commit`) vẫn dùng Môi trường và ngày **của lượt chạy**, không dùng
cấu hình hay ngày lúc duyệt.

Trình tự chốt:
1. Nạp lưới, tìm dòng + 4 cột như 5.3.
2. **Đọc sống ngay trước khi ghi** (1 request `spreadsheets.get` theo 5 vùng 1 ô): ô cột A
   của dòng + 4 ô đích, kèm `userEnteredValue`, `textFormatRuns`, `dataValidation`,
   `numberFormat`. Cột A khác mã (Sheet vừa chèn/xoá dòng) → DỪNG. Nội dung mới của ô Kết
   quả dựng từ bản vừa đọc, không từ lưới cũ.
3. **Chống ghi trùng**: dòng đầu của mỗi lần ghi mang `#<runId 8 ký tự>`. Ô Kết quả đã
   chứa mã đó → bỏ qua phần nối (thử ghi lại bao nhiêu lần cũng không nhân đôi).
4. Ô Kết quả sau khi nối vượt 50.000 ký tự (giới hạn của Google Sheets) → DỪNG.
5. Ghi.
6. **Đọc lại sau khi ghi**, so khớp theo kiểu giá trị: chữ so `stringValue`, ngày so
   `numberValue`; ô Kết quả còn phải giữ đủ số đoạn định dạng cũ. Lệch → `sheet.state = failed`,
   ghi nhật ký.
7. Nhật ký (5.7) — lưu **bản chụp ô** trước/sau (`userEnteredValue` + `textFormatRuns` +
   `numberFormat`), nên hoàn tác trả lại được cả link lẫn định dạng.

Hàng đợi ghi chỉ có **1 luồng** trong runner. Lỗi 429/5xx của API → thử lại tối đa 3 lần
(1s, 3s, 9s), vẫn qua đủ chốt ở mỗi lần.

### 5.5 Nội dung "Kết quả thực hiện"

```
[Tự động] 25/09/2026 14:32 · vòng 3 · hồ sơ default · #a1b2c3d4
✓ B1 Mở tab Mẫu đánh giá
✓ B2 Mở mẫu Nháp "Mẫu TTS - Bản sao"
✗ B3 Bấm Kích hoạt ← hệ thống chặn: "…"
• Banner chỉ xem: không (mong muốn: có) ✗
Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — <resultText của kịch bản>
- Video Test Record: https://files.catbox.moe/xxxxxx.mp4
```

- Dòng `✓/✗` từ `ctx.step`; dòng `•` từ `ctx.check`; lỗi rút gọn tối đa 120 ký tự.
- `Kết luận:` `ĐẠT —` / `KHÔNG ĐẠT (QC xác nhận lỗi app) —` + `resultText`.
- Kịch bản cũ chưa có bước: chỉ dòng đầu + `Kết luận` + video.
- Dòng `- Video Test Record:` giữ đúng chữ cũ để QC và công thức sẵn có vẫn nhận ra.

### 5.6 Nhãn Môi trường

- Mặc định (khi không khai `ENV_LABELS`):
  `devtunnels.ms=Localhost,localhost=Localhost,beta.fastdo.vn=Beta,fastdo.vn=Production`
  — 3 nhãn khớp đúng danh sách chọn của ô Môi trường; `beta.fastdo.vn` lấy từ tài liệu repo
  fastdo-server.
- So theo hậu tố tên miền, hậu tố dài nhất thắng (`beta.fastdo.vn` thắng `fastdo.vn`).
- Host không khớp nhãn nào → **chặn chạy thật** (chạy nháp vẫn được) tới khi khai nhãn.

### 5.7 Nhật ký ghi và hoàn tác

- `runs/.sheet-audit.ndjson`, mỗi dòng một lần ghi: `auditId`, thời điểm, `runId`, mã
  case, vòng, tab (gid + tên), người duyệt (nếu có), và **mỗi ô: địa chỉ, trước, sau**.
- **Hoàn tác** một `auditId`: với từng ô, chỉ ghi lại giá trị "trước" khi giá trị hiện
  tại **vẫn đúng bằng** giá trị "sau" mình đã ghi; ô đã bị ai sửa → từ chối ô đó và báo.
  Hoàn tác cũng được ghi nhật ký. `result.json` của lượt đó chuyển `sheet.state = reverted`.

### 5.8 Rủi ro còn lại

Sheets API không có thao tác "so rồi mới ghi" nguyên tử. Nếu QC gõ vào đúng ô Kết quả
trong khoảng ~0,3s giữa bước 2 và bước 5, nội dung vừa gõ có thể mất; nhật ký giữ bản
trước để khôi phục.

---

## 6. Chốt quy trình

Mọi chốt nằm trong `engine/gates.js`, được **cả CLI lẫn server** gọi — không có cờ vượt
chốt. Mỗi lần chặn trả về: chốt nào, vì sao, lệnh/nút để sửa.

### 6.1 Trước khi chạy

| Chốt | Nội dung | Áp cho |
|---|---|---|
| Cấu hình | đủ biến bắt buộc (`config.REQUIRED_ENV` + `GOOGLE_SA_KEY_FILE` + tab); hồ sơ mà case cần phải được khai — thiếu thì chỉ chặn case đó | mọi lượt |
| Hạ tầng | tunnel HTTP 200; đọc được Sheet, tab tồn tại; ffmpeg; Chrome; Catbox (chỉ chạy thật). Nhớ kết quả 10 phút trong `runs/.preflight.json`, mất hiệu lực khi đổi `TARGET_URL`/Sheet/tab | mọi lượt |
| Vòng | **bắt buộc `--round=N`** (bỏ mặc định vòng 1); vòng phải có khối trên Sheet; ô Trạng thái hoặc Kết quả của case ở vòng đó đã có nội dung → phải xác nhận (`--ghi-tiep` / hộp thoại UI) | chạy thật có ghi Sheet |
| Kịch bản đã kiểm chứng | có ít nhất 1 lượt (nháp hoặc thật) **cùng mã băm + cùng nhãn Môi trường** kết thúc ĐẠT, hoặc KHÔNG ĐẠT đã được duyệt là `app`. Không có → case bị loại khỏi lượt, gợi ý chạy nháp | chạy thật |
| Không chồng kết quả | case đang có lần **chờ duyệt** cùng vòng → phải duyệt xong mới chạy thật lại vòng đó | chạy thật |
| Khoá | case không đang chạy ở tiến trình khác | mọi lượt |

**Mã băm kịch bản** = sha256 (lấy 12 ký tự đầu) của: file kịch bản + `src/engine/ctx.js` +
`src/core/evaluation_helpers.js`, `cursor_motion.js`, `page_ready.js`, `datetime_picker.js`
+ mọi file trong `src/testcases/lib/` (nếu có). Sửa bất kỳ file nào trong danh sách → phải
chạy nháp lại.

**Sổ đã kiểm chứng** `runs/.verified.json`: `mã case → [{ hash, envLabel, runDir, at, via }]`,
`via` = `pass` hoặc `review-app`. Duyệt một lượt là `kich-ban` → xoá mục cùng `hash + envLabel`.

**"Chạy nháp rồi chạy thật"**: tuỳ chọn của lượt (`--nhap-truoc`). Engine chạy nháp
trước; case ĐẠT mới được nối sang chạy thật trong cùng lượt; chốt vẫn được kiểm thật. Case
có `consumes` được cảnh báo trước: cần 2 bản dữ liệu.

**Chạy nháp** = `--nhap` (bí danh `--dry`): không upload, không ghi Sheet, video tuỳ chọn
(`--video`, chỉ lưu máy). Tổ hợp cũ **tắt cả upload lẫn ghi Sheet** (`--no-record --no-sheet`,
`--no-upload --no-sheet`) cũng được hiểu là chạy nháp.

**Chạy thật** = mọi tổ hợp còn lại, và **luôn quay + upload video** (video là bằng chứng):
`--no-record` hoặc `--no-upload` mà không kèm `--no-sheet` → từ chối, gợi ý `--nhap`.
`--no-sheet` đơn lẻ = chạy thật không ghi Sheet (vẫn quay, vẫn upload) — chốt "Kịch bản đã
kiểm chứng" vẫn áp vì video được đưa lên host công khai; chốt "Vòng" thì không áp.

### 6.2 Sau khi chạy — engine tự xếp

| Kết quả | Xử lý |
|---|---|
| ĐẠT (chạy thật) | ghi Sheet ngay; ghi vào sổ đã kiểm chứng |
| ĐẠT (nháp) | không ghi Sheet; ghi vào sổ đã kiểm chứng |
| KHÔNG ĐẠT | `sheet.state = pending` (chờ duyệt), không ghi |
| LỖI HẠ TẦNG | không ghi; tự chạy lại 1 lần (mục 7.3) |
| ĐÃ HUỶ | không ghi, không chạy lại |
| Upload Catbox hỏng | `sheet.state = waiting-upload`; "Upload lại rồi ghi" dùng lại đúng file mp4. Không có video → không ghi (giữ luật cũ) |
| Ghi Sheet hỏng | `sheet.state = failed` kèm lý do; "Thử ghi lại" an toàn nhờ `#runId` |

`--sheet-on`: `pass` = hành vi mặc định mới; `never` = `--no-sheet`; **`always` bị từ chối**
("FAIL phải qua duyệt") — đổi có chủ đích so với trước.

### 6.3 Duyệt FAIL

- Chọn **đúng 1 nguyên nhân**:
  - `app` — lỗi app → ghi `Fail` + Kết quả (`Kết luận: KHÔNG ĐẠT (QC xác nhận lỗi app) — …`);
    lượt này vào sổ đã kiểm chứng.
  - `kich-ban` — lỗi kịch bản → **không ghi**; tạo việc "sửa kịch bản" trong
    `runs/.claude-queue.json` (kèm đường dẫn `fail.md`, `trace.zip`); xoá khỏi sổ đã kiểm chứng.
  - `du-lieu` — dữ liệu/môi trường → **không ghi**; gợi ý chuẩn bị lại rồi chạy lại.
- **Đã mở phát video**: server (Spec D) chỉ nhận yêu cầu duyệt khi kèm số giây video đã
  phát > 0; lưu vào nhật ký. CLI: `npm run commit -- <thư mục run> --nguyen-nhan=app|kich-ban|du-lieu`,
  nhật ký ghi "duyệt qua CLI".
- Người duyệt: `QC_NAME` (mặc định tên user Windows) — chỉ lưu nhật ký, không ghi Sheet.
- Ghi chú tuỳ chọn — lưu nhật ký, không ghi Sheet.
- Lượt chạy thật cũ đang `pending` mà vòng đã bị lượt khác ghi sau đó → duyệt vẫn được,
  nhưng hỏi xác nhận (sẽ ghi đè Trạng thái mới hơn).

---

## 7. Lập lịch

### 7.1 Luật

1. Case vào hàng theo thứ tự tester chọn.
2. Luồng rảnh lấy **case đầu tiên** mà khoá mã case + mọi `resources` đều rảnh.
3. Case không khai `parallel: true` = **chạy một mình**: khi nó ở đầu hàng, ngừng phát case
   mới, chờ mọi luồng xong, rồi chạy nó; xong mới phát tiếp. Không case nào bị bỏ đói.
4. `resources` = khai báo + tự suy từ hằng số `DRAFT_TEMPLATE_NAME` / `TEMPLATE_NAME`
   (tiền tố `mau:`). Giá trị là chuỗi tự do, so khớp chính xác; quy ước tiền tố `mau:`
   (mẫu đánh giá), `ky:` (kỳ đánh giá), `cauhinh:` (cấu hình dùng chung của tổ chức).
5. Case chờ khoá phát sự kiện `case.waiting` kèm thứ đang chờ.

### 7.2 Huỷ

- `cancel <mã>` → đóng context → `ĐÃ HUỶ`. `cancelAll` → huỷ hết đang chạy + bỏ hàng đợi.
- Lượt bị Ctrl+C / server tắt → huỷ như `cancelAll`, `result.json` của từng case vẫn được ghi.

### 7.3 Chạy lại tự động

- LỖI HẠ TẦNG → chạy lại **1 lần** bằng context mới, video mới, thư mục `-a2`.
- **Không chạy lại** khi: case có `consumes`; chẩn đoán `THIẾU TIỀN ĐIỀU KIỆN`,
  `HỢP ĐỒNG KỊCH BẢN`, `PHIÊN BỊ APP CHẶN`; case bị huỷ.
- **KHÔNG ĐẠT không bao giờ tự chạy lại** (tránh "chạy tới khi pass").
- Chrome chết → dựng lại Chrome; case đang chạy tính LỖI HẠ TẦNG theo luật trên; hàng
  đợi chạy tiếp.

---

## 8. Video, trace, chẩn đoán

- **Quay**: Playwright `recordVideo` 1280×720 cho từng context → `video.webm`. Khoảng
  25 khung/giây cố định — `RECORD_FPS` không còn tác dụng (ghi rõ trong tài liệu).
- **Con trỏ ảo + gợn sóng khi click**: giữ, nạp qua init script.
- **Hậu kỳ** (`video_post.js`, tối đa 2 việc ffmpeg cùng lúc, không chặn luồng):
  - đệm thêm **dải 60px dưới khung hình**, vẽ phụ đề bước từ `steps.ass`
    (`<mã> · <nhãn bước> · <mm:ss>`) bằng filter `subtitles` (ffmpeg máy có libass + libx264);
  - xuất `<mã>_AutoRecord.mp4` (H.264, `+faststart`) — tên file giữ như cũ;
  - xuất `steps.vtt` cho trình phát ở Spec D (bấm bước → tua);
  - ffmpeg hỏng → upload `video.webm` gốc thay thế, ghi cảnh báo.
  - Chạy ffmpeg với `cwd` = thư mục run và tên file tương đối (tránh lỗi thoát ký tự
    đường dẫn Windows trong filter `subtitles`).
- Mốc thời gian phụ đề tính từ lúc tạo trang của context (chênh ~0,1–0,3s, chấp nhận được).
- **Trace**: bật suốt case; `trace.zip` chỉ giữ khi FAIL / LỖI HẠ TẦNG.
- **`*.fail.md`**: giữ nguyên bộ phân loại 8 hạng của `diagnostics.js`, thêm 3 hạng mới
  (`HỢP ĐỒNG KỊCH BẢN`, `PHIÊN BỊ APP CHẶN`, `ĐĂNG NHẬP HỒ SƠ THẤT BẠI`) và đường dẫn trace.
  Bản "mới nhất" ở `diagnostics/<mã>.fail.md` vẫn giữ.
- **Ảnh nhỏ màn hình** (tuỳ chọn `--thumbs`, server của Spec D bật): JPEG chất lượng 40
  mỗi 3s mỗi luồng → `runs/<lượt>/thumbs/<mã>.jpg` (ghi đè).

---

## 9. Sự kiện và điều khiển — hợp đồng cho Spec D

Mỗi sự kiện là 1 dòng JSON `{ "ev": "<tên>", "t": "<ISO>", ... }`, vừa ghi vào
`runs/<lượt>/events.ndjson`, vừa in ra stdout với tiền tố `::ev:: ` (dòng log người đọc
in bình thường, không tiền tố).

| Sự kiện | Trường |
|---|---|
| `batch.started` | `batchId`, `mode` (`nhap`/`that`), `round`, `parallel`, `cases[]` |
| `batch.gate` | `caseId`, `gate`, `ok`, `message`, `fix` |
| `case.queued` / `case.waiting` | `caseId`, `waitingFor[]` |
| `case.started` | `caseId`, `attempt`, `worker`, `profile`, `runDir` |
| `case.step` | `caseId`, `index`, `label`, `status` (`start`/`ok`/`fail`), `ms` |
| `case.log` | `caseId`, `stream`, `text` |
| `case.thumb` | `caseId`, `path` (tương đối trong `runs/`) |
| `case.finished` | `caseId`, `verdict` (`DAT`/`KHONG_DAT`/`LOI_HA_TANG`/`DA_HUY`), `seconds`, `diagnosis` |
| `case.video` | `caseId`, `mp4`, `url` |
| `case.sheet` | `caseId`, `state`, `cells`, `reason` |
| `batch.finished` | tóm tắt số lượng theo kết quả, thời gian |

Điều khiển: server ghi vào stdin của runner, mỗi dòng 1 JSON:
`{"cmd":"cancel","caseId":"…"}`, `{"cmd":"cancelAll"}`,
`{"cmd":"add","cases":["…"]}` (dùng mode/vòng của lượt, vẫn qua đủ chốt).
CLI chạy tay (stdin là terminal) bỏ qua kênh này.

`events.ndjson` là nguồn phát lại khi trang mở lại / mất kết nối.

---

## 10. `result.json` v2

Giữ **mọi trường v1** (`testcaseId`, `round`, `account`, `pass`, `resultText`, `videoPath`,
`videoUrl`, `sheet`, `sheetCell`, `sheetStatus`, `error`, `failReport`, `seconds`…) để giao
diện cũ và `commit` vẫn đọc được. Thêm:

`schema: 2`, `runId`, `batchId`, `title`, `mode`, `profile`, `envLabel`, `scriptHash`,
`attempt`, `verdict`, `diagnosis {kind, hint}`, `steps[] {label, ok, startMs, endMs, error}`,
`checks[] {label, ok, expected, actual}`, `video {webm, mp4, url, vtt}`, `trace`,
`sheet {state, cells {status, result, env, date}, auditId, warnings[], reason}`,
`review {cause, by, at, videoWatchedSec, note, via}`.

`sheet.state` mở rộng: `written` · `pending` · `skipped` · `failed` · `waiting-upload` · `reverted`.

Thư mục:
- Lượt: `runs/<YYYYMMDD-HHmmss>-lot-<pid>/` — `events.ndjson`, `batch.json`, `thumbs/`.
- Case: `runs/<YYYYMMDD-HHmmss>-<mã>-<v3|nhap>-<hồ sơ>-<pid>-a<lần>/` — `result.json`,
  `<mã>_AutoRecord.mp4`, `steps.ass`, `steps.vtt`, `trace.zip` (khi lỗi), `<mã>.fail.md`, dump.
  `video.webm` bị xoá ngay khi hậu kỳ ra mp4 thành công; hậu kỳ hỏng thì giữ webm.

---

## 11. CLI, tool, tương thích

### 11.1 Cờ `npm test`

| Cờ | Ý nghĩa |
|---|---|
| `--nhap` (`--dry`) | chạy nháp (mục 6.1) |
| `--round=N` | bắt buộc với chạy thật |
| `--ghi-tiep` | xác nhận ghi vào vòng đã có kết quả |
| `--nhap-truoc` | chạy nháp rồi nối sang chạy thật trong cùng lượt |
| `--parallel=N` | số luồng (1–4), đè `PARALLEL` |
| `--profile=<tên>` | ép mọi case dùng hồ sơ này |
| `--headless` | chạy ẩn |
| `--video` | quay video cả khi chạy nháp (lưu máy) |
| `--thumbs` | ghi ảnh nhỏ màn hình |
| `--account=N` | tương thích: = `--profile=slotN` |
| `--no-record`, `--no-upload` | chỉ hợp lệ khi chạy nháp (xem mục 6.1) |
| `--no-sheet`, `--row=N`, `--case-timeout=`, `--report-json=`, `--auth-only`, `--sheet-on=pass\|never` | giữ như cũ (`--sheet-on=always` bị từ chối) |

Exit code: `0` mọi case ĐẠT (và đã ghi nếu chạy thật) · `1` có case KHÔNG ĐẠT / LỖI / chờ
duyệt / ghi hỏng · `2` có case bị chốt chặn, không chạy.

### 11.2 Tool

- `plan` — chuyển sang Sheet API (không mở Chrome để đọc Sheet); thêm: hồ sơ mỗi case cần
  và đã khai chưa, `resources`/`consumes` (cảnh báo cần 2 bản dữ liệu khi nháp + thật),
  trạng thái "đã kiểm chứng" với mã băm hiện tại, nhãn Môi trường. Giữ dòng `PLAN_RESULT`.
- `sheet:dump`, `case` — Sheet API.
- `sheet:tabs` (mới) — liệt kê tab (tên, gid, số dòng).
- `probe` (+ `setups/`) — Playwright, giữ định dạng digest.
- `commit` — thêm `--nguyen-nhan=`, `--ghi-chu=`; nhận cả `failed` và `waiting-upload`.
- `undo` (mới) — `npm run undo -- <auditId>`.
- `preflight`, `smoke-test`, `test:auth` (`--profile=`), `chrome:kill` — port.
- `ui-run.js` — chuyển tiếp cờ mới.

### 11.3 Mã cũ

`src/core/browser.js`, `recorder.js`, `session.js`, `sheet_service.js` (đường gõ phím)
**giữ nguyên, không xoá**, thêm 1 dòng đầu file ghi "không còn được engine v2 gọi từ
2026-09-25". Gói `puppeteer-core`, `puppeteer-screen-recorder` giữ trong `package.json`.
Xoá hay không do user quyết sau. Helper thao tác (`evaluation_helpers.js`…) được **port
tại chỗ** — sau kỳ 2, runner cũ không còn chạy được, đường lùi là git.

### 11.4 `.env`

Không đổi tên biến nào. Biến mới, đều tuỳ chọn: `PARALLEL`, `HEADLESS`,
`GOOGLE_SA_KEY_FILE` (bắt buộc để ghi Sheet), `SHEET_GID`, `ENV_LABELS`, `QC_NAME`,
`PROFILE_<TÊN>_EMAIL/_PASSWORD/_ORG`. Không tự sửa `.env` của user — kể cả `SHEET_TAB`
đang sai; tool chỉ báo và gợi ý.

### 11.5 Giao diện cũ (spec B)

`src/tools/ui/server.js` + `index.html` vẫn chạy được trong suốt spec C: vẫn gửi
`--round`, `--sheet-on=pass`. Log song song có tiền tố `[mã]` nên khung "Toàn bộ" đọc
được, nhưng tách log theo case có thể không chuẩn — Spec D thay hẳn phần này.

### 11.6 Tài liệu

Cập nhật `SKILL.md`, `references/viet-kich-ban.md` (hợp đồng ctx v2, khai báo
`profile`/`resources`/`consumes`/`parallel`, bắt buộc `step`), `references/van-hanh.md`,
`README.md`.

---

## 12. Phụ thuộc mới

| Gói | Vì sao | Đã cân nhắc | License | Chi phí gỡ bỏ |
|---|---|---|---|---|
| `playwright-core@1.62.1` (ghim cứng) | engine: context, video, trace, locator | giữ Puppeteer; `@playwright/test` | Apache-2.0 | trung bình — helper + kịch bản đã port |
| `google-auth-library` | xác thực service account cho Sheets REST | gói `googleapis` đầy đủ (~80MB) | Apache-2.0 | thấp — chỉ `sheets_client.js` dùng |

- Không tải trình duyệt: `channel: 'chrome'` dùng Chrome đã cài (máy hiện có Chrome 154).
- ffmpeg riêng của Playwright (cho `recordVideo`): 1.62.1 cần bản `ffmpeg-1011`, đã có
  trong `%LOCALAPPDATA%\ms-playwright`. Máy khác: `npx playwright install ffmpeg`
  (preflight kiểm và nói rõ; Spec D cho UI tự làm).
- ffmpeg hệ thống (đã bắt buộc từ trước) dùng cho hậu kỳ.

---

## 13. Kiểm thử

**Unit** (`npm run test:unit`, `node --test`, không trình duyệt, không `.env`, ~1s):
- `sheet_grid`: tìm cột theo nhãn với dữ liệu mẫu **đúng 3 dòng tiêu đề thật của tab V1**
  (khối 7/6 cột, `FEEDBACK AI`, nhãn có khoảng trắng đầu); trùng nhãn trong khối; thiếu
  nhãn; `TEST LẦN 1` vs `10`; mã trùng ở cột A. Giữ và cập nhật test sẵn có.
- `sheet_writer` với API giả: đủ chốt `[AN TOÀN]`; đọc sống phát hiện dòng bị dời; chống ghi
  trùng `#runId`; giới hạn 50.000 ký tự; đọc lại sau ghi lệch → `failed`; thử lại 429.
- `audit`: hoàn tác đúng; từ chối ô đã bị sửa.
- `scheduler` với luồng giả: khoá mã case, khoá `resources`, case chạy một mình, không bỏ
  đói, huỷ 1 case, huỷ hết, luật chạy lại (kể cả các ngoại lệ).
- `gates`: mã băm + nhãn Môi trường, vòng bắt buộc, vòng đã có dữ liệu, chồng kết quả chờ
  duyệt, host chưa có nhãn, hồ sơ thiếu.
- `result_text`, `env_label`, `profiles` (đọc `.env` giả, tương thích `FASTDO_EMAIL_2`),
  hợp đồng kịch bản (`check` hỏng mà `pass = true`).

**Tích hợp không cần Fastdo** (`npm run test:engine`): server HTML cục bộ do test tự dựng,
3 context song song → mỗi case có mp4 + dải phụ đề + `steps.vtt`; case FAIL giữ
`trace.zip`, case ĐẠT không; huỷ 1 case không ảnh hưởng 2 case kia; watchdog đóng đúng context.

**Với Fastdo — chỉ chạy nháp, chỉ case không phá dữ liệu**: EVAL_023, EVAL_024 trên engine
cũ và engine mới phải cùng kết luận (đặc tả hoá hành vi trước khi đổi). Case phá dữ liệu
(017, 019, 020, 021, 022, 037) chỉ chạy khi user đã chuẩn bị dữ liệu mới và đồng ý.

**Ghi Sheet thật**: không ghi tab V1/HUY trong lúc phát triển. Service account không tạo
được Sheet riêng (403 — không có dung lượng Drive), nên theo lựa chọn của user (2026-09-28):
tool `sheet:selftest` tạo **tab ẩn tạm `_fe2_kiem_thu`** trong Sheet của team, chép 3 dòng
tiêu đề thật + 2 dòng mẫu, rồi kiểm: ghi 4 ô, giữ link cũ, chống ghi trùng, hoàn tác, và
**xoá tab** ở cuối (kể cả khi kiểm hỏng).

Không có lệnh nào được báo là đã qua nếu chưa thực sự chạy.

---

## 14. Phân kỳ triển khai

Mỗi kỳ đứng độc lập, kiểm xong mới sang kỳ sau. User tự commit theo từng kỳ để lùi được
từng kỳ.

1. **Sheet API** — `sheets/*`, `sheet_grid` theo nhãn, tab theo gid, bộ ghi 4 cột, nhật ký
   + hoàn tác, `sheet:tabs`, `undo`; nối vào runner **cũ**. Sửa sớm lỗi sai tab.
2. **Engine Playwright** — `browser_pool`, `context_factory`, `ctx` v2, `case_runner`,
   video + phụ đề + trace, port helper + 8 kịch bản, chạy **1 luồng**.
3. **Lập lịch song song** — hồ sơ, khoá, `gates`, sổ đã kiểm chứng, duyệt theo nguyên nhân,
   sự kiện + điều khiển stdin, `result.json` v2 đầy đủ.
4. **Port tool + tài liệu** — `plan`, `probe`, `preflight`, `case`, `sheet:dump`, `commit`,
   `smoke-test`, `test:auth`, `chrome:kill`, `ui-run`; `SKILL.md`, references, README.

---

## 15. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Port Playwright làm đổi hành vi kịch bản cũ | giữ chữ ký ctx; so kết luận engine cũ/mới trên case không phá dữ liệu; case phá dữ liệu kiểm cùng user |
| App bật lại chặn đăng nhập song song | chẩn đoán `PHIÊN BỊ APP CHẶN`, giảm `PARALLEL` |
| Sheets API không so-rồi-ghi nguyên tử | cửa sổ ~0,3s; nhật ký giữ bản trước |
| Service account chưa được share Editor | đọc vẫn chạy; ghi báo 403 kèm email cần share |
| Bản ffmpeg của Playwright lệch phiên bản | ghim `playwright-core@1.62.1`; preflight kiểm |
| Chạy đua màn chọn tổ chức (đã biết) | `ensureOrgSelected` + chạy lại 1 lần khi LỖI HẠ TẦNG |
| Catbox là host công khai | không đổi so với hiện nay |
| 4 luồng + 2 việc ffmpeg nặng máy | mặc định 3 luồng; máy hiện 16 luồng CPU / 16GB RAM |

---

## 16. Ngoài phạm vi

- Giao diện React, file nhấp đúp để mở, ranh giới bí mật trên UI (Spec D).
- AI viết nhận xét vào cột `FEEDBACK AI` / `DEV /QC NOTE`.
- Lịch chạy hồi quy định kỳ, báo cáo tổng hợp.
- Viết kịch bản cho các case V1 — làm theo đúng phạm vi user yêu cầu từng lượt.
- Xoá mã / gói Puppeteer cũ.

---

## 17. Bàn giao cho Spec D

**Yêu cầu của user**: Tester làm được **mọi** việc trên UI, không phải gõ `npm run` hay
lệnh nào — tự động nhất có thể.

Spec C bảo đảm mọi hành động có **hàm thư viện** trong `src/engine/index.js` (CLI chỉ là
lớp mỏng gọi lại), để server của Spec D gọi thẳng:

`runBatch(opts, { onEvent })` · `cancel(caseId)` / `cancelAll()` / `addCases(ids)` ·
`plan(ids)` · `preflight({ force })` · `listTabs()` · `refreshSheetCache()` ·
`commit(runDir, { cause, reviewer, videoWatchedSec, note })` · `retryWrite(runDir)` ·
`retryUpload(runDir)` · `undo(auditId)` · `relogin(profile)` · `killStrayChrome()` ·
`smokeTest()` · `listRuns()` / `readRun(runDir)` · `listProfiles()` (không bao giờ trả mật khẩu).

Quyết định sẽ hỏi ở Spec D (spec B từng cố ý khoá):
1. Cho UI **ghi — nhưng không bao giờ đọc lại** — mật khẩu hồ sơ, `CATBOX_USERHASH`, file key.
2. Cho bật "Claude tự chạy" (`CLAUDE_AUTO_RUN`) ngay trên UI.
3. Có tự khởi động cùng Windows không.

---

## Prompt gốc của user liên quan spec này

> D:\FastDo\TEstAuto-Gian\fEvaluation, Tôi đang muốn update Tool này để test automation,
> chạy mượt, có thể chạy cùng lúc nhiều test case, viết đánh giá trong Sheet, và kèm quay
> video. Hãy dựa vào src code mà update tiên tiến hơn, mạnh hơn, UI/UX tốt hơn, dủng react
> làm giao diện cho tôi. Tuyệt đối đảm bảo việc test luốn chạy đúng quy trình, bạn có thể
> đề xuất thêm các Tính năng update hoặc thay thế đẻ cải thiện tốt hơn, UI có người là
> Tester dễ hiểu dễ dùng

Các lựa chọn trong brainstorm: "C trước, rồi D" · "Hồ sơ tài khoản + khoá dữ liệu" ·
"4 cột, kết quả có cấu trúc" · "Chặt vừa" · "B — Playwright + bộ lập lịch riêng" ·
duyệt phần 1–6.

> Tôi muốn hỏi thêm là chỉ khi khai báo thêm
> PROFILE_NHANVIEN_EMAIL=…
> PROFILE_NHANVIEN_PASSWORD=…
> PROFILE_NHANVIEN_ORG=WATER QUALITY - TEAM 1ST
> thì nó mới chạy thêm luồng mới và mỗi luồng phải copy 3 lần trong ENV à ??

> Giữ đủ các chốt, kể cả việc phải mở video trước khi xác nhận duyệt FAIL.
>
> nhưng mọi việc test tôi mong muốn Tester có thể làm trên UI không cần phải chạy npm run
> hay gì hết, để mọi thứ tự động nhất có thể
