// ============================================================================
// case_id.js: NGUỒN DUY NHẤT về dạng mã testcase.
//
//   EVAL_017, EVAL_V1_045   case QC của module Đánh giá (Sheet fEvaluation - VIBE)
//   1295-QC01, 1295-AI02    case theo ticket của AI-QC (Sheet testcase tổng, tab = mã ticket)
//
// Mã đi thẳng vào path.join() rồi require(), nên chỉ nhận đúng 2 dạng này — chuỗi tự do là lỗ
// thực thi mã tuỳ ý.
// ============================================================================

const EVAL_ID_RE = /^EVAL_[A-Z0-9_]+$/;
const TICKET_ID_RE = /^(\d{1,10})-(QC|AI)\d{2}$/;

/** Mã đã viết hoa có đúng 1 trong 2 dạng không */
function isCaseId(id) {
  return EVAL_ID_RE.test(id) || TICKET_ID_RE.test(id);
}

/** Mã ticket của case AI-QC ("1295-QC01" → "1295"), null nếu không phải case theo ticket */
function ticketOf(id) {
  const m = TICKET_ID_RE.exec(String(id || '').toUpperCase());
  return m ? m[1] : null;
}

module.exports = { EVAL_ID_RE, TICKET_ID_RE, isCaseId, ticketOf };
