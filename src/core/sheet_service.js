// [ENGINE V1 — PUPPETEER] Từ 2026-09-29 engine v2 (src/engine/, Playwright + Sheets API) không còn gọi file này. Giữ nguyên, không xoá (theo lệ repo).
// ============================================================================
// sheet_service.js: Tự động cập nhật Trạng thái + Kết quả thực hiện + link video
// vào Google Sheet
//
// Tối ưu tốc độ: toàn bộ lưới được kéo về 1 lần qua endpoint CSV của Google
// (gviz) ngay trong tab đang đăng nhập -> tìm dòng/cột trong RAM.
// Cách cũ dò từng ô qua Name Box + Formula Bar (~0.7s/ô) tốn ~28s cho 1 lần ghi;
// cách mới tốn ~0.3s. Bộ hàm dò từng ô vẫn được giữ làm fallback khi fetch lỗi.
// ============================================================================

const config = require('../config');
const G = require('./sheet_grid');

// Nhãn ghi vào cột "Trạng thái" của vòng test
const STATUS_PASS = 'DONE';
const STATUS_FAIL = 'Fail';

// Chuyển số thứ tự cột (1-based: 1 -> A, 27 -> AA)
function colIndexToLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

// Chuyển chữ cái cột sang số thứ tự (1-based: A -> 1, AA -> 27)
function letterToColIndex(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col;
}

/**
 * Tìm tab Google Sheet hoặc mở tab mới nếu chưa có
 */
async function getOrOpenSheetPage(browser, sheetId = config.SHEET_ID) {
  // Cấp quyền clipboard TRƯỚC mọi nhánh: nếu chỉ cấp lúc tạo tab mới thì từ case
  // thứ hai trở đi (tab Sheets đã sẵn) sẽ không có quyền, phải quay về gõ từng
  // ký tự - vừa chậm vừa dễ bị autocomplete làm hỏng nội dung.
  try {
    await browser
      .defaultBrowserContext()
      .overridePermissions('https://docs.google.com', ['clipboard-read', 'clipboard-write']);
  } catch (err) {
    console.warn('[SHEET] Không cấp được quyền clipboard:', err.message);
  }

  const pages = await browser.pages();
  let page = pages.find(
    (p) => p.url().includes('docs.google.com/spreadsheets') && p.url().includes(sheetId)
  );

  if (page) {
    await page.bringToFront();
    return page;
  }

  page = await browser.newPage();
  await page.goto(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  // Chờ đúng lúc Name Box sẵn sàng thay vì ngủ cứng 3.5s
  await page.waitForSelector('#t-name-box', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400));
  return page;
}

/**
 * Di chuyển con trỏ chọn ô qua Name Box (VD "I17" hoặc "A17")
 */
async function gotoCell(page, cellAddress) {
  const nameBox = await page.$('#t-name-box');
  if (!nameBox) throw new Error('Không tìm thấy Name Box (#t-name-box) trên Google Sheet.');

  await nameBox.click({ clickCount: 3 });
  await page.keyboard.type(cellAddress, { delay: 0 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 350));
}

/**
 * Đọc nội dung thực tế của ô hiện tại qua Formula Bar
 */
async function readCellText(page) {
  const el = await page.$('#t-formula-bar-input');
  if (!el) throw new Error('Không tìm thấy formula bar (#t-formula-bar-input)');
  const text = await page.evaluate((e) => e.innerText, el);
  return text.replace(/\n$/, '');
}

// ---------------------------------------------------------------------------
// Đọc nhanh toàn bộ lưới qua CSV
// ---------------------------------------------------------------------------

/** Parse CSV chuẩn RFC4180 (hỗ trợ dấu nháy kép và xuống dòng trong ô) */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Kéo toàn bộ lưới của tab về dạng mảng 2 chiều bằng 1 request duy nhất.
 * Chạy fetch ngay trong tab Google Sheet đang mở nên dùng luôn session đăng nhập.
 * Trả về null nếu không lấy được (gọi hàm sẽ tự fallback sang cách dò từng ô).
 */
async function fetchGrid(page, sheetId = config.SHEET_ID, tab = config.SHEET_TAB) {
  try {
    const csv = await page.evaluate(async (id, tabName) => {
      const url =
        `https://docs.google.com/spreadsheets/d/${id}/gviz/tq` +
        `?tqx=out:csv&headers=0&sheet=${encodeURIComponent(tabName)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.text();
    }, sheetId, tab);

    if (!csv) return null;
    const grid = parseCsv(csv);
    console.log(`[SHEET] Đã nạp lưới ${grid.length} dòng bằng 1 request CSV`);
    return grid;
  } catch (err) {
    console.warn('[SHEET] Không nạp được lưới qua CSV:', err.message);
    return null;
  }
}

/** Tìm số dòng (1-based) của testcaseId trong cột ID, dựa trên lưới đã nạp */
function findRowInGrid(grid, testcaseId) {
  const idCol = letterToColIndex(config.SHEET_ID_COLUMN) - 1;
  for (let r = 1; r < grid.length; r++) {
    const val = (grid[r][idCol] || '').trim();
    if (val === testcaseId.trim()) return r + 1;
  }
  return null;
}

/**
 * Xác định cột Trạng thái & Kết quả thực hiện của vòng test, dựa trên lưới đã nạp.
 * Bố cục mỗi vòng ở dòng 1-2: Ưu tiên (+0), Môi trường (+1), Trạng thái (+2),
 * Kết quả thực hiện (+3), DEV/QC NOTE (+4), Test Date (+5).
 */
function resolveRoundColumnsFromGrid(grid, roundNumber) {
  const cols = G.roundColumns(grid, roundNumber);
  if (!cols) return null;
  return {
    statusCol: colIndexToLetter(cols.statusIdx + 1),
    resultCol: colIndexToLetter(cols.resultIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Fallback: dò từng ô qua Name Box (chậm, chỉ dùng khi fetch CSV thất bại)
// ---------------------------------------------------------------------------

/**
 * Tự động tìm số dòng tương ứng với testcaseId ở cột ID (cột A)
 */
async function findRowByTestcaseId(page, testcaseId, maxRows = 100) {
  console.log(`[SHEET] Đang dò tìm dòng cho mã ${testcaseId}...`);

  for (let r = 2; r <= maxRows; r++) {
    await gotoCell(page, `${config.SHEET_ID_COLUMN}${r}`);
    const val = await readCellText(page);
    if (val && val.trim() === testcaseId.trim()) {
      console.log(`[SHEET] Đã tìm thấy ${testcaseId} tại dòng ${r}`);
      return r;
    }
  }

  throw new Error(
    `Không tìm thấy mã testcase ${testcaseId} trong cột ${config.SHEET_ID_COLUMN} (dòng 2-${maxRows})`
  );
}

/**
 * Đường FALLBACK khi không nạp được lưới CSV: dò dòng 1 qua Name Box để tìm cột
 * của vòng test. Chậm (~0.7s mỗi ô) nên chỉ chạy khi fetch gviz hỏng.
 *
 * Ở đây KHÔNG có nhánh đoán đại nào, và đó là điểm mấu chốt. Bản cũ trả về cột I
 * khi không tìm thấy nhãn — tức ghi đè thẳng lên Trạng thái và Kết quả của vòng 1
 * mà chỉ console.warn. Bản cũ còn tắt hẳn việc dò khi roundNumber === 1 (mặc định
 * cột I), nên Sheet có bố cục khác là ghi sai ngay từ vòng đầu.
 */
async function resolveRoundColumnsByScan(page, roundNumber = 1) {
  console.log(`[SHEET] Đang dò cột của TEST LẦN ${roundNumber} trên dòng 1...`);
  const seen = [];

  for (let c = 1; c <= 40; c++) {
    const colLetter = colIndexToLetter(c);
    await gotoCell(page, `${colLetter}1`);
    const val = (await readCellText(page)) || '';
    const m = G.ROUND_LABEL_RE.exec(val.trim());
    if (!m) continue;

    seen.push(`LẦN ${m[1]} (cột ${colLetter})`);
    if (parseInt(m[1], 10) !== Number(roundNumber)) continue;

    const statusCol = colIndexToLetter(c + G.STATUS_OFFSET);
    const resultCol = colIndexToLetter(c + G.RESULT_OFFSET);

    // Chốt cuối: 2 ô sắp ghi phải đúng mang nhãn Trạng thái / Kết quả thực hiện.
    // Bố cục +2/+3 chỉ là giả định; Sheet khác bố cục mà không chốt thì ghi nhầm
    // cột trong im lặng.
    const expect = [
      [statusCol, G.STATUS_LABEL],
      [resultCol, G.RESULT_LABEL],
    ];
    for (const [col, want] of expect) {
      await gotoCell(page, `${col}2`);
      const actual = ((await readCellText(page)) || '').replace(/\s+/g, ' ').trim();
      if (actual && G.normalizeLabel(actual) !== G.normalizeLabel(want)) {
        throw new Error(
          `[AN TOÀN] Ô ${col}2 đang mang nhãn "${actual}", không phải "${want}" — bố cục ` +
            `vòng ${roundNumber} khác giả định. Dừng lại, không ghi.`
        );
      }
    }

    console.log(
      `[SHEET] TEST LẦN ${roundNumber} tại cột ${colLetter} -> Trạng thái ${statusCol}, Kết quả ${resultCol}`
    );
    return { statusCol, resultCol };
  }

  throw new Error(
    `[AN TOÀN] Không tìm thấy nhãn "TEST LẦN ${roundNumber}" ở dòng 1 (đã dò 40 cột đầu). ` +
      `Nhãn vòng đọc được: ${seen.length ? seen.join(', ') : '(không có)'}. Dừng lại, không ghi.`
  );
}

/** Giữ chữ ký cũ (trả về chữ cái cột Kết quả), nay cũng không còn nhánh đoán đại */
async function resolveResultColumn(page, roundNumber = 1) {
  const { resultCol } = await resolveRoundColumnsByScan(page, roundNumber);
  return resultCol;
}

// ---------------------------------------------------------------------------
// Ghi dữ liệu
// ---------------------------------------------------------------------------

/**
 * Ghi text vào ô đang được chọn. Text nhiều dòng dùng Alt+Enter để xuống dòng
 * trong cùng 1 ô (Enter thường sẽ kết thúc việc nhập).
 */
async function typeIntoCell(page, text) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.down('Alt');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Alt');
      await new Promise((r) => setTimeout(r, 80));
    }
    // delay 10ms/ký tự: gõ delay 0 vào ô Google Sheet bị rớt/nhân đôi ký tự với
    // chuỗi dài (đã gặp: "Record: https://...9riolh.mp4" ra thành
    // "Record:https://...9riolh..mp4"), làm hỏng link video ghi lên Sheet.
    await page.keyboard.type(lines[i], { delay: 10 });
  }
}

/** Ghi đè nội dung 1 ô */
async function writeCell(page, cellAddress, text) {
  await gotoCell(page, cellAddress);
  // Xoá sạch rồi vào hẳn chế độ sửa trước khi nhập: gõ thẳng vào ô đang chọn thì
  // ký tự đầu tiên dùng để KÍCH HOẠT chế độ sửa và hay bị nuốt mất.
  await page.keyboard.press('Delete');
  await new Promise((r) => setTimeout(r, 250));
  await page.keyboard.press('F2');
  await new Promise((r) => setTimeout(r, 450));

  const pasted = await setClipboard(page, text);
  if (pasted) {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 600));
  } else {
    await typeIntoCell(page, text);
  }

  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Nạp text vào clipboard của trang. Trả về false nếu trình duyệt không cho phép.
 */
async function setClipboard(page, text) {
  try {
    // Sheets phải đang ở foreground thì navigator.clipboard mới ghi được.
    // Tab app bị đẩy xuống nền ở đây - runner có trách nhiệm bringToFront lại
    // trước case kế tiếp, nếu không Chrome bóp cổ tab nền và mọi lệnh CDP trên
    // nó sẽ TREO (đã gặp: EVAL_020/021/022 treo 308s ở page.evaluateHandle).
    await page.bringToFront();
    const ok = await page.evaluate(async (t) => {
      try {
        await navigator.clipboard.writeText(t);
        return true;
      } catch (e) {
        return false;
      }
    }, text);
    return ok;
  } catch (err) {
    return false;
  }
}

/**
 * Nối thêm nội dung vào cuối 1 ô.
 *
 * Ưu tiên dán bằng clipboard thay vì gõ từng ký tự: gõ chuỗi dài vào ô Google
 * Sheet hay bị autocomplete xen vào làm hỏng nội dung (đã gặp: link video
 * ".../9riolh.mp4" thành ".../9riolh..mp4"), lại chậm vì phải delay mỗi phím.
 * Dán thì nguyên khối, tức thì và không bị autocomplete đụng vào.
 * Phải ở trong chế độ sửa ô (F2) mới dán được text nhiều dòng vào CÙNG 1 ô -
 * dán khi chưa vào chế độ sửa sẽ bị Sheets tách thành nhiều dòng.
 */
async function appendToCell(page, cellAddress, text, hasExistingContent) {
  await gotoCell(page, cellAddress);
  await page.keyboard.press('F2');
  // Chờ hẳn 450ms: vào chế độ sửa ô chưa xong mà đã gõ/dán thì Sheets NUỐT vài
  // ký tự đầu (đã gặp: "Điền Trọng số..." vào ô thành "iền Trọng số...").
  await new Promise((r) => setTimeout(r, 450));

  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 250));

  if (hasExistingContent) {
    await page.keyboard.down('Alt');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Alt');
    await new Promise((r) => setTimeout(r, 200));
  }

  const pasted = await setClipboard(page, text);
  if (pasted) {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 600));
  } else {
    console.warn('[SHEET] Không dùng được clipboard, quay về cách gõ từng ký tự');
    await typeIntoCell(page, text);
  }

  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Cập nhật Trạng thái + Kết quả thực hiện + link video vào Google Sheet
 *
 * @param {object} browser  Puppeteer browser
 * @param {object} opts
 * @param {string} opts.testcaseId  Mã testcase, VD "EVAL_017"
 * @param {number} [opts.row]       Ép số dòng (bỏ qua bước dò)
 * @param {number} [opts.roundNumber=1]
 * @param {string} opts.videoUrl
 * @param {string} opts.resultText  Mô tả kết quả thực hiện
 * @param {boolean} [opts.pass]     true -> ghi "DONE", false -> ghi "Fail",
 *                                  undefined -> không đụng cột Trạng thái
 * @param {object} [opts.page]      Tab Sheet đã mở sẵn (để chạy song song lúc upload)
 */
async function updateSheetResult(
  browser,
  { testcaseId, row, roundNumber = 1, videoUrl, resultText, pass, page: presetPage }
) {
  console.log(`[SHEET] Bắt đầu cập nhật kết quả cho ${testcaseId}...`);
  const page = presetPage || (await getOrOpenSheetPage(browser));

  // 1. Nạp lưới 1 lần rồi tra dòng/cột trong RAM
  const grid = await fetchGrid(page);

  let targetRow = row || null;
  let statusCol = null;
  let resultCol = null;
  let existingResult = null;

  if (grid) {
    targetRow = targetRow || findRowInGrid(grid, testcaseId);
    if (!targetRow) {
      throw new Error(
        `Không tìm thấy mã testcase ${testcaseId} trong cột ${config.SHEET_ID_COLUMN} của tab "${config.SHEET_TAB}"`
      );
    }

    // Đối chiếu sơ bộ trên lưới. LƯU Ý: khi không truyền --row thì targetRow vừa
    // được suy ra từ CHÍNH ô này, nên phép so dưới đây là tautology và không chặn
    // được gì — nó chỉ thật sự có tác dụng cho trường hợp --row chỉ định tay.
    // Chốt thật nằm ở bước đọc sống ngay trước khi ghi, bên dưới.
    const idCol = letterToColIndex(config.SHEET_ID_COLUMN) - 1;
    const actualId = ((grid[targetRow - 1] || [])[idCol] || '').trim();
    if (actualId !== testcaseId.trim()) {
      throw new Error(
        `[AN TOÀN] Sai dòng! Mong đợi ${config.SHEET_ID_COLUMN}${targetRow} = "${testcaseId}", thực tế = "${actualId}". Dừng lại!`
      );
    }

    const cols = resolveRoundColumnsFromGrid(grid, roundNumber);
    if (!cols) {
      const have = G.listRoundNumbers(grid);
      throw new Error(
        `[AN TOÀN] Tab "${config.SHEET_TAB}" không có cột nào mang nhãn "TEST LẦN ${roundNumber}". ` +
          `Sheet đang có vòng: ${have.length ? have.join(', ') : '(không vòng nào)'}. ` +
          'Dừng lại — thêm cột cho vòng này trước, hoặc chạy vào vòng đã có.'
      );
    }

    const labels = G.checkRoundLabels(grid, roundNumber);
    if (!labels.ok) {
      throw new Error(
        `[AN TOÀN] Bố cục vòng ${roundNumber} không như mong đợi: ${labels.problems.join('; ')}. ` +
          'Dừng lại, không ghi.'
      );
    }

    statusCol = cols.statusCol;
    resultCol = cols.resultCol;

    const resultIdx = letterToColIndex(resultCol) - 1;
    existingResult = (grid[targetRow - 1] || [])[resultIdx] || '';
  }

  // 2. Fallback sang cách dò từng ô nếu không nạp được lưới
  if (!targetRow) {
    targetRow = await findRowByTestcaseId(page, testcaseId);
  }
  if (!resultCol) {
    const scanned = await resolveRoundColumnsByScan(page, roundNumber);
    statusCol = scanned.statusCol;
    resultCol = scanned.resultCol;
  }
  if (existingResult === null) {
    await gotoCell(page, `${resultCol}${targetRow}`);
    existingResult = await readCellText(page);
  }

  // ---------------------------------------------------------------------------
  // CHỐT SỐNG: đọc thật ô cột A của dòng sắp ghi, trên đúng trang sắp ghi.
  //
  // Đây là chốt DUY NHẤT độc lập với nguồn dữ liệu đã dùng để suy ra dòng, và nó
  // bắt được hai kiểu sai mà mọi chốt trên lưới đều mù:
  //   1. Lưới gviz có thể là bản cache cũ (xem ghi chú ở bước ghi bên dưới). Sheet
  //      vừa bị chèn/xoá dòng thì lưới vẫn trả vị trí cũ, và đối chiếu lưới với
  //      lưới thì luôn khớp.
  //   2. Ghi đi qua Name Box, mà Name Box luôn trỏ vào SUB-TAB đang hiển thị —
  //      trong khi lưới lại đọc qua gviz theo TÊN tab. Tab Sheets được tái dùng
  //      nếu đã mở (không kèm #gid), nên QC để sẵn một sub-tab khác là đọc một
  //      nơi ghi một nơi.
  // Giá: 1 lần đọc ô (~0.7s) cho mỗi lần ghi. Đổi lại là lần ghi duy nhất được
  // xác nhận đúng chỗ trên trang thật.
  // ---------------------------------------------------------------------------
  await gotoCell(page, `${config.SHEET_ID_COLUMN}${targetRow}`);
  const liveId = ((await readCellText(page)) || '').trim();
  if (liveId !== testcaseId.trim()) {
    throw new Error(
      `[AN TOÀN] Sai dòng! Ô ${config.SHEET_ID_COLUMN}${targetRow} trên trang đang mở = ` +
        `"${liveId}", không phải "${testcaseId}". Nguyên nhân thường gặp: tab Google Sheet ` +
        `đang hiển thị sub-tab khác "${config.SHEET_TAB}", hoặc Sheet đã chèn/xoá dòng sau ` +
        'khi lưới được nạp. Dừng lại, không ghi.'
    );
  }

  const resultCell = `${resultCol}${targetRow}`;
  const statusCell = `${statusCol}${targetRow}`;
  console.log(
    `[SHEET] ${testcaseId} -> dòng ${targetRow}, Trạng thái ${statusCell}, Kết quả ${resultCell}`
  );

  // 3. Ghi cột Trạng thái
  let statusWritten = null;
  if (typeof pass === 'boolean') {
    statusWritten = pass ? STATUS_PASS : STATUS_FAIL;
    await writeCell(page, statusCell, statusWritten);
    console.log(`[SHEET] Đã ghi Trạng thái ô ${statusCell}: "${statusWritten}"`);
  }

  // 4. Ghi cột Kết quả thực hiện (mô tả + link video), luôn NỐI THÊM, không xoá cũ
  const entryLines = [];
  if (resultText) entryLines.push(String(resultText).trim());
  if (videoUrl) entryLines.push(`- Video Test Record: ${videoUrl}`);
  const newEntry = entryLines.join('\n');

  if (!newEntry) {
    return { success: true, cell: statusCell, status: statusWritten, note: 'chỉ ghi Trạng thái' };
  }

  // Đọc LẠI nội dung thật của ô ngay trước khi ghi. Lưới CSV từ gviz có thể là
  // bản cache cũ - đã gặp: ô vừa bị xoá tay nhưng CSV vẫn trả nội dung rác cũ,
  // và bước ghi đè lấy nội dung đó ra "hồi sinh" lại rác vào Sheet.
  await gotoCell(page, resultCell);
  const liveExisting = await readCellText(page);
  const hasExisting = !!(liveExisting && liveExisting.trim().length > 0);

  if (hasExisting && videoUrl && liveExisting.includes(videoUrl)) {
    console.log(`[SHEET] Ô ${resultCell} đã chứa link video này, bỏ qua không ghi lại.`);
    return { success: true, cell: resultCell, status: statusWritten, state: 'already_exists' };
  }

  await appendToCell(page, resultCell, newEntry, hasExisting);

  // 5. Verify lại nội dung vừa ghi. So khớp TOÀN BỘ đoạn vừa thêm, không chỉ link
  //    video: chỉ kiểm tra link thì nội dung mất vài ký tự đầu vẫn lọt qua
  //    (đã gặp: "Điền Trọng số..." vào Sheet thành "iền Trọng số...").
  const checkCell = async () => {
    await gotoCell(page, resultCell);
    const text = await readCellText(page);
    const ok = entryLines.every((line) => text.includes(line));
    return { text, ok };
  };

  let verified = await checkCell();
  if (!verified.ok) {
    console.warn(
      `[SHEET] Nội dung ô ${resultCell} không khớp sau khi ghi (rớt ký tự?), đang ghi đè lại...`
    );
    const rewritten = hasExisting ? `${liveExisting.trim()}\n${newEntry}` : newEntry;
    await writeCell(page, resultCell, rewritten);
    verified = await checkCell();
  }

  if (!verified.ok) {
    throw new Error(
      `[SHEET] Ghi ô ${resultCell} thất bại sau 2 lần thử. Nội dung hiện tại: "${verified.text.slice(-120)}"`
    );
  }

  console.log(`[SHEET] Đã cập nhật thành công ô ${resultCell}`);
  return { success: true, cell: resultCell, statusCell, status: statusWritten, content: verified.text };
}

module.exports = {
  getOrOpenSheetPage,
  writeCellPublic: writeCell,
  gotoCell,
  readCellText,
  findRowByTestcaseId,
  resolveResultColumn,
  resolveRoundColumnsByScan,
  resolveRoundColumnsFromGrid,
  fetchGrid,
  parseCsv,
  updateSheetResult,
};
