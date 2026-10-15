const test = require('node:test');
const assert = require('node:assert');
const { parseEnvLabels, resolveEnvLabel, DEFAULT_ENV_LABELS } = require('./env_label');

test('mặc định khớp danh sách chọn của Sheet: Localhost / Beta / Production', () => {
  const rules = parseEnvLabels('');
  assert.strictEqual(resolveEnvLabel('https://60rr1632-3000.asse.devtunnels.ms/', rules), 'Localhost');
  assert.strictEqual(resolveEnvLabel('https://beta.fastdo.vn/', rules), 'Beta');
  assert.strictEqual(resolveEnvLabel('https://app.fastdo.vn/evaluation', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('https://fastdo.vn', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('http://localhost:3000', rules), 'Localhost');
  assert.match(DEFAULT_ENV_LABELS, /beta\.fastdo\.vn=Beta/);
});

test('hậu tố khớp theo ranh giới tên miền (notfastdo.vn không phải fastdo.vn)', () => {
  assert.strictEqual(resolveEnvLabel('https://notfastdo.vn', parseEnvLabels('')), null);
});

test('host lạ hoặc URL hỏng → null', () => {
  const rules = parseEnvLabels('');
  assert.strictEqual(resolveEnvLabel('https://example.com', rules), null);
  assert.strictEqual(resolveEnvLabel('không phải url', rules), null);
});

test('ENV_LABELS tự khai thay mặc định; hậu tố dài nhất thắng; bỏ dấu chấm đầu', () => {
  const rules = parseEnvLabels(' .fastdo.vn=Production , staging.fastdo.vn=Beta ');
  assert.strictEqual(resolveEnvLabel('https://x.staging.fastdo.vn', rules), 'Beta');
  assert.strictEqual(resolveEnvLabel('https://y.fastdo.vn', rules), 'Production');
  assert.strictEqual(resolveEnvLabel('https://x.devtunnels.ms', rules), null);
});

test('ENV_LABELS sai cú pháp thì ném lỗi nói rõ', () => {
  assert.throws(() => parseEnvLabels('devtunnels.ms'), /phải có dạng/);
  assert.throws(() => parseEnvLabels('=Localhost'), /phải có dạng/);
  assert.throws(() => parseEnvLabels('dev tunnels=Localhost'), /không hợp lệ/);
});
