const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { uploadToCatbox, remoteNameFor } = require('./catbox');

function tempFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catbox-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}

/** fetch giả: POST trả link, HEAD trả lần lượt các kích thước trong storedSizes */
function fakeFetch(storedSizes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'HEAD') {
      const size = storedSizes.shift();
      return { status: 200, headers: { get: (key) => (key === 'content-length' ? String(size) : null) } };
    }
    return { status: 200, text: async () => 'https://files.catbox.moe/abc123.webm\n' };
  };
  return { fetchImpl, calls };
}

const quiet = { wait: async () => {}, userhash: 'u' };

test('remoteNameFor: đuôi theo file thật (webm xin tên .mp4 → .webm), đúng đuôi thì giữ nguyên', () => {
  assert.strictEqual(remoteNameFor('C:/r/video.webm', 'aiqc-1338-ai01-truoc.mp4'), 'aiqc-1338-ai01-truoc.webm');
  assert.strictEqual(remoteNameFor('C:/r/1338-AI01_AutoRecord.mp4', 'aiqc-1338-ai01-truoc.mp4'), 'aiqc-1338-ai01-truoc.mp4');
  assert.strictEqual(remoteNameFor('C:/r/video.webm', undefined), 'test-record.webm');
});

test('upload: gửi kèm Content-Length + đúng đuôi; link đủ dữ liệu thì trả link', async () => {
  const file = tempFile('video.webm', 2048);
  const { fetchImpl, calls } = fakeFetch([2048]);
  const link = await uploadToCatbox(file, 'aiqc-1338-ai01-truoc.mp4', { ...quiet, fetchImpl });
  assert.strictEqual(link, 'https://files.catbox.moe/abc123.webm');
  const post = calls[0].init;
  assert.strictEqual(post.method, 'POST');
  assert.ok(Number(post.headers['Content-Length']) > 2048, 'Content-Length phải có và gồm cả file');
  assert.strictEqual(calls[1].init.method, 'HEAD');
});

test('upload: Catbox giữ 0 byte → upload lại; lần sau đủ thì trả link', async () => {
  const file = tempFile('video.webm', 4096);
  const { fetchImpl, calls } = fakeFetch([0, 4096]);
  const link = await uploadToCatbox(file, 'x.mp4', { ...quiet, fetchImpl });
  assert.strictEqual(link, 'https://files.catbox.moe/abc123.webm');
  assert.strictEqual(calls.filter((call) => call.init.method === 'POST').length, 2);
});

test('upload: hết lượt mà link vẫn rỗng → báo lỗi, không trả link hỏng; file rỗng thì không upload', async () => {
  const file = tempFile('video.webm', 1024);
  const { fetchImpl } = fakeFetch([0, 0, 0]);
  await assert.rejects(uploadToCatbox(file, 'x.mp4', { ...quiet, fetchImpl }), /giữ 0 \/ 1024 byte/);

  const empty = tempFile('video.webm', 0);
  await assert.rejects(uploadToCatbox(empty, 'x.mp4', { ...quiet, fetchImpl }), /rỗng \(0 byte\)/);
});
