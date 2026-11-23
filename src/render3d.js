// Three.js 3D 渲染：透视斜俯视 / 霓虹玻璃平台 / 胶囊连体蛇 / 光环果实 / 粒子 / 三套皮肤
import * as THREE from '../vendor/three.module.js';
import { COLORS, FOOD_DEFS, THEMES, MP } from './config.js';

function hexRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = parseInt(full, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

const SNAKE_CAP = 320;
const PARTICLE_CAP = 600;
const FOOD_GEOMETRY_CACHE = {};

function foodGeometry(type) {
  if (FOOD_GEOMETRY_CACHE[type]) return FOOD_GEOMETRY_CACHE[type];
  let geo;
  if (type === 'gold') geo = new THREE.OctahedronGeometry(0.38, 0);
  else if (type === 'shield') geo = new THREE.TorusGeometry(0.26, 0.1, 10, 18);
  else if (type === 'slow') geo = new THREE.TetrahedronGeometry(0.36);
  else if (type === 'double') geo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  else geo = new THREE.IcosahedronGeometry(0.33, 0);
  FOOD_GEOMETRY_CACHE[type] = geo;
  return geo;
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.38)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function makeLabelTexture(text, color) {
  const dpr = 2;
  const fontSize = 40;
  const font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  const measureContext = document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  const textWidth = Math.ceil(measureContext.measureText(text).width);
  const padX = 26;
  const padY = 12;
  const width = Math.max(96, textWidth + padX * 2);
  const height = fontSize + padY * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = 'rgba(4, 8, 20, 0.8)';
  roundRectPath(ctx, 2, 2, width - 4, height - 4, 16);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  roundRectPath(ctx, 2, 2, width - 4, height - 4, 16);
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText(text, width / 2, height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

function resolveQuality(setting) {
  if (setting === 'low' || setting === 'high') return setting;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'high';
}

function hashPhase(id) {
  const value = String(id);
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return ((hash % 1000) / 1000) * Math.PI * 2;
}

function disposeGroup(group) {
  group.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material.map && material.userData && material.userData.ownsMap) material.map.dispose();
        material.dispose();
      }
    }
  });
}

export class Renderer3D {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.qualitySetting = settings.quality || 'auto';
    this.quality = resolveQuality(this.qualitySetting);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.computePixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.theme = THEMES[settings.theme] || THEMES.neon;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(new THREE.Color(this.theme.bgBottom), 60, 170);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 320);
    this.cameraDistance = 40;
    this.followMode = false;
    this.focus = new THREE.Vector3();
    this.aspect = 1;
    this.lastNow = 0;
    this.dynamicScale = 1;
    this.frameAvgMs = 16.7;
    this.lastScaleChangeAt = 0;
    this.grid = 0;
    this.shadowGeometry = new THREE.CircleGeometry(0.42, 18);
    this.boardGroup = null;
    this.snakes = new Map();
    this.foods = new Map();
    this.glowTexture = makeGlowTexture();
    this.menuOrbs = null;
    this.dummy = new THREE.Object3D();
    this.tempColorA = new THREE.Color();
    this.headColor = new THREE.Color();
    this.tailColor = new THREE.Color();
    this.segColor = new THREE.Color();
    this.axisY = new THREE.Vector3(0, 1, 0);
    this.qFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.qYaw = new THREE.Quaternion();
    this.snakeGeometry = new THREE.CapsuleGeometry(0.34, 0.5, 4, 10);
    this.ringGeometry = new THREE.TorusGeometry(0.52, 0.02, 6, 28);

    this.initLights();
    this.initParticles();
    this.initDust();
    this.applyBackground();
    this.resize();
    this.setGrid(24, true);
  }

  initLights() {
    this.ambient = new THREE.AmbientLight(new THREE.Color(this.theme.ambient), 1.1);
    this.scene.add(this.ambient);
    this.keyLight = new THREE.DirectionalLight(new THREE.Color(this.theme.key), 1.7);
    this.keyLight.position.set(14, 32, 18);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.DirectionalLight(new THREE.Color(this.theme.fill), 0.8);
    this.fillLight.position.set(-16, 14, -12);
    this.scene.add(this.fillLight);
  }

  computePixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const low = this.quality === 'low';
    const cap = low ? 0.9 : 1.5;
    let ratio = Math.min(dpr, cap);
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const maxPixels = low ? 1.6e6 : 3.2e6; // 上限，避免高分屏/手机的填充压力
    const pixels = width * height * ratio * ratio;
    if (pixels > maxPixels) ratio *= Math.sqrt(maxPixels / pixels);
    return Math.max(0.5, ratio * this.dynamicScale);
  }

  // 按实际帧耗时自适应渲染分辨率，弱机型优先保帧率
  noteFrame(dtMs, now) {
    if (!(dtMs > 0)) return;
    this.frameAvgMs = this.frameAvgMs * 0.9 + Math.min(dtMs, 100) * 0.1;
    if (now - this.lastScaleChangeAt < 1200) return;
    if (this.frameAvgMs > 23 && this.dynamicScale > 0.62) {
      this.dynamicScale = Math.max(0.62, this.dynamicScale * 0.86);
      this.lastScaleChangeAt = now;
      this.renderer.setPixelRatio(this.computePixelRatio());
    } else if (this.frameAvgMs < 15 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale * 1.05);
      this.lastScaleChangeAt = now;
      this.renderer.setPixelRatio(this.computePixelRatio());
    }
  }

  applyQuality(qualitySetting) {
    const setting = qualitySetting || 'auto';
    const next = resolveQuality(setting);
    const settingChanged = setting !== this.qualitySetting;
    this.qualitySetting = setting;
    if (!settingChanged && next === this.quality) return;
    if (next === this.quality) return;
    this.quality = next;
    this.renderer.setPixelRatio(this.computePixelRatio());
    if (this.dust) this.dust.visible = next !== 'low';
    if (this.boardHalo) this.boardHalo.visible = next !== 'low';
    for (const entry of this.snakes.values()) {
      if (entry.headShadow) entry.headShadow.visible = next !== 'low';
    }
    for (const entry of this.foods.values()) {
      if (entry.shadow) entry.shadow.visible = next !== 'low';
      if (entry.ring) entry.ring.visible = next !== 'low';
    }
    this.resize();
  }

  applyTheme(themeId, force = false) {
    const theme = THEMES[themeId] || THEMES.neon;
    if (!force && this.theme.id === theme.id && this.boardGroup) return;
    this.theme = theme;
    this.applyBackground();
    this.ambient.color.set(theme.ambient);
    this.keyLight.color.set(theme.key);
    this.fillLight.color.set(theme.fill);
    this.scene.fog.color.set(theme.bgBottom);
    if (this.dust) this.dust.material.color.set(theme.dust);
    this.setGrid(this.grid || 24, true);
  }

  applyBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0, this.theme.bgTop);
    base.addColorStop(0.55, hexRgba(this.theme.bgTop, 0.55));
    base.addColorStop(1, this.theme.bgBottom);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 512);
    const nebula = ctx.createRadialGradient(256, 190, 10, 256, 190, 380);
    nebula.addColorStop(0, hexRgba(this.theme.glow, 0.16));
    nebula.addColorStop(1, hexRgba(this.theme.glow, 0));
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, 512, 512);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = texture;
  }

  initDust() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    this.dustBase = new Float32Array(count * 3);
    const span = 34;
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 2 - 1) * span;
      const z = (Math.random() * 2 - 1) * span;
      const y = 0.4 + Math.random() * 6;
      this.dustBase[i * 3] = x;
      this.dustBase[i * 3 + 1] = y;
      this.dustBase[i * 3 + 2] = z;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(this.theme.dust),
      size: 0.07,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geometry, material);
    this.dust.frustumCulled = false;
    this.dust.visible = this.quality !== 'low';
    this.scene.add(this.dust);
  }

  updateDust(now) {
    if (!this.dust) return;
    const t = now / 1000;
    const positions = this.dust.geometry.attributes.position.array;
    const count = this.dustBase.length / 3;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.dustBase[i * 3] + Math.sin(t * 0.35 + i * 0.7) * 0.8;
      positions[i * 3 + 1] = 0.4 + ((this.dustBase[i * 3 + 1] + t * 0.18) % 6.2);
      positions[i * 3 + 2] = this.dustBase[i * 3 + 2] + Math.cos(t * 0.28 + i * 0.9) * 0.8;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(this.computePixelRatio());
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.aspect = width / Math.max(1, height);
    this.refreshProjection();
    if (!this.followMode) this.updateCamera(null, 0, performance.now());
  }

  elevationFor(aspect) {
    return aspect < 0.8 ? 0.94 : 0.72;
  }

  // 单人/菜单：把棋盘四角投影到屏幕，迭代拉远直到整张地图（含下边框）都在画面内
  fitBoardDistance(halfSize, elevation, startDistance) {
    const depth = Math.sqrt(Math.max(0.02, 1 - elevation * elevation));
    const corners = [
      [-halfSize, 0, -halfSize],
      [halfSize, 0, -halfSize],
      [-halfSize, 0, halfSize],
      [halfSize, 0, halfSize],
    ];
    const point = new THREE.Vector3();
    let distance = startDistance;
    for (let iteration = 0; iteration < 8; iteration++) {
      this.camera.position.set(0, distance * elevation, distance * depth);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld(true);
      let maxAbs = 0;
      for (const corner of corners) {
        point.set(corner[0], corner[1], corner[2]).project(this.camera);
        maxAbs = Math.max(maxAbs, Math.abs(point.x), Math.abs(point.y));
      }
      if (maxAbs <= 0.9) break;
      distance *= maxAbs / 0.86;
    }
    return distance;
  }

  // 跟随模式：迭代求焦点上限，保证走到任意边缘时该边的墙仍在屏幕内
  computeFollowClamp() {
    const half = (this.grid || 24) / 2;
    const elevation = this.elevationFor(this.aspect);
    const depth = Math.sqrt(Math.max(0.02, 1 - elevation * elevation));
    const distance = this.cameraDistance || 40;
    const limit = 0.94;
    const point = new THREE.Vector3();
    const fits = (focusX, focusZ, targetX, targetZ) => {
      this.camera.position.set(focusX, distance * elevation, focusZ + distance * depth);
      this.camera.lookAt(focusX, 0, focusZ);
      this.camera.updateMatrixWorld(true);
      point.set(targetX, 0, targetZ).project(this.camera);
      return Math.abs(point.x) <= limit && Math.abs(point.y) <= limit;
    };

    let clampZ = half;
    for (let i = 0; i < 32; i++) {
      if (fits(0, clampZ, 0, half)) break;
      clampZ -= half / 32;
      if (clampZ < 0) { clampZ = 0; break; }
    }
    let clampX = half;
    for (let i = 0; i < 32; i++) {
      if (fits(clampX, 0, half, 0)) break;
      clampX -= half / 32;
      if (clampX < 0) { clampX = 0; break; }
    }
    this.followClampX = clampX;
    this.followClampZ = clampZ;
  }

  refreshProjection() {
    const g = this.grid || 24;
    const portrait = this.aspect < 0.8;
    const pad = portrait ? 0.6 : 1.8;
    const halfBoard = g / 2 + pad;
    const viewHalf = this.followMode ? Math.min(halfBoard, MP.cameraFollowHalf) : halfBoard;
    const tan = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const elevation = this.elevationFor(this.aspect);
    const distV = (viewHalf * elevation) / tan;
    const distH = viewHalf / (tan * this.aspect);
    let distance = Math.max(distV, distH) * (portrait ? 1.0 : 1.12);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    if (!this.followMode) {
      distance = this.fitBoardDistance(g / 2 + 0.2, elevation, distance);
    }
    this.cameraDistance = distance;
    if (this.followMode) this.computeFollowClamp();
  }

  updateCamera(focusWorld, shake, now) {
    const tan = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const elevation = this.elevationFor(this.aspect);
    const depthFactor = Math.sqrt(Math.max(0.02, 1 - elevation * elevation));
    let targetX = 0;
    let targetZ = 0;
    if (this.followMode && focusWorld) {
      const half = (this.grid || 24) / 2;
      const vert = this.cameraDistance * tan;
      const horz = vert * this.aspect;
      const clampX = this.followClampX != null
        ? this.followClampX
        : Math.max(0, half - Math.min(half, horz * 0.92));
      const clampZ = this.followClampZ != null
        ? this.followClampZ
        : Math.max(0, half - Math.min(half, (vert / elevation) * 0.92));
      targetX = Math.max(-clampX, Math.min(clampX, focusWorld.x));
      targetZ = Math.max(-clampZ, Math.min(clampZ, focusWorld.z));
      const dt = this.lastNow ? Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000)) : 0.016;
      const k = 1 - Math.exp(-dt * 25);
      if (Math.abs(targetX - this.focus.x) > 6 || Math.abs(targetZ - this.focus.z) > 6) {
        this.focus.x = targetX;
        this.focus.z = targetZ;
      } else {
        this.focus.x += (targetX - this.focus.x) * k;
        this.focus.z += (targetZ - this.focus.z) * k;
      }
    } else {
      this.focus.x += (0 - this.focus.x) * 0.25;
      this.focus.z += (0 - this.focus.z) * 0.25;
    }
    this.lastNow = now || this.lastNow;
    const dist = this.cameraDistance || 40;
    const jitterX = shake > 0.2 ? (Math.random() * 2 - 1) * shake * 0.05 : 0;
    const jitterZ = shake > 0.2 ? (Math.random() * 2 - 1) * shake * 0.05 : 0;
    this.camera.position.set(
      this.focus.x + jitterX,
      dist * elevation,
      this.focus.z + dist * depthFactor + jitterZ,
    );
    this.camera.lookAt(this.focus.x, 0, this.focus.z);
  }

  makeBoardTexture(grid) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = this.theme.board;
    ctx.fillRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(size / 2, size / 2, 60, size / 2, size / 2, size * 0.72);
    glow.addColorStop(0, this.theme.boardAccent);
    glow.addColorStop(0.65, this.theme.board);
    glow.addColorStop(1, this.theme.boardSide);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    if (this.settings.grid) {
      const step = size / grid;
      const dotRadius = grid > 40 ? 1.5 : 2.2;
      ctx.fillStyle = hexRgba(this.theme.grid, 0.55);
      for (let i = 0; i <= grid; i++) {
        for (let j = 0; j <= grid; j++) {
          ctx.beginPath();
          ctx.arc(i * step, j * step, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  setGrid(grid, force = false) {
    if (!force && this.grid === grid && this.boardGroup) return;
    this.grid = grid;
    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      disposeGroup(this.boardGroup);
    }
    const group = new THREE.Group();
    const size = grid;
    const half = size / 2;

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(size, 0.8, size),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(this.theme.boardSide), metalness: 0.45, roughness: 0.65 }),
    );
    platform.position.y = -0.42;
    group.add(platform);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: this.makeBoardTexture(grid), metalness: 0.3, roughness: 0.55 }),
    );
    top.material.userData.ownsMap = true;
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    group.add(top);

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(size + 7, size + 7),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: new THREE.Color(this.theme.glow),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.06;
    halo.visible = this.quality !== 'low';
    this.boardHalo = halo;
    group.add(halo);

    const borderMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.border), transparent: true, opacity: 0.95 });
    const thickness = 0.14;
    for (const z of [-half, half]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(size + thickness, 0.2, thickness), borderMaterial);
      bar.position.set(0, 0.06, z);
      group.add(bar);
    }
    for (const x of [-half, half]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(thickness, 0.2, size + thickness), borderMaterial);
      bar.position.set(x, 0.06, 0);
      group.add(bar);
    }
    this.boardGroup = group;
    this.scene.add(group);
    this.resize();
  }

  worldPos(x, y) {
    return { x: x - this.grid / 2, z: y - this.grid / 2 };
  }

  snakeEntry(id, color) {
    let entry = this.snakes.get(id);
    if (!entry) {
      const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.3, emissiveIntensity: 1.0 });
      const mesh = new THREE.InstancedMesh(this.snakeGeometry, bodyMaterial, SNAKE_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SNAKE_CAP * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      const headGroup = new THREE.Group();
      const headMaterial = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.2, emissiveIntensity: 1.0 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 20, 14), headMaterial);
      head.position.y = 0.44;
      headGroup.add(head);
      const eyeGeometry = new THREE.SphereGeometry(0.09, 8, 8);
      const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x05121c });
      const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eyeLeft.position.set(-0.17, 0.56, 0.34);
      const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eyeRight.position.set(0.17, 0.56, 0.34);
      headGroup.add(eyeLeft, eyeRight);
      this.scene.add(headGroup);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture, color, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(2.4, 2.4, 1);
      this.scene.add(glow);

      const headShadow = new THREE.Mesh(
        this.shadowGeometry,
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      headShadow.rotation.x = -Math.PI / 2;
      headShadow.position.y = 0.012;
      headShadow.scale.set(1.3, 1.3, 1);
      this.scene.add(headShadow);

      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 20, 14),
        new THREE.MeshBasicMaterial({
          color: 0x4da3ff, transparent: true, opacity: 0.16,
          depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      bubble.visible = false;
      this.scene.add(bubble);

      const shieldRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.08, 0.035, 8, 32),
        new THREE.MeshBasicMaterial({
          color: 0x9ccaff, transparent: true, opacity: 0.7,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      shieldRing.rotation.x = Math.PI / 2;
      shieldRing.visible = false;
      this.scene.add(shieldRing);

      const buffGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture, color: 0xffffff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      buffGlow.scale.set(3, 3, 1);
      buffGlow.visible = false;
      this.scene.add(buffGlow);

      entry = { mesh, headGroup, head, glow, headShadow, bubble, shieldRing, buffGlow, color: null };
      this.snakes.set(id, entry);
    }
    if (entry.color !== color) {
      entry.color = color;
      entry.head.material.color.set(color);
      entry.head.material.emissive.set(color);
      entry.glow.material.color.set(color);
    }
    return entry;
  }

  hideSnake(id) {
    const entry = this.snakes.get(id);
    if (!entry) return;
    entry.mesh.count = 0;
    entry.headGroup.visible = false;
    entry.glow.visible = false;
    if (entry.headShadow) entry.headShadow.visible = false;
    if (entry.bubble) entry.bubble.visible = false;
    if (entry.shieldRing) entry.shieldRing.visible = false;
    if (entry.buffGlow) entry.buffGlow.visible = false;
    if (entry.labelSprite) entry.labelSprite.visible = false;
  }

  applyLabel(entry, snake) {
    if (!snake.label) {
      if (entry.labelSprite) entry.labelSprite.visible = false;
      return;
    }
    const key = `${snake.label}|${snake.color}`;
    if (entry.labelKey !== key) {
      entry.labelKey = key;
      const { texture, aspect } = makeLabelTexture(snake.label, snake.color);
      if (entry.labelSprite) {
        this.scene.remove(entry.labelSprite);
        entry.labelSprite.material.map.dispose();
        entry.labelSprite.material.dispose();
      }
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
      const sprite = new THREE.Sprite(material);
      const worldHeight = 0.9;
      sprite.scale.set(worldHeight * aspect, worldHeight, 1);
      sprite.renderOrder = 20;
      entry.labelSprite = sprite;
      this.scene.add(sprite);
    }
    const head = snake.segments[0];
    const pos = this.worldPos(head[0], head[1]);
    entry.labelSprite.position.set(pos.x, 2.0, pos.z);
    entry.labelSprite.visible = true;
  }

  applySnake(snake, now) {
    const segments = snake.segments;
    if (!snake.visible || !segments || segments.length === 0) {
      this.hideSnake(snake.id);
      return;
    }
    const entry = this.snakeEntry(snake.id, snake.color);
    const count = Math.min(segments.length, SNAKE_CAP);
    const headColor = this.headColor.set(snake.color);
    const tailColor = this.tailColor.copy(headColor).multiplyScalar(0.35);

    for (let i = 0; i < count; i++) {
      const pos = this.worldPos(segments[i][0], segments[i][1]);
      const t = count > 1 ? i / (count - 1) : 0;
      const radiusScale = 1 - 0.3 * t;
      let dx = 0;
      let dz = 0;
      const neighbor = i < count - 1 ? i + 1 : i - 1;
      if (neighbor >= 0 && neighbor !== i) {
        const np = this.worldPos(segments[neighbor][0], segments[neighbor][1]);
        dx = np.x - pos.x;
        dz = np.z - pos.z;
        if (Math.abs(dx) > 1.5 || Math.abs(dz) > 1.5) {
          dx = 0;
          dz = 0;
        }
      }
      const yaw = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
      this.qYaw.setFromAxisAngle(this.axisY, yaw);
      this.dummy.quaternion.copy(this.qYaw).multiply(this.qFlat);
      this.dummy.position.set(pos.x, 0.36, pos.z);
      this.dummy.scale.set(radiusScale, 1, radiusScale);
      this.dummy.updateMatrix();
      entry.mesh.setMatrixAt(i, this.dummy.matrix);
      entry.mesh.setColorAt(i, this.segColor.copy(headColor).lerp(tailColor, t));
    }
    entry.mesh.count = count;
    entry.mesh.instanceMatrix.needsUpdate = true;
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;

    const head = segments[0];
    const headPos = this.worldPos(head[0], head[1]);
    entry.headGroup.visible = true;
    entry.headGroup.position.set(headPos.x, 0.06, headPos.z);
    const dir = snake.dir || [1, 0];
    entry.headGroup.rotation.y = Math.atan2(dir[0], dir[1]);
    entry.glow.visible = this.quality !== 'low';
    entry.glow.position.set(headPos.x, 0.12, headPos.z);
    entry.headShadow.visible = this.quality !== 'low';
    entry.headShadow.position.set(headPos.x, 0.014, headPos.z);

    // 护盾罩子
    const shieldActive = snake.shield || snake.shieldPhase;
    entry.bubble.visible = !!shieldActive;
    entry.shieldRing.visible = !!shieldActive;
    if (shieldActive) {
      const pulse = 1 + Math.sin(now / 180) * 0.08;
      entry.bubble.position.set(headPos.x, 0.62, headPos.z);
      entry.bubble.scale.set(pulse, pulse * 0.9, pulse);
      entry.bubble.material.opacity = snake.shieldPhase
        ? 0.1 + 0.14 * Math.abs(Math.sin(now / 60))
        : 0.2;
      entry.shieldRing.position.set(headPos.x, 0.7, headPos.z);
      entry.shieldRing.rotation.z = now / 700;
      entry.shieldRing.material.opacity = snake.shieldPhase
        ? 0.4 + 0.4 * Math.abs(Math.sin(now / 60))
        : 0.7;
    }

    // 增益光环：双倍金色 / 减速紫色
    const auraColor = snake.doubleBuff ? '#ffd23f' : snake.slowBuff ? '#a04dff' : null;
    entry.buffGlow.visible = !!auraColor && this.quality !== 'low';
    if (auraColor) {
      const auraPulse = 1 + Math.sin(now / 240) * 0.12;
      entry.buffGlow.material.color.set(auraColor);
      entry.buffGlow.position.set(headPos.x, 0.5, headPos.z);
      entry.buffGlow.scale.set(3.2 * auraPulse, 3.2 * auraPulse, 1);
    }

    this.applyLabel(entry, snake);
  }

  syncFoods(list, now) {
    const seen = new Set();
    for (const food of list) {
      seen.add(food.id);
      let entry = this.foods.get(food.id);
      if (!entry) {
        const def = FOOD_DEFS[food.type] || FOOD_DEFS.normal;
        const mesh = new THREE.Mesh(
          foodGeometry(food.type),
          new THREE.MeshStandardMaterial({
            color: def.color,
            emissive: new THREE.Color(def.color),
            emissiveIntensity: 0.95,
            roughness: 0.3,
            metalness: 0.2,
          }),
        );
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTexture, color: def.color, transparent: true, opacity: 0.6,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glow.scale.set(2.0, 2.0, 1);
        const shadow = new THREE.Mesh(
          this.shadowGeometry,
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.013;
        shadow.scale.set(0.85, 0.85, 1);
        const ring = new THREE.Mesh(
          this.ringGeometry,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(def.color),
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        this.scene.add(mesh);
        this.scene.add(glow);
        this.scene.add(shadow);
        this.scene.add(ring);
        entry = { mesh, glow, shadow, ring };
        this.foods.set(food.id, entry);
      }
      const pos = this.worldPos(food.x, food.y);
      const phase = hashPhase(food.id);
      const bob = 0.58 + Math.sin(now / 320 + phase) * 0.09;
      entry.mesh.position.set(pos.x, bob, pos.z);
      entry.mesh.rotation.y += 0.025;
      entry.mesh.rotation.x = Math.sin(now / 760 + phase) * 0.22;
      entry.glow.position.set(pos.x, bob, pos.z);
      entry.shadow.position.set(pos.x, 0.013, pos.z);
      const extras = this.quality !== 'low';
      entry.glow.visible = extras;
      entry.shadow.visible = extras;
      entry.ring.visible = extras;
      entry.ring.position.set(pos.x, bob, pos.z);
      entry.ring.rotation.x = Math.PI / 2 + Math.sin(now / 900 + phase) * 0.25;
      entry.ring.rotation.y = now / 800 + phase;
      const ringScale = 1 + Math.sin(now / 300 + phase) * 0.12;
      entry.ring.scale.set(ringScale, ringScale, 1);
      const pulse = 1 + Math.sin(now / 260 + phase) * 0.12;
      entry.glow.scale.set(2.0 * pulse, 2.0 * pulse, 1);
    }
    for (const [id, entry] of this.foods) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.mesh);
      this.scene.remove(entry.glow);
      this.scene.remove(entry.shadow);
      this.scene.remove(entry.ring);
      entry.mesh.material.dispose();
      entry.glow.material.dispose();
      entry.shadow.material.dispose();
      entry.ring.material.dispose();
      this.foods.delete(id);
    }
  }

  initParticles() {
    const geometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(PARTICLE_CAP * 3);
    this.particleColors = new Float32Array(PARTICLE_CAP * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.pointCloud = new THREE.Points(geometry, material);
    this.pointCloud.frustumCulled = false;
    this.scene.add(this.pointCloud);
  }

  updateParticles(effects) {
    const count = Math.min(effects.particles.length, PARTICLE_CAP);
    for (let i = 0; i < count; i++) {
      const p = effects.particles[i];
      const pos = this.worldPos(p.x, p.y);
      this.particlePositions[i * 3] = pos.x;
      this.particlePositions[i * 3 + 1] = p.z;
      this.particlePositions[i * 3 + 2] = pos.z;
      const color = this.tempColorA.set(p.color);
      const fade = Math.max(0, p.life / p.maxLife);
      this.particleColors[i * 3] = color.r * fade;
      this.particleColors[i * 3 + 1] = color.g * fade;
      this.particleColors[i * 3 + 2] = color.b * fade;
    }
    this.pointCloud.geometry.setDrawRange(0, count);
    this.pointCloud.geometry.attributes.position.needsUpdate = true;
    this.pointCloud.geometry.attributes.color.needsUpdate = true;
  }

  renderScene(view, effects, now) {
    const followCell = view.follow && view.focus ? view.focus : null;
    const wantFollow = !!followCell;
    if (wantFollow !== this.followMode) {
      this.followMode = wantFollow;
      this.refreshProjection();
    }
    this.setGrid(view.grid || 24);
    const focusWorld = followCell ? this.worldPos(followCell[0], followCell[1]) : null;
    this.updateCamera(focusWorld, effects.shake, now);
    if (this.menuOrbs) {
      for (const orb of this.menuOrbs) orb.mesh.visible = false;
    }
    const seen = new Set();
    for (const snake of view.snakes) {
      seen.add(snake.id);
      this.applySnake(snake, now);
    }
    for (const id of this.snakes.keys()) {
      if (!seen.has(id)) this.hideSnake(id);
    }
    this.syncFoods(view.foods || [], now);
    this.updateParticles(effects);
    this.updateDust(now);
    this.renderer.render(this.scene, this.camera);
  }

  ensureMenuOrbs() {
    if (this.menuOrbs) return;
    const colors = ['#19f9ff', '#ff4d6d', '#39d98a', '#ffd23f', '#a04dff', '#4da3ff', '#ff9f43', '#f368e0'];
    this.menuOrbs = [];
    for (let i = 0; i < 10; i++) {
      const color = colors[i % colors.length];
      const mesh = new THREE.Mesh(
        i % 3 === 0 ? foodGeometry('gold') : new THREE.IcosahedronGeometry(0.3, 0),
        new THREE.MeshStandardMaterial({
          color, emissive: new THREE.Color(color), emissiveIntensity: 0.9, roughness: 0.3,
        }),
      );
      this.scene.add(mesh);
      this.menuOrbs.push({
        mesh,
        angle: (i / 10) * Math.PI * 2,
        radius: 8.5 + (i % 3) * 1.6,
        speed: 0.12 + (i % 4) * 0.035,
        height: 0.7 + (i % 5) * 0.18,
      });
    }
  }

  renderMenu(now, effects) {
    if (this.followMode) {
      this.followMode = false;
      this.refreshProjection();
    }
    this.setGrid(24);
    this.updateCamera(null, 0, now);
    for (const id of this.snakes.keys()) this.hideSnake(id);
    this.syncFoods([], now);
    this.ensureMenuOrbs();
    for (const orb of this.menuOrbs) {
      orb.mesh.visible = true;
      const angle = orb.angle + now / 1000 * orb.speed;
      const x = Math.cos(angle) * orb.radius;
      const z = Math.sin(angle) * orb.radius;
      orb.mesh.position.set(x, orb.height + Math.sin(now / 900 + orb.angle) * 0.3, z);
      orb.mesh.rotation.y = now / 900 + orb.angle;
    }
    this.updateParticles(effects);
    this.updateDust(now);
    this.renderer.render(this.scene, this.camera);
  }
}