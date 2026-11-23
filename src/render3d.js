// Three.js 3D 渲染：斜俯视 / 发光方块蛇 / 悬浮果实 / 粒子 / 震屏
import * as THREE from '../vendor/three.module.js';
import { COLORS, FOOD_DEFS } from './config.js';

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
      for (const material of materials) material.dispose();
    }
  });
}

export class Renderer3D {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.Fog(COLORS.fog, 60, 170);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 320);
    this.cameraDistance = 40;
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

    this.initLights();
    this.initParticles();
    this.resize();
    this.setGrid(24);
  }

  initLights() {
    this.scene.add(new THREE.AmbientLight(0x8899ff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(14, 32, 18);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x3f63ff, 0.8);
    fill.position.set(-16, 14, -12);
    this.scene.add(fill);
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const aspect = width / Math.max(1, height);
    const g = this.grid || 24;
    const halfBoard = g / 2 + 1.8;
    const tan = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const distV = (halfBoard * 0.8) / tan;
    const distH = halfBoard / (tan * aspect);
    this.cameraDistance = Math.max(distV, distH) * 1.12;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.updateCamera(0);
  }

  updateCamera(shake) {
    const dist = this.cameraDistance || 40;
    const jitterX = shake > 0.2 ? (Math.random() * 2 - 1) * shake * 0.05 : 0;
    const jitterZ = shake > 0.2 ? (Math.random() * 2 - 1) * shake * 0.05 : 0;
    this.camera.position.set(jitterX, dist * 0.74, dist * 0.72 + jitterZ);
    this.camera.lookAt(0, 0, 0);
  }

  setGrid(grid) {
    if (this.grid === grid && this.boardGroup) return;
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
      new THREE.MeshStandardMaterial({ color: 0x0a0f22, metalness: 0.4, roughness: 0.7 }),
    );
    platform.position.y = -0.42;
    group.add(platform);

    const points = [];
    for (let i = 1; i < grid; i++) {
      const p = -half + i;
      points.push(-half, 0, p, half, 0, p);
      points.push(p, 0, -half, p, 0, half);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    group.add(new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0x2c4aa8, transparent: true, opacity: 0.38 }),
    ));

    const borderMaterial = new THREE.MeshBasicMaterial({ color: 0x3f63ff, transparent: true, opacity: 0.9 });
    const thickness = 0.12;
    for (const z of [-half, half]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(size + thickness, 0.16, thickness), borderMaterial);
      bar.position.set(0, 0.07, z);
      group.add(bar);
    }
    for (const x of [-half, half]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(thickness, 0.16, size + thickness), borderMaterial);
      bar.position.set(x, 0.07, 0);
      group.add(bar);
    }
    this.boardGroup = group;
    this.scene.add(group);
    this.resize();
  }

  worldPos(x, y) {
    return { x: x + 0.5 - this.grid / 2, z: y + 0.5 - this.grid / 2 };
  }

  snakeEntry(id, color) {
    let entry = this.snakes.get(id);
    if (!entry) {
      const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25, emissiveIntensity: 1.0 });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), bodyMaterial, SNAKE_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SNAKE_CAP * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      const headGroup = new THREE.Group();
      const headMaterial = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2, emissiveIntensity: 0.95 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), headMaterial);
      head.position.y = 0.45;
      headGroup.add(head);
      const eyeGeometry = new THREE.SphereGeometry(0.085, 8, 8);
      const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x05121c });
      const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eyeLeft.position.set(-0.15, 0.52, 0.3);
      const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eyeRight.position.set(0.15, 0.52, 0.3);
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

      entry = { mesh, headGroup, head, glow, headShadow, color: null };
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
      const worldHeight = 1.0;
      sprite.scale.set(worldHeight * aspect, worldHeight, 1);
      sprite.renderOrder = 20;
      entry.labelSprite = sprite;
      this.scene.add(sprite);
    }
    const head = snake.segments[0];
    const pos = this.worldPos(head[0], head[1]);
    entry.labelSprite.position.set(pos.x, 2.1, pos.z);
    entry.labelSprite.visible = true;
  }

  applySnake(snake) {
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
      const scale = 1 - 0.22 * t;
      this.dummy.position.set(pos.x, 0.3, pos.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(scale, scale, scale);
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
    entry.glow.visible = true;
    entry.glow.position.set(headPos.x, 0.12, headPos.z);
    entry.headShadow.visible = true;
    entry.headShadow.position.set(headPos.x, 0.014, headPos.z);
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
        this.scene.add(mesh);
        this.scene.add(glow);
        this.scene.add(shadow);
        entry = { mesh, glow, shadow };
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
      const pulse = 1 + Math.sin(now / 260 + phase) * 0.12;
      entry.glow.scale.set(2.0 * pulse, 2.0 * pulse, 1);
    }
    for (const [id, entry] of this.foods) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.mesh);
      this.scene.remove(entry.glow);
      this.scene.remove(entry.shadow);
      entry.mesh.material.dispose();
      entry.glow.material.dispose();
      entry.shadow.material.dispose();
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
      const pos = this.worldPos(p.x - 0.5, p.y - 0.5);
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
    this.setGrid(view.grid || 24);
    this.updateCamera(effects.shake);
    if (this.menuOrbs) {
      for (const orb of this.menuOrbs) orb.mesh.visible = false;
    }
    const seen = new Set();
    for (const snake of view.snakes) {
      seen.add(snake.id);
      this.applySnake(snake);
    }
    for (const id of this.snakes.keys()) {
      if (!seen.has(id)) this.hideSnake(id);
    }
    this.syncFoods(view.foods || [], now);
    this.updateParticles(effects);
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
    this.setGrid(24);
    this.updateCamera(0);
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
    this.renderer.render(this.scene, this.camera);
  }
}