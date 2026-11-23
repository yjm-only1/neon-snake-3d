// 联机竞技场自测（360° 连续移动）：node tools/sim/arena-selftest.mjs
import { Arena } from '../../src/mp/arena.js';
import { MP, DIFFICULTIES } from '../../src/config.js';

let passed = 0;
let failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function near(a, b, eps = 0.05) { return Math.abs(a - b) <= eps; }

function makeArena(playerCount = 1, options = {}) {
  const arena = new Arena({ seed: 42, ...options });
  const ids = [];
  for (let i = 0; i < playerCount; i++) {
    const res = arena.addPlayer(`玩家${i + 1}`);
    ids.push(res.id);
  }
  return { arena, ids };
}

function started(playerCount = 1, options = {}) {
  const { arena, ids } = makeArena(playerCount, options);
  const host = ids[0];
  const res = arena.start(host);
  if (res.error) throw new Error(res.error);
  arena.update(MP.countdownMs + 1);
  return { arena, ids, host };
}

function setSnake(player, segments, heading = 0) {
  player.body.segments = segments.map(([x, y]) => ({ x, y }));
  player.body.heading = heading;
  player.body.targetHeading = heading;
  player.alive = true;
}

// ---------- 1. 房间与房主 ----------
console.log('1. 房间与房主');
{
  const { arena, ids } = makeArena(2);
  ok(ids.length === 2, '加入 2 名玩家');
  ok(arena.hostId() === ids[0], '首位玩家为房主');
  ok(arena.start(ids[1]).error, '非房主不能开局');
  ok(arena.start(ids[0]).ok === true, '房主可开局');
  ok(arena.phase === 'countdown', '开局进入倒计时');
  ok(arena.removePlayer(ids[0]) === true && arena.hostId() === ids[1], '房主离开后由下一位接任');
}
{
  const { arena, ids } = makeArena(1);
  const longName = arena.addPlayer('这是一个超长昵称<script>');
  ok(longName.player.name.length <= MP.nameMaxLength, '昵称截断到上限');
  ok(!longName.player.name.includes('<'), '昵称剔除尖括号');
  arena.removePlayer(ids[0]);
  ok(arena.hostId() === longName.id, '空房后新房主');
}
{
  const { arena } = makeArena(MP.maxPlayers);
  ok(arena.addPlayer('第九人').error != null, '满员拒绝加入');
}

// ---------- 2. 倒计时与连续移动 ----------
console.log('2. 倒计时与连续移动');
{
  const { arena, ids } = makeArena(1);
  arena.start(ids[0]);
  arena.update(MP.countdownMs - 500);
  ok(arena.phase === 'countdown', '倒计时未结束不开打');
  arena.update(600);
  ok(arena.phase === 'playing', '倒计时结束进入对局');

  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[10, 10], [9.5, 10], [9, 10]], 0);
  const before = player.body.head.x;
  arena.update(250);
  ok(near(player.body.head.x, before + 2, 0.08), '经典档 250ms 前进约 2 格', `x=${player.body.head.x}`);

  arena.setAim(ids[0], -Math.PI / 2);
  for (let i = 0; i < 20; i++) arena.update(16);
  ok(near(player.body.heading, -Math.PI / 2, 0.06), '360° 目标角度生效', `heading=${player.body.heading}`);
}

// ---------- 3. 吃食物与连击 ----------
console.log('3. 吃食物与连击');
{
  const { arena, ids } = started(1, { mode: 'race', difficulty: 'classic' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[10, 10], [9.5, 10], [9, 10]], 0);
  const head = player.body.head;
  arena.sharedFoods.push({ id: 1, type: 'normal', x: head.x + 0.4, y: head.y, remainingMs: null });
  arena.update(16);
  ok(player.score === 10, '吃普通果实 +10', `score=${player.score}`);
  ok(player.body.segments.length === 4, '蛇身增长');
  ok(arena.sharedFoods.length === 1, '吃掉后补充一个新食物');

  arena.sharedFoods = [];
  const h2 = player.body.head;
  arena.sharedFoods.push({ id: 2, type: 'gold', x: h2.x + 0.4, y: h2.y, remainingMs: null });
  arena.update(16);
  ok(player.score === 10 + 100, '金果 +50 × 连击 x2 = +100', `score=${player.score}`);
}

// ---------- 4. 撞墙与穿墙 ----------
console.log('4. 撞墙与穿墙');
{
  const { arena, ids } = started(1, { difficulty: 'classic' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 0.5, 10], [MP.grid - 1, 10], [MP.grid - 1.5, 10]], 0);
  arena.update(100);
  ok(player.alive === false, '经典档撞墙死亡');
  const snap = arena.snapshot();
  const me = snap.players.find((p) => p.id === ids[0]);
  ok(me.respawnInMs > 0 && me.respawnInMs <= MP.respawnMs, '死亡快照带重生倒计时');
}
{
  const { arena, ids } = started(1, { difficulty: 'chill' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 0.3, 10], [MP.grid - 0.8, 10], [MP.grid - 1.3, 10]], 0);
  arena.update(100);
  ok(player.alive === true, '悠闲档穿墙不死');
  ok(player.body.head.x < 1, '从右侧穿到左侧');
}

// ---------- 5. 限时重生 ----------
console.log('5. 限时模式重生');
{
  const { arena, ids } = started(1, { rhythm: 'timed', difficulty: 'classic' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 0.5, 10], [MP.grid - 1, 10], [MP.grid - 1.5, 10]], 0);
  arena.update(100);
  ok(player.alive === false, '死亡进入等待');
  arena.update(MP.respawnMs + 100);
  ok(player.alive === true, '3 秒后重生');
  ok(player.buffs.shield === true && player.buffs.shieldPhase > 0, '重生带护盾与无敌相位');
  ok(player.body.segments.length === 3, '重生蛇长恢复 3');
}

// ---------- 6. 生存淘汰 ----------
console.log('6. 生存淘汰');
{
  const { arena, ids } = started(2, { rhythm: 'survival', difficulty: 'classic' });
  const [a, b] = ids.map((id) => arena.players.get(id));
  arena.sharedFoods = [];
  setSnake(a, [[MP.grid - 0.5, 10], [MP.grid - 1, 10], [MP.grid - 1.5, 10]], 0);
  setSnake(b, [[5, 5], [4.5, 5], [4, 5]], 0);
  arena.update(100);
  ok(a.alive === false && a.eliminated === true, '撞墙被淘汰');
  ok(arena.phase === 'ended', '仅剩一人存活时比赛结束');
  ok(arena.winnerId === b.id, '最后存活者获胜');
  ok(arena.ranking[0].id === b.id, '排名第一为存活者');
}

// ---------- 7. 同场对抗 vs 抢食竞速 ----------
console.log('7. 同场对抗 vs 抢食竞速');
{
  const battle = started(2, { mode: 'battle', difficulty: 'classic' }).arena;
  const bIds = [...battle.players.keys()];
  const [p1, p2] = bIds.map((id) => battle.players.get(id));
  battle.sharedFoods = [];
  setSnake(p1, [[10, 10], [9.5, 10], [9, 10]], 0);
  setSnake(p2, [[11, 10], [11.5, 10], [12, 10]], Math.PI);
  battle.update(16);
  ok(p1.alive === false || p2.alive === false, '对抗模式撞到对手蛇身死亡');
}
{
  const race = started(2, { mode: 'race', difficulty: 'classic' }).arena;
  const rIds = [...race.players.keys()];
  const [p1, p2] = rIds.map((id) => race.players.get(id));
  race.sharedFoods = [];
  setSnake(p1, [[10, 10], [9.5, 10], [9, 10]], 0);
  setSnake(p2, [[11, 10], [11.5, 10], [12, 10]], Math.PI);
  race.update(16);
  ok(p1.alive === true && p2.alive === true, '抢食模式可穿过对手蛇身');
}

// ---------- 8. 各自竞速（同种子） ----------
console.log('8. 各自竞速');
{
  const { arena, ids } = started(2, { mode: 'lanes', rhythm: 'survival' });
  ok(arena.rhythmId === 'timed', '各自竞速固定限时节奏');
  ok(arena.sharedFoods.length === 0, '各自模式无共享食物池');
  const [p1, p2] = ids.map((id) => arena.players.get(id));
  ok(p1.foods.length === 2 && p2.foods.length === 2, '每人各自两份食物');
  ok(near(p1.body.head.x, p2.body.head.x) && near(p1.body.head.y, p2.body.head.y), '两人在各自棋盘同点出生');
  const sameFoods = p1.foods.every((food, index) => {
    const other = p2.foods[index];
    return other && near(food.x, other.x) && near(food.y, other.y) && food.type === other.type;
  });
  ok(sameFoods, '开局两份食物的位置和类型完全相同');
}

// ---------- 9. 大地图与食物刷新 ----------
console.log('9. 大地图与食物刷新');
{
  ok(MP.grid === 44, '联机棋盘为 44x44（面积约 2.5 倍）');
  const { arena } = started(2, { mode: 'race' });
  const heads = [...arena.players.values()].map((p) => p.body.head);
  const distances = arena.sharedFoods.map((food) =>
    Math.min(...heads.map((head) => Math.hypot(food.x - head.x, food.y - head.y))));
  const maxDistance = Math.max(...distances);
  ok(maxDistance <= MP.foodSpawnRadius + 1.5, '共享模式食物围绕玩家刷新', `max=${maxDistance.toFixed(1)}`);
  ok(arena.sharedFoods.length >= 3, '大图食物数量随人数上调');
}

// ---------- 10. 限时结束与排名 ----------
console.log('10. 限时结束与排名');
{
  const { arena, ids } = started(2, { rhythm: 'timed' });
  const [p1, p2] = ids.map((id) => arena.players.get(id));
  p1.score = 500;
  p2.score = 900;
  arena.matchTimeLeftMs = 10;
  arena.update(20);
  ok(arena.phase === 'ended', '时间到结束对局');
  ok(arena.ranking.length === 2 && arena.ranking[0].id === p2.id, '按分数排名');
  ok(arena.winnerId === p2.id, '胜者为最高分');
}

// ---------- 11. 金果实过期 ----------
console.log('11. 金果实过期');
{
  const { arena, ids } = started(1, { mode: 'race' });
  const player = arena.players.get(ids[0]);
  setSnake(player, [[5, 5], [4.5, 5], [4, 5]], 0);
  arena.sharedFoods = [{ id: 99, type: 'gold', x: 20, y: 20, remainingMs: 500 }];
  arena.update(700);
  ok(arena.sharedFoods.filter((food) => food.id === 99).length === 0, '金果实到期被替换');
  ok(arena.sharedFoods.length === 1, '保持食物数量');
}

// ---------- 12. 快照结构 ----------
console.log('12. 快照结构');
{
  const { arena, ids } = started(2, { mode: 'battle', rhythm: 'timed' });
  const snap = arena.snapshot();
  ok(snap.phase === 'playing' && snap.mode === 'battle' && snap.rhythm === 'timed', '快照含阶段/模式/节奏');
  ok(Array.isArray(snap.players) && snap.players.length === 2, '快照含全部玩家');
  const me = snap.players.find((p) => p.id === ids[0]);
  ok(Array.isArray(me.segments) && me.segments.length === 3, '玩家含连续蛇身坐标');
  ok(typeof me.heading === 'number' && typeof me.speed === 'number' && me.speed > 0, '玩家含朝向与速度');
  ok(Array.isArray(snap.foods) && snap.foods.length >= 3, '共享模式含食物列表');
  ok(snap.hostId === ids[0] && snap.grid === MP.grid, '快照含房主与棋盘尺寸');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);