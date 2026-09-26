import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
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
// Idle/walk/run for this rig, played directly as mocap on its own real skeleton via
// THREE.AnimationMixer - no retargeting math needed, since the source clips (Mixamo,
// "mixamorig"-prefixed bone names) match this skeleton's own bone names exactly. Used
// only while nothing else is happening (see combatWeight in postAnimate below); guard,
// attack, hit, dash and death keep using the shadow-rig procedural system above, since
// these locomotion clips have no data for any of that.
// ===========================================================================

export interface LocomotionClipUrls {
  idle: string;
  walk: string;
  run: string;
}

interface LocomotionClips {
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  run: THREE.AnimationClip;
}

const locomotionClipCache = new Map<string, Promise<LocomotionClips>>();

// Mixamo FBX exports can carry more than one clip (an empty reference pose alongside the
// real one, or the real data at a different index than expected - confirmed happening for
// at least one of these clips) - the actual animated one is whichever has tracks.
function findAnimatedClip(clips: THREE.AnimationClip[], url: string): THREE.AnimationClip {
  const clip = clips.find((c) => c.tracks.length > 0);
  if (!clip) throw new Error('loadExternalRig: no animated clip in ' + url);
  return clip;
}

// Mixamo authors position tracks in centimeters at real-human scale; this rig uses its
// own, much smaller native scale - quaternion tracks are unit-agnostic and need no
// correction, but position tracks (in practice just the hips) do, by posScale (measured
// against this rig's own bind-pose hips height, so it lines up with the same "feet on the
// ground" reference the procedural system's own hipsBindY already uses). Clips also bake
// in the character physically walking/running across Mixamo's own virtual floor - since
// the game's own physics already drives world position, that horizontal (X/Z) travel is
// stripped relative to frame 0, keeping only the vertical bob (Y) that reads as the
// stride's own up-down motion.
function rescaleAndStripRootMotion(clip: THREE.AnimationClip, posScale: number) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const values = (track as THREE.VectorKeyframeTrack).values;
    for (let i = 0; i < values.length; i++) values[i] *= posScale;
    const x0 = values[0];
    const z0 = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] -= x0;
      values[i + 2] -= z0;
    }
  }
}

function loadLocomotionClips(urls: LocomotionClipUrls, hipsBindY: number): Promise<LocomotionClips> {
  const key = `${urls.idle}|${urls.walk}|${urls.run}`;
  let p = locomotionClipCache.get(key);
  if (!p) {
    p = (async () => {
      const loader = new FBXLoader();
      const [idleFbx, walkFbx, runFbx] = await Promise.all([
        loader.loadAsync(urls.idle),
        loader.loadAsync(urls.walk),
        loader.loadAsync(urls.run)
      ]);
      const idle = findAnimatedClip(idleFbx.animations, urls.idle);
      const walk = findAnimatedClip(walkFbx.animations, urls.walk);
      const run = findAnimatedClip(runFbx.animations, urls.run);
      const hipsTrack = walk.tracks.find((t) => t.name === 'mixamorigHips.position') as
        | THREE.VectorKeyframeTrack
        | undefined;
      const posScale = hipsTrack ? hipsBindY / hipsTrack.values[1] : 1;
      for (const clip of [idle, walk, run]) rescaleAndStripRootMotion(clip, posScale);
      return { idle, walk, run };
    })();
    locomotionClipCache.set(key, p);
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

// Always driven procedurally, never by this rig's own locomotion clip, regardless of
// combatWeight - the Great Sword idle's own head/neck movement (a big alert look-around
// turn) exposed a skin-weight seam at the neck that reads as a grotesquely stretched
// throat at that rotation (confirmed: this pack's idle only, not the procedural system's
// own much smaller head sway, which never bends the neck that far). Simplest fix is to
// just never hand this pack's neck/head rotation to the mesh at all.
const ALWAYS_PROCEDURAL = new Set(['neck', 'head']);

// The katana attach point's own local rotation while this hand is driven by the
// locomotion mixer instead of the shadow rig - restFlips.handBoneR (see below) only
// cancels out the flip that formula applies, so it's meaningless once the mixer's own
// clip data is driving the hand bone directly instead. Measured empirically in-game
// (screenshot comparison against several candidate rotations) against this rig's actual
// Great Sword idle/walk clips, since there's no formula to derive it from - a fixed
// local offset from the hand bone that happens to hold the blade in a natural
// forward/up two-handed grip for this specific mocap pack's own hand convention.
const MIXAMO_GRIP_FLIP = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, -Math.PI / 12, 0));

const qWorld = new THREE.Quaternion();
const qParentWorld = new THREE.Quaternion();
const qLocalTmp = new THREE.Quaternion();

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
//
// blend (0-1): how much of this procedural rotation to apply, the rest being whatever
// target.quaternion already holds (a rig's own locomotion mixer, when blend < 1 - see
// postAnimate). 0 skips the computation entirely, both as a small perf win during plain
// locomotion and because there's nothing to blend toward yet on the very first frame
// (target's rest pose is a fine stand-in for "untouched"). The matrixWorld refresh still
// always runs, since target's local rotation may have just changed via the mixer instead.
function copyWorldRotation(source: THREE.Object3D, target: THREE.Object3D, flip: THREE.Quaternion | null, blend = 1) {
  if (blend > 0) {
    source.getWorldQuaternion(qWorld);
    if (flip) qWorld.multiply(flip);
    target.parent!.getWorldQuaternion(qParentWorld);
    qParentWorld.invert().multiply(qWorld);
    if (blend >= 1) target.quaternion.copy(qParentWorld);
    else target.quaternion.slerp(qParentWorld, blend);
  }
  target.updateMatrix();
  target.matrixWorld.multiplyMatrices(target.parent!.matrixWorld, target.matrix);
}

// Converts the shadow bone's LOCAL rotation (its full delta from rest, since every
// shadow bone starts at identity) into the imported bone's own local convention by
// conjugating with that bone's own natural bind-pose local rotation `restLocal`
// (captured once, before this bone is ever touched) - standard retargeting math, exact
// for any rotation magnitude as long as restLocal itself is small (see LOCAL_JOINTS).
// blend: see copyWorldRotation above.
function copyLocalRotation(source: THREE.Object3D, target: THREE.Object3D, restLocal: THREE.Quaternion, blend = 1) {
  if (blend <= 0) return;
  qLocalTmp.copy(restLocal).invert().multiply(source.quaternion).multiply(restLocal);
  if (blend >= 1) target.quaternion.copy(qLocalTmp);
  else target.quaternion.slerp(qLocalTmp, blend);
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
  locomotionClips?: LocomotionClipUrls;
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

  let locomotion: {
    mixer: THREE.AnimationMixer;
    idleAction: THREE.AnimationAction;
    walkAction: THREE.AnimationAction;
    runAction: THREE.AnimationAction;
  } | null = null;
  if (opts.locomotionClips) {
    const clips = await loadLocomotionClips(opts.locomotionClips, hipsBindY);
    const mixer = new THREE.AnimationMixer(model);
    const idleAction = mixer.clipAction(clips.idle);
    const walkAction = mixer.clipAction(clips.walk);
    const runAction = mixer.clipAction(clips.run);
    idleAction.play();
    walkAction.play();
    runAction.play();
    locomotion = { mixer, idleAction, walkAction, runAction };
  }
  // Eased toward postAnimate's combatWeight rather than snapping straight to it, so
  // entering/leaving a combat state doesn't visibly pop between this rig's own
  // locomotion clip and the procedural pose - see postAnimate below.
  let combatWeightSmoothed = 0;

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
  // hanging down" convention weapon meshes are authored in. Only valid while this hand is
  // procedurally driven, though - see MIXAMO_GRIP_FLIP below for the locomotion case.
  const realHandR = realBones.mixamorigLeftHand; // see the L/R note above
  const realHandL = realBones.mixamorigRightHand;
  const proceduralGripFlip = restFlips.handBoneR ? restFlips.handBoneR.clone().invert() : new THREE.Quaternion();
  const hand = new THREE.Group();
  hand.quaternion.copy(proceduralGripFlip);
  hand.scale.setScalar(deltaScale);
  if (realHandR) realHandR.add(hand);
  const handL = new THREE.Group();
  // handL only ever holds the healing gourd (see attachGourd() in engine.ts), which is
  // only visible during the drink animation - always a combatWeight=1 (fully procedural)
  // state - so unlike `hand` above, this one never needs a locomotion-mode counterpart.
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
    postAnimate: (combatWeight, moveAmt, dt) => {
      if (locomotion) {
        const m = Math.max(0, Math.min(1, moveAmt));
        // triangular cross-fade: idle at 0, full walk at 0.5, full run at 1
        if (m <= 0.5) {
          locomotion.idleAction.weight = 1 - m / 0.5;
          locomotion.walkAction.weight = m / 0.5;
          locomotion.runAction.weight = 0;
        } else {
          locomotion.idleAction.weight = 0;
          locomotion.walkAction.weight = 1 - (m - 0.5) / 0.5;
          locomotion.runAction.weight = (m - 0.5) / 0.5;
        }
        locomotion.mixer.update(dt);
        combatWeightSmoothed += (combatWeight - combatWeightSmoothed) * (1 - Math.exp(-16 * Math.max(0, dt)));
      }
      // Without a locomotion clip there's nothing to blend against - stay fully
      // procedural, exactly like before this rig ever had one.
      const blend = locomotion ? combatWeightSmoothed : 1;
      if (locomotion) hand.quaternion.copy(MIXAMO_GRIP_FLIP).slerp(proceduralGripFlip, blend);

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
        const boneBlend = ALWAYS_PROCEDURAL.has(key) ? 1 : blend;
        if (LOCAL_JOINTS.has(key)) {
          const rl = restLocal[key];
          if (rl) copyLocalRotation(src, dst, rl, boneBlend);
        } else {
          copyWorldRotation(src, dst, restFlips[key] ?? null, boneBlend);
        }
      }
      if (real.hips) {
        const proceduralY = hipsBindY + (shadow.hips!.position.y - shadowHipsRestY) * deltaScale;
        if (locomotion) {
          // Y: blend toward the procedural height instead of snapping (the mixer already
          // wrote its own vertical bob this frame). X/Z: the procedural system never
          // moves the hips horizontally (world movement comes from `root`, not this bone)
          // but the mixer does (small weight-shift sway, left in on purpose) - fade that
          // back out as combat takes over so it doesn't linger into a static combat pose.
          real.hips.position.y += (proceduralY - real.hips.position.y) * blend;
          real.hips.position.x *= 1 - blend;
          real.hips.position.z *= 1 - blend;
        } else {
          real.hips.position.y = proceduralY;
        }
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
      locomotion?.mixer.stopAllAction();
      // Geometry, materials and textures come from the cached template (shared with
      // every other clone made from it) and must outlive this one instance - nothing
      // to dispose for the imported mesh itself beyond dropping this clone's own
      // bone/mesh objects, which happens once `root` is removed from the scene and GC'd.
    }
  };
  return rig;
}
