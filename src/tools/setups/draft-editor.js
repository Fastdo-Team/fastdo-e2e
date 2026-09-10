// ============================================================================
// setups/draft-editor.js: Đưa probe tới trình soạn thảo của 1 mẫu Nháp.
//
//   node src/tools/probe.js "/evaluation?tab=template" --setup=src/tools/setups/draft-editor.js
//
// File setup nhận ĐÚNG `ctx` mà testcase nhận, nên mọi helper trong
// core/evaluation_helpers.js đều dùng được ngay, không phải viết lại.
// ============================================================================

const H = require('../../core/evaluation_helpers');

const TEMPLATE_NAME = process.env.PROBE_TEMPLATE || 'EVAL_QA - Mau test nhom - Bản sao';

module.exports = {
  description: `mở mẫu Nháp "${TEMPLATE_NAME}" ở chế độ Sửa`,

  async setup(ctx) {
    const { page, click, waitXPath } = ctx;
    await H.openEvaluationTab(page, click, 'template');
    await H.openDraftByName(page, click, waitXPath, TEMPLATE_NAME);
  },
};
