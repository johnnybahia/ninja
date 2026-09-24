import * as THREE from 'three';
import { TAU, rand } from './constants';
import type { Atmos } from './atmosphere';

// ===========================================================================
// Garden details around the temple: koi pond, bamboo grove, red spider lilies,
// pebbles and fallen petals. Everything repeated is instanced (one draw call per
// kind); the pond water is a small custom shader reflecting the current sky.
// ===========================================================================

export type Solid = { x: number; z: number; r: number; h: number };

const POND = { x: -21, z: -6, r: 4.4 };
const GROVE = { x: 24.5, z: -4 };

function pondRadius(a: number) {
  return POND.r * (1 + Math.sin(a * 3 + 0.7) * 0.09 + Math.sin(a * 5 + 2.1) * 0.05);
}

export class Garden {
  solids: Solid[] = [];
  private water: THREE.Mesh;
  private waterU: Record<string, THREE.IUniform>;
  private koi: THREE.InstancedMesh;
  private koiData: { r: number; speed: number; ph: number; depth: number; wob: number }[] = [];
  private dummy = new THREE.Object3D();

  constructor(root: THREE.Object3D, atm: Atmos, windTime: { value: number }, isFree: (x: number, z: number, pad: number) => boolean) {
    this.water = this.buildPond(root, atm);
    this.waterU = (this.water.material as THREE.ShaderMaterial).uniforms;
    this.koi = this.buildKoi(root);
    this.buildBamboo(root, windTime);
    this.buildFlowers(root, windTime, isFree);
    this.buildPebbles(root, isFree);
    this.buildPetalCarpet(root, isFree);
  }

  // true when (x, z) is clear of the pond and grove (used by grass / props placement)
  static blocked(x: number, z: number) {
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.9) return true;
    if (Math.hypot(x - GROVE.x, z - GROVE.z) < 5.2) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  private buildPond(root: THREE.Object3D, atm: Atmos) {
    // pond bed: dark mud bowl slightly below ground
    const shape = new THREE.Shape();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const r = pondRadius(a);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const bedG = new THREE.ShapeGeometry(shape, 12).rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bedG, new THREE.MeshStandardMaterial({ color: 0x1c2420, roughness: 1 }));
    bed.position.set(POND.x, 0.015, POND.z);
    bed.receiveShadow = true;
    root.add(bed);

    // edging stones
    const stoneG = new THREE.DodecahedronGeometry(1, 0);
    const n = 30;
    const stones = new THREE.InstancedMesh(stoneG, new THREE.MeshStandardMaterial({ color: 0x6a655e, roughness: 0.9, flatShading: true }), n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.05, 0.05);
      const r = pondRadius(a) + rand(0.05, 0.3);
      const s = rand(0.28, 0.5);
      this.dummy.position.set(POND.x + Math.cos(a) * r, s * 0.35, POND.z + Math.sin(a) * r);
      this.dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      this.dummy.scale.set(s * 1.3, s * 0.6, s);
      this.dummy.updateMatrix();
      stones.setMatrixAt(i, this.dummy.matrix);
    }
    stones.castShadow = true;
    stones.receiveShadow = true;
    root.add(stones);

    // lily pads and a few lotus flowers floating on the surface
    const padG = new THREE.CircleGeometry(0.32, 14, 0.3, TAU - 0.5).rotateX(-Math.PI / 2);
    const pads = new THREE.InstancedMesh(padG, new THREE.MeshStandardMaterial({ color: 0x3f6a34, roughness: 0.6 }), 14);
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const r = rand(0.6, POND.r * 0.75);
      const s = rand(0.7, 1.3);
      this.dummy.position.set(POND.x + Math.cos(a) * r, 0.155, POND.z + Math.sin(a) * r);
      this.dummy.rotation.set(0, rand(0, TAU), 0);
      this.dummy.scale.set(s, 1, s);
      this.dummy.updateMatrix();
      pads.setMatrixAt(i, this.dummy.matrix);
    }
    pads.renderOrder = 6;
    root.add(pads);
    const lotusG = new THREE.ConeGeometry(0.11, 0.12, 7, 1, true).rotateX(Math.PI);
    const lotus = new THREE.InstancedMesh(lotusG, new THREE.MeshStandardMaterial({ color: 0xf2b8c8, emissive: 0x3a1420, side: THREE.DoubleSide }), 5);
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU);
      const r = rand(0.8, POND.r * 0.65);
      this.dummy.position.set(POND.x + Math.cos(a) * r, 0.2, POND.z + Math.sin(a) * r);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      lotus.setMatrixAt(i, this.dummy.matrix);
    }
    root.add(lotus);

    // water: sky reflection by fresnel, sun glint on animated ripples, see-through center
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3() },
          uSunCol: { value: new THREE.Color() },
          uCenter: { value: new THREE.Vector2(POND.x, POND.z) },
          uRadius: { value: POND.r }
        }
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;
        uniform vec2 uCenter; uniform float uRadius;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz;
          // two layers of travelling ripples -> perturbed normal
          float w1 = sin(p.x * 3.1 + uTime * 1.4) * cos(p.y * 2.7 - uTime * 1.1);
          float w2 = sin((p.x + p.y) * 5.3 - uTime * 2.2) * 0.5;
          vec3 n = normalize(vec3(w1 * 0.07 + w2 * 0.04, 1.0, cos(p.x * 2.3 - uTime) * 0.06 + w2 * 0.03));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, r.y));
          float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 420.0);
          vec3 deep = vec3(0.02, 0.07, 0.07);
          vec3 col = mix(deep, sky, 0.25 + fres * 0.6) + uSunCol * min(spec * 1.4, 1.2);
          float edge = length(p - uCenter) / uRadius;
          float a = mix(0.5, 0.95, fres) * smoothstep(1.08, 0.9, edge);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `
    });
    const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12).rotateX(-Math.PI / 2), mat);
    water.position.set(POND.x, 0.14, POND.z);
    water.renderOrder = 4;
    root.add(water);
    this.solids.push({ x: POND.x, z: POND.z, r: POND.r - 0.2, h: 6 });
    this.syncWater(atm);
    return water;
  }

  private buildKoi(root: THREE.Object3D) {
    // simple fish: tapered body + tail fin, orange/white/black mixes via instance color
    const body = new THREE.SphereGeometry(0.13, 8, 6).scale(0.7, 0.4, 2.2);
    const tail = new THREE.ConeGeometry(0.09, 0.18, 4).rotateX(-Math.PI / 2).scale(1, 0.25, 1).translate(0, 0, -0.3);
    const geo = new THREE.BufferGeometry();
    // merge body + tail by hand (both indexed)
    const merged = [body, tail].map((g) => g.toNonIndexed());
    const pos = new Float32Array(merged.reduce((s, g) => s + g.attributes.position.array.length, 0));
    const nor = new Float32Array(pos.length);
    let o = 0;
    for (const g of merged) {
      pos.set(g.attributes.position.array as Float32Array, o);
      nor.set(g.attributes.normal.array as Float32Array, o);
      o += g.attributes.position.array.length;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const n = 7;
    const koi = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0x3a1a08 }), n);
    const cols = [0xff7a1a, 0xf2f2ee, 0xff5a20, 0xffa040, 0xe8e6e0, 0xff6a2a, 0x2a2420];
    for (let i = 0; i < n; i++) {
      koi.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      this.koiData.push({ r: rand(1, POND.r * 0.7), speed: rand(0.25, 0.5) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, TAU), depth: rand(0.07, 0.085), wob: rand(0, 10) });
    }
    root.add(koi);
    return koi;
  }

  private buildBamboo(root: THREE.Object3D, windTime: { value: number }) {
    // stalk texture: green with darker node rings every ~0.7m
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 32, 0);
    grd.addColorStop(0, '#4f6a2c');
    grd.addColorStop(0.5, '#7f9a44');
    grd.addColorStop(1, '#4a6228');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = 'rgba(40,52,20,0.9)';
      g.fillRect(0, y, 32, 3);
      g.fillStyle = 'rgba(190,200,120,0.5)';
      g.fillRect(0, y + 3, 32, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 3);

    const sway = (m: THREE.Material, amp: number, key: string) => {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = windTime;
        shader.vertexShader =
          'uniform float uWindTime;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec3 wo = instanceMatrix[3].xyz;
            float hh = clamp(position.y / 7.0, 0.0, 1.0);
            float ph = uWindTime * 1.3 + wo.x * 0.4 + wo.z * 0.3;
            transformed.x += sin(ph) * ${amp.toFixed(3)} * hh * hh;
            transformed.z += cos(ph * 0.8) * ${(amp * 0.5).toFixed(3)} * hh * hh;`
          );
      };
      m.customProgramCacheKey = () => key;
    };

    const stalkG = new THREE.CylinderGeometry(0.065, 0.08, 7, 7).translate(0, 3.5, 0);
    const stalkM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    sway(stalkM, 0.35, 'bamboo');
    const clumps = [[0, 0], [2.2, 1.6], [-1.8, 2.2], [1.4, -2.3], [-2.2, -1.4], [3.2, -0.6]];
    const stalks: THREE.Matrix4[] = [];
    const leafSpots: THREE.Vector3[] = [];
    for (const [cx, cz] of clumps) {
      const k = 4 + Math.floor(rand(0, 3));
      for (let i = 0; i < k; i++) {
        const x = GROVE.x + cx + rand(-0.6, 0.6);
        const z = GROVE.z + cz + rand(-0.6, 0.6);
        const h = rand(0.8, 1.15);
        this.dummy.position.set(x, 0, z);
        this.dummy.rotation.set(rand(-0.06, 0.06), rand(0, TAU), rand(-0.06, 0.06));
        this.dummy.scale.set(1, h, 1);
        this.dummy.updateMatrix();
        stalks.push(this.dummy.matrix.clone());
        for (let l = 0; l < 4; l++) leafSpots.push(new THREE.Vector3(x + rand(-0.5, 0.5), 7 * h * rand(0.55, 1.0), z + rand(-0.5, 0.5)));
      }
      this.solids.push({ x: GROVE.x + cx, z: GROVE.z + cz, r: 0.9, h: 7 });
    }
    const stalkMesh = new THREE.InstancedMesh(stalkG, stalkM, stalks.length);
    stalks.forEach((m, i) => stalkMesh.setMatrixAt(i, m));
    stalkMesh.castShadow = true;
    root.add(stalkMesh);

    // leaf sprays: bunches of narrow blades
    const leafG = new THREE.PlaneGeometry(0.12, 0.8).translate(0, -0.36, 0);
    const leafM = new THREE.MeshStandardMaterial({ color: 0x5c8a38, side: THREE.DoubleSide, roughness: 0.7 });
    sway(leafM, 0.35, 'bambooLeaf');
    const perSpot = 9;
    const leaves = new THREE.InstancedMesh(leafG, leafM, leafSpots.length * perSpot);
    let li = 0;
    for (const s of leafSpots) {
      for (let j = 0; j < perSpot; j++) {
        this.dummy.position.copy(s);
        this.dummy.rotation.set(rand(0.6, 1.4), (j / perSpot) * TAU + rand(-0.3, 0.3), rand(-0.3, 0.3));
        this.dummy.scale.setScalar(rand(0.8, 1.2));
        this.dummy.updateMatrix();
        leaves.setMatrixAt(li++, this.dummy.matrix);
        leaves.setColorAt(li - 1, new THREE.Color().setHSL(0.25 + rand(-0.03, 0.03), 0.5, rand(0.32, 0.46)));
      }
    }
    leaves.castShadow = true;
    root.add(leaves);
  }

  private buildFlowers(root: THREE.Object3D, windTime: { value: number }, isFree: (x: number, z: number, pad: number) => boolean) {
    // Red spider lily: long curled petals and whisker stamens radiating from the top
    // of a bare stem. Built once, instanced in drifts.
    const parts: THREE.BufferGeometry[] = [];
    const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.5, 4).translate(0, 0.25, 0);
    parts.push(stem);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const petal = new THREE.PlaneGeometry(0.035, 0.16).translate(0, 0.08, 0);
      petal.rotateX(-1.15);
      petal.rotateY(a);
      petal.translate(0, 0.5, 0);
      parts.push(petal);
      const stamen = new THREE.PlaneGeometry(0.006, 0.2).translate(0, 0.1, 0);
      stamen.rotateX(-0.6);
      stamen.rotateY(a + 0.5);
      stamen.translate(0, 0.5, 0);
      parts.push(stamen);
    }
    const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const count = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let o = 0;
    geos.forEach((g, gi) => {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      const c = gi === 0 ? [0.18, 0.35, 0.12] : [1.25, 0.08, 0.06];
      for (let i = 0; i < g.attributes.position.count; i++) col.set(c, (o + i) * 3);
      o += g.attributes.position.count;
    });
    const flowerG = new THREE.BufferGeometry();
    flowerG.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flowerG.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    flowerG.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x2a0202 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime;
      shader.vertexShader =
        'uniform float uWindTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 wo = instanceMatrix[3].xyz;
          float hh = clamp(position.y / 0.6, 0.0, 1.0);
          float ph = uWindTime * 2.2 + wo.x * 0.5 + wo.z * 0.4;
          transformed.x += sin(ph) * 0.05 * hh;
          transformed.z += cos(ph * 0.9) * 0.03 * hh;`
        );
    };
    mat.customProgramCacheKey = () => 'lily';

    const drifts = [
      [-10, 14, 2.6, 40], [10.5, 13.5, 2.4, 36], [-14, -14, 2.2, 30], [14, -15, 2.5, 34],
      [-4.4, -17, 1.2, 18], [4.4, -18, 1.2, 18], [-17, -3, 1.6, 22], [19, 9, 2.4, 30], [-19, 10, 2, 26]
    ];
    const total = drifts.reduce((s, d) => s + d[3], 0);
    const lilies = new THREE.InstancedMesh(flowerG, mat, total);
    let i = 0;
    for (const [dx, dz, rad, n] of drifts) {
      for (let k = 0; k < n; k++) {
        let x = 0;
        let z = 0;
        let ok = false;
        for (let t = 0; t < 8 && !ok; t++) {
          const a = rand(0, TAU);
          const r = Math.sqrt(Math.random()) * rad;
          x = dx + Math.cos(a) * r;
          z = dz + Math.sin(a) * r;
          ok = isFree(x, z, 0.3);
        }
        if (!ok) continue;
        const s = rand(0.8, 1.25);
        this.dummy.position.set(x, 0, z);
        this.dummy.rotation.set(rand(-0.12, 0.12), rand(0, TAU), rand(-0.12, 0.12));
        this.dummy.scale.set(s, s * rand(0.85, 1.2), s);
        this.dummy.updateMatrix();
        lilies.setMatrixAt(i++, this.dummy.matrix);
      }
    }
    lilies.count = i;
    root.add(lilies);
  }

  private buildPebbles(root: THREE.Object3D, isFree: (x: number, z: number, pad: number) => boolean) {
    const n = 420;
    const g = new THREE.DodecahedronGeometry(1, 0);
    const pebbles = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), n);
    let i = 0;
    for (let t = 0; t < n * 3 && i < n; t++) {
      // mostly along the plaza curb and the stone path
      const near = Math.random() < 0.6;
      const a = rand(0, TAU);
      const r = near ? 13.2 + Math.abs(rand(-1.2, 1.6)) : rand(14, 30);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (!isFree(x, z, 0.2)) continue;
      const s = rand(0.035, 0.1);
      this.dummy.position.set(x, s * 0.3, z);
      this.dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      this.dummy.scale.set(s * 1.3, s * 0.7, s);
      this.dummy.updateMatrix();
      pebbles.setMatrixAt(i, this.dummy.matrix);
      const v = rand(0.1, 0.22);
      pebbles.setColorAt(i, new THREE.Color(v, v * 0.97, v * 0.92));
      i++;
    }
    pebbles.count = i;
    pebbles.receiveShadow = true;
    root.add(pebbles);
  }

  private buildPetalCarpet(root: THREE.Object3D, isFree: (x: number, z: number, pad: number) => boolean) {
    const n = 1400;
    const g = new THREE.PlaneGeometry(0.09, 0.06).rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xf0b0c2, roughness: 0.8 }), n);
    let i = 0;
    for (let t = 0; t < n * 3 && i < n; t++) {
      // thicker drifts on the plaza edges and path, thinner everywhere else
      const a = rand(0, TAU);
      const r = Math.random() < 0.55 ? rand(9, 14.5) : rand(3, 30);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (!isFree(x, z, 0)) continue;
      this.dummy.position.set(x, 0.035 + Math.random() * 0.01, z);
      this.dummy.rotation.set(rand(-0.25, 0.25), rand(0, TAU), rand(-0.25, 0.25));
      this.dummy.scale.setScalar(rand(0.7, 1.3));
      this.dummy.updateMatrix();
      m.setMatrixAt(i, this.dummy.matrix);
      m.setColorAt(i, new THREE.Color().setHSL(0.94 + rand(-0.02, 0.02), 0.55, rand(0.6, 0.78)));
      i++;
    }
    m.count = i;
    m.receiveShadow = true;
    root.add(m);
  }

  // ---------------------------------------------------------------------------
  syncWater(atm: Atmos) {
    const u = (this.water?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!u) return;
    (u.uZenith.value as THREE.Color).copy(atm.zenith).multiplyScalar(1.6);
    (u.uHorizon.value as THREE.Color).copy(atm.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(atm.sunDir);
    (u.uSunCol.value as THREE.Color).copy(atm.sunGlow);
  }

  update(dt: number, time: number, atm: Atmos) {
    this.waterU.uTime.value = time;
    this.syncWater(atm);
    for (let i = 0; i < this.koiData.length; i++) {
      const k = this.koiData[i];
      k.ph += (k.speed / k.r) * dt;
      const x = POND.x + Math.cos(k.ph) * k.r;
      const z = POND.z + Math.sin(k.ph) * k.r * 0.8;
      this.dummy.position.set(x, k.depth, z);
      // swim tangentially, with a lazy tail-driven wobble
      const dir = Math.sign(k.speed);
      this.dummy.rotation.set(0, Math.atan2(-Math.sin(k.ph) * dir, Math.cos(k.ph) * 0.8 * dir) + Math.sin(time * 5 + k.wob) * 0.18, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.koi.setMatrixAt(i, this.dummy.matrix);
    }
    this.koi.instanceMatrix.needsUpdate = true;
  }
}
