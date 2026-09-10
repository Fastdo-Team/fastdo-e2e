const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = process.env.FASTDO_EMAIL;
const PASSWORD = process.env.FASTDO_PASSWORD;
const CATBOX_USERHASH = process.env.CATBOX_USERHASH;

if (!EMAIL || !PASSWORD || !CATBOX_USERHASH) {
  console.warn(
    '[WARN] Thiếu FASTDO_EMAIL / FASTDO_PASSWORD / CATBOX_USERHASH trong file .env ở root repo. ' +
      'Vui lòng kiểm tra lại file .env.'
  );
}

module.exports = {
  // Đường dẫn
  ROOT_DIR: path.join(__dirname, '..'),
  AUTH_DIR: path.join(__dirname, '..', '.auth'),
  AUTH_STATE_PATH: path.join(__dirname, '..', '.auth', 'user_state.json'),
  VIDEOS_DIR: path.join(__dirname, '..', 'videos'),

  // Chrome & Target
  CDP_URL: process.env.CDP_URL || 'http://localhost:9222',
  TARGET_URL: process.env.TARGET_URL || 'https://lp3svsq4-5112.asse.devtunnels.ms/',
  SCALE_PAGE_URL: process.env.SCALE_PAGE_URL || 'https://lp3svsq4-5112.asse.devtunnels.ms/evaluation?tab=scale',
  ORG_NAME: process.env.ORG_NAME || 'Water Quality - NH3T TEAM',

  // Thông tin đăng nhập
  EMAIL,
  PASSWORD,

  // Google Sheet
  SHEET_URL: process.env.SHEET_URL || 'https://docs.google.com/spreadsheets/d/1ArYMmaaqbb_g1aa9irROzGXAm1tULQvUw8rq-sXK8Hk/edit',
  SHEET_ID: process.env.SHEET_ID || '1ArYMmaaqbb_g1aa9irROzGXAm1tULQvUw8rq-sXK8Hk',
  SHEET_TAB: process.env.SHEET_TAB || 'fEvaluation - VIBE',
  SHEET_ID_COLUMN: 'A',
  SHEET_RESULT_COLUMN: 'I', // Mặc định Lần 1

  // Catbox
  CATBOX_USERHASH,

  // Video recording options
  // fps là đòn bẩy tốc độ lớn nhất của cả lần chạy: mỗi khung hình là 1 lần
  // screencast qua CDP nên page chạy chậm hẳn khi fps cao. 15fps vẫn đủ mượt để
  // xem lại thao tác QA. Chỉnh bằng RECORD_FPS trong .env nếu cần nét hơn.
  RECORDER_CONFIG: {
    followNewTab: false,
    fps: parseInt(process.env.RECORD_FPS, 10) || 15,
    videoFrame: { width: 1280, height: 720 },
    videoCrf: 18,
    videoCodec: 'libx264',
    videoPreset: 'ultrafast',
    videoBitrate: 1500,
    autopad: { color: 'black' },
    aspectRatio: '16:9',
  }
};
