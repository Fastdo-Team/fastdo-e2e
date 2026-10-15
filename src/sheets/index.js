// ============================================================================
// sheets/index.js: một cửa mở Sheet cho mọi tool — client + tab đã chọn + bộ ghi.
// ============================================================================

const path = require('path');
const config = require('../config');
const { createSheetsClient } = require('./sheets_client');
const { resolveTab } = require('./tab');
const { createSheetWriter } = require('./sheet_writer');
const { createAuditLog } = require('./audit');

const AUDIT_PATH = path.join(config.ROOT_DIR, 'runs', '.sheet-audit.ndjson');

/**
 * Mở Sheet theo cấu hình: đọc danh sách tab, chọn tab (gid ưu tiên, tên phải khớp
 * chính xác). Không đọc lưới — gọi readGrid() khi cần.
 */
async function openSheet({ transport, cfg = config } = {}) {
  const client = createSheetsClient({ spreadsheetId: cfg.SHEET_ID, keyFile: cfg.GOOGLE_SA_KEY_FILE, transport });
  const meta = await client.getMeta();
  const tab = resolveTab(meta, { gid: cfg.SHEET_GID, title: cfg.SHEET_TAB });
  return {
    client,
    meta,
    tab,
    readGrid: () => client.readGrid(tab.title),
    writer: () => createSheetWriter({ client, tab, auditLog: createAuditLog(AUDIT_PATH) }),
  };
}

module.exports = { openSheet, AUDIT_PATH };
