const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });

const EMAIL = process.env.FASTDO_EMAIL;
const PASSWORD = process.env.FASTDO_PASSWORD;
const CATBOX_USERHASH = process.env.CATBOX_USERHASH;

if (!EMAIL || !PASSWORD || !CATBOX_USERHASH) {
  throw new Error(
    'Thiếu FASTDO_EMAIL / FASTDO_PASSWORD / CATBOX_USERHASH trong file .env ở root repo. ' +
      'Copy .env.example thành .env rồi điền giá trị thật.'
  );
}

module.exports = {
  CDP_URL: 'http://localhost:9222',
  // Dev tunnel đổi theo thời gian — nguồn thật nằm ở .env (TARGET_URL/SCALE_PAGE_URL),
  // giá trị dưới đây chỉ là fallback khi .env chưa cập nhật.
  TARGET_URL: process.env.TARGET_URL || 'https://lp3svsq4-5112.asse.devtunnels.ms/',
  SCALE_PAGE_URL: process.env.SCALE_PAGE_URL || 'https://lp3svsq4-5112.asse.devtunnels.ms/evaluation?tab=scale',
  EMAIL,
  PASSWORD,
  ORG_NAME: 'Water Quality - NH3T TEAM',
  SHEET_URL: process.env.SHEET_URL || 'https://docs.google.com/spreadsheets/d/1ArYMmaaqbb_g1aa9irROzGXAm1tULQvUw8rq-sXK8Hk/edit',
  SHEET_ID: process.env.SHEET_ID || '1ArYMmaaqbb_g1aa9irROzGXAm1tULQvUw8rq-sXK8Hk',
  SHEET_TAB: process.env.SHEET_TAB || 'fEvaluation - VIBE',
  SHEET_ID_COLUMN: 'A',
  SHEET_RESULT_COLUMN: 'I',
  CATBOX_USERHASH,
};
