// 360° 连续移动蛇身：头部按朝向连续前进，身体沿轨迹跟随
import { BODY } from './config.js';

export function normalizeAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

export class ContinuousSnake {
  constructor(options) {
    this.grid = options.grid;
    this.spacing = options.spacing ?? BODY.spacing;
    this.turnRate = options.turnRate ?? BODY.turnRate;
    this.heading = options.heading ?? 0;
    this.targetHeading = this.heading;
    const length = options.length ?? 3;
    const startX = options.x ?? this.grid / 2;
    const startY = options.y ?? this.grid / 2;
    this.segments = [];
    for (let i = 0; i < length; i++) {
      this.segments.push({
        x: startX - Math.cos(this.heading) * this.spacing * i,
        y: startY - Math.sin(this.heading) * this.spacing * i,
      });
    }
  }

  get head() {
    return this.segments[0];
  }

  setAim(angle) {
    if (Number.isFinite(angle)) this.targetHeading = normalizeAngle(angle);
  }

  grow(count = 1) {
    const tail = this.segments[this.segments.length - 1];
    for (let i = 0; i < count; i++) {
      this.segments.push({ x: tail.x, y: tail.y });
    }
  }

  update(dtSec, speed, wrap) {
    let diff = normalizeAngle(this.targetHeading - this.heading);
    const maxStep = this.turnRate * dtSec;
    if (diff > maxStep) diff = maxStep;
    else if (diff < -maxStep) diff = -maxStep;
    this.heading = normalizeAngle(this.heading + diff);

    const head = this.segments[0];
    let nx = head.x + Math.cos(this.heading) * speed * dtSec;
    let ny = head.y + Math.sin(this.heading) * speed * dtSec;

    if (wrap) {
      let shiftX = 0;
      let shiftY = 0;
      if (nx < 0) { nx += this.grid; shiftX = this.grid; }
      else if (nx >= this.grid) { nx -= this.grid; shiftX = -this.grid; }
      if (ny < 0) { ny += this.grid; shiftY = this.grid; }
      else if (ny >= this.grid) { ny -= this.grid; shiftY = -this.grid; }
      if (shiftX !== 0 || shiftY !== 0) {
        for (const segment of this.segments) {
          segment.x += shiftX;
          segment.y += shiftY;
        }
      }
    }
    head.x = nx;
    head.y = ny;

    for (let i = 1; i < this.segments.length; i++) {
      const ahead = this.segments[i - 1];
      const segment = this.segments[i];
      const dx = segment.x - ahead.x;
      const dy = segment.y - ahead.y;
      const distance = Math.hypot(dx, dy);
      if (distance > this.spacing) {
        const scale = this.spacing / distance;
        segment.x = ahead.x + dx * scale;
        segment.y = ahead.y + dy * scale;
      }
    }
  }
}