// 局域网服务器集成测试：node tools/e2e/server-test.mjs
// 覆盖：建房/加入/配置/开局/输入/快照广播/离开
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json() };
}

class SseClient {
  constructor(url) {
    this.url = url;
    this.snapshots = [];
    this.events = [];
    this.buffer = '';
    this.controller = new AbortController();
  }

  async start() {
    this.response = await fetch(this.url, { signal: this.controller.signal });
    if (!this.response.ok) throw new Error('SSE 连接失败 ' + this.response.status);
    this.reader = this.response.body.getReader();
    this.decoder = new TextDecoder();
    this.loop = this.readLoop();
    return this;
  }

  async readLoop() {
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        let index;
        while ((index = this.buffer.indexOf('\n\n')) >= 0) {
          const frame = this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.snapshot) this.snapshots.push(payload.snapshot);
              if (Array.isArray(payload.events)) this.events.push(...payload.events);
            } catch (err) { /* 忽略非 JSON 帧 */ }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('SSE 读取出错:', err.message);
    }
  }

  latest() {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  stop() {
    this.controller.abort();
  }
}

async function waitFor(fn, timeoutMs = 10000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(interval);
  }
  return false;
}

async function main() {
  const server = spawn(process.execPath, ['server/server.mjs', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  try {
    const ready = await waitFor(async () => {
      try {
        const res = await fetch(BASE + '/api/config');
        return res.ok;
      } catch (err) { return false; }
    }, 8000);
    ok(ready, '服务器启动并可访问 /api/config');
    const config = await (await fetch(BASE + '/api/config')).json();
    ok(config.ok === true && config.maxPlayers >= 2, '配置接口返回房间信息');

    console.log('2. 加入房间');
    const p1 = await api('/api/join', { name: '小明' });
    const p2 = await api('/api/join', { name: '小红' });
    ok(p1.status === 200 && p1.data.playerId, '玩家 1 加入成功');
    ok(p2.status === 200 && p2.data.playerId, '玩家 2 加入成功');
    ok(p2.data.snapshot.players.length === 2, '加入后房间快照包含两名玩家');
    ok(p1.data.snapshot.hostId === p1.data.playerId, '先加入者为房主');

    const sse1 = await new SseClient(`${BASE}/api/events?pid=${p1.data.playerId}&token=${p1.data.token}`).start();
    const sse2 = await new SseClient(`${BASE}/api/events?pid=${p2.data.playerId}&token=${p2.data.token}`).start();
    await sleep(400);
    ok(sse1.latest() && sse1.latest().players.length === 2, 'SSE 收到包含两名玩家的快照');
    ok(sse2.latest() !== null, '第二名玩家 SSE 也收到快照');

    console.log('3. 房主配置与开局');
    const deny = await api('/api/config', {
      pid: p2.data.playerId, token: p2.data.token,
      mode: 'battle', rhythm: 'timed', difficulty: 'classic',
    });
    ok(deny.status === 403, '非房主不能改配置');
    const cfg = await api('/api/config', {
      pid: p1.data.playerId, token: p1.data.token,
      mode: 'battle', rhythm: 'timed', difficulty: 'classic',
    });
    ok(cfg.status === 200, '房主修改配置成功');
    await sleep(200);
    ok(sse1.latest().mode === 'battle', '快照反映新模式');

    const startRes = await api('/api/start', { pid: p1.data.playerId, token: p1.data.token });
    ok(startRes.status === 200, '房主开局成功');
    const inCountdown = await waitFor(() => sse1.latest() && sse1.latest().phase === 'countdown', 3000);
    ok(inCountdown, '进入 5 秒倒计时');
    const playing = await waitFor(() => sse1.latest() && sse1.latest().phase === 'playing', 8000);
    ok(playing, '倒计时结束进入对局');

    console.log('4. 输入与移动');
    const before = sse1.latest().players.find((p) => p.id === p1.data.playerId);
    const beforeHead = before.segments[0];
    await api('/api/input', { pid: p1.data.playerId, token: p1.data.token, dir: 'up' });
    const moved = await waitFor(() => {
      const snap = sse1.latest();
      if (!snap) return false;
      const me = snap.players.find((p) => p.id === p1.data.playerId);
      return me && me.segments[0] && (me.segments[0][0] !== beforeHead[0] || me.segments[0][1] !== beforeHead[1]);
    }, 3000);
    ok(moved, '服务端执行转向并广播新位置');

    const reverse = await api('/api/input', { pid: p1.data.playerId, token: p1.data.token, dir: 'down' });
    ok(reverse.data.ok === false, '服务端拒绝 180° 反转');

    console.log('5. 离开与清理');
    const leave = await api('/api/leave', { pid: p2.data.playerId, token: p2.data.token });
    ok(leave.status === 200, '玩家 2 主动离开');
    const left = await waitFor(() => {
      const snap = sse1.latest();
      return snap && snap.players.length === 1;
    }, 3000);
    ok(left, '快照中玩家已移除');
    sse1.stop();
    sse2.stop();

    console.log(`\n结果：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (err) { /* done */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });