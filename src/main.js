// 主控：单人 3D / 局域网联机 状态机 + 主循环
import { SnakeGame } from './game.js';
import { loadState, saveState } from './storage.js';
import { AudioEngine } from './audio.js';
import { InputController } from './input.js';
import { Effects } from './effects.js';
import { Renderer3D } from './render3d.js';
import { UI } from './ui.js';
import { NetClient } from './net.js';
import { GRID_SOLO, DIFFICULTIES, FOOD_DEFS, ACHIEVEMENTS } from './config.js';

const state = loadState();
const unlockedAchievements = new Set(state.achievements);
const audio = new AudioEngine(state.settings);
const effects = new Effects();
const canvas = document.getElementById('game');
const renderer = new Renderer3D(canvas, state.settings);

let game = null;
let mode = 'menu'; // menu | solo | soloPaused | soloDying | soloGameOver | lan
let currentDiff = 'classic';
let bestAtStart = 0;
let maxCombo = 1;
let deathTimer = 0;
let shieldSaveSeen = false;
let hintShown = false;

let net = null;
let selfId = null;
let lastLanPhase = null;
let lanMatchUnlocked = false;
let lanFocus = null;

const ui = new UI(state, {
  onStartSolo: (diffId) => startSolo(diffId),
  onOpenLan: () => openLan(),
  onLanJoin: (name) => joinLan(name),
  onLanLeave: () => leaveLan(),
  onLanStart: () => startLanMatch(),
  onLanConfig: (partial) => changeLanConfig(partial),
  onSaveProfile: () => saveState(state),
  onPauseToggle: () => togglePause(),
  onRestart: () => restartCurrent(),
  onQuit: () => quitToMenu(),
  onConfirm: () => confirmAction(),
  onSettingsChanged: () => {
    renderer.applyTheme(state.settings.theme, true);
    audio.setSettings(state.settings);
    if (state.settings.music && (mode === 'solo' || (mode === 'lan' && net && net.snapshot && net.snapshot.phase === 'playing'))) {
      audio.startMusic();
    }
    saveState(state);
  },
});

const input = new InputController({
  onDirection: (dir) => {
    if (mode === 'solo' && game) game.queueDirection(dir);
    else if (mode === 'lan' && net && net.snapshot && net.snapshot.phase === 'playing') net.sendDirection(dir);
  },
  onPauseToggle: () => togglePause(),
  onConfirm: () => confirmAction(),
  onMute: () => toggleMute(),
});
input.attach();

window.addEventListener('resize', () => renderer.resize());

// ---------- 单人 ----------
function startSolo(diffId) {
  document.activeElement?.blur();
  audio.ensure();
  currentDiff = diffId;
  game = new SnakeGame({ difficulty: diffId });
  effects.reset();
  bestAtStart = state.bests[diffId] ?? 0;
  maxCombo = 1;
  shieldSaveSeen = false;
  deathTimer = 0;
  mode = 'solo';
  ui.showSolo(diffId);
  audio.ui();
  audio.startMusic();
  audio.setIntensity(88 + game.currentSpeed() * 3.2);
  if (!hintShown) {
    hintShown = true;
    ui.toast('方向键 / WASD 转向 · 空格暂停 · 手机滑动', 'hint');
  }
}

function togglePause() {
  if (ui.anyOverlayOpen()) {
    ui.closeTopOverlays();
    return;
  }
  if (mode === 'solo') {
    mode = 'soloPaused';
    ui.showSoloPause();
    audio.stopMusic();
    audio.ui();
  } else if (mode === 'soloPaused') {
    mode = 'solo';
    ui.hideSoloPause();
    audio.startMusic();
    audio.ui();
  }
}

function restartCurrent() {
  if (mode === 'lan') return;
  startSolo(currentDiff);
}

function quitToMenu() {
  if (mode === 'lan') {
    leaveLan();
    return;
  }
  mode = 'menu';
  game = null;
  audio.stopMusic();
  effects.reset();
  ui.showMenu();
  saveState(state);
}

function confirmAction() {
  if (ui.anyOverlayOpen()) return;
  if (mode === 'menu') startSolo(currentDiff);
  else if (mode === 'soloGameOver') startSolo(currentDiff);
  else if (mode === 'soloPaused') togglePause();
}

function toggleMute() {
  state.settings.sfx = !state.settings.sfx;
  saveState(state);
  ui.toast(state.settings.sfx ? '音效已开启' : '音效已关闭');
  if (state.settings.sfx) audio.ui();
}

function enterSoloDying() {
  mode = 'soloDying';
  deathTimer = 1.05;
  audio.stopMusic();
  audio.death();
  effects.deathBurst(game.snake, '#19f9ff');
  const head = game.snake[0];
  effects.burst(head.x + 0.5, head.y + 0.5, '#ffffff', 26, 9);
  effects.addShake(16);
  effects.addFlash(0.45, game.deadReason === 'wall' ? '#ff4d6d' : '#a04dff');
}

function finishSolo() {
  mode = 'soloGameOver';
  const score = game.score;
  const prevBest = state.bests[currentDiff] ?? 0;
  const isNewRecord = score > prevBest;
  if (isNewRecord) state.bests[currentDiff] = score;
  state.stats.games += 1;
  state.stats.fruits += game.fruitsEaten;
  state.stats.longest = Math.max(state.stats.longest, game.snake.length);
  state.stats.totalScore += score;
  state.stats.totalTimeMs += game.elapsed;
  saveState(state);
  if (isNewRecord) audio.newRecord();
  ui.showSoloGameOver({
    score,
    best: state.bests[currentDiff],
    isNewRecord,
    length: game.snake.length,
    fruits: game.fruitsEaten,
    maxCombo,
    durationMs: game.elapsed,
    difficulty: currentDiff,
  });
}

function handleSoloEvents(events) {
  for (const event of events) {
    if (event.type === 'eat') {
      const def = FOOD_DEFS[event.food];
      const cx = event.head.x + 0.5;
      const cy = event.head.y + 0.5;
      if (event.food === 'gold') {
        audio.gold();
        effects.addFlash(0.28, '#ffd23f');
        effects.addShake(5);
        effects.burst(cx, cy, def.color, 24, 7.5);
      } else {
        audio.eat(event.combo);
        effects.burst(cx, cy, def.color, event.combo >= 2 ? 18 : 10, 5);
      }
      if (event.food === 'shield' || event.food === 'slow' || event.food === 'double') {
        audio.buff(event.food);
        effects.burst(cx, cy, def.color, 16, 5);
      }
      if (event.combo >= 2) effects.addShake(1.5 + event.combo);
    } else if (event.type === 'shieldBreak') {
      shieldSaveSeen = true;
      audio.shieldBreak();
      effects.addFlash(0.35, '#4da3ff');
      effects.addShake(10);
    }
  }
}

function unlockAchievement(id) {
  if (unlockedAchievements.has(id)) return false;
  unlockedAchievements.add(id);
  state.achievements.push(id);
  saveState(state);
  const def = ACHIEVEMENTS.find((item) => item.id === id);
  ui.toast(`成就解锁：${def ? def.name : id}`, 'achievement');
  audio.gold();
  return true;
}

function checkSoloAchievements() {
  if (game.fruitsEaten >= 1) unlockAchievement('first_bite');
  if (game.snake.length >= 15) unlockAchievement('len_15');
  if (game.snake.length >= 30) unlockAchievement('len_30');
  if (game.getComboMultiplier() >= 5) unlockAchievement('combo_5');
  if (game.score >= 1000) unlockAchievement('score_1000');
  if (currentDiff === 'insane' && game.score >= 500) unlockAchievement('insane_500');
  if (shieldSaveSeen) unlockAchievement('shield_save');
  if (game.fruitTypesEaten.size >= 5) unlockAchievement('all_fruits');
}

// ---------- 局域网 ----------
async function openLan() {
  ui.showLanConnecting();
  audio.ensure();
  const probe = await NetClient.probe();
  if (!probe) {
    ui.showLanUnavailable('当前页面没有连上房间服务器。');
    return;
  }
  ui.showLanForm(state.profile.name);
}

async function joinLan(rawName) {
  const name = (rawName || '').slice(0, 8) || state.profile.name || '玩家';
  state.profile.name = name;
  saveState(state);
  ui.saveName(name);
  try {
    net = new NetClient({
      onSnapshot: handleLanSnapshot,
      onEvents: handleLanEvents,
      onDisconnected: handleLanDisconnected,
    });
    const data = await net.join(name, state.profile);
    selfId = data.playerId;
    mode = 'lan';
    lastLanPhase = null;
    lanMatchUnlocked = false;
    lanFocus = null;
    effects.reset();
    audio.ensure();
    audio.ui();
    ui.updateLan(net.snapshot, selfId);
  } catch (err) {
    if (net) net.cleanup();
    net = null;
    selfId = null;
    ui.showLanUnavailable(err.message || '加入房间失败');
  }
}

function handleLanSnapshot(snapshot) {
  if (!net || mode !== 'lan') return;
  const previous = lastLanPhase;
  lastLanPhase = snapshot.phase;

  if (snapshot.phase === 'playing' && previous !== 'playing') {
    effects.reset();
    audio.startMusic();
    audio.setIntensity(110);
    lanMatchUnlocked = false;
  }
  if (snapshot.phase !== 'playing' && previous === 'playing') {
    audio.stopMusic();
  }
  if (snapshot.phase === 'ended' && previous !== 'ended') {
    if (!lanMatchUnlocked) {
      lanMatchUnlocked = true;
      state.stats.mpGames = (state.stats.mpGames || 0) + 1;
      if (snapshot.winnerId === selfId) {
        state.stats.mpWins = (state.stats.mpWins || 0) + 1;
        unlockAchievement('mp_win');
        audio.newRecord();
      }
      unlockAchievement('mp_first');
      saveState(state);
    }
  }
  ui.updateLan(snapshot, selfId);
}

function handleLanEvents(events) {
  if (!net || !net.snapshot) return;
  const players = net.snapshot.players;
  for (const event of events) {
    if (event.type === 'eat') {
      const def = FOOD_DEFS[event.food];
      const cx = event.x + 0.5;
      const cy = event.y + 0.5;
      const isMe = event.playerId === selfId;
      if (event.food === 'gold') {
        if (isMe) { audio.gold(); effects.addFlash(0.22, '#ffd23f'); }
        effects.burst(cx, cy, def.color, 18, 6.5);
      } else {
        if (isMe) audio.eat(event.combo);
        effects.burst(cx, cy, def.color, isMe ? 12 : 7, 4.5);
      }
      if (isMe && (event.food === 'shield' || event.food === 'slow' || event.food === 'double')) {
        audio.buff(event.food);
      }
    } else if (event.type === 'shieldBreak') {
      if (event.playerId === selfId) {
        shieldSaveSeen = true;
        audio.shieldBreak();
        effects.addFlash(0.35, '#4da3ff');
        effects.addShake(10);
      }
    } else if (event.type === 'death') {
      const player = players.find((p) => p.id === event.playerId);
      const color = player ? player.color : '#ff4d6d';
      effects.burst(event.x + 0.5, event.y + 0.5, color, 26, 9);
      effects.addShake(8);
      if (event.playerId === selfId) {
        audio.death();
        effects.addFlash(0.4, '#ff4d6d');
        effects.addShake(16);
      }
    } else if (event.type === 'respawn' && event.playerId === selfId) {
      ui.toast('已重生，获得护盾', 'hint');
    }
  }
}

function handleLanDisconnected() {
  if (!net || net.leaving) return;
  ui.toast('与房间服务器断开，请重新加入', 'error');
  net.cleanup();
  net = null;
  selfId = null;
  lastLanPhase = null;
  lanFocus = null;
  mode = 'menu';
  audio.stopMusic();
  ui.showMenu();
}

async function changeLanConfig(partial) {
  if (!net) return;
  const res = await net.setConfig(partial);
  if (!res.ok) ui.toast((res.data && res.data.error) || '修改配置失败', 'error');
}

async function startLanMatch() {
  if (!net) return;
  const res = await net.start();
  if (!res.ok) ui.toast((res.data && res.data.error) || '开始失败', 'error');
}

async function leaveLan() {
  const client = net;
  net = null;
  selfId = null;
  lastLanPhase = null;
  lanFocus = null;
  mode = 'menu';
  audio.stopMusic();
  effects.reset();
  ui.showMenu();
  if (client) {
    try { await client.leave(); } catch (err) { /* 忽略 */ }
  }
}

// ---------- 渲染视图 ----------
function buildSoloView() {
  const t = game.alive ? game.getTickProgress() : 1;
  const segments = [];
  for (let i = 0; i < game.snake.length; i++) {
    const cur = game.snake[i];
    const old = game.prevSnake[i] || cur;
    const wrapped = Math.abs(cur.x - old.x) > 1.5 || Math.abs(cur.y - old.y) > 1.5;
    segments.push([
      wrapped ? cur.x : old.x + (cur.x - old.x) * t,
      wrapped ? cur.y : old.y + (cur.y - old.y) * t,
    ]);
  }
  const foods = game.food
    ? [{ id: `solo-${game.food.type}`, type: game.food.type, x: game.food.x, y: game.food.y }]
    : [];
  return {
    grid: GRID_SOLO,
    snakes: [{
      id: 'solo',
      color: state.profile.color || '#19f9ff',
      label: `${state.profile.avatar || '🐍'} ${state.profile.name || '玩家'}`,
      segments,
      dir: [game.dir.x, game.dir.y],
      visible: true,
    }],
    foods,
  };
}

function interpolateSegments(prevPlayer, player, alpha) {
  const current = player.segments;
  const previous = prevPlayer ? prevPlayer.segments : null;
  if (!previous || previous.length !== current.length) return current;
  const out = [];
  for (let i = 0; i < current.length; i++) {
    const c = current[i];
    const o = previous[i];
    const wrapped = Math.abs(c[0] - o[0]) > 1.5 || Math.abs(c[1] - o[1]) > 1.5;
    out.push(wrapped ? [c[0], c[1]] : [o[0] + (c[0] - o[0]) * alpha, o[1] + (c[1] - o[1]) * alpha]);
  }
  return out;
}

function buildLanView() {
  const snapshot = net.snapshot;
  const previous = net.prevSnapshot;
  const alpha = net.getInterpolation();
  const lanes = snapshot.mode === 'lanes';
  const relevant = lanes ? snapshot.players.filter((p) => p.id === selfId) : snapshot.players;
  const snakes = relevant.map((player) => {
    const prevPlayer = previous ? previous.players.find((p) => p.id === player.id) : null;
    return {
      id: player.id,
      color: player.color,
      label: `${player.avatar || '🐍'} ${player.name}`,
      segments: player.alive ? interpolateSegments(prevPlayer, player, alpha) : [],
      dir: player.dir,
      visible: player.alive,
    };
  });
  let foods = [];
  const me = snapshot.players.find((p) => p.id === selfId);
  if (lanes) {
    if (me && me.foods) foods = me.foods;
  } else {
    foods = snapshot.foods || [];
  }
  // 大战场镜头跟随自己的蛇；死亡等待重生时停在最后一次位置
  const selfSnake = relevant.find((player) => player.id === selfId);
  if (selfSnake && selfSnake.segments && selfSnake.segments.length > 0) {
    lanFocus = selfSnake.segments[0];
  }
  return { grid: snapshot.grid || 56, snakes, foods, follow: true, focus: lanFocus };
}

// ---------- 主循环 ----------
let lastTime = performance.now();

function frame(now) {
  const dtSec = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  effects.update(dtSec);

  if (mode === 'solo' && game) {
    game.update(dtSec * 1000);
    handleSoloEvents(game.drainEvents());
    maxCombo = Math.max(maxCombo, game.getComboMultiplier());
    audio.setIntensity(88 + game.currentSpeed() * 3.2);
    ui.updateSoloHud(game, Math.max(bestAtStart, game.score));
    if (!game.alive) enterSoloDying();
    else checkSoloAchievements();
  } else if (mode === 'soloDying') {
    deathTimer -= dtSec;
    if (deathTimer <= 0) finishSolo();
  }

  if (mode === 'lan' && net && net.snapshot) {
    renderer.renderScene(buildLanView(), effects, now);
  } else if (game && mode !== 'menu') {
    renderer.renderScene(buildSoloView(), effects, now);
  } else {
    renderer.renderMenu(now, effects);
  }

  ui.setFlash(effects.flash, effects.flashColor);
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'solo') togglePause();
});

window.addEventListener('pagehide', () => {
  if (net) net.leave();
});

// 调试句柄：自动化测试用
window.__neonSnake3D = {
  getGame: () => game,
  getMode: () => mode,
  getNet: () => net,
  getSelfId: () => selfId,
  getSnapshot: () => (net ? net.snapshot : null),
};

ui.showMenu();
requestAnimationFrame(frame);

const auto = new URLSearchParams(location.hash.slice(1)).get('play');
if (auto && DIFFICULTIES[auto]) startSolo(auto);