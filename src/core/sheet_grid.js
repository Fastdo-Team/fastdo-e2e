// ============================================================================
// sheet_grid.js: NGUỒN DUY NHẤT hiểu bố cục lưới Google Sheet.
//
// Mọi câu hỏi "cột này thuộc vòng mấy", "vòng N ghi vào cột nào", "nhãn cột này
// là gì" đều phải đi qua đây. Trước kia có hai bản hiểu song song — sheet_service
// so khớp `===` chặt, còn file này dùng regex lỏng hơn — nên `plan` báo "vòng 3
// có cột" trong khi runner lại ghi về cột I của vòng 1. Một bố cục thì chỉ được
// có một bản hiểu.
//
// Nằm ở core/ chứ không phải tools/lib/ vì core/sheet_service.js (tầng dưới) cần
// nó; tools/ phụ thuộc core/, không bao giờ ngược lại.
//
// Lưới vào đây luôn là mảng 2 chiều từ sheet_service.fetchGrid():
//   grid[0] = dòng 1 = nhãn nhóm ("TEST LẦN 1", "TEST LẦN 2"...)
//   grid[1] = dòng 2 = tên cột ("Trạng thái", "Kết quả thực hiện"...)
//   grid[2..] = dữ liệu từng case
// ============================================================================

// Bố cục cố định của mỗi vòng test, tính từ cột mang nhãn "TEST LẦN n".
// Dùng làm nhãn dự phòng vì vài cột (Test Date) để trống ở dòng 2.
const ROUND_LAYOUT = [
  'Ưu tiên',
  'Môi trường',
  'Trạng thái',
  'Kết quả thực hiện',
  'DEV/QC NOTE',
  'Test Date',
];

// Vị trí 2 cột runner thực sự ghi vào, tính từ cột nhãn "TEST LẦN n".
const STATUS_OFFSET = 2;
const RESULT_OFFSET = 3;

// Nhãn kỳ vọng của 2 cột đó — suy ra từ ROUND_LAYOUT để không có bản chép thứ hai.
const STATUS_LABEL = ROUND_LAYOUT[STATUS_OFFSET];
const RESULT_LABEL = ROUND_LAYOUT[RESULT_OFFSET];

// Cho phép khác hoa/thường và khoảng trắng thừa, nhưng KHÔNG cho phép chữ thừa:
// "TEST LẦN 1 (cũ)" không khớp, còn "test  lần  1" thì khớp.
const ROUND_LABEL_RE = /^TEST\s+LẦN\s+(\d+)$/i;

/** Chuẩn hoá nhãn trước khi so khớp: gộp khoảng trắng, bỏ hoa/thường */
function normalizeLabel(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Cột đầu tiên mang nhãn "TEST LẦN n" ở dòng 1 — mốc chia đặc tả / kết quả */
function findFirstRoundColumn(headerRow) {
  for (let c = 0; c < headerRow.length; c += 1) {
    if (ROUND_LABEL_RE.test((headerRow[c] || '').trim())) return c;
  }
  return headerRow.length;
}

/** Cột mang nhãn "TEST LẦN n" gần nhất về bên trái của cột c (-1 nếu chưa có) */
function roundStartOf(grid, c) {
  const header = grid[0] || [];
  let start = -1;
  for (let i = 0; i <= c && i < header.length; i += 1) {
    if (ROUND_LABEL_RE.test((header[i] || '').trim())) start = i;
  }
  return start;
}

/** Nhóm vòng test mà cột c thuộc về, để biết "Trạng thái" này là của LẦN mấy */
function roundOf(grid, c) {
  const start = roundStartOf(grid, c);
  return start === -1 ? '' : ((grid[0] || [])[start] || '').trim().toUpperCase();
}

/**
 * Nhãn của cột c: ưu tiên dòng 2 (tên cột) → bố cục vòng test → dòng 1 → số cột.
 */
function columnLabel(grid, c) {
  const sub = ((grid[1] || [])[c] || '').replace(/\s+/g, ' ').trim();
  if (sub) return sub;

  const start = roundStartOf(grid, c);
  if (start !== -1 && ROUND_LAYOUT[c - start]) return ROUND_LAYOUT[c - start];

  const group = ((grid[0] || [])[c] || '').replace(/\s+/g, ' ').trim();
  return group || `cột ${c + 1}`;
}

/**
 * Chỉ số dòng (0-based trong grid) của mã case. -1 nếu không có.
 * Số dòng hiển thị trên Sheet = chỉ số này + 1.
 */
function findRowIndex(grid, testcaseId, idCol = 0) {
  const target = String(testcaseId || '').trim().toUpperCase();
  for (let r = 1; r < grid.length; r += 1) {
    if (((grid[r] || [])[idCol] || '').trim().toUpperCase() === target) return r;
  }
  return -1;
}

/** Mọi mã EVAL_* đang có ở cột ID — dùng để gợi ý khi gõ sai mã */
function listCaseIds(grid, idCol = 0) {
  return grid
    .slice(1)
    .map((r) => ((r || [])[idCol] || '').trim())
    .filter((v) => /^EVAL_/i.test(v));
}

/** Danh sách vòng test mà Sheet đang có cột: [{ number, startCol }] */
function listRounds(grid) {
  const header = (grid && grid[0]) || [];
  const rounds = [];
  for (let c = 0; c < header.length; c += 1) {
    const m = ROUND_LABEL_RE.exec((header[c] || '').trim());
    if (m) rounds.push({ number: parseInt(m[1], 10), startCol: c });
  }
  return rounds.sort((a, b) => a.number - b.number);
}

/** Chỉ số các vòng Sheet đang có, để đưa vào thông điệp lỗi */
function listRoundNumbers(grid) {
  return listRounds(grid).map((r) => r.number);
}

/** Cột nhãn "TEST LẦN n" của vòng n (0-based), -1 nếu Sheet không có vòng đó */
function findRoundStart(grid, roundNumber) {
  const hit = listRounds(grid).find((r) => r.number === Number(roundNumber));
  return hit ? hit.startCol : -1;
}

/**
 * Chỉ số 0-based của 2 cột runner sẽ ghi cho vòng n, hoặc null nếu Sheet không có
 * vòng đó. Trả null là tín hiệu DỪNG — gọi hàm tuyệt đối không được tự đoán một
 * cột thay thế, vì đoán sai nghĩa là ghi đè kết quả của vòng khác.
 */
function roundColumns(grid, roundNumber) {
  const startIdx = findRoundStart(grid, roundNumber);
  if (startIdx === -1) return null;
  return {
    startIdx,
    statusIdx: startIdx + STATUS_OFFSET,
    resultIdx: startIdx + RESULT_OFFSET,
  };
}

/**
 * Chốt cuối trước khi ghi: 2 ô sắp ghi có đúng mang nhãn "Trạng thái" và
 * "Kết quả thực hiện" ở dòng 2 không.
 *
 * Bố cục +2/+3 chỉ là giả định. Sheet khác bố cục — chuyện chắc chắn xảy ra khi
 * QC đổi sang link Sheet khác — sẽ làm runner ghi nhầm cột mà không ai biết.
 * Chốt này biến cái sai âm thầm đó thành một lỗi ồn ào.
 *
 * Trả { ok, problems: [] }. Dòng 2 để TRỐNG được coi là đạt, vì Sheet thật có vài
 * cột không điền tên — chỉ chặn khi nhãn có mà KHÁC với kỳ vọng.
 */
function checkRoundLabels(grid, roundNumber) {
  const cols = roundColumns(grid, roundNumber);
  if (!cols) {
    return { ok: false, problems: [`Sheet không có cột nào mang nhãn "TEST LẦN ${roundNumber}"`] };
  }

  const subHeader = (grid && grid[1]) || [];
  const problems = [];
  const expect = [
    { idx: cols.statusIdx, want: STATUS_LABEL, role: 'Trạng thái' },
    { idx: cols.resultIdx, want: RESULT_LABEL, role: 'Kết quả thực hiện' },
  ];

  for (const { idx, want, role } of expect) {
    const actual = (subHeader[idx] || '').replace(/\s+/g, ' ').trim();
    if (actual && normalizeLabel(actual) !== normalizeLabel(want)) {
      problems.push(`cột ${role} của vòng ${roundNumber} đang mang nhãn "${actual}", không phải "${want}"`);
    }
  }

  // Cột đích phải còn nằm trong khối của CHÍNH vòng đó. Khi dòng 2 để trống, đây
  // là chốt duy nhất còn lại: một khối vòng hẹp hơn 4 cột sẽ đẩy cột Kết quả của
  // vòng này sang địa phận vòng sau, mà phép so nhãn ở trên không thấy gì cả.
  const inBlock = [
    { idx: cols.statusIdx, role: 'Trạng thái' },
    { idx: cols.resultIdx, role: 'Kết quả thực hiện' },
  ];
  for (const { idx, role } of inBlock) {
    if (roundStartOf(grid, idx) !== cols.startIdx) {
      problems.push(
        `cột ${role} của vòng ${roundNumber} đã lấn sang khối vòng khác ` +
          `(${roundOf(grid, idx) || 'ngoài mọi vòng'}) — khối vòng này hẹp hơn bố cục chuẩn`
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Tình trạng từng vòng của 1 case: vòng nào đã có người ghi kết quả.
 * `hasData` là căn cứ để suy ra vòng kế tiếp — coi là đã chạy khi Trạng thái
 * HOẶC Kết quả thực hiện có nội dung, vì QC ghi tay đôi khi chỉ điền một trong hai.
 */
function roundsOfCase(grid, rowIdx) {
  const row = grid[rowIdx] || [];
  return listRounds(grid).map(({ number, startCol }) => {
    // Theo nhãn dòng 2 nếu có; Sheet để trống nhãn thì lùi về offset cũ.
    const { cols } = findRoundColumnsByLabel(grid, number);
    const statusIdx = cols.status !== null ? cols.status : startCol + STATUS_OFFSET;
    const resultIdx = cols.result !== null ? cols.result : startCol + RESULT_OFFSET;
    const status = (row[statusIdx] || '').trim();
    const result = (row[resultIdx] || '').trim();
    return {
      number,
      startCol,
      status,
      result,
      hasData: Boolean(status || result),
    };
  });
}

/**
 * Vòng test nên ghi tiếp = vòng cao nhất đã có dữ liệu + 1.
 * Trả kèm `columnExists` để biết Sheet đã có sẵn cột cho vòng đó chưa — chạy vào
 * vòng chưa có cột thì runner sẽ DỪNG (xem roundColumns), nên biết trước là hơn.
 */
function suggestNextRound(grid, rowIdx) {
  const rounds = roundsOfCase(grid, rowIdx);
  const done = rounds.filter((r) => r.hasData);
  const next = done.length ? Math.max(...done.map((r) => r.number)) + 1 : 1;
  return {
    next,
    done,
    columnExists: rounds.some((r) => r.number === next),
    maxRoundColumn: rounds.length ? Math.max(...rounds.map((r) => r.number)) : 0,
  };
}

/**
 * Phần đặc tả của case (mọi cột bên trái mốc "TEST LẦN 1"), dạng [{label, value}].
 * Đây là thứ phải bám đúng khi viết kịch bản — đừng tự nghĩ tiêu chí khác.
 */
function readSpec(grid, rowIdx) {
  const row = grid[rowIdx] || [];
  const firstRoundCol = findFirstRoundColumn(grid[0] || []);
  const out = [];
  for (let c = 0; c < firstRoundCol; c += 1) {
    const value = (row[c] || '').trim();
    if (value) out.push({ label: columnLabel(grid, c), value });
  }
  return out;
}

/** In khối đặc tả ra terminal, giá trị nhiều dòng thì thụt lề cho dễ đọc */
function printSpec(spec, indent = '') {
  if (!spec.length) {
    console.log(`${indent}(mọi cột đặc tả đều rỗng — kiểm tra lại tab Sheet)`);
    return;
  }
  for (const { label, value } of spec) {
    if (value.includes('\n')) {
      console.log(`\n${indent}${label}:`);
      value.split('\n').forEach((l) => console.log(`${indent}    ${l.trim()}`));
    } else {
      console.log(`${indent}${label}: ${value}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Engine v2 (kỳ 1): tìm cột theo NHÃN trong khối vòng, thay cho offset cố định.
//
// Sheet thật (tab V1, 2026-09-28): vòng 1–5 rộng 7 cột (có FIXED), vòng 6+ rộng 6 cột,
// vòng 1 có "FEEDBACK AI" thay "DEV /QC NOTE", nhãn có khoảng trắng thừa ở đầu. Offset
// +2/+3 vẫn đúng cho Trạng thái/Kết quả nhưng Test Date lệch theo vòng — nên mọi cột
// engine v2 ghi đều tìm theo nhãn dòng 2, trong đúng phạm vi khối của vòng đó.
// ---------------------------------------------------------------------------

const WRITE_LABELS = {
  status: 'Trạng thái',
  result: 'Kết quả thực hiện',
  env: 'Môi trường',
  testDate: 'Test Date',
};

/** Chữ cái cột từ chỉ số 0-based: 0 → A, 25 → Z, 26 → AA */
function colLetter(idx) {
  let n = Number(idx) + 1;
  let out = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

/**
 * Khối cột của vòng n: từ ô "TEST LẦN n" tới trước ô "TEST LẦN" kế tiếp THEO VỊ TRÍ.
 * Vòng cuối kéo tới hết chiều rộng dài nhất của 2 dòng tiêu đề (Sheets API cắt ô trống
 * ở đuôi dòng 1). null = Sheet không có vòng đó.
 */
function roundBlock(grid, roundNumber) {
  const rounds = listRounds(grid);
  const hit = rounds.find((r) => r.number === Number(roundNumber));
  if (!hit) return null;
  const later = rounds.map((r) => r.startCol).filter((c) => c > hit.startCol);
  const width = Math.max(((grid && grid[0]) || []).length, ((grid && grid[1]) || []).length);
  return { startIdx: hit.startCol, endIdx: later.length ? Math.min(...later) : width };
}

/**
 * Các cột engine v2 ghi cho vòng n, tìm theo nhãn dòng 2 trong đúng khối của vòng.
 * - Trạng thái / Kết quả thực hiện: phải có ĐÚNG 1 cột, không thì ok = false (DỪNG).
 * - Môi trường / Test Date: thiếu hoặc trùng thì để null kèm cảnh báo.
 * Trả { ok, cols: {status, result, env, testDate} (0-based | null), block, problems, warnings }.
 */
function findRoundColumnsByLabel(grid, roundNumber) {
  const cols = { status: null, result: null, env: null, testDate: null };
  const block = roundBlock(grid, roundNumber);
  if (!block) {
    return {
      ok: false,
      cols,
      block: null,
      problems: [`Sheet không có cột nào mang nhãn "TEST LẦN ${roundNumber}"`],
      warnings: [],
    };
  }

  const sub = (grid && grid[1]) || [];
  const hitsOf = (label) => {
    const want = normalizeLabel(label);
    const hits = [];
    for (let c = block.startIdx; c < block.endIdx; c += 1) {
      if (normalizeLabel(sub[c]) === want) hits.push(c);
    }
    return hits;
  };

  // Khối có 2 bộ cột thường vì ô tiêu đề của vòng kế tiếp bị để trống (đã gặp thật:
  // ô AU1 của tab V1 thiếu "TEST LẦN 7"). Chỉ đúng ô cần điền thay vì chỉ nói "trùng".
  const firstLabel = normalizeLabel(ROUND_LAYOUT[0]);
  let missingHeaderHint = '';
  for (let c = block.startIdx + 1; c < block.endIdx; c += 1) {
    if (normalizeLabel(sub[c]) === firstLabel) {
      missingHeaderHint = ` — có vẻ ô ${colLetter(c)}1 đang thiếu nhãn "TEST LẦN ${Number(roundNumber) + 1}"`;
      break;
    }
  }

  const problems = [];
  const warnings = [];
  for (const key of ['status', 'result']) {
    const hits = hitsOf(WRITE_LABELS[key]);
    if (hits.length === 1) cols[key] = hits[0];
    else if (hits.length === 0) {
      problems.push(`khối vòng ${roundNumber} không có cột "${WRITE_LABELS[key]}" ở dòng 2`);
    } else {
      problems.push(
        `khối vòng ${roundNumber} có ${hits.length} cột "${WRITE_LABELS[key]}" ` +
          `(${hits.map(colLetter).join(', ')}) — không biết ghi cột nào${missingHeaderHint}`
      );
    }
  }
  for (const key of ['env', 'testDate']) {
    const hits = hitsOf(WRITE_LABELS[key]);
    if (hits.length === 1) cols[key] = hits[0];
    else if (hits.length === 0) {
      warnings.push(`khối vòng ${roundNumber} không có cột "${WRITE_LABELS[key]}" — bỏ qua cột này`);
    } else {
      warnings.push(
        `khối vòng ${roundNumber} có ${hits.length} cột "${WRITE_LABELS[key]}" ` +
          `(${hits.map(colLetter).join(', ')}) — bỏ qua cột này để khỏi ghi nhầm`
      );
    }
  }

  return { ok: problems.length === 0, cols, block, problems, warnings };
}

/** Mọi dòng (0-based) mang mã case ở cột ID — để phát hiện mã trùng */
function findRowIndices(grid, testcaseId, idCol = 0) {
  const target = String(testcaseId || '').trim().toUpperCase();
  const out = [];
  for (let r = 1; r < (grid || []).length; r += 1) {
    if (((grid[r] || [])[idCol] || '').trim().toUpperCase() === target) out.push(r);
  }
  return out;
}

module.exports = {
  ROUND_LAYOUT,
  ROUND_LABEL_RE,
  STATUS_OFFSET,
  RESULT_OFFSET,
  STATUS_LABEL,
  RESULT_LABEL,
  normalizeLabel,
  findFirstRoundColumn,
  roundStartOf,
  roundOf,
  columnLabel,
  findRowIndex,
  listCaseIds,
  listRounds,
  listRoundNumbers,
  findRoundStart,
  roundColumns,
  checkRoundLabels,
  roundsOfCase,
  suggestNextRound,
  readSpec,
  printSpec,
  WRITE_LABELS,
  colLetter,
  roundBlock,
  findRoundColumnsByLabel,
  findRowIndices,
};
