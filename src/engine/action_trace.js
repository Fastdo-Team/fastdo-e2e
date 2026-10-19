// ============================================================================
// action_trace.js: chú thích TỪNG THAO TÁC trên video + con trỏ ảo lướt chậm tới chỗ sắp thao tác.
//
// Kịch bản AI-QC thao tác bằng locator Playwright (locator.click / fill / selectOption…) chứ không qua ctx.click, nên bắt
// ở tầng Playwright: vá 1 lần các hàm thao tác của Frame / ElementHandle / Keyboard / Page (locator.* và page.click(sel)
// đều đi qua Frame). Hàm đã vá chỉ làm thêm việc khi page có page.__fastdoTrace — trang CHÍNH của lượt CÓ QUAY VIDEO
// (case_runner gắn sau khởi động); chạy nháp, trang phụ ctx.as, công cụ khác: gọi thẳng hàm gốc như cũ.
//
// Mỗi thao tác: tả phần tử ngay trong trang (nhãn nút, tên ô nhập, giá trị chọn) → 1 dòng chú thích («Bấm «Lưu»») kèm mốc
// thời gian — video_post vẽ thành dòng dưới khung hình; con trỏ ảo lướt tới giữa phần tử trong cursorMs, dừng pauseMs cho
// người xem kịp thấy rồi mới thao tác. Thao tác lồng nhau (ctx.type = bấm + gõ phím) chỉ ghi dòng ngoài cùng.
// Lỗi khi tả / lướt không bao giờ làm hỏng thao tác thật.
// ============================================================================

const path = require('path');

const RESOLVE_TIMEOUT_MS = 2500;
const DEFAULT_POS = { x: 640, y: 360 };
// Thao tác dùng chuột thật — sau khi lướt thì đưa chuột thật tới đích luôn (Playwright cũng sẽ đưa tới đó khi bấm)
const POINTER_KINDS = new Set(['click', 'dblclick', 'tap', 'hover', 'check', 'uncheck']);

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quote = (s) => `«${s}»`;

/** Tả phần tử — chạy TRONG trang (Playwright chuyển nguyên hàm vào trang, không dùng biến ngoài) */
function describeElement(el, values) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const ICONS =
    '.material-icons,.material-icons-outlined,.material-icons-round,.material-icons-sharp,' +
    '.material-symbols-outlined,.material-symbols-rounded,svg,script,style';
  // innerText giữ khoảng cách giữa các ô (hàng bảng «AI-QC 1309 Đơn từ làm thêm»); bỏ chữ của icon (vd «edit Chỉnh sửa» → «Chỉnh sửa»)
  const textOf = (node) => {
    if (!node) return '';
    let text = typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
    if (node.querySelectorAll) {
      node.querySelectorAll(ICONS).forEach((icon) => {
        const word = norm(icon.textContent);
        if (word) text = text.replace(word, ' ');
      });
    }
    return norm(text);
  };
  const attr = (n) => norm(el.getAttribute && el.getAttribute(n));
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  const type = attr('type').toLowerCase();
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el.isContentEditable);

  let name = attr('aria-label');
  if (!name && attr('aria-labelledby')) {
    name = norm(
      attr('aria-labelledby')
        .split(' ')
        .map((id) => (document.getElementById(id) || {}).textContent || '')
        .join(' ')
    );
  }
  if (!name && el.labels && el.labels.length) name = textOf(el.labels[0]);
  if (!name && (type === 'checkbox' || type === 'radio')) name = textOf(el.closest('label')) || textOf(el.parentElement);
  if (!name && isField) {
    name = attr('placeholder');
    if (!name) {
      const field = el.closest('.field, .form-group');
      const label = field && field.querySelector('label, .label');
      if (label && !label.contains(el)) name = textOf(label);
    }
    // ô chọn có dòng gợi ý đầu (vd «Chọn loại đơn từ», value rỗng) — dòng đó là tên ô
    if (!name && tag === 'select' && el.options.length && !el.options[0].value) name = norm(el.options[0].text);
  }
  if (!name && !isField) name = textOf(el);
  if (!name) name = attr('title') || attr('alt') || (/^(button|submit|reset)$/.test(type) ? attr('value') : '') || attr('name');
  // nút chỉ có icon: dùng tên icon (vd «close») còn hơn để trống
  if (!name && !isField) name = norm(el.textContent);

  let picked = '';
  if (tag === 'select' && Array.isArray(values)) {
    const options = Array.from(el.options);
    picked = values
      .map((v) => {
        const hit =
          v.index != null
            ? options[v.index]
            : options.find(
                (o) =>
                  (v.value != null && o.value === v.value) ||
                  (v.label != null && norm(o.label) === norm(v.label)) ||
                  (v.any != null && (o.value === v.any || norm(o.label) === norm(v.any)))
              );
        return hit ? norm(hit.label || hit.text) : norm(v.label || v.value || v.any || '');
      })
      .filter(Boolean)
      .join(', ');
  }
  return { name: name.slice(0, 120), picked, password: type === 'password' };
}

/** Tên lấy từ selector khi không tả được phần tử (vd internal:role=button[name="Gửi"s] → Gửi) */
function nameFromSelector(selector) {
  const s = String(selector || '');
  const quoted = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (quoted.length) return clean(quoted[quoted.length - 1]);
  const pattern = [...s.matchAll(/(?:name|text)=\/((?:[^/\\]|\\.)+)\//g)].map((m) => m[1]);
  if (pattern.length) return clean(pattern[pattern.length - 1].replace(/\(\^\|\\s\)|\\s|[\^$\\]/g, ' '));
  return '';
}

/** Giá trị selectOption → dạng chuyển được vào trang ({any} = Playwright khớp theo value hoặc nhãn) */
function selectValues(values) {
  const list = values == null ? [] : Array.isArray(values) ? values : [values];
  return list
    .map((v) => {
      if (typeof v === 'string') return { any: v };
      if (v && typeof v === 'object' && typeof v.asElement !== 'function') return { value: v.value, label: v.label, index: v.index };
      return null;
    })
    .filter(Boolean);
}

function fileNames(files) {
  const list = files == null ? [] : Array.isArray(files) ? files : [files];
  return list.map((f) => (typeof f === 'string' ? path.basename(f) : clean(f && f.name))).filter(Boolean).join(', ');
}

function shortUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.pathname}${u.search}`;
  } catch {
    return String(url || '');
  }
}

/** Câu chú thích 1 thao tác */
function actionText(kind, info = {}) {
  const name = info.name ? quote(cut(clean(info.name), 40)) : '';
  const at = name ? ` ở ${name}` : '';
  const shown = info.password ? '••••••' : cut(clean(info.value), 30);
  switch (kind) {
    case 'click':
    case 'tap':
      return name ? `Bấm ${name}` : 'Bấm chuột';
    case 'dblclick':
      return name ? `Bấm đúp ${name}` : 'Bấm đúp chuột';
    case 'hover':
      return name ? `Rê chuột lên ${name}` : 'Rê chuột';
    case 'fill':
      return clean(info.value) === '' ? `Xoá nội dung${name ? ` ${name}` : ''}` : `Nhập ${quote(shown)}${name ? ` vào ${name}` : ''}`;
    case 'type':
      return `Gõ ${quote(shown)}${name ? ` vào ${name}` : ''}`;
    case 'press':
      return `Nhấn phím ${quote(clean(info.key))}${at}`;
    case 'select':
      return `Chọn ${quote(cut(clean(info.picked) || '…', 40))}${at}`;
    case 'check':
      return name ? `Tích chọn ${name}` : 'Tích chọn';
    case 'uncheck':
      return name ? `Bỏ chọn ${name}` : 'Bỏ chọn';
    case 'upload':
      return `Tải tệp ${quote(cut(clean(info.files), 40))} lên${name ? ` ${name}` : ''}`;
    case 'goto':
      return `Mở trang ${cut(shortUrl(info.url), 60)}`;
    case 'reload':
      return 'Tải lại trang';
    default:
      return name ? `${kind} ${name}` : String(kind);
  }
}

/** Chuỗi selector cũ (".//a", "xpath=…", "xpath/…") hoặc CSS → locator phần tử đầu */
function toLocator(page, selector) {
  const s = String(selector);
  return page.locator(/^(\.?\/\/|xpath[=/])/.test(s) ? `xpath=${s.replace(/^xpath[=/]/, '')}` : s).first();
}

/**
 * Nhật ký thao tác của 1 trang đang quay video.
 * @param {object} o
 * @param {object} o.page        trang chính (Playwright)
 * @param {number} o.t0          mốc 0 của video (cùng mốc với steps)
 * @param {number} [o.cursorMs]  thời gian con trỏ lướt tới đích (0 = không lướt)
 * @param {number} [o.pauseMs]   dừng sau khi con trỏ tới đích, trước khi thao tác
 */
function createActionTrace({ page, t0 = Date.now(), cursorMs = 0, pauseMs = 0, clock = () => Date.now(), sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const actions = [];
  let depth = 0;

  async function describe(target, info) {
    const found = await target.evaluate(describeElement, info.values || null, { timeout: RESOLVE_TIMEOUT_MS }).catch(() => null);
    return found || {};
  }

  /**
   * Con trỏ ảo lướt tới giữa phần tử (cuộn vào khung trước nếu đang khuất); chuột thật theo tới nếu là thao tác chuột
   * (pointer = thao tác tự bấm bằng chuột dù loại không phải bấm, vd ctx.type).
   */
  async function pointAt(target, kind, pointer) {
    const viewport = (page.viewportSize && page.viewportSize()) || { width: 1280, height: 720 };
    let box = await target.boundingBox({ timeout: RESOLVE_TIMEOUT_MS }).catch(() => null);
    const outside = (b) => b.y < 0 || b.x < 0 || b.y + b.height > viewport.height || b.x + b.width > viewport.width;
    if (box && outside(box)) {
      await target.scrollIntoViewIfNeeded({ timeout: RESOLVE_TIMEOUT_MS }).catch(() => {});
      box = await target.boundingBox({ timeout: RESOLVE_TIMEOUT_MS }).catch(() => null);
    }
    if (!box || box.width <= 0 || box.height <= 0) return; // phần tử ẩn (ô chọn tuỳ biến…) — chỉ chú thích
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const from = page.__fastdoCursor || page.__fastdoMouse || DEFAULT_POS;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance >= 2) {
      // quãng ngắn lướt nhanh hơn, tối thiểu 40% cursorMs
      const ms = Math.round(cursorMs * Math.min(1, Math.max(0.4, distance / 600)));
      await page
        .evaluate(([fx, fy, tx, ty, d]) => (window.__fastdoGlide ? window.__fastdoGlide(fx, fy, tx, ty, d) : null), [from.x, from.y, to.x, to.y, ms])
        .catch(() => {});
    }
    page.__fastdoCursor = to;
    if (pointer || POINTER_KINDS.has(kind)) {
      await page.mouse.move(to.x, to.y);
      page.__fastdoMouse = to;
    }
  }

  /**
   * Ghi chú thích + đưa con trỏ tới rồi mới chạy action(). target: Locator / ElementHandle / chuỗi selector / null.
   * Thao tác lỗi → dòng chú thích có ok = false; lỗi ném tiếp nguyên vẹn.
   */
  async function run(kind, target, info, action) {
    if (depth > 0) return action();
    depth += 1;
    const entry = { ms: clock() - t0, text: '', ok: true };
    actions.push(entry);
    try {
      try {
        const element = typeof target === 'string' ? toLocator(page, target) : target;
        const found = element ? await describe(element, info) : {};
        entry.text = actionText(kind, { ...info, ...found, name: found.name || nameFromSelector(info.selector) });
        if (element && cursorMs > 0) await pointAt(element, kind, Boolean(info.pointer));
        if (element && pauseMs > 0) await wait(pauseMs);
      } catch {
        if (!entry.text) entry.text = actionText(kind, { ...info, name: nameFromSelector(info.selector) });
      }
      return await action();
    } catch (err) {
      entry.ok = false;
      throw err;
    } finally {
      depth -= 1;
    }
  }

  return { actions, run };
}

// --- Vá Playwright (1 lần / tiến trình) --------------------------------------

// Hàm thao tác → loại chú thích; withValue = có tham số giá trị đứng trước options
const SPECS = {
  click: { kind: 'click' },
  dblclick: { kind: 'dblclick' },
  tap: { kind: 'tap' },
  hover: { kind: 'hover' },
  check: { kind: 'check' },
  uncheck: { kind: 'uncheck' },
  fill: { kind: 'fill', withValue: true, info: (v) => ({ value: v }) },
  type: { kind: 'type', withValue: true, info: (v) => ({ value: v }) },
  press: { kind: 'press', withValue: true, info: (k) => ({ key: k }) },
  selectOption: { kind: 'select', withValue: true, info: (v) => ({ values: selectValues(v) }) },
  setInputFiles: { kind: 'upload', withValue: true, info: (f) => ({ files: fileNames(f) }) },
};

const traceOf = (page) => (page && page.__fastdoTrace) || null;
const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

function patch(proto, names, wrap) {
  if (!proto) return;
  for (const name of names) {
    const orig = proto[name];
    if (typeof orig !== 'function' || orig.__fastdoTraced) continue;
    const wrapped = wrap(name, orig);
    wrapped.__fastdoTraced = true;
    proto[name] = wrapped;
  }
}

// frame.click(selector, options) — đường của locator.click() và page.click(selector)
function wrapFrame(name, orig) {
  const spec = SPECS[name];
  return function (selector, ...rest) {
    const trace = traceOf(safe(() => this.page()));
    if (!trace) return orig.call(this, selector, ...rest);
    const options = spec.withValue ? rest[1] : rest[0];
    const target = safe(() => (options && options.strict ? this.locator(selector) : this.locator(selector).first()));
    const info = { ...(spec.info ? spec.info(rest[0]) : {}), selector };
    return trace.run(spec.kind, target, info, () => orig.call(this, selector, ...rest));
  };
}

// elementHandle.click(options) — phần tử lấy từ page.$(…)
function wrapHandle(name, orig) {
  const spec = SPECS[name];
  return function (...args) {
    const trace = traceOf(safe(() => this._frame && this._frame.page()));
    if (!trace) return orig.apply(this, args);
    return trace.run(spec.kind, this, spec.info ? spec.info(args[0]) : {}, () => orig.apply(this, args));
  };
}

function wrapKeyboard(name, orig) {
  return function (...args) {
    const trace = traceOf(this._page);
    if (!trace) return orig.apply(this, args);
    const info = name === 'press' ? { key: args[0] } : { value: args[0] };
    return trace.run(name, null, info, () => orig.apply(this, args));
  };
}

function wrapPage(name, orig) {
  return function (...args) {
    const trace = traceOf(this);
    if (!trace) return orig.apply(this, args);
    return trace.run(name, null, name === 'goto' ? { url: args[0] } : {}, () => orig.apply(this, args));
  };
}

/** Vá các lớp Playwright từ 1 page thật (lấy prototype qua đối tượng sống). Không bao giờ ném lỗi. */
async function installActionHooks(page) {
  try {
    patch(Object.getPrototypeOf(page.mainFrame()), Object.keys(SPECS), wrapFrame);
    patch(Object.getPrototypeOf(page.keyboard), ['press', 'type'], wrapKeyboard);
    patch(Object.getPrototypeOf(page), ['goto', 'reload'], wrapPage);
    const handle = await page.evaluateHandle(() => document.documentElement);
    const element = handle && handle.asElement();
    if (element) patch(Object.getPrototypeOf(element), Object.keys(SPECS), wrapHandle);
    if (handle) await handle.dispose().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createActionTrace,
  installActionHooks,
  actionText,
  nameFromSelector,
  selectValues,
  fileNames,
  describeElement,
};
