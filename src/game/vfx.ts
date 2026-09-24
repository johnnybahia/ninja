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

// ---------------------------------------------------------------------------
// Ink blood: persistent brush-style splatters on the ground. One instanced mesh;
// the oldest splatter is recycled once the pool is full.
// ---------------------------------------------------------------------------
function splatterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  const dot = (x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // main pool: overlapping lobes, then droplets and streaks thrown toward +x
  for (let i = 0; i < 9; i++) dot(52 + Math.random() * 16, 64 + (Math.random() - 0.5) * 22, 9 + Math.random() * 11);
  for (let i = 0; i < 16; i++) {
    const a = (Math.random() - 0.5) * 1.3;
    const d = 30 + Math.random() * 30;
    dot(58 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1.2 + Math.random() * 3.4);
  }
  g.lineCap = 'round';
  g.strokeStyle = '#fff';
  for (let i = 0; i < 5; i++) {
    const a = (Math.random() - 0.5) * 0.9;
    g.lineWidth = 1.5 + Math.random() * 3;
    g.beginPath();
    g.moveTo(62, 64);
    g.lineTo(62 + Math.cos(a) * (32 + Math.random() * 26), 64 + Math.sin(a) * (32 + Math.random() * 26));
    g.stroke();
  }
  // soften edges a touch so the brush reads wet instead of cut out
  const soft = document.createElement('canvas');
  soft.width = soft.height = 128;
  const s = soft.getContext('2d')!;
  s.filter = 'blur(1.2px)';
  s.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(typeof s.filter === 'string' ? soft : c);
  return t;
}

export class InkDecals {
  private mesh: THREE.InstancedMesh;
  private items: { x: number; z: number; rot: number; sx: number; sz: number; t: number }[] = [];
  private next = 0;
  private growing = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene, private max = 60) {
    const tex = splatterTexture();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      alphaMap: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  // (dx, dz): direction the blood was thrown; size in meters
  spawn(x: number, z: number, dx: number, dz: number, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    const it = this.items[i] || (this.items[i] = { x: 0, z: 0, rot: 0, sx: 1, sz: 1, t: 0 });
    it.x = x;
    it.z = z;
    it.rot = Math.atan2(-dz, dx) + (Math.random() - 0.5) * 0.5;
    it.sx = size * (1.1 + Math.random() * 0.5);
    it.sz = size * (0.8 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
    it.t = 0;
    // near-black crimson: reads as ink more than gore
    this.col.setRGB(0.32 + Math.random() * 0.1, 0.015, 0.03);
    this.mesh.setColorAt(i, this.col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.growing = 0.2;
    this.write(i, 0.25);
  }

  private write(i: number, k: number) {
    const it = this.items[i];
    this.dummy.position.set(it.x, 0.05, it.z);
    this.dummy.rotation.set(0, it.rot, 0);
    this.dummy.scale.set(it.sx * k, 1, it.sz * k);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    if (this.growing <= 0) return;
    this.growing -= dt;
    for (let i = 0; i < this.mesh.count; i++) {
      const it = this.items[i];
      if (it.t >= 1) continue;
      it.t = Math.min(1, it.t + dt / 0.14);
      this.write(i, 0.25 + 0.75 * (1 - (1 - it.t) * (1 - it.t)));
    }
  }

  clear() {
    this.mesh.count = 0;
    this.next = 0;
  }
}

// ---------------------------------------------------------------------------
// Dust puffs: soft, normally blended billboards that grow and fade (footsteps,
// dash starts, landings). Custom point shader so each puff has its own size.
// ---------------------------------------------------------------------------
export class DustPool {
  private points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private base: Float32Array;
  private next = 0;
  private active = 0;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(scene: THREE.Scene, private n = 96) {
    this.pos = new Float32Array(n * 3).fill(-999);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.base = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uScale: { value: 400 } }]);
    this.uniforms.map.value = softDotTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute vec4 aColor; attribute float aSize; uniform float uScale;
        varying vec4 vC;
        void main() {
          vC = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.1);
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform sampler2D map;
        varying vec4 vC;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vC.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vC.rgb, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  // pixels per world unit at 1m: drawing-buffer height * projection scale / 2
  setScale(bufferHeight: number, fovDeg: number) {
    this.uniforms.uScale.value = bufferHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color, alpha: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.base[i] = alpha;
    this.size[i] = size;
    this.life[i] = life;
    this.max[i] = life;
    this.active = this.n;
  }

  update(dt: number) {
    if (this.active <= 0) return;
    let alive = 0;
    const drag = Math.exp(-3.2 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const k = this.life[i] / this.max[i];
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.25 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] *= 1 + dt * 1.6;
      // quick fade in, long fade out
      this.col[i * 4 + 3] = this.base[i] * Math.min(1, (1 - k) * 8) * k;
    }
    if (!alive) this.active = 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(-999);
    this.active = 1;
    this.update(0);
  }
}

// ---------------------------------------------------------------------------
// Afterimages: a few pooled copies of the player's rig frozen in a pose and
// faded out as translucent ink silhouettes (dash / perfect dodge).
// ---------------------------------------------------------------------------
export class Afterimages {
  private ghosts: { root: THREE.Object3D; bones: Map<string, THREE.Object3D>; mat: THREE.MeshBasicMaterial; t: number; dur: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, make: () => THREE.Object3D, count = 4) {
    for (let i = 0; i < count; i++) {
      const root = make();
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a2260, transparent: true, opacity: 0, depthWrite: false, fog: true });
      const bones = new Map<string, THREE.Object3D>();
      root.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.set(o.name, o);
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
            m.material = mat;
            m.castShadow = false;
            m.renderOrder = 8;
          } else m.visible = false; // cloth ribbons stay out of the silhouette
        }
      });
      root.visible = false;
      scene.add(root);
      this.ghosts.push({ root, bones, mat, t: 1, dur: 1 });
    }
  }

  // freeze a copy of `src` (a rig root with the same bone names) where it stands
  spawn(src: THREE.Object3D, color: THREE.Color, dur = 0.32) {
    const g = this.ghosts[this.next];
    this.next = (this.next + 1) % this.ghosts.length;
    g.root.position.copy(src.position);
    g.root.quaternion.copy(src.quaternion);
    g.root.scale.copy(src.scale);
    src.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const b = g.bones.get(o.name);
      if (!b) return;
      b.position.copy(o.position);
      b.quaternion.copy(o.quaternion);
      b.scale.copy(o.scale);
    });
    g.mat.color.copy(color);
    g.t = 0;
    g.dur = dur;
    g.root.visible = true;
  }

  update(dt: number) {
    for (const g of this.ghosts) {
      if (!g.root.visible) continue;
      g.t += dt;
      const k = 1 - g.t / g.dur;
      if (k <= 0) {
        g.root.visible = false;
        continue;
      }
      g.mat.opacity = 0.5 * k * k;
    }
  }

  clear() {
    for (const g of this.ghosts) g.root.visible = false;
  }
}
