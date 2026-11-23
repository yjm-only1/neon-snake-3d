# 霓虹贪吃蛇 3D · Neon Snake 3D

Three.js 3D 贪吃蛇：保留经典玩法（三档难度 / 5 种果实 / 连击 / 成就），新增**局域网联机**（最多 8 人、三种玩法 × 两种节奏）与**个人资料**（昵称 / 头像 / 颜色，联机头顶显示昵称牌）。

![主菜单](screenshots/menu-3d.png)
![单人 3D](screenshots/game-3d-desktop.png)
![局域网对战](screenshots/lan-battle-3d.png)

## 永久网址

- **单人 3D（GitHub Pages）**：https://yjm-only1.github.io/neon-snake-3d/
- **局域网联机**：需一台主机运行本仓库的 `node server/server.mjs`（GitHub Pages 只能单人）
- 经典 2D 版（旧）：https://yjm-only1.github.io/neon-snake/

## 单人 3D

- 双击根目录 `index.html`（构建产物）即玩；或运行局域网服务器后在浏览器打开
- 三档难度（各有独立最高分）：悠闲 6 格/秒穿墙 · 经典 8 格/秒撞墙死 · 狂暴 11 格/秒加速最陡
- 5 种果实（普通 / 金果 / 护盾 / 减速 / 双倍）+ 3 秒连击 ×2~×5
- 个人资料：昵称、头像（emoji）、颜色，蛇头顶实时显示昵称牌
- 三套皮肤：霓虹 / 极光 / 熔岩（设置里实时切换）

## 皮肤

设置 → 皮肤：影响底板质感、点阵、边框光晕、背景与灯光；蛇身颜色由个人资料决定。

![极光皮肤](screenshots/menu-aurora.png)
![熔岩皮肤](screenshots/menu-magma.png)

## 局域网联机（最多 8 人）

浏览器之间不能直接互连，需要一台电脑当主机：

```bash
# 主机：项目目录下运行（零依赖，只需 Node.js）
node server/server.mjs
# 或 Windows 直接双击 start-server.bat

# 服务器窗口会打印地址，例如：
#   本机访问:   http://localhost:8787
#   局域网访问: http://192.168.1.5:8787
```

所有人（含主机）用**局域网地址**打开页面 → 点「局域网联机」→ 填昵称 → 加入房间；首位进房者是房主，可改玩法/节奏/难度并开始。

### 联机玩法矩阵

| 玩法 | 限时 3 分钟（死亡 3 秒重生） | 生存淘汰（最后存活者胜） |
|---|---|---|
| 抢食竞速（共享地图 · 互不伤害） | ✅ | ✅ |
| 同场对抗（共享地图 · 撞蛇身死） | ✅ | ✅ |
| 各自竞速（独立地图 · 同种子食物） | ✅ | —（无淘汰意义，固定限时） |

- 联机条目标题上方实时显示每人分数与阵亡状态
- 每条蛇头顶显示「头像 + 昵称」昵称牌，颜色由个人资料决定
- 断线 / 关页面自动移出房间；服务器 12 秒心跳超时清理

## 操作

| 输入 | 动作 |
|---|---|
| 方向键 / WASD | 转向（缓冲 2 步，禁止 180° 反转） |
| 空格 / Esc | 暂停（仅单人） |
| Enter | 菜单开局 / 结算重开 |
| M | 静音音效 |
| 手机滑动屏幕 | 转向 |

## 项目结构

```
index.html / deploy-site/index.html   单文件构建产物（双击即玩）
dev.html                              源码页面（需本地服务器）
src/config.js                         难度 / 食物 / 联机参数 / 头像颜色 / 成就
src/game.js                           单人模拟（纯逻辑，Node 可测）
src/mp/arena.js                       联机权威模拟（服务端复用）
src/render3d.js                       Three.js 3D 渲染（透视相机 / 昵称牌 / 粒子）
src/net.js                            联机客户端（SSE 快照流）
src/ui.js                             菜单 / 大厅 / HUD / 结算 / 个人资料
src/main.js                           状态机 + 主循环
server/server.mjs                     零依赖局域网服务器（HTTP + SSE）
vendor/three.module.js                Three.js r160
tools/build_single.py                 单文件构建
tools/sim/arena-selftest.mjs          联机逻辑自测（55 断言）
tools/e2e/server-test.mjs             服务器集成测试（18 断言）
tools/e2e/browser-test.mjs            单人 3D 浏览器验收（12 断言）
tools/e2e/lan-browser-test.mjs        双人联机浏览器验收（17 断言）
```

## 测试与构建

```bash
node tools/sim/arena-selftest.mjs    # 联机逻辑
node tools/e2e/server-test.mjs       # 服务器集成
node tools/e2e/browser-test.mjs      # 单人 3D（需本机 Chrome）
node tools/e2e/lan-browser-test.mjs  # 双人联机（需本机 Chrome）
python tools/build_single.py         # 重建 index.html 与 deploy-site/index.html
```

## 技术要点

- 服务端权威：Node 复用 `src/mp/arena.js` 跑模拟，浏览器只上报转向、接收 15Hz 快照并插值渲染
- 传输零依赖：HTTP POST 上报输入 + SSE 推送快照，局域网延迟通常 <10ms，无需 npm install
- 3D：透视斜俯视相机、发光方块蛇（InstancedMesh）、悬浮果实、贴地阴影、粒子与震屏
- GitHub Pages 只提供单人 3D；联机必须通过局域网服务器

## 发布

公开仓库发布整个 `neon-snake-3d` 工程；仓库根目录即本工程目录，工程目录之外的任何文件不得进入。

```bash
bash tools/publish_site.sh   # 构建并推送到 GitHub main，Pages 自动发布
```