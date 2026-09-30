import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchCharacter } from './characters';
import type { CharacterTemplate } from './models';
import type { RigInstance } from './types';

// ===========================================================================
// Mocap-driven characters: a GLB (Mixamo skeleton + clips, see
// scripts/convert_characters.py) played straight through THREE.AnimationMixer - no
// retargeting at runtime, every clip was authored (or retargeted offline) for that exact
// skeleton. The Rōnin drives the player and, recoloured on its decimated LOD mesh, the
// enemy samurai; the archer has a model of its own.
//
// The mixer itself only blends. ClipController owns all timing: each frame it sets every
// action's time and weight explicitly and then evaluates the mixer once, so a one-shot's
// exact clip time is always known to gameplay (hit frames, cancel windows) and walk/run
// stay phase-locked while their speeds change.
// ===========================================================================

const LOCO = ['idle', 'walk', 'run', 'walkBack', 'strafeL', 'strafeR', 'fightIdle'] as const;
const LOOPS = new Set<string>([...LOCO, 'guard']);
// clips whose root travel belongs to the clip (the body falls/slides away) - everything
// else not looping has its horizontal travel pulled out into a curve the game applies
// to the character's actual position instead (see rootMotion)
const KEEP_ROOT = new Set(['death', 'death2']);

// Sword grip, in the right hand bone's own local frame, measured from the Great Sword
// clips themselves (scripts: average over idle/locomotion/attack frames of the line
// from the left palm to the right palm = the hilt, and of the tip's swing direction =
// where the edge leads). Every weapon file shares one convention (blade +Z, edge +Y,
// grip at origin), so this one frame fits them all.
export interface Grip {
  axis: THREE.Vector3; // hand-local direction weapon +Z (blade / arrow flight) points
  edge: THREE.Vector3; // hand-local hint for weapon +Y (cutting edge / bow limbs)
}
const SWORD_GRIP: Grip = { axis: new THREE.Vector3(0.7, -0.2, -0.68).normalize(), edge: new THREE.Vector3(-0.884, 0.141, -0.445) };
// Off hand (throwables, the healing gourd): pointing along the fingers.
const OFF_GRIP: Grip = { axis: new THREE.Vector3(0, 1, 0), edge: new THREE.Vector3(0, 0, 1) };

function gripQuat(axis: THREE.Vector3, edgeHint: THREE.Vector3) {
  const z = axis.clone().normalize();
  const y = edgeHint.clone().addScaledVector(z, -edgeHint.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

interface RootCurve {
  times: Float32Array;
  x: Float32Array; // model-space travel since the clip's first frame (character faces +Z)
  z: Float32Array;
}

interface Prepared {
  clips: Map<string, THREE.AnimationClip>;
  root: Map<string, RootCurve>;
  phase: Map<string, number>; // loop clips: normalized time where the left foot leads
  speed: Map<string, number>; // loop clips: natural ground speed, model units/s
  height: number; // bind-pose standing height, model units
}

const prepared = new WeakMap<CharacterTemplate, Prepared>();

function sampleVec(track: THREE.KeyframeTrack, t: number, out: THREE.Vector3) {
  const times = track.times;
  const v = track.values;
  if (t <= times[0]) return out.fromArray(v, 0);
  const n = times.length;
  if (t >= times[n - 1]) return out.fromArray(v, (n - 1) * 3);
  let i = 1;
  while (times[i] < t) i++;
  const k = (t - times[i - 1]) / (times[i] - times[i - 1]);
  out.fromArray(v, (i - 1) * 3);
  return out.lerp(new THREE.Vector3().fromArray(v, i * 3), k);
}

// Root motion clean-up, once per template: hips position keys live in the armature
// node's space (Blender export: rotated, 1/100 scale), so each key goes to model space,
// gets fixed there, and comes back.
function prepare(tpl: CharacterTemplate): Prepared {
  const cached = prepared.get(tpl);
  if (cached) return cached;
  const scene = tpl.scene;
  scene.updateMatrixWorld(true);
  const hips = scene.getObjectByName('mixamorigHips')!;
  const toModel = hips.parent!.matrixWorld.clone();
  const toLocal = toModel.clone().invert();
  const head = scene.getObjectByName('mixamorigHeadTop_End')!;
  const height = head.getWorldPosition(new THREE.Vector3()).y;
  // where the hips sit over the character's origin at rest: a clip's own stance offset
  // (a boxer's stance leans back ~20cm) must not carry into the game, where the origin
  // is the body's centre and everything - reach, hit spans, body collision - is
  // measured from it
  const bindHips = hips.position.clone().applyMatrix4(toModel);

  const root = new Map<string, RootCurve>();
  const speed = new Map<string, number>();
  const p = new THREE.Vector3();
  for (const [name, clip] of tpl.clips) {
    const track = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
    if (!track) continue;
    const v = track.values;
    const n = track.times.length;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(p.fromArray(v, i * 3).applyMatrix4(toModel).clone());
    const p0 = pts[0].clone();
    if (LOOPS.has(name)) {
      // one cycle travels one stride - remove that straight-line drift so the loop
      // neither slides forward nor snaps back at its seam (the sway stays)
      const last = pts[n - 1];
      const dx = last.x - p0.x;
      const dz = last.z - p0.z;
      const dur = track.times[n - 1] - track.times[0] || 1;
      speed.set(name, Math.hypot(dx, dz) / dur);
      for (let i = 0; i < n; i++) {
        const f = n > 1 ? i / (n - 1) : 0;
        pts[i].x -= dx * f;
        pts[i].z -= dz * f;
      }
    } else if (!KEEP_ROOT.has(name)) {
      const curve: RootCurve = { times: new Float32Array(track.times), x: new Float32Array(n), z: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        curve.x[i] = pts[i].x - p0.x;
        curve.z[i] = pts[i].z - p0.z;
        pts[i].x = bindHips.x;
        pts[i].z = bindHips.z;
        // the jump clip leaves the ground on its own - the game's physics already
        // lifts the whole character, so keep only its crouch/tuck, never its rise
        if (name === 'jump') pts[i].y = Math.min(pts[i].y, p0.y);
      }
      root.set(name, curve);
    }
    for (let i = 0; i < n; i++) pts[i].applyMatrix4(toLocal).toArray(v, i * 3);
  }

  // Loop phase alignment: walk and run blend into each other, and only look right if
  // both have the same foot forward at the same moment - find where each one's left
  // foot leads, so ClipController can offset them onto one shared gait phase.
  const phase = new Map<string, number>();
  const probe = cloneSkeleton(scene);
  const mixer = new THREE.AnimationMixer(probe);
  const lf = probe.getObjectByName('mixamorigLeftFoot')!;
  const rf = probe.getObjectByName('mixamorigRightFoot')!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const name of ['walk', 'run', 'walkBack', 'strafeL', 'strafeR']) {
    const clip = tpl.clips.get(name);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.play();
    let best = -Infinity;
    let bestT = 0;
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * clip.duration;
      act.time = t;
      mixer.update(0);
      probe.updateMatrixWorld(true);
      const lead = lf.getWorldPosition(a).z - rf.getWorldPosition(b).z;
      if (lead > best) {
        best = lead;
        bestT = i / 32;
      }
    }
    act.stop();
    phase.set(name, bestT);
  }
  mixer.uncacheRoot(probe);

  const out: Prepared = { clips: tpl.clips, root, phase, speed, height };
  prepared.set(tpl, out);
  return out;
}

export interface PlayOptions {
  speed?: number;
  from?: number; // clip seconds
  to?: number; // clip seconds (the action ends here, fading out from `to - fadeOut`)
  fadeIn?: number;
  fadeOut?: number;
  hold?: boolean; // clamp on the last frame until replaced/stopped (death, broken)
  rootMotion?: boolean; // let the game apply this clip's travel (see consumeRoot)
  weight?: number; // < 1 for a partial overlay on top of the base pose
}

export class OneShot {
  t: number;
  prevT: number;
  w = 0;
  fading = false;
  constructor(
    public name: string,
    public action: THREE.AnimationAction,
    public o: Required<Omit<PlayOptions, 'to'>> & { to: number }
  ) {
    this.t = o.from;
    this.prevT = o.from;
  }
  /** True on the one update where the clip passes `time` (clip seconds). */
  crossed(time: number) {
    return this.prevT < time && this.t >= time;
  }
  get done() {
    return !this.o.hold && this.t >= this.o.to;
  }
}

export interface BaseInput {
  speed: number; // current ground speed, world units/s
  runSpeed: number; // the speed that counts as a full run, world units/s
  dirX: number; // movement direction in the character's own frame (+Z forward, +X left)
  dirZ: number;
  guard?: boolean;
  air?: boolean;
  fight?: boolean; // unarmed stance for idle
}

export class ClipController {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private base = new Map<string, number>(); // smoothed base weights
  private gait = 0; // shared locomotion phase, cycles
  private guardW = 0;
  private airW = 0;
  current: OneShot | null = null;
  private fading: OneShot[] = [];
  private overlays: OneShot[] = [];
  private rootAcc = new THREE.Vector2();
  private pauseT = 0;

  constructor(
    private model: THREE.Object3D,
    private prep: Prepared,
    private worldScale: number
  ) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of prep.clips) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(LOOPS.has(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.timeScale = 0; // time is set by hand every frame
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions.set(name, a);
    }
  }

  has(name: string) {
    return this.actions.has(name);
  }

  duration(name: string) {
    return this.prep.clips.get(name)?.duration ?? 0;
  }

  play(name: string, opts: PlayOptions = {}): OneShot | null {
    const action = this.actions.get(name);
    if (!action) return null;
    const dur = action.getClip().duration;
    const shot = new OneShot(name, action, {
      speed: opts.speed ?? 1,
      from: opts.from ?? 0,
      to: Math.min(dur, opts.to ?? dur),
      fadeIn: opts.fadeIn ?? 0.12,
      fadeOut: opts.fadeOut ?? 0.25,
      hold: opts.hold ?? false,
      rootMotion: opts.rootMotion ?? false,
      weight: opts.weight ?? 1
    });
    if (shot.o.weight < 1) {
      this.overlays.push(shot);
      return shot;
    }
    if (this.current) this.retire(this.current);
    // re-triggering the clip that's still fading out: take over its action instead of
    // two OneShots fighting over the same time/weight
    this.fading = this.fading.filter((f) => f.action !== action);
    this.overlays = this.overlays.filter((f) => f.action !== action);
    this.current = shot;
    return shot;
  }

  /** Fades the current one-shot out now (interrupted by a dodge, a hit...). */
  stop(fadeOut = 0.15) {
    if (!this.current) return;
    this.current.o.fadeOut = fadeOut;
    this.retire(this.current);
    this.current = null;
  }

  private retire(s: OneShot) {
    s.fading = true;
    this.fading.push(s);
  }

  /** Root travel of the current one-shot since the last call, in world units along the
   *  character's own axes (x: left, y: forward). */
  consumeRoot(out: THREE.Vector2) {
    out.copy(this.rootAcc);
    this.rootAcc.set(0, 0);
    return out;
  }

  private rootAt(name: string, t: number, out: THREE.Vector2) {
    const c = this.prep.root.get(name);
    if (!c) return out.set(0, 0);
    const times = c.times;
    const n = times.length;
    if (t <= times[0]) return out.set(c.x[0], c.z[0]);
    if (t >= times[n - 1]) return out.set(c.x[n - 1], c.z[n - 1]);
    let i = 1;
    while (times[i] < t) i++;
    const k = (t - times[i - 1]) / (times[i] - times[i - 1]);
    return out.set(c.x[i - 1] + (c.x[i] - c.x[i - 1]) * k, c.z[i - 1] + (c.z[i] - c.z[i - 1]) * k);
  }

  /** Hit pause: this character's animation nearly freezes for `sec` (game seconds) - the
   *  attacker and the victim, and only them, hang for a beat when a blow lands. */
  pause(sec: number) {
    this.pauseT = Math.max(this.pauseT, sec);
  }

  update(dt: number, input: BaseInput) {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      dt *= 0.05;
    }
    const ease = (k: number) => 1 - Math.exp(-k * Math.max(0, dt));

    // ---- one-shots
    const cur = this.current;
    if (cur) {
      cur.prevT = cur.t;
      cur.t = Math.min(cur.o.to, cur.t + dt * cur.o.speed);
      const fadeInW = cur.o.fadeIn > 0 ? Math.min(1, (cur.t - cur.o.from) / (cur.o.fadeIn * cur.o.speed)) : 1;
      const fadeOutW = cur.o.hold ? 1 : cur.o.fadeOut > 0 ? Math.min(1, (cur.o.to - cur.t) / (cur.o.fadeOut * cur.o.speed)) : 1;
      cur.w = Math.max(0, Math.min(fadeInW, fadeOutW));
      if (cur.o.rootMotion) {
        const a = this.rootAt(cur.name, cur.prevT, new THREE.Vector2());
        const b = this.rootAt(cur.name, cur.t, new THREE.Vector2());
        this.rootAcc.x += (b.x - a.x) * this.worldScale;
        this.rootAcc.y += (b.y - a.y) * this.worldScale;
      }
      if (cur.done) {
        this.current = null;
        cur.w = 0;
      }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.prevT = f.t;
      f.t = Math.min(f.o.to, f.t + dt * f.o.speed);
      f.w -= dt / Math.max(0.01, f.o.fadeOut);
      if (f.w <= 0) this.fading.splice(i, 1);
    }
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const f = this.overlays[i];
      f.prevT = f.t;
      f.t += dt * f.o.speed;
      const k = Math.min((f.t - f.o.from) / Math.max(0.01, f.o.fadeIn), (f.o.to - f.t) / Math.max(0.01, f.o.fadeOut));
      f.w = Math.max(0, Math.min(1, k)) * f.o.weight;
      if (f.t >= f.o.to) this.overlays.splice(i, 1);
    }

    // ---- base: locomotion / guard / air, under whatever the one-shots leave uncovered
    this.guardW += ((input.guard ? 1 : 0) - this.guardW) * ease(14);
    this.airW += ((input.air ? 1 : 0) - this.airW) * ease(12);
    const s = Math.max(0, input.speed) / Math.max(0.01, input.runSpeed);
    const walkSpan = 0.45;
    const idleW = Math.max(0, 1 - s / walkSpan);
    const runW = Math.min(1, Math.max(0, (s - walkSpan) / (1 - walkSpan)));
    const moveW = 1 - idleW - runW;
    const dl = Math.hypot(input.dirX, input.dirZ);
    const dx = dl > 1e-4 ? input.dirX / dl : 0;
    const dz = dl > 1e-4 ? input.dirZ / dl : 1;
    let fw = Math.max(0, dz);
    let bw = Math.max(0, -dz);
    let lw = Math.max(0, dx);
    let rw = Math.max(0, -dx);
    if (!this.actions.has('strafeL')) {
      lw = rw = 0;
    }
    if (!this.actions.has('walkBack')) bw = 0;
    const dsum = fw + bw + lw + rw || 1;
    fw /= dsum;
    bw /= dsum;
    lw /= dsum;
    rw /= dsum;

    const fight = !!input.fight && this.actions.has('fightIdle');
    // there's only a forward run: fast sideways/backwards movement keeps the walking
    // strafe/back-pedal clips (sped up by scaleFor below) rather than sprinting sideways
    const target: Record<string, number> = {
      idle: fight ? 0 : idleW,
      fightIdle: fight ? idleW : 0,
      walk: moveW * fw,
      run: runW * fw,
      walkBack: (moveW + runW) * bw,
      strafeL: (moveW + runW) * lw,
      strafeR: (moveW + runW) * rw
    };

    // one shared gait phase at the blended rate, each clip offset so its own left-foot-
    // forward moment lines up - walk and run can then cross-fade without the feet
    // scissoring
    const scaleFor = (name: string) => {
      const nat = (this.prep.speed.get(name) ?? 0) * this.worldScale;
      return nat > 0.05 ? THREE.MathUtils.clamp(input.speed / nat, 0.55, 1.8) : 1;
    };
    let rate = 0;
    let wsum = 0;
    for (const name of ['walk', 'run', 'walkBack', 'strafeL', 'strafeR']) {
      const w = target[name];
      if (w <= 0) continue;
      rate += (w * scaleFor(name)) / (this.duration(name) || 1);
      wsum += w;
    }
    if (wsum > 0) this.gait = (this.gait + (dt * rate) / wsum) % 1;

    const oneShotW = Math.min(1, (this.current?.w ?? 0) + this.fading.reduce((acc, f) => acc + f.w, 0));
    const baseW = 1 - oneShotW;
    for (const name of LOCO) {
      const a = this.actions.get(name);
      if (!a) continue;
      const prev = this.base.get(name) ?? (name === 'idle' ? 1 : 0);
      const w = prev + ((target[name] ?? 0) - prev) * ease(10);
      this.base.set(name, w);
      const dur = a.getClip().duration;
      if (name === 'idle' || name === 'fightIdle') a.time = (a.time + dt) % dur;
      else a.time = ((this.gait + (this.prep.phase.get(name) ?? 0)) % 1) * dur;
      a.setEffectiveWeight(w * baseW * (1 - this.guardW) * (1 - this.airW));
    }
    const guard = this.actions.get('guard');
    if (guard) {
      guard.time = (guard.time + dt) % guard.getClip().duration;
      guard.setEffectiveWeight(baseW * this.guardW * (1 - this.airW));
    }
    const jump = this.actions.get('jump');
    if (jump) {
      jump.time = 0.42; // tucked, mid-air (its rise was stripped - physics does that)
      jump.setEffectiveWeight(baseW * this.airW);
    }

    // ---- one-shot actions last, so they own their action's time/weight this frame
    for (const f of this.fading) {
      f.action.time = f.t;
      f.action.setEffectiveWeight(Math.max(0, f.w));
    }
    for (const f of this.overlays) {
      f.action.time = f.t;
      f.action.setEffectiveWeight(f.w);
    }
    if (this.current) {
      this.current.action.time = this.current.t;
      this.current.action.setEffectiveWeight(this.current.w);
    }
    // anything neither base nor a live one-shot is silenced
    for (const [name, a] of this.actions) {
      if (LOCO.includes(name as (typeof LOCO)[number]) || name === 'guard' || name === 'jump') continue;
      const live = this.current?.action === a || this.fading.some((f) => f.action === a) || this.overlays.some((f) => f.action === a);
      if (!live) a.setEffectiveWeight(0);
    }
    this.mixer.update(0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}

export interface ClipRigOptions {
  lod?: boolean; // decimated body (enemies); a model that only ships one body uses it either way
  tint?: THREE.Color; // multiplies the armor's base color (enemies)
  rim?: THREE.Color;
  height?: number;
  grips?: { right?: Grip; left?: Grip };
  kind?: RigInstance['kind'];
}

export function createClipRig(tpl: CharacterTemplate, opts: ClipRigOptions = {}): RigInstance {
  const prep = prepare(tpl);
  const model = cloneSkeleton(tpl.scene) as THREE.Group;

  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) bodies.push(o as THREE.SkinnedMesh);
  });
  const wanted = bodies.filter((b) => b.name.endsWith('LOD') === !!opts.lod);
  const keep = (wanted[0] ?? bodies[0])?.name;
  const drop: THREE.Object3D[] = [];
  const flash = { value: 0 };
  const rim = opts.rim ?? new THREE.Color(1.0, 0.5, 0.3).multiplyScalar(0.22);
  const mats: THREE.Material[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.name !== keep) {
      drop.push(m);
      return;
    }
    // own material per instance: the hit-flash uniform (patchCharacter) is per character
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    if (opts.tint) mat.color.multiply(opts.tint);
    patchCharacter(mat, flash, rim);
    m.material = mat;
    mats.push(mat);
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
  });
  drop.forEach((o) => o.removeFromParent());

  const height = opts.height ?? 2.32;
  const scale = height / prep.height;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(model);
  root.add(body);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // weapon/gourd attach points at each palm (between the wrist and the finger roots)
  const attach = (side: 'Right' | 'Left', axis: THREE.Vector3, edge: THREE.Vector3) => {
    const bone = model.getObjectByName(`mixamorig${side}Hand`)!;
    const palm = new THREE.Vector3();
    let n = 0;
    for (const f of ['Index1', 'Middle1', 'Ring1', 'Pinky1']) {
      const c = model.getObjectByName(`mixamorig${side}Hand${f}`);
      if (c) {
        palm.add(c.position);
        n++;
      }
    }
    if (n) palm.divideScalar(n).multiplyScalar(0.65);
    const g = new THREE.Group();
    g.position.copy(palm);
    g.quaternion.copy(gripQuat(axis, edge));
    // weapons are modelled in world units; cancel the skeleton's own scale chain
    g.scale.setScalar(1 / bone.getWorldScale(new THREE.Vector3()).x);
    bone.add(g);
    return g;
  };
  const gr = opts.grips?.right ?? SWORD_GRIP;
  const gl = opts.grips?.left ?? OFF_GRIP;
  const hand = attach('Right', gr.axis, gr.edge);
  const handL = attach('Left', gl.axis, gl.edge);

  const ctl = new ClipController(model, prep, scale);
  const stub = () => new THREE.Object3D();
  const rig: RigInstance = {
    root,
    body,
    head: stub(),
    eye: stub(),
    legL: stub(),
    legR: stub(),
    legBaseY: 0,
    armL: stub(),
    armR: stub(),
    hand,
    handL,
    scarf: stub(),
    mats,
    flash,
    kind: opts.kind ?? 'samurai',
    clip: ctl,
    model,
    sizeScale: height / 2.32,
    dispose: () => {
      ctl.dispose();
      for (const m of mats) m.dispose();
    }
  };
  return rig;
}
