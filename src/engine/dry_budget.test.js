const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { takeDryBudget } = require('./dry_budget');

const ledgerIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-dry-')), 'aiqc', 'dry-1309.json');

test('không đặt AIQC_DRY_BUDGET / AIQC_DRY_LEDGER → không giới hạn, không ghi sổ', () => {
  const out = takeDryBudget(['1309-AI01'], {});
  assert.deepStrictEqual(out, { budget: null, allowed: ['1309-AI01'], refused: [], counts: {} });
  assert.strictEqual(takeDryBudget(['1309-AI01'], { AIQC_DRY_BUDGET: '0', AIQC_DRY_LEDGER: ledgerIn() }).budget, null);
});

test('đếm theo từng case; tới trần thì từ chối case đó, case khác vẫn chạy', () => {
  const env = { AIQC_DRY_BUDGET: '2', AIQC_DRY_LEDGER: ledgerIn() };
  assert.deepStrictEqual(takeDryBudget(['1309-AI01'], env).allowed, ['1309-AI01']);
  const second = takeDryBudget(['1309-AI01', '1309-AI02'], env);
  assert.deepStrictEqual([second.allowed, second.counts], [['1309-AI01', '1309-AI02'], { '1309-AI01': 2, '1309-AI02': 1 }]);
  const third = takeDryBudget(['1309-AI01', '1309-AI02'], env);
  assert.deepStrictEqual([third.allowed, third.refused], [['1309-AI02'], ['1309-AI01']]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(env.AIQC_DRY_LEDGER, 'utf8')), { '1309-AI01': 2, '1309-AI02': 2 });
});

test('sổ hỏng → đếm lại từ 0 (không chặn nhầm)', () => {
  const env = { AIQC_DRY_BUDGET: '1', AIQC_DRY_LEDGER: ledgerIn() };
  fs.mkdirSync(path.dirname(env.AIQC_DRY_LEDGER), { recursive: true });
  fs.writeFileSync(env.AIQC_DRY_LEDGER, '{hỏng');
  assert.deepStrictEqual(takeDryBudget(['1309-AI01'], env).allowed, ['1309-AI01']);
});

test('refundDryBudget: trả lại lượt cho case chưa kịp chạy kịch bản; không xuống dưới 0; không có sổ thì bỏ qua', () => {
  const { refundDryBudget } = require('./dry_budget');
  const env = { AIQC_DRY_BUDGET: '2', AIQC_DRY_LEDGER: ledgerIn() };
  takeDryBudget(['1309-AI01', '1309-AI02'], env);
  takeDryBudget(['1309-AI01'], env);
  refundDryBudget(['1309-AI01', '1309-AI03'], env);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(env.AIQC_DRY_LEDGER, 'utf8')), { '1309-AI01': 1, '1309-AI02': 1 });
  // lượt đã trả lại dùng được tiếp
  assert.deepStrictEqual(takeDryBudget(['1309-AI01'], env).allowed, ['1309-AI01']);
  refundDryBudget(['1309-AI01'], {});
});
