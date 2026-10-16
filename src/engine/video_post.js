// ============================================================================
// video_post.js: hậu kỳ video 1 case — webm (Playwright) → mp4 H.264 có DẢI PHỤ ĐỀ BƯỚC
// đặt DƯỚI khung hình (đệm 60px, không đè lên app), kèm steps.vtt cho trình phát của UI.
//
// Phần "khởi động" (vào app, chọn tổ chức) được cắt khỏi đầu video như video cũ vốn
// không có bước đăng nhập. ffmpeg chạy với cwd = thư mục run và tên file tương đối — tránh
// lỗi thoát ký tự đường dẫn Windows trong filter `subtitles`. Tối đa 2 việc ffmpeg cùng lúc.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WIDTH = 1280;
const HEIGHT = 720;
const BAND = 60;
const two = (n) => String(n).padStart(2, '0');

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function assTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${two(m)}:${two(s)}.${two(cs % 100)}`;
}

function vttTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${two(h)}:${two(m)}:${two(s)}.${String(t % 1000).padStart(3, '0')}`;
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const assText = (t) =>
  String(t)
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\\/g, '/')
    .replace(/\r?\n/g, ' ');

/** Phụ đề theo bước; mốc thời gian đã trừ phần khởi động bị cắt đầu video */
function buildCaptions({ caseId, steps = [], trimMs = 0, durationMs = 0 }) {
  const end = Math.max(1000, durationMs - trimMs);
  const list = steps
    .map((s) => ({ ...s, start: Math.max(0, (s.startMs || 0) - trimMs) }))
    .filter((s) => s.start < end)
    .sort((a, b) => a.start - b.start);
  if (!list.length) return [{ startMs: 0, endMs: end, text: caseId }];
  const cues = [];
  if (list[0].start > 0) cues.push({ startMs: 0, endMs: list[0].start, text: `${caseId} · chuẩn bị` });
  list.forEach((s, i) => {
    const stop = list[i + 1] ? list[i + 1].start : end;
    if (stop <= s.start) return;
    cues.push({
      startMs: s.start,
      endMs: stop,
      text: `${caseId} · ${cut(String(s.label), 80)} · ${mmss(s.start)}${s.ok === false ? ' ✗' : ''}`,
    });
  });
  return cues;
}

function toAss(cues) {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT + BAND}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, ' +
      'Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, ' +
      'MarginR, MarginV, Encoding',
    'Style: Buoc,Arial,26,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,20,20,17,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Buoc,,0,0,0,,${assText(c.text)}`);
  return `${[...head, ...lines].join('\n')}\n`;
}

function toVtt(cues) {
  const body = cues.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.text}\n`);
  return `WEBVTT\n\n${body.join('\n')}`;
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

const limit = createLimiter(2);

function runFfmpeg(args, { cwd, timeoutMs = 180000, ffmpeg = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { cwd, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ffmpeg quá ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`không chạy được ffmpeg: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thoát mã ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/**
 * webm → mp4 + dải phụ đề bước. Ghi steps.ass + steps.vtt cạnh video.
 * @returns {Promise<{mp4: string, vtt: string, ass: string}>}
 */
function renderCaseVideo({ runDir, webmName = 'video.webm', mp4Name, caseId, steps, trimMs = 0, durationMs = 0, endMs = null }) {
  return limit(async () => {
    const cues = buildCaptions({ caseId, steps, trimMs, durationMs: endMs || durationMs });
    // endMs: hết phần giữ khung cuối — báo lỗi / dọn dẹp sau đó không đưa vào video
    const cut = endMs && endMs > trimMs ? ['-t', ((endMs - trimMs) / 1000).toFixed(3)] : [];
    fs.writeFileSync(path.join(runDir, 'steps.ass'), toAss(cues), 'utf8');
    fs.writeFileSync(path.join(runDir, 'steps.vtt'), toVtt(cues), 'utf8');
    await runFfmpeg(
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', (Math.max(0, trimMs) / 1000).toFixed(3),
        '-i', webmName,
        '-vf', `pad=${WIDTH}:${HEIGHT + BAND}:0:0:black,subtitles=steps.ass`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-an',
        ...cut,
        mp4Name,
      ],
      { cwd: runDir }
    );
    return { mp4: path.join(runDir, mp4Name), vtt: path.join(runDir, 'steps.vtt'), ass: path.join(runDir, 'steps.ass') };
  });
}

module.exports = {
  buildCaptions,
  toAss,
  toVtt,
  mmss,
  assTime,
  vttTime,
  createLimiter,
  runFfmpeg,
  renderCaseVideo,
  WIDTH,
  HEIGHT,
  BAND,
};
