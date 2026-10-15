// ============================================================================
// page_ready.js: Chờ trang thực sự sẵn sàng để đọc/thao tác.
//
// Tách riêng vì cả probe.js và preflight.js đều cần đúng logic này. Blazor render
// SAU `domcontentloaded`, và app còn overlay loading riêng (`div#custom-loading`)
// phủ kín màn hình vài giây sau khi render - dump hay click lúc đó đều vô nghĩa.
// ============================================================================

const config = require('../config');
const { humanClick } = require('./cursor_motion');

// Đã xác nhận thật bằng probe: `page.goto()` thẳng tới một URL sâu (ví dụ
// `/evaluation?tab=template`) có thể ĐUA với việc app tự khôi phục ngữ cảnh tổ
// chức phía client — session/cookie vẫn hợp lệ, nhưng app lặng lẽ render lại màn
// "chọn tổ chức" thay vì trang thật (thanh địa chỉ vẫn đúng URL, chỉ nội dung
// sai). Mọi bước chờ selector của trang thật phía sau chờ vô thời hạn vì thứ
// chúng chờ không bao giờ xuất hiện. Đặt chốt ở waitForSettle() vì mọi công cụ
// điều hướng sâu (probe/preflight/plan) đều đi qua đúng một hàm này.
async function dismissOrgPickerIfPresent(page) {
  // Tổ chức theo HỒ SƠ đang chạy (engine v2 gắn page.__fastdoOrg); page cũ thì dùng ORG_NAME.
  const org = page.__fastdoOrg || config.ORG_NAME;
  const orgXPath = `.//a[contains(., "${org}")]`;
  try {
    const orgLink = await page.$('xpath=' + orgXPath);
    if (!orgLink) return false;
    console.log('[SETTLE] Lạc vào màn chọn tổ chức giữa chừng điều hướng, đang chọn lại:', org);
    // Đợi ĐIỀU HƯỚNG đi kèm cú bấm hoàn tất, không chỉ nghỉ 1 nhịp cố định — nghỉ
    // cố định (bản trước) không đảm bảo redirect đã commit xong, nên vòng lặp
    // gọi hàm này tick tiếp có thể vẫn thấy đúng link đó và bấm lại lần nữa giữa
    // chừng, gây ra 2-3 cú bấm thật cho 1 lần chọn. Cùng mẫu performFullLogin đã
    // dùng đúng ở bước chọn tổ chức lúc đăng nhập mới.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      humanClick(page, orgLink),
    ]);
    await new Promise((r) => setTimeout(r, 800));
    return true;
  } catch (e) {
    return false; // không chặn luồng chính vì một chốt phụ
  }
}

/**
 * Chờ tới khi DOM ổn định VÀ không còn lớp phủ chặn click.
 *
 * Không dò theo chữ cụ thể của 1 trang: đếm số element tương tác ĐANG THẤY tới
 * khi 3 lần đo liền nhau bằng nhau. Shell của Blazor luôn có sẵn 2 nút reconnect
 * ẩn (#components-reconnect-button / #components-resume-button) nên phải lọc
 * element ẩn, không thì heuristic chốt "ổn định" khi app còn chưa render gì.
 *
 * CỐ Ý không đóng popup "Bật thông báo đẩy": nó CHÍNH LÀ thứ digest cần chỉ ra
 * qua cờ "BỊ CHE".
 *
 * @param {object} page          Puppeteer Page
 * @param {number} timeoutMs     hạn chờ
 * @param {string} [waitText]    thêm điều kiện: body phải chứa chuỗi này
 * @param {string} [targetUrl]   URL đang muốn đứng ở đó — nếu bấm qua màn chọn
 *   tổ chức khiến trang bị app tự chuyển hướng sang nơi khác (ví dụ /homepage),
 *   quay lại đúng URL này thay vì lặng lẽ đo độ ổn định của trang SAI
 * @returns {Promise<{count:number, seconds:number, settled:boolean, overlay:string|null}>}
 */
async function waitForSettle(page, timeoutMs = 15000, waitText = null, targetUrl = null) {
  let t0 = Date.now();
  let last = -1;
  let stable = 0;
  let lastOverlay = null;
  // Tự quay lại targetUrl khi vừa chọn xong tổ chức, nhưng GIỚI HẠN số lần —
  // không phải vô điều kiện (từng gây vòng lặp tự đá nhau: quay lại ngay lập
  // tức LẠI kích hoạt đúng cuộc đua đó, ăn hết ngân sách mà không tới được nội
  // dung thật), cũng không phải đúng 1 lần (một số trang đua dai hơn — đã đo
  // thật trên tab=cycle: cần tới lần thứ 2-3 mới ổn định, giới hạn 1 lần bỏ
  // cuộc quá sớm). Khoảng nghỉ 1.2s giữa các lần giữ cho nó không tự đá nhau.
  let reNavigateCount = 0;
  const MAX_RE_NAVIGATE = 3;

  while (Date.now() - t0 < timeoutMs) {
    let count = -1;
    let textOk = true;

    // Kiểm mỗi vòng lặp, không phải 1 lần duy nhất: `page.goto()` chỉ đợi
    // domcontentloaded, còn Blazor render màn chọn tổ chức KHÔNG đồng bộ SAU
    // đó — kiểm sớm quá (ngay đầu hàm) sẽ không thấy gì vì nó còn chưa render,
    // rồi khi nó render xong thì không còn ai kiểm lại nữa. Query rẻ (1 xpath),
    // lặp mỗi 400ms không đáng kể so với cái giá bỏ lỡ nó.
    const justDismissed = await dismissOrgPickerIfPresent(page);
    if (justDismissed && targetUrl && reNavigateCount < MAX_RE_NAVIGATE) {
      reNavigateCount += 1;
      // Bấm chọn tổ chức xong, app tự chuyển hướng sang /homepage — bỏ luôn URL
      // đang muốn đứng ở đó (đã xác nhận thật). Nghỉ một nhịp trước khi quay lại
      // để ngữ cảnh tổ chức phía client kịp lưu — quay lại ngay lập tức (0ms) là
      // chính thứ đã gây ra vòng lặp tự đá nhau ở trên.
      await new Promise((r) => setTimeout(r, 1200));
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Trang thật sự bắt đầu tải lại từ đầu ở đây — reset đồng hồ đếm giờ để
        // nội dung thật (dữ liệu riêng của trang, có thể tải lâu hơn trang gốc)
        // được hưởng trọn `timeoutMs`, không bị trừ hao phần thời gian đã tiêu
        // cho việc chọn lại tổ chức phía trước.
        t0 = Date.now();
        last = -1;
        stable = 0;
      } catch (e) {
        /* để vòng lặp tự thử lại nhịp sau bằng phép đo bình thường */
      }
    }

    try {
      const probeResult = await page.evaluate((needle) => {
        const visible = Array.from(
          document.querySelectorAll('a,button,input,select,textarea')
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            el.offsetParent !== null &&
            r.left >= 0 &&
            r.top >= 0 &&
            r.left < window.innerWidth &&
            r.top < window.innerHeight
          );
        });

        // Không đoán overlay theo diện tích: container layout hợp lệ cũng phủ kín
        // viewport. Đo đúng thứ digest đo - bao nhiêu element thật đang bị che.
        const sample = visible.slice(0, 12);
        let occluded = 0;
        for (const el of sample) {
          const r = el.getBoundingClientRect();
          let top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (top && top.id === '__fake_cursor') top = null;
          if (top && top !== el && !el.contains(top) && !top.contains(el)) occluded += 1;
        }

        return {
          count: visible.length,
          occluded,
          sampled: sample.length,
          textOk: needle ? document.body.innerText.includes(needle) : true,
        };
      }, waitText || null);

      count = probeResult.count;
      const blocked =
        probeResult.sampled >= 3 && probeResult.occluded / probeResult.sampled >= 0.5;
      textOk = probeResult.textOk && !blocked;
      lastOverlay = blocked
        ? `${probeResult.occluded}/${probeResult.sampled} element bị che`
        : null;
    } catch (err) {
      count = -1; // đang điều hướng, đo lại vòng sau
    }

    if (count > 0 && count === last && textOk) {
      stable += 1;
      if (stable >= 2) {
        return { count, seconds: (Date.now() - t0) / 1000, settled: true, overlay: null };
      }
    } else {
      stable = 0;
    }
    last = count;
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    count: last,
    seconds: (Date.now() - t0) / 1000,
    settled: false,
    overlay: lastOverlay,
  };
}

module.exports = { waitForSettle, dismissOrgPickerIfPresent };
