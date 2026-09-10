// Upload video lên Catbox bằng userhash cố định (tài khoản đã có) để lấy link vĩnh viễn.
// KHÔNG dùng anonymous upload / litterbox — Catbox chặn anonymous (HTTP 412 "Invalid uploader"),
// litterbox chỉ giữ link tối đa 72h.
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { CATBOX_USERHASH } = require('./config');

async function uploadToCatbox(videoPath, remoteFilename) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('userhash', CATBOX_USERHASH);
  form.append('fileToUpload', fs.createReadStream(videoPath), remoteFilename || 'test-record.mp4');

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });
  const text = await res.text();
  if (res.status !== 200 || !text.startsWith('http')) {
    throw new Error(`Upload Catbox thất bại (HTTP ${res.status}): ${text}`);
  }
  return text.trim();
}

module.exports = { uploadToCatbox };
