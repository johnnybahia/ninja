import * as THREE from 'three';

// Dev overlay for combat geometry (TUNE.hitDebug): every hurtbox, blade segment and hit
// contact drawn as lines, so "did that swing really touch?" can be checked by eye. One
// pre-allocated line buffer, rewritten each frame; nothing is created while it is off.
const MAX = 2400;

export class DebugDraw {
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private n = 0;
  readonly mesh: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, fog: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin() {
    this.n = 0;
  }

  line(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    if (this.n + 2 > MAX) return;
    const c = new THREE.Color(color);
    let i = this.n * 3;
    this.pos[i] = a.x;
    this.pos[i + 1] = a.y;
    this.pos[i + 2] = a.z;
    this.col[i] = c.r;
    this.col[i + 1] = c.g;
    this.col[i + 2] = c.b;
    i += 3;
    this.pos[i] = b.x;
    this.pos[i + 1] = b.y;
    this.pos[i + 2] = b.z;
    this.col[i] = c.r;
    this.col[i + 1] = c.g;
    this.col[i + 2] = c.b;
    this.n += 2;
  }

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  /** Vertical capsule as two rings and four struts. */
  capsule(x: number, z: number, y0: number, y1: number, r: number, color: number) {
    const k = 10;
    for (const y of [y0, y1]) {
      for (let i = 0; i < k; i++) {
        const a0 = (i / k) * Math.PI * 2;
        const a1 = ((i + 1) / k) * Math.PI * 2;
        this.line(this.tmpA.set(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r), this.tmpB.set(x + Math.cos(a1) * r, y, z + Math.sin(a1) * r), color);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.line(this.tmpA.set(x + Math.cos(a) * r, y0, z + Math.sin(a) * r), this.tmpB.set(x + Math.cos(a) * r, y1, z + Math.sin(a) * r), color);
    }
  }

  cross(p: THREE.Vector3, s: number, color: number) {
    this.line(this.tmpA.set(p.x - s, p.y, p.z), this.tmpB.set(p.x + s, p.y, p.z), color);
    this.line(this.tmpA.set(p.x, p.y - s, p.z), this.tmpB.set(p.x, p.y + s, p.z), color);
    this.line(this.tmpA.set(p.x, p.y, p.z - s), this.tmpB.set(p.x, p.y, p.z + s), color);
  }

  end(visible: boolean) {
    this.mesh.visible = visible;
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
