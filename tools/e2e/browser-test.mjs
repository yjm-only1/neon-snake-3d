// 3D 浏览器验收：node tools/e2e/browser-test.mjs
// 覆盖：WebGL 场景加载 / 个人资料保存 / 单人开局与移动 / 结算 / 截图
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9350;
const PROFILE_DIR = path.join(ROOT, 'Temp', 'chrome-3d-profile');
const URL = process.env.GAME_URL || ('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'));
const SHOTS = path.join(ROOT, 'Temp');
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
    } catch (err) { /* 页面尚未就绪 */ }
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
  await sleep(260);
}

async function shot(cdp, name) {
  const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data.data, 'base64'));
  console.log('  · 截图', name);
}

async function main() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--hide-scrollbars',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1080,1920', URL,
  ], { stdio: 'ignore' });

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && !t.url.startsWith('about:'));
      } catch (err) { /* wait */ }
      if (!target) await sleep(200);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1200);

    console.log('1. 页面与 WebGL');
    ok(await waitFor(cdp, 'document.querySelectorAll("[data-diff]").length === 3'), '主菜单生成 3 张难度卡');
    const webgl = await evaluate(cdp, '!!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl")');
    ok(webgl, '浏览器支持 WebGL');
    await shot(cdp, 'menu-3d.png');

    console.log('2. 个人资料');
    await clickReal(cdp, '#btnProfile');
    ok(await evaluate(cdp, '!document.getElementById("profileOverlay").classList.contains("hidden")'), '个人资料面板打开');
    await evaluate(cdp, `(() => {
      const input = document.getElementById('profileName');
      input.value = '小明';
      input.dispatchEvent(new Event('input'));
    })()`);
    await clickReal(cdp, '[data-avatar="🦊"]');
    await clickReal(cdp, '[data-color="#39d98a"]');
    await shot(cdp, 'profile-3d.png');
    await clickReal(cdp, '#btnProfileSave');
    const profile = JSON.parse(await evaluate(cdp, 'localStorage.getItem("neonSnake3D.v1")')).profile;
    ok(profile.name === '小明', '昵称保存', profile.name);
    ok(profile.avatar === '🦊', '头像保存', profile.avatar);
    ok(profile.color === '#39d98a', '颜色保存', profile.color);

    console.log('3. 单人 3D 对局');
    await clickReal(cdp, '[data-diff="classic"]');
    ok(await evaluate(cdp, '!document.getElementById("soloHud").classList.contains("hidden")'), 'HUD 显示');
    ok(await evaluate(cdp, 'window.__neonSnake3D.getMode()') === 'solo', '进入单人模式');
    await sleep(900);
    const elapsed = await evaluate(cdp, 'window.__neonSnake3D.getGame().elapsed');
    ok(elapsed > 500, '模拟推进（蛇在移动）', `elapsed=${elapsed}`);
    await shot(cdp, 'game-3d-mobile.png');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await shot(cdp, 'game-3d-desktop.png');

    console.log('4. 死亡与结算');
    await evaluate(cdp, 'window.__neonSnake3D.getGame().die("wall")');
    ok(await waitFor(cdp, '!document.getElementById("gameOverOverlay").classList.contains("hidden")', 5000), '结算面板弹出');
    const best = JSON.parse(await evaluate(cdp, 'localStorage.getItem("neonSnake3D.v1")')).bests.classic;
    ok(best >= 0, '最高分已写入', `best=${best}`);
    await shot(cdp, 'gameover-3d.png');

    const errs = cdp.errors.filter((e) => !/favicon/i.test(e));
    ok(errs.length === 0, '无页面运行时异常', errs.join(' | ').slice(0, 300));

    console.log(`\n结果：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (err) { /* done */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });