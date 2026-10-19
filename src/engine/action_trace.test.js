const test = require('node:test');
const assert = require('node:assert');
const { createActionTrace, actionText, nameFromSelector, selectValues, fileNames } = require('./action_trace');

test('câu chú thích theo loại thao tác', () => {
  assert.strictEqual(actionText('click', { name: 'Lưu' }), 'Bấm «Lưu»');
  assert.strictEqual(actionText('click', {}), 'Bấm chuột');
  assert.strictEqual(actionText('fill', { name: 'Nhập lý do...', value: 'AI-QC 1309' }), 'Nhập «AI-QC 1309» vào «Nhập lý do...»');
  assert.strictEqual(actionText('fill', { name: 'Lý do', value: '' }), 'Xoá nội dung «Lý do»');
  assert.strictEqual(actionText('fill', { name: 'Mật khẩu', value: 'bí mật', password: true }), 'Nhập «••••••» vào «Mật khẩu»');
  assert.strictEqual(actionText('select', { name: 'Chọn loại đơn từ', picked: 'Đơn từ làm thêm' }), 'Chọn «Đơn từ làm thêm» ở «Chọn loại đơn từ»');
  assert.strictEqual(actionText('select', { picked: '01:20' }), 'Chọn «01:20»');
  assert.strictEqual(actionText('press', { key: 'Enter' }), 'Nhấn phím «Enter»');
  assert.strictEqual(actionText('press', { key: 'Enter', name: 'Tìm kiếm' }), 'Nhấn phím «Enter» ở «Tìm kiếm»');
  assert.strictEqual(actionText('type', { value: 'abc' }), 'Gõ «abc»');
  assert.strictEqual(actionText('check', { name: 'Cho phép OT qua ngày' }), 'Tích chọn «Cho phép OT qua ngày»');
  assert.strictEqual(actionText('uncheck', { name: 'X' }), 'Bỏ chọn «X»');
  assert.strictEqual(actionText('upload', { files: 'a.png', name: 'Tệp' }), 'Tải tệp «a.png» lên «Tệp»');
  assert.strictEqual(actionText('goto', { url: 'http://localhost:5200/hrm/form?tab=2' }), 'Mở trang /hrm/form?tab=2');
  assert.strictEqual(actionText('reload'), 'Tải lại trang');
  assert.strictEqual(actionText('click', { name: 'x'.repeat(60) }).length, 'Bấm «»'.length + 40);
});

test('tên lấy từ selector khi không tả được phần tử', () => {
  assert.strictEqual(nameFromSelector('internal:role=button[name="Gửi"s]'), 'Gửi');
  assert.strictEqual(nameFromSelector('internal:role=button[name=/(^|\\s)Chỉnh sửa$/] >> nth=0'), 'Chỉnh sửa');
  assert.strictEqual(nameFromSelector('internal:text="Tạo mới"s >> nth=0'), 'Tạo mới');
  assert.strictEqual(nameFromSelector('select'), '');
  assert.strictEqual(nameFromSelector(undefined), '');
});

test('giá trị selectOption / setInputFiles đổi sang dạng chuyển được vào trang', () => {
  assert.deepStrictEqual(selectValues('01:20'), [{ any: '01:20' }]);
  assert.deepStrictEqual(selectValues({ label: 'Ngày nghỉ' }), [{ value: undefined, label: 'Ngày nghỉ', index: undefined }]);
  assert.deepStrictEqual(selectValues([{ index: 2 }, { asElement() {} }]), [{ value: undefined, label: undefined, index: 2 }]);
  assert.deepStrictEqual(selectValues(null), []);
  assert.strictEqual(fileNames(['C:\\tmp\\a.png', { name: 'b.pdf' }]), 'a.png, b.pdf');
});

function fakePage() {
  const calls = { glides: [], moves: [] };
  const page = {
    calls,
    viewportSize: () => ({ width: 1280, height: 720 }),
    evaluate: async (fn, args) => {
      calls.glides.push(args);
    },
    mouse: {
      move: async (x, y) => {
        calls.moves.push([x, y]);
      },
    },
  };
  return page;
}

function fakeTarget({ name = 'Lưu', box = { x: 100, y: 100, width: 50, height: 20 }, failDescribe = false } = {}) {
  const target = {
    scrolled: 0,
    evaluate: async () => {
      if (failDescribe) throw new Error('strict mode violation');
      return { name, picked: '', password: false };
    },
    boundingBox: async () => (typeof box === 'function' ? box(target) : box),
    scrollIntoViewIfNeeded: async () => {
      target.scrolled += 1;
    },
  };
  return target;
}

test('thao tác chuột: ghi chú thích, con trỏ lướt từ vị trí trước tới giữa phần tử, chuột thật theo tới, dừng rồi mới bấm', async () => {
  const page = fakePage();
  const sleeps = [];
  let clock = 1050;
  const trace = createActionTrace({ page, t0: 1000, cursorMs: 600, pauseMs: 400, clock: () => clock, sleep: async (ms) => sleeps.push(ms) });
  const order = [];
  const result = await trace.run('click', fakeTarget(), {}, async () => {
    order.push('action');
    return 'xong';
  });
  assert.strictEqual(result, 'xong');
  assert.deepStrictEqual(trace.actions, [{ ms: 50, text: 'Bấm «Lưu»', ok: true }]);
  assert.deepStrictEqual(page.calls.glides, [[640, 360, 125, 110, Math.round(Math.hypot(515, 250))]]);
  assert.deepStrictEqual(page.calls.moves, [[125, 110]]);
  assert.deepStrictEqual(page.__fastdoMouse, { x: 125, y: 110 });
  assert.deepStrictEqual(sleeps, [400]);
  assert.deepStrictEqual(order, ['action']);

  // thao tác kế tiếp lướt từ chỗ cũ; quãng ngắn → tối thiểu 40% cursorMs
  await trace.run('click', fakeTarget({ box: { x: 110, y: 100, width: 50, height: 20 } }), {}, async () => {});
  assert.deepStrictEqual(page.calls.glides[1], [125, 110, 135, 110, 240]);
});

test('ô nhập (không phải thao tác chuột): con trỏ lướt tới nhưng chuột thật đứng yên', async () => {
  const page = fakePage();
  const trace = createActionTrace({ page, cursorMs: 600, sleep: async () => {} });
  await trace.run('fill', fakeTarget({ name: 'Nhập lý do...' }), { value: 'abc' }, async () => {});
  assert.strictEqual(trace.actions[0].text, 'Nhập «abc» vào «Nhập lý do...»');
  assert.strictEqual(page.calls.glides.length, 1);
  assert.deepStrictEqual(page.calls.moves, []);
  assert.deepStrictEqual(page.__fastdoCursor, { x: 125, y: 110 });
  assert.strictEqual(page.__fastdoMouse, undefined);

  // ctx.type tự bấm vào ô → pointer: chuột thật theo tới
  await trace.run('type', fakeTarget(), { value: 'x', pointer: true }, async () => {});
  assert.strictEqual(page.calls.moves.length, 1);
});

test('phần tử khuất khỏi khung: cuộn vào rồi mới đo lại vị trí', async () => {
  const page = fakePage();
  const trace = createActionTrace({ page, cursorMs: 600, sleep: async () => {} });
  const target = fakeTarget({ box: (t) => (t.scrolled ? { x: 100, y: 300, width: 40, height: 20 } : { x: 100, y: 1500, width: 40, height: 20 }) });
  await trace.run('click', target, {}, async () => {});
  assert.strictEqual(target.scrolled, 1);
  assert.deepStrictEqual(page.calls.moves, [[120, 310]]);
});

test('thao tác lồng bên trong (ctx.type = bấm + gõ) chỉ ghi 1 dòng; lỗi → ok=false, ném lỗi nguyên vẹn, thao tác sau vẫn ghi', async () => {
  const page = fakePage();
  const trace = createActionTrace({ page, sleep: async () => {} });
  await trace.run('type', fakeTarget({ name: 'Tên' }), { value: 'abc' }, async () => {
    await trace.run('click', fakeTarget({ name: 'Tên' }), {}, async () => {});
    await trace.run('type', null, { value: 'abc' }, async () => {});
  });
  assert.deepStrictEqual(trace.actions.map((a) => a.text), ['Gõ «abc» vào «Tên»']);

  await assert.rejects(
    trace.run('click', fakeTarget({ name: 'Gửi' }), {}, async () => {
      throw new Error('Timeout 30000ms');
    }),
    /Timeout 30000ms/
  );
  await trace.run('press', null, { key: 'Escape' }, async () => {});
  assert.deepStrictEqual(trace.actions.slice(1).map((a) => [a.text, a.ok]), [
    ['Bấm «Gửi»', false],
    ['Nhấn phím «Escape»', true],
  ]);
});

test('không tả được phần tử (trùng nhiều phần tử, chưa có trên trang) → tên lấy từ selector; cursorMs 0 → không lướt', async () => {
  const page = fakePage();
  const trace = createActionTrace({ page, sleep: async () => {} });
  await trace.run('click', fakeTarget({ failDescribe: true }), { selector: 'internal:role=button[name="Gửi"s]' }, async () => {});
  assert.strictEqual(trace.actions[0].text, 'Bấm «Gửi»');
  assert.deepStrictEqual(page.calls.glides, []);
  assert.deepStrictEqual(page.calls.moves, []);
});
