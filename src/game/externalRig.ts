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
// means neither skeleton's local axis LAYOUT matters. What it doesn't sidestep is which
// local direction each bone calls "toward my child" - and that's a real, measured
// difference here, though not a uniform one: our own rig's LIMB bones (arm/forearm,
// thigh/shin) point their child down at local -Y (limbs hang in the rest pose), while its
// SPINE chain (hips/spine/chest/neck/head) points its child up at local +Y (the torso
// stands, it doesn't hang) - two different conventions in our OWN rig, confirmed by
// measuring both. This imported skeleton uses +Y for every one of those bones, limbs
// included. So it agrees with our spine chain already, but disagrees with our limbs -
// meaning the correction below applies ONLY to limb bones, never to the torso chain.
// (A single blanket 180 degree correction was tried first and broke the torso instead:
// applying it to the spine chain flips a relationship that was already correct.)
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

// Only these need the child-offset correction (see the big comment above) - the torso
// chain already agrees with the imported skeleton's own +Y convention. Legs and arms
// need DIFFERENT flip axes (confirmed empirically: an X-axis flip alone makes the leg
// chain correct but leaves the arm chain broken), because the correction axis is
// resolved in world space and a vertical bone (leg) and a diagonal one (arm, spread in
// this skeleton's A-pose bind) don't share one fixed axis that flips Y on both correctly.
const LEG_FLIP_JOINTS = new Set(['legL', 'shinL', 'footL', 'legR', 'shinR', 'footR']);
const ARM_FLIP_JOINTS = new Set(['armL', 'foreL', 'handBoneL', 'armR', 'foreR', 'handBoneR']);

const qWorld = new THREE.Quaternion();
const qParentWorld = new THREE.Quaternion();

// A limb bone's child sits at local +Y in this skeleton's bind pose, where our own
// rig's limb bones sit at local -Y (arms/legs hang in the rest pose). Left uncorrected,
// a copied world rotation swings the bone correctly for a "child at -Y" bone but the
// real child is at +Y, so the limb points the opposite physical way. The flip quaternions
// are the correction: post-multiplying one onto the copied world rotation before
// converting to local space re-aims local +Y where local -Y would otherwise have gone.
const LEG_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const ARM_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

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
  // Rotation: the hand bone's WORLD rotation is shadowWrist * ARM_FLIP (needed so the
  // mesh skins correctly - see the arm/leg flip note above), but a weapon here isn't
  // skinned, it's a rigid child: it needs the hand's true physical orientation,
  // shadowWrist alone. Giving the attach point ARM_FLIP as its own local rotation
  // cancels the parent's flip back out (ARM_FLIP is self-inverse, so flip*flip =
  // identity), restoring the same "+Z forward, arm hanging down" convention weapon
  // meshes are authored in.
  const realHandR = realBones.mixamorigLeftHand; // see the L/R note above
  const realHandL = realBones.mixamorigRightHand;
  const hand = new THREE.Group();
  hand.quaternion.copy(ARM_FLIP);
  hand.scale.setScalar(deltaScale);
  if (realHandR) realHandR.add(hand);
  const handL = new THREE.Group();
  handL.quaternion.copy(ARM_FLIP);
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
        const flip = LEG_FLIP_JOINTS.has(key) ? LEG_FLIP : ARM_FLIP_JOINTS.has(key) ? ARM_FLIP : null;
        if (src && dst) copyWorldRotation(src, dst, flip);
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
