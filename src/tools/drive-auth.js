#!/usr/bin/env node
// ============================================================================
// drive-auth.js: cấp quyền Google Drive (1 lần) cho việc lưu video kiểm thử — ghi 4 biến DRIVE_* vào .env.
//
//   npm run drive:auth -- --client-file C:\duong-dan\client_secret_xxx.json [--folder-name "AI-QC Video"]
//   npm run drive:auth                    (.env đã có DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET — chỉ lấy lại refresh token)
//
// Chuẩn bị 1 lần trên Google Cloud Console (project nào cũng được, vd project của service account Sheet):
//   1. APIs & Services → Library → bật «Google Drive API».
//   2. Google Auth Platform → Branding: tên app + email hỗ trợ. Audience: External → bấm «Publish app» (In production).
//      Để «Testing» thì refresh token hết hạn sau 7 ngày. Phạm vi drive.file thuộc loại không nhạy cảm → không cần Google xét duyệt.
//   3. Clients → Create client → Application type «Desktop app» → tải file JSON.
// Chạy lệnh trên → trình duyệt mở trang đăng nhập Google → chọn tài khoản Gmail SẼ LƯU VIDEO → Cho phép.
//
// Lệnh tự tạo thư mục video trên Drive của tài khoản đó (drive.file chỉ thấy thư mục do app tạo — thư mục tạo tay không dùng
// được); .env đã có DRIVE_FOLDER_ID còn dùng được thì giữ. Không in secret ra màn hình; .env cũ lưu thành .env.bak.
// Server AI-QC: nhập 4 giá trị DRIVE_* bằng Install-AiQcSvc.ps1 (hộp thoại, không qua file).
// ============================================================================

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const { checkDrive, createTokenProvider, apiError, SCOPES, FILES_API, FOLDER_MIME } = require('../core/drive');

const ENV_PATH = path.join(config.ROOT_DIR, '.env');
const WAIT_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const out = { folderName: 'AI-QC Video' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--client-file') out.clientFile = argv[++i];
    else if (a === '--folder-name') out.folderName = argv[++i];
    else throw new Error(`Tham số lạ: "${a}" — dùng --client-file <file JSON> [--folder-name <tên>]`);
  }
  return out;
}

/** client_id + client_secret: từ file JSON tải ở Google Cloud (Desktop app → "installed"), không có thì từ .env */
function readClient(clientFile) {
  if (!clientFile) {
    if (config.DRIVE_CLIENT_ID && config.DRIVE_CLIENT_SECRET) return { clientId: config.DRIVE_CLIENT_ID, clientSecret: config.DRIVE_CLIENT_SECRET };
    throw new Error('Chưa có OAuth client — truyền --client-file <file JSON client Desktop tải ở Google Cloud Console>');
  }
  const raw = JSON.parse(fs.readFileSync(clientFile, 'utf8').replace(/^﻿/, ''));
  const block = raw.installed || raw.web;
  if (!block || !block.client_id || !block.client_secret) {
    throw new Error(`${clientFile} không phải file OAuth client (thiếu installed.client_id / client_secret)`);
  }
  if (!raw.installed) console.warn('[DRIVE] ⚠ File là client loại Web — nên tạo loại «Desktop app» (mới nhận địa chỉ 127.0.0.1 bất kỳ cổng).');
  return { clientId: block.client_id, clientSecret: block.client_secret };
}

function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // không mở được thì người dùng tự mở link đã in
  }
}

/** Đăng nhập qua trình duyệt (loopback 127.0.0.1 + PKCE) → refresh token */
async function authorize({ clientId, clientSecret }) {
  const { OAuth2Client } = require('google-auth-library');
  const server = http.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(16).toString('hex');
  const url = client.generateAuthUrl({
    access_type: 'offline',
    // luôn hỏi lại để Google trả refresh token mới (lần thứ 2 trở đi không có prompt thì không trả)
    prompt: 'consent',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  console.log('[DRIVE] Mở trang đăng nhập Google — chọn tài khoản Gmail sẽ LƯU VIDEO rồi bấm Cho phép.');
  console.log(`[DRIVE] Trình duyệt không tự mở thì dán link này vào trình duyệt TRÊN MÁY NÀY:\n${url}\n`);
  openBrowser(url);

  let timer;
  const code = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Quá 5 phút chưa đăng nhập xong — chạy lại lệnh')), WAIT_MS);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const finish = (ok, text) => {
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<p style="font:16px sans-serif">${text}</p>`);
      };
      if (u.searchParams.get('state') !== state) {
        finish(false, 'Sai mã phiên — đóng tab này, chạy lại lệnh.');
        return;
      }
      if (u.searchParams.get('error')) {
        finish(false, `Google báo lỗi: ${u.searchParams.get('error')}. Đóng tab này.`);
        reject(new Error(`Google từ chối cấp quyền: ${u.searchParams.get('error')}`));
        return;
      }
      finish(true, 'Đã cấp quyền Google Drive. Đóng tab này, quay lại cửa sổ lệnh.');
      resolve(u.searchParams.get('code'));
    });
  }).finally(() => {
    clearTimeout(timer);
    server.close();
  });

  const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error('Google không trả refresh token — vào myaccount.google.com/permissions gỡ quyền app rồi chạy lại');
  return tokens.refresh_token;
}

/** Thư mục video: DRIVE_FOLDER_ID cũ còn dùng được với tài khoản vừa cấp quyền thì giữ, không thì tạo mới */
async function resolveFolder(getToken, folderName) {
  const fetchImpl = require('node-fetch');
  if (config.DRIVE_FOLDER_ID) {
    try {
      const { folder } = await checkDrive({ getToken, folderId: config.DRIVE_FOLDER_ID });
      return { ...folder, created: false };
    } catch (err) {
      console.warn(`[DRIVE] Thư mục cũ trong .env không dùng được (${err.message}) — tạo thư mục mới.`);
    }
  }
  const res = await fetchImpl(`${FILES_API}?fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }),
    timeout: 30000,
  });
  if (res.status !== 200) throw await apiError(res, 'Tạo thư mục video');
  return { ...(await res.json()), created: true };
}

/** Vá từng dòng .env, giữ comment + thứ tự, biến chưa có thì thêm cuối (cùng luật patchEnvFile của tools/ui/server.js) */
function patchEnv(updates) {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();
  const lines = (raw ? raw.split(/\r?\n/) : []).map((line) => {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    if (!m || !Object.prototype.hasOwnProperty.call(updates, m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${updates[m[1]]}`;
  });
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  if (raw) fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
  fs.writeFileSync(ENV_PATH, lines.join(eol) + eol, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = readClient(args.clientFile);
  const refreshToken = await authorize(client);
  const getToken = createTokenProvider({ ...client, refreshToken });

  const folder = await resolveFolder(getToken, args.folderName);
  const { email } = await checkDrive({ getToken, folderId: folder.id });

  patchEnv({
    DRIVE_CLIENT_ID: client.clientId,
    DRIVE_CLIENT_SECRET: client.clientSecret,
    DRIVE_REFRESH_TOKEN: refreshToken,
    DRIVE_FOLDER_ID: folder.id,
  });

  console.log(`[DRIVE] ✓ Tài khoản lưu video: ${email || '(không đọc được email)'}`);
  console.log(
    `[DRIVE] ✓ Thư mục ${folder.created ? 'mới tạo' : 'giữ nguyên'}: «${folder.name}» https://drive.google.com/drive/folders/${folder.id}`
  );
  console.log(`[DRIVE] ✓ Đã ghi DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, DRIVE_REFRESH_TOKEN, DRIVE_FOLDER_ID vào ${ENV_PATH}`);
}

main().catch((err) => {
  console.error(`[DRIVE] ✗ ${err.message}`);
  process.exitCode = 1;
});
