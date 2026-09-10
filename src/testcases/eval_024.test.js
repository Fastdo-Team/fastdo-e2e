// ============================================================================
// eval_024.test.js: Testcase EVAL_024
// Tiêu đề: UI - Sidebar tối đa 3 mục điều hướng theo D-036
//
// Kết quả mong muốn (theo Sheet):
//   Sidebar module chỉ hiển thị tối đa 3 mục điều hướng "Quản lý đánh giá",
//   "Đánh giá của tôi", "Đánh giá tôi phụ trách" - không phát sinh thêm mục nào.
//
// Ghi chú kỹ thuật: sidebar module nằm trong
// section#navbar-overall-need-to-guidelines > nav > ul > li > a.
// Các link "menu" / "push_pin" / tên module ở phía trên nav KHÔNG phải mục điều
// hướng nên phải bám đúng thẻ <nav>, đừng quét cả <section>.
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const EXPECTED_ITEMS = ['Quản lý đánh giá', 'Đánh giá của tôi', 'Đánh giá tôi phụ trách'];

module.exports = {
  id: 'EVAL_024',
  title: 'Sidebar module tối đa 3 mục điều hướng (D-036)',
  targetPath: '/evaluation',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click } = ctx;

    console.log('[TEST] Mở module Đánh giá nhân sự');
    await page.goto(this.getTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await H.waitFor(page, () => document.body.innerText.includes('Kỳ đánh giá'), null, 25000);
    await H.dismissPushPopup(page, click);
    await H.sleep(800);

    console.log('[TEST] Quan sát menu điều hướng bên trái của module');
    const nav = await page.evaluate(() => {
      const section = document.querySelector('#navbar-overall-need-to-guidelines');
      const navEl = section ? section.querySelector('nav') : null;
      if (!navEl) return { found: false, items: [], hrefs: [] };
      const links = Array.from(navEl.querySelectorAll('li a'));
      return {
        found: true,
        items: links.map((a) => (a.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
        hrefs: links.map((a) => a.getAttribute('href')),
      };
    });

    if (!nav.found) {
      throw new Error('Không tìm thấy thẻ <nav> của sidebar module (#navbar-overall-need-to-guidelines)');
    }
    console.log('[TEST] Các mục sidebar đọc được:', JSON.stringify(nav.items));
    console.log('[TEST] href tương ứng:', JSON.stringify(nav.hrefs));

    const withinLimit = nav.items.length <= 3;
    const matchesExpected =
      nav.items.length === EXPECTED_ITEMS.length &&
      EXPECTED_ITEMS.every((expected) => nav.items.some((it) => it.includes(expected)));
    const extras = nav.items.filter((it) => !EXPECTED_ITEMS.some((e) => it.includes(e)));

    console.log(`[TEST] Số mục=${nav.items.length} | trong giới hạn 3=${withinLimit} | khớp danh sách=${matchesExpected}`);

    const pass = withinLimit && matchesExpected;
    const resultText = pass
      ? `Sidebar module hiển thị đúng ${nav.items.length} mục điều hướng: ` +
        `${nav.items.join(', ')} - khớp đúng D-036 (tối đa 3 mục "Quản lý đánh giá", ` +
        '"Đánh giá của tôi", "Đánh giá tôi phụ trách"), không phát sinh mục nào khác.'
      : `FAIL: sidebar có ${nav.items.length} mục (${nav.items.join(', ')}). ` +
        `Trong giới hạn 3 mục=${withinLimit}; khớp đúng danh sách D-036=${matchesExpected}` +
        (extras.length ? `; mục phát sinh ngoài danh sách: ${extras.join(', ')}` : '') +
        '.';

    return { pass, resultText };
  },
};
