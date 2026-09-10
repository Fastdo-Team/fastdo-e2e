// Recipe đã kiểm chứng cho input ngày giờ dùng thư viện Flatpickr trong app Fastdo.
// KHÔNG dùng element._flatpickr.setDate() (JS API trực tiếp) — đã kiểm chứng KHÔNG ổn định,
// Blazor re-render làm hỏng tham chiếu instance (lỗi thật gặp: "Cannot read properties of
// undefined (reading 'dateFormat')"). Cách dưới đây click xuyên qua UI lịch thật, đã verify
// bằng submit thật thành công (không bị chặn validate ngày giờ).
async function setFlatpickrField(page, placeholder, day, hour, minute) {
  const input = await page.$(`xpath/.//input[@placeholder="${placeholder}"]`);
  if (!input) throw new Error(`không tìm thấy input ngày giờ với placeholder "${placeholder}"`);
  await input.click();
  await new Promise((r) => setTimeout(r, 600));

  const dayHandles = await page.$$('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)');
  let target = null;
  for (const h of dayHandles) {
    const txt = await page.evaluate((el) => el.textContent.trim(), h);
    if (txt === String(day)) {
      target = h;
      break;
    }
  }
  if (!target) throw new Error(`không tìm thấy ngày ${day} trong lịch đang mở`);
  await target.click();
  await new Promise((r) => setTimeout(r, 300));

  const hourInput = await page.$('.flatpickr-hour');
  await hourInput.click({ clickCount: 3 });
  await page.keyboard.type(String(hour).padStart(2, '0'));
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 300));

  const minInput = await page.$('.flatpickr-minute');
  await minInput.click({ clickCount: 3 });
  await page.keyboard.type(String(minute).padStart(2, '0'));
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 300));

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  // Đọc lại giá trị thật để xác nhận — đã gặp trường hợp gõ phút bị rớt 1 ký tự.
  const finalValue = await page.evaluate(
    (ph) => document.querySelector(`input[placeholder="${ph}"]`)?.value,
    placeholder
  );
  const expectedFragment = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (!finalValue || !finalValue.includes(expectedFragment)) {
    throw new Error(
      `Giá trị sau khi set không đúng: mong chứa "${expectedFragment}", thực tế "${finalValue}". Thử gọi lại setFlatpickrField cho field này.`
    );
  }
  return finalValue;
}

module.exports = { setFlatpickrField };
