const puppeteer = require('puppeteer-core');
const config = require('./config');
const { getOrOpenSheetPage, gotoCell, verifyRowMatchesId, typeAppendDraft } = require('./sheet_writer');

const ROW = 20;
const RESULT_COL = 'U'; // TEST LẦN 3 - Kết quả thực hiện
const TESTCASE_ID = 'EVAL_017';
const APPEND_TEXT =
  '\nRetest lần 3: Tái lập đúng tiền điều kiện (draft có 1 nhóm rỗng lỗi + 1 nhóm "Nhom hop le EVAL_017" đã có tiêu chí). ' +
  'Bấm Kích hoạt bị chặn đúng ("Nhóm phải có ít nhất một tiêu chí"). Kiểm tra bằng code (không chỉ nhìn ảnh): khu vực nhóm KHÔNG có lỗi ' +
  'không hiển thị bất kỳ text lỗi thô "Lỗi: group.ErrorSummary" nào - đúng như mô tả case. Reload lại xác nhận Mẫu vẫn ở trạng thái Nháp. ' +
  'Ghi chú riêng: nhóm CÓ lỗi (rỗng) vẫn tự lộ text thô "Lỗi: group.ErrorSummary" trên chính nó - là 1 bug hiển thị khác, ngoài phạm vi câu hỏi case này.\n' +
  '- Video Test Record: https://files.catbox.moe/5a0ckh.mp4';

async function main() {
  const browser = await puppeteer.connect({ browserURL: config.CDP_URL, defaultViewport: null });
  const page = await getOrOpenSheetPage(browser);

  await verifyRowMatchesId(page, config.SHEET_ID_COLUMN, ROW, TESTCASE_ID);
  console.log('STEP: verify dòng', ROW, '= EVAL_017 OK');

  await gotoCell(page, `${RESULT_COL}${ROW}`);
  await page.screenshot({ path: 'cell_check_017.png' });
  console.log('STEP: đã tới ô', `${RESULT_COL}${ROW}`, '- xem cell_check_017.png');

  await typeAppendDraft(page, APPEND_TEXT, 'draft_check_017.png');
  console.log('STEP: đã gõ nháp - xem draft_check_017.png (CHƯA lưu)');

  await browser.disconnect();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
