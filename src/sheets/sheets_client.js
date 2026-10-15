// ============================================================================
// sheets_client.js: gọi Google Sheets API (REST v4) bằng service account.
//
// Vì sao REST + google-auth-library thay vì gói `googleapis`: `googleapis` nặng ~80MB
// cho vài endpoint. google-auth-library lo ký JWT + làm mới token; phần còn lại chỉ là
// vài URL.
//
// Không có hàm nào ở đây tự "đoán" — lỗi API được đổi thành thông điệp nói rõ phải sửa
// gì (Share cho ai, id nào sai…). 429/5xx/lỗi mạng thử lại 3 lần (1s, 3s, 9s).
// ============================================================================

const fs = require('fs');
const { quoteTab } = require('./a1');

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  // Chỉ để hỏi "có quyền sửa không" mà không phải ghi thử.
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 3000, 9000];

// Đủ để nối ô Kết quả mà giữ link, kiểm danh sách chọn, kiểm kiểu ngày.
const CELL_FIELDS =
  'userEnteredValue,effectiveValue,formattedValue,textFormatRuns,chipRuns,' +
  'dataValidation,userEnteredFormat(numberFormat)';

function readServiceAccountEmail(keyFile) {
  try {
    return JSON.parse(fs.readFileSync(keyFile, 'utf8')).client_email || '';
  } catch {
    return '';
  }
}

/** Transport thật. Trả {status, data}, không ném khi HTTP lỗi — `call()` quyết định. */
function createGoogleTransport(keyFile) {
  if (!keyFile) {
    throw new Error('[SHEET] Chưa khai GOOGLE_SA_KEY_FILE trong .env (đường dẫn file JSON key của service account).');
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`[SHEET] GOOGLE_SA_KEY_FILE trỏ tới file không tồn tại: ${keyFile}`);
  }
  // Nạp muộn: test chỉ dùng transport giả không cần thư viện này.
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  let clientPromise = null;
  return async function transport({ method = 'GET', url, data }) {
    clientPromise = clientPromise || auth.getClient();
    const client = await clientPromise;
    try {
      const res = await client.request({ method, url, data, retry: false, timeout: 30000 });
      return { status: res.status, data: res.data };
    } catch (err) {
      if (err && err.response) return { status: err.response.status, data: err.response.data };
      throw err;
    }
  };
}

/** Lỗi API → thông điệp nói rõ phải sửa gì */
function describeError(res, { what, spreadsheetId, saEmail }) {
  const apiMsg = (res.data && res.data.error && res.data.error.message) || `HTTP ${res.status}`;
  let msg;
  if (res.status === 403) {
    msg =
      `không có quyền (${apiMsg}). Share Sheet cho service account ` +
      `${saEmail || '(xem client_email trong file key)'} — Editor để ghi, Viewer nếu chỉ đọc.`;
  } else if (res.status === 404) {
    msg = `không tìm thấy Sheet id "${spreadsheetId}" (${apiMsg}) — kiểm SHEET_ID (đoạn giữa /d/ và /edit trong link).`;
  } else if (/not supported for this document/i.test(apiMsg)) {
    msg =
      'file là Excel (.xlsx) upload lên Drive, API không ghi được — mở file → Tệp → Lưu dưới ' +
      `dạng Google Trang tính, rồi dùng id mới (${apiMsg}).`;
  } else if (/Unable to parse range/i.test(apiMsg)) {
    msg = `vùng ô không hợp lệ — tên tab không tồn tại? (${apiMsg})`;
  } else {
    msg = `HTTP ${res.status} — ${apiMsg}`;
  }
  const err = new Error(`[SHEET] ${what}: ${msg}`);
  err.status = res.status;
  return err;
}

/**
 * Đọc theo TÊN tab nhưng ghi theo GID: tab bị đổi tên giữa lượt (tên cũ giờ là tab khác)
 * thì đọc một tab, ghi một tab. Lỗi này chặn trường hợp đó.
 */
function gidMismatchError(expected, got) {
  return new Error(
    `[AN TOÀN] Tên tab vừa đọc thuộc tab gid ${got}, không phải gid ${expected} đang ghi — ` +
      'tab vừa bị đổi tên? Dừng lại, không ghi. Chạy lại để nạp lại danh sách tab.'
  );
}

/** 'Tab'!H4 → "3:7" (dòng:cột 0-based) — khớp startRow/startColumn API trả về */
function posKey(range) {
  const m = /!([A-Z]+)(\d+)$/.exec(String(range));
  if (!m) throw new Error(`[SHEET] vùng không phải 1 ô: ${range}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return `${Number(m[2]) - 1}:${col - 1}`;
}

/**
 * @param {object} o
 * @param {string} o.spreadsheetId
 * @param {string} [o.keyFile]      bắt buộc nếu không truyền transport
 * @param {Function} [o.transport]  ({method,url,data}) => Promise<{status,data}> — test truyền bản giả
 * @param {Function} [o.sleep]      (ms) => Promise — test truyền bản chạy tức thì
 */
function createSheetsClient({ spreadsheetId, keyFile, transport, sleep } = {}) {
  if (!spreadsheetId) throw new Error('[SHEET] Chưa khai SHEET_ID trong .env.');
  const send = transport || createGoogleTransport(keyFile);
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const saEmail = keyFile ? readServiceAccountEmail(keyFile) : '';
  const base = `${API}/${encodeURIComponent(spreadsheetId)}`;

  async function call(req, what) {
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await send(req);
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await wait(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`[SHEET] ${what}: lỗi mạng — ${err && err.message ? err.message : err}`);
      }
      if (res.status >= 200 && res.status < 300) return res.data || {};
      if (RETRY_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
        await wait(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw describeError(res, { what, spreadsheetId, saEmail });
    }
  }

  /** Tên Sheet + danh sách tab (tên thật, gid, số dòng/cột, ẩn hay không) */
  async function getMeta() {
    const fields =
      'properties(title,locale,timeZone),' +
      'sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))';
    const d = await call({ url: `${base}?fields=${encodeURIComponent(fields)}` }, 'đọc danh sách tab');
    const p = d.properties || {};
    return {
      title: p.title || '',
      locale: p.locale || '',
      tabs: (d.sheets || []).map((s) => ({
        gid: s.properties.sheetId,
        title: s.properties.title,
        index: s.properties.index,
        hidden: Boolean(s.properties.hidden),
        rows: (s.properties.gridProperties || {}).rowCount || 0,
        cols: (s.properties.gridProperties || {}).columnCount || 0,
      })),
    };
  }

  /** Toàn bộ giá trị hiển thị của 1 tab, mảng 2 chiều chuỗi (như lưới CSV cũ) */
  async function readGrid(tabTitle) {
    const url =
      `${base}/values/${encodeURIComponent(quoteTab(tabTitle))}` +
      '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
    const d = await call({ url }, `đọc tab "${tabTitle}"`);
    return (d.values || []).map((row) => row.map((v) => (v == null ? '' : String(v))));
  }

  /**
   * Chi tiết từng ô: giá trị gõ vào, link trong chữ, danh sách chọn, định dạng số.
   * @param {string[]} ranges vùng 1 ô dạng 'Tab'!H4
   * @param {{gid?: number}} [opts] gid: các ô phải thuộc đúng tab này, không thì ném [AN TOÀN]
   * @returns {Promise<object[]>} CellData theo đúng thứ tự `ranges` ({} nếu ô trống)
   */
  async function readCells(ranges, { gid } = {}) {
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const fields = `sheets(properties(sheetId),data(startRow,startColumn,rowData(values(${CELL_FIELDS}))))`;
    const d = await call(
      { url: `${base}?includeGridData=true&${qs}&fields=${encodeURIComponent(fields)}` },
      'đọc ô'
    );
    const byPos = new Map();
    for (const sheet of d.sheets || []) {
      // API bỏ trường bằng 0 → không có sheetId nghĩa là gid 0.
      const sheetId = (sheet.properties && sheet.properties.sheetId) || 0;
      if (gid !== undefined && sheetId !== Number(gid)) throw gidMismatchError(Number(gid), sheetId);
      for (const g of sheet.data || []) {
        const row = ((g.rowData || [])[0] || {}).values || [];
        byPos.set(`${g.startRow || 0}:${g.startColumn || 0}`, row[0] || {});
      }
    }
    return ranges.map((r) => byPos.get(posKey(r)) || {});
  }

  /** Một lượt spreadsheets.batchUpdate (updateCells, addSheet, deleteSheet, copyPaste…) */
  async function batchUpdate(requests) {
    return call({ method: 'POST', url: `${base}:batchUpdate`, data: { requests } }, 'ghi Sheet');
  }

  /** Service account có quyền SỬA file không — hỏi Drive, không ghi thử. null = không biết */
  async function canEdit() {
    try {
      const d = await call(
        {
          url:
            `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}` +
            '?fields=capabilities(canEdit)&supportsAllDrives=true',
        },
        'kiểm quyền sửa'
      );
      return Boolean(d.capabilities && d.capabilities.canEdit);
    } catch {
      return null;
    }
  }

  return { spreadsheetId, saEmail, getMeta, readGrid, readCells, batchUpdate, canEdit };
}

module.exports = { createSheetsClient, createGoogleTransport, describeError, gidMismatchError, posKey, SCOPES, CELL_FIELDS };
