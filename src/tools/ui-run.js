#!/usr/bin/env node
// ============================================================================
// ui-run.js: chạy test QUA giao diện đang mở, thay vì spawn thẳng.
//
//   node src/tools/ui-run.js EVAL_050 --round=3
//   node src/tools/ui-run.js EVAL_050 EVAL_051 --round=3 --sheet-on=pass --no-record
//
// Vì sao cần: khi Claude chạy `npm test` thẳng từ terminal, tiến trình đó không
// thuộc về server giao diện, nên QC đang mở trang KHÔNG thấy gì cho tới khi F5.
// Qua tool này thì cùng một lần chạy hiện ở cả hai nơi: log chảy về trang cho QC
// xem, và vẫn in ra terminal cho Claude đọc.
//
// Không có server đang chạy thì thoát mã 2 — gọi `npm test` như bình thường.
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT_DIR = path.join(__dirname, '..', '..');
const TOKEN_FILE = path.join(ROOT_DIR, '.ui-token');

const CASE_ID_RE = /^EVAL_[A-Z0-9_]+$/;
const KNOWN_FLAGS = ['--round=N', '--account=N', '--sheet-on=pass|never', '--no-record', '--no-upload', '--plan'];

function die(msg, code = 1) {
  console.error(`[ui-run] ${msg}`);
  process.exit(code);
}

function positiveInt(arg, fallback) {
  const raw = arg.split('=')[1];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) die(`"${arg}" không hợp lệ — phải là số nguyên dương.`);
  return n;
}

function parseArgs() {
  const o = { ids: [], round: 1, account: 1, sheetOn: 'pass', record: true, upload: true, plan: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--no-record') o.record = false;
    else if (arg === '--no-upload') o.upload = false;
    else if (arg === '--plan') o.plan = true;
    else if (arg.startsWith('--round=')) o.round = positiveInt(arg, 1);
    else if (arg.startsWith('--account=')) o.account = positiveInt(arg, 1);
    else if (arg.startsWith('--sheet-on=')) {
      o.sheetOn = arg.slice('--sheet-on='.length);
      if (o.sheetOn === 'always') die(`"${arg}" không còn dùng được — case KHÔNG ĐẠT phải được QC xem video rồi duyệt.`);
      if (!['pass', 'never'].includes(o.sheetOn)) die(`"${arg}" — chỉ nhận pass hoặc never.`);
    } else if (arg.startsWith('--')) {
      die(`Cờ không hợp lệ: "${arg}". Cờ hợp lệ: ${KNOWN_FLAGS.join('  ')}`);
    } else {
      const id = arg.toUpperCase();
      if (!CASE_ID_RE.test(id)) die(`"${arg}" không phải mã testcase hợp lệ (dạng đúng: EVAL_017).`);
      o.ids.push(id);
    }
  }
  return o;
}

function readServer() {
  if (!fs.existsSync(TOKEN_FILE)) {
    die(
      'Không thấy .ui-token — giao diện chưa chạy.\n' +
        '        Mở một terminal khác rồi chạy `npm run ui`, hoặc dùng `npm test` như bình thường.',
      2
    );
  }
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (err) {
    die(`.ui-token hỏng: ${err.message}`, 2);
  }
}

function request(server, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: pathname,
        method,
        headers: Object.assign(
          { 'x-fastdo-token': server.token },
          payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
        ),
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            return reject(new Error(`phản hồi không phải JSON: ${raw.slice(0, 200)}`));
          }
          if (res.statusCode >= 400) return reject(new Error(data.error || `HTTP ${res.statusCode}`));
          resolve(data);
        });
      }
    );
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        // .ui-token sống sót khi server bị tắt cứng (kill -9, treo máy). File cũ
        // sẽ làm lần sau tưởng nhầm là giao diện đang chạy — dọn luôn tại đây.
        try {
          fs.unlinkSync(TOKEN_FILE);
        } catch {
          /* không xoá được thì thôi, thông điệp dưới vẫn đủ rõ */
        }
        return reject(
          new Error('giao diện không phản hồi (.ui-token cũ đã được dọn) — dùng `npm test` như bình thường.')
        );
      }
      reject(new Error(err.message));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Nối vào luồng log của job và in ra terminal. Trả về exit code của tiến trình con. */
function followLog(server, jobId) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: `/api/log/${jobId}?token=${encodeURIComponent(server.token)}`,
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        if (res.statusCode !== 200) return reject(new Error(`không nối được luồng log: HTTP ${res.statusCode}`));
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          let sep;
          // SSE ngăn cách các khối bằng một dòng trống
          while ((sep = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const event = (/^event:\s*(.*)$/m.exec(block) || [])[1];
            const dataLine = (/^data:\s*(.*)$/m.exec(block) || [])[1];
            if (!dataLine) continue;
            let data;
            try {
              data = JSON.parse(dataLine);
            } catch {
              continue;
            }
            if (event === 'line') {
              (data.stream === 'err' ? process.stderr : process.stdout).write(data.text + '\n');
            } else if (event === 'done') {
              res.destroy();
              return resolve(data.code);
            }
          }
        });
        res.on('end', () => resolve(0));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const o = parseArgs();
  if (!o.ids.length) {
    console.error('[ui-run] Thiếu mã testcase. Ví dụ: node src/tools/ui-run.js EVAL_021 --round=3');
    process.exit(1);
  }

  const server = readServer();

  let started;
  try {
    started = o.plan
      ? await request(server, 'POST', '/api/plan', { ids: o.ids, account: o.account })
      : await request(server, 'POST', '/api/run', {
          ids: o.ids,
          round: o.round,
          account: o.account,
          sheetOn: o.sheetOn,
          record: o.record,
          upload: o.upload,
        });
  } catch (err) {
    die(err.message, 2);
  }

  console.log(`[ui-run] Đã giao cho giao diện tại ${server.url} — QC đang mở trang sẽ thấy log này.`);
  console.log(`[ui-run] Lệnh thật: node ${started.args.join(' ')}`);
  console.log('-'.repeat(70));

  try {
    const code = await followLog(server, started.jobId);
    process.exitCode = code || 0;
  } catch (err) {
    die(`mất luồng log: ${err.message}. Tiến trình vẫn chạy, xem tiếp trên trang ${server.url}`, 1);
  }
}

main();
