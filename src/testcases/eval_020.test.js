// ============================================================================
// eval_020.test.js: Testcase EVAL_020
// Tiêu đề: Kích hoạt mẫu có tiêu chí trùng lặp trong cùng 1 nhóm không bị chặn
//
// Kết quả mong muốn (theo Sheet):
//   Theo BR-14 mục 1.3.5 ("không trùng tiêu chí trong nhóm"): hệ thống PHẢI chặn
//   việc 1 Tiêu chí xuất hiện từ 2 lần trở lên trong cùng 1 Nhóm.
//
// Ghi chú: LẦN 1 tố bug ở chỗ "dropdown vẫn cho chọn, không lọc loại trừ".
// Case này kiểm tra chính hàng rào đó: mở modal "Chọn tiêu chí" của 1 nhóm đã có
// tiêu chí và xem tiêu chí đó còn được chào ra để chọn lại nữa không.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const DRAFT_TEMPLATE_NAME = 'EVAL_QA - Mau test nhom - Bản sao';

module.exports = {
  id: 'EVAL_020',
  title: 'Không cho tiêu chí trùng lặp trong cùng 1 nhóm',
  targetPath: '/evaluation?tab=template',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click, waitXPath } = ctx;

    // Bước 0-1: Mở mẫu Nháp sandbox
    console.log('[TEST] Mở danh sách Mẫu đánh giá');
    await H.openEvaluationTab(page, click, 'template');
    console.log(`[TEST] Mở mẫu Nháp "${DRAFT_TEMPLATE_NAME}" ở chế độ Sửa`);
    await H.openDraftByName(page, click, waitXPath, DRAFT_TEMPLATE_NAME);

    // Bước 2: Tìm nhóm đã có sẵn tiêu chí
    const cards = await H.readGroupCards(page);
    console.log('[TEST] Cấu trúc hiện tại:', JSON.stringify(cards));
    const target = cards.find((c) => !c.isEmpty && c.criteria.length > 0);
    if (!target) {
      throw new Error(
        `Mẫu "${DRAFT_TEMPLATE_NAME}" không có nhóm nào chứa tiêu chí - thiếu tiền điều kiện.`
      );
    }
    const existingNames = target.criteria.map((c) => c.name);
    console.log(`[TEST] Nhóm "${target.name}" đang có tiêu chí:`, JSON.stringify(existingNames));

    // Bước 3: Mở modal "Chọn tiêu chí" và xem danh sách được chào ra
    console.log('[TEST] Thao tác: Bấm "+ Thêm tiêu chí" trong chính nhóm đó');
    const options = await H.openCriterionPicker(page, click, target.index);
    console.log('[TEST] Danh sách tiêu chí modal cho chọn:', JSON.stringify(options));

    const stillOffered = existingNames.filter((n) => options.includes(n));
    const duplicateSelectable = stillOffered.length > 0;
    console.log('[TEST] Tiêu chí đã có trong nhóm vẫn được chào lại:', JSON.stringify(stillOffered));

    // Cảnh báo nếu có tiêu chí trùng TÊN nhưng khác ID (theo EVAL_014 là hợp lệ)
    const duplicateNamesInPicker = options.filter((n, i) => options.indexOf(n) !== i);
    if (duplicateNamesInPicker.length > 0) {
      console.log(
        '[TEST] Lưu ý: modal có tiêu chí trùng TÊN nhưng khác ID (hợp lệ theo EVAL_014):',
        JSON.stringify([...new Set(duplicateNamesInPicker)])
      );
    }

    await H.closeCriterionPicker(page, click);

    // Bước 4: Xác nhận mẫu không bị đụng chạm gì
    const status = await H.readTemplateStatus(page);
    const stillDraft = status === 'Nháp';
    console.log('[TEST] Trạng thái mẫu sau thao tác:', status);

    const pass = !duplicateSelectable && stillDraft;
    const resultText = pass
      ? `Nhóm "${target.name}" đang có tiêu chí ${JSON.stringify(existingNames)}. Mở lại modal ` +
        '"Chọn tiêu chí" của chính nhóm đó: các tiêu chí đã có ĐÃ BỊ LOẠI khỏi danh sách, ' +
        `modal chỉ còn ${options.length} tiêu chí khác. Không thể tạo được trạng thái trùng tiêu chí ` +
        'trong cùng 1 nhóm qua giao diện nữa, nên hàng rào BR-14 (không trùng tiêu chí trong nhóm) ' +
        'đã được chặn ngay từ bước chọn. Mẫu vẫn ở trạng thái Nháp.' +
        (duplicateNamesInPicker.length > 0
          ? ` Lưu ý: danh sách vẫn có tiêu chí trùng TÊN nhưng khác ID (${[...new Set(duplicateNamesInPicker)].join(', ')}) - đây là hợp lệ theo EVAL_014.`
          : '')
      : `FAIL: modal "Chọn tiêu chí" của nhóm "${target.name}" VẪN chào lại tiêu chí đã có trong nhóm ` +
        `(${stillOffered.join(', ')}) - vẫn tạo được trạng thái trùng tiêu chí. ` +
        `Mẫu vẫn Nháp=${stillDraft}.`;

    return { pass, resultText };
  },
};
