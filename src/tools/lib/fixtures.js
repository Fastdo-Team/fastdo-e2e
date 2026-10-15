// ============================================================================
// fixtures.js: Dò xem testcase cần mẫu dữ liệu nào, và mẫu đó còn trên app không.
//
// Tách ra khỏi preflight.js để plan.js dùng chung.
//
// Vì sao quét source thay vì bắt testcase khai báo `requires`: quét là cách
// không xâm lấn — 8 file testcase hiện có không phải sửa dòng nào, và case mới
// chỉ cần đặt hằng số tên mẫu theo đúng quy ước là tự được bảo vệ.
// ============================================================================

const fs = require('fs');
const path = require('path');
const config = require('../../config');

// Bắt cả TEMPLATE_NAME và DRAFT_TEMPLATE_NAME — 2 tên đang dùng lẫn lộn trong
// các case cũ. Đặt tên khác 2 cái này thì preflight/plan sẽ KHÔNG bảo vệ được.
const FIXTURE_CONST_RE = /(?:DRAFT_)?TEMPLATE_NAME\s*=\s*['"]([^'"]+)['"]/g;

/**
 * Map "tên mẫu" -> [mã case cần nó].
 * @param {string[]|null} onlyCases chỉ quét các mã này (null = quét mọi testcase)
 */
function scanFixtureNames(onlyCases = null) {
  const dir = path.join(config.ROOT_DIR, 'src', 'testcases');
  const wanted = new Map();
  if (!fs.existsSync(dir)) return wanted;

  const filter = onlyCases ? new Set(onlyCases.map((c) => c.toUpperCase())) : null;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const caseId = file.replace('.test.js', '').toUpperCase();
    if (filter && !filter.has(caseId)) continue;

    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = new RegExp(FIXTURE_CONST_RE.source, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!wanted.has(name)) wanted.set(name, []);
      if (!wanted.get(name).includes(caseId)) wanted.get(name).push(caseId);
    }
  }

  return wanted;
}

/** Đọc bảng danh sách mẫu đánh giá đang hiển thị: [{ name, status }] */
function readTemplateRows(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('table tbody tr'))
      .map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          name: ((tds[0] || {}).innerText || '').replace(/\s+/g, ' ').trim(),
          status: ((tds[1] || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((r) => r.name)
  );
}

/**
 * Đối chiếu mẫu cần với mẫu đang có trên app.
 * Trả [{ name, cases, ok, detail }] — `ok=false` nghĩa là case đó chạy sẽ chết ở
 * openDraftByName, nên phải chặn trước khi đốt 20-50 giây mỗi case.
 */
function matchFixtures(wanted, rows) {
  const out = [];

  for (const [name, cases] of wanted) {
    const hits = rows.filter((r) => r.name === name);

    if (hits.length === 0) {
      out.push({
        name,
        cases,
        ok: false,
        detail: `KHÔNG còn trên tunnel này → ${cases.join(', ')} sẽ chết ở openDraftByName`,
      });
    } else if (!hits.some((r) => r.status === 'Nháp')) {
      const states = [...new Set(hits.map((r) => r.status))].join(', ');
      out.push({
        name,
        cases,
        ok: false,
        detail: `có nhưng không bản nào ở trạng thái Nháp (đang: ${states}) → ${cases.join(', ')} cần mẫu Nháp để bấm Sửa`,
      });
    } else {
      out.push({
        name,
        cases,
        ok: true,
        detail: `có ${hits.length} bản, có Nháp → ${cases.join(', ')} OK`,
      });
    }
  }

  return out;
}

/** Tên các mẫu đang ở trạng thái Nháp — gợi ý để sửa hằng số trong testcase */
function listDraftNames(rows) {
  return [...new Set(rows.filter((r) => r.status === 'Nháp').map((r) => r.name))];
}

module.exports = {
  scanFixtureNames,
  readTemplateRows,
  matchFixtures,
  listDraftNames,
};
