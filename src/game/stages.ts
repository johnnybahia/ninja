import * as THREE from 'three';
import { TAU } from './constants';
import type { Atmos } from './atmosphere';
import type { PropSystem } from './props';
import { MAT } from './rigs';
import { makeRng, rockGeometry } from './shapes';
import { applySurface } from './surfaces';
import { bambooKit } from './garden';
import { Batcher, Solid, WIND_TIME, WorldMats, curvedBeam, curvedRoof, mtx } from './world';

// ===========================================================================
// Stages: places to fight in, each with its own ground, walls, landmarks and air. The temple
// (world.ts) is the first; the others are built here out of the same materials and the same
// kit (stone lanterns, fire bowls, banners, rocks, bamboo), so they add no texture and only a
// handful of draw calls each - everything static is merged per material by the Batcher.
//
// A stage also says where one can stand: `inside` / `confine` replace the temple's round
// arena, `radius` scales the engine's ring logic (where enemies come in, how far a teleport
// may go) and `cam` keeps the camera on the near side of a wall.
//
// Every stage has exactly 4 lit lanterns and 4 fire bowls: the number of point lights never
// changes with the stage, so no lit shader is recompiled when one gives way to the next.
// ===========================================================================

export interface StageCtx {
  b: Batcher;
  group: THREE.Object3D;
  M: WorldMats;
  plazaMat: THREE.Material;
  pathMat: THREE.Material;
  groundMat: THREE.Material;
  props: PropSystem;
  solid(x: number, z: number, r: number, h: number): Solid;
  lantern(x: number, z: number, lit: boolean): void;
  torch(x: number, z: number): void;
  banner(x: number, z: number, ry: number): void;
  rock(x: number, z: number, s: number, seed: number): void;
  /** stonework a blade strikes sparks from: a capsule between two points */
  stone(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number): void;
  /** timber a blade splinters and marks: a capsule between two points (red: lacquered) */
  wood(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, red?: boolean): void;
  /** a standing post that can be cut down, with what it carries (geometry, material, offset from its foot) */
  post(x: number, z: number, H: number, r: number, mat: THREE.Material, extras?: [THREE.BufferGeometry, THREE.Material, number, number, number][], hp?: number): void;
  halo(x: number, y: number, z: number, size: number, k: number): void;
  ember(x: number, y: number, z: number): void;
}

type XZ = { x: number; z: number };

export interface StageDef {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** reach of the playable ground from the centre (the temple's is 40) */
  radius: number;
  /** where the player stands when the stage opens */
  start: [number, number];
  /** the atmosphere that suits it (index into ATMOSPHERES), used while the game cycles them by itself */
  atmos?: number;
  /** false hides the shared earth disc (a lake has water instead) */
  ground?: boolean;
  /** view-distance multiplier on the atmosphere's fog */
  fog?: number;
  inside(x: number, z: number, pad: number): boolean;
  confine(pos: XZ, r: number): void;
  cam?(pos: XZ): void;
  build?(c: StageCtx): void;
  update?(time: number, atm: Atmos, focus: THREE.Vector3): void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const circle = (R: number) => ({
  inside: (x: number, z: number, pad: number) => Math.hypot(x, z) < R - pad,
  confine: (pos: XZ, r: number) => {
    const d = Math.hypot(pos.x, pos.z);
    if (d > R - r) {
      pos.x *= (R - r) / d;
      pos.z *= (R - r) / d;
    }
  }
});

const square = (H: number) => ({
  inside: (x: number, z: number, pad: number) => Math.abs(x) < H - pad && Math.abs(z) < H - pad,
  confine: (pos: XZ, r: number) => {
    pos.x = clamp(pos.x, -(H - r), H - r);
    pos.z = clamp(pos.z, -(H - r), H - r);
  }
});

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);

// A torii of any size at (x, z), turned by ry: pillars (solid, and marked by blades) and the two beams
function torii(c: StageCtx, x: number, z: number, ry: number, k: number, solid = true) {
  const T = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const at = (m: THREE.Matrix4) => T.clone().multiply(m);
  for (const px of [-3.3 * k, 3.3 * k]) {
    c.b.add(cyl(0.3 * k, 0.36 * k, 6.2 * k, 16), c.M.torii, at(mtx(px, 3.1 * k, 0)));
    c.b.add(cyl(0.42 * k, 0.46 * k, 0.5 * k, 16), c.M.dark, at(mtx(px, 0.25 * k, 0)));
    if (solid) {
      const wx = x + Math.cos(ry) * px;
      const wz = z - Math.sin(ry) * px;
      c.solid(wx, wz, 0.55 * k, 7 * k);
      c.props.addPillar(wx, wz, 0.3, 6.2 * k, 0.32 * k, true);
    }
  }
  c.b.add(curvedBeam(10.4 * k, 0.42 * k, 0.85 * k, 0.55 * k), c.M.dark, at(mtx(0, 6.55 * k, 0)));
  c.b.add(curvedBeam(9.4 * k, 0.36 * k, 0.6 * k, 0.35 * k), c.M.torii, at(mtx(0, 6.12 * k, 0)));
  c.b.add(box(8.2 * k, 0.34 * k, 0.42 * k), c.M.torii, at(mtx(0, 5.0 * k, 0)));
  c.b.add(box(0.34 * k, 0.8 * k, 0.3 * k), c.M.torii, at(mtx(0, 5.55 * k, 0)));
}

// ---------------------------------------------------------------------------
// 竹 Bambuzal: a round clearing closed in by a wall of bamboo, with a wayside shrine. Small
// (half the temple's reach) and dim: the fight is close, and the clumps inside can be cut down.
// ---------------------------------------------------------------------------
const BAMBOO_R = 20;

function buildBamboo(c: StageCtx) {
  const rng = makeRng(7719);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const kit = bambooKit(WIND_TIME);
  const d = new THREE.Object3D();
  const col = new THREE.Color();

  // the wall: thicker and taller than the garden's stalks, denser toward the clearing
  const N = 360;
  const per = 14; // leaf blades per stalk
  const wall = new THREE.InstancedMesh(kit.stalkG, kit.stalkM, N);
  const wallLeaves = new THREE.InstancedMesh(kit.leafG, kit.leafM, N * per);
  const wallBase = new THREE.Vector3();
  const wallTop = new THREE.Vector3();
  let li = 0;
  for (let i = 0; i < N; i++) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 8; k++) {
      const a = R(0, TAU);
      const r = BAMBOO_R + 1.6 + 14 * Math.pow(rng(), 1.7);
      x = Math.sin(a) * r;
      z = Math.cos(a) * r;
      if (!(Math.abs(x) < 2.3 && z > 0)) break; // the path in stays open
    }
    const h = R(1.25, 1.95);
    d.position.set(x, 0, z);
    d.rotation.set(R(-0.07, 0.07), R(0, TAU), R(-0.07, 0.07));
    d.scale.set(R(1.1, 1.7), h, R(1.1, 1.7));
    d.updateMatrix();
    wall.setMatrixAt(i, d.matrix);
    wallTop.set(0, 7, 0).applyMatrix4(d.matrix);
    for (let j = 0; j < per; j++) {
      d.position.set(x + R(-0.8, 0.8), 7 * h * R(0.45, 1.0), z + R(-0.8, 0.8));
      d.rotation.set(R(0.6, 1.4), R(0, TAU), R(-0.3, 0.3));
      d.scale.setScalar(R(1.3, 2.0));
      d.updateMatrix();
      wallLeaves.setMatrixAt(li, d.matrix);
      wallLeaves.setColorAt(li++, col.setHSL(0.25 + R(-0.03, 0.03), 0.5, R(0.26, 0.42)));
    }
    // the front rows are within a blade's reach: they can be cut like the clumps
    if (Math.hypot(x, z) < BAMBOO_R + 3.4) c.props.addStalk(wallBase.set(x, 0, z), wallTop, { mesh: wall, idx: i, h, leaves: wallLeaves, leafStart: i * per, leafCount: per, map: kit.tex });
  }
  wall.castShadow = true;
  c.group.add(wall, wallLeaves);

  // clumps inside the clearing: cover to fight around, and every stalk can be cut
  const clumps: [number, number][] = [[-12.5, -5.5], [13, -3.5], [-11, 9.5], [11.5, 10.5], [-5.5, 15], [7, -15.5]];
  const stalkM: THREE.Matrix4[] = [];
  const spots: THREE.Vector3[] = [];
  for (const [cx, cz] of clumps) {
    for (let i = 0; i < 5; i++) {
      const x = cx + R(-0.6, 0.6);
      const z = cz + R(-0.6, 0.6);
      const h = R(0.85, 1.15);
      d.position.set(x, 0, z);
      d.rotation.set(R(-0.06, 0.06), R(0, TAU), R(-0.06, 0.06));
      d.scale.set(1, h, 1);
      d.updateMatrix();
      stalkM.push(d.matrix.clone());
      for (let l = 0; l < 4; l++) spots.push(new THREE.Vector3(x + R(-0.5, 0.5), 7 * h * R(0.55, 1.0), z + R(-0.5, 0.5)));
    }
    c.solid(cx, cz, 0.9, 7);
  }
  const perSpot = 9;
  const stalks = new THREE.InstancedMesh(kit.stalkG, kit.stalkM, stalkM.length);
  stalkM.forEach((m, i) => stalks.setMatrixAt(i, m));
  stalks.castShadow = true;
  const leaves = new THREE.InstancedMesh(kit.leafG, kit.leafM, spots.length * perSpot);
  li = 0;
  for (const s of spots) {
    for (let j = 0; j < perSpot; j++) {
      d.position.copy(s);
      d.rotation.set(R(0.6, 1.4), (j / perSpot) * TAU + R(-0.3, 0.3), R(-0.3, 0.3));
      d.scale.setScalar(R(0.8, 1.2));
      d.updateMatrix();
      leaves.setMatrixAt(li, d.matrix);
      leaves.setColorAt(li++, col.setHSL(0.25 + R(-0.03, 0.03), 0.5, R(0.32, 0.46)));
    }
  }
  leaves.castShadow = true;
  c.group.add(stalks, leaves);
  const base = new THREE.Vector3();
  const top = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  stalkM.forEach((m, idx) => {
    m.decompose(base, q, sc);
    top.set(0, 7, 0).applyMatrix4(m);
    c.props.addStalk(base, top, { mesh: stalks, idx, h: sc.y, leaves, leafStart: idx * 4 * perSpot, leafCount: 4 * perSpot, map: kit.tex });
  });

  // a round stone court in the middle and stepping stones from the way in to the shrine
  const court = new THREE.Mesh(new THREE.CircleGeometry(5.6, 40).rotateX(-Math.PI / 2), c.pathMat);
  court.position.y = 0.025;
  court.receiveShadow = true;
  c.group.add(court);
  const curb = new THREE.Mesh(new THREE.TorusGeometry(5.65, 0.13, 8, 72).rotateX(Math.PI / 2), c.M.stoneDark);
  curb.position.y = 0.04;
  curb.scale.y = 0.6;
  curb.receiveShadow = true;
  c.group.add(curb);
  for (let z = 19; z > -11.5; z -= 1.25) {
    if (Math.abs(z) < 6.2) continue;
    const s = R(0.5, 0.72);
    c.b.add(cyl(s, s * 1.05, 0.08, 7), c.M.stone, mtx(R(-0.35, 0.35), 0.04, z, 0, R(0, TAU), 0, 1, 1, R(0.8, 1.1)));
  }

  // hokora: a small roofed shrine on a stone base, with a torii of its own
  const sz = -15.2;
  c.b.add(box(3.6, 0.5, 3.0), c.M.stone, mtx(0, 0.25, sz));
  c.b.add(box(2.9, 0.3, 2.4), c.M.stoneDark, mtx(0, 0.65, sz));
  c.b.add(box(2.2, 0.22, 0.6), c.M.stone, mtx(0, 0.11, sz + 1.8));
  c.b.add(box(1.9, 1.5, 1.5), c.M.wood, mtx(0, 1.55, sz));
  c.b.add(box(1.3, 1.1, 0.06), c.M.woodDark, mtx(0, 1.45, sz + 0.76));
  c.b.add(box(0.5, 0.36, 0.05), MAT.glow, mtx(0, 1.55, sz + 0.8));
  for (const px of [-1.05, 1.05]) for (const pz of [-0.85, 0.85]) c.b.add(box(0.16, 1.7, 0.16), c.M.woodDark, mtx(px, 1.6, sz + pz));
  c.b.add(curvedRoof(3.9, 3.3, 1.15, 0.85, 0.4), c.M.roof, mtx(0, 2.4, sz));
  c.b.add(box(2.0, 0.16, 0.2), c.M.dark, mtx(0, 3.56, sz));
  c.solid(0, sz, 2.1, 3.4);
  c.stone(-1.5, 0.35, sz + 0.6, 1.5, 0.35, sz + 0.6, 0.95);
  c.wood(0, 0.9, sz, 0, 2.5, sz, 1.15);
  c.halo(0, 1.6, sz + 1.0, 2.6, 0.7);
  torii(c, 0, -10.4, 0, 0.52);
  torii(c, 0, 17.2, 0, 0.8);

  // jizō statues with red bibs beside the shrine
  for (const [jx, jz, js] of [[-3.5, -13.6, 1], [-4.4, -13.0, 0.82], [3.7, -13.4, 0.9]]) {
    c.b.add(cyl(0.2 * js, 0.26 * js, 0.7 * js, 10), c.M.stone, mtx(jx, 0.35 * js, jz));
    c.b.add(new THREE.SphereGeometry(0.19 * js, 12, 9), c.M.stone, mtx(jx, 0.86 * js, jz));
    c.b.add(box(0.3 * js, 0.2 * js, 0.04), c.M.torii, mtx(jx, 0.6 * js, jz + 0.22 * js, 0.25));
    c.solid(jx, jz, 0.32, 1);
    c.stone(jx, 0.05, jz, jx, 0.95 * js, jz, 0.26 * js);
  }

  const rocks: [number, number, number][] = [[-9.5, -10.5, 1.15], [15, 3.5, 1.0], [-15.5, 2, 0.9], [3.5, 13.5, 0.8], [-6.5, -16.5, 0.85]];
  rocks.forEach(([x, z, s], i) => c.rock(x, z, s, 40 + i));

  c.lantern(-2.5, -7.4, true);
  c.lantern(2.5, -7.4, true);
  c.lantern(-2.5, 8.6, true);
  c.lantern(2.5, 8.6, true);
  c.lantern(-8.6, 0, false);
  c.lantern(8.6, 0, false);
  c.torch(-5.2, -13.2);
  c.torch(5.2, -13.2);
  c.torch(-14.2, -9.5);
  c.torch(14.5, 8);
}

// ---------------------------------------------------------------------------
// 城 Pátio do Castelo: a square paved yard between plastered walls, under the keep. Wide open
// in the middle (nowhere to hide from arrows), with the walls at your back.
// ---------------------------------------------------------------------------
const YARD = 19.9; // half the yard, to the inner face of the walls

function buildCastle(c: StageCtx) {
  const plaster = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.48, 0.43), roughness: 0.92 });
  applySurface(plaster, 'rock', { mode: 'tri', scale: 0.45, normal: 0.35, albedo: 0.22, sat: 0.1 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(YARD * 2 + 1, YARD * 2 + 1).rotateX(-Math.PI / 2), c.plazaMat);
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  c.group.add(floor);

  // a stretch of wall along X centred on (cx, cz), turned by ry: stone footing, black boards,
  // white plaster and a little tiled roof
  const wall = (cx: number, cz: number, len: number, ry: number) => {
    const T = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, 0, cz);
    const at = (m: THREE.Matrix4) => T.clone().multiply(m);
    c.b.add(box(len, 1.2, 1.7), c.M.stone, at(mtx(0, 0.6, 0)));
    c.b.add(box(len, 0.9, 1.06), c.M.woodDark, at(mtx(0, 1.65, 0)));
    c.b.add(box(len, 1.25, 1.0), plaster, at(mtx(0, 2.7, 0)));
    for (const s of [-1, 1]) c.b.add(box(len + 0.3, 0.14, 1.15), c.M.roof, at(mtx(0, 3.62, s * 0.46, s * 0.52, 0, 0)));
    c.b.add(box(len + 0.3, 0.2, 0.24), c.M.dark, at(mtx(0, 3.98, 0)));
    // a blade scraping along the wall: stone below, the black boards above
    const n = Math.ceil(len / 8);
    const dx = Math.cos(ry);
    const dz = -Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const t0 = -len / 2 + (len * i) / n;
      const t1 = -len / 2 + (len * (i + 1)) / n;
      c.stone(cx + dx * t0, 0.6, cz + dz * t0, cx + dx * t1, 0.6, cz + dz * t1, 0.9);
      c.wood(cx + dx * t0, 1.75, cz + dz * t0, cx + dx * t1, 1.75, cz + dz * t1, 0.62);
    }
  };
  const W = YARD + 0.85; // wall centre line
  const L = W * 2 + 1.7;
  wall(0, -W, L, 0);
  wall(-W, 0, L, Math.PI / 2);
  wall(W, 0, L, Math.PI / 2);
  const side = (L - 7.2) / 2;
  wall(-(3.6 + side / 2), W, side, 0);
  wall(3.6 + side / 2, W, side, 0);

  // the gate in the south wall: heavy posts, a roof, and doors barred shut
  for (const px of [-3.3, 3.3]) c.b.add(box(0.7, 5.0, 0.8), c.M.woodDark, mtx(px, 2.5, W));
  c.b.add(box(7.9, 0.7, 0.9), c.M.woodDark, mtx(0, 4.75, W));
  c.b.add(curvedRoof(10.2, 4.0, 1.5, 3.0, 0.6), c.M.roof, mtx(0, 5.1, W));
  c.b.add(box(6.4, 0.22, 0.26), c.M.dark, mtx(0, 6.62, W));
  for (const px of [-1.48, 1.48]) {
    c.b.add(box(2.9, 4.3, 0.2), c.M.wood, mtx(px, 2.15, W - 0.1));
    for (const y of [0.7, 2.1, 3.5]) c.b.add(box(2.9, 0.16, 0.26), c.M.dark, mtx(px, y, W - 0.1));
  }
  c.b.add(box(5.4, 0.3, 0.3), c.M.woodDark, mtx(0, 1.5, W - 0.32));
  c.wood(-2.9, 1.2, W - 0.15, 2.9, 1.2, W - 0.15, 0.35);
  c.wood(-2.9, 2.8, W - 0.15, 2.9, 2.8, W - 0.15, 0.35);
  for (const px of [-3.3, 3.3]) c.wood(px, 0.1, W, px, 4.6, W, 0.5);

  // corner turrets on the north side
  for (const sx of [-1, 1]) {
    const x = sx * (W + 0.6);
    const z = -(W + 0.6);
    c.b.add(box(5.6, 2.6, 5.6), c.M.stone, mtx(x, 1.3, z));
    c.b.add(box(4.4, 0.5, 4.4), c.M.woodDark, mtx(x, 2.85, z));
    c.b.add(box(4.2, 2.4, 4.2), plaster, mtx(x, 4.3, z));
    c.b.add(box(1.0, 0.7, 0.06), MAT.glow, mtx(x - sx * 0.2, 4.4, z + 2.12));
    c.b.add(curvedRoof(6.2, 6.2, 1.7, 0.5, 0.6), c.M.roof, mtx(x, 5.5, z));
  }

  // the keep (tenshu) rising behind the north wall: stone base and three roofed storeys
  const kz = -(W + 13);
  c.b.add(new THREE.CylinderGeometry(9.2, 12.4, 6.5, 4, 1).rotateY(Math.PI / 4), c.M.stone, mtx(0, 3.25, kz, 0, 0, 0, 1.12, 1, 0.92));
  const storey = (y: number, w: number, dp: number, h: number, roofH: number, ridge: number) => {
    c.b.add(box(w, h, dp), plaster, mtx(0, y + h / 2, kz));
    c.b.add(box(w + 0.1, 0.9, dp + 0.1), c.M.woodDark, mtx(0, y + 0.45, kz));
    c.b.add(box(w + 0.5, 0.3, dp + 0.5), c.M.dark, mtx(0, y + h - 0.15, kz));
    const n = Math.max(2, Math.round(w / 2.4));
    for (let i = 0; i < n; i++) c.b.add(box(0.8, 1.0, 0.08), MAT.glow, mtx((i - (n - 1) / 2) * 2.1, y + h * 0.56, kz + dp / 2 + 0.03));
    c.b.add(curvedRoof(w + 4.6, dp + 4.6, roofH, ridge, 1.0), c.M.roof, mtx(0, y + h, kz));
  };
  storey(6.5, 14.5, 12, 4.4, 2.1, 4.6);
  storey(11.3, 10.4, 8.6, 3.9, 1.9, 3.0);
  storey(15.6, 7.0, 6.0, 3.4, 2.7, 2.2);
  c.b.add(box(4.8, 0.3, 0.34), c.M.dark, mtx(0, 21.75, kz));
  for (const sx of [-1, 1]) c.b.add(new THREE.ConeGeometry(0.28, 1.0, 6), MAT.glow, mtx(sx * 2.3, 22.3, kz, 0, 0, sx * -0.35));
  c.halo(0, 17.5, kz + 3.2, 9, 0.5);

  // a war drum on its stand before the north wall, between two banners
  const dz = -YARD + 2.3;
  c.b.add(cyl(1.05, 1.05, 1.3, 20).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), c.M.wood, mtx(0, 1.75, dz));
  for (const s of [-1, 1]) c.b.add(cyl(0.98, 0.98, 0.05, 20).rotateX(Math.PI / 2), plaster, mtx(0, 1.75, dz + s * 0.66));
  for (const px of [-0.95, 0.95]) {
    c.b.add(box(0.16, 1.9, 0.16), c.M.woodDark, mtx(px, 0.95, dz - 0.45, 0.18));
    c.b.add(box(0.16, 1.9, 0.16), c.M.woodDark, mtx(px, 0.95, dz + 0.45, -0.18));
  }
  c.b.add(box(2.2, 0.14, 1.4), c.M.woodDark, mtx(0, 0.5, dz));
  c.solid(0, dz, 1.35, 3);
  c.wood(0, 1.75, dz - 0.5, 0, 1.75, dz + 0.5, 1.05);
  c.banner(-4.2, dz, 0);
  c.banner(4.2, dz, 0);

  // weapon racks along the side walls
  for (const sx of [-1, 1]) {
    const x = sx * (YARD - 1.5);
    for (const z of [-11.5, -8.9]) c.b.add(box(0.14, 1.9, 0.14), c.M.woodDark, mtx(x, 0.95, z));
    for (const y of [0.55, 1.75]) c.b.add(box(0.12, 0.12, 2.9), c.M.woodDark, mtx(x, y, -10.2));
    for (let i = 0; i < 5; i++) {
      const z = -11.3 + i * 0.55;
      c.b.add(cyl(0.03, 0.035, 2.9, 6), c.M.wood, mtx(x - sx * 0.22, 1.42, z, 0, 0, sx * 0.13));
      c.b.add(new THREE.ConeGeometry(0.06, 0.34, 6), c.M.stoneDark, mtx(x - sx * 0.41, 3.02, z, 0, 0, sx * 0.13));
    }
    c.solid(x, -10.9, 0.8, 2);
    c.solid(x, -9.5, 0.8, 2);
    c.props.addPillar(x, -11.5, 0, 1.9, 0.1, false);
    c.props.addPillar(x, -8.9, 0, 1.9, 0.1, false);
  }

  // straw-bound striking posts (makiwara) to cut at
  // (posts of their own: three good cuts bring one down, straw and all)
  const strawG = cyl(0.24, 0.24, 0.8, 12);
  const armG = box(1.1, 0.1, 0.1);
  for (const [px, pz] of [[-12.5, 5.5], [-12.5, 9.5], [12.5, 5.5], [12.5, 9.5], [-6, 13.5], [6, 13.5]]) {
    c.post(px, pz, 2.0, 0.15, c.M.woodDark, [[strawG, c.M.wood, 0, 1.45, 0], [armG, c.M.woodDark, 0, 1.0, 0]], 3);
  }

  for (const z of [-7, 0, 7]) {
    c.banner(-(YARD - 0.9), z + 3.4, -Math.PI / 2);
    c.banner(YARD - 0.9, z + 3.4, Math.PI / 2);
  }
  c.lantern(-5.4, YARD - 2.2, true);
  c.lantern(5.4, YARD - 2.2, true);
  c.lantern(-8, -YARD + 2.3, true);
  c.lantern(8, -YARD + 2.3, true);
  c.torch(-9.5, -9.5);
  c.torch(9.5, -9.5);
  c.torch(-9.5, 9.5);
  c.torch(9.5, 9.5);
}

// ---------------------------------------------------------------------------
// 橋 Ponte do Lago: a long timber deck over still water with a round stage in the middle. Narrow
// at both ends (enemies come down the bridge) and open in the centre; there is nothing to hide
// behind, and the railing is at your back.
// ---------------------------------------------------------------------------
const DECK_X = 8.6;
const DECK_Z = 26;
const DECK_R = 13.6;
let waterMap: THREE.Texture | null = null;
let waterMat: THREE.MeshStandardMaterial | null = null;

const lakeInside = (x: number, z: number, pad: number) => (Math.abs(x) < DECK_X - pad && Math.abs(z) < DECK_Z - pad) || Math.hypot(x, z) < DECK_R - pad;

function lakeConfine(pos: XZ, r: number) {
  if (lakeInside(pos.x, pos.z, r)) return;
  const rx = clamp(pos.x, -(DECK_X - r), DECK_X - r);
  const rz = clamp(pos.z, -(DECK_Z - r), DECK_Z - r);
  const d = Math.hypot(pos.x, pos.z) || 1;
  const k = (DECK_R - r) / d;
  const cx = pos.x * k;
  const cz = pos.z * k;
  if (Math.hypot(rx - pos.x, rz - pos.z) <= Math.hypot(cx - pos.x, cz - pos.z)) {
    pos.x = rx;
    pos.z = rz;
  } else {
    pos.x = cx;
    pos.z = cz;
  }
}

function buildLake(c: StageCtx) {
  const rng = makeRng(4411);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const WY = -1.15; // water level under the deck (the deck's top is the ground, y = 0)

  // still water: one flat disc that mirrors the sky through the scene's environment map
  waterMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.035, 0.045), roughness: 0.07, metalness: 0.85, envMapIntensity: 1.5 });
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}tex/water_n.webp`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(46, 46);
    waterMap = t;
    if (waterMat) {
      waterMat.normalMap = t;
      waterMat.normalScale.set(0.32, 0.32);
      waterMat.needsUpdate = true;
    }
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(66, 48).rotateX(-Math.PI / 2), waterMat);
  water.position.y = WY;
  c.group.add(water);
  // the far shore: the earth rises out of the water and runs out to the forest and the hills
  const shore = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(170, -0.05), new THREE.Vector2(56, -0.05), new THREE.Vector2(51, WY - 0.4)], 64),
    c.groundMat
  );
  shore.receiveShadow = true;
  c.group.add(shore);

  // the deck: a long bridge and the round stage it crosses
  c.b.add(box(DECK_X * 2 + 0.5, 0.34, DECK_Z * 2 + 1), c.M.wood, mtx(0, -0.17, 0));
  c.b.add(cyl(DECK_R + 0.3, DECK_R + 0.3, 0.34, 48), c.M.wood, mtx(0, -0.172, 0));
  c.b.add(cyl(DECK_R + 0.45, DECK_R + 0.45, 0.3, 48), c.M.woodDark, mtx(0, -0.36, 0));
  c.b.add(box(DECK_X * 2 + 0.8, 0.3, DECK_Z * 2 + 1), c.M.woodDark, mtx(0, -0.36, 0));
  // a ring of pale boards marks the stage, and the bridge runs on into the mist at both ends
  c.b.add(new THREE.TorusGeometry(6.2, 0.09, 4, 56).rotateX(Math.PI / 2), c.M.woodDark, mtx(0, 0.0, 0, 0, 0, 0, 1, 0.25, 1));
  for (const s of [-1, 1]) c.b.add(box(7.4, 0.34, 40), c.M.wood, mtx(0, -0.17, s * (DECK_Z + 20.4)));

  // posts down into the water
  const post = cyl(0.24, 0.26, 2.2, 8);
  for (let z = -DECK_Z; z <= DECK_Z + 0.1; z += 5.2) {
    if (Math.abs(z) < 11) continue;
    for (const sx of [-1, 1]) c.b.add(post, c.M.woodDark, mtx(sx * (DECK_X - 0.1), -1.0, z));
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + 0.22;
    c.b.add(post, c.M.woodDark, mtx(Math.sin(a) * DECK_R, -1.0, Math.cos(a) * DECK_R));
  }
  for (const s of [-1, 1]) for (let z = 6; z < 40; z += 6.5) for (const sx of [-1, 1]) c.b.add(post, c.M.woodDark, mtx(sx * 3.4, -1.0, s * (DECK_Z + z)));

  // red railings: along the bridge...
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.52, 0.98]) c.b.add(box(0.09, 0.09, len), c.M.torii, mtx((x0 + x1) / 2, y, (z0 + z1) / 2, 0, ry, 0));
    c.wood(x0, 0.75, z0, x1, 0.75, z1, 0.3, true);
    const n = Math.max(1, Math.round(len / 2.1));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      c.b.add(box(0.15, 1.08, 0.15), c.M.torii, mtx(x0 + (x1 - x0) * t, 0.54, z0 + (z1 - z0) * t));
    }
  };
  const zJoin = Math.sqrt(DECK_R * DECK_R - DECK_X * DECK_X); // where the bridge's edge meets the round stage
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rail(sx * (DECK_X + 0.05), sz * (zJoin + 0.4), sx * (DECK_X + 0.05), sz * (DECK_Z + 0.3));
  // ...and around the two bows of the stage
  const a0 = Math.asin(DECK_X / DECK_R);
  for (const side of [0, Math.PI]) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = side + Math.PI / 2 - (Math.PI / 2 - a0) + ((Math.PI - 2 * a0) * i) / n;
      const t1 = side + Math.PI / 2 - (Math.PI / 2 - a0) + ((Math.PI - 2 * a0) * (i + 1)) / n;
      rail(Math.sin(t0) * (DECK_R + 0.1), Math.cos(t0) * (DECK_R + 0.1), Math.sin(t1) * (DECK_R + 0.1), Math.cos(t1) * (DECK_R + 0.1));
    }
  }

  // a gate across each end of the bridge, shut
  for (const s of [-1, 1]) {
    const z = s * (DECK_Z + 0.35);
    for (const px of [-4.6, 4.6]) {
      c.b.add(cyl(0.3, 0.34, 5.6, 14), c.M.torii, mtx(px, 2.8, z));
      c.solid(px, s * (DECK_Z - 0.2), 0.6, 6);
      c.props.addPillar(px, z, 0.2, 5.6, 0.34, true);
    }
    c.b.add(curvedBeam(12.6, 0.42, 0.85, 0.55), c.M.dark, mtx(0, 5.9, z));
    c.b.add(curvedBeam(11.4, 0.34, 0.6, 0.35), c.M.torii, mtx(0, 5.48, z));
    c.b.add(box(9.2, 0.3, 0.36), c.M.torii, mtx(0, 4.5, z));
    c.b.add(box(8.9, 0.16, 0.2), c.M.woodDark, mtx(0, 2.75, z));
    c.b.add(box(8.9, 0.16, 0.2), c.M.woodDark, mtx(0, 0.25, z));
    for (let x = -4.2; x <= 4.21; x += 0.6) c.b.add(box(0.1, 2.6, 0.1), c.M.woodDark, mtx(x, 1.5, z));
    c.wood(-4.3, 0.9, z, 4.3, 0.9, z, 0.3);
    c.wood(-4.3, 2.1, z, 4.3, 2.1, z, 0.3);
    for (const sx of [-1, 1]) for (let x = 5.2; x <= 8.5; x += 0.55) c.b.add(box(0.1, 1.5, 0.1), c.M.torii, mtx(sx * x, 0.75, z));
  }

  // out on the water: the great torii, a pavilion on stilts, rocks, and paper lanterns set adrift
  torii(c, 37, -14, Math.PI / 2, 2.1, false);
  const px = -33;
  const pz = 13;
  c.b.add(cyl(4.6, 4.6, 0.3, 6), c.M.wood, mtx(px, 0.25, pz));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    c.b.add(cyl(0.16, 0.18, 3.2, 8), c.M.torii, mtx(px + Math.sin(a) * 3.9, 2.0, pz + Math.cos(a) * 3.9));
    c.b.add(post, c.M.woodDark, mtx(px + Math.sin(a) * 3.9, -0.9, pz + Math.cos(a) * 3.9));
  }
  c.b.add(new THREE.ConeGeometry(6.2, 2.5, 6), c.M.roof, mtx(px, 4.85, pz));
  c.b.add(new THREE.SphereGeometry(0.26, 10, 8), MAT.glow, mtx(px, 6.2, pz));
  c.b.add(box(0.7, 0.7, 0.7), MAT.glow, mtx(px, 2.9, pz));
  c.halo(px, 2.9, pz, 6, 0.8);
  const rocks: [number, number, number][] = [[21, 12, 2.4], [24, 15.5, 1.3], [-19, -20, 2.0], [-23, -17, 1.2], [17, -30, 1.7], [-15, 30, 1.5], [30, 27, 2.2]];
  rocks.forEach(([x, z, s], i) => c.b.add(rockGeometry(90 + i * 5, 3), c.M.rock, mtx(x, WY + s * 0.3, z, 0, R(0, TAU), 0, s * 1.3, s * 1.1, s * 1.1)));
  const lampG = box(0.36, 0.3, 0.36);
  const baseG = box(0.5, 0.05, 0.5);
  let glows = 0;
  for (let i = 0; i < 44; i++) {
    const a = R(0, TAU);
    const r = R(15, 46);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (lakeInside(x, z, -2.5) || (Math.abs(x) < 5.5 && Math.abs(z) < 68)) continue;
    c.b.add(lampG, MAT.glow, mtx(x, WY + 0.2, z, 0, R(0, TAU), 0));
    c.b.add(baseG, c.M.woodDark, mtx(x, WY + 0.03, z));
    if (glows < 12 && r < 34) {
      c.halo(x, WY + 0.3, z, 2.2, 0.75);
      c.ember(x, WY + 0.6, z);
      glows++;
    }
  }

  // things on the deck to cut: banners at the mouths of the bridge and mooring posts on the stage
  for (const sz of [-1, 1]) {
    c.banner(-7.7, sz * 19.5, Math.PI / 2);
    c.banner(7.7, sz * 19.5, -Math.PI / 2);
  }
  const capG = new THREE.ConeGeometry(0.2, 0.26, 8);
  const ropeG = cyl(0.19, 0.19, 0.16, 10);
  for (const [mx, mz] of [[-10.6, 4.5], [10.6, 4.5], [-10.6, -4.5], [10.6, -4.5]]) {
    c.post(mx, mz, 1.5, 0.15, c.M.woodDark, [[capG, c.M.torii, 0, 1.63, 0], [ropeG, c.M.wood, 0, 1.1, 0]], 2);
  }
  c.lantern(-7.4, 14.6, true);
  c.lantern(7.4, 14.6, true);
  c.lantern(-7.4, -14.6, true);
  c.lantern(7.4, -14.6, true);
  c.torch(-7.5, 23.6);
  c.torch(7.5, 23.6);
  c.torch(-7.5, -23.6);
  c.torch(7.5, -23.6);
}

function updateLake(time: number) {
  if (waterMap) waterMap.offset.set(time * 0.006, time * 0.011);
}

export const STAGES: StageDef[] = [
  { id: 'templo', name: 'Templo', glyph: '寺', desc: 'A praça do templo', radius: 40, start: [0, 5], ...circle(40) },
  {
    id: 'bambu',
    name: 'Bambuzal',
    glyph: '竹',
    desc: 'Clareira fechada: luta de perto, corte o bambu',
    radius: BAMBOO_R,
    start: [0, 7],
    atmos: 1,
    fog: 0.6,
    ...circle(BAMBOO_R),
    cam: (pos) => circle(BAMBOO_R + 1.2).confine(pos, 0),
    build: buildBamboo
  },
  {
    id: 'castelo',
    name: 'Pátio do Castelo',
    glyph: '城',
    desc: 'Pátio aberto entre muralhas: sem abrigo contra flechas',
    radius: 27,
    start: [0, 9],
    atmos: 0,
    ...square(YARD),
    cam: (pos) => square(YARD - 0.35).confine(pos, 0),
    build: buildCastle
  },
  {
    id: 'lago',
    name: 'Ponte do Lago',
    glyph: '橋',
    desc: 'Ponte estreita sobre a água: eles vêm pelas duas pontas',
    radius: DECK_Z,
    start: [0, 5],
    atmos: 2,
    ground: false,
    fog: 1.35,
    inside: lakeInside,
    confine: lakeConfine,
    build: buildLake,
    update: updateLake
  }
];

export type StageMode = 'three' | 'off';

/** Which stage a wave is fought in: a new one every 3 waves (always the temple when off). */
export function stageForWave(wave: number, mode: StageMode): number {
  return mode === 'off' ? 0 : Math.floor(Math.max(0, wave - 1) / 3) % STAGES.length;
}
