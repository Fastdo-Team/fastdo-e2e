---
name: fastdo-eval-runner
description: Chạy test QA tự động cho testcase trong Google Sheet "fEvaluation" của Fastdo — đọc đặc tả case từ Sheet, điều khiển Chrome thật qua CDP, quay video (có con trỏ ảo), upload Catbox lấy link vĩnh viễn, ghi kết quả vào Sheet. Tự kích hoạt khi user gõ dạng "test EVAL_xxx" / "chạy EVAL_xxx" / "kiểm thử EVAL_xxx".
---

# Fastdo Eval Runner

Bộ kiểm thử tự động cho testcase Fastdo trong Google Sheet `fEvaluation - VIBE`.
Repo: `D:\FastDo\Test-Auto` — **mọi lệnh phải chạy với cwd là thư mục này**.

Nguyên tắc chia vai: **Claude viết kịch bản (1 lần mỗi case). CLI diễn (mãi mãi,
0 token).** Đừng làm thay việc của CLI — đừng dùng computer-use, đừng chụp màn
hình để click.

---

# QUY TRÌNH BẮT BUỘC khi user nói "test EVAL_XXX"

Làm đúng thứ tự. Không nhảy bước. Không đoán vòng test.

## Bước 1 — Kiểm tra hạ tầng (~20s)

```bash
cd /d/FastDo/Test-Auto && npm run preflight
```

- `SẴN SÀNG CHẠY TEST` → đi tiếp.
- `✗ Mẫu "..." KHÔNG còn trên tunnel này` → **DỪNG**. Báo user: fixture đã mất,
  chạy sẽ chết oan, cần tạo lại mẫu sandbox trên app trước. Đừng chạy test.
- `✗ Dev tunnel` → **DỪNG**. `TARGET_URL` trong `.env` đã hết hạn/đổi, hỏi user URL mới.

`preflight` **không chạy test nào** — nó chỉ là health check. Đừng nhầm nó với `npm test`.

## Bước 2 — Đọc đặc tả case từ Sheet (~15s)

```bash
cd /d/FastDo/Test-Auto && npm run case -- EVAL_XXX
```

In ra `ID / Function / Tiêu đề / Mô tả (Điều kiện + Các bước + Kết quả mong muốn)
/ Nền tảng`, kèm tóm tắt kết quả các vòng đã chạy.

**Không mở Sheet trên trình duyệt để đọc bằng mắt.** Không chụp ảnh Sheet.
Nếu case không có trong Sheet, tool sẽ liệt kê các mã đang có — báo user, đừng bịa đặc tả.

## Bước 3 — Chốt vòng test với user

Từ output Bước 2, đếm vòng đã có kết quả. Vòng tiếp theo = vòng cao nhất + 1.

**Nói rõ con số đó rồi chờ user xác nhận trước khi chạy thật.** Ghi sai cột là
ghi đè lên dữ liệu QC của vòng khác — không tự quyết.

> "Sheet cho thấy EVAL_024 đã chạy LẦN 1–4 (đều DONE). Tôi sẽ ghi vào **TEST LẦN 5**. Đúng chưa?"

Nếu user đã nói rõ vòng ngay từ đầu ("test EVAL_024 lần 3") thì dùng luôn, không hỏi lại.

## Bước 4 — Kiểm xem case đã có file kịch bản chưa

```bash
cd /d/FastDo/Test-Auto && node src/runner.js
```

In danh sách case đang có file trong `src/testcases/`.

### 4a. ĐÃ có file → sang Bước 5.

### 4b. CHƯA có file → phải viết trước

1. **Khám phá DOM bằng text, KHÔNG chụp màn hình:**

   ```bash
   cd /d/FastDo/Test-Auto && npm run probe -- "/evaluation?tab=template" --tables
   ```

   Cần trạng thái sâu (đã bấm vào editor):

   ```bash
   cd /d/FastDo/Test-Auto && PROBE_TEMPLATE="<tên mẫu Nháp có thật>" npm run probe -- "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js
   ```

   Lấy tên mẫu Nháp có thật từ output `preflight` (dòng "Mẫu Nháp đang có trên tunnel").

2. **Tạo `src/testcases/eval_xxx.test.js`** theo khung ở mục Tham chiếu bên dưới.
   Bọc từng bước bằng `ctx.step('nhãn', () => ...)`. Bám đúng "Các bước" và
   "Kết quả mong muốn" trong đặc tả Sheet, đừng tự nghĩ ra tiêu chí khác.

3. Sang Bước 5.

## Bước 5 — Chạy nháp (~8s, KHÔNG cần hỏi user)

```bash
cd /d/FastDo/Test-Auto && npm test -- EVAL_XXX --no-record --no-sheet
```

Bước này không quay video, không ghi Sheet, không upload gì — an toàn, cứ chạy.

- **PASS** → sang Bước 6.
- **FAIL / CRASH** → đọc báo cáo, sửa, chạy lại Bước 5:

  ```bash
  cd /d/FastDo/Test-Auto && cat diagnostics/EVAL_XXX.fail.md
  ```

  Xem bảng chẩn đoán bên dưới. Đang bí giữa đường thì chèn `await ctx.dump('nhãn')`
  vào đúng dòng đó trong file test rồi chạy lại — nó ghi digest DOM ra
  `diagnostics/EVAL_XXX_dump_N_*.txt` và không dừng test.

## Bước 6 — Chạy thật (~40s)

Chỉ chạy sau khi user đã chốt vòng test ở Bước 3.

```bash
cd /d/FastDo/Test-Auto && npm test -- EVAL_XXX --round=<N>
```

Bước này **quay video, upload lên Catbox (host công khai), và ghi vào Google
Sheet của team**. Đó là lý do phải chốt vòng trước.

Rồi báo lại user: PASS/FAIL, thời gian, link Catbox, ô Sheet đã ghi. Runner in
sẵn đủ 4 thứ đó trong bảng cuối, chép lại chứ đừng diễn giải thêm.

---

# Bảng chẩn đoán khi FAIL

`diagnostics/EVAL_XXX.fail.md` có mục `## Chẩn đoán` ở đầu. **Đọc dòng đó trước
tiên** — 3 hạng đầu rất dễ nhầm nhau và sửa sai chỗ:

| Chẩn đoán | Làm gì |
|---|---|
| `LỚP PHỦ CHẶN CLICK` | đóng lớp phủ (xem cột cờ trong digest biết ai che). **KHÔNG mò selector** |
| `THIẾU TIỀN ĐIỀU KIỆN` | fixture dữ liệu đã mất → chạy `npm run preflight`. **KHÔNG mò selector** |
| `SELECTOR KHÔNG KHỚP` | lúc này mới lấy selector mới từ mục `DOM lúc chết` |
| `HẾT HẠN CHỜ` | sửa điều kiện chờ (`H.waitFor`). **KHÔNG nới timeout cho qua** |
| `HẠ TẦNG CDP` / `BLAZOR MẤT CIRCUIT` | chạy lại case, không phải lỗi app |
| `BACKEND LỖI 5XX` | bug backend → báo dev, không sửa test |
| `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT` | test đúng, app sai → **báo bug, KHÔNG sửa test cho pass** |

Crash hạ tầng thì runner **cố ý không ghi Sheet** — lỗi chạy máy không phải kết
quả kiểm thử. Đừng ép ghi.

---

# KHÔNG ĐƯỢC LÀM

1. **Không chụp màn hình / computer-use để tìm selector hay đọc Sheet.** Đã có
   `npm run probe` và `npm run case`. Chụp ảnh tốn 8–20k token cho 1 case và hay
   đoán sai selector.
2. **Không sửa testcase cho pass** khi chẩn đoán là `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT`.
   Test đúng mà app sai thì đi báo bug.
3. **Không tự chọn `--round`.** Chốt với user (Bước 3).
4. **Không bỏ Bước 5.** Đừng chạy thẳng bản có ghi Sheet khi chưa chạy nháp xong.
5. **Không tạo file test mới ngoài `src/testcases/`**, không sửa `session.js` /
   `recorder.js` / `catbox.js` / `sheet_service.js` / `cursor_motion.js` /
   `browser.js` khi chỉ đang viết 1 case.
6. **Không tự quyết số case.** Làm đúng phạm vi user yêu cầu: user nói 1 mã thì
   làm 1, nói 5 mã thì làm cả 5, nói "chạy nhóm EVAL_030→035" thì làm 6. Nhưng
   **không tự mở rộng ra ngoài phạm vi đó** — không viết trước case chưa được yêu
   cầu, không đề xuất "viết nốt các case còn thiếu". Sheet có ~120 mã và danh sách
   **thay đổi liên tục**, nên viết trước cả loạt là làm ra file chết. Số case chưa
   có kịch bản KHÔNG phải việc tồn cần dọn.

---

# Tham chiếu

## Cấu trúc `src/`

| File | Vai trò |
|---|---|
| `runner.js` | Điều phối toàn luồng bằng 1 lệnh CLI. Exit 1 khi có case FAIL |
| `core/session.js` | Lưu/nạp cookies + localStorage (`.auth/user_state.json`) → bỏ qua đăng nhập và chọn tổ chức |
| `core/cursor_motion.js` | Con trỏ ảo đỏ + hiệu ứng sóng khi click, cho video |
| `core/recorder.js` | Quay MP4, mặc định 15fps (đổi bằng `RECORD_FPS` trong `.env`) |
| `core/catbox.js` | Upload Catbox lấy link vĩnh viễn (có `userhash` + retry) |
| `core/sheet_service.js` | Tìm dòng theo mã, tính cột `TEST LẦN N`, ghi Trạng thái + Kết quả, **verify lại sau khi ghi** |
| `core/dom_digest.js` | Sinh digest DOM dạng text + cờ độ tin cậy. Nguồn duy nhất cho probe / `ctx.dump` / báo cáo lỗi |
| `core/diagnostics.js` | Bắt console + request lỗi, nhật ký bước, phân loại lỗi, ghi `diagnostics/*.fail.md` |
| `core/page_ready.js` | `waitForSettle()` — chờ Blazor render xong VÀ overlay loading tan |
| `tools/probe.js` | CLI khám phá DOM |
| `tools/preflight.js` | CLI kiểm hạ tầng + fixture |
| `tools/case-info.js` | CLI đọc đặc tả case từ Sheet |
| `testcases/` | Kịch bản từng case (`eval_017.test.js`...) |

## Cờ CLI

| `npm test` | |
|---|---|
| `--round=N` | ghi vào cột `TEST LẦN N` (mặc định 1) |
| `--no-record` | không quay video (nhanh hơn ~20s) |
| `--no-sheet` | không ghi Google Sheet |
| `--no-upload` | quay nhưng không upload Catbox |
| `--row=N` | chỉ định cứng dòng Sheet |
| `--case-timeout=<giây>` | hạn giờ mỗi case (mặc định 150) |

| `npm run probe` | |
|---|---|
| `--grep=<regex>` | lọc element theo nhãn/selector |
| `--tables` | dump mọi `<table>` thành mảng |
| `--text` | kèm `innerText` của `<main>` |
| `--all` | in cả element ẩn/disabled |
| `--setup=<file>` | chạy vài cú click để chạm trạng thái sâu |
| `--limit=<n>` | trần số element (mặc định 120) |
| `--keep-open` | giữ Chrome sống, lần probe sau nhanh hơn ~3s |

Chạy nhiều case 1 lệnh dùng chung Chrome + session + tab Sheet, tiết kiệm ~8–10s
**mỗi** case: `npm test -- EVAL_021 EVAL_022 EVAL_024 --round=2`.

Session hết hạn: `npm run test:auth`.

## Cờ độ tin cậy trong digest

| Cờ | Nghĩa |
|---|---|
| `⚠ BỊ CHE bởi <X>` | có thứ khác đè lên. **Click mất tác dụng và KHÔNG ném lỗi** — đóng lớp phủ trước |
| `⚠ TRONG OVERLAY` | element thuộc modal/popup đang mở |
| `⚠ NGOÀI VIEWPORT` | cần `scrollIntoView` trước khi click |
| `⚠ SELECTOR THEO VỊ TRÍ` | selector phải dùng `:nth-of-type` — vỡ khi Blazor render lại danh sách. Ưu tiên bám text |
| `· click tâm trúng <X>` | icon trang trí đè lên tâm (thường vẫn click được) |
| `(khớp N element - GIÒN)` | selector không định danh duy nhất, phải thu hẹp |

## Khung file testcase

```javascript
const config = require('../config');
const H = require('../core/evaluation_helpers');

module.exports = {
  id: 'EVAL_018',
  title: 'Tiêu đề lấy từ Sheet',
  targetPath: '/evaluation?tab=template',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click, type, waitXPath, clickUntil, setFlatpickr, step, dump } = ctx;

    await step('mo tab template', () => H.openEvaluationTab(page, click, 'template'));
    // ... các bước theo đúng đặc tả Sheet

    return {
      pass: true,           // hoặc false
      resultText: 'Mô tả chi tiết kết quả, sẽ được ghi vào cột Kết quả thực hiện',
    };
  },
};
```

`ctx.step()` và `ctx.dump()` **không bắt buộc** — 7 case cũ không dùng vẫn chạy y
nguyên. Nhưng case mới thì nên dùng `step()`: lúc FAIL sẽ biết chết ở bước nào.

Helper dùng chung ở `core/evaluation_helpers.js`: `openEvaluationTab`,
`openDraftByName`, `readGroupCards`, `openCriterionPicker`, `closeCriterionPicker`,
`addCriterion`, `setGroupWeight`, `setCriterionWeight`, `removeEmptyGroups`,
`clickActivate`, `saveDraft`, `dismissPushPopup`, `waitFor`, `sleep`... — **tra
file đó trước khi tự viết thao tác mới**.

## Ghi Google Sheet

- Cột `Trạng thái` bị **ghi đè** bằng `DONE` (pass) hoặc `Fail` (fail), lấy từ `result.pass`.
- Cột `Kết quả thực hiện` luôn **nối thêm**, không bao giờ xoá nội dung cũ:
  `resultText` rồi tới dòng `- Video Test Record: <link>`. Cùng 1 link video thì
  bỏ qua, không ghi trùng.
- Bố cục mỗi vòng: `Ưu tiên (+0) | Môi trường (+1) | Trạng thái (+2) | Kết quả
  thực hiện (+3) | DEV/QC NOTE (+4) | Test Date (+5)`. Nhãn `TEST LẦN N` ở dòng 1
  so khớp **chính xác** (`TEST LẦN 1` là tiền tố của `TEST LẦN 10`).
- Lưới được kéo về **1 lần** qua endpoint CSV `gviz` trong tab Sheet đang đăng
  nhập rồi tra trong RAM. Cách dò từng ô qua Name Box còn trong file làm fallback.

## Ngân sách thời gian (đo trên EVAL_017)

| Chặng | Thời gian |
|---|---|
| Khởi tạo Chrome | 0.5s |
| Phục hồi session | 1.8s |
| Các bước kiểm thử | ~21s |
| Kết thúc & lưu video | 1.5s |
| Upload Catbox | 2.3s |
| Ghi Google Sheet | 5.2s |

Ba bẫy tốc độ đã gỡ, đừng để quay lại:

1. **fps quay video** — 30fps làm mỗi lần chạy chậm thêm ~19s, vì mỗi khung hình
   là 1 lần screencast qua CDP.
2. **Dò ô Google Sheet từng cái** — mỗi ô ~0.7s; dò dòng 2→22 rồi cột A→R tốn ~28s.
3. **`waitForSelector` cho thứ có thể không xuất hiện** — chờ trang cảnh báo dev
   tunnel với timeout 3000 đốt trọn 3s mỗi lần chạy trong trường hợp phổ biến là
   không có cảnh báo. Dùng `page.$()` cho DOM server render sẵn.

Runner in bảng thời gian từng chặng ở cuối mỗi lần chạy — nhìn đó để biết chậm ở
đâu, đừng đoán.

## Bài học trên trang Mẫu đánh giá

Rút ra từ lần sửa EVAL_017 (2026-09-05), áp dụng cho mọi case chạm trình soạn thảo:

- **Không hardcode `id` mẫu vào URL.** Bản cũ trỏ cứng
  `...&view=editor&id=2608280428469JSU4YU9FCHUR135JN59`; mẫu nháp đó bị xoá khỏi
  DB nên trang trả *"Đã có lỗi khi tải dữ liệu. Thử lại"*. Thay vào đó: mở
  `/evaluation?tab=template`, tìm dòng theo **tên mẫu**, bấm `Sửa`.
- **Đóng popup "Bật thông báo đẩy" trước mọi thao tác.** Popup phủ lên bảng danh
  sách, làm mọi click vào `Sửa` im lặng không tác dụng. Bấm `Từ chối` ngay sau khi
  list load xong (`H.dismissPushPopup`).
- **Kích hoạt thất bại VẪN ghi dữ liệu nháp xuống server.** Nhóm rỗng do test tạo
  ra còn lại sau khi đóng trình duyệt và tích luỹ dần. Testcase phải tự chuẩn hoá
  tiền điều kiện đầu mỗi lần chạy và dọn dẹp (`Xóa nhóm` + `Lưu nháp`) ở cuối.
- **Xoá nhiều nhóm phải làm từng cái một bằng click chuột thật.** Blazor render
  lại toàn bộ danh sách sau mỗi lần xoá, nên bắn nhiều `el.click()` liền trong 1
  lượt `page.evaluate` thì các click sau rơi vào node đã bị gỡ khỏi DOM.
- **Selector card nhóm:** mỗi nhóm là `div.box.mb-4` có chứa
  `input[placeholder="Tên nhóm"]`. Nhóm rỗng nhận diện bằng chuỗi `Nhóm chưa có
  tiêu chí nào`; ô lỗi của nhóm là `div.notification.is-danger`.

## Tình trạng đã biết (2026-09-10)

- `EVAL_017`, `EVAL_019`, `EVAL_020` đang **crash** vì mẫu sandbox
  `EVAL_QA - Mau test nhom - Bản sao` không còn trên tunnel hiện tại. `preflight`
  báo trước điều này. Cần tạo lại mẫu Nháp đó, hoặc sửa hằng số
  `DRAFT_TEMPLATE_NAME` trong 3 file sang mẫu Nháp có thật.
- Có file kịch bản: `EVAL_017, 019, 020, 021, 022, 023, 024`. Sheet có ~120 mã
  (`EVAL_001` → `EVAL_116` kèm biến thể `007B/047C`...), nên phần lớn case sẽ đi
  qua Bước 4b khi được yêu cầu. **Đây không phải việc tồn cần dọn** — xem điều 6
  mục KHÔNG ĐƯỢC LÀM.
