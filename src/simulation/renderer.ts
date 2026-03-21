/**
 * Three.js renderer for three-body simulation
 * Real 3D with perspective camera, bloom post-processing, and star spikes
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Body, Vec3 } from './physics';
import { computeCenterOfMass } from './physics';

// ── Module state ──
let threeRenderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let composer: EffectComposer;

// Body visuals
const bodyMeshes: THREE.Mesh[] = [];
const glowSprites: THREE.Sprite[] = [];
const spikeSprites: THREE.Sprite[] = [];
const trailMeshes: THREE.Mesh[] = [];

// Starfield (no module ref needed)

// Camera orbit
let rotX = 0, rotY = 0;
let userCameraDistance = 1.0;
const BASE_CAM_DIST = 8;

// Intro camera movement (camera starts close, pulls back)
let introStartTime = -1;
let introPhase = 0; // 0=camera close, 1=camera at normal distance
const INTRO_CAM_START = 0.3; // very close — bodies outside FOV

// Background
type BgMode = 'nebula' | 'dark' | 'blue' | 'panorama' | 'custom';
let bgMode: BgMode = 'panorama';
let bgCustomColor = '#000000';

// Textures
let glowTexture: THREE.Texture;
const spikeTextures: THREE.Texture[] = [];
let panoramaTexture: THREE.Texture | null = null;
let proceduralStarsGroup: THREE.Group;
let bloomPass: UnrealBloomPass;
let starSpikesVisible = true;

// ── Config exports ──

export function setRotation(rx: number, ry: number) {
  rotX = rx;
  rotY = ry;
}

export function setCameraDistance(d: number) {
  userCameraDistance = d;
}

export function setBgMode(mode: BgMode, color?: string) {
  bgMode = mode;
  if (color !== undefined) bgCustomColor = color;
  applyBackground();
}

export function resetCamera() {
  introStartTime = -1;
  introPhase = 0;
}

export function setBloomStrength(s: number) {
  if (bloomPass) bloomPass.strength = s;
}

export function setStarSpikesVisible(v: boolean) {
  starSpikesVisible = v;
  for (const spike of spikeSprites) spike.visible = v;
}

// ── Texture helpers ──

function createGlowTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.08, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function createSpikeTexture(color: Vec3): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2, cy = size / 2;
  const r = Math.round(color.x * 255);
  const g = Math.round(color.y * 255);
  const b = Math.round(color.z * 255);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, size * 0.46, 0);
    grad.addColorStop(0, `rgba(255,255,255,0.7)`);
    grad.addColorStop(0.1, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.1)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(size * 0.46, 0);
    ctx.lineTo(0, 5);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  return new THREE.CanvasTexture(c);
}

// ── Starfield + Galaxy ──

function createGalaxyTexture(): THREE.Texture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2, cy = size / 2;

  // --- Core bulge (warm bright center) ---
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.12);
  coreGrad.addColorStop(0, 'rgba(255, 245, 220, 0.9)');
  coreGrad.addColorStop(0.3, 'rgba(255, 230, 190, 0.5)');
  coreGrad.addColorStop(0.6, 'rgba(200, 180, 160, 0.15)');
  coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, size, size);

  // --- Diffuse disc glow ---
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.45); // flatten to ellipse (tilted galaxy)
  const discGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
  discGrad.addColorStop(0, 'rgba(180, 190, 220, 0.25)');
  discGrad.addColorStop(0.3, 'rgba(140, 155, 200, 0.12)');
  discGrad.addColorStop(0.6, 'rgba(100, 120, 180, 0.04)');
  discGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- Spiral arms (two main arms) ---
  const armCount = 2;
  const armStars = 6000;

  for (let arm = 0; arm < armCount; arm++) {
    const armOffset = (arm / armCount) * Math.PI * 2;
    for (let i = 0; i < armStars; i++) {
      const t = Math.random();
      const dist = t * size * 0.38;
      const angle = armOffset + t * 3.5 + (Math.random() - 0.5) * 0.6;
      // Spread perpendicular to arm
      const spread = (Math.random() - 0.5) * (15 + t * 25);
      const px = cx + (dist * Math.cos(angle)) + spread * Math.sin(angle);
      const py = cy + (dist * Math.sin(angle) * 0.45) + spread * Math.cos(angle) * 0.45;

      if (px < 0 || px > size || py < 0 || py > size) continue;

      const brightness = (1 - t * 0.6) * (0.3 + Math.random() * 0.7);
      const starSize = 0.4 + Math.random() * 1.0;

      // Color variation: blue-ish in arms, warm near center
      const warmth = Math.max(0, 1 - dist / (size * 0.2));
      const r = Math.round(160 + warmth * 80 + Math.random() * 30);
      const g = Math.round(170 + warmth * 50 + Math.random() * 20);
      const b = Math.round(200 + Math.random() * 40);

      ctx.beginPath();
      ctx.arc(px, py, starSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${brightness * 0.4})`;
      ctx.fill();
    }
  }

  // --- Scattered disc stars (fill between arms) ---
  for (let i = 0; i < 3000; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * size * 0.36;
    const px = cx + dist * Math.cos(angle);
    const py = cy + dist * Math.sin(angle) * 0.45;
    if (px < 0 || px > size || py < 0 || py > size) continue;
    const brightness = (1 - dist / (size * 0.4)) * Math.random();
    const starSize = 0.3 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.arc(px, py, starSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,210,240,${brightness * 0.2})`;
    ctx.fill();
  }

  // --- Bright star clusters (scattered bright spots in arms) ---
  for (let i = 0; i < 40; i++) {
    const arm = Math.floor(Math.random() * armCount);
    const armOffset = (arm / armCount) * Math.PI * 2;
    const t = 0.2 + Math.random() * 0.6;
    const dist = t * size * 0.35;
    const angle = armOffset + t * 3.5 + (Math.random() - 0.5) * 0.3;
    const px = cx + dist * Math.cos(angle);
    const py = cy + dist * Math.sin(angle) * 0.45;

    const clusterGrad = ctx.createRadialGradient(px, py, 0, px, py, 3 + Math.random() * 4);
    clusterGrad.addColorStop(0, 'rgba(220, 230, 255, 0.5)');
    clusterGrad.addColorStop(0.5, 'rgba(180, 200, 240, 0.15)');
    clusterGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = clusterGrad;
    ctx.beginPath();
    ctx.arc(px, py, 3 + Math.random() * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function createNebulaTexture(
  r: number, g: number, b: number, style: 'soft' | 'wispy',
): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;

  if (style === 'soft') {
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
    grad.addColorStop(0.3, `rgba(${r},${g},${b},0.08)`);
    grad.addColorStop(0.6, `rgba(${r},${g},${b},0.02)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Wispy: multiple offset blobs
    for (let i = 0; i < 5; i++) {
      const ox = half + (Math.random() - 0.5) * size * 0.4;
      const oy = half + (Math.random() - 0.5) * size * 0.4;
      const radius = size * (0.15 + Math.random() * 0.2);
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.1)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},0.03)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

function createStarGlowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.4, 'rgba(200,220,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function createStarfield() {
  proceduralStarsGroup = new THREE.Group();

  // Star color palette (spectral classes)
  const starColors = [
    new THREE.Color(0.7, 0.8, 1.0),   // blue-white (B)
    new THREE.Color(0.85, 0.9, 1.0),  // white (A)
    new THREE.Color(1.0, 1.0, 0.9),   // yellow-white (F)
    new THREE.Color(1.0, 0.95, 0.8),  // yellow (G, sun-like)
    new THREE.Color(1.0, 0.85, 0.6),  // orange (K)
    new THREE.Color(1.0, 0.7, 0.5),   // red (M)
  ];

  // --- Layer 1: Dim distant stars (many, small) ---
  const dimCount = 1200;
  const dimPositions: number[] = [];
  const dimColors: number[] = [];
  for (let i = 0; i < dimCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 150 + Math.random() * 100;
    dimPositions.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );
    const c = starColors[Math.floor(Math.random() * starColors.length)];
    const bright = 0.3 + Math.random() * 0.5;
    dimColors.push(c.r * bright, c.g * bright, c.b * bright);
  }
  const dimGeo = new THREE.BufferGeometry();
  dimGeo.setAttribute('position', new THREE.Float32BufferAttribute(dimPositions, 3));
  dimGeo.setAttribute('color', new THREE.Float32BufferAttribute(dimColors, 3));
  const dimMat = new THREE.PointsMaterial({
    size: 0.18,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  });
  proceduralStarsGroup.add(new THREE.Points(dimGeo, dimMat));

  // --- Layer 2: Medium stars (fewer, larger) ---
  const medCount = 300;
  const medPositions: number[] = [];
  const medColors: number[] = [];
  for (let i = 0; i < medCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 140 + Math.random() * 110;
    medPositions.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );
    const c = starColors[Math.floor(Math.random() * starColors.length)];
    const bright = 0.5 + Math.random() * 0.5;
    medColors.push(c.r * bright, c.g * bright, c.b * bright);
  }
  const medGeo = new THREE.BufferGeometry();
  medGeo.setAttribute('position', new THREE.Float32BufferAttribute(medPositions, 3));
  medGeo.setAttribute('color', new THREE.Float32BufferAttribute(medColors, 3));
  const medMat = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
  });
  proceduralStarsGroup.add(new THREE.Points(medGeo, medMat));

  // --- Layer 3: Bright prominent stars (few, with glow sprites) ---
  const starGlowTex = createStarGlowTexture();
  const brightCount = 40;
  for (let i = 0; i < brightCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 130 + Math.random() * 80;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const c = starColors[Math.floor(Math.random() * 3)];

    const spriteMat = new THREE.SpriteMaterial({
      map: starGlowTex,
      color: c,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.4 + Math.random() * 0.4,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    const s = 1.5 + Math.random() * 2.5;
    sprite.scale.set(s, s, 1);
    proceduralStarsGroup.add(sprite);
  }

  // --- Nebula clouds (colored gas/dust patches) ---
  const nebulae = [
    { r: 80, g: 50, b: 120, style: 'soft' as const },
    { r: 40, g: 70, b: 130, style: 'wispy' as const },
    { r: 120, g: 40, b: 50, style: 'soft' as const },
    { r: 30, g: 80, b: 90, style: 'wispy' as const },
    { r: 60, g: 40, b: 100, style: 'soft' as const },
    { r: 100, g: 60, b: 40, style: 'wispy' as const },
  ];

  for (let i = 0; i < nebulae.length; i++) {
    const n = nebulae[i];
    const tex = createNebulaTexture(n.r, n.g, n.b, n.style);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 120 + Math.random() * 60;

    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6 + Math.random() * 0.3,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );
    const s = 30 + Math.random() * 50;
    sprite.scale.set(s, s, 1);
    proceduralStarsGroup.add(sprite);
  }

  // --- Distant galaxy (textured billboard) ---
  const galaxyTex = createGalaxyTexture();
  const galaxyMat = new THREE.SpriteMaterial({
    map: galaxyTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const galaxySprite = new THREE.Sprite(galaxyMat);
  galaxySprite.position.set(-280, -180, -400);
  galaxySprite.scale.set(55, 55, 1);
  proceduralStarsGroup.add(galaxySprite);

  scene.add(proceduralStarsGroup);
}

// ── Background ──

function applyBackground() {
  if (!scene) return;
  // Show/hide procedural stars based on mode
  if (proceduralStarsGroup) {
    proceduralStarsGroup.visible = (bgMode === 'nebula');
  }
  switch (bgMode) {
    case 'nebula':
      scene.background = new THREE.Color('#0a0a1e');
      break;
    case 'panorama':
      if (panoramaTexture) {
        scene.background = panoramaTexture;
      } else {
        scene.background = new THREE.Color('#020208');
      }
      break;
    case 'dark':
      scene.background = new THREE.Color('#020208');
      break;
    case 'blue':
      scene.background = new THREE.Color('#0a0a2e');
      break;
    case 'custom':
      scene.background = new THREE.Color(bgCustomColor);
      break;
  }
}

// ── Body visuals (lazy init) ──

function ensureBodies(bodies: Body[]) {
  if (bodyMeshes.length > 0) return;

  for (let i = 0; i < bodies.length; i++) {
    const isPlanet = i === 3;
    const bodyColor = new THREE.Color(bodies[i].color.x, bodies[i].color.y, bodies[i].color.z);
    const radius = isPlanet ? 0.02 : 0.04;

    // Core sphere — HDR white for suns to drive bloom, dimmer for planet
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: isPlanet ? new THREE.Color(bodyColor.r * 0.5, bodyColor.g * 0.5, bodyColor.b * 0.5) : new THREE.Color(1.2, 1.2, 1.2),
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    bodyMeshes.push(mesh);

    // Glow sprite
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: isPlanet ? bodyColor : new THREE.Color(
        Math.min(1, bodies[i].color.x + 0.4),
        Math.min(1, bodies[i].color.y + 0.4),
        Math.min(1, bodies[i].color.z + 0.4),
      ),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: isPlanet ? 0.1 : 0.35,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    const glowSize = isPlanet ? 0.1 : 0.35;
    glow.scale.set(glowSize, glowSize, 1);
    scene.add(glow);
    glowSprites.push(glow);

    // Star spike sprite (suns only)
    if (!isPlanet) {
      const spikeTex = createSpikeTexture(bodies[i].color);
      spikeTextures.push(spikeTex);
      const spikeMat = new THREE.SpriteMaterial({
        map: spikeTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        rotation: 0,
      });
      const spike = new THREE.Sprite(spikeMat);
      spike.scale.set(1.2, 1.2, 1);
      scene.add(spike);
      spike.visible = starSpikesVisible;
      spikeSprites.push(spike);
    }

    // Trail mesh (ribbon geometry, updated each frame)
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    scene.add(trailMesh);
    trailMeshes.push(trailMesh);
  }
}

// ── Trail ribbon ──

function updateTrail(index: number, trail: Vec3[], bodyColor: Vec3) {
  const mesh = trailMeshes[index];
  const isPlanet = index === 3;

  // Planet trail: use only last portion for shorter trail
  const maxLen = isPlanet ? Math.min(trail.length, 120) : trail.length;
  const trailSlice = trail.length > maxLen ? trail.slice(trail.length - maxLen) : trail;

  if (trailSlice.length < 3) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;

  const dimFactor = isPlanet ? 0.3 : 1.0; // planet trail much dimmer

  const len = trailSlice.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const camPos = camera.position;

  for (let i = 0; i < len; i++) {
    const age = i / (len - 1); // 0=oldest 1=newest
    const halfWidth = (0.003 + age * (isPlanet ? 0.005 : 0.01));

    // Tangent
    let tx: number, ty: number, tz: number;
    if (i === 0) {
      tx = trailSlice[1].x - trailSlice[0].x;
      ty = trailSlice[1].y - trailSlice[0].y;
      tz = trailSlice[1].z - trailSlice[0].z;
    } else if (i === len - 1) {
      tx = trailSlice[i].x - trailSlice[i - 1].x;
      ty = trailSlice[i].y - trailSlice[i - 1].y;
      tz = trailSlice[i].z - trailSlice[i - 1].z;
    } else {
      tx = trailSlice[i + 1].x - trailSlice[i - 1].x;
      ty = trailSlice[i + 1].y - trailSlice[i - 1].y;
      tz = trailSlice[i + 1].z - trailSlice[i - 1].z;
    }

    // View direction
    const vx = camPos.x - trailSlice[i].x;
    const vy = camPos.y - trailSlice[i].y;
    const vz = camPos.z - trailSlice[i].z;

    // Perpendicular = tangent × view
    let nx = ty * vz - tz * vy;
    let ny = tz * vx - tx * vz;
    let nz = tx * vy - ty * vx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen > 1e-4) { nx /= nLen; ny /= nLen; nz /= nLen; }
    else { nx = 0; ny = 1; nz = 0; }

    positions.push(
      trailSlice[i].x + nx * halfWidth, trailSlice[i].y + ny * halfWidth, trailSlice[i].z + nz * halfWidth,
      trailSlice[i].x - nx * halfWidth, trailSlice[i].y - ny * halfWidth, trailSlice[i].z - nz * halfWidth,
    );

    // Color: blend toward white at newest end
    const brightness = 0.15 + age * 0.85; // gentle linear: 0.15 → 1.0
    const r = Math.min(1, bodyColor.x + (1 - bodyColor.x) * brightness * 0.2);
    const g = Math.min(1, bodyColor.y + (1 - bodyColor.y) * brightness * 0.2);
    const b = Math.min(1, bodyColor.z + (1 - bodyColor.z) * brightness * 0.2);
    const a = (0.2 + age * 0.8) * dimFactor; // opacity: 0.2 → 1.0
    colors.push(r * a, g * a, b * a, r * a, g * a, b * a);
  }

  const indices: number[] = [];
  for (let i = 0; i < len - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = mesh.geometry as THREE.BufferGeometry;
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
}

// ── Public API ──

export function initRenderer(canvas: HTMLCanvasElement) {
  threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  threeRenderer.setPixelRatio(window.devicePixelRatio);
  threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  threeRenderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  applyBackground();

  // Load ESO panorama texture for 'panorama' background mode
  const loader = new THREE.TextureLoader();
  loader.load('/eso0932a.jpg', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    panoramaTexture = tex;
    if (bgMode === 'panorama') applyBackground();
  });

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, BASE_CAM_DIST);

  // Post-processing: bloom for white-hot glow
  composer = new EffectComposer(threeRenderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,  // strength
    0.2,  // radius
    0.35, // threshold
  );
  bloomPass = bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  glowTexture = createGlowTexture();
  createStarfield();
}

export function render(
  bodies: Body[],
  _width: number,
  _height: number,
  time: number,
) {
  if (!threeRenderer) return;
  ensureBodies(bodies);

  const com = computeCenterOfMass(bodies);

  // ── Intro camera animation (camera pulls back from close to normal) ──
  if (introPhase < 1) {
    if (introStartTime < 0) introStartTime = time;
    const elapsed = time - introStartTime;
    const t = Math.min(elapsed / 2.5, 1);
    introPhase = 1 - Math.pow(1 - t, 3); // easeOutCubic
  }

  // ── Camera orbit ──
  const normalDist = BASE_CAM_DIST * userCameraDistance;
  const camDist = introPhase < 1
    ? INTRO_CAM_START + (normalDist - INTRO_CAM_START) * introPhase
    : normalDist;
  const azimuth = rotX * Math.PI / 180;
  const elevation = Math.max(-1.4, Math.min(1.4, -rotY * Math.PI / 180));
  camera.position.x = camDist * Math.cos(elevation) * Math.sin(azimuth);
  camera.position.y = camDist * Math.sin(elevation);
  camera.position.z = camDist * Math.cos(elevation) * Math.cos(azimuth);
  camera.lookAt(0, 0, 0);

  // ── Update body positions ──
  let spikeIdx = 0;
  for (let i = 0; i < bodies.length; i++) {
    const isPlanet = i === 3;
    const bx = bodies[i].x - com.x;
    const by = bodies[i].y - com.y;
    const bz = bodies[i].z - com.z;

    bodyMeshes[i].position.set(bx, by, bz);
    glowSprites[i].position.set(bx, by, bz);

    if (!isPlanet && spikeIdx < spikeSprites.length) {
      spikeSprites[spikeIdx].position.set(bx, by, bz);
      (spikeSprites[spikeIdx].material as THREE.SpriteMaterial).rotation =
        time * 0.12 + i * 0.7;
      spikeIdx++;
    }
  }

  // ── Update trails ──
  for (let i = 0; i < bodies.length; i++) {
    updateTrail(i, bodies[i].trail, bodies[i].color);
  }

  // ── Render ──
  composer.render();
}

export function resizeRenderer(width: number, height: number) {
  if (!threeRenderer) return;
  threeRenderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer.setSize(width, height);
}

export function disposeRenderer() {
  if (!threeRenderer) return;
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    if (obj instanceof THREE.Sprite) {
      obj.material.dispose();
    }
  });
  glowTexture?.dispose();
  spikeTextures.forEach(t => t.dispose());
  spikeTextures.length = 0;
  composer.dispose();
  threeRenderer.dispose();
  bodyMeshes.length = 0;
  glowSprites.length = 0;
  spikeSprites.length = 0;
  trailMeshes.length = 0;
}
