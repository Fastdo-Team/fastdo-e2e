// ============================================================================
// dom_digest.js: Sinh "digest" ngữ nghĩa của DOM dưới dạng text để đọc bằng mắt
// (hoặc bằng AI) thay cho việc chụp màn hình.
//
// Đây là NGUỒN DUY NHẤT sinh digest, dùng ở 3 nơi:
//   1. src/tools/probe.js   - khám phá trang trước khi viết testcase
//   2. ctx.dump() trong runner - dump tại đúng dòng đang bí của case đang viết
//   3. src/core/diagnostics.js - tự ghi vào báo cáo khi case FAIL/crash
// Nếu tách thành nhiều bản, cờ độ tin cậy sẽ chỉ đúng ở 1 nơi rồi trôi dần.
//
// Giá trị lớn nhất không phải danh sách element, mà là các CỜ ĐỘ TIN CẬY:
// "BỊ CHE" phát hiện element bị lớp phủ chặn - đúng lỗi từng đốt nhiều giờ nhất
// của bộ test này (popup "Bật thông báo đẩy" phủ lên bảng, click vào nút "Sửa"
// im lặng không có tác dụng và KHÔNG ném lỗi nào).
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DIAGNOSTICS_DIR = path.join(config.ROOT_DIR, 'diagnostics');

/**
 * Hàm chạy TRONG page. Không được tham chiếu biến Node bên ngoài - mọi thứ cần
 * dùng phải truyền qua `opts`.
 */
/* eslint-disable */
function collectInPage(opts) {
  const CANDIDATE_SELECTOR = [
    'a', 'button', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="tab"]', '[role="checkbox"]',
    '[onclick]', '[contenteditable="true"]', 'label[for]',
  ].join(',');

  // Lớp phủ theo Bulma (framework chính của Blazor Fastdo) + role chuẩn
  const OVERLAY_SELECTOR =
    '.modal, .modal-background, .modal-card, .modal-content, [role="dialog"], ' +
    '[role="alertdialog"], .notification, .toast, .dropdown-menu';

  // Class tổ tiên "có nghĩa" - dùng làm mốc neo cho selector CSS, thay vì bò
  // ngược lên tận <body> tạo ra chuỗi nth-of-type dài và cực giòn.
  const ANCHOR_CLASSES = [
    'box', 'modal', 'modal-card', 'card', 'panel', 'notification', 'dropdown',
    'navbar', 'menu', 'table', 'tabs', 'media', 'level', 'tile',
  ];

  const shrink = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /** id do Blazor/framework sinh tự động thì không dùng làm selector được */
  function isGeneratedId(id) {
    if (!id) return true;
    if (/[0-9a-f]{8,}/i.test(id)) return true;   // hash/guid
    if (/\d{6,}/.test(id)) return true;          // timestamp
    return false;
  }

  function esc(v) {
    return window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
  }

  function countCss(sel) {
    try {
      return document.querySelectorAll(sel).length;
    } catch (e) {
      return -1;
    }
  }

  function countXPath(xp) {
    try {
      return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        .snapshotLength;
    } catch (e) {
      return -1;
    }
  }

  function describeElement(el) {
    if (!el || !el.tagName) return '(không rõ)';
    let out = el.tagName.toLowerCase();
    if (el.id && !isGeneratedId(el.id)) out += '#' + el.id;
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (cls.length) out += '.' + cls.join('.');
    return out;
  }

  function elementName(el) {
    const tag = el.tagName.toLowerCase();
    const parts = [];

    const text = shrink(el.innerText || el.textContent);
    if (text) parts.push('"' + cut(text, 60) + '"');

    for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
      const v = shrink(el.getAttribute(attr));
      if (v) parts.push(attr + '="' + cut(v, 40) + '"');
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = shrink(el.value);
      if (v) parts.push('val="' + cut(v, 30) + '"');
      if (el.type === 'checkbox' || el.type === 'radio') parts.push(el.checked ? '[đã chọn]' : '[chưa chọn]');
    }

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && href !== '#' && !text) parts.push('href="' + cut(href, 40) + '"');
    }

    return parts.join(' ') || '(không có nhãn)';
  }

  /**
   * Chọn selector theo thứ tự ưu tiên độ bền, dừng ở cái đầu tiên định danh
   * duy nhất. Trả kèm số element khớp để người viết biết selector có giòn không.
   */
  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    if (el.id && !isGeneratedId(el.id)) candidates.push('#' + esc(el.id));

    for (const attr of Array.from(el.attributes)) {
      if (attr.name.indexOf('data-') === 0 && attr.value && attr.value.length < 40) {
        candidates.push(tag + '[' + attr.name + '="' + attr.value + '"]');
      }
    }

    for (const attr of ['placeholder', 'aria-label', 'name', 'title']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 60) candidates.push(tag + '[' + attr + '="' + v + '"]');
    }

    for (const sel of candidates) {
      const n = countCss(sel);
      if (n === 1) return { selector: sel, matches: 1, kind: 'attr' };
    }

    // text-XPath: bám chữ hiển thị, bền hơn nth-of-type khi Blazor render lại
    const text = shrink(el.innerText || el.textContent);
    if (text && text.length <= 60) {
      const safe = text.replace(/"/g, '');
      const xp =
        text.length > 40
          ? './/' + tag + '[contains(., "' + safe.slice(0, 40) + '")]'
          : './/' + tag + '[normalize-space()="' + safe + '"]';
      const n = countXPath(xp);
      if (n === 1) return { selector: 'xpath: ' + xp, matches: 1, kind: 'text' };
      if (n > 1) candidates.push('xpath: ' + xp);
    }

    // Neo vào tổ tiên có class "có nghĩa" rồi đi xuống bằng nth-of-type
    let anchor = null;
    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const cls = (node.className && typeof node.className === 'string' ? node.className : '').split(/\s+/);
      if ((node.id && !isGeneratedId(node.id)) || cls.some((c) => ANCHOR_CLASSES.indexOf(c) >= 0)) {
        anchor = node;
        break;
      }
      node = node.parentElement;
      depth++;
    }

    function nthPath(from, to) {
      const chain = [];
      let cur = to;
      while (cur && cur !== from && chain.length < 4) {
        const parent = cur.parentElement;
        if (!parent) break;
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        const t = cur.tagName.toLowerCase();
        chain.unshift(same.length > 1 ? t + ':nth-of-type(' + (same.indexOf(cur) + 1) + ')' : t);
        cur = parent;
      }
      return chain.join(' > ');
    }

    if (anchor) {
      const anchorCls = (anchor.className && typeof anchor.className === 'string' ? anchor.className : '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3);
      let anchorSel =
        anchor.id && !isGeneratedId(anchor.id)
          ? '#' + esc(anchor.id)
          : anchor.tagName.toLowerCase() + (anchorCls.length ? '.' + anchorCls.join('.') : '');

      // :nth-of-type là thứ tự GIỮA CÁC ANH EM CÙNG TAG, không phải thứ tự trong
      // document. Lấy theo thứ tự document sẽ sinh ra selector khớp 0 element.
      if (document.querySelectorAll(anchorSel).length > 1 && anchor.parentElement) {
        const sibs = Array.from(anchor.parentElement.children).filter(
          (c) => c.tagName === anchor.tagName
        );
        if (sibs.length > 1) {
          anchorSel += ':nth-of-type(' + (sibs.indexOf(anchor) + 1) + ')';
        }
      }

      const basePath = nthPath(anchor, el);
      let full = (anchorSel + ' ' + basePath).trim();
      let n = countCss(full);

      // nth-of-type một mình hay bị trùng (2 nhóm đều có input). Làm rõ leaf
      // bằng attribute phân biệt - đúng dạng selector các testcase đang dùng:
      // div.box.mb-4:nth-of-type(1) input[placeholder="Tên nhóm"]
      if (n !== 1 && basePath) {
        for (const attr of ['placeholder', 'type', 'aria-label', 'name', 'title']) {
          const v = el.getAttribute(attr);
          if (!v || v.length > 60) continue;
          const chain = basePath.split(' > ');
          chain[chain.length - 1] = el.tagName.toLowerCase() + '[' + attr + '="' + v + '"]';
          const candidate = (anchorSel + ' ' + chain.join(' > ')).trim();
          const cn = countCss(candidate);
          if (cn === 1) {
            full = candidate;
            n = 1;
            break;
          }
          if (cn > 0 && cn < n) {
            full = candidate;
            n = cn;
          }
        }
      }

      return { selector: full, matches: n, kind: 'path' };
    }

    const fallback = nthPath(document.body, el);
    return { selector: fallback || tag, matches: countCss(fallback || tag), kind: 'path' };
  }

  // ---- Thu thập ------------------------------------------------------------
  const seen = new Set();
  const rows = [];
  let hiddenCount = 0;

  const all = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR));

  for (const el of all) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.id === '__fake_cursor') continue;

    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const isHidden =
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      parseFloat(cs.opacity || '1') === 0 ||
      rect.width === 0 ||
      rect.height === 0 ||
      (el.offsetParent === null && cs.position !== 'fixed');

    if (isHidden) {
      hiddenCount++;
      if (!opts.all) continue;
    }

    const flags = [];
    if (isHidden) flags.push('[ẩn]');

    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') flags.push('[disabled]');

    const overlayAncestor = el.closest(OVERLAY_SELECTOR);
    const inOverlay =
      overlayAncestor && window.getComputedStyle(overlayAncestor).display !== 'none';
    if (inOverlay) flags.push('⚠ TRONG OVERLAY');

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const outOfViewport =
      !isHidden && (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight);
    if (outOfViewport) flags.push('⚠ NGOÀI VIEWPORT');

    // Phép thử quyết định: click vào tâm element sẽ trúng ai?
    if (!isHidden && !outOfViewport) {
      let top = document.elementFromPoint(cx, cy);
      if (top && top.id === '__fake_cursor') top = null;
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        // Phân biệt 2 mức để cờ ⚠ giữ được sức nặng. Phân loại theo HÌNH HỌC,
        // không theo danh sách class: popup chặn click có thể không mang class
        // .modal/.notification nào (đúng ca popup "Bật thông báo đẩy" đã đốt
        // nhiều giờ), phân loại theo class sẽ đánh mất chính ca đó.
        //
        //  - trang trí trong chính field (icon, span) - cùng element cha, nhỏ hơn
        //    và không trùm hết target: thường vẫn click được → chỉ ghi chú
        //  - còn lại: có thứ khác đè lên từ ngoài → ⚠ BỊ CHE
        const topRect = top.getBoundingClientRect();
        const coversTarget =
          topRect.left <= rect.left &&
          topRect.top <= rect.top &&
          topRect.right >= rect.right &&
          topRect.bottom >= rect.bottom;
        const sameField = !!(el.parentElement && el.parentElement.contains(top));
        const smaller = topRect.width * topRect.height < rect.width * rect.height;

        if (sameField && smaller && !coversTarget) {
          flags.push('· click tâm trúng ' + describeElement(top));
        } else {
          const topOverlay = top.closest(OVERLAY_SELECTOR);
          const where =
            topOverlay && topOverlay !== top ? ` (trong ${describeElement(topOverlay)})` : '';
          flags.push('⚠ BỊ CHE bởi ' + describeElement(top) + where);
        }
      }
    }

    let tagLabel = el.tagName.toLowerCase();
    if (tagLabel === 'input' && el.type) tagLabel += '[' + el.type + ']';
    if (el.getAttribute('role') && tagLabel !== el.getAttribute('role')) {
      tagLabel += '{' + el.getAttribute('role') + '}';
    }

    const sel = buildSelector(el);

    // Tier cuối là đường CSS theo vị trí (nth-of-type). Nó ĐÚNG lúc đo nhưng vỡ
    // ngay khi Blazor render lại danh sách hoặc thêm/xoá 1 dòng. Nói rõ ra để
    // người viết cân nhắc bám text/attribute, hoặc xin thêm data-testid vào app.
    if (sel.kind === 'path') flags.push('⚠ SELECTOR THEO VỊ TRÍ');

    rows.push({
      tag: tagLabel,
      name: elementName(el),
      selector: sel.selector,
      matches: sel.matches,
      flags: flags,
    });

    if (rows.length >= (opts.limit || 120) * 3) break; // chặn trang khổng lồ
  }

  return {
    url: location.href,
    title: document.title,
    rows: rows,
    hiddenCount: hiddenCount,
    totalCandidates: all.length,
  };
}

function collectTablesInPage(maxRows) {
  return Array.from(document.querySelectorAll('table')).map((t, i) => {
    const trs = Array.from(t.querySelectorAll('tr')).slice(0, maxRows);
    return {
      index: i + 1,
      totalRows: t.querySelectorAll('tr').length,
      rows: trs.map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) =>
          String(c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
        )
      ),
    };
  });
}

function collectTextInPage(maxChars) {
  const root = document.querySelector('main') || document.body;
  return String(root.innerText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars);
}
/* eslint-enable */

// ---- Định dạng (chạy ở Node, dễ canh cột hơn trong page) -------------------

/**
 * Lọc theo --grep. PHẢI gọi TRƯỚC khi cắt theo --limit: cắt trước rồi lọc sau sẽ
 * bỏ im lặng những element khớp nằm ngoài N dòng đầu.
 */
function filterRows(rows, grep) {
  if (!grep) return { list: rows, error: null };
  try {
    const re = new RegExp(grep, 'i');
    return {
      list: rows.filter((r) => re.test(r.name) || re.test(r.selector) || re.test(r.tag)),
      error: null,
    };
  } catch (err) {
    return { list: rows, error: `[DIGEST] --grep không phải regex hợp lệ: ${grep}` };
  }
}

function formatRows(list) {
  if (list.length === 0) return '(không có element nào khớp)';

  // Cắt tên theo đúng bề rộng cột. Nếu để tên dài hơn cột thì padEnd không chèn
  // được gì và cột NAME dính liền cột SELECTOR, không đọc được.
  const NAME_MAX = 46;
  const nameOf = (r) => (r.name.length > NAME_MAX ? r.name.slice(0, NAME_MAX - 1) + '…' : r.name);

  const lines = [];
  const tagWidth = Math.min(16, Math.max(3, ...list.map((r) => r.tag.length)));
  const nameWidth = Math.min(NAME_MAX, Math.max(4, ...list.map((r) => nameOf(r).length)));

  lines.push(
    '#'.padEnd(3) + 'TAG'.padEnd(tagWidth + 1) + 'NAME / VALUE'.padEnd(nameWidth + 1) + 'SELECTOR ĐỀ XUẤT'
  );
  lines.push('-'.repeat(3 + tagWidth + 1 + nameWidth + 1 + 30));

  list.forEach((r, i) => {
    const idx = String(i + 1).padStart(2, '0') + ' ';
    const warn = r.matches !== 1 ? ` (khớp ${r.matches} element - GIÒN)` : '';
    const flags = r.flags.length ? '   ' + r.flags.join(' ') : '';
    lines.push(
      idx +
        r.tag.padEnd(tagWidth + 1) +
        nameOf(r).padEnd(nameWidth) +
        ' ' +
        r.selector +
        warn +
        flags
    );
  });

  return lines.join('\n');
}

/**
 * Sinh digest cho page hiện tại.
 * KHÔNG BAO GIỜ NÉM LỖI: digest là công cụ chẩn đoán, nó không được phép trở
 * thành nguồn lỗi mới trong đường chạy fail.
 *
 * @param {object} page   Puppeteer Page
 * @param {object} opts
 * @param {boolean} opts.all     in cả element ẩn/disabled (mặc định false)
 * @param {string}  opts.grep    regex lọc theo name/selector/tag
 * @param {boolean} opts.tables  kèm dump mọi <table>
 * @param {boolean} opts.text    kèm innerText của <main>
 * @param {number}  opts.limit   trần số element in ra (mặc định 120)
 * @param {string}  opts.label   nhãn in ở đầu digest
 * @returns {Promise<string>}
 */
async function digest(page, opts = {}) {
  const limit = opts.limit || 120;

  try {
    const data = await page.evaluate(collectInPage, { all: !!opts.all, limit });
    const filtered = filterRows(data.rows, opts.grep);

    const out = [];
    out.push('='.repeat(78));
    out.push(`DOM DIGEST${opts.label ? ' — ' + opts.label : ''}`);
    out.push(`URL   : ${data.url}`);
    out.push(`Title : ${data.title}`);
    out.push(
      `Element: ${data.rows.length} tương tác được` +
        (data.hiddenCount ? ` | ${data.hiddenCount} bị ẩn (xem bằng --all)` : '') +
        (opts.grep ? ` | ${filtered.list.length} khớp --grep="${opts.grep}"` : '')
    );
    out.push('='.repeat(78));
    if (filtered.error) out.push(filtered.error);
    out.push('');

    const shown = filtered.list.slice(0, limit);
    out.push(formatRows(shown));
    if (filtered.list.length > limit) {
      out.push('');
      out.push(
        `… còn ${filtered.list.length - limit} element khớp nữa` +
          (opts.grep ? ', thu hẹp --grep thêm.' : ', dùng --grep để thu hẹp.')
      );
    }

    if (opts.tables) {
      try {
        const tables = await page.evaluate(collectTablesInPage, 30);
        out.push('');
        out.push('-'.repeat(78));
        out.push(`BẢNG (${tables.length})`);
        out.push('-'.repeat(78));
        if (tables.length === 0) out.push('(trang không có <table> nào)');
        for (const t of tables) {
          out.push('');
          out.push(`TABLE #${t.index} (${t.totalRows} dòng)`);
          for (const row of t.rows) out.push('| ' + row.join(' | ') + ' |');
          if (t.totalRows > t.rows.length) out.push(`… còn ${t.totalRows - t.rows.length} dòng nữa`);
        }
      } catch (err) {
        out.push(`[DIGEST] không đọc được bảng: ${err.message}`);
      }
    }

    if (opts.text) {
      try {
        const text = await page.evaluate(collectTextInPage, 4000);
        out.push('');
        out.push('-'.repeat(78));
        out.push('INNERTEXT (<main>)');
        out.push('-'.repeat(78));
        out.push(text || '(rỗng)');
      } catch (err) {
        out.push(`[DIGEST] không đọc được innerText: ${err.message}`);
      }
    }

    return out.join('\n');
  } catch (err) {
    return `[DIGEST] không đọc được DOM: ${err.message}`;
  }
}

/** Chỉ phần bảng element, không header - dùng nhúng vào báo cáo fail */
async function digestRowsOnly(page, opts = {}) {
  try {
    const limit = opts.limit || 40;
    const data = await page.evaluate(collectInPage, { all: !!opts.all, limit });
    const filtered = filterRows(data.rows, opts.grep);
    const shown = filtered.list.slice(0, limit);
    const more =
      filtered.list.length > shown.length
        ? `\n… còn ${filtered.list.length - shown.length} element nữa`
        : '';
    return { count: data.rows.length, text: formatRows(shown) + more, url: data.url };
  } catch (err) {
    return { count: 0, text: `[DIGEST] không đọc được DOM: ${err.message}`, url: '' };
  }
}

function ensureDiagnosticsDir() {
  if (!fs.existsSync(DIAGNOSTICS_DIR)) {
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
  }
  return DIAGNOSTICS_DIR;
}

/** Ghi digest ra diagnostics/<filename>, trả về đường dẫn tuyệt đối */
async function digestToFile(page, filename, opts = {}) {
  const text = await digest(page, opts);
  ensureDiagnosticsDir();
  const filePath = path.join(DIAGNOSTICS_DIR, filename);
  fs.writeFileSync(filePath, text, 'utf8');
  return { filePath, text };
}

module.exports = {
  digest,
  digestRowsOnly,
  digestToFile,
  ensureDiagnosticsDir,
  DIAGNOSTICS_DIR,
};
