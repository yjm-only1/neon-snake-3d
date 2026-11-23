// 手机浏览器验收：node tools/e2e/mobile-test.mjs
// 覆盖：移动端视口 / 触屏识别 / 方向键显示 / 点击转向
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9352;
const PROFILE_DIR = path.join(ROOT, 'Temp', 'chrome-mobile-profile');
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
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
    } catch (err) { /* wait */ }
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


async function dragJoystick(cdp, dx, dy) {
  const rect = await evaluate(cdp, `(() => {
    const el = document.getElementById('joystick');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  })()`);
  if (!rect) throw new Error('找不到摇杆');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.cx, y: rect.cy });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.cx, y: rect.cy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.cx + dx, y: rect.cy + dy });
  await sleep(400);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.cx + dx, y: rect.cy + dy, button: 'left', clickCount: 1 });
  await sleep(150);
}

async function main() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--hide-scrollbars',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`,
    URL,
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.reload');
    await sleep(1400);

    console.log('1. 移动端加载');
    ok(await waitFor(cdp, 'document.querySelectorAll("[data-diff]").length === 3'), '手机视口下正常生成菜单');
    ok(await evaluate(cdp, 'document.body.classList.contains("touch-device")'), '识别为触屏设备');

    console.log('2. 触屏摇杆');
    await clickReal(cdp, '[data-diff="classic"]');
    ok(await waitFor(cdp, '!document.getElementById("soloHud").classList.contains("hidden")'), '进入对局');
    ok(await evaluate(cdp, 'document.getElementById("joystick").classList.contains("visible")'), '摇杆显示');
    ok(await evaluate(cdp, 'getComputedStyle(document.getElementById("joystick")).display') !== 'none', '摇杆可见');
    await dragJoystick(cdp, 0, -50);
    const heading = await evaluate(cdp, 'window.__neonSnake3D.getGame().heading');
    ok(Math.abs(heading + Math.PI / 2) < 0.35, '摇杆向上转向成功', `heading=${heading}`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.join(ROOT, 'Temp'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'Temp', 'game-3d-mobile-joystick.png'), Buffer.from(shot.data, 'base64'));
    console.log('  · 截图 game-3d-mobile-joystick.png');

    console.log('3. 横屏适配');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.reload');
    await sleep(1200);
    ok(await waitFor(cdp, 'document.querySelectorAll("[data-diff]").length === 3'), '横屏菜单正常加载');
    ok(await evaluate(cdp, 'document.body.classList.contains("touch-device")'), '横屏仍识别触屏');
    await clickReal(cdp, '[data-diff="classic"]');
    ok(await waitFor(cdp, '!document.getElementById("soloHud").classList.contains("hidden")'), '横屏进入对局');
    ok(await evaluate(cdp, 'document.getElementById("joystick").classList.contains("visible")'), '横屏摇杆显示');
    await dragJoystick(cdp, 0, -50);
    const landHeading = await evaluate(cdp, 'window.__neonSnake3D.getGame().heading');
    ok(Math.abs(landHeading + Math.PI / 2) < 0.35, '横屏摇杆向上转向', `heading=${landHeading}`);
    const landShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'Temp', 'game-3d-landscape-joystick.png'), Buffer.from(landShot.data, 'base64'));
    console.log('  · 截图 game-3d-landscape-joystick.png');

    console.log('4. 全图模式手机可见性');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await evaluate(cdp, `(() => {
      const raw = JSON.parse(localStorage.getItem('neonSnake3D.v1') || '{}');
      raw.settings = raw.settings || {};
      raw.settings.camera = 'map';
      raw.settings.theme = 'aurora';
      localStorage.setItem('neonSnake3D.v1', JSON.stringify(raw));
    })()`);
    await cdp.send('Page.reload');
    await sleep(1200);
    await clickReal(cdp, '[data-diff="classic"]');
    ok(await waitFor(cdp, '!document.getElementById("soloHud").classList.contains("hidden")'), '全图模式进入对局');
    const mapShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'Temp', 'game-3d-mobile-map-aurora.png'), Buffer.from(mapShot.data, 'base64'));
    console.log('  · 截图 game-3d-mobile-map.png');

    const errs = cdp.errors.filter((e) => !/favicon/i.test(e));
    ok(errs.length === 0, '无页面运行时异常', errs.join(' | ').slice(0, 300));

    console.log(`\n结果：${passed} 通过，${failed} 失败`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (err) { /* done */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });