// 核心模拟：纯逻辑、无 DOM，可被 Node 直接导入做无头自测
import { GRID_SOLO as GRID, START_LENGTH, DIFFICULTIES, FOOD_DEFS, FOOD_TYPES, COMBO, BUFF } from './config.js';

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export class SnakeGame {
  constructor(options = {}) {
    this.rng = options.rng || Math.random;
    this.reset(options.difficulty || 'classic');
  }

  reset(difficultyId) {
    this.difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.classic;
    const center = Math.floor(GRID / 2);
    this.snake = [];
    for (let i = 0; i < START_LENGTH; i++) this.snake.push({ x: center - i, y: center });
    this.prevSnake = this.snake.map((seg) => ({ x: seg.x, y: seg.y }));
    this.dir = DIRS.right;
    this.pendingDirs = [];
    this.food = null;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.fruitsEaten = 0;
    this.fruitTypesEaten = new Set();
    this.buffs = { shield: false, slowRemaining: 0, doubleRemaining: 0, shieldPhase: 0 };
    this.speed = this.currentSpeed();
    this.tickAccum = 0;
    this.elapsed = 0;
    this.alive = true;
    this.deadReason = '';
    this.events = [];
    this.spawnFood();
  }

  /** 入队一个转向（'up'/'down'/'left'/'right' 或向量）；最多缓存 2 步，拒绝反转与重复。 */
  queueDirection(dir) {
    if (!this.alive) return false;
    const d = typeof dir === 'string' ? DIRS[dir] : dir;
    if (!d || (d.x === 0 && d.y === 0) || Math.abs(d.x) + Math.abs(d.y) !== 1) return false;
    const ref = this.pendingDirs.length > 0
      ? this.pendingDirs[this.pendingDirs.length - 1]
      : this.dir;
    if (d.x === -ref.x && d.y === -ref.y) return false;
    if (d.x === ref.x && d.y === ref.y) return false;
    if (this.pendingDirs.length >= 2) return false;
    this.pendingDirs.push({ x: d.x, y: d.y });
    return true;
  }

  /** 推进模拟；dt 单位毫秒（与配置中的时长常量一致）。 */
  update(dt) {
    if (!this.alive || !(dt > 0)) return;
    this.elapsed += dt;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 1;
      }
    }
    if (this.buffs.slowRemaining > 0) {
      this.buffs.slowRemaining = Math.max(0, this.buffs.slowRemaining - dt);
    }
    if (this.buffs.doubleRemaining > 0) {
      this.buffs.doubleRemaining = Math.max(0, this.buffs.doubleRemaining - dt);
    }
    if (this.buffs.shieldPhase > 0) {
      this.buffs.shieldPhase = Math.max(0, this.buffs.shieldPhase - dt);
    }
    if (this.food && this.food.remainingMs != null) {
      this.food.remainingMs -= dt;
      if (this.food.remainingMs <= 0) {
        this.events.push({ type: 'foodExpired', food: this.food.type });
        this.spawnFood();
      }
    }

    this.tickAccum += dt;
    let guard = 16;
    while (this.alive && guard-- > 0) {
      this.speed = this.currentSpeed();
      const interval = 1000 / this.speed;
      if (this.tickAccum < interval) break;
      this.tickAccum -= interval;
      this.tick();
    }
    if (!this.alive) this.tickAccum = 0;
  }

  currentSpeed() {
    let speed = this.difficulty.baseSpeed;
    if (this.difficulty.growthEvery > 0) {
      speed += Math.floor(this.fruitsEaten / this.difficulty.growthEvery) * this.difficulty.growthPerFruit;
    }
    speed = Math.min(speed, this.difficulty.maxSpeed);
    if (this.buffs.slowRemaining > 0) speed *= BUFF.slowMultiplier;
    return speed;
  }

  /** 渲染插值进度 0..1（距下一格移动的完成度）。 */
  getTickProgress() {
    const interval = 1000 / this.speed;
    if (!Number.isFinite(interval) || interval <= 0) return 0;
    return Math.max(0, Math.min(1, this.tickAccum / interval));
  }

  drainEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  tick() {
    this.prevSnake = this.snake.map((seg) => ({ x: seg.x, y: seg.y }));

    if (this.pendingDirs.length > 0) {
      const next = this.pendingDirs.shift();
      if (!(next.x === -this.dir.x && next.y === -this.dir.y)) this.dir = next;
    }

    const head = this.snake[0];
    let nx = head.x + this.dir.x;
    let ny = head.y + this.dir.y;

    let hitWall = nx < 0 || ny < 0 || nx >= GRID || ny >= GRID;
    const wrapAllowed = this.difficulty.wrap || this.buffs.shieldPhase > 0;
    if (hitWall && wrapAllowed) {
      nx = (nx + GRID) % GRID;
      ny = (ny + GRID) % GRID;
      hitWall = false;
    }

    let eating = !!(this.food && this.food.x === nx && this.food.y === ny);
    const bodyCount = eating ? this.snake.length : this.snake.length - 1;
    let hitSelf = !hitWall && this.overlapsBody(nx, ny, bodyCount);

    if (hitWall || hitSelf) {
      if (!this.tryAbsorbCollision()) {
        this.die(hitWall ? 'wall' : 'self');
        return;
      }
      if (hitWall) {
        nx = (nx + GRID) % GRID;
        ny = (ny + GRID) % GRID;
        eating = !!(this.food && this.food.x === nx && this.food.y === ny);
      }
    }

    this.snake.unshift({ x: nx, y: ny });
    if (eating) this.eat();
    else this.snake.pop();
  }

  overlapsBody(x, y, count) {
    for (let i = 0; i < count; i++) {
      const seg = this.snake[i];
      if (seg.x === x && seg.y === y) return true;
    }
    return false;
  }

  tryAbsorbCollision() {
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

    if (def.id === 'shield') this.buffs.shield = true;
    else if (def.id === 'slow') this.buffs.slowRemaining = BUFF.slowDuration;
    else if (def.id === 'double') this.buffs.doubleRemaining = BUFF.doubleDuration;

    this.events.push({
      type: 'eat',
      food: def.id,
      gained,
      combo: this.combo,
      double: doubleActive,
      head: { x: this.snake[0].x, y: this.snake[0].y },
    });
    this.spawnFood();
  }

  die(reason) {
    this.alive = false;
    this.deadReason = reason;
    this.events.push({ type: 'death', reason });
  }

  spawnFood() {
    const cell = this.findEmptyCell();
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

  findEmptyCell() {
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = Math.floor(this.rng() * GRID);
      const y = Math.floor(this.rng() * GRID);
      if (!this.snake.some((seg) => seg.x === x && seg.y === y)) return { x, y };
    }
    const occupied = new Set(this.snake.map((seg) => seg.y * GRID + seg.x));
    const free = [];
    for (let i = 0; i < GRID * GRID; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    if (free.length === 0) return null;
    const pick = free[Math.floor(this.rng() * free.length)];
    return { x: pick % GRID, y: Math.floor(pick / GRID) };
  }

  /** 测试辅助：在指定位置放置指定类型食物。 */
  placeFood(type, x, y) {
    const def = FOOD_DEFS[type];
    if (!def) return;
    this.food = { type, x, y, remainingMs: def.lifetime != null ? def.lifetime : null };
  }

  getComboMultiplier() {
    return this.comboTimer > 0 ? this.combo : 1;
  }
}