const config = require('./src/config');
const { initBrowser } = require('./src/core/browser');
const { ensureAuthenticated } = require('./src/core/session');
const { waitForSettle } = require('./src/core/page_ready');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { browser, page } = await initBrowser();
  await ensureAuthenticated(page);

  const url = new URL(
    '/evaluation?tab=cycle&view=readonly&id=26090903024284Q2DVQK0GTCDY43WYXQ',
    config.TARGET_URL
  ).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const settle = await waitForSettle(page, 20000, 'Xuất Excel');
  console.log('SETTLE:', JSON.stringify(settle));
  await sleep(500);

  const requests = [];
  page.on('request', (req) => {
    requests.push({ t: Date.now(), url: req.url(), method: req.method() });
  });
  const consoleMsgs = [];
  page.on('console', (msg) => consoleMsgs.push(msg.text()));

  const cdp = await page.target().createCDPSession();
  const downloads = [];
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  cdp.on('Page.downloadWillBegin', (e) => downloads.push({ t: Date.now(), url: e.url, guid: e.guid }));
  await cdp.send('Page.enable').catch(() => {});

  const btnHandle = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Xuất Excel')
  );
  const btn = btnHandle.asElement();
  const box = await btn.boundingBox();
  console.log('BOUNDING BOX:', JSON.stringify(box));
  const elAtPoint = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.outerHTML.slice(0, 200) : null;
  }, box.x + box.width / 2, box.y + box.height / 2);
  console.log('ELEMENT AT CLICK POINT:', elAtPoint);

  const overlayInfo = await page.evaluate(() => {
    const el = document.getElementById('custom-loading');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, innerText: el.innerText.slice(0,100) };
  });
  console.log('OVERLAY INFO:', JSON.stringify(overlayInfo));

  browser.on('targetcreated', (t) => console.log('[NEW TARGET]', t.url()));

  const t0 = Date.now();
  const stateLog = [];
  const poll = setInterval(async () => {
    try {
      const state = await page.evaluate((b) => ({
        disabled: b.disabled,
        html: b.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 150),
      }), btn);
      stateLog.push({ t: Date.now() - t0, ...state });
    } catch (e) {}
  }, 100);

  await btn.click();
  await sleep(50);
  await btn.click();
  await sleep(50);
  await btn.click();
  await sleep(50);
  await btn.click();

  await sleep(6000);
  clearInterval(poll);

  console.log('STATE LOG (chỉ đổi):');
  let last = null;
  stateLog.forEach((s) => {
    const key = s.disabled + '|' + s.html;
    if (key !== last) { console.log(`  t=${s.t}ms disabled=${s.disabled} html="${s.html}"`); last = key; }
  });
  console.log('ALL REQUESTS SAU CLICK:', JSON.stringify(requests.map(r => ({ t: r.t - t0, url: r.url, method: r.method })), null, 2));
  console.log('DOWNLOADS:', JSON.stringify(downloads.map(d => ({ t: d.t - t0, url: d.url })), null, 2));
  console.log('CONSOLE:', JSON.stringify(consoleMsgs));

  browser.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
