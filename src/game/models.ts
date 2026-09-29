import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Imported 3D assets (public/models, built by scripts/convert_*.py + optimize_models.mjs).
// Everything is fetched once, up front, and cached for the page's lifetime: spawning an
// enemy or throwing a kunai happens mid-frame and has to be synchronous, so gameplay only
// ever clones what's already here - and falls back to the procedural models (rigs.ts) for
// anything that failed to load.

export const RONIN_URL = '/models/ronin.glb';

// Weapon id (as makeWeapon() knows them) -> file. Every file is pre-normalized to the
// same convention as the procedural weapons: blade along +Z, edge toward +Y, grip at the
// origin, sized in world units.
const WEAPON_FILES: Record<string, string> = {
  katana: '/models/weapons/katana.glb',
  ekatana: '/models/weapons/ekatana.glb',
  greatsword: '/models/weapons/greatsword.glb',
  bo: '/models/weapons/bo.glb',
  kama: '/models/weapons/kama.glb',
  kunai: '/models/weapons/kunai.glb',
  shuriken: '/models/weapons/shuriken.glb'
};

export interface RoninTemplate {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

let loader: GLTFLoader | null = null;
function gltfLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

let roninPromise: Promise<RoninTemplate> | null = null;
let roninReady: RoninTemplate | null = null;

export function loadRonin(): Promise<RoninTemplate> {
  if (!roninPromise) {
    roninPromise = gltfLoader()
      .loadAsync(RONIN_URL)
      .then((gltf) => {
        const clips = new Map(gltf.animations.map((c) => [c.name, c] as const));
        roninReady = { scene: gltf.scene, clips };
        return roninReady;
      });
    // a failed fetch shouldn't poison the cache forever - the next caller retries
    roninPromise.catch(() => {
      roninPromise = null;
    });
  }
  return roninPromise;
}

/** The Rōnin template if it has finished loading, else null (callers fall back). */
export function roninIfReady(): RoninTemplate | null {
  return roninReady;
}

const weaponReady = new Map<string, THREE.Object3D>();
let weaponsPromise: Promise<void> | null = null;

export function loadWeapons(): Promise<void> {
  if (!weaponsPromise) {
    weaponsPromise = Promise.all(
      Object.entries(WEAPON_FILES).map(([id, url]) =>
        gltfLoader()
          .loadAsync(url)
          .then((gltf) => {
            gltf.scene.traverse((o) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              m.castShadow = true;
              m.receiveShadow = false;
            });
            weaponReady.set(id, gltf.scene);
          })
          .catch((e) => console.warn('weapon model failed, using procedural', id, e))
      )
    ).then(() => undefined);
  }
  return weaponsPromise;
}

/** A fresh instance of an imported weapon (geometry/materials shared), or null if it
 *  isn't loaded (yet, or at all). */
export function cloneWeaponModel(id: string): THREE.Group | null {
  const src = weaponReady.get(id);
  if (!src) return null;
  const g = new THREE.Group();
  g.add(src.clone(true));
  return g;
}

export function preloadModels(): Promise<unknown> {
  return Promise.allSettled([loadRonin(), loadWeapons()]);
}
