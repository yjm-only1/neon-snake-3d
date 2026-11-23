// 局域网联机客户端：HTTP API + SSE 快照流
export class NetClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.pid = null;
    this.token = null;
    this.snapshot = null;
    this.prevSnapshot = null;
    this.lastArrival = 0;
    this.snapshotInterval = 50;
    this.frames = [];
    this.events = [];
    this.source = null;
    this.pingTimer = null;
    this.joined = false;
    this.leaving = false;
  }

  static async probe() {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.ok ? data : null;
    } catch (err) {
      return null;
    }
  }

  async post(pathname, body, keepalive = false) {
    const res = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      keepalive,
    });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async join(name, profile = {}) {
    const res = await this.post('/api/join', {
      name,
      avatar: profile.avatar,
      color: profile.color,
    });
    if (!res.ok || !res.data) {
      throw new Error((res.data && res.data.error) || '加入房间失败');
    }
    this.pid = res.data.playerId;
    this.token = res.data.token;
    this.joined = true;
    this.leaving = false;
    if (res.data.snapshot) this.applySnapshot(res.data.snapshot);
    this.openEvents();
    this.pingTimer = setInterval(() => this.ping(), 3000);
    return res.data;
  }

  openEvents() {
    if (this.source) this.source.close();
    const url = `/api/events?pid=${encodeURIComponent(this.pid)}&token=${encodeURIComponent(this.token)}`;
    const source = new EventSource(url);
    source.onmessage = (event) => {
      let payload = null;
      try { payload = JSON.parse(event.data); } catch (err) { return; }
      if (payload && payload.snapshot) this.applySnapshot(payload.snapshot);
      if (payload && Array.isArray(payload.events) && payload.events.length > 0) {
        this.events.push(...payload.events);
        if (this.handlers.onEvents) this.handlers.onEvents(payload.events);
      }
    };
    source.onerror = () => {
      if (this.leaving) return;
      if (this.handlers.onDisconnected) this.handlers.onDisconnected();
    };
    this.source = source;
  }

  applySnapshot(snapshot) {
    const now = performance.now();
    if (this.snapshot) {
      this.prevSnapshot = this.snapshot;
      const delta = now - this.lastArrival;
      if (delta > 16 && delta < 500) this.snapshotInterval = delta;
    }
    this.snapshot = snapshot;
    this.lastArrival = now;
    this.frames.push({ snapshot, at: now });
    if (this.frames.length > 6) this.frames.shift();
    if (this.handlers.onSnapshot) this.handlers.onSnapshot(snapshot);
  }

  // 双快照按时间插值：渲染时刻落后最新快照一个“渲染延迟”，
  // 快照到达抖动不会直接变成画面抖动；落后时用最新帧按速度短距离外推。
  getRenderFrame(now) {
    const frames = this.frames;
    if (frames.length === 0) return null;
    const delay = Math.min(140, Math.max(60, this.snapshotInterval * 1.8 + 8));
    const renderTime = now - delay;
    let a = frames[0];
    let b = frames[0];
    if (frames.length > 1) {
      a = frames[frames.length - 2];
      b = frames[frames.length - 1];
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].at >= renderTime) {
          a = frames[i - 1];
          b = frames[i];
          break;
        }
      }
    }
    let alpha = 1;
    if (b.at > a.at) {
      alpha = Math.max(0, Math.min(1, (renderTime - a.at) / (b.at - a.at)));
    }
    let extraSec = 0;
    if (renderTime > b.at) extraSec = Math.min(0.1, (renderTime - b.at) / 1000);
    if (renderTime < a.at) {
      a = frames[0];
      b = frames[0];
      alpha = 1;
      extraSec = 0;
    }
    return { a: a.snapshot, b: b.snapshot, alpha, extraSec };
  }

  drainEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  async ping() {
    if (!this.joined || this.leaving) return;
    try {
      const res = await this.post('/api/ping', { pid: this.pid, token: this.token });
      if (res.status === 401) this.handlers.onDisconnected && this.handlers.onDisconnected();
    } catch (err) { /* 网络抖动忽略 */ }
  }

  sendDirection(dir) {
    if (!this.joined || this.leaving) return;
    this.post('/api/input', { pid: this.pid, token: this.token, dir }).catch(() => {});
  }

  async setConfig(partial) {
    return this.post('/api/config', {
      pid: this.pid,
      token: this.token,
      mode: partial.mode,
      rhythm: partial.rhythm,
      difficulty: partial.difficulty,
    });
  }

  async start() {
    return this.post('/api/start', { pid: this.pid, token: this.token });
  }

  async leave() {
    if (!this.pid) return;
    this.leaving = true;
    try {
      await this.post('/api/leave', { pid: this.pid, token: this.token }, true);
    } catch (err) { /* 关闭页面时允许失败 */ }
    this.cleanup();
  }

  cleanup() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.joined = false;
    this.pid = null;
    this.token = null;
    this.snapshot = null;
    this.prevSnapshot = null;
    this.frames.length = 0;
    this.events = [];
  }
}