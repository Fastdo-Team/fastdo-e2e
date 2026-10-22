// ============================================================================
// drive.js: đẩy video lên Google Drive của 1 tài khoản Gmail, trả link xem — thay Catbox (server Catbox chết 2026-10-22).
//
// Vì sao OAuth Gmail mà không dùng service account của Sheet: service account không có dung lượng Drive
// (about.storageQuota.limit = 0) và không thuộc Shared Drive nào → không làm chủ được file nào. Refresh token
// lấy 1 lần bằng `npm run drive:auth` (xem đầu src/tools/drive-auth.js).
// Phạm vi drive.file: app chỉ thấy file / thư mục do chính nó tạo, không đọc được phần còn lại của Drive.
//
// Mỗi lần đẩy:
//   - upload kiểu resumable (multipart chỉ dành cho file ≤ 5 MB), gửi đủ Content-Length;
//   - mở quyền «Ai có link đều xem được» (như Catbox — QC, Fastdo, Sheet bấm là xem);
//   - đọc lại kích thước trên Drive, phải khớp bản trên máy (bài học Catbox 0 byte, ticket 1338) — lệch thì bỏ file
//     vào thùng rác rồi upload lại; hết lượt vẫn lệch → báo lỗi, không trả link hỏng.
// 429 / 5xx / lỗi mạng thử lại; lỗi cấu hình (token thu hồi, thư mục sai, hết dung lượng) báo ngay, không thử lại.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');

const MB = 1024 * 1024;
const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const ABOUT_API = 'https://www.googleapis.com/drive/v3/about';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const RETRY_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

// Nạp muộn: test truyền fetch giả, không cần node-fetch thật
const defaultFetch = (...args) => require('node-fetch')(...args);

/** Tên file trên Drive theo đúng loại file thật: video.webm (hậu kỳ hỏng, chưa có mp4) mà tên xin «.mp4» thì đổi đuôi thành
 * .webm — trình xem của Drive chọn cách phát theo loại file, sai loại thì không phát. */
function remoteNameFor(videoPath, remoteFilename) {
  const actual = path.extname(videoPath).toLowerCase() || '.mp4';
  const wanted = remoteFilename || `test-record${actual}`;
  return path.extname(wanted).toLowerCase() === actual ? wanted : `${wanted.slice(0, wanted.length - path.extname(wanted).length)}${actual}`;
}

/** Link xem trên Drive (trình phát của Drive, không cần đăng nhập khi đã mở quyền «ai có link») */
function viewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** Lỗi có `retry` = thử lại có ích hay không */
function driveError(message, retry) {
  const err = new Error(message);
  err.retry = retry;
  return err;
}

/** Phản hồi lỗi của Drive API → lỗi nói rõ phải sửa gì */
async function apiError(res, what) {
  let body = {};
  try {
    body = await res.json();
  } catch {
    // thân không phải JSON (502 của proxy…) — chỉ còn mã HTTP
  }
  const error = body.error || {};
  const reason = ((error.errors || [])[0] || {}).reason || error.status || '';
  const message = error.message || `HTTP ${res.status}`;
  if (res.status === 429 || res.status >= 500 || RETRY_REASONS.has(reason)) {
    return driveError(`${what}: HTTP ${res.status} ${message}`, true);
  }
  if (res.status === 401) {
    return driveError(`${what}: token Drive bị từ chối (${message}) — chạy lại npm run drive:auth`, false);
  }
  if (reason === 'storageQuotaExceeded') {
    return driveError(`${what}: Drive của tài khoản lưu video đã hết dung lượng — dọn thư mục video cũ hoặc đổi tài khoản (npm run drive:auth)`, false);
  }
  if (res.status === 404) {
    return driveError(
      `${what}: không thấy thư mục DRIVE_FOLDER_ID (${message}) — thư mục phải do chính app tạo (npm run drive:auth tạo sẵn); ` +
        'thư mục tạo tay trên drive.google.com app không thấy được',
      false
    );
  }
  return driveError(`${what}: HTTP ${res.status} ${message}`, false);
}

/** Hàm lấy access token từ refresh token (OAuth client Desktop + refresh token của tài khoản Gmail lưu video) */
function createTokenProvider({ clientId, clientSecret, refreshToken } = {}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw driveError('Chưa cấu hình DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET / DRIVE_REFRESH_TOKEN trong .env — chạy npm run drive:auth', false);
  }
  // Nạp muộn: test truyền getToken giả
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return async () => {
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('Google không trả access token');
      return token;
    } catch (err) {
      const grant = (err.response && err.response.data && err.response.data.error) || err.message || '';
      if (/invalid_grant|invalid_client|unauthorized_client/i.test(grant)) {
        throw driveError(
          `Refresh token Drive không còn dùng được (${grant}) — chạy lại npm run drive:auth. OAuth app phải ở trạng thái ` +
            '«In production»: để «Testing» thì token chỉ sống 7 ngày',
          false
        );
      }
      throw driveError(`Lấy access token Drive lỗi: ${err.message}`, true);
    }
  };
}

function tokenFromConfig() {
  return createTokenProvider({
    clientId: config.DRIVE_CLIENT_ID,
    clientSecret: config.DRIVE_CLIENT_SECRET,
    refreshToken: config.DRIVE_REFRESH_TOKEN,
  });
}

/** 1 lượt: mở phiên resumable → gửi file → mở quyền xem → đọc lại kích thước. Trả { id, stored } */
async function uploadOnce({ fetchImpl, token, videoPath, size, name, mimeType, folderId, timeout }) {
  const auth = { Authorization: `Bearer ${token}` };
  const metadata = { name, mimeType, ...(folderId ? { parents: [folderId] } : {}) };
  const start = await fetchImpl(`${UPLOAD_API}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(metadata),
    timeout: 30000,
  });
  if (start.status !== 200) throw await apiError(start, 'Mở phiên upload');
  const session = start.headers.get('location');
  if (!session) throw driveError('Mở phiên upload: Drive không trả địa chỉ phiên (Location)', true);

  // Địa chỉ phiên đã gắn quyền — PUT không cần token
  const put = await fetchImpl(session, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(size) },
    body: fs.createReadStream(videoPath),
    timeout,
  });
  if (put.status !== 200 && put.status !== 201) throw await apiError(put, 'Gửi file');
  const { id } = await put.json();
  if (!id) throw driveError('Gửi file: Drive không trả id file', true);

  const share = await fetchImpl(`${FILES_API}/${id}/permissions?fields=id`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    timeout: 30000,
  });
  if (share.status !== 200) throw await apiError(share, 'Mở quyền «ai có link đều xem được»');

  const check = await fetchImpl(`${FILES_API}/${id}?fields=id,size`, { method: 'GET', headers: auth, timeout: 30000 });
  if (check.status !== 200) throw await apiError(check, 'Đọc lại file vừa upload');
  const stored = (await check.json()).size;
  return { id, stored: stored == null ? null : Number(stored) };
}

/** Bỏ file hỏng vào thùng rác (không xoá hẳn) — lỗi thì thôi, file chỉ nằm thừa trong thư mục */
async function trash(fetchImpl, token, id) {
  try {
    await fetchImpl(`${FILES_API}/${id}?fields=id`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
      timeout: 30000,
    });
  } catch {
    // bỏ qua
  }
}

/**
 * Đẩy video lên Google Drive (thư mục DRIVE_FOLDER_ID, trống = gốc My Drive), mở quyền «ai có link đều xem được», trả link xem.
 * @param {{maxRetries?: number, fetchImpl?: Function, wait?: Function, getToken?: () => Promise<string>, folderId?: string}} [options]
 */
async function uploadToDrive(videoPath, remoteFilename, options = {}) {
  const { maxRetries = 3, fetchImpl = defaultFetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`File video không tồn tại: ${videoPath}`);
  }
  const size = fs.statSync(videoPath).size;
  if (size === 0) {
    throw new Error(`File video rỗng (0 byte), không upload: ${videoPath}`);
  }

  const getToken = options.getToken || tokenFromConfig();
  const folderId = options.folderId !== undefined ? options.folderId : config.DRIVE_FOLDER_ID;
  const name = remoteNameFor(videoPath, remoteFilename);
  const mimeType = path.extname(name).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
  const timeout = 60000 + Math.ceil(size / MB) * 15000;
  let lastProblem = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DRIVE] Đang tải video lên Google Drive (lần thử ${attempt}, ${(size / MB).toFixed(1)} MB)...`);
      const token = await getToken();
      const { id, stored } = await uploadOnce({ fetchImpl, token, videoPath, size, name, mimeType, folderId, timeout });
      if (stored === size) {
        const link = viewLink(id);
        console.log(`[DRIVE] Upload thành công: ${link}`);
        return link;
      }
      lastProblem = `Drive giữ ${stored == null ? 'không rõ' : stored} / ${size} byte (file ${id})`;
      console.warn(`[DRIVE] File vừa upload không đủ dữ liệu — ${lastProblem}`);
      await trash(fetchImpl, token, id);
    } catch (err) {
      lastProblem = err.message;
      if (err.retry === false) throw new Error(`Upload lên Google Drive thất bại: ${err.message}`);
      console.warn(`[DRIVE] Lỗi upload lần ${attempt}: ${err.message}`);
    }
    if (attempt < maxRetries) await wait(2000 * attempt);
  }

  throw new Error(`Upload lên Google Drive thất bại sau ${maxRetries} lần thử: ${lastProblem}`);
}

/**
 * Kiểm cấu hình Drive mà không upload: lấy được token, tài khoản nào, thư mục còn dùng được không.
 * @returns {Promise<{email: string, folder: {id: string, name: string}|null}>}
 */
async function checkDrive({ fetchImpl = defaultFetch, getToken, folderId } = {}) {
  const token = await (getToken || tokenFromConfig())();
  const auth = { Authorization: `Bearer ${token}` };
  const about = await fetchImpl(`${ABOUT_API}?fields=user(emailAddress)`, { method: 'GET', headers: auth, timeout: 30000 });
  if (about.status !== 200) throw await apiError(about, 'Đọc tài khoản Drive');
  const email = ((await about.json()).user || {}).emailAddress || '';

  const id = folderId !== undefined ? folderId : config.DRIVE_FOLDER_ID;
  if (!id) return { email, folder: null };
  const res = await fetchImpl(`${FILES_API}/${id}?fields=id,name,mimeType,trashed`, { method: 'GET', headers: auth, timeout: 30000 });
  if (res.status !== 200) throw await apiError(res, 'Đọc thư mục DRIVE_FOLDER_ID');
  const folder = await res.json();
  if (folder.mimeType !== FOLDER_MIME || folder.trashed) {
    throw driveError(`DRIVE_FOLDER_ID (${id}) không phải thư mục đang dùng được (đã vào thùng rác?) — chạy lại npm run drive:auth`, false);
  }
  return { email, folder: { id: folder.id, name: folder.name } };
}

module.exports = {
  uploadToDrive,
  checkDrive,
  createTokenProvider,
  remoteNameFor,
  viewLink,
  apiError,
  SCOPES,
  FILES_API,
  ABOUT_API,
  FOLDER_MIME,
};
