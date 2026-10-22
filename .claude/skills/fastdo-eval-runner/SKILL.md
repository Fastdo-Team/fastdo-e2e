---
name: fastdo-eval-runner
description: Chạy test QA tự động cho testcase Fastdo trong Google Sheet "fEvaluation - VIBE" — đọc đặc tả case từ Sheet, điều khiển Chrome thật qua CDP, quay video có con trỏ ảo, upload Google Drive lấy link xem, ghi kết quả vào đúng cột vòng test. Dùng skill này bất cứ khi nào user nhắc tới mã EVAL_xxx, nói "test/chạy/kiểm thử/quay lại case", hỏi case đã chạy tới vòng mấy, nhờ viết kịch bản test cho một case, hoặc nhờ đọc báo cáo lỗi của một lần chạy — kể cả khi họ không gọi tên skill.
---

# Fastdo Eval Runner

Bộ kiểm thử tự động cho testcase Fastdo trong Google Sheet `fEvaluation - VIBE`.

**Gốc repo** = thư mục chứa `package.json`, tức 4 cấp trên file này
(`.claude/skills/fastdo-eval-runner/SKILL.md` → lên 4 → gốc). Mọi lệnh dưới đây
chạy ở đó. Đừng `cd` sang đường dẫn tuyệt đối nào — repo này được clone ở chỗ
khác nhau trên từng máy.

Nguyên tắc chia vai — **Claude viết kịch bản (1 lần mỗi case). CLI diễn (mãi mãi,
0 token).** Đừng làm thay việc của CLI: đừng chụp màn hình để tìm nút bấm, đừng
click bằng computer-use. Cái giá của việc làm thay là 8–20k token mỗi case và
selector đoán sai.

Có hai kiểu người dùng bộ này, cả hai đều hợp lệ:

- **QC tự gõ terminal** — case đã có kịch bản thì không cần Claude, không tốn token.
- **QC nhờ Claude** — khi case chưa có kịch bản, khi FAIL cần chẩn đoán, hoặc khi
  muốn chạy cả cụm case một lượt.

---

# Lần đầu trên một máy mới (làm đúng 1 lần)

Bỏ qua bước này thì mọi lệnh chết bằng `Cannot find module 'dotenv'` — thông báo
đó không nói cho ai biết phải làm gì, nên kiểm tra trước khi đổ lỗi cho app.

```bash
npm install
```

```bash
cp .env.example .env
```

Rồi điền vào `.env`: `FASTDO_EMAIL`, `FASTDO_PASSWORD`,
`TARGET_URL` (dev tunnel hiện hành), `SHEET_ID`, `SHEET_TAB`; Google Drive lưu video thì chạy
`npm run drive:auth` (tự ghi `DRIVE_*`).
Cần thêm `ffmpeg` trong PATH để quay video — thiếu nó vẫn chạy được nhưng phải
thêm `--no-record`, và khi đó không có video nộp QC.

`npm run plan` ở Bước 1 tự kiểm cả 3 thứ này và nói rõ thiếu gì.

## Phụ thuộc — thiếu thì đề xuất cài, đừng lách

Khi phát hiện thiếu một trong các thứ dưới đây, **nói ra và đưa lệnh cài cho user
quyết**, đừng tự đi đường vòng (đừng chụp màn hình thay cho MCP, đừng bỏ
`--no-record` để né ffmpeg mà không báo — QC mất video là mất bằng chứng).

| Phụ thuộc | Ai kiểm | Thiếu thì làm gì |
|---|---|---|
| Node ≥ 18, `npm install`, `.env`, ffmpeg, Chrome | `npm run plan` tự kiểm | Làm theo đúng câu lệnh `plan` in ra |
| MCP `fastdo-chrome` (chỉ cần khi viết kịch bản mới) | Claude kiểm bằng `claude mcp list` | Đề xuất lệnh dưới đây, **hỏi user trước khi chạy** vì nó sửa cấu hình máy |

```bash
claude mcp add fastdo-chrome -s user -- npx -y chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222
```

Bản `chrome-devtools` đăng ký sẵn (nếu có) **không dùng được cho việc này** vì
thiếu `--browserUrl`: nó tự mở một Chrome riêng profile trắng, chưa đăng nhập
Fastdo. Đăng ký thêm server mới chứ đừng sửa bản cũ — sửa sẽ làm hỏng nó khi dùng
cho việc khác. Chi tiết cách dùng nằm trong `references/viet-kich-ban.md`.

MCP là **tuỳ chọn**: không có nó vẫn chạy test và vẫn viết được kịch bản bằng
`npm run probe`. Chỉ đề xuất cài khi thật sự đang cần soi DOM trực tiếp.

---

# QUY TRÌNH khi cần chạy một hay nhiều case

## Bước 1 — `npm run plan` (một lệnh, ~10–15s, trả lời hết)

```bash
npm run plan -- EVAL_021 EVAL_022
```

Một phiên Chrome duy nhất trả lời trọn bộ câu hỏi cần biết trước khi chạy: hạ
tầng còn sống không, case có trong Sheet không, đặc tả là gì, đã có kịch bản
chưa, mẫu dữ liệu case cần còn không, và **nên ghi vào vòng test thứ mấy**.

Đọc dòng `PLAN_RESULT` ở cuối là đủ để biết đi tiếp thế nào:

| Kết quả | Làm gì |
|---|---|
| `ready=EVAL_021:3` | có kịch bản, hạ tầng OK → sang Bước 2 |
| `missing=EVAL_050` | chưa có kịch bản → viết trước, xem Bước 2b |
| `blocked=...` | **DỪNG.** Mã sai, hoặc mẫu dữ liệu đã bị xoá khỏi tunnel. Chạy tiếp là chết oan |
| `✗ Dev tunnel` | **DỪNG.** `TARGET_URL` trong `.env` đã hết hạn/đổi — hỏi user URL mới |

`plan` **không chạy test nào** và không ghi gì — cứ chạy thoải mái.
Nó thay cho cả `npm run preflight` lẫn `npm run case` ở đường chạy thường ngày;
hai lệnh đó vẫn còn dùng được khi cần kiểm riêng toàn bộ fixture hoặc đọc đặc tả
một case mà chưa định chạy.

## Bước 2 — Chốt vòng test với user

`plan` in sẵn `→ Vòng sẽ ghi: LẦN N` suy ra từ các vòng đã có kết quả trong Sheet.
**Nói lại con số đó rồi chờ user xác nhận trước khi chạy thật.**

> "Sheet cho thấy EVAL_021 đã chạy LẦN 1–2 (đều DONE). Tôi sẽ ghi vào **TEST LẦN 3**. Đúng chưa?"

Ghi sai cột là ghi đè lên dữ liệu QC của vòng khác — nên đây là điểm dừng duy
nhất còn lại trong quy trình. Nếu user đã nói rõ vòng ngay từ đầu ("test EVAL_021
lần 3") thì dùng luôn, không hỏi lại.

### 2b. Nếu case chưa có kịch bản

Đọc `references/viet-kich-ban.md` rồi làm theo. Tóm tắt: khám phá DOM bằng text
(`npm run probe`, hoặc MCP `chrome-devtools` khi cần soi trực tiếp), bám đúng
"Các bước" và "Kết quả mong muốn" mà `plan` đã in ra từ Sheet, tạo
`src/testcases/eval_xxx.test.js`, rồi quay lại Bước 3.

Đừng tự nghĩ tiêu chí đạt/không đạt khác với đặc tả trong Sheet.

## Bước 3 — Chạy nháp, rồi chạy thật

```bash
npm test -- EVAL_021 EVAL_022 --no-record --no-sheet
```

Không quay video, không ghi Sheet, không upload gì — an toàn tuyệt đối, **không
cần hỏi user**, cứ chạy. FAIL thì đọc `diagnostics/EVAL_XXX.fail.md`, sửa, chạy
lại. Xem bảng chẩn đoán bên dưới.

PASS rồi mới chạy thật:

```bash
npm test -- EVAL_021 EVAL_022 --round=3
```

Nhiều case trong **một lệnh** thì dùng chung Chrome + session + tab Sheet, tiết
kiệm ~8–10 giây **mỗi** case so với gọi từng lệnh rời. Đây là đòn bẩy tốc độ lớn
nhất khi chạy cả cụm — `plan` đã in sẵn lệnh gộp đúng cú pháp, chép lại là được.

Bước này **quay video, upload lên Google Drive (ai có link đều xem được), và ghi vào Google
Sheet của team**. Đó là lý do phải chốt vòng ở Bước 2.

### 3b. Chạy song song 2 tài khoản — khi có nhiều case

Mỗi case mất 20–50 giây và phần lớn thời gian đó là ngồi chờ app. Hai tài khoản
Fastdo chạy cùng lúc thì rút gần một nửa thời gian của cả cụm.

Thêm tài khoản thứ hai vào `.env` (slot 1 giữ nguyên tên biến cũ, không phải sửa):

```
FASTDO_EMAIL_2=...
FASTDO_PASSWORD_2=...
```

Rồi để `plan` chia việc:

```bash
npm run plan -- EVAL_021 EVAL_022 EVAL_023 EVAL_024 --split=2
```

Nó kiểm luôn `.env` đã có tài khoản slot 2 chưa, rồi in ra 2 lệnh — **mở 2 cửa sổ
terminal, mỗi cửa sổ một lệnh, chạy cùng lúc**:

```
[Terminal 1] npm test -- EVAL_021 EVAL_023 --round=3
[Terminal 2] npm test -- EVAL_022 EVAL_024 --account=2 --round=3
```

`--account=N` là cờ dùng được ở **mọi** lệnh (`plan`, `test`, `probe`,
`preflight`, `case`). Mỗi slot tự có Chrome riêng (cổng 9222 / 9223), profile
riêng, file session riêng và thư mục video riêng, nên hai lần chạy không đụng
nhau. Mỗi lần chạy in dòng `[BROWSER] Slot N · email · CDP port` để nhìn là biết
đang chạy bằng tài khoản nào.

Ba điều cần nhớ:

1. **Không đưa cùng một mã cho 2 slot.** Hai lần chạy sẽ ghi đè lẫn nhau trên
   cùng một ô Sheet, và thứ giữ lại là của lần về đích sau — không phải lần đúng.
2. **Lần đầu dùng slot 2, Chrome mở ra với profile trắng.** Đăng nhập Google một
   lần trong cửa sổ đó (tài khoản có quyền sửa Sheet — dùng chính tài khoản đang
   dùng ở slot 1 cũng được), nếu không thì bước ghi Sheet sẽ thất bại. Đăng nhập
   Fastdo thì runner tự làm bằng `FASTDO_EMAIL_2`.
3. **Đừng chạy quá 2–3 slot trên một máy.** Mỗi slot là một Chrome thật đang quay
   video; quá tay thì cả hai cùng chậm và video bị giật.

## Bước 4 — Bàn giao cho QC

Runner in sẵn bảng kết quả ở cuối. Chép lại đúng số liệu đó, đừng diễn giải thêm,
theo dạng:

```
EVAL_021 — ĐẠT (ghi TEST LẦN 3)
  Kết quả  : <resultText runner in ra>
  Video    : https://drive.google.com/file/d/xxxxx/view
  Sheet    : ô K23, Trạng thái = DONE
  Thời gian: 41.2s
```

Case KHÔNG ĐẠT thì thêm 2 dòng, vì đó mới là thứ QC cần để xử lý tiếp:

```
  Chẩn đoán: <dòng ## Chẩn đoán đầu file fail.md>
  Báo cáo  : runs/<thời điểm>-EVAL_021-v3-acc1-<pid>/EVAL_021.fail.md
```

Mọi bằng chứng của **lần chạy đó** nằm trong `runs/<thời điểm>-<mã>-v<vòng>-acc<slot>-<pid>/`:
`result.json`, video, báo cáo lỗi, các digest DOM. Chạy lại không xoá lần trước
nữa. Bản mới nhất vẫn có ở `diagnostics/<mã>.fail.md` như cũ.

Chạy với `--sheet-on=pass` thì case KHÔNG ĐẠT **chưa vào Sheet** — nó dừng ở trạng
thái `pending` để QC xem video rồi tự duyệt bằng `npm run commit -- <thư mục run>`
(hoặc nút **Ghi vào Sheet** trong `npm run ui`). Lý do: `Fail` trong Sheet có thể là
bug app, mà cũng có thể chỉ là kịch bản sai selector — runner không phân biệt được,
QC xem video thì được.

Nói rõ cho QC cách xác nhận: **mở link video, đối chiếu với "Kết quả mong muốn"
trong đặc tả.** Video là bằng chứng, Sheet là nơi lưu. Nếu video cho thấy app
đúng mà test báo sai, đó là lỗi kịch bản — báo lại để sửa, đừng sửa Sheet bằng tay.

---

# Khi FAIL — đọc chẩn đoán trước, đừng mò selector

`diagnostics/EVAL_XXX.fail.md` có mục `## Chẩn đoán` ngay đầu file. **Đọc dòng đó
trước tiên** — 3 hạng đầu rất dễ nhầm nhau và sửa sai chỗ:

| Chẩn đoán | Làm gì |
|---|---|
| `LỚP PHỦ CHẶN CLICK` | đóng lớp phủ (cột cờ trong digest cho biết ai che). **KHÔNG mò selector** |
| `THIẾU TIỀN ĐIỀU KIỆN` | fixture dữ liệu đã mất → chạy lại `npm run plan`. **KHÔNG mò selector** |
| `SELECTOR KHÔNG KHỚP` | lúc này mới lấy selector mới từ mục `DOM lúc chết` |
| `HẾT HẠN CHỜ` | sửa điều kiện chờ (`H.waitFor`). **KHÔNG nới timeout cho qua** |
| `HẠ TẦNG CDP` / `BLAZOR MẤT CIRCUIT` | chạy lại case, không phải lỗi app |
| `BACKEND LỖI 5XX` | bug backend → báo dev, không sửa test |
| `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT` | test đúng, app sai → **báo bug, KHÔNG sửa test cho pass** |
| Lỗi bắt đầu bằng `[AN TOÀN]` | runner **từ chối ghi Sheet** vì không chắc ô đích. Đọc thông điệp: thiếu cột vòng → thêm cột vào Sheet; nhãn cột lệch → Sheet sai bố cục; sai dòng → sai mã hoặc sai `--row`. **Không nới lỏng chốt để cho qua** |

Đang bí giữa đường thì chèn `await ctx.dump('nhãn')` vào đúng dòng đó trong file
test rồi chạy lại — nó ghi digest DOM ra `diagnostics/EVAL_XXX_dump_N_*.txt` và
không dừng test.

Crash hạ tầng thì runner **cố ý không ghi Sheet** — lỗi chạy máy không phải kết
quả kiểm thử. Đừng ép ghi.

Video hỏng / upload chết mà app vẫn chạy được thì thử riêng đường ống ghi hình:
`npm run smoke-test` (chỉ mở example.com, quay 1.5s, upload) — OK nghĩa là ffmpeg
và Google Drive đều sống, lỗi nằm ở phía testcase.

---

# KHÔNG ĐƯỢC LÀM

1. **Không chụp màn hình / computer-use để tìm selector hay đọc Sheet.** Đã có
   `npm run plan`, `npm run probe`, và MCP `chrome-devtools` đọc DOM bằng text.
2. **Không sửa testcase cho pass** khi chẩn đoán là `KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT`.
   Test đúng mà app sai thì đi báo bug.
3. **Không tự chọn `--round`.** Chốt với user (Bước 2).
4. **Không bỏ bước chạy nháp.** Đừng chạy thẳng bản ghi Sheet khi chưa nháp xong.
5. **Không tạo file test ngoài `src/testcases/`**, không sửa `session.js` /
   `recorder.js` / `drive.js` / `sheet_service.js` / `cursor_motion.js` /
   `browser.js` khi chỉ đang viết 1 case.
6. **Không tự quyết số case.** Làm đúng phạm vi user yêu cầu: nói 1 mã thì làm 1,
   nói "chạy nhóm EVAL_030→035" thì làm 6. Nhưng **không tự mở rộng ra ngoài phạm
   vi đó** — không viết trước case chưa được yêu cầu, không đề xuất "viết nốt các
   case còn thiếu". Sheet có ~120 mã và danh sách **thay đổi liên tục**, nên viết
   trước cả loạt là làm ra file chết. Số case chưa có kịch bản KHÔNG phải việc tồn
   cần dọn.
7. **Không đóng Chrome hay chuyển tab khi runner đang chạy.** Chrome bóp cổ tab
   nền tới mức lệnh CDP treo vô hạn — đã từng làm 3 case treo hơn 300 giây mỗi case.

---

# Giao diện cho QC — `npm run ui`

QC không cần Claude cho việc chạy hằng ngày nữa. `npm run ui` mở một bảng điều
khiển ở `http://127.0.0.1:7788` (in ra kèm token, đổi mỗi lần khởi động):

- Chọn case bằng checkbox, đặt vòng test, ba công tắc quay video / upload / ghi Sheet
- Nút **Chuẩn bị** chạy `plan` để biết nên ghi vòng mấy
- Nhật ký chảy về thời gian thực, có đồng hồ so với hạn 150s và nút Dừng
- Tab **Lịch sử & duyệt**: mọi lần chạy trong `runs/`, video, và nút **Ghi vào Sheet**
  cho các case đang chờ duyệt
- Tab **Cấu hình**: đổi link Sheet, tên tab, `TARGET_URL`, tổ chức, FPS

Khi user hỏi những việc mà giao diện làm được (đổi link Sheet, đổi tunnel, chạy lại
một case đã có kịch bản, xem lại kết quả cũ), **chỉ họ sang `npm run ui`** thay vì
tự làm hộ — nhanh hơn và không tốn token.

Claude vẫn cần cho: viết kịch bản case mới, chẩn đoán FAIL, và sửa code.

## Khi giao diện đang mở, chạy test QUA nó

Có file `.ui-token` ở gốc repo nghĩa là QC đang mở giao diện. Lúc đó **đừng gọi
`npm test` thẳng** — dùng:

```bash
node src/tools/ui-run.js EVAL_050 --round=3 --sheet-on=pass
```

Cùng một lần chạy sẽ hiện ở cả hai nơi: log chảy về trang cho QC xem theo thời
gian thực, và vẫn in ra terminal cho Claude đọc. Gọi `npm test` thẳng thì tiến
trình đó không thuộc về server, nên QC ngồi nhìn một trang đứng im.

Không có `.ui-token` (hoặc tool báo exit code 2) thì cứ `npm test` như thường.

Trang **tự cập nhật** khi có kịch bản mới hoặc lần chạy mới — viết xong một file
trong `src/testcases/` là bảng case tự hiện thêm dòng, không cần bảo QC F5.

## Hàng đợi việc từ giao diện

QC tick case chưa có kịch bản rồi bấm "Giao Claude viết kịch bản" thì yêu cầu nằm ở
`runs/.claude-queue.json`. Khi user nói "xử lý hàng đợi" (hoặc dán câu nhắc từ trang),
đọc file đó, làm các mục `status: "pending"`, xong thì đặt `status: "done"` kèm
`resolvedAt` — trang sẽ tự cập nhật.

Bảng case trên trang lấy từ `runs/.sheet-cache.json` (`npm run sheet:dump`). File này là
nguồn nhanh để biết Sheet đang có những mã nào mà không phải mở Chrome.

Ranh giới của giao diện, cố ý đặt ra chứ không phải thiếu: chỉ nghe `127.0.0.1`;
mật khẩu và `DRIVE_*` **không đọc, không sửa** được qua trình duyệt (chỉ hiện
đã cấu hình hay chưa); `TARGET_URL` phải qua whitelist tên miền; không có ô nhập
`--row`. Chi tiết trong `docs/superpowers/specs/2026-09-18-giao-dien-qc-design.md`.

---

# Tra cứu

| Cần gì | Đọc |
|---|---|
| Viết kịch bản case mới: probe, MCP chrome-devtools, khung file, helper có sẵn, bài học trang Mẫu đánh giá | `references/viet-kich-ban.md` |
| Cờ CLI đầy đủ, cấu trúc `src/`, bố cục Google Sheet, ngân sách thời gian, các bẫy tốc độ đã gỡ | `references/van-hanh.md` |

Lệnh hay dùng nhất:

```bash
npm run plan -- EVAL_021 EVAL_022     # chuẩn bị: hạ tầng + đặc tả + vòng test
npm run plan -- EVAL_021 EVAL_022 EVAL_023 --split=2   # chia việc cho 2 tài khoản
npm test -- EVAL_021 --no-record --no-sheet   # chạy nháp, an toàn
npm test -- EVAL_021 --round=3        # chạy thật: video + Google Drive + Sheet
npm test -- EVAL_022 --account=2 --round=3    # chạy bằng tài khoản slot 2
npm run test:auth                     # session hết hạn, đăng nhập lại (thêm --account=2 cho slot 2)
npm run test:unit                     # test logic bố cục Sheet, ~0.1s, không cần trình duyệt
npm run ui                            # bảng điều khiển cho QC (localhost, không cần Claude)
npm run commit -- runs/<thư mục>      # duyệt và ghi một lần chạy đang chờ vào Sheet
node src/tools/ui-run.js EVAL_050 --round=3   # chạy qua giao diện đang mở (QC xem trực tiếp)
```

Trạng thái case nào đã có kịch bản, mẫu nào còn trên tunnel, case đã chạy tới
vòng mấy — **không ghi cứng ở đây**, vì loại thông tin đó sai chỉ sau vài ngày.
`npm run plan` luôn là nguồn đúng.
