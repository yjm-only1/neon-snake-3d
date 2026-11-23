// 输入：键盘方向键/WASD + 触屏滑动；空格暂停、Enter 确认、M 静音
const KEY_DIRS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

const SWIPE_MIN = 22; // 触发滑动的最小位移（px）

export class InputController {
  constructor(handlers) {
    this.handlers = handlers;
    this.touchStart = null;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    const surface = document.getElementById('app');
    if (surface) {
      surface.addEventListener('touchstart', this.onTouchStart, { passive: true });
      surface.addEventListener('touchend', this.onTouchEnd, { passive: false });
    }
  }

  onKeyDown(event) {
    if (event.repeat) return;
    const dir = KEY_DIRS[event.code];
    if (dir) {
      event.preventDefault();
      this.handlers.onDirection(dir);
      return;
    }
    if (event.code === 'Space' || event.code === 'Escape') {
      event.preventDefault();
      this.handlers.onPauseToggle();
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      this.handlers.onConfirm();
      return;
    }
    if (event.code === 'KeyM') this.handlers.onMute();
  }

  onTouchStart(event) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    this.touchStart = { x: touch.clientX, y: touch.clientY, t: performance.now() };
  }

  onTouchEnd(event) {
    if (!this.touchStart) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    const elapsed = performance.now() - this.touchStart.t;
    this.touchStart = null;
    if (elapsed > 600) return;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    this.handlers.onDirection(dir);
  }
}