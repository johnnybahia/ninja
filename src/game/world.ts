import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT } from './rigs';
import { TAU, rand } from './constants';
import type { QualityProfile } from './postfx';
import { ATMOSPHERES, Atmos, blendAtmos, cloneAtmos } from './atmosphere';
import { Garden } from './garden';
import { Lobe, coniferGeometry, foliageCards, foliageMaterial, makeRng, rockGeometry, sweep } from './shapes';
import { applySurface, initSurfaces, neutralize } from './surfaces';
import { detectQuality } from './postfx';

export type Solid = { x: number; z: number; r: number; h: number };

// World copies of the shared palette, with baked surface detail. Weapons and characters
// keep the plain MAT versions (a world-space projection would swim on moving parts).
function worldMaterials(): WorldMats {
  const tex = (m: THREE.MeshStandardMaterial, k = 0.6) => {
    const c = m.clone();
    neutralize(c.color, k);
    return c;
  };
  const W = {
    stone: tex(MAT.stone),
    stoneDark: tex(MAT.stoneDark),
    rock: tex(MAT.rock),
    wood: tex(MAT.wood, 0.3),
    woodDark: tex(MAT.woodDark, 0.3),
    roof: tex(MAT.roof, 0.2),
    torii: MAT.torii.clone(),
    trunk: tex(MAT.trunk, 0.5),
    dark: MAT.dark.clone()
  };
  applySurface(W.stone, 'rock', { mode: 'tri', scale: 0.5, normal: 1.1, albedo: 0.85 });
  applySurface(W.stoneDark, 'rock', { mode: 'tri', scale: 0.6, normal: 1.0, albedo: 0.8 });
  applySurface(W.rock, 'rock', { mode: 'tri', scale: 0.42, normal: 1.3, albedo: 0.9 });
  applySurface(W.wood, 'wood', { mode: 'tri', scale: 0.4, normal: 0.9, albedo: 0.9 });
  applySurface(W.woodDark, 'wood', { mode: 'tri', scale: 0.45, normal: 0.8, albedo: 0.7 });
  applySurface(W.roof, 'roof', { mode: 'uv', scale: 1, normal: 1.2, albedo: 0.9 });
  applySurface(W.torii, 'wood', { mode: 'tri', scale: 0.4, normal: 0.35, albedo: 0.12 });
  applySurface(W.trunk, 'bark', { mode: 'tri', scale: 0.7, normal: 1.3, albedo: 0.9 });
  applySurface(W.dark, 'wood', { mode: 'tri', scale: 0.45, normal: 0.4, albedo: 0.2 });
  return W;
}
type WorldMats = Record<'stone' | 'stoneDark' | 'rock' | 'wood' | 'woodDark' | 'roof' | 'torii' | 'trunk' | 'dark', THREE.MeshStandardMaterial>;
let WM: WorldMats;

// Shared wind clock for every swaying material (grass, foliage, banners)
const WIND_TIME = { value: 0 };
const IDENT = new THREE.Matrix4();

function glsl(n: number) {
  return n.toFixed(4);
}

// Bends vertices by height with a travelling wind wave. `instanced` uses the instance
// origin for the wave phase so neighbouring blades move a little out of step.
function addWind(mat: THREE.Material, o: { instanced?: boolean; amp: number; base: number; span: number; key: string }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uWindTime = WIND_TIME;
    shader.vertexShader =
      'uniform float uWindTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${o.instanced ? 'vec3 wOrigin = instanceMatrix[3].xyz;' : 'vec3 wOrigin = position;'}
        float wH = clamp((position.y - ${glsl(o.base)}) / ${glsl(o.span)}, 0.0, 1.0);
        float wPh = uWindTime * 1.7 + wOrigin.x * 0.23 + wOrigin.z * 0.19;
        float wAmt = (sin(wPh) * 0.65 + sin(wPh * 2.7 + 1.3) * 0.35) * ${glsl(o.amp)} * wH * wH;
        transformed.x += wAmt;
        transformed.z += wAmt * 0.45;`
      );
  };
  mat.customProgramCacheKey = () => 'wind-' + o.key;
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

// Shoji paper panel: warm glowing paper with a dark wooden lattice
function shojiTexture() {
  const t = canvasTex(256, (g, s) => {
    g.fillStyle = '#fff1d6';
    g.fillRect(0, 0, s, s);
    const gr = g.createRadialGradient(s / 2, s * 0.6, 10, s / 2, s * 0.6, s * 0.8);
    gr.addColorStop(0, 'rgba(255,220,160,0)');
    gr.addColorStop(1, 'rgba(160,90,40,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#2a1a12';
    const bar = 7;
    for (let i = 0; i <= 4; i++) g.fillRect((i * (s - bar)) / 4, 0, bar, s);
    for (let i = 0; i <= 6; i++) g.fillRect(0, (i * (s - bar)) / 6, s, bar);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function bannerTexture() {
  const t = canvasTex(128, (g, s) => {
    g.fillStyle = '#9e1f24';
    g.fillRect(0, 0, s, s * 4);
    g.fillStyle = '#7a151a';
    g.fillRect(0, 0, s, 10);
    g.strokeStyle = '#f2e6cc';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(s / 2, s * 0.5, s * 0.28, 0, TAU);
    g.stroke();
    g.fillStyle = '#f2e6cc';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU - Math.PI / 2;
      g.beginPath();
      g.ellipse(s / 2 + Math.cos(a) * 14, s * 0.5 + Math.sin(a) * 14, 11, 6, a + Math.PI / 2, 0, TAU);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function roundSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Everything static is collected per material and merged into one mesh each, which
// turns hundreds of world draw calls into a couple dozen.
class Batcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private shadowless = new Set<THREE.Material>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, color?: THREE.Color) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (color) {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    }
    const list = this.buckets.get(mat) || [];
    list.push(g);
    this.buckets.set(mat, list);
    return g;
  }

  noShadow(mat: THREE.Material) {
    this.shadowless.add(mat);
  }

  build(parent: THREE.Object3D) {
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const me = new THREE.Mesh(merged, mat);
      me.castShadow = !this.shadowless.has(mat);
      me.receiveShadow = true;
      parent.add(me);
      list.forEach((g) => g.dispose());
    }
    this.buckets.clear();
  }
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
function mtx(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)).clone();
}

// Japanese hip roof with sagging slopes and upturned corners. Base rectangle w×d at
// height 0, ridge of half-length `ridge` along X at height h.
function curvedRoof(w: number, d: number, h: number, ridge: number, lift: number) {
  const segU = 12;
  const segV = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const hw = w / 2;
  const hd = d / 2;
  // perimeter corners (counter-clockwise from +x,+z) and the matching ridge points
  const eave = [
    [hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]
  ];
  const top = [
    [ridge, 0], [-ridge, 0], [-ridge, 0], [ridge, 0]
  ];
  for (let side = 0; side < 4; side++) {
    const a = eave[side];
    const b = eave[(side + 1) % 4];
    const ta = top[side];
    const tb = top[(side + 1) % 4];
    const base = pos.length / 3;
    for (let i = 0; i <= segU; i++) {
      const s = i / segU;
      const ex = a[0] + (b[0] - a[0]) * s;
      const ez = a[1] + (b[1] - a[1]) * s;
      const rx = ta[0] + (tb[0] - ta[0]) * s;
      const rz = ta[1] + (tb[1] - ta[1]) * s;
      const corner = Math.pow(Math.abs(s * 2 - 1), 3);
      for (let j = 0; j <= segV; j++) {
        const t = j / segV;
        const x = ex + (rx - ex) * t;
        const z = ez + (rz - ez) * t;
        const y = h * Math.pow(t, 1.55) + lift * corner * Math.pow(1 - t, 2.2);
        pos.push(x, y, z);
        uv.push(s * 4, t * 3);
      }
    }
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const p = base + i * (segV + 1) + j;
        idx.push(p, p + 1, p + segV + 1, p + 1, p + segV + 2, p + segV + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Box bent upward at both ends (torii kasagi / shimaki beams)
function curvedBeam(len: number, hgt: number, dep: number, rise: number) {
  const g = new THREE.BoxGeometry(len, hgt, dep, 24, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i) / (len / 2);
    p.setY(i, p.getY(i) + rise * k * k * Math.abs(k));
  }
  g.computeVertexNormals();
  return g;
}

function bladeGeometry() {
  const segs = 4;
  const h = 0.46;
  const w = 0.095;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const half = (w * (1 - t) + 0.004) * 0.5;
    const bend = t * t * 0.14;
    pos.push(-half, t * h, bend, half, t * h, bend);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, t, 1, t);
    if (i < segs) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
// Sky dome: gradient, sun halo, HDR sun disc (feeds bloom) and drifting clouds
// ---------------------------------------------------------------------------
function buildSky(atm: Atmos) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: atm.zenith },
      uHorizon: { value: atm.horizon },
      uSun: { value: atm.sunGlow },
      uSunDir: { value: atm.sunDir },
      uStars: { value: atm.stars },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir; uniform float uTime; uniform float uStars;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, uSunDir), 0.0);
        vec3 horizon = uHorizon + uSun * pow(sd, 4.0) * 0.35;
        vec3 col = mix(horizon, uZenith, pow(smoothstep(-0.05, 0.55, h), 0.62));
        col += uSun * (pow(sd, 10.0) * 0.45 + pow(sd, 90.0) * 1.2);
        col += uSun * smoothstep(0.9990, 0.9995, sd) * 5.0;
        vec2 cuv = d.xz / (h + 0.18) * 1.1 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fbm(cuv * 1.3);
        float cl = smoothstep(0.52, 0.82, n) * smoothstep(0.03, 0.3, h) * (1.0 - smoothstep(0.55, 0.9, h));
        vec3 cloud = mix(uHorizon * 0.55 + vec3(0.02, 0.015, 0.04), uSun * 0.9, pow(sd, 2.5) * 0.9);
        col = mix(col, cloud, cl * 0.75);
        if (uStars > 0.01 && h > 0.0) {
          // twinkling star field, hidden behind clouds and near the horizon haze
          vec2 sp = d.xz / (h + 0.3) * 42.0;
          vec2 cell = floor(sp);
          vec2 f = fract(sp) - 0.5;
          float r = hash(cell);
          vec2 jit = vec2(hash(cell + 1.7), hash(cell + 4.3)) - 0.5;
          float star = step(0.975, r) * smoothstep(0.09, 0.0, length(f - jit * 0.6));
          float tw = 0.55 + 0.45 * sin(uTime * (2.0 + r * 3.0) + r * 60.0);
          col += vec3(0.85, 0.9, 1.1) * star * tw * uStars * smoothstep(0.04, 0.3, h) * (1.0 - cl) * 1.6;
        }
        col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.15, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// Distant mountain ring, colored by height from haze to a darker ridge (no fog so the
// silhouettes stay readable; the base matches the fog color for a seamless horizon).
function buildMountains(radius: number, minH: number, maxH: number, ridgeCol: THREE.Color, seed: number, fogCol: THREE.Color) {
  const seg = 160;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const base = fogCol;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    const n =
      Math.sin(a * 3 + seed) * 0.35 +
      Math.sin(a * 7.3 + seed * 2.1) * 0.25 +
      Math.sin(a * 17.1 + seed * 0.7) * 0.12 +
      Math.sin(a * 41.7 + seed * 3.3) * 0.05;
    const hgt = minH + (maxH - minH) * (0.5 + n * 0.7);
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    pos.push(x, -4, z, x * 0.96, hgt, z * 0.96);
    col.push(base.r, base.g, base.b, ridgeCol.r, ridgeCol.g, ridgeCol.b);
    if (i < seg) {
      const b = i * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -5;
  return m;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
interface Petal {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  ph: number;
}

interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  ember: boolean;
  cx: number;
  cz: number;
  cy: number;
}

export class World {
  solids: Solid[] = [];
  sun: THREE.DirectionalLight;
  private scene: THREE.Scene;
  private root = new THREE.Group();
  private sky: THREE.Mesh;
  private grass: THREE.InstancedMesh;
  private grassMax = 16000;
  private petals: THREE.InstancedMesh;
  private petalData: Petal[] = [];
  private petalMax = 420;
  private motes: THREE.Points;
  private moteData: Mote[] = [];
  private motePos: Float32Array;
  private moteCol: Float32Array;
  private flames: { outer: THREE.Mesh; inner: THREE.Mesh; ph: number; light: THREE.PointLight }[] = [];
  private lanternLights: THREE.PointLight[] = [];
  private emberSources: THREE.Vector3[] = [];
  private dummy = new THREE.Object3D();
  private shojiMat: THREE.MeshBasicMaterial;
  private hemi: THREE.HemisphereLight;
  private front: THREE.DirectionalLight;
  private mountains: { mesh: THREE.Mesh; far: boolean }[] = [];
  atm: Atmos = cloneAtmos(ATMOSPHERES[0]);
  private atmTarget: Atmos = ATMOSPHERES[0];
  private atmBlending = false;
  atmIndex = 0;
  private garden: Garden;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.root);
    let q: string | null = null;
    try {
      q = localStorage.getItem('kage_quality');
    } catch {
      q = null;
    }
    initSurfaces(renderer, (q && q !== 'auto' ? q : detectQuality()) === 'high');
    WM = worldMaterials();
    const atm = this.atm;
    scene.background = atm.fog.clone();
    scene.fog = new THREE.Fog(atm.fog.clone(), atm.fogNear, atm.fogFar);
    MAT.glow.color.set(0xff9a3c).multiplyScalar(atm.glow);

    // Lights: low sun behind the temple, cool sky fill, and a soft front fill so
    // characters facing the camera are not pure silhouettes against the sky.
    this.hemi = new THREE.HemisphereLight(atm.skyFill, atm.groundFill, atm.hemiI);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(atm.sunLight, atm.sunI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.front = new THREE.DirectionalLight(atm.front, atm.frontI);
    this.front.position.set(10, 14, 30);
    scene.add(this.front);

    this.sky = buildSky(atm);
    scene.add(this.sky);
    const mFar = buildMountains(175, 26, 58, atm.ridgeFar, 1.7, atm.fog);
    const mNear = buildMountains(140, 14, 34, atm.ridgeNear, 4.2, atm.fog);
    this.root.add(mFar, mNear);
    this.mountains.push({ mesh: mFar, far: true }, { mesh: mNear, far: false });

    const batch = new Batcher();

    this.buildGround();
    this.buildTemple(batch);
    this.buildTorii(batch);
    this.buildTrees(batch);
    this.buildLanterns(batch);
    this.buildRocks(batch);
    this.buildDistantForest();
    this.buildBanners(batch);
    this.buildTorches(batch);
    batch.build(this.root);

    this.garden = new Garden(this.root, atm, WIND_TIME, (x, z, pad) => this.isFree(x, z, pad));
    this.solids.push(...this.garden.solids);
    this.shojiMat = this.root.userData.shoji as THREE.MeshBasicMaterial;
    this.buildMist();
    this.grass = this.buildGrass();
    this.petals = this.buildPetals();
    const motes = this.buildMotes();
    this.motes = motes.points;
    this.motePos = motes.pos;
    this.moteCol = motes.col;
  }

  // open ground: off the temple podium, the pond/grove and every solid prop
  private isFree(x: number, z: number, pad: number) {
    if (z < -21.5 && Math.abs(x) < 10) return false;
    if (Garden.blocked(x, z)) return false;
    return !this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + pad);
  }

  private addSolid(x: number, z: number, r: number, h: number) {
    this.solids.push({ x, z, r, h });
  }

  private buildGround() {
    const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95, color: new THREE.Color(0.075, 0.08, 0.06) });
    applySurface(groundMat, 'ground', { mode: 'top', scale: 0.19, normal: 1.0, breakup: true });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64).rotateX(-Math.PI / 2), groundMat);
    ground.receiveShadow = true;
    this.root.add(ground);

    const plazaMat = new THREE.MeshStandardMaterial({ roughness: 0.8, color: new THREE.Color(0.12, 0.12, 0.125) });
    applySurface(plazaMat, 'cobble', { mode: 'top', scale: 0.3, normal: 1.1, breakup: true });
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(13, 64).rotateX(-Math.PI / 2), plazaMat);
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    this.root.add(plaza);
    // raised stone curb around the plaza
    const curb = new THREE.Mesh(new THREE.TorusGeometry(13.05, 0.16, 10, 160).rotateX(Math.PI / 2), WM.stoneDark);
    curb.position.y = 0.04;
    curb.scale.y = 0.6;
    curb.receiveShadow = true;
    this.root.add(curb);

    const pathMat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: new THREE.Color(0.16, 0.16, 0.155) });
    applySurface(pathMat, 'flag', { mode: 'tri', scale: 0.32, normal: 1.0 });
    const path = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 11), pathMat);
    path.position.set(0, 0.03, -17.8);
    path.receiveShadow = true;
    this.root.add(path);
    const path2 = path.clone();
    path2.scale.z = 0.36;
    path2.position.set(0, 0.03, 15);
    this.root.add(path2);
  }

  private buildTemple(b: Batcher) {
    const T = new THREE.Matrix4().makeTranslation(0, 0, -29);
    const at = (m: THREE.Matrix4) => T.clone().multiply(m);
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // stone podium with steps
    b.add(box(17, 1.2, 12), WM.stone, at(mtx(0, 0.6, 0)));
    b.add(box(17.4, 0.18, 12.4), WM.stoneDark, at(mtx(0, 1.21, 0)));
    for (let i = 0; i < 4; i++) {
      b.add(box(5.2, 0.3, 0.55), WM.stone, at(mtx(0, 0.15 + i * 0.3, 7.6 - i * 0.55)));
    }
    // wooden floor / veranda
    b.add(box(15, 0.28, 10), WM.wood, at(mtx(0, 1.44, 0)));
    // veranda railing (front, gap for the stairs) and posts
    const railY = 2.25;
    for (const side of [-1, 1]) {
      b.add(box(4.6, 0.1, 0.12), WM.woodDark, at(mtx(side * 5.2, railY, 4.95)));
      b.add(box(4.6, 0.08, 0.1), WM.woodDark, at(mtx(side * 5.2, railY - 0.35, 4.95)));
      for (let k = 0; k < 5; k++) b.add(box(0.12, 0.8, 0.12), WM.woodDark, at(mtx(side * (3.0 + k * 1.1), 1.95, 4.95)));
    }
    // pillars: red with black bases
    const pg = new THREE.CylinderGeometry(0.3, 0.33, 4.6, 24);
    const baseG = new THREE.CylinderGeometry(0.42, 0.46, 0.35, 24);
    for (const x of [-6.8, -2.3, 2.3, 6.8]) {
      for (const z of [4.3, -4.3]) {
        b.add(pg, WM.torii, at(mtx(x, 3.88, z)));
        b.add(baseG, WM.dark, at(mtx(x, 1.75, z)));
      }
    }
    // walls: back & sides in dark wood, front shoji panels glowing from inside
    b.add(box(13.6, 4.4, 0.35), WM.wood, at(mtx(0, 3.8, -4.2)));
    b.add(box(0.35, 4.4, 8.4), WM.wood, at(mtx(-6.8, 3.8, 0)));
    b.add(box(0.35, 4.4, 8.4), WM.wood, at(mtx(6.8, 3.8, 0)));
    const shojiMat = new THREE.MeshBasicMaterial({ map: shojiTexture(), color: new THREE.Color(1.05, 0.82, 0.56) });
    this.root.userData.shoji = shojiMat;
    b.noShadow(shojiMat);
    const panel = new THREE.PlaneGeometry(4.2, 3.3);
    for (const x of [-4.55, 0, 4.55]) b.add(panel, shojiMat, at(mtx(x, 3.42, 3.95)));
    // lintels and beams
    b.add(box(15.2, 0.5, 0.55), WM.woodDark, at(mtx(0, 5.95, 4.3)));
    b.add(box(15.2, 0.5, 0.55), WM.woodDark, at(mtx(0, 5.95, -4.3)));
    b.add(box(0.55, 0.5, 9.2), WM.woodDark, at(mtx(-6.8, 5.95, 0)));
    b.add(box(0.55, 0.5, 9.2), WM.woodDark, at(mtx(6.8, 5.95, 0)));
    b.add(box(14.2, 0.18, 0.22), WM.woodDark, at(mtx(0, 5.25, 4.1)));
    // bracket blocks under the eaves
    for (const x of [-6.8, -2.3, 2.3, 6.8]) b.add(box(0.7, 0.3, 0.7), WM.torii, at(mtx(x, 6.35, 4.3)));
    // main curved roof + ridge + raised upper roof
    b.add(curvedRoof(19.5, 14, 3.6, 5.2, 1.1), WM.roof, at(mtx(0, 6.3, 0)));
    b.add(box(10.6, 0.45, 0.6), WM.dark, at(mtx(0, 9.95, 0)));
    for (const s of [-1, 1]) {
      const orn = new THREE.ConeGeometry(0.28, 0.9, 6);
      b.add(orn, MAT.gold, at(mtx(s * 5.4, 10.45, 0, 0, 0, -s * 0.35)));
    }
    b.add(box(7.5, 1.3, 4.4), WM.wood, at(mtx(0, 10.6, 0)));
    b.add(curvedRoof(10.5, 6.8, 2.1, 2.6, 0.7), WM.roof, at(mtx(0, 11.15, 0)));
    b.add(box(5.6, 0.3, 0.4), WM.dark, at(mtx(0, 13.28, 0)));
    // hanging lanterns at the entrance
    const lanternG = new THREE.CylinderGeometry(0.32, 0.32, 0.62, 20);
    for (const x of [-3.2, 3.2]) b.add(lanternG, MAT.glow, at(mtx(x, 4.9, 4.7)));
    b.noShadow(MAT.glow);

    this.addSolid(-4.5, -29, 6.2, 12);
    this.addSolid(4.5, -29, 6.2, 12);
    this.addSolid(0, -22.8, 2.6, 1.3);
    this.emberSources.push(new THREE.Vector3(-3.2, 5, -24.3), new THREE.Vector3(3.2, 5, -24.3));
  }

  private buildTorii(b: Batcher) {
    const T = new THREE.Matrix4().makeTranslation(0, 0, 17);
    const at = (m: THREE.Matrix4) => T.clone().multiply(m);
    const pil = new THREE.CylinderGeometry(0.3, 0.36, 6.2, 24);
    const foot = new THREE.CylinderGeometry(0.42, 0.46, 0.5, 24);
    for (const x of [-3.3, 3.3]) {
      b.add(pil, WM.torii, at(mtx(x, 3.1, 0)));
      b.add(foot, WM.dark, at(mtx(x, 0.25, 0)));
      this.addSolid(x, 17, 0.55, 7);
    }
    b.add(curvedBeam(10.4, 0.42, 0.85, 0.55), WM.dark, at(mtx(0, 6.55, 0)));
    b.add(curvedBeam(9.4, 0.36, 0.6, 0.35), WM.torii, at(mtx(0, 6.12, 0)));
    b.add(new THREE.BoxGeometry(8.2, 0.34, 0.42), WM.torii, at(mtx(0, 5.0, 0)));
    b.add(new THREE.BoxGeometry(0.34, 0.8, 0.3), WM.torii, at(mtx(0, 5.55, 0)));
    b.add(new THREE.BoxGeometry(1.1, 0.7, 0.08), WM.dark, at(mtx(0, 5.6, 0.2)));
  }

  private buildTrees(b: Batcher) {
    const rng = makeRng(20260924);
    const R = (a: number, c: number) => a + (c - a) * rng();
    const up = new THREE.Vector3(0, 1, 0);
    const sakuraCards: THREE.BufferGeometry[] = [];
    const pineCards: THREE.BufferGeometry[] = [];
    const pinkTint = () => new THREE.Color().setHSL(0.95 + R(-0.02, 0.02), R(0.1, 0.35), R(0.78, 0.95));
    const pineTint = () => new THREE.Color().setHSL(0.3 + R(-0.03, 0.04), R(0.2, 0.4), R(0.42, 0.62));

    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + R(0, 0.14);
      const r = 30 + R(0, 8);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (z < -19 && Math.abs(x) < 14) continue;
      if (z > 13 && Math.abs(x) < 7) continue;
      const s = 0.85 + R(0, 0.45);
      const ry = R(0, TAU);
      const base = new THREE.Vector3(x, -0.1, z);
      if (rng() < 0.45) {
        // sakura: short leaning trunk, a crown of curving limbs, blossom clouds
        const lean = new THREE.Vector3(R(-0.5, 0.5), 0, R(-0.5, 0.5)).multiplyScalar(s);
        const h = R(2.0, 2.6) * s;
        const top = base.clone().add(lean).setY(h);
        const trunk = [base, base.clone().lerp(top, 0.45).add(new THREE.Vector3(R(-0.2, 0.2), 0, R(-0.2, 0.2))), top];
        b.add(sweep(trunk, (t) => 0.26 * s * (1 - 0.45 * t) * (1 + 0.9 * Math.exp(-t * 9)), 12, 12).geo, WM.trunk, IDENT);
        const lobes: Lobe[] = [{ c: top.clone().addScaledVector(up, 1.0 * s), r: 1.25 * s }];
        const nb = 4 + Math.floor(rng() * 2);
        for (let k = 0; k < nb; k++) {
          const ang = ry + (k / nb) * TAU + R(-0.35, 0.35);
          const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
          const len = R(1.6, 2.5) * s;
          const rise = R(0.6, 1.3) * s;
          const p0 = top.clone().addScaledVector(up, -0.35 * s);
          const p1 = p0.clone().addScaledVector(dir, len * 0.45).addScaledVector(up, rise * 0.65);
          const p2 = p0.clone().addScaledVector(dir, len).addScaledVector(up, rise);
          b.add(sweep([p0, p1, p2], (t) => 0.13 * s * (1 - 0.75 * t), 8, 10).geo, WM.trunk, IDENT);
          lobes.push({ c: p2.clone().addScaledVector(up, 0.3 * s), r: R(1.0, 1.35) * s }, { c: p1.clone().addScaledVector(up, 0.55 * s), r: R(0.75, 1.0) * s });
        }
        const canopy = lobes.reduce((acc, l) => acc.add(l.c), new THREE.Vector3()).divideScalar(lobes.length);
        sakuraCards.push(foliageCards(lobes, canopy, 15, [1.0, 1.45], pinkTint, rng));
      } else {
        // kuromatsu: S-curved trunk with cloud-pruned needle pads on low sweeping limbs
        const h = R(4.2, 5.4) * s;
        const bend = new THREE.Vector3(R(-1, 1), 0, R(-1, 1)).normalize().multiplyScalar(0.8 * s);
        const trunk = [
          base,
          base.clone().add(new THREE.Vector3(bend.x * 0.6, h * 0.33, bend.z * 0.6)),
          base.clone().add(new THREE.Vector3(-bend.x * 0.3, h * 0.66, -bend.z * 0.3)),
          base.clone().add(new THREE.Vector3(bend.x * 0.4, h, bend.z * 0.4))
        ];
        const tr = sweep(trunk, (t) => 0.3 * s * (1 - 0.62 * t) * (1 + 0.7 * Math.exp(-t * 10)), 12, 18);
        b.add(tr.geo, WM.trunk, IDENT);
        const pads: Lobe[] = [{ c: trunk[3].clone().addScaledVector(up, 0.3 * s), r: 0.95 * s, flat: 0.45 }];
        for (let k = 0; k < 4; k++) {
          const t = 0.42 + k * 0.15;
          const at = tr.curve.getPointAt(t);
          for (let side = 0; side < 2; side++) {
            const ang = ry + k * 2.1 + side * Math.PI + R(-0.4, 0.4);
            const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
            const len = (2.0 - k * 0.32) * s * R(0.8, 1.1);
            const p1 = at.clone().addScaledVector(dir, len * 0.5).addScaledVector(up, -0.15 * s);
            const p2 = at.clone().addScaledVector(dir, len).addScaledVector(up, 0.25 * s);
            b.add(sweep([at, p1, p2], (tt) => 0.1 * s * (1 - 0.7 * tt), 7, 8).geo, WM.trunk, IDENT);
            pads.push({ c: p2.clone().addScaledVector(up, 0.2 * s), r: (1.35 - k * 0.17) * s, flat: 0.38 });
          }
        }
        const canopy = pads.reduce((acc, l) => acc.add(l.c), new THREE.Vector3()).divideScalar(pads.length);
        pineCards.push(foliageCards(pads, canopy, 20, [0.85, 1.25], pineTint, rng, 0.75));
      }
      this.addSolid(x, z, 0.7, 9);
    }

    const base = `${import.meta.env.BASE_URL}tex/`;
    let sakMesh: THREE.Mesh | undefined;
    let pineMesh: THREE.Mesh | undefined;
    const sakuraMat = foliageMaterial(`${base}sakura_card.webp`, () => sakMesh, 0x2a0e16);
    const pineMat = foliageMaterial(`${base}pine_card.webp`, () => pineMesh);
    addWind(sakuraMat, { amp: 0.12, base: 2.4, span: 3.5, key: 'sakura-card' });
    addWind(pineMat, { amp: 0.07, base: 2.0, span: 5, key: 'pine-card' });
    const mk = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
      const g = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = false;
      this.root.add(m);
      return m;
    };
    sakMesh = mk(sakuraCards, sakuraMat);
    pineMesh = mk(pineCards, pineMat);
  }

  private buildLanterns(b: Batcher) {
    const pts = [
      [-3.4, -6], [3.4, -6],
      [-3.4, -14], [3.4, -14],
      [-4, 12], [4, 12],
      [-9, 0], [9, 0]
    ];
    const baseG = new THREE.CylinderGeometry(0.42, 0.5, 0.3, 16);
    const pillarG = new THREE.CylinderGeometry(0.16, 0.2, 0.85, 16);
    const shelfG = new THREE.CylinderGeometry(0.48, 0.4, 0.16, 6);
    const boxG = new THREE.BoxGeometry(0.46, 0.44, 0.46);
    const frameG = new THREE.BoxGeometry(0.08, 0.5, 0.08);
    const roofG = new THREE.ConeGeometry(0.7, 0.38, 6);
    const jewelG = new THREE.SphereGeometry(0.1, 14, 10);
    for (const [lx, lz] of pts) {
      b.add(baseG, WM.stone, mtx(lx, 0.15, lz));
      b.add(pillarG, WM.stone, mtx(lx, 0.72, lz));
      b.add(shelfG, WM.stone, mtx(lx, 1.22, lz));
      b.add(boxG, MAT.glow, mtx(lx, 1.52, lz));
      for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(frameG, WM.stoneDark, mtx(lx + fx * 0.24, 1.52, lz + fz * 0.24));
      b.add(roofG, WM.stone, mtx(lx, 1.94, lz, 0, Math.PI / 6, 0, 1, 1, 1));
      b.add(jewelG, WM.stone, mtx(lx, 2.2, lz));
      this.addSolid(lx, lz, 0.5, 2.3);
      this.emberSources.push(new THREE.Vector3(lx, 1.5, lz));
    }
    // warm light pools around the two plaza lanterns (only lit on higher quality)
    for (const [lx, lz] of [[-9, 0], [9, 0], [-4, 12], [4, 12]]) {
      const l = new THREE.PointLight(0xff9a48, 5, 10, 1.6);
      l.position.set(lx, 1.6, lz);
      this.root.add(l);
      this.lanternLights.push(l);
    }
  }

  private buildRocks(b: Batcher) {
    const pts = [
      [-10, -12, 1.1], [10, -12, 0.9],
      [-8, 16, 0.85], [8, 16, 1.05],
      [-16, -2, 1.3], [16, -2, 1.2],
      [-5.5, -23.5, 0.95], [5.5, -23.8, 0.9]
    ];
    pts.forEach(([rx, rz, s], i) => {
      b.add(rockGeometry(i * 7 + 3, 3), WM.rock, mtx(rx, s * 0.22, rz, 0, rand(0, TAU), 0, s * 1.3, s * 0.85, s * 1.1));
      b.add(rockGeometry(i * 7 + 5, 2, 0.28), WM.rock, mtx(rx + s * 1.15, s * 0.1, rz + s * 0.45, 0, rand(0, TAU), 0, s * 0.5, s * 0.4, s * 0.45));
      this.addSolid(rx, rz, s * 0.95, s * 1.5);
    });
  }

  // Dark pine silhouettes between the arena and the mountains for depth
  private buildDistantForest() {
    const n = 150;
    const g = coniferGeometry(9);
    const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x1a2a22, side: THREE.DoubleSide }), n);
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = rand(52, 95);
      const s = rand(3.5, 8);
      d.position.set(Math.sin(a) * r, -0.2, Math.cos(a) * r);
      d.rotation.set(0, rand(0, TAU), 0);
      const hh = s * rand(1.6, 2.4);
      d.scale.set(s * 0.85, hh, s * 0.85);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    this.root.add(m);
  }

  private buildBanners(b: Batcher) {
    const pts = [
      [-12, -22, 0.1], [12, -22, -0.1],
      [-15, 8, 0.15], [15, 8, -0.15],
      [-7, 22, 0.05], [7, 22, -0.05]
    ];
    const cloth = new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.85, side: THREE.DoubleSide });
    // pinned at the pole (uv.x = 0), rippling more toward the free edge
    cloth.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = WIND_TIME;
      shader.vertexShader =
        'uniform float uWindTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float free = uv.x;
          float ph = uWindTime * 3.1 - uv.x * 4.0 + uv.y * 2.0 + modelMatrix[3].x;
          transformed.z += sin(ph) * 0.16 * free + sin(ph * 2.3) * 0.05 * free;
          transformed.x -= (1.0 - cos(ph)) * 0.03 * free;`
        );
    };
    cloth.customProgramCacheKey = () => 'banner';
    const clothG = new THREE.PlaneGeometry(1.0, 3.4, 8, 14).translate(0.5, 0, 0);
    const poleG = new THREE.CylinderGeometry(0.06, 0.08, 5.6, 8);
    const barG = new THREE.CylinderGeometry(0.04, 0.04, 1.15, 6).rotateZ(Math.PI / 2);
    for (const [bx, bz, ry] of pts) {
      const base = new THREE.Matrix4().compose(new THREE.Vector3(bx, 0, bz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
      b.add(poleG, WM.woodDark, base.clone().multiply(mtx(0, 2.8, 0)));
      b.add(barG, WM.woodDark, base.clone().multiply(mtx(0.55, 5.2, 0)));
      const c = new THREE.Mesh(clothG, cloth);
      c.position.set(bx, 3.45, bz);
      c.rotation.y = ry;
      c.translateX(0.04);
      c.castShadow = true;
      this.root.add(c);
      this.addSolid(bx, bz, 0.3, 5.5);
    }
  }

  private buildTorches(b: Batcher) {
    const pts = [
      [-5.8, -23], [5.8, -23],
      [-2.2, 14.2], [2.2, 14.2]
    ];
    const legG = new THREE.CylinderGeometry(0.04, 0.05, 2.3, 6);
    const bowlG = new THREE.CylinderGeometry(0.36, 0.2, 0.26, 10);
    const outerM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(3), transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    const innerM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd070).multiplyScalar(4), transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const outerG = new THREE.ConeGeometry(0.26, 0.7, 10).translate(0, 0.35, 0);
    const innerG = new THREE.ConeGeometry(0.13, 0.42, 8).translate(0, 0.21, 0);
    for (const [tx, tz] of pts) {
      const g = new THREE.Group();
      g.position.set(tx, 0, tz);
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * TAU;
        b.add(legG, WM.woodDark, mtx(tx + Math.sin(ang) * 0.28, 1.12, tz + Math.cos(ang) * 0.28, Math.cos(ang) * 0.18, 0, -Math.sin(ang) * 0.18));
      }
      b.add(bowlG, WM.dark, mtx(tx, 2.2, tz));
      const outer = new THREE.Mesh(outerG, outerM);
      outer.position.y = 2.3;
      const inner = new THREE.Mesh(innerG, innerM);
      inner.position.y = 2.3;
      const light = new THREE.PointLight(0xff7a2a, 9, 12, 1.6);
      light.position.set(0, 2.9, 0);
      g.add(outer, inner, light);
      this.root.add(g);
      this.flames.push({ outer, inner, ph: rand(0, 10), light });
      this.addSolid(tx, tz, 0.35, 2.5);
      this.emberSources.push(new THREE.Vector3(tx, 2.6, tz));
    }
  }

  private buildGrass() {
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = WIND_TIME;
      shader.uniforms.uSunDir = { value: this.atm.sunDir };
      shader.uniforms.uSunCol = { value: this.atm.sunLight };
      shader.vertexShader =
        'uniform float uWindTime;\nvarying float vBladeH;\nvarying vec3 vGrassW;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vBladeH = position.y / 0.46;
          vec3 wOrigin = instanceMatrix[3].xyz;
          float wPh = uWindTime * 2.0 + wOrigin.x * 0.31 + wOrigin.z * 0.23;
          float gust = 0.6 + 0.4 * sin(uWindTime * 0.5 + wOrigin.x * 0.05);
          float wAmt = (sin(wPh) * 0.7 + sin(wPh * 2.9) * 0.3) * 0.16 * gust * vBladeH * vBladeH;
          transformed.x += wAmt;
          transformed.z += wAmt * 0.5;
          vGrassW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader = 'varying float vBladeH;\nvarying vec3 vGrassW;\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(0.68, 1.12, vBladeH);`
      ).replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 toCam = normalize(cameraPosition - vGrassW);
        float back = pow(max(dot(-toCam, normalize(uSunDir)), 0.0), 5.0);
        totalEmissiveRadiance += uSunCol * diffuseColor.rgb * back * vBladeH * vBladeH * 1.1;`
      );
    };
    mat.customProgramCacheKey = () => 'grass';
    const m = new THREE.InstancedMesh(bladeGeometry(), mat, this.grassMax);
    const d = this.dummy;
    const cA = new THREE.Color(0x7a9a48);
    const cB = new THREE.Color(0xaab85c);
    const cC = new THREE.Color(0x587a38);
    const col = new THREE.Color();
    let i = 0;
    let guard = 0;
    while (i < this.grassMax && guard++ < this.grassMax * 6) {
      const a = rand(0, TAU);
      const r = Math.sqrt(rand(13.6 * 13.6, 48 * 48));
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (z < -21.5 && Math.abs(x) < 10) continue; // temple podium
      if (Math.abs(x) < 2.1 && z < -12 && z > -23.5) continue; // stone path
      if (Math.abs(x) < 2 && z > 13 && z < 17) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r * 0.8)) continue;
      if (Garden.blocked(x, z)) continue;
      const s = rand(0.7, 1.35) * (r > 36 ? 1.2 : 1);
      d.position.set(x, 0, z);
      d.rotation.set(rand(-0.15, 0.15), rand(0, TAU), rand(-0.15, 0.15));
      d.scale.set(s, s * rand(0.8, 1.3), s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      const t = Math.random();
      col.copy(cA).lerp(t < 0.5 ? cB : cC, Math.random() * 0.8);
      m.setColorAt(i, col);
      i++;
    }
    m.count = i;
    this.grassMax = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  private buildPetals() {
    const g = new THREE.PlaneGeometry(0.085, 0.06);
    const mat = new THREE.MeshLambertMaterial({ color: 0xf7bccb, emissive: 0x4a1e2a, side: THREE.DoubleSide });
    const m = new THREE.InstancedMesh(g, mat, this.petalMax);
    m.frustumCulled = false;
    for (let i = 0; i < this.petalMax; i++) {
      this.petalData.push({
        p: new THREE.Vector3(rand(-22, 22), rand(0, 14), rand(-22, 22)),
        v: new THREE.Vector3(rand(0.4, 1.1), rand(-1.1, -0.55), rand(-0.3, 0.3)),
        rot: new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)),
        spin: new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3)),
        ph: rand(0, TAU)
      });
    }
    this.root.add(m);
    return m;
  }

  // Fireflies drifting around lanterns plus embers rising from the torches (HDR -> bloom)
  private buildMotes() {
    const n = 140;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ember = i >= 70;
      const src = this.emberSources[i % this.emberSources.length];
      this.moteData.push({
        x: src.x, y: src.y, z: src.z, vx: 0, vy: 0, vz: 0,
        life: rand(0, 3), max: ember ? rand(1.2, 2.4) : rand(3, 7), ember,
        cx: src.x, cy: src.y, cz: src.z
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.14,
        map: roundSpriteTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    pts.frustumCulled = false;
    this.root.add(pts);
    return { points: pts, pos, col };
  }

  // Start easing toward another atmosphere (instant for the first frame / menu)
  setAtmosphere(i: number, instant = false) {
    this.atmIndex = i;
    this.atmTarget = ATMOSPHERES[i];
    if (instant) {
      // copy in place: shaders hold references to these color/vector objects
      blendAtmos(this.atm, this.atmTarget, 1);
      this.applyAtmos();
      this.atmBlending = false;
    } else {
      this.atmBlending = true;
    }
  }

  private applyAtmos() {
    const a = this.atm;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(a.fog);
    fog.near = a.fogNear;
    fog.far = a.fogFar;
    (this.scene.background as THREE.Color).copy(a.fog);
    this.hemi.color.copy(a.skyFill);
    this.hemi.groundColor.copy(a.groundFill);
    this.hemi.intensity = a.hemiI;
    this.sun.color.copy(a.sunLight);
    this.sun.intensity = a.sunI;
    this.front.color.copy(a.front);
    this.front.intensity = a.frontI;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uStars.value = a.stars;
    MAT.glow.color.set(0xff9a3c).multiplyScalar(a.glow);
    for (const m of this.mountains) {
      const ridge = m.far ? a.ridgeFar : a.ridgeNear;
      const col = m.mesh.geometry.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i += 2) {
        col.setXYZ(i, a.fog.r, a.fog.g, a.fog.b);
        col.setXYZ(i + 1, ridge.r, ridge.g, ridge.b);
      }
      col.needsUpdate = true;
    }
  }

  private petalQuality = 1;
  private mist: THREE.Mesh[] = [];
  private mistU = { uTime: { value: 0 }, uDensity: { value: 0.3 }, uColor: { value: new THREE.Color() }, uFocus: { value: new THREE.Vector2() } };

  // Low ground mist: horizontal sheets of drifting noise around the play area. Sheets
  // (rather than billboards) never show hard cut lines against the ground.
  private buildMist() {
    const mk = (y: number, scale: number, speed: number, alpha: number) => {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { ...this.mistU, uY: { value: y }, uScale: { value: scale }, uSpeed: { value: speed }, uAlpha: { value: alpha } },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uDensity; uniform vec3 uColor; uniform vec2 uFocus;
          uniform float uScale; uniform float uSpeed; uniform float uAlpha;
          varying vec3 vW;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
          }
          float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
          void main() {
            vec2 p = vW.xz * uScale + vec2(uTime * uSpeed, uTime * uSpeed * 0.4);
            float n = fbm(p) * 0.7 + fbm(p * 0.5 - vec2(uTime * uSpeed * 0.6, 0.0)) * 0.5;
            float a = smoothstep(0.35, 0.95, n) * uDensity * uAlpha;
            float r = length(vW.xz - uFocus);
            a *= 1.0 - smoothstep(38.0, 60.0, r);
            float cam = length(vW - cameraPosition);
            a *= smoothstep(2.0, 7.0, cam);
            gl_FragColor = vec4(uColor, a);
          }
        `
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(130, 130).rotateX(-Math.PI / 2), m);
      mesh.position.y = y;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.mist.push(mesh);
    };
    mk(0.22, 0.06, 0.35, 0.55);
    mk(0.9, 0.035, 0.22, 0.4);
  }

  setQuality(p: QualityProfile) {
    this.grass.visible = p.grassDensity > 0;
    this.grass.count = Math.floor(this.grassMax * Math.max(0, p.grassDensity));
    const wantShadow = p.grassDensity >= 1;
    if (this.grass.receiveShadow !== wantShadow) {
      this.grass.receiveShadow = wantShadow;
      (this.grass.material as THREE.Material).needsUpdate = true;
    }
    this.petalQuality = p.ambientParticles;
    this.mist.forEach((m, i) => (m.visible = i < p.mistLayers));
    this.petals.count = Math.floor(this.petalMax * p.ambientParticles);
    const lights = p.composer ? (p.shadowMap >= 2048 ? 4 : 2) : 0;
    this.lanternLights.forEach((l, i) => (l.visible = i < lights));
    this.flames.forEach((f) => (f.light.visible = p.shadowMap >= 2048));
    this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
  }

  update(dt: number, time: number, focus: THREE.Vector3, camPos: THREE.Vector3) {
    WIND_TIME.value = time;
    if (this.atmBlending) {
      const done = blendAtmos(this.atm, this.atmTarget, 1 - Math.exp(-dt * 0.9));
      this.applyAtmos();
      if (done) this.atmBlending = false;
    }
    this.petals.count = Math.floor(this.petalMax * Math.min(1, this.petalQuality * this.atm.petals));
    this.mistU.uTime.value = time;
    this.mistU.uDensity.value = this.atm.mist;
    this.mistU.uColor.value.copy(this.atm.fog).lerp(this.atm.skyFill, 0.25).multiplyScalar(1.15);
    this.mistU.uFocus.value.set(focus.x, focus.z);
    for (const m of this.mist) {
      m.position.x = focus.x;
      m.position.z = focus.z;
    }
    this.garden.update(dt, time, this.atm);
    this.sky.position.copy(camPos);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;

    // Sun follows the action so the shadow map covers it at full resolution
    const sd = this.atm.sunDir;
    this.sun.position.set(focus.x - sd.x * 60, 45, focus.z - sd.z * 60);
    this.sun.target.position.set(focus.x, 0, focus.z);

    // Flickering fire and lantern glow
    for (const f of this.flames) {
      const k = 0.85 + Math.sin(time * 11 + f.ph) * 0.08 + Math.sin(time * 23 + f.ph * 2) * 0.06;
      f.outer.scale.set(1 + Math.sin(time * 9 + f.ph) * 0.06, k, 1);
      f.inner.scale.set(1, 0.9 + Math.sin(time * 17 + f.ph) * 0.12, 1);
      f.outer.rotation.y = time * 1.3 + f.ph;
      f.light.intensity = 8 * k;
    }
    const glowK = 0.94 + Math.sin(time * 7.3) * 0.03 + Math.sin(time * 13.1) * 0.03;
    const lamp = this.atm.lantern;
    this.lanternLights.forEach((l, i) => (l.intensity = lamp * (glowK + Math.sin(time * 5 + i) * 0.04)));
    const sj = this.atm.shoji * glowK;
    this.shojiMat.color.setRGB(1.05 * sj, 0.82 * sj, 0.56 * sj);

    // Petals: drift with the wind, flutter, respawn above the play area around the focus
    const d = this.dummy;
    const n = this.petals.count;
    for (let i = 0; i < n; i++) {
      const pt = this.petalData[i];
      pt.ph += dt * 2.2;
      pt.p.x += (pt.v.x + Math.sin(pt.ph) * 0.35) * dt;
      pt.p.y += pt.v.y * dt;
      pt.p.z += (pt.v.z + Math.cos(pt.ph * 0.7) * 0.25) * dt;
      pt.rot.x += pt.spin.x * dt;
      pt.rot.y += pt.spin.y * dt;
      pt.rot.z += pt.spin.z * dt;
      const dx = pt.p.x - focus.x;
      const dz = pt.p.z - focus.z;
      if (pt.p.y < 0.03 || Math.abs(dx) > 24 || Math.abs(dz) > 24) {
        pt.p.set(focus.x + rand(-22, 18), rand(8, 14), focus.z + rand(-22, 22));
      }
      d.position.copy(pt.p);
      d.rotation.copy(pt.rot);
      // hide petals brushing the lens; up close they read as big flat squares
      d.scale.setScalar(pt.p.distanceToSquared(camPos) < 4 ? 0 : 1);
      d.updateMatrix();
      this.petals.setMatrixAt(i, d.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;

    // Motes
    for (let i = 0; i < this.moteData.length; i++) {
      const m = this.moteData[i];
      m.life += dt;
      if (m.life >= m.max) {
        const src = this.emberSources[Math.floor(Math.random() * this.emberSources.length)];
        m.life = 0;
        m.cx = src.x;
        m.cy = src.y;
        m.cz = src.z;
        if (m.ember) {
          m.x = src.x + rand(-0.15, 0.15);
          m.y = src.y;
          m.z = src.z + rand(-0.15, 0.15);
          m.vx = rand(-0.3, 0.3) + 0.25;
          m.vy = rand(1.2, 2.2);
          m.vz = rand(-0.3, 0.3);
        } else {
          m.x = src.x + rand(-2.5, 2.5);
          m.y = rand(0.4, 2.6);
          m.z = src.z + rand(-2.5, 2.5);
        }
      }
      const f = m.life / m.max;
      let bright: number;
      if (m.ember) {
        m.vx += Math.sin(time * 3 + i) * 0.6 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.z += m.vz * dt;
        bright = (1 - f) * 3.2;
        this.moteCol[i * 3] = bright;
        this.moteCol[i * 3 + 1] = bright * 0.45;
        this.moteCol[i * 3 + 2] = bright * 0.12;
      } else {
        m.x += Math.sin(time * 0.9 + i * 1.7) * 0.4 * dt;
        m.y += Math.sin(time * 1.3 + i) * 0.25 * dt;
        m.z += Math.cos(time * 0.8 + i * 2.3) * 0.4 * dt;
        bright = Math.sin(f * Math.PI) * (0.6 + 0.4 * Math.sin(time * 6 + i * 3)) * 2.4 * this.atm.fireflies;
        this.moteCol[i * 3] = bright * 0.9;
        this.moteCol[i * 3 + 1] = bright;
        this.moteCol[i * 3 + 2] = bright * 0.35;
      }
      this.motePos[i * 3] = m.x;
      this.motePos[i * 3 + 1] = m.y;
      this.motePos[i * 3 + 2] = m.z;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    this.motes.geometry.attributes.color.needsUpdate = true;
  }
}
