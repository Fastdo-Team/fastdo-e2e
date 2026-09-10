// ============================================================================
// datetime_picker.js: Xử lý tương tác chuẩn với Flatpickr trên Fastdo
// ============================================================================

/**
 * Điền ngày giờ vào input Flatpickr và verify giá trị
 */
async function setFlatpickrField(page, placeholder, day, hour, minute) {
  const input = await page.$(`xpath/.//input[@placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Không tìm thấy input ngày giờ với placeholder "${placeholder}"`);
  
  await input.click();
  await new Promise((r) => setTimeout(r, 400));

  const dayHandles = await page.$$('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)');
  let target = null;
  for (const h of dayHandles) {
    const txt = await page.evaluate((el) => el.textContent.trim(), h);
    if (txt === String(day)) {
      target = h;
      break;
    }
  }
  if (!target) throw new Error(`Không tìm thấy ngày ${day} trong lịch đang mở`);
  await target.click();
  await new Promise((r) => setTimeout(r, 200));

  const hourInput = await page.$('.flatpickr-hour');
  if (hourInput) {
    await hourInput.click({ clickCount: 3 });
    await page.keyboard.type(String(hour).padStart(2, '0'));
    await page.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 150));
  }

  const minInput = await page.$('.flatpickr-minute');
  if (minInput) {
    await minInput.click({ clickCount: 3 });
    await page.keyboard.type(String(minute).padStart(2, '0'));
    await page.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 150));
  }

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));

  const finalValue = await page.evaluate(
    (ph) => document.querySelector(`input[placeholder="${ph}"]`)?.value,
    placeholder
  );

  const expectedFragment = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (!finalValue || !finalValue.includes(expectedFragment)) {
    throw new Error(
      `Giá trị ngày giờ sau khi điền chưa đúng: mong chứa "${expectedFragment}", thực tế "${finalValue}".`
    );
  }
  return finalValue;
}

module.exports = { setFlatpickrField };
