// 联机权威模拟：服务端运行，客户端只发转向、收快照。
// 玩法：race 抢食竞速（互不伤害）/ battle 同场对抗（撞蛇身死）/ lanes 各自竞速（同种子食物）
// 节奏：timed 限时3分钟+重生 / survival 生存淘汰（一条命）
import {
  MP, MP_MODES, MP_RHYTHMS, DIFFICULTIES, START_LENGTH, FOOD_DEFS, FOOD_TYPES,
  COMBO, BUFF, PLAYER_COLORS, AVATARS,
} from '../config.js';
import { DIRS } from '../game.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitizeName(name, fallbackIndex) {
  let value = String(name == null ? '' : name).replace(/[\u0000-\u001f<>]/g, '').trim();
  if (value.length === 0) value = `玩家${fallbackIndex}`;
  return value.slice(0, MP.nameMaxLength);
}

export class Arena {
  constructor(options = {}) {
    this.grid = MP.grid;
    this.seed = options.seed ?? ((Date.now() & 0x7fffffff) || 1);
    this.rng = mulberry32(this.seed);
    this.seedRng = mulberry32(this.seed ^ 0x5f3759df);
    this.players = new Map();
    this.phase = 'lobby'; // lobby | countdown | playing | ended
    this.events = [];
    this.sharedFoods = [];
    this.foodIdSeq = 1;
    this.joinSeq = 0;
    this.elapsedMs = 0;
    this.countdownLeftMs = 0;
    this.matchTimeLeftMs = 0;
    this.ranking = [];
    this.winnerId = null;
    this.setMode({
      mode: options.mode || 'race',
      rhythm: options.rhythm || 'timed',
      difficulty: options.difficulty || 'classic',
    }, true);
  }

  setMode({ mode, rhythm, difficulty }, force = false) {
    if (!force && this.phase !== 'lobby' && this.phase !== 'ended') return false;
    if (MP_MODES[mode]) this.modeId = mode;
    if (MP_RHYTHMS[rhythm]) this.rhythmId = rhythm;
    if (DIFFICULTIES[difficulty]) this.difficultyId = difficulty;
    if (!this.modeId) this.modeId = 'race';
    if (!this.rhythmId) this.rhythmId = 'timed';
    if (!this.difficultyId) this.difficultyId = 'classic';
    if (this.modeId === 'lanes') this.rhythmId = 'timed';
    this.mode = MP_MODES[this.modeId];
    this.rhythm = MP_RHYTHMS[this.rhythmId];
    this.difficulty = DIFFICULTIES[this.difficultyId];
    return true;
  }

  hostId() {
    for (const player of this.players.values()) {
      if (player.connected) return player.id;
    }
    return null;
  }

  addPlayer(name, avatar, color) {
    if (this.players.size >= MP.maxPlayers) return { error: '房间已满' };
    if (this.phase !== 'lobby' && this.phase !== 'ended') return { error: '对局已开始，请等下一局' };
    const id = `p${++this.joinSeq}`;
    const cleanName = sanitizeName(name, this.joinSeq);
    const cleanColor = PLAYER_COLORS.includes(color)
      ? color
      : PLAYER_COLORS[(this.joinSeq - 1) % PLAYER_COLORS.length];
    const cleanAvatar = AVATARS.includes(avatar) ? avatar : AVATARS[0];
    const player = this.createPlayer(id, cleanName, cleanColor, cleanAvatar);
    this.players.set(id, player);
    this.events.push({ type: 'join', playerId: id, name: cleanName });
    if (this.phase === 'ended') {
      this.phase = 'lobby';
      this.ranking = [];
      this.winnerId = null;
    }
    return { id, player };
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return false;
    this.players.delete(id);
    this.events.push({ type: 'leave', playerId: id, name: player.name });
    if (this.phase === 'playing') this.checkEnd();
    return true;
  }

  touch(id) {
    const player = this.players.get(id);
    if (player) player.lastSeen = Date.now();
  }

  createPlayer(id, name, color, avatar) {
    const player = {
      id,
      name,
      avatar: avatar || AVATARS[0],
      color,
      connected: true,
      lastSeen: Date.now(),
      score: 0,
      combo: 1,
      comboTimer: 0,
      fruitsEaten: 0,
      fruitTypes: new Set(),
      dir: { ...DIRS.right },
      pendingDirs: [],
      segments: [],
      alive: true,
      eliminated: false,
      respawnAt: 0,
      buffs: { shield: false, slowRemaining: 0, doubleRemaining: 0, shieldPhase: 0 },
      tickAccum: 0,
      speed: this.difficulty.baseSpeed,
      foods: [],
      laneSeq: 0,
    };
    this.placeSnake(player);
    if (!this.mode.shared) {
      this.spawnLaneFood(player);
      this.spawnLaneFood(player);
    }
    return player;
  }

  start(hostId) {
    if (this.hostId() !== hostId) return { error: '只有房主可以开始' };
    if (this.players.size === 0) return { error: '房间没有玩家' };
    if (this.phase === 'countdown' || this.phase === 'playing') return { error: '对局进行中' };
    this.elapsedMs = 0;
    this.sharedFoods = [];
    this.foodIdSeq = 1;
    this.ranking = [];
    this.winnerId = null;
    for (const player of this.players.values()) {
      player.score = 0;
      player.combo = 1;
      player.comboTimer = 0;
      player.fruitsEaten = 0;
      player.fruitTypes = new Set();
      player.buffs = { shield: false, slowRemaining: 0, doubleRemaining: 0, shieldPhase: 0 };
      player.tickAccum = 0;
      player.eliminated = false;
      player.respawnAt = 0;
      player.foods = [];
      player.laneSeq = 0;
      this.placeSnake(player);
      if (!this.mode.shared) {
        this.spawnLaneFood(player);
        this.spawnLaneFood(player);
      }
    }
    if (this.mode.shared) {
      const count = this.foodTargetCount();
      for (let i = 0; i < count; i++) this.spawnSharedFood();
    }
    this.phase = 'countdown';
    this.countdownLeftMs = MP.countdownMs;
    this.events.push({ type: 'startCountdown' });
    return { ok: true };
  }

  foodTargetCount() {
    return Math.max(3, Math.min(10, this.players.size * 2));
  }

  beginPlaying() {
    this.phase = 'playing';
    this.elapsedMs = 0;
    this.matchTimeLeftMs = this.rhythmId === 'timed' ? MP.matchMs : MP.survivalMaxMs;
    this.events.push({ type: 'begin' });
  }

  update(dtMs) {
    if (this.phase === 'countdown') {
      this.countdownLeftMs -= dtMs;
      if (this.countdownLeftMs <= 0) this.beginPlaying();
      return;
    }
    if (this.phase !== 'playing') return;

    this.elapsedMs += dtMs;
    this.matchTimeLeftMs -= dtMs;

    for (const player of this.players.values()) {
      this.updatePlayerTimers(player, dtMs);
      if (!player.alive) {
        if (this.rhythmId === 'timed' && player.respawnAt > 0 && this.elapsedMs >= player.respawnAt) {
          this.respawn(player);
        }
        continue;
      }
      player.speed = this.speedOf(player);
      player.tickAccum += dtMs;
      let guard = 8;
      while (player.alive && guard-- > 0) {
        const interval = 1000 / player.speed;
        if (player.tickAccum < interval) break;
        player.tickAccum -= interval;
        this.movePlayer(player);
      }
    }

    this.updateFoods(dtMs);
    this.checkEnd();
  }

  updatePlayerTimers(player, dtMs) {
    if (player.comboTimer > 0) {
      player.comboTimer -= dtMs;
      if (player.comboTimer <= 0) {
        player.comboTimer = 0;
        player.combo = 1;
      }
    }
    const buffs = player.buffs;
    if (buffs.slowRemaining > 0) buffs.slowRemaining = Math.max(0, buffs.slowRemaining - dtMs);
    if (buffs.doubleRemaining > 0) buffs.doubleRemaining = Math.max(0, buffs.doubleRemaining - dtMs);
    if (buffs.shieldPhase > 0) buffs.shieldPhase = Math.max(0, buffs.shieldPhase - dtMs);
  }

  speedOf(player) {
    let speed = this.difficulty.baseSpeed;
    if (this.difficulty.growthEvery > 0) {
      speed += Math.floor(player.fruitsEaten / this.difficulty.growthEvery) * this.difficulty.growthPerFruit;
    }
    speed = Math.min(speed, this.difficulty.maxSpeed);
    if (player.buffs.slowRemaining > 0) speed *= BUFF.slowMultiplier;
    return speed;
  }

  queueDirection(id, dirName) {
    const player = this.players.get(id);
    if (!player || !player.alive || this.phase !== 'playing') return false;
    const dir = DIRS[dirName];
    if (!dir) return false;
    const ref = player.pendingDirs.length > 0
      ? player.pendingDirs[player.pendingDirs.length - 1]
      : player.dir;
    if (dir.x === -ref.x && dir.y === -ref.y) return false;
    if (dir.x === ref.x && dir.y === ref.y) return false;
    if (player.pendingDirs.length >= 2) return false;
    player.pendingDirs.push({ x: dir.x, y: dir.y });
    return true;
  }

  movePlayer(player) {
    if (player.pendingDirs.length > 0) {
      const next = player.pendingDirs.shift();
      if (!(next.x === -player.dir.x && next.y === -player.dir.y)) player.dir = next;
    }

    const head = player.segments[0];
    let nx = head.x + player.dir.x;
    let ny = head.y + player.dir.y;
    let hitWall = nx < 0 || ny < 0 || nx >= this.grid || ny >= this.grid;
    if (hitWall && (this.difficulty.wrap || player.buffs.shieldPhase > 0)) {
      nx = (nx + this.grid) % this.grid;
      ny = (ny + this.grid) % this.grid;
      hitWall = false;
    }

    let eatingFood = hitWall ? null : this.foodAt(player, nx, ny);
    const bodyCount = eatingFood ? player.segments.length : player.segments.length - 1;
    const hitSelf = !hitWall && player.segments.some((seg, i) => i < bodyCount && seg.x === nx && seg.y === ny);
    const hitOther = !hitWall && this.mode.inter && this.collidesOther(player, nx, ny);

    if (hitWall || hitSelf || hitOther) {
      if (!this.tryAbsorb(player)) {
        this.killPlayer(player, hitWall ? 'wall' : hitSelf ? 'self' : 'snake', head);
        return;
      }
      if (hitWall) {
        nx = (nx + this.grid) % this.grid;
        ny = (ny + this.grid) % this.grid;
        eatingFood = this.foodAt(player, nx, ny);
      }
    }

    player.segments.unshift({ x: nx, y: ny });
    if (eatingFood) this.eatFood(player, eatingFood);
    else player.segments.pop();
  }

  collidesOther(player, x, y) {
    for (const other of this.players.values()) {
      if (other === player || !other.alive) continue;
      for (const seg of other.segments) {
        if (seg.x === x && seg.y === y) return true;
      }
    }
    return false;
  }

  tryAbsorb(player) {
    if (player.buffs.shieldPhase > 0) return true;
    if (player.buffs.shield) {
      player.buffs.shield = false;
      player.buffs.shieldPhase = BUFF.shieldPhaseDuration;
      this.events.push({ type: 'shieldBreak', playerId: player.id });
      return true;
    }
    return false;
  }

  killPlayer(player, reason, head) {
    player.alive = false;
    player.segments = [];
    player.pendingDirs = [];
    player.combo = 1;
    player.comboTimer = 0;
    player.buffs = { shield: false, slowRemaining: 0, doubleRemaining: 0, shieldPhase: 0 };
    if (this.rhythmId === 'survival') {
      player.eliminated = true;
      player.respawnAt = 0;
    } else {
      player.respawnAt = this.elapsedMs + MP.respawnMs;
    }
    this.events.push({
      type: 'death',
      playerId: player.id,
      reason,
      x: head ? head.x : 0,
      y: head ? head.y : 0,
    });
  }

  respawn(player) {
    this.placeSnake(player);
    player.buffs.shield = true;
    player.buffs.shieldPhase = MP.respawnShieldMs;
    player.respawnAt = 0;
    player.tickAccum = 0;
    this.events.push({
      type: 'respawn',
      playerId: player.id,
      x: player.segments[0].x,
      y: player.segments[0].y,
    });
  }

  placeSnake(player) {
    // 各自竞速模式：所有人在自己棋盘的中心同点出生，配合同种子食物保证完全公平
    const cell = this.mode.shared ? this.findSpawnCell() : this.centerCell();
    player.segments = [];
    for (let i = 0; i < START_LENGTH; i++) {
      player.segments.push({ x: cell.x - i, y: cell.y });
    }
    player.dir = { ...DIRS.right };
    player.pendingDirs = [];
    player.alive = true;
  }

  centerCell() {
    return { x: Math.floor(this.grid / 2), y: Math.floor(this.grid / 2) };
  }

  findSpawnCell() {
    const margin = 3;
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = margin + Math.floor(this.rng() * (this.grid - margin * 2));
      const y = margin + Math.floor(this.rng() * (this.grid - margin * 2));
      if (this.isFreeForSpawn(x, y) && this.isFreeForSpawn(x - 1, y) && this.isFreeForSpawn(x - 2, y)) {
        return { x, y };
      }
    }
    for (let y = margin; y < this.grid - margin; y++) {
      for (let x = margin + 2; x < this.grid - margin; x++) {
        if (this.isFreeForSpawn(x, y) && this.isFreeForSpawn(x - 1, y) && this.isFreeForSpawn(x - 2, y)) {
          return { x, y };
        }
      }
    }
    return { x: Math.floor(this.grid / 2), y: Math.floor(this.grid / 2) };
  }

  isFreeForSpawn(x, y) {
    if (x < 0 || y < 0 || x >= this.grid || y >= this.grid) return false;
    for (const other of this.players.values()) {
      for (const seg of other.segments) {
        if (seg.x === x && seg.y === y) return false;
      }
    }
    return true;
  }

  foodAt(player, x, y) {
    const foods = this.mode.shared ? this.sharedFoods : player.foods;
    for (const food of foods) {
      if (food.x === x && food.y === y) return food;
    }
    return null;
  }

  eatFood(player, food) {
    const list = this.mode.shared ? this.sharedFoods : player.foods;
    const index = list.indexOf(food);
    if (index >= 0) list.splice(index, 1);

    const def = FOOD_DEFS[food.type];
    player.combo = player.comboTimer > 0 ? Math.min(player.combo + 1, COMBO.max) : 1;
    player.comboTimer = COMBO.window;
    const doubleActive = player.buffs.doubleRemaining > 0;
    const gained = (def.score || 0) * player.combo * (doubleActive ? 2 : 1);
    player.score += gained;
    player.fruitsEaten += 1;
    player.fruitTypes.add(def.id);

    if (def.id === 'shield') player.buffs.shield = true;
    else if (def.id === 'slow') player.buffs.slowRemaining = BUFF.slowDuration;
    else if (def.id === 'double') player.buffs.doubleRemaining = BUFF.doubleDuration;

    this.events.push({
      type: 'eat',
      playerId: player.id,
      food: def.id,
      gained,
      combo: player.combo,
      double: doubleActive,
      x: food.x,
      y: food.y,
    });

    if (this.mode.shared) this.spawnSharedFood();
    else this.spawnLaneFood(player);
  }

  updateFoods(dtMs) {
    if (this.mode.shared) {
      for (let i = this.sharedFoods.length - 1; i >= 0; i--) {
        const food = this.sharedFoods[i];
        if (food.remainingMs == null) continue;
        food.remainingMs -= dtMs;
        if (food.remainingMs <= 0) {
          this.sharedFoods.splice(i, 1);
          this.spawnSharedFood();
        }
      }
    } else {
      for (const player of this.players.values()) {
        for (let i = player.foods.length - 1; i >= 0; i--) {
          const food = player.foods[i];
          if (food.remainingMs == null) continue;
          food.remainingMs -= dtMs;
          if (food.remainingMs <= 0) {
            player.foods.splice(i, 1);
            this.spawnLaneFood(player);
          }
        }
      }
    }
  }

  spawnSharedFood() {
    const cell = this.findFoodCell();
    if (!cell) return;
    const type = this.weightedType(this.seedRng);
    const def = FOOD_DEFS[type];
    this.sharedFoods.push({
      id: this.foodIdSeq++,
      type,
      x: cell.x,
      y: cell.y,
      remainingMs: def.lifetime != null ? def.lifetime : null,
    });
  }

  spawnLaneFood(player) {
    // 同种子序列：所有玩家按相同的序号生成食物，早局完全一致
    for (let attempt = 0; attempt < 120; attempt++) {
      const index = player.laneSeq++;
      const spawn = this.deterministicSpawn(index);
      if (this.isFreeOnBoard(player, spawn.x, spawn.y) && !this.foodOccupied(player, spawn.x, spawn.y)) {
        const def = FOOD_DEFS[spawn.type];
        player.foods.push({
          id: `${player.id}-${index}`,
          type: spawn.type,
          x: spawn.x,
          y: spawn.y,
          remainingMs: def.lifetime != null ? def.lifetime : null,
        });
        return;
      }
    }
  }

  deterministicSpawn(index) {
    const rng = mulberry32((this.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    // 限制在棋盘中部区域，配合跟随镜头保证食物可达可见
    const center = Math.floor(this.grid / 2);
    const range = Math.max(6, Math.floor(this.grid * 0.32));
    const x = Math.max(1, Math.min(this.grid - 2, center + Math.floor((rng() * 2 - 1) * range)));
    const y = Math.max(1, Math.min(this.grid - 2, center + Math.floor((rng() * 2 - 1) * range)));
    let total = 0;
    for (const id of FOOD_TYPES) total += FOOD_DEFS[id].weight;
    let roll = rng() * total;
    let type = 'normal';
    for (const id of FOOD_TYPES) {
      roll -= FOOD_DEFS[id].weight;
      if (roll < 0) { type = id; break; }
    }
    return { x, y, type };
  }

  foodOccupied(player, x, y) {
    for (const food of player.foods) {
      if (food.x === x && food.y === y) return true;
    }
    return false;
  }

  isFreeOnBoard(player, x, y) {
    if (x < 0 || y < 0 || x >= this.grid || y >= this.grid) return false;
    for (const seg of player.segments) {
      if (seg.x === x && seg.y === y) return false;
    }
    return true;
  }

  findFoodCell() {
    // 大战场：新食物围绕一名存活玩家刷新，保证跟随视角内始终有目标
    const alive = [...this.players.values()].filter((p) => p.alive && p.segments.length > 0);
    const anchor = alive.length > 0 ? alive[Math.floor(this.rng() * alive.length)] : null;
    const center = anchor ? anchor.segments[0] : this.centerCell();
    for (let attempt = 0; attempt < 400; attempt++) {
      const radius = 5 + this.rng() * Math.max(1, MP.foodSpawnRadius - 5);
      const angle = this.rng() * Math.PI * 2;
      const x = Math.max(1, Math.min(this.grid - 2, Math.round(center.x + Math.cos(angle) * radius)));
      const y = Math.max(1, Math.min(this.grid - 2, Math.round(center.y + Math.sin(angle) * radius)));
      if (!this.isFreeForSpawn(x, y)) continue;
      let occupied = false;
      for (const food of this.sharedFoods) {
        if (food.x === x && food.y === y) { occupied = true; break; }
      }
      if (!occupied) return { x, y };
    }
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = Math.floor(this.rng() * this.grid);
      const y = Math.floor(this.rng() * this.grid);
      if (!this.isFreeForSpawn(x, y)) continue;
      let occupied = false;
      for (const food of this.sharedFoods) {
        if (food.x === x && food.y === y) { occupied = true; break; }
      }
      if (!occupied) return { x, y };
    }
    return null;
  }

  weightedType(rng) {
    let total = 0;
    for (const id of FOOD_TYPES) total += FOOD_DEFS[id].weight;
    let roll = rng() * total;
    for (const id of FOOD_TYPES) {
      roll -= FOOD_DEFS[id].weight;
      if (roll < 0) return id;
    }
    return 'normal';
  }

  checkEnd() {
    if (this.phase !== 'playing') return;
    if (this.rhythmId === 'timed') {
      if (this.matchTimeLeftMs <= 0) this.endMatch('time');
      return;
    }
    const connected = [...this.players.values()].filter((p) => p.connected);
    const aliveCount = connected.filter((p) => p.alive).length;
    if (connected.length >= 2 && aliveCount <= 1) {
      this.endMatch('last');
    } else if (connected.length === 1 && aliveCount === 0) {
      this.endMatch('last');
    } else if (this.matchTimeLeftMs <= 0) {
      this.endMatch('timeout');
    }
  }

  endMatch(reason) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const list = [...this.players.values()].filter((p) => p.connected);
    list.sort((a, b) => {
      if (this.rhythmId === 'survival') {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
      }
      if (b.score !== a.score) return b.score - a.score;
      return 0;
    });
    this.ranking = list.map((p, index) => ({
      rank: index + 1,
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      alive: p.alive,
    }));
    this.winnerId = this.ranking.length > 0 ? this.ranking[0].id : null;
    this.events.push({ type: 'end', reason, ranking: this.ranking, winnerId: this.winnerId });
  }

  drainEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  snapshot() {
    const players = [];
    for (const player of this.players.values()) {
      players.push({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        color: player.color,
        connected: player.connected,
        score: player.score,
        combo: player.comboTimer > 0 ? player.combo : 1,
        alive: player.alive,
        eliminated: player.eliminated,
        respawnInMs: player.alive || this.rhythmId !== 'timed'
          ? 0
          : Math.max(0, Math.round(player.respawnAt - this.elapsedMs)),
        segments: player.segments.map((seg) => [seg.x, seg.y]),
        dir: [player.dir.x, player.dir.y],
        buffs: {
          shield: player.buffs.shield,
          slowMs: Math.round(player.buffs.slowRemaining),
          doubleMs: Math.round(player.buffs.doubleRemaining),
          shieldPhaseMs: Math.round(player.buffs.shieldPhase),
        },
        fruits: player.fruitsEaten,
        food: !this.mode.shared && player.foods.length > 0 ? this.foodView(player.foods[0]) : null,
      });
    }
    return {
      phase: this.phase,
      mode: this.modeId,
      rhythm: this.rhythmId,
      difficulty: this.difficultyId,
      hostId: this.hostId(),
      grid: this.grid,
      countdownLeftMs: Math.max(0, Math.round(this.countdownLeftMs)),
      timeLeftMs: this.rhythmId === 'timed' ? Math.max(0, Math.round(this.matchTimeLeftMs)) : null,
      players,
      foods: this.mode.shared ? this.sharedFoods.map((food) => this.foodView(food)) : null,
      ranking: this.ranking,
      winnerId: this.winnerId,
      serverTime: Date.now(),
    };
  }

  foodView(food) {
    return {
      id: food.id,
      type: food.type,
      x: food.x,
      y: food.y,
      remainingMs: food.remainingMs == null ? null : Math.max(0, Math.round(food.remainingMs)),
    };
  }
}

export { mulberry32 };