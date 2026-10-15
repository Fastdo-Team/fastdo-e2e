#!/usr/bin/env node
// ============================================================================
// kill-stray-chrome.js: dọn Chrome/Node của repo này còn sót lại sau khi kẹt.
//
//   npm run chrome:kill
//
// Vì sao cần: một lệnh dùng Chrome (probe/plan/test/Claude tự chạy) có thể treo
// giữa chừng — đặc biệt khi Claude tự spawn lệnh qua Bash tool của nó, tiến
// trình con trên Windows đi qua Git Bash và BỊ ĐỨT liên kết cha-con khỏi tiến
// trình `claude` trong bảng tiến trình, nên ngay cả taskkill /T (duyệt cây theo
// đúng liên kết cha-con) từ đúng gốc cũng không tìm thấy nó. Việc kill này dùng
// trong `server.js` khi bấm "Dừng"; tool này là bản CLI của đúng cơ chế đó, để
// dùng được cả khi giao diện không chạy — hoặc dùng ngay bằng tay khi thấy một
// cửa sổ Chrome trắng trơn không rõ vì sao.
//
// Chỉ nhắm vào tiến trình có đường dẫn REPO NÀY trong dòng lệnh (theo nội dung,
// không theo liên kết cha-con) — không đụng Chrome cá nhân hay MCP khác trên máy.
// ============================================================================

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');

function main() {
  if (process.platform !== 'win32') {
    console.error('[chrome:kill] Chỉ hỗ trợ Windows (repo này chạy trên Windows).');
    process.exitCode = 1;
    return;
  }

  console.log('='.repeat(70));
  console.log('  DỌN CHROME/NODE KẸT — theo đường dẫn repo, không theo cha-con');
  console.log('='.repeat(70));
  console.log(`  Repo: ${ROOT_DIR}`);
  console.log('');

  const needle = ROOT_DIR.replace(/'/g, "''"); // PowerShell single-quote: chỉ escape nháy đơn
  const self = process.pid;

  // Liệt kê trước để QC thấy đang giết đúng thứ gì — im lặng dọn hộ người khác
  // là cách nhanh nhất khiến người ta không dám dùng lại tool nữa.
  const listPs =
    `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') ` +
    `-and $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne ${self} } | ` +
    `Select-Object ProcessId,Name,CommandLine | Format-Table -AutoSize -Wrap | Out-String -Width 200`;

  const listed = spawnSync('powershell', ['-NoProfile', '-Command', listPs], { encoding: 'utf8', timeout: 20000 });
  const out = (listed.stdout || '').trim();

  if (!out || !/\d/.test(out)) {
    console.log('  Không có gì để dọn — sạch.');
    return;
  }

  console.log(out);

  const killPs =
    `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') ` +
    `-and $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne ${self} } | ` +
    `ForEach-Object { taskkill /PID $_.ProcessId /T /F }`;

  const killed = spawnSync('powershell', ['-NoProfile', '-Command', killPs], { encoding: 'utf8', timeout: 20000 });
  console.log(killed.stdout || '');
  if (killed.stderr) console.error(killed.stderr);
  console.log('-'.repeat(70));
  console.log('  Xong. Nếu Chrome vẫn còn cửa sổ mở, đóng tay lần này — lần sau tool tự bắt được.');
}

main();
