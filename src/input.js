// 输入：键盘四方向 / 触屏滑动 360° / 触屏摇杆 360°
const KEY_ANGLES = {
  ArrowRight: 0, KeyD: 0,
  ArrowDown: Math.PI / 2, KeyS: Math.PI / 2,
  ArrowLeft: Math.PI, KeyA: Math.PI,
  ArrowUp: -Math.PI / 2, KeyW: -Math.PI / 2,
};

const SWIPE_MIN = 22;
const DEAD_ZONE_RATIO = 0.2;

export class InputController {
  constructor(handlers) {
    this.handlers = handlers;
    this.touchStart = null;
    this.joystick = null;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onJoystickDown = this.onJoystickDown.bind(this);
    this.onJoystickMove = this.onJoystickMove.bind(this);
    this.onJoystickUp = this.onJoystickUp.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    const surface = document.getElementById('app');
    if (surface) {
      surface.addEventListener('touchstart', this.onTouchStart, { passive: true });
      surface.addEventListener('touchend', this.onTouchEnd, { passive: false });
    }
    this.attachJoystick();
  }

  onKeyDown(event) {
    if (event.repeat) return;
    const angle = KEY_ANGLES[event.code];
    if (angle !== undefined) {
      event.preventDefault();
      this.handlers.onAim(angle);
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
    if (event.target.closest && event.target.closest('#joystick')) {
      this.touchStart = null;
      return;
    }
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
    this.handlers.onAim(Math.atan2(dy, dx));
  }

  attachJoystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    if (!base || !knob) return;
    this.joystick = { base, knob, pointerId: null, centerX: 0, centerY: 0, radius: 0 };
    base.addEventListener('pointerdown', this.onJoystickDown, { passive: false });
    window.addEventListener('pointermove', this.onJoystickMove, { passive: false });
    window.addEventListener('pointerup', this.onJoystickUp);
    window.addEventListener('pointercancel', this.onJoystickUp);
  }

  onJoystickDown(event) {
    const js = this.joystick;
    if (!js || js.pointerId !== null) return;
    event.preventDefault();
    const rect = js.base.getBoundingClientRect();
    js.pointerId = event.pointerId;
    js.centerX = rect.left + rect.width / 2;
    js.centerY = rect.top + rect.height / 2;
    js.radius = rect.width / 2;
    try { js.base.setPointerCapture(event.pointerId); } catch (err) { /* 部分浏览器不支持 */ }
    this.updateJoystick(event.clientX, event.clientY);
  }

  onJoystickMove(event) {
    const js = this.joystick;
    if (!js || js.pointerId === null || event.pointerId !== js.pointerId) return;
    event.preventDefault();
    this.updateJoystick(event.clientX, event.clientY);
  }

  onJoystickUp(event) {
    const js = this.joystick;
    if (!js || js.pointerId === null || event.pointerId !== js.pointerId) return;
    this.resetJoystick();
  }

  updateJoystick(clientX, clientY) {
    const js = this.joystick;
    const dx = clientX - js.centerX;
    const dy = clientY - js.centerY;
    const distance = Math.hypot(dx, dy);
    const maxTravel = js.radius * 0.62;
    const clamped = Math.min(distance, maxTravel);
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 0;
    js.knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    const deadZone = js.radius * DEAD_ZONE_RATIO;
    if (distance < deadZone) {
      this.handlers.onAim(null);
      return;
    }
    this.handlers.onAim(Math.atan2(ny, nx));
  }

  resetJoystick() {
    const js = this.joystick;
    if (!js) return;
    js.pointerId = null;
    js.knob.style.transform = 'translate(0px, 0px)';
    this.handlers.onAim(null);
  }
}