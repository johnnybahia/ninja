import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { RigInstance } from './types';
import { FACE_URI } from './rigs';

// ===========================================================================
// Characters are built from simple parts (lathes, capsules, rounded boxes)
// rigidly skinned to a real bone hierarchy and merged into ONE skinned mesh per
// material. A full character costs ~4 draw calls instead of ~40, and the joints
// (shoulder, elbow, hip, knee, ankle) can bend for proper animation.
// ===========================================================================

type Kind = 'cloth' | 'armor' | 'metal' | 'skin' | 'glow' | 'face';
const KINDS: Kind[] = ['cloth', 'armor', 'metal', 'skin', 'glow', 'face'];

interface BoneSpec {
  name: string;
  parent: string | null;
  pos: [number, number, number];
}

interface Template {
  specs: BoneSpec[];
  geos: Partial<Record<Kind, THREE.BufferGeometry>>;
}

const c = (hex: number) => new THREE.Color(hex);

// Standard humanoid skeleton, facing +Z. Arms hang down (-Y); weapons in the hand
// point +Z, matching the conventions used by the animation code.
function humanoidBones(o: { hip: number; shoulderX: number; hipX: number; thigh: number; shin: number; upper: number; fore: number }): BoneSpec[] {
  const chestY = 0.28;
  return [
    { name: 'body', parent: null, pos: [0, 0, 0] },
    { name: 'hips', parent: 'body', pos: [0, o.hip, 0] },
    { name: 'spine', parent: 'hips', pos: [0, 0.12, 0] },
    { name: 'chest', parent: 'spine', pos: [0, chestY, 0] },
    { name: 'neck', parent: 'chest', pos: [0, 0.3, 0] },
    { name: 'head', parent: 'neck', pos: [0, 0.12, 0] },
    { name: 'upperArmL', parent: 'chest', pos: [-o.shoulderX, 0.24, 0] },
    { name: 'foreL', parent: 'upperArmL', pos: [0, -o.upper, 0] },
    { name: 'handL', parent: 'foreL', pos: [0, -o.fore, 0] },
    { name: 'upperArmR', parent: 'chest', pos: [o.shoulderX, 0.24, 0] },
    { name: 'foreR', parent: 'upperArmR', pos: [0, -o.upper, 0] },
    { name: 'handR', parent: 'foreR', pos: [0, -o.fore, 0] },
    { name: 'thighL', parent: 'hips', pos: [-o.hipX, -0.05, 0] },
    { name: 'shinL', parent: 'thighL', pos: [0, -o.thigh, 0] },
    { name: 'footL', parent: 'shinL', pos: [0, -o.shin, 0] },
    { name: 'thighR', parent: 'hips', pos: [o.hipX, -0.05, 0] },
    { name: 'shinR', parent: 'thighR', pos: [0, -o.thigh, 0] },
    { name: 'footR', parent: 'shinR', pos: [0, -o.shin, 0] }
  ];
}

const M = new THREE.Matrix4();
const Qt = new THREE.Quaternion();
const Eu = new THREE.Euler();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();

class RigBuilder {
  specs: BoneSpec[];
  private index = new Map<string, number>();
  private world = new Map<string, THREE.Vector3>();
  private parts = new Map<Kind, THREE.BufferGeometry[]>();

  constructor(specs: BoneSpec[]) {
    this.specs = specs;
    specs.forEach((s, i) => {
      this.index.set(s.name, i);
      const p = new THREE.Vector3(...s.pos);
      if (s.parent) p.add(this.world.get(s.parent)!);
      this.world.set(s.name, p);
    });
  }

  addBone(name: string, parent: string, pos: [number, number, number]) {
    this.specs.push({ name, parent, pos });
    this.index.set(name, this.specs.length - 1);
    this.world.set(name, new THREE.Vector3(...pos).add(this.world.get(parent)!));
  }

  // Adds a part in the bone's local space: position, rotation (radians), scale.
  part(
    bone: string,
    geo: THREE.BufferGeometry,
    color: THREE.Color,
    kind: Kind,
    p: [number, number, number] = [0, 0, 0],
    r: [number, number, number] = [0, 0, 0],
    s: [number, number, number] = [1, 1, 1]
  ) {
    const bi = this.index.get(bone);
    if (bi === undefined) throw new Error('bone ' + bone);
    const g = geo.clone();
    M.compose(V1.set(...p).add(this.world.get(bone)!), Qt.setFromEuler(Eu.set(...r)), V2.set(...s));
    g.applyMatrix4(M);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!g.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const list = this.parts.get(kind) || [];
    list.push(g);
    this.parts.set(kind, list);
  }

  build(): Template {
    const geos: Partial<Record<Kind, THREE.BufferGeometry>> = {};
    for (const [kind, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (merged) {
        merged.computeBoundingSphere();
        geos[kind] = merged;
      }
    }
    return { specs: this.specs, geos };
  }
}

// --------------------------------------------------------------------------
// Shape helpers (all hang from the bone origin downward unless noted)
// --------------------------------------------------------------------------
const limb = (rTop: number, rBot: number, len: number, seg = 9) =>
  new THREE.CylinderGeometry(rTop, rBot, len, seg, 1).translate(0, -len / 2, 0);
const ball = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const lathe = (pts: [number, number][], seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const ring = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg, 1, true);

// --------------------------------------------------------------------------
// Materials: rim light (warm sunset backlight) + white hit flash, per rig
// --------------------------------------------------------------------------
function patchCharacter(mat: THREE.Material, flash: { value: number }, rim: THREE.Color) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFlash = flash;
    shader.uniforms.uRim = { value: rim };
    shader.fragmentShader =
      'uniform float uFlash;\nuniform vec3 uRim;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * pow(rimF, 2.8) + vec3(1.0, 0.88, 0.8) * uFlash * 0.75;`
      );
  };
  mat.customProgramCacheKey = () => 'char';
}

function makeMaterials(flash: { value: number }, rim: THREE.Color, skinTone: THREE.Color | null, faceMap: THREE.Texture | null) {
  const std = (roughness: number, metalness: number) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
    patchCharacter(m, flash, rim);
    return m;
  };
  const skin = std(0.62, 0);
  if (skinTone) skin.color.copy(skinTone);
  const mats: Record<Kind, THREE.Material> = {
    cloth: std(0.86, 0),
    armor: std(0.36, 0.2),
    metal: std(0.28, 0.85),
    skin,
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    face: (() => {
      const m = new THREE.MeshStandardMaterial({ map: faceMap, roughness: 0.66, emissiveMap: faceMap, emissive: new THREE.Color(0.42, 0.4, 0.38) });
      patchCharacter(m, flash, rim);
      return m;
    })()
  };
  return mats;
}

// --------------------------------------------------------------------------
// Cloth ribbons (scarf, headband tails): verlet chain simulated in world space
// --------------------------------------------------------------------------
export class Ribbon {
  mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private pos: Float32Array;
  private nor: Float32Array;
  private started = false;
  private tmp = new THREE.Vector3();
  private side = new THREE.Vector3();
  private rest = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  constructor(
    private rigRoot: THREE.Object3D,
    private anchor: THREE.Object3D,
    private offset: THREE.Vector3,
    private n: number,
    private seg: number,
    private width: number,
    material: THREE.Material,
    private restDir: THREE.Vector3,
    private taper = 0.55
  ) {
    for (let i = 0; i < n; i++) {
      this.pts.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    this.pos = new Float32Array(n * 2 * 3);
    this.nor = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    rigRoot.add(this.mesh);
  }

  update(dt: number, time: number) {
    const root = this.rigRoot;
    root.updateMatrixWorld(true);
    const a = this.anchor.localToWorld(this.tmp.copy(this.offset));
    // rest direction in world space (behind and down relative to the character)
    this.rest.copy(this.restDir).transformDirection(root.matrixWorld);
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < this.n; i++) {
        this.pts[i].copy(a).addScaledVector(this.rest, i * this.seg);
        this.prev[i].copy(this.pts[i]);
      }
    }
    const h = Math.min(dt, 1 / 30);
    const g = -7.5 * h * h;
    const windX = (Math.sin(time * 1.9) * 0.6 + 0.5) * h * h;
    this.pts[0].copy(a);
    this.prev[0].copy(a);
    for (let i = 1; i < this.n; i++) {
      const p = this.pts[i];
      const q = this.prev[i];
      const vx = (p.x - q.x) * 0.9;
      const vy = (p.y - q.y) * 0.9;
      const vz = (p.z - q.z) * 0.9;
      q.copy(p);
      p.x += vx + windX;
      p.y += vy + g;
      p.z += vz + Math.cos(time * 2.3 + i) * 0.3 * h * h;
    }
    const cx = root.position.x;
    const cz = root.position.z;
    for (let i = 1; i < this.n; i++) {
      const p = this.pts[i];
      const par = this.pts[i - 1];
      // mild shape memory toward the rest direction so it trails nicely at idle
      p.x += (par.x + this.rest.x * this.seg - p.x) * 0.12;
      p.y += (par.y + this.rest.y * this.seg - p.y) * 0.12;
      p.z += (par.z + this.rest.z * this.seg - p.z) * 0.12;
      // keep out of the torso
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dd = Math.hypot(dx, dz);
      const ry = p.y - root.position.y;
      if (dd < 0.3 && ry > 0.5 && ry < 1.9 && dd > 1e-4) {
        p.x = cx + (dx / dd) * 0.3;
        p.z = cz + (dz / dd) * 0.3;
      }
      if (p.y < root.position.y + 0.03) p.y = root.position.y + 0.03;
      // inextensible: follow the leader
      this.tmp.subVectors(p, par);
      const len = this.tmp.length() || 1;
      p.copy(par).addScaledVector(this.tmp, this.seg / len);
    }
    // build the strip in the rig's local space
    this.side.set(1, 0, 0).transformDirection(root.matrixWorld);
    this.inv.copy(root.matrixWorld).invert();
    for (let i = 0; i < this.n; i++) {
      const w = this.width * (1 - (i / (this.n - 1)) * (1 - this.taper)) * 0.5;
      const p = this.pts[i];
      V1.copy(p).addScaledVector(this.side, -w).applyMatrix4(this.inv);
      V2.copy(p).addScaledVector(this.side, w).applyMatrix4(this.inv);
      this.pos.set([V1.x, V1.y, V1.z, V2.x, V2.y, V2.z], i * 6);
      const nxt = this.pts[Math.min(i + 1, this.n - 1)];
      const prv = this.pts[Math.max(i - 1, 0)];
      this.tmp.subVectors(nxt, prv).normalize();
      const nrm = V1.crossVectors(this.side, this.tmp).normalize().transformDirection(this.inv);
      this.nor.set([nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

// Face card wrapped around the rounded head so it doesn't read as a flat sticker
function faceCard() {
  const g = new THREE.PlaneGeometry(0.35, 0.43, 10, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 0.175;
    const y = p.getY(i) / 0.215;
    p.setZ(i, 0.012 - 0.07 * x * x - 0.03 * y * y);
  }
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------
// Face: the chosen photo cropped to the face and feathered into the skin tone
// --------------------------------------------------------------------------
let faceCache: { tex: THREE.CanvasTexture; tone: THREE.Color; ready: boolean; listeners: (() => void)[] } | null = null;
function faceTexture() {
  if (faceCache) return faceCache;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 160;
  const g = cv.getContext('2d')!;
  const tone = new THREE.Color(0xaa7164);
  g.fillStyle = '#' + tone.getHexString();
  g.fillRect(0, 0, 128, 160);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cache = { tex, tone, ready: false, listeners: [] as (() => void)[] };
  faceCache = cache;
  const img = new Image();
  img.onload = () => {
    // average cheek color -> head/neck/hands skin so the face blends in
    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = img.height;
    const pg = probe.getContext('2d')!;
    pg.drawImage(img, 0, 0);
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (const [x0, y0] of [[70, 66], [96, 66]]) {
      const d = pg.getImageData(x0, y0, 10, 10).data;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        gg += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
    const hex = (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n);
    tone.setHex(hex);
    g.fillStyle = '#' + tone.getHexString();
    g.fillRect(0, 0, 128, 160);
    // crop forehead-to-chin, feather edges with an elliptical mask
    const f = document.createElement('canvas');
    f.width = 128;
    f.height = 160;
    const fg = f.getContext('2d')!;
    fg.drawImage(img, 58, 22, 64, 80, 0, 0, 128, 160);
    fg.globalCompositeOperation = 'destination-in';
    fg.save();
    fg.translate(64, 84);
    fg.scale(1, 1.3);
    const grd = fg.createRadialGradient(0, 0, 24, 0, 0, 60);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = grd;
    fg.fillRect(-64, -80, 128, 160);
    fg.restore();
    g.drawImage(f, 0, 0);
    tex.needsUpdate = true;
    cache.ready = true;
    cache.listeners.forEach((fn) => fn());
    cache.listeners = [];
  };
  img.src = FACE_URI;
  return cache;
}

// --------------------------------------------------------------------------
// Templates (geometry built once per character type and shared by instances)
// --------------------------------------------------------------------------
const templates = new Map<string, Template>();

function ninjaTemplate(): Template {
  const B = new RigBuilder(humanoidBones({ hip: 0.98, shoulderX: 0.29, hipX: 0.13, thigh: 0.45, shin: 0.4, upper: 0.33, fore: 0.31 }));
  const gi = c(0xebe5d9);
  const giShade = c(0xcfc6b6);
  const trim = c(0xa3262e);
  const hakama = c(0x25232f);
  const obi = c(0x2a1c16);
  const wrap = c(0xd7cfc0);
  const strap = c(0x2a2420);
  const tabi = c(0x1f1c22);
  const hair = c(0x2a201a);
  const leather = c(0x3a2e28);
  const lacquer = c(0x1a1414);
  const gold = c(0xd8a84a);
  const white = c(0xffffff);

  // hips: hakama top + obi
  B.part('hips', lathe([[0.19, -0.16], [0.25, -0.06], [0.26, 0.06], [0.235, 0.14]]), hakama, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 0.82]);
  B.part('hips', ring(0.26, 0.13), obi, 'cloth', [0, 0.1, 0], [0, 0, 0], [1, 1, 0.82]);
  B.part('hips', rbox(0.14, 0.1, 0.06, 0.02), obi, 'cloth', [0.02, 0.1, 0.21]);
  B.part('hips', box(0.05, 0.18, 0.02), obi, 'cloth', [0.06, 0.0, 0.215], [0, 0, 0.15]);
  B.part('hips', box(0.05, 0.14, 0.02), obi, 'cloth', [-0.01, 0.01, 0.215], [0, 0, -0.1]);
  // waist
  B.part('spine', lathe([[0.235, -0.02], [0.245, 0.1], [0.255, 0.2]]), gi, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 0.78]);
  // chest: gi with red-trimmed lapels, shoulder guards, katana scabbard on the back
  B.part('chest', lathe([[0.255, -0.08], [0.285, 0.05], [0.305, 0.17], [0.31, 0.25], [0.27, 0.32], [0.12, 0.36]]), gi, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 0.74]);
  for (const s of [-1, 1]) {
    B.part('chest', box(0.055, 0.44, 0.03), trim, 'cloth', [s * 0.075, 0.1, 0.205], [0.12, 0, s * -0.42]);
    B.part('chest', box(0.03, 0.4, 0.02), giShade, 'cloth', [s * 0.13, 0.06, 0.2], [0.1, 0, s * -0.4]);
    B.part('chest', rbox(0.2, 0.07, 0.25, 0.03), leather, 'cloth', [s * 0.27, 0.3, 0], [0, 0, s * -0.3]);
  }
  B.part('chest', box(0.1, 0.12, 0.02), trim, 'cloth', [0, 0.26, 0.19], [0.3, 0, Math.PI / 4]);
  B.part('chest', limb(0.042, 0.048, 0.95, 10), lacquer, 'armor', [-0.24, 0.52, -0.21], [0.05, 0, 0.62]);
  B.part('chest', ring(0.05, 0.05, 10), gold, 'metal', [-0.21, 0.47, -0.21], [0.05, 0, 0.62]);
  B.part('chest', ring(0.05, 0.04, 10), gold, 'metal', [0.3, -0.26, -0.21], [0.05, 0, 0.62]);
  // scarf wrap around the neck (tails are simulated ribbons)
  B.part('chest', new THREE.TorusGeometry(0.13, 0.055, 8, 18), trim, 'cloth', [0, 0.34, -0.01], [Math.PI / 2 + 0.2, 0, 0], [1, 1, 0.9]);
  // neck & head
  B.part('neck', limb(0.072, 0.08, 0.16, 10), white, 'skin', [0, 0.1, 0]);
  B.part('head', rbox(0.39, 0.45, 0.41, 0.17), white, 'skin', [0, 0.21, -0.005]);
  B.part('head', faceCard(), white, 'face', [0, 0.2, 0.2]);
  B.part('head', new THREE.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 'cloth', [0, 0.3, -0.02], [-0.18, 0, 0], [1, 0.95, 1.06]);
  B.part('head', new THREE.SphereGeometry(0.215, 16, 10, Math.PI * 0.62, Math.PI * 0.76, 0.2, Math.PI * 0.62), hair, 'cloth', [0, 0.25, -0.02]);
  for (const s of [-1, 1]) {
    B.part('head', rbox(0.04, 0.14, 0.1, 0.018), hair, 'cloth', [s * 0.19, 0.24, -0.01]);
    B.part('head', ball(0.045, 8, 6), white, 'skin', [s * 0.198, 0.2, 0.01], [0, 0, 0], [0.6, 1, 1]);
  }
  B.part('head', ring(0.228, 0.075, 20), trim, 'cloth', [0, 0.33, -0.005], [0, 0, 0], [1, 1, 1.02]);
  B.part('head', rbox(0.08, 0.07, 0.05, 0.02), trim, 'cloth', [0, 0.32, -0.235]);
  // arms: flared white sleeves with red cuffs, wrapped forearms, fists
  for (const [side, s] of [['L', -1], ['R', 1]] as const) {
    B.part('upperArm' + side, ball(0.1), gi, 'cloth');
    B.part('upperArm' + side, limb(0.1, 0.125, 0.3), gi, 'cloth', [0, -0.02, 0]);
    B.part('upperArm' + side, ring(0.127, 0.035), trim, 'cloth', [0, -0.31, 0]);
    B.part('fore' + side, ball(0.07), wrap, 'cloth');
    B.part('fore' + side, limb(0.072, 0.058, 0.28), wrap, 'cloth', [0, -0.01, 0]);
    for (const y of [-0.08, -0.18, -0.26]) B.part('fore' + side, ring(0.07 - y * 0.05, 0.02), strap, 'cloth', [0, y, 0]);
    B.part('hand' + side, rbox(0.1, 0.11, 0.1, 0.035), white, 'skin', [0, -0.04, 0.01]);
    B.part('hand' + side, rbox(0.04, 0.06, 0.05, 0.015), white, 'skin', [s * -0.05, -0.02, 0.03]);
    // legs: wide dark hakama, wrapped shins, split-toe tabi
    B.part('thigh' + side, ball(0.14), hakama, 'cloth', [0, 0.02, 0]);
    B.part('thigh' + side, limb(0.14, 0.17, 0.47), hakama, 'cloth');
    B.part('shin' + side, ball(0.115), hakama, 'cloth', [0, 0.03, 0]);
    B.part('shin' + side, limb(0.12, 0.1, 0.12), hakama, 'cloth', [0, 0.02, 0]);
    B.part('shin' + side, limb(0.085, 0.068, 0.3), wrap, 'cloth', [0, -0.08, 0]);
    for (const y of [-0.14, -0.24, -0.33]) B.part('shin' + side, ring(0.083 + y * 0.04, 0.02), strap, 'cloth', [0, y, 0]);
    B.part('foot' + side, rbox(0.115, 0.085, 0.25, 0.035), tabi, 'cloth', [0, -0.035, 0.05]);
    B.part('foot' + side, box(0.02, 0.07, 0.08), strap, 'cloth', [s * -0.015, -0.03, 0.16]);
  }
  return B.build();
}

function samuraiLike(kind: 'samurai' | 'archer'): Template {
  const B = new RigBuilder(humanoidBones({ hip: 0.97, shoulderX: 0.3, hipX: 0.13, thigh: 0.45, shin: 0.4, upper: 0.33, fore: 0.31 }));
  const archer = kind === 'archer';
  const plate = archer ? c(0x4f5a3a) : c(0x7a1a1c);
  const plateDk = archer ? c(0x2e3424) : c(0x14111a);
  const cloth = archer ? c(0x3a3a2c) : c(0x241f2a);
  const lace = archer ? c(0xb09a5a) : c(0x1b1a26);
  const gold = c(0xcaa04a);
  const skinC = c(0xc98f68);
  const mask = archer ? c(0x3a2a22) : c(0x2a0e10);
  const eye = new THREE.Color(1.0, 0.55, 0.12).multiplyScalar(2.6);

  // kusazuri: four skirt panels on their own bones so they can swing with the legs
  for (const [nm, x, z, ry] of [['plateF', 0, 0.2, 0], ['plateB', 0, -0.2, Math.PI], ['plateL', -0.22, 0, -Math.PI / 2], ['plateR', 0.22, 0, Math.PI / 2]] as const) {
    B.addBone(nm, 'hips', [x, 0.02, z]);
    for (let k = 0; k < 3; k++) {
      B.part(nm, box(0.3, 0.12, 0.035), k % 2 ? plateDk : plate, 'armor', [0, -0.07 - k * 0.1, 0.01 * k], [0.06, ry, 0]);
    }
    B.part(nm, box(0.31, 0.02, 0.04), lace, 'cloth', [0, -0.02, 0], [0.06, ry, 0]);
  }
  B.part('hips', lathe([[0.2, -0.14], [0.25, -0.04], [0.25, 0.08], [0.23, 0.14]]), cloth, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 0.84]);
  B.part('hips', ring(0.255, 0.1), lace, 'cloth', [0, 0.08, 0], [0, 0, 0], [1, 1, 0.86]);
  B.part('spine', lathe([[0.25, -0.02], [0.27, 0.1], [0.28, 0.2]]), plate, 'armor', [0, 0, 0], [0, 0, 0], [1, 1, 0.8]);
  B.part('spine', ring(0.285, 0.03), plateDk, 'armor', [0, 0.07, 0], [0, 0, 0], [1, 1, 0.8]);
  // dō chest armor with horizontal lames and a gold crest
  B.part('chest', lathe([[0.28, -0.08], [0.31, 0.04], [0.33, 0.16], [0.33, 0.25], [0.29, 0.32], [0.14, 0.36]]), plate, 'armor', [0, 0, 0], [0, 0, 0], [1, 1, 0.8]);
  for (const y of [-0.02, 0.08, 0.18]) B.part('chest', ring(0.325 + y * 0.05, 0.022), plateDk, 'armor', [0, y, 0], [0, 0, 0], [1, 1, 0.8]);
  B.part('chest', new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14).rotateX(Math.PI / 2), gold, 'metal', [0, 0.14, 0.27]);
  if (archer) {
    // quiver with arrows on the back
    B.part('chest', limb(0.07, 0.06, 0.6, 10), c(0x5a3a22), 'cloth', [0.12, 0.45, -0.28], [-0.2, 0, -0.35]);
    for (let k = 0; k < 4; k++) B.part('chest', limb(0.008, 0.008, 0.2, 5), c(0xe0dccf), 'cloth', [0.1 + k * 0.03 - 0.04, 0.6, -0.3 - k * 0.01], [-0.2, 0, -0.35]);
  }
  // neck, head, helmet / hat, menpo mask with glowing eyes
  B.part('neck', limb(0.075, 0.085, 0.16, 10), skinC, 'skin', [0, 0.1, 0]);
  B.part('head', ball(0.21, 16, 12), skinC, 'skin', [0, 0.2, 0], [0, 0, 0], [1, 1.08, 1]);
  B.part('head', rbox(0.3, 0.2, 0.14, 0.05), mask, 'armor', [0, 0.12, 0.13]);
  B.part('head', box(0.2, 0.035, 0.04), eye, 'glow', [0, 0.22, 0.195]);
  if (archer) {
    B.part('head', new THREE.ConeGeometry(0.46, 0.22, 16), c(0x7a6440), 'cloth', [0, 0.46, 0]);
    B.part('head', ring(0.46, 0.02, 16), c(0x3a2e20), 'cloth', [0, 0.35, 0]);
  } else {
    B.part('head', new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), plateDk, 'armor', [0, 0.26, -0.01]);
    B.part('head', lathe([[0.24, 0], [0.3, -0.09], [0.36, -0.2]], 16), plateDk, 'armor', [0, 0.27, -0.02]);
    B.part('head', ring(0.3, 0.025, 16), plate, 'armor', [0, 0.18, -0.02]);
    for (const s of [-1, 1]) B.part('head', rbox(0.12, 0.14, 0.03, 0.01), plate, 'armor', [s * 0.25, 0.28, 0.12], [0, s * -0.6, s * 0.3]);
    B.part('head', new THREE.TorusGeometry(0.17, 0.018, 6, 20, Math.PI), gold, 'metal', [0, 0.46, 0.14], [-0.2, 0, 0]);
  }
  // arms: sode shoulder plates, armored sleeves, gloves
  for (const [side, s] of [['L', -1], ['R', 1]] as const) {
    B.part('upperArm' + side, ball(0.105), cloth, 'cloth');
    B.part('upperArm' + side, limb(0.1, 0.1, 0.3), cloth, 'cloth');
    for (let k = 0; k < 3; k++) {
      B.part('upperArm' + side, box(0.26, 0.09, 0.03), k % 2 ? plateDk : plate, 'armor', [s * 0.1, 0.04 - k * 0.085, 0], [0, s * Math.PI / 2, s * 0.25]);
    }
    B.part('fore' + side, ball(0.075), plateDk, 'armor');
    B.part('fore' + side, limb(0.075, 0.062, 0.28), plateDk, 'armor');
    B.part('fore' + side, ring(0.078, 0.03), gold, 'metal', [0, -0.12, 0]);
    B.part('hand' + side, rbox(0.1, 0.11, 0.1, 0.035), plateDk, 'cloth', [0, -0.04, 0.01]);
    // legs: haidate thigh plates, dark hakama, suneate shin guards
    B.part('thigh' + side, ball(0.14), cloth, 'cloth', [0, 0.02, 0]);
    B.part('thigh' + side, limb(0.14, 0.15, 0.46), cloth, 'cloth');
    B.part('thigh' + side, box(0.22, 0.3, 0.04), plate, 'armor', [0, -0.16, 0.13], [-0.08, 0, 0]);
    B.part('shin' + side, ball(0.11), cloth, 'cloth', [0, 0.02, 0]);
    B.part('shin' + side, limb(0.1, 0.075, 0.38), plateDk, 'armor', [0, -0.01, 0]);
    B.part('shin' + side, box(0.14, 0.3, 0.03), archer ? plate : plateDk, 'armor', [0, -0.18, 0.08]);
    B.part('shin' + side, ring(0.1, 0.03), gold, 'metal', [0, -0.05, 0]);
    B.part('foot' + side, rbox(0.12, 0.08, 0.25, 0.03), c(0x2a2220), 'cloth', [0, -0.03, 0.05]);
  }
  return B.build();
}

function oniTemplate(): Template {
  const B = new RigBuilder(humanoidBones({ hip: 0.96, shoulderX: 0.36, hipX: 0.15, thigh: 0.44, shin: 0.4, upper: 0.34, fore: 0.32 }));
  const skin = c(0xa8342a);
  const skinDk = c(0x7a2018);
  const hair = c(0xe8e0d0);
  const horn = c(0xe6dcc0);
  const tiger = c(0xd8962a);
  const stripe = c(0x1c1410);
  const gold = c(0xcaa04a);
  const eye = new THREE.Color(1.0, 0.3, 0.1).multiplyScalar(3.2);

  B.part('hips', lathe([[0.24, -0.16], [0.3, -0.06], [0.31, 0.06], [0.28, 0.14]]), tiger, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 0.85]);
  for (let k = 0; k < 5; k++) B.part('hips', box(0.04, 0.2, 0.03), stripe, 'cloth', [-0.2 + k * 0.1, -0.02, 0.26], [0, 0, 0.3]);
  B.part('hips', ring(0.31, 0.08), c(0x3a2418), 'cloth', [0, 0.1, 0], [0, 0, 0], [1, 1, 0.86]);
  B.part('spine', ball(0.3, 16, 12), skin, 'skin', [0, 0.1, 0.04], [0, 0, 0], [1, 0.9, 0.85]);
  // massive chest and shoulders
  B.part('chest', ball(0.36, 18, 14), skin, 'skin', [0, 0.14, 0], [0, 0, 0], [1.08, 0.95, 0.82]);
  for (const s of [-1, 1]) {
    B.part('chest', ball(0.17, 12, 10), skin, 'skin', [s * 0.13, 0.18, 0.2], [0, 0, 0], [1, 0.8, 0.5]);
    B.part('chest', ball(0.2, 12, 10), skin, 'skin', [s * 0.3, 0.3, 0], [0, 0, 0], [1, 0.85, 0.9]);
  }
  B.part('neck', limb(0.13, 0.16, 0.2, 12), skin, 'skin', [0, 0.1, 0]);
  B.part('head', ball(0.24, 16, 12), skin, 'skin', [0, 0.18, 0], [0, 0, 0], [1, 1.02, 1]);
  B.part('head', rbox(0.3, 0.12, 0.16, 0.05), skinDk, 'skin', [0, 0.02, 0.13]);
  B.part('head', box(0.24, 0.04, 0.05), eye, 'glow', [0, 0.22, 0.215]);
  for (const s of [-1, 1]) {
    B.part('head', new THREE.ConeGeometry(0.06, 0.34, 8), horn, 'armor', [s * 0.13, 0.46, 0.02], [-0.25, 0, s * -0.4]);
    B.part('head', ring(0.065, 0.04, 10), gold, 'metal', [s * 0.11, 0.37, 0.03], [-0.25, 0, s * -0.4]);
    B.part('head', new THREE.ConeGeometry(0.025, 0.09, 6), horn, 'armor', [s * 0.07, 0.02, 0.2], [0, 0, Math.PI]);
  }
  for (let k = 0; k < 11; k++) {
    const a = -Math.PI * 0.95 + (k / 10) * Math.PI * 0.9 + Math.PI / 2;
    B.part('head', new THREE.ConeGeometry(0.07, 0.4, 6), hair, 'cloth', [Math.cos(a) * 0.19, 0.32, -Math.sin(a) * 0.19 - 0.06], [-0.9 + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.9]);
  }
  for (const [side] of [['L'], ['R']] as const) {
    B.part('upperArm' + side, ball(0.17), skin, 'skin');
    B.part('upperArm' + side, limb(0.16, 0.14, 0.32), skin, 'skin');
    B.part('fore' + side, ball(0.13), skin, 'skin');
    B.part('fore' + side, limb(0.14, 0.11, 0.3), skin, 'skin');
    B.part('fore' + side, ring(0.125, 0.07), gold, 'metal', [0, -0.22, 0]);
    B.part('hand' + side, rbox(0.17, 0.17, 0.16, 0.06), skinDk, 'skin', [0, -0.06, 0.01]);
    B.part('thigh' + side, ball(0.18), tiger, 'cloth', [0, 0.02, 0]);
    B.part('thigh' + side, limb(0.18, 0.15, 0.45), skin, 'skin');
    B.part('shin' + side, ball(0.14), skin, 'skin', [0, 0.02, 0]);
    B.part('shin' + side, limb(0.14, 0.1, 0.38), skin, 'skin');
    B.part('shin' + side, ring(0.12, 0.06), gold, 'metal', [0, -0.3, 0]);
    B.part('foot' + side, rbox(0.17, 0.1, 0.3, 0.04), skinDk, 'skin', [0, -0.04, 0.06]);
  }
  return B.build();
}

function getTemplate(key: string) {
  let t = templates.get(key);
  if (!t) {
    t = key === 'ninja' ? ninjaTemplate() : key === 'oni' ? oniTemplate() : samuraiLike(key as 'samurai' | 'archer');
    templates.set(key, t);
  }
  return t;
}

// --------------------------------------------------------------------------
// Instances
// --------------------------------------------------------------------------
export type CharKind = 'ninja' | 'samurai' | 'archer' | 'oni';

export function buildCharacter(kind: CharKind, scale = 1): RigInstance {
  const t = getTemplate(kind);
  const flash = { value: 0 };
  const rim = kind === 'ninja' ? new THREE.Color(1.0, 0.62, 0.36).multiplyScalar(0.55) : new THREE.Color(1.0, 0.5, 0.3).multiplyScalar(0.28);
  const face = kind === 'ninja' ? faceTexture() : null;
  const mats = makeMaterials(flash, rim, face ? face.tone : null, face ? face.tex : null);
  if (face && !face.ready) {
    const skin = mats.skin as THREE.MeshStandardMaterial;
    face.listeners.push(() => skin.color.copy(face.tone));
  }

  const root = new THREE.Group();
  const bones: Record<string, THREE.Bone> = {};
  const list: THREE.Bone[] = [];
  for (const s of t.specs) {
    const b = new THREE.Bone();
    b.name = s.name;
    b.position.set(...s.pos);
    (s.parent ? bones[s.parent] : root).add(b);
    bones[s.name] = b;
    list.push(b);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const used: THREE.Material[] = [];
  for (const k of KINDS) {
    const g = t.geos[k];
    if (!g) continue;
    const m = new THREE.SkinnedMesh(g, mats[k]);
    m.castShadow = k !== 'glow';
    m.receiveShadow = false;
    m.frustumCulled = false;
    root.add(m);
    m.bind(skeleton);
    used.push(mats[k]);
  }
  // unused materials are still disposed with the rig
  for (const k of KINDS) if (!used.includes(mats[k])) mats[k].dispose();

  // attach points: weapons ride on these (+Z forward when the arm hangs down)
  const hand = new THREE.Group();
  hand.position.y = -0.06;
  bones.handR.add(hand);
  const handL = new THREE.Group();
  handL.position.y = -0.06;
  bones.handL.add(handL);

  const cloth: Ribbon[] = [];
  let scarf: THREE.Object3D = new THREE.Group();
  if (kind === 'ninja') {
    const scarfMat = new THREE.MeshStandardMaterial({ color: 0xa3262e, roughness: 0.8, side: THREE.DoubleSide });
    patchCharacter(scarfMat, flash, rim);
    used.push(scarfMat);
    cloth.push(new Ribbon(root, bones.chest, new THREE.Vector3(0.05, 0.33, -0.15), 10, 0.14, 0.15, scarfMat, new THREE.Vector3(0.1, -0.35, -1).normalize()));
    cloth.push(new Ribbon(root, bones.chest, new THREE.Vector3(-0.06, 0.32, -0.14), 8, 0.13, 0.12, scarfMat, new THREE.Vector3(-0.15, -0.45, -1).normalize()));
    cloth.push(new Ribbon(root, bones.head, new THREE.Vector3(0.02, 0.32, -0.25), 5, 0.075, 0.05, scarfMat, new THREE.Vector3(0.2, -0.6, -1).normalize(), 0.8));
    cloth.push(new Ribbon(root, bones.head, new THREE.Vector3(-0.02, 0.31, -0.25), 5, 0.07, 0.045, scarfMat, new THREE.Vector3(-0.25, -0.7, -1).normalize(), 0.8));
    scarf = cloth[0].mesh;
  }

  root.scale.setScalar(scale);
  const plates = ['plateF', 'plateB', 'plateL', 'plateR'].map((n) => bones[n]).filter(Boolean);

  return {
    root,
    body: bones.body,
    hips: bones.hips,
    hipsRestY: bones.hips.position.y,
    spine: bones.spine,
    chest: bones.chest,
    neck: bones.neck,
    head: bones.head,
    eye: bones.head,
    legL: bones.thighL,
    legR: bones.thighR,
    shinL: bones.shinL,
    shinR: bones.shinR,
    footL: bones.footL,
    footR: bones.footR,
    legBaseY: bones.thighL.position.y,
    armL: bones.upperArmL,
    armR: bones.upperArmR,
    foreL: bones.foreL,
    foreR: bones.foreR,
    handBoneL: bones.handL,
    handBoneR: bones.handR,
    hand,
    handL,
    scarf,
    mats: used,
    flash,
    cloth,
    plates,
    kind,
    dispose: () => {
      used.forEach((m) => m.dispose());
      cloth.forEach((r) => r.dispose());
    }
  };
}
