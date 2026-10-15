// 9301-AI01: dán (Ctrl+V) nội dung vào trường «Mô tả rõ bối cảnh của khách hàng» của công việc quy trình ở Todolist.
const config = require('../../config');
const H = require('../../core/evaluation_helpers');

const TASK_TITLE = 'Nhập thông tin ticket_[9005] - Sửa tiêu đề theo ảnh';
const FIELD_LABEL = 'Mô tả rõ bối cảnh của khách hàng';

module.exports = {
  id: '9301-AI01',
  title: 'Todolist: dán nội dung vào trường «Mô tả rõ bối cảnh của khách hàng» của công việc quy trình',
  targetPath: '/todolist',
  timeoutSec: 150,

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, step } = ctx;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const pasted = `PASTE-QC ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

    await step('B1 dat chuoi vao clipboard (thay Notepad)', async () => {
      try {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(config.TARGET_URL).origin });
      } catch (e) {
        /* bỏ qua nếu context không hỗ trợ */
      }
    });

    await step('B2 mo Todolist, mo cong viec', async () => {
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

    await step('B3 click, Ctrl+A, Delete', async () => {
      await field.scrollIntoViewIfNeeded();
      await field.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await H.sleep(500);
    });

    await step('B4 Ctrl+V', async () => {
      await page.evaluate((t) => navigator.clipboard.writeText(t), pasted);
      await page.keyboard.press('Control+V');
      await H.sleep(3500);
    });

    const actual = await read();
    const focused = await field.evaluate((e) => e === document.activeElement || e.contains(document.activeElement));
    const errText = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.notification.is-danger, .toast-error, .is-danger'))
        .map((e) => (e.innerText || '').trim())
        .filter(Boolean)
        .join(' | ')
    );

    const pass = actual === pasted && focused && !errText;
    return {
      pass,
      resultText: pass
        ? `Đã đưa «${pasted}» vào clipboard, mở công việc «${TASK_TITLE}», xoá nội dung cũ, Ctrl+V. Trường hiển thị đúng «${actual}», con trỏ còn trong trường, không có lỗi.`
        : `Đã đưa «${pasted}» vào clipboard, mở công việc «${TASK_TITLE}», xoá nội dung cũ, Ctrl+V. Mong muốn trường hiển thị đúng «${pasted}», con trỏ còn trong trường, không báo lỗi; thực tế trường hiện «${actual}», con trỏ trong trường=${focused}, thông báo lỗi=«${errText}».`,
    };
  },
};
