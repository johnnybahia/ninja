import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ===========================================================================
// Smooth procedural shapes: noise-displaced rocks, swept tapering branches and
// foliage cards with soft spherical normals (the canopy shades like one cloud
// instead of a pile of facets).
// ===========================================================================

// Deterministic RNG so a scene looks the same on every load
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Trilinear value noise, 0..1
export function noise3(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  );
}

export function fbm3(x: number, y: number, z: number, seed = 0, oct = 4) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * noise3(x * f, y * f, z * f, seed + i * 17);
    f *= 2.07;
    a *= 0.5;
  }
  return v / (1 - Math.pow(0.5, oct));
}

// Weathered boulder: an icosphere pushed around by fBm, squashed, with a flattened
// base so it sits on the ground. Smooth normals, unit-ish size.
export function rockGeometry(seed: number, detail = 3, rough = 0.32) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3, seed, 4);
    const ridge = 1 - Math.abs(noise3(v.x * 2.4, v.y * 2.4 + seed, v.z * 2.4, seed + 5) * 2 - 1);
    v.multiplyScalar(1 + (n - 0.5) * rough * 2 + ridge * rough * 0.25);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Tapering tube swept along a smooth curve. radius(t) gives the radius at t = 0..1.
export function sweep(points: THREE.Vector3[], radius: (t: number) => number, radial = 10, segs = 16) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  // a small cap so branch tips are not open
  g.computeVertexNormals();
  return { geo: g, curve };
}

// ---------------------------------------------------------------------------
// Foliage cards
// ---------------------------------------------------------------------------
export interface Lobe {
  c: THREE.Vector3; // cluster centre
  r: number; // cluster radius
  flat?: number; // vertical squash (pine pads)
}

const cardBase = new THREE.PlaneGeometry(1, 1);

// `count` cards per lobe; normals point away from the lobe (blended with the whole
// canopy's centre) so lighting wraps around the cluster like a soft ball.
export function foliageCards(lobes: Lobe[], canopy: THREE.Vector3, count: number, size: [number, number], tint: () => THREE.Color, rng: () => number, horizontal = 0) {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const vtx = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const toCanopy = new THREE.Vector3();
  for (const lobe of lobes) {
    const flat = lobe.flat ?? 1;
    for (let i = 0; i < count; i++) {
      // random point inside the lobe, biased toward the surface
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const rr = lobe.r * Math.pow(rng(), 0.35) * 0.8;
      const sx = Math.sqrt(1 - u * u);
      pos.set(Math.cos(th) * sx, u * flat, Math.sin(th) * sx).multiplyScalar(rr).add(lobe.c);
      const s = (size[0] + (size[1] - size[0]) * rng()) * (0.7 + 0.3 * lobe.r);
      if (horizontal > 0 && rng() < horizontal) e.set(-Math.PI / 2 + (rng() - 0.5) * 0.9, rng() * Math.PI * 2, (rng() - 0.5) * 0.5, 'YXZ');
      else e.set((rng() - 0.5) * Math.PI, rng() * Math.PI * 2, (rng() - 0.5) * Math.PI, 'YXZ');
      q.setFromEuler(e);
      m.compose(pos, q, scl.set(s, s, s));
      const g = cardBase.clone().applyMatrix4(m);
      const gp = g.attributes.position as THREE.BufferAttribute;
      const gn = g.attributes.normal as THREE.BufferAttribute;
      for (let k = 0; k < gp.count; k++) {
        vtx.fromBufferAttribute(gp, k);
        nrm.copy(vtx).sub(lobe.c);
        nrm.y /= Math.max(0.3, flat);
        nrm.normalize();
        toCanopy.copy(vtx).sub(canopy).normalize();
        nrm.lerp(toCanopy, 0.45).add(vtx.set(0, 0.35, 0)).normalize();
        gn.setXYZ(k, nrm.x, nrm.y, nrm.z);
      }
      const col = tint();
      const cArr = new Float32Array(gp.count * 3);
      for (let k = 0; k < gp.count; k++) cArr.set([col.r, col.g, col.b], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

// Standard material for alpha-cut foliage cards. The card texture arrives async, so
// the mesh stays hidden until it is ready (no black squares on first frames).
export function foliageMaterial(url: string, mesh: () => THREE.Object3D | undefined, emissive = 0x000000) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    roughness: 0.85,
    emissive
  });
  mat.alphaToCoverage = true;
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    mat.map = t;
    mat.needsUpdate = true;
    const m = mesh();
    if (m) m.visible = true;
  });
  // keep the soft spherical normals on both faces (three flips them for back faces)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      normal = normalize(vNormal);`
    );
  };
  return mat;
}

// Distant conifer: stacked drooping tiers with a noisy rim, so the silhouette reads as
// needled boughs instead of a clean cone. Unit height, base at y = 0.
export function coniferGeometry(seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 5;
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const r = 0.5 * (1 - t * 0.78);
    const h = 0.32;
    const y0 = 0.12 + t * 0.78;
    const g = new THREE.ConeGeometry(r, h, 16, 2, true);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const rad = Math.hypot(x, z);
      if (rad < 1e-4) continue;
      const a = Math.atan2(z, x);
      // jagged rim: the lower the vertex, the more it is pushed around
      const low = 0.5 - y / h;
      const j = 1 + (noise3(Math.cos(a) * 2.5, k * 1.7, Math.sin(a) * 2.5, seed) - 0.5) * 0.7 * low;
      p.setXYZ(i, x * j, y - low * low * 0.06, z * j);
    }
    g.translate(0, y0 + h / 2, 0);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  parts.push(new THREE.CylinderGeometry(0.03, 0.05, 0.2, 6).translate(0, 0.1, 0).deleteAttribute('uv') as THREE.BufferGeometry);
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}
