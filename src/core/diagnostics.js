// ============================================================================
// diagnostics.js: Gom bằng chứng khi testcase FAIL/crash thành 1 file text đọc
// được ngay, để không phải chạy lại + chụp màn hình mới biết vì sao chết.
//
// Ghi ra diagnostics/EVAL_0xx.fail.md dạng markdown (KHÔNG phải JSON): mục đích
// duy nhất của file này là được đọc, mà JSON tốn token cho dấu ngoặc/escape mà
// không thêm thông tin nào.
//
// Nguyên tắc: mọi thứ ở đây đều bọc try/catch và chỉ console.warn khi lỗi.
// Hạ tầng chẩn đoán không được phép che mất kết quả test thật.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { digestRowsOnly, ensureDiagnosticsDir, DIAGNOSTICS_DIR } = require('./dom_digest');

const BUFFER_LIMIT = 20;
const ATTACHED_FLAG = '__fastdoDiagnosticsCollector';

/**
 * Gắn listener console/network lên page. Gọi nhiều lần cũng chỉ gắn 1 bộ:
 * runner dùng CHUNG 1 page cho mọi case trong lệnh, gắn lại mỗi case sẽ nhân
 * đôi listener và log sẽ bị lặp.
 */
function attachCollectors(page) {
  if (page[ATTACHED_FLAG]) return page[ATTACHED_FLAG];

  const collector = {
    consoleErrors: [],
    failedRequests: [],
    reset() {
      this.consoleErrors.length = 0;
      this.failedRequests.length = 0;
    },
  };

  const push = (arr, item) => {
    arr.push(item);
    if (arr.length > BUFFER_LIMIT) arr.shift();
  };

  page.on('console', (msg) => {
    try {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') return;
      push(collector.consoleErrors, `[${type}] ${String(msg.text()).slice(0, 300)}`);
    } catch (e) {
      /* không để listener làm chết test */
    }
  });

  page.on('pageerror', (err) => {
    try {
      push(collector.consoleErrors, `[pageerror] ${String(err.message).slice(0, 300)}`);
    } catch (e) {}
  });

  page.on('response', (res) => {
    try {
      const status = res.status();
      if (status < 400) return;
      push(collector.failedRequests, `${status} ${res.request().method()} ${res.url().slice(0, 160)}`);
    } catch (e) {}
  });

  page.on('requestfailed', (req) => {
    try {
      const reason = (req.failure() && req.failure().errorText) || 'không rõ';
      // Request bị chính test huỷ khi điều hướng không phải lỗi đáng báo
      if (reason === 'net::ERR_ABORTED') return;
      push(collector.failedRequests, `FAILED ${req.method()} ${req.url().slice(0, 160)} (${reason})`);
    } catch (e) {}
  });

  page[ATTACHED_FLAG] = collector;
  return collector;
}

/**
 * Nhật ký bước cho 1 case. Dùng qua ctx.step() - không bắt buộc, case cũ không
 * gọi thì nhật ký rỗng và báo cáo sẽ rơi về bảng `timings` cấp case của runner.
 */
function createStepLog() {
  const steps = [];

  async function step(label, fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const seconds = (Date.now() - t0) / 1000;
      steps.push({ label, seconds, ok: true });
      console.log(`   ✓ ${label}  ${seconds.toFixed(1)}s`);
      return result;
    } catch (err) {
      const seconds = (Date.now() - t0) / 1000;
      steps.push({ label, seconds, ok: false, error: err.message });
      console.log(`   ✗ ${label}  ${seconds.toFixed(1)}s  ← ${err.message}`);
      throw err; // ném lại nguyên trạng, step() chỉ quan sát
    }
  }

  return { steps, step };
}

/**
 * Cố đoán selector nào đã thất bại từ thông điệp lỗi. Best-effort: không tìm
 * thấy thì bỏ dòng đó khỏi báo cáo, không bịa.
 */
function guessFailedSelector(message) {
  if (!message) return null;

  const xpath = message.match(/(\.\/\/[^\s]+)/);
  if (xpath) return xpath[1];

  const quoted = message.match(/selector[^"']*["']([^"']{4,120})["']/i);
  if (quoted) return quoted[1];

  const css = message.match(/([a-z]+(?:[.#][\w-]+)+(?:\s*[>\s]\s*[a-z]+(?:[.#][\w-]+)*)*)/);
  if (css && css[1].length > 8) return css[1];

  return null;
}

/**
 * Phân loại lỗi rồi mới gợi ý hướng xử lý, thay vì chỉ đổ bằng chứng thô ra.
 * CỐ Ý hedge: chỉ nói "hướng xử lý", không khẳng định fix - đoán chắc rồi sai
 * còn tốn thời gian hơn là nói thật rằng chưa phân loại được.
 */
function classifyFailure({ errorMessage, collector, domText, verdict }) {
  const msg = String(errorMessage || '');
  const failedRequests = (collector && collector.failedRequests) || [];
  const consoleErrors = (collector && collector.consoleErrors) || [];

  // Lớp phủ chặn click: xét trước cả "không tìm thấy", vì triệu chứng của nó
  // thường LÀ "không tìm thấy" hoặc "bấm mà không có gì xảy ra".
  const occludedCount = (String(domText || '').match(/⚠ BỊ CHE/g) || []).length;
  const rowCount = (String(domText || '').match(/^\d\d /gm) || []).length;
  if (rowCount >= 4 && occludedCount / rowCount >= 0.5) {
    return {
      kind: 'LỚP PHỦ CHẶN CLICK',
      hint:
        `${occludedCount}/${rowCount} element trong digest đang bị che. Click rơi vào lớp phủ, ` +
        'im lặng không tác dụng và không ném lỗi. Xem cột cờ để biết ai che, đóng nó trước ' +
        '(vd: H.dismissPushPopup, đóng modal) rồi mới thao tác.',
    };
  }

  if (/Protocol error|Target closed|Session closed|detached|Execution context was destroyed/i.test(msg)) {
    return {
      kind: 'HẠ TẦNG CDP',
      hint: 'Mất kết nối CDP / tab bị đóng giữa chừng. Không phải lỗi của app, chạy lại case.',
    };
  }

  if (/Watchdog|vượt quá \d+s|Navigation timeout|timeout of \d+ms/i.test(msg)) {
    return {
      kind: 'HẾT HẠN CHỜ',
      hint:
        'Điều kiện chờ không bao giờ đúng. Kiểm tra digest DOM bên dưới xem trạng thái thật ' +
        'khác gì mong đợi; chờ theo ĐIỀU KIỆN (H.waitFor) chứ đừng nới timeout cho qua.',
    };
  }

  // Thiếu BẢN GHI DỮ LIỆU có tên (mẫu/kỳ/tiêu chí/thang điểm/nhóm) khác hẳn
  // thiếu CONTROL trên UI: cái đầu là fixture đã bị xoá/đổi trạng thái, cái sau
  // là selector sai. Xếp lẫn nhau sẽ đẩy người sửa đi mò selector vô ích.
  if (
    /thiếu tiền điều kiện|không có nhóm nào|chưa có tiêu chí|không có mẫu/i.test(msg) ||
    /không tìm thấy\s+(mẫu|kỳ|tiêu chí|thang điểm|nhóm|đợt)/i.test(msg)
  ) {
    return {
      kind: 'THIẾU TIỀN ĐIỀU KIỆN',
      hint:
        'Dữ liệu sandbox không ở trạng thái case cần. Đây KHÔNG phải bug của app - chạy ' +
        '`node src/tools/preflight.js` để xem fixture nào đã mất.',
    };
  }

  if (/Không tìm thấy|không thấy|no element|failed to find|waitForSelector/i.test(msg)) {
    return {
      kind: 'SELECTOR KHÔNG KHỚP',
      hint:
        'Element không có trong DOM lúc tìm. Đối chiếu digest bên dưới: nếu element đã đổi ' +
        'nhãn/cấu trúc thì lấy selector mới từ đó; nếu cả trang không render thì là vấn đề ' +
        'nạp trang, không phải selector.',
    };
  }

  if (failedRequests.some((r) => /^5\d\d /.test(r))) {
    return {
      kind: 'BACKEND LỖI 5XX',
      hint: 'Server trả 5xx trong lúc test (xem mục Request lỗi). Bug backend, không phải bug test.',
    };
  }

  if (consoleErrors.some((l) => /WebSocket|circuit|reconnect/i.test(l))) {
    return {
      kind: 'BLAZOR MẤT CIRCUIT',
      hint: 'Circuit Blazor đứt giữa test nên UI không phản hồi nữa. Chạy lại case.',
    };
  }

  if (!msg && verdict === 'FAIL') {
    return {
      kind: 'KẾT QUẢ NGHIỆP VỤ KHÔNG ĐẠT',
      hint:
        'Test chạy trót lọt và kết luận không đạt. Đọc "Kết quả test" ở trên: nếu đúng thì đây ' +
        'là bug app cần báo, KHÔNG sửa test cho nó pass.',
    };
  }

  return { kind: 'CHƯA PHÂN LOẠI ĐƯỢC', hint: 'Đọc nhật ký bước + digest DOM bên dưới.' };
}

function block(title, lines, emptyText) {
  const out = ['', `## ${title}`];
  if (!lines || lines.length === 0) {
    out.push(emptyText || '(không có)');
  } else {
    out.push(...lines);
  }
  return out;
}

/**
 * Ghi báo cáo lỗi cho 1 case.
 *
 * @param {object} p
 * @param {string} p.testcaseId
 * @param {'CRASH'|'FAIL'} p.verdict   CRASH = lỗi hạ tầng, FAIL = kết quả nghiệp vụ
 * @param {object} p.page              Puppeteer Page (để dump DOM lúc chết)
 * @param {object} p.collector         từ attachCollectors()
 * @param {Array}  p.steps             từ createStepLog().steps
 * @param {string} p.errorMessage
 * @param {string} p.resultText
 * @param {string} p.videoPath
 * @param {number} p.seconds
 * @returns {Promise<string|null>} đường dẫn file, hoặc null nếu ghi thất bại
 */
async function writeFailReport(p) {
  try {
    const stamp = new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 16);
    const lines = [];

    lines.push(`# ${p.testcaseId} — ${p.verdict}  (${stamp}, ${(p.seconds || 0).toFixed(1)}s)`);
    lines.push('');

    let dom = null;
    if (p.page) {
      dom = await digestRowsOnly(p.page, { limit: 40 });
    }

    lines.push(`URL cuối: ${(dom && dom.url) || '(không đọc được)'}`);
    if (p.errorMessage) lines.push(`Lỗi: ${p.errorMessage}`);
    if (p.resultText && p.verdict === 'FAIL') lines.push(`Kết quả test: ${p.resultText}`);

    const failedSelector = guessFailedSelector(p.errorMessage);
    if (failedSelector) lines.push(`Selector thất bại: ${failedSelector}`);

    const cls = classifyFailure({
      errorMessage: p.errorMessage,
      collector: p.collector,
      domText: dom && dom.text,
      verdict: p.verdict,
    });
    lines.push('');
    lines.push(`## Chẩn đoán: ${cls.kind}`);
    lines.push(cls.hint);

    lines.push(
      ...block(
        'Nhật ký bước',
        (p.steps || []).map(
          (s) =>
            `${s.ok ? '✓' : '✗'} ${s.label.padEnd(38)} ${s.seconds.toFixed(1)}s` +
            (s.ok ? '' : '   ← chết ở đây')
        ),
        '(testcase này chưa dùng ctx.step() - xem bảng thời gian ở cuối log terminal)'
      )
    );

    lines.push(
      ...block(
        `Console error (${(p.collector && p.collector.consoleErrors.length) || 0})`,
        (p.collector ? p.collector.consoleErrors : []).map((l) => `- ${l}`),
        '(sạch)'
      )
    );

    lines.push(
      ...block(
        `Request lỗi (${(p.collector && p.collector.failedRequests.length) || 0})`,
        (p.collector ? p.collector.failedRequests : []).map((l) => `- ${l}`),
        '(sạch)'
      )
    );

    lines.push('');
    lines.push(`## DOM lúc chết (${dom ? dom.count : 0} element tương tác)`);
    lines.push('```');
    lines.push(dom ? dom.text : '(không đọc được DOM)');
    lines.push('```');

    if (p.videoPath && fs.existsSync(p.videoPath)) {
      lines.push('');
      lines.push(`Video: ${path.relative(path.join(__dirname, '..', '..'), p.videoPath)}`);
    }

    ensureDiagnosticsDir();
    const filePath = path.join(DIAGNOSTICS_DIR, `${p.testcaseId}.fail.md`);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
    return filePath;
  } catch (err) {
    console.warn(`[DIAG] Ghi báo cáo lỗi thất bại: ${err.message}`);
    return null;
  }
}

module.exports = {
  attachCollectors,
  createStepLog,
  writeFailReport,
  guessFailedSelector,
  classifyFailure,
};
