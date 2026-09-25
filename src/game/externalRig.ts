import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchCharacter } from './characters';
import type { RigInstance } from './types';

// ===========================================================================
// Loads a rigged GLB (mixamorig-style skeleton, any bind/rest pose) and wraps
// its bones so the SAME procedural animation code that drives our own
// hand-built rigs (animation.ts) can drive it too, unchanged.
//
// animation.ts eases every joint toward an absolute target angle each frame by
// writing bone.rotation.x/y/z directly - a convention that only reads right
// because our own bones start at identity rotation (arms hanging straight
// down = zero). An imported rig's bind pose is whatever pose it was scanned
// in (here, arms spread ~45 degrees), so writing the same absolute numbers
// would send the limbs to the wrong place entirely.
//
// The fix: each joint is a proxy object whose `.rotation` is a real
// THREE.Euler wired (via the same _onChange hook Object3D itself uses to
// keep .quaternion in sync) to compute `real.quaternion = bind * delta`
// instead of `real.quaternion = delta`. animation.ts's read/write pattern on
// `.rotation.x/y/z` needs no changes at all - it is simply now writing into
// "this bone's own rest pose" space instead of "hanging straight down" space,
// which is exactly what retargeting onto a different bind pose requires.
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

const qTmp = new THREE.Quaternion();

// A joint proxy: writes to `.rotation.x/y/z` (exactly how animation.ts eases
// every joint) apply as a delta ON TOP of the real bone's own bind pose.
function retargetedBone(real: THREE.Object3D) {
  const bind = real.quaternion.clone();
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  euler._onChange(() => {
    real.quaternion.copy(bind).multiply(qTmp.setFromEuler(euler));
  });
  return { rotation: euler } as unknown as THREE.Object3D;
}

// The one position channel animation.ts touches (hips bob): virtual rest is 0,
// and the delta is re-scaled from our world-ish units into the import's own
// (smaller) local-space units before landing on the real bone.
function retargetedHipsPosition(real: THREE.Object3D, deltaScale: number) {
  const bindY = real.position.y;
  let virtualY = 0;
  return {
    x: 0,
    z: 0,
    get y() {
      return virtualY;
    },
    set y(v: number) {
      virtualY = v;
      real.position.y = bindY + v * deltaScale;
    }
  };
}

export interface ExternalRigOptions {
  url: string;
  height?: number; // target standing height in our world's units (our own rigs are ~1.72)
  kind?: RigInstance['kind'];
}

export async function loadExternalRig(opts: ExternalRigOptions): Promise<RigInstance> {
  const gltf = await new GLTFLoader().loadAsync(opts.url);
  const model = gltf.scene;

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
  const targetHeight = opts.height ?? 1.72;
  const scale = targetHeight / importedHeight;
  const deltaScale = 1 / scale; // world-unit deltas -> the import's own (smaller) local units

  const root = new THREE.Group();
  const bodyNode = new THREE.Group();
  bodyNode.add(model);
  root.add(bodyNode);
  root.scale.setScalar(scale);

  const proxies: Record<string, THREE.Object3D> = { body: retargetedBone(bodyNode) };
  for (const [src, dst] of Object.entries(BONE_MAP)) {
    const real = realBones[src];
    if (!real) continue;
    proxies[dst] = retargetedBone(real);
  }

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

  // weapon attach points, parented to the real hand bones (not the retargeted proxy -
  // a child of a bone follows its animated world transform either way, and this keeps
  // the attachment math simple: local offset from the hand, nothing else)
  const realHandR = realBones.mixamorigLeftHand; // see the L/R note above
  const realHandL = realBones.mixamorigRightHand;
  const hand = new THREE.Group();
  if (realHandR) realHandR.add(hand);
  const handL = new THREE.Group();
  if (realHandL) realHandL.add(handL);

  const hipsReal = realBones.mixamorigHips;
  const hipsProxy = proxies.hips as unknown as { position: { x: number; y: number; z: number } };
  if (hipsReal) hipsProxy.position = retargetedHipsPosition(hipsReal, deltaScale);

  const rig: RigInstance = {
    root,
    body: proxies.body,
    head: proxies.head,
    eye: proxies.head,
    legL: proxies.legL,
    legR: proxies.legR,
    legBaseY: 0,
    armL: proxies.armL,
    armR: proxies.armR,
    hand,
    handL,
    scarf: new THREE.Group(),
    mats: usedMats,
    hips: proxies.hips,
    hipsRestY: 0,
    spine: proxies.spine,
    chest: proxies.chest,
    neck: proxies.neck,
    foreL: proxies.foreL,
    foreR: proxies.foreR,
    handBoneL: proxies.handBoneL,
    handBoneR: proxies.handBoneR,
    shinL: proxies.shinL,
    shinR: proxies.shinR,
    footL: proxies.footL,
    footR: proxies.footR,
    flash,
    kind: opts.kind ?? 'samurai',
    dispose: () => {
      usedMats.forEach((m) => m.dispose());
      mesh.geometry.dispose();
      const anyMat = mesh.material;
      const mats = Array.isArray(anyMat) ? anyMat : anyMat ? [anyMat] : [];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        std.roughnessMap?.dispose();
        std.metalnessMap?.dispose();
      }
    }
  };
  return rig;
}
