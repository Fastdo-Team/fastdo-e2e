// Script được inject vào mọi trang (evaluateOnNewDocument) để vẽ 1 con trỏ ảo
// theo dõi toạ độ chuột thật + hiệu ứng gợn sóng khi click, phục vụ quay video demo.
function initFakeCursorOverlay() {
  if (window.__fakeCursorInit) return;
  window.__fakeCursorInit = true;

  const style = document.createElement('style');
  style.textContent = `
    #__fake_cursor {
      position: fixed; width: 20px; height: 20px; border-radius: 50%;
      background: rgba(255, 45, 85, 0.9); border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      pointer-events: none; z-index: 2147483647;
      transform: translate(-50%, -50%);
      transition: left 0.03s linear, top 0.03s linear;
      left: -100px; top: -100px;
    }
    #__fake_cursor.__click { animation: __cursor_pulse 0.4s ease-out; }
    @keyframes __cursor_pulse {
      0% { box-shadow: 0 0 0 0 rgba(255,45,85,0.7); }
      100% { box-shadow: 0 0 0 26px rgba(255,45,85,0); }
    }
  `;
  document.documentElement.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = '__fake_cursor';
  document.documentElement.appendChild(cursor);

  document.addEventListener(
    'mousemove',
    (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    },
    true
  );
  document.addEventListener(
    'mousedown',
    () => {
      cursor.classList.remove('__click');
      void cursor.offsetWidth;
      cursor.classList.add('__click');
    },
    true
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFakeCursorOverlay);
} else {
  initFakeCursorOverlay();
}
