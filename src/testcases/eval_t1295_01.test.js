// ============================================================================
// eval_t1295_01.test.js: Testcase EVAL_T1295_01 (ticket [1295])
// Luồng chuẩn: gõ chữ vào trường văn bản dài (Quill) của công việc quy trình
// mở từ Todolist. Gõ từng phím, đọc lại và so khớp CHÍNH XÁC.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const TASK_NAME = 'Nhập thông tin ticket_[9005] - Sửa tiêu đề theo ảnh';
const FIELD_LABEL = 'Mô tả rõ bối cảnh của khách hàng';

module.exports = {
  id: 'EVAL_T1295_01',
  title: 'Luồng chuẩn: Gõ chữ vào trường văn bản dài của công việc quy trình mở từ Todolist',
  targetPath: '/todolist',
  timeoutSec: 150,

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click, waitXPath, step } = ctx;
    const run = (name, fn) => (step ? step(name, fn) : fn());

    await run('B1 vao Todolist tab Danh sach', async () => {
      await page.goto(this.getTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await H.waitFor(page, (n) => document.body.innerText.includes(n), TASK_NAME, 25000);
      await H.dismissPushPopup(page, click);
    });

    await run('B2 mo cong viec', async () => {
      const title = page.getByText(TASK_NAME, { exact: true }).first();
      await title.scrollIntoViewIfNeeded();
      await title.click();
      let opened = await H.waitFor(page, (l) => document.body.innerText.includes(l), FIELD_LABEL, 8000);
      if (!opened) {
        // Thử bấm vào thẻ công việc (tổ tiên gần nhất chứa tiêu đề + "Quy trình")
        const card = page.locator('xpath=(//*[contains(normalize-space(.), "Quy trình")][.//text()[normalize-space()="' + TASK_NAME + '"]])[last()]');
        await card.click({ position: { x: 20, y: 10 } });
        opened = await H.waitFor(page, (l) => document.body.innerText.includes(l), FIELD_LABEL, 15000);
      }
      await H.sleep(800);
    });

    // Tìm đúng khung soạn thảo thuộc trường FIELD_LABEL
    const markField = () =>
      page.evaluate((label) => {
        document.querySelectorAll('[data-ai-qc-field]').forEach((e) => e.removeAttribute('data-ai-qc-field'));
        // Nhãn = phần tử nhỏ nhất chứa chữ nhãn; khung của trường = .ql-editor đầu tiên đứng sau nhãn
        const labels = Array.from(document.querySelectorAll('body *')).filter(
          (e) => (e.innerText || '').includes(label) && !Array.from(e.children).some((c) => (c.innerText || '').includes(label))
        );
        const editors = Array.from(document.querySelectorAll('.ql-editor'));
        for (const lb of labels) {
          const ed = editors.find((e) => lb.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (ed) {
            ed.setAttribute('data-ai-qc-field', '1');
            return true;
          }
        }
        return false;
      }, FIELD_LABEL);

    await run('B3 bam vao truong va xoa het noi dung cu', async () => {
      if (!(await markField())) {
        const info = await page.evaluate((label) => {
          const body = document.body.innerText;
          const i = body.indexOf('Mẫu công việc');
          return {
            editors: document.querySelectorAll('.ql-editor').length,
            hasLabel: body.includes(label),
            hasTemplate: i >= 0,
            url: location.href,
            snippet: body.slice(Math.max(0, i), Math.max(0, i) + 400),
            dialog: Array.from(document.querySelectorAll('[role=dialog], .modal, .is-active'))
              .map((e) => (e.innerText || '').slice(0, 300))
              .slice(0, 3),
          };
        }, FIELD_LABEL);
        throw new Error(`Không tìm thấy khung soạn thảo của trường "${FIELD_LABEL}" ${JSON.stringify(info)}`);
      }
      await page.locator('[data-ai-qc-field="1"]').scrollIntoViewIfNeeded();
      await page.locator('[data-ai-qc-field="1"]').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await H.sleep(300);
    });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const typed = `AI-QC ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    await run('B4 go tung phim', async () => {
      await page.keyboard.type(typed, { delay: 80 });
      await H.sleep(800);
    });

    const shown = await page.evaluate(() => {
      const ed = document.querySelector('[data-ai-qc-field="1"]');
      return ed ? ed.innerText.replace(/\n$/, '') : null;
    });

    const state = await page.evaluate(() => {
      const ed = document.querySelector('[data-ai-qc-field="1"]');
      return {
        focused: !!ed && (ed === document.activeElement || ed.contains(document.activeElement)),
        editable: ed ? ed.getAttribute('contenteditable') : null,
        inModal: !!(ed && ed.closest('.modal-card')),
        editors: document.querySelectorAll('.ql-editor').length,
      };
    });
    console.log('[TEST] Trạng thái khung sau khi gõ:', JSON.stringify(state));

    const pass = shown === typed;
    const resultText = pass
      ? `Gõ từng phím «${typed}» vào trường «${FIELD_LABEL}»; trường hiển thị đúng «${shown}».`
      : `Gõ từng phím «${typed}» vào trường «${FIELD_LABEL}» nhưng trường hiện «${shown}» (khác chuỗi đã gõ). ` +
        `Trạng thái khung: có focus=${state.focused}, contenteditable=${state.editable}, nằm trong modal chi tiết=${state.inModal}.`;
    return { pass, resultText };
  },
};
