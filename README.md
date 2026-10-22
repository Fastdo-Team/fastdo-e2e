# Fastdo Test Auto (Fast & Independent Runner)

Bộ công cụ QA Automation tối ưu tốc độ cao cho các testcase Fastdo (Google Sheet `fEvaluation - VIBE`).

> **Quy trình đầy đủ để test 1 case** nằm trong
> [`.claude/skills/fastdo-eval-runner/SKILL.md`](.claude/skills/fastdo-eval-runner/SKILL.md) —
> 4 bước, có đủ điểm dừng và bảng chẩn đoán. Nói với Claude `test EVAL_024` là nó
> tự chạy theo đúng quy trình đó. README này là tra cứu từng lệnh rời.
>
> Tự chạy tay thì chỉ cần nhớ 3 lệnh:
> ```bash
> npm run plan -- EVAL_024                      # chuẩn bị + biết nên ghi vòng mấy
> npm test -- EVAL_024 --no-record --no-sheet   # chạy nháp, an toàn
> npm test -- EVAL_024 --round=3                # chạy thật: video + Google Drive + Sheet
> ```
>
> Hoặc không gõ lệnh nào: `npm run ui` mở bảng điều khiển cho QC.

---

## Điểm Nổi Bật của Phiên Bản Mới (v1.1)

1. **Siêu nhanh (30 – 60 giây / testcase):** Thay vì 15–20 phút như trước đây.
2. **Độc lập 100% (Không phụ thuộc AI):** Bạn có thể tự chạy bất cứ lúc nào từ Terminal / Command Line, không tốn token của Claude.
3. **Giữ nguyên con trỏ ảo & hiệu ứng:** Video test xuất ra vẫn có con trỏ ảo màu đỏ di chuyển mượt mà và hiệu ứng ripple khi click chuột.
4. **Tự động hóa từ A đến Z:**
   - Tự động dùng lại Session đăng nhập (không phải gõ email/mật khẩu hay chọn tổ chức lại).
   - Tự động quay video màn hình chuẩn MP4 30fps.
   - Tự động upload lên Google Drive (quyền «ai có link đều xem được») lấy link xem.
   - Tự động tìm đúng dòng testcase và cột vòng test (Lần 1, Lần 2...) để điền kết quả vào Google Sheet an toàn.

---

## Cài Đặt Ban Đầu

1. **Cài đặt thư viện:**
   ```bash
   npm install
   ```

2. **Cấu hình file `.env`:**
   ```bash
   cp .env.example .env
   ```
   Bắt buộc phải có đủ, thiếu một biến là runner dừng ngay (không còn giá trị mặc
   định cứng trong code — trước đây `.env` mất `SHEET_ID` vẫn chạy và ghi vào Sheet
   mặc định, tức ghi nhầm Sheet mà không ai biết):

   | Biến | Là gì |
   |---|---|
   | `FASTDO_EMAIL` / `FASTDO_PASSWORD` | tài khoản đăng nhập app |
   | `DRIVE_CLIENT_ID` / `DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN` / `DRIVE_FOLDER_ID` | Google Drive lưu video — `npm run drive:auth` ghi sẵn cả 4 (cách chuẩn bị ở đầu `src/tools/drive-auth.js`) |
   | `TARGET_URL` | dev tunnel hiện hành — **hay hết hạn nhất**, đổi thường xuyên |
   | `SHEET_ID` | id Google Sheet (đoạn giữa `/d/` và `/edit` trong link) |
   | `SHEET_TAB` | tên tab trong Sheet, ví dụ `fEvaluation - VIBE` |

   Tuỳ chọn: `FASTDO_EMAIL_2`/`FASTDO_PASSWORD_2` (chạy song song), `ORG_NAME`,
   `RECORD_FPS`, `CDP_PORT`.

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

## Chuẩn Bị Bằng 1 Lệnh — `npm run plan`

```bash
npm run plan -- EVAL_021 EVAL_022
```

Gộp `preflight` + `case` vào **một phiên Chrome duy nhất**, trả lời trọn bộ câu
hỏi cần biết trước khi chạy: hạ tầng còn sống không, case có trong Sheet không,
đặc tả là gì, đã có kịch bản chưa, mẫu dữ liệu case cần còn không, và **nên ghi
vào vòng test thứ mấy** (suy ra từ các vòng đã có kết quả). Không chạy test nào,
không ghi gì — cứ chạy thoải mái.

Kết thúc bằng lệnh chạy đã ghép sẵn, chép lại là được:

```
  Sẵn sàng chạy : EVAL_021 (vòng 3), EVAL_022 (vòng 3)

  Chạy nháp (không video, không ghi Sheet — cứ chạy, an toàn):
      npm test -- EVAL_021 EVAL_022 --no-record --no-sheet

  Chạy thật (quay video + upload Google Drive + GHI SHEET):
      npm test -- EVAL_021 EVAL_022 --round=3

PLAN_RESULT ready=EVAL_021:3,EVAL_022:3 missing=- blocked=-
```

Cờ: `--full` (in đặc tả đầy đủ mọi case) · `--round=N` (ép vòng) · `--no-app`
(bỏ bước kiểm mẫu dữ liệu, nhanh hơn ~8s).
Exit code: `0` sẵn sàng · `1` có thứ chặn hẳn · `2` thiếu kịch bản. Xâu chuỗi được:

```bash
npm run plan -- EVAL_021 && npm test -- EVAL_021 --round=3
```

`preflight` và `case` vẫn dùng được khi cần kiểm riêng **toàn bộ** fixture của mọi
testcase, hoặc đọc đặc tả một case mà chưa định chạy.

## Chạy Song Song 2 Tài Khoản — `--account=N`

Mỗi case mất 20–50 giây và phần lớn là ngồi chờ app. Hai tài khoản Fastdo chạy
cùng lúc rút gần một nửa thời gian của cả cụm.

Thêm tài khoản thứ hai vào `.env` (slot 1 giữ nguyên tên biến cũ, không sửa gì):

```env
FASTDO_EMAIL_2=...
FASTDO_PASSWORD_2=...
# ORG_NAME_2=...   # chỉ khi tài khoản 2 thuộc tổ chức khác
```

Để `plan` chia việc — nó kiểm luôn `.env` đã đủ tài khoản chưa rồi in sẵn 2 lệnh:

```bash
npm run plan -- EVAL_021 EVAL_022 EVAL_023 EVAL_024 --split=2
```

```
[Terminal 1] npm test -- EVAL_021 EVAL_023 --round=3
[Terminal 2] npm test -- EVAL_022 EVAL_024 --account=2 --round=3
```

Mở **2 cửa sổ terminal**, mỗi cửa sổ một lệnh, chạy cùng lúc. `--account=N` dùng
được ở mọi lệnh (`test`, `plan`, `probe`, `preflight`, `case`); trên PowerShell có
thể dùng `$env:FASTDO_ACCOUNT=2` thay cho cờ.

Mỗi slot tách riêng 4 thứ nên không dẫm lên nhau:

| | Slot 1 | Slot 2 |
|---|---|---|
| Tài khoản | `FASTDO_EMAIL` | `FASTDO_EMAIL_2` |
| File session | `.auth/user_state.json` | `.auth/user_state_2.json` |
| Cổng CDP | 9222 | 9223 |
| Profile Chrome | `.chrome_profile` | `.chrome_profile_2` |
| Thư mục video | `videos/` | `videos/acc2/` |

Dùng chung: tunnel, Google Sheet, Google Drive.

Hai lưu ý:

- **Không đưa cùng một mã cho 2 slot.** Sheet không khoá ô — hai lần ghi vào cùng
  một ô thì thứ giữ lại là của lần về đích sau, không phải lần đúng.
- **Lần đầu dùng slot 2, Chrome mở ra với profile trắng** → đăng nhập Google một
  lần trong cửa sổ đó (tài khoản có quyền sửa Sheet; dùng chung tài khoản Google
  với slot 1 cũng được). Đăng nhập Fastdo thì runner tự làm.

Mỗi lần chạy in dòng `[BROWSER] Slot N · email · CDP port` để nhìn là biết đang
chạy bằng tài khoản nào.

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

## Bảng Điều Khiển Cho QC — `npm run ui`

```bash
npm run ui
```

Mở `http://127.0.0.1:7788` (terminal in ra link kèm token, token đổi mỗi lần khởi
động). Đổi cổng: `UI_PORT=7799 npm run ui`.

Bốn khối trên một trang:

1. **Thanh trạng thái** — cấu hình đủ chưa, app đang trỏ đâu, tab Sheet nào, có
   ffmpeg không, có tài khoản slot 2 không.
2. **Chọn case** — bảng các case đã có kịch bản, checkbox, tiêu đề đọc thẳng từ file.
3. **Tuỳ chọn + chạy** — vòng test, slot tài khoản, chính sách ghi Sheet, quay video,
   upload. Nút **Chuẩn bị** chạy `plan` để biết nên ghi vòng mấy. Trước khi bấm Chạy,
   trang nói rõ "sẽ ghi vào TEST LẦN mấy". Nhật ký chảy về thời gian thực, có nút Dừng.
4. **Lịch sử & duyệt** — mọi lần chạy trong `runs/`: PASS/FAIL, video, trạng thái ghi
   Sheet, báo cáo chẩn đoán, và nút **Ghi vào Sheet** cho case đang chờ duyệt.

Tab **Cấu hình** đổi được link Sheet (dán cả link cũng được), tên tab, `TARGET_URL`,
tên tổ chức và FPS — ghi thẳng vào `.env` theo kiểu vá từng dòng, giữ bản cũ ở
`.env.bak`.

### Bảng Case Lấy Từ Sheet

```bash
npm run sheet:dump    # hoặc bấm "Làm mới từ Sheet" trên trang
```

Kéo **toàn bộ** danh sách testcase từ Sheet về `runs/.sheet-cache.json` (mở Chrome ~15s),
gồm mọi cột đặc tả mà Sheet đang có — nhãn cột đọc thẳng từ Sheet nên thêm/bớt cột
không phải sửa code. Bảng trên trang hiện đủ các cột đó, kèm: đã có kịch bản chưa,
các vòng đã chạy kèm trạng thái, và vòng kế tiếp nên ghi.

Ô tìm kiếm lọc theo mọi cột (nhiều từ = phải khớp hết). Các nút lọc nhanh: có/chưa có
kịch bản, đã chạy/chưa chạy vòng nào.

Tick case rồi bấm:

- **Chạy thật / Chạy nháp** — chỉ áp dụng cho case đã có kịch bản; case chưa có bị bỏ qua
  và trang nói rõ bỏ qua mấy case.
- **Giao Claude viết kịch bản** — cho case chưa có. Xem mục dưới.

Nhật ký tách **riêng từng case**: khung "Toàn bộ" cộng một khung cho mỗi mã, có dấu
✓/✗ ngay trên nút khi case đó xong.

### Giao Việc Cho Claude

Mặc định là **hàng đợi**: trang ghi yêu cầu kèm câu nhắc dựng sẵn vào
`runs/.claude-queue.json` và hiện ở tab "Việc cho Claude" — chép câu nhắc dán vào phiên
chat với Claude. Trang **không** tự khởi động Claude.

Muốn bấm một nút là Claude tự chạy thì đặt `CLAUDE_AUTO_RUN=1` trong `.env`. Lúc đó
server spawn `claude -p ... --permission-mode bypassPermissions` và log chảy về trang như
mọi job khác. Công tắc này **cố ý chỉ sửa được trong `.env`, không có nút trên trình
duyệt** — bật nó nghĩa là một nút web khởi động được agent có quyền chạy lệnh trên máy.

Nút **Nhờ Claude chẩn đoán** ở mỗi lần chạy FAIL cũng đi qua đúng cơ chế đó.

### Trang Tự Cập Nhật

Server theo dõi `src/testcases/` và `runs/`. Claude vừa viết xong một kịch bản mới
thì bảng case tự hiện thêm dòng; một lần chạy vừa xong thì lịch sử tự cập nhật —
không cần F5.

Muốn lần chạy do Claude khởi động cũng hiện log trực tiếp trên trang, bảo Claude
dùng `node src/tools/ui-run.js EVAL_xxx --round=N` thay cho `npm test`. Nó đọc
`.ui-token` ở gốc repo, giao việc cho giao diện, rồi vẫn in log ra terminal. Giao
diện không chạy thì tool thoát mã 2 để biết mà quay về `npm test`.

Hai lần chạy cùng một slot bị chặn: chung cổng CDP và chung profile Chrome thì lần
sau sẽ nối vào Chrome của lần trước và phá tab của nó.

### Những gì giao diện cố ý KHÔNG làm

- Chỉ nghe `127.0.0.1`, mọi thao tác ghi cần token sinh lúc khởi động. Không dùng
  chung qua mạng.
- **Mật khẩu và `DRIVE_*` không đọc, không sửa được** qua trình duyệt — chỉ
  hiện đã cấu hình hay chưa. Sửa chúng trong `.env`.
- `TARGET_URL` phải là `https` và thuộc danh sách tên miền cho phép
  (`.devtunnels.ms`, `.fastdo.vn`, mở rộng bằng `TARGET_URL_ALLOW` trong `.env`).
  Lý do: runner gõ email và mật khẩu thật vào bất cứ trang nào URL đó trỏ tới.
- Không có ô nhập số dòng (`--row`) — đó là cờ cứu hộ của dev.
- Không viết được kịch bản case mới; việc đó vẫn cần Claude.

## Duyệt Kết Quả — `--sheet-on` và `npm run commit`

```bash
npm test -- EVAL_021 --round=3 --sheet-on=pass
```

`--sheet-on` nhận `always` (mặc định, như xưa nay) · `pass` · `never`.

Với `pass`, case **ĐẠT** ghi thẳng vào Sheet, còn case **KHÔNG ĐẠT** dừng ở trạng
thái `pending`: vẫn quay video, vẫn upload Google Drive, vẫn có `result.json` — chỉ chưa
đụng Sheet. Lý do: `Fail` trong Sheet có thể là bug app, mà cũng có thể chỉ là kịch
bản sai selector. Hai thứ đó không được lẫn, và người phân biệt được là QC sau khi
xem video.

Xem xong thì duyệt:

```bash
npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680 --dry   # xem trước
npm run commit -- runs/20260918-143205-EVAL_021-v3-acc1-24680         # ghi thật
```

Nó không chạy lại test và không bịa dữ liệu — lấy nguyên từ `result.json` rồi đi qua
đúng `updateSheetResult`, tức đúng mọi chốt an toàn. Chỉ nhận lần chạy đang `pending`,
nên không ghi trùng được.

## Bằng Chứng Mỗi Lần Chạy — `runs/`

Mỗi case, mỗi lần chạy, một thư mục riêng — chạy lại **không xoá bằng chứng lần trước** nữa:

```
runs/20260918-143205-EVAL_021-v3-acc1-24680/
├── result.json              kết quả đầy đủ + vòng, slot tài khoản, TARGET_URL, mốc giờ
├── EVAL_021_AutoRecord.mp4  video
├── EVAL_021.fail.md         báo cáo chẩn đoán (nếu FAIL/CRASH)
└── EVAL_021_dump_*.txt      digest DOM do ctx.dump() sinh ra
```

Bản "mới nhất" vẫn ở `diagnostics/<mã>.fail.md` như cũ. `runs/` nằm trong `.gitignore`;
dọn bớt thư mục cũ bằng tay khi thấy nặng.

Trong `result.json`, trạng thái ghi Sheet phân biệt ba nhánh — `written` (kèm ô đã ghi),
`skipped` (kèm lý do: crash hạ tầng / `--no-sheet` / chưa có link video), `failed`
(kèm thông điệp lỗi). "Chưa ghi" và "ghi hỏng" là hai chuyện khác hẳn nhau.

Thêm `--report-json=runs/<tên>.json` để runner ghi bản kê của cả lệnh: chạy những case nào,
thư mục run tương ứng ở đâu, kết quả ra sao.

## Chốt An Toàn Khi Ghi Sheet

Runner **từ chối ghi** thay vì đoán, trong cả ba tình huống dưới đây. Lỗi bắt đầu bằng
`[AN TOÀN]`:

- **Sheet chưa có cột của vòng được yêu cầu.** Trước đây chỗ này âm thầm trả về cột `I`
  — tức nối kết quả vòng 9 vào ô vòng 1 và ghi đè Trạng thái vòng 1. Nay dừng hẳn và nêu
  Sheet đang có những vòng nào.
- **Nhãn dòng 2 của ô sắp ghi không phải `Trạng thái` / `Kết quả thực hiện`.** Bắt được
  Sheet có bố cục khác `+2/+3`.
- **Dòng không khớp mã ở cột A**, kể cả khi dòng do `--row=N` chỉ định.

Kèm theo: cờ gõ sai (`--nosheet`) nay là lỗi chứ không bị bỏ qua, mã case phải đúng dạng
`EVAL_...`, và thiếu biến bắt buộc trong `.env` thì dừng ngay thay vì chạy tiếp rồi hỏng
sau khi đã quay xong video.

Chạy test cho chính phần logic này (~0.1s, không cần trình duyệt):

```bash
npm run test:unit
```

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
