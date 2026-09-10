# Fastdo Test Auto (Fast & Independent Runner)

Bộ công cụ QA Automation tối ưu tốc độ cao cho các testcase Fastdo (Google Sheet `fEvaluation - VIBE`).

> **Quy trình đầy đủ để test 1 case** nằm trong
> [`.claude/skills/fastdo-eval-runner/SKILL.md`](.claude/skills/fastdo-eval-runner/SKILL.md) —
> 6 bước, có đủ điểm dừng và bảng chẩn đoán. Nói với Claude `test EVAL_024` là nó
> tự chạy theo đúng quy trình đó. README này là tra cứu từng lệnh rời.

---

## Điểm Nổi Bật của Phiên Bản Mới (v1.1)

1. **Siêu nhanh (30 – 60 giây / testcase):** Thay vì 15–20 phút như trước đây.
2. **Độc lập 100% (Không phụ thuộc AI):** Bạn có thể tự chạy bất cứ lúc nào từ Terminal / Command Line, không tốn token của Claude.
3. **Giữ nguyên con trỏ ảo & hiệu ứng:** Video test xuất ra vẫn có con trỏ ảo màu đỏ di chuyển mượt mà và hiệu ứng ripple khi click chuột.
4. **Tự động hóa từ A đến Z:**
   - Tự động dùng lại Session đăng nhập (không phải gõ email/mật khẩu hay chọn tổ chức lại).
   - Tự động quay video màn hình chuẩn MP4 30fps.
   - Tự động upload lên Catbox lấy link vĩnh viễn.
   - Tự động tìm đúng dòng testcase và cột vòng test (Lần 1, Lần 2...) để điền kết quả vào Google Sheet an toàn.

---

## Cài Đặt Ban Đầu

1. **Cài đặt thư viện:**
   ```bash
   npm install
   ```

2. **Cấu hình file `.env`:**
   Đảm bảo file `.env` ở root repo có đủ các biến:
   ```env
   FASTDO_EMAIL=tester01.fastdo@gmail.com
   FASTDO_PASSWORD=...
   CATBOX_USERHASH=...
   TARGET_URL=https://lp3svsq4-5112.asse.devtunnels.ms/
   SHEET_ID=1ArYMmaaqbb_g1aa9irROzGXAm1tULQvUw8rq-sXK8Hk
   ```

3. **FFmpeg:**
   Đảm bảo `ffmpeg` đã có trong PATH (`ffmpeg -version`).

---

## Hướng Dẫn Chạy Test Độc Lập

### 1. Chạy 1 Testcase Cụ Thể (Mặc định Lần 1)
```bash
npm test -- EVAL_017
# hoặc:
node src/runner.js EVAL_017
```

### 2. Chạy Cho Các Vòng Test Khác (TEST LẦN 2, LẦN 3...)
```bash
npm test -- EVAL_017 --round=2
```
*Script sẽ tự động đọc dòng 1 của Sheet để tìm cột của "TEST LẦN 2" và ghi đúng ô.*

### 3. Các Tùy Chọn Bổ Sung Hữu Ích
- **Chạy thử không ghi vào Sheet (Dry run):**
  ```bash
  npm test -- EVAL_017 --no-sheet
  ```
- **Chạy siêu tốc không quay video (chỉ kiểm tra logic Pass/Fail trong 5–10s):**
  ```bash
  npm test -- EVAL_017 --no-record --no-sheet
  ```
- **Chỉ làm mới Session đăng nhập:**
  ```bash
  npm run test:auth
  ```

---

## Đọc Đặc Tả Case Từ Sheet — `npm run case`

```bash
npm run case -- EVAL_024              # đặc tả + tóm tắt kết quả các vòng
npm run case -- EVAL_024 --round=3    # kèm kết quả đầy đủ của LẦN 3
npm run case -- EVAL_024 --full       # kết quả đầy đủ mọi vòng
```

In ra `ID / Function / Tiêu đề / Mô tả (Điều kiện + Các bước + Kết quả mong muốn)
/ Nền tảng`. Toàn bộ lưới được kéo về bằng **1 request CSV gviz** trong tab Sheet
đang đăng nhập nên mất ~15s — không phải mở Sheet đọc bằng mắt hay chụp ảnh.

Dùng nó để biết **vòng test tiếp theo là lần mấy** trước khi chạy `--round=N`.

## Chạy `preflight` Trước Khi Đốt Thời Gian

Mỗi testcase mất 20–50 giây. Biết trước "mẫu sandbox đã bị xoá" ở giây thứ 20 tốt
hơn là nhìn 3 case lần lượt chết sau 1 phút.

```bash
npm run preflight
```

Kiểm 7 thứ, rẻ trước đắt sau: biến `.env` → `ffmpeg` trong PATH → tuổi file
session → dev tunnel còn sống → đăng nhập được → app render được → **mẫu sandbox
mà từng testcase cần có còn tồn tại và còn ở trạng thái Nháp không**.

Mục cuối là mục đáng giá nhất: nó quét hằng số `DRAFT_TEMPLATE_NAME` trong
`src/testcases/*.js` rồi đối chiếu với danh sách mẫu thật trên tunnel, và nói
thẳng case nào sẽ chết:

```
✗ Mẫu "EVAL_QA - Mau test nhom - Bản sao" — KHÔNG còn trên tunnel này
  → EVAL_017, EVAL_019, EVAL_020 sẽ chết ở openDraftByName
✓ Mẫu "Mẫu đánh giá Thực tập sinh - Bản sao" — có 4 bản, có Nháp → EVAL_021, EVAL_022 OK
```

Exit 0 = chạy được, exit 1 = có thứ chắc chắn làm test chết. Dùng được trong chuỗi:

```bash
npm run preflight && npm test -- EVAL_021 EVAL_022
```

`npm test` cũng đã trả **exit 1 khi có case FAIL** (trước đây chỉ lỗi fatal mới
exit 1, nên `npm test && <lệnh sau>` vẫn chạy tiếp dù case không đạt).

## Đọc DOM Bằng Text — `probe` (đừng chụp màn hình)

Khi cần biết trang có element gì, selector nào để viết testcase: **KHÔNG mở trình
duyệt ngắm rồi chụp ảnh.** Chạy `probe`, nó in ra danh sách element dạng text.

```bash
# Khám phá 1 trang
npm run probe -- "/evaluation?tab=template"

# Lọc theo chữ + kèm dump bảng
npm run probe -- "/evaluation?tab=template" --grep="nhóm|tiêu chí" --tables

# Chạm trạng thái sâu (sau vài cú click): mở mẫu Nháp ở chế độ Sửa
PROBE_TEMPLATE="Tên mẫu Nháp có thật" npm run probe -- "/evaluation?tab=template" \
  --setup=src/tools/setups/draft-editor.js
```

Mỗi element ra 1 dòng: tag, nhãn, **selector đề xuất** (ưu tiên `#id` → `data-*` →
`[placeholder]` → text-XPath → đường CSS neo vào `div.box`...), kèm **cờ độ tin cậy**:

| Cờ | Nghĩa |
|---|---|
| `⚠ BỊ CHE bởi <X>` | có thứ khác đè lên. **Click sẽ mất tác dụng và KHÔNG ném lỗi** — phải đóng lớp phủ trước |
| `⚠ TRONG OVERLAY` | element thuộc modal/popup đang mở |
| `⚠ NGOÀI VIEWPORT` | cần `scrollIntoView` trước khi click |
| `· click tâm trúng <X>` | tâm element có icon trang trí đè lên (thường vẫn click được) |
| `⚠ SELECTOR THEO VỊ TRÍ` | selector phải dùng `:nth-of-type` vì element không có id/attr/text riêng. Đúng lúc đo nhưng **vỡ khi render lại danh sách** — cân nhắc bám text, hoặc xin thêm `data-testid` vào app |
| `(khớp N element - GIÒN)` | selector không định danh duy nhất, phải thu hẹp thêm |
| `[disabled]` / `[ẩn]` | `[ẩn]` chỉ hiện khi `--all` |

Cờ khác: `--all` `--text` `--limit=<n>` `--out=<tên file>` `--keep-open`
`--wait=<ms>` `--wait-text=<chuỗi>`.

Digest đầy đủ ghi ra `diagnostics/probe_*.txt` (terminal chỉ in 15 dòng đầu) —
`grep` đúng phần cần thay vì đọc cả file.

## Khi Testcase FAIL — Đọc `diagnostics/`, Đừng Chạy Lại Để Nhìn

Case FAIL hoặc crash thì runner tự ghi `diagnostics/EVAL_0xx.fail.md`, gồm: URL
cuối, thông điệp lỗi, **selector thất bại**, **dòng `## Chẩn đoán` phân loại lỗi**,
nhật ký từng bước (bước nào chết), console error, request 4xx/5xx, digest DOM ngay
lúc chết, đường dẫn video.

Phân loại lỗi để không đi sửa sai chỗ — 8 hạng, quan trọng nhất là 3 hạng dễ bị
nhầm lẫn với nhau:

| Chẩn đoán | Nghĩa |
|---|---|
| `LỚP PHỦ CHẶN CLICK` | ≥50% element trong digest bị che. Đóng lớp phủ, đừng mò selector |
| `THIẾU TIỀN ĐIỀU KIỆN` | thiếu **bản ghi dữ liệu có tên** (mẫu/kỳ/tiêu chí). Chạy `preflight`, đừng mò selector |
| `SELECTOR KHÔNG KHỚP` | thiếu **control trên UI**. Lúc này mới lấy selector mới từ digest |
| `HẾT HẠN CHỜ` | điều kiện chờ không bao giờ đúng — sửa điều kiện, **đừng nới timeout cho qua** |
| `HẠ TẦNG CDP` / `BLAZOR MẤT CIRCUIT` | không phải lỗi app, chạy lại case |
| `BACKEND LỖI 5XX` | bug backend, không phải bug test |
| `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT` | test chạy trót lọt và kết luận không đạt — nếu đúng thì báo bug, **KHÔNG sửa test cho pass** |

Đang viết case mà bí giữa đường thì gọi `ctx.dump('nhãn')` ngay tại dòng đó — nó
ghi digest ra `diagnostics/<ID>_dump_N_<nhãn>.txt` và **không dừng test**:

```bash
npm test -- EVAL_025 --no-record --no-sheet   # 5-10s, rồi đọc file dump
```

`diagnostics/` nằm trong `.gitignore`.

## Cách Thêm Testcase Mới

Để thêm testcase mới (ví dụ `EVAL_018`):
1. `npm run probe -- "<đường dẫn trang>"` để lấy selector — không chụp màn hình.
2. Tạo file `src/testcases/eval_018.test.js`.
3. Khai báo `id`, `targetUrl`, và hàm `async run(ctx)`.
4. Bọc từng bước bằng `ctx.step('nhãn', () => ...)` để khi FAIL biết ngay chết ở bước nào.
5. Chạy: `npm test -- EVAL_018 --no-record --no-sheet` cho nhanh, FAIL thì đọc `diagnostics/EVAL_018.fail.md`.
