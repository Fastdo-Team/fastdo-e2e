// ============================================================================
// env_label.js: nhãn cột "Môi trường" suy từ tên miền của TARGET_URL.
//
// Ô Môi trường trên Sheet là danh sách chọn strict: Beta / Localhost / Production.
// Mặc định khớp đúng 3 nhãn đó; `beta.fastdo.vn` lấy từ tài liệu repo fastdo-server.
// Hậu tố dài nhất thắng, nên beta.fastdo.vn → Beta dù fastdo.vn → Production.
// ============================================================================

const DEFAULT_ENV_LABELS =
  'devtunnels.ms=Localhost,localhost=Localhost,beta.fastdo.vn=Beta,fastdo.vn=Production';

/** "hậu tố=nhãn,…" → [{ suffix, label }]. Rỗng = mặc định. Sai cú pháp thì ném lỗi. */
function parseEnvLabels(raw) {
  const text = String(raw == null ? '' : raw).trim() || DEFAULT_ENV_LABELS;
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i <= 0 || i === pair.length - 1) {
        throw new Error(`ENV_LABELS: "${pair}" phải có dạng <hậu tố tên miền>=<nhãn>, vd devtunnels.ms=Localhost`);
      }
      const suffix = pair.slice(0, i).trim().toLowerCase().replace(/^\.+/, '');
      const label = pair.slice(i + 1).trim();
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(suffix)) {
        throw new Error(`ENV_LABELS: hậu tố tên miền "${suffix}" không hợp lệ`);
      }
      if (!label || /[\r\n=]/.test(label)) {
        throw new Error(`ENV_LABELS: nhãn của "${suffix}" không hợp lệ`);
      }
      return { suffix, label };
    });
}

/** Nhãn Môi trường của URL, hoặc null nếu không khớp hậu tố nào (engine sẽ chặn ghi). */
function resolveEnvLabel(targetUrl, rules) {
  let host;
  try {
    host = new URL(String(targetUrl)).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hits = (rules || []).filter((r) => host === r.suffix || host.endsWith(`.${r.suffix}`));
  if (!hits.length) return null;
  return hits.reduce((best, r) => (r.suffix.length > best.suffix.length ? r : best)).label;
}

module.exports = { DEFAULT_ENV_LABELS, parseEnvLabels, resolveEnvLabel };
