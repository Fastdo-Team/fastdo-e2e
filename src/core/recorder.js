// [ENGINE V1 — PUPPETEER] Từ 2026-09-29 engine v2 (src/engine/, Playwright + Sheets API) không còn gọi file này. Giữ nguyên, không xoá (theo lệ repo).
// ============================================================================
// recorder.js: Quản lý ghi video kiểm thử kèm con trỏ ảo
// ============================================================================

const fs = require('fs');
const path = require('path');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const config = require('../config');

class TestRecorder {
  constructor(page, options = {}) {
    this.page = page;
    this.options = { ...config.RECORDER_CONFIG, ...options };
    this.recorder = new PuppeteerScreenRecorder(page, this.options);
    this.videoPath = null;
    this.isRecording = false;
  }

  /**
   * @param {string} testcaseId
   * @param {string} [outDir] Thư mục run của lần chạy này. Không truyền thì về
   *   videos/ như cũ, để smoke test và các script rời không phải sửa gì.
   */
  async start(testcaseId, outDir) {
    const dir = outDir || config.VIDEOS_DIR;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.videoPath = path.join(dir, `${testcaseId}_AutoRecord.mp4`);
    
    // Nếu file cũ tồn tại, xoá trước khi quay mới
    if (fs.existsSync(this.videoPath)) {
      try {
        fs.unlinkSync(this.videoPath);
      } catch (e) {}
    }

    console.log(`[RECORDER] Bắt đầu ghi video: ${this.videoPath}`);
    await this.recorder.start(this.videoPath);
    this.isRecording = true;
    return this.videoPath;
  }

  async stop() {
    if (!this.isRecording) return null;
    console.log('[RECORDER] Đang kết thúc và lưu video...');
    await this.recorder.stop();
    this.isRecording = false;
    
    // Chờ 500ms để FFmpeg hoàn tất ghi file ra đĩa
    await new Promise((r) => setTimeout(r, 500));
    console.log(`[RECORDER] Đã lưu video thành công (${this.videoPath})`);
    return this.videoPath;
  }
}

module.exports = { TestRecorder };
