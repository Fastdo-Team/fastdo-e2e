# Spec B — Giao diện QC chạy trên máy

Ngày: 2026-09-18
Trạng thái: đang thực thi
Repo: `fEvaluation`

Dựng trên spec A (`2026-09-18-chot-an-toan-va-lich-su-chay-design.md`), vốn đã tạo
ra đúng thứ giao diện cần: thư mục `runs/` mỗi lần chạy, `result.json` giàu dữ liệu,
cờ `--report-json`, và các chốt an toàn ghi Sheet.

## Quyết định đã chốt với user (trong brainstorm)

| Câu hỏi | Chốt |
|---|---|
| Phạm vi | Trung tâm điều khiển đầy đủ: sửa config + chọn case + bấm chạy + xem log + xem lịch sử |
| Nơi chạy | Localhost, máy của từng QC. Không đăng nhập, không hàng đợi, chỉ nghe `127.0.0.1` |
| Cách chạy test | Tiến trình con `node src/runner.js --report-json=…`, giao diện đọc `runs/` |
| Ghi Sheet | **PASS tự ghi, FAIL chờ QC duyệt** |
| Thư viện mới | Không. Dùng module `http` có sẵn của Node, log chảy về bằng SSE |

## Tầng 2a — Chính sách ghi Sheet (CLI dùng được ngay)

**2a.1 · Cờ `--sheet-on=<always|pass|never>`** cho runner. Mặc định `always` để
mọi thói quen cũ không đổi. Giao diện luôn dùng `pass`.

Khi `pass` và case KHÔNG đạt: runner vẫn quay video, vẫn upload Catbox, vẫn ghi
`result.json` — chỉ **không đụng Google Sheet**, và đặt
`sheet.state = 'pending'` kèm đủ dữ liệu để ghi sau.

Lý do: `Fail` trong Sheet có thể là bug app, mà cũng có thể chỉ là kịch bản sai
selector. Hai thứ đó không được lẫn, và người phân biệt được là QC sau khi xem video.

**2a.2 · `npm run commit -- <thư-mục-run>`** — đọc `result.json` của một lần chạy
đang `pending` rồi ghi vào Sheet, đi qua đúng `updateSheetResult` (tức đúng mọi chốt
an toàn của spec A), rồi cập nhật lại `result.json`. Từ chối nếu trạng thái không
phải `pending`, để không ghi trùng.

## Tầng 2b — Server cục bộ

`npm run ui` → `src/tools/ui/server.js`, mở `http://127.0.0.1:<port>`.

| Endpoint | Việc |
|---|---|
| `GET /` | trang HTML |
| `GET /api/state` | cấu hình (đã che bí mật), danh sách case có kịch bản, các lần chạy gần đây |
| `POST /api/run` | spawn runner, trả `jobId` |
| `POST /api/plan` | spawn plan, trả `jobId` |
| `GET /api/log/:jobId` | SSE: stdout theo dòng, kết thúc bằng exit code |
| `POST /api/commit` | ghi một lần chạy `pending` vào Sheet |
| `POST /api/config` | vá `.env` từng dòng |
| `POST /api/stop/:jobId` | dừng tiến trình đang chạy |

### Ranh giới an toàn (bắt buộc, đã chốt ở brainstorm)

- Chỉ `listen('127.0.0.1')`. Mọi `POST` phải kèm token sinh lúc khởi động và phải
  qua kiểm `Origin`/`Sec-Fetch-Site`.
- **Danh sách khoá được đọc**, không phải danh sách cấm: biến ngoài danh sách mặc
  định là bí mật, chỉ trả `hasValue: true/false`. Thêm biến mới sau này tự động an toàn.
- Mật khẩu và `CATBOX_USERHASH` **không đọc, không ghi** qua giao diện.
- Mã case chỉ **chọn** từ danh sách server liệt kê; server vẫn kiểm lại
  `^EVAL_[A-Z0-9_]+$`.
- `spawn('node', [...], { shell: false, cwd: ROOT_DIR })`. Mọi tham số số ép về
  số nguyên trước khi đưa vào mảng đối số.
- `TARGET_URL` phải qua whitelist (`https`, `*.devtunnels.ms` hoặc domain Fastdo)
  — `session.js` gõ email và mật khẩu thật vào bất cứ trang nào URL đó trỏ tới.
- Không phục vụ file theo đường dẫn từ trình duyệt. Không `express.static(ROOT_DIR)`.
- Vá `.env` **từng dòng**, không ghi đè cả file: `.env` không nằm trong git, ghi
  hỏng là mất mật khẩu vĩnh viễn.

## Tầng 2c — Trang HTML

Một trang, bốn khối:

1. **Thanh trạng thái** — tunnel sống/chết, Sheet đang trỏ đâu, slot tài khoản,
   ffmpeg. Đỏ là chặn, vàng là cảnh báo.
2. **Bảng case** — mã, tiêu đề, có kịch bản chưa, vòng đã chạy, vòng kế tiếp
   (điền sẵn). Chọn bằng checkbox. Ba công tắc: quay video / upload / ghi Sheet.
   Nút Chạy hiện sẵn câu "sẽ ghi vào ô nào" trước khi bấm.
3. **Khối đang chạy** — log thời gian thực, đồng hồ so với hạn 150s, nút Dừng.
4. **Lịch sử** — các lần chạy gần đây từ `runs/`: PASS/FAIL, video nhúng, trạng
   thái ghi Sheet, và nút **Ghi vào Sheet** cho những lần đang `pending`.

Không thanh tiến độ theo bước: chỉ 1/8 kịch bản dùng `ctx.step()`, nên dữ liệu
bước chưa tồn tại — vẽ ra là vẽ một thanh giả.

## Không làm trong spec này

- Sửa mật khẩu / `CATBOX_USERHASH` qua giao diện
- Ô nhập số dòng (`--row`) — đó là cờ cứu hộ của dev, phơi lên UI là biến nó thành
  nút phá dữ liệu hàng ngày
- Viết kịch bản case mới từ giao diện (việc đó cần Claude)
- Dùng chung cho nhiều người qua mạng

## Prompt gốc của user liên quan spec này

> hãy đọc và Update src …, thứ tôi cần bạn làm là nâng cấp việc Skill này chạy tốt hơn,
> mạnh hơn, tiện dụng hơn cho QC. có thể làm HTML để quản lý, giống như đổi link sheet
> để đọc, đổi các Config

> chọn C, và sửa luôn bug ghi đè vòng 1

> hai spec, làm spec A trước

> hãy thực hiện tiếp
