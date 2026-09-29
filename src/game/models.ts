import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Imported 3D assets (public/models, built by scripts/convert_*.py + optimize_models.mjs).
// Everything is fetched once, up front, and cached for the page's lifetime: spawning an
// enemy or throwing a kunai happens mid-frame and has to be synchronous, so gameplay only
// ever clones what's already here - and falls back to the procedural models (rigs.ts) for
// anything that failed to load.

// Relative to the deploy's base path: '/' on Netlify, '/ninja/' on GitHub Pages
const M = `${import.meta.env.BASE_URL}models/`;

const CHARACTER_FILES = {
  ronin: `${M}ronin.glb`,
  archer: `${M}archer.glb`,
  samurai2: `${M}samurai2.glb`,
  giant: `${M}giant.glb`
};
export type CharacterModel = keyof typeof CHARACTER_FILES;

// Weapon id (as makeWeapon() knows them) -> file. Every file is pre-normalized to the
// same convention as the procedural weapons: blade along +Z, edge toward +Y, grip at the
// origin, sized in world units.
const WEAPON_FILES: Record<string, string> = {
  katana: `${M}weapons/katana.glb`,
  ekatana: `${M}weapons/ekatana.glb`,
  greatsword: `${M}weapons/greatsword.glb`,
  bo: `${M}weapons/bo.glb`,
  kama: `${M}weapons/kama.glb`,
  kunai: `${M}weapons/kunai.glb`,
  shuriken: `${M}weapons/shuriken.glb`,
  longbow: `${M}weapons/bow.glb`,
  arrow: `${M}weapons/arrow.glb`
};

/** A loaded mocap character: its skinned scene (cloned per instance) and clips by name. */
export interface CharacterTemplate {
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

const charPromise = new Map<CharacterModel, Promise<CharacterTemplate>>();
const charReady = new Map<CharacterModel, CharacterTemplate>();

export function loadCharacter(id: CharacterModel): Promise<CharacterTemplate> {
  let p = charPromise.get(id);
  if (!p) {
    p = gltfLoader()
      .loadAsync(CHARACTER_FILES[id])
      .then((gltf) => {
        const tpl = { scene: gltf.scene, clips: new Map(gltf.animations.map((c) => [c.name, c] as const)) };
        charReady.set(id, tpl);
        return tpl;
      });
    // a failed fetch shouldn't poison the cache forever - the next caller retries
    p.catch(() => charPromise.delete(id));
    charPromise.set(id, p);
  }
  return p;
}

/** The template if it has finished loading, else null (callers fall back). */
export function characterIfReady(id: CharacterModel): CharacterTemplate | null {
  return charReady.get(id) ?? null;
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
  return Promise.allSettled([...(Object.keys(CHARACTER_FILES) as CharacterModel[]).map(loadCharacter), loadWeapons()]);
}
