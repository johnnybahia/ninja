import type * as THREE from 'three';
import type { Ribbon } from './characters';
import type { ClipController } from './clipRig';
import type { BladeTrail } from './vfx';

export type CharacterId = 'kage' | 'samurai';

export type WeaponKind = 'melee' | 'chain' | 'proj' | 'bomb' | 'karate';

export interface WeaponDef {
  id: string;
  name: string;
  glyph: string;
  kind: WeaponKind;
  dmg: number[];
  range?: number;
  arc?: number;
  cd: number;
  kb?: number;
  anim?: string;
  dur?: number;
  stamina?: number;
  count?: number;
  spread?: number;
  speed?: number;
  pierce?: boolean;
  life?: number;
  pointMult?: number;
}

export interface SpecialDef {
  name: string;
  cd: number;
}

export interface KarateMove {
  name: string;
  range: number;
  arc: number;
  dmg: number;
  kb: number;
  cd: number;
  dur: number;
  anim: string;
  lunge: number;
  heavy?: boolean;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  kanji: string;
  title: string;
  accent: string;
  lede: string;
  weapons: WeaponDef[];
}

export interface RigInstance {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  eye: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  legBaseY: number;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  hand: THREE.Group;
  handL: THREE.Group;
  scarf: THREE.Object3D;
  tails?: THREE.Group;
  mats: THREE.Material[];
  // articulated skeleton (characters.ts)
  hips?: THREE.Object3D;
  hipsRestY?: number;
  spine?: THREE.Object3D;
  chest?: THREE.Object3D;
  neck?: THREE.Object3D;
  foreL?: THREE.Object3D;
  foreR?: THREE.Object3D;
  handBoneL?: THREE.Object3D;
  handBoneR?: THREE.Object3D;
  shinL?: THREE.Object3D;
  shinR?: THREE.Object3D;
  footL?: THREE.Object3D;
  footR?: THREE.Object3D;
  plates?: THREE.Object3D[];
  flash?: { value: number };
  // rim-light colour (a shader uniform shared by the rig's materials) and its base value,
  // so the engine can scale it with the atmosphere (see rimBoost)
  rim?: THREE.Color;
  rimBase?: THREE.Color;
  cloth?: Ribbon[];
  kind?: 'ninja' | 'samurai' | 'archer' | 'oni';
  dispose?: () => void;
  // Mocap rig (clipRig.ts): animated by its clip controller instead of animateCharacter,
  // and every procedural joint above is an inert stub.
  clip?: ClipController;
  model?: THREE.Object3D;
  // size relative to a standard character (mocap rigs: their root scale is a unit
  // conversion, not a size - see sizeOf in engine.ts)
  sizeScale?: number;
}

export type EnemyVariant = 'brute' | 'monk' | 'trovao' | 'sombrio'; // samurai kinds, and the Oni's boss-wave forms

export interface EnemyInstance {
  type: 'samurai' | 'archer' | 'boss';
  hp: number;
  maxHp: number;
  speed: number;
  r: number;
  h: number;
  rig: RigInstance;
  pos: THREE.Vector3;
  kb: THREE.Vector3;
  yaw: number;
  state: string;
  t: number;
  cd: number;
  cd2: number;
  cd3?: number;
  flash: number;
  dead: boolean;
  deathT: number;
  phase: number;
  moveAmt: number;
  hitPlayer: boolean;
  chargeDir: THREE.Vector3;
  vy: number;
  strafe?: number;
  bar: THREE.Group;
  barFg: THREE.Mesh;
  tele?: THREE.Mesh;
  windup?: number;
  _risky?: boolean;
  _special?: boolean;
  _ptMult?: number;
  _counter?: boolean;
  _wasExecutable?: boolean;
  hitLunge?: boolean;
  lungeYaw?: number;
  anim?: { kind: string; t: number; dur: number; side: number };
  shotPending?: boolean;
  // Sekiro-style combat
  posture: number;
  maxPosture: number;
  postureT: number; // time since posture was last raised (regen starts after a delay)
  brokenT: number; // >0 while posture is broken: deathblow window
  mode: 'approach' | 'circle' | 'attack' | 'recover' | 'guard' | 'stagger' | 'broken';
  modeT: number;
  token: boolean;
  strike?: EnemyStrike;
  comboLeft: number;
  circleDir: number;
  guardT: number;
  staggerT: number;
  dbCount?: number; // deathblows already taken (boss needs two)
  // mocap archer: the shot in progress, a close-range kick, and the live bow string /
  // nocked arrow drawn over the (stringless) bow model
  bow?: { phase: 'draw' | 'aim' | 'release'; t: number };
  kick?: { t: number; done: boolean };
  bowFx?: { bow: THREE.Object3D; string: THREE.Line; arrow: THREE.Object3D; nock: THREE.Object3D; mid: THREE.Vector3 };
  // blade-accurate strikes (mocap enemies): the held weapon and its cutting extent, and
  // the window in which the weapon (or a kicking foot) can actually reach the player
  weapon?: THREE.Object3D;
  bladeKey?: string;
  blade?: {
    st: EnemyStrike;
    t: number;
    dur: number;
    hit: boolean;
    limb?: 'foot';
    prev: { a: THREE.Vector3; b: THREE.Vector3 };
    prevOk: boolean;
  };
  trail?: BladeTrail;
  elite?: boolean;
  fury?: boolean; // the Oni's second phase
  aura?: THREE.Mesh;
  // fighting back: rest before the next parry/sidestep, blows taken since the last defence
  // (raises the odds of one), and a sidestep in progress
  defCd?: number;
  dry?: number;
  dodgeT?: number;
  dodgeX?: number;
  dodgeZ?: number;
  // obstacle steering: side taken around a blocker, time left on it, smoothed heading,
  // and the stall detector that forces a sidestep when pushing against something
  steerSide?: number;
  steerT?: number;
  sdx?: number;
  sdz?: number;
  stuckT?: number;
  escapeT?: number;
  // a samurai with its own way of fighting: the heavy Brutamontes or the long-reach Monge
  variant?: EnemyVariant;
  // wave goals: the captain to hunt, and a routed enemy running away before it vanishes
  // boss forms: the ability clock, the Sombrio's time out of sight, a forced perilous strike
  bossT?: number;
  vanishT?: number;
  forcePeril?: boolean;
  captain?: boolean;
  flee?: boolean;
  fleeT?: number;
  postureBar?: THREE.Mesh;
  danger?: THREE.Sprite;
  dbMark?: THREE.Sprite;
}

export type StrikeKind = 'slash' | 'thrust' | 'sweep' | 'smash';

export interface EnemyStrike {
  kind: StrikeKind;
  windup: number;
  t: number;
  perilous: boolean;
  feint: boolean;
  reach: number;
  dmg: number;
  side: number;
}

export interface ProjectileInstance {
  type: string;
  friendly: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dmg: number;
  life: number;
  grav?: number;
  pierce?: boolean;
  hit?: Set<EnemyInstance>;
  r?: number;
  mesh: THREE.Object3D;
  homing?: boolean;
  speed?: number;
  sp?: boolean;
  ptMult?: number;
  bomb?: boolean;
  aoeR?: number;
  kb?: number;
  noSolid?: boolean;
}

export interface GameSettings {
  cameraSensitivity: number; // 0.6 = Baixa, 1.0 = Normal, 1.5 = Alta, 2.0 = Rápida
  autoCamera: boolean; // Auto-align camera behind movement
  autoTurnWithStick: boolean; // Directional rotates camera dynamically
  cinematicCamera: boolean; // Finisher / special-move camera moves, depth of field and flash
}
