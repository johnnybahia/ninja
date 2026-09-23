import type * as THREE from 'three';

export type CharacterId = 'kage' | 'bravo';

export type WeaponKind = 'melee' | 'chain' | 'proj' | 'bomb' | 'karate' | 'flame';

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
  stCost?: number;
  count?: number;
  spread?: number;
  speed?: number;
  pierce?: boolean;
  gun?: boolean;
  spin?: boolean;
  cdBase?: number;
  cdMin?: number;
  rocket?: boolean;
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
  body: THREE.Group;
  head: THREE.Group;
  eye: THREE.Mesh | THREE.Object3D;
  legL: THREE.Group;
  legR: THREE.Group;
  legBaseY: number;
  armL: THREE.Group;
  armR: THREE.Group;
  hand: THREE.Group;
  handL: THREE.Group;
  scarf: THREE.Object3D;
  tails?: THREE.Group;
  mats: THREE.Material[];
}

export interface EnemyInstance {
  type: 'samurai' | 'archer' | 'boss';
  isZ: boolean;
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
  gun?: boolean;
  sp?: boolean;
  ptMult?: number;
  bomb?: boolean;
  kb?: number;
  noSolid?: boolean;
}

export interface GameSettings {
  cameraSensitivity: number; // 0.6 = Baixa, 1.0 = Normal, 1.5 = Alta, 2.0 = Rápida
  autoCamera: boolean; // Auto-align camera behind movement
  autoTurnWithStick: boolean; // Directional rotates camera dynamically
}
