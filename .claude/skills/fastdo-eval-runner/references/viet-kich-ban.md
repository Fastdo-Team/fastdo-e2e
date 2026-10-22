# Viết kịch bản cho một case mới

Đọc file này khi `npm run plan` báo `missing=EVAL_XXX`.

Đầu vào duy nhất là đặc tả mà `plan` đã in ra từ Sheet — mục "Điều kiện", "Các
bước", "Kết quả mong muốn". Bám đúng nó. Test tự nghĩ ra tiêu chí riêng thì PASS
cũng vô nghĩa, vì QC đối chiếu video với đặc tả chứ không đối chiếu với code.

---

## 1. Khám phá DOM — bằng text, không bằng ảnh

### Cách mặc định: `npm run probe`

```bash
npm run probe -- "/evaluation?tab=template" --tables
```

Cần trạng thái sâu (đã bấm vào editor mới thấy được element):

```bash
PROBE_TEMPLATE="<tên mẫu Nháp có thật>" npm run probe -- "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js
```

Tên mẫu Nháp có thật lấy từ dòng "Mẫu Nháp đang có trên tunnel" mà `plan` hoặc
`preflight` in ra.

| Cờ | Tác dụng |
|---|---|
| `--grep=<regex>` | lọc element theo nhãn/selector |
| `--tables` | dump mọi `<table>` thành mảng |
| `--text` | kèm `innerText` của `<main>` |
| `--all` | in cả element ẩn/disabled |
| `--setup=<file>` | chạy vài cú click để chạm trạng thái sâu (`src/tools/setups/`) |
| `--limit=<n>` | trần số element (mặc định 120) |
| `--out=<tên file>` | đặt tên file digest |
| `--wait=<ms>` / `--wait-text=<chuỗi>` | chờ thêm trước khi chụp digest |
| `--keep-open` | giữ Chrome sống, lần probe sau nhanh hơn ~3s |

### Cờ độ tin cậy trong digest — đọc kỹ, đây là chỗ hay sai nhất

| Cờ | Nghĩa |
|---|---|
| `⚠ BỊ CHE bởi <X>` | có thứ khác đè lên. **Click mất tác dụng và KHÔNG ném lỗi** — đóng lớp phủ trước |
| `⚠ TRONG OVERLAY` | element thuộc modal/popup đang mở |
| `⚠ NGOÀI VIEWPORT` | cần `scrollIntoView` trước khi click |
| `⚠ SELECTOR THEO VỊ TRÍ` | selector phải dùng `:nth-of-type` — vỡ khi Blazor render lại danh sách. Ưu tiên bám text |
| `· click tâm trúng <X>` | icon trang trí đè lên tâm (thường vẫn click được) |
| `(khớp N element - GIÒN)` | selector không định danh duy nhất, phải thu hẹp |

### Khi cần soi trực tiếp: MCP `chrome-devtools`

`probe` chụp một lát cắt tĩnh. Khi phải thử vài selector liên tiếp, hoặc khi cần
xem console/network ngay lúc thao tác, MCP cho phép lái trang sống mà **vẫn đọc
bằng text** — `take_snapshot` trả về cây accessibility, không phải ảnh.

Điều kiện để MCP bám đúng Chrome của repo (chung session đã đăng nhập, chung
profile `.chrome_profile`):

1. Mở Chrome của repo và giữ nó sống trên port 9222:

   ```bash
   npm run probe -- "/evaluation?tab=template" --keep-open
   ```

   Lệnh này đồng thời khôi phục session đăng nhập vào profile, nên MCP gắn vào
   sau đó là đã đăng nhập sẵn.

2. MCP phải được đăng ký kèm `--browserUrl`, nếu không nó tự mở một Chrome riêng
   với profile trắng — chưa đăng nhập, soi gì cũng sai. Bản `chrome-devtools`
   đăng ký sẵn trên máy **không** có cờ này, nên đăng ký thêm một server riêng
   thay vì sửa nó (sửa sẽ làm hỏng khi dùng cho việc khác, vì lúc đó không có gì
   nghe ở 9222):

   ```bash
   claude mcp add fastdo-chrome -s user -- npx -y chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222
   ```

3. Kiểm tra bám đúng: `list_pages` phải thấy tab của `TARGET_URL`. Không thấy
   nghĩa là MCP đang nói chuyện với một Chrome khác — dừng lại, đừng tin kết quả.

Cổng 9222 ở trên là của **slot 1**. Muốn soi Chrome của slot 2 thì đăng ký thêm
một server nữa trỏ vào `http://127.0.0.1:9223`. Nhưng thường không cần: viết kịch
bản chỉ làm một lần, cứ dùng slot 1 cho gọn.

Dùng được gì:

| Tool | Thay cho |
|---|---|
| `take_snapshot` | `npm run probe` nhưng theo thời gian thực, mỗi bước một lần |
| `evaluate_script` | thử một selector trước khi viết nó vào file test |
| `click` / `fill` / `hover` (theo uid) | kiểm chứng một chuỗi thao tác có chạy không trước khi code |
| `list_console_messages` / `list_network_requests` | xem lỗi JS và request 5xx ngay lúc thao tác |

Ranh giới cần giữ:

- MCP chỉ dùng cho **khám phá và chẩn đoán**. Lần chạy chính thức vẫn phải là
  `npm test` — video, con trỏ đỏ, upload Google Drive và ghi Sheet nằm hết trong repo,
  MCP không sinh ra được.
- Thao tác qua MCP **không** tạo con trỏ đỏ trong video, nên đừng dùng nó để quay.
- `take_screenshot` của MCP vẫn là ảnh và vẫn tốn 8–20k token. Ưu tiên
  `take_snapshot`/`evaluate_script`; chỉ chụp ảnh khi thật sự cần thấy vấn đề
  hiển thị (lệch layout, sai màu) — thứ mà text không diễn tả được.

---

## 2. Khung file testcase

Tạo `src/testcases/eval_xxx.test.js`:

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

`ctx.step()` và `ctx.dump()` **không bắt buộc** — các case cũ không dùng vẫn chạy
y nguyên. Nhưng case mới thì nên dùng `step()`: lúc FAIL sẽ biết chết ở bước nào
thay vì chỉ có một stack trace.

`resultText` là thứ QC đọc trong Sheet, nên viết cho người đọc: nêu con số quan
sát được và đối chiếu với kỳ vọng, đừng chỉ ghi "OK".

### Hằng số tên mẫu — đặt đúng tên mới được bảo vệ

Case nào cần một mẫu dữ liệu có sẵn thì khai báo bằng hằng số tên
`TEMPLATE_NAME` hoặc `DRAFT_TEMPLATE_NAME`:

```javascript
const DRAFT_TEMPLATE_NAME = 'EVAL_QA - Mau test nhom - Bản sao';
```

`plan` và `preflight` quét đúng 2 tên hằng số này để biết case cần mẫu nào và
chặn trước khi chạy. Đặt tên hằng số khác đi thì case mất lưới an toàn, và sẽ
chết giữa chừng khi mẫu bị xoá thay vì được báo trước.

---

## 3. Helper có sẵn — tra trước khi tự viết thao tác mới

`src/core/evaluation_helpers.js`:

`sleep`, `waitFor`, `dismissPushPopup`, `openEvaluationTab`, `openDraftByName`,
`readTemplateStatus`, `readGroupCards`, `getGroupCardHandle`, `setInputValue`,
`setGroupName`, `setGroupWeight`, `setCriterionWeight`, `openCriterionPicker`,
`closeCriterionPicker`, `addCriterion`, `removeEmptyGroups`, `clickActivate`,
`extractActivationErrors`, `extractRetiredCriterionNames`,
`removeCriterionRowsByName`, `saveDraft`.

Thao tác đã có helper mà tự viết lại bằng `page.evaluate` là cách nhanh nhất để
dẫm lại đúng những cái bẫy đã gỡ ở mục 4.

---

## 4. Bài học trên trang Mẫu đánh giá

Rút ra từ lần sửa EVAL_017, áp dụng cho mọi case chạm trình soạn thảo mẫu:

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
