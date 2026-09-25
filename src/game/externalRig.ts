import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildCharacter, patchCharacter } from './characters';
import type { RigInstance } from './types';

// Loading a GLB means a network fetch + JSON/binary parse, unlike every other
// character in the game (built from procedural geometry, nothing to await). Selecting
// the same external character again later (e.g. leaving and reopening the character
// select screen) should not pay that cost twice, so the parsed template is cached per
// URL for the page's lifetime and cloned cheaply (SkeletonUtils.clone only duplicates
// the bone/mesh graph - geometry, materials and textures stay shared, so repeat
// clones cost no extra GPU memory).
const templateCache = new Map<string, Promise<THREE.Group>>();

function loadTemplate(url: string): Promise<THREE.Group> {
  let p = templateCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    templateCache.set(url, p);
  }
  return p;
}

// ===========================================================================
// Loads a rigged GLB (mixamorig-style skeleton, any bind/rest pose) and lets the SAME
// procedural animation code that drives our own hand-built rigs (animation.ts) drive
// it too, unchanged.
//
// animation.ts eases every joint toward an absolute target angle by writing
// bone.rotation.x/y/z directly - a convention that only reads right when the target
// bone's own local axes match our own rig's authoring convention. Copying a bone's WORLD
// rotation straight onto the corresponding imported bone (three.js's own
// SkeletonUtils.retarget() technique) sidesteps most of that: working in world space
// means neither skeleton's local axis LAYOUT matters. What it doesn't sidestep is each
// bone's own bind-pose difference from our rig's corresponding bone - and that's a real,
// per-bone difference here, not a uniform one (confirmed by measuring it - see
// buildRestFlips below), since this skeleton wasn't built for our rig.
// ===========================================================================

// mixamorig's Left/Right is the character's own anatomical side, which sits
// on the OPPOSITE side of our +X/-X convention (verified by inspecting bind
// pose world positions) - so the L/R suffixes below are intentionally swapped.
const BONE_MAP: Record<string, string> = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine2: 'chest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  mixamorigRightArm: 'armL',
  mixamorigLeftArm: 'armR',
  mixamorigRightForeArm: 'foreL',
  mixamorigLeftForeArm: 'foreR',
  mixamorigRightHand: 'handBoneL',
  mixamorigLeftHand: 'handBoneR',
  mixamorigRightUpLeg: 'legL',
  mixamorigLeftUpLeg: 'legR',
  mixamorigRightLeg: 'shinL',
  mixamorigLeftLeg: 'shinR',
  mixamorigRightFoot: 'footL',
  mixamorigLeftFoot: 'footR'
};

// Strict parent-before-child order: each bone's world matrix is rebuilt from its own
// freshly-set local rotation plus its parent's *already rebuilt* world matrix, so a
// child processed before its parent would read a stale parent transform. This skeleton
// has a couple of bones our own rig has no equivalent for - mixamorigSpine1 (between
// spine and chest) and the two shoulder/clavicle bones (between chest and each upper
// arm) - which just need their matrixWorld carried forward unchanged so their children
// read a correct, non-stale parent transform; PASSTHROUGH marks those spots.
const PASSTHROUGH = Symbol('passthrough');
const SYNC_ORDER = [
  'hips', 'spine', PASSTHROUGH, 'chest', 'neck', 'head',
  PASSTHROUGH, 'armL', 'foreL', 'handBoneL',
  PASSTHROUGH, 'armR', 'foreR', 'handBoneR',
  'legL', 'shinL', 'footL',
  'legR', 'shinR', 'footR'
] as const;
// mixamorig name for each PASSTHROUGH slot above, in the same order they appear.
const PASSTHROUGH_NAMES = ['mixamorigSpine1', 'mixamorigRightShoulder', 'mixamorigLeftShoulder'];

// The world-space flip above is only exact right at rest - it's an approximation that
// grows away from it (see the file header). For most bones that's fine (the pose never
// swings far, or the approximation error stays small), but the sword arm swings through
// very large angles (a run cycle's own arm swing stacked on a held two-handed grip, or a
// full attack) and visibly drifted - the hand ended up pinned near the body instead of
// reaching out. These three bones use LOCAL conjugation instead - exact at any rotation
// magnitude, provided the bone's own natural bind-pose rotation is small, which this
// import's right arm/forearm/hand happen to be (its LEFT forearm isn't, hence this isn't
// applied to every limb - see copyLocalRotation below for the actual math).
const LOCAL_JOINTS = new Set(['armR', 'foreR', 'handBoneR']);

const qWorld = new THREE.Quaternion();
const qParentWorld = new THREE.Quaternion();

// For each synced bone, measures the constant rotation `flip` such that
// `shadowRestWorld * flip == realRestWorld` - i.e. exactly what's needed so that
// retargeting AT REST reproduces the imported model's own natural bind pose, whatever
// that bone's authored local-axis convention happens to be. Composed with the shadow's
// WORLD rotation at any later pose (copyWorldRotation below), this reproduces the same
// physical limb direction using the real bone's own convention.
//
// (Measured PER BONE like this, rather than one hand-picked axis-angle constant shared
// by a whole limb: a single guessed constant looked plausible near rest, then visibly
// broke down for arms at the large joint angles a real guard stance or attack swing
// reaches - confirmed by comparing the sword hand's position relative to the hips
// against the same pose on the procedural ninja, and by real-gameplay screenshots
// showing the sword pinned near the spine instead of held out in front.)
function buildRestFlips(
  shadow: RigInstance,
  real: Partial<Record<string, THREE.Object3D>>
): Partial<Record<string, THREE.Quaternion>> {
  shadow.root.updateMatrixWorld(true);
  const flips: Partial<Record<string, THREE.Quaternion>> = {};
  const qs = new THREE.Quaternion();
  const qd = new THREE.Quaternion();
  for (const key of SYNC_ORDER) {
    if (key === PASSTHROUGH) continue;
    const src = (shadow as unknown as Record<string, THREE.Object3D | undefined>)[key];
    const dst = real[key];
    if (!src || !dst) continue;
    src.getWorldQuaternion(qs);
    dst.getWorldQuaternion(qd);
    flips[key] = qs.clone().invert().multiply(qd);
  }
  return flips;
}

// Copies `source`'s WORLD rotation onto `target`, re-expressed in target's own local
// (parent-relative) space, then rebuilds just target's own matrixWorld from that -
// cheap (no subtree traversal) and correct as long as target.parent's matrixWorld is
// already current, which SYNC_ORDER guarantees.
function copyWorldRotation(source: THREE.Object3D, target: THREE.Object3D, flip: THREE.Quaternion | null) {
  source.getWorldQuaternion(qWorld);
  if (flip) qWorld.multiply(flip);
  target.parent!.getWorldQuaternion(qParentWorld);
  target.quaternion.copy(qParentWorld.invert().multiply(qWorld));
  target.updateMatrix();
  target.matrixWorld.multiplyMatrices(target.parent!.matrixWorld, target.matrix);
}

// Converts the shadow bone's LOCAL rotation (its full delta from rest, since every
// shadow bone starts at identity) into the imported bone's own local convention by
// conjugating with that bone's own natural bind-pose local rotation `restLocal`
// (captured once, before this bone is ever touched) - standard retargeting math, exact
// for any rotation magnitude as long as restLocal itself is small (see LOCAL_JOINTS).
function copyLocalRotation(source: THREE.Object3D, target: THREE.Object3D, restLocal: THREE.Quaternion) {
  target.quaternion.copy(restLocal).invert().multiply(source.quaternion).multiply(restLocal);
}

// Refreshes a bone's matrixWorld from its own (unchanged) local matrix and its parent's
// freshly-updated one - for a bone we never retarget but whose children still need a
// current parent transform to read.
function refreshMatrixWorld(bone: THREE.Object3D) {
  if (!bone.parent) return;
  bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
}

export interface ExternalRigOptions {
  url: string;
  height?: number; // target standing height in our world's units (the procedural ninja rig measures 2.32 - it's deliberately stylized/elongated, not a realistic human height)
  kind?: RigInstance['kind'];
}

export async function loadExternalRig(opts: ExternalRigOptions): Promise<RigInstance> {
  const template = await loadTemplate(opts.url);
  const model = cloneSkeleton(template);

  const realBones: Record<string, THREE.Object3D> = {};
  let skinned: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) realBones[o.name] = o;
    if ((o as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) throw new Error('loadExternalRig: no skinned mesh in ' + opts.url);
  const mesh: THREE.SkinnedMesh = skinned;

  const box = new THREE.Box3().setFromObject(model);
  const importedHeight = Math.max(0.01, box.max.y - box.min.y);
  const targetHeight = opts.height ?? 2.32;
  const scale = targetHeight / importedHeight;
  const deltaScale = 1 / scale; // world-unit deltas -> the import's own (smaller) local units

  const root = new THREE.Group();
  const bodyNode = new THREE.Group();
  bodyNode.add(model);
  root.add(bodyNode);
  root.scale.setScalar(scale);

  // real bone lookup by OUR joint name (not the mixamorig name), via BONE_MAP
  const real: Partial<Record<string, THREE.Object3D>> = {};
  for (const [src, dst] of Object.entries(BONE_MAP)) {
    const bone = realBones[src];
    if (bone) real[dst] = bone;
  }

  // Shadow rig: an ordinary procedural ninja skeleton, driven by animateCharacter() the
  // same as any other character (its own bones, its own convention, nothing special).
  // Never added to a scene or rendered - only its bone transforms exist, purely as the
  // source skeleton for the per-frame world-space retarget below.
  const shadow = buildCharacter('ninja');

  // Measured before either skeleton has ever been animated, so both are still at their
  // own natural rest/bind pose - see buildRestFlips above for what this captures and why.
  root.updateMatrixWorld(true);
  const restFlips = buildRestFlips(shadow, real);
  const restLocal: Partial<Record<string, THREE.Quaternion>> = {};
  for (const key of LOCAL_JOINTS) {
    const dst = real[key];
    if (dst) restLocal[key] = dst.quaternion.clone();
  }

  const hipsBindY = real.hips?.position.y ?? 0;
  const shadowHipsRestY = shadow.hipsRestY ?? 0;

  const flash = { value: 0 };
  const rim = new THREE.Color(1.0, 0.5, 0.3).multiplyScalar(0.28);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const usedMats: THREE.Material[] = [];
  for (const m of materials) {
    if (m instanceof THREE.MeshStandardMaterial) {
      patchCharacter(m, flash, rim);
      usedMats.push(m);
    }
  }
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  // weapon attach points, parented to the real hand bones.
  //
  // Scale: makeWeapon() builds geometry directly in the game's own world units (a
  // katana sized to look right on our 2.32-unit-tall ninja). The hand bone lives inside
  // `root`, which carries `scale` to blow up the IMPORTED MESH's own (much smaller,
  // ~1-unit-tall) geometry up to that same 2.32 units - a correction the weapon never
  // needed, since it was never in the import's units to begin with. Left alone, the
  // weapon inherits that scale on top of its own already-correct size and renders
  // roughly `scale` times too big (confirmed: a katana several times the character's own
  // height). Countering it with 1/scale (deltaScale) here cancels that back out for
  // anything parented to these two groups, while the character mesh itself - skinned to
  // the imported skeleton, not a child of these groups - still gets the full scale it
  // needs.
  //
  // Rotation: the hand bone's WORLD rotation is shadowWrist * restFlips.handBoneX
  // (needed so the mesh skins correctly - see buildRestFlips above), but a weapon here
  // isn't skinned, it's a rigid child: it needs the hand's true physical orientation,
  // shadowWrist alone. Giving the attach point that flip's inverse as its own local
  // rotation cancels the parent's flip back out, restoring the same "+Z forward, arm
  // hanging down" convention weapon meshes are authored in.
  const realHandR = realBones.mixamorigLeftHand; // see the L/R note above
  const realHandL = realBones.mixamorigRightHand;
  const hand = new THREE.Group();
  if (restFlips.handBoneR) hand.quaternion.copy(restFlips.handBoneR).invert();
  hand.scale.setScalar(deltaScale);
  if (realHandR) realHandR.add(hand);
  const handL = new THREE.Group();
  if (restFlips.handBoneL) handL.quaternion.copy(restFlips.handBoneL).invert();
  handL.scale.setScalar(deltaScale);
  if (realHandL) realHandL.add(handL);

  const rig: RigInstance = {
    root,
    body: shadow.body,
    head: shadow.head,
    eye: shadow.head,
    legL: shadow.legL,
    legR: shadow.legR,
    legBaseY: shadow.legBaseY,
    armL: shadow.armL,
    armR: shadow.armR,
    hand,
    handL,
    scarf: new THREE.Group(),
    mats: usedMats,
    hips: shadow.hips,
    hipsRestY: shadow.hipsRestY,
    spine: shadow.spine,
    chest: shadow.chest,
    neck: shadow.neck,
    foreL: shadow.foreL,
    foreR: shadow.foreR,
    handBoneL: shadow.handBoneL,
    handBoneR: shadow.handBoneR,
    shinL: shadow.shinL,
    shinR: shadow.shinR,
    footL: shadow.footL,
    footR: shadow.footR,
    flash,
    kind: opts.kind ?? 'samurai',
    postAnimate: () => {
      shadow.root.updateMatrixWorld(true);
      let passIdx = 0;
      for (const key of SYNC_ORDER) {
        if (key === PASSTHROUGH) {
          const bone = realBones[PASSTHROUGH_NAMES[passIdx++]];
          if (bone) refreshMatrixWorld(bone);
          continue;
        }
        const dst = real[key];
        const src = (shadow as unknown as Record<string, THREE.Object3D | undefined>)[key];
        if (!src || !dst) continue;
        if (LOCAL_JOINTS.has(key)) {
          const rl = restLocal[key];
          if (rl) copyLocalRotation(src, dst, rl);
        } else {
          copyWorldRotation(src, dst, restFlips[key] ?? null);
        }
      }
      if (real.hips) {
        real.hips.position.y = hipsBindY + (shadow.hips!.position.y - shadowHipsRestY) * deltaScale;
        real.hips.updateMatrix();
        real.hips.matrixWorld.multiplyMatrices(real.hips.parent!.matrixWorld, real.hips.matrix);
      }
      // bodyNode wraps the whole imported model and, like shadow.body, has no imported-
      // skeleton axis quirk to correct for (both are plain, identity-bind nodes this
      // module/characters.ts controls) - its rotation carries over directly.
      bodyNode.quaternion.copy(shadow.body.quaternion);
      root.updateMatrixWorld(true);
    },
    dispose: () => {
      shadow.dispose?.();
      // Geometry, materials and textures come from the cached template (shared with
      // every other clone made from it) and must outlive this one instance - nothing
      // to dispose for the imported mesh itself beyond dropping this clone's own
      // bone/mesh objects, which happens once `root` is removed from the scene and GC'd.
    }
  };
  return rig;
}
