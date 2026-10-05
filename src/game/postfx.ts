import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type Quality = 'high' | 'medium' | 'low';
export type QualitySetting = Quality | 'auto';

export interface QualityProfile {
  pixelRatio: number;
  composer: boolean;
  msaa: number;
  shadowMap: number;
  softShadows: boolean;
  bloom: boolean;
  grassDensity: number;
  ambientParticles: number;
  ink: boolean;
  rays: boolean;
  mistLayers: number;
  reflections: boolean;
  dof: boolean;
  groundFx: number; // plaza detail layers (plaza.ts): 0 none, 0.5 lighter, 1 full
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'high')
    return { pixelRatio: Math.min(dpr, 2), composer: true, msaa: 4, shadowMap: 2048, softShadows: true, bloom: true, grassDensity: 1, ambientParticles: 1, ink: true, rays: true, mistLayers: 2, reflections: true, dof: true, groundFx: 1 };
  if (q === 'medium')
    return { pixelRatio: Math.min(dpr, 1.5), composer: true, msaa: 2, shadowMap: 1024, softShadows: true, bloom: true, grassDensity: 0.6, ambientParticles: 0.7, ink: true, rays: false, mistLayers: 1, reflections: false, dof: false, groundFx: 0.5 };
  return { pixelRatio: 1, composer: false, msaa: 0, shadowMap: 1024, softShadows: false, bloom: false, grassDensity: 0, ambientParticles: 0.4, ink: false, rays: false, mistLayers: 0, reflections: false, dof: false, groundFx: 0 };
}

export function detectQuality(): Quality {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  return coarse || small ? 'medium' : 'high';
}

// Cinematic grade applied in linear HDR before tone mapping: split toning, saturation,
// contrast, edge chromatic aberration, vignette and film grain, plus gameplay-driven
// desaturation (slow motion) and a red edge pulse when the player gets hurt.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uShadowTint: { value: new THREE.Color(0.9, 0.94, 1.1) },
    uHighTint: { value: new THREE.Color(1.06, 1.0, 0.9) },
    uSat: { value: 1.08 },
    uContrast: { value: 1.08 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.045 },
    uAberration: { value: 0.012 },
    uDesat: { value: 0 },
    uHurt: { value: 0 },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uNear: { value: 0.1 },
    uFar: { value: 420 },
    uInk: { value: 0 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uRays: { value: 0 },
    uRayColor: { value: new THREE.Color(1.2, 0.7, 0.4) },
    uFlash: { value: 0 },
    uSpike: { value: 0 },
    uRadial: { value: 0 },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uDof: { value: 0 },
    uFocusDist: { value: 5 },
    uFocusRange: { value: 3 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uNear;
    uniform float uFar;
    uniform float uInk;
    uniform vec2 uSunUv;
    uniform float uRays;
    uniform vec3 uRayColor;
    uniform float uTime;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    uniform float uSat;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uDesat;
    uniform float uHurt;
    uniform float uFlash;
    uniform float uSpike;
    uniform float uRadial;
    uniform vec2 uFocus;
    uniform float uDof;
    uniform float uFocusDist;
    uniform float uFocusRange;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float invDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return 1.0 / max(-perspectiveDepthToViewZ(d, uNear, uFar), 0.05);
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * (r2 * uAberration + uSpike * 0.03 * (0.25 + 4.0 * r2));
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );

      // Finisher cinematic: depth of field (blur grows with distance from the focal plane)
      // and a radial rush toward the strike. Both cost nothing while off.
      float coc = 0.0;
      if (uDof > 0.0 || uRadial > 0.0) {
        if (uDof > 0.0) {
          float z = 1.0 / invDepth(vUv);
          coc = clamp(abs(z - uFocusDist) / uFocusRange - 0.35, 0.0, 1.0) * uDof;
        }
        vec2 toF = vUv - uFocus;
        float rad = uRadial * smoothstep(0.08, 0.65, length(toF));
        float amt = clamp(coc + rad * 3.0, 0.0, 1.0);
        if (amt > 0.01) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 10; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            float rr = sqrt((fi + 0.5) / 10.0);
            vec2 tap = vUv + vec2(cos(a), sin(a)) * rr * coc * 12.0 * uTexel - toF * rad * 0.09 * (fi / 9.0);
            acc += texture2D(tDiffuse, tap).rgb;
          }
          col = mix(col, acc / 10.0, amt);
        }
      }

      // Ink outline: the Laplacian of 1/depth is ~0 across flat surfaces and spikes at
      // silhouettes, so only real shape edges get a brush line (thinner in the distance)
      if (uInk > 0.0) {
        float ic = invDepth(vUv);
        vec2 o = uTexel * 1.3;
        float lx = invDepth(vUv + vec2(o.x, 0.0)) + invDepth(vUv - vec2(o.x, 0.0)) - 2.0 * ic;
        float ly = invDepth(vUv + vec2(0.0, o.y)) + invDepth(vUv - vec2(0.0, o.y)) - 2.0 * ic;
        float dist = 1.0 / ic;
        float edge = (abs(lx) + abs(ly)) * dist;
        float ink = smoothstep(0.14, 0.5, edge) * (1.0 - smoothstep(25.0, 70.0, dist));
        col = mix(col, col * 0.35, ink * uInk * (1.0 - clamp(coc * 1.6, 0.0, 1.0)));
      }

      // Light shafts: march toward the sun and gather bright open sky, so gaps between
      // the temple, trees and characters cast visible rays
      if (uRays > 0.0) {
        vec2 delta = vUv - uSunUv;
        vec2 stepv = delta * (0.92 / 20.0);
        vec2 ruv = vUv;
        float illum = 0.0;
        float decay = 1.0;
        for (int i = 0; i < 20; i++) {
          ruv -= stepv;
          float sky = step(0.99995, texture2D(tDepth, ruv).x);
          illum += sky * max(luma(texture2D(tDiffuse, ruv).rgb) - 0.2, 0.0) * decay;
          decay *= 0.94;
        }
        col += uRayColor * illum * (uRays / 20.0) * (1.0 - smoothstep(0.15, 1.0, length(delta)));
      }

      float l = luma(col);
      col *= mix(vec3(1.0), uShadowTint, 1.0 - smoothstep(0.0, 0.45, l));
      col *= mix(vec3(1.0), uHighTint, smoothstep(0.3, 1.4, l));

      l = luma(col);
      col = mix(vec3(l), col, uSat * (1.0 - 0.75 * uDesat));
      col = pow(max(col, vec3(0.0)) / 0.18, vec3(uContrast)) * 0.18;

      float vig = 1.0 - smoothstep(0.18, 0.75, r2 * (1.0 + 0.9 * uDesat)) * uVignette;
      col *= vig;

      float edge = smoothstep(0.08, 0.5, r2);
      col = mix(col, col * vec3(1.35, 0.4, 0.35) + vec3(0.06, 0.0, 0.0), uHurt * edge);

      col += vec3(uFlash);

      float g = hash(vUv * vec2(1731.0, 947.0) + fract(uTime * 7.13)) - 0.5;
      col *= 1.0 + g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export interface GradeLook {
  shadowTint: [number, number, number];
  highTint: [number, number, number];
  sat: number;
  contrast: number;
  vignette: number;
  bloom: number;
}

export const NINJA_LOOK: GradeLook = {
  shadowTint: [0.88, 0.93, 1.12],
  highTint: [1.07, 1.0, 0.88],
  sat: 1.1,
  contrast: 1.07,
  vignette: 0.5,
  bloom: 0.55
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, msaa: number, bloomOn: boolean) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? msaa : 0
    });
    target.depthTexture = new THREE.DepthTexture(size.x, size.y);
    target.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.9);
    this.bloom.enabled = bloomOn;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setLook(look: GradeLook) {
    const u = this.grade.uniforms;
    (u.uShadowTint.value as THREE.Color).setRGB(...look.shadowTint);
    (u.uHighTint.value as THREE.Color).setRGB(...look.highTint);
    u.uSat.value = look.sat;
    u.uContrast.value = look.contrast;
    u.uVignette.value = look.vignette;
    this.bloom.strength = look.bloom;
  }

  update(time: number, desat: number, hurt: number) {
    const u = this.grade.uniforms;
    u.uTime.value = time;
    u.uDesat.value = desat;
    u.uHurt.value = hurt;
  }

  // Finisher cinematic: white flash, chromatic spike, radial rush toward `focusUv`, and
  // depth of field around view distance `focusDist` (sharp within ~0.35 * range of it)
  setCinema(flash: number, spike: number, radial: number, focusUv: THREE.Vector2, dof: number, focusDist: number, focusRange: number) {
    const u = this.grade.uniforms;
    u.uFlash.value = flash;
    u.uSpike.value = spike;
    u.uRadial.value = radial;
    (u.uFocus.value as THREE.Vector2).copy(focusUv);
    u.uDof.value = dof;
    u.uFocusDist.value = focusDist;
    u.uFocusRange.value = focusRange;
  }

  // ink: outline strength (0 = off); rays: shaft strength with the sun's screen uv
  setStylize(ink: number, rays: number, sunUv: THREE.Vector2, rayColor: THREE.Color, near: number, far: number) {
    const u = this.grade.uniforms;
    u.uInk.value = ink;
    u.uRays.value = rays;
    (u.uSunUv.value as THREE.Vector2).copy(sunUv);
    (u.uRayColor.value as THREE.Color).copy(rayColor);
    u.uNear.value = near;
    u.uFar.value = far;
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uTexel.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
  }

  render() {
    // the scene is rendered into the read buffer; its depth feeds the outline and rays
    this.grade.uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
