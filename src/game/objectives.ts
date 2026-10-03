import * as THREE from 'three';

// Things to destroy at a Conquista post: a stack of powder kegs (it blows up on the garrison) and a
// war drum (it calls reinforcements until it is broken). The player's blade or a thrown weapon
// breaks them; each has a few hits of life and a little bar once its post is awake.

export type ObjectiveKind = 'powder' | 'drum';

const BAR_W = 1.5;

export class Objective {
  readonly group = new THREE.Group();
  readonly kind: ObjectiveKind;
  readonly x: number;
  readonly z: number;
  readonly r: number; // how close a blade or shot has to pass
  readonly h: number;
  readonly maxHp: number;
  readonly solid: { x: number; z: number; r: number; h: number };
  hp: number;
  dead = false;
  active = false; // the post is awake: only then can it be hurt
  post = -1; // index of the post it stands at
  token: object | null = null; // the last blow's window: one hit per swing
  private body = new THREE.Group();
  private glow: THREE.Mesh | null = null;
  private bar = new THREE.Group();
  private barFg: THREE.Mesh;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private flash = 0;
  private beat = 0;
  private owned: { dispose(): void }[] = [];

  constructor(kind: ObjectiveKind, x: number, z: number) {
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
    this.group.add(this.body);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.85 });
    this.owned.push(wood);

    if (kind === 'powder') {
      this.r = 1.05;
      this.h = 1.9;
      this.maxHp = 3;
      const band = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.5, metalness: 0.6 });
      const sack = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 1 });
      const kegGeo = new THREE.CylinderGeometry(0.4, 0.44, 0.9, 12);
      const bandGeo = new THREE.CylinderGeometry(0.455, 0.455, 0.07, 12);
      const sackGeo = new THREE.BoxGeometry(0.7, 0.36, 0.5);
      this.owned.push(band, sack, kegGeo, bandGeo, sackGeo);
      const keg = (px: number, py: number, pz: number) => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(kegGeo, wood);
        m.castShadow = true;
        g.add(m);
        for (const dy of [-0.26, 0.26]) {
          const b = new THREE.Mesh(bandGeo, band);
          b.position.y = dy;
          g.add(b);
        }
        g.position.set(px, py, pz);
        this.body.add(g);
      };
      keg(-0.46, 0.45, 0);
      keg(0.46, 0.45, 0.08);
      keg(0, 1.35, 0.04);
      for (const [px, pz, ry] of [[0.95, -0.55, 0.4], [-0.95, 0.6, -0.5]] as const) {
        const s = new THREE.Mesh(sackGeo, sack);
        s.position.set(px, 0.18, pz);
        s.rotation.y = ry;
        s.castShadow = true;
        this.body.add(s);
      }
      // a fuse that glows
      const glowGeo = new THREE.SphereGeometry(0.11, 8, 6);
      const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.3), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      this.glow = new THREE.Mesh(glowGeo, glowMat);
      this.glow.position.set(0, 1.95, 0.04);
      this.body.add(this.glow);
      this.owned.push(glowGeo, glowMat);
    } else {
      this.r = 1.15;
      this.h = 2.1;
      this.maxHp = 6;
      const postGeo = new THREE.CylinderGeometry(0.1, 0.13, 2.1, 8);
      const drumGeo = new THREE.CylinderGeometry(0.82, 0.82, 0.85, 20).rotateZ(Math.PI / 2);
      const skin = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.7 });
      const headGeo = new THREE.CircleGeometry(0.8, 20);
      const headMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9, side: THREE.DoubleSide });
      const stickGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.9, 6);
      this.owned.push(postGeo, drumGeo, skin, headGeo, headMat, stickGeo);
      for (const sx of [-1.0, 1.0]) {
        const p = new THREE.Mesh(postGeo, wood);
        p.position.set(sx, 1.05, 0);
        p.castShadow = true;
        this.body.add(p);
      }
      const drum = new THREE.Mesh(drumGeo, skin);
      drum.position.y = 1.25;
      drum.castShadow = true;
      this.body.add(drum);
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(headGeo, headMat);
        h.position.set(sx * 0.43, 1.25, 0);
        h.rotation.y = (sx * Math.PI) / 2;
        this.body.add(h);
      }
      for (const sz of [-0.3, 0.3]) {
        const s = new THREE.Mesh(stickGeo, wood);
        s.position.set(0, 0.5, 1.0 + sz * 0.2);
        s.rotation.x = 0.45 * (sz > 0 ? 1 : -1);
        this.body.add(s);
      }
    }
    this.hp = this.maxHp;
    this.solid = { x, z, r: Math.min(0.9, this.r * 0.8), h: this.h };

    // a red ground ring marks it once the post is awake
    const ringGeo = new THREE.RingGeometry(this.r + 0.15, this.r + 0.4, 40).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.5, 0.35), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.y = 0.08;
    this.group.add(this.ring);
    this.owned.push(ringGeo, this.ringMat);

    // life bar (faces the camera)
    const bgGeo = new THREE.PlaneGeometry(BAR_W, 0.14);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x120c18, transparent: true, opacity: 0.8, depthTest: false });
    const fgGeo = new THREE.PlaneGeometry(BAR_W - 0.06, 0.08).translate((BAR_W - 0.06) / 2, 0, 0);
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xff7a3a, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    this.barFg = new THREE.Mesh(fgGeo, fgMat);
    this.barFg.position.set(-(BAR_W - 0.06) / 2, 0, 0.01);
    bg.renderOrder = 10;
    this.barFg.renderOrder = 11;
    this.bar.add(bg, this.barFg);
    this.bar.position.y = this.h + 0.7;
    this.bar.visible = false;
    this.group.add(this.bar);
    this.owned.push(bgGeo, bgMat, fgGeo, fgMat);
  }

  setActive(on: boolean) {
    this.active = on;
    this.bar.visible = on && !this.dead;
  }

  /** The drum sounds: it swells for a moment. */
  pulse() {
    this.beat = 1;
  }

  /** One blow (damage in "hits"); true when it was the one that broke it. */
  hit(dmg: number): boolean {
    if (this.dead || !this.active) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.flash = 1;
    this.barFg.scale.x = Math.max(0.001, this.hp / this.maxHp);
    if (this.hp > 0) return false;
    this.dead = true;
    this.bar.visible = false;
    this.group.visible = false;
    return true;
  }

  update(t: number, dt: number, camQuat: THREE.Quaternion) {
    if (this.dead) return;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.beat = Math.max(0, this.beat - dt * 3.2);
    this.body.scale.setScalar(1 + 0.07 * this.flash + 0.09 * this.beat);
    this.body.rotation.z = Math.sin(t * 60) * 0.03 * this.flash;
    if (this.glow) this.glow.scale.setScalar(0.85 + Math.sin(t * 13) * 0.2 + Math.sin(t * 23) * 0.1);
    this.ringMat.opacity = this.active ? 0.35 + Math.sin(t * 4) * 0.12 : 0;
    this.bar.quaternion.copy(camQuat);
  }

  dispose() {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
  }
}
