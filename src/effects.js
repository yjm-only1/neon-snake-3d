// 3D 粒子 / 震屏 / 闪光数据层（坐标以「格」为单位，渲染器换算世界坐标）
export class Effects {
  constructor() {
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
  }

  burst(cx, cy, color, count = 14, speed = 5) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vel = speed * (0.35 + Math.random());
      this.particles.push({
        x: cx,
        y: cy,
        z: 0.45,
        vx: Math.cos(angle) * vel,
        vz: Math.sin(angle) * vel,
        vy: 1.5 + Math.random() * 3.5,
        life: 0.55 + Math.random() * 0.4,
        maxLife: 0.95,
        size: 0.7 + Math.random() * 1.1,
        color,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  deathBurst(segments, color) {
    const palette = [color, '#19f9ff', '#a04dff', '#ffffff'];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      this.burst(seg.x, seg.y, palette[i % palette.length], 5, 6.5);
    }
  }

  addShake(magnitude) {
    this.shake = Math.max(this.shake, magnitude);
  }

  addFlash(alpha, color = '#ffffff') {
    this.flash = Math.max(this.flash, alpha);
    this.flashColor = color;
  }

  update(dtSec) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtSec;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dtSec;
      p.y += p.vz * dtSec;
      p.z += p.vy * dtSec;
      p.vy -= 9.5 * dtSec;
      if (p.z < 0) {
        p.z = 0;
        p.vy = 0;
      }
      p.vx *= 0.94;
      p.vz *= 0.94;
    }
    this.shake = Math.max(0, this.shake - dtSec * 55);
    this.flash = Math.max(0, this.flash - dtSec * 3.2);
  }

  reset() {
    this.particles.length = 0;
    this.shake = 0;
    this.flash = 0;
  }
}