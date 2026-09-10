// ============================================================================
// evaluation_helpers.js: Thao tác dùng chung cho các testcase module
// "Đánh giá nhân sự" (Thang điểm / Kho tiêu chí / Mẫu đánh giá).
//
// Gom về 1 chỗ vì mọi case EVAL_* đều lặp lại đúng các bước: đóng popup thông
// báo đẩy, mở danh sách mẫu, vào editor của 1 mẫu Nháp, đọc/sửa nhóm - tiêu chí.
// ============================================================================

const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng; hết hạn thì trả false thay vì ném lỗi */
async function waitFor(page, fn, arg = null, timeout = 8000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Đóng popup "Bật thông báo đẩy".
 * Popup này phủ lên nội dung trang, làm mọi click bên dưới im lặng không tác dụng
 * - đây từng là nguyên nhân khiến các case cũ báo "nút không bấm được".
 */
async function dismissPushPopup(page, click) {
  const found = await waitFor(page, () => document.body.innerText.includes('Bật thông báo đẩy'), null, 2000);
  if (!found) return false;

  const handle = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('a, button')).find(
      (b) => (b.innerText || '').trim() === 'Từ chối'
    ) || null
  );
  const btn = handle.asElement();
  if (!btn) return false;

  await click(page, btn);
  await waitFor(page, () => !document.body.innerText.includes('Bật thông báo đẩy'), null, 4000);
  return true;
}

/** Mở 1 tab của module Đánh giá nhân sự và đợi render xong */
async function openEvaluationTab(page, click, tab = 'template') {
  const url = new URL(`/evaluation?tab=${tab}`, config.TARGET_URL).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => /Tạo (thang điểm|tiêu chí|mẫu đánh giá)/i.test(document.body.innerText),
    { timeout: 25000, polling: 200 }
  );
  await dismissPushPopup(page, click);
  return url;
}

/** Trạng thái hiển thị của mẫu đang mở trong editor */
function readTemplateStatus(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes('chỉ xem')) return 'Đang dùng';
    if (/\bĐang dùng\b/.test(text) && !/\bNháp\b/.test(text)) return 'Đang dùng';
    if (/\bNháp\b/.test(text)) return 'Nháp';
    return 'không rõ';
  });
}

/** Đọc toàn bộ nhóm + tiêu chí + trọng số trên trình soạn thảo */
function readGroupCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    return cards.map((c, index) => ({
      index,
      name: c.querySelector('input[placeholder="Tên nhóm"]').value,
      weight: (c.querySelector('div.field.is-flex input[type="number"]') || {}).value,
      isEmpty: (c.innerText || '').includes('Nhóm chưa có tiêu chí nào'),
      hasRawErrorText: (c.innerText || '').includes('group.ErrorSummary'),
      criteria: Array.from(c.querySelectorAll('tbody tr')).map((r) => ({
        name: ((r.querySelector('td') || {}).innerText || '').trim(),
        weight: (r.querySelector('input[type="number"]') || {}).value,
      })),
    }));
  });
}

/** Lấy element handle của card nhóm thứ `groupIndex` */
function getGroupCardHandle(page, groupIndex) {
  return page.evaluateHandle((i) => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    return cards[i] || null;
  }, groupIndex);
}

/** Mở mẫu Nháp theo tên và đợi trình soạn thảo sẵn sàng */
async function openDraftByName(page, click, waitXPath, templateName) {
  const editXPath =
    `.//tr[.//text()[contains(., "${templateName}")]]` +
    `//*[self::button or self::a][contains(., "Sửa")]`;

  // Thử tối đa 3 lần: popup "Bật thông báo đẩy" có thể hiện ra MUỘN, sau lúc đã
  // dismiss lần đầu. Khi đó nó phủ lên bảng danh sách và cú click vào "Sửa" rơi
  // trúng lớp phủ - không có lỗi nào được ném ra, chỉ là editor không bao giờ mở.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await dismissPushPopup(page, click);

    const editBtn = await waitXPath(page, editXPath, 10000);
    if (!editBtn) {
      throw new Error(`Không tìm thấy mẫu Nháp "${templateName}" trong danh sách để mở Sửa`);
    }
    await click(page, editBtn);

    const ok = await waitFor(
      page,
      () =>
        document.querySelector('div.box.mb-4 input[placeholder="Tên nhóm"]') &&
        document.body.innerText.includes('Kích hoạt'),
      null,
      attempt === 1 ? 12000 : 20000
    );
    if (ok) {
      await sleep(500);
      return page.url();
    }

    console.warn(
      `[HELPER] Lần ${attempt}: bấm "Sửa" của "${templateName}" nhưng trình soạn thảo chưa mở, thử lại...`
    );
    // Về lại danh sách rồi thử lại từ đầu
    await page.goto(new URL('/evaluation?tab=template', config.TARGET_URL).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitFor(page, () => document.body.innerText.includes('Tạo mẫu đánh giá'), null, 25000);
  }

  throw new Error(
    `Bấm "Sửa" của "${templateName}" 3 lần nhưng trình soạn thảo không render ` +
      '(kiểm tra popup che nút, hoặc mẫu lỗi dữ liệu)'
  );
}

/** Gán giá trị cho 1 ô input (xoá sạch giá trị cũ trước khi gõ) */
async function setInputValue(page, elementHandle, value) {
  await elementHandle.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(String(value), { delay: 20 });
  await page.keyboard.press('Tab');
  await sleep(400);
}

/** Đặt Trọng số nhóm cho nhóm thứ `groupIndex` */
async function setGroupWeight(page, groupIndex, value) {
  const handle = await page.evaluateHandle((i) => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    const card = cards[i];
    return card ? card.querySelector('div.field.is-flex input[type="number"]') : null;
  }, groupIndex);

  const input = handle.asElement();
  if (!input) throw new Error(`Không tìm thấy ô "Trọng số nhóm" của nhóm thứ ${groupIndex + 1}`);
  await setInputValue(page, input, value);
}

/** Đặt Trọng số cho dòng tiêu chí thứ `rowIndex` trong nhóm thứ `groupIndex` */
async function setCriterionWeight(page, groupIndex, rowIndex, value) {
  const handle = await page.evaluateHandle(
    (i, j) => {
      const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
        c.querySelector('input[placeholder="Tên nhóm"]')
      );
      const card = cards[i];
      if (!card) return null;
      const row = card.querySelectorAll('tbody tr')[j];
      return row ? row.querySelector('input[type="number"]') : null;
    },
    groupIndex,
    rowIndex
  );

  const input = handle.asElement();
  if (!input) throw new Error(`Không tìm thấy ô trọng số tiêu chí [${groupIndex}][${rowIndex}]`);
  await setInputValue(page, input, value);
}

/** Đặt tên cho nhóm thứ `groupIndex` */
async function setGroupName(page, groupIndex, name) {
  const handle = await page.evaluateHandle((i) => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    return cards[i] ? cards[i].querySelector('input[placeholder="Tên nhóm"]') : null;
  }, groupIndex);

  const input = handle.asElement();
  if (!input) throw new Error(`Không tìm thấy ô "Tên nhóm" của nhóm thứ ${groupIndex + 1}`);
  await setInputValue(page, input, name);
}

/**
 * Mở modal "Chọn tiêu chí" của nhóm thứ `groupIndex`, trả về danh sách tiêu chí
 * đang được phép chọn. Dùng cho EVAL_020 (kiểm tra modal có loại trừ tiêu chí
 * đã có trong nhóm hay không).
 */
async function openCriterionPicker(page, click, groupIndex) {
  const handle = await page.evaluateHandle((i) => {
    const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
      c.querySelector('input[placeholder="Tên nhóm"]')
    );
    const card = cards[i];
    if (!card) return null;
    return (
      Array.from(card.querySelectorAll('a, button')).find((b) =>
        (b.innerText || '').includes('Thêm tiêu chí')
      ) || null
    );
  }, groupIndex);

  const btn = handle.asElement();
  if (!btn) throw new Error(`Không tìm thấy nút "+ Thêm tiêu chí" của nhóm thứ ${groupIndex + 1}`);

  await click(page, btn);
  const opened = await waitFor(page, () => document.body.innerText.includes('Chọn tiêu chí'), null, 8000);
  if (!opened) throw new Error('Bấm "+ Thêm tiêu chí" nhưng modal "Chọn tiêu chí" không mở');
  await sleep(300);

  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal-card-body a.panel-block')).map((a) =>
      (a.innerText || '').trim()
    )
  );
}

/** Đóng modal "Chọn tiêu chí" bằng nút Hủy */
async function closeCriterionPicker(page, click) {
  const handle = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('.modal-card-foot a, .modal-card-foot button')).find(
      (b) => (b.innerText || '').trim() === 'Hủy'
    ) || null
  );
  const btn = handle.asElement();
  if (btn) await click(page, btn);
  await waitFor(page, () => !document.body.innerText.includes('Chọn tiêu chí'), null, 5000);
}

/**
 * Thêm 1 tiêu chí vào nhóm. `criterionName` bỏ trống thì lấy mục đầu tiên có sẵn.
 * Trả về tên tiêu chí đã chọn.
 */
async function addCriterion(page, click, groupIndex, criterionName = null) {
  const options = await openCriterionPicker(page, click, groupIndex);
  if (options.length === 0) {
    await closeCriterionPicker(page, click);
    throw new Error('Modal "Chọn tiêu chí" không còn tiêu chí nào để thêm');
  }

  const picked = criterionName && options.includes(criterionName) ? criterionName : options[0];
  const handle = await page.evaluateHandle(
    (name) =>
      Array.from(document.querySelectorAll('.modal-card-body a.panel-block')).find(
        (a) => (a.innerText || '').trim() === name
      ) || null,
    picked
  );
  const item = handle.asElement();
  if (!item) {
    await closeCriterionPicker(page, click);
    throw new Error(`Không tìm thấy tiêu chí "${picked}" trong modal`);
  }

  await click(page, item);
  await waitFor(page, () => !document.body.innerText.includes('Chọn tiêu chí'), null, 8000);
  await sleep(500);
  return picked;
}

/**
 * Xoá toàn bộ nhóm rỗng, trả về số nhóm đã xoá.
 * Phải xoá từng nhóm một bằng click chuột thật: Blazor render lại cả danh sách sau
 * mỗi lần xoá nên bắn nhiều click trong 1 lượt evaluate thì click sau rơi vào node
 * đã bị gỡ khỏi DOM.
 */
async function removeEmptyGroups(page, click) {
  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const before = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
          c.querySelector('input[placeholder="Tên nhóm"]')
        ).length
    );
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
    await waitFor(
      page,
      (n) =>
        Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
          c.querySelector('input[placeholder="Tên nhóm"]')
        ).length < n,
      before,
      5000
    );
    removed++;
  }
  return removed;
}

/**
 * Xoá các dòng tiêu chí theo tên khỏi mọi nhóm. Trả về số dòng đã xoá.
 * Dùng để dọn tiêu chí đã Ngừng dùng - chúng chặn kích hoạt với lỗi "Tiêu chí
 * không tồn tại hoặc đã ngừng sử dụng", che mất rule thật mà case đang muốn test.
 */
async function removeCriterionRowsByName(page, click, names) {
  let removed = 0;
  for (const name of names) {
    for (let guard = 0; guard < 5; guard++) {
      const handle = await page.evaluateHandle((n) => {
        const cards = Array.from(document.querySelectorAll('div.box.mb-4')).filter((c) =>
          c.querySelector('input[placeholder="Tên nhóm"]')
        );
        for (const card of cards) {
          const row = Array.from(card.querySelectorAll('tbody tr')).find(
            (r) => ((r.querySelector('td') || {}).innerText || '').trim() === n
          );
          if (row) {
            return (
              Array.from(row.querySelectorAll('a, button')).find(
                (b) => (b.innerText || '').trim() === 'Xóa'
              ) || null
            );
          }
        }
        return null;
      }, name);

      const btn = handle.asElement();
      if (!btn) break;
      await click(page, btn);
      await sleep(900);
      removed++;
    }
  }
  return removed;
}

/**
 * Trích tên các tiêu chí bị báo "không tồn tại hoặc đã ngừng sử dụng" từ banner lỗi.
 * Dòng lỗi có dạng: "<Nhóm> — <Tên tiêu chí>: Tiêu chí không tồn tại hoặc đã ngừng sử dụng."
 */
function extractRetiredCriterionNames(bodyText) {
  return extractActivationErrors(bodyText)
    .filter((line) => /Tiêu chí không tồn tại hoặc đã ngừng sử dụng/i.test(line))
    .map((line) => {
      const withoutGroup = line.includes('—') ? line.split('—').slice(1).join('—') : line;
      return withoutGroup.split(':')[0].trim();
    })
    .filter(Boolean);
}

/** Bấm "Kích hoạt" rồi chờ hệ thống phản hồi (chặn hoặc kích hoạt xong) */
async function clickActivate(page, click, waitXPath) {
  const btn = await waitXPath(page, './/*[self::button or self::a][contains(., "Kích hoạt")]', 8000);
  if (!btn) throw new Error('Không tìm thấy nút "Kích hoạt" trên giao diện');

  await click(page, btn);
  await waitFor(
    page,
    () =>
      document.body.innerText.includes('Không thể kích hoạt do các lỗi sau') ||
      document.body.innerText.includes('chỉ xem') ||
      !document.body.innerText.includes('Kích hoạt'),
    null,
    12000
  );
  await sleep(800); // để Blazor vẽ xong banner lỗi / banner chỉ xem

  const bodyText = await page.$eval('body', (b) => b.innerText);
  return {
    bodyText,
    blocked: bodyText.includes('Không thể kích hoạt do các lỗi sau'),
    activated: bodyText.includes('chỉ xem'),
  };
}

/**
 * Trích các dòng lỗi ngay dưới banner "Không thể kích hoạt do các lỗi sau:".
 * Cắt theo dòng thay vì lấy N ký tự, nếu không sẽ dính cả nhãn của form phía dưới
 * ("Tên *", "Mô tả", "Trọng số nhóm"...) vào mô tả kết quả ghi lên Sheet.
 */
function extractActivationErrors(bodyText) {
  const marker = 'Không thể kích hoạt do các lỗi sau:';
  const at = bodyText.indexOf(marker);
  if (at === -1) return [];

  const lines = bodyText.slice(at + marker.length).split('\n');
  const errors = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (errors.length > 0) break;
      continue;
    }
    // Hết khối lỗi khi chạm vào nhãn đầu tiên của form bên dưới
    if (/^(Tên \*|Mô tả|Ngưỡng đạt|Trọng số nhóm|Xóa nhóm|Lỗi:)/.test(line)) break;
    errors.push(line);
    if (errors.length >= 6) break;
  }
  return errors;
}

/** Bấm "Lưu nháp" */
async function saveDraft(page, click, waitXPath) {
  const btn = await waitXPath(page, './/*[self::button or self::a][contains(., "Lưu nháp")]', 5000);
  if (!btn) return false;
  await click(page, btn);
  await sleep(1500);
  return true;
}

module.exports = {
  sleep,
  waitFor,
  dismissPushPopup,
  openEvaluationTab,
  openDraftByName,
  readTemplateStatus,
  readGroupCards,
  getGroupCardHandle,
  setInputValue,
  setGroupName,
  setGroupWeight,
  setCriterionWeight,
  openCriterionPicker,
  closeCriterionPicker,
  addCriterion,
  removeEmptyGroups,
  clickActivate,
  extractActivationErrors,
  extractRetiredCriterionNames,
  removeCriterionRowsByName,
  saveDraft,
};
