// 核心模拟：360° 连续移动，纯逻辑无 DOM，可被 Node 直接导入做无头自测
import { GRID_SOLO as GRID, START_LENGTH, DIFFICULTIES, FOOD_DEFS, FOOD_TYPES, COMBO, BUFF, BODY } from './config.js';
import { ContinuousSnake } from './snake-body.js';

export class SnakeGame {
  constructor(options = {}) {
    this.rng = options.rng || Math.random;
    this.reset(options.difficulty || 'classic');
  }

  reset(difficultyId) {
    this.difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.classic;
    this.grid = GRID;
    const center = GRID / 2;
    this.body = new ContinuousSnake({
      grid: GRID,
      length: START_LENGTH,
      x: center - 1,
      y: center,
      heading: 0,
    });
    this.snake = this.body.segments;
    this.heading = this.body.heading;
    this.dir = { x: 1, y: 0 };
    this.food = null;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.fruitsEaten = 0;
    this.fruitTypesEaten = new Set();
    this.buffs = { shield: false, slowRemaining: 0, doubleRemaining: 0, shieldPhase: 0 };
    this.speed = this.currentSpeed();
    this.elapsed = 0;
    this.alive = true;
    this.deadReason = '';
    this.events = [];
    this.spawnFood();
  }

  /** 设置目标朝向（弧度，屏幕坐标：0=右，π/2=下）。 */
  setAim(angle) {
    if (this.alive) this.body.setAim(angle);
  }

  update(dtMs) {
    if (!this.alive || !(dtMs > 0)) return;
    this.elapsed += dtMs;

    if (this.comboTimer > 0) {
      this.comboTimer -= dtMs;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 1;
      }
    }
    const buffs = this.buffs;
    if (buffs.slowRemaining > 0) buffs.slowRemaining = Math.max(0, buffs.slowRemaining - dtMs);
    if (buffs.doubleRemaining > 0) buffs.doubleRemaining = Math.max(0, buffs.doubleRemaining - dtMs);
    if (buffs.shieldPhase > 0) buffs.shieldPhase = Math.max(0, buffs.shieldPhase - dtMs);

    const wrap = this.difficulty.wrap || buffs.shieldPhase > 0;
    this.speed = this.currentSpeed();
    this.body.update(dtMs / 1000, this.speed, wrap);
    this.heading = this.body.heading;
    this.dir = { x: Math.cos(this.heading), y: Math.sin(this.heading) };

    if (!wrap && this.hitWall()) {
      if (!this.tryAbsorb()) {
        this.die('wall');
        return;
      }
    }
    if (this.alive && buffs.shieldPhase <= 0 && this.hitSelf()) {
      if (!this.tryAbsorb()) {
        this.die('self');
        return;
      }
    }

    if (this.food && this.food.remainingMs != null) {
      this.food.remainingMs -= dtMs;
      if (this.food.remainingMs <= 0) {
        this.events.push({ type: 'foodExpired', food: this.food.type });
        this.spawnFood();
      }
    }

    if (this.alive && this.food) {
      const head = this.body.head;
      const dx = this.food.x - head.x;
      const dy = this.food.y - head.y;
      if (Math.hypot(dx, dy) <= BODY.eatRadius) this.eat();
    }
  }

  hitWall() {
    const head = this.body.head;
    return head.x < BODY.headRadius
      || head.y < BODY.headRadius
      || head.x > this.grid - BODY.headRadius
      || head.y > this.grid - BODY.headRadius;
  }

  hitSelf() {
    const head = this.body.head;
    const segments = this.body.segments;
    for (let i = BODY.selfHitIndex; i < segments.length; i++) {
      const dx = segments[i].x - head.x;
      const dy = segments[i].y - head.y;
      if (Math.hypot(dx, dy) < BODY.selfHitDistance) return true;
    }
    return false;
  }

  currentSpeed() {
    let speed = this.difficulty.baseSpeed;
    if (this.difficulty.growthEvery > 0) {
      speed += Math.floor(this.fruitsEaten / this.difficulty.growthEvery) * this.difficulty.growthPerFruit;
    }
    speed = Math.min(speed, this.difficulty.maxSpeed);
    if (this.buffs && this.buffs.slowRemaining > 0) speed *= BUFF.slowMultiplier;
    return speed;
  }

  getComboMultiplier() {
    return this.comboTimer > 0 ? this.combo : 1;
  }

  drainEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  tryAbsorb() {
    if (this.buffs.shieldPhase > 0) return true;
    if (this.buffs.shield) {
      this.buffs.shield = false;
      this.buffs.shieldPhase = BUFF.shieldPhaseDuration;
      this.events.push({ type: 'shieldBreak' });
      return true;
    }
    return false;
  }

  eat() {
    const def = FOOD_DEFS[this.food.type];
    this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, COMBO.max) : 1;
    this.comboTimer = COMBO.window;

    const doubleActive = this.buffs.doubleRemaining > 0;
    const gained = (def.score || 0) * this.combo * (doubleActive ? 2 : 1);
    this.score += gained;
    this.fruitsEaten += 1;
    this.fruitTypesEaten.add(def.id);
    this.body.grow(1);

    if (def.id === 'shield') this.buffs.shield = true;
    else if (def.id === 'slow') this.buffs.slowRemaining = BUFF.slowDuration;
    else if (def.id === 'double') this.buffs.doubleRemaining = BUFF.doubleDuration;

    this.events.push({
      type: 'eat',
      food: def.id,
      gained,
      combo: this.combo,
      double: doubleActive,
      head: { x: this.body.head.x, y: this.body.head.y },
    });
    this.spawnFood();
  }

  die(reason) {
    this.alive = false;
    this.deadReason = reason;
    this.events.push({
      type: 'death',
      reason,
      head: { x: this.body.head.x, y: this.body.head.y },
    });
  }

  spawnFood() {
    const cell = this.findFoodPosition();
    if (!cell) {
      this.food = null;
      return;
    }
    const type = this.pickFoodType();
    const def = FOOD_DEFS[type];
    this.food = {
      type,
      x: cell.x,
      y: cell.y,
      remainingMs: def.lifetime != null ? def.lifetime : null,
    };
  }

  findFoodPosition() {
    const margin = 1.2;
    const head = this.body.head;
    // 优先刷在蛇头附近，跟随镜头下始终有目标
    for (let attempt = 0; attempt < 300; attempt++) {
      const radius = 5 + this.rng() * 9;
      const angle = this.rng() * Math.PI * 2;
      const x = Math.max(margin, Math.min(this.grid - margin, head.x + Math.cos(angle) * radius));
      const y = Math.max(margin, Math.min(this.grid - margin, head.y + Math.sin(angle) * radius));
      if (this.distanceToBody(x, y) < 1.2) continue;
      return { x, y };
    }
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = margin + this.rng() * (this.grid - margin * 2);
      const y = margin + this.rng() * (this.grid - margin * 2);
      if (this.distanceToBody(x, y) < 1.2) continue;
      return { x, y };
    }
    return null;
  }

  distanceToBody(x, y) {
    let min = Infinity;
    for (const segment of this.body.segments) {
      const distance = Math.hypot(segment.x - x, segment.y - y);
      if (distance < min) min = distance;
    }
    return min;
  }

  pickFoodType() {
    let total = 0;
    for (const id of FOOD_TYPES) total += FOOD_DEFS[id].weight;
    let roll = this.rng() * total;
    for (const id of FOOD_TYPES) {
      roll -= FOOD_DEFS[id].weight;
      if (roll < 0) return id;
    }
    return 'normal';
  }

  /** 测试辅助：在指定位置放置指定类型食物。 */
  placeFood(type, x, y) {
    const def = FOOD_DEFS[type];
    if (!def) return;
    this.food = { type, x, y, remainingMs: def.lifetime != null ? def.lifetime : null };
  }
}