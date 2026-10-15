// ============================================================================
// ticket_tab.js: Sheet testcase tổng của AI-QC — mỗi ticket 1 tab (tên = mã ticket),
// tab "Tổng hợp" 1 dòng / ticket.
//
// Bố cục tab ticket = tab "_Mẫu" (AI-QC-Testcase-Ticket.xlsx, đã lưu thành Google Trang tính):
//   dòng 1  nhãn "TEST LẦN n" (gộp ô)          dòng 2  tên cột
//   dòng 3  "TÊN TICKET"                       dòng 4+ mỗi dòng 1 case: ID | Function | Tiêu đề | Mô tả | Nền tảng
// TEST LẦN 1 là vòng của AI. Cột luôn tìm theo NHÃN (sheet_grid), không đoán theo vị trí.
//
// Hàm thuần (plan*, build*) tách khỏi hàm gọi API (prepare / writeResults / setState) để test
// không cần mạng. Mọi lần ghi đi bằng 1 lượt batchUpdate.
// ============================================================================

const G = require('../core/sheet_grid');
const { quoteTab, a1Of } = require('./a1');
const C = require('./cell_values');
const { TICKET_ID_RE } = require('../engine/case_id');

const TEMPLATE_TAB = '_Mẫu';
const SUMMARY_TAB = 'Tổng hợp';
const TITLE_ROW = 2; // 0-based = dòng 3
const FIRST_CASE_ROW = 3; // 0-based = dòng 4
const SUMMARY_HEADER_ROW = 2; // 0-based = dòng 3 của tab Tổng hợp
const TICKET_RE = /^\d{1,10}$/;
const MAX_CASES_PER_KIND = 99;

const SPEC_COLS = { id: 0, function: 1, title: 2, description: 3, platform: 4 };
// Nút «AI soạn thêm testcase» nằm trong dòng hồng tên ticket (dòng 3): tên ticket gộp A3:C3, nhãn ở D3, hộp kiểm ở E3
// (lệnh setup-template thêm vào _Mẫu; bản đầu đặt ở F3 / G3 dưới khối TEST LẦN 1 — dễ nhầm là cột «Môi trường»).
const AI_TOGGLE_LABEL = 'AI soạn thêm testcase';
const AI_TOGGLE_COLS = { label: 3, box: 4 };
// Loại case ghi ở đầu Tiêu đề. Case không ghi loại (QC viết) = Tái hiện.
const CASE_TYPES = { repro: '[Tái hiện]', regression: '[Hồi quy]' };
const GUIDE_TAB = 'Hướng dẫn';
const GUIDE_SECTION = '11. AI SOẠN THÊM TESTCASE (TỪ 15/10/2026)';
const PLATFORMS = ['Web', 'App', 'Web + App'];
const PRIORITIES = ['Thấp', 'Trung bình', 'Quan trọng', 'Khẩn cấp'];
const CASE_STATUSES = ['DONE', 'Fail', 'Doing', 'Cancel', 'Pending'];
const REPRO_VALUES = ['Có', 'Một phần', 'Không'];
// Trùng danh sách chọn cột «Trạng thái AI-QC» của tab Tổng hợp (strict) — ghi giá trị khác sẽ bị API từ chối.
const SUMMARY_STATES = [
  'Chuẩn bị testcase',
  'Đang tái hiện',
  'Không tái hiện được',
  'Đang code',
  'Đang kiểm lại',
  'AI đang sửa',
  'Đang ghi kết quả',
  'Đạt',
  'Cần người xem',
  'Bỏ qua E2E',
];
const SUMMARY_LABELS = {
  ticket: 'Mã ticket',
  name: 'Tên ticket',
  tab: 'Tab',
  source: 'Nguồn testcase',
  repro: 'Tái hiện lỗi',
  state: 'Trạng thái AI-QC',
  rounds: 'Vòng sửa',
  pr: 'Pull Request',
  last: 'Lần test cuối',
};

function assertTicket(ticket) {
  if (!TICKET_RE.test(String(ticket || ''))) {
    throw new Error(`[AN TOÀN] Mã ticket "${ticket}" không hợp lệ — chỉ gồm số (tên tab = mã ticket).`);
  }
}

/** Link mở thẳng tab của ticket */
function tabUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`;
}

const cellOf = (grid, r, c) => String(((grid[r] || [])[c]) || '').trim();

/** Cột mang nhãn `label` (dòng 2) trong khối TEST LẦN n, -1 nếu không có */
function labelColumn(grid, roundNumber, label) {
  const block = G.roundBlock(grid, roundNumber);
  if (!block) return -1;
  const want = G.normalizeLabel(label);
  for (let c = block.startIdx; c < block.endIdx; c += 1) {
    if (G.normalizeLabel((grid[1] || [])[c]) === want) return c;
  }
  return -1;
}

/** Loại case theo tiền tố Tiêu đề: «[Hồi quy] …» → regression, còn lại (kể cả «[Tái hiện] …», không tiền tố) → repro */
function caseType(title) {
  const t = String(title || '').normalize('NFC').trim().toLowerCase();
  return /^\[\s*hồi quy\s*\]/.test(t) ? 'regression' : 'repro';
}

/** Tiêu đề bỏ tiền tố loại, chữ thường — để so trùng case */
function titleKey(title) {
  return String(title || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/^\[\s*(tái hiện|hồi quy)\s*\]\s*/, '')
    .replace(/\s+/g, ' ');
}

/** Nút «AI soạn thêm testcase» ở dòng 3: giá trị ô ngay sau nhãn. Tab tạo trước khi có nút (không có nhãn) → BẬT. */
function readAiToggle(grid) {
  const row = grid[TITLE_ROW] || [];
  const want = G.normalizeLabel(AI_TOGGLE_LABEL);
  for (let c = 0; c < row.length; c += 1) {
    if (G.normalizeLabel(row[c]).startsWith(want)) {
      return !['FALSE', 'SAI', '0'].includes(G.normalizeLabel(row[c + 1]));
    }
  }
  return true;
}

/** Các case đang có trên tab ticket (từ dòng 4), kể cả dòng QC viết mà chưa ghi ID */
function readCases(grid) {
  const priorityCol = labelColumn(grid, 1, 'Ưu tiên');
  const out = [];
  for (let r = FIRST_CASE_ROW; r < grid.length; r += 1) {
    const spec = {
      id: cellOf(grid, r, SPEC_COLS.id).toUpperCase(),
      function: cellOf(grid, r, SPEC_COLS.function),
      title: cellOf(grid, r, SPEC_COLS.title),
      description: cellOf(grid, r, SPEC_COLS.description),
      platform: cellOf(grid, r, SPEC_COLS.platform),
    };
    if (!spec.id && !spec.title && !spec.description) continue;
    out.push({
      row: r,
      ...spec,
      source: /-AI\d{2}$/.test(spec.id) ? 'AI' : 'QC',
      type: caseType(spec.title),
      priority: priorityCol >= 0 ? cellOf(grid, r, priorityCol) : '',
    });
  }
  return out;
}

/**
 * Kế hoạch bước "chuẩn bị testcase":
 *  - dòng QC có nội dung mà chưa có ID (hoặc ID sai dạng) → gán <mã>-QCnn;
 *  - thêm tối đa `maxAiCases` case AI (<mã>-AInn) ngay dưới dòng cuối — AI đã đọc mọi case đang có và chỉ gửi case MỚI;
 *    case trùng tiêu đề với case đang có (bỏ tiền tố loại) bị bỏ. Tiêu đề ghi tiền tố loại, Mô tả thêm dòng «Nguồn: …»;
 *  - dòng 3 còn chữ mẫu / trống → "[mã] tiêu đề".
 * @returns {{ writes: {row:number,col:number,value:any}[], cases: object[] }}
 */
function planPrepare(grid, { ticket, title, aiCases = [], maxAiCases = 3 }) {
  assertTicket(ticket);
  const existing = readCases(grid);
  const used = new Set(existing.map((c) => c.id).filter((id) => TICKET_ID_RE.test(id)));
  const nextId = (kind) => {
    for (let n = 1; n <= MAX_CASES_PER_KIND; n += 1) {
      const id = `${ticket}-${kind}${String(n).padStart(2, '0')}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error(`Tab ${ticket} đã đủ ${MAX_CASES_PER_KIND} case ${kind}.`);
  };

  const writes = [];
  const cases = [];
  for (const c of existing) {
    let id = c.id;
    if (!TICKET_ID_RE.test(id) || !id.startsWith(`${ticket}-`)) {
      id = nextId(c.source === 'AI' ? 'AI' : 'QC');
      writes.push({ row: c.row, col: SPEC_COLS.id, value: id });
    }
    cases.push({ ...c, id });
  }

  const priorityCol = labelColumn(grid, 1, 'Ưu tiên');
  const seen = new Set(existing.map((c) => titleKey(c.title)).filter(Boolean));
  const fresh = aiCases.filter((a) => {
    const key = titleKey(a.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let row = existing.length ? Math.max(...existing.map((c) => c.row)) + 1 : FIRST_CASE_ROW;
  for (const a of fresh.slice(0, Math.max(0, maxAiCases))) {
    const id = nextId('AI');
    const type = a.type === 'regression' ? 'regression' : 'repro';
    const platform = PLATFORMS.includes(a.platform) ? a.platform : 'Web';
    const priority = PRIORITIES.includes(a.priority) ? a.priority : '';
    const title = `${CASE_TYPES[type]} ${String(a.title).trim().replace(/^\[\s*(tái hiện|hồi quy)\s*\]\s*/i, '')}`;
    const source = String(a.source || '').trim();
    const base = String(a.description || '');
    const description = source && !/(^|\n)\s*Nguồn:/.test(base) ? `${base}\nNguồn: ${source}` : base;
    const values = [id, a.function || '', title, description, platform];
    values.forEach((value, col) => writes.push({ row, col, value }));
    if (priority && priorityCol >= 0) writes.push({ row, col: priorityCol, value: priority });
    cases.push({ row, id, source: 'AI', type, function: values[1], title, description, platform, priority });
    row += 1;
  }

  const titleCell = cellOf(grid, TITLE_ROW, 0);
  if (!titleCell || /^TÊN TICKET/i.test(titleCell)) {
    writes.push({ row: TITLE_ROW, col: 0, value: `[${ticket}] ${title || ''}`.trim() });
  }
  return { writes, cases };
}

/**
 * Ô «Kết quả thực hiện» của TEST LẦN 1: chữ cũ giữ nguyên + 1 khối mới, mỗi phần (trước / sau khi sửa)
 * 2 dòng, link video bấm được (textFormatRuns).
 * @param {object} existingCell CellData đang có (đọc sống ngay trước khi ghi)
 * @param {{label:string, text:string, videoLabel:string, videoUrl?:string}[]} parts
 */
function buildResultCell(existingCell, parts) {
  const oldText = C.cellText(existingCell);
  const runs = C.cleanRuns(existingCell && existingCell.textFormatRuns);
  let text = oldText && !oldText.endsWith('\n') ? `${oldText}\n` : oldText;
  if (oldText) runs.push({ startIndex: text.length, format: {} });

  const links = [];
  parts.forEach((p, i) => {
    if (i > 0) text += '\n';
    text += `[${p.label}] ${String(p.text || '').trim()}\n- ${p.videoLabel}: `;
    if (p.videoUrl) {
      links.push({ at: text.length, uri: p.videoUrl });
      text += p.videoUrl;
    } else {
      text += '(không có video)';
    }
  });
  for (const l of links) {
    runs.push({ startIndex: l.at, format: { link: { uri: l.uri } } });
    const end = l.at + l.uri.length;
    if (end < text.length) runs.push({ startIndex: end, format: {} });
  }
  return { userEnteredValue: { stringValue: text }, textFormatRuns: runs };
}

/**
 * Kế hoạch ghi kết quả TEST LẦN 1 cho từng case.
 * @param {string[][]} grid lưới tab ticket
 * @param {{ cases: {id, status, parts, feedback}[], testDateSerial: number, existingResultCells: Object<string,object> }} o
 */
function planResults(grid, { cases, testDateSerial, existingResultCells = {} }) {
  const found = G.findRoundColumnsByLabel(grid, 1);
  if (!found.ok) throw new Error(`[AN TOÀN] Tab ticket sai bố cục: ${found.problems.join('; ')}`);
  const feedbackCol = [labelColumn(grid, 1, 'FEEDBACK AI'), labelColumn(grid, 1, 'DEV/QC NOTE')].find((c) => c >= 0);

  const writes = [];
  for (const c of cases) {
    const row = G.findRowIndex(grid, c.id);
    if (row < FIRST_CASE_ROW) throw new Error(`[AN TOÀN] Không thấy case ${c.id} trên tab — không ghi.`);
    if (!CASE_STATUSES.includes(c.status)) throw new Error(`[AN TOÀN] Trạng thái "${c.status}" không có trong danh sách chọn.`);
    if (found.cols.env !== null) writes.push({ row, col: found.cols.env, value: 'Localhost' });
    writes.push({ row, col: found.cols.status, value: c.status });
    if (c.parts && c.parts.length) {
      writes.push({ row, col: found.cols.result, value: buildResultCell(existingResultCells[c.id], c.parts) });
    }
    if (feedbackCol !== undefined && c.feedback) writes.push({ row, col: feedbackCol, value: String(c.feedback) });
    if (found.cols.testDate !== null && testDateSerial) writes.push({ row, col: found.cols.testDate, value: testDateSerial });
  }
  return { writes, resultCol: found.cols.result };
}

/**
 * Kế hoạch cập nhật dòng của ticket trên tab Tổng hợp (tìm theo cột «Mã ticket», chưa có thì lấy dòng trống đầu tiên).
 * Chỉ ghi field được truyền; các cột số case là công thức sẵn trong file, không đụng.
 */
function planSummary(grid, o) {
  assertTicket(o.ticket);
  const header = grid[SUMMARY_HEADER_ROW] || [];
  const colOf = (key) => header.findIndex((h) => G.normalizeLabel(h) === G.normalizeLabel(SUMMARY_LABELS[key]));
  const ticketCol = colOf('ticket');
  if (ticketCol < 0) throw new Error(`[AN TOÀN] Tab "${SUMMARY_TAB}" thiếu cột «${SUMMARY_LABELS.ticket}» ở dòng 3.`);
  if (o.state !== undefined && !SUMMARY_STATES.includes(o.state)) throw new Error(`Trạng thái AI-QC "${o.state}" không hợp lệ.`);
  if (o.repro !== undefined && !REPRO_VALUES.includes(o.repro)) throw new Error(`Giá trị «Tái hiện lỗi» "${o.repro}" không hợp lệ.`);

  let row = -1;
  for (let r = SUMMARY_HEADER_ROW + 1; r < grid.length; r += 1) {
    if (cellOf(grid, r, ticketCol) === String(o.ticket)) {
      row = r;
      break;
    }
  }
  if (row < 0) {
    row = SUMMARY_HEADER_ROW + 1;
    while (cellOf(grid, row, ticketCol)) row += 1;
  }

  const writes = [];
  const put = (key, value) => {
    const col = colOf(key);
    if (col >= 0 && value !== undefined && value !== null) writes.push({ row, col, value });
  };
  put('ticket', String(o.ticket));
  put('name', o.name);
  if (o.tabUrl) {
    put('tab', {
      userEnteredValue: { stringValue: String(o.ticket) },
      textFormatRuns: [{ startIndex: 0, format: { link: { uri: o.tabUrl } } }],
    });
  }
  put('source', o.source);
  put('repro', o.repro);
  put('state', o.state);
  put('rounds', o.rounds);
  if (o.prUrl) {
    put('pr', { userEnteredValue: { stringValue: o.prUrl }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: o.prUrl } } }] });
  }
  put('last', o.lastSerial);
  return { row, writes };
}

/** Số ngày-giờ kiểu Google Sheets (giờ địa phương của máy chạy) */
function toSheetsDateTimeSerial(date) {
  const d = new Date(date);
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (local - Date.UTC(1899, 11, 30)) / 86400000;
}

function toCellData(value) {
  if (value && typeof value === 'object' && value.userEnteredValue) return value;
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

/** writes → các request updateCells (1 ô / request; ô có link thì ghi kèm textFormatRuns) */
function writeRequests(gid, writes) {
  return writes.map((w) => {
    const cell = toCellData(w.value);
    return {
      updateCells: {
        start: { sheetId: gid, rowIndex: w.row, columnIndex: w.col },
        rows: [{ values: [cell] }],
        fields: cell.textFormatRuns ? 'userEnteredValue,textFormatRuns' : 'userEnteredValue',
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Gọi API
// ---------------------------------------------------------------------------------------------

async function findTab(client, title) {
  const meta = await client.getMeta();
  return { meta, tab: meta.tabs.find((t) => t.title === title) || null };
}

/** Tab của ticket: có rồi thì dùng, chưa có thì nhân bản "_Mẫu" và đặt ngay sau các tab hệ thống */
async function ensureTicketTab(client, ticket) {
  assertTicket(ticket);
  const { meta, tab } = await findTab(client, ticket);
  if (tab) return { gid: tab.gid, created: false };
  const template = meta.tabs.find((t) => t.title === TEMPLATE_TAB);
  if (!template) throw new Error(`[SHEET] Không thấy tab "${TEMPLATE_TAB}" để nhân bản tab ticket.`);
  const systemTabs = meta.tabs.filter((t) => t.title.startsWith('_') || t.title === SUMMARY_TAB || t.title === 'Hướng dẫn');
  const insertSheetIndex = systemTabs.length ? Math.max(...systemTabs.map((t) => t.index)) + 1 : 0;
  const res = await client.batchUpdate([
    { duplicateSheet: { sourceSheetId: template.gid, insertSheetIndex, newSheetName: String(ticket) } },
  ]);
  const props = (((res.replies || [])[0] || {}).duplicateSheet || {}).properties || {};
  if (props.sheetId === undefined) throw new Error('[SHEET] Nhân bản tab mẫu không trả về gid của tab mới.');
  return { gid: props.sheetId, created: true };
}

async function updateSummary(client, o) {
  const { tab } = await findTab(client, SUMMARY_TAB);
  if (!tab) throw new Error(`[SHEET] Không thấy tab "${SUMMARY_TAB}".`);
  const grid = await client.readGrid(SUMMARY_TAB);
  const plan = planSummary(grid, o);
  if (plan.writes.length) await client.batchUpdate(writeRequests(tab.gid, plan.writes));
  return plan.row;
}

/** Bước 3 của agent: tab ticket + case (QC có sẵn + AI soạn) + dòng Tổng hợp «Chuẩn bị testcase» */
async function prepare(client, { ticket, title, aiCases, maxAiCases }) {
  const { gid, created } = await ensureTicketTab(client, ticket);
  const grid = await client.readGrid(String(ticket));
  // QC tắt nút → không bao giờ ghi case AI, kể cả khi agent lỡ gửi
  const aiCasesEnabled = readAiToggle(grid);
  const plan = planPrepare(grid, { ticket, title, aiCases: aiCasesEnabled ? aiCases : [], maxAiCases });
  if (plan.writes.length) await client.batchUpdate(writeRequests(gid, plan.writes));
  const url = tabUrl(client.spreadsheetId, gid);
  await updateSummary(client, {
    ticket,
    name: title,
    tabUrl: url,
    source: plan.cases.some((c) => c.source === 'QC') ? 'QC + AI' : 'Chỉ AI',
    state: 'Chuẩn bị testcase',
  });
  return {
    gid,
    url,
    created,
    aiCasesEnabled,
    cases: plan.cases.map(({ id, source, type, function: fn, title: t, description, platform, priority }) => ({
      id,
      source,
      type: type || caseType(t),
      function: fn,
      title: t,
      description,
      platform,
      priority,
    })),
  };
}

/** Bước 8 của agent: TEST LẦN 1 từng case + dòng Tổng hợp */
async function writeResults(client, { ticket, cases, summary = {}, now = new Date() }) {
  assertTicket(ticket);
  const { tab } = await findTab(client, String(ticket));
  if (!tab) throw new Error(`[SHEET] Chưa có tab "${ticket}" — chạy prepare trước.`);
  const grid = await client.readGrid(String(ticket));
  const found = G.findRoundColumnsByLabel(grid, 1);
  if (!found.ok) throw new Error(`[AN TOÀN] Tab ticket sai bố cục: ${found.problems.join('; ')}`);

  // Đọc sống ô Kết quả để NỐI vào chữ cũ (không bao giờ xoá kết quả lần trước)
  const rows = cases.map((c) => G.findRowIndex(grid, c.id));
  const ranges = rows.filter((r) => r >= FIRST_CASE_ROW).map((r) => `${quoteTab(String(ticket))}!${a1Of(r, found.cols.result)}`);
  const cells = ranges.length ? await client.readCells(ranges, { gid: tab.gid }) : [];
  const existingResultCells = {};
  let i = 0;
  cases.forEach((c, k) => {
    if (rows[k] >= FIRST_CASE_ROW) existingResultCells[c.id] = cells[i++] || {};
  });

  const { writes } = planResults(grid, {
    cases,
    testDateSerial: Math.floor(toSheetsDateTimeSerial(now)),
    existingResultCells,
  });
  if (writes.length) await client.batchUpdate(writeRequests(tab.gid, writes));
  await updateSummary(client, { ...summary, ticket, tabUrl: tabUrl(client.spreadsheetId, tab.gid), lastSerial: toSheetsDateTimeSerial(now) });
  return { gid: tab.gid, url: tabUrl(client.spreadsheetId, tab.gid) };
}

/** Mục 11 cuối tab Hướng dẫn */
const GUIDE_LINES = [
  GUIDE_SECTION,
  '• Ô tích «AI soạn thêm testcase» nằm trong dòng hồng tên ticket (ô E3 của tab ticket) — là thiết lập của CẢ TICKET, không thuộc khối TEST LẦN 1. TÍCH = AI đọc ticket, đọc mọi case đang có, đọc code + tài liệu nghiệp vụ rồi soạn thêm case còn thiếu (ID có chữ AI). BỎ TÍCH = AI chỉ chạy case QC đã viết. Chỉnh TRƯỚC khi bấm «Giao AI code».',
  '• Tab tạo trước ngày 15/10/2026 không có ô tích → coi như đã tích.',
  '• Mỗi case AI có dòng «Nguồn: …» cuối Mô tả — nơi lấy «Kết quả mong muốn» (câu trong ticket, case QC, file code, tài liệu). AI không soạn case không có nguồn.',
  '• Loại case ghi ở đầu Tiêu đề: «[Tái hiện]» = nhắm đúng lỗi / yêu cầu của ticket, bản chưa sửa phải KHÔNG ĐẠT. «[Hồi quy]» = hành vi đang đúng phải giữ, bản chưa sửa phải ĐẠT.',
  '• Case QC không ghi loại được tính là [Tái hiện]. Muốn case QC là hồi quy thì ghi «[Hồi quy]» ở đầu Tiêu đề.',
  '• Case [Hồi quy] KHÔNG ĐẠT ngay trên bản chưa sửa → Trạng thái Pending + FEEDBACK AI «Cần QC xem» (kỳ vọng sai hoặc lỗi cũ ngoài ticket). AI không sửa code theo case đó.',
  '• Số case do AI quyết theo rủi ro: luồng chính, dữ liệu biên, thao tác khác (dán / sửa / xoá / huỷ), lưu rồi mở lại, quyền, chức năng liền kề — tối đa 8 case mỗi lượt.',
];

/**
 * Kế hoạch lệnh setup-template (chạy lại không đổi gì):
 *  - ô «AI soạn thêm testcase» của _Mẫu: chưa có → 'add'; đang ở chỗ cũ (F3 / G3) → 'move'; đã ở D3 / E3 → 'ok';
 *  - mục 11 của Hướng dẫn: chưa có → thêm cuối tab (cách dòng cuối 1 dòng trống); có rồi → ghi lại đúng chỗ những dòng khác chữ.
 * @returns {{ toggle: 'add'|'move'|'ok', oldCol: number, guide: {row:number,col:number,value:string}[] }}
 */
function planSetupTemplate(templateGrid, guideGrid) {
  const want = G.normalizeLabel(AI_TOGGLE_LABEL);
  const oldCol = (templateGrid[TITLE_ROW] || []).findIndex((v) => G.normalizeLabel(v).startsWith(want));
  const toggle = oldCol < 0 ? 'add' : oldCol === AI_TOGGLE_COLS.label ? 'ok' : 'move';

  const sectionRow = guideGrid.findIndex((r) => (r || []).some((v) => String(v || '').trim() === GUIDE_SECTION));
  let guide;
  if (sectionRow < 0) {
    const lastRow = guideGrid.reduce((last, r, i) => ((r || []).some((v) => String(v || '').trim()) ? i : last), -1);
    guide = GUIDE_LINES.map((value, i) => ({ row: lastRow + 2 + i, col: 0, value }));
  } else {
    guide = GUIDE_LINES.map((value, i) => ({ row: sectionRow + i, col: 0, value }))
      .filter((w) => String(((guideGrid[w.row] || [])[0]) || '').trim() !== w.value);
  }
  return { toggle, oldCol, guide };
}

/**
 * Request đặt ô «AI soạn thêm testcase» vào dòng hồng của _Mẫu: bỏ gộp A3:E3 → chép định dạng A3 (nền hồng) sang D3:E3 →
 * gộp lại A3:C3 (tên ticket, tự xuống dòng) → D3 nhãn, E3 hộp kiểm mặc định tích. 'move' thì xoá sạch ô cũ trước.
 */
function toggleRequests(gid, { toggle, oldCol }) {
  if (toggle === 'ok') return [];
  const range = (fromCol, toCol) => ({
    sheetId: gid,
    startRowIndex: TITLE_ROW,
    endRowIndex: TITLE_ROW + 1,
    startColumnIndex: fromCol,
    endColumnIndex: toCol,
  });
  const requests = [];
  if (toggle === 'move') {
    // updateCells không có rows = xoá các trường trong fields của cả vùng
    requests.push({ updateCells: { range: range(oldCol, oldCol + 2), fields: 'userEnteredValue,dataValidation,userEnteredFormat' } });
  }
  requests.push(
    { unmergeCells: { range: range(0, AI_TOGGLE_COLS.box + 1) } },
    { copyPaste: { source: range(0, 1), destination: range(AI_TOGGLE_COLS.label, AI_TOGGLE_COLS.box + 1), pasteType: 'PASTE_FORMAT' } },
    { mergeCells: { range: range(0, AI_TOGGLE_COLS.label), mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: range(0, 1), cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } },
    {
      updateCells: {
        start: { sheetId: gid, rowIndex: TITLE_ROW, columnIndex: AI_TOGGLE_COLS.label },
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: `${AI_TOGGLE_LABEL}:` },
                userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'RIGHT', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' },
              },
              {
                userEnteredValue: { boolValue: true },
                dataValidation: { condition: { type: 'BOOLEAN' } },
                userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
              },
            ],
          },
        ],
        // Chỉ ghi các trường định dạng cần đổi — giữ nền hồng vừa chép từ A3
        fields:
          'userEnteredValue,dataValidation,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,' +
          'userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy',
      },
    }
  );
  return requests;
}

/** Lệnh setup-template: ô «AI soạn thêm testcase» trong dòng hồng của _Mẫu + mục 11 tab Hướng dẫn */
async function setupTemplate(client) {
  const meta = await client.getMeta();
  const template = meta.tabs.find((t) => t.title === TEMPLATE_TAB);
  const guideTab = meta.tabs.find((t) => t.title === GUIDE_TAB);
  if (!template) throw new Error(`[SHEET] Không thấy tab "${TEMPLATE_TAB}".`);
  if (!guideTab) throw new Error(`[SHEET] Không thấy tab "${GUIDE_TAB}".`);
  const plan = planSetupTemplate(await client.readGrid(TEMPLATE_TAB), await client.readGrid(GUIDE_TAB));
  const requests = [...toggleRequests(template.gid, plan), ...writeRequests(guideTab.gid, plan.guide)];
  if (requests.length) await client.batchUpdate(requests);
  return { toggle: plan.toggle, guideRows: plan.guide.length };
}

/** Đổi riêng «Trạng thái AI-QC» (và vài cột khác nếu truyền) trên tab Tổng hợp */
async function setState(client, o) {
  await updateSummary(client, o);
}

module.exports = {
  TEMPLATE_TAB,
  SUMMARY_TAB,
  SUMMARY_STATES,
  REPRO_VALUES,
  CASE_STATUSES,
  tabUrl,
  caseType,
  readAiToggle,
  readCases,
  planPrepare,
  planSetupTemplate,
  toggleRequests,
  setupTemplate,
  buildResultCell,
  planResults,
  planSummary,
  toSheetsDateTimeSerial,
  writeRequests,
  ensureTicketTab,
  prepare,
  writeResults,
  setState,
};
