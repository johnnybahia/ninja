import * as THREE from 'three';

// Conquista mode: enemy outposts scattered over the field. A post is a banner pole, a palisade of
// stakes, two braziers and a glowing ring on the ground marking where the garrison fights. Red
// while hostile, jade once taken.

export interface PostSpot {
  x: number;
  z: number;
}

const HOSTILE = new THREE.Color(0xd8343a);
const TAKEN = new THREE.Color(0x4fd6a8);
const POST_RADIUS = 6.6;

/** The `count` open spots on the field that are farthest from each other (deterministic). */
export function pickPostSpots(isFree: (x: number, z: number, pad: number) => boolean, count = 3): PostSpot[] {
  const cands: PostSpot[] = [];
  for (const pad of [4.5, 3.2]) {
    for (const r of [22, 24, 26]) {
      for (let a = 0; a < 360; a += 5) {
        const x = Math.sin((a * Math.PI) / 180) * r;
        const z = Math.cos((a * Math.PI) / 180) * r;
        if (isFree(x, z, pad)) cands.push({ x, z });
      }
    }
    if (cands.length >= count * 6) break;
  }
  if (!cands.length) return [];
  // first: the open spot closest to the south-east, then keep adding the one farthest from the rest
  const chosen: PostSpot[] = [cands.reduce((b, c) => (Math.hypot(c.x - 17, c.z - 17) < Math.hypot(b.x - 17, b.z - 17) ? c : b))];
  while (chosen.length < count && chosen.length < cands.length) {
    let best = cands[0];
    let bestD = -1;
    for (const c of cands) {
      const d = Math.min(...chosen.map((o) => Math.hypot(o.x - c.x, o.z - c.z)));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

function bannerTexture(glyph: string, color: THREE.Color): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.clone().multiplyScalar(0.55).getHexString()}`;
  g.fillRect(0, 0, 256, 176);
  g.strokeStyle = 'rgba(239,230,210,0.85)';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 236, 156);
  g.fillStyle = '#efe6d2';
  g.font = 'bold 120px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 128, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Outpost {
  readonly group = new THREE.Group();
  readonly x: number;
  readonly z: number;
  readonly radius = POST_RADIUS;
  readonly solids: { x: number; z: number; r: number; h: number }[];
  captured = false;
  armed = true; // a post retaken after a round only wakes once the player has walked away from it
  private banner: THREE.Mesh;
  private bannerMat: THREE.MeshBasicMaterial;
  private bannerRest: Float32Array;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private flames: THREE.Mesh[] = [];
  private texHostile: THREE.CanvasTexture;
  private texTaken: THREE.CanvasTexture;
  private owned: { dispose(): void }[] = [];

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.9 });
    this.owned.push(wood);

    // pole with a crossbar, the banner hanging from it
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.2, 6.2, 8);
    const pole = new THREE.Mesh(poleGeo, wood);
    pole.position.y = 3.1;
    pole.castShadow = true;
    const barGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6).rotateZ(Math.PI / 2);
    const bar = new THREE.Mesh(barGeo, wood);
    bar.position.set(1.3, 5.7, 0);
    this.group.add(pole, bar);
    this.owned.push(poleGeo, barGeo);

    this.texHostile = bannerTexture('将', HOSTILE);
    this.texTaken = bannerTexture('勝', TAKEN);
    this.bannerMat = new THREE.MeshBasicMaterial({ map: this.texHostile, side: THREE.DoubleSide });
    const bgeo = new THREE.PlaneGeometry(2.3, 1.6, 8, 2);
    this.bannerRest = new Float32Array(bgeo.attributes.position.array as Float32Array);
    this.banner = new THREE.Mesh(bgeo, this.bannerMat);
    this.banner.position.set(1.3, 4.8, 0);
    this.group.add(this.banner);
    this.owned.push(bgeo, this.bannerMat, this.texHostile, this.texTaken);

    // palisade: a ring of slanted stakes (one draw call)
    const stakeGeo = new THREE.ConeGeometry(0.1, 1.9, 5);
    const stakes = new THREE.InstancedMesh(stakeGeo, wood, 14);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const r = POST_RADIUS - 0.5 + ((i * 7) % 3) * 0.12;
      q.setFromEuler(new THREE.Euler(Math.sin(i * 1.7) * 0.16, 0, Math.cos(i * 2.3) * 0.16));
      m.compose(new THREE.Vector3(Math.sin(a) * r, 0.85, Math.cos(a) * r), q, new THREE.Vector3(1, 1, 1));
      stakes.setMatrixAt(i, m);
    }
    stakes.castShadow = true;
    this.group.add(stakes);
    this.owned.push(stakeGeo);

    // braziers
    const bowlGeo = new THREE.CylinderGeometry(0.42, 0.28, 0.55, 8);
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.8 });
    const flameGeo = new THREE.ConeGeometry(0.28, 0.8, 7);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 0.3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.owned.push(bowlGeo, bowlMat, flameGeo, flameMat);
    for (const side of [-1, 1]) {
      const bowl = new THREE.Mesh(bowlGeo, bowlMat);
      bowl.position.set(side * 1.9, 0.5, 1.6);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(side * 1.9, 1.05, 1.6);
      this.flames.push(flame);
      this.group.add(bowl, flame);
    }

    // the ground ring and a faint disc inside it
    const ringGeo = new THREE.RingGeometry(POST_RADIUS - 0.3, POST_RADIUS, 72).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: HOSTILE.clone().multiplyScalar(1.4), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.y = 0.07;
    const discGeo = new THREE.CircleGeometry(POST_RADIUS - 0.3, 48).rotateX(-Math.PI / 2);
    this.discMat = new THREE.MeshBasicMaterial({ color: HOSTILE.clone().multiplyScalar(1.2), transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const disc = new THREE.Mesh(discGeo, this.discMat);
    disc.position.y = 0.05;
    this.group.add(this.ring, disc);
    this.owned.push(ringGeo, this.ringMat, discGeo, this.discMat);

    this.solids = [
      { x, z, r: 0.45, h: 6 },
      { x: x - 1.9, z: z + 1.6, r: 0.5, h: 1 },
      { x: x + 1.9, z: z + 1.6, r: 0.5, h: 1 }
    ];
  }

  setCaptured(c: boolean) {
    this.captured = c;
    this.bannerMat.map = c ? this.texTaken : this.texHostile;
    this.bannerMat.needsUpdate = true;
    const col = (c ? TAKEN : HOSTILE).clone();
    this.ringMat.color.copy(col).multiplyScalar(1.4);
    this.discMat.color.copy(col).multiplyScalar(1.2);
    this.ringMat.opacity = c ? 0.35 : 0.6;
  }

  update(t: number) {
    // the banner ripples (more toward its free edge), the flames flicker, the ring breathes
    const pos = this.banner.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const rx = this.bannerRest[i * 3];
      const k = (rx + 1.15) / 2.3;
      pos.setZ(i, Math.sin(t * 3.2 + rx * 2.4) * 0.14 * k);
    }
    pos.needsUpdate = true;
    this.flames.forEach((f, i) => {
      const s = 0.85 + Math.sin(t * 11 + i * 2) * 0.15 + Math.sin(t * 17 + i) * 0.08;
      f.scale.set(s, 0.9 + s * 0.25, s);
    });
    this.ringMat.opacity = (this.captured ? 0.3 : 0.5) + Math.sin(t * 2.2) * 0.1;
  }

  dispose() {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
  }
}
