// ============================================================================
// eval_019.test.js: Testcase EVAL_019
// Tiêu đề: Business rule BR-14 - Kích hoạt mẫu có Trọng số nhóm bằng 0 bị chặn
//
// Kết quả mong muốn (theo Sheet):
//   Hệ thống chặn Kích hoạt, hiển thị đúng lỗi "Trọng số nhóm phải lớn hơn 0";
//   Mẫu không chuyển sang Active.
//
// Ghi chú: DEV/QC note của LẦN 1 ghi "AI cần retest lại vì chưa điền 0" - lần này
// test điền số 0 thật vào ô Trọng số nhóm rồi mới bấm Kích hoạt.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const DRAFT_TEMPLATE_NAME = 'EVAL_QA - Mau test nhom - Bản sao';

module.exports = {
  id: 'EVAL_019',
  title: 'Chặn kích hoạt khi Trọng số nhóm = 0',
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

    // Bước 2: Chuẩn hoá - bỏ hết nhóm rỗng để lỗi duy nhất là trọng số = 0
    let cards = await H.readGroupCards(page);
    console.log('[TEST] Cấu trúc ban đầu:', JSON.stringify(cards));
    if (cards.some((c) => c.isEmpty)) {
      const removed = await H.removeEmptyGroups(page, click);
      console.log(`[TEST] Dọn ${removed} nhóm rỗng để cô lập lỗi trọng số`);
      cards = await H.readGroupCards(page);
    }

    const target = cards.find((c) => !c.isEmpty);
    if (!target) {
      throw new Error(
        `Mẫu "${DRAFT_TEMPLATE_NAME}" không còn nhóm nào có tiêu chí - thiếu tiền điều kiện.`
      );
    }
    const originalWeight = target.weight || '1';
    console.log(`[TEST] Nhóm mục tiêu "${target.name}", trọng số hiện tại = ${originalWeight}`);

    // Bước 3: Điền Trọng số nhóm = 0
    console.log('[TEST] Thao tác: Điền Trọng số nhóm = 0');
    await H.setGroupWeight(page, target.index, 0);
    const afterSet = await H.readGroupCards(page);
    const appliedWeight = (afterSet[target.index] || {}).weight;
    console.log('[TEST] Trọng số sau khi điền:', appliedWeight);
    if (String(appliedWeight) !== '0') {
      throw new Error(`Không điền được số 0 vào ô Trọng số nhóm (đang là "${appliedWeight}")`);
    }

    // Bước 4: Bấm Kích hoạt
    console.log('[TEST] Thao tác: Bấm nút "Kích hoạt"');
    const act = await H.clickActivate(page, click, waitXPath);
    const blocked = act.blocked;
    const hasWeightError = /Trọng số nhóm phải lớn hơn 0/i.test(act.bodyText);
    const errorLine = H.extractActivationErrors(act.bodyText).join(' | ');
    console.log('[TEST] Bị chặn:', blocked, '| Có lỗi trọng số:', hasWeightError);
    console.log('[TEST] Nội dung banner lỗi:', errorLine);

    // Bước 5: Verify độc lập - reload xem mẫu còn Nháp không
    console.log('[TEST] Verify độc lập: Reload kiểm tra trạng thái mẫu...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await H.waitFor(
      page,
      () =>
        document.querySelector('div.box.mb-4 input[placeholder="Tên nhóm"]') &&
        document.body.innerText.includes('Kích hoạt'),
      null,
      25000
    );
    const status = await H.readTemplateStatus(page);
    const stillDraft = status === 'Nháp';
    console.log('[TEST] Trạng thái sau reload:', status);

    // Bước 6: Dọn dẹp - trả Trọng số nhóm về giá trị cũ
    try {
      const now = await H.readGroupCards(page);
      const again = now.find((c) => c.name === target.name && !c.isEmpty) || now.find((c) => !c.isEmpty);
      if (again) {
        await H.setGroupWeight(page, again.index, originalWeight);
        await H.saveDraft(page, click, waitXPath);
        console.log(`[TEST] Dọn dẹp: trả Trọng số nhóm về ${originalWeight} và lưu nháp`);
      }
    } catch (err) {
      console.warn('[TEST] Dọn dẹp không thành công (bỏ qua):', err.message);
    }

    const pass = blocked && hasWeightError && stillDraft;
    const resultText = pass
      ? `Điền Trọng số nhóm = 0 cho nhóm "${target.name}" rồi bấm Kích hoạt: hệ thống chặn đúng ` +
        `theo BR-14, hiển thị lỗi "Trọng số nhóm phải lớn hơn 0". Banner lỗi: "${errorLine}". ` +
        'Reload xác nhận mẫu vẫn ở trạng thái Nháp, không chuyển sang Active.'
      : `FAIL: chặn kích hoạt=${blocked}; có lỗi "Trọng số nhóm phải lớn hơn 0"=${hasWeightError}; ` +
        `mẫu vẫn Nháp=${stillDraft} (trạng thái đọc được: "${status}"). Banner lỗi: "${errorLine}".`;

    return { pass, resultText };
  },
};
