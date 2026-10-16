const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./script_meta');

const run = async () => ({ pass: true, resultText: '' });

test('mặc định: hồ sơ default, chạy một mình, 150s; resources suy từ DRAFT_TEMPLATE_NAME', () => {
  const src = "const DRAFT_TEMPLATE_NAME = 'Mẫu TTS - Bản sao';";
  const m = M.readMeta({ id: 'EVAL_021', run }, 'eval_021.test.js', src);
  assert.deepStrictEqual(
    { profile: m.profile, parallel: m.parallel, timeoutSec: m.timeoutSec, resources: m.resources, problems: m.problems },
    { profile: 'default', parallel: false, timeoutSec: 150, resources: ['mau:Mẫu TTS - Bản sao'], problems: [] }
  );
});

test('consumes luôn được gộp vào resources (thứ bị tiêu hao cũng phải khoá)', () => {
  const m = M.readMeta({ id: 'EVAL_037', run, parallel: true, consumes: ['phieu:DRYRUN040'] }, 'x.js', '');
  assert.deepStrictEqual(m.resources, ['phieu:DRYRUN040']);
  assert.deepStrictEqual(m.consumes, ['phieu:DRYRUN040']);
  assert.strictEqual(m.parallel, true);
});

test('khai báo sai → problems (engine báo HỢP ĐỒNG KỊCH BẢN, không chạy)', () => {
  const m = M.readMeta({ id: 'EVAL_X', profile: 'Nhân Viên', resources: 'mau:a', timeoutSec: 5 }, 'x.js', '');
  assert.strictEqual(m.problems.length, 4);
});

test('mã băm đổi khi file kịch bản đổi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-meta-'));
  const f = path.join(dir, 'eval_x.test.js');
  fs.writeFileSync(f, 'a');
  const h1 = M.scriptHash(f, dir, []);
  fs.writeFileSync(f, 'b');
  const h2 = M.scriptHash(f, dir, []);
  assert.match(h1, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(h1, h2);
});

test('ready / blocker (AI-QC): chỉ true đúng kiểu mới là sẵn sàng; blocker cắt khoảng trắng', () => {
  assert.strictEqual(M.readMeta({ run }, 'x.js', '').ready, false);
  assert.strictEqual(M.readMeta({ run, ready: 'true' }, 'x.js', '').ready, false);
  const m = M.readMeta({ run, ready: false, blocker: '  cần tài khoản người duyệt  ' }, 'x.js', '');
  assert.deepStrictEqual({ ready: m.ready, blocker: m.blocker }, { ready: false, blocker: 'cần tài khoản người duyệt' });
  assert.strictEqual(M.readMeta({ run, ready: true }, 'x.js', '').ready, true);
});

function ticketDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-ready-'));
  fs.mkdirSync(path.join(dir, 'tickets'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'tickets', name), body);
  return dir;
}

test('listTicketScripts: chỉ file của ticket, mã theo tên file; id lệch / nạp hỏng → problems', () => {
  const dir = ticketDir({
    '1309-ai01.test.js': "module.exports = { id: '1309-AI01', ready: true, async run() {} };",
    '1309-ai02.test.js': "module.exports = { id: '1309-AI02', ready: false, blocker: 'cần vai trò duyệt', async run() {} };",
    '1309-ai03.test.js': "module.exports = { id: 'explore', ready: true, async run() {} };",
    '1309-ai04.test.js': 'module.exports = {',
    '9301-qc01.test.js': "module.exports = { id: '9301-QC01', ready: true, async run() {} };",
  });
  const list = M.listTicketScripts('1309', dir);
  assert.deepStrictEqual(
    list.map((s) => [s.id, s.ready, s.blocker, s.problems.length]),
    [
      ['1309-AI01', true, '', 0],
      ['1309-AI02', false, 'cần vai trò duyệt', 0],
      ['1309-AI03', true, '', 1],
      ['1309-AI04', false, '', 1],
    ]
  );
  assert.match(list[2].problems[0], /khác tên file/);
  assert.match(list[3].problems[0], /không nạp được/);
});

test('resetTicketReady: bỏ mọi ready: true của ticket (kể cả viết gọn 1 dòng), không đụng ticket khác', () => {
  const dir = ticketDir({
    '1309-ai01.test.js': "module.exports = {\n  id: '1309-AI01',\n  ready: true,\n  async run() {},\n};",
    '1309-ai02.test.js': "module.exports = { id: '1309-AI02', ready:true, async run() {} };",
    '1309-ai03.test.js': "module.exports = { id: '1309-AI03', ready: false, async run() {} };",
    '9301-qc01.test.js': "module.exports = { id: '9301-QC01', ready: true, async run() {} };",
  });
  assert.deepStrictEqual(M.resetTicketReady('1309', dir), ['1309-AI01', '1309-AI02']);
  assert.deepStrictEqual(
    M.listTicketScripts('1309', dir).map((s) => s.ready),
    [false, false, false]
  );
  assert.strictEqual(M.listTicketScripts('9301', dir)[0].ready, true);
  assert.match(fs.readFileSync(path.join(dir, 'tickets', '1309-ai01.test.js'), 'utf8'), /\n {2}ready: false,\n/);
});

test('kịch bản theo ticket nằm ở testcases/tickets/<mã thường>.test.js', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-tk-'));
  fs.mkdirSync(path.join(dir, 'tickets'));
  const f = path.join(dir, 'tickets', '1295-qc01.test.js');
  fs.writeFileSync(f, 'module.exports = {}');
  assert.strictEqual(M.findScriptFile('1295-QC01', dir), f);
  assert.strictEqual(M.findScriptFile('1295-QC02', dir), null);
  assert.strictEqual(M.readMeta({ run }, f, '').id, '1295-QC01');
});

test('listHelpers: hàm export có JSDoc ngay trên (tên + tham số + dòng mô tả đầu); bỏ hàm không export; file hỏng báo lỗi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-helpers-'));
  const lib = path.join(dir, 'tickets', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(
    path.join(lib, 'hrm_form.js'),
    [
      '/** Đầu file: không phải hàm */',
      'const x = 1;',
      '/**',
      ' * Tạo 1 đơn OT, trả { start, end }.',
      ' * @param {string} tag',
      ' */',
      'async function createOT(page,',
      '  url, tag) {}',
      '/** Hàm nội bộ */',
      'function hidden() {}',
      'module.exports = { createOT };',
    ].join('\n')
  );
  fs.writeFileSync(path.join(lib, 'z_broken.js'), 'module.exports = {');
  const list = M.listHelpers(dir);
  assert.deepStrictEqual(list[0], { file: 'hrm_form.js', name: 'createOT(page, url, tag)', doc: 'Tạo 1 đơn OT, trả { start, end }.' });
  assert.strictEqual(list.length, 2);
  assert.match(list[1].doc, /không nạp được/);
});

test('mã băm đổi khi hàm dùng chung trong tickets/lib đổi', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-hashlib-'));
  const lib = path.join(root, 'src', 'testcases', 'tickets', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const f = path.join(root, 'src', 'testcases', 'tickets', '1309-ai01.test.js');
  fs.writeFileSync(f, 'a');
  fs.writeFileSync(path.join(lib, 'hrm_form.js'), 'v1');
  const h1 = M.scriptHash(f, root, []);
  fs.writeFileSync(path.join(lib, 'hrm_form.js'), 'v2');
  assert.notStrictEqual(h1, M.scriptHash(f, root, []));
});
