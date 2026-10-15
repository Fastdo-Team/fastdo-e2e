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

test('kịch bản theo ticket nằm ở testcases/tickets/<mã thường>.test.js', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2-tk-'));
  fs.mkdirSync(path.join(dir, 'tickets'));
  const f = path.join(dir, 'tickets', '1295-qc01.test.js');
  fs.writeFileSync(f, 'module.exports = {}');
  assert.strictEqual(M.findScriptFile('1295-QC01', dir), f);
  assert.strictEqual(M.findScriptFile('1295-QC02', dir), null);
  assert.strictEqual(M.readMeta({ run }, f, '').id, '1295-QC01');
});
