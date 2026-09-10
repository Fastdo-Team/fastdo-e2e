// ============================================================================
// setups/cycle-view.js: Mở trang "Kỳ đánh giá", lọc theo trạng thái (tuỳ chọn),
// rồi bấm "Xem" vào 1 kỳ để khám phá cấu trúc trang chi tiết kỳ (tiến độ, kết
// quả, xuất Excel...).
//
//   PROBE_CYCLE_STATUS="Đã đóng" PROBE_CYCLE_INDEX=0 \
//     node src/tools/probe.js "/evaluation" --setup=src/tools/setups/cycle-view.js
// ============================================================================

const H = require('../../core/evaluation_helpers');

const ROW_INDEX = parseInt(process.env.PROBE_CYCLE_INDEX || '0', 10);
const STATUS = process.env.PROBE_CYCLE_STATUS || null;

module.exports = {
  description: `mở "Kỳ đánh giá"${STATUS ? ` lọc "${STATUS}"` : ''}, bấm "Xem" ở dòng ${ROW_INDEX}`,

  async setup(ctx) {
    const { page, click } = ctx;
    await H.waitFor(page, () => document.body.innerText.includes('Kỳ đánh giá'), null, 15000);
    await H.dismissPushPopup(page, click);
    await H.sleep(600);

    if (STATUS) {
      const selHandle = await page.evaluateHandle(() =>
        Array.from(document.querySelectorAll('select')).find((s) => s.innerText.includes('Nháp'))
      );
      const selEl = selHandle.asElement();
      await page.evaluate(
        (el, lbl) => {
          const opt = Array.from(el.options).find((o) => o.textContent.trim() === lbl);
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        selEl,
        STATUS
      );
      await H.sleep(1200);
    }

    const handle = await page.evaluateHandle((idx) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const row = rows[idx];
      if (!row) return null;
      return Array.from(row.querySelectorAll('a')).find((a) => a.textContent.trim() === 'Xem') || null;
    }, ROW_INDEX);
    const link = handle.asElement();
    if (!link) throw new Error(`Không tìm thấy nút "Xem" ở dòng ${ROW_INDEX}`);
    await click(page, link);
    await H.sleep(1500);
  },
};
