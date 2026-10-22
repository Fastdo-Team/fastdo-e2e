// ============================================================================
// hrm_form.js: hàm dùng chung cho kịch bản AI-QC chạm Đơn từ (HRM) — tạo đơn OT, mở chi tiết, đọc thời gian.
//
// Rút từ kịch bản ticket 1309 (2026-10-15, chạy được trên bản dev): đơn OT do chính tài khoản thử tạo và tự chọn mình làm người
// duyệt, lý do = tag để tìm lại đúng đơn. url = địa chỉ đầy đủ màn Đơn từ (vd new URL('/hrm/form', config.TARGET_URL)).
// Chỉ THÊM hàm mới; sửa hàm có sẵn thì giữ nguyên tên, tham số, giá trị trả về (kịch bản ticket khác đang dùng).
// ============================================================================

const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Mở màn Đơn từ ở url, chờ nút «Tạo mới», đóng popup «Bật thông báo đẩy» nếu có. */
async function gotoForm(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByText('Tạo mới', { exact: true }).first().waitFor({ timeout: 25000 });
  const deny = page.locator('button:has-text("Từ chối")').first();
  if (await deny.isVisible().catch(() => false)) await deny.click();
}

/** Tên hiển thị của tài khoản đang đăng nhập (đọc từ menu avatar góc trên) — dùng để tự chọn mình làm người duyệt. */
async function getMyName(page) {
  await page.locator('#header .dropdown button').last().click();
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('.dropdown.is-active'))
      .map((x) => x.innerText.split('\n').map((s) => s.trim()).filter(Boolean))
      .find((a) => a[0] === 'info');
    return d ? d[1] : '';
  });
}

/**
 * Tạo 1 đơn OT 60 phút ngày nghỉ (người duyệt = chính tài khoản), lý do = tag; tự dời khung giờ khi bị báo trùng. Trả { start, end } 'HH:mm'.
 * Lỗi (không đọc được tên, mọi khung giờ bị từ chối) → throw.
 * @deprecated Tạo dữ liệu qua giao diện (chậm, đơn cũ chồng giờ) — từ agent 1.8.0 dữ liệu thử ghi thẳng Mongo QC: dùng seedOtForm(db, …).
 */
async function createOT(page, url, tag) {
  await gotoForm(page, url);
  const me = await getMyName(page);
  if (!me) throw new Error('Không đọc được tên tài khoản đang đăng nhập để chọn làm người duyệt');
  await gotoForm(page, url);
  await page.getByText('Tạo mới', { exact: true }).first().click();
  const sel = page.locator('select').filter({ hasText: 'Chọn loại đơn từ' }).first();
  await sel.waitFor({ timeout: 10000 });
  await sel.selectOption({ label: 'Đơn từ làm thêm' });
  const times = page.locator('select').filter({ hasText: '01:05' });
  await times.nth(1).waitFor({ timeout: 10000 });
  await page.locator('select').filter({ hasText: 'Chọn thời điểm' }).first().selectOption({ label: 'Ngày nghỉ' });
  await page.locator('textarea[placeholder="Nhập lý do..."]').fill(tag);
  await page.locator('input[placeholder="Chọn người phê duyệt"]').click();
  await page.waitForTimeout(800);
  await page.getByText(me, { exact: true }).last().click();
  await page.waitForTimeout(800);
  const now = new Date();
  // Khung giờ khởi đầu theo đồng hồ; bị báo trùng thì nhảy tới sau đơn đang trùng (chừa 35 phút để còn sửa kéo dài thêm 30 phút)
  const LAST_START = 22 * 60 + 25;
  let cand = 60 + 5 * ((now.getHours() * 60 + now.getMinutes() + now.getSeconds()) % 250);
  let wraps = 0;
  for (let i = 0; i < 25; i++) {
    if (cand > LAST_START) {
      if (++wraps > 1) break;
      cand = 60;
    }
    const start = fmt(cand);
    const end = fmt(cand + 60);
    await times.nth(0).selectOption(start);
    await times.nth(1).selectOption(end);
    await page.getByText('bị trùng').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    const done = page.getByText('Đã đăng ký đơn từ thành công').first();
    const dup = page.getByText('bị trùng').first();
    const res = await Promise.race([
      done.waitFor({ timeout: 8000 }).then(() => 'ok', () => 'none'),
      dup.waitFor({ timeout: 8000 }).then(() => 'dup', () => 'none'),
    ]);
    if (res === 'ok') return { start, end };
    let next = cand + 30;
    if (res === 'dup') {
      const msg = await dup.innerText().catch(() => '');
      const ends = [...msg.matchAll(/\d\d:\d\d - (\d\d:\d\d)/g)].map((m) => toMin(m[1]));
      if (ends.length) next = Math.max(...ends) + 35;
    }
    cand = Math.max(cand + 5, Math.ceil(next / 5) * 5);
  }
  throw new Error('Không tạo được đơn OT: mọi khung giờ thử đều bị từ chối (trùng đơn khác hoặc vi phạm quy định)');
}

/** Mở popup chi tiết đơn OT có lý do chứa tag (đang ở màn Đơn từ); pending = chờ nút «Chỉnh sửa» (đơn chờ duyệt). */
async function openDetail(page, tag, { pending = true } = {}) {
  const row = page.locator('tr').filter({ hasText: tag }).first();
  await row.getByText('Đơn từ làm thêm').first().click({ timeout: 10000 });
  await page.getByText('Thời gian đăng kí làm thêm').first().waitFor({ timeout: 15000 });
  if (pending) await btn(page, 'Chỉnh sửa').waitFor({ timeout: 10000 });
  else await page.waitForTimeout(1500);
}

/** Nút có icon đứng trước nhãn (vd «edit Chỉnh sửa») → locator khớp theo đuôi nhãn. */
function btn(page, label) {
  return page.getByRole('button', { name: new RegExp(`(^|\\s)${label}$`) }).first();
}

/** Đọc «Thời gian đăng kí làm thêm» ở chế độ xem của popup chi tiết: 'dd/MM/yyyy HH:mm - dd/MM/yyyy HH:mm' ('' nếu không thấy). */
async function readOT(page) {
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\s*\n\s*/g, ' | ');
    const m = t.match(/Quy đổi \| (\d\d\/\d\d\/\d{4}) \| (\d\d:\d\d) \| arrow_downward \| (\d\d\/\d\d\/\d{4}) \| (\d\d:\d\d)/);
    return m ? `${m[1]} ${m[2]} - ${m[3]} ${m[4]}` : '';
  });
}

/** Giờ đang chọn ở 2 ô giờ của popup chi tiết khi đang «Chỉnh sửa»: ['HH:mm', 'HH:mm']. */
async function readEditTimes(page) {
  return page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('select')).filter((x) => x.options.length > 200 && x.options[0].value === '01:00');
    return s.map((x) => x.value);
  });
}

/** Đóng popup chi tiết đơn (bấm «Đóng»), chờ popup biến mất; popup đã tự đóng thì bỏ qua. */
async function closeDetail(page) {
  const header = page.getByText('Thời gian đăng kí làm thêm').first();
  if (!(await header.isVisible().catch(() => false))) return;
  // popup có thể tự đóng ngay lúc bấm (sau Xác nhận / Từ chối) → bỏ qua lỗi click, chỉ cần popup đã đóng
  await page.getByText('Đóng', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Thời gian đăng kí làm thêm').first().waitFor({ state: 'detached', timeout: 10000 });
}

/**
 * Ghi thẳng 1 đơn OT chờ duyệt vào hrm_form (Mongo QC): người nộp = user, lý do = tag, hôm nay từ startHHmm đến endHHmm, lớp duyệt theo approvers
 * (mặc định [user]; mỗi phần tử 1 lớp, status 1 = chờ). Tuỳ chọn: workCoefficient (vd { value: 1, value_config: 1, workShifts: [...] }), day (Date, mặc định
 * hôm nay). Trả { id, start: Date, end: Date }. Không thấy loại đơn OT trong hrm_rules.forms → throw.
 */
async function seedOtForm(db, { tag, user, startHHmm, endHHmm, approvers, workCoefficient, day = new Date() }) {
  const rules = await db.findOne('hrm_rules', {});
  const formDef = rules && (rules.forms || []).find((f) => f.type === 2);
  if (!formDef) throw new Error('Công ty thử chưa có loại đơn OT (hrm_rules.forms type = 2) để ghi đơn');
  const at = (hhmm) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  const start = at(startHHmm);
  const end = at(endHHmm);
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const list = approvers && approvers.length ? approvers : [user];
  const rec = await db.insert('hrm_form', {
    created_at: 0n,
    updated_at: 0n,
    hours_ot: (toMin(endHHmm) - toMin(startHHmm)) / 60,
    hours_to_workshift: 0,
    max_minutes: 0,
    user,
    created: db.ticks(),
    confirm_date: 0n,
    form: { ...formDef, ot_info: { ...(formDef.ot_info || {}), type: 1 } },
    work_date_shifts: [{ start: db.ticks(start), end: db.ticks(end), loaded: false, id_string: null }],
    is_confirm: false,
    reason: tag,
    reason_destroy: null,
    is_destroy: false,
    destroy_date: 0n,
    destroy_user: null,
    images: [],
    users: [],
    users_comment: [user],
    confirm_users: list.map((id, i) => ({ pos: i + 1, user: id, allowOther: false, otherUsers: [], status: 1, date: 0n, is_approve_type_4: false, behalfUser: null })),
    comment: 0,
    files: [],
    analysis_content: null,
    workShifts: [{ date: db.ticks(midnight), shifts: [] }],
    location_id: null,
    value: 0,
    value_last_year: 0,
    value_take_permits: 0,
    value_reward: 0,
    is_paid_by_accumulated_hours: false,
    value_accumulated_hours_used: 0,
    shift_change: { id_shift: null, id_desired_shift: null, user_desired_shift: null, current_date: 0n, desired_date: 0n },
    coefficient: 1,
    edits_history: [],
    time_inout_reality: null,
    rules_history: rules.current_rules || null,
    checkin_id_ot: null,
    users_follow: [],
    is_mobile: false,
    workCoefficient: workCoefficient || { value: 1, workShifts: [], value_config: 1 },
    annual_leave_of_type_five: 0,
    shift_edit_by_form: '',
    proxy_user_id: '',
  });
  return { id: rec._id, start, end };
}

/** Khung giờ OT 60 phút rạng sáng (01:00–04:55) suy từ đồng hồ, ít đụng ca làm / đơn khác: trả { startHHmm, endHHmm }. */
function quietSlot(now = new Date()) {
  const s = 60 + 5 * ((now.getMinutes() * 60 + now.getSeconds()) % 48);
  return { startHHmm: fmt(s), endHHmm: fmt(s + 60) };
}

/** Mở màn Đơn từ đã mở sẵn lại sau khi ghi dữ liệu: tải lại trang, chờ nút «Tạo mới», đóng popup «Bật thông báo đẩy» nếu có. */
async function reloadForm(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Tạo mới', { exact: true }).first().waitFor({ timeout: 25000 });
  const deny = page.locator('button:has-text("Từ chối")').first();
  if (await deny.isVisible().catch(() => false)) await deny.click().catch(() => {});
}

/** Chế độ OT qua ngày: 2 ô «Ngày bắt đầu»/«Ngày kết thúc» (flatpickr) khi đang «Chỉnh sửa» — đọc ['dd/MM/yy HH:mm', 'dd/MM/yy HH:mm']. */
async function readEditDates(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input.flatpickr-input'))
      .map((x) => x.value)
      .filter((v) => /^\d\d\/\d\d\/\d\d \d\d:\d\d$/.test(v))
  );
}

/** Chọn ngày giờ cho ô flatpickr thứ idx (0 = bắt đầu, 1 = kết thúc) của popup đang «Chỉnh sửa» (OT qua ngày): date = Date theo giờ máy. */
async function setEditDate(page, idx, date) {
  await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll('[data-aiqc-ot]').forEach((e) => e.removeAttribute('data-aiqc-ot'));
    document.querySelectorAll('input.flatpickr-input').forEach((x) => {
      if (/^\d\d\/\d\d\/\d\d \d\d:\d\d$/.test(x.value)) x.setAttribute('data-aiqc-ot', String(n++));
    });
  });
  const input = page.locator(`input[data-aiqc-ot="${idx}"]`);
  await input.click({ timeout: 8000 });
  await page.waitForTimeout(500);
  await input.evaluate((el, p) => {
    const fp = el._flatpickr;
    fp.setDate(new Date(p[0], p[1], p[2], p[3], p[4]), true);
    fp.close();
  }, [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]);
  await page.waitForTimeout(800);
}

module.exports = { btn, fmt, toMin, gotoForm, getMyName, createOT, openDetail, readOT, readEditTimes, closeDetail, seedOtForm, quietSlot, reloadForm, readEditDates, setEditDate };
