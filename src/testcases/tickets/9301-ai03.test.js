// 9301-AI03: gõ tiếng Việt có dấu + ký tự đặc biệt vào trường văn bản dài «Mô tả rõ vấn đề khách đang gặp (Pain Point)» ở Todolist.
const config = require('../../config');
const H = require('../../core/evaluation_helpers');

const TASK_TITLE = 'Nhập thông tin ticket_[9005] - Sửa tiêu đề theo ảnh';
const FIELD_LABEL = 'Mô tả rõ vấn đề khách đang gặp';

module.exports = {
  id: '9301-AI03',
  title: 'Todolist: gõ tiếng Việt có dấu và ký tự đặc biệt vào «Mô tả rõ vấn đề khách đang gặp (Pain Point)»',
  targetPath: '/todolist',
  timeoutSec: 150,

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, step } = ctx;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const typed = `Không thể chỉnh sửa & lưu ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())} (ă â ê ô ơ ư đ)`;

    await step('B1 mo Todolist, mo cong viec quy trinh', async () => {
      await page.goto(this.getTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction((t) => document.body.innerText.includes(t), TASK_TITLE, { timeout: 25000 });
      const deny = page.locator('button:has-text("Từ chối")').first();
      if (await deny.isVisible().catch(() => false)) await deny.click();
      await page.getByText(TASK_TITLE, { exact: false }).first().click();
      await page.waitForFunction((l) => document.body.innerText.includes(l), FIELD_LABEL, { timeout: 20000 });
    });

    const fieldHandle = await page.evaluateHandle((label) => {
      const lb = Array.from(document.querySelectorAll('li.column')).find(
        (e) => (e.innerText || '').trim().startsWith(label)
      );
      if (!lb) return null;
      let sib = lb.nextElementSibling;
      while (sib) {
        const f = sib.querySelector('[contenteditable="true"], textarea, .ql-editor, .ProseMirror') || sib.querySelector('input');
        if (f) return f;
        sib = sib.nextElementSibling;
      }
      return null;
    }, FIELD_LABEL);
    const field = fieldHandle.asElement();
    if (!field) {
      return { pass: false, resultText: `Đã mở công việc «${TASK_TITLE}» nhưng không tìm thấy khung nhập của trường «${FIELD_LABEL}».` };
    }

    const read = () =>
      field.evaluate((e) => ('value' in e && typeof e.value === 'string' && e.tagName !== 'DIV' ? e.value : e.innerText || e.textContent || '').replace(/​/g, '').trim());

    await step('B2 click va xoa noi dung cu', async () => {
      await field.scrollIntoViewIfNeeded();
      await field.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await H.sleep(500);
    });
    const afterClear = await read();

    await step('B3 go chuoi tieng Viet', async () => {
      await page.keyboard.type(typed, { delay: 80 });
      await H.sleep(3500); // chờ Blazor đồng bộ lại, nếu có
    });
    const actual = await read();
    const info = await field.evaluate((e) => `${e.tagName}.${e.className}`.slice(0, 80));
    console.log(`[TEST] Khung nhập: ${info}; giá trị sau 3.5s: «${actual}»`);

    const pass = actual === typed;
    return {
      pass,
      resultText: pass
        ? `Đã mở công việc «${TASK_TITLE}», xoá nội dung cũ trong «${FIELD_LABEL}» (còn «${afterClear}»), gõ «${typed}». Trường hiển thị đúng «${actual}».`
        : `Đã mở công việc «${TASK_TITLE}», xoá nội dung cũ trong «${FIELD_LABEL}» (còn «${afterClear}»), gõ «${typed}». Mong muốn trường hiển thị đúng «${typed}»; thực tế hiện «${actual}».`,
    };
  },
};
