// 联机竞技场无头自测：node tools/sim/arena-selftest.mjs
import { Arena } from '../../src/mp/arena.js';
import { MP, DIFFICULTIES } from '../../src/config.js';

let passed = 0;
let failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

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

function setSnake(player, cells, dir = { x: 1, y: 0 }) {
  player.segments = cells.map(([x, y]) => ({ x, y }));
  player.dir = { ...dir };
  player.pendingDirs = [];
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

// ---------- 2. 倒计时与移动 ----------
console.log('2. 倒计时与移动');
{
  const { arena, ids } = makeArena(1);
  const host = ids[0];
  arena.start(host);
  arena.update(MP.countdownMs - 500);
  ok(arena.phase === 'countdown', '倒计时未结束不开打');
  arena.update(600);
  ok(arena.phase === 'playing', '倒计时结束进入对局');

  const player = arena.players.get(host);
  arena.sharedFoods = [];
  setSnake(player, [[10, 10], [9, 10], [8, 10]], { x: 1, y: 0 });
  ok(player.segments[0].x === 10 && player.segments[0].y === 10, '测试起始位置已就位');
  arena.update(125); // 经典 8 格/秒 → 一 tick
  ok(player.segments[0].x === 11 && player.segments[0].y === 10, '按速度前进一格', JSON.stringify(player.segments[0]));
  ok(player.segments.length === 3, '未吃食物长度不变');

  const reversed = arena.queueDirection(host, 'left');
  ok(reversed === false, '禁止 180° 反转');
  arena.queueDirection(host, 'up');
  arena.update(125);
  ok(player.segments[0].y === 9, '转向生效');
}

// ---------- 3. 吃食物与连击 ----------
console.log('3. 吃食物与连击');
{
  const { arena, ids } = started(1, { mode: 'race', difficulty: 'classic' });
  const host = ids[0];
  const player = arena.players.get(host);
  arena.sharedFoods = [];
  setSnake(player, [[10, 10], [9, 10], [8, 10]]);
  arena.sharedFoods.push({ id: 1, type: 'normal', x: 11, y: 10, remainingMs: null });
  arena.update(125);
  ok(player.score === 10, '吃普通果实 +10', `score=${player.score}`);
  ok(player.segments.length === 4, '蛇身增长');
  ok(arena.sharedFoods.length === 1, '吃掉后补充一个新食物');
  ok(arena.sharedFoods[0].x !== 11 || arena.sharedFoods[0].y !== 10, '新食物不占用旧位置');

  arena.sharedFoods = [];
  setSnake(player, [[11, 10], [10, 10], [9, 10]]);
  arena.drainEvents(); // 清掉第一颗果实的事件
  arena.sharedFoods.push({ id: 2, type: 'gold', x: 12, y: 10, remainingMs: null });
  arena.update(125);
  ok(player.score === 10 + 100, '金果 +50 × 连击 x2 = +100', `score=${player.score}`);

  const eatEvents = arena.drainEvents().filter((e) => e.type === 'eat');
  ok(eatEvents.length === 1 && eatEvents[0].combo === 2, '吃食物事件带连击倍率');
}

// ---------- 4. 撞墙与穿墙 ----------
console.log('4. 撞墙与穿墙');
{
  const { arena, ids } = started(1, { difficulty: 'classic' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 1, 10], [MP.grid - 2, 10], [MP.grid - 3, 10]]);
  arena.update(125);
  ok(player.alive === false, '经典档撞墙死亡');
  const snap = arena.snapshot();
  const me = snap.players.find((p) => p.id === ids[0]);
  ok(me.respawnInMs > 0 && me.respawnInMs <= MP.respawnMs, '死亡快照带重生倒计时');
}
{
  const { arena, ids } = started(1, { difficulty: 'chill' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 1, 10], [MP.grid - 2, 10], [MP.grid - 3, 10]]);
  arena.update(200);
  ok(player.alive === true, '悠闲档穿墙不死');
  ok(player.segments[0].x === 0, '从右侧穿到左侧');
}

// ---------- 5. 限时重生 ----------
console.log('5. 限时模式重生');
{
  const { arena, ids } = started(1, { rhythm: 'timed', difficulty: 'classic' });
  const player = arena.players.get(ids[0]);
  arena.sharedFoods = [];
  setSnake(player, [[MP.grid - 1, 10], [MP.grid - 2, 10], [MP.grid - 3, 10]]);
  arena.update(125);
  ok(player.alive === false, '死亡进入等待');
  arena.update(MP.respawnMs + 50);
  ok(player.alive === true, '3 秒后重生');
  ok(player.buffs.shield === true && player.buffs.shieldPhase > 0, '重生带护盾与无敌相位');
  ok(player.segments.length === 3, '重生蛇长恢复 3');
}

// ---------- 6. 生存淘汰 ----------
console.log('6. 生存淘汰');
{
  const { arena, ids } = started(2, { rhythm: 'survival', difficulty: 'classic' });
  const [a, b] = ids.map((id) => arena.players.get(id));
  arena.sharedFoods = [];
  setSnake(a, [[MP.grid - 1, 10], [MP.grid - 2, 10], [MP.grid - 3, 10]]);
  setSnake(b, [[5, 5], [4, 5], [3, 5]]);
  // 两人都在动；先让 a 撞墙
  arena.update(125);
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
  setSnake(p1, [[10, 10], [9, 10], [8, 10]]);
  setSnake(p2, [[11, 10], [12, 10], [13, 10]], { x: -1, y: 0 });
  battle.update(125);
  ok(p1.alive === false, '对抗模式撞到对手蛇身死亡');
  ok(battle.drainEvents().some((e) => e.type === 'death' && e.playerId === p1.id), '产生死亡事件');
}
{
  const race = started(2, { mode: 'race', difficulty: 'classic' }).arena;
  const rIds = [...race.players.keys()];
  const [p1, p2] = rIds.map((id) => race.players.get(id));
  race.sharedFoods = [];
  setSnake(p1, [[10, 10], [9, 10], [8, 10]]);
  setSnake(p2, [[11, 10], [12, 10], [13, 10]], { x: -1, y: 0 });
  race.update(125);
  ok(p1.alive === true, '抢食模式可穿过对手蛇身');
}

// ---------- 8. 各自竞速（同种子） ----------
console.log('8. 各自竞速');
{
  const { arena, ids } = started(2, { mode: 'lanes', rhythm: 'survival' });
  ok(arena.rhythmId === 'timed', '各自竞速固定限时节奏');
  ok(arena.sharedFoods.length === 0, '各自模式无共享食物池');
  const [p1, p2] = ids.map((id) => arena.players.get(id));
  ok(p1.foods.length === 2 && p2.foods.length === 2, '每人各自两份食物');
  ok(p1.segments[0].x === p2.segments[0].x && p1.segments[0].y === p2.segments[0].y, '两人在各自棋盘同点出生');
  const s1 = arena.deterministicSpawn(0);
  const s2 = arena.deterministicSpawn(0);
  ok(s1.x === s2.x && s1.y === s2.y && s1.type === s2.type, '同序号食物序列一致');
  const sameFoods = p1.foods.every((food, index) => {
    const other = p2.foods[index];
    return other && food.x === other.x && food.y === other.y && food.type === other.type;
  });
  ok(sameFoods, '开局两份食物的位置和类型完全相同');
}

console.log('8.5 大战场与食物刷新');
{
  ok(MP.grid === 44, '联机棋盘为 44x44（面积约 2.5 倍）');
  const { arena } = started(2, { mode: 'race' });
  const heads = [...arena.players.values()].map((p) => p.segments[0]);
  const distances = arena.sharedFoods.map((food) =>
    Math.min(...heads.map((head) => Math.hypot(food.x - head.x, food.y - head.y))));
  const maxDistance = Math.max(...distances);
  ok(maxDistance <= MP.foodSpawnRadius + 1.5, '共享模式食物围绕玩家刷新', `max=${maxDistance.toFixed(1)}`);
  ok(arena.sharedFoods.length >= 3, '大图食物数量随人数上调', `foods=${arena.sharedFoods.length}`);
}

// ---------- 9. 限时结束与排名 ----------
console.log('9. 限时结束与排名');
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
  ok(arena.drainEvents().some((e) => e.type === 'end'), '产生结束事件');
}

// ---------- 10. 金果实过期 ----------
console.log('10. 金果实过期');
{
  const { arena, ids } = started(1, { mode: 'race' });
  const player = arena.players.get(ids[0]);
  setSnake(player, [[5, 5], [4, 5], [3, 5]]);
  arena.sharedFoods = [{ id: 99, type: 'gold', x: 20, y: 20, remainingMs: 500 }];
  arena.update(700);
  const golds = arena.sharedFoods.filter((f) => f.id === 99);
  ok(golds.length === 0, '金果实到期被替换');
  ok(arena.sharedFoods.length === 1, '保持食物数量');
}

// ---------- 11. 快照结构 ----------
console.log('11. 快照结构');
{
  const { arena, ids } = started(2, { mode: 'battle', rhythm: 'timed' });
  const snap = arena.snapshot();
  ok(snap.phase === 'playing' && snap.mode === 'battle' && snap.rhythm === 'timed', '快照含阶段/模式/节奏');
  ok(Array.isArray(snap.players) && snap.players.length === 2, '快照含全部玩家');
  const me = snap.players.find((p) => p.id === ids[0]);
  ok(Array.isArray(me.segments) && me.segments.length === 3, '玩家含蛇身坐标');
  ok(Array.isArray(snap.foods) && snap.foods.length >= 2, '共享模式含食物列表');
  ok(snap.hostId === ids[0], '快照含房主');
  ok(snap.grid === MP.grid, '快照含网格尺寸');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);