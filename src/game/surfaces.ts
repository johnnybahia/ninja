import * as THREE from 'three';
import LUM from './texture-manifest.json';

// ===========================================================================
// Surface materials: baked albedo + normal maps (scripts/bake_textures.py) applied
// to existing MeshStandardMaterials. Most world geometry is merged into big
// batches without meaningful UVs, so the maps are projected in world space
// (triplanar, whiteout-blended normals). Roofs keep their own UVs, flat ground
// uses a single top-down projection. Albedo acts as a luminance-normalised detail
// multiplier, so the material colour still sets the tone of each atmosphere.
// ===========================================================================

export type SurfaceName = keyof typeof LUM;
export type SurfaceMode = 'tri' | 'top' | 'uv';

export interface SurfaceOpts {
  mode: SurfaceMode;
  scale: number | [number, number]; // repeats per metre (tri/top) or per uv unit
  normal?: number; // normal map strength
  albedo?: number; // 0 = colour only, 1 = full texture detail
  breakup?: boolean; // hide tiling on large areas with a second, rotated sample
}

interface Surface {
  alb: THREE.IUniform<THREE.Texture>;
  nrm: THREE.IUniform<THREE.Texture>;
  gain: number;
}

const surfaces = new Map<string, Surface>();
let hiRes = true;
let aniso = 4;

export function initSurfaces(renderer: THREE.WebGLRenderer, highRes: boolean) {
  hiRes = highRes;
  aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function solidTexture(r: number, g: number, b: number, srgb: boolean) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const loader = new THREE.TextureLoader();

function loadInto(u: THREE.IUniform<THREE.Texture>, url: string, srgb: boolean) {
  loader.load(url, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    const old = u.value;
    u.value = t;
    old.dispose();
  });
}

function surface(name: SurfaceName): Surface {
  let s = surfaces.get(name);
  if (s) return s;
  const lum = LUM[name];
  // until the image arrives: flat normal and a grey whose normalised value is 1
  const g = (new THREE.Color().setScalar(lum).getHex() >> 16) & 255;
  s = { alb: { value: solidTexture(g, g, g, true) }, nrm: { value: solidTexture(128, 128, 255, false) }, gain: 1 / lum };
  const base = `${import.meta.env.BASE_URL}tex/${name}`;
  const suf = hiRes ? '' : '_s';
  loadInto(s.alb, `${base}_a${suf}.webp`, true);
  loadInto(s.nrm, `${base}_n${suf}.webp`, false);
  surfaces.set(name, s);
  return s;
}

// Desaturate a colour toward grey of the same luminance: the texture now carries the
// hue, the material keeps the brightness that each atmosphere was tuned with.
export function neutralize(c: THREE.Color, k: number) {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return c.lerp(new THREE.Color(l, l, l), k);
}

export function applySurface(mat: THREE.MeshStandardMaterial, name: SurfaceName, o: SurfaceOpts) {
  const s = surface(name);
  const scale = typeof o.scale === 'number' ? new THREE.Vector2(o.scale, o.scale) : new THREE.Vector2(...o.scale);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.tSurfA = s.alb;
    shader.uniforms.tSurfN = s.nrm;
    shader.uniforms.uSurfScale = { value: scale };
    shader.uniforms.uSurfGain = { value: s.gain };
    shader.uniforms.uSurfAlb = { value: o.albedo ?? 1 };
    shader.uniforms.uSurfNrm = { value: o.normal ?? 1 };
    const defs =
      (o.mode === 'uv' ? '#define SURF_UV\n' : o.mode === 'top' ? '#define SURF_TOP\n' : '') + (o.breakup ? '#define SURF_BREAKUP\n' : '');
    shader.vertexShader =
      defs +
      'varying vec3 vSurfPos;\nvarying vec3 vSurfNrm;\nvarying vec2 vSurfUv;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `{
          vec4 sp = vec4(transformed, 1.0);
          vec3 sn = objectNormal;
          #ifdef USE_INSTANCING
            sp = instanceMatrix * sp;
            sn = mat3(instanceMatrix) * sn;
          #endif
          vSurfPos = (modelMatrix * sp).xyz;
          vSurfNrm = normalize(mat3(modelMatrix) * sn);
          vSurfUv = uv;
        }
        #include <project_vertex>`
      );
    shader.fragmentShader =
      defs +
      `varying vec3 vSurfPos;
      varying vec3 vSurfNrm;
      varying vec2 vSurfUv;
      uniform sampler2D tSurfA;
      uniform sampler2D tSurfN;
      uniform vec2 uSurfScale;
      uniform float uSurfGain;
      uniform float uSurfAlb;
      uniform float uSurfNrm;
      vec3 surfTN(vec2 uv) {
        vec3 t = texture2D(tSurfN, uv).xyz * 2.0 - 1.0;
        t.xy *= uSurfNrm;
        return t;
      }
      ` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 sN = normalize(vSurfNrm);
          vec3 sW = pow(abs(sN), vec3(4.0));
          sW /= dot(sW, vec3(1.0));
          #if defined(SURF_UV)
            vec2 sUv = vSurfUv * uSurfScale;
            vec3 sAlb = texture2D(tSurfA, sUv).rgb;
          #elif defined(SURF_TOP)
            vec2 sUv = vSurfPos.xz * uSurfScale;
            vec3 sAlb = texture2D(tSurfA, sUv).rgb;
          #else
            vec3 sP = vSurfPos * uSurfScale.x;
            vec3 sAlb = texture2D(tSurfA, sP.zy).rgb * sW.x + texture2D(tSurfA, sP.xz).rgb * sW.y + texture2D(tSurfA, sP.xy).rgb * sW.z;
          #endif
          #ifdef SURF_BREAKUP
            // large, lazy blend toward a rotated, rescaled copy hides the repetition
            float sMac = sin(dot(vSurfPos.xz, vec2(0.071, 0.053))) * sin(dot(vSurfPos.xz, vec2(-0.043, 0.089)) + 1.7);
            vec2 sUv2 = mat2(0.8, -0.6, 0.6, 0.8) * sUv * 0.61 + 0.37;
            sAlb = mix(sAlb, texture2D(tSurfA, sUv2).rgb, smoothstep(-0.25, 0.25, sMac));
          #endif
          diffuseColor.rgb *= mix(vec3(1.0), sAlb * uSurfGain, uSurfAlb);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec3 nW;
            #if defined(SURF_UV)
              // cotangent frame from screen derivatives (roof tiles follow their own uvs)
              vec3 dp1 = dFdx(vSurfPos);
              vec3 dp2 = dFdy(vSurfPos);
              vec2 du1 = dFdx(sUv);
              vec2 du2 = dFdy(sUv);
              vec3 dp2p = cross(dp2, sN);
              vec3 dp1p = cross(sN, dp1);
              vec3 T = dp2p * du1.x + dp1p * du2.x;
              vec3 B = dp2p * du1.y + dp1p * du2.y;
              float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
              nW = normalize(mat3(T * im, B * im, sN) * surfTN(sUv));
            #elif defined(SURF_TOP)
              vec3 tY = surfTN(sUv);
              nW = normalize(vec3(tY.x, tY.z * sN.y, tY.y) + vec3(sN.x, 0.0, sN.z));
            #else
              // whiteout blend of three tangent-space samples
              vec3 tX = surfTN(sP.zy);
              vec3 tY = surfTN(sP.xz);
              vec3 tZ = surfTN(sP.xy);
              tX = vec3(tX.xy + sN.zy, abs(tX.z) * sN.x);
              tY = vec3(tY.xy + sN.xz, abs(tY.z) * sN.y);
              tZ = vec3(tZ.xy + sN.xy, abs(tZ.z) * sN.z);
              nW = normalize(tX.zyx * sW.x + tY.xzy * sW.y + tZ.xyz * sW.z);
            #endif
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`
        );
  };
  mat.customProgramCacheKey = () => `${prevKey}|surf-${name}-${o.mode}${o.breakup ? '-b' : ''}`;
  mat.needsUpdate = true;
  return mat;
}
