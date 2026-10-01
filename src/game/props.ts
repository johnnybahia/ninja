import * as THREE from 'three';
import { BladeSeg, bladeLerp, closestSegSeg } from './combat';
import { sfx } from './audio';

// ===========================================================================
// Reactive scenery. A blade (or fist, or blast) that touches a tree, rock, lantern, pillar,
// bamboo stalk, banner pole or railing post makes it answer in kind:
//   stone   -> steel throws sparks and chips, blunt things only thud; lanterns crack and
//              shatter under heavy blows, specials, bombs
//   trees   -> bark chips, a pale cut mark in the bark, leaves / petals / twigs shaken loose,
//              the crown sways (only the tree that was hit)
//   wood    -> splinters and a cut mark; thin posts and banner poles snap and topple
//   bamboo  -> a clean cut: the top falls, the stump stays
// Everything is a fixed pool (instanced debris, points for sparks, instanced cut marks) so
// nothing is created while playing, and nothing costs anything while nothing is hit.
// ===========================================================================

export interface Seg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
  limb?: boolean; // a branch rather than the trunk
}

export interface Canopy {
  x: number;
  y: number;
  z: number;
  r: number;
  pink: boolean;
}

export interface PropHit {
  power: number; // 1 light, 2 heavy, 3 special, 10 blast
  edged: boolean; // blade/metal (cuts, sparks on stone) vs blunt (staff, fist)
  token: object; // a prop reacts once per swing
  radius: number; // blade thickness
}

export interface PropFx {
  dust(x: number, z: number, n: number, spd: number, dx?: number, dz?: number): void;
  flash(x: number, y: number, z: number, size: number): void;
  shake(a: number): void;
}

export interface LanternParts {
  head: THREE.Object3D[]; // everything above the base: lit box, roof...
  pillar: THREE.Object3D;
  light?: THREE.PointLight;
  solid: { r: number; h: number };
  onBreak?: () => void;
  onRestore?: () => void;
}

export interface StalkParts {
  mesh: THREE.InstancedMesh;
  idx: number;
  h: number; // height multiplier of the stalk (7 m * h)
  leaves: THREE.InstancedMesh;
  leafStart: number;
  leafCount: number;
  map: THREE.Texture;
}

export interface ThinParts {
  pole: THREE.Mesh; // centred cylinder / box of height H
  H: number;
  base: THREE.Vector3; // where it meets the ground
  topGeo: (len: number) => THREE.BufferGeometry;
  extras?: THREE.Object3D[]; // a banner's bar and cloth, carried by the falling top
  solid?: { r: number; h: number };
  dark?: boolean;
}

type Kind = 'tree' | 'rock' | 'lantern' | 'pillar' | 'stalk' | 'thin';

interface Prop {
  kind: Kind;
  segs: Seg[];
  cx: number;
  cz: number;
  reach: number;
  hp: number;
  maxHp: number;
  broken: boolean;
  token: object | null;
  lastSnd: number;
  tree?: number;
  canopy?: Canopy;
  lantern?: LanternParts;
  stalk?: StalkParts;
  thin?: ThinParts;
  red?: boolean; // lacquered pillar
  saved?: unknown; // original state, for reset
}

// ---------------------------------------------------------------------------
// Debris: one instanced mesh per shape, a ring of fixed slots
// ---------------------------------------------------------------------------
interface Deb {
  on: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ex: number;
  ey: number;
  ez: number;
  wx: number;
  wy: number;
  wz: number;
  sx: number;
  sy: number;
  sz: number;
  age: number;
  life: number;
  leaf: boolean;
  rest: boolean;
  ph: number;
  gy: number; // resting height
}

const dM = new THREE.Matrix4();
const dQ = new THREE.Quaternion();
const dE = new THREE.Euler();
const dP = new THREE.Vector3();
const dS = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class DebrisPool {
  mesh: THREE.InstancedMesh;
  private items: Deb[] = [];
  private head = 0;
  private dirty = false;
  private active = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = n;
    for (let i = 0; i < n; i++) {
      this.items.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ex: 0, ey: 0, ez: 0, wx: 0, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0, age: 0, life: 1, leaf: false, rest: false, ph: 0, gy: 0 });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(o: Partial<Deb>, color: THREE.Color) {
    const i = this.head++ % this.items.length;
    const d = this.items[i];
    Object.assign(d, { on: true, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, ex: Math.random() * 6, ey: Math.random() * 6, ez: Math.random() * 6, sx: 0.05, sy: 0.05, sz: 0.05, age: 0, life: 6, leaf: false, rest: false, ph: Math.random() * 6.28, gy: 0.03 }, o);
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = true;
  }

  clear() {
    this.items.forEach((d, i) => {
      if (d.on) this.mesh.setMatrixAt(i, ZERO);
      d.on = false;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, windX: number) {
    if (!this.dirty && this.active === 0) return;
    let active = 0;
    for (let i = 0; i < this.items.length; i++) {
      const d = this.items[i];
      if (!d.on) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.on = false;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      active++;
      if (!d.rest) {
        if (d.leaf) {
          // a leaf drifts down: slow fall, side-to-side sway, a push from the wind
          d.vy = Math.max(d.vy - 3 * dt, -1.1);
          d.vx += (Math.sin(d.age * 3 + d.ph) * 0.9 + windX) * dt;
          d.vz += Math.cos(d.age * 2.3 + d.ph) * 0.7 * dt;
          d.vx *= 1 - 0.8 * dt;
          d.vz *= 1 - 0.8 * dt;
        } else d.vy -= 9.8 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.ex += d.wx * dt;
        d.ey += d.wy * dt;
        d.ez += d.wz * dt;
        if (d.y <= d.gy) {
          d.y = d.gy;
          if (d.leaf || Math.abs(d.vy) < 0.7) {
            d.rest = true;
            d.vx = d.vy = d.vz = 0;
          } else {
            d.vy = -d.vy * 0.33;
            d.vx *= 0.55;
            d.vz *= 0.55;
            d.wx *= 0.5;
            d.wy *= 0.5;
            d.wz *= 0.5;
          }
        }
      }
      const fade = Math.min(1, (d.life - d.age) / 1.0);
      dM.compose(dP.set(d.x, d.y, d.z), dQ.setFromEuler(dE.set(d.ex, d.ey, d.ez)), dS.set(d.sx * fade, d.sy * fade, d.sz * fade));
      this.mesh.setMatrixAt(i, dM);
    }
    this.active = active;
    this.dirty = false;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Sparks: additive points with a velocity, gravity and a bounce
class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private head = 0;
  private live = 0;
  private n: number;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    // a soft round dot, not the default square
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cg = c.getContext('2d')!;
    const gr = cg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = gr;
    cg.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.09, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number) {
    const i = this.head++ % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b], i * 3);
    this.life[i] = life;
    this.live++;
  }

  update(dt: number) {
    if (this.live <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999;
        continue;
      }
      alive++;
      this.vel[k + 1] -= 9.5 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] = Math.abs(this.vel[k + 1]) * 0.38;
        this.vel[k] *= 0.6;
        this.vel[k + 2] *= 0.6;
      }
      // cool from white-yellow toward orange as it dies
      const f = Math.min(1, this.life[i] * 3);
      this.col[k] *= 0.5 + 0.5 * f;
      this.col[k + 1] *= 0.35 + 0.65 * f;
      this.col[k + 2] *= 0.2 + 0.8 * f;
    }
    this.live = alive;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(-999);
    this.live = 1;
    this.update(0.001);
    this.live = 0;
  }
}

// A cut-off top toppling over its base like a rod (inverted pendulum), then lying still
interface Fall {
  g: THREE.Group;
  axis: THREE.Vector3;
  theta: number;
  omega: number;
  len: number;
  landed: boolean;
  tip: THREE.Vector3;
  geos: THREE.BufferGeometry[];
}

const cA = new THREE.Vector3();
const cB = new THREE.Vector3();
const c1 = new THREE.Vector3();
const c2 = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpN = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const tmpY = new THREE.Vector3();
const basis = new THREE.Matrix4();

interface Contact {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  seg: Seg;
}

const rnd = (a: number, b: number) => a + (b - a) * Math.random();

export class PropSystem {
  readonly root = new THREE.Group();
  /** per-tree crown sway amplitude, read by the foliage shader (see World.addShake) */
  readonly treeShake = new Float32Array(32);
  fx: PropFx | null = null;
  private props: Prop[] = [];
  private leaves: DebrisPool;
  private chips: DebrisPool;
  private twigs: DebrisPool;
  private stones: DebrisPool;
  private sparks: Sparks;
  private marks: THREE.InstancedMesh;
  private markHead = 0;
  private falls: Fall[] = [];
  private q = 1;
  private windX = 0.25;
  private ground = (_x: number, _z: number) => 0;

  constructor(parent: THREE.Object3D) {
    parent.add(this.root);
    const leafG = new THREE.CircleGeometry(1, 6);
    const leafM = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    this.leaves = new DebrisPool(leafG, leafM, 260);
    this.chips = new DebrisPool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 170);
    this.twigs = new DebrisPool(new THREE.CylinderGeometry(0.5, 0.8, 1, 5), new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x6b4a30 }), 48);
    this.stones = new DebrisPool(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), 72);
    this.sparks = new Sparks(160);
    // pale gashes on bark and lacquer
    this.marks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.6, 0.38), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      90
    );
    this.marks.frustumCulled = false;
    this.marks.count = 90;
    for (let i = 0; i < 90; i++) this.marks.setMatrixAt(i, ZERO);
    this.root.add(this.leaves.mesh, this.chips.mesh, this.twigs.mesh, this.stones.mesh, this.sparks.points, this.marks);
  }

  /** 1 high, ~0.6 medium, ~0.35 low: scales how much debris a hit throws */
  setQuality(q: number) {
    this.q = q;
  }

  // ------------------------------------------------------------------ registration
  addTree(idx: number, trunk: Seg[], limbs: Seg[], canopy: Canopy) {
    const segs = [...trunk, ...limbs.map((s) => ({ ...s, limb: true }))];
    this.register({ kind: 'tree', segs, tree: idx, canopy });
  }

  addRock(x: number, z: number, s: number) {
    const r = s * 1.0;
    this.register({ kind: 'rock', segs: [{ a: new THREE.Vector3(x, 0.05, z), b: new THREE.Vector3(x, s * 0.9, z), r }] });
  }

  addLantern(x: number, z: number, parts: LanternParts) {
    const p = this.register({ kind: 'lantern', segs: [{ a: new THREE.Vector3(x, 0.05, z), b: new THREE.Vector3(x, 2.2, z), r: 0.46 }], lantern: parts, hp: 9 });
    p.saved = { hr: parts.light?.intensity ?? 0, sr: parts.solid.r, sh: parts.solid.h };
  }

  addPillar(x: number, z: number, y0: number, y1: number, r: number, red: boolean) {
    this.register({ kind: 'pillar', segs: [{ a: new THREE.Vector3(x, y0, z), b: new THREE.Vector3(x, y1, z), r }], red });
  }

  addStalk(foot: THREE.Vector3, crown: THREE.Vector3, parts: StalkParts) {
    const p = this.register({ kind: 'stalk', segs: [{ a: foot.clone(), b: crown.clone(), r: 0.085 }], stalk: parts });
    const base = new THREE.Matrix4();
    parts.mesh.getMatrixAt(parts.idx, base);
    const leafMats: THREE.Matrix4[] = [];
    for (let i = 0; i < parts.leafCount; i++) {
      const m = new THREE.Matrix4();
      parts.leaves.getMatrixAt(parts.leafStart + i, m);
      leafMats.push(m);
    }
    p.saved = { base, leafMats };
  }

  addThin(parts: ThinParts, hp: number, r: number) {
    const x = parts.base.x;
    const z = parts.base.z;
    const p = this.register({ kind: 'thin', segs: [{ a: new THREE.Vector3(x, parts.base.y, z), b: new THREE.Vector3(x, parts.base.y + parts.H, z), r }], thin: parts, hp });
    p.saved = {
      pos: parts.pole.position.clone(),
      scale: parts.pole.scale.clone(),
      extras: (parts.extras ?? []).map((o) => ({ o, parent: o.parent, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() })),
      sr: parts.solid?.r ?? 0,
      sh: parts.solid?.h ?? 0
    };
  }

  private register(o: Partial<Prop> & { kind: Kind; segs: Seg[] }): Prop {
    let cx = 0;
    let cz = 0;
    for (const s of o.segs) {
      cx += (s.a.x + s.b.x) / 2;
      cz += (s.a.z + s.b.z) / 2;
    }
    cx /= o.segs.length;
    cz /= o.segs.length;
    let reach = 0;
    for (const s of o.segs) reach = Math.max(reach, Math.hypot(s.a.x - cx, s.a.z - cz) + s.r, Math.hypot(s.b.x - cx, s.b.z - cz) + s.r);
    const p: Prop = { hp: 1e9, maxHp: 1e9, broken: false, token: null, lastSnd: 0, cx, cz, reach, ...o };
    p.maxHp = p.hp;
    this.props.push(p);
    return p;
  }

  // ------------------------------------------------------------------ the blade test
  /** Test the blade's path this frame against every prop around it. */
  sweep(prev: BladeSeg | null, cur: BladeSeg, hit: PropHit) {
    const mx = (cur.a.x + cur.b.x) / 2;
    const mz = (cur.a.z + cur.b.z) / 2;
    const half = cur.a.distanceTo(cur.b) / 2;
    const move = prev ? Math.max(prev.a.distanceTo(cur.a), prev.b.distanceTo(cur.b)) : 0;
    for (const p of this.props) {
      if (p.token === hit.token || (p.broken && p.kind !== 'tree')) continue;
      const lim = p.reach + half + move + hit.radius + 0.3;
      const dx = p.cx - mx;
      const dz = p.cz - mz;
      if (dx * dx + dz * dz > lim * lim) continue;
      const c = this.contact(p, prev, cur, hit.radius);
      if (!c) continue;
      p.token = hit.token;
      let dirX = 0;
      let dirZ = 0;
      if (prev) {
        dirX = cur.b.x - prev.b.x;
        dirZ = cur.b.z - prev.b.z;
        const l = Math.hypot(dirX, dirZ);
        if (l > 1e-3) {
          dirX /= l;
          dirZ /= l;
        } else {
          dirX = -c.normal.x;
          dirZ = -c.normal.z;
        }
      } else {
        dirX = -c.normal.x;
        dirZ = -c.normal.z;
      }
      this.react(p, c, hit, dirX, dirZ);
    }
  }

  private contact(p: Prop, prev: BladeSeg | null, cur: BladeSeg, radius: number): Contact | null {
    const n = prev ? Math.min(10, Math.max(1, Math.ceil(Math.max(prev.a.distanceTo(cur.a), prev.b.distanceTo(cur.b)) / 0.25))) : 1;
    for (let k = 1; k <= n; k++) {
      if (prev) bladeLerp(prev, cur, k / n, cA, cB);
      else {
        cA.copy(cur.a);
        cB.copy(cur.b);
      }
      for (const s of p.segs) {
        const lim = s.r + radius + 0.02;
        const d2 = closestSegSeg(cA, cB, s.a, s.b, c1, c2);
        if (d2 > lim * lim) continue;
        const d = Math.sqrt(d2);
        const nrm = new THREE.Vector3().subVectors(c1, c2);
        if (d > 1e-4) nrm.multiplyScalar(1 / d);
        else nrm.set(cB.x - cA.x, 0, cB.z - cA.z).normalize();
        nrm.y *= 0.2;
        nrm.normalize();
        return { point: c2.clone().addScaledVector(nrm, s.r), normal: nrm, seg: s };
      }
    }
    return null;
  }

  /** A blast: everything inside the radius reacts at full power */
  explode(x: number, y: number, z: number, radius: number, power = 10) {
    const tok = {};
    for (const p of this.props) {
      if (p.broken && p.kind !== 'tree') continue;
      const d = Math.hypot(p.cx - x, p.cz - z);
      if (d > radius + p.reach) continue;
      const s = p.segs[0];
      const nrm = new THREE.Vector3(x - p.cx, 0, z - p.cz).normalize();
      const c: Contact = { point: new THREE.Vector3(p.cx, Math.min(Math.max(y, s.a.y), s.b.y), p.cz).addScaledVector(nrm, s.r), normal: nrm, seg: s };
      p.token = tok;
      this.react(p, c, { power, edged: false, token: tok, radius: 0 }, -nrm.x, -nrm.z);
    }
  }

  // ------------------------------------------------------------------ reactions
  private react(p: Prop, c: Contact, hit: PropHit, dirX: number, dirZ: number) {
    const now = performance.now();
    const loud = now - p.lastSnd > 90;
    if (loud) p.lastSnd = now;
    switch (p.kind) {
      case 'rock':
        this.stoneHit(c, hit, dirX, dirZ, loud);
        break;
      case 'lantern':
        this.stoneHit(c, hit, dirX, dirZ, loud);
        // a plain swing barely scratches stone; heavy blows, specials, bombs and the Oni's sword break it
        p.hp -= hit.power >= 10 ? 99 : hit.power * hit.power * 0.45 * (hit.edged ? 1 : 0.8);
        if (p.hp <= 0) this.breakLantern(p, dirX, dirZ);
        break;
      case 'tree':
        if (c.seg.limb) this.limbHit(p, c, hit, dirX, dirZ, loud);
        else this.trunkHit(p, c, hit, dirX, dirZ, loud);
        break;
      case 'pillar':
        this.woodHit(c, hit, dirX, dirZ, loud, p.red ? 0xb0261c : 0xc9a36a, true);
        break;
      case 'stalk':
        if (hit.edged || hit.power >= 2) this.cutStalk(p, c, dirX, dirZ);
        else if (loud) {
          this.shedBamboo(p, c.point, 4);
          sfx.leaves();
        }
        break;
      case 'thin':
        this.woodHit(c, hit, dirX, dirZ, loud, p.thin?.dark ? 0x5a3a24 : 0xc9a36a, false);
        p.hp -= hit.power >= 10 ? 99 : hit.power * (hit.edged ? 1 : 0.7);
        if (p.hp <= 0) this.breakThin(p, c, dirX, dirZ);
        break;
    }
  }

  private count(n: number) {
    return Math.max(1, Math.round(n * this.q));
  }

  private stoneHit(c: Contact, hit: PropHit, dirX: number, dirZ: number, loud: boolean) {
    const P = c.point;
    const N = c.normal;
    const pw = Math.min(hit.power, 3);
    if (hit.edged) {
      // steel on stone: a spray along the blade's travel, bent away from the surface
      const n = this.count(10 + 9 * pw);
      for (let i = 0; i < n; i++) {
        const sp = rnd(3, 8 + 2 * pw);
        tmpV.set(dirX * 0.7 + N.x * 0.9 + rnd(-0.45, 0.45), rnd(0.15, 0.95), dirZ * 0.7 + N.z * 0.9 + rnd(-0.45, 0.45)).normalize().multiplyScalar(sp);
        const w = Math.random();
        this.sparks.emit(P.x, P.y, P.z, tmpV.x, tmpV.y, tmpV.z, rnd(0.25, 0.6), 1.5 + 0.6 * w, 0.95 + 0.5 * w, 0.3 + 0.4 * w);
      }
      this.fx?.flash(P.x, P.y, P.z, 0.28 + 0.1 * pw);
      if (loud) sfx.stone(pw);
    } else if (loud) sfx.thud(pw);
    const chips = this.count(2 + 2 * pw);
    for (let i = 0; i < chips; i++) this.chip(P, N, dirX, dirZ, tmpC.setHSL(0.08, 0.05, rnd(0.28, 0.55)), 0.025, 0.06);
    this.fx?.dust(P.x, P.z, 2 + Math.round(pw), 1.2, N.x, N.z);
  }

  private chip(P: THREE.Vector3, N: THREE.Vector3, dirX: number, dirZ: number, color: THREE.Color, s0: number, s1: number) {
    const sp = rnd(1.2, 4);
    this.chips.spawn(
      {
        x: P.x,
        y: P.y,
        z: P.z,
        vx: (N.x * 0.8 + dirX * 0.5 + rnd(-0.5, 0.5)) * sp,
        vy: rnd(0.5, 2.6),
        vz: (N.z * 0.8 + dirZ * 0.5 + rnd(-0.5, 0.5)) * sp,
        wx: rnd(-14, 14),
        wy: rnd(-14, 14),
        wz: rnd(-14, 14),
        sx: rnd(s0, s1),
        sy: rnd(s0, s1) * 0.6,
        sz: rnd(s0, s1) * 1.4,
        life: rnd(4, 7),
        gy: 0.02
      },
      color
    );
  }

  private trunkHit(p: Prop, c: Contact, hit: PropHit, dirX: number, dirZ: number, loud: boolean) {
    const pw = Math.min(hit.power, 3);
    const P = c.point;
    const chips = this.count((5 + 4 * pw) * (hit.edged ? 1 : 0.5));
    for (let i = 0; i < chips; i++) this.chip(P, c.normal, dirX, dirZ, tmpC.setHSL(0.07, 0.4, rnd(0.14, 0.32)), 0.02, 0.055);
    if (hit.edged) this.mark(P, c.normal, dirX, dirZ, 1 + (pw >= 2 ? 1 : 0));
    this.fx?.dust(P.x, P.z, 2, 1, c.normal.x, c.normal.z);
    this.shed(p, (hit.edged ? 1 : 0.7) * pw, true);
    if (loud) sfx.wood(pw);
  }

  private limbHit(p: Prop, c: Contact, hit: PropHit, dirX: number, dirZ: number, loud: boolean) {
    const pw = Math.min(hit.power, 3);
    const P = c.point;
    for (let i = 0; i < this.count(3 + 2 * pw); i++) this.chip(P, c.normal, dirX, dirZ, tmpC.setHSL(0.07, 0.4, rnd(0.16, 0.3)), 0.015, 0.04);
    // a snapped twig with its leaves, and a bigger shower from around the hit
    const twigs = hit.edged ? 1 + Math.round(pw * 0.7) : 1;
    for (let i = 0; i < twigs; i++) this.twig(P, dirX, dirZ);
    this.leafBurst(p, P, this.count(8 + 6 * pw));
    this.shed(p, pw * 0.7, false);
    if (loud) {
      sfx.crack();
      sfx.leaves();
    }
  }

  private twig(P: THREE.Vector3, dirX: number, dirZ: number) {
    const len = rnd(0.28, 0.7);
    this.twigs.spawn(
      {
        x: P.x,
        y: P.y,
        z: P.z,
        vx: dirX * rnd(0.3, 1.4) + rnd(-0.6, 0.6),
        vy: rnd(0, 1.2),
        vz: dirZ * rnd(0.3, 1.4) + rnd(-0.6, 0.6),
        wx: rnd(-6, 6),
        wy: rnd(-4, 4),
        wz: rnd(-6, 6),
        sx: 0.025,
        sy: len,
        sz: 0.025,
        life: rnd(6, 9),
        gy: 0.03
      },
      tmpC.setHSL(0.08, 0.35, rnd(0.16, 0.26))
    );
  }

  private leafColor(pink: boolean) {
    return pink ? tmpC.setHSL(0.95 + rnd(-0.02, 0.02), rnd(0.2, 0.45), rnd(0.8, 0.94)) : tmpC.setHSL(0.3 + rnd(-0.03, 0.03), rnd(0.35, 0.55), rnd(0.28, 0.42));
  }

  private leaf(x: number, y: number, z: number, pink: boolean, vx = 0, vz = 0) {
    this.leaves.spawn(
      {
        x,
        y,
        z,
        vx: vx + rnd(-0.4, 0.4),
        vy: rnd(-0.4, 0.3),
        vz: vz + rnd(-0.4, 0.4),
        wx: rnd(-5, 5),
        wy: rnd(-5, 5),
        wz: rnd(-5, 5),
        sx: pink ? rnd(0.06, 0.09) : 0.014,
        sy: pink ? rnd(0.045, 0.07) : rnd(0.07, 0.1),
        sz: 1,
        leaf: true,
        life: rnd(7, 11),
        gy: 0.015
      },
      this.leafColor(pink)
    );
  }

  /** Shake a tree: its crown sways and lets go of leaves / petals */
  private shed(p: Prop, power: number, trunk: boolean) {
    if (p.tree !== undefined) this.treeShake[p.tree] = Math.min(0.5, Math.max(this.treeShake[p.tree], 0.12 + 0.09 * power));
    const cn = p.canopy;
    if (!cn) return;
    const n = this.count((7 + 8 * power) * (trunk ? 1 : 0.6));
    for (let i = 0; i < n; i++) {
      tmpV.set(rnd(-1, 1), rnd(-0.6, 0.8), rnd(-1, 1));
      if (tmpV.lengthSq() > 1) tmpV.normalize();
      this.leaf(cn.x + tmpV.x * cn.r, cn.y + tmpV.y * cn.r * 0.7, cn.z + tmpV.z * cn.r, cn.pink);
    }
    if (power >= 1.5 || Math.random() < 0.35) {
      const k = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < k; i++) {
        tmpV.set(rnd(-1, 1), rnd(-0.3, 0.5), rnd(-1, 1)).normalize();
        this.twig(dP.set(cn.x + tmpV.x * cn.r, cn.y + tmpV.y * cn.r * 0.6, cn.z + tmpV.z * cn.r), tmpV.x, tmpV.z);
      }
    }
    sfx.leaves();
  }

  private leafBurst(p: Prop, P: THREE.Vector3, n: number) {
    const pink = p.canopy?.pink ?? false;
    for (let i = 0; i < n; i++) this.leaf(P.x + rnd(-0.5, 0.5), P.y + rnd(-0.2, 0.7), P.z + rnd(-0.5, 0.5), pink, rnd(-0.6, 0.6), rnd(-0.6, 0.6));
  }

  /** Pale gashes on a trunk or pillar, lying flat on the surface and following the blade */
  private mark(P: THREE.Vector3, N: THREE.Vector3, dirX: number, dirZ: number, n: number) {
    for (let k = 0; k < n; k++) {
      // tangent: the blade's direction with the normal component removed
      tmpT.set(dirX, rnd(-0.5, 0.5), dirZ);
      tmpT.addScaledVector(N, -tmpT.dot(N));
      if (tmpT.lengthSq() < 1e-4) tmpT.set(0, 1, 0).addScaledVector(N, -N.y);
      tmpT.normalize();
      tmpY.crossVectors(N, tmpT).normalize();
      basis.makeBasis(tmpT, tmpY, N);
      dQ.setFromRotationMatrix(basis);
      const off = (k - (n - 1) / 2) * 0.09 + rnd(-0.02, 0.02);
      dP.copy(P).addScaledVector(tmpY, off).addScaledVector(N, 0.006);
      dM.compose(dP, dQ, dS.set(rnd(0.12, 0.2), rnd(0.014, 0.026), 1));
      this.marks.setMatrixAt(this.markHead++ % 90, dM);
    }
    this.marks.instanceMatrix.needsUpdate = true;
  }

  private woodHit(c: Contact, hit: PropHit, dirX: number, dirZ: number, loud: boolean, flake: number, decal: boolean) {
    const pw = Math.min(hit.power, 3);
    const P = c.point;
    const n = this.count((4 + 4 * pw) * (hit.edged ? 1 : 0.6));
    for (let i = 0; i < n; i++) this.chip(P, c.normal, dirX, dirZ, tmpC.set(flake).offsetHSL(rnd(-0.02, 0.02), 0, rnd(-0.08, 0.1)), 0.015, 0.05);
    if (decal && hit.edged) this.mark(P, c.normal, dirX, dirZ, 1 + (pw >= 2 ? 1 : 0));
    this.fx?.dust(P.x, P.z, 2, 1, c.normal.x, c.normal.z);
    if (loud) sfx.wood(pw);
  }

  // ------------------------------------------------------------------ breaking
  private breakLantern(p: Prop, dirX: number, dirZ: number) {
    const L = p.lantern!;
    p.broken = true;
    L.head.forEach((o) => (o.visible = false));
    L.pillar.visible = false;
    if (L.light) L.light.intensity = 0;
    L.solid.r = 0.5;
    L.solid.h = 0.3;
    L.onBreak?.();
    const s = p.segs[0];
    const x = s.a.x;
    const z = s.a.z;
    const n = this.count(18);
    for (let i = 0; i < n; i++) {
      const big = i < 5;
      const sz = big ? rnd(0.12, 0.24) : rnd(0.04, 0.1);
      tmpV.set(rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1)).normalize();
      this.stones.spawn(
        {
          x: x + rnd(-0.2, 0.2),
          y: rnd(0.5, 2.1),
          z: z + rnd(-0.2, 0.2),
          vx: (tmpV.x * 2.4 + dirX * 1.6) * (big ? 0.6 : 1),
          vy: tmpV.y * 3,
          vz: (tmpV.z * 2.4 + dirZ * 1.6) * (big ? 0.6 : 1),
          wx: rnd(-8, 8),
          wy: rnd(-8, 8),
          wz: rnd(-8, 8),
          sx: sz * rnd(0.8, 1.3),
          sy: sz * rnd(0.6, 1),
          sz: sz * rnd(0.8, 1.3),
          life: rnd(20, 30),
          gy: sz * 0.5
        },
        tmpC.setHSL(0.08, 0.05, rnd(0.25, 0.5))
      );
    }
    this.fx?.dust(x, z, 16, 3);
    this.fx?.flash(x, 1.6, z, 1.6);
    this.fx?.shake(0.3);
    sfx.rubble();
  }

  private cutStalk(p: Prop, c: Contact, dirX: number, dirZ: number) {
    const S = p.stalk!;
    p.broken = true;
    const H = 7 * S.h;
    const cutY = Math.min(Math.max(c.point.y, 0.7), H - 0.9);
    const base = (p.saved as { base: THREE.Matrix4 }).base;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    base.decompose(pos, quat, scl);
    // the stump keeps the stalk's bottom part
    S.mesh.setMatrixAt(S.idx, new THREE.Matrix4().compose(pos, quat, scl.set(scl.x, cutY / 7, scl.z)));
    S.mesh.instanceMatrix.needsUpdate = true;
    // its crown of leaves goes with the top
    for (let i = 0; i < S.leafCount; i++) S.leaves.setMatrixAt(S.leafStart + i, ZERO);
    S.leaves.instanceMatrix.needsUpdate = true;
    // the top: a cylinder with a handful of leaf blades, toppling along the blade's travel
    const len = H - cutY;
    const geo = new THREE.CylinderGeometry(0.062, 0.07, len, 7).translate(0, len / 2, 0);
    const g = new THREE.Group();
    g.position.set(pos.x, cutY, pos.z);
    const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: S.map, roughness: 0.55 }));
    top.castShadow = true;
    g.add(top);
    const leafGeo = new THREE.PlaneGeometry(0.12, 0.8).translate(0, -0.36, 0);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x5c8a38, side: THREE.DoubleSide, roughness: 0.7 });
    const blades = new THREE.InstancedMesh(leafGeo, leafMat, 22);
    for (let i = 0; i < 22; i++) {
      dM.compose(dP.set(rnd(-0.3, 0.3), len * rnd(0.6, 1), rnd(-0.3, 0.3)), dQ.setFromEuler(dE.set(rnd(0.6, 1.4), (i / 22) * 6.28, rnd(-0.3, 0.3))), dS.setScalar(rnd(0.8, 1.2)));
      blades.setMatrixAt(i, dM);
    }
    g.add(blades);
    this.root.add(g);
    this.addFall(g, dirX, dirZ, len, [geo, leafGeo], [top.material as THREE.Material, leafMat]);
    // splinters, a burst of leaves and the snap
    const hp = c.point;
    for (let i = 0; i < this.count(8); i++) this.chip(hp, c.normal, dirX, dirZ, tmpC.setHSL(0.2 + rnd(-0.02, 0.03), 0.45, rnd(0.35, 0.55)), 0.012, 0.035);
    for (let i = 0; i < this.count(12); i++) this.leaf(pos.x + rnd(-0.4, 0.4), cutY + len * rnd(0.55, 1), pos.z + rnd(-0.4, 0.4), false, dirX * 0.5, dirZ * 0.5);
    sfx.crack();
    sfx.leaves();
  }

  private shedBamboo(p: Prop, P: THREE.Vector3, n: number) {
    for (let i = 0; i < this.count(n); i++) this.leaf(P.x + rnd(-0.3, 0.3), P.y + rnd(0.5, 2.5), P.z + rnd(-0.3, 0.3), false);
  }

  private breakThin(p: Prop, c: Contact, dirX: number, dirZ: number) {
    const T = p.thin!;
    p.broken = true;
    const cutY = Math.min(Math.max(c.point.y - T.base.y, 0.28), T.H * 0.75);
    T.pole.scale.y = cutY / T.H;
    T.pole.position.y = T.base.y + cutY / 2;
    if (T.solid) {
      T.solid.r = 0.25;
      T.solid.h = cutY;
    }
    const len = T.H - cutY;
    const geo = T.topGeo(len);
    const g = new THREE.Group();
    g.position.set(T.base.x, T.base.y + cutY, T.base.z);
    const top = new THREE.Mesh(geo, T.pole.material);
    top.position.y = len / 2;
    top.castShadow = true;
    g.add(top);
    this.root.add(g);
    // a banner's bar and cloth ride along with the top
    for (const o of T.extras ?? []) {
      g.attach(o);
    }
    this.addFall(g, dirX, dirZ, len, [geo], []);
    const hp = c.point;
    for (let i = 0; i < this.count(10); i++) this.chip(hp, c.normal, dirX, dirZ, tmpC.set(0xc9a36a).offsetHSL(rnd(-0.02, 0.02), 0, rnd(-0.1, 0.08)), 0.015, 0.05);
    this.fx?.dust(hp.x, hp.z, 6, 2, dirX, dirZ);
    sfx.crack();
  }

  private addFall(g: THREE.Group, dirX: number, dirZ: number, len: number, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
    const l = Math.hypot(dirX, dirZ) || 1;
    // the blade's travel decides the way it topples, with a little scatter
    const ang = Math.atan2(dirX / l, dirZ / l) + rnd(-0.35, 0.35);
    const fx = Math.sin(ang);
    const fz = Math.cos(ang);
    const f: Fall = { g, axis: new THREE.Vector3(fz, 0, -fx), theta: 0.04, omega: 0.35, len, landed: false, tip: new THREE.Vector3(), geos };
    (f as Fall & { mats: THREE.Material[] }).mats = mats;
    this.falls.push(f);
    // keep the number of lying pieces bounded (the oldest are dropped)
    while (this.falls.length > 14) this.disposeFall(this.falls.shift()!);
  }

  private disposeFall(f: Fall) {
    // extras (banner cloth) are restored by reset(); only what was created here is freed
    f.g.removeFromParent();
    f.geos.forEach((g) => g.dispose());
    ((f as Fall & { mats?: THREE.Material[] }).mats ?? []).forEach((m) => m.dispose());
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    this.leaves.update(dt, this.windX);
    this.chips.update(dt, 0);
    this.twigs.update(dt, 0.1);
    this.stones.update(dt, 0);
    this.sparks.update(dt);
    for (let i = 0; i < this.treeShake.length; i++) if (this.treeShake[i] > 0.0005) this.treeShake[i] *= Math.exp(-dt * 2.4);
    else this.treeShake[i] = 0;
    for (const f of this.falls) {
      if (f.landed) continue;
      // rod pivoting about its foot: angular acceleration grows with the lean
      f.omega += ((3 * 9.8) / (2 * f.len)) * Math.sin(f.theta) * dt;
      f.theta += f.omega * dt;
      const max = 1.5;
      if (f.theta >= max) {
        f.theta = max;
        f.landed = true;
        f.g.getWorldPosition(tmpV);
        const fx = -f.axis.z;
        const fz = f.axis.x;
        this.fx?.dust(tmpV.x + fx * f.len, tmpV.z + fz * f.len, 6, 2);
        sfx.thud(1.5);
      }
      f.g.quaternion.setFromAxisAngle(f.axis, f.theta);
    }
  }

  // ------------------------------------------------------------------ restart
  /** Put everything back: lanterns lit and whole, bamboo standing, poles and posts upright. */
  reset() {
    this.leaves.clear();
    this.chips.clear();
    this.twigs.clear();
    this.stones.clear();
    this.sparks.clear();
    for (let i = 0; i < 90; i++) this.marks.setMatrixAt(i, ZERO);
    this.marks.instanceMatrix.needsUpdate = true;
    this.treeShake.fill(0);
    for (const p of this.props) {
      p.token = null;
      if (p.kind === 'lantern' && p.broken) {
        const L = p.lantern!;
        const s = p.saved as { hr: number; sr: number; sh: number };
        L.head.forEach((o) => (o.visible = true));
        L.pillar.visible = true;
        if (L.light) L.light.intensity = s.hr;
        L.solid.r = s.sr;
        L.solid.h = s.sh;
        L.onRestore?.();
        p.hp = p.maxHp;
        p.broken = false;
      } else if (p.kind === 'stalk' && p.broken) {
        const S = p.stalk!;
        const s = p.saved as { base: THREE.Matrix4; leafMats: THREE.Matrix4[] };
        S.mesh.setMatrixAt(S.idx, s.base);
        S.mesh.instanceMatrix.needsUpdate = true;
        s.leafMats.forEach((m, i) => S.leaves.setMatrixAt(S.leafStart + i, m));
        S.leaves.instanceMatrix.needsUpdate = true;
        p.broken = false;
      } else if (p.kind === 'thin' && p.broken) {
        const T = p.thin!;
        const s = p.saved as { pos: THREE.Vector3; scale: THREE.Vector3; extras: { o: THREE.Object3D; parent: THREE.Object3D | null; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }[]; sr: number; sh: number };
        T.pole.position.copy(s.pos);
        T.pole.scale.copy(s.scale);
        s.extras.forEach((e) => {
          e.parent?.add(e.o);
          e.o.position.copy(e.pos);
          e.o.quaternion.copy(e.quat);
          e.o.scale.copy(e.scale);
        });
        if (T.solid) {
          T.solid.r = s.sr;
          T.solid.h = s.sh;
        }
        p.hp = p.maxHp;
        p.broken = false;
      }
    }
    this.falls.forEach((f) => this.disposeFall(f));
    this.falls = [];
  }
}
