const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, ArgError } = require('../runner');

const parse = (...argv) => parseArgs(argv, 1);

test('--nhap = không upload, không ghi Sheet, không quay (trừ khi --video)', () => {
  const o = parse('EVAL_021', '--nhap');
  assert.deepStrictEqual([o.mode, o.record, o.upload, o.sheet], ['nhap', false, false, false]);
  assert.strictEqual(parse('EVAL_021', '--nhap', '--video').record, true);
  assert.strictEqual(parse('EVAL_021', '--dry').mode, 'nhap');
});

test('tương thích cũ: --no-record --no-sheet / --no-upload --no-sheet là chạy nháp', () => {
  assert.strictEqual(parse('EVAL_021', '--no-record', '--no-sheet').mode, 'nhap');
  const o = parse('EVAL_021', '--no-upload', '--no-sheet');
  assert.deepStrictEqual([o.mode, o.record], ['nhap', true]);
  assert.strictEqual(parse('EVAL_021', '--sheet-on=never', '--no-record', '--no-upload').mode, 'nhap');
});

test('chạy thật đủ video + upload + Sheet, mặc định --sheet-on=pass', () => {
  const o = parse('eval_021', '--round=3');
  assert.deepStrictEqual([o.mode, o.record, o.upload, o.sheet, o.round, o.caseIds[0], o.sheetOn], ['that', true, true, true, 3, 'EVAL_021', 'pass']);
});

test('--no-sheet đơn lẻ = chạy thật không ghi Sheet (vẫn quay, vẫn upload), không bắt --round', () => {
  const o = parse('EVAL_021', '--no-sheet');
  assert.deepStrictEqual([o.mode, o.record, o.upload, o.sheet], ['that', true, true, false]);
});

test('[QUY TRÌNH] chạy thật có ghi Sheet mà thiếu --round → từ chối', () => {
  assert.throws(() => parse('EVAL_021'), (e) => e instanceof ArgError && /--round=N/.test(e.message));
});

test('[QUY TRÌNH] chạy thật mà tắt video / upload → từ chối, gợi ý --nhap', () => {
  assert.throws(() => parse('EVAL_021', '--round=1', '--no-record'), /luôn quay và upload.*--nhap/);
  assert.throws(() => parse('EVAL_021', '--round=1', '--no-upload'), /luôn quay và upload/);
});

test('[QUY TRÌNH] --sheet-on=always bị từ chối (FAIL phải qua duyệt)', () => {
  assert.throws(() => parse('EVAL_021', '--round=1', '--sheet-on=always'), /không còn dùng được.*duyệt/);
});

test('cờ gõ sai / số sai / mã sai → từ chối, không nuốt im lặng', () => {
  assert.throws(() => parse('EVAL_021', '--nosheet'), /Cờ không hợp lệ: "--nosheet"/);
  assert.throws(() => parse('EVAL_021', '--round='), /số nguyên dương/);
  assert.throws(() => parse('EVAL_021', '--round=abc'), /số nguyên dương/);
  assert.throws(() => parse('../../etc', '--nhap'), /không phải mã testcase/);
  assert.throws(() => parse('EVAL_021', '--profile=Nhân Viên', '--nhap'), /tên hồ sơ/);
  assert.throws(() => parse('EVAL_021', '--nhap', '--report-json=package.json'), /runs\//);
});

test('--account=2 → hồ sơ slot2 (tương thích); --profile đè lên', () => {
  assert.strictEqual(parseArgs(['EVAL_021', '--nhap'], 2).profile, 'slot2');
  assert.strictEqual(parseArgs(['EVAL_021', '--nhap', '--profile=nhanvien'], 2).profile, 'nhanvien');
});

test('mã case theo ticket (AI-QC): 1295-QC01 / 1295-AI02 được nhận, giữ nguyên dạng hoa', () => {
  assert.deepStrictEqual(parse('1295-qc01', '1295-AI02', '--nhap').caseIds, ['1295-QC01', '1295-AI02']);
  assert.throws(() => parse('1295-QC1', '--nhap'), /không phải mã testcase/);
  assert.throws(() => parse('1295-XX01', '--nhap'), /không phải mã testcase/);
  assert.throws(() => parse('1295-QC01/../x', '--nhap'), /không phải mã testcase/);
});
