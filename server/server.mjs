// 局域网房间服务器：零依赖。托管游戏页面 + SSE 实时快照 + 权威模拟。
// 启动：node server/server.mjs [端口]（默认 8787）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Arena } from '../src/mp/arena.js';
import { MP } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || MP.port);
const TICK_MS = MP.tickMs;
const BROADCAST_MS = MP.snapshotMs;
const SESSION_TIMEOUT_MS = 12000;

const arena = new Arena({ mode: 'race', rhythm: 'timed', difficulty: 'classic' });
const sessions = new Map(); // token -> { playerId, res, lastSeen }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function getSession(pid, token) {
  if (typeof token !== 'string') return null;
  const session = sessions.get(token);
  if (!session || session.playerId !== pid) return null;
  const player = arena.players.get(pid);
  if (!player) return null;
  return session;
}

function lanUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}`);
      }
    }
  }
  return urls;
}

function broadcastNow() {
  const payload = JSON.stringify({ snapshot: arena.snapshot(), events: arena.drainEvents() });
  const frame = `data: ${payload}\n\n`;
  for (const session of sessions.values()) {
    if (!session.res) continue;
    try {
      session.res.write(frame);
    } catch (err) {
      /* 连接已断，等待清理 */
    }
  }
}

function removePlayerByToken(token) {
  const session = sessions.get(token);
  if (!session) return;
  sessions.delete(token);
  if (session.res) {
    try { session.res.end(); } catch (err) { /* 已关闭 */ }
  }
  arena.removePlayer(session.playerId);
}

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(ROOT, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (urlPath === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('尚未构建页面：请先运行 python tools/build_single.py（或用 dev.html 开发模式）');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      version: 1,
      grid: MP.grid,
      maxPlayers: MP.maxPlayers,
      players: arena.players.size,
      phase: arena.phase,
    });
  }

  if (pathname === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const result = arena.addPlayer(body.name, body.avatar, body.color);
    if (result.error) return sendJson(res, 400, { error: result.error });
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, { playerId: result.id, res: null, lastSeen: Date.now() });
    console.log(`[join] ${result.player.name} (${result.id}) 共 ${arena.players.size} 人`);
    broadcastNow();
    return sendJson(res, 200, {
      ok: true,
      token,
      playerId: result.id,
      snapshot: arena.snapshot(),
    });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    const session = getSession(pid, token);
    if (!session) return sendJson(res, 401, { error: '会话无效，请重新加入' });
    session.lastSeen = Date.now();
    session.res = res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    res.write(`data: ${JSON.stringify({ snapshot: arena.snapshot(), events: arena.drainEvents() })}\n\n`);
    req.on('close', () => {
      if (sessions.get(token) === session) {
        removePlayerByToken(token);
        console.log(`[leave] ${pid} 连接断开，房间剩 ${arena.players.size} 人`);
      }
    });
    return;
  }

  if (pathname === '/api/input' && req.method === 'POST') {
    const body = await readBody(req);
    const session = getSession(body.pid, body.token);
    if (!session) return sendJson(res, 401, { error: '会话无效' });
    session.lastSeen = Date.now();
    const accepted = arena.queueDirection(body.pid, body.dir);
    return sendJson(res, 200, { ok: accepted });
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const session = getSession(body.pid, body.token);
    if (!session) return sendJson(res, 401, { error: '会话无效' });
    session.lastSeen = Date.now();
    if (arena.hostId() !== body.pid) return sendJson(res, 403, { error: '只有房主可以修改配置' });
    const changed = arena.setMode({ mode: body.mode, rhythm: body.rhythm, difficulty: body.difficulty });
    if (!changed) return sendJson(res, 400, { error: '对局进行中无法修改' });
    broadcastNow();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/start' && req.method === 'POST') {
    const body = await readBody(req);
    const session = getSession(body.pid, body.token);
    if (!session) return sendJson(res, 401, { error: '会话无效' });
    session.lastSeen = Date.now();
    const result = arena.start(body.pid);
    if (result.error) return sendJson(res, 400, { error: result.error });
    broadcastNow();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/ping' && req.method === 'POST') {
    const body = await readBody(req);
    const session = getSession(body.pid, body.token);
    if (!session) return sendJson(res, 401, { error: '会话无效' });
    session.lastSeen = Date.now();
    arena.touch(body.pid);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/leave' && req.method === 'POST') {
    const body = await readBody(req);
    const session = getSession(body.pid, body.token);
    if (session) {
      removePlayerByToken(body.token);
      console.log(`[leave] ${body.pid} 主动离开，房间剩 ${arena.players.size} 人`);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[error]', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
    else res.end();
  });
});

let lastBroadcast = 0;
let lastPrune = 0;
setInterval(() => {
  const now = Date.now();
  arena.update(TICK_MS);
  if (now - lastBroadcast >= BROADCAST_MS) {
    lastBroadcast = now;
    broadcastNow();
  }
  if (now - lastPrune >= 2000) {
    lastPrune = now;
    for (const [token, session] of sessions) {
      if (now - session.lastSeen > SESSION_TIMEOUT_MS) {
        removePlayerByToken(token);
        console.log(`[timeout] ${session.playerId} 心跳超时，移出房间`);
      }
    }
  }
}, TICK_MS);

// 每个广播周期给 SSE 写一个注释帧，避免中间层超时
setInterval(() => {
  for (const session of sessions.values()) {
    if (!session.res) continue;
    try { session.res.write(': keep-alive\n\n'); } catch (err) { /* closed */ }
  }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  霓虹贪吃蛇 3D · 局域网房间');
  console.log('  ---------------------------');
  console.log(`  本机访问:   http://localhost:${PORT}`);
  const urls = lanUrls(PORT);
  for (const url of urls) console.log(`  局域网访问: ${url}`);
  if (urls.length === 0) console.log('  未找到局域网 IPv4 地址，请检查网络连接');
  console.log('  同一 Wi-Fi / 局域网内的朋友用上面的地址打开即玩');
  console.log('  按 Ctrl+C 关闭服务器');
  console.log('');
});