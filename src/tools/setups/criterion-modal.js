// ============================================================================
// setups/criterion-modal.js: Mở modal "Chọn tiêu chí" và ĐỨNG NGUYÊN ở đó.
//
//   node src/tools/probe.js "/evaluation?tab=template" --setup=src/tools/setups/criterion-modal.js
//
// Dùng để kiểm chứng cờ ⚠ BỊ CHE của dom_digest: khi modal đang mở, mọi element
// PHÍA SAU modal phải mang cờ "BỊ CHE bởi div.modal-background", còn element
// TRONG modal phải mang "TRONG OVERLAY" mà KHÔNG mang "BỊ CHE".
//
// Modal là lớp phủ chắc chắn dựng được theo ý muốn, khác popup "Bật thông báo
// đẩy" xuất hiện không đoán trước được.
// ============================================================================

const H = require('../../core/evaluation_helpers');
const draftEditor = require('./draft-editor');

module.exports = {
  description: 'mở mẫu Nháp rồi mở modal "Chọn tiêu chí" của nhóm đầu tiên',

  async setup(ctx) {
    const { page, click } = ctx;

    await draftEditor.setup(ctx);

    const cards = await H.readGroupCards(page);
    if (cards.length === 0) {
      throw new Error('Mẫu Nháp không có nhóm nào - không mở được modal "Chọn tiêu chí"');
    }

    const options = await H.openCriterionPicker(page, click, 0);
    console.log(`[SETUP] Modal đang mở, chào ra ${options.length} tiêu chí`);
    // CỐ Ý không gọi closeCriterionPicker: probe cần dump lúc modal còn mở.
  },
};
