# Vận hành — cấu trúc, cờ CLI, Sheet, tốc độ

Tra cứu khi cần hiểu bộ máy bên dưới. Đường chạy thường ngày không cần file này.

---

## Cấu trúc `src/`

| File | Vai trò |
|---|---|
| `runner.js` | Điều phối toàn luồng bằng 1 lệnh CLI. Exit 1 khi có case FAIL |
| `core/session.js` | Lưu/nạp cookies + localStorage (`.auth/user_state*.json`, riêng theo slot) → bỏ qua đăng nhập và chọn tổ chức |
| `core/browser.js` | Nối vào Chrome ở cổng CDP của slot, không có thì tự khởi chạy Chrome thật với profile riêng của slot |
| `core/cursor_motion.js` | Con trỏ ảo đỏ + hiệu ứng sóng khi click, cho video |
| `core/recorder.js` | Quay MP4, mặc định 15fps (đổi bằng `RECORD_FPS` trong `.env`) |
| `core/catbox.js` | Upload Catbox lấy link vĩnh viễn (có `userhash` + retry) |
| `core/sheet_service.js` | Tìm dòng theo mã, tính cột `TEST LẦN N`, ghi Trạng thái + Kết quả, **verify lại sau khi ghi** |
| `core/dom_digest.js` | Sinh digest DOM dạng text + cờ độ tin cậy. Nguồn duy nhất cho probe / `ctx.dump` / báo cáo lỗi |
| `core/diagnostics.js` | Bắt console + request lỗi, nhật ký bước, phân loại lỗi, ghi `diagnostics/*.fail.md` |
| `core/page_ready.js` | `waitForSettle()` — chờ Blazor render xong VÀ overlay loading tan |
| `core/sheet_grid.js` | **Nguồn duy nhất** hiểu bố cục lưới Sheet: cột nào thuộc vòng nào, vòng kế tiếp là mấy, nhãn ô sắp ghi có đúng không |
| `core/evaluation_helpers.js` | Thao tác dùng chung trên module Đánh giá |
| `tools/plan.js` | CLI chuẩn bị: hạ tầng + đặc tả Sheet + vòng test + fixture, trong 1 phiên Chrome |
| `tools/preflight.js` | CLI kiểm hạ tầng + **toàn bộ** fixture của mọi testcase |
| `tools/case-info.js` | CLI đọc đặc tả 1 case từ Sheet (kèm `--full` xem hết kết quả cũ) |
| `tools/probe.js` | CLI khám phá DOM |
| `tools/commit-result.js` | Ghi một lần chạy `pending` vào Sheet sau khi QC duyệt (`npm run commit`) |
| `tools/ui/server.js` + `ui/index.html` | Bảng điều khiển cục bộ cho QC (`npm run ui`), chỉ nghe 127.0.0.1 |
| `tools/lib/fixtures.js` | Quét mẫu dữ liệu testcase cần, đối chiếu với mẫu đang có trên app |
| `testcases/` | Kịch bản từng case (`eval_017.test.js`...) |
| `core/*.test.js` | Test tự động cho phần bố cục Sheet — `npm run test:unit`, ~0.1s, không cần trình duyệt |

Sheet chỉ có một bố cục, nên logic "cột này thuộc vòng mấy" phải có đúng một bản.
`core/sheet_grid.js` là bản đó — cả `sheet_service` (ghi) lẫn `plan`/`case` (đọc)
đều dùng chung. Trước kia có hai bản lệch nhau: `plan` báo "vòng 3 có cột" trong
khi runner ghi về cột I của vòng 1.

---

## Cờ CLI

### `npm test`

| Cờ | Tác dụng |
|---|---|
| `--round=N` | ghi vào cột `TEST LẦN N` (mặc định 1) |
| `--no-record` | không quay video (nhanh hơn ~20s) |
| `--no-sheet` | không ghi Google Sheet |
| `--no-upload` | quay nhưng không upload Catbox |
| `--row=N` | chỉ định cứng dòng Sheet |
| `--case-timeout=<giây>` | hạn giờ mỗi case (mặc định 150) |
| `--auth-only` | chỉ đăng nhập lại, không chạy case nào (= `npm run test:auth`) |
| `--account=N` | chạy bằng tài khoản slot N (xem mục Chạy song song bên dưới) |
| `--report-json=runs/<tên>.json` | ghi bản kê JSON của cả lệnh (case nào, thư mục run nào, kết quả ra sao) |
| `--sheet-on=always\|pass\|never` | chính sách ghi Sheet. `pass` = chỉ ghi case ĐẠT, case không đạt để `pending` chờ QC duyệt. Mặc định `always` |

Nhiều mã trong cùng một lệnh thì dùng chung Chrome + session + tab Sheet:
`npm test -- EVAL_021 EVAL_022 EVAL_024 --round=2`.

**Cờ lạ là lỗi, không bị bỏ qua.** `--nosheet` gõ thiếu gạch từng biến một lần
chạy nháp thành lần ghi thật vào Sheet của team; nay runner dừng và in danh sách
cờ đúng. Mã case cũng phải đúng dạng `EVAL_...` — chuỗi tự do đi thẳng vào
`require()` nên là lỗ thực thi mã tuỳ ý.

### `npm run plan`

| Cờ | Tác dụng |
|---|---|
| `--full` | in đặc tả đầy đủ cho mọi case, kể cả case đã có kịch bản |
| `--round=N` | ép vòng test thay vì để plan suy ra từ Sheet |
| `--no-app` | bỏ bước mở app kiểm mẫu dữ liệu (nhanh hơn ~8s, chấp nhận rủi ro fixture đã mất) |
| `--split=N` | chia các case sẵn sàng thành N nhóm và in lệnh cho N slot chạy song song |

Exit code: `0` = mọi case sẵn sàng · `1` = có thứ chặn hẳn · `2` = thiếu kịch bản.
Dòng cuối `PLAN_RESULT ready=… missing=… blocked=…` để đọc nhanh hoặc xâu lệnh.

---

## Chạy song song nhiều tài khoản

`--account=N` dùng được ở **mọi** lệnh (`test`, `plan`, `probe`, `preflight`,
`case`) vì `config.js` đọc cờ này ngay khi nạp, trước cả khi tool chạy. Cũng đặt
được bằng biến môi trường `FASTDO_ACCOUNT=N` — tiện trên PowerShell, nơi cú pháp
`VAR=x lệnh` không dùng được.

Slot 1 giữ nguyên mọi tên cũ, nên `.env` và `.auth` sẵn có không phải sửa gì.

| Thứ tách riêng theo slot | Slot 1 | Slot 2 |
|---|---|---|
| Tài khoản | `FASTDO_EMAIL` / `FASTDO_PASSWORD` | `FASTDO_EMAIL_2` / `FASTDO_PASSWORD_2` |
| Tổ chức | `ORG_NAME` | `ORG_NAME_2`, không có thì dùng `ORG_NAME` |
| File session | `.auth/user_state.json` | `.auth/user_state_2.json` |
| Cổng CDP | 9222 | 9223 |
| Profile Chrome | `.chrome_profile` | `.chrome_profile_2` |
| Thư mục hiện vật | `runs/…-acc1-<pid>/` | `runs/…-acc2-<pid>/` |

Dùng chung mọi slot: `TARGET_URL` (cùng tunnel), `SHEET_ID`/`SHEET_TAB` (cùng
Sheet), `CATBOX_USERHASH` (cùng nơi lưu video).

Bốn thứ trên phải tách, thiếu một cái là hai lần chạy dẫm lên nhau:

- **Cổng CDP** — `initBrowser()` thử *nối* vào cổng trước khi khởi chạy. Hai slot
  cùng cổng thì slot thứ hai nối thẳng vào Chrome của slot thứ nhất và phá tab
  của nó, chứ không báo lỗi.
- **Profile Chrome** — Chrome không mở được 2 tiến trình trên cùng một
  `user-data-dir`, slot thứ hai chết ngay lúc khởi chạy.
- **File session** — hai tài khoản ghi đè cookie của nhau, kết quả là cả hai cùng
  chạy bằng một tài khoản mà không ai biết.
- **Thư mục hiện vật** — tên thư mục run có kèm slot và pid (`…-acc2-12345`). Thiếu
  phần này thì hai slot cùng khởi động một mã, cùng vòng, trong cùng một giây sẽ
  dùng chung thư mục, và `recorder` xoá đúng file video mà tiến trình kia đang ghi.

Giới hạn thật sự nằm ở chỗ mỗi slot là một Chrome thật đang quay video: 2–3 slot
trên một máy là hợp lý, nhiều hơn thì cả hai cùng chậm và video bị giật.

**Không đưa cùng một mã cho 2 slot.** Sheet không khoá ô: hai lần ghi vào cùng một
ô thì thứ giữ lại là của lần về đích sau, không phải lần đúng.

Lần đầu dùng slot 2, Chrome mở ra với profile trắng — phải **đăng nhập Google một
lần** trong cửa sổ đó (tài khoản có quyền sửa Sheet; dùng chung tài khoản Google
với slot 1 cũng được), nếu không bước ghi Sheet sẽ thất bại. Đăng nhập Fastdo thì
runner tự làm bằng `FASTDO_EMAIL_2`.

---

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
- Chạy vào vòng mà Sheet **chưa có cột** thì runner **dừng và không ghi gì**, nêu rõ
  Sheet đang có những vòng nào. `plan` cảnh báo trước để không phải đợi tới lúc đó.
- Trước khi ghi, runner đối chiếu nhãn dòng 2 của đúng 2 ô sắp ghi (`Trạng thái`,
  `Kết quả thực hiện`). Sheet có bố cục khác `+2/+3` sẽ bị chặn thay vì ghi nhầm cột.
- `--row=N` vẫn luôn phải khớp mã ở cột A, kể cả trên đường fallback không có lưới.

  > Cả ba chốt trên là kết quả của một lỗi có thật: bản cũ, khi không xác định được
  > cột của vòng, `console.warn` rồi trả về cột `I` — tức nối kết quả vòng 9 vào ô
  > vòng 1 và ghi đè Trạng thái vòng 1, im lặng. Xem
  > `docs/superpowers/specs/2026-09-18-chot-an-toan-va-lich-su-chay-design.md`.

---

## Lịch sử lần chạy — `runs/`

Mỗi case, mỗi lần chạy, một thư mục riêng — tên gồm thời điểm, mã, vòng, slot tài
khoản và pid, để hai lần chạy song song không bao giờ dùng chung thư mục:

```
runs/20260918-143205-EVAL_021-v3-acc1-24680/
├── result.json              kết quả đầy đủ + danh tính lần chạy
├── EVAL_021_AutoRecord.mp4  video (nếu có quay)
├── EVAL_021.fail.md         báo cáo chẩn đoán (nếu FAIL/CRASH)
└── EVAL_021_dump_*.txt      digest DOM do ctx.dump() sinh ra
```

Trước đây chạy lại một case là **xoá sạch bằng chứng lần trước**: `recorder` xoá
video cũ cùng tên, `fail.md` bị ghi đè, số thứ tự dump reset. Nay không còn.

Bản "mới nhất" vẫn nằm ở `diagnostics/<mã>.fail.md` như cũ — thêm chỗ mới nhưng
không lấy đi chỗ cũ.

`result.json` chứa nguyên object runner dựng sẵn (trước đây chỉ `console.log` rồi
chết theo tiến trình), cộng phần danh tính: vòng, slot tài khoản, `TARGET_URL`,
mốc bắt đầu/kết thúc, các cờ đã dùng. Trạng thái ghi Sheet phân biệt **ba nhánh**,
vì "chưa ghi" và "ghi hỏng" là hai chuyện khác hẳn nhau với QC:

| `sheet.state` | Nghĩa |
|---|---|
| `written` | đã ghi, kèm `cell` và `status` |
| `skipped` | không ghi, kèm `reason` (crash hạ tầng / `--no-sheet` / chưa có link video) |
| `failed` | có thử ghi nhưng hỏng, kèm `reason` |

`runs/` nằm trong `.gitignore`. Không có file chỉ mục — quét thẳng thư mục, vì
một file index là một thứ nữa có thể lệch với thực tế. Dọn bớt thư mục cũ bằng tay
khi thấy nặng.

---

## Ngân sách thời gian (đo trên EVAL_017)

| Chặng | Thời gian |
|---|---|
| Khởi tạo Chrome | 0.5s |
| Phục hồi session | 1.8s |
| Các bước kiểm thử | ~21s |
| Kết thúc & lưu video | 1.5s |
| Upload Catbox | 2.3s |
| Ghi Google Sheet | 5.2s |

Runner in bảng thời gian từng chặng ở cuối mỗi lần chạy — nhìn đó để biết chậm ở
đâu, đừng đoán.

### Bốn bẫy tốc độ đã gỡ, đừng để quay lại

1. **fps quay video** — 30fps làm mỗi lần chạy chậm thêm ~19s, vì mỗi khung hình
   là 1 lần screencast qua CDP. Mặc định 15fps, đổi bằng `RECORD_FPS`.
2. **Dò ô Google Sheet từng cái** — mỗi ô ~0.7s; dò dòng 2→22 rồi cột A→R tốn ~28s.
   Nay kéo cả lưới bằng 1 request CSV.
3. **`waitForSelector` cho thứ có thể không xuất hiện** — chờ trang cảnh báo dev
   tunnel với timeout 3000 đốt trọn 3s mỗi lần chạy trong trường hợp phổ biến là
   không có cảnh báo. Dùng `page.$()` cho DOM server render sẵn.
4. **Mỗi câu hỏi một lần khởi động Chrome** — quy trình cũ tốn 4 phiên Chrome cho
   1 case (preflight → case-info → nháp → thật). `plan` gộp 2 phiên đầu làm 1, và
   chạy nhiều mã trong một lệnh `npm test` gộp phần còn lại.

---

## Claude tự chạy trên trang (npm run ui) bị treo

Đã gặp thật và đã sửa 2 lớp:

1. **Nút "Dừng" không dừng hết.** Khi Claude tự chạy lệnh qua Bash tool của nó
   (`CLAUDE_AUTO_RUN=1`), tiến trình con trên Windows đi qua Git Bash và liên kết
   cha-con trong bảng tiến trình Windows BỊ ĐỨT khỏi `claude.exe` — `taskkill /T`
   đúng gốc vẫn không tìm thấy nhánh đó. `server.js`'s `killTree()` nay quét bổ
   sung theo NỘI DUNG dòng lệnh (chứa đường dẫn repo) khi dừng job kind `claude`.
2. **`npm run probe` có thể treo vô thời hạn.** `page.evaluate()` không tự bung
   dù `protocolTimeout` đặt 90s trong một số tình huống — probe.js nay có
   watchdog cứng 90s, tự huỷ và thoát thay vì treo mãi.

Tự dọn Chrome/Node còn sót lại (không cần server đang chạy):

```bash
npm run chrome:kill
```

## Khi Chrome/CDP dở chứng

- **Không đóng Chrome hay chuyển tab khi runner đang chạy.** Chrome bóp cổ tab nền
  tới mức mọi lệnh CDP trên nó treo vô hạn — đã làm EVAL_020/021/022 treo hơn 300
  giây mỗi case. Runner có `page.bringToFront()` đầu mỗi case và watchdog 150s để
  hạn chế, nhưng đừng thử lại.
- Session hết hạn (đăng nhập lại từ đầu, hoặc app đá ra màn hình chọn tổ chức):
  `npm run test:auth`.
- **Điều hướng thẳng tới URL sâu có thể đua với việc app tự khôi phục ngữ cảnh tổ
  chức phía client** — session hợp lệ nhưng trang render lại màn "chọn tổ chức"
  thay vì trang thật (URL trên thanh địa chỉ vẫn đúng, chỉ nội dung sai).
  `waitForSettle()` và `openEvaluationTab()` tự phát hiện và chọn lại, nhưng
  KHÔNG phải lúc nào cũng thắng được cuộc đua — app có độ trễ không ổn định ở
  bước này. Gặp lỗi "Chờ trang ... sẵn sàng quá 25000ms" thì chạy lại lệnh,
  thường qua ngay ở lần thứ 2.
- Video hoặc upload chết mà app vẫn chạy: `npm run smoke-test` để tách bạch lỗi
  đường ống ghi hình khỏi lỗi testcase.
