import * as THREE from 'three';

// Soft round dot for point particles (sparks, dust) instead of hard squares
let dotTex: THREE.CanvasTexture | null = null;
export function softDotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.65, 'rgba(255,255,255,0.25)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(-64, -64, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 8; i++) {
    g.save();
    g.rotate((i / 8) * Math.PI * 2);
    const len = i % 2 ? 36 : 62;
    g.beginPath();
    g.moveTo(-3.5, 0);
    g.lineTo(0, -len);
    g.lineTo(3.5, 0);
    g.closePath();
    g.fill();
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Blade trail: a fading ribbon swept between the weapon's base and tip
// ---------------------------------------------------------------------------
export class BladeTrail {
  mesh: THREE.Mesh;
  private max = 18;
  private samples: { a: THREE.Vector3; b: THREE.Vector3; t: number }[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private life = 0.15;
  private tint = new THREE.Color(1.5, 1.45, 1.3);

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.max * 2 * 3);
    this.col = new Float32Array(this.max * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  setTint(c: THREE.Color) {
    this.tint.copy(c);
  }

  push(base: THREE.Vector3, tip: THREE.Vector3, time: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && last.b.distanceToSquared(tip) < 0.0004) {
      last.t = time;
      return;
    }
    const s = this.samples.length >= this.max ? this.samples.shift()! : { a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0 };
    s.a.copy(base);
    s.b.copy(tip);
    s.t = time;
    this.samples.push(s);
  }

  update(time: number) {
    while (this.samples.length && time - this.samples[0].t > this.life) this.samples.shift();
    const n = this.samples.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < this.max; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const k = i < n ? 1 - (time - s.t) / this.life : 0;
      const fade = Math.max(0, k) * (i / Math.max(1, n - 1));
      this.pos.set([s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z], i * 6);
      // base edge dim, tip edge bright
      const f2 = fade * fade * 0.85;
      this.col.set([this.tint.r * f2 * 0.1, this.tint.g * f2 * 0.1, this.tint.b * f2 * 0.1, f2 * 0.2, this.tint.r * f2, this.tint.g * f2, this.tint.b * f2, f2], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.samples.length = 0;
    this.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Impact bursts: star-shaped flashes at hit points (HDR -> bloom)
// ---------------------------------------------------------------------------
export class ImpactPool {
  private items: { s: THREE.Sprite; t: number; dur: number; size: number; spin: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count = 12) {
    const tex = starTexture();
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
      );
      s.visible = false;
      s.renderOrder = 25;
      scene.add(s);
      this.items.push({ s, t: 1, dur: 1, size: 1, spin: 0 });
    }
  }

  spawn(p: THREE.Vector3, color: THREE.Color, size = 1.2, dur = 0.14) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.s.position.copy(p);
    it.s.material.color.copy(color);
    it.s.material.rotation = Math.random() * Math.PI;
    it.t = 0;
    it.dur = dur;
    it.size = size;
    it.spin = (Math.random() - 0.5) * 6;
    it.s.visible = true;
  }

  update(dt: number) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        it.s.visible = false;
        continue;
      }
      const sc = it.size * (0.35 + 0.9 * Math.sqrt(k));
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = 1 - k * k;
      it.s.material.rotation += it.spin * dt;
    }
  }
}
