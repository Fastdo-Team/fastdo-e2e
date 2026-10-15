const test = require('node:test');
const assert = require('node:assert');
const { guardPage } = require('./page_guard');

function fakePage() {
  const calls = [];
  const rec = (name) => async (...args) => {
    calls.push([name, args.length]);
    return name;
  };
  return {
    calls,
    evaluate: rec('evaluate'),
    evaluateHandle: rec('evaluateHandle'),
    waitForFunction: rec('waitForFunction'),
    $: rec('$'),
    $$: rec('$$'),
    waitForSelector: rec('waitForSelector'),
    $eval: rec('$eval'),
    $$eval: rec('$$eval'),
  };
}

test('evaluate / evaluateHandle nhiều tham số → lỗi HỢP ĐỒNG KỊCH BẢN (Playwright âm thầm bỏ tham số thứ 2)', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.evaluate((a, b) => a + b, 1, 2), /HỢP ĐỒNG KỊCH BẢN.*chỉ nhận 1 tham số/);
  assert.throws(() => p.evaluateHandle((a) => a, 1, 2), /HỢP ĐỒNG KỊCH BẢN/);
});

test('evaluate 0 hoặc 1 tham số đi thẳng qua', async () => {
  const p = guardPage(fakePage());
  assert.strictEqual(await p.evaluate(() => 1), 'evaluate');
  assert.strictEqual(await p.evaluate(([a, b]) => a + b, [1, 2]), 'evaluate');
});

test('waitForFunction kiểu Puppeteer (fn, {timeout}, arg) hoặc (fn, {timeout}) → lỗi', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.waitForFunction(() => true, { timeout: 5, polling: 200 }, 'x'), /thứ tự Puppeteer/);
  assert.throws(() => p.waitForFunction(() => true, { timeout: 5, polling: 200 }), /thứ tự Puppeteer/);
});

test('waitForFunction kiểu Playwright (fn, arg, {timeout}) đi thẳng qua', async () => {
  const p = guardPage(fakePage());
  assert.strictEqual(await p.waitForFunction((n) => n, 3, { timeout: 5 }), 'waitForFunction');
  assert.strictEqual(await p.waitForFunction(() => true, null, { timeout: 5 }), 'waitForFunction');
});

test('selector "xpath/…" (Puppeteer) → lỗi chỉ đúng cú pháp "xpath=…"', () => {
  const p = guardPage(fakePage());
  assert.throws(() => p.$('xpath/.//a'), /xpath=/);
  assert.throws(() => p.$$('xpath/.//a'), /xpath=/);
  assert.throws(() => p.waitForSelector('xpath/.//a'), /xpath=/);
  assert.throws(() => p.$eval('xpath/.//a', (e) => e), /xpath=/);
});

test('bọc 2 lần không bọc chồng', () => {
  const inner = fakePage();
  const once = guardPage(inner);
  const twice = guardPage(once);
  assert.strictEqual(twice, once);
  const wrapped = once.evaluate;
  guardPage(once);
  assert.strictEqual(once.evaluate, wrapped);
});
