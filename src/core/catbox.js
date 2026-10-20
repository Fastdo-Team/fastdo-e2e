const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('../config');

const MB = 1024 * 1024;

// Nạp muộn: test truyền fetch giả, không cần node-fetch thật
const defaultFetch = (...args) => require('node-fetch')(...args);

/** Tên file trên Catbox theo đúng loại file thật: video.webm (hậu kỳ hỏng, chưa có mp4) mà tên xin «.mp4» thì đổi đuôi thành .webm —
 * Catbox trả Content-Type theo đuôi, sai đuôi thì trình duyệt không phát. */
function remoteNameFor(videoPath, remoteFilename) {
  const actual = path.extname(videoPath).toLowerCase() || '.mp4';
  const wanted = remoteFilename || `test-record${actual}`;
  return path.extname(wanted).toLowerCase() === actual ? wanted : `${wanted.slice(0, wanted.length - path.extname(wanted).length)}${actual}`;
}

/** Kích thước file Catbox đang giữ (HEAD); không đọc được → null */
async function remoteSize(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { method: 'HEAD', timeout: 30000 });
    const length = res.headers && res.headers.get('content-length');
    return res.status === 200 && length != null ? Number(length) : null;
  } catch {
    return null;
  }
}

/**
 * Đẩy video lên Catbox. Ticket 1338 (2026-10-20): link trả về 200 nhưng file 0 byte trong khi bản trên máy nặng vài MB — nay:
 *   - từ chối file rỗng;
 *   - gửi kèm kích thước (Content-Length, không gửi kiểu chunked) và đúng đuôi file;
 *   - hạn giờ theo dung lượng (video dài cần lâu hơn 60s);
 *   - upload xong đọc lại link: kích thước phải khớp bản trên máy, lệch thì upload lại; hết lượt vẫn lệch → báo lỗi (không trả link hỏng).
 * @param {number|{maxRetries?: number, fetchImpl?: Function, wait?: Function, userhash?: string}} [options] số lần thử (cách gọi cũ) hoặc tuỳ chọn
 */
async function uploadToCatbox(videoPath, remoteFilename, options = {}) {
  const opts = typeof options === 'number' ? { maxRetries: options } : options;
  const { maxRetries = 3, fetchImpl = defaultFetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`File video không tồn tại: ${videoPath}`);
  }
  const size = fs.statSync(videoPath).size;
  if (size === 0) {
    throw new Error(`File video rỗng (0 byte), không upload: ${videoPath}`);
  }

  const userhash = opts.userhash || config.CATBOX_USERHASH;
  if (!userhash) {
    throw new Error('Chưa cấu hình CATBOX_USERHASH trong file .env');
  }

  const name = remoteNameFor(videoPath, remoteFilename);
  const contentType = path.extname(name).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
  const timeout = 60000 + Math.ceil(size / MB) * 15000;
  let lastProblem = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[CATBOX] Đang tải video lên Catbox (lần thử ${attempt}, ${(size / MB).toFixed(1)} MB)...`);
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('userhash', userhash);
      form.append('fileToUpload', fs.createReadStream(videoPath), { filename: name, contentType, knownLength: size });

      const res = await fetchImpl('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        headers: { ...form.getHeaders(), 'Content-Length': String(form.getLengthSync()) },
        timeout,
      });

      const text = await res.text();
      if (res.status === 200 && text.startsWith('http')) {
        const link = text.trim();
        const stored = await remoteSize(fetchImpl, link);
        if (stored === size) {
          console.log(`[CATBOX] Upload thành công: ${link}`);
          return link;
        }
        lastProblem = `Catbox giữ ${stored == null ? 'không rõ' : stored} / ${size} byte (${link})`;
        console.warn(`[CATBOX] Link vừa tạo không đủ dữ liệu — ${lastProblem}`);
      } else {
        lastProblem = `HTTP ${res.status}: ${text}`;
        console.warn(`[CATBOX] Phản hồi không mong muốn (${lastProblem})`);
      }
    } catch (err) {
      lastProblem = err.message;
      console.warn(`[CATBOX] Lỗi upload lần ${attempt}: ${err.message}`);
    }
    if (attempt < maxRetries) await wait(2000 * attempt);
  }

  throw new Error(`Upload lên Catbox thất bại sau ${maxRetries} lần thử: ${lastProblem}`);
}

module.exports = { uploadToCatbox, remoteNameFor };
