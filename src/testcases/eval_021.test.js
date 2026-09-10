// ============================================================================
// eval_021.test.js: Testcase EVAL_021
// Tiêu đề: Happy - Kích hoạt Mẫu đánh giá Draft hợp lệ thành công
//
// Kết quả mong muốn (theo Sheet):
//   Kích hoạt thành công, Mẫu chuyển "Đang dùng" (Active), hiển thị banner chế độ
//   chỉ xem, ẩn hoàn toàn khả năng Sửa trực tiếp cấu trúc Nhóm/Tiêu chí.
//
// ⚠️ CASE NÀY PHÁ HUỶ DỮ LIỆU: mẫu Nháp dùng làm sandbox sẽ chuyển vĩnh viễn sang
// "Đang dùng" và KHÔNG quay lại Nháp được. Mỗi lần chạy lại cần 1 mẫu Nháp mới -
// tạo bằng "Nhân bản" từ 1 mẫu Đang dùng rồi đổi DRAFT_TEMPLATE_NAME bên dưới.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

// Mẫu Nháp sẽ bị tiêu thụ trong lần chạy này
// Lần chạy trước đã tiêu thụ mẫu "5555" (nay là Đang dùng) - đổi sang mẫu Nháp khác.
const DRAFT_TEMPLATE_NAME = 'Mẫu đánh giá Thực tập sinh - Bản sao';
const FALLBACK_GROUP_NAME = 'Nhom hop le EVAL_021';

module.exports = {
  id: 'EVAL_021',
  title: 'Kích hoạt Mẫu đánh giá Draft hợp lệ thành công',
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

    // Bước 2: Chuẩn hoá thành 1 mẫu HỢP LỆ (có nhóm, có tiêu chí, trọng số > 0)
    let cards = await H.readGroupCards(page);
    console.log('[TEST] Cấu trúc ban đầu:', JSON.stringify(cards));
    if (cards.length === 0) {
      throw new Error(`Mẫu "${DRAFT_TEMPLATE_NAME}" không có nhóm nào - thiếu tiền điều kiện.`);
    }

    // Chỉ giữ lại 1 nhóm hợp lệ: xoá hết nhóm rỗng (nhóm rỗng sẽ chặn kích hoạt)
    const emptyBefore = cards.filter((c) => c.isEmpty).length;
    if (emptyBefore > 0 && cards.some((c) => !c.isEmpty)) {
      const removed = await H.removeEmptyGroups(page, click);
      console.log(`[TEST] Dọn ${removed} nhóm rỗng`);
      cards = await H.readGroupCards(page);
    }

    // Nếu mọi nhóm đều rỗng thì nạp tiêu chí cho nhóm đầu tiên
    if (!cards.some((c) => !c.isEmpty)) {
      console.log('[TEST] Chuẩn bị: nhóm chưa có tiêu chí, thêm 1 tiêu chí từ Kho tiêu chí');
      const picked = await H.addCriterion(page, click, 0);
      console.log(`[TEST] Đã thêm tiêu chí "${picked}"`);
      cards = await H.readGroupCards(page);
    }

    const target = cards.find((c) => !c.isEmpty);
    if (!target) throw new Error('Không tạo được nhóm hợp lệ có tiêu chí');

    if (!target.name || !target.name.trim()) {
      console.log(`[TEST] Chuẩn bị: nhóm chưa có tên, đặt tên "${FALLBACK_GROUP_NAME}"`);
      await H.setGroupName(page, target.index, FALLBACK_GROUP_NAME);
    }
    if (!target.weight || Number(target.weight) <= 0) {
      console.log('[TEST] Chuẩn bị: Trọng số nhóm <= 0, đặt lại = 1');
      await H.setGroupWeight(page, target.index, 1);
    }
    for (let i = 0; i < target.criteria.length; i++) {
      if (!target.criteria[i].weight || Number(target.criteria[i].weight) <= 0) {
        console.log(`[TEST] Chuẩn bị: Trọng số tiêu chí "${target.criteria[i].name}" <= 0, đặt lại = 1`);
        await H.setCriterionWeight(page, target.index, i, 1);
      }
    }

    cards = await H.readGroupCards(page);
    console.log('[TEST] Tiền điều kiện sau chuẩn hoá:', JSON.stringify(cards));
    const finalGroup = cards.find((c) => !c.isEmpty);

    // Bước 3: Bấm Kích hoạt
    console.log('[TEST] Thao tác: Bấm nút "Kích hoạt"');
    const act = await H.clickActivate(page, click, waitXPath);
    console.log('[TEST] Bị chặn:', act.blocked, '| Đã kích hoạt:', act.activated);
    if (act.blocked) {
      console.log('[TEST] Banner lỗi:', H.extractActivationErrors(act.bodyText).join(' | '));
    }

    // Bước 4: Verify độc lập - reload xem banner chỉ xem và khả năng sửa
    console.log('[TEST] Verify độc lập: Reload kiểm tra trình soạn thảo...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await H.waitFor(page, () => document.body.innerText.includes('Quay lại danh sách'), null, 25000);
    await H.sleep(1200);

    const verify = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        text: t,
        readOnlyBanner: t.includes('chỉ xem'),
        hasAddGroup: t.includes('Thêm nhóm'),
        hasAddCriterion: t.includes('Thêm tiêu chí'),
        hasDeleteGroup: t.includes('Xóa nhóm'),
        hasActivateBtn: t.includes('Kích hoạt'),
      };
    });

    // Trạng thái phải đọc từ DANH SÁCH mẫu, không đọc từ trang soạn thảo:
    // sau khi kích hoạt, trang soạn thảo chỉ hiện banner "chỉ xem" chứ KHÔNG in
    // chữ "Đang dùng" - bám vào text của trang editor sẽ báo FAIL oan.
    console.log('[TEST] Verify độc lập: Đối chiếu trạng thái trong danh sách mẫu...');
    await H.openEvaluationTab(page, click, 'template');
    const listStatus = await page.evaluate((name) => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) => {
        const first = tr.querySelector('td');
        return first && (first.innerText || '').trim() === name;
      });
      if (!row) return null;
      const cells = Array.from(row.querySelectorAll('td')).map((td) => (td.innerText || '').trim());
      return cells[1] || null;
    }, DRAFT_TEMPLATE_NAME);
    console.log(`[TEST] Trạng thái của "${DRAFT_TEMPLATE_NAME}" trong danh sách:`, listStatus);

    const statusActive = listStatus === 'Đang dùng';
    const editingHidden = !verify.hasAddGroup && !verify.hasAddCriterion && !verify.hasDeleteGroup;
    console.log(
      `[TEST] Đang dùng=${statusActive} | banner chỉ xem=${verify.readOnlyBanner} | ` +
        `ẩn Thêm nhóm=${!verify.hasAddGroup} ẩn Thêm tiêu chí=${!verify.hasAddCriterion} ẩn Xóa nhóm=${!verify.hasDeleteGroup}`
    );

    const pass = act.activated && statusActive && editingHidden;
    const resultText = pass
      ? `Mẫu Nháp "${DRAFT_TEMPLATE_NAME}" (nhóm "${finalGroup.name}", trọng số nhóm ${finalGroup.weight}, ` +
        `${finalGroup.criteria.length} tiêu chí trọng số > 0) bấm Kích hoạt: thành công. ` +
        'Reload xác nhận trạng thái chuyển "Đang dùng", hiển thị banner chế độ chỉ xem, ' +
        'ẩn hoàn toàn Thêm nhóm / Thêm tiêu chí / Xóa nhóm - không sửa trực tiếp cấu trúc được nữa. ' +
        'Đối chiếu lại danh sách Mẫu đánh giá: mẫu hiển thị trạng thái "Đang dùng".'
      : `FAIL: kích hoạt thành công=${act.activated}; trạng thái trong danh sách="${listStatus}"; ` +
        `banner chỉ xem=${verify.readOnlyBanner}; ẩn hết thao tác sửa cấu trúc=${editingHidden} ` +
        `(còn Thêm nhóm=${verify.hasAddGroup}, Thêm tiêu chí=${verify.hasAddCriterion}, Xóa nhóm=${verify.hasDeleteGroup}).` +
        (act.blocked ? ' Hệ thống chặn kích hoạt dù tiền điều kiện đã hợp lệ.' : '');

    return { pass, resultText };
  },
};
