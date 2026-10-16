// ============================================================================
// dry_budget.js: trần số lần CHẠY NHÁP mỗi case trong 1 phiên tái hiện AI-QC.
//
//   AIQC_DRY_BUDGET=8  AIQC_DRY_LEDGER=<runs/aiqc/dry-1309-<giờ>.json>   (agent đặt cho phiên Claude tái hiện)
//
// Prompt ghi «tối đa 4 lần» nhưng AI vẫn chạy 12 lần cho 1 case (ticket 1309) — trần phải do engine giữ. Sổ đếm theo mã
// case, mỗi phiên 1 file. Không đặt 2 biến này (QC chạy tay, lần chạy chính thức của agent) → không giới hạn.
// ============================================================================

const fs = require('fs');
const path = require('path');

function readLedger(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Chia các case sắp chạy nháp thành được chạy / hết lượt và ghi sổ (+1 cho mỗi case được chạy).
 * @returns {{budget: number|null, allowed: string[], refused: string[], counts: Object<string, number>}}
 */
function takeDryBudget(caseIds, env = process.env) {
  const budget = Number(env.AIQC_DRY_BUDGET);
  const ledger = String(env.AIQC_DRY_LEDGER || '').trim();
  if (!ledger || !Number.isInteger(budget) || budget < 1) {
    return { budget: null, allowed: caseIds.slice(), refused: [], counts: {} };
  }

  const counts = readLedger(ledger);
  const allowed = [];
  const refused = [];
  for (const id of caseIds) {
    const used = Number(counts[id]) || 0;
    if (used >= budget) {
      refused.push(id);
    } else {
      counts[id] = used + 1;
      allowed.push(id);
    }
  }
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, JSON.stringify(counts, null, 2), 'utf8');
  return { budget, allowed, refused, counts };
}

module.exports = { takeDryBudget };
