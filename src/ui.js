// DOM 界面：主菜单 / 单人 HUD / 局域网大厅 / 联机 HUD / 结算 / 成就 / 设置
import {
  DIFFICULTY_LIST, DIFFICULTIES, ACHIEVEMENTS,
  MP_MODES, MP_MODE_LIST, MP_RHYTHMS, MP_RHYTHM_LIST,
  AVATARS, PLAYER_COLORS, THEMES, THEME_LIST, FOOD_DEFS, QUALITY_LIST,
} from './config.js';

const NAME_STORAGE_KEY = 'neonSnake3D.name';

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle('hidden', hidden);
}

export class UI {
  constructor(state, handlers) {
    this.state = state;
    this.handlers = handlers;
    this.currentDiff = 'classic';
    this.soloCache = { score: null, best: null, combo: null };
    this.buffCache = { shield: null, slow: null, double: null };
    this.lanCache = { boardSignature: '', timer: '', mode: '', respawn: '', phase: null };
    this.lobbySignature = '';
    this.endSignature = '';
    this.profileDraft = { ...state.profile };
    this.inviteReady = false;
    this.el = {};
    const ids = [
      'menu', 'diffRow', 'menuStats', 'btnLan', 'btnAchievements', 'btnSettings', 'btnHelp',
      'soloHud', 'hudScore', 'hudBest', 'comboChip', 'comboValue', 'btnPause', 'diffChip',
      'lanHud', 'lanTimer', 'lanModeChip', 'btnLanLeave', 'lanBoard', 'lanRespawn', 'lanRespawnSec', 'minimap',
      'buffBar', 'buffShield', 'buffSlow', 'buffDouble', 'buffSlowTime', 'buffSlowBar', 'buffDoubleTime', 'buffDoubleBar',
      'countdownOverlay', 'countdownText',
      'lanOverlay', 'lanConnecting', 'lanUnavailable', 'btnLanUnavailableClose',
      'lanForm', 'lanName', 'btnLanJoin', 'btnLanBack',
      'lanLobby', 'lanLobbyCount', 'lanHostTag', 'lanPlayerList',
      'lanInvite', 'lanInviteTitle', 'lanQr', 'lanUrl', 'btnCopyUrl',
      'hostConfig', 'guestSummary', 'guestSummaryText',
      'selMode', 'selRhythm', 'selDifficulty', 'btnLanStart', 'btnLanLeave2', 'lanHint',
      'lanEndOverlay', 'lanWinBanner', 'lanRanking', 'btnLanAgain', 'btnLanEndLeave', 'lanEndHint',
      'pauseOverlay', 'btnResume', 'btnPauseSettings', 'btnRestart', 'btnQuit',
      'gameOverOverlay', 'newRecord', 'gameOverTitle', 'resultScore', 'resultGrid', 'btnAgain', 'btnToMenu',
      'achievementsOverlay', 'achCount', 'achList', 'btnAchClose',
      'profileOverlay', 'btnProfile', 'profileAvatarPreview', 'profileNamePreview', 'profileName',
      'avatarPicker', 'colorPicker', 'btnProfileSave', 'btnProfileClose', 'profileStats',
      'settingsOverlay', 'setSfx', 'setMusic', 'setGrid', 'setTheme', 'setQuality', 'btnFullscreen', 'btnSetClose', 'helpOverlay', 'btnHelpClose',
      'flashLayer', 'toastLayer',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.populateSelects();
    this.bind();
    this.buildDifficultyCards();
    this.applySettings();
  }

  populateSelects() {
    this.el.selMode.innerHTML = MP_MODE_LIST
      .map((id) => `<option value="${id}">${MP_MODES[id].name} · ${MP_MODES[id].desc}</option>`)
      .join('');
    const rhythmIds = MP_RHYTHM_LIST;
    this.el.selRhythm.innerHTML = rhythmIds
      .map((id) => `<option value="${id}">${MP_RHYTHMS[id].name}</option>`)
      .join('');
    this.el.selDifficulty.innerHTML = DIFFICULTY_LIST
      .map((id) => `<option value="${id}">${DIFFICULTIES[id].name} · ${DIFFICULTIES[id].tagline}</option>`)
      .join('');
    this.el.setTheme.innerHTML = THEME_LIST
      .map((id) => `<option value="${id}">${THEMES[id].name}</option>`)
      .join('');
    this.el.setQuality.innerHTML = QUALITY_LIST
      .map((item) => `<option value="${item.id}">${item.name}</option>`)
      .join('');
  }

  bind() {
    const h = this.handlers;
    this.el.btnLan.addEventListener('click', () => h.onOpenLan());
    this.el.btnProfile.addEventListener('click', () => this.showProfile());
    this.el.btnProfileClose.addEventListener('click', () => this.hideProfile());
    this.el.btnProfileSave.addEventListener('click', () => this.saveProfile());
    this.el.profileName.addEventListener('input', () => this.refreshProfilePreview());
    this.el.btnAchievements.addEventListener('click', () => this.showAchievements());
    this.el.btnAchClose.addEventListener('click', () => this.hideAchievements());
    this.el.btnSettings.addEventListener('click', () => this.showSettings());
    this.el.btnSetClose.addEventListener('click', () => this.hideSettings());
    this.el.btnFullscreen.addEventListener('click', () => h.onFullscreen());
    this.el.btnHelp.addEventListener('click', () => this.showHelp());
    this.el.btnHelpClose.addEventListener('click', () => this.hideHelp());

    this.el.btnPause.addEventListener('click', () => h.onPauseToggle());
    this.el.btnResume.addEventListener('click', () => h.onPauseToggle());
    this.el.btnPauseSettings.addEventListener('click', () => this.showSettings());
    this.el.btnRestart.addEventListener('click', () => h.onRestart());
    this.el.btnQuit.addEventListener('click', () => h.onQuit());
    this.el.btnAgain.addEventListener('click', () => h.onRestart());
    this.el.btnToMenu.addEventListener('click', () => h.onQuit());

    this.el.btnLanJoin.addEventListener('click', () => h.onLanJoin(this.el.lanName.value.trim()));
    this.el.lanName.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') h.onLanJoin(this.el.lanName.value.trim());
    });
    this.el.btnLanBack.addEventListener('click', () => h.onLanLeave());
    this.el.btnLanUnavailableClose.addEventListener('click', () => h.onLanLeave());
    this.el.btnLanLeave.addEventListener('click', () => h.onLanLeave());
    this.el.btnLanLeave2.addEventListener('click', () => h.onLanLeave());
    this.el.btnLanEndLeave.addEventListener('click', () => h.onLanLeave());
    this.el.btnLanStart.addEventListener('click', () => h.onLanStart());
    this.el.btnLanAgain.addEventListener('click', () => h.onLanStart());

    for (const select of [this.el.selMode, this.el.selRhythm, this.el.selDifficulty]) {
      select.addEventListener('change', () => {
        h.onLanConfig({
          mode: this.el.selMode.value,
          rhythm: this.el.selRhythm.value,
          difficulty: this.el.selDifficulty.value,
        });
      });
    }

    for (const [key, input] of [['sfx', this.el.setSfx], ['music', this.el.setMusic], ['grid', this.el.setGrid]]) {
      input.addEventListener('change', () => {
        this.state.settings[key] = input.checked;
        h.onSettingsChanged();
      });
    }
    this.el.setTheme.addEventListener('change', () => {
      this.state.settings.theme = this.el.setTheme.value;
      h.onSettingsChanged();
    });
    this.el.setQuality.addEventListener('change', () => {
      this.state.settings.quality = this.el.setQuality.value;
      h.onSettingsChanged();
    });
  }

  buildDifficultyCards() {
    const row = this.el.diffRow;
    row.innerHTML = '';
    for (const id of DIFFICULTY_LIST) {
      const diff = DIFFICULTIES[id];
      const card = document.createElement('button');
      card.className = 'diff-card';
      card.style.setProperty('--accent', diff.color);
      card.dataset.diff = id;
      card.innerHTML = `
        <span class="diff-name">${diff.name}</span>
        <span class="diff-tag">${diff.tagline}</span>
        <span class="diff-best">最高分 <b data-best="${id}">0</b></span>`;
      card.addEventListener('click', () => this.handlers.onStartSolo(id));
      row.appendChild(card);
    }
  }

  refreshMenu() {
    for (const id of DIFFICULTY_LIST) {
      const node = this.el.diffRow.querySelector(`[data-best="${id}"]`);
      if (node) node.textContent = String(this.state.bests[id] ?? 0);
    }
    const stats = this.state.stats;
    this.el.menuStats.textContent =
      `总局数 ${stats.games} · 果实 ${stats.fruits} · 最长 ${stats.longest} · 成就 ${this.state.achievements.length}/${ACHIEVEMENTS.length}`;
    this.applySettings();
  }

  applySettings() {
    this.el.setSfx.checked = this.state.settings.sfx;
    this.el.setMusic.checked = this.state.settings.music;
    this.el.setGrid.checked = this.state.settings.grid;
    this.el.setTheme.value = this.state.settings.theme;
    this.el.setQuality.value = this.state.settings.quality;
  }

  showMenu() {
    setHidden(this.el.menu, false);
    setHidden(this.el.soloHud, true);
    setHidden(this.el.lanHud, true);
    setHidden(this.el.buffBar, true);
    setHidden(this.el.pauseOverlay, true);
    setHidden(this.el.gameOverOverlay, true);
    setHidden(this.el.lanEndOverlay, true);
    setHidden(this.el.countdownOverlay, true);
    setHidden(this.el.lanOverlay, true);
    setHidden(this.el.profileOverlay, true);
    this.refreshMenu();
  }

  hideMenu() {
    setHidden(this.el.menu, true);
  }

  // ---------- 单人 ----------
  showSolo(diffId) {
    this.currentDiff = diffId;
    this.hideMenu();
    this.hideLanUI();
    setHidden(this.el.soloHud, false);
    setHidden(this.el.lanHud, true);
    setHidden(this.el.buffBar, false);
    setHidden(this.el.countdownOverlay, true);
    setHidden(this.el.pauseOverlay, true);
    setHidden(this.el.gameOverOverlay, true);
    this.el.diffChip.textContent = DIFFICULTIES[diffId].name;
    this.el.diffChip.style.color = DIFFICULTIES[diffId].color;
    this.soloCache = { score: null, best: null, combo: null };
    this.buffCache = { shield: null, slow: null, double: null };
  }

  updateSoloHud(game, best) {
    const combo = game.getComboMultiplier();
    if (this.soloCache.score !== game.score) {
      this.soloCache.score = game.score;
      this.el.hudScore.textContent = String(game.score);
    }
    if (this.soloCache.best !== best) {
      this.soloCache.best = best;
      this.el.hudBest.textContent = String(best);
    }
    if (this.soloCache.combo !== combo) {
      this.soloCache.combo = combo;
      const show = combo >= 2;
      setHidden(this.el.comboChip, !show);
      if (show) {
        this.el.comboValue.textContent = String(combo);
        this.el.comboChip.classList.remove('pop');
        void this.el.comboChip.offsetWidth;
        this.el.comboChip.classList.add('pop');
      }
    }
    this.updateBuffs({
      shield: game.buffs.shield,
      slowMs: game.buffs.slowRemaining,
      doubleMs: game.buffs.doubleRemaining,
    });
  }

  updateBuffs(buffs) {
    if (this.buffCache.shield !== buffs.shield) {
      this.buffCache.shield = buffs.shield;
      setHidden(this.el.buffShield, !buffs.shield);
    }
    const slowActive = buffs.slowMs > 0;
    if (this.buffCache.slow !== slowActive) {
      this.buffCache.slow = slowActive;
      setHidden(this.el.buffSlow, !slowActive);
    }
    if (slowActive) {
      this.el.buffSlowTime.textContent = `${(buffs.slowMs / 1000).toFixed(1)}s`;
      this.el.buffSlowBar.style.width = `${Math.min(100, (buffs.slowMs / 8000) * 100)}%`;
    }
    const doubleActive = buffs.doubleMs > 0;
    if (this.buffCache.double !== doubleActive) {
      this.buffCache.double = doubleActive;
      setHidden(this.el.buffDouble, !doubleActive);
    }
    if (doubleActive) {
      this.el.buffDoubleTime.textContent = `${(buffs.doubleMs / 1000).toFixed(1)}s`;
      this.el.buffDoubleBar.style.width = `${Math.min(100, (buffs.doubleMs / 10000) * 100)}%`;
    }
  }

  showSoloPause() { setHidden(this.el.pauseOverlay, false); }
  hideSoloPause() { setHidden(this.el.pauseOverlay, true); }

  showSoloGameOver(result) {
    setHidden(this.el.newRecord, !result.isNewRecord);
    this.el.gameOverTitle.textContent = '游戏结束';
    this.el.resultScore.textContent = String(result.score);
    this.el.resultGrid.innerHTML = `
      <div><span>难度</span><b>${DIFFICULTIES[result.difficulty].name}</b></div>
      <div><span>最高分</span><b>${result.best}</b></div>
      <div><span>蛇身长度</span><b>${result.length}</b></div>
      <div><span>吃到果实</span><b>${result.fruits}</b></div>
      <div><span>最高连击</span><b>×${result.maxCombo}</b></div>
      <div><span>存活时间</span><b>${formatClock(result.durationMs)}</b></div>`;
    setHidden(this.el.gameOverOverlay, false);
  }

  hideSoloGameOver() { setHidden(this.el.gameOverOverlay, true); }

  // ---------- 局域网 ----------
  hideLanUI() {
    setHidden(this.el.lanOverlay, true);
    setHidden(this.el.lanEndOverlay, true);
    setHidden(this.el.lanHud, true);
    setHidden(this.el.lanHud, true);
  }

  showLanSection(name) {
    setHidden(this.el.lanOverlay, false);
    for (const section of ['lanConnecting', 'lanUnavailable', 'lanForm', 'lanLobby']) {
      setHidden(this.el[section], section !== name);
    }
  }

  showLanConnecting() {
    this.hideMenu();
    this.showLanSection('lanConnecting');
  }

  showLanUnavailable(message) {
    this.hideMenu();
    this.showLanSection('lanUnavailable');
    if (message) {
      const tip = this.el.lanUnavailable.querySelector('.lan-tip');
      if (tip) tip.textContent = message;
    }
  }

  showLanForm(defaultName) {
    this.hideMenu();
    this.showLanSection('lanForm');
    this.el.lanName.value = defaultName || '玩家';
    setTimeout(() => this.el.lanName.focus(), 60);
  }

  getSavedName() {
    try { return localStorage.getItem(NAME_STORAGE_KEY) || '玩家'; } catch (err) { return '玩家'; }
  }

  saveName(name) {
    try { localStorage.setItem(NAME_STORAGE_KEY, name); } catch (err) { /* 忽略 */ }
  }

  updateLan(snapshot, selfId) {
    if (!snapshot) return;
    switch (snapshot.phase) {
      case 'lobby':
        this.renderLobby(snapshot, selfId);
        break;
      case 'countdown':
        this.renderCountdown(snapshot, selfId);
        break;
      case 'playing':
        this.enterLanPlaying(snapshot, selfId);
        break;
      case 'ended':
        this.renderLanEnd(snapshot, selfId);
        break;
      default:
        break;
    }
  }

  renderLobby(snapshot, selfId) {
    this.hideMenu();
    setHidden(this.el.lanOverlay, false);
    setHidden(this.el.lanEndOverlay, true);
    setHidden(this.el.lanHud, true);
    setHidden(this.el.countdownOverlay, true);
    for (const section of ['lanConnecting', 'lanUnavailable', 'lanForm']) setHidden(this.el[section], true);
    setHidden(this.el.lanLobby, false);
    this.ensureInvite();

    const signature = JSON.stringify({
      players: snapshot.players.map((p) => [p.id, p.name, p.color]),
      hostId: snapshot.hostId,
      mode: snapshot.mode,
      rhythm: snapshot.rhythm,
      difficulty: snapshot.difficulty,
      selfId,
    });
    if (signature !== this.lobbySignature) {
      this.lobbySignature = signature;
      this.el.lanLobbyCount.textContent = `${snapshot.players.length}/8`;
      setHidden(this.el.lanHostTag, snapshot.hostId !== selfId);
      this.el.lanPlayerList.innerHTML = snapshot.players.map((player) => `
        <div class="lan-player-row ${player.id === snapshot.hostId ? 'host' : ''}">
          <span class="lan-player-dot" style="color:${player.color};background:${player.color}"></span>
          <span class="lan-player-name">${this.escape(player.name)}</span>
          ${player.id === snapshot.hostId ? '<span class="lan-player-badge">房主</span>' : ''}
        </div>`).join('');
      this.el.selMode.value = snapshot.mode;
      this.el.selRhythm.value = snapshot.rhythm;
      this.el.selDifficulty.value = snapshot.difficulty;
    }
    const isHost = snapshot.hostId === selfId;
    this.el.selMode.disabled = !isHost;
    this.el.selRhythm.disabled = !isHost || snapshot.mode === 'lanes';
    this.el.selDifficulty.disabled = !isHost;
    setHidden(this.el.hostConfig, !isHost);
    setHidden(this.el.guestSummary, isHost);
    setHidden(this.el.btnLanStart, !isHost);
    if (!isHost) {
      const mode = MP_MODES[snapshot.mode];
      const rhythm = MP_RHYTHMS[snapshot.rhythm];
      const difficulty = DIFFICULTIES[snapshot.difficulty];
      this.el.guestSummaryText.textContent =
        `${mode ? mode.name : snapshot.mode} · ${rhythm ? rhythm.name : snapshot.rhythm} · ${difficulty ? difficulty.name : snapshot.difficulty}`;
    }
    this.el.lanInviteTitle.textContent = isHost
      ? '邀请朋友加入（同一 Wi-Fi）'
      : '把房间分享给朋友（同一 Wi-Fi）';
    this.el.lanHint.textContent = isHost
      ? '选择玩法与节奏后点击开始'
      : '等待房主开始… 也可以邀请更多朋友';
  }

  async ensureInvite() {
    if (this.inviteReady) return;
    this.inviteReady = true;
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      const info = await res.json();
      const host = location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      let inviteUrl = location.origin;
      if (isLocal) {
        if (info.lanUrls && info.lanUrls.length > 0) {
          inviteUrl = info.lanUrls[0];
        } else {
          this.el.lanUrl.textContent = '未检测到局域网地址，请检查 Wi-Fi 连接';
          setHidden(this.el.lanQr, true);
          setHidden(this.el.btnCopyUrl, true);
          return;
        }
      }
      this.el.lanUrl.textContent = inviteUrl;
      this.el.lanQr.src = `/api/qr?text=${encodeURIComponent(inviteUrl)}`;
      this.el.btnCopyUrl.addEventListener('click', () => this.copyText(inviteUrl));
    } catch (err) {
      this.el.lanUrl.textContent = '邀请信息获取失败';
    }
  }

  copyText(text) {
    const done = () => this.toast('邀请链接已复制', 'hint');
    const fail = () => this.toast('复制失败，请手动选择链接复制', 'error');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done, fail));
      return;
    }
    this.fallbackCopy(text, done, fail);
  }

  fallbackCopy(text, done, fail) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (ok) done();
      else fail();
    } catch (err) {
      fail();
    }
  }

  renderCountdown(snapshot, selfId) {
    setHidden(this.el.lanOverlay, true);
    setHidden(this.el.lanEndOverlay, true);
    setHidden(this.el.lanHud, true);
    setHidden(this.el.countdownOverlay, false);
    const seconds = Math.max(1, Math.ceil(snapshot.countdownLeftMs / 1000));
    if (this.el.countdownText.textContent !== String(seconds)) {
      this.el.countdownText.textContent = String(seconds);
    }
  }

  enterLanPlaying(snapshot, selfId) {
    if (this.lanCache.phase !== 'playing') {
      this.lanCache.phase = 'playing';
      this.lanCache.boardSignature = '';
      setHidden(this.el.lanOverlay, true);
      setHidden(this.el.lanEndOverlay, true);
      setHidden(this.el.countdownOverlay, true);
      setHidden(this.el.lanHud, false);
      setHidden(this.el.buffBar, false);
      this.buffCache = { shield: null, slow: null, double: null };
      this.toast('对局开始！', 'hint');
    }
    this.updateLanHud(snapshot, selfId);
  }

  updateLanHud(snapshot, selfId) {
    const me = snapshot.players.find((p) => p.id === selfId);

    const timerText = snapshot.timeLeftMs == null ? '生存' : formatClock(snapshot.timeLeftMs);
    if (this.lanCache.timer !== timerText) {
      this.lanCache.timer = timerText;
      this.el.lanTimer.textContent = timerText;
    }
    const modeText = `${MP_MODES[snapshot.mode].name} · ${MP_RHYTHMS[snapshot.rhythm].name} · ${DIFFICULTIES[snapshot.difficulty].name}`;
    if (this.lanCache.mode !== modeText) {
      this.lanCache.mode = modeText;
      this.el.lanModeChip.textContent = modeText;
    }

    const sorted = [...snapshot.players].sort((a, b) => b.score - a.score);
    const boardSignature = sorted.map((p) => `${p.id}:${p.score}:${p.alive ? 1 : 0}`).join('|');
    if (boardSignature !== this.lanCache.boardSignature) {
      this.lanCache.boardSignature = boardSignature;
      this.el.lanBoard.innerHTML = sorted.map((player) => `
        <div class="lan-board-row ${player.id === selfId ? 'me' : ''} ${player.alive ? '' : 'dead'}">
          <span class="lan-board-dot" style="color:${player.color};background:${player.color}"></span>
          <span class="lan-board-name">${this.escape(player.name)}</span>
          <span class="lan-board-score">${player.score}</span>
        </div>`).join('');
    }

    const showRespawn = me && !me.alive && snapshot.rhythm === 'timed' && me.respawnInMs > 0;
    if (showRespawn) {
      const seconds = Math.max(1, Math.ceil(me.respawnInMs / 1000));
      if (this.lanCache.respawn !== String(seconds)) {
        this.lanCache.respawn = String(seconds);
        this.el.lanRespawnSec.textContent = String(seconds);
      }
    }
    setHidden(this.el.lanRespawn, !showRespawn);

    if (me) {
      this.updateBuffs({
        shield: me.buffs.shield || me.buffs.shieldPhaseMs > 0,
        slowMs: me.buffs.slowMs,
        doubleMs: me.buffs.doubleMs,
      });
    }
    this.drawMinimap(snapshot, selfId);
  }

  drawMinimap(snapshot, selfId) {
    const canvas = this.el.minimap;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const pad = 8;
    const grid = snapshot.grid || 44;
    const scale = (width - pad * 2) / grid;
    ctx.clearRect(0, 0, width, width);
    ctx.fillStyle = 'rgba(30, 55, 130, 0.16)';
    ctx.fillRect(pad, pad, grid * scale, grid * scale);
    ctx.strokeStyle = 'rgba(79, 123, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, pad + 0.5, grid * scale - 1, grid * scale - 1);

    const dot = (x, y, color, radius) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pad + (x + 0.5) * scale, pad + (y + 0.5) * scale, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    let foods = [];
    if (snapshot.mode === 'lanes') {
      const me = snapshot.players.find((p) => p.id === selfId);
      foods = me && me.foods ? me.foods : [];
    } else {
      foods = snapshot.foods || [];
    }
    for (const food of foods) {
      const def = FOOD_DEFS[food.type] || FOOD_DEFS.normal;
      dot(food.x, food.y, def.color, 2.2);
    }

    for (const player of snapshot.players) {
      if (!player.alive || !player.segments || player.segments.length === 0) continue;
      if (snapshot.mode === 'lanes' && player.id !== selfId) continue;
      const head = player.segments[0];
      if (player.id === selfId) {
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pad + (head[0] + 0.5) * scale, pad + (head[1] + 0.5) * scale, 4.5, 0, Math.PI * 2);
        ctx.stroke();
        dot(head[0], head[1], '#ffffff', 2.2);
      } else {
        dot(head[0], head[1], player.color, 3);
      }
    }
  }

  renderLanEnd(snapshot, selfId) {
    setHidden(this.el.lanHud, true);
    setHidden(this.el.lanRespawn, true);
    setHidden(this.el.buffBar, true);
    setHidden(this.el.countdownOverlay, true);
    setHidden(this.el.lanOverlay, true);
    setHidden(this.el.lanEndOverlay, false);

    const signature = JSON.stringify({ ranking: snapshot.ranking, selfId, hostId: snapshot.hostId });
    if (signature !== this.endSignature) {
      this.endSignature = signature;
      const isWinner = snapshot.winnerId === selfId;
      setHidden(this.el.lanWinBanner, !isWinner);
      this.el.lanRanking.innerHTML = snapshot.ranking.map((row) => `
        <div class="rank-row ${row.rank === 1 ? 'first' : ''} ${row.id === selfId ? 'me' : ''}">
          <span class="rank-no">${row.rank}</span>
          <span class="lan-player-dot" style="color:${row.color};background:${row.color}"></span>
          <span class="rank-name">${this.escape(row.name)}</span>
          ${snapshot.rhythm === 'survival' && !row.alive ? '<span class="rank-dead">已淘汰</span>' : ''}
          <span class="rank-score">${row.score}</span>
        </div>`).join('');
      const isHost = snapshot.hostId === selfId;
      setHidden(this.el.btnLanAgain, !isHost);
      this.el.lanEndHint.textContent = isHost ? '再来一局会立即开始新对局' : '等待房主开始下一局…';
    }
    this.lanCache.phase = 'ended';
  }

  // ---------- 个人资料 ----------
  showProfile() {
    this.profileDraft = { ...this.state.profile };
    this.el.profileName.value = this.profileDraft.name;
    this.renderProfilePickers();
    this.refreshProfilePreview();
    const stats = this.state.stats;
    this.el.profileStats.textContent =
      `单机 ${stats.games} 局 · 联机 ${stats.mpGames || 0} 局 · 联机胜场 ${stats.mpWins || 0} · 成就 ${this.state.achievements.length}/${ACHIEVEMENTS.length}`;
    setHidden(this.el.profileOverlay, false);
  }

  hideProfile() { setHidden(this.el.profileOverlay, true); }

  renderProfilePickers() {
    this.el.avatarPicker.innerHTML = AVATARS.map((avatar) =>
      `<button class="avatar-btn ${avatar === this.profileDraft.avatar ? 'sel' : ''}" data-avatar="${avatar}">${avatar}</button>`).join('');
    for (const btn of this.el.avatarPicker.querySelectorAll('[data-avatar]')) {
      btn.addEventListener('click', () => {
        this.profileDraft.avatar = btn.dataset.avatar;
        this.renderProfilePickers();
        this.refreshProfilePreview();
      });
    }
    this.el.colorPicker.innerHTML = PLAYER_COLORS.map((color) =>
      `<button class="color-swatch ${color === this.profileDraft.color ? 'sel' : ''}" data-color="${color}" style="background:${color};color:${color}"></button>`).join('');
    for (const btn of this.el.colorPicker.querySelectorAll('[data-color]')) {
      btn.addEventListener('click', () => {
        this.profileDraft.color = btn.dataset.color;
        this.renderProfilePickers();
        this.refreshProfilePreview();
      });
    }
  }

  refreshProfilePreview() {
    const name = (this.el.profileName.value || '玩家').trim().slice(0, 8) || '玩家';
    this.el.profileAvatarPreview.textContent = this.profileDraft.avatar;
    this.el.profileNamePreview.textContent = name;
    this.el.profileAvatarPreview.style.borderColor = this.profileDraft.color;
    this.el.profileAvatarPreview.style.boxShadow = `0 0 14px ${this.profileDraft.color}55`;
  }

  saveProfile() {
    const name = (this.el.profileName.value || '').trim().slice(0, 8) || '玩家';
    const profile = { name, avatar: this.profileDraft.avatar, color: this.profileDraft.color };
    this.state.profile = { ...profile };
    this.handlers.onSaveProfile(profile);
    this.hideProfile();
    this.toast('个人资料已保存', 'hint');
  }

  // ---------- 成就 / 设置 / 玩法 ----------
  showAchievements() {
    const unlocked = new Set(this.state.achievements);
    this.el.achCount.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    this.el.achList.innerHTML = ACHIEVEMENTS.map((a) => {
      const done = unlocked.has(a.id);
      return `<div class="ach-item ${done ? 'done' : ''}">
        <span class="ach-mark">${done ? '✓' : '·'}</span>
        <span class="ach-text"><b>${a.name}</b><i>${a.desc}</i></span>
      </div>`;
    }).join('');
    setHidden(this.el.achievementsOverlay, false);
  }
  hideAchievements() { setHidden(this.el.achievementsOverlay, true); }

  showSettings() { this.applySettings(); setHidden(this.el.settingsOverlay, false); }
  hideSettings() { setHidden(this.el.settingsOverlay, true); }
  showHelp() { setHidden(this.el.helpOverlay, false); }
  hideHelp() { setHidden(this.el.helpOverlay, true); }

  anyOverlayOpen() {
    return ['achievementsOverlay', 'settingsOverlay', 'helpOverlay', 'profileOverlay']
      .some((id) => !this.el[id].classList.contains('hidden'));
  }

  closeTopOverlays() {
    this.hideAchievements();
    this.hideSettings();
    this.hideHelp();
    this.hideProfile();
  }

  setFlash(alpha, color) {
    this.el.flashLayer.style.background = color || '#ffffff';
    this.el.flashLayer.style.opacity = String(Math.min(0.6, Math.max(0, alpha)));
  }

  toast(text, kind = 'info') {
    const layer = this.el.toastLayer;
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    layer.appendChild(node);
    while (layer.children.length > 3) layer.removeChild(layer.firstChild);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 350);
    }, 2200);
  }

  escape(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}