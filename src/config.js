// 全部可调参数与静态数据（单人 / 联机 / 3D 配色）

export const STORAGE_KEY = 'neonSnake3D.v1';

export const GRID_SOLO = 24;      // 单人棋盘 24x24
export const START_LENGTH = 3;

export const COMBO = { window: 3000, max: 5 };

export const BUFF = {
  slowMultiplier: 0.7,
  slowDuration: 8000,
  doubleDuration: 10000,
  shieldPhaseDuration: 1000,
};

export const DIFFICULTY_LIST = ['chill', 'classic', 'insane'];

export const DIFFICULTIES = {
  chill: {
    id: 'chill', name: '悠闲', tagline: '慢速 · 穿墙不死',
    baseSpeed: 6, maxSpeed: 9, growthPerFruit: 0, growthEvery: 0,
    wrap: true, color: '#39d98a',
  },
  classic: {
    id: 'classic', name: '经典', tagline: '中速 · 撞墙即死',
    baseSpeed: 8, maxSpeed: 14, growthPerFruit: 0.3, growthEvery: 5,
    wrap: false, color: '#19f9ff',
  },
  insane: {
    id: 'insane', name: '狂暴', tagline: '高速 · 越吃越快',
    baseSpeed: 11, maxSpeed: 18, growthPerFruit: 0.5, growthEvery: 3,
    wrap: false, color: '#ff4d6d',
  },
};

export const FOOD_DEFS = {
  normal: { id: 'normal', name: '果实', score: 10, weight: 70, color: '#ff4d6d', glow: '#ff8ba0' },
  gold:   { id: 'gold',   name: '金果实', score: 50, weight: 8, color: '#ffd23f', glow: '#ffe680', lifetime: 6000 },
  shield: { id: 'shield', name: '护盾', weight: 8,  color: '#4da3ff', glow: '#9ccaff' },
  slow:   { id: 'slow',   name: '减速', weight: 7,  color: '#a04dff', glow: '#c99bff' },
  double: { id: 'double', name: '双倍分', weight: 7, color: '#39d98a', glow: '#8ff0c0' },
};

export const FOOD_TYPES = ['normal', 'gold', 'shield', 'slow', 'double'];

// 联机
export const MP = {
  grid: 56,              // 大战场：面积约为原来的 4 倍
  cameraFollowHalf: 14,  // 跟随镜头可见半宽（约 28 格视野）
  foodSpawnRadius: 12,   // 共享模式新食物围绕玩家的刷新半径
  maxPlayers: 8,
  tickMs: 60,            // 服务端模拟步长
  snapshotMs: 66,        // 快照广播间隔（约 15Hz）
  countdownMs: 5000,
  matchMs: 180000,       // 限时 3 分钟
  survivalMaxMs: 600000, // 生存模式兜底时长
  respawnMs: 3000,
  respawnShieldMs: 2000,
  dropGraceMs: 6000,
  nameMaxLength: 8,
  port: 8787,
};

export const MP_MODES = {
  race: { id: 'race', name: '抢食竞速', desc: '共享地图 · 互不伤害 · 比分数', shared: true, inter: false },
  battle: { id: 'battle', name: '同场对抗', desc: '共享地图 · 撞蛇身即死', shared: true, inter: true },
  lanes: { id: 'lanes', name: '各自竞速', desc: '独立地图 · 同种子食物 · 比分数', shared: false, inter: false },
};

export const MP_MODE_LIST = ['race', 'battle', 'lanes'];

export const MP_RHYTHMS = {
  timed: { id: 'timed', name: '限时 3 分钟', desc: '时间到比分数 · 死亡 3 秒重生' },
  survival: { id: 'survival', name: '生存淘汰', desc: '一条命 · 最后存活者获胜' },
};

export const MP_RHYTHM_LIST = ['timed', 'survival'];

export const PLAYER_COLORS = [
  '#19f9ff', '#ff4d6d', '#39d98a', '#ffd23f',
  '#a04dff', '#4da3ff', '#ff9f43', '#f368e0',
];

export const AVATARS = ['🐍', '🐲', '🦊', '🐸', '🐼', '🦄', '👾', '🤖'];

export const PROFILE_DEFAULTS = { name: '玩家', avatar: '🐍', color: PLAYER_COLORS[0] };

export const ACHIEVEMENTS = [
  { id: 'first_bite',  name: '初尝禁果',   desc: '吃到第一个果实' },
  { id: 'len_15',      name: '小有成长',   desc: '单局蛇身长度达到 15' },
  { id: 'len_30',      name: '长蛇传说',   desc: '单局蛇身长度达到 30' },
  { id: 'combo_5',     name: '连击大师',   desc: '单局打出 ×5 连击' },
  { id: 'score_1000',  name: '四位数',     desc: '单局得分达到 1000' },
  { id: 'insane_500',  name: '狂暴幸存者', desc: '狂暴难度单局达到 500 分' },
  { id: 'shield_save', name: '千钧一发',   desc: '护盾抵消一次死亡' },
  { id: 'all_fruits',  name: '大满贯',     desc: '单局集齐全部 5 种果实' },
  { id: 'mp_first',    name: '联机新兵',   desc: '完成一局局域网联机' },
  { id: 'mp_win',      name: '局域网之王', desc: '联机结算获得第一名' },
];

export const SETTINGS_DEFAULTS = { sfx: true, music: true, grid: true, theme: 'neon' };

// 皮肤主题：影响底板、点阵、边框、光晕、背景与灯光
export const THEMES = {
  neon: {
    id: 'neon', name: '霓虹',
    bgTop: '#0d1440', bgBottom: '#04050d',
    board: '#0b1228', boardAccent: '#16224a', boardSide: '#070c1c',
    grid: '#5a78ff', border: '#4f7bff', glow: '#19f9ff',
    ambient: '#8fa4ff', key: '#ffffff', fill: '#4058ff',
    dust: '#6f8cff',
  },
  aurora: {
    id: 'aurora', name: '极光',
    bgTop: '#062a2a', bgBottom: '#020b0c',
    board: '#06201f', boardAccent: '#0d3a34', boardSide: '#041312',
    grid: '#37e0c0', border: '#2fd8b0', glow: '#64ffda',
    ambient: '#8fffe0', key: '#f2fffb', fill: '#2fd8b0',
    dust: '#39d98a',
  },
  magma: {
    id: 'magma', name: '熔岩',
    bgTop: '#2a0d06', bgBottom: '#0b0302',
    board: '#1e0a08', boardAccent: '#3a140c', boardSide: '#120504',
    grid: '#ff8a5c', border: '#ff6a3d', glow: '#ffb347',
    ambient: '#ffb08f', key: '#fff0e0', fill: '#ff4d2e',
    dust: '#ff7a45',
  },
};

export const THEME_LIST = ['neon', 'aurora', 'magma'];

export const COLORS = {
  bg: '#05060f',
  fog: '#05060f',
  board: '#0b1024',
  grid: 'rgba(90, 130, 255, 0.22)',
  border: '#3f63ff',
  text: '#eaf6ff',
};