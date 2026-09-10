// ============================================================================
// eval_037.test.js: Testcase EVAL_037
// Function: Tự đánh giá (Self Assessment)
// Tiêu đề: Happy: Nhân viên mở phiếu, chấm điểm và Lưu nháp tự đánh giá
//
// Điều kiện (theo Sheet): tài khoản đang đăng nhập có Assignment tự đánh giá
// trong 1 kỳ đang Open (self_review_enabled=true).
// Các bước: B1 mở phiếu từ MyAssignmentList → B2 chấm điểm 1-5 + nhận xét từng
// tiêu chí → B3 bấm "Lưu nháp".
// Kết quả mong muốn: phiếu chuyển từ "Chưa bắt đầu" (NotStarted) sang trạng
// thái khác (Draft); dữ liệu đã chấm còn nguyên sau khi tải lại trang.
//
// Ghi chú phạm vi: Sheet còn nói "còn nguyên sau khi tải lại trang/đăng xuất-
// đăng nhập lại" (mục 3.1.2, 3.1.3) - case này CHỈ kiểm bằng tải lại trang.
// Đăng xuất sẽ làm mất session dùng chung (.auth/user_state.json) của mọi case
// khác trong bộ test; tải lại trang đã đủ chứng minh dữ liệu được lưu ở server
// chứ không phải state tạm phía client.
//
// Fixture: dùng phiếu "DRYRUN040 - Cold Submit Test" (5 bản trùng tên, đúng
// dạng sandbox dùng nhiều lần cho kiểu test "nộp lần đầu"). KHÔNG dùng
// "EVAL_063 - Tu danh gia BAT" vì tên đó gợi ý nó là fixture riêng của case
// EVAL_063, dùng nhầm sẽ phá tiền điều kiện của case đó.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const TARGET_ASSIGNMENT_NAME = 'DRYRUN040';
const SCORE_TO_SET = 3; // "Đạt yêu cầu" - mức trung tính, không quan trọng bằng việc có chấm+lưu đúng

function readProgress(page) {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\/(\d+)\s*tiêu chí đã có điểm/);
    return m ? { done: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
  });
}

function countAssignmentsByName(page, needle) {
  return page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('table.table tbody tr'));
    const matching = rows.filter((r) => r.innerText.includes(n));
    return {
      total: matching.length,
      notStarted: matching.filter((r) => r.innerText.includes('Chưa bắt đầu')).length,
    };
  }, needle);
}

/** Mở phiếu "Chưa bắt đầu" đầu tiên khớp tên. Trả về snapshot số lượng TRƯỚC khi mở. */
async function openFirstNotStartedAssignment(ctx, needle) {
  const { page, click } = ctx;

  const before = await countAssignmentsByName(page, needle);
  if (before.notStarted === 0) {
    throw new Error(
      `Thiếu tiền điều kiện: không còn phiếu "${needle}" nào ở trạng thái "Chưa bắt đầu" ` +
        `(hiện có ${before.total} phiếu cùng tên trong danh sách "Cần làm")`
    );
  }

  const handle = await page.evaluateHandle((n) => {
    const rows = Array.from(document.querySelectorAll('table.table tbody tr'));
    const row = rows.find((r) => r.innerText.includes(n) && r.innerText.includes('Chưa bắt đầu'));
    if (!row) return null;
    return Array.from(row.querySelectorAll('a')).find((a) => a.innerText.trim() === 'Mở') || null;
  }, needle);

  const btn = handle.asElement();
  if (!btn) {
    throw new Error(`Thiếu tiền điều kiện: không tìm thấy nút "Mở" cho phiếu "${needle}" Chưa bắt đầu`);
  }

  await click(page, btn);
  return before;
}

/** Chọn mức điểm + gõ nhận xét cho 1 tiêu chí (0-based groupIndex) */
async function scoreCriterion(ctx, groupIndex, score, note) {
  const { page, click, type } = ctx;

  const radioHandle = await page.evaluateHandle(
    (gi, val) => {
      const groups = Array.from(document.querySelectorAll('div.box.mb-3')).filter((g) =>
        g.querySelector('input[type="radio"]')
      );
      const group = groups[gi];
      if (!group) return null;
      const labels = Array.from(group.querySelectorAll('label'));
      const label = labels[val - 1];
      return label ? label.querySelector('input[type="radio"]') : null;
    },
    groupIndex,
    score
  );

  const radio = radioHandle.asElement();
  if (!radio) throw new Error(`Không tìm thấy radio mức ${score} cho tiêu chí thứ ${groupIndex + 1}`);
  await click(page, radio);

  const textareaHandle = await page.evaluateHandle((gi) => {
    const groups = Array.from(document.querySelectorAll('div.box.mb-3')).filter((g) =>
      g.querySelector('input[type="radio"]')
    );
    const group = groups[gi];
    return group ? group.querySelector('textarea') : null;
  }, groupIndex);

  const textarea = textareaHandle.asElement();
  if (textarea && note) await type(page, textarea, note);
}

/** Đọc lại trạng thái đã chọn của 1 tiêu chí - dùng để verify persistence sau reload */
function readCriterionState(page, groupIndex) {
  return page.evaluate((gi) => {
    const groups = Array.from(document.querySelectorAll('div.box.mb-3')).filter((g) =>
      g.querySelector('input[type="radio"]')
    );
    const group = groups[gi];
    if (!group) return null;
    const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
    const checkedIndex = radios.findIndex((r) => r.checked);
    const textarea = group.querySelector('textarea');
    return {
      score: checkedIndex === -1 ? null : checkedIndex + 1,
      note: textarea ? textarea.value.trim() : '',
    };
  }, groupIndex);
}

function countCriterionGroups(page) {
  return page.evaluate(
    () => Array.from(document.querySelectorAll('div.box.mb-3')).filter((g) => g.querySelector('input[type="radio"]')).length
  );
}

module.exports = {
  id: 'EVAL_037',
  title: 'Happy: Nhân viên mở phiếu, chấm điểm và Lưu nháp tự đánh giá',
  targetPath: '/evaluation/my-assessments',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click, step, dump } = ctx;
    const listUrl = this.getTargetUrl();

    await step('mo danh sach Danh gia cua toi', async () => {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await H.waitFor(page, () => document.body.innerText.includes('Cần làm'), null, 20000);
      await H.dismissPushPopup(page, click);
    });

    const before = await step(`mo phieu "${TARGET_ASSIGNMENT_NAME}" Chua bat dau`, () =>
      openFirstNotStartedAssignment(ctx, TARGET_ASSIGNMENT_NAME)
    );

    // location.href đổi qua client-route Blazor TRƯỚC KHI form kịp render - chỉ
    // chờ URL rồi đọc DOM ngay sẽ ăn race condition (đã bắt được thật: DOM lúc
    // chết có đủ 5 nhóm tiêu chí dù bước này báo "vào được trang chi tiết").
    // Phải chờ chính nội dung cần dùng, không chờ URL làm đại diện cho nó.
    await step('cho vao trang chi tiet phieu (URL + form da render)', async () => {
      const gotUrl = await H.waitFor(page, () => location.href.includes('view=detail'), null, 10000);
      if (!gotUrl) throw new Error('URL không chuyển sang view=detail sau khi bấm "Mở"');
      const gotForm = await H.waitFor(
        page,
        () => document.querySelectorAll('div.box.mb-3 input[type="radio"]').length > 0,
        null,
        10000
      );
      if (!gotForm) throw new Error('URL đã vào view=detail nhưng form chấm điểm không render kịp');
    });

    const detailUrl = page.url();
    const progressBefore = await readProgress(page);
    const totalCriteria = await countCriterionGroups(page);

    if (!totalCriteria) {
      throw new Error('Thiếu tiền điều kiện: phiếu mở ra không có tiêu chí nào để chấm điểm');
    }

    const notes = [];
    await step(`cham diem ${totalCriteria} tieu chi (muc ${SCORE_TO_SET}/5) + nhap nhan xet`, async () => {
      for (let i = 0; i < totalCriteria; i += 1) {
        const note = `Ghi chu tu dong kiem thu EVAL_037 - tieu chi ${i + 1}`;
        notes.push(note);
        await scoreCriterion(ctx, i, SCORE_TO_SET, note);
      }
    });

    const progressAfterScoring = await readProgress(page);
    await dump('sau khi cham diem, truoc khi luu nhap');

    const savedOk = await step('bam Luu nhap', () => H.saveDraft(page, click, ctx.waitXPath));
    await H.sleep(1200);

    const after = await step('quay lai danh sach, doc lai trang thai', async () => {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await H.waitFor(page, () => document.body.innerText.includes('Cần làm'), null, 20000);
      return countAssignmentsByName(page, TARGET_ASSIGNMENT_NAME);
    });

    const statusChanged = after.total === before.total && after.notStarted === before.notStarted - 1;

    const persistCheck = await step('tai lai chinh phieu vua luu, kiem tra du lieu con nguyen', async () => {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await H.waitFor(page, () => /\d+\/\d+\s*tiêu chí đã có điểm/.test(document.body.innerText), null, 15000);

      const progress = await readProgress(page);
      const states = [];
      for (let i = 0; i < totalCriteria; i += 1) states.push(await readCriterionState(page, i));

      const allScoresMatch = states.every((s) => s && s.score === SCORE_TO_SET);
      const allNotesMatch = states.every((s, i) => s && s.note === notes[i]);

      return { progress, allScoresMatch, allNotesMatch };
    });

    const scoredFullyBeforeSave =
      progressBefore &&
      progressAfterScoring &&
      progressBefore.done === 0 &&
      progressAfterScoring.done === progressAfterScoring.total &&
      progressAfterScoring.total === totalCriteria;

    const persistedFullyAfterReload =
      persistCheck.progress &&
      persistCheck.progress.done === totalCriteria &&
      persistCheck.allScoresMatch &&
      persistCheck.allNotesMatch;

    const pass = !!(scoredFullyBeforeSave && savedOk && statusChanged && persistedFullyAfterReload);

    const resultText = pass
      ? `Mở phiếu "${TARGET_ASSIGNMENT_NAME}" (đang "Chưa bắt đầu"), chấm đủ ${totalCriteria}/${totalCriteria} ` +
        `tiêu chí ở mức ${SCORE_TO_SET}/5 kèm nhận xét, bấm "Lưu nháp" thành công. Trong danh sách "Cần làm", ` +
        `số phiếu "${TARGET_ASSIGNMENT_NAME}" ở trạng thái "Chưa bắt đầu" giảm từ ${before.notStarted} xuống ` +
        `${after.notStarted} (tổng số phiếu cùng tên không đổi: ${after.total}) - phiếu đã chuyển sang trạng thái ` +
        `khác. Tải lại đúng phiếu đó: vẫn còn ${persistCheck.progress.done}/${totalCriteria} tiêu chí có điểm, ` +
        `mức điểm và nhận xét của cả ${totalCriteria} tiêu chí khớp đúng dữ liệu đã lưu. ` +
        `(Chỉ kiểm persistence bằng tải lại trang, không đăng xuất/đăng nhập lại - xem ghi chú đầu file.)`
      : `FAIL: chấm đủ trước khi lưu=${scoredFullyBeforeSave} (progressBefore=${JSON.stringify(progressBefore)}, ` +
        `progressAfterScoring=${JSON.stringify(progressAfterScoring)}); bấm Lưu nháp=${savedOk}; ` +
        `chuyển trạng thái trong danh sách=${statusChanged} (trước: ${before.notStarted} Chưa bắt đầu / ` +
        `${before.total} tổng, sau: ${after.notStarted} / ${after.total}); ` +
        `dữ liệu còn nguyên sau tải lại=${persistedFullyAfterReload} ` +
        `(progress=${JSON.stringify(persistCheck.progress)}, điểm khớp=${persistCheck.allScoresMatch}, ` +
        `nhận xét khớp=${persistCheck.allNotesMatch}).`;

    return { pass, resultText };
  },
};
