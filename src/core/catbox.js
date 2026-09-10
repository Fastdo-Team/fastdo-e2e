// ============================================================================
// catbox.js: Tải video lên Catbox bằng userhash để lấy link vĩnh viễn
// ============================================================================

const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const config = require('../config');

async function uploadToCatbox(videoPath, remoteFilename, maxRetries = 2) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`File video không tồn tại: ${videoPath}`);
  }

  const userhash = config.CATBOX_USERHASH;
  if (!userhash) {
    throw new Error('Chưa cấu hình CATBOX_USERHASH trong file .env');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[CATBOX] Đang tải video lên Catbox (lần thử ${attempt})...`);
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('userhash', userhash);
      form.append('fileToUpload', fs.createReadStream(videoPath), remoteFilename || 'test-record.mp4');

      const res = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 60000,
      });

      const text = await res.text();
      if (res.status === 200 && text.startsWith('http')) {
        const link = text.trim();
        console.log(`[CATBOX] Upload thành công: ${link}`);
        return link;
      }

      console.warn(`[CATBOX] Phản hồi không mong muốn (HTTP ${res.status}): ${text}`);
    } catch (err) {
      console.warn(`[CATBOX] Lỗi upload lần ${attempt}: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw new Error('Upload lên Catbox thất bại sau các lần thử');
}

module.exports = { uploadToCatbox };
