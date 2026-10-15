# Spec A — Chốt an toàn ghi Sheet & Lịch sử lần chạy

Ngày: 2026-09-18
Trạng thái: đã duyệt, đang thực thi
Repo: `fEvaluation` (bộ QA automation testcase Fastdo)

Spec này là **phần A của hai phần**. Phần B (giao diện HTML cho QC) dựng trên nền
này và có spec riêng. Lý do tách: tầng 0 dưới đây đang sửa một lỗi hỏng dữ liệu
**đang xảy ra**, không nên chờ thiết kế giao diện xong mới được làm.

---

## Vấn đề

### Lỗi chính — ghi đè kết quả vòng 1

`resolveResultColumn()` (`src/core/sheet_service.js:251`) khi không tìm thấy nhãn
`TEST LẦN N` ở dòng 1 thì không dừng, mà `console.warn` rồi `return 'I'` — đúng
cột Kết quả của **vòng 1**. `statusCol` kéo theo thành `H`, cột Trạng thái vòng 1.

Đường đi tới lỗi: `resolveRoundColumnsFromGrid` trả `null` khi Sheet chưa có cột
của vòng được yêu cầu → `resultCol` vẫn `null` → rơi vào `resolveResultColumn` →
cũng không thấy → trả `'I'`. Kết quả: chạy `--round=9` trên Sheet mới có 5 vòng
sẽ **nối kết quả vòng 9 vào ô vòng 1 và ghi đè Trạng thái vòng 1**, không một
thông báo lỗi nào.

### Lỗi phụ trợ cùng nhóm

1. **Hai bản hiểu bố cục Sheet lệch nhau.** `src/core/sheet_service.js:190` so khớp
   `===` chặt; `src/tools/lib/sheet_grid.js:31` dùng regex `/^TEST\s+LẦN\s+(\d+)$/i`
   lỏng hơn. Nhãn có khoảng trắng kép hoặc khác hoa/thường sẽ khiến `plan` báo
   "cột có sẵn" trong khi runner ghi về cột I. Offset `+2/+3` cũng hardcode ở cả
   hai nơi.
2. **Không có chốt nào đối chiếu nhãn của ô sắp ghi.** Bố cục `+2/+3` được coi là
   chân lý. Sheet khác bố cục là ghi nhầm cột, im lặng.
3. **`--row=N` bỏ qua đối chiếu mã ở cột A trên đường fallback.** Phần kiểm nằm
   trong `if (!targetRow)` (`sheet_service.js:428`) nên có `--row` là không chạy.
   Đường có lưới vẫn kiểm (`:408`) — hẹp hơn báo cáo ban đầu, nhưng vẫn phải sửa.
4. **Cờ lạ bị nuốt im lặng.** Vòng đọc cờ của `runner.js:69-79` không có nhánh
   `else`; `--nosheet` gõ thiếu gạch biến lần chạy nháp thành lần ghi thật.
5. **Giá trị mặc định cứng trong `config.js`** cho `TARGET_URL`/`SHEET_ID`/`SHEET_TAB`
   (`:83,:92-94`). `.env` mất `SHEET_ID` vẫn qua được bước kiểm "đủ 5 biến" rồi ghi
   vào Sheet mặc định trong code — ghi nhầm Sheet mà không ai biết.

### Bằng chứng bị xoá khi chạy lại

- `recorder.start()` `unlinkSync` video cũ cùng tên (`src/core/recorder.js:24-31`)
- `diagnostics/<mã>.fail.md` bị ghi đè (`src/core/diagnostics.js:310`)
- `dumpCount` reset mỗi lần chạy (`src/runner.js:147`)
- Object `record` giàu dữ liệu runner dựng sẵn (`src/runner.js:118-130`) chỉ được
  `console.log` rồi chết theo tiến trình — không có lịch sử lần chạy ở bất cứ đâu

---

## Tầng 0 — Chốt an toàn ghi Sheet

**0.1 · Một nguồn duy nhất cho bố cục Sheet.**
Dời `src/tools/lib/sheet_grid.js` → `src/core/sheet_grid.js` (core là tầng dưới;
tools phụ thuộc core, không ngược lại). `sheet_service.js` dùng chung module này.
Xoá `resolveRoundColumnsFromGrid` trùng lặp. Nhãn cột Trạng thái / Kết quả thực
hiện suy ra từ `ROUND_LAYOUT` chứ không viết lại.

**0.2 · Không xác định được cột vòng thì DỪNG.**
`resolveResultColumn` ném lỗi thay vì `return 'I'`, nêu rõ Sheet đang có những
vòng nào. Trên đường có lưới, chặn ngay khi `roundColumns()` trả `null` — không mò
tiếp bằng Name Box.

**0.3 · Chốt cuối: đối chiếu nhãn dòng 2 của đúng ô sắp ghi.**
Ô Trạng thái phải mang nhãn `Trạng thái`, ô Kết quả phải mang nhãn
`Kết quả thực hiện` (so khớp sau khi chuẩn hoá khoảng trắng và hoa/thường). Lệch
thì ném lỗi, không ghi. Đây là chốt bắt được Sheet có bố cục khác `+2/+3` — tình
huống chắc chắn xảy ra khi phần B cho QC đổi link Sheet. Đường fallback không lưới
cũng làm đúng chốt này, đổi lại 2 lần đọc ô (~1.4s) trên một đường hiếm.

**0.4 · `--row=N` luôn đối chiếu mã ở cột A**, kể cả đường fallback.

**0.5 · Cờ lạ là lỗi.**
`runner.js` và `plan.js` khai báo danh sách cờ hợp lệ (gồm `--account=` do
`config.js` tiêu thụ). Gặp cờ ngoài danh sách thì dừng và in danh sách đúng.

**0.6 · Bỏ giá trị mặc định cứng**, thiếu biến bắt buộc thì fail-fast.
Chấp nhận rủi ro: `.env` đang thiếu biến sẽ dừng chạy thay vì chạy sai. Hỏng ồn
hơn ghi nhầm Sheet.

**0.7 · Sửa tài liệu.**
`.claude/skills/fastdo-eval-runner/references/van-hanh.md:125-126` đang mô tả sai
hành vi ("không ghi được", thực tế là ghi nhầm vòng 1).

---

## Tầng 1 — Lịch sử lần chạy

**1.1 · Mỗi case mỗi lần chạy một thư mục.**
`runs/<YYYYMMDD-HHmmss>-<mã>-v<vòng>/` chứa `result.json`, video, `fail.md`, các
file dump. Runner tính thư mục ở đầu mỗi case rồi truyền xuống `recorder`,
`writeFailReport`, `ctx.dump`.

Vẫn giữ song song bản "mới nhất" ở `diagnostics/<mã>.fail.md` — thêm chỗ mới nhưng
không lấy đi chỗ cũ mà SKILL.md và thói quen đang trỏ tới.

**1.2 · `result.json`** = object `record` sẵn có, cộng phần danh tính lần chạy hiện
không được lưu ở đâu: vòng, slot tài khoản, `TARGET_URL`, mốc bắt đầu/kết thúc,
các cờ đã dùng. Trạng thái ghi Sheet phân biệt **ba nhánh**:
`written` (kèm ô) / `skipped` (kèm lý do: crash hạ tầng, upload lỗi, tắt bằng cờ) /
`failed` (kèm thông điệp lỗi).

**1.3 · `--report-json=<đường dẫn>`** — chạy xong ghi bản kê của cả lệnh: đã chạy
case nào, thư mục run tương ứng, kết quả. Phần B đọc file này; CLI dùng được ngay.

**1.4 · Không có file chỉ mục.** Giao diện quét thẳng `runs/`. Một file index là
một thứ nữa có thể lệch với thực tế.

`runs/` vào `.gitignore`.

---

## Kiểm thử

Logic bố cục Sheet là thứ bắt buộc có test tự động, vì sai ở đây là hỏng dữ liệu
QC và không thể phát hiện bằng mắt:

- `src/core/sheet_grid.test.js` — chạy bằng `node --test`, không cần trình duyệt,
  không cần `.env`. Phủ: tìm mốc vòng, phân biệt `TEST LẦN 1` với `TEST LẦN 10`,
  suy ra vòng kế tiếp, offset Trạng thái/Kết quả, đối chiếu nhãn dòng 2, và **các
  trường hợp phải ném lỗi** (vòng không có cột, nhãn lệch).
- Thêm script `npm run test:unit`.

Phần chạm trình duyệt và Google Sheet không có test tự động — xác minh bằng chạy
thật một case vào vòng mà Sheet chưa có cột, và phải thấy nó **dừng** thay vì ghi.

---

## Bổ sung sau khi soi ngược (2026-09-18)

Một đợt soi 3 chiều trên chính bản vừa thực thi tìm ra thêm các lỗi dưới đây; tất
cả đã sửa và có test:

1. **Chốt cột A trên đường có lưới là tautology.** `targetRow` được suy ra từ chính
   ô mà chốt đem đi so, nên khi không có `--row` nó không bao giờ chặn được gì.
2. **Đọc một tab, ghi một tab khác.** `fetchGrid` đọc qua gviz theo TÊN tab, còn mọi
   thao tác ghi đi qua Name Box — vốn luôn trỏ vào SUB-TAB đang hiển thị.
   `getOrOpenSheetPage` mở Sheet không kèm `#gid` và tái dùng tab sẵn có, nên QC để
   sẵn một sub-tab khác là ghi sai chỗ, và bước verify đọc lại đúng ô sai đó nên
   luôn "khớp".
   → Cả (1) và (2) được giải bằng **một chốt sống**: đọc thật ô cột A của dòng sắp
   ghi, trên đúng trang sắp ghi, ngay trước khi ghi. Đây là chốt duy nhất độc lập
   với dữ liệu đã dùng để suy ra dòng. Giá: 1 lần đọc ô (~0.7s) mỗi lần ghi.
3. **`checkRoundLabels` mù khi dòng 2 để trống.** Khối vòng hẹp hơn bố cục chuẩn sẽ
   đẩy cột Kết quả sang địa phận vòng sau mà không ai thấy → thêm chốt "cột đích
   phải còn thuộc khối của chính vòng đó".
4. **`--round=` rỗng âm thầm rơi về vòng 1** (lỗi do chính đợt sửa này tạo ra —
   `positiveInt` coi chuỗi rỗng là "không truyền cờ"). Script bọc ngoài khai triển
   một biến chưa set là dính ngay.
5. **Ném giá trị không phải Error.** `err.message` trên `null` ném TypeError ngay
   trong `catch` (mất cả hàng đợi lẫn bản kê); trên chuỗi cho `undefined`, khiến
   `harnessCrashed = false` và runner ghi `Fail / LỖI KHI CHẠY TEST: undefined` vào
   Sheet như một kết quả kiểm thử thật.
6. **`--report-json` ghi đè bất kỳ file nào.** Đã chứng minh bằng cách vô tình xoá
   sổ chính `package.json` lúc thử nghiệm → nay bắt buộc nằm trong `runs/` và có
   đuôi `.json`.
7. **`--account=` không được kiểm** → gõ sai âm thầm chạy slot 1, tức nối vào đúng
   Chrome của QC slot 1.
8. **Thư mục run không tách theo slot/pid** → hai slot cùng khởi động một mã trong
   cùng một giây dùng chung thư mục, và `recorder` xoá video tiến trình kia đang ghi.
9. **`pass` không phải boolean** → terminal in PASS, `sheet.state = written`, nhưng
   `sheet_service` chỉ ghi cột Trạng thái khi `typeof pass === 'boolean'` nên ô đó
   giữ nguyên giá trị cũ.
10. **Ghi Sheet hỏng không đổi exit code** và lý do không xuất hiện trong báo cáo
    cuối → 5 case PASS mà cả 5 lần ghi bị chặn vẫn exit 0.
11. **Danh sách biến bắt buộc bị chép ở 3 nơi** → `plan`/`preflight` nay đọc thẳng
    `config.REQUIRED_ENV`.
12. **Một case chết ngoài dự kiến giết cả hàng đợi** và làm mất bản kê JSON của các
    case đã xong → bọc từng case trong vòng lặp của `main`.
13. **Runner mở Chrome rồi mới phát hiện thiếu kịch bản** → kiểm trước khi mở.

## Còn tồn, cần quyết định riêng

- **Watchdog không huỷ được case bị bỏ rơi.** `Promise.race` chỉ thôi chờ; promise cũ
  vẫn sống và vẫn điều khiển đúng cái `page` mà case kế tiếp đang dùng. Là lỗi có
  trước, cần thiết kế riêng (cờ huỷ trong `ctx`, hoặc mở tab mới sau khi watchdog bắn).
- **Gốc của vấn đề sub-tab** vẫn còn: `getOrOpenSheetPage` không chọn `#gid`. Chốt
  sống chặn được hậu quả, nhưng mở đúng sub-tab ngay từ đầu vẫn tốt hơn.
- **`EVAL_001` và `EVAL_015` mất kịch bản** khi dọn thư mục `scripts/` cũ; chúng chưa
  từng được port sang `src/testcases/`.
- **Nhánh `already_exists`** chạy SAU khi cột Trạng thái đã bị ghi.
- **`existingResult`** nay là biến chết trong `updateSheetResult` (giữ nguyên theo lệ
  không xoá code cũ khi đang sửa lỗi).

## Không làm trong spec này

- Giao diện HTML, server cục bộ (phần B)
- Bổ sung `ctx.step()` cho 7 kịch bản cũ, gom code trùng giữa các testcase
- Đổi tên video theo vòng/thời điểm ở mức `recorder` (thư mục run đã giải quyết)
- Ghi Sheet khi upload Catbox lỗi — đổi chính sách ghi, để phần B bàn cùng luồng
  "PASS tự ghi, FAIL chờ duyệt"

---

## Prompt gốc của user liên quan spec này

> hãy đọc và Update src D:\FastDo\TEstAuto-Gian\fEvaluation, đây là Skill cho Claude
> dùng để chạy test case, thứ tôi cần bạn làm là nâng cấp việc Skill này chạy tốt hơn,
> mạnh hơn, tiện dụng hơn cho QC. có thể làm HTML để quản lý, giống như đổi link sheet
> để đọc, đổi các Config, . Bạn có thể đề xuất thêm ý tương để update thêm cho Skill này không

> chọn C, và sửa luôn bug ghi đè vòng 1

> hai spec, làm spec A trước

> oke, hãy tự thực hiện hết cho tôi
