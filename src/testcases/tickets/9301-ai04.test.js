// 9301-AI04 (Hồi quy): gõ + dán vào trường «Mô tả rõ bối cảnh của khách hàng» trực tiếp ở module Quy trình.
const config = require('../../config');
const H = require('../../core/evaluation_helpers');

const TASK_TITLE = 'Nhập thông tin ticket_[9005] - Sửa tiêu đề theo ảnh';
const TASK_NAME = '[9005] - Sửa tiêu đề theo ảnh';
const FIELD_LABEL = 'Mô tả rõ bối cảnh của khách hàng';

module.exports = {
  id: '9301-AI04',
  title: 'Quy trình: nhập chữ vào trường văn bản dài «Mô tả rõ bối cảnh của khách hàng» vẫn hoạt động',
  targetPath: '/workflow',
  timeoutSec: 150,

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, step } = ctx;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const typed = `QT-QC ${stamp}`;
    const pasted = `DAN-QC ${stamp}`;

    await step('B1 mo module Quy trinh, mo nhiem vu', async () => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(config.TARGET_URL).origin }).catch(() => {});
      await page.goto(this.getTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('input[placeholder="Tên nhiệm vụ, bước công việc…"]', { timeout: 25000 });
      const deny = page.locator('button:has-text("Từ chối")').first();
      if (await deny.isVisible().catch(() => false)) await deny.click();
      const search = page.locator('input[placeholder="Tên nhiệm vụ, bước công việc…"]');
      await search.click();
      await search.fill(TASK_NAME);
      await search.press('Enter');
      await page.waitForFunction((t) => document.body.innerText.includes(t), TASK_NAME, { timeout: 20000 });
      await page.getByText(TASK_NAME, { exact: false }).first().click();
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
      return { pass: false, resultText: `Đã mở nhiệm vụ «${TASK_TITLE}» ở module Quy trình nhưng không tìm thấy khung nhập của trường «${FIELD_LABEL}».` };
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

    await step('B3 go roi dan', async () => {
      await page.keyboard.type(typed, { delay: 80 });
      await H.sleep(1500);
      await page.evaluate((t) => navigator.clipboard.writeText(t), pasted);
      await page.keyboard.press('Control+V');
      await H.sleep(3500);
    });
    const actual = await read();
    const expected = `${typed}${pasted}`;
    const norm = (s) => s.replace(/\s+/g, '');
    const pass = norm(actual) === norm(expected);

    return {
      pass,
      resultText: pass
        ? `Đã mở nhiệm vụ «${TASK_TITLE}» ở module Quy trình, xoá nội dung cũ, gõ «${typed}» rồi dán «${pasted}». Trường hiển thị đúng «${actual}».`
        : `Đã mở nhiệm vụ «${TASK_TITLE}» ở module Quy trình, xoá nội dung cũ, gõ «${typed}» rồi dán «${pasted}». Mong muốn trường chứa «${typed}» và «${pasted}»; thực tế hiện «${actual}».`,
    };
  },
};
