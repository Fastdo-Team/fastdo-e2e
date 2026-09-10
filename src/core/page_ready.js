// ============================================================================
// page_ready.js: Chờ trang thực sự sẵn sàng để đọc/thao tác.
//
// Tách riêng vì cả probe.js và preflight.js đều cần đúng logic này. Blazor render
// SAU `domcontentloaded`, và app còn overlay loading riêng (`div#custom-loading`)
// phủ kín màn hình vài giây sau khi render - dump hay click lúc đó đều vô nghĩa.
// ============================================================================

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
 * @param {object} page        Puppeteer Page
 * @param {number} timeoutMs   hạn chờ
 * @param {string} [waitText]  thêm điều kiện: body phải chứa chuỗi này
 * @returns {Promise<{count:number, seconds:number, settled:boolean, overlay:string|null}>}
 */
async function waitForSettle(page, timeoutMs = 15000, waitText = null) {
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  let lastOverlay = null;

  while (Date.now() - t0 < timeoutMs) {
    let count = -1;
    let textOk = true;

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

module.exports = { waitForSettle };
