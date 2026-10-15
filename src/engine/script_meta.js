// ============================================================================
// script_meta.js: nạp kịch bản, đọc khai báo v2, tính mã băm.
//
//   profile   hồ sơ cần dùng (mặc định 'default')
//   resources dữ liệu dùng chung → không chạy cùng lúc; tự suy thêm từ hằng số
//             DRAFT_TEMPLATE_NAME / TEMPLATE_NAME (tiền tố "mau:")
//   consumes  dữ liệu bị tiêu hao mỗi lần chạy → cảnh báo cần thêm bản; luôn gộp vào resources
//   parallel  true = tự nhận an toàn khi chạy song song; bỏ trống = chạy một mình
//   timeoutSec hạn giờ (10–1800, mặc định 150)
// Mã băm = file kịch bản + các helper thao tác: sửa bất kỳ file nào → phải chạy nháp lại.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { NAME_RE } = require('./profiles');
const { ticketOf } = require('./case_id');

const TESTCASE_DIR = path.join(config.ROOT_DIR, 'src', 'testcases');
const FIXTURE_CONST_RE = /(?:DRAFT_)?TEMPLATE_NAME\s*=\s*['"]([^'"]+)['"]/g;
const HASH_FILES = [
  'src/engine/ctx.js',
  'src/engine/steps.js',
  'src/core/evaluation_helpers.js',
  'src/core/cursor_motion.js',
  'src/core/page_ready.js',
  'src/core/datetime_picker.js',
];
const DEFAULT_TIMEOUT_SEC = 150;

function findScriptFile(caseId, dir = TESTCASE_DIR) {
  // Case AI-QC theo ticket để riêng thư mục tickets/ — kho kịch bản Đánh giá không lẫn với kịch bản ticket.
  if (ticketOf(caseId)) {
    const p = path.join(dir, 'tickets', `${caseId.toLowerCase()}.test.js`);
    return fs.existsSync(p) ? p : null;
  }
  for (const name of [`${caseId.toLowerCase()}.test.js`, `${caseId}.test.js`, `${caseId.toLowerCase()}_record.js`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function derivedResources(source) {
  const out = [];
  const re = new RegExp(FIXTURE_CONST_RE.source, 'g');
  let m;
  while ((m = re.exec(source)) !== null) out.push(`mau:${m[1]}`);
  return out;
}

function readMeta(mod, file, source = '') {
  const problems = [];
  const id = String(mod.id || path.basename(file).replace(/\.test\.js$|_record\.js$/i, '')).toUpperCase();
  const profile = mod.profile === undefined ? 'default' : String(mod.profile);
  if (!NAME_RE.test(profile)) problems.push(`profile "${profile}" không hợp lệ (chỉ a-z, 0-9, _)`);

  const list = (v, name) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
      problems.push(`${name} phải là mảng chuỗi`);
      return [];
    }
    return v.map((x) => x.trim());
  };
  const consumes = list(mod.consumes, 'consumes');
  const resources = [...new Set([...list(mod.resources, 'resources'), ...consumes, ...derivedResources(source)])];

  const t = mod.timeoutSec === undefined ? DEFAULT_TIMEOUT_SEC : Number(mod.timeoutSec);
  const timeoutOk = Number.isInteger(t) && t >= 10 && t <= 1800;
  if (!timeoutOk) problems.push(`timeoutSec "${mod.timeoutSec}" phải là số nguyên 10–1800`);
  if (typeof mod.run !== 'function') problems.push('thiếu hàm async run(ctx)');

  return {
    id,
    title: String(mod.title || ''),
    profile,
    resources,
    consumes,
    parallel: mod.parallel === true,
    timeoutSec: timeoutOk ? t : DEFAULT_TIMEOUT_SEC,
    problems,
  };
}

function scriptHash(file, root = config.ROOT_DIR, extra = HASH_FILES) {
  const h = crypto.createHash('sha256');
  const add = (p) => {
    h.update(path.relative(root, p).replace(/\\/g, '/'));
    h.update('\0');
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));
    h.update('\0');
  };
  add(file);
  for (const rel of extra) add(path.join(root, rel));
  const libDir = path.join(root, 'src', 'testcases', 'lib');
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js')).sort()) add(path.join(libDir, f));
  }
  return h.digest('hex').slice(0, 12);
}

/** null nếu chưa có kịch bản */
function loadScript(caseId) {
  const file = findScriptFile(caseId);
  if (!file) return null;
  const source = fs.readFileSync(file, 'utf8');
  const mod = require(file);
  return { file, module: mod, meta: readMeta(mod, file, source), hash: scriptHash(file) };
}

module.exports = { findScriptFile, derivedResources, readMeta, scriptHash, loadScript, HASH_FILES, DEFAULT_TIMEOUT_SEC, TESTCASE_DIR };
