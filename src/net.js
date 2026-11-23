// 局域网联机客户端：HTTP API + SSE 快照流
export class NetClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.pid = null;
    this.token = null;
    this.snapshot = null;
    this.prevSnapshot = null;
    this.lastArrival = 0;
    this.snapshotInterval = 66;
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
      if (delta > 24 && delta < 500) this.snapshotInterval = delta;
    }
    this.snapshot = snapshot;
    this.lastArrival = now;
    if (this.handlers.onSnapshot) this.handlers.onSnapshot(snapshot);
  }

  // 渲染插值系数：0=上一快照，1=最新快照
  getInterpolation() {
    if (!this.prevSnapshot) return 1;
    const t = (performance.now() - this.lastArrival) / this.snapshotInterval;
    return Math.max(0, Math.min(1, t));
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
    this.events = [];
  }
}