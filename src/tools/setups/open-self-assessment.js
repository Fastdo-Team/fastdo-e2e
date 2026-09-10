// ============================================================================
// setups/open-self-assessment.js: Mở phiếu tự đánh giá "Chưa bắt đầu" đầu tiên
// khớp NAME_FILTER trong danh sách "Cần làm" của /evaluation/my-assessments.
//
//   NAME_FILTER="DRYRUN040" node src/tools/probe.js "/evaluation/my-assessments" \
//     --setup=src/tools/setups/open-self-assessment.js
//
// Dùng để probe form chấm điểm (Behavioral Anchor, thang điểm, nhận xét, nút
// "Lưu nháp") trước khi viết testcase EVAL_037.
// ============================================================================

const NAME_FILTER = process.env.NAME_FILTER || 'DRYRUN040';

module.exports = {
  description: `mở phiếu "Chưa bắt đầu" đầu tiên khớp "${NAME_FILTER}" trong Đánh giá của tôi`,

  async setup(ctx) {
    const { page, click } = ctx;

    const handle = await page.evaluateHandle((needle) => {
      const rows = Array.from(document.querySelectorAll('table.table tbody tr'));
      const row = rows.find(
        (r) => r.innerText.includes(needle) && r.innerText.includes('Chưa bắt đầu')
      );
      if (!row) return null;
      return Array.from(row.querySelectorAll('a')).find((a) => a.innerText.trim() === 'Mở') || null;
    }, NAME_FILTER);

    const btn = handle.asElement();
    if (!btn) {
      throw new Error(`Không tìm thấy dòng "Chưa bắt đầu" nào khớp "${NAME_FILTER}" trong danh sách`);
    }

    await click(page, btn);
    await new Promise((r) => setTimeout(r, 1500));
  },
};
