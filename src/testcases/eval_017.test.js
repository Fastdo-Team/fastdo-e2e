// ============================================================================
// eval_017.test.js: Testcase EVAL_017
// Tiêu đề: Bug UI - Hiển thị text thô "Lỗi: group.ErrorSummary" khi Kích hoạt thất bại
//
// Kết quả mong muốn (theo Sheet):
//   Khi Kích hoạt thất bại do 1 nhóm có lỗi, các nhóm KHÔNG có lỗi không được
//   hiển thị bất kỳ dòng text lỗi thô nào (không lộ binding expression ra UI).
//
// Ghi chú kỹ thuật: KHÔNG hardcode id mẫu nữa. Bản cũ trỏ cứng vào
// id=2608280428469JSU4YU9FCHUR135JN59 - mẫu nháp này đã bị xoá khỏi DB nên trang
// trả "Đã có lỗi khi tải dữ liệu. Thử lại" và không render ô Tên nhóm.
// Bản này tự tìm mẫu Nháp theo tên trong danh sách rồi bấm "Sửa" để vào editor.
//
// Tốc độ: mọi bước chờ đều bám vào điều kiện thật của DOM (waitForFunction) thay
// vì ngủ cứng - Blazor phản hồi nhanh hơn nhiều so với các mốc sleep cũ.
// ============================================================================

const config = require('../config');

// Tên mẫu Nháp dùng làm sandbox cho case này (mẫu QA, không phải data nghiệp vụ thật)
const DRAFT_TEMPLATE_NAME = 'EVAL_QA - Mau test nhom - Bản sao';
// Tên nhóm rỗng do test tự tạo để sinh lỗi kích hoạt
const EMPTY_GROUP_NAME = 'Nhom rong EVAL_017';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng; hết hạn thì bỏ qua thay vì ném lỗi */
async function waitFor(page, fn, arg, timeout = 8000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
    return true;
  } catch (err) {
    return false;
  }
}

/** Đếm số card nhóm và số nhóm rỗng ngay trên trình duyệt */
function countGroups(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    return {
      total: cards.length,
      empty: cards.filter((c) => (c.innerText || '').includes('Nhóm chưa có tiêu chí nào')).length,
    };
  });
}

/** Đọc trạng thái các card nhóm hiện có trên trình soạn thảo */
function readGroupCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter(
      (c) => c.querySelector('input[placeholder="Tên nhóm"]')
    );
    return cards.map((c, index) => ({
      index,
      name: c.querySelector('input[placeholder="Tên nhóm"]').value,
      isEmpty: (c.innerText || '').includes('Nhóm chưa có tiêu chí nào'),
      hasRawErrorText: (c.innerText || '').includes('group.ErrorSummary'),
    }));
  });
}

/**
 * Xoá toàn bộ nhóm rỗng đang có trên editor, trả về số nhóm đã xoá.
 * Phải xoá từng nhóm một bằng click chuột thật: Blazor render lại cả danh sách
 * sau mỗi lần xoá nên nếu bắn nhiều click liền trong 1 lượt evaluate thì các
 * click sau rơi vào node đã bị gỡ khỏi DOM và không có tác dụng.
 */
async function removeEmptyGroups(page, click) {
  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const before = await countGroups(page);
    if (before.empty === 0) break;

    const handle = await page.evaluateHandle(() => {
      const card = Array.from(document.querySelectorAll('div.box.mb-4')).find(
        (c) =>
          c.querySelector('input[placeholder="Tên nhóm"]') &&
          (c.innerText || '').includes('Nhóm chưa có tiêu chí nào')
      );
      if (!card) return null;
      return (
        Array.from(card.querySelectorAll('a, button')).find(
          (b) => (b.innerText || '').trim() === 'Xóa nhóm'
        ) || null
      );
    });
    const btn = handle.asElement();
    if (!btn) break;

    await click(page, btn);
    // Chờ đúng lúc Blazor render lại xong thay vì ngủ cứng
    await waitFor(
      page,
      (n) =>
        Array.from(document.querySelectorAll('div.box.mb-4')).filter(
          (c) => c.querySelector('input[placeholder="Tên nhóm"]')
        ).length < n,
      before.total,
      5000
    );
    removed++;
  }
  return removed;
}

module.exports = {
  id: 'EVAL_017',
  title: 'Bug UI: text thô "Lỗi: group.ErrorSummary" khi Kích hoạt thất bại',
  targetPath: '/evaluation?tab=template',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click, type, waitXPath } = ctx;

    // -----------------------------------------------------------------------
    // Bước 0: Mở danh sách Mẫu đánh giá
    // -----------------------------------------------------------------------
    const listUrl = this.getTargetUrl();
    console.log(`[TEST] Mở danh sách Mẫu đánh giá: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      (name) => document.body.innerText.includes(name),
      { timeout: 25000, polling: 200 },
      DRAFT_TEMPLATE_NAME
    );

    // Popup "Bật thông báo đẩy" che bảng danh sách -> phải đóng trước khi click
    const denyPushBtn = await waitXPath(
      page,
      './/*[self::button or self::a][normalize-space()="Từ chối"]',
      2500
    );
    if (denyPushBtn) {
      console.log('[TEST] Đóng popup xin quyền thông báo đẩy');
      await click(page, denyPushBtn);
      await waitFor(page, () => !document.body.innerText.includes('Bật thông báo đẩy'), null, 4000);
    }

    // -----------------------------------------------------------------------
    // Bước 1: Vào trình soạn thảo mẫu Nháp (tự tìm theo tên, không hardcode id)
    // -----------------------------------------------------------------------
    const editXPath =
      `.//tr[.//text()[contains(., "${DRAFT_TEMPLATE_NAME}")]]` +
      `//*[self::button or self::a][contains(., "Sửa")]`;
    const editBtn = await waitXPath(page, editXPath, 10000);
    if (!editBtn) {
      throw new Error(
        `Không tìm thấy mẫu Nháp "${DRAFT_TEMPLATE_NAME}" trong danh sách để mở Sửa`
      );
    }
    console.log(`[TEST] Mở mẫu Nháp "${DRAFT_TEMPLATE_NAME}" ở chế độ Sửa`);
    await click(page, editBtn);
    // Editor coi như sẵn sàng khi đã có card nhóm VÀ nút Kích hoạt
    await page.waitForFunction(
      () =>
        document.querySelector('div.box.mb-4 input[placeholder="Tên nhóm"]') &&
        document.body.innerText.includes('Kích hoạt'),
      { timeout: 25000, polling: 200 }
    );
    console.log('[TEST] Đã vào trình soạn thảo:', page.url());

    // -----------------------------------------------------------------------
    // Bước 2: Chuẩn hoá tiền điều kiện - đúng 1 nhóm hợp lệ + 1 nhóm rỗng
    // (Kích hoạt thất bại vẫn ghi dữ liệu nháp xuống server nên nhóm rỗng của
    //  lần chạy trước còn sót lại -> phải dọn trước khi test.)
    // -----------------------------------------------------------------------
    let cards = await readGroupCards(page);
    console.log('[TEST] Tiền điều kiện ban đầu:', JSON.stringify(cards));

    if (!cards.some((c) => !c.isEmpty)) {
      throw new Error(
        `Mẫu "${DRAFT_TEMPLATE_NAME}" không còn nhóm nào có tiêu chí - thiếu tiền điều kiện ` +
          '(cần ít nhất 1 nhóm hợp lệ để đối chứng). Vui lòng bổ sung tiêu chí cho mẫu này.'
      );
    }

    if (cards.some((c) => c.isEmpty)) {
      const removed = await removeEmptyGroups(page, click);
      console.log(`[TEST] Dọn ${removed} nhóm rỗng còn sót từ lần chạy trước`);
    }

    console.log('[TEST] Thao tác: Bấm "+ Thêm nhóm" để tạo 1 nhóm rỗng (nhóm có lỗi)');
    const beforeAdd = await countGroups(page);
    const addGroupBtn = await waitXPath(
      page,
      './/*[self::button or self::a][contains(., "Thêm nhóm")]',
      8000
    );
    if (!addGroupBtn) throw new Error('Không tìm thấy nút "+ Thêm nhóm"');
    await click(page, addGroupBtn);
    const added = await waitFor(
      page,
      (n) => document.querySelectorAll('input[placeholder="Tên nhóm"]').length > n,
      beforeAdd.total,
      8000
    );
    if (!added) throw new Error('Bấm "+ Thêm nhóm" nhưng không thấy nhóm mới xuất hiện');

    const nameInputs = await page.$$('input[placeholder="Tên nhóm"]');
    await type(page, nameInputs[nameInputs.length - 1], EMPTY_GROUP_NAME);

    cards = await readGroupCards(page);
    console.log('[TEST] Tiền điều kiện sau chuẩn hoá:', JSON.stringify(cards));
    const validGroupName = cards.find((c) => !c.isEmpty).name;

    // -----------------------------------------------------------------------
    // Bước 3: Bấm "Kích hoạt" -> hệ thống phải chặn
    // -----------------------------------------------------------------------
    console.log('[TEST] Thao tác: Bấm nút "Kích hoạt"');
    const activateBtn = await waitXPath(
      page,
      './/*[self::button or self::a][contains(., "Kích hoạt")]',
      8000
    );
    if (!activateBtn) throw new Error('Không tìm thấy nút "Kích hoạt" trên giao diện');
    await click(page, activateBtn);
    // Chờ hệ thống phản hồi: hoặc chặn (banner lỗi), hoặc kích hoạt xong
    await waitFor(
      page,
      () =>
        document.body.innerText.includes('Không thể kích hoạt do các lỗi sau') ||
        document.body.innerText.includes('chỉ xem'),
      null,
      10000
    );
    await sleep(600); // để Blazor vẽ xong ô lỗi trong từng card nhóm

    const afterActivateText = await page.$eval('body', (b) => b.innerText);
    const blockedCorrectly = afterActivateText.includes('Không thể kích hoạt do các lỗi sau');
    console.log('[TEST] Hệ thống chặn kích hoạt đúng như kỳ vọng:', blockedCorrectly);

    // -----------------------------------------------------------------------
    // Bước 4: Kiểm tra text thô "group.ErrorSummary" trên từng card nhóm
    // -----------------------------------------------------------------------
    cards = await readGroupCards(page);
    console.log('[TEST] Kiểm tra từng nhóm sau khi Kích hoạt:', JSON.stringify(cards));

    const validGroup = cards.find((c) => c.name === validGroupName && !c.isEmpty);
    const validGroupHasRawError = validGroup ? validGroup.hasRawErrorText : null;
    const errorGroupHasRawError = cards.some((c) => c.isEmpty && c.hasRawErrorText);
    const rawErrorAnywhere = afterActivateText.includes('group.ErrorSummary');
    console.log(
      `[TEST] Text thô: nhóm hợp lệ=${validGroupHasRawError}, ` +
        `nhóm lỗi=${errorGroupHasRawError}, toàn trang=${rawErrorAnywhere}`
    );

    // -----------------------------------------------------------------------
    // Bước 5: Verify độc lập - reload xem mẫu còn ở trạng thái Nháp không
    // -----------------------------------------------------------------------
    console.log('[TEST] Verify độc lập: Reload trang kiểm tra trạng thái mẫu...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        document.querySelector('div.box.mb-4 input[placeholder="Tên nhóm"]') &&
        document.body.innerText.includes('Kích hoạt'),
      { timeout: 25000, polling: 200 }
    );
    const afterReloadText = await page.$eval('body', (b) => b.innerText);
    const stillDraft = afterReloadText.includes('Nháp');
    console.log('[TEST] Mẫu vẫn ở trạng thái Nháp:', stillDraft);

    // -----------------------------------------------------------------------
    // Bước 6: Dọn dẹp - xoá nhóm rỗng test vừa tạo, trả mẫu về trạng thái ban đầu
    // -----------------------------------------------------------------------
    try {
      const cleaned = await removeEmptyGroups(page, click);
      const saveBtn = await waitXPath(
        page,
        './/*[self::button or self::a][contains(., "Lưu nháp")]',
        5000
      );
      if (saveBtn) {
        await click(page, saveBtn);
        await sleep(1500); // chờ request lưu nháp đi hết
      }
      console.log(`[TEST] Dọn dẹp: đã xoá ${cleaned} nhóm rỗng và lưu nháp lại`);
    } catch (err) {
      console.warn('[TEST] Dọn dẹp không thành công (bỏ qua):', err.message);
    }

    // -----------------------------------------------------------------------
    // Kết luận
    // -----------------------------------------------------------------------
    const pass =
      blockedCorrectly && validGroupHasRawError === false && stillDraft && !rawErrorAnywhere;

    const resultText = pass
      ? `Tiền điều kiện: mẫu Nháp "${DRAFT_TEMPLATE_NAME}" có 1 nhóm hợp lệ ("${validGroupName}") ` +
        `+ 1 nhóm rỗng ("${EMPTY_GROUP_NAME}"). Bấm Kích hoạt: hệ thống chặn đúng, báo ` +
        '"Nhóm phải có ít nhất một tiêu chí". Không còn dòng text thô "Lỗi: group.ErrorSummary" ' +
        'ở bất kỳ nhóm nào. Reload xác nhận mẫu vẫn ở trạng thái Nháp.'
      : 'BUG còn: sau khi Kích hoạt thất bại, UI vẫn lộ binding expression thô. Chi tiết: ' +
        `hệ thống chặn kích hoạt=${blockedCorrectly}; ` +
        `nhóm hợp lệ ("${validGroupName}") hiện text thô=${validGroupHasRawError}; ` +
        `nhóm rỗng ("${EMPTY_GROUP_NAME}") hiện text thô "Lỗi: group.ErrorSummary"=${errorGroupHasRawError}; ` +
        `text thô xuất hiện trên trang=${rawErrorAnywhere}; mẫu vẫn Nháp=${stillDraft}.`;

    return { pass, resultText };
  },
};
