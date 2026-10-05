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
// Blade trail: a fading ribbon swept between the weapon's base and tip. Three rows (dim root,
// a body, a white-hot cutting edge) and a trailing edge that narrows as the stretch ages, so a
// swing reads as a crescent instead of a flat band; heavy blows can ask for a longer life.
// ---------------------------------------------------------------------------
const WHITE = new THREE.Color(1, 1, 1);

export class BladeTrail {
  mesh: THREE.Mesh;
  private max = 26;
  private samples: { a: THREE.Vector3; b: THREE.Vector3; t: number; life: number }[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private life = 0.15;
  private tint = new THREE.Color(1.5, 1.45, 1.3);
  private edge = new THREE.Color();
  private rowA = new THREE.Vector3();
  private rowM = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const ROWS = 3;
    this.pos = new Float32Array(this.max * ROWS * 3);
    this.col = new Float32Array(this.max * ROWS * 4);
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const r0 = i * ROWS;
      const r1 = (i + 1) * ROWS;
      for (let j = 0; j < ROWS - 1; j++) idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
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

  /** `life`: how long this stretch of the swing stays visible */
  push(base: THREE.Vector3, tip: THREE.Vector3, time: number, life = this.life) {
    const last = this.samples[this.samples.length - 1];
    if (last && last.b.distanceToSquared(tip) < 0.0004) {
      last.t = time;
      return;
    }
    const s = this.samples.length >= this.max ? this.samples.shift()! : { a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, life };
    s.a.copy(base);
    s.b.copy(tip);
    s.t = time;
    s.life = life;
    this.samples.push(s);
  }

  update(time: number) {
    while (this.samples.length && time - this.samples[0].t > this.samples[0].life) this.samples.shift();
    const n = this.samples.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    this.edge.copy(this.tint).lerp(WHITE, 0.4);
    for (let i = 0; i < this.max; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const age = (time - s.t) / s.life;
      const k = i < n ? 1 - age : 0;
      const fade = Math.max(0, k) * (i / Math.max(1, n - 1));
      const f2 = fade * fade * 0.9;
      // the root of an older stretch creeps toward the tip: the crescent thins out behind the blade
      this.rowA.copy(s.a).lerp(s.b, Math.min(0.6, Math.max(0, age) * 0.65));
      this.rowM.copy(this.rowA).lerp(s.b, 0.74);
      this.pos.set([this.rowA.x, this.rowA.y, this.rowA.z, this.rowM.x, this.rowM.y, this.rowM.z, s.b.x, s.b.y, s.b.z], i * 9);
      const t = this.tint;
      const e = this.edge;
      this.col.set(
        [t.r * f2 * 0.06, t.g * f2 * 0.06, t.b * f2 * 0.06, f2 * 0.12, t.r * f2 * 0.5, t.g * f2 * 0.5, t.b * f2 * 0.5, f2 * 0.55, e.r * f2 * 1.3, e.g * f2 * 1.3, e.b * f2 * 1.3, f2],
        i * 12
      );
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.samples.length = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Impact bursts, one instanced quad per impact and one draw call for all of them. Every impact is
// the star flash (HDR, so it blooms); the kind adds layers on top: a shock ring that expands, a
// streak along the direction of the cut, and for parries a cross of sparks. The layers are drawn
// analytically in the fragment shader, in view-space metres around the impact.
// ---------------------------------------------------------------------------
export type ImpactKind = 'flash' | 'hit' | 'heavy' | 'crit' | 'parry' | 'perfect' | 'block' | 'hurt' | 'dodge';

// ring strength, streak strength, cross strength, ring size relative to the flash
const IMPACT_KINDS: Record<ImpactKind, [number, number, number, number]> = {
  flash: [0, 0, 0, 1],
  hit: [0, 0.75, 0, 1],
  heavy: [0.55, 1, 0, 1],
  crit: [0.9, 1.2, 0.5, 1.25],
  parry: [0.7, 0.7, 0.9, 0.9],
  perfect: [1, 1, 1, 1.15],
  block: [0.25, 0, 0, 0.7],
  hurt: [0.6, 0, 0, 0.9],
  dodge: [0.8, 0.5, 0, 1.1]
};
const IMPACT_FX_TIME = 0.26; // the ring and streak outlast the flash

export class ImpactPool {
  readonly mesh: THREE.Mesh;
  /** rings, streaks and crosses on top of the flash (off on low quality and with reduced motion) */
  fancy = true;
  private n: number;
  private items: { t: number; dur: number; size: number; spin: number; rot: number; ring: number; streak: number; cross: number; rscale: number; on: boolean }[] = [];
  private next = 0;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aA: THREE.InstancedBufferAttribute; // half extent, rotation, flash age 0..1, size
  private aB: THREE.InstancedBufferAttribute; // ring, streak, cross strength, ring scale
  private aDir: THREE.InstancedBufferAttribute; // cut direction x, z, layer age 0..1

  constructor(scene: THREE.Scene, count = 14) {
    this.n = count;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3);
    this.aCol = mk(3);
    this.aA = mk(4);
    this.aB = mk(4);
    this.aDir = mk(3);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aA', this.aA);
    geo.setAttribute('aB', this.aB);
    geo.setAttribute('aDir', this.aDir);
    geo.instanceCount = count;
    for (let i = 0; i < count; i++) {
      this.items.push({ t: 1, dur: 1, size: 1, spin: 0, rot: 0, ring: 0, streak: 0, cross: 0, rscale: 1, on: false });
      this.aA.setXYZW(i, 0, 0, 1, 1);
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: starTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec3 aCol; attribute vec4 aA; attribute vec4 aB; attribute vec3 aDir;
        varying vec2 vQ; varying vec3 vCol; varying vec4 vA; varying vec4 vB; varying vec2 vD; varying float vTr;
        void main() {
          vCol = aCol; vA = aA; vB = aB; vTr = aDir.z;
          vec2 d = (viewMatrix * vec4(aDir.x, 0.0, aDir.y, 0.0)).xy;
          float dl = length(d);
          vD = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
          vec2 q = position.xy * 2.0 * aA.x;
          vQ = q;
          vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vQ; varying vec3 vCol; varying vec4 vA; varying vec4 vB; varying vec2 vD; varying float vTr;
        void main() {
          float size = vA.w;
          float tf = vA.z;
          float tr = vTr;
          float e = 1.0 - (1.0 - tr) * (1.0 - tr);
          // the star flash (same growth and fade the sprite had)
          float sh = max(0.5 * size * (0.35 + 0.9 * sqrt(tf)), 1e-4);
          float cr = cos(vA.y);
          float sr = sin(vA.y);
          vec2 qs = vec2(cr * vQ.x + sr * vQ.y, -sr * vQ.x + cr * vQ.y) / (2.0 * sh) + 0.5;
          float I = 0.0;
          if (qs.x > 0.0 && qs.x < 1.0 && qs.y > 0.0 && qs.y < 1.0) I = texture2D(map, qs).a * (1.0 - tf * tf);
          // shock ring
          if (vB.x > 0.0) {
            float R = size * (0.12 + 0.5 * e) * vB.w;
            float th = size * 0.07 * (1.0 - 0.7 * tr) + 0.01;
            float d = abs(length(vQ) - R);
            float ring = smoothstep(th, 0.0, d) + 0.25 * exp(-d * d / (th * th * 9.0));
            I += vB.x * ring * pow(1.0 - tr, 1.3);
          }
          // streak along the cut, and the cross of a parry
          if (vB.y > 0.0 || vB.z > 0.0) {
            vec2 n = vec2(-vD.y, vD.x);
            float u = dot(vQ, vD);
            float v = dot(vQ, n);
            float Ls = size * (0.22 + 0.62 * e);
            float core = size * 0.022 * (1.0 - 0.5 * tr) + 0.006;
            float s1 = smoothstep(Ls, 0.0, abs(u)) * exp(-v * v / (core * core));
            float s2 = smoothstep(Ls * 0.6, 0.0, abs(v)) * exp(-u * u / (core * core * 1.6));
            I += (vB.y * s1 + vB.z * s2) * pow(1.0 - tr, 0.8);
          }
          gl_FragColor = vec4(vCol * I, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      fog: false
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    scene.add(this.mesh);
  }

  /** `dir` is the way the blow travelled (x, z); without it the streak and the cross are skipped */
  spawn(p: THREE.Vector3, color: THREE.Color, size = 1.2, dur = 0.14, kind: ImpactKind = 'flash', dir?: { x: number; z: number }) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const it = this.items[i];
    const [ring, streak, cross, rs] = IMPACT_KINDS[kind];
    const hasDir = !!dir && (dir.x !== 0 || dir.z !== 0);
    it.t = 0;
    it.dur = dur;
    it.size = size;
    it.spin = (Math.random() - 0.5) * 6;
    it.rot = Math.random() * Math.PI;
    it.ring = this.fancy ? ring : 0;
    it.streak = this.fancy && hasDir ? streak : 0;
    it.cross = this.fancy && hasDir ? cross : 0;
    it.rscale = rs;
    it.on = true;
    this.aPos.setXYZ(i, p.x, p.y, p.z);
    this.aCol.setXYZ(i, color.r, color.g, color.b);
    this.aB.setXYZW(i, it.ring, it.streak, it.cross, rs);
    const l = hasDir ? Math.hypot(dir!.x, dir!.z) : 1;
    this.aDir.setXYZ(i, hasDir ? dir!.x / l : 1, hasDir ? dir!.z / l : 0, 0);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aB.needsUpdate = true;
  }

  update(dt: number) {
    let touched = false;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (!it.on) continue;
      it.t += dt;
      const tf = Math.min(1, it.t / it.dur);
      const tr = Math.min(1, it.t / Math.max(it.dur, IMPACT_FX_TIME));
      const fxOn = (it.ring > 0 || it.streak > 0 || it.cross > 0) && tr < 1;
      touched = true;
      if (tf >= 1 && !fxOn) {
        it.on = false;
        this.aA.setXYZW(i, 0, 0, 1, 1);
        continue;
      }
      // half extent of the quad: the largest layer still alive (kept tight, these are additive)
      let half = tf < 1 ? 0.5 * it.size * (0.35 + 0.9 * Math.sqrt(tf)) : 0;
      if (fxOn) {
        const e = 1 - (1 - tr) * (1 - tr);
        if (it.ring > 0) half = Math.max(half, it.size * (0.12 + 0.5 * e) * it.rscale + (it.size * 0.07 + 0.01) * 4);
        if (it.streak > 0 || it.cross > 0) half = Math.max(half, it.size * (0.22 + 0.62 * e));
      }
      this.aA.setXYZW(i, half, it.rot + it.spin * it.t, tf, it.size);
      this.aDir.setZ(i, tr);
    }
    if (touched) this.aA.needsUpdate = this.aDir.needsUpdate = true;
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
// Streaks: pooled quads stretched along their own velocity, one draw call for the whole pool.
// Sparks are bright additive slivers that cool and shrink as they die; blood drops are dark
// slivers that, on reaching the ground, lie down as small ovals pointing the way they were thrown.
// ---------------------------------------------------------------------------
export class StreakPool {
  readonly mesh: THREE.Mesh;
  private n: number;
  private limit: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private misc: Float32Array; // width, lying on the ground (0/1), heading on the ground, length on the ground
  private base: Float32Array; // colour at birth
  private a0: Float32Array;
  private w0: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private rest: Float32Array; // seconds a drop stays on the ground (0: bounces like a spark)
  private next = 0;
  private live = 0;
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, o: { max: number; additive: boolean; stretch: number }) {
    const n = (this.n = this.limit = o.max);
    this.pos = new Float32Array(n * 3).fill(-999);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.misc = new Float32Array(n * 4);
    this.base = new Float32Array(n * 3);
    this.a0 = new Float32Array(n);
    this.w0 = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.rest = new Float32Array(n);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const mk = (arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(this.pos, 3);
    this.aVel = mk(this.vel, 3);
    this.aCol = mk(this.col, 4);
    this.aMisc = mk(this.misc, 4);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aMisc', this.aMisc);
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uStretch: { value: o.stretch } },
      defines: { ADD: o.additive ? 1 : 0 },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aCol; attribute vec4 aMisc;
        uniform float uStretch;
        varying vec2 vUv; varying vec4 vCol; varying float vMode;
        void main() {
          vUv = uv; vCol = aCol; vMode = aMisc.y;
          float w = aMisc.x;
          if (aMisc.y > 0.5) {
            // lying on the ground: an oval along the heading
            float c = cos(aMisc.z);
            float s = sin(aMisc.z);
            vec2 q = vec2(position.x * w, position.y * aMisc.w);
            vec3 wp = aPos + vec3(q.x * c - q.y * s, 0.0, q.x * s + q.y * c);
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          } else {
            // in the air: a sliver from the tail (a moment ago) to the head, always facing the camera
            vec4 head = modelViewMatrix * vec4(aPos, 1.0);
            vec4 tail = modelViewMatrix * vec4(aPos - aVel * uStretch, 1.0);
            vec2 d = head.xy - tail.xy;
            float len = length(d);
            d = len > 1e-5 ? d / len : vec2(0.0, 1.0);
            vec2 n = vec2(-d.y, d.x);
            float L = max(len, w * 1.4);
            float t = position.y + 0.5;
            vec4 mv = head;
            mv.xy += d * ((t - 1.0) * L + t * w * 0.5) + n * position.x * w;
            mv.z = mix(tail.z, head.z, t);
            gl_Position = projectionMatrix * mv;
          }
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec4 vCol; varying float vMode;
        void main() {
          float a;
          if (vMode > 0.5) {
            a = 1.0 - smoothstep(0.55, 1.0, length(vUv * 2.0 - 1.0));
          } else {
            float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
            a = smoothstep(0.0, 0.7, across) * mix(0.12, 1.0, vUv.y * vUv.y);
          }
          a *= vCol.a;
          #if ADD
            gl_FragColor = vec4(vCol.rgb * a, 1.0);
          #else
            gl_FragColor = vec4(vCol.rgb, a);
          #endif
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      ...(o.additive
        ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor }
        : { blending: THREE.NormalBlending })
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.additive ? 22 : 4;
    scene.add(this.mesh);
  }

  /** How many of the pool's slots are in use (quality): the oldest are recycled past this. */
  setLimit(k: number) {
    this.limit = Math.max(1, Math.min(this.n, Math.round(k)));
    for (let i = this.limit; i < this.n; i++) this.kill(i);
    this.next %= this.limit;
  }

  /** `rest` > 0 makes a drop that lands lie there for that many seconds; 0 bounces like a spark. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, grav: number, r: number, g: number, b: number, alpha: number, width: number, rest = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = r;
    this.base[i * 3 + 1] = g;
    this.base[i * 3 + 2] = b;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = alpha;
    this.a0[i] = alpha;
    this.w0[i] = width;
    this.misc[i * 4] = width;
    this.misc[i * 4 + 1] = 0;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.rest[i] = rest;
    this.live++;
  }

  private kill(i: number) {
    this.life[i] = 0;
    this.pos[i * 3 + 1] = -999;
    this.col[i * 4 + 3] = 0;
    this.misc[i * 4 + 1] = 0;
  }

  update(dt: number) {
    if (this.live <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.limit; i++) {
      let life = this.life[i];
      if (life <= 0) continue;
      life -= dt;
      if (life <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = life;
      alive++;
      const k = i * 3;
      const c = i * 4;
      const f = life / this.maxLife[i];
      if (this.misc[c + 1] > 0.5) {
        // lying on the ground: solid for a while, then it fades
        this.col[c + 3] = this.a0[i] * Math.min(1, f * 2.2);
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] <= 0.05) {
        if (this.rest[i] > 0) {
          // a drop lands: lie down along the way it was flying
          const vx = this.vel[k];
          const vz = this.vel[k + 2];
          const sp = Math.hypot(vx, vz);
          this.pos[k + 1] = 0.052 + (i % 5) * 0.0006;
          this.misc[c + 1] = 1;
          this.misc[c + 2] = sp > 0.01 ? Math.atan2(-vx, vz) : Math.random() * 6.28;
          this.misc[c] = this.w0[i] * 1.7;
          this.misc[c + 3] = Math.min(0.4, this.w0[i] * (2.2 + sp * 0.35));
          this.col[c] = this.base[k] * 0.72;
          this.col[c + 1] = this.base[k + 1] * 0.72;
          this.col[c + 2] = this.base[k + 2] * 0.72;
          this.life[i] = this.maxLife[i] = this.rest[i] * (0.7 + Math.random() * 0.6);
          continue;
        }
        this.pos[k + 1] = 0.05;
        this.vel[k + 1] *= -0.3;
      }
      if (this.rest[i] > 0) continue; // blood keeps its colour in the air
      // sparks cool from white-yellow toward red, thin out and fade
      this.col[c] = this.base[k] * (0.4 + 0.6 * f);
      this.col[c + 1] = this.base[k + 1] * (0.25 + 0.75 * f);
      this.col[c + 2] = this.base[k + 2] * (0.12 + 0.88 * f);
      this.col[c + 3] = this.a0[i] * Math.min(1, f * 4);
      this.misc[c] = this.w0[i] * (0.45 + 0.55 * f);
    }
    this.live = alive;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aMisc.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.n; i++) this.kill(i);
    this.live = 1;
    this.update(0);
    this.live = 0;
    this.next = 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Afterimages: a few pooled copies of the player's rig frozen in a pose and
// faded out as translucent ink silhouettes (dash / perfect dodge).
// ---------------------------------------------------------------------------
export class Afterimages {
  private ghosts: { root: THREE.Object3D; bones: Map<string, THREE.Object3D>; mat: THREE.MeshBasicMaterial; t: number; dur: number }[] = [];
  private next = 0;

  constructor(
    private scene: THREE.Scene,
    make: () => THREE.Object3D,
    count = 4
  ) {
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

  dispose() {
    for (const g of this.ghosts) {
      this.scene.remove(g.root);
      g.mat.dispose();
    }
    this.ghosts = [];
  }
}

// ---------------------------------------------------------------------------
// Weapon effects for the fighters: a glow along a blade, and arcs of lightning.
// Both live on the weapon model (blade along its local +Z) and cost nothing while
// invisible; `update` is called each frame by the owner.
// ---------------------------------------------------------------------------
export interface WeaponFx {
  update(t: number): void;
  dispose(): void;
}

/** A sheath of light around the blade, with a bright core. `color` is HDR so it blooms. */
export function makeBladeGlow(weapon: THREE.Object3D, color: THREE.Color, base: number, tip: number): WeaponFx {
  const len = tip - base;
  const mk = (w: number, c: THREE.Color, op: number) =>
    new THREE.Mesh(
      new THREE.BoxGeometry(w, w, len),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
  const halo = mk(0.09, color, 0.42);
  const core = mk(0.03, new THREE.Color(1, 1, 1).lerp(color, 0.25).multiplyScalar(1.4), 0.9);
  const g = new THREE.Group();
  g.add(halo, core);
  g.position.z = (base + tip) / 2;
  g.renderOrder = 15;
  weapon.add(g);
  return {
    update(t) {
      const k = 0.85 + Math.sin(t * 17) * 0.1 + Math.sin(t * 41) * 0.05;
      halo.scale.set(k, k, 1);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.34 + 0.12 * k;
    },
    dispose() {
      weapon.remove(g);
      for (const m of [halo, core]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
  };
}

/** Crackling lightning along the blade: a few jagged arcs that re-roll many times a second. */
export function makeLightning(weapon: THREE.Object3D, color: THREE.Color, base: number, tip: number): WeaponFx {
  const ARCS = 3;
  const PTS = 7;
  const pos = new Float32Array(ARCS * (PTS - 1) * 2 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  line.frustumCulled = false;
  line.renderOrder = 15;
  weapon.add(line);
  // a soft violet halo so the arcs read from afar
  const halo = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, tip - base),
    new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  halo.position.z = (base + tip) / 2;
  halo.renderOrder = 15;
  weapon.add(halo);
  let next = 0;
  const roll = () => {
    let o = 0;
    for (let a = 0; a < ARCS; a++) {
      const z0 = base + Math.random() * (tip - base) * 0.3;
      const z1 = tip + Math.random() * 0.25; // some arcs leap past the tip
      const amp = 0.05 + Math.random() * 0.1;
      let px = 0;
      let py = 0;
      let pz = z0;
      for (let i = 1; i < PTS; i++) {
        const f = i / (PTS - 1);
        const w = Math.sin(f * Math.PI) * amp * 2.2;
        const nx = (Math.random() - 0.5) * w;
        const ny = (Math.random() - 0.5) * w;
        const nz = z0 + (z1 - z0) * f;
        pos[o++] = px;
        pos[o++] = py;
        pos[o++] = pz;
        pos[o++] = nx;
        pos[o++] = ny;
        pos[o++] = nz;
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    g.attributes.position.needsUpdate = true;
  };
  roll();
  return {
    update(t) {
      if (t >= next) {
        next = t + 0.05 + Math.random() * 0.04;
        roll();
      }
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.16 * Math.random();
    },
    dispose() {
      weapon.remove(line, halo);
      g.dispose();
      (line.material as THREE.Material).dispose();
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
    }
  };
}
