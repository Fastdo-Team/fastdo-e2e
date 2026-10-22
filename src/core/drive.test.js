const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { uploadToDrive, checkDrive, createTokenProvider, remoteNameFor } = require('./drive');

function tempFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}

function json(status, body, headers = {}) {
  return {
    status,
    headers: { get: (key) => headers[key.toLowerCase()] || null },
    json: async () => body,
  };
}

/**
 * fetch giả của Drive: mở phiên → PUT → mở quyền → đọc lại kích thước (lần lượt các số trong storedSizes).
 * `fail` = { step: 'start'|'put'|'share', status, reason } trả lỗi đúng 1 lần ở bước đó.
 */
function fakeDrive(storedSizes, fail) {
  const calls = [];
  let fileNo = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = url.includes('upload_id=')
      ? 'put'
      : url.includes('uploadType=resumable')
        ? 'start'
        : url.includes('/permissions')
          ? 'share'
          : init.method === 'PATCH'
            ? 'trash'
            : 'get';
    if (fail && fail.step === step && !fail.used) {
      fail.used = true;
      return json(fail.status, { error: { message: 'giả', errors: [{ reason: fail.reason || '' }] } });
    }
    if (step === 'start') return json(200, {}, { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc' });
    if (step === 'put') {
      fileNo += 1;
      return json(200, { id: `file${fileNo}` });
    }
    if (step === 'share') return json(200, { id: 'anyoneWithLink' });
    if (step === 'trash') return json(200, { id: 'x' });
    return json(200, { id: `file${fileNo}`, size: String(storedSizes.shift()) });
  };
  return { fetchImpl, calls };
}

const quiet = { wait: async () => {}, getToken: async () => 'tok', folderId: 'folder1' };

test('remoteNameFor: đuôi theo file thật (webm xin tên .mp4 → .webm), đúng đuôi thì giữ nguyên', () => {
  assert.strictEqual(remoteNameFor('C:/r/video.webm', 'aiqc-1338-ai01-truoc.mp4'), 'aiqc-1338-ai01-truoc.webm');
  assert.strictEqual(remoteNameFor('C:/r/1338-AI01_AutoRecord.mp4', 'aiqc-1338-ai01-truoc.mp4'), 'aiqc-1338-ai01-truoc.mp4');
  assert.strictEqual(remoteNameFor('C:/r/video.webm', undefined), 'test-record.webm');
});

test('upload: phiên resumable vào đúng thư mục, PUT kèm Content-Length, mở quyền ai có link → trả link xem', async () => {
  const file = tempFile('video.webm', 2048);
  const { fetchImpl, calls } = fakeDrive([2048]);
  const link = await uploadToDrive(file, 'aiqc-1338-ai01-truoc.mp4', { ...quiet, fetchImpl });
  assert.strictEqual(link, 'https://drive.google.com/file/d/file1/view');

  const start = calls[0].init;
  assert.strictEqual(start.method, 'POST');
  assert.strictEqual(start.headers.Authorization, 'Bearer tok');
  assert.strictEqual(start.headers['X-Upload-Content-Length'], '2048');
  assert.deepStrictEqual(JSON.parse(start.body), { name: 'aiqc-1338-ai01-truoc.webm', mimeType: 'video/webm', parents: ['folder1'] });

  const put = calls[1].init;
  assert.strictEqual(put.method, 'PUT');
  assert.strictEqual(put.headers['Content-Length'], '2048');
  assert.ok(!put.headers.Authorization, 'địa chỉ phiên đã gắn quyền, không gửi token lần nữa');

  assert.deepStrictEqual(JSON.parse(calls[2].init.body), { type: 'anyone', role: 'reader' });
});

test('upload: Drive giữ thiếu byte → bỏ file vào thùng rác, upload lại; lần sau đủ thì trả link file mới', async () => {
  const file = tempFile('video.mp4', 4096);
  const { fetchImpl, calls } = fakeDrive([0, 4096]);
  const link = await uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl });
  assert.strictEqual(link, 'https://drive.google.com/file/d/file2/view');
  const trashed = calls.filter((call) => call.init.method === 'PATCH');
  assert.strictEqual(trashed.length, 1);
  assert.ok(trashed[0].url.includes('/file1?'));
  assert.deepStrictEqual(JSON.parse(trashed[0].init.body), { trashed: true });
});

test('upload: hết lượt mà vẫn thiếu byte → báo lỗi, không trả link hỏng; file rỗng thì không upload', async () => {
  const file = tempFile('video.mp4', 1024);
  const { fetchImpl } = fakeDrive([0, 0, 0]);
  await assert.rejects(uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl }), /giữ 0 \/ 1024 byte/);

  const empty = tempFile('video.mp4', 0);
  await assert.rejects(uploadToDrive(empty, 'x.mp4', { ...quiet, fetchImpl }), /rỗng \(0 byte\)/);
});

test('upload: 503 / rateLimitExceeded thì thử lại; hết dung lượng / thư mục sai thì báo ngay', async () => {
  const file = tempFile('video.mp4', 512);

  const busy = fakeDrive([512], { step: 'put', status: 503 });
  assert.strictEqual(await uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl: busy.fetchImpl }), 'https://drive.google.com/file/d/file1/view');

  const limited = fakeDrive([512], { step: 'start', status: 403, reason: 'userRateLimitExceeded' });
  assert.ok(await uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl: limited.fetchImpl }));

  const full = fakeDrive([512], { step: 'start', status: 403, reason: 'storageQuotaExceeded' });
  await assert.rejects(uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl: full.fetchImpl }), /hết dung lượng/);
  assert.strictEqual(full.calls.length, 1, 'không thử lại');

  const lost = fakeDrive([512], { step: 'start', status: 404 });
  await assert.rejects(uploadToDrive(file, 'x.mp4', { ...quiet, fetchImpl: lost.fetchImpl }), /DRIVE_FOLDER_ID/);
});

test('upload: không có thư mục → lên gốc My Drive (không gửi parents)', async () => {
  const file = tempFile('video.mp4', 256);
  const { fetchImpl, calls } = fakeDrive([256]);
  await uploadToDrive(file, 'x.mp4', { ...quiet, folderId: '', fetchImpl });
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { name: 'x.mp4', mimeType: 'video/mp4' });
});

test('token: thiếu biến cấu hình → lỗi chỉ cách sửa', () => {
  assert.throws(() => createTokenProvider({ clientId: 'a', clientSecret: '', refreshToken: 'r' }), /npm run drive:auth/);
});

test('checkDrive: trả email tài khoản + thư mục; thư mục đã vào thùng rác → lỗi', async () => {
  const fetchFor = (folder) => async (url) =>
    url.includes('/about') ? json(200, { user: { emailAddress: 'qc@gmail.com' } }) : json(200, folder);
  const ok = await checkDrive({
    getToken: async () => 'tok',
    folderId: 'f1',
    fetchImpl: fetchFor({ id: 'f1', name: 'AI-QC Video', mimeType: 'application/vnd.google-apps.folder', trashed: false }),
  });
  assert.deepStrictEqual(ok, { email: 'qc@gmail.com', folder: { id: 'f1', name: 'AI-QC Video' } });

  await assert.rejects(
    checkDrive({
      getToken: async () => 'tok',
      folderId: 'f1',
      fetchImpl: fetchFor({ id: 'f1', name: 'AI-QC Video', mimeType: 'application/vnd.google-apps.folder', trashed: true }),
    }),
    /thùng rác/
  );
});
