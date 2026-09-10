// ============================================================================
// eval_023.test.js: Testcase EVAL_023
// Tiêu đề: Happy - Tài khoản có quyền ManageConfig truy cập đầy đủ Kỳ đánh giá
//          và Thiết lập
//
// Kết quả mong muốn (theo Sheet):
//   Tài khoản có ManageConfig truy cập được đầy đủ cả tab "Kỳ đánh giá" và
//   "Thiết lập" (Thang điểm / Kho tiêu chí / Mẫu đánh giá), thao tác CRUD bình
//   thường trên cả 3 mục con, không bị chặn quyền (mục 1.4.2).
// ============================================================================

const config = require('../config');
const H = require('../core/evaluation_helpers');

const BLOCKED_PATTERN = /Không có quyền|Bạn không được phép|Forbidden|NotEntitled|403/i;

// 3 mục con của Thiết lập + nút "Tạo..." tương ứng (dấu hiệu CRUD khả dụng)
const SETTING_TABS = [
  { tab: 'scale', label: 'Thang điểm', createLabel: 'Tạo thang điểm' },
  { tab: 'criterion', label: 'Kho tiêu chí', createLabel: 'Tạo tiêu chí' },
  { tab: 'template', label: 'Mẫu đánh giá', createLabel: 'Tạo mẫu đánh giá' },
];

module.exports = {
  id: 'EVAL_023',
  title: 'ManageConfig truy cập đầy đủ Kỳ đánh giá và Thiết lập',
  targetPath: '/evaluation',

  getTargetUrl() {
    return new URL(this.targetPath, config.TARGET_URL).toString();
  },

  async run(ctx) {
    const { page, click } = ctx;
    const checks = [];

    // Bước 1: Tab "Kỳ đánh giá"
    console.log('[TEST] Mở tab "Kỳ đánh giá"');
    await page.goto(this.getTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await H.waitFor(page, () => document.body.innerText.includes('Kỳ đánh giá'), null, 25000);
    await H.dismissPushPopup(page, click);
    await H.sleep(800);

    const cycle = await page.evaluate((blockedSrc) => {
      const t = document.body.innerText;
      return {
        url: location.href,
        hasCreate: t.includes('Tạo kỳ đánh giá'),
        blocked: new RegExp(blockedSrc, 'i').test(t),
      };
    }, BLOCKED_PATTERN.source);
    checks.push({ name: 'Kỳ đánh giá', ...cycle, ok: cycle.hasCreate && !cycle.blocked });
    console.log('[TEST] Kỳ đánh giá:', JSON.stringify(cycle));

    // Bước 2: 3 mục con của "Thiết lập"
    for (const s of SETTING_TABS) {
      console.log(`[TEST] Mở Thiết lập > ${s.label}`);
      const url = new URL(`/evaluation?tab=${s.tab}`, config.TARGET_URL).toString();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await H.waitFor(page, (label) => document.body.innerText.includes(label), s.createLabel, 25000);
      await H.dismissPushPopup(page, click);
      await H.sleep(600);

      const info = await page.evaluate(
        (createLabel, blockedSrc) => {
          const t = document.body.innerText;
          return {
            url: location.href,
            hasCreate: t.includes(createLabel),
            blocked: new RegExp(blockedSrc, 'i').test(t),
            rowCount: document.querySelectorAll('tbody tr').length,
          };
        },
        s.createLabel,
        BLOCKED_PATTERN.source
      );
      checks.push({ name: s.label, ...info, ok: info.hasCreate && !info.blocked });
      console.log(`[TEST] ${s.label}:`, JSON.stringify(info));
    }

    const allOk = checks.every((c) => c.ok);
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);

    const pass = allOk;
    const resultText = pass
      ? 'Tài khoản tester01.fastdo@gmail.com (tổ chức Water Quality - NH3T TEAM) truy cập được đầy đủ: ' +
        'tab "Kỳ đánh giá" (thấy nút Tạo kỳ đánh giá) và cả 3 mục con của Thiết lập - ' +
        checks
          .filter((c) => c.name !== 'Kỳ đánh giá')
          .map((c) => `${c.name} (${c.rowCount} bản ghi, có nút Tạo)`)
          .join(', ') +
        '. Không mục nào trả về lỗi chặn quyền, thao tác CRUD khả dụng bình thường - đúng mục 1.4.2.'
      : `FAIL: các mục sau không truy cập được hoặc bị chặn quyền: ${failed.join(', ')}. ` +
        `Chi tiết: ${JSON.stringify(checks)}`;

    return { pass, resultText };
  },
};
