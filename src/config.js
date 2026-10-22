const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Slot tài khoản — để 2 QC (hoặc 1 QC 2 tài khoản) chạy song song trên cùng máy.
//
//   npm test -- EVAL_021 --round=3              → slot 1 (mặc định)
//   npm test -- EVAL_022 --account=2 --round=3  → slot 2
//
// Đọc slot ngay tại config thay vì bắt từng CLI tự xử: mọi tool (runner, plan,
// probe, preflight, case) đều require config nên cùng lúc có được khả năng này,
// và không tool nào có cơ hội hiểu slot khác nhau.
//
// Mỗi slot phải tách RIÊNG 4 thứ, thiếu 1 cái là 2 lần chạy dẫm lên nhau:
//   - tài khoản đăng nhập   (FASTDO_EMAIL_2 / FASTDO_PASSWORD_2)
//   - file session          (.auth/user_state_2.json)
//   - cổng CDP              (9223 thay vì 9222 — nếu không, lần chạy thứ hai sẽ
//                            NỐI vào Chrome của lần thứ nhất và phá tab của nó)
//   - profile Chrome        (.chrome_profile_2 — Chrome không mở 2 tiến trình
//                            trên cùng một user-data-dir)
//
// Những thứ DÙNG CHUNG vì bản chất là một: TARGET_URL (cùng tunnel), SHEET_ID
// (cùng Sheet), DRIVE_* (cùng nơi lưu video).
// ---------------------------------------------------------------------------
function resolveAccountSlot() {
  const fromArgv = process.argv.find((a) => a.startsWith('--account='));
  const raw = fromArgv ? fromArgv.split('=')[1] : process.env.FASTDO_ACCOUNT;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

const ACCOUNT = resolveAccountSlot();
// Slot 1 giữ nguyên tên biến cũ để .env và .auth hiện có không phải sửa gì.
const SUFFIX = ACCOUNT === 1 ? '' : `_${ACCOUNT}`;

/** Biến của slot hiện tại, có fallback về biến không hậu tố */
function slotEnv(name, { fallback = false } = {}) {
  const value = process.env[`${name}${SUFFIX}`];
  if (value) return value;
  return fallback ? process.env[name] : undefined;
}

const EMAIL = slotEnv('FASTDO_EMAIL');
const PASSWORD = slotEnv('FASTDO_PASSWORD');
// Catbox chết server 2026-10-22 — video nay lên Google Drive (core/drive.js). Biến cũ chỉ còn cho core/catbox.js.
const CATBOX_USERHASH = process.env.CATBOX_USERHASH;
// Google Drive lưu video: OAuth client Desktop + refresh token của 1 tài khoản Gmail (npm run drive:auth ghi sẵn cả 4 biến).
// Thư mục trống = gốc My Drive.
const DRIVE_CLIENT_ID = (process.env.DRIVE_CLIENT_ID || '').trim();
const DRIVE_CLIENT_SECRET = (process.env.DRIVE_CLIENT_SECRET || '').trim();
const DRIVE_REFRESH_TOKEN = (process.env.DRIVE_REFRESH_TOKEN || '').trim();
const DRIVE_FOLDER_ID = (process.env.DRIVE_FOLDER_ID || '').trim();

// Ba biến dưới đây quyết định GHI VÀO ĐÂU, nên tuyệt đối không có giá trị mặc
// định. Bản cũ để sẵn URL tunnel và SHEET_ID thật trong code: .env mất SHEET_ID
// vẫn qua được bước kiểm "đủ biến" rồi ghi thẳng vào Sheet mặc định — ghi nhầm
// Sheet mà không ai biết. Thiếu thì phải dừng, không được đoán.
const TARGET_URL = process.env.TARGET_URL || '';
const SHEET_ID = process.env.SHEET_ID || '';
const SHEET_TAB = process.env.SHEET_TAB || '';
// Engine v2 — Google Sheets API. Tab chọn theo SHEET_GID (số sau "gid=" trên link
// Sheet): không phụ thuộc tên tab, dấu cách cuối tên hay thứ tự tab. Chỉ có SHEET_TAB
// thì tên phải khớp CHÍNH XÁC (src/sheets/tab.js) — không còn lùi về tab đầu như gviz.
const SHEET_GID = (process.env.SHEET_GID || '').trim();
// File JSON key của service account. Đường dẫn tương đối tính từ gốc repo.
const GOOGLE_SA_KEY_FILE = (process.env.GOOGLE_SA_KEY_FILE || '').trim()
  ? path.resolve(ROOT_DIR, process.env.GOOGLE_SA_KEY_FILE.trim())
  : '';

// Tên biến bắt buộc, đã gắn hậu tố slot để thông điệp lỗi chỉ đúng dòng cần sửa
const REQUIRED_ENV = [
  [`FASTDO_EMAIL${SUFFIX}`, EMAIL],
  [`FASTDO_PASSWORD${SUFFIX}`, PASSWORD],
  ['DRIVE_CLIENT_ID', DRIVE_CLIENT_ID],
  ['DRIVE_CLIENT_SECRET', DRIVE_CLIENT_SECRET],
  ['DRIVE_REFRESH_TOKEN', DRIVE_REFRESH_TOKEN],
  ['TARGET_URL', TARGET_URL],
  ['SHEET_ID', SHEET_ID],
  // Một trong hai là đủ; có cả hai thì SHEET_GID thắng.
  ['SHEET_GID (hoặc SHEET_TAB)', SHEET_GID || SHEET_TAB],
  ['GOOGLE_SA_KEY_FILE', GOOGLE_SA_KEY_FILE],
];

/** Tên các biến bắt buộc còn thiếu (rỗng = đủ) */
function missingRequired() {
  return REQUIRED_ENV.filter(([, value]) => !value).map(([name]) => name);
}

/**
 * Dừng ngay nếu thiếu biến bắt buộc. Gọi ở đầu mỗi lệnh CÓ HÀNH ĐỘNG (runner),
 * không gọi lúc nạp module: `plan`/`preflight` cần nạp được config để còn báo
 * cáo tử tế xem thiếu cái gì.
 *
 * Trước đây thiếu biến chỉ console.warn rồi chạy tiếp, nên lỗi nổ muộn — sau khi
 * đã quay xong video, hoặc gõ chuỗi "undefined" vào ô mật khẩu.
 */
/**
 * Giá trị CÓ nhưng SAI — khác với "thiếu", nên tách riêng để plan/preflight báo đúng.
 */
function invalidConfig() {
  const out = [];
  if (SHEET_GID && !/^\d+$/.test(SHEET_GID)) {
    out.push(`SHEET_GID="${SHEET_GID}" phải là số (số sau "gid=" trên link Sheet)`);
  }
  if (GOOGLE_SA_KEY_FILE && !fs.existsSync(GOOGLE_SA_KEY_FILE)) {
    out.push(`GOOGLE_SA_KEY_FILE trỏ tới file không tồn tại: ${GOOGLE_SA_KEY_FILE}`);
  }
  try {
    // Nạp muộn: env_label.js là hàm thuần, không phụ thuộc ngược lại config.
    require('./sheets/env_label').parseEnvLabels(process.env.ENV_LABELS);
  } catch (err) {
    out.push(err.message);
  }
  return out;
}

function assertReady() {
  const missing = missingRequired();
  const invalid = invalidConfig();
  if (!missing.length && !invalid.length) return;
  const parts = [];
  if (missing.length) parts.push(`Thiếu biến bắt buộc trong .env: ${missing.join(', ')}.`);
  if (invalid.length) parts.push(`Cấu hình sai: ${invalid.join('; ')}.`);
  const err = new Error(`${parts.join(' ')} Xem .env.example rồi sửa trước khi chạy.`);
  err.code = 'CONFIG_INCOMPLETE';
  throw err;
}

// Cổng CDP của slot: 9222, 9223, 9224... CDP_URL đặt tay chỉ còn hiệu lực cho
// slot 1, để không ai vô tình trỏ cả 2 slot vào cùng một Chrome.
const CDP_BASE_PORT = parseInt(process.env.CDP_PORT, 10) || 9222;
const CDP_PORT = CDP_BASE_PORT + (ACCOUNT - 1);

module.exports = {
  // Kiểm tra cấu hình
  REQUIRED_ENV: REQUIRED_ENV.map(([name]) => name),
  missingRequired,
  assertReady,
  invalidConfig,

  // Slot tài khoản đang chạy
  ACCOUNT,
  ACCOUNT_SUFFIX: SUFFIX,
  // Tên hồ sơ tài khoản của slot này — ghi vào dòng đầu ô Kết quả thực hiện.
  PROFILE_NAME: ACCOUNT === 1 ? 'default' : `slot${ACCOUNT}`,

  // Đường dẫn — tách theo slot để 2 lần chạy không ghi đè file của nhau
  ROOT_DIR,
  AUTH_DIR: path.join(ROOT_DIR, '.auth'),
  AUTH_STATE_PATH: path.join(ROOT_DIR, '.auth', `user_state${SUFFIX}.json`),
  CHROME_PROFILE_DIR: path.join(ROOT_DIR, `.chrome_profile${SUFFIX}`),
  VIDEOS_DIR: ACCOUNT === 1 ? path.join(ROOT_DIR, 'videos') : path.join(ROOT_DIR, 'videos', `acc${ACCOUNT}`),

  // Chrome & Target
  CDP_PORT,
  CDP_URL:
    process.env.CDP_URL && ACCOUNT === 1 ? process.env.CDP_URL : `http://localhost:${CDP_PORT}`,
  TARGET_URL,
  // Chưa có nơi tiêu thụ nào trong repo (grep toàn bộ src/ không ra) — giữ lại
  // để .env cũ không báo thừa biến, nhưng không đặt giá trị cứng đã lạc hậu.
  SCALE_PAGE_URL: process.env.SCALE_PAGE_URL || '',
  ORG_NAME: slotEnv('ORG_NAME', { fallback: true }) || 'Water Quality - NH3T TEAM',

  // Thông tin đăng nhập của slot hiện tại
  EMAIL,
  PASSWORD,

  // Google Sheet — dùng chung mọi slot
  // SHEET_URL cũng chưa có nơi tiêu thụ; SHEET_ID mới là thứ thật sự được dùng.
  SHEET_URL: process.env.SHEET_URL || '',
  SHEET_ID,
  SHEET_TAB,
  SHEET_GID,
  GOOGLE_SA_KEY_FILE,
  ENV_LABELS: process.env.ENV_LABELS || '',
  // Người duyệt ghi vào nhật ký ghi Sheet (không ghi lên Sheet).
  QC_NAME: (process.env.QC_NAME || process.env.USERNAME || process.env.USER || '').trim(),
  SHEET_ID_COLUMN: 'A',
  SHEET_RESULT_COLUMN: 'I', // Mặc định Lần 1

  // Google Drive (video)
  DRIVE_CLIENT_ID,
  DRIVE_CLIENT_SECRET,
  DRIVE_REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  // Catbox (đã thay bằng Drive)
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
