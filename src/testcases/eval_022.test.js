// ============================================================================
// eval_022.test.js: Testcase EVAL_022
// Tiêu đề: Business rule - Không bắt buộc Tổng trọng số nhóm/tiêu chí phải bằng 100%
//
// Kết quả mong muốn (theo Sheet):
//   Theo mục 1.3.2/1.3.5: hệ thống Kích hoạt thành công NGAY CẢ KHI tổng Trọng số
//   nhóm/tiêu chí khác 100% - BR-14 chỉ yêu cầu từng Trọng số > 0, KHÔNG ràng buộc
//   tổng phải bằng 100.
//
// Ghi chú: LẦN 1 mới chỉ "xác nhận qua đọc code", chưa test trực tiếp với tổng
// khác 100 (lần kích hoạt thành công trước đó vô tình có tổng đúng 100). Case này
// ép tổng trọng số lệch hẳn 100 rồi mới kích hoạt.
//
// ⚠️ CASE NÀY PHÁ HUỶ DỮ LIỆU: mẫu Nháp sandbox sẽ chuyển vĩnh viễn sang
// "Đang dùng". Mỗi lần chạy lại cần 1 mẫu Nháp mới (tạo bằng "Nhân bản").
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

// Mẫu Nháp sẽ bị tiêu thụ trong lần chạy này.
// Lần chạy trước đã tiêu thụ "66666" (nay là Đang dùng).
const DRAFT_TEMPLATE_NAME = 'Mẫu đánh giá Thực tập sinh - Bản sao';
// Bộ trọng số cố ý lệch 100 (30 + 25 = 55)
const GROUP_WEIGHTS = [30, 25];
const CRITERION_WEIGHT = 7;

module.exports = {
  id: 'EVAL_022',
  title: 'Tổng trọng số khác 100% vẫn kích hoạt được',
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

    // Bước 2: Chuẩn hoá - bỏ nhóm rỗng, đảm bảo mọi nhóm đều có tiêu chí
    let cards = await H.readGroupCards(page);
    console.log('[TEST] Cấu trúc ban đầu:', JSON.stringify(cards));
    if (cards.some((c) => c.isEmpty) && cards.some((c) => !c.isEmpty)) {
      const removed = await H.removeEmptyGroups(page, click);
      console.log(`[TEST] Dọn ${removed} nhóm rỗng`);
      cards = await H.readGroupCards(page);
    }
    if (!cards.some((c) => !c.isEmpty)) {
      throw new Error(`Mẫu "${DRAFT_TEMPLATE_NAME}" không có nhóm nào chứa tiêu chí.`);
    }

    // Bước 3: Ép trọng số lệch hẳn 100
    console.log('[TEST] Thao tác: Đặt trọng số nhóm/tiêu chí sao cho tổng KHÁC 100');
    for (let i = 0; i < cards.length; i++) {
      const w = GROUP_WEIGHTS[i] !== undefined ? GROUP_WEIGHTS[i] : GROUP_WEIGHTS[GROUP_WEIGHTS.length - 1];
      await H.setGroupWeight(page, i, w);
      for (let j = 0; j < cards[i].criteria.length; j++) {
        await H.setCriterionWeight(page, i, j, CRITERION_WEIGHT);
      }
    }

    cards = await H.readGroupCards(page);
    let groupTotal = cards.reduce((s, c) => s + (Number(c.weight) || 0), 0);
    let criterionTotals = cards.map((c) => ({
      group: c.name,
      total: c.criteria.reduce((s, cr) => s + (Number(cr.weight) || 0), 0),
    }));
    console.log('[TEST] Cấu trúc sau khi đặt trọng số:', JSON.stringify(cards));
    console.log(
      `[TEST] Tổng trọng số nhóm = ${groupTotal} | tổng trọng số tiêu chí từng nhóm:`,
      JSON.stringify(criterionTotals)
    );

    const totalsAreOffHundred =
      groupTotal !== 100 && criterionTotals.every((t) => t.total !== 100);
    if (!totalsAreOffHundred) {
      throw new Error(
        `Không tạo được tiền điều kiện: cần tổng trọng số KHÁC 100 nhưng đang là nhóm=${groupTotal}, ` +
          `tiêu chí=${JSON.stringify(criterionTotals)}`
      );
    }

    // Bước 4: Bấm Kích hoạt
    console.log('[TEST] Thao tác: Bấm nút "Kích hoạt"');
    let act = await H.clickActivate(page, click, waitXPath);
    console.log('[TEST] Bị chặn:', act.blocked, '| Đã kích hoạt:', act.activated);
    let errorLine = H.extractActivationErrors(act.bodyText).join(' | ');
    if (errorLine) console.log('[TEST] Banner lỗi:', errorLine);

    // Mẫu sandbox có thể còn tiêu chí đã Ngừng dùng (dư từ các case EVAL_007B/007C).
    // Lỗi đó chặn kích hoạt vì lý do KHÁC HẲN rule đang test, làm case này không
    // kết luận được gì về tổng trọng số -> dọn rồi kích hoạt lại.
    const retired = H.extractRetiredCriterionNames(act.bodyText);
    let cleanedRetired = [];
    if (act.blocked && retired.length > 0) {
      console.log('[TEST] Tiền điều kiện bẩn - tiêu chí đã Ngừng dùng:', JSON.stringify(retired));
      const removed = await H.removeCriterionRowsByName(page, click, retired);
      cleanedRetired = retired;
      console.log(`[TEST] Đã gỡ ${removed} dòng tiêu chí Ngừng dùng`);

      // Nhóm nào rỗng sau khi gỡ thì bỏ luôn, nếu không sẽ dính lỗi "nhóm rỗng"
      const afterClean = await H.readGroupCards(page);
      if (afterClean.some((c) => c.isEmpty) && afterClean.some((c) => !c.isEmpty)) {
        const n = await H.removeEmptyGroups(page, click);
        console.log(`[TEST] Gỡ tiếp ${n} nhóm rỗng phát sinh sau khi dọn`);
      }

      cards = await H.readGroupCards(page);
      console.log('[TEST] Cấu trúc sau khi dọn:', JSON.stringify(cards));
      if (!cards.some((c) => !c.isEmpty)) {
        throw new Error(
          `Sau khi gỡ tiêu chí Ngừng dùng, mẫu "${DRAFT_TEMPLATE_NAME}" không còn nhóm hợp lệ nào ` +
            '- cần mẫu Nháp khác để test case này.'
        );
      }

      console.log('[TEST] Thao tác: Bấm "Kích hoạt" lại sau khi dọn tiền điều kiện');
      act = await H.clickActivate(page, click, waitXPath);
      console.log('[TEST] Bị chặn:', act.blocked, '| Đã kích hoạt:', act.activated);
      errorLine = H.extractActivationErrors(act.bodyText).join(' | ');
      if (errorLine) console.log('[TEST] Banner lỗi:', errorLine);
    }

    // Tổng trọng số có thể đã đổi sau bước dọn -> tính lại theo trạng thái THẬT
    // tại thời điểm bấm Kích hoạt, đừng báo cáo con số cũ.
    if (cleanedRetired.length > 0) {
      groupTotal = cards.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
      criterionTotals = cards.map((c) => ({
        group: c.name,
        total: c.criteria.reduce((sum, cr) => sum + (Number(cr.weight) || 0), 0),
      }));
      console.log(`[TEST] Tổng trọng số sau khi dọn: nhóm = ${groupTotal} |`, JSON.stringify(criterionTotals));
    }

    // Bước 5: Verify độc lập - reload xem trạng thái
    console.log('[TEST] Verify độc lập: Reload kiểm tra trạng thái mẫu...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await H.waitFor(page, () => document.body.innerText.includes('Quay lại danh sách'), null, 25000);
    await H.sleep(1200);

    // Đọc trạng thái từ DANH SÁCH mẫu: trang soạn thảo sau khi kích hoạt chỉ hiện
    // banner "chỉ xem", KHÔNG in chữ "Đang dùng" -> bám text trang editor sẽ FAIL oan.
    await H.openEvaluationTab(page, click, 'template');
    const listStatus = await page.evaluate((name) => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) => {
        const first = tr.querySelector('td');
        return first && (first.innerText || '').trim() === name;
      });
      if (!row) return null;
      return Array.from(row.querySelectorAll('td')).map((td) => (td.innerText || '').trim())[1] || null;
    }, DRAFT_TEMPLATE_NAME);
    const statusActive = listStatus === 'Đang dùng';
    console.log(`[TEST] Trạng thái của "${DRAFT_TEMPLATE_NAME}" trong danh sách:`, listStatus);

    const pass = act.activated && statusActive && !act.blocked;
    const resultText = pass
      ? `Đặt Trọng số nhóm ${cards.map((c) => c.weight).join(' + ')} = ${groupTotal} (khác 100) và ` +
        `trọng số tiêu chí mỗi nhóm ${JSON.stringify(criterionTotals.map((t) => t.total))} (đều khác 100), ` +
        'rồi bấm Kích hoạt: hệ thống kích hoạt THÀNH CÔNG, không hề đòi tổng phải bằng 100%. ' +
        'Reload xác nhận mẫu đã chuyển "Đang dùng". Xác nhận đúng mục 1.3.2/1.3.5: BR-14 chỉ ' +
        'yêu cầu từng trọng số > 0, không có ràng buộc tổng = 100.' +
        (cleanedRetired.length > 0
          ? ` (Trước đó phải gỡ tiêu chí đã Ngừng dùng còn sót trong mẫu: ${cleanedRetired.join(', ')} - chúng chặn kích hoạt vì lý do khác, không liên quan rule tổng trọng số.)`
          : '')
      : `FAIL: với tổng trọng số nhóm = ${groupTotal} (khác 100), hệ thống KHÔNG kích hoạt được. ` +
        `Bị chặn=${act.blocked}; đã kích hoạt=${act.activated}; trạng thái trong danh sách="${listStatus}". ` +
        (errorLine ? `Banner lỗi: "${errorLine}".` : '');

    return { pass, resultText };
  },
};
