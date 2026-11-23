// 局域网联机浏览器验收：node tools/e2e/lan-browser-test.mjs
// 流程：起服务器 → 浏览器进房间 → 第二名玩家 HTTP 加入 → 房主改配置并开局 → 对局中截图
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8901;
const DEBUG_PORT = 9351;
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE_DIR = path.join(ROOT, 'Temp', 'chrome-lan-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch (err) { /* 等待页面 */ }
    await sleep(200);
  }
  return false;
}

async function clickReal(cdp, selector) {
  const rect = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) throw new Error('找不到元素: ' + selector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(300);
}

async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'Temp'), { recursive: true });

  const server = spawn(process.execPath, ['server/server.mjs', String(PORT), '--no-open'], { cwd: ROOT, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--hide-scrollbars',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1280,800', `${BASE}/`,
  ], { stdio: 'ignore' });

  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      try { ready = (await fetch(`${BASE}/api/config`)).ok; } catch (err) { /* wait */ }
      if (!ready) await sleep(200);
    }
    ok(ready, '房间服务器就绪');

    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && !t.url.startsWith('about:'));
      } catch (err) { /* wait */ }
      if (!target) await sleep(200);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    ok(await waitFor(cdp, 'document.querySelectorAll("[data-diff]").length === 3'), '游戏页从局域网服务器加载');

    console.log('2. 进入房间');
    await clickReal(cdp, '#btnLan');
    ok(await waitFor(cdp, '!document.getElementById("lanForm").classList.contains("hidden")', 5000), '检测到服务器并显示加入表单');
    await evaluate(cdp, `(() => {
      const input = document.getElementById('lanName');
      input.value = '小花';
      input.dispatchEvent(new Event('input'));
    })()`);
    await clickReal(cdp, '#btnLanJoin');
    ok(await waitFor(cdp, '!document.getElementById("lanLobby").classList.contains("hidden")', 5000), '加入房间并进入大厅');

    const second = await api('/api/join', { name: '阿强', avatar: '🐼', color: '#ff9f43' });
    ok(second.status === 200, '第二名玩家加入');
    ok(await waitFor(cdp, 'document.querySelectorAll(".lan-player-row").length === 2', 5000), '大厅显示两名玩家');
    ok(await waitFor(cdp, 'document.getElementById("lanQr").src.includes("/api/qr")', 5000), '大厅显示邀请二维码');
    ok(await evaluate(cdp, 'document.getElementById("lanUrl").textContent.startsWith("http")'), '大厅显示邀请地址');

    console.log('3. 房主配置与开局');
    await evaluate(cdp, `(() => {
      const set = (id, value) => {
        const el = document.getElementById(id);
        el.value = value;
        el.dispatchEvent(new Event('change'));
      };
      set('selMode', 'battle');
      set('selRhythm', 'timed');
      set('selDifficulty', 'classic');
    })()`);
    await sleep(600);
    ok(await evaluate(cdp, 'window.__neonSnake3D.getSnapshot().mode') === 'battle', '服务端已切换为同场对抗');
    await clickReal(cdp, '#btnLanStart');
    ok(await waitFor(cdp, '!document.getElementById("countdownOverlay").classList.contains("hidden")', 4000), '显示 5 秒倒计时');
    ok(await waitFor(cdp, 'window.__neonSnake3D.getSnapshot() && window.__neonSnake3D.getSnapshot().phase === "playing"', 12000), '倒计时结束进入对局');
    ok(await waitFor(cdp, '!document.getElementById("lanHud").classList.contains("hidden")', 3000), '联机 HUD 显示');
    const snap = await evaluate(cdp, 'window.__neonSnake3D.getSnapshot()');
    ok(snap.players.length === 2, '快照包含两名玩家');
    ok(snap.timeLeftMs > 0, '快照包含计时');
    ok(await evaluate(cdp, 'document.querySelectorAll("#lanBoard .lan-board-row").length === 2'), '排行榜显示两人');

    console.log('4. 操作与截图');
    await evaluate(cdp, 'window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }))');
    await sleep(700);
    const dir = await evaluate(cdp, `(() => {
      const snap = window.__neonSnake3D.getSnapshot();
      const me = snap.players.find((p) => p.id === window.__neonSnake3D.getSelfId());
      return me ? me.dir.join(',') : '';
    })()`);
    ok(dir !== '1,0', '转向指令已被服务端执行', `dir=${dir}`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'Temp', 'lan-battle-3d.png'), Buffer.from(shot.data, 'base64'));
    console.log('  · 截图 lan-battle-3d.png');

    const errs = cdp.errors.filter((e) => !/favicon/i.test(e));
    ok(errs.length === 0, '无页面运行时异常', errs.join(' | ').slice(0, 300));

    console.log('5. 离开房间');
    await clickReal(cdp, '#btnLanLeave');
    ok(await waitFor(cdp, '!document.getElementById("menu").classList.contains("hidden")', 4000), '返回主菜单');
    await sleep(400);
    const config = await (await fetch(`${BASE}/api/config`)).json();
    ok(config.players === 1, '服务器房间只剩第二名玩家', `players=${config.players}`);

    console.log(`\n结果：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (err) { /* done */ }
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (err) { /* done */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });