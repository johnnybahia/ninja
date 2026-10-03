import * as THREE from 'three';
import {
  CharacterId,
  CharacterDef,
  WeaponDef,
  RigInstance,
  EnemyInstance,
  EnemyVariant,
  ProjectileInstance,
  EnemyStrike,
  StrikeKind,
  GameSettings
} from './types';
import {
  TAU,
  R_ARENA,
  clamp,
  wrap,
  turnTo,
  rand,
  WEAPONS_KAGE,
  SPECIALS,
  KARATE
} from './constants';
import { sfx } from './audio';
import { World } from './world';
import { ATMOSPHERES, AtmosMode, atmosphereForWave } from './atmosphere';
import { THEMES, ThemeMode, themeForWave } from './theme';
import { Afterimages, BladeTrail, DustPool, ImpactPool, InkDecals, softDotTexture, makeBladeGlow, makeLightning } from './vfx';
import { PostFX, NINJA_LOOK, Quality, QualitySetting, QualityProfile, qualityProfile, detectQuality } from './postfx';
import { MAT, makeWeapon, mesh } from './rigs';
import { buildCharacter } from './characters';
import { createClipRig, Grip, OneShot, PlayOptions } from './clipRig';
import { loadCharacter, loadWeapons, loadLazyWeapons, weaponsReady, preloadModels, characterIfReady, CharacterTemplate, LAZY_CHARACTERS, type CharacterModel } from './models';
import { COMBOS, SPECIAL_MOVES, RUSH, ENEMY_STRIKES, BOSS_STRIKES, FINISHERS, FINISHER_CLIP_LEN, Finisher, ClipMove } from './moves';
import { BladeSeg, makeSeg, segSegDist, sweepVsCapsule, BLADE_SEG, MAGNET_REACH, HURT_BOTTOM, HURT_TOP } from './combat';
import { DebugDraw } from './debugdraw';
import { animateCharacter, animateDeath } from './animation';
import { TUNE } from './tunables';
import { cardById, describeOffer, drawCards, CardOffer } from './cards';
import { HONOR, NO_BONUS, MetaBonus, RunSummary } from './meta';
import { pickWaveGoal, pickWaveMod, WAVE_GOALS, WaveMod, type GoalId } from './mods';
import { Outpost, pickPostSpots } from './outposts';

// Enemy samurai reuse the Rōnin's mesh, armour darkened toward blued steel
const ENEMY_TINT = new THREE.Color(0.42, 0.46, 0.62);
const ENEMY_RIM = new THREE.Color(0.35, 0.45, 1.0).multiplyScalar(0.18);
// the Brutamontes: a darker, bigger samurai
// The Oni takes a different form every boss wave: 4 the Oni, 8 the Trovão (lightning that
// marks the ground), 12 the Sombrio (vanishes and strikes from behind), then round again
const BOSS_NAME: Record<string, string> = { oni: '鬼 ONI', trovao: '雷 ONI TROVÃO', sombrio: '影 ONI SOMBRIO' };
const BOSS_COLOR: Record<string, number> = { trovao: 0x40b0ff, sombrio: 0xa060ff };
const BOSS_HINT: Record<string, string> = {
  oni: 'O oni despertou',
  trovao: 'Oni Trovão: raios marcam o chão, saia do círculo',
  sombrio: 'Oni Sombrio: ele some e reaparece de surpresa'
};
function bossFormFor(wave: number): EnemyVariant | undefined {
  const k = (Math.floor(wave / 4) - 1) % 3;
  return k === 1 ? 'trovao' : k === 2 ? 'sombrio' : undefined;
}
const BOLT_DELAY = 1.15;
const BOLT_R = 1.75;
const BOLT_RING = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2);
const BOLT_PILLAR = new THREE.CylinderGeometry(0.14, 0.24, 22, 10, 1, true);
// The fighters with their own models, and where the sword sits in each hand (measured so the
// weapon matches how the Rōnin holds it in the same clips)
const VARIANT_MODEL: Partial<Record<EnemyVariant, CharacterModel>> = { monk: 'bonin', shinobi: 'shinobi', raio: 'raio', nito: 'nito' };
const VARIANT_HEIGHT: Partial<Record<EnemyVariant, number>> = { brute: 2.8, monk: 2.4, shinobi: 2.3, raio: 2.3, nito: 2.45 };
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const VARIANT_GRIP: Partial<Record<EnemyVariant, { right: Grip; left?: Grip }>> = {
  shinobi: { right: { axis: V3(0.731, -0.225, -0.644), edge: V3(-0.645, 0.08, -0.76) } },
  // claws on the knuckles: +Z along the forearm, +Y on the back of the hand (from the skeleton's rest pose)
  raio: { right: { axis: V3(0, 1, 0.003), edge: V3(-0.272, -0.003, 0.962) }, left: { axis: V3(0, 0.998, 0.057), edge: V3(-0.334, 0.054, -0.941) } },
  nito: { right: { axis: V3(0.658, -0.383, -0.648), edge: V3(-0.581, 0.288, -0.761) }, left: { axis: V3(-0.728, -0.084, 0.68), edge: V3(-0.042, 0.996, 0.079) } },
  monk: { right: { axis: V3(0.323, -0.167, -0.931), edge: V3(-0.946, -0.057, -0.318) } }
};
// the weapons each fighter wields (right hand, left hand) - fetched in the background
const VARIANT_WEAPONS: Partial<Record<EnemyVariant, [string, string]>> = { nito: ['dsfire', 'dsmagic'], raio: ['claw_r', 'claw_l'] };
// A wave doesn't pour in all at once: only so many enemies are in the fight at a time and the rest
// wait at the edge of the arena, stepping in a moment after someone falls (the fight stays readable)
// Conquista: a post wakes up when the player comes this close; each post has its own garrison
const POST_ACTIVATE = 20;
// Foot soldiers (ashigaru): plenty of them, each falls to one blow and hits lightly. They need no
// attack token, only a couple swing at once, so a crowd of them is a battlefield, not a wall.
const ASHIGARU_TINT = new THREE.Color(0.6, 0.55, 0.46);
const FODDER_SWINGERS = 2;
const FODDER_DAMAGE = 0.3;
// patrols on the road between posts
const PATROL_FIRST = 9;
const PATROL_EVERY: [number, number] = [16, 26];
const PATROL_CLEAR = 22; // no patrol while the player is this close to a post that is still hostile
const isFodder = (e: { variant?: EnemyVariant }) => e.variant === 'ashigaru';
const GARRISONS = ['infantry', 'archers', 'elite'] as const;
type Garrison = (typeof GARRISONS)[number];
const GARRISON_NAME: Record<Garrison, string> = { infantry: 'infantaria', archers: 'arqueiros', elite: 'guarda de elite' };
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const REINFORCE_GAP = 1.4; // seconds after a fall before the next one steps in
const REINFORCE_SPACING = 0.6; // between two that step in back to back
const RESIST_MAX = 5; // most enemies in the field at once on a Resistir wave
const HINTS: Partial<Record<EnemyVariant, [string, string]>> = {
  brute: ['Novo inimigo: Brutamontes', 'Pule a varrida e castigue a recuperação'],
  monk: ['Novo inimigo: Samurai do Bō', 'Ataca de longe: feche a distância com a esquiva'],
  nito: ['Novo inimigo: Samurai das Duas Espadas', 'Espadas gêmeas de fogo e magia: apare ou afaste-se'],
  shinobi: ['Novo inimigo: Shinobi', 'Veloz: some e reaparece perto, atira estrelas'],
  raio: ['Novo inimigo: Lutador do Raio', 'Garras em combos relâmpago e teletransporte: esquive no ritmo']
};
const FIGHTER_NAME: Partial<Record<EnemyVariant, string>> = { shinobi: 'Shinobi', raio: 'Lutador do Raio', nito: 'Samurai das Duas Espadas', monk: 'Samurai do Bō' };
const SHINOBI_LIGHT = new THREE.Color(0.5, 1.7, 3.2);
const RAIO_LIGHT = new THREE.Color(1.7, 1.3, 3.4);
const FIRE_LIGHT = new THREE.Color(2.2, 0.85, 0.25);
const MAGIC_LIGHT = new THREE.Color(1.3, 0.7, 2.6);
// the named fighters, the wave each one joins at, and in what order they take turns
const FIGHTER_ORDER: EnemyVariant[] = ['nito', 'shinobi', 'raio'];
const FIGHTER_MIN: Partial<Record<EnemyVariant, number>> = { nito: 4, shinobi: 5, raio: 6 };
const BRUTE_TINT = new THREE.Color(0.62, 0.34, 0.3);
// Archer's bow hand, measured from its own aiming clip: arrow flight along the line from
// the drawing hand to the bow hand, limbs as upright as the pose allows
const ARCHER_BOW_GRIP: Grip = { axis: new THREE.Vector3(-0.038, 0.93, -0.366), edge: new THREE.Vector3(-0.798, 0.193, 0.571) };
// Sword hand of the other mocap enemies: the Rōnin's measured grip carried over through
// each skeleton's own hand orientation (sampled on the same retargeted clip frames)
const SAMURAI2_GRIP: Grip = { axis: new THREE.Vector3(0.295, -0.267, -0.918), edge: new THREE.Vector3(-0.988, 0.151, 0.016) };
const GIANT_GRIP: Grip = { axis: new THREE.Vector3(0.97, 0.025, 0.243), edge: new THREE.Vector3(-0.124, -0.45, -0.885) };
const GIANT_HEIGHT = 5;
// how long the archer holds full draw before loosing (the readable part of its telegraph)
const ARCHER_AIM_HOLD = 0.45;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Scroll drop chance per kill for each loaded weapon (2 weapons -> 7.5% per kill).
const SCROLL_RATE_PER_WEAPON = 0.0375;
const SPECIAL_DURATION = 20;

// Pseudo-random distribution: the chance on the n-th kill since the last scroll is C·n.
// Solves for C so the long-run rate still averages `p`, but without long droughts or streaks.
const prdCache = new Map<number, number>();
function prdConstant(p: number): number {
  const cached = prdCache.get(p);
  if (cached !== undefined) return cached;
  const rateFor = (c: number) => {
    let mean = 0;
    let alive = 1;
    for (let n = 1; alive > 1e-9; n++) {
      const pn = Math.min(1, c * n);
      mean += n * alive * pn;
      alive *= 1 - pn;
    }
    return 1 / mean;
  };
  let lo = 0;
  let hi = p;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rateFor(mid) < p) lo = mid;
    else hi = mid;
  }
  prdCache.set(p, hi);
  return hi;
}

// Blade span (local Z on the weapon mesh) swept by the melee trail
const TRAIL_SPEC: Record<string, { base: number; tip: number; tint: THREE.Color }> = {
  katana: { base: 0.25, tip: 1.33, tint: new THREE.Color(1.25, 1.4, 1.75) },
  bo: { base: -0.95, tip: 1.55, tint: new THREE.Color(1.7, 1.25, 0.6) },
  kama: { base: 0.3, tip: 0.62, tint: new THREE.Color(1.3, 1.55, 1.35) }
};
const LIMB_TRAIL = { base: 0, tip: 0, tint: new THREE.Color(1.45, 1.4, 1.25) };
const ENEMY_TRAIL = new THREE.Color(2.3, 0.95, 0.6);
const ENEMY_TRAIL_BOSS = new THREE.Color(2.6, 0.6, 0.4);
const SHINOBI_TRAIL = new THREE.Color(0.6, 1.8, 3.2);
const RAIO_TRAIL = new THREE.Color(1.8, 1.3, 3.4);
const TRAIL_SPECIAL = new THREE.Color(2.2, 1.6, 0.5);
const IMPACT_NORMAL = new THREE.Color(2.2, 1.9, 1.5);
const IMPACT_HEAVY = new THREE.Color(2.6, 1.7, 0.9);
const IMPACT_CRIT = new THREE.Color(3.0, 2.2, 0.7);
const IMPACT_HURT = new THREE.Color(2.6, 0.5, 0.35);
const IMPACT_DODGE = new THREE.Color(1.2, 2.2, 2.6);
const IMPACT_DEFLECT = new THREE.Color(3.2, 1.7, 0.45);
const IMPACT_BLOCK = new THREE.Color(1.8, 1.5, 1.1);
const IMPACT_TELL = new THREE.Color(2.8, 2.5, 1.3);

// Sekiro-style combat tuning
// (the parry windows live in TUNE: parryWindow / perfectWindow)
const TELL_LEAD = 0.17; // the blow's flash comes this long before it lands: pressing guard now is a perfect parry
const PARRY_SCENE_GAP = [0, 14, 7, 3.5]; // seconds between two defence scenes, by TUNE.parryScene
const CUT_MIN_SPEED = 5; // m/s: the tip must be moving at least this fast to cut a shot out of the air
const SHOT_BACK_SPEED = 26;
const CLASH_POSE_TIME = 0.2; // how long the weapon is held where the blades met
const GHOST_DASH = new THREE.Color(0x2a2464);
const GHOST_PERFECT = new THREE.Color(0x6a4a18);
const DUST_BASE = new THREE.Color(0.55, 0.5, 0.44); // seconds after pressing guard that an incoming strike is deflected
const PLAYER_MAX_POSTURE = 100;
// Swings cost stamina on the mocap rig, so a dodge has to stay affordable after a combo
const DASH_COST = 22;
const STAMINA_REGEN = 30; // per second
// Incoming hits at or below this (arrows, an archer's kick) only jolt the Rōnin - he keeps
// moving and swinging; anything heavier knocks him out of what he was doing
const LIGHT_HIT = 10;
// Healing gourd: the clip runs fast (about a second in all); half the sip lands as the gourd
// reaches the mouth, the rest near the end, and a press during a move waits this long for it
const HEAL_SPEED = 1.8;
const HEAL_FIRST_AT = 0.3;
const HEAL_SECOND_LEFT = 0.25;
const HEAL_BUFFER = 0.35;

// Canvas sprites shared by every enemy: the perilous-attack kanji and the deathblow mark
let dangerTex: THREE.CanvasTexture | null = null;
let deathblowTex: THREE.CanvasTexture | null = null;
function markTextures() {
  if (!dangerTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,40,20,0.55)');
    gr.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    g.font = 'bold 84px "Zen Kaku Gothic New", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(20,4,4,0.9)';
    g.strokeText('危', 64, 68);
    g.fillStyle = '#ff3b24';
    g.fillText('危', 64, 68);
    dangerTex = new THREE.CanvasTexture(c);
    dangerTex.colorSpace = THREE.SRGBColorSpace;
  }
  if (!deathblowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,60,40,1)');
    gr.addColorStop(0.45, 'rgba(220,10,10,0.7)');
    gr.addColorStop(1, 'rgba(160,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    deathblowTex = new THREE.CanvasTexture(c);
  }
  return { dangerTex: dangerTex!, deathblowTex: deathblowTex! };
}

export interface GameEngineCallbacks {
  onHpChange: (hp: number, maxHp: number) => void;
  onStaminaChange: (st: number, maxSt: number) => void;
  onXpChange: (xp: number, xpNext: number, level: number) => void;
  onScoreChange: (score: number) => void;
  onComboChange: (combo: number) => void;
  onWaveChange: (wave: number, text: string, sub: string) => void;
  onWeaponChange: (weaponIdx: number, weapon: WeaponDef) => void;
  onSpecialsUpdate: (specials: Record<number, number>) => void;
  onGameOver: (score: number, wave: number, level: number, kills: number, bestCombo: number, summary: RunSummary) => void;
  onQualityChange?: (setting: QualitySetting, effective: Quality) => void;
  onPostureChange?: (posture: number, max: number) => void;
  onCinematic?: (active: boolean, kind?: 'full' | 'short' | 'duel') => void;
  onDeathblowReady?: (ready: boolean) => void;
  onHealsChange?: (heals: number) => void;
  onCardOffer?: (offer: CardOffer[] | null) => void;
  onHonorChange?: (honor: number) => void;
  onBossChange?: (boss: { hp: number; max: number; fury: boolean; name: string } | null) => void;
  onWaveMod?: (mod: { id: string; name: string; glyph: string; desc: string } | null) => void;
  // shots being drawn or in flight toward the player from outside the view: angle from the camera's forward (rad, + = right)
  onThreats?: (threats: { a: number; u: number }[]) => void;
}

// A committed move or reaction on the mocap rig. Times are clip seconds (see moves.ts).
interface PlayerAct {
  kind: 'attack' | 'special' | 'hurt' | 'deflect' | 'block' | 'stagger' | 'heal' | 'deathblow' | 'draw' | 'death';
  shot: OneShot;
  move?: ClipMove;
  events: { t: number; fn: () => void }[];
  chainAt: number;
  cancelAt: number;
  endAt: number;
  turnUntil: number;
  onChain?: () => void;
  // blade-accurate hits (see stepHitWindows): the clip-time spans in which the weapon
  // can connect, plus the attack-magnetism target the swing closes on
  windows: HitWindow[];
  target?: EnemyInstance;
  magnet?: { reach: number; until: number; k: number };
}

interface HitWindow {
  t0: number;
  t1: number;
  dmg: number;
  kb: number;
  heavy: boolean;
  weapon: WeaponDef;
  hits: Set<EnemyInstance>;
  began: boolean;
  wide: number; // extra contact radius (a broad shove)
  ring: number; // whirl: anyone this close is caught when the window is half through
  ringDone: boolean;
}

// Where a blow really landed: the contact point and the direction the blade was travelling
interface HitInfo {
  point: THREE.Vector3;
  dirX: number;
  dirZ: number;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private callbacks: GameEngineCallbacks;

  public settings: GameSettings = {
    cameraSensitivity: 1.0,
    autoCamera: true,
    autoTurnWithStick: true,
    cinematicCamera: true
  };

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;
  private world!: World;

  private solids: { x: number; z: number; r: number; h: number }[] = [];

  // Particles (Gerais: poeira, faíscas, fumaça, magia)
  private PN = 700;
  private pPos = new Float32Array(this.PN * 3);
  private pCol = new Float32Array(this.PN * 3);
  private pVel = new Float32Array(this.PN * 3);
  private pLife = new Float32Array(this.PN);
  private pGrav = new Float32Array(this.PN);
  private pGeo = new THREE.BufferGeometry();
  private pIdx = 0;
  private tmpC = new THREE.Color();

  // Blood & Splatter Particles (Simulação visceral de sangue e impacto de corte)
  private BLOOD_PN = 1000;
  private bPos = new Float32Array(this.BLOOD_PN * 3);
  private bCol = new Float32Array(this.BLOOD_PN * 3);
  private bVel = new Float32Array(this.BLOOD_PN * 3);
  private bLife = new Float32Array(this.BLOOD_PN);
  private bMaxLife = new Float32Array(this.BLOOD_PN);
  private bGrav = new Float32Array(this.BLOOD_PN);
  private bGeo = new THREE.BufferGeometry();
  private bIdx = 0;
  private bloodPoints!: THREE.Points;

  // Shockwaves & Blood Rings
  private rings: { m: THREE.Mesh; t: number; dur: number; maxR: number; startR: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);

  // Character & Weapons
  public charId: CharacterId = 'kage';
  public weapons: WeaponDef[] = WEAPONS_KAGE;
  public activeWeaponIdx = 0;
  // Bumped on every setCharacter() call so a slow in-flight load (external GLB fetch)
  // can tell it's been superseded by a newer selection and discard its result instead
  // of clobbering whatever the player switched to in the meantime.
  private charReqId = 0;

  // Player State
  public player = {
    rig: null as unknown as RigInstance,
    pos: new THREE.Vector3(0, 0, 5),
    kb: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    vy: 0,
    yaw: Math.PI,
    hp: 60,
    maxHp: 60,
    st: 100,
    maxSt: 100,
    score: 0,
    level: 1,
    xp: 0,
    xpNext: 800,
    dmgMult: 1,
    killCombo: 0,
    killComboT: 0,
    hitCombo: 0,
    hitComboT: 0,
    bestCombo: 0,
    tookDamage: false,
    jumps: 0,
    grounded: true,
    dash: 0,
    dashDir: new THREE.Vector3(),
    inv: 0,
    dashInv: false,
    atkCd: 0,
    combo: 0,
    comboT: 0,
    comboW: -1,
    anim: null as { kind: string; t: number; dur: number; side: number } | null,
    moveAmt: 0,
    phase: 0,
    kills: 0,
    weaponMeshes: [] as THREE.Group[],
    special: {} as Record<number, number>,
    tornado: 0,
    torTick: 0,
    rush: null as { t: number; hits: number; kicked: boolean } | null,
    attackHeldT: 0,
    guardPressT: -99,
    posture: 0,
    postureT: 0,
    staggerT: 0,
    lastPostureSent: -1,
    heals: 3,
    healT: 0,
    healDur: 0,
    healHalf: false,
    healDone: false,
    dbReady: false
  };

  private slash!: THREE.Mesh;
  private slashT = 1;
  private slashDur = 0.16;
  private slashGeos: Record<string, THREE.BufferGeometry> = {};

  private chain = new THREE.Group();
  private chainLink!: THREE.Mesh;
  private chainTip!: THREE.Mesh;
  private chainT = 1;
  private chainSpin = 0;

  // Entities
  private enemies: EnemyInstance[] = [];
  private projectiles: ProjectileInstance[] = [];
  private pickups: { m: THREE.Mesh; x: number; z: number; t: number }[] = [];
  private scrolls: { g: THREE.Group; ring: THREE.Mesh; glyph: THREE.Sprite; x: number; z: number; t: number; w: number }[] = [];
  private glyphTex = new Map<string, THREE.CanvasTexture>();
  private killsSinceScroll = 0;
  private scrollsGiven: Record<number, number> = {};

  private projPools: Record<string, THREE.Group[]> = {};

  // Camera & Input
  public camYaw = Math.PI;
  public camPitch = 0.35;
  public camDist = 7.2;
  // optional fixed camera distance (close-ups / cinematics); null = automatic
  public camDistOverride: number | null = null;
  private shake = 0;
  private hitstop = 0;
  private spHit = false;
  private ptMult = 1;
  private lastHS = 0;
  private lastMove = new THREE.Vector3(0, 0, -1);
  private slowmoT = 0;
  private attackQueueT = 0;
  private slowmoScale = 1;
  private labels: { sprite: THREE.Sprite; t: number; life: number; vy: number }[] = [];
  private reticle!: THREE.Sprite;
  private reticleTarget = new THREE.Vector3();

  public input = {
    jx: 0,
    jy: 0,
    keys: {} as Record<string, boolean>,
    attackHeld: false,
    guardHeld: false
  };

  public lookTouch = { id: null as number | null, lx: 0, ly: 0 };
  public joyTouch = { id: null as number | null, ox: 0, oy: 0 };

  public state: 'menu' | 'play' | 'over' = 'menu';
  public paused = false;
  public loadout: number[] | null = null;
  public wave = 0;
  private waveTimer = 0;
  private clearedShown = false;
  // defending against arrows and stars: the weapon's path this frame and last, warnings, zoom pacing
  private cutPrev = makeSeg();
  private cutCur = makeSeg();
  private cutPrevOk = false;
  private cutActive = false;
  private cutV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private warnedShooters = new Set<EnemyInstance>();
  private lastThreatKey = '';
  private threatT = 0;
  private lastParryZoom = -99;
  // The cut-in on a defence worth seeing: the camera swings low to the side of the two fighters, the
  // blades hold where they met, a short slow-motion; the controls stay live and it never lasts long
  private parryScene: { t: number; dur: number; e: EnemyInstance; mid: THREE.Vector3; side: number; camOk: boolean; spark: number } | null = null;
  private lastParryScene = -99;
  private parrySide = 1;
  private parryFocus = new THREE.Vector3();
  // the weapon held where the blades met for a moment after a parry, and the fight camera's lean
  private clash: { mesh: THREE.Object3D; q: THREE.Quaternion; t: number } | null = null;
  private clashSeg = makeSeg();
  private clashObj = new THREE.Object3D();
  private clashQ = new THREE.Quaternion();
  private fightLead = new THREE.Vector3();
  private camExtra = 0;
  // enemies of the wave waiting to step in, and how many of each kind may be in the fight
  // Conquista mode (see outposts.ts): the field has enemy posts; walking up to one wakes its
  // garrison, whose captain you defeat to take it. Each post is a "wave" for scaling and Honra.
  public mode: 'waves' | 'conquest' = 'waves';
  private posts: Outpost[] = [];
  private postSolids: { x: number; z: number; r: number; h: number }[] = [];
  private conq = { round: 1, active: -1, taken: 0, hudT: 0, hudText: '', bossKills0: 0, routed: false, patrolT: PATROL_FIRST };
  private spawnOrigin: { x: number; z: number } | null = null;
  private garrison: Garrison = 'infantry';
  private waveQueue: { type: 'samurai' | 'archer'; variant?: EnemyVariant }[] = [];
  private waveCap: { melee: number; archer: number; fodder: number } | null = null;
  private reinforceT = 0;
  private prevActive = 0;

  // Run progression: level-up cards, Honra (meta currency) and the per-wave grade
  public metaBonus: MetaBonus = NO_BONUS;
  private cardLv: Record<string, number> = {};
  private cardOffer: string[] | null = null;
  private picksPending = 0;
  private pickDelay = 0;
  private heritageT = 0;
  private runOpen = false;
  private finishers = 0;
  private honor = { kill: 0, finish: 0, wave: 0, boss: 0, rank: 0, mod: 0 };
  private ranks: string[] = [];
  // wave modifiers, run stats behind the daily missions, and the Oni's shockwaves
  private waveMod: WaveMod | null = null;
  // the wave's goal when it is not "kill them all" (see mods.ts): its clock, the next
  // batch of reinforcements, the captain to hunt, and the Honra it pays
  private goal: { id: GoalId; name: string; glyph: string; honor: number; t: number; dur: number; next: number; shown: number; done: boolean; captain?: EnemyInstance } | null = null;
  private prevGoal: GoalId | null = null;
  private seenVariants = new Set<EnemyVariant>();
  private fighterTurn = 0;
  private prevMod: WaveMod['id'] | null = null;
  private enemyTime = 1;
  private deflectsTotal = 0;
  private flawless = 0;
  private bossKills = 0;
  private modWaves = 0;
  private bestRank = 0;
  private bolts: { x: number; z: number; t: number; ring: THREE.Mesh; pillar: THREE.Mesh; struck: boolean; visual?: boolean }[] = [];
  private shocks: { x: number; z: number; r: number; mesh: THREE.Mesh; hit: boolean }[] = [];
  private waveStat = { t0: 0, enemies: 0, queued: 0, finishers: 0, deflects: 0 };
  private lastBossKey = -1;
  private lastHardDef = -99;
  private timers: { at: number; fn: () => void }[] = [];
  private time = 0;
  private clock = new THREE.Clock();
  private reqId: number | null = null;
  private isRunning = false;

  private tmpV = new THREE.Vector3();
  private decals!: InkDecals;
  private dust!: DustPool;
  private ghosts!: Afterimages;
  private ghostT = 0;
  private stepIdx = 0;
  private dustCol = new THREE.Color();
  private bufSize = new THREE.Vector2();
  private tmpH = new THREE.Vector3();
  private trailA = new THREE.Vector3();
  private trailB = new THREE.Vector3();

  // Rendering quality & post-processing
  private fx: PostFX | null = null;
  public qualitySetting: QualitySetting = 'auto';
  public atmosMode: AtmosMode = 'two';
  /** scenery theme: a new one every 3 waves, or always the first */
  public themeMode: ThemeMode = 'three';
  // ?theme=N pins one theme for every wave (to look at them one by one)
  private themeForce: number | null = null;
  /** ?wave=N starts a practice run at wave N (to see the Oni or a theme right away): nothing is saved */
  public practice = false;
  private profile: QualityProfile = qualityProfile('high');
  private sunUv = new THREE.Vector2();
  public quality: Quality = 'high';
  private fpsAcc = 0;
  private fpsFrames = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private resScale = 1;
  private hurtFx = 0;
  private landFx = 0;
  private trail!: BladeTrail;
  private impacts!: ImpactPool;
  private camTarget = new THREE.Vector3(0, 1.6, 5);
  private camLead = new THREE.Vector3();
  private fovKick = 0;
  private baseFov = 60;
  private prevYaw = Math.PI;
  private desatFx = 0;
  // deathblow cinematic in progress: `t` runs on game time up to the strike, `after` on
  // real time since it; `side`/`dist` fix the shot's angle and distance when it starts
  private cine: {
    t: number;
    after: number;
    e: EnemyInstance;
    struck: boolean;
    full: boolean;
    boss: boolean;
    side: number;
    dist: number;
    hitAt: number; // game-seconds from the start to the blow (set by the finisher)
    style: Finisher['style'];
    boom: boolean;
  } | null = null;
  // finisher chosen last for each weapon (so it never repeats back to back); dev hook to force one
  private lastFinisher: Record<string, number> = {};
  public forceFinisher: number | null = null;
  private cineSide = Math.random() < 0.5 ? 1 : -1;
  private lastDeathblowAt = -99;
  private cineW = 0;
  private cineFocus = new THREE.Vector3();
  private cineRange = 3;
  private flashFx = 0;
  private spikeFx = 0;
  private punchT = 1;
  private punchDur = 0.6;
  private fxUv = new THREE.Vector2();
  private fxFwd = new THREE.Vector3();
  // Mocap rig only: the move/reaction currently playing (see startAct), a buffered
  // attack press waiting for its combo window, and the death animation's countdown to
  // the game-over screen
  private act: PlayerAct | null = null;
  private actQueued = false;
  private healBufT = 0;
  private deadT = -1;
  private rootTmp = new THREE.Vector2();
  private bladePrev = makeSeg();
  private bladeCur = makeSeg();
  private enemyBladeCurL = makeSeg();
  private bladePrevOk = false;
  private bladeRadius = 0.06;
  private hitPt = new THREE.Vector3();
  private comboTarget: EnemyInstance | null = null;
  private dbg!: DebugDraw;
  private dbgHits: { p: THREE.Vector3; t: number }[] = [];
  private enemyBlades: BladeSeg[] = [];
  private gourd: THREE.Group | null = null;

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement, callbacks: GameEngineCallbacks) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.mmCtx = minimapCanvas.getContext('2d')!;
    this.callbacks = callbacks;

    this.initThree();
    this.initWorld();
    this.initPlayer();
    this.initSlashEffects();
    this.dbg = new DebugDraw(this.scene);
    // dev-only handle for automated visual checks (stripped from production builds)
    if (import.meta.env.DEV) (window as unknown as { __tune: typeof TUNE }).__tune = TUNE;
    this.setQuality(this.qualitySetting);
    // start fetching the imported models while the menu is up
    void preloadModels();

    this.isRunning = true;
    this.clock.start();
    this.loop();
  }

  private initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 420);
    this.baseFov = this.camera.aspect < 1 ? 72 : 60;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();

    // General Particle Buffer
    for (let i = 0; i < this.PN; i++) this.pPos[i * 3 + 1] = -999;
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const points = new THREE.Points(
      this.pGeo,
      new THREE.PointsMaterial({
        size: 0.3,
        map: softDotTexture(),
        color: new THREE.Color(2.2, 2.2, 2.2),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    points.frustumCulled = false;
    this.scene.add(points);

    // Procedural Smooth Droplet Texture for Blood
    const bloodCanvas = document.createElement('canvas');
    bloodCanvas.width = 32;
    bloodCanvas.height = 32;
    const bCtx = bloodCanvas.getContext('2d');
    if (bCtx) {
      const grad = bCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.45)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      bCtx.fillStyle = grad;
      bCtx.fillRect(0, 0, 32, 32);
    }
    const bloodTex = new THREE.CanvasTexture(bloodCanvas);

    // Dedicated Blood Particles Buffer
    for (let i = 0; i < this.BLOOD_PN; i++) this.bPos[i * 3 + 1] = -999;
    this.bGeo.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    this.bGeo.setAttribute('color', new THREE.BufferAttribute(this.bCol, 3));
    this.bloodPoints = new THREE.Points(
      this.bGeo,
      new THREE.PointsMaterial({
        size: 0.32,
        map: bloodTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
      })
    );
    this.bloodPoints.frustumCulled = false;
    this.scene.add(this.bloodPoints);
  }

  private initWorld() {
    this.world = new World(this.renderer, this.scene);
    this.sun = this.world.sun;
    this.solids = this.world.solids;
    // scenery that answers a blow: dust, a spark flash and camera shake come from here
    this.world.props.fx = {
      dust: (x, z, n, spd, dx = 0, dz = 0) => this.puff(x, z, n, spd, dx, dz),
      flash: (x, y, z, size) => this.impacts.spawn(this.tmpV.set(x, y, z), IMPACT_NORMAL, size, 0.1),
      shake: (a) => {
        this.shake = Math.max(this.shake, a);
      }
    };
  }

  private initPlayer() {
    this.player.rig = buildCharacter('ninja');
    this.scene.add(this.player.rig.root);

    this.weapons = WEAPONS_KAGE;
    this.player.weaponMeshes = [];
    this.weapons.forEach((w) => {
      const m = makeWeapon(w.id);
      m.visible = false;
      this.player.rig.hand.add(m);
      this.player.weaponMeshes.push(m);
    });
    this.attachGourd();
    this.setWeapon(0);
  }

  private initSlashEffects() {
    this.trail = new BladeTrail(this.scene);
    this.impacts = new ImpactPool(this.scene);
    this.decals = new InkDecals(this.scene);
    this.dust = new DustPool(this.scene);
    this.rebuildGhosts(null);

    this.slashGeos = {
      katana: new THREE.RingGeometry(1.1, 2.9, 24, 1, -Math.PI / 2 - 1.05, 2.1).rotateX(-Math.PI / 2),
      bo: new THREE.RingGeometry(1.6, 3.5, 40).rotateX(-Math.PI / 2),
      kick: new THREE.RingGeometry(0.9, 2.8, 24, 1, -Math.PI / 2 - 1.5, 3.0).rotateX(-Math.PI / 2)
    };

    const slashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff0d8).multiplyScalar(1.8),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.slash = new THREE.Mesh(this.slashGeos.katana, slashMat);
    this.slash.visible = false;
    this.scene.add(this.slash);
    this.buildReticle();

    this.chainLink = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.9, emissive: 0x2a2c30 })
    );
    this.chainTip = mesh(new THREE.BoxGeometry(0.03, 0.34, 0.08), MAT.metal);
    this.chainTip.scale.setScalar(1.6);
    this.chain.add(this.chainLink, this.chainTip);
    this.chain.visible = false;
    this.scene.add(this.chain);
  }

  // Building the ninja is synchronous (procedural geometry); loading the samurai means
  // awaiting its GLB (plus the weapon models). Either way the old rig stays on screen,
  // live and rendering, until the new one is fully ready - the swap below is the only
  // place this.player.rig changes, so the render loop never sees it null or half-built.
  public async setCharacter(id: CharacterId): Promise<void> {
    if (this.state === 'play') return;
    const reqId = ++this.charReqId;

    let rig: RigInstance;
    let resolvedId = id;
    try {
      if (id === 'samurai') {
        const [tpl] = await Promise.all([loadCharacter('ronin'), loadWeapons()]);
        rig = createClipRig(tpl);
      } else {
        rig = buildCharacter('ninja');
      }
    } catch (e) {
      console.error('setCharacter: failed to load', id, e);
      resolvedId = 'kage';
      rig = buildCharacter('ninja');
    }

    // A newer selection (or a Play press) already landed while this one was loading -
    // its result is stale, drop it instead of clobbering whatever is live now.
    if (reqId !== this.charReqId) {
      rig.dispose?.();
      return;
    }
    this.charId = resolvedId;

    this.scene.remove(this.player.rig.root);
    this.player.rig.dispose?.();
    this.player.rig = rig;
    this.scene.add(this.player.rig.root);
    this.act = null;
    this.equipWeapons();
    this.rebuildGhosts(rig.clip ? characterIfReady('ronin') : null);
  }

  // One mesh per weapon slot, only the active one visible. On the mocap rig the
  // throwables sit in the off hand - the spell-cast clip used for throwing snaps the left
  // arm forward.
  private equipWeapons() {
    for (const m of this.player.weaponMeshes) m.removeFromParent();
    this.weapons = WEAPONS_KAGE;
    this.player.weaponMeshes = [];
    const rig = this.player.rig;
    this.weapons.forEach((w) => {
      const m = makeWeapon(w.id);
      m.visible = false;
      const offHand = !!rig.clip && (w.kind === 'proj' || w.kind === 'bomb');
      (offHand ? rig.handL : rig.hand).add(m);
      this.player.weaponMeshes.push(m);
    });
    this.attachGourd();
    this.setWeapon(0);
  }

  // Dash afterimages copy the player's pose bone-by-bone, so they need the same skeleton
  private rebuildGhosts(tpl: CharacterTemplate | null) {
    this.ghosts?.dispose();
    this.ghosts = new Afterimages(this.scene, () => {
      const r = tpl ? createClipRig(tpl, { lod: true }) : buildCharacter('ninja');
      r.dispose?.();
      return r.root;
    });
  }

  private attachGourd() {
    this.gourd?.removeFromParent();
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xc89a4a, roughness: 0.55 });
    const cord = new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.8 });
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), body);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), body);
    b.position.y = 0.12;
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12), cord);
    c.position.y = 0.065;
    c.rotation.x = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.05, 8), cord);
    cap.position.y = 0.19;
    g.add(a, b, c, cap);
    g.position.set(0, -0.02, 0.06);
    g.visible = false;
    this.player.rig.handL.add(g);
    this.gourd = g;
  }

  public setWeapon(idx: number) {
    if (idx < 0 || idx >= this.weapons.length) return;
    const changed = idx !== this.activeWeaponIdx;
    this.activeWeaponIdx = idx;
    this.player.weaponMeshes.forEach((m, k) => {
      m.visible = k === idx;
    });
    this.callbacks.onWeaponChange(idx, this.weapons[idx]);
    // standing still, a swap reads as drawing the new weapon (any input cancels it)
    if (changed && this.state === 'play' && this.player.rig.clip && !this.act && this.player.grounded && this.player.moveAmt < 0.25) {
      this.startAct('draw', 'draw', { from: 0.25, cancel: 0, end: 0.83 });
    }
  }

  public recenterCamera() {
    // Alinha a câmera diretamente atrás do personagem com suavidade
    this.camYaw = wrap(this.player.yaw - Math.PI);
    this.camPitch = 0.35;
  }

  public start() {
    this.reset();
    const first = this.atmosMode === 'random' ? Math.floor(Math.random() * ATMOSPHERES.length) : 0;
    if (first !== this.world.atmIndex) this.world.setAtmosphere(first, true);
    const pin = parseInt(new URLSearchParams(location.search).get('theme') ?? '', 10);
    this.themeForce = Number.isFinite(pin) ? Math.min(THEMES.length - 1, Math.max(0, pin)) : null;
    this.world.setTheme(this.themeForce ?? 0, true);
    // the new fighters load in the background while the first waves are fought
    LAZY_CHARACTERS.forEach((id) => void loadCharacter(id).catch(() => undefined));
    void loadLazyWeapons();
    this.paused = false;
    this.state = 'play';
    this.runOpen = true;
    this.heritageT = this.metaBonus.startSpecial > 0 ? 6 : 0;
    const from = parseInt(new URLSearchParams(location.search).get('wave') ?? '', 10);
    this.practice = Number.isFinite(from) && from > 1;
    if (this.practice) {
      // a practice run opens straight on a late wave: give the fighters' models (fetched in
      // the background) a few seconds to arrive so that wave can show them
      const go = () => {
        if (this.state !== 'play' || this.wave !== 0) return;
        this.wave = Math.min(40, from) - 1;
        this.nextWave();
      };
      Promise.race([Promise.allSettled([...LAZY_CHARACTERS.map(loadCharacter), loadLazyWeapons()]), new Promise((r) => setTimeout(r, 8000))]).then(go);
    } else if (this.mode === 'conquest') this.setupConquest();
    else this.nextWave();
    if (!this.isRunning) {
      this.isRunning = true;
      this.clock.start();
      this.loop();
    }
  }

  public backToMenu() {
    this.reset();
    this.state = 'menu';
  }

  public reset() {
    this.enemies.forEach((e) => this.removeEnemy(e));
    this.enemies = [];
    while (this.projectiles.length) this.killProj(this.projectiles.length - 1);
    this.pickups.forEach((p) => this.scene.remove(p.m));
    this.pickups = [];
    while (this.scrolls.length) this.removeScroll(this.scrolls.length - 1);

    this.rings.forEach((r) => {
      this.scene.remove(r.m);
      (r.m.material as THREE.Material).dispose();
    });
    this.rings = [];
    for (let i = 0; i < this.BLOOD_PN; i++) this.bPos[i * 3 + 1] = -999;
    this.bGeo.attributes.position.needsUpdate = true;
    this.decals.clear();
    this.dust.clear();
    this.ghosts.clear();

    this.world.props.reset();
    this.endClash();
    this.clearConquest();
    this.cardLv = {};
    this.cardOffer = null;
    this.picksPending = 0;
    this.pickDelay = 0;
    this.heritageT = 0;
    this.finishers = 0;
    this.honor = { kill: 0, finish: 0, wave: 0, boss: 0, rank: 0, mod: 0 };
    this.ranks = [];
    this.lastBossKey = -1;
    this.timers = [];
    this.waveMod = null;
    this.prevMod = null;
    this.goal = null;
    this.prevGoal = null;
    this.seenVariants.clear();
    this.fighterTurn = 0;
    this.enemyTime = 1;
    this.world.fogScale = 1;
    this.deflectsTotal = 0;
    this.flawless = 0;
    this.bossKills = 0;
    this.modWaves = 0;
    this.bestRank = 0;
    for (const sh of this.shocks) this.disposeShock(sh);
    this.shocks = [];
    for (const b of this.bolts) this.disposeBolt(b);
    this.bolts = [];
    this.callbacks.onWaveMod?.(null);
    this.callbacks.onCardOffer?.(null);
    this.callbacks.onHonorChange?.(0);
    this.callbacks.onBossChange?.(null);
    const mb = this.metaBonus;
    this.player.maxHp = 60 + mb.hp;
    this.player.hp = this.player.maxHp;
    this.player.maxSt = 100 + mb.st;
    this.player.st = this.player.maxSt;
    this.player.score = 0;
    this.player.level = 1;
    this.player.xp = 0;
    this.player.xpNext = 800;
    this.player.dmgMult = 1 + mb.dmg;
    this.player.killCombo = 0;
    this.player.killComboT = 0;
    this.player.hitCombo = 0;
    this.player.hitComboT = 0;
    this.player.bestCombo = 0;
    this.player.kills = 0;
    this.player.special = {};
    this.player.tornado = 0;
    this.player.rush = null;
    this.player.dash = 0;
    this.player.dashInv = false;
    this.player.posture = 0;
    this.player.postureT = 0;
    this.player.staggerT = 0;
    this.player.guardPressT = -99;
    this.player.lastPostureSent = -1;
    this.player.heals = this.healsPerWave();
    this.player.healT = 0;
    this.healBufT = 0;
    this.player.dbReady = false;
    this.callbacks.onHealsChange?.(this.player.heals);
    this.callbacks.onDeathblowReady?.(false);
    this.cine = null;
    this.cineW = 0;
    this.flashFx = 0;
    this.spikeFx = 0;
    this.punchT = 1;
    this.parryScene = null;
    this.callbacks.onCinematic?.(false);
    this.act = null;
    this.actQueued = false;
    this.deadT = -1;
    this.player.rig.clip?.stop(0);
    this.attackQueueT = 0;
    this.input.attackHeld = false;
    this.input.guardHeld = false;
    this.killsSinceScroll = 0;
    this.scrollsGiven = {};
    this.player.pos.set(0, 0, 5);
    this.player.vel.set(0, 0, 0);
    this.player.kb.set(0, 0, 0);
    this.player.yaw = Math.PI;

    this.camYaw = 0;
    this.camPitch = 0.42;
    this.wave = 0;
    this.waveTimer = 0;

    this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
    this.callbacks.onXpChange(this.player.xp, this.player.xpNext, this.player.level);
    this.callbacks.onScoreChange(0);
    this.callbacks.onComboChange(0);
    this.callbacks.onSpecialsUpdate({});
    this.setWeapon(this.loadout?.[0] ?? 0);
  }

  public nextWave() {
    this.wave++;
    this.player.heals = this.healsPerWave();
    this.callbacks.onHealsChange?.(this.player.heals);
    this.clearedShown = false;
    this.player.tookDamage = false;

    const boss = this.wave % 4 === 0;
    // a post of the Conquista mode: the captain's goal on every ordinary one, no wave challenges
    const conq = this.mode === 'conquest' && this.conq.active >= 0;
    const mod = conq ? null : pickWaveMod(this.wave, this.prevMod);
    this.waveMod = mod;
    if (mod) this.prevMod = mod.id;
    const goalDef = conq ? (boss ? null : WAVE_GOALS.find((g) => g.id === 'capitao')!) : !boss && !mod ? pickWaveGoal(this.wave, this.prevGoal) : null;
    if (goalDef && !conq) this.prevGoal = goalDef.id;
    let nS = Math.min(9, 2 + this.wave);
    let nA = Math.min(4, Math.floor(this.wave / 2));
    if (goalDef?.id === 'duelo') {
      nS = 1;
      nA = 0;
    } else if (goalDef?.id === 'resistir') {
      nS = 3;
      nA = this.wave >= 5 ? 1 : 0;
    } else if (goalDef?.id === 'capitao') {
      nS = Math.min(7, 3 + Math.floor(this.wave / 2));
      nA = Math.min(3, Math.floor(this.wave / 3));
    }
    if (conq && !boss) {
      // each post has its own kind of garrison
      if (this.garrison === 'infantry') nA = Math.min(nA, 1);
      else if (this.garrison === 'archers') {
        nA = Math.min(5, nA + 2);
        nS = Math.max(2, nS - 2);
      } else nS = Math.max(2, nS - 1);
    }
    if (mod?.id === 'flechas') {
      nA = Math.min(7, nA + 3);
      nS = Math.max(1, Math.ceil(nS * 0.5));
    }
    this.enemyTime = mod?.id === 'ventania' ? 1.22 : 1;
    this.world.fogScale = mod?.id === 'nevoa' ? 0.35 : 1;
    // fog wave: they come out of the mist close by
    const near = mod?.id === 'nevoa' || goalDef?.id === 'duelo';

    // samurai with their own way of fighting take the place of some plain ones (not on
    // boss waves or goal waves, which are busy enough)
    let nBrute = 0;
    let nMonk = 0;
    if (!boss && (!goalDef || conq)) {
      if (this.wave >= 3) nBrute = Math.min(2, 1 + Math.floor((this.wave - 3) / 5), Math.max(0, nS - 2));
      if (this.wave >= 3) nMonk = Math.min(3, Math.floor(this.wave / 3), Math.max(0, nS - nBrute - 1));
    }
    // the named fighters (see roster below) join from wave 4: one a wave, two from wave 9,
    // taking turns so the same one doesn't come twice running
    const fighters: EnemyVariant[] = [];
    if (!boss && (!goalDef || conq) && this.wave >= 4) {
      const pool = FIGHTER_ORDER.filter((v) => this.wave >= FIGHTER_MIN[v]! && this.fighterReady(v));
      for (let k = 0; k < (this.wave >= 9 || (conq && this.garrison === 'elite') ? 2 : 1) && pool.length; k++) {
        fighters.push(pool.splice(this.fighterTurn++ % pool.length, 1)[0]);
        if (nS - nBrute - nMonk - fighters.length < 1) fighters.pop();
      }
    }
    // a duel is fought against one of them once they are around
    let duelist: EnemyVariant | undefined;
    if (goalDef?.id === 'duelo' && this.wave >= 4) {
      const pool = FIGHTER_ORDER.filter((v) => this.wave >= FIGHTER_MIN[v]! && this.fighterReady(v));
      if (pool.length) duelist = pool[this.fighterTurn++ % pool.length];
    }
    const list: { type: 'samurai' | 'archer' | 'boss'; variant?: EnemyVariant }[] = [];
    for (let i = 0; i < nS - nBrute - nMonk - fighters.length; i++) list.push({ type: 'samurai', variant: duelist });
    for (let i = 0; i < nBrute; i++) list.push({ type: 'samurai', variant: 'brute' });
    for (let i = 0; i < nMonk; i++) list.push({ type: 'samurai', variant: this.fighterReady('monk') ? 'monk' : undefined });
    for (const v of fighters) list.push({ type: 'samurai', variant: v });
    for (let i = 0; i < nA; i++) list.push({ type: 'archer' });
    // a post's foot soldiers: plenty, each worth little (the garrison of infantry has the most)
    if (conq) {
      const nAshi = Math.round(Math.min(10, 3 + this.conq.round * 2) * (boss ? 0.5 : this.garrison === 'infantry' ? 1 : 0.6));
      for (let i = 0; i < nAshi; i++) list.push({ type: 'samurai', variant: 'ashigaru' });
    }
    if (boss) list.push({ type: 'boss', variant: bossFormFor(this.wave) });

    // only so many at a time: a mix goes in now (a plain face or two, one of the special ones, an
    // archer) and the rest steps in as the fight thins out
    const cap = this.capsFor(boss, goalDef?.id, mod?.id);
    this.waveCap = cap;
    this.waveQueue = [];
    let now = list;
    if (cap) {
      const plain = list.filter((it) => it.type === 'samurai' && !it.variant);
      const special = list.filter((it) => it.type === 'samurai' && it.variant && !isFodder(it));
      const fodder = list.filter((it) => isFodder(it));
      const archers = list.filter((it) => it.type === 'archer');
      const first: typeof list = list.filter((it) => it.type === 'boss');
      const sp = special.shift();
      if (sp) first.push(sp);
      const meleeIn = () => first.filter((it) => it.type === 'samurai').length;
      while (meleeIn() < cap.melee && plain.length) first.push(plain.shift()!);
      while (meleeIn() < cap.melee && special.length) first.push(special.shift()!);
      while (first.filter((it) => it.type === 'archer').length < cap.archer && archers.length) first.push(archers.shift()!);
      while (first.filter((it) => isFodder(it)).length < cap.fodder && fodder.length) first.push(fodder.shift()!);
      // the rest, plain and special faces alternating, a couple of foot soldiers after each
      const rest: typeof list = [];
      const melee: typeof list = [];
      while (plain.length || special.length) {
        if (special.length) melee.push(special.shift()!);
        if (plain.length) melee.push(plain.shift()!);
      }
      for (const m of melee) {
        rest.push(m);
        for (let k = 0; k < 2 && fodder.length; k++) rest.push(fodder.shift()!);
      }
      rest.push(...fodder, ...archers);
      now = first;
      this.waveQueue = rest.filter((it): it is { type: 'samurai' | 'archer'; variant?: EnemyVariant } => it.type !== 'boss');
    }
    this.reinforceT = REINFORCE_GAP;
    this.prevActive = now.filter((it) => it.type !== 'boss').length;
    const spawned: EnemyInstance[] = [];
    now.forEach((it) => {
      const e = this.spawnOrigin ? this.spawnAtPost(it.type, it.variant) : this.spawnRing(it.type, near, it.variant);
      if (e) spawned.push(e);
    });
    for (const e of spawned) if (e.type === 'boss' && e.variant) e.aura = this.makeAura(BOSS_COLOR[e.variant], 3.0);
    this.goal = null;
    if (goalDef) {
      let captain: EnemyInstance | undefined;
      if (goalDef.id === 'duelo' && spawned[0]) this.makeDuelist(spawned[0]);
      if (goalDef.id === 'capitao') {
        captain = this.pickCaptain(spawned);
        if (captain) this.makeCaptain(captain);
      }
      const dur = goalDef.id === 'resistir' ? 28 + Math.min(14, this.wave * 1.2) : 0;
      this.goal = { id: goalDef.id, name: goalDef.name, glyph: goalDef.glyph, honor: goalDef.honor, t: 0, dur, next: 6, shown: -1, done: false, captain };
    }
    // practice with &fury=1: the Oni comes in at half life, so its Fury (shockwaves) starts at once
    if (this.practice && boss && new URLSearchParams(location.search).get('fury') === '1') for (const e of spawned) if (e.type === 'boss') e.hp = e.maxHp * 0.5;
    if (mod?.id === 'ferro') for (const e of spawned) e.maxPosture *= 1.6;
    if (mod?.id === 'elite') {
      const pool = spawned.filter((e) => e.type === 'samurai' && !e.variant);
      for (let n = 1 + Math.floor(this.wave / 6); n > 0 && pool.length; n--) this.makeElite(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }

    this.waveStat = { t0: this.time, enemies: list.filter((it) => !isFodder(it)).length, queued: this.waveQueue.filter((it) => !isFodder(it)).length, finishers: 0, deflects: 0 };
    let sub = boss ? BOSS_HINT[bossFormFor(this.wave) ?? 'oni'] : mod ? mod.desc : goalDef ? (duelist ? `Duelo contra ${FIGHTER_NAME[duelist]}` : goalDef.desc) : `${nS} samurais${nA ? ` e ${nA} arqueiros` : ''}`;
    const atmIdx = atmosphereForWave(this.wave, this.atmosMode, this.world.atmIndex);
    if (atmIdx !== this.world.atmIndex) {
      this.world.setAtmosphere(atmIdx);
      sub += ` · ${ATMOSPHERES[atmIdx].name}`;
    }
    const themeIdx = this.themeForce ?? themeForWave(this.wave, this.themeMode);
    if (themeIdx !== this.world.themeIndex) {
      this.world.setTheme(themeIdx);
      sub += ` · ${THEMES[themeIdx].glyph} ${THEMES[themeIdx].name}`;
    }
    // the first time a new kind of samurai shows up, a hint on how to beat it
    let hintAt = 2.3;
    for (const v of ['brute', 'monk', 'nito', 'shinobi', 'raio'] as EnemyVariant[]) {
      if (spawned.some((e) => e.variant === v) && this.hintVariant(v, hintAt)) hintAt += 2.3;
    }
    this.callbacks.onWaveMod?.(mod ? { id: mod.id, name: mod.name, glyph: mod.glyph, desc: mod.desc } : goalDef ? { id: goalDef.id, name: goalDef.name, glyph: goalDef.glyph, desc: goalDef.desc } : null);
    const label = conq ? `Posto ${this.wave}` : `Onda ${this.wave}`;
    if (conq) sub = `${GARRISON_NAME[this.garrison][0].toUpperCase()}${GARRISON_NAME[this.garrison].slice(1)} · ${boss ? sub : goalDef ? goalDef.desc : sub}`;
    this.callbacks.onWaveChange(this.wave, mod ? `${label} · ${mod.name}` : goalDef ? `${label} · ${goalDef.name}` : label, sub);
    sfx.wave();
  }

  // The first time a kind of samurai shows up, a hint on how to beat it (true if one was shown)
  private hintVariant(v: EnemyVariant, delay: number): boolean {
    const h = HINTS[v];
    if (!h || this.seenVariants.has(v)) return false;
    this.seenVariants.add(v);
    const wv = this.wave;
    this.timers.push({ at: this.time + delay, fn: () => this.state === 'play' && this.wave === wv && this.callbacks.onWaveChange(wv, h[0], h[1]) });
    return true;
  }

  // How many may be in the fight at once. Duels and Resistir (which streams its own
  // reinforcements) are left alone; the Oni's escorts are fewer, the captain's band one more.
  private capsFor(boss: boolean, goalId?: string, modId?: string): { melee: number; archer: number; fodder: number } | null {
    if (goalId === 'duelo' || goalId === 'resistir') return null;
    const w = this.wave;
    let melee = w <= 2 ? 2 : w <= 5 ? 3 : 4;
    let archer = w <= 5 ? 1 : 2;
    let fodder = w <= 3 ? 4 : 6;
    if (boss) {
      melee = Math.max(2, melee - 1);
      archer = 1;
      fodder = 4;
    }
    if (goalId === 'capitao') melee += 1;
    if (modId === 'flechas') archer = 4;
    return { melee, archer, fodder };
  }

  // A new face steps in from ahead of the camera (so it is seen coming, not met in the back),
  // else from anywhere on the ring
  private spawnAhead(type: 'samurai' | 'archer', variant?: EnemyVariant): EnemyInstance | null {
    const pt = this.aheadPoint();
    return pt ? this.spawnEnemy(type, pt.x, pt.z, variant) : this.spawnRing(type, true, variant);
  }

  // An open spot 15-23 m away in the half of the field the camera looks at
  private aheadPoint(): { x: number; z: number } | null {
    const P = this.player.pos;
    const fa = Math.atan2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
    for (let k = 0; k < 24; k++) {
      const a = fa + rand(-1.25, 1.25);
      const r = rand(15, 23);
      const x = P.x + Math.sin(a) * r;
      const z = P.z + Math.cos(a) * r;
      if (Math.hypot(x, z) > 35) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.8)) continue;
      return { x, z };
    }
    return null;
  }

  // Which of the waiting ones steps in: one whose kind isn't already in the fight, if the
  // numbers allow it (-1: no room yet)
  private pickQueued(melee: number, archers: number, fodder: number): number {
    const cap = this.waveCap;
    if (!cap) return -1;
    const live = new Set<string>();
    for (const e of this.enemies) if (!e.dead && e.type === 'samurai' && !isFodder(e)) live.add(e.variant ?? 'plain');
    let first = -1;
    for (let i = 0; i < this.waveQueue.length; i++) {
      const it = this.waveQueue[i];
      if (isFodder(it)) {
        if (fodder >= cap.fodder) continue;
        if (first < 0) first = i;
        continue;
      }
      if (it.type === 'samurai' ? melee >= cap.melee : archers >= cap.archer) continue;
      if (first < 0) first = i;
      if (it.type === 'archer' || !live.has(it.variant ?? 'plain')) return i;
    }
    return first;
  }

  private stepReinforcements(dt: number) {
    if (!this.waveQueue.length) return;
    let melee = 0;
    let archers = 0;
    let fodder = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (isFodder(e)) fodder++;
      else if (e.type === 'samurai') melee++;
      else if (e.type === 'archer') archers++;
    }
    const act = melee + archers + fodder;
    const idx = this.pickQueued(melee, archers, fodder);
    // a foot soldier steps in almost at once; a face of note takes its moment
    if (act < this.prevActive) this.reinforceT = Math.max(this.reinforceT, idx >= 0 && isFodder(this.waveQueue[idx]) ? 0.5 : REINFORCE_GAP);
    this.prevActive = act;
    this.reinforceT -= dt;
    if (this.reinforceT > 0) return;
    if (idx < 0) return;
    const [it] = this.waveQueue.splice(idx, 1);
    const e = this.spawnOrigin ? this.spawnAtPost(it.type, it.variant) : this.spawnAhead(it.type, it.variant);
    if (!e) {
      this.waveQueue.unshift(it);
      return;
    }
    if (this.waveMod?.id === 'ferro') e.maxPosture *= 1.6;
    if (it.variant) this.hintVariant(it.variant, 0.6);
    this.prevActive = act + 1;
    this.reinforceT = isFodder(it) ? 0.25 : REINFORCE_SPACING;
  }

  // ---------------------------------------------------------------------------
  // Conquista: enemy posts across the field, each with a garrison and a captain
  // ---------------------------------------------------------------------------
  private setupConquest() {
    this.clearConquest();
    const spots = pickPostSpots((x, z, pad) => this.world.isFree(x, z, pad), 3);
    for (const sp of spots) {
      const post = new Outpost(sp.x, sp.z);
      this.scene.add(post.group);
      for (const so of post.solids) {
        this.solids.push(so);
        this.postSolids.push(so);
      }
      this.posts.push(post);
    }
    this.conq = { round: 1, active: -1, taken: 0, hudT: 0, hudText: '', bossKills0: 0, routed: false, patrolT: PATROL_FIRST };
    this.wave = 0;
    this.callbacks.onWaveChange(0, 'Conquista', `Tome os ${this.posts.length} postos inimigos: derrote o capitão de cada um`);
    this.updateConquestHud(0, true);
  }

  private clearConquest() {
    for (const p of this.posts) p.dispose();
    this.posts = [];
    if (this.postSolids.length) {
      const drop = new Set(this.postSolids);
      for (let i = this.solids.length - 1; i >= 0; i--) if (drop.has(this.solids[i])) this.solids.splice(i, 1);
      this.postSolids = [];
    }
    this.spawnOrigin = null;
    this.conq = { round: 1, active: -1, taken: 0, hudT: 0, hudText: '', bossKills0: 0, routed: false, patrolT: PATROL_FIRST };
  }

  private stepConquest(dt: number) {
    for (const p of this.posts) p.update(this.time);
    const c = this.conq;
    if (c.active >= 0) {
      // the Oni leads its post like a captain: when it falls the escort breaks and runs
      if (!this.goal && !c.routed && this.bossKills > c.bossKills0) {
        c.routed = true;
        this.waveQueue = [];
        this.routEnemies();
      }
      return;
    }
    const P = this.player.pos;
    for (let i = 0; i < this.posts.length; i++) {
      const p = this.posts[i];
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d > POST_ACTIVATE + 8) p.armed = true;
      if (!p.captured && p.armed && d < POST_ACTIVATE) {
        this.startOutpost(i);
        return;
      }
    }
    this.stepPatrols(dt);
    this.updateConquestHud(dt);
  }

  // The objective pill: how many posts are taken and which way the nearest one lies
  private updateConquestHud(dt: number, force = false) {
    const c = this.conq;
    c.hudT -= dt;
    if (c.hudT > 0 && !force) return;
    c.hudT = 0.3;
    const P = this.player.pos;
    let best: Outpost | null = null;
    let bd = Infinity;
    for (const p of this.posts) {
      if (p.captured) continue;
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    const dx = best.x - P.x;
    const dz = best.z - P.z;
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const arrow = ARROWS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    const text = `Conquista ${c.taken}/${this.posts.length} · ${arrow} ${Math.round(bd / 2) * 2} m`;
    if (text === c.hudText) return;
    c.hudText = text;
    this.callbacks.onWaveMod?.({ id: 'conquista', name: text, glyph: '旗', desc: 'Vá até um posto inimigo e derrote o capitão da guarnição' });
  }

  private startOutpost(i: number) {
    const p = this.posts[i];
    this.conq.active = i;
    this.conq.routed = false;
    this.conq.bossKills0 = this.bossKills;
    // a patrol still on the road breaks off: the post is the fight now
    this.routEnemies((e) => !!e.patrol);
    this.spawnOrigin = { x: p.x, z: p.z };
    this.garrison = GARRISONS[i % GARRISONS.length];
    this.nextWave();
    this.spawnLabel(p.x, 3.6, p.z, 'POSTO INIMIGO!', '#ff8a7a', 1.5);
  }

  private captureOutpost() {
    const c = this.conq;
    const p = this.posts[c.active];
    c.active = -1;
    this.spawnOrigin = null;
    this.waveQueue = [];
    c.taken++;
    if (p) {
      p.setCaptured(true);
      this.emitParticles(p.x, 1.5, p.z, 44, 0x4fd6a8, 6, 3, -1, 1.2);
      this.spawnLabel(p.x, 3.6, p.z, 'POSTO TOMADO!', '#8fe0c8', 1.6);
    }
    // the taken post pays in life and Honra
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(this.player.maxHp * 0.3));
    this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
    this.addHonor('mod', 8);
    sfx.wave();
    if (c.taken >= this.posts.length) {
      c.round++;
      c.taken = 0;
      this.posts.forEach((q) => {
        q.setCaptured(false);
        q.armed = false;
      });
      this.callbacks.onWaveChange(this.wave, `Território conquistado · Rodada ${c.round}`, 'Reforços retomam os postos: tome todos de novo, mais fortes');
    } else {
      this.callbacks.onWaveChange(this.wave, `Posto tomado · ${c.taken}/${this.posts.length}`, 'Siga para o próximo posto');
    }
    this.updateConquestHud(0, true);
  }

  // The garrison forms up inside the post's ring
  private spawnAtPost(type: 'samurai' | 'archer' | 'boss', variant?: EnemyVariant): EnemyInstance | null {
    const o = this.spawnOrigin;
    if (!o) return null;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * TAU;
      const r = type === 'boss' ? rand(1.5, 3.5) : rand(2.5, 5.5);
      const x = o.x + Math.sin(a) * r;
      const z = o.z + Math.cos(a) * r;
      if (Math.hypot(x, z) > R_ARENA - 2) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + (type === 'boss' ? 1.5 : 0.8))) continue;
      return this.spawnEnemy(type, x, z, variant);
    }
    return this.spawnRing(type, true, variant);
  }

  // A patrol takes the road now and then while no post is awake: a few foot soldiers and a leader
  // who has already seen the player. One at a time, never near a hostile post, gone when a post wakes.
  private stepPatrols(dt: number) {
    const c = this.conq;
    c.patrolT -= dt;
    if (c.patrolT > 0) return;
    c.patrolT = rand(PATROL_EVERY[0], PATROL_EVERY[1]);
    if (this.enemies.some((e) => !e.dead && e.patrol)) return;
    const P = this.player.pos;
    if (this.posts.some((p) => !p.captured && Math.hypot(p.x - P.x, p.z - P.z) < PATROL_CLEAR)) return;
    const base = this.aheadPoint();
    if (!base) return;
    const lead: { type: 'samurai'; variant?: EnemyVariant } = { type: 'samurai' };
    const fighters = FIGHTER_ORDER.filter((v) => this.wave >= FIGHTER_MIN[v]! && this.fighterReady(v));
    if (c.round >= 2 && fighters.length && Math.random() < 0.5) lead.variant = fighters[Math.floor(Math.random() * fighters.length)];
    else if (this.wave >= 3 && this.fighterReady('monk') && Math.random() < 0.4) lead.variant = 'monk';
    const group: { type: 'samurai'; variant?: EnemyVariant }[] = [lead];
    for (let i = 0; i < Math.min(6, 2 + c.round); i++) group.push({ type: 'samurai', variant: 'ashigaru' });
    for (const it of group) {
      const a = Math.random() * TAU;
      const r = rand(0.5, 2.6);
      const e = this.spawnEnemy(it.type, base.x + Math.sin(a) * r, base.z + Math.cos(a) * r, it.variant);
      e.patrol = true;
    }
    this.spawnLabel(base.x, 3.2, base.z, 'RONDA INIMIGA!', '#ffb36a', 1.3);
  }

  // Who leads a garrison: a named fighter if there is one, else the brute, else any samurai
  private pickCaptain(list: EnemyInstance[]): EnemyInstance | undefined {
    return list.find((e) => e.variant === 'nito' || e.variant === 'shinobi' || e.variant === 'raio') ?? list.find((e) => e.variant === 'brute') ?? list.find((e) => e.type === 'samurai');
  }

  // Elite samurai: tougher and harder-hitting, marked with a golden ground ring and a gold
  // life bar, and always drop a scroll
  private makeElite(e: EnemyInstance) {
    e.elite = true;
    e.hp *= 1.7;
    e.maxHp = e.hp;
    e.speed *= 1.08;
    (e.barFg.material as THREE.MeshBasicMaterial).color.set(0xffd166);
    e.aura = this.makeAura(0xff9a10, 1.25);
  }

  // A fighter can only appear once its model has finished loading (it loads in the background)
  private fighterReady(v: EnemyVariant) {
    const m = VARIANT_MODEL[v];
    const w = VARIANT_WEAPONS[v];
    return !!m && !!characterIfReady(m) && (!w || weaponsReady(w));
  }

  // One spot on the ring around the arena (never on top of the player or a solid prop)
  private spawnRing(type: 'samurai' | 'archer' | 'boss', near: boolean, variant?: EnemyVariant): EnemyInstance | null {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * TAU;
      const r = near ? rand(14, 22) : rand(20, 34);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < (near ? 10 : 13)) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + (type === 'boss' ? 1.5 : 0.8))) continue;
      return this.spawnEnemy(type, x, z, variant);
    }
    return null;
  }

  // Duel: the lone samurai is a master - an elite with a lot more life
  private makeDuelist(e: EnemyInstance) {
    this.makeElite(e);
    e.hp *= 1.6;
    e.maxHp = e.hp;
    e.speed *= 1.04;
  }

  // Captain hunt: an elite with a red ring; when he falls the band breaks and runs
  private makeCaptain(e: EnemyInstance) {
    this.makeElite(e);
    e.hp *= 1.25;
    e.maxHp = e.hp;
    e.captain = true;
    (e.barFg.material as THREE.MeshBasicMaterial).color.set(0xff3a2a);
    if (e.aura) this.disposeAura(e);
    e.aura = this.makeAura(0xff2a18, 1.7);
  }

  // The enemies still standing turn and run, then vanish (no Honra, no drops)
  private routEnemies(only?: (e: EnemyInstance) => boolean) {
    for (const e of this.enemies) {
      if (e.dead || e.flee || (only && !only(e))) continue;
      e.flee = true;
      e.fleeT = 0;
      e.token = false;
      e.brokenT = 0;
      e.staggerT = 0;
      e.dodgeT = 0;
      e.mode = 'recover';
      this.cancelStrike(e);
      e.rig.clip?.stop(0.2);
    }
  }

  // Goal clock: Resistir streams in reinforcements until the dawn, Capitão ends the moment
  // the captain falls
  private stepGoal(dt: number) {
    const g = this.goal;
    if (!g || g.done) return;
    if (g.id === 'resistir') {
      g.t += dt;
      const sec = Math.ceil(Math.max(0, g.dur - g.t));
      if (sec !== g.shown) {
        g.shown = sec;
        this.callbacks.onWaveMod?.({ id: g.id, name: `${g.name} · ${sec}s`, glyph: g.glyph, desc: 'Aguente até o amanhecer: os reforços não param' });
      }
      const alive = this.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
      g.next -= dt;
      // never more than a handful in the field at once, however long the night
      const room = RESIST_MAX - alive;
      if (g.t < g.dur - 4 && (g.next <= 0 || alive === 0) && room > 0) {
        g.next = 7;
        const n = Math.min(2 + (this.wave >= 6 ? 1 : 0), room);
        for (let i = 0; i < n; i++) this.spawnRing('samurai', false);
        if (this.wave >= 5 && room - n > 0 && Math.random() < 0.5) this.spawnRing('archer', false);
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 3.2, this.player.pos.z, 'REFORÇOS!', '#ffd166', 1.2);
        sfx.wave();
      }
      if (g.t >= g.dur) this.finishGoal(g, 'Amanheceu: o bando recua');
    } else if (g.id === 'capitao' && g.captain && g.captain.dead) {
      this.finishGoal(g, 'Capitão derrotado: o bando foge');
    }
  }

  private finishGoal(g: NonNullable<GameEngine['goal']>, text: string) {
    g.done = true;
    this.waveQueue = [];
    this.routEnemies();
    this.callbacks.onWaveMod?.({ id: g.id, name: `${g.name} ✓`, glyph: g.glyph, desc: text });
    this.callbacks.onWaveChange(this.wave, text, '');
    sfx.wave();
  }

  private makeAura(color: number, radius: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.78, radius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    m.renderOrder = 6;
    this.scene.add(m);
    return m;
  }

  private spawnEnemy(type: 'samurai' | 'archer' | 'boss', x: number, z: number, variant?: EnemyVariant) {
    // tougher fights: every enemy scales with the wave, all live-tunable (the Oni softer)
    const hpMul = (1 + (this.wave - 1) * TUNE.enemyHpScale) * (type === 'boss' ? 1 + (TUNE.enemyHp - 1) * 0.3 : TUNE.enemyHp);
    let rig: RigInstance;
    let bowObj: THREE.Object3D | null = null;
    let weaponObj: THREE.Object3D | null = null;
    let weaponObjL: THREE.Object3D | null = null;
    let bladeKey = '';
    let bladeKeyL = '';
    let hp = 60;
    let speed = 3.7;
    let r = 0.5;
    let h = 2.5;

    if (type === 'samurai') {
      // mocap samurai (the Rōnin recoloured, decimated body) once its model is in;
      // the procedural samurai otherwise
      // two looks, one fighter: the Rōnin recoloured or the second samurai model, picked
      // per spawn, same clips and AI
      const tpl = characterIfReady('ronin');
      const tpl2 = characterIfReady('samurai2');
      const vTint = variant === 'brute' ? BRUTE_TINT : variant === 'ashigaru' ? ASHIGARU_TINT : undefined;
      const vHeight = variant === 'brute' ? 2.8 : variant === 'ashigaru' ? 2.1 : undefined;
      // a fighter with a model of its own (when it has finished loading)
      const fm = variant && VARIANT_MODEL[variant] ? characterIfReady(VARIANT_MODEL[variant]!) : null;
      if (fm && variant) rig = createClipRig(fm, { lod: true, height: VARIANT_HEIGHT[variant], grips: VARIANT_GRIP[variant] });
      else if (tpl2 && (!tpl || Math.random() < 0.5)) rig = createClipRig(tpl2, { lod: true, grips: { right: SAMURAI2_GRIP }, tint: vTint, height: vHeight });
      else if (tpl) rig = createClipRig(tpl, { lod: true, tint: vTint ? ENEMY_TINT.clone().multiply(vTint) : ENEMY_TINT, rim: ENEMY_RIM, height: vHeight });
      else rig = buildCharacter('samurai');
      // the Samurai do Bō fights with a long staff, the Brutamontes with an oversized blade,
      // the Samurai das Duas Espadas with one in each hand
      // (the Lutador do Raio has claws on both fists, the Duas Espadas the Dancer's pair)
      const own = fm && variant ? VARIANT_WEAPONS[variant] : undefined;
      if (own && weaponsReady(own)) {
        bladeKey = own[0];
        bladeKeyL = own[1];
        weaponObj = makeWeapon(own[0]);
        weaponObjL = makeWeapon(own[1]);
        rig.hand.add(weaponObj);
        rig.handL.add(weaponObjL);
      } else {
        weaponObj = makeWeapon(variant === 'monk' ? 'bo' : 'ekatana');
        bladeKey = variant === 'monk' ? 'bo' : 'ekatana';
        if (variant === 'brute') weaponObj.scale.setScalar(1.45);
        else if (variant === 'ashigaru') weaponObj.scale.setScalar(0.85);
        rig.hand.add(weaponObj);
        if (variant === 'nito' && fm) {
          weaponObjL = makeWeapon('ekatana');
          bladeKeyL = 'ekatana';
          rig.handL.add(weaponObjL);
        }
      }
      hp = 60 * hpMul;
      speed = 3.7;
      if (variant === 'brute') {
        hp *= 3.2;
        speed *= 0.62;
        r = 0.8;
        h = 3.0;
      } else if (variant === 'ashigaru') {
        // a single blow of any weapon brings one down (until the late waves, when two may)
        hp = Math.min(24, 10 + this.wave * 0.6);
        speed *= 0.95;
        r = 0.45;
      } else if (variant === 'monk') {
        hp *= 0.85;
        speed *= 1.12;
      } else if (variant === 'shinobi') {
        hp *= 0.85;
        speed *= 1.5;
      } else if (variant === 'raio') {
        hp *= 1.2;
        speed *= 1.3;
      } else if (variant === 'nito') {
        hp *= 1.4;
        speed *= 1.02;
        r = 0.6;
      }
    } else if (type === 'archer') {
      const tpl = characterIfReady('archer');
      if (tpl) {
        rig = createClipRig(tpl, { lod: true, kind: 'archer', height: 2.3, grips: { left: ARCHER_BOW_GRIP } });
        bowObj = makeWeapon('longbow');
        rig.handL.add(bowObj);
      } else {
        rig = buildCharacter('archer');
        rig.handL.add(makeWeapon('bow'));
      }
      hp = 40 * hpMul;
      speed = 3.3;
    } else {
      const tpl = characterIfReady('giant');
      if (tpl) {
        // a coloured rim glow marks the form (the Trovão blue, the Sombrio violet)
        const glow = variant ? new THREE.Color(BOSS_COLOR[variant]).multiplyScalar(0.5) : undefined;
        rig = createClipRig(tpl, { lod: true, kind: 'oni', height: GIANT_HEIGHT, grips: { right: GIANT_GRIP }, rim: glow });
        // the great sword is modelled at human scale - sized to the giant's hand
        const sword = makeWeapon('greatsword');
        sword.scale.setScalar(rig.sizeScale ?? 1);
        rig.hand.add(sword);
        weaponObj = sword;
        bladeKey = 'greatsword';
      } else {
        rig = buildCharacter('oni', 2.1);
        rig.hand.add(makeWeapon('greatsword'));
      }
      hp = 480 * hpMul;
      speed = 3.1;
      r = 1.1;
      h = 5.2;
    }

    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, fog: false, depthWrite: false })
    );
    bg.renderOrder = 10;
    const fg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.14).translate(0.6, 0, 0),
      new THREE.MeshBasicMaterial({ color: type === 'boss' ? 0xf2a65a : 0xe0404a, fog: false, depthWrite: false })
    );
    fg.position.x = -0.6;
    fg.position.z = 0.001;
    fg.renderOrder = 11;
    // posture bar under the health bar, growing outward from the middle
    const pbg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, fog: false, depthWrite: false })
    );
    pbg.position.y = -0.14;
    pbg.renderOrder = 10;
    const pfg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xffc040, fog: false, depthWrite: false })
    );
    pfg.position.set(0, -0.14, 0.001);
    pfg.scale.x = 0.001;
    pfg.renderOrder = 11;
    bar.add(bg, fg, pbg, pfg);
    bar.visible = false;
    if (type === 'boss') bar.scale.setScalar(2);
    else if (variant === 'brute') bar.scale.setScalar(1.35);
    this.scene.add(bar);

    const enemy: EnemyInstance = {
      type,
      hp,
      maxHp: hp,
      speed,
      r,
      h,
      rig,
      pos: new THREE.Vector3(x, 0, z),
      kb: new THREE.Vector3(),
      yaw: Math.atan2(this.player.pos.x - x, this.player.pos.z - z),
      state: 'idle',
      t: 0,
      cd: 1 + Math.random() * 1.2,
      cd2: 0,
      flash: 0,
      dead: false,
      deathT: 0,
      phase: Math.random() * 6,
      moveAmt: 0,
      hitPlayer: false,
      chargeDir: new THREE.Vector3(),
      vy: 0,
      bar,
      barFg: fg,
      posture: 0,
      maxPosture: (type === 'boss' ? 320 : type === 'archer' ? 60 : 100) * (type === 'boss' ? 1 : TUNE.enemyPosture) * (variant === 'brute' ? 2.2 : 1),
      postureT: 0,
      brokenT: 0,
      mode: 'approach',
      modeT: 0,
      token: false,
      comboLeft: 0,
      circleDir: Math.random() < 0.5 ? 1 : -1,
      variant,
      guardT: 0,
      staggerT: 0,
      postureBar: pfg
    };
    {
      // markers ride a group sized to the enemy (a mocap root's own scale is a unit
      // conversion, not the character's size - see sizeOf)
      const overlay = new THREE.Group();
      overlay.scale.setScalar(this.sizeOf(enemy) / rig.root.scale.x);
      rig.root.add(overlay);
      const { dangerTex, deathblowTex } = markTextures();
      const danger = new THREE.Sprite(new THREE.SpriteMaterial({ map: dangerTex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      danger.position.set(0, 2.95, 0);
      danger.visible = false;
      danger.renderOrder = 32;
      overlay.add(danger);
      enemy.danger = danger;
      const mark = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: deathblowTex, color: new THREE.Color(2.2, 1.2, 1.2), transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
      );
      mark.position.set(0, 1.5, 0.25);
      mark.visible = false;
      mark.renderOrder = 33;
      overlay.add(mark);
      enemy.dbMark = mark;
    }

    if (type === 'boss' || type === 'samurai') {
      enemy.tele = new THREE.Mesh(
        new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: type === 'boss' ? 0xff3030 : 0xff8a30,
          transparent: true,
          opacity: 0.3,
          depthWrite: false
        })
      );
      enemy.tele.visible = false;
      enemy.tele.scale.setScalar(type === 'boss' ? 1.6 : 1.1);
      this.scene.add(enemy.tele);
    }

    if (bowObj && rig.model) enemy.bowFx = this.makeBowFx(rig, bowObj);
    if (rig.clip && weaponObj) {
      enemy.weapon = weaponObj;
      enemy.bladeKey = bladeKey;
      if (weaponObjL) {
        enemy.weaponL = weaponObjL;
        enemy.bladeKeyL = bladeKeyL;
      }
      // a sheath of light on the Shinobi's sword, arcs of lightning on the Lutador's
      const seg = BLADE_SEG[bladeKey];
      if (variant === 'shinobi' && seg && characterIfReady('shinobi')) enemy.fx = [makeBladeGlow(weaponObj, SHINOBI_LIGHT, seg.base, seg.tip)];
      const segL = BLADE_SEG[bladeKeyL];
      if (variant === 'raio' && seg && segL && weaponObjL && bladeKey === 'claw_r') {
        enemy.fx = [makeLightning(weaponObj, RAIO_LIGHT, seg.base, seg.tip), makeLightning(weaponObjL, RAIO_LIGHT, segL.base, segL.tip)];
      } else if (variant === 'nito' && seg && segL && weaponObjL && bladeKey === 'dsfire') {
        enemy.fx = [makeBladeGlow(weaponObj, FIRE_LIGHT, seg.base, seg.tip), makeBladeGlow(weaponObjL, MAGIC_LIGHT, segL.base, segL.tip)];
      }
    }

    this.scene.add(rig.root);
    this.emitParticles(x, 1, z, 26, 0x8a7aa8, 5, 2, 3, 0.9);
    this.enemies.push(enemy);
    if (type === 'boss' && rig.clip) {
      // entrance: the giant roars before it moves (held in place like a stagger)
      this.enemyClip(enemy, 'powerUp', { from: 0.3, to: 2.5, speed: 1.2, fadeIn: 0.2 });
      enemy.staggerT = (2.5 - 0.3) / 1.2;
      enemy.cd = Math.max(enemy.cd, 2.4);
    }
    return enemy;
  }

  // The bow model is unstrung: its string is a live 3-point line, tip -> nock -> tip, the
  // nock following the drawing hand at full draw (with an arrow on it), else straight
  private makeBowFx(rig: RigInstance, bow: THREE.Object3D): NonNullable<EnemyInstance['bowFx']> {
    rig.root.updateMatrixWorld(true);
    const top = new THREE.Vector3(0, -Infinity, 0);
    const bottom = new THREE.Vector3(0, Infinity, 0);
    const v = new THREE.Vector3();
    bow.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        bow.worldToLocal(v);
        if (v.y > top.y) top.copy(v);
        if (v.y < bottom.y) bottom.copy(v);
      }
    });
    const geo = new THREE.BufferGeometry().setFromPoints([top, top.clone().lerp(bottom, 0.5), bottom]);
    const string = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe6dcc4 }));
    string.frustumCulled = false;
    bow.add(string);
    const arrow = makeWeapon('arrow');
    arrow.visible = false;
    bow.add(arrow);
    const nock = rig.model!.getObjectByName('mixamorigRightHandIndex2') ?? rig.model!.getObjectByName('mixamorigRightHand')!;
    return { bow, string, arrow, nock, mid: top.clone().lerp(bottom, 0.5) };
  }

  private updateBowFx(e: EnemyInstance) {
    const fx = e.bowFx;
    if (!fx) return;
    const b = e.bow;
    const cur = e.rig.clip?.current;
    const drawn = !!b && !e.dead && ((b.phase === 'draw' && cur?.name === 'draw' && cur.t >= 0.62) || b.phase === 'aim');
    const pos = fx.string.geometry.attributes.position as THREE.BufferAttribute;
    if (drawn) {
      e.rig.root.updateMatrixWorld(true);
      fx.nock.getWorldPosition(this.tmpV);
      fx.bow.worldToLocal(this.tmpV);
      pos.setXYZ(1, this.tmpV.x, this.tmpV.y, this.tmpV.z);
      fx.arrow.visible = true;
      fx.arrow.position.copy(this.tmpV);
      fx.arrow.quaternion.setFromUnitVectors(Z_AXIS, this.tmpV.negate().normalize());
    } else {
      pos.setXYZ(1, fx.mid.x, fx.mid.y, fx.mid.z);
      fx.arrow.visible = false;
    }
    pos.needsUpdate = true;
  }

  private removeEnemy(e: EnemyInstance) {
    if (e.bowFx) {
      e.bowFx.string.geometry.dispose();
      (e.bowFx.string.material as THREE.Material).dispose();
    }
    e.trail?.dispose();
    e.fx?.forEach((f) => f.dispose());
    if (e.aura) {
      this.scene.remove(e.aura);
      e.aura.geometry.dispose();
      (e.aura.material as THREE.Material).dispose();
    }
    this.scene.remove(e.rig.root);
    this.scene.remove(e.bar);
    if (e.tele) this.scene.remove(e.tele);
    e.rig.dispose?.();
    e.danger?.material.dispose();
    e.dbMark?.material.dispose();
    e.bar.children.forEach((c) => {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    if (e.tele) {
      e.tele.geometry.dispose();
      (e.tele.material as THREE.Material).dispose();
    }
  }

  private emitParticles(
    x: number,
    y: number,
    z: number,
    n: number,
    color: number,
    speed: number,
    up = 2,
    grav = 12,
    life = 0.6
  ) {
    this.tmpC.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.pIdx;
      this.pIdx = (this.pIdx + 1) % this.PN;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;

      const th = Math.random() * TAU;
      const ph = Math.acos(rand(-1, 1));
      const s = speed * (0.35 + Math.random() * 0.65);

      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      this.pVel[i * 3 + 1] = Math.cos(ph) * s + up;
      this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;

      this.pLife[i] = life * (0.6 + Math.random() * 0.6);
      this.pGrav[i] = grav;
      this.pCol[i * 3] = this.tmpC.r;
      this.pCol[i * 3 + 1] = this.tmpC.g;
      this.pCol[i * 3 + 2] = this.tmpC.b;
    }
  }

  public emitBlood(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    count: number,
    isCombo = false,
    isHeavy = false
  ) {
    const total = Math.min(80, isCombo ? Math.round(count * 1.7) : count);

    const dLen = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / dLen;
    const nz = dirZ / dLen;
    const px = -nz;
    const pz = nx;

    // Paleta de tons de sangue arterial denso a vívido
    const shades = [0x900010, 0xb30919, 0xc9182b, 0x6e030a, 0xd9162e];

    for (let k = 0; k < total; k++) {
      const i = this.bIdx;
      this.bIdx = (this.bIdx + 1) % this.BLOOD_PN;

      this.bPos[i * 3] = x + (Math.random() - 0.5) * 0.28;
      this.bPos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.35;
      this.bPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.28;

      let vx = 0;
      let vy = 0;
      let vz = 0;
      const spd = isCombo ? rand(8, 17) : isHeavy ? rand(6, 14) : rand(4, 10);

      if (isCombo) {
        // Arco em leque dinâmico simulando a lâmina rasgando no ar
        const arc = (Math.random() - 0.5) * 2.0;
        const forward = rand(0.2, 1.1);
        vx = (nx * forward + px * arc) * spd;
        vz = (nz * forward + pz * arc) * spd;
        vy = rand(-1.0, 4.5);
      } else {
        // Spray cônico de impacto
        const sx = (Math.random() - 0.5) * 0.8;
        const sz = (Math.random() - 0.5) * 0.8;
        vx = (nx + sx) * spd;
        vz = (nz + sz) * spd;
        vy = rand(1.5, 4.8) + (isHeavy ? 2.2 : 0);
      }

      this.bVel[i * 3] = vx;
      this.bVel[i * 3 + 1] = vy;
      this.bVel[i * 3 + 2] = vz;

      const life = rand(0.7, isCombo ? 1.6 : 1.1);
      this.bLife[i] = life;
      this.bMaxLife[i] = life;
      this.bGrav[i] = rand(18, 28);

      const colorHex = shades[Math.floor(Math.random() * shades.length)];
      this.tmpC.set(colorHex);
      this.bCol[i * 3] = this.tmpC.r;
      this.bCol[i * 3 + 1] = this.tmpC.g;
      this.bCol[i * 3 + 2] = this.tmpC.b;
    }

    // Faíscas afiadas de impacto metálico de lâmina
    const sparkCount = isCombo ? 12 : isHeavy ? 8 : 4;
    this.emitParticles(
      x,
      y,
      z,
      sparkCount,
      isCombo ? 0xfff2b0 : 0xff7040,
      isCombo ? 8 : 5,
      2.0,
      15,
      0.28
    );

    // Anel de choque carmesim de impacto de sangue
    if (isCombo || isHeavy) {
      this.spawnBloodRing(x, y, z, isCombo ? 2.8 : 1.7);
    }
  }

  // ground dust tinted by the current atmosphere; (dx, dz) biases the spread
  private puff(x: number, z: number, n: number, spd: number, dx = 0, dz = 0) {
    this.dustCol.copy(this.world.atm.fog).lerp(DUST_BASE, 0.55).multiplyScalar(0.9 + this.world.atm.hemiI * 0.15);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const v = spd * rand(0.4, 1);
      this.dust.emit(
        x + rand(-0.15, 0.15),
        rand(0.05, 0.2),
        z + rand(-0.15, 0.15),
        Math.sin(a) * v + dx * spd * 0.6,
        rand(0.2, 0.7),
        Math.cos(a) * v + dz * spd * 0.6,
        rand(0.35, 0.6),
        rand(0.5, 0.85),
        this.dustCol,
        0.4
      );
    }
  }

  private spawnBloodRing(x: number, y: number, z: number, maxR: number, color = 0x9b111e, dur = 0.28) {
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const m = new THREE.Mesh(this.ringGeo, ringMat);
    m.position.set(x, Math.max(0.08, y * 0.4), z);
    m.scale.set(0.1, 0.1, 0.1);
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur, maxR, startR: 0.2 });
  }

  // AoE burst for bomb-flagged projectiles (grenades). Damage falls
  // off with distance from the blast center; the player's own explosives never hurt them.
  private explodeAt(x: number, y: number, z: number, radius: number, dmg: number, kb: number) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - x;
      const dz = e.pos.z - z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d > radius + e.r) continue;
      const falloff = 1 - Math.min(1, d / (radius + e.r));
      this.hitEnemy(e, Math.round(dmg * (0.5 + 0.5 * falloff)), dx / d, dz / d, kb, true);
    }
    this.emitParticles(x, y + 0.4, z, 26, 0xffb04a, 6, 3, 5, 0.55);
    this.world.props.explode(x, y, z, radius, 10);
    this.spawnBloodRing(x, y, z, radius, 0xffa030, 0.4);
    this.shake = Math.max(this.shake, 0.4);
    sfx.boom();
  }

  private updateParticles(dt: number) {
    const fade = Math.max(0, 1 - dt * 1.8);
    for (let i = 0; i < this.PN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -999;
        continue;
      }
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.05) {
        this.pPos[i * 3 + 1] = 0.05;
        this.pVel[i * 3 + 1] *= -0.3;
      }
      this.pCol[i * 3] *= fade;
      this.pCol[i * 3 + 1] *= fade;
      this.pCol[i * 3 + 2] *= fade;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;

    // Atualização de partículas de sangue visceral
    for (let i = 0; i < this.BLOOD_PN; i++) {
      if (this.bLife[i] <= 0) continue;

      if (this.bPos[i * 3 + 1] <= 0.05) {
        // Ao tocar o chão: desacelera e esvanece suavemente simulando poça
        this.bPos[i * 3 + 1] = 0.05;
        this.bVel[i * 3] *= Math.max(0, 1 - dt * 10);
        this.bVel[i * 3 + 2] *= Math.max(0, 1 - dt * 10);
        this.bVel[i * 3 + 1] = 0;

        this.bLife[i] -= dt * 0.75;
        if (this.bLife[i] <= 0) {
          this.bPos[i * 3 + 1] = -999;
          continue;
        }
        const f = Math.max(0, this.bLife[i] / this.bMaxLife[i]);
        this.bCol[i * 3] *= f;
        this.bCol[i * 3 + 1] *= f;
        this.bCol[i * 3 + 2] *= f;
      } else {
        // No ar
        this.bLife[i] -= dt;
        if (this.bLife[i] <= 0) {
          this.bPos[i * 3 + 1] = -999;
          continue;
        }
        this.bVel[i * 3 + 1] -= this.bGrav[i] * dt;
        this.bPos[i * 3] += this.bVel[i * 3] * dt;
        this.bPos[i * 3 + 1] += this.bVel[i * 3 + 1] * dt;
        this.bPos[i * 3 + 2] += this.bVel[i * 3 + 2] * dt;

        if (this.bPos[i * 3 + 1] <= 0.05) {
          this.bPos[i * 3 + 1] = 0.05;
          this.bVel[i * 3] *= 0.22;
          this.bVel[i * 3 + 2] *= 0.22;
          this.bVel[i * 3 + 1] = 0;
        }
      }
    }
    this.bGeo.attributes.position.needsUpdate = true;
    this.bGeo.attributes.color.needsUpdate = true;

    // Atualização de Blood Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const progress = r.t / r.dur;
      if (progress >= 1) {
        this.scene.remove(r.m);
        (r.m.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const scale = r.startR + (r.maxR - r.startR) * Math.sin((progress * Math.PI) / 2);
      r.m.scale.set(scale, scale, scale);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
    }
  }

  // ----------------------------------------------------
  // FLOATING COMBAT LABELS (damage numbers, dodge callouts)
  // ----------------------------------------------------
  private spawnLabel(x: number, y: number, z: number, text: string, color: string, scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // long words shrink to fit the label instead of being cut at its edges
      let size = 42;
      ctx.font = `bold ${size}px "Zen Kaku Gothic New", sans-serif`;
      while (size > 18 && ctx.measureText(text).width > 176) {
        size -= 2;
        ctx.font = `bold ${size}px "Zen Kaku Gothic New", sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(10,6,4,0.8)';
      ctx.strokeText(text, 96, 38);
      ctx.fillStyle = color;
      ctx.fillText(text, 96, 38);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.position.set(x, y, z);
    spr.scale.set(1.7 * scale, 0.64 * scale, 1);
    spr.renderOrder = 30;
    this.scene.add(spr);
    this.labels.push({ sprite: spr, t: 0, life: 0.85, vy: 1.15 });

    if (this.labels.length > 24) {
      const old = this.labels.shift();
      if (old) {
        this.scene.remove(old.sprite);
        old.sprite.material.map?.dispose();
        old.sprite.material.dispose();
      }
    }
  }

  // ----------------------------------------------------
  // AIM RETICLE: shots fly along the player's facing, so the reticle sits in the world on
  // that line (not at screen center, which in third person is the character itself)
  // ----------------------------------------------------
  private buildReticle() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(64, 64, 38, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 8;
      for (const [x0, y0, x1, y1] of [
        [64, 6, 64, 30],
        [64, 98, 64, 122],
        [6, 64, 30, 64],
        [98, 64, 122, 64]
      ]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(64, 64, 7, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.reticle = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        sizeAttenuation: false
      })
    );
    this.reticle.renderOrder = 31;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  private updateReticle(dt: number) {
    const w = this.weapons[this.activeWeaponIdx];
    const straight = w && w.kind === 'proj';
    if (!straight || this.player.hp <= 0) {
      this.reticle.visible = false;
      return;
    }
    const fx = Math.sin(this.player.yaw);
    const fz = Math.cos(this.player.yaw);
    const reach = Math.min(18, (w.speed || 30) * (w.life || 1.2));
    const n = w.count || 1;
    const halfSpread = ((n - 1) / 2) * (w.spread || 0);

    // Nearest enemy inside the line of fire (feedback only; the shot direction is unchanged)
    let lock: EnemyInstance | null = null;
    let best = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - this.player.pos.x;
      const dz = e.pos.z - this.player.pos.z;
      const along = dx * fx + dz * fz;
      if (along <= 0.3 || along > reach + e.r) continue;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral > e.r + 0.35 + along * Math.tan(halfSpread)) continue;
      if (along < best) {
        best = along;
        lock = e;
      }
    }

    const aimDist = Math.min(reach, 10);
    if (lock) this.reticleTarget.set(lock.pos.x, lock.pos.y + lock.h * 0.55, lock.pos.z);
    else this.reticleTarget.set(this.player.pos.x + fx * aimDist, 1.25, this.player.pos.z + fz * aimDist);

    const mat = this.reticle.material;
    if (!this.reticle.visible) this.reticle.position.copy(this.reticleTarget);
    else this.reticle.position.lerp(this.reticleTarget, 1 - Math.exp(-dt * 16));
    this.reticle.visible = true;
    mat.color.set(lock ? 0xff4a3a : 0xffffff);
    mat.opacity = lock ? 1 : 0.75;
    // Constant on-screen size (~3.5% of view height), slightly larger when locked on
    const s = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * (lock ? 0.042 : 0.036);
    this.reticle.scale.set(s, s, 1);
  }

  private updateLabels(dt: number) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const L = this.labels[i];
      L.t += dt;
      L.sprite.position.y += L.vy * dt;
      L.sprite.material.opacity = Math.max(0, 1 - L.t / L.life);
      if (L.t >= L.life) {
        this.scene.remove(L.sprite);
        L.sprite.material.map?.dispose();
        L.sprite.material.dispose();
        this.labels.splice(i, 1);
      }
    }
  }

  // Rolls damage variance (±18%): weak/normal/critical. Hit/miss stays fully
  // deterministic (arc/range already decided the hit landed) — only the
  // number and its flavor are randomized.
  private rollDamage(base: number, allowCrit: boolean): { dmg: number; tier: 'weak' | 'normal' | 'crit' } {
    const roll = rand(0.82, 1.18);
    let mult = roll;
    let tier: 'weak' | 'normal' | 'crit' = 'normal';
    if (roll >= 1.1 - 0.02 * (this.cardLv.gume ?? 0)) {
      tier = 'crit';
      if (allowCrit) mult *= 1.35;
    } else if (roll <= 0.9) {
      tier = 'weak';
    }
    return { dmg: Math.max(1, Math.round(base * mult)), tier };
  }

  private triggerSlowmo(duration: number, scale: number) {
    this.slowmoT = duration;
    this.slowmoScale = scale;
  }

  public jump() {
    if (this.state !== 'play' || this.player.jumps >= 2) return;
    if (this.player.staggerT > 0 || this.cine || !this.freeToCancel()) return;
    this.player.vy = this.player.jumps === 0 ? 10.5 : 9.5;
    this.player.jumps++;
    this.cancelAct(0.1);
    this.player.grounded = false;
    this.emitParticles(this.player.pos.x, this.player.pos.y + 0.2, this.player.pos.z, 10, 0xbfb3d8, 3, 1, 4, 0.4);
    sfx.jump();
  }

  public dash() {
    if (this.state !== 'play' || this.player.dash > 0 || this.player.st < this.dashCost()) return;
    if (this.player.staggerT > 0 || this.cine || !this.freeToCancel()) return;
    this.player.st -= this.dashCost();
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
    this.cancelAct(0.08);
    this.player.dash = 0.2;
    this.player.inv = Math.max(this.player.inv, 0.3 + 0.04 * (this.cardLv.sombra ?? 0));
    this.player.dashInv = true;
    this.player.comboT = 0;
    this.player.tornado = 0;
    this.player.rush = null;

    if (this.lastMove.lengthSq() > 0.01 && this.player.moveAmt > 0.1) {
      this.player.dashDir.copy(this.lastMove).normalize();
    } else {
      this.player.dashDir.set(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    }
    this.player.yaw = Math.atan2(this.player.dashDir.x, this.player.dashDir.z);
    this.fovKick = Math.max(this.fovKick, 7);
    this.ghosts.spawn(this.player.rig.root, GHOST_DASH);
    this.ghostT = 0.06;
    this.puff(this.player.pos.x, this.player.pos.z, 6, 2.2, -this.player.dashDir.x, -this.player.dashDir.z);
    sfx.dash();
  }

  // Attack from a button press: fires now if possible, otherwise buffers the press
  // briefly so a quick tap during another weapon's cooldown isn't silently dropped.
  public pressAttack() {
    const before = this.player.atkCd;
    this.tryAttack();
    this.attackQueueT = this.player.atkCd > before ? 0 : 0.3;
  }

  public tryAttack() {
    if (this.player.rig.clip) {
      this.soulsAttack();
      return;
    }
    if (this.player.atkCd > 0 || this.state !== 'play') return;
    if (this.player.staggerT > 0 || this.cine || this.input.guardHeld || this.player.healT > 0) return;
    const w = this.weapons[this.activeWeaponIdx];
    if (this.player.rush || this.player.tornado > 0) return;

    const db = this.findDeathblowTarget();
    if (db) {
      this.performDeathblow(db);
      return;
    }

    if (this.player.special[this.activeWeaponIdx] > 0) {
      this.trySpecial(w);
      return;
    }

    if (w.stamina && this.player.st < w.stamina) return;
    if (w.stamina) {
      this.player.st -= w.stamina;
      this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
    }

    if (w.kind === 'karate') {
      const st =
        this.player.comboT > 0 && this.player.comboW === this.activeWeaponIdx ? (this.player.combo + 1) % 4 : 0;
      const m = KARATE[st];
      this.player.combo = st;
      this.player.comboW = this.activeWeaponIdx;
      this.player.comboT = 0.8;
      this.player.anim = { kind: m.anim, t: 0, dur: m.dur, side: 0 };
      this.player.atkCd = m.cd;
      this.player.pos.x += Math.sin(this.player.yaw) * m.lunge;
      this.player.pos.z += Math.cos(this.player.yaw) * m.lunge;
      this.meleeHit(m.range, m.arc, m.dmg, m.kb, !!m.heavy || st === 2);
      if (m.anim === 'roundKick') {
        this.slash.geometry = this.slashGeos.kick;
        this.slashT = 0;
        this.slashDur = 0.22;
      }
      m.heavy ? sfx.heavy() : sfx.swing();
      return;
    }

    let fx = Math.sin(this.player.yaw);
    let fz = Math.cos(this.player.yaw);
    this.player.rig.root.updateMatrixWorld(true);
    this.player.rig.hand.getWorldPosition(this.tmpH);

    let step = 0;
    if (w.id === 'katana') {
      step = this.player.comboT > 0 && this.player.comboW === this.activeWeaponIdx ? (this.player.combo + 1) % 3 : 0;
      this.player.combo = step;
      this.player.comboW = this.activeWeaponIdx;
      this.player.comboT = 0.75;
    }
    const heavy = step === 2 || w.id === 'bo';
    this.player.anim = { kind: w.anim || 'slash', t: 0, dur: w.dur || 0.2, side: step };
    this.player.atkCd = w.cd + (step === 2 ? 0.15 : 0);
    this.ptMult = w.pointMult || 1;

    if (w.kind === 'melee') {
      if (step === 0) {
        // only the combo's opening hit re-aims - re-aiming on every hit would jitter the
        // character between enemies standing on different sides mid-combo.
        this.autoFaceNearestEnemyForAttack(w.range || 2.5);
        fx = Math.sin(this.player.yaw);
        fz = Math.cos(this.player.yaw);
      }
      if (w.id === 'katana') {
        const lungeDist = step === 2 ? 0.85 : 0.45;
        this.player.pos.x += fx * lungeDist;
        this.player.pos.z += fz * lungeDist;
      }
      this.meleeHit(w.range || 2.5, w.arc || 2.0, w.dmg[Math.min(step, w.dmg.length - 1)], (w.kb || 4) + (step === 2 ? 7 : 0), heavy);
      this.slash.geometry = this.slashGeos[w.id === 'bo' ? 'bo' : 'katana'];
      this.slashT = 0;
      this.slashDur = w.id === 'bo' ? 0.3 : 0.16;
      this.slash.rotation.set(0, this.player.yaw, 0);
      heavy ? sfx.heavy() : sfx.swing();
    } else if (w.kind === 'chain') {
      this.meleeHit(w.range || 6.5, w.arc || 1.15, w.dmg[0], w.kb || -7, true);
      this.chainT = 0;
      sfx.swing();
    } else if (w.kind === 'proj') {
      const n = w.count || 1;
      for (let i = 0; i < n; i++) {
        const a = this.player.yaw + (i - (n - 1) / 2) * (w.spread || 0);
        this.spawnProj({
          type: w.id,
          friendly: true,
          ptMult: w.pointMult || 1,
          pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
          vel: new THREE.Vector3(Math.sin(a) * (w.speed || 30), 0, Math.cos(a) * (w.speed || 30)),
          dmg: w.dmg[0],
          pierce: !!w.pierce,
          life: w.life || 1.2
        });
      }
      sfx.throw();
    } else if (w.kind === 'bomb') {
      this.spawnProj({
        type: 'bomb',
        friendly: true,
        pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
        vel: new THREE.Vector3(fx * 14, 7.5, fz * 14),
        grav: 16,
        dmg: w.dmg[0],
        life: 3,
        bomb: true
      });
      sfx.throw();
    }
  }

  private trySpecial(w: WeaponDef) {
    const S = SPECIALS[w.id];
    if (!S) return;
    if (this.player.rig.clip) {
      this.soulsSpecial(w);
      return;
    }
    this.player.atkCd = S.cd;
    this.fovKick = Math.min(this.fovKick, -4);
    const fx = Math.sin(this.player.yaw);
    const fz = Math.cos(this.player.yaw);
    this.player.rig.root.updateMatrixWorld(true);
    this.player.rig.hand.getWorldPosition(this.tmpH);

    switch (w.id) {
      case 'katana':
        this.player.anim = { kind: 'slash', t: 0, dur: 0.24, side: 0 };
        this.slash.geometry = this.slashGeos.katana;
        this.slashT = 0;
        this.slashDur = 0.2;
        this.spHit = true;
        this.meleeHit(2.9, 2.1, 40, 6, true);
        this.spHit = false;
        this.spawnProj({
          type: 'wave',
          friendly: true,
          sp: true,
          pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y - 0.3, this.tmpH.z),
          vel: new THREE.Vector3(fx * 22, 0, fz * 22),
          dmg: 45,
          pierce: true,
          life: 0.8,
          r: 1.5,
          kb: 6,
          noSolid: true
        });
        sfx.heavy();
        break;
      case 'bo':
        this.player.tornado = 1.5;
        this.player.torTick = 0;
        this.player.anim = { kind: 'spin', t: 0, dur: 1.5, side: 0 };
        sfx.dash();
        break;
      case 'kama':
        this.player.anim = { kind: 'spin', t: 0, dur: 0.45, side: 0 };
        this.chainSpin = 0.45;
        this.spHit = true;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.pos.x - this.player.pos.x;
          const dz = e.pos.z - this.player.pos.z;
          const d = Math.hypot(dx, dz) || 0.001;
          if (d < 7 + e.r) this.hitEnemy(e, 48, -dx / d, -dz / d, 6, true);
        }
        this.spHit = false;
        sfx.heavy();
        break;
      case 'shuriken':
        for (let i = 0; i < 12; i++) {
          const a = this.player.yaw + (i / 12) * TAU;
          this.spawnProj({
            type: 'shuriken',
            friendly: true,
            sp: true,
            homing: true,
            speed: 18,
            pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
            vel: new THREE.Vector3(Math.sin(a) * 18, 0, Math.cos(a) * 18),
            dmg: 11,
            life: 2.2
          });
        }
        sfx.throw();
        break;
      case 'kunai': {
        const tg = this.findTarget(14);
        if (tg) {
          const dx = tg.pos.x - this.player.pos.x;
          const dz = tg.pos.z - this.player.pos.z;
          const d = Math.hypot(dx, dz) || 0.001;
          this.player.pos.x = tg.pos.x + (dx / d) * (tg.r + 0.9);
          this.player.pos.z = tg.pos.z + (dz / d) * (tg.r + 0.9);
          this.player.yaw = Math.atan2(-dx, -dz);
          this.spHit = true;
          this.hitEnemy(tg, 130, -dx / d, -dz / d, 8, true);
          this.spHit = false;
          sfx.dash();
        }
        break;
      }
      case 'karate':
        this.player.rush = { t: 0, hits: 0, kicked: false };
        break;
      case 'bomb': {
        // Chuva de Fogo: a scatter of grenades arcing down across an area instead of one throw
        const n = 5;
        for (let i = 0; i < n; i++) {
          const a = this.player.yaw + (i - (n - 1) / 2) * 0.3 + rand(-0.05, 0.05);
          this.spawnProj({
            type: 'bomb',
            friendly: true,
            sp: true,
            bomb: true,
            pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y + 0.2, this.tmpH.z),
            vel: new THREE.Vector3(Math.sin(a) * 13, 7 + rand(-1, 2), Math.cos(a) * 13),
            grav: 16,
            dmg: 36,
            aoeR: 3.2,
            kb: 8,
            life: 2.5
          });
        }
        sfx.throw();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mocap rig: Souls-style moves (see moves.ts). A move commits: damage lands on the
  // clip's own hit frame, the next combo step only starts inside its chain window, and a
  // dodge/guard can only cut into the recovery (after `cancel`).
  // ---------------------------------------------------------------------------
  private startAct(
    kind: PlayerAct['kind'],
    clip: string,
    o: PlayOptions & { chain?: number; cancel?: number; end?: number; turnUntil?: number } = {},
    move?: ClipMove
  ): PlayerAct | null {
    const ctl = this.player.rig.clip;
    if (!ctl) return null;
    this.endClash();
    const shot = ctl.play(clip, { fadeIn: 0.1, fadeOut: 0.3, ...o });
    if (!shot) return null;
    const a: PlayerAct = {
      kind,
      shot,
      move,
      events: [],
      chainAt: o.chain ?? 99,
      cancelAt: o.cancel ?? 0,
      endAt: o.end ?? shot.o.to,
      turnUntil: o.turnUntil ?? 0,
      windows: []
    };
    this.act = a;
    this.bladePrevOk = false;
    return a;
  }

  // Steering: free when idle, only through a move's wind-up, locked once it lands
  private clipTurnSpeed() {
    const a = this.act;
    if (!a || a.kind === 'draw') return TUNE.turnSpeedIdle;
    if ((a.kind === 'attack' || a.kind === 'special') && a.shot.t < a.turnUntil) return TUNE.turnSpeedAttacking;
    return 0;
  }

  /** Nothing committed is playing (or it's past its cancel point) - dodge/jump/guard OK. */
  private freeToCancel() {
    if (!this.player.rig.clip) return true;
    if (this.player.hp <= 0) return false;
    const a = this.act;
    return !a || a.shot.t >= a.cancelAt;
  }

  private cancelAct(fade = 0.12) {
    if (!this.act) return;
    this.act = null;
    this.actQueued = false;
    this.player.rig.clip?.stop(fade);
  }

  /** Guard is up (mocap rig: only when not committed to something else). */
  private guarding() {
    if (!this.input.guardHeld || this.player.staggerT > 0) return false;
    const a = this.act;
    return !a || a.kind === 'deflect' || a.kind === 'block' || a.kind === 'draw';
  }

  private soulsAttack() {
    if (this.state !== 'play' || this.player.hp <= 0) return;
    if (this.player.staggerT > 0 || this.cine || this.player.healT > 0) return;
    if (this.player.rush || this.player.tornado > 0) return;
    const a = this.act;
    if (a) {
      const counter = (a.kind === 'deflect' || a.kind === 'block' || a.kind === 'hurt') && a.shot.t >= a.cancelAt;
      const chain = a.kind === 'attack' && a.shot.t >= a.chainAt;
      if (a.kind !== 'draw' && !counter && !chain) {
        // too early: remember the press for the combo window (see stepPlayerAct)
        if (a.kind === 'attack' || a.kind === 'deflect' || a.kind === 'block') this.actQueued = true;
        this.player.atkCd += 0.001; // tells pressAttack() the press was taken
        return;
      }
    }
    if (this.input.guardHeld && !a) return;

    const db = this.findDeathblowTarget();
    if (db) {
      this.performDeathblow(db);
      return;
    }
    const w = this.weapons[this.activeWeaponIdx];
    if (this.player.special[this.activeWeaponIdx] > 0) {
      this.trySpecial(w);
      return;
    }
    const combo = COMBOS[w.id];
    if (!combo) return;
    const chaining = !!a && a.kind === 'attack' && this.player.comboW === this.activeWeaponIdx;
    const step = chaining ? (this.player.combo + 1) % combo.length : 0;
    const m = combo[step];
    if (w.stamina && this.player.st < w.stamina) return;
    if (m.stamina && this.player.st <= 0) return;
    this.player.st = Math.max(0, this.player.st - m.stamina - (w.stamina || 0));
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
    this.player.combo = step;
    this.player.comboW = this.activeWeaponIdx;
    this.player.comboT = 0;
    this.ptMult = w.pointMult || 1;
    this.actQueued = false;
    if (step === 0) this.autoFaceNearestEnemyForAttack(Math.max(2.5, m.range));
    const sweepable = w.kind === 'melee' || w.kind === 'karate';
    const target = sweepable ? this.pickAttackTarget(m.range, chaining) : null;

    const act = this.startAct(
      'attack',
      m.clip,
      {
        speed: (m.speed ?? 1) * TUNE.attackSpeed,
        from: m.from,
        rootMotion: !!m.root,
        fadeIn: chaining ? 0.14 : 0.1,
        chain: m.chain,
        cancel: m.cancel,
        end: m.end,
        turnUntil: m.hit[0] ?? m.release ?? 0
      },
      m
    );
    if (!act) return;
    this.player.atkCd = Math.max(0, this.player.atkCd) + 0.05;
    if (sweepable) {
      // damage is decided by the weapon actually touching a body inside these spans
      for (const [t0, t1] of m.win ?? m.hit.map((h): [number, number] => [h - 0.08, h + 0.08])) {
        act.windows.push({ t0, t1, dmg: m.dmg, kb: m.kb, heavy: !!m.heavy, weapon: w, hits: new Set(), began: false, wide: m.wide ?? 0, ring: m.ring ?? 0, ringDone: false });
      }
      if (target && m.hit.length) {
        this.comboTarget = target;
        act.target = target;
        act.magnet = { reach: m.reach ?? MAGNET_REACH[w.id] ?? 1.3, until: m.hit[0], k: m.root ? 0.5 : 1 };
      }
    } else {
      for (const t of m.hit) act.events.push({ t, fn: () => this.soulsStrike(w, m, step) });
    }
    if (m.release !== undefined) act.events.push({ t: m.release, fn: () => this.throwWeapon(w, false) });
  }

  // a move's hit frame
  private soulsStrike(w: WeaponDef, m: ClipMove, step: number) {
    if (w.kind === 'chain') {
      this.meleeHit(m.range, m.arc, m.dmg, m.kb, true);
      this.chainT = 0;
      sfx.swing();
      return;
    }
    this.meleeHit(m.range, m.arc, m.dmg, m.kb, !!m.heavy);
    m.heavy || step === 2 ? sfx.heavy() : sfx.swing();
  }

  // Closest live enemy in front (or right beside) the player within reach of a swing;
  // a combo keeps the target it started on so it doesn't jitter between enemies
  private pickAttackTarget(range: number, keepPrev: boolean): EnemyInstance | null {
    const P = this.player;
    const maxD = range * 1.15;
    const prev = this.comboTarget;
    if (keepPrev && prev && !prev.dead && Math.hypot(prev.pos.x - P.pos.x, prev.pos.z - P.pos.z) - prev.r <= maxD) return prev;
    const fx = Math.sin(P.yaw);
    const fz = Math.cos(P.yaw);
    let best: EnemyInstance | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - P.pos.x;
      const dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d - e.r > maxD) continue;
      const dot = (fx * dx + fz * dz) / d;
      if (dot < -0.17) continue; // never spin around to someone behind
      const score = d - dot * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // Attack magnetism: until its first hit frame the swing turns toward its target and
  // closes just enough distance for the weapon to arrive there when the hit does -
  // never past body contact - so a blade meant for someone in reach really reaches them
  private stepMagnet(a: PlayerAct, dt: number) {
    const t = a.target;
    const mg = a.magnet;
    if (!t || !mg || t.dead) return;
    const sh = a.shot;
    if (sh.t > mg.until) return;
    const dx = t.pos.x - this.player.pos.x;
    const dz = t.pos.z - this.player.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    this.player.yaw = turnTo(this.player.yaw, Math.atan2(dx, dz), Math.min(1, dt * 12));
    const gap = d - (t.r + mg.reach);
    if (gap > 0.04 && gap < 2.2) {
      const remain = Math.max(0.05, (mg.until - sh.t) / Math.max(0.1, sh.o.speed));
      const step = Math.min(gap, ((gap / remain) * dt * mg.k) || 0, 12 * dt);
      this.player.pos.x += (dx / d) * step;
      this.player.pos.z += (dz / d) * step;
    }
  }

  // The weapon's cutting segment in world space (or the limb that is striking, for
  // unarmed moves: whichever hand/foot is farthest from the body)
  private readBlade(w: WeaponDef, eff: string, out: BladeSeg): boolean {
    const rig = this.player.rig;
    if (eff !== 'sword') {
      const model = rig.model;
      if (!model) return false;
      const feet = eff === 'LF' || eff === 'RF';
      const name = `mixamorig${eff[0] === 'L' ? 'Left' : 'Right'}${feet ? 'Foot' : 'Hand'}`;
      const o = model.getObjectByName(name);
      if (!o) return false;
      o.getWorldPosition(out.a);
      const toe = feet ? model.getObjectByName(name.replace('Foot', 'ToeBase')) : null;
      if (toe) toe.getWorldPosition(out.b);
      else out.b.copy(out.a);
      this.bladeRadius = feet ? 0.2 : 0.17;
      return true;
    }
    const spec = BLADE_SEG[w.id];
    const mesh = this.player.weaponMeshes[this.activeWeaponIdx];
    if (!spec || !mesh) return false;
    mesh.localToWorld(out.a.set(0, 0, spec.base));
    mesh.localToWorld(out.b.set(0, 0, spec.tip));
    this.bladeRadius = 0.06;
    return true;
  }

  // Runs every frame of an attack: while a hit window is open the blade segment (and its
  // path since the last frame) is tested against every enemy's body; the first touch is
  // the hit, at the real contact point. Each enemy is hit once per window.
  private stepHitWindows(a: PlayerAct) {
    const sh = a.shot;
    const rig = this.player.rig;
    // the root transform is normally written at the end of the frame - bring it up to
    // date so the blade is read where the character really is now
    rig.root.position.copy(this.player.pos);
    rig.root.rotation.y = this.player.yaw;
    rig.root.updateMatrixWorld(true);
    const w = this.weapons[this.activeWeaponIdx];
    const cur = this.bladeCur;
    if (!this.readBlade(w, a.move?.eff ?? 'sword', cur)) return;
    const prev = this.bladePrevOk ? this.bladePrev : null;
    for (let i = a.windows.length - 1; i >= 0; i--) {
      const win = a.windows[i];
      if (sh.t < win.t0) continue;
      if (!win.began) {
        win.began = true;
        win.heavy || w.id === 'bo' ? sfx.heavy() : sfx.swing();
      }
      this.sweepEnemies(win, prev, cur, a);
      if (this.act !== a) return;
      if (win.ring > 0 && !win.ringDone && sh.t >= (win.t0 + win.t1) / 2) {
        win.ringDone = true;
        this.ringHit(win, a);
        if (this.act !== a) return;
      }
      // the same blade also touches the scenery: sparks off stone, bark chips, a cut bamboo
      this.world.props.sweep(prev, cur, { power: a.kind === 'special' ? 3 : win.heavy ? 2 : 1, edged: w.id !== 'bo' && w.id !== 'karate', token: win, radius: this.bladeRadius });
      if (sh.t > win.t1) a.windows.splice(i, 1);
    }
    this.bladePrev.a.copy(cur.a);
    this.bladePrev.b.copy(cur.b);
    this.bladePrevOk = true;
  }

  private sweepEnemies(win: HitWindow, prev: BladeSeg | null, cur: BladeSeg, a: PlayerAct) {
    const inflate = 0.1 + 0.3 * TUNE.hitAssist + this.bladeRadius;
    for (const e of this.enemies) {
      if (e.dead || win.hits.has(e)) continue;
      const s = this.sizeOf(e);
      if (!sweepVsCapsule(prev, cur, e.pos.x, e.pos.z, e.pos.y + HURT_BOTTOM * s, e.pos.y + HURT_TOP * s, e.r + inflate + win.wide, this.hitPt, false, e.r)) continue;
      this.landSweepHit(e, win, prev, cur);
      if (this.act !== a) return;
    }
  }

  // A whirl catches everyone inside its ring that the staff's path didn't touch (it swings
  // high and wide, so a body just inside its reach could slip between two frames)
  private ringHit(win: HitWindow, a: PlayerAct) {
    const P = this.player;
    for (const e of this.enemies.slice()) {
      if (e.dead || win.hits.has(e)) continue;
      if (Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.r > win.ring) continue;
      this.hitPt.set(e.pos.x, e.pos.y + 1.2 * this.sizeOf(e), e.pos.z);
      this.landSweepHit(e, win, null, null);
      if (this.act !== a) return;
    }
  }

  private landSweepHit(e: EnemyInstance, win: HitWindow, prev: BladeSeg | null, cur: BladeSeg | null) {
    const P = this.player;
    win.hits.add(e);
    const dx = e.pos.x - P.pos.x;
    const dz = e.pos.z - P.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const nx = dx / d;
    const nz = dz / d;
    // knock along a mix of "away from the attacker" and the way the blade was travelling
    let bx = prev && cur ? cur.b.x - prev.b.x : 0;
    let bz = prev && cur ? cur.b.z - prev.b.z : 0;
    const bl = Math.hypot(bx, bz);
    if (bl > 1e-3) {
      bx /= bl;
      bz /= bl;
    } else {
      bx = nx;
      bz = nz;
    }
    let kx = nx * 0.55 + bx * 0.45;
    let kz = nz * 0.55 + bz * 0.45;
    const kl = Math.hypot(kx, kz) || 1;
    kx /= kl;
    kz /= kl;
    this.dbgHits.push({ p: this.hitPt.clone(), t: this.time });
    // a wide swing can cut several enemies, the third onward for less
    const mult = win.hits.size > 2 ? 0.7 : 1;
    this.hitEnemy(e, win.dmg * mult, nx, nz, win.kb, win.heavy, { point: this.hitPt, dirX: kx, dirZ: kz });
  }

  // Throwables leave the off hand (normal throw or the weapon's special volley)
  private throwWeapon(w: WeaponDef, special: boolean) {
    this.player.rig.root.updateMatrixWorld(true);
    (this.player.rig.clip ? this.player.rig.handL : this.player.rig.hand).getWorldPosition(this.tmpH);
    const h = this.tmpH;
    const fx = Math.sin(this.player.yaw);
    const fz = Math.cos(this.player.yaw);
    if (w.kind === 'proj' && !special) {
      const n = w.count || 1;
      const dmg = COMBOS[w.id]?.[0]?.dmg ?? w.dmg[0];
      for (let i = 0; i < n; i++) {
        const a = this.player.yaw + (i - (n - 1) / 2) * (w.spread || 0);
        this.spawnProj({
          type: w.id,
          friendly: true,
          ptMult: w.pointMult || 1,
          pos: new THREE.Vector3(h.x, h.y, h.z),
          vel: new THREE.Vector3(Math.sin(a) * (w.speed || 30), 0, Math.cos(a) * (w.speed || 30)),
          dmg,
          pierce: !!w.pierce,
          life: w.life || 1.2
        });
      }
    } else if (w.kind === 'bomb' && !special) {
      this.spawnProj({
        type: 'bomb',
        friendly: true,
        pos: new THREE.Vector3(h.x, h.y, h.z),
        vel: new THREE.Vector3(fx * 14, 7.5, fz * 14),
        grav: 16,
        dmg: COMBOS.bomb[0].dmg,
        life: 3,
        bomb: true
      });
    } else if (w.id === 'shuriken') {
      for (let i = 0; i < 12; i++) {
        const a = this.player.yaw + (i / 12) * TAU;
        this.spawnProj({
          type: 'shuriken',
          friendly: true,
          sp: true,
          homing: true,
          speed: 18,
          pos: new THREE.Vector3(h.x, h.y, h.z),
          vel: new THREE.Vector3(Math.sin(a) * 18, 0, Math.cos(a) * 18),
          dmg: SPECIAL_MOVES.shuriken.dmg,
          life: 2.2
        });
      }
    } else if (w.id === 'bomb') {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = this.player.yaw + (i - (n - 1) / 2) * 0.3 + rand(-0.05, 0.05);
        this.spawnProj({
          type: 'bomb',
          friendly: true,
          sp: true,
          bomb: true,
          pos: new THREE.Vector3(h.x, h.y + 0.2, h.z),
          vel: new THREE.Vector3(Math.sin(a) * 13, 7 + rand(-1, 2), Math.cos(a) * 13),
          grav: 16,
          dmg: SPECIAL_MOVES.bomb.dmg,
          aoeR: 3.2,
          kb: 8,
          life: 2.5
        });
      }
    }
    sfx.throw();
  }

  private soulsSpecial(w: WeaponDef) {
    const m = SPECIAL_MOVES[w.id];
    if (!m) return;
    this.actQueued = false;
    this.fovKick = Math.min(this.fovKick, -4);
    if (this.settings.cinematicCamera && w.id !== 'bo' && w.id !== 'shuriken' && w.id !== 'bomb') {
      this.punchT = 0;
      this.punchDur = 0.6;
    }
    const speed = (m.speed ?? 1) * TUNE.attackSpeed;
    const opts = { speed, from: m.from, rootMotion: !!m.root, chain: m.chain, cancel: m.cancel, end: m.end, turnUntil: m.hit[0] ?? m.release ?? 0 };
    if (w.id === 'karate') {
      this.playRush(0);
      return;
    }
    if (w.id === 'kunai') {
      // Relâmpago: blink to the target, then cut
      const tg = this.findTarget(14);
      if (!tg) return;
      const dx = tg.pos.x - this.player.pos.x;
      const dz = tg.pos.z - this.player.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      this.player.pos.x = tg.pos.x - (dx / d) * (tg.r + 1.1);
      this.player.pos.z = tg.pos.z - (dz / d) * (tg.r + 1.1);
      this.player.yaw = Math.atan2(dx, dz);
      this.ghosts.spawn(this.player.rig.root, GHOST_DASH);
      sfx.dash();
      const act = this.startAct('special', m.clip, opts, m);
      act?.events.push({
        t: m.hit[0],
        fn: () => {
          if (tg.dead) return;
          const ex = tg.pos.x - this.player.pos.x;
          const ez = tg.pos.z - this.player.pos.z;
          const ed = Math.hypot(ex, ez) || 0.001;
          this.spHit = true;
          this.hitEnemy(tg, m.dmg, ex / ed, ez / ed, m.kb, true);
          this.spHit = false;
          sfx.heavy();
        }
      });
      this.player.atkCd += 0.05;
      return;
    }
    const act = this.startAct('special', m.clip, opts, m);
    if (!act) return;
    this.player.atkCd += 0.05;
    if (w.id === 'bo') {
      // Tornado: the spin clip whirls while updatePlayer ticks the AoE
      this.player.tornado = (m.end - (m.from ?? 0) - 0.1) / speed;
      this.player.torTick = 0;
      sfx.dash();
      return;
    }
    if (m.release !== undefined) {
      act.events.push({ t: m.release, fn: () => this.throwWeapon(w, true) });
      return;
    }
    act.events.push({
      t: m.hit[0],
      fn: () => {
        this.spHit = true;
        if (w.id === 'kama') {
          this.chainSpin = 0.45;
          for (const e of this.enemies) {
            if (e.dead) continue;
            const dx = e.pos.x - this.player.pos.x;
            const dz = e.pos.z - this.player.pos.z;
            const d = Math.hypot(dx, dz) || 0.001;
            if (d < m.range + e.r) this.hitEnemy(e, m.dmg, -dx / d, -dz / d, m.kb, true);
          }
        } else {
          // katana: Corte do Vento - the cut plus a travelling wave
          this.meleeHit(m.range, m.arc, m.dmg, m.kb, true);
          this.slash.geometry = this.slashGeos.katana;
          this.slash.rotation.set(0, this.player.yaw, 0);
          this.slashT = 0;
          this.slashDur = 0.2;
          this.player.rig.root.updateMatrixWorld(true);
          this.player.rig.hand.getWorldPosition(this.tmpH);
          const fx = Math.sin(this.player.yaw);
          const fz = Math.cos(this.player.yaw);
          this.spawnProj({
            type: 'wave',
            friendly: true,
            sp: true,
            pos: new THREE.Vector3(this.tmpH.x, Math.max(0.6, this.tmpH.y - 0.3), this.tmpH.z),
            vel: new THREE.Vector3(fx * 22, 0, fz * 22),
            dmg: 41,
            pierce: true,
            life: 0.8,
            r: 1.5,
            kb: 6,
            noSolid: true
          });
        }
        this.spHit = false;
        sfx.heavy();
      }
    });
  }

  // Punho do Dragão: a flurry of jabs into a spinning kick, each step starting in the
  // previous one's chain window
  private playRush(i: number) {
    const m = RUSH[i];
    const act = this.startAct('special', m.clip, { speed: (m.speed ?? 1) * TUNE.attackSpeed, from: m.from, chain: m.chain, cancel: m.cancel, end: m.end, turnUntil: m.hit[0] }, m);
    if (!act) return;
    this.player.atkCd += 0.05;
    act.events.push({
      t: m.hit[0],
      fn: () => {
        const tg = this.findTarget(3.2);
        if (tg) {
          const dx = tg.pos.x - this.player.pos.x;
          const dz = tg.pos.z - this.player.pos.z;
          const d = Math.hypot(dx, dz) || 0.001;
          this.player.yaw = Math.atan2(dx, dz);
          this.hitEnemy(tg, m.dmg, dx / d, dz / d, m.kb, !!m.heavy);
        }
        m.heavy ? sfx.heavy() : sfx.swing();
      }
    });
    if (i + 1 < RUSH.length) act.onChain = () => this.playRush(i + 1);
  }

  // Runs every frame on the mocap rig: fires due hit frames, starts a buffered combo
  // step inside its window, and releases the character when the move ends
  private stepPlayerAct(dt: number) {
    const a = this.act;
    const ctl = this.player.rig.clip!;
    if (!a) {
      this.player.anim = null;
      return;
    }
    if (ctl.current !== a.shot) {
      this.act = null;
      this.player.anim = null;
      return;
    }
    const sh = a.shot;
    for (let i = 0; i < a.events.length; ) {
      if (sh.t >= a.events[i].t) {
        const ev = a.events.splice(i, 1)[0];
        ev.fn();
        if (this.act !== a) return;
      } else i++;
    }
    this.stepMagnet(a, dt);
    if (a.windows.length) {
      this.stepHitWindows(a);
      if (this.act !== a) return;
    }
    if (a.onChain && sh.t >= a.chainAt) {
      const next = a.onChain;
      a.onChain = undefined;
      next();
      return;
    }
    if (this.actQueued && (a.kind === 'attack' ? sh.t >= a.chainAt : (a.kind === 'deflect' || a.kind === 'block') && sh.t >= a.cancelAt)) {
      this.actQueued = false;
      this.soulsAttack();
      if (this.act !== a) return;
    }
    if (a.kind === 'draw' && this.player.moveAmt > 0.25) {
      this.cancelAct(0.2);
      this.player.anim = null;
      return;
    }
    if (a.kind !== 'death' && sh.t >= a.endAt) {
      this.act = null;
      ctl.stop(0.3);
      this.player.anim = null;
      return;
    }
    const swinging = a.kind === 'attack' || a.kind === 'special' || a.kind === 'deathblow';
    this.player.anim = swinging ? { kind: a.kind, t: sh.t, dur: a.endAt, side: 0 } : null;
  }

  private updatePlayerClip(dt: number) {
    const rig = this.player.rig;
    const ctl = rig.clip!;
    const w = this.weapons[this.activeWeaponIdx];
    const speed = this.player.dash > 0 ? TUNE.moveMaxSpeed * 1.6 : Math.hypot(this.player.vel.x, this.player.vel.z);
    const input = {
      speed,
      runSpeed: TUNE.moveMaxSpeed,
      dirX: 0,
      dirZ: 1,
      guard: this.guarding(),
      air: !this.player.grounded,
      fight: w?.kind === 'karate'
    };
    // While a hit window is open a long frame (30fps phone, a slow frame) is played as
    // several short steps with the blade tested after each: a fast swing moves a metre or
    // more between two frames and would otherwise slip through a target it really crossed
    const act = this.act;
    const steps = act && act.windows.length ? Math.min(8, Math.max(1, Math.ceil(dt * 60))) : 1;
    for (let i = 0; i < steps; i++) {
      ctl.update(dt / steps, input);
      ctl.consumeRoot(this.rootTmp);
      if (this.rootTmp.lengthSq() > 0) {
        const k = this.act?.move?.root ?? 1;
        const c = Math.cos(this.player.yaw);
        const sn = Math.sin(this.player.yaw);
        this.player.pos.x += (this.rootTmp.x * c + this.rootTmp.y * sn) * k;
        this.player.pos.z += (-this.rootTmp.x * sn + this.rootTmp.y * c) * k;
      }
      if (i < steps - 1) {
        if (this.act !== act || !act || !act.windows.length) break;
        this.stepHitWindows(act);
        if (this.act !== act) break;
      }
    }
    this.stepPlayerAct(dt);
  }

  // draw (clip) -> hold at full draw -> loose, the arrow leaving from the bow itself
  // The archer looses its shot. Some shots lead the player's movement (a runner used to
  // dodge every arrow just by moving), damage grows with the wave, and from wave 4 a shot
  // is a short volley: a second (third from wave 8) arrow follows a beat later, fanned off
  // the line. Arrows are still a jolt, not a stagger (see damagePlayer's `light`).
  private fireArrows(e: EnemyInstance, ox: number, oy: number, oz: number) {
    const n = this.wave >= 8 ? 3 : this.wave >= 4 ? 2 : 1;
    const dmg = Math.round((TUNE.arrowDmg + Math.min(4, (this.wave - 1) * 0.5)) * (n > 1 ? 0.8 : 1));
    const speed = 22;
    const loose = (ox: number, oy: number, oz: number, fan: number) => {
      const P = this.player;
      let ax = P.pos.x - ox;
      let az = P.pos.z - oz;
      if (Math.random() < TUNE.arrowLead) {
        const t = (Math.hypot(ax, az) || 1) / speed;
        ax += P.vel.x * t * 0.85;
        az += P.vel.z * t * 0.85;
      }
      const len = Math.hypot(ax, az) || 1;
      ax /= len;
      az /= len;
      const c = Math.cos(fan);
      const sn = Math.sin(fan);
      this.spawnProj({
        type: 'arrow',
        friendly: false,
        pos: new THREE.Vector3(ox, oy, oz),
        vel: new THREE.Vector3((ax * c - az * sn) * speed, 0, (ax * sn + az * c) * speed),
        dmg,
        life: 2,
        owner: e
      });
      sfx.arrow();
    };
    loose(ox, oy, oz, 0);
    const fans = n === 2 ? [(Math.random() < 0.5 ? -1 : 1) * 0.12] : n === 3 ? [-0.12, 0.12] : [];
    fans.forEach((fan, i) => {
      this.timers.push({
        at: this.time + 0.2 * (i + 1),
        fn: () => {
          if (e.dead || e.brokenT > 0 || this.cine) return;
          loose(e.pos.x + Math.sin(e.yaw) * 0.6, oy, e.pos.z + Math.cos(e.yaw) * 0.6, fan);
        }
      });
    });
  }

  private stepArcherShot(e: EnemyInstance, nx: number, nz: number, dt: number) {
    const b = e.bow!;
    const ctl = e.rig.clip!;
    b.t += dt;
    if (b.phase === 'draw') {
      if (ctl.current?.name !== 'draw') {
        b.phase = 'aim';
        b.t = 0;
        this.enemyClip(e, 'aim', { from: 0.15, fadeIn: 0.08, fadeOut: 0.1 });
      }
    } else if (b.phase === 'aim') {
      if (b.t >= ARCHER_AIM_HOLD) {
        b.phase = 'release';
        b.t = 0;
        e.rig.root.updateMatrixWorld(true);
        e.rig.handL.getWorldPosition(this.tmpH);
        this.fireArrows(e, this.tmpH.x + nx * 0.3, this.tmpH.y, this.tmpH.z + nz * 0.3);
        this.enemyClip(e, 'release', { from: 0.12, fadeIn: 0.04 });
      }
    } else if (b.t >= 0.45) {
      e.bow = undefined;
    }
  }

  // A mocap enemy's live blade (or kicking foot) this frame: test it against the player's
  // body; the first touch resolves the strike (dodge / deflect / block / damage) at the
  // real contact point. If the window closes without touching, the swing whiffed.
  private enemyBladeCur = makeSeg();

  private readEnemyBlade(e: EnemyInstance, foot: boolean, out: BladeSeg): boolean {
    if (foot) {
      const model = e.rig.model;
      if (!model) return false;
      // whichever foot is farther from the body is the one being thrown
      let best = -1;
      for (const side of ['Left', 'Right']) {
        const f = model.getObjectByName(`mixamorig${side}Foot`);
        if (!f) continue;
        f.getWorldPosition(this.tmpV);
        const dist = Math.hypot(this.tmpV.x - e.pos.x, this.tmpV.z - e.pos.z);
        if (dist > best) {
          best = dist;
          out.a.copy(this.tmpV);
          const toe = model.getObjectByName(`mixamorig${side}ToeBase`);
          if (toe) toe.getWorldPosition(out.b);
          else out.b.copy(this.tmpV);
        }
      }
      return best >= 0;
    }
    const spec = e.bladeKey ? BLADE_SEG[e.bladeKey] : undefined;
    if (!spec || !e.weapon) return false;
    e.weapon.localToWorld(out.a.set(0, 0, spec.base));
    e.weapon.localToWorld(out.b.set(0, 0, spec.tip));
    return true;
  }

  // The left-hand sword's segment (only the Samurai das Duas Espadas has one)
  private readEnemySecondBlade(e: EnemyInstance, foot: boolean): BladeSeg | null {
    if (foot || !e.weaponL) return null;
    const spec = BLADE_SEG[e.bladeKeyL ?? 'ekatana'];
    const out = this.enemyBladeCurL;
    e.weaponL.localToWorld(out.a.set(0, 0, spec.base));
    e.weaponL.localToWorld(out.b.set(0, 0, spec.tip));
    return out;
  }

  private stepEnemyBlade(e: EnemyInstance, dt: number) {
    const b = e.blade;
    if (!b) return;
    b.t += dt;
    e.rig.root.position.copy(e.pos);
    e.rig.root.rotation.y = e.yaw;
    e.rig.root.updateMatrixWorld(true);
    const cur = this.enemyBladeCur;
    if (!this.readEnemyBlade(e, b.limb === 'foot', cur)) {
      e.blade = undefined;
      return;
    }
    if (TUNE.hitDebug > 0.5) this.enemyBlades.push({ a: cur.a.clone(), b: cur.b.clone() });
    this.enemyTrail(e, cur, b.limb === 'foot', b.prevOk ? b.prev.b : null, dt);
    // enemy swings hit the scenery too (the Oni's great sword shatters lanterns)
    this.world.props.sweep(b.prevOk ? b.prev : null, cur, { power: e.type === 'boss' ? 4 : 1.5, edged: b.limb !== 'foot', token: b, radius: 0.08 });
    const P = this.player;
    // the second sword (Samurai das Duas Espadas) cuts along with the first
    const curL = this.readEnemySecondBlade(e, b.limb === 'foot');
    if (curL) this.enemyTrail(e, curL, false, b.prevLOk ? b.prevL.b : null, dt);
    if (!b.hit && this.state === 'play' && !this.cine) {
      const radius = 0.45 + 0.15 + (b.limb === 'foot' ? 0.2 : 0.06);
      // a sweep the player must jump is decided by height in resolveStrike, so where the
      // blade happens to pass vertically doesn't matter for it
      const flat = b.st.kind === 'sweep';
      const touch = (prev: BladeSeg | null, seg: BladeSeg) => sweepVsCapsule(prev, seg, P.pos.x, P.pos.z, P.pos.y + HURT_BOTTOM, P.pos.y + HURT_TOP, radius, this.hitPt, flat, 0.45);
      if (touch(b.prevOk ? b.prev : null, cur) || (curL && touch(b.prevLOk ? b.prevL : null, curL))) {
        b.hit = true;
        this.dbgHits.push({ p: this.hitPt.clone(), t: this.time });
        if (e.variant === 'raio') this.flashBolt(P.pos.x, P.pos.z, 0xb69cff);
        this.resolveStrike(e, b.st, this.hitPt);
      }
    }
    b.prev.a.copy(cur.a);
    b.prev.b.copy(cur.b);
    b.prevOk = true;
    if (curL) {
      b.prevL.a.copy(curL.a);
      b.prevL.b.copy(curL.b);
      b.prevLOk = true;
    }
    if (b.t >= b.dur) e.blade = undefined;
  }

  // Flinch that matches where the blow came from: a hit from the front snaps the head
  // back, one from behind doubles the body forward, a side hit is a quick recoil
  private reactionClip(e: EnemyInstance): string {
    const toPlayer = Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z);
    const rel = Math.abs(wrap(toPlayer - e.yaw));
    if (rel < 0.9) return e.type === 'archer' ? 'hit1' : 'hit3';
    if (rel > 2.2) return 'hit2';
    return 'hit1';
  }

  // How big an enemy is relative to a standard character: a procedural rig's root scale,
  // or the mocap rig's own sizeScale (its root carries the model's unit conversion too)
  private sizeOf(e: EnemyInstance) {
    return e.rig.sizeScale ?? e.rig.root.scale.x;
  }

  // Mocap enemy reactions: no-ops on the procedural rigs
  private enemyClip(e: EnemyInstance, name: string, o: PlayOptions = {}): OneShot | null {
    return e.rig.clip?.play(name, { fadeIn: 0.1, fadeOut: 0.25, ...o }) ?? null;
  }

  private findTarget(maxD: number): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bs = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - this.player.pos.x;
      const dz = e.pos.z - this.player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      const s = d + Math.abs(wrap(Math.atan2(dx, dz) - this.player.yaw)) * 2.5;
      if (s < bs) {
        bs = s;
        best = e;
      }
    }
    return best;
  }

  private meleeHit(range: number, arc: number, dmg: number, kb: number, heavy: boolean): boolean {
    let any = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - this.player.pos.x;
      const dz = e.pos.z - this.player.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d > range + e.r) continue;
      if (arc < 6.2 && Math.abs(wrap(Math.atan2(dx, dz) - this.player.yaw)) > arc / 2 + 0.2) continue;
      this.hitEnemy(e, dmg, dx / d, dz / d, kb, heavy);
      any = true;
    }
    return any;
  }

  // What an enemy does about a blow that just connected. Blocks (guard up, only builds its
  // posture) were always there; parries (the blade is turned aside, the swing bounces and
  // the enemy answers) and sidesteps (the blow cuts air, then it comes back) are new.
  // Fairness: a committed enemy (winding up / striking), a staggered or broken one never
  // defends; one enemy rests 2.5 s after a parry/sidestep and no two happen within half a
  // second of each other; after 3 blows in a row with no defence the odds climb, so it
  // reads as luck without long droughts or unfair streaks. Specials cut through all of it.
  private rollEnemyDefense(e: EnemyInstance, nx: number, nz: number): 'none' | 'block' | 'parry' | 'dodge' {
    if (this.spHit || e.dead) return 'none';
    const boss = e.type === 'boss';
    if (e.type !== 'samurai' && !boss) return 'none';
    if ((e.dodgeT ?? 0) > 0) return 'dodge'; // still out of reach
    if (e.brokenT > 0 || e.staggerT > 0 || e.strike) return 'none';
    const facing = Math.abs(wrap(Math.atan2(-nx, -nz) - e.yaw)) < 1.15;
    if (!facing) return 'none';
    if (e.guardT > 0) return 'block';
    const k = 1 + Math.min(0.6, (this.wave - 1) * 0.06);
    const elite = !!e.elite;
    let block = (0.22 + Math.min(0.3, this.wave * 0.03)) * TUNE.enemyBlock;
    let parry = TUNE.enemyParry * k * (elite ? 1.4 : 1);
    let dodge = TUNE.enemyDodge * k * (elite ? 0.8 : 1);
    if (boss) {
      block = 0.1 * TUNE.enemyBlock * (e.fury ? 0.6 : 1);
      parry = 0;
      dodge = 0;
    } else if (e.variant === 'brute') {
      // too heavy to parry or sidestep, and it trusts its armour over a guard
      block *= 0.5;
      parry = 0;
      dodge = 0;
    }
    if ((e.defCd ?? 0) > 0 || this.time - this.lastHardDef < 0.5) {
      parry = 0;
      dodge = 0;
    } else {
      const pity = Math.min(0.3, 0.07 * Math.max(0, (e.dry ?? 0) - 2));
      parry += pity * 0.5;
      dodge += pity * 0.5;
    }
    const r = Math.random();
    if (r < parry) return 'parry';
    if (r < parry + dodge) return 'dodge';
    if (r < parry + dodge + block) return 'block';
    return 'none';
  }

  private enemyDefend(e: EnemyInstance, kind: 'block' | 'parry' | 'dodge', dmg: number, nx: number, nz: number, heavy: boolean, hit?: HitInfo) {
    const nl = Math.hypot(nx, nz) || 1;
    const sc = this.sizeOf(e);
    const p = hit ? this.tmpV.copy(hit.point) : this.tmpV.set(e.pos.x - (nx / nl) * 0.6, e.pos.y + 1.35 * sc, e.pos.z - (nz / nl) * 0.6);
    const labelY = e.pos.y + (e.type === 'boss' ? 5.6 : 2.9);
    e.dry = 0;
    if (kind === 'block') {
      e.mode = 'guard';
      e.guardT = 0.9;
      e.modeT = 0;
      e.flash = 0.05;
      this.impacts.spawn(p, IMPACT_BLOCK, 1.2, 0.12);
      this.emitParticles(p.x, p.y, p.z, 12, 0xffc27a, 6, 1.5, 16, 0.25);
      sfx.block();
      this.spawnLabel(e.pos.x, labelY, e.pos.z, 'BLOQUEOU', '#a9bcd8', 0.9);
      this.player.atkCd += 0.1;
      this.enemyClip(e, 'hit1', { speed: 1.5, to: 0.8, fadeIn: 0.05 });
      this.addEnemyPosture(e, dmg * 1.35 * TUNE.blockPosture * (heavy ? 1.4 : 1));
      return;
    }
    if (kind === 'parry') {
      e.defCd = 2.5;
      this.lastHardDef = this.time;
      e.guardT = 0;
      this.impacts.spawn(p, IMPACT_DEFLECT, 2.3, 0.2);
      this.emitParticles(p.x, p.y, p.z, 26, 0xffb347, 9, 2.2, 18, 0.32);
      sfx.clang();
      this.spawnLabel(e.pos.x, labelY, e.pos.z, 'APAROU!', '#ffb347', 1.15);
      this.shake = Math.max(this.shake, 0.2);
      this.fovKick = Math.min(this.fovKick, -3);
      // both bodies freeze for a beat; the swing is spent and the combo broken
      e.rig.clip?.pause(0.12);
      this.parryRecoil();
      this.addEnemyPosture(e, dmg * 0.4);
      // ... and the enemy answers with a quick strike (its wind-up is the warning)
      if (e.brokenT <= 0 && !this.cine) {
        e.mode = 'attack';
        e.modeT = 0;
        e.comboLeft = 1;
        e.t = 1;
        e.cd2 = 0.3;
        e.token = true;
      }
      return;
    }
    // sidestep: away from the attacker or across, then back in with a counter
    e.defCd = 2.5;
    this.lastHardDef = this.time;
    e.dodgeT = 0.3;
    const back = Math.random() < 0.5;
    const side = Math.random() < 0.5 ? 1 : -1;
    e.dodgeX = back ? nx / nl : (-nz / nl) * side;
    e.dodgeZ = back ? nz / nl : (nx / nl) * side;
    this.cancelStrike(e);
    this.spawnLabel(e.pos.x, labelY, e.pos.z, 'ESQUIVOU', '#8fe0c8', 1);
    this.puff(e.pos.x, e.pos.z, 6, 2.2, e.dodgeX, e.dodgeZ);
    sfx.dash();
  }

  // A parried swing bounces: the rest of the move's hits are gone, the combo is broken,
  // and the Rōnin freezes for a beat in the recoil
  private parryRecoil() {
    const a = this.act;
    if (a && a.kind === 'attack') {
      a.windows = a.windows.filter((w) => w.began);
      a.chainAt = 99;
      a.onChain = undefined;
      this.actQueued = false;
    }
    this.player.rig.clip?.pause(0.16);
    this.player.rig.clip?.play('hit3', { from: 0.12, to: 0.5, speed: 1.6, weight: 0.4, fadeIn: 0.04, fadeOut: 0.15 });
    this.player.atkCd += 0.2;
  }

  public hitEnemy(e: EnemyInstance, dmg: number, nx: number, nz: number, kb: number, heavy: boolean, hit?: HitInfo) {
    if (e.dead) return;
    // Samurai (and, rarely, the Oni) fight back: a blow that connects may be blocked,
    // parried or sidestepped instead of landing - see rollEnemyDefense
    const defense = this.rollEnemyDefense(e, nx, nz);
    if (defense !== 'none') {
      this.enemyDefend(e, defense, dmg, nx, nz, heavy, hit);
      return;
    }
    e.dry = (e.dry ?? 0) + 1;
    const rolled = this.rollDamage(dmg * this.player.dmgMult, true);
    dmg = rolled.dmg;
    e.hp -= dmg;
    e.flash = 0.14;
    {
      const nl = Math.hypot(nx, nz) || 1;
      const sc = this.sizeOf(e);
      if (hit) this.tmpV.copy(hit.point);
      else this.tmpV.set(e.pos.x - (nx / nl) * e.r * 0.7, e.pos.y + 1.25 * sc, e.pos.z - (nz / nl) * e.r * 0.7);
      const crit = rolled.tier === 'crit';
      const size = (crit ? 1.9 : heavy ? 1.55 : 1.1) * (e.type === 'boss' ? 1.4 : 1);
      this.impacts.spawn(this.tmpV, crit ? IMPACT_CRIT : heavy ? IMPACT_HEAVY : IMPACT_NORMAL, size);
      this.emitParticles(this.tmpV.x, this.tmpV.y, this.tmpV.z, crit ? 16 : 9, 0xffd49a, 7, 1.5, 16, 0.24);
      if (crit || heavy) this.fovKick = Math.min(this.fovKick, -3);
    }

    const labelY = e.pos.y + (e.type === 'boss' ? 5.6 : 2.9);
    const labelColor = rolled.tier === 'crit' ? '#ffd166' : rolled.tier === 'weak' ? '#b9b0c8' : '#efe6d2';
    this.spawnLabel(
      e.pos.x + rand(-0.25, 0.25),
      labelY,
      e.pos.z + rand(-0.25, 0.25),
      rolled.tier === 'crit' ? `${dmg}!` : `${dmg}`,
      labelColor,
      rolled.tier === 'crit' ? 1.4 : rolled.tier === 'weak' ? 0.85 : 1
    );
    const res = e.type === 'boss' ? 0.2 : 1;
    e.kb.x += (hit ? hit.dirX : nx) * kb * res;
    e.kb.z += (hit ? hit.dirZ : nz) * kb * res;
    // heavy blows interrupt an ordinary samurai wind-up (the Oni and perilous moves shrug them off)
    if (heavy && e.type === 'archer' && e.rig.clip && e.hp > dmg) {
      // a heavy blow knocks the archer out of its shot or kick
      e.bow = undefined;
      e.kick = undefined;
      e.blade = undefined;
      e.staggerT = 0.4;
      this.enemyClip(e, this.reactionClip(e), { speed: 1.1, fadeIn: 0.05 });
    }
    if (heavy && e.type === 'samurai' && e.variant !== 'brute' && e.strike && !e.strike.perilous) {
      this.cancelStrike(e);
      this.enemyClip(e, this.reactionClip(e), { speed: 1.4, to: 0.95, fadeIn: 0.05 });
      e.staggerT = 0.35;
      e.mode = 'recover';
      e.modeT = 0;
      e.token = false;
    }

    // Atualiza sequência de golpes (Hit Combo Streak)
    if (this.player.hitComboT > 0) {
      this.player.hitCombo++;
    } else {
      this.player.hitCombo = 1;
    }
    this.player.hitComboT = 1.6;

    const isCombo = this.player.combo >= 1 || this.player.hitCombo >= 2 || this.player.killCombo > 0;
    const isComboFinisher = this.player.combo === 2 || this.player.hitCombo % 3 === 0 || heavy;

    // Emissão de sangue realista com spray direcional e leque de corte
    const bloodCount = isComboFinisher ? 38 : isCombo ? 26 : heavy ? 22 : 14;
    if (hit) this.emitBlood(hit.point.x, hit.point.y, hit.point.z, hit.dirX, hit.dirZ, bloodCount, isCombo, isComboFinisher);
    else this.emitBlood(e.pos.x, e.pos.y + 1.1, e.pos.z, nx, nz, bloodCount, isCombo, isComboFinisher);
    if (heavy || isComboFinisher || Math.random() < 0.5) {
      const off = rand(0.5, 1.3);
      this.decals.spawn(e.pos.x + nx * off, e.pos.z + nz * off, nx, nz, heavy || isComboFinisher ? rand(1.1, 1.5) : rand(0.7, 1));
    }

    // Hitstop cinemático e tremor de impacto proporcional ao combo
    if (hit && this.player.rig.clip) {
      // hit pause: only the two bodies involved hang for a beat, the rest of the world
      // keeps moving (a global slowdown is kept for the deathblow)
      const beat = isComboFinisher ? 0.09 : isCombo ? 0.065 : 0.05;
      this.player.rig.clip.pause(beat);
      e.rig.clip?.pause(beat * 1.3);
    } else {
      const now = performance.now();
      if (now - this.lastHS > 90) {
        this.hitstop = isComboFinisher ? 0.08 : isCombo ? 0.05 : 0.03;
        this.lastHS = now;
      }
    }
    this.shake = Math.max(this.shake, isComboFinisher ? 0.32 : isCombo ? 0.22 : 0.12);

    if (isComboFinisher) {
      sfx.comboSlice();
    } else if (isCombo) {
      sfx.sliceHit();
    } else {
      sfx.hit();
    }

    this.callbacks.onComboChange(Math.max(this.player.hitCombo, this.player.killCombo));

    if (e.hp <= 0) this.killEnemy(e);
    else {
      // a flinch layered over whatever the samurai is doing (a full reaction would
      // cancel its footwork on every hit)
      if (e.rig.clip && !e.strike && e.brokenT <= 0 && e.staggerT <= 0 && e.variant !== 'brute') {
        this.enemyClip(e, this.reactionClip(e), { from: 0.1, to: 0.62, speed: 1.4, weight: 0.5, fadeIn: 0.05, fadeOut: 0.18 });
      }
      this.addEnemyPosture(e, dmg * 0.55 * (heavy ? 1.5 : 1));
    }
  }

  private killEnemy(e: EnemyInstance) {
    e.dead = true;
    e.deathT = 0;
    e.bow = undefined;
    e.kick = undefined;
    this.updateBowFx(e);
    this.enemyClip(e, Math.random() < 0.5 ? 'death' : 'death2', { hold: true, fadeIn: 0.08 });
    e.bar.visible = false;
    e.token = false;
    this.cancelStrike(e);

    this.player.kills++;
    const fodder = isFodder(e);
    if (e.type === 'boss') {
      this.addHonor('boss', HONOR.boss);
      this.bossKills++;
    } else this.addHonor('kill', fodder ? 0.2 : HONOR.kill[e.type] ?? 1);
    if (e.elite) this.addHonor('mod', HONOR.elite);
    const pts = e.type === 'boss' ? 1200 : e.type === 'archer' ? 120 : fodder ? 20 : 80;
    this.player.score += pts;
    this.callbacks.onScoreChange(this.player.score);

    this.player.killCombo = this.player.killComboT > 0 ? this.player.killCombo + 1 : 1;
    this.player.killComboT = 2.2;
    this.player.bestCombo = Math.max(this.player.bestCombo, Math.max(this.player.killCombo, this.player.hitCombo));
    this.callbacks.onComboChange(Math.max(this.player.killCombo, this.player.hitCombo));

    this.addXp(pts);

    // Erupção de sangue estelar ao eliminar o inimigo
    this.emitBlood(e.pos.x, e.pos.y + 1.2, e.pos.z, 0, 0, e.type === 'boss' ? 65 : fodder ? 18 : 42, true, true);
    {
      const a = rand(0, TAU);
      this.decals.spawn(e.pos.x, e.pos.z, Math.sin(a), Math.cos(a), e.type === 'boss' ? 2.6 : 1.8);
    }
    this.emitParticles(e.pos.x, 1, e.pos.z, fodder ? 10 : 28, 0x9a88c0, 5, 3, 4, 1);

    // Bosses always drop a scroll; other kills roll against the loadout-proportional rate
    if (fodder) {
      if (Math.random() < 0.04) this.dropPickup(e.pos.x, e.pos.z);
    } else if (e.type === 'boss' || e.elite || this.rollScroll()) this.dropScroll(e.pos.x, e.pos.z);
    else if (Math.random() < 0.2) this.dropPickup(e.pos.x, e.pos.z);
  }

  private addXp(pts: number) {
    this.player.xp += pts;
    while (this.player.xp >= this.player.xpNext) {
      this.player.xp -= this.player.xpNext;
      this.player.level++;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
      this.player.xpNext = Math.round(this.player.xpNext * 1.35);
      sfx.levelup();
      // the reward is a choice: three cards, one kept (opened once the moment has passed)
      this.picksPending++;
      this.pickDelay = Math.max(this.pickDelay, 0.7);
      this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
    }
    this.callbacks.onXpChange(this.player.xp, this.player.xpNext, this.player.level);
  }

  private healsPerWave() {
    return 3 + this.metaBonus.heals + (this.cardLv.cabaca ?? 0);
  }

  private dashCost() {
    return Math.max(8, DASH_COST - 3 * (this.cardLv.passo ?? 0));
  }

  private specialDuration() {
    return SPECIAL_DURATION + 5 * (this.cardLv.pergaminho ?? 0);
  }

  /** Adds Honra to the run (Espólio scales it); returns what was actually added. */
  private addHonor(kind: keyof typeof this.honor, base: number): number {
    const v = base * (1 + 0.15 * (this.cardLv.espolio ?? 0));
    this.honor[kind] += v;
    this.callbacks.onHonorChange?.(this.honorTotal());
    return v;
  }

  private honorTotal() {
    const h = this.honor;
    return Math.round(h.kill + h.finish + h.wave + h.boss + h.rank + h.mod);
  }

  private makeSummary(): RunSummary {
    const h = this.honor;
    return {
      score: Math.round(this.player.score),
      wave: this.wave,
      level: this.player.level,
      kills: this.player.kills,
      bestCombo: this.player.bestCombo,
      finishers: this.finishers,
      deflects: this.deflectsTotal,
      flawless: this.flawless,
      bossKills: this.bossKills,
      modWaves: this.modWaves,
      bestRank: (['D', 'C', 'B', 'A', 'S'] as const)[this.bestRank],
      honor: { kill: Math.round(h.kill), finish: Math.round(h.finish), wave: Math.round(h.wave), boss: Math.round(h.boss), rank: Math.round(h.rank), mod: Math.round(h.mod), total: this.honorTotal() },
      cards: { ...this.cardLv },
      ranks: [...this.ranks]
    };
  }

  /** The finished (or abandoned) run's results, once; null if it was already collected. */
  public takeRunSummary(): RunSummary | null {
    if (!this.runOpen) return null;
    this.runOpen = false;
    return this.practice ? null : this.makeSummary();
  }

  // Grade of the wave just cleared: staying unhit matters most, then speed, finishers, parries
  private waveRank(): 'S' | 'A' | 'B' | 'C' | 'D' {
    const w = this.waveStat;
    let pts = 0;
    if (!this.player.tookDamage) pts += 2;
    // (each one that waits its turn adds the time it takes to step in and walk up)
    if (this.time - w.t0 <= 12 + 10 * w.enemies + 6 * w.queued) pts += 1;
    if (w.finishers >= Math.ceil(w.enemies * 0.4)) pts += 1;
    if (w.deflects >= 3) pts += 1;
    return pts >= 5 ? 'S' : pts === 4 ? 'A' : pts === 3 ? 'B' : pts === 2 ? 'C' : 'D';
  }

  private openCardOffer() {
    const ids = drawCards(this.cardLv);
    if (!ids.length) {
      // every card maxed: the level still pays out
      this.picksPending = 0;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
      this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
      return;
    }
    this.cardOffer = ids;
    // nothing may stay held down under the overlay
    this.input.attackHeld = false;
    this.input.guardHeld = false;
    this.callbacks.onCardOffer?.(describeOffer(ids, this.cardLv));
  }

  public pickCard(id: string) {
    if (!this.cardOffer || !this.cardOffer.includes(id)) return;
    const def = cardById(id);
    if (!def) return;
    const lvl = (this.cardLv[id] ?? 0) + 1;
    if (lvl > def.max) return;
    this.cardLv[id] = lvl;
    const P = this.player;
    if (id === 'lamina') P.dmgMult += 0.07;
    else if (id === 'vigor') {
      P.maxHp += 10;
      P.hp = Math.min(P.maxHp, P.hp + 10);
      this.callbacks.onHpChange(P.hp, P.maxHp);
    } else if (id === 'folego') {
      P.maxSt += 12;
      P.st = Math.min(P.maxSt, P.st + 12);
      this.callbacks.onStaminaChange(P.st, P.maxSt);
    } else if (id === 'cabaca') {
      P.heals++;
      this.callbacks.onHealsChange?.(P.heals);
    }
    this.cardOffer = null;
    this.picksPending = Math.max(0, this.picksPending - 1);
    this.pickDelay = 0.35;
    this.callbacks.onCardOffer?.(null);
    sfx.special();
  }

  // Per-frame bookkeeping for the run: the Herança scroll, queued level-up cards and the
  // boss's life bar
  private stepProgress(dt: number) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].at) this.timers.splice(i, 1)[0].fn();
    }
    if (this.heritageT > 0) {
      this.heritageT -= dt;
      if (this.heritageT <= 0) {
        const i = this.loadoutPool()[0];
        const w = this.weapons[i];
        if (w && SPECIALS[w.id]) {
          this.player.special[i] = this.metaBonus.startSpecial;
          this.callbacks.onSpecialsUpdate({ ...this.player.special });
          this.callbacks.onWaveChange(this.wave, 'Herança', `${w.name}: especial por ${this.metaBonus.startSpecial}s`);
        }
      }
    }
    if (this.picksPending > 0 && !this.cardOffer && !this.cine && this.deadT < 0 && this.player.hp > 0) {
      this.pickDelay -= dt;
      if (this.pickDelay <= 0) this.openCardOffer();
    }
    const boss = this.enemies.find((e) => e.type === 'boss' && !e.dead);
    const key = boss ? Math.round((Math.max(0, boss.hp) / boss.maxHp) * 200) + (boss.fury ? 1000 : 0) : -1;
    if (key !== this.lastBossKey) {
      this.lastBossKey = key;
      this.callbacks.onBossChange?.(boss ? { hp: Math.max(0, boss.hp), max: boss.maxHp, fury: !!boss.fury, name: BOSS_NAME[boss.variant ?? 'oni'] } : null);
    }
  }

  private loadoutPool(): number[] {
    return this.loadout && this.loadout.length ? this.loadout : this.weapons.map((_, i) => i);
  }

  private rollScroll(): boolean {
    const rate = Math.min(0.5, SCROLL_RATE_PER_WEAPON * this.loadoutPool().length);
    this.killsSinceScroll++;
    if (Math.random() < Math.min(1, prdConstant(rate) * this.killsSinceScroll)) {
      this.killsSinceScroll = 0;
      return true;
    }
    return false;
  }

  // Only loaded weapons get specials (a charge on an unbound weapon would be unusable).
  // Prefers a weapon with no special running or scroll already waiting, then the one
  // given the fewest scrolls this run, so both buttons get specials evenly.
  private pickScrollWeapon(): number {
    const pool = this.loadoutPool();
    const pending = new Set(this.scrolls.map((s) => s.w));
    const score = (i: number) =>
      (this.player.special[i] > 0 || pending.has(i) ? 1000 : 0) + (this.scrollsGiven[i] || 0);
    const best = Math.min(...pool.map(score));
    const cands = pool.filter((i) => score(i) === best);
    return cands[Math.floor(Math.random() * cands.length)];
  }

  // Weapon glyph badge floating over a scroll so the player knows which special it grants
  private getGlyphTexture(w: WeaponDef): THREE.CanvasTexture {
    let tex = this.glyphTex.get(w.id);
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(64, 64, 56, 0, TAU);
      ctx.fillStyle = 'rgba(22,18,31,0.85)';
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#ffd166';
      ctx.stroke();
      ctx.font = 'bold 66px "Zen Kaku Gothic New", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166';
      ctx.fillText(w.glyph, 64, 68);
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glyphTex.set(w.id, tex);
    return tex;
  }

  private dropScroll(x: number, z: number) {
    const wIdx = this.pickScrollWeapon();
    this.scrollsGiven[wIdx] = (this.scrollsGiven[wIdx] || 0) + 1;
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.62, 10).rotateZ(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xf3e2b3 })
      )
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.78, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 })
    );
    const glyph = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.getGlyphTexture(this.weapons[wIdx]),
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false
      })
    );
    glyph.scale.set(0.95, 0.95, 1);
    glyph.position.set(x, 1.75, z);
    g.position.set(x, 0.9, z);
    ring.position.set(x, 0.06, z);
    this.scene.add(g, ring, glyph);
    this.scrolls.push({ g, ring, glyph, x, z, t: 0, w: wIdx });
  }

  private removeScroll(i: number) {
    const k = this.scrolls[i];
    this.scene.remove(k.g, k.ring, k.glyph);
    k.glyph.material.dispose();
    this.scrolls.splice(i, 1);
  }

  private dropPickup(x: number, z: number) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshBasicMaterial({ color: 0x6fe0b0 })
    );
    m.position.set(x, 0.8, z);
    this.scene.add(m);
    this.pickups.push({ m, x, z, t: 0 });
  }

  public damagePlayer(dmg: number, nx: number, nz: number, light?: boolean) {
    if (this.player.inv > 0 || this.state !== 'play') return;
    const dmgIn = dmg;
    const rolled = this.rollDamage(dmg, false); // incoming damage: variance + label only, no crit bonus
    dmg = rolled.dmg;
    this.player.hp = Math.max(0, this.player.hp - dmg);
    this.player.inv = 0.6;
    this.hurtFx = 1;
    if (this.player.healT > 0 && !this.player.healDone) {
      // interrupted mid-drink: the sip is lost
      this.player.healT = 0;
      this.player.anim = null;
    }
    if (this.player.rig.clip && this.player.hp > 0 && this.act?.kind !== 'stagger') {
      if (light ?? dmgIn <= LIGHT_HIT) {
        // a jolt layered over whatever he's doing (a sip still spills, though)
        if (this.act?.kind === 'heal') this.cancelAct(0.15);
        this.player.rig.clip.play('hit3', { from: 0.12, to: 0.6, speed: 1.5, weight: 0.45, fadeIn: 0.04, fadeOut: 0.15 });
      } else {
        // a real blow knocks him out of whatever he was doing
        this.actQueued = false;
        this.startAct('hurt', Math.random() < 0.5 ? 'hit3' : 'hit2', { speed: 1.35, to: 1.1, cancel: 0.5, end: 1.0, fadeIn: 0.06 });
      }
    }
    this.impacts.spawn(this.tmpV.set(this.player.pos.x, this.player.pos.y + 1.3, this.player.pos.z), IMPACT_HURT, 1.4, 0.18);
    this.player.dashInv = false;
    this.player.killCombo = 0;
    this.player.hitCombo = 0;
    this.player.hitComboT = 0;
    this.callbacks.onComboChange(0);
    this.player.tookDamage = true;
    this.player.kb.x += nx * 9;
    this.player.kb.z += nz * 9;
    this.shake = Math.max(this.shake, 0.35);
    // Emissão de sangue do jogador ao sofrer golpe
    this.emitBlood(this.player.pos.x, this.player.pos.y + 1.1, this.player.pos.z, -nx, -nz, 18, false, true);
    this.decals.spawn(this.player.pos.x - nx * 0.7, this.player.pos.z - nz * 0.7, -nx, -nz, 0.8);
    this.spawnLabel(
      this.player.pos.x,
      this.player.pos.y + 2.3,
      this.player.pos.z,
      `-${dmg}`,
      rolled.tier === 'weak' ? '#d99a9a' : '#ff5a5a',
      rolled.tier === 'weak' ? 0.85 : 1
    );
    sfx.hurt();
    this.callbacks.onHpChange(this.player.hp, this.player.maxHp);

    if (this.player.hp <= 0) {
      if (this.player.rig.clip) {
        // play the fall out before the game-over screen (see updatePlayerMovementAndCamera)
        this.actQueued = false;
        this.input.guardHeld = false;
        this.player.inv = 99;
        this.deadT = 0;
        this.startAct('death', Math.random() < 0.5 ? 'death' : 'death2', { hold: true, fadeIn: 0.12 });
        return;
      }
      this.gameOver();
    }
  }

  private gameOver() {
    this.state = 'over';
    const summary = this.makeSummary();
    this.runOpen = false;
    this.cardOffer = null;
    this.picksPending = 0;
    this.callbacks.onCardOffer?.(null);
    this.callbacks.onBossChange?.(null);
    this.callbacks.onGameOver(Math.round(this.player.score), this.wave, this.player.level, this.player.kills, this.player.bestCombo, summary);
  }

  // ---------------------------------------------------------------------------
  // Guard, deflect, posture and deathblow (Sekiro-style combat)
  // ---------------------------------------------------------------------------
  public guardDown() {
    if (this.state !== 'play' || this.player.healT > 0 || this.player.hp <= 0) return;
    this.input.guardHeld = true;
    // mocap rig: a committed swing can't be turned into a parry, only its recovery
    if (!this.freeToCancel()) return;
    if (this.act && this.act.kind !== 'deflect' && this.act.kind !== 'block') this.cancelAct(0.1);
    this.player.guardPressT = this.time;
  }

  public guardUp() {
    this.input.guardHeld = false;
  }

  // Healing gourd: a short drink that leaves you open, three sips per wave
  public heal() {
    const P = this.player;
    if (this.state !== 'play' || P.heals <= 0 || P.healT > 0 || P.hp <= 0) return;
    if (P.staggerT > 0 || this.cine || P.hp >= P.maxHp) return;
    if (this.act && this.act.kind !== 'draw') {
      // mid-move: the press waits for the recovery (same rule as a dodge), not lost
      if (!this.freeToCancel()) {
        this.healBufT = HEAL_BUFFER;
        return;
      }
      this.cancelAct(0.1);
    }
    this.healBufT = 0;
    P.heals--;
    P.healHalf = false;
    P.healDone = false;
    if (P.rig.clip) {
      // the "power up" clip's head-back moment, played fast
      P.healDur = (2.1 - 0.3) / HEAL_SPEED;
      P.healT = P.healDur;
      this.startAct('heal', 'powerUp', { from: 0.3, to: 2.1, speed: HEAL_SPEED, cancel: 99, end: 2.1, fadeIn: 0.1 });
    } else {
      P.healDur = 0.85;
      P.healT = P.healDur;
      P.anim = { kind: 'drink', t: 0, dur: 0.85, side: 0 };
    }
    this.input.guardHeld = false;
    this.callbacks.onHealsChange?.(P.heals);
  }

  // One half of the sip's healing
  private healPart(amt: number, first: boolean) {
    const P = this.player;
    P.hp = Math.min(P.maxHp, P.hp + amt);
    this.callbacks.onHpChange(P.hp, P.maxHp);
    this.emitParticles(P.pos.x, P.pos.y + 1.2, P.pos.z, first ? 26 : 14, 0x7affb0, 3, 2.5, -1, 0.9);
    this.spawnLabel(P.pos.x, P.pos.y + 2.4, P.pos.z, `+${amt}`, '#7affb0', 1.1);
    if (first) sfx.heal();
  }

  private addPlayerPosture(v: number) {
    this.player.posture = Math.min(PLAYER_MAX_POSTURE, this.player.posture + v);
    this.player.postureT = 0;
  }

  private faceEnemy(e: EnemyInstance) {
    this.player.yaw = Math.atan2(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
  }

  // A regular attack never adjusted player.yaw at all - it just swung whichever way the
  // player already happened to be facing (movement input is the only thing that ever
  // turns the character - see updatePlayerMovementAndCamera), so an enemy standing beside
  // or behind the player at the moment of the swing reads as "attacking the wrong way"
  // even though the hit itself still lands via meleeHit's own arc check. This nudges yaw
  // toward the nearest in-range enemy roughly ahead of the player - restricted to a wide
  // front cone (not a full lock-on turning to anything anywhere) so it reads as aim
  // assist, not the character spinning to face something the player wasn't aiming at -
  // and only a partial turn (turnTo's own proportional step, not a hard snap like
  // faceEnemy) so it doesn't reintroduce the instant-turn popping this session's camera
  // work already moved away from.
  private autoFaceNearestEnemyForAttack(range: number) {
    const facingX = Math.sin(this.player.yaw);
    const facingZ = Math.cos(this.player.yaw);
    const FRONT_CONE_COS = Math.cos((100 * Math.PI) / 180);
    let best: EnemyInstance | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - this.player.pos.x;
      const dz = e.pos.z - this.player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist - e.r > range) continue;
      const dot = (facingX * dx + facingZ * dz) / (dist || 1);
      if (dot < FRONT_CONE_COS) continue;
      if (dist < bestDist) { bestDist = dist; best = e; }
    }
    if (!best) return;
    const targetYaw = Math.atan2(best.pos.x - this.player.pos.x, best.pos.z - this.player.pos.z);
    this.player.yaw = turnTo(this.player.yaw, targetYaw, 0.7);
  }

  private addEnemyPosture(e: EnemyInstance, v: number) {
    if (e.dead || e.brokenT > 0) return;
    e.posture += v;
    e.postureT = 0;
    if (e.posture >= e.maxPosture) this.breakPosture(e);
  }

  private breakPosture(e: EnemyInstance) {
    e.posture = e.maxPosture;
    e.brokenT = e.type === 'boss' ? 2.8 : 3.4;
    e.mode = 'broken';
    e.modeT = 0;
    this.cancelStrike(e);
    e.token = false;
    e.anim = undefined;
    e.bow = undefined;
    e.kick = undefined;
    // doubled over, held there until the posture recovers or a deathblow lands
    this.enemyClip(e, 'hit2', { to: 0.62, hold: true, fadeIn: 0.08 });
    sfx.postureBreak();
    this.impacts.spawn(this.tmpV.set(e.pos.x, e.pos.y + 1.5 * this.sizeOf(e), e.pos.z), IMPACT_DEFLECT, 2.6, 0.3);
    this.shake = Math.max(this.shake, 0.25);
    this.spawnLabel(e.pos.x, e.pos.y + 3.1 * this.sizeOf(e), e.pos.z, 'POSTURA!', '#ff5a3a', 1.2);
  }

  private cancelStrike(e: EnemyInstance) {
    e.blade = undefined;
    e.strike = undefined;
    e.windup = 0;
    if (e.tele) e.tele.visible = false;
    if (e.danger) e.danger.visible = false;
  }

  private tokensInUse() {
    let n = 0;
    for (const o of this.enemies) if (!o.dead && o.token && o.type !== 'boss') n++;
    return n;
  }

  private maxTokens() {
    return this.wave <= 2 ? 1 : this.wave <= 5 ? 2 : 3;
  }

  // The moves of the named fighters: the Rōnin's own clips, in each one's style. The opening
  // move of a chain is slower (readable); the rest follow quickly.
  private fighterStrike(e: EnemyInstance, first: boolean, last: boolean) {
    const sp = first ? 0.8 : 1;
    type FS = { kind: StrikeKind; clip: string; hit: number; from?: number; speed: number; dmg: number; reach: number; perilous: boolean; limb?: 'foot' };
    const r = Math.random();
    switch (e.variant) {
      case 'shinobi': {
        // fast cuts and stabs; now and then the sliding cut (jump it)
        if (last && r < 0.3) return { kind: 'sweep', clip: 'slideAttack', hit: 1.43, from: 0.95, speed: 1, dmg: 14, reach: 3.3, perilous: true } as FS;
        if (r < 0.4) return { kind: 'slash', clip: 'eSwordAttack', hit: 0.52, speed: 1.45 * sp, dmg: 11, reach: 3, perilous: false } as FS;
        return { kind: 'slash', clip: 'eSwordSlash', hit: 0.7, from: 0.12, speed: 1.7 * sp, dmg: 9, reach: 2.4, perilous: false } as FS;
      }
      case 'raio': {
        // Wolverine-style: claw swipes in quick left-right chains, ending in a berserk spin
        // (jump it) or a kick
        if (last) {
          if (r < 0.45) return { kind: 'sweep', clip: 'spin', hit: 0.43, from: 0.1, speed: 1, dmg: 16, reach: 3.1, perilous: true } as FS;
          return { kind: 'slash', clip: 'kick1', hit: 0.68, from: 0.15, speed: 1.7 * sp, dmg: 12, reach: 2.6, perilous: false, limb: 'foot' } as FS;
        }
        const step = e.t % 3;
        if (step === 0) return { kind: 'slash', clip: 'jabL', hit: 0.33, speed: 1.75 * sp, dmg: 9, reach: 2.5, perilous: false } as FS;
        if (step === 1) return { kind: 'slash', clip: 'jabR', hit: 0.25, speed: 1.75 * sp, dmg: 9, reach: 2.5, perilous: false } as FS;
        return { kind: 'slash', clip: 'cross', hit: 0.28, speed: 1.6 * sp, dmg: 12, reach: 2.6, perilous: false } as FS;
      }
      case 'monk': {
        // the staff's whirl now and then (jump it); the usual cuts and jabs otherwise
        if (last && r < 0.35) return { kind: 'sweep', clip: 'spin', hit: 0.43, from: 0.1, speed: 0.95, dmg: 13, reach: 3.6, perilous: true } as FS;
        return null;
      }
      case 'nito': {
        // two blades: wide, quick cuts in long chains, and a spin with both (jump it)
        if (last && r < 0.4) return { kind: 'sweep', clip: 'spin', hit: 0.43, from: 0.1, speed: 0.95, dmg: 15, reach: 3.1, perilous: true } as FS;
        if (r < 0.35) return { kind: 'slash', clip: 'attack', hit: 0.5, speed: 1.3 * sp, dmg: 12, reach: 2.7, perilous: false } as FS;
        return { kind: 'slash', clip: 'eSwordSlash', hit: 0.7, from: 0.12, speed: 1.5 * sp, dmg: 11, reach: 2.7, perilous: false } as FS;
      }
    }
    return null;
  }

  private startStrike(e: EnemyInstance, first: boolean) {
    const boss = e.type === 'boss';
    const last = e.comboLeft <= 1;
    const brute = e.variant === 'brute';
    const monk = e.variant === 'monk';
    // the Brutamontes always ends a chain with a slow sweep to jump; the Monge jabs
    const perilChance = boss ? (e.fury ? 0.45 : 0.35) : isFodder(e) ? 0 : brute ? 1 : monk ? 0.3 : this.wave >= 2 ? 0.28 : 0.1;
    let kind: StrikeKind = boss ? 'smash' : 'slash';
    let perilous = false;
    if (last && (e.forcePeril || Math.random() < perilChance)) {
      e.forcePeril = false;
      perilous = true;
      kind = boss || brute ? 'sweep' : monk ? 'thrust' : Math.random() < 0.5 ? 'thrust' : 'sweep';
    }
    const windup = boss ? (kind === 'sweep' ? 0.85 : first ? 0.62 : 0.46) : perilous ? 0.64 : first ? 0.46 : 0.32;
    let reach = boss ? (kind === 'sweep' ? 4.6 : 3.9) : brute ? (kind === 'sweep' ? 3.7 : 3.0) : monk ? (kind === 'thrust' ? 4.3 : 3.3) : kind === 'thrust' ? 3.4 : kind === 'sweep' ? 2.8 : 2.3;
    let dmg = Math.round((boss ? (kind === 'sweep' ? 22 : 24) : kind === 'thrust' ? 18 : kind === 'sweep' ? 15 : 12) * (e.elite ? 1.25 : 1) * (brute ? 1.7 : monk ? 0.85 : isFodder(e) ? FODDER_DAMAGE : 1));
    let wind = windup;
    // the named fighters use the Rōnin's own moves in their own style (see fighterStrike)
    const fs = e.rig.clip ? this.fighterStrike(e, first, last) : null;
    let limb: 'foot' | undefined;
    if (fs) {
      kind = fs.kind;
      perilous = fs.perilous;
      reach = fs.reach;
      dmg = Math.round(fs.dmg * (e.elite ? 1.25 : 1));
      limb = fs.limb;
      const from = fs.from ?? 0;
      wind = (fs.hit - from) / fs.speed;
      this.enemyClip(e, fs.clip, { from, speed: fs.speed, fadeIn: 0.1, fadeOut: 0.28 });
    } else if (e.rig.clip && boss) {
      const opts = BOSS_STRIKES[kind] ?? BOSS_STRIKES.smash;
      const pick = opts[Math.floor(Math.random() * opts.length)];
      const speed = kind === 'sweep' ? 0.85 : first ? 0.9 : 1.05;
      const from = pick.from ?? 0;
      wind = (pick.hit - from) / speed;
      this.enemyClip(e, pick.clip, { from, speed, fadeIn: 0.15, fadeOut: 0.35 });
    } else if (e.rig.clip && !boss) {
      // the wind-up IS the clip up to its hit frame: readable, and the blade really
      // arrives when the damage does (combo follow-ups come a little quicker)
      const opts = ENEMY_STRIKES[kind];
      const pick = opts[Math.floor(Math.random() * opts.length)];
      const speed = (perilous ? 0.95 : first ? 1.05 : 1.25) * (brute ? 0.72 : monk ? 1.15 : isFodder(e) ? 0.8 : 1);
      const from = pick.from ?? 0;
      wind = (pick.hit - from) / speed;
      this.enemyClip(e, pick.clip, { from, speed, fadeIn: 0.12, fadeOut: 0.3 });
    }
    const strike: EnemyStrike = {
      kind,
      windup: wind,
      t: 0,
      perilous,
      feint: first && !perilous && !boss && Math.random() < 0.08,
      reach,
      dmg,
      limb,
      side: e.strike ? e.strike.side ^ 1 : Math.random() < 0.5 ? 0 : 1
    };
    e.strike = strike;
    e.windup = wind;
    if (e.tele) {
      const m = e.tele.material as THREE.MeshBasicMaterial;
      m.color.set(perilous ? 0xff1e1e : boss ? 0xff5a30 : 0xff8a30);
      m.opacity = 0.18;
      e.tele.visible = true;
      e.tele.position.set(e.pos.x, 0.05, e.pos.z);
      e.tele.scale.setScalar(boss ? 1.6 : 1.1);
    }
    if (perilous && e.danger) {
      e.danger.visible = true;
      e.danger.scale.setScalar(0.01);
      sfx.danger();
    }
  }

  // An enemy strike lands: perilous sweeps must be jumped, thrusts can only be
  // deflected; everything else can be deflected (tight timing) or blocked (posture).
  private resolveStrike(e: EnemyInstance, st: EnemyStrike, contact?: THREE.Vector3) {
    if (this.state !== 'play' || this.cine) return;
    const dx = this.player.pos.x - e.pos.x;
    const dz = this.player.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    // (a strike that came from a live blade already touched the player - no timer-era
    // distance/angle gates needed)
    if (!contact) {
      if (d > st.reach + 0.35) return;
      if (Math.abs(wrap(Math.atan2(dx, dz) - e.yaw)) > (st.kind === 'sweep' ? 1.7 : 1.15)) return;
    }
    const nx = dx / d;
    const nz = dz / d;

    if (this.player.inv > 0) {
      if (this.player.dashInv) {
        const perfect = this.player.dash > 0;
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, perfect ? 'PERFEITO!' : 'ESQUIVOU!', perfect ? '#ffd166' : '#8fe0c8', perfect ? 1.55 : 1.1);
        this.triggerSlowmo(perfect ? 0.5 : 0.22, perfect ? 0.22 : 0.42);
        this.impacts.spawn(this.tmpV.set(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z), IMPACT_DODGE, perfect ? 2.4 : 1.6, 0.3);
        this.fovKick = perfect ? -5 : -2.5;
        this.ghosts.spawn(this.player.rig.root, perfect ? GHOST_PERFECT : GHOST_DASH, perfect ? 0.6 : 0.4);
        if (perfect) {
          this.player.st = Math.min(this.player.maxSt, this.player.st + 18);
          this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
        }
        sfx.dash();
      }
      return;
    }

    if (st.kind === 'sweep' && this.player.pos.y > 0.35) {
      // jumped the sweep: small reward, like countering in Sekiro
      this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, 'SALTOU!', '#ffd166', 1.3);
      this.triggerSlowmo(0.3, 0.35);
      this.addEnemyPosture(e, e.type === 'boss' ? 40 : 25);
      return;
    }

    const canAct = this.player.staggerT <= 0;
    const deflect = canAct && st.kind !== 'sweep' && this.time - this.player.guardPressT <= TUNE.parryWindow;
    if (deflect) {
      this.waveStat.deflects++;
      this.deflectsTotal++;
      this.faceEnemy(e);
      // a perfect parry (guard pressed right on the blow) pays more: stamina back, the foe's posture
      // hit harder, a longer freeze and a flash; any parry brings the weapon to where the blades meet
      const perfect = this.time - this.player.guardPressT <= TUNE.perfectWindow;
      this.playerDeflectAnim();
      const meet = this.clashPose(e);
      const mid = meet ? this.tmpV.copy(meet) : contact ? this.tmpV.copy(contact) : this.tmpV.set(this.player.pos.x - nx * 0.75, this.player.pos.y + 1.35, this.player.pos.z - nz * 0.75);
      this.impacts.spawn(mid, IMPACT_DEFLECT, (st.kind === 'thrust' ? 2.4 : 1.9) * (perfect ? 1.35 : 1), perfect ? 0.22 : 0.16);
      this.emitParticles(mid.x, mid.y, mid.z, perfect ? 40 : 26, perfect ? 0xfff0b0 : 0xffb347, perfect ? 11 : 9, 2.2, 18, 0.32);
      this.hitstop = perfect ? 0.1 : 0.075;
      this.lastHS = performance.now();
      this.shake = Math.max(this.shake, perfect ? 0.3 : 0.2);
      this.fovKick = Math.min(this.fovKick, perfect ? -4.5 : -3);
      this.addPlayerPosture(perfect ? 0 : 3);
      sfx.clang();
      const scene = this.startParryScene(e, meet, perfect, st.kind === 'thrust');
      if (perfect) {
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, 'APARO PERFEITO!', '#ffd166', 1.45);
        if (!scene) this.triggerSlowmo(0.22, 0.38);
        this.player.st = Math.min(this.player.maxSt, this.player.st + 10);
        this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
        if (this.settings.cinematicCamera) {
          this.flashFx = Math.max(this.flashFx, 0.14);
          this.spikeFx = Math.max(this.spikeFx, 0.3);
        }
        this.addEnemyPosture(e, 12);
      } else if (st.kind === 'thrust') {
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, 'CONTRA-ATAQUE!', '#ffd166', 1.3);
        this.triggerSlowmo(0.35, 0.3);
      } else this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.4, this.player.pos.z, 'APAROU!', '#ffb347', 1);
      // a short push-in on the defences worth seeing: the wave's first, a thrust, the Oni, a captain
      if (!scene && (perfect || st.kind === 'thrust' || this.waveStat.deflects === 1 || e.type === 'boss' || e.captain)) this.parryZoom(perfect || st.kind === 'thrust');
      e.staggerT = e.type === 'boss' ? 0.18 : 0.32;
      e.anim = { kind: 'erecoil', t: 0, dur: 0.32, side: 0 };
      this.enemyClip(e, 'hit1', { from: 0.1, to: 0.75, speed: 1.6 });
      this.addEnemyPosture(e, (e.type === 'boss' ? 34 : 28) * (st.kind === 'thrust' ? 1.7 : 1));
      return;
    }

    const blocking = canAct && this.guarding() && st.kind !== 'sweep' && st.kind !== 'thrust';
    if (blocking) {
      if (this.player.rig.clip) this.startAct('block', 'hit1', { speed: 1.25, to: 0.85, cancel: 0.4, end: 0.8, fadeIn: 0.06 });
      this.faceEnemy(e);
      const mid = contact ? this.tmpV.copy(contact) : this.tmpV.set(this.player.pos.x - nx * 0.7, this.player.pos.y + 1.3, this.player.pos.z - nz * 0.7);
      this.impacts.spawn(mid, IMPACT_BLOCK, 1.3, 0.12);
      this.emitParticles(mid.x, mid.y, mid.z, 10, 0xffd49a, 5, 1.5, 16, 0.22);
      this.player.kb.x += nx * 4;
      this.player.kb.z += nz * 4;
      this.shake = Math.max(this.shake, 0.12);
      sfx.block();
      this.addPlayerPosture(st.dmg * 2.6);
      if (this.player.posture >= PLAYER_MAX_POSTURE) {
        // guard broken: staggered and the hit gets through at half strength
        this.player.staggerT = 1.1;
        this.player.posture = PLAYER_MAX_POSTURE * 0.6;
        this.input.guardHeld = false;
        if (this.player.rig.clip) this.startAct('stagger', 'hit2', { speed: 1.1, cancel: 99, end: 1.2, fadeIn: 0.06 });
        sfx.guardBreak();
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, 'GUARDA QUEBRADA', '#ff5a5a', 1.2);
        this.damagePlayer(Math.round(st.dmg * 0.5), nx, nz);
      }
      return;
    }

    this.addPlayerPosture(st.dmg * 0.8);
    this.damagePlayer(st.dmg, nx, nz);
  }

  private playerDeflectAnim() {
    if (this.player.rig.clip) this.startAct('deflect', 'hit1', { from: 0.05, to: 0.6, speed: 1.7, cancel: 0.22, end: 0.6, fadeIn: 0.04 });
    else this.player.anim = { kind: 'deflect', t: 0, dur: 0.2, side: 0 };
  }

  private findDeathblowTarget(): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.brokenT <= 0) continue;
      const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z) - e.r;
      if (d < 2.9 && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // One of the active weapon's three finishers at random, never the one it used last time
  private pickFinisher(): Finisher {
    const id = this.weapons[this.activeWeaponIdx]?.id ?? 'katana';
    const list = FINISHERS[id] ?? FINISHERS.katana;
    let i = this.forceFinisher !== null ? this.forceFinisher % list.length : Math.floor(Math.random() * list.length);
    const last = this.lastFinisher[id];
    if (this.forceFinisher === null && list.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    this.lastFinisher[id] = i;
    return list[i];
  }

  // What each finisher adds at the moment of the blow, beyond the shared flash and sparks
  private finisherFx(c: NonNullable<GameEngine['cine']>, e: EnemyInstance, sc: number) {
    const P = this.player;
    const fx = Math.sin(P.yaw);
    const fz = Math.cos(P.yaw);
    const y = e.pos.y + 1.2 * sc;
    if (c.style === 'slam') {
      this.puff(e.pos.x, e.pos.z, 14, 4);
      this.shake = Math.max(this.shake, 0.75);
    } else if (c.style === 'slide') {
      this.puff(P.pos.x, P.pos.z, 12, 3, -fx, -fz);
      this.puff(e.pos.x, e.pos.z, 8, 3, fx, fz);
    } else if (c.style === 'stab') {
      this.emitBlood(e.pos.x, y, e.pos.z, fx, fz, 50, true, true);
    } else if (c.style === 'spin') {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        this.emitParticles(e.pos.x + Math.cos(a) * 1.2 * sc, y, e.pos.z + Math.sin(a) * 1.2 * sc, 3, 0xffd49a, 5, 1, 4, 0.35);
      }
    } else if (c.style === 'kick') {
      this.impacts.spawn(this.tmpV.set(e.pos.x, y, e.pos.z), IMPACT_HEAVY, 3.4 * (sc > 1 ? 1.3 : 1), 0.3);
      this.shake = Math.max(this.shake, 0.65);
    }
    if (c.boom) {
      this.emitParticles(e.pos.x, y, e.pos.z, 70, 0xff7a20, 12, 4, 10, 0.7);
      this.impacts.spawn(this.tmpV.set(e.pos.x, y, e.pos.z), IMPACT_HEAVY, 4.6 * (sc > 1 ? 1.3 : 1), 0.4);
      this.shake = Math.max(this.shake, 0.85);
      sfx.boom();
    }
  }

  private performDeathblow(e: EnemyInstance) {
    const dx = this.player.pos.x - e.pos.x;
    const dz = this.player.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dist = e.r + 0.85;
    this.player.pos.x = e.pos.x + (dx / d) * dist;
    this.player.pos.z = e.pos.z + (dz / d) * dist;
    this.faceEnemy(e);
    e.yaw = Math.atan2(dx, dz);
    this.player.inv = Math.max(this.player.inv, 1.6);
    this.player.dashInv = false;
    this.player.atkCd = 0.85;
    const fin = this.pickFinisher();
    const lead = fin.lead ?? 0.3;
    if (this.player.rig.clip) {
      // the clip is played in place from `from` so the blow lands exactly `lead` seconds in
      // (its own travel - a leap, a slide - would carry past the target); the recovery
      // runs about a second, kept inside the clip
      this.actQueued = false;
      const speed = (fin.hit - fin.from) / lead;
      const end = Math.min((FINISHER_CLIP_LEN[fin.clip] ?? 2) - 0.06, fin.from + 0.95 * speed);
      this.startAct('deathblow', fin.clip, { from: fin.from, speed, cancel: 99, end, fadeIn: 0.06 });
    } else {
      this.player.anim = { kind: 'deathblow', t: 0, dur: 0.8, side: 0 };
    }
    e.brokenT = Math.max(e.brokenT, 3);
    // Shot variants: the boss's first deathblow (it survives) and back-to-back finishers
    // get a shorter version so the cinematic never wears out; the killing blow on the
    // Oni gets the longest
    const boss = e.type === 'boss';
    const boss1 = boss && (e.dbCount || 0) === 0 && e.hp > e.maxHp * 0.5;
    const cinema = this.settings.cinematicCamera;
    const full = !cinema || (!boss1 && (boss || this.time - this.lastDeathblowAt > 4));
    this.lastDeathblowAt = this.time;
    this.cineSide = -this.cineSide;
    const sc = this.sizeOf(e);
    const shot = cinema ? this.pickCineShot(e, sc) : { side: 1, dist: 4 };
    this.cine = { t: 0, after: 0, e, struck: false, full, boss: boss && !boss1, side: shot.side, dist: shot.dist * (fin.style === 'stab' ? 0.9 : 1), hitAt: lead, style: fin.style, boom: !!fin.boom };
    this.triggerSlowmo(full ? 0.75 : 0.4, full ? 0.38 : 0.5);
    this.fovKick = -9;
    this.callbacks.onCinematic?.(true, full ? 'full' : 'short');
    sfx.heavy();
  }

  // Side and distance for the finisher's camera: alternate sides between finishers, and
  // take the other one (or come closer) when a trunk or pillar would be in the way
  private pickCineShot(e: EnemyInstance, sc: number) {
    const P = this.player.pos;
    let ax = e.pos.x - P.x;
    let az = e.pos.z - P.z;
    const ad = Math.hypot(ax, az) || 1;
    ax /= ad;
    az /= ad;
    const mx = (P.x + e.pos.x) / 2;
    const mz = (P.z + e.pos.z) / 2;
    const portrait = this.camera.aspect < 1;
    const full = 4.3 * Math.sqrt(sc) * (portrait ? 1.3 : 1);
    const clear = (side: number, d: number) => {
      for (const k of [0.4, 0.7, 1]) {
        const x = mx + (-az * side * 0.92 - ax * 0.4) * d * k;
        const z = mz + (ax * side * 0.92 - az * 0.4) * d * k;
        for (const so of this.solids) {
          if (so.h < 2.5 || so.r > 3) continue;
          const rr = so.r * 0.7 + 0.5;
          if ((x - so.x) ** 2 + (z - so.z) ** 2 < rr * rr) return false;
        }
      }
      return true;
    };
    for (const f of [1, 0.75, 0.55]) {
      if (clear(this.cineSide, full * f)) return { side: this.cineSide, dist: full * f };
      if (clear(-this.cineSide, full * f)) return { side: -this.cineSide, dist: full * f };
    }
    return { side: this.cineSide, dist: full * 0.55 };
  }

  // Finisher camera: dollies from the normal chase view to a low three-quarter side shot
  // (a slight dutch tilt), pushes in on the strike, then eases back out. Blended over the
  // normal camera by `cineW`, so it leaves and returns without a cut.
  private applyCineCamera(dt: number, look: THREE.Vector3) {
    const c = this.cine;
    if (!c || !this.settings.cinematicCamera) {
      this.cineW = 0;
      return;
    }
    if (c.struck) c.after += dt;
    const ss = (a: number, b: number, x: number) => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    const w = (c.struck ? 1 - ss(0.25, 0.85, c.after) : ss(0, c.hitAt, c.t)) * (c.full ? 1 : 0.6);
    this.cineW = w;
    if (w < 0.001) return;
    const P = this.player.pos;
    const e = c.e;
    const sc = this.sizeOf(e);
    let ax = e.pos.x - P.x;
    let az = e.pos.z - P.z;
    const ad = Math.hypot(ax, az) || 1;
    ax /= ad;
    az /= ad;
    const bias = c.boss || sc > 1.5 ? 0.62 : 0.5;
    const fy = P.y + 1.3 * (1 + (sc - 1) * 0.5);
    this.cineFocus.set(P.x + (e.pos.x - P.x) * bias, fy, P.z + (e.pos.z - P.z) * bias);
    const push = c.struck ? 1 : ss(0, c.hitAt, c.t);
    const d = c.dist * (1 - 0.18 * push);
    const px = -az * c.side;
    const pz = ax * c.side;
    const camX = this.cineFocus.x + (px * 0.92 - ax * 0.4) * d;
    const camZ = this.cineFocus.z + (pz * 0.92 - az * 0.4) * d;
    // a sliding finisher is filmed from near the ground
    const camY = Math.max(0.45, P.y + 0.75 + 0.3 * sc - (c.style === 'slide' ? 0.35 : 0));
    this.camera.position.x += (camX - this.camera.position.x) * w;
    this.camera.position.y += (camY - this.camera.position.y) * w;
    this.camera.position.z += (camZ - this.camera.position.z) * w;
    look.lerp(this.cineFocus, w);
    const portrait = this.camera.aspect < 1;
    const cf = (portrait ? 54 : c.boss ? 46 : 42) - 5 * push;
    this.camera.fov += (cf - this.camera.fov) * w;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(look);
    this.camera.rotateZ(0.05 * c.side * w);
  }

  private updateCinematic(dt: number) {
    const c = this.cine;
    if (!c) return;
    c.t += dt;
    const e = c.e;
    const cinema = this.settings.cinematicCamera;
    if (!c.struck && c.t >= c.hitAt) {
      c.struck = true;
      const sc = this.sizeOf(e);
      const p = this.tmpV.set(e.pos.x, e.pos.y + 1.3 * sc, e.pos.z);
      this.impacts.spawn(p, IMPACT_CRIT, (cinema ? 2 : 3.2) * (sc > 1 ? 1.4 : 1), 0.35);
      this.emitBlood(e.pos.x, e.pos.y + 1.2 * sc, e.pos.z, Math.sin(this.player.yaw), Math.cos(this.player.yaw), 70, true, true);
      this.decals.spawn(e.pos.x + Math.sin(this.player.yaw) * 1.2, e.pos.z + Math.cos(this.player.yaw) * 1.2, Math.sin(this.player.yaw), Math.cos(this.player.yaw), 2.4 * sc);
      this.emitParticles(p.x, p.y, p.z, 30, 0xff6a3a, 8, 3, 12, 0.5);
      this.finisherFx(c, e, sc);
      this.shake = Math.max(this.shake, c.full ? 0.55 : 0.4);
      this.hitstop = 0.14;
      this.lastHS = performance.now();
      if (cinema) {
        // the impact frame: white flash + colour split, then the aftermath in slow motion
        this.flashFx = c.full ? 0.6 : 0.22;
        this.spikeFx = c.full ? 1 : 0.5;
        this.fovKick = -5;
        if (c.boss) this.triggerSlowmo(1.0, 0.25);
        else this.triggerSlowmo(c.full ? 0.5 : 0.25, c.full ? 0.28 : 0.45);
      }
      sfx.deathblow();
      this.finishers++;
      this.waveStat.finishers++;
      this.addHonor('finish', HONOR.finisher);
      const sede = 6 * (this.cardLv.sede ?? 0);
      if (sede > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + sede);
        this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
        this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.4, this.player.pos.z, `+${sede}`, '#7affb0', 1.1);
      }
      if (e.type === 'boss' && (e.dbCount || 0) === 0 && e.hp > e.maxHp * 0.5) {
        // the Oni survives the first deathblow with half its life taken
        e.dbCount = 1;
        e.hp -= e.maxHp * 0.5;
        e.brokenT = 0;
        e.posture = 0;
        e.mode = 'recover';
        e.modeT = 0;
        e.staggerT = 1.2;
        e.flash = 0.14;
        this.enemyClip(e, 'hit2', { speed: 1.0, fadeIn: 0.08 });
        this.spawnLabel(e.pos.x, e.pos.y + 6, e.pos.z, 'FERIDO!', '#ff5a3a', 1.6);
      } else {
        e.hp = 0;
        this.player.score += e.type === 'boss' ? 1500 : 150;
        this.callbacks.onScoreChange(this.player.score);
        this.killEnemy(e);
      }
    }
    // with the cinematic camera the release is timed in real seconds after the strike
    // (the slow motion stretches game time); without it, the original game-time span
    const over = cinema ? c.struck && c.after >= (c.boss ? 1.1 : c.full ? 0.85 : 0.5) : c.t >= 0.95;
    if (over || c.t >= 2) {
      this.cine = null;
      this.callbacks.onCinematic?.(false);
    }
  }

  private spawnProj(o: Partial<ProjectileInstance> & { type: string; pos: THREE.Vector3; vel: THREE.Vector3; dmg: number; life: number }) {
    const pl = this.projPools[o.type] || (this.projPools[o.type] = []);
    let m = pl.pop();
    if (!m) {
      m = makeWeapon(o.type);
      this.scene.add(m);
    }
    m.visible = true;
    m.position.copy(o.pos);

    const p: ProjectileInstance = {
      type: o.type,
      friendly: o.friendly ?? true,
      pos: o.pos,
      vel: o.vel,
      dmg: o.dmg,
      life: o.life,
      mesh: m,
      pierce: o.pierce,
      sp: o.sp,
      ptMult: o.ptMult,
      bomb: o.bomb,
      aoeR: o.aoeR,
      kb: o.kb,
      noSolid: o.noSolid,
      grav: o.grav,
      owner: o.owner
    };
    if (p.pierce) p.hit = new Set();
    this.projectiles.push(p);
  }

  private killProj(i: number) {
    const p = this.projectiles[i];
    p.mesh.visible = false;
    this.projPools[p.type].push(p.mesh as THREE.Group);
    this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
    this.projectiles.pop();
  }

  private collide(pos: THREE.Vector3, r: number) {
    for (const s of this.solids) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const d = Math.hypot(dx, dz);
      const m = s.r + r;
      if (d < m && d > 0.0001 && pos.y < s.h) {
        pos.x = s.x + (dx / d) * m;
        pos.z = s.z + (dz / d) * m;
      }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > R_ARENA - r) {
      pos.x *= (R_ARENA - r) / d;
      pos.z *= (R_ARENA - r) / d;
    }
  }

  /* =========================================================================
     CORE FIX: Direcional girando a câmera junto com o personagem e ajuste automático
     ========================================================================= */
  private updatePlayerMovementAndCamera(dt: number) {
    let ix = this.input.jx;
    let iy = this.input.jy;
    const k = this.input.keys;

    if (k.KeyW || k.ArrowUp) iy -= 1;
    if (k.KeyS || k.ArrowDown) iy += 1;
    if (k.KeyA || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;

    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }

    // Vetores de direção relativos à câmera
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);

    const mx = fx * -iy + rx * ix;
    const mz = fz * -iy + rz * ix;
    const amt = Math.min(1, Math.hypot(mx, mz));

    if (amt > 0.05) {
      // 1. O PERSONAGEM VIRA NA DIREÇÃO DO MOVIMENTO (Acaba com andar de costas!)
      const moveAngle = Math.atan2(mx, mz);
      this.lastMove.set(mx, 0, mz);
      const turnK = this.player.rig.clip ? this.clipTurnSpeed() : this.player.anim ? TUNE.turnSpeedAttacking : TUNE.turnSpeedIdle;
      this.player.yaw = turnTo(this.player.yaw, moveAngle, dt * turnK);

      // 2. O DIRECIONAL GIRA A CÂMERA DINAMICAMENTE
      if (this.settings.autoTurnWithStick) {
        // Ao desviar para a esquerda/direita com o analógico, a câmera gira suavemente junto
        const steerSens = TUNE.camSteerSpeed * this.settings.cameraSensitivity;
        this.camYaw += -ix * steerSens * dt;
      }

      // 3. AJUSTE AUTOMÁTICO DE ROTAÇÃO DA CÂMERA (Auto-Follow & Virada para Trás)
      //
      // Chasing camYaw toward wrap(player.yaw - PI) every frame the stick is held closes
      // a loop: yaw is itself turning toward moveAngle, which is derived from THIS SAME
      // camYaw. For held-forward input the two targets happen to already agree (moveAngle
      // sits exactly PI from where the camera wants to end up), so this is a no-op there -
      // but for any other constant direction (held backward, held strafe) there is no
      // angle that satisfies both at once, so camYaw and player.yaw chase each other in a
      // circle that never settles, rotating both at a steady rate for as long as the
      // stick stays held in that direction (confirmed with a standalone simulation of the
      // exact math: at the old default speed this was ~300deg/s - a dizzying, obviously
      // broken spin). It doesn't have a stable fixed point to settle into, full stop - no
      // amount of retuning removes that. What TUNE.camFollowSpeed's now-much-lower default
      // does is keep that unavoidable drift slow enough to read as "camera swinging around
      // to keep up with you" instead of "spinning" - a deliberate compromise, not a fix,
      // since disabling it while the stick is held (an earlier attempt) meant the camera
      // never adjusts during ordinary continuous play, which is worse.
      if (this.settings.autoCamera && this.lookTouch.id === null) {
        const camBehindPlayer = wrap(this.player.yaw - Math.PI);
        const autoSpeed = TUNE.camFollowSpeed * this.settings.cameraSensitivity;
        this.camYaw = turnTo(this.camYaw, camBehindPlayer, dt * autoSpeed);
      }
    }

    // mocap rig: steering out of a move's recovery (past its cancel point, nothing left to
    // land) ends it, so a combo you stop pressing doesn't pin the feet to the ground
    const a = this.act;
    if (a && amt > 0.2 && a.shot.t >= a.cancelAt && a.events.length === 0 && !a.onChain) {
      if (a.kind === 'attack' || a.kind === 'special' || a.kind === 'hurt' || a.kind === 'block' || a.kind === 'deflect') this.cancelAct(0.2);
    }

    if (this.player.dash > 0) {
      this.player.dash -= dt;
      this.player.pos.addScaledVector(this.player.dashDir, TUNE.dashSpeed * dt);
      this.player.vel.set(0, 0, 0);
      this.emitParticles(this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z, 1, 0x8a86c8, 0.7, 0.2, 0, 0.4);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.06;
        this.ghosts.spawn(this.player.rig.root, GHOST_DASH);
      }
    } else {
      // mocap rig: a committed move owns the feet (its root motion is all the movement)
      const committed = !!this.player.rig.clip && (this.player.hp <= 0 || (!!this.act && this.act.kind !== 'draw'));
      const penalty =
        this.cine || committed ? 0 : this.player.staggerT > 0 ? 0.25 : this.player.healT > 0 ? 0.35 : this.input.guardHeld ? 0.45 : this.player.anim ? 0.6 : this.player.tornado > 0 ? 0.55 : 1;
      const maxSp = TUNE.moveMaxSpeed * penalty;
      const dvx = amt > 0.05 ? (mx / amt) * maxSp * amt : 0;
      const dvz = amt > 0.05 ? (mz / amt) * maxSp * amt : 0;
      const accelK = 1 - Math.exp(-(amt > 0.05 ? TUNE.accelToward : TUNE.accelDecay) * dt);
      this.player.vel.x += (dvx - this.player.vel.x) * accelK;
      this.player.vel.z += (dvz - this.player.vel.z) * accelK;
      this.player.pos.x += this.player.vel.x * dt;
      this.player.pos.z += this.player.vel.z * dt;
    }

    const velAmt = Math.min(1, Math.hypot(this.player.vel.x, this.player.vel.z) / TUNE.moveMaxSpeed);
    this.player.moveAmt +=
      ((this.player.dash > 0 ? 1 : Math.max(amt > 0.05 ? amt : 0, velAmt * 0.7)) - this.player.moveAmt) *
      Math.min(1, dt * 12);

    this.player.pos.addScaledVector(this.player.kb, dt);
    this.player.kb.multiplyScalar(Math.exp(-7 * dt));
    this.player.vy -= 28 * dt;
    this.player.pos.y += this.player.vy * dt;

    if (this.player.pos.y <= 0) {
      if (!this.player.grounded && this.player.vy < -6) {
        this.puff(this.player.pos.x, this.player.pos.z, 9, 2.6);
        this.landFx = 1;
      }
      this.player.pos.y = 0;
      this.player.vy = 0;
      this.player.grounded = true;
      this.player.jumps = 0;
    }
    // bodies are solid: the player and the enemies can't walk through one another (a dodge
    // still slips past - its invulnerability is the point of it)
    if (this.player.dash <= 0) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const ox = this.player.pos.x - e.pos.x;
        const oz = this.player.pos.z - e.pos.z;
        const od = Math.hypot(ox, oz);
        const minD = e.r + 0.45;
        if (od < minD && od > 1e-4) {
          const push = Math.min(minD - od, 12 * dt + 0.02);
          this.player.pos.x += (ox / od) * push * 0.65;
          this.player.pos.z += (oz / od) * push * 0.65;
          e.pos.x -= (ox / od) * push * 0.35;
          e.pos.z -= (oz / od) * push * 0.35;
        }
      }
    }
    this.collide(this.player.pos, 0.45);

    this.player.inv -= dt;
    this.player.atkCd -= dt;
    this.player.comboT -= dt;
    this.player.killComboT -= dt;
    if (this.player.hitComboT > 0) {
      this.player.hitComboT -= dt;
      if (this.player.hitComboT <= 0) {
        this.player.hitCombo = 0;
        if (this.player.killComboT <= 0) {
          this.callbacks.onComboChange(0);
        }
      }
    }

    // Special items timers
    let specialsChanged = false;
    for (const k in this.player.special) {
      const idx = +k;
      const prevShown = Math.ceil(this.player.special[idx]);
      this.player.special[idx] -= dt;
      if (this.player.special[idx] <= 0) {
        delete this.player.special[idx];
        specialsChanged = true;
      } else if (Math.ceil(this.player.special[idx]) !== prevShown) {
        specialsChanged = true;
      }
    }
    if (specialsChanged) {
      this.callbacks.onSpecialsUpdate({ ...this.player.special });
    }

    // posture: recovers after a short pause, faster while guarding; stagger ticks down
    this.player.postureT += dt;
    if (this.player.postureT > 1 && this.player.posture > 0) {
      this.player.posture = Math.max(0, this.player.posture - (this.input.guardHeld ? 28 : 18) * dt * (1 + this.metaBonus.postureRecov + 0.2 * (this.cardLv.ferro ?? 0)));
    }
    if (this.player.staggerT > 0) this.player.staggerT -= dt;
    if (this.gourd) this.gourd.visible = this.player.healT > 0;
    if (this.player.healT > 0) {
      this.player.healT -= dt;
      const total = Math.round(this.player.maxHp * 0.45);
      const firstAmt = Math.round(total / 2);
      if (!this.player.healHalf && this.player.healDur - this.player.healT >= HEAL_FIRST_AT) {
        this.player.healHalf = true;
        this.healPart(firstAmt, true);
      }
      if (!this.player.healDone && this.player.healT <= HEAL_SECOND_LEFT) {
        this.player.healDone = true;
        if (!this.player.healHalf) {
          this.player.healHalf = true;
          this.healPart(firstAmt, true);
        }
        this.healPart(total - firstAmt, false);
      }
    }
    if (this.healBufT > 0) {
      this.healBufT -= dt;
      if (this.player.healT <= 0 && this.freeToCancel()) this.heal();
    }
    const dbReady = !!this.findDeathblowTarget();
    if (dbReady !== this.player.dbReady) {
      this.player.dbReady = dbReady;
      this.callbacks.onDeathblowReady?.(dbReady);
    }
    const pr = Math.round(this.player.posture);
    if (pr !== this.player.lastPostureSent) {
      this.player.lastPostureSent = pr;
      this.callbacks.onPostureChange?.(this.player.posture, PLAYER_MAX_POSTURE);
    }
    this.updateCinematic(dt);

    this.player.st = Math.min(this.player.maxSt, this.player.st + (STAMINA_REGEN + 4 * (this.cardLv.folego ?? 0)) * dt);
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);

    // Bō special: spinning AoE tick for its duration, then releases the attack button
    if (this.player.tornado > 0) {
      this.player.torTick += dt;
      if (this.player.torTick >= 0.2) {
        this.player.torTick -= 0.2;
        this.meleeHit(3.4, TAU, 16, 5, false);
      }
      this.player.tornado -= dt;
      if (this.player.tornado <= 0) {
        this.player.tornado = 0;
        this.player.torTick = 0;
      }
    }

    // Karatê special: timed flurry on the nearest target, then releases the attack button
    if (this.player.rush) {
      const r = this.player.rush;
      r.t += dt;
      if (!r.kicked && r.hits < 3 && r.t >= (r.hits + 1) * 0.16) {
        r.hits++;
        const tg = this.findTarget(3);
        if (tg) {
          const dx = tg.pos.x - this.player.pos.x;
          const dz = tg.pos.z - this.player.pos.z;
          const d = Math.hypot(dx, dz) || 0.001;
          this.hitEnemy(tg, 24, dx / d, dz / d, 2, false);
          this.player.anim = { kind: r.hits % 2 ? 'punchR' : 'punchL', t: 0, dur: 0.14, side: 0 };
        }
      } else if (!r.kicked && r.hits >= 3 && r.t >= 0.58) {
        r.kicked = true;
        const tg = this.findTarget(3.2);
        if (tg) {
          const dx = tg.pos.x - this.player.pos.x;
          const dz = tg.pos.z - this.player.pos.z;
          const d = Math.hypot(dx, dz) || 0.001;
          this.hitEnemy(tg, 60, dx / d, dz / d, 10, true);
          this.player.anim = { kind: 'roundKick', t: 0, dur: 0.3, side: 0 };
        }
      }
      if (r.t >= 1.0) {
        this.player.rush = null;
      }
    }

    if (this.attackQueueT > 0) this.attackQueueT -= dt;
    if (this.input.attackHeld || this.attackQueueT > 0) {
      const before = this.player.atkCd;
      this.tryAttack();
      if (this.player.atkCd > before) this.attackQueueT = 0;
    }

    // Advance and update attack animation timer
    if (this.player.anim) {
      this.player.anim.t += dt;
      if (this.player.anim.t >= this.player.anim.dur) {
        this.player.anim = null;
      }
    }

    // Animation updates
    this.player.phase += dt * 11 * this.player.moveAmt;
    const stepIdx = Math.floor(this.player.phase / Math.PI);
    if (stepIdx !== this.stepIdx) {
      this.stepIdx = stepIdx;
      if (this.player.grounded && this.player.dash <= 0 && this.player.moveAmt > 0.55) {
        const side = stepIdx % 2 ? 0.14 : -0.14;
        const cx = Math.cos(this.player.yaw) * side;
        const cz = -Math.sin(this.player.yaw) * side;
        this.puff(this.player.pos.x + cx, this.player.pos.z + cz, 2, 0.5, -Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
      }
    }
    const yawRate = dt > 0 ? wrap(this.player.yaw - this.prevYaw) / dt : 0;
    this.prevYaw = this.player.yaw;
    if (this.player.rig.flash) this.player.rig.flash.value = this.hurtFx * this.hurtFx * 0.35;
    if (this.deadT >= 0) {
      this.deadT += dt;
      if (this.deadT > 2.6 && this.state === 'play') this.gameOver();
    }
    if (this.player.rig.clip) this.updatePlayerClip(dt);
    else animateCharacter(this.player.rig, {
      moveAmt: this.player.moveAmt,
      phase: this.player.phase,
      air: !this.player.grounded,
      t: this.time,
      dt,
      anim: this.player.anim,
      weapon: this.weapons[this.activeWeaponIdx]?.id,
      dash: this.player.dash > 0,
      turn: yawRate,
      hit: this.hurtFx * 0.8,
      landJuice: this.landFx,
      guard: this.input.guardHeld && this.player.staggerT <= 0,
      stagger: this.player.staggerT > 0
    });
    this.updateBladeTrail(dt);

    this.player.rig.root.position.copy(this.player.pos);
    this.player.rig.root.rotation.y = this.player.yaw;
    // (no invulnerability blink: the red screen edge, blood and damage number already say "hit")
    this.player.rig.root.visible = true;
  }

  private updateCamera(dt: number) {
    // soft follow: the frame trails the player slightly, which reads as weight
    const kx = 1 - Math.exp(-14 * dt);
    const ky = 1 - Math.exp(-9 * dt);
    this.camTarget.x += (this.player.pos.x - this.camTarget.x) * kx;
    this.camTarget.z += (this.player.pos.z - this.camTarget.z) * kx;
    this.camTarget.y += (this.player.pos.y + 1.6 - this.camTarget.y) * ky;
    const camTarget = this.camTarget;
    // subtle look-ahead in the direction of travel - kept off the obstacle-avoidance
    // raycast below (which still keys off the player's own followed position), so this
    // is purely cosmetic and safe to rip out (delete camLead + this block + the two
    // lookTarget uses below) if it doesn't feel right.
    const leadTarget = this.player.vel.clone().multiplyScalar(TUNE.camLeadAmount);
    this.camLead.lerp(leadTarget, 1 - Math.exp(-4 * dt));
    const lookTarget = camTarget.clone().add(this.camLead);
    // fight camera: the frame leans toward the opponent (the one swinging, else the closest) and opens
    // up for a crowd or the Oni, so the exchange is the picture and nobody hides behind the player
    let leadX = 0;
    let leadZ = 0;
    let extra = 0;
    const fc = this.state === 'play' && !this.cine && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ? TUNE.fightCam : 0;
    if (fc > 0) {
      let focus: EnemyInstance | null = null;
      let best = 0;
      let crowd = 0;
      let bossNear = false;
      for (const e of this.enemies) {
        if (e.dead || e.flee) continue;
        const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
        if (d < 7 && !isFodder(e)) crowd++;
        if (e.type === 'boss' && d < 14) bossNear = true;
        if (d > 9 || isFodder(e)) continue;
        const sc = (e.strike || e.mode === 'attack' ? 2 : 1) / (0.5 + d);
        if (sc > best) {
          best = sc;
          focus = e;
        }
      }
      if (focus) {
        const dx = focus.pos.x - this.player.pos.x;
        const dz = focus.pos.z - this.player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.min(2.2, d * 0.3) / d;
        leadX = dx * k * fc;
        leadZ = dz * k * fc;
      }
      extra = fc * ((crowd >= 3 ? 0.9 : crowd === 2 ? 0.4 : 0) + (bossNear ? 1.6 : 0));
    }
    const fk = 1 - Math.exp(-3.5 * dt);
    this.fightLead.x += (leadX - this.fightLead.x) * fk;
    this.fightLead.z += (leadZ - this.fightLead.z) * fk;
    this.camExtra += (extra - this.camExtra) * (1 - Math.exp(-2.5 * dt));
    lookTarget.x += this.fightLead.x;
    lookTarget.z += this.fightLead.z;
    this.fovKick *= Math.exp(-5 * dt);
    // special-move punch-in: a quick push toward the fighter that eases back out
    let punch = 0;
    if (this.punchT < this.punchDur) {
      this.punchT += dt;
      punch = Math.sin(Math.PI * Math.min(1, this.punchT / this.punchDur)) ** 1.5;
    }
    const fov = this.baseFov + this.fovKick - 6 * punch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const cp = Math.cos(this.camPitch);
    const camDir = new THREE.Vector3(
      Math.sin(this.camYaw) * cp,
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * cp
    );

    const want = ((this.camDistOverride ?? (this.camera.aspect < 1 ? 10.5 : 7.2)) + this.camExtra) * (1 - 0.3 * punch);
    // pull in when a trunk, pillar or pole stands between the camera and the player
    let limit = want;
    for (const so of this.solids) {
      if (so.h < 2.5 || so.r > 3) continue;
      const ox = camTarget.x - so.x;
      const oz = camTarget.z - so.z;
      const rr = so.r * 0.7 + 0.35;
      const a2 = camDir.x * camDir.x + camDir.z * camDir.z;
      const b = ox * camDir.x + oz * camDir.z;
      const c = ox * ox + oz * oz - rr * rr;
      const disc = b * b - a2 * c;
      if (disc <= 0 || a2 < 1e-6) continue;
      const t = (-b - Math.sqrt(disc)) / a2;
      if (t > 0.4 && t < limit && camTarget.y + camDir.y * t < so.h) limit = Math.max(1.8, t - 0.3);
    }
    this.camDist += (limit - this.camDist) * Math.min(1, dt * (limit < this.camDist ? 18 : 5));

    this.camera.position.copy(lookTarget).addScaledVector(camDir, this.camDist);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-9 * dt);
    }
    this.camera.lookAt(lookTarget);
    this.applyCineCamera(dt, lookTarget);
    this.applyParryScene(dt, lookTarget);
  }

  private nearSolids: { x: number; z: number; r: number; h: number }[] = [];
  private steerOut = { x: 0, z: 0 };

  // Obstacle-aware heading for walking enemies. They used to take the straight line to their
  // goal and let collide() shove them off whatever stood in the way: dead ahead of a rock,
  // trunk or pillar that cancels the move and they stood there. This probes headings around
  // the wanted one and takes the nearest that stays clear for a few metres, keeping to one
  // side so it doesn't flip every frame; updateEnemies' stall detector forces a sidestep
  private steer(e: EnemyInstance, wx: number, wz: number, maxLen: number, dt: number) {
    const out = this.steerOut;
    out.x = wx;
    out.z = wz;
    const ln = Math.hypot(wx, wz);
    if (ln < 1e-4) return out;
    const ax = wx / ln;
    const az = wz / ln;
    const look = Math.min(2.4 + e.r * 1.6, maxLen);
    const near = this.nearSolids;
    near.length = 0;
    for (const s of this.solids) {
      const reach = s.r + e.r + look;
      const ox = s.x - e.pos.x;
      const oz = s.z - e.pos.z;
      if (ox * ox + oz * oz < reach * reach) near.push(s);
    }
    if (!near.length) {
      e.steerT = 0;
      e.steerSide = 0;
      return out;
    }
    // distance a heading runs before touching a blocker (capped at `look`); the margin only
    // applies from outside, so a heading along the surface of what it touches counts as clear
    const run = (dx: number, dz: number) => {
      let t = look;
      for (const s of near) {
        const ox = s.x - e.pos.x;
        const oz = s.z - e.pos.z;
        const d2 = ox * ox + oz * oz;
        const rr = Math.min(s.r + e.r + 0.3, Math.sqrt(d2) - 0.01);
        const proj = ox * dx + oz * dz;
        if (proj <= 0 || rr <= 0) continue;
        const perp2 = d2 - proj * proj;
        if (perp2 >= rr * rr) continue;
        const hit = proj - Math.sqrt(rr * rr - perp2);
        if (hit < t) t = hit;
      }
      return t;
    };
    const turn = (a: number) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      return { x: ax * c + az * s, z: az * c - ax * s };
    };
    const STEP = Math.PI / 16;
    const wasActive = (e.steerT ?? 0) > 0;
    const pref = e.steerSide || e.circleDir;
    let bx = ax;
    let bz = az;
    let side = 0;
    if ((e.escapeT ?? 0) > 0) {
      e.escapeT = (e.escapeT ?? 0) - dt;
      for (const a of [4, 6, 2, 8]) {
        const h = turn(a * STEP * pref);
        if (run(h.x, h.z) > look * 0.5) {
          bx = h.x;
          bz = h.z;
          side = pref;
          break;
        }
      }
    } else if (run(ax, az) < look) {
      let found = false;
      // committed to a side: try it first (up to 90 degrees) before the other one
      const order: number[] = [];
      if (wasActive && e.steerSide) {
        for (let k = 1; k <= 8; k++) order.push(k * pref);
        for (let k = 1; k <= 8; k++) order.push(-k * pref);
      } else {
        for (let k = 1; k <= 16; k++) order.push(k * pref, -k * pref);
      }
      for (const o of order) {
        const h = turn(o * STEP);
        if (run(h.x, h.z) >= look * 0.98) {
          bx = h.x;
          bz = h.z;
          side = Math.sign(o);
          found = true;
          break;
        }
      }
      if (!found) {
        // boxed in: clearest heading that doesn't stray far, favouring the side already taken
        let best = -1;
        for (let k = 1; k <= 12; k++) {
          for (const sg of [pref, -pref]) {
            const h = turn(sg * k * STEP);
            const sc = run(h.x, h.z) / look - k * 0.03 + (sg === pref ? 0.12 : 0);
            if (sc > best) {
              best = sc;
              bx = h.x;
              bz = h.z;
              side = sg;
            }
          }
        }
      }
    }
    if (side !== 0) {
      e.steerSide = side;
      e.steerT = 0.7;
    } else if (wasActive) {
      e.steerT = (e.steerT ?? 0) - dt;
      if (e.steerT <= 0) e.steerSide = 0;
    }
    if ((e.steerT ?? 0) > 0) {
      // ease between the straight line and the detour so the turn reads as walking around
      let sx = wasActive ? e.sdx ?? ax : ax;
      let sz = wasActive ? e.sdz ?? az : az;
      const k = Math.min(1, dt * 10);
      sx += (bx - sx) * k;
      sz += (bz - sz) * k;
      const sl = Math.hypot(sx, sz) || 1;
      e.sdx = sx / sl;
      e.sdz = sz / sl;
      out.x = e.sdx * ln;
      out.z = e.sdz * ln;
    } else {
      out.x = bx * ln;
      out.z = bz * ln;
    }
    return out;
  }

  private updateEnemies(gdt: number) {
    this.enemyBlades.length = 0;
    const tokensFree = this.maxTokens() - this.tokensInUse();
    let granted = 0;
    let fodderSwinging = 0;
    for (const o of this.enemies) if (!o.dead && isFodder(o) && o.mode === 'attack') fodderSwinging++;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      // a windy wave (and the Oni in its fury) runs the whole fighter faster - movement,
      // timers and its animation alike
      const dt = e.dead ? gdt : gdt * this.enemyTime * (e.fury ? 1.2 : 1);
      if (e.aura) {
        e.aura.visible = !e.dead && (e.vanishT ?? 0) <= 0;
        e.aura.position.set(e.pos.x, 0.07, e.pos.z);
        const pulse = 1 + Math.sin(this.time * 5 + i) * 0.06;
        e.aura.scale.setScalar(pulse * (e.type === 'boss' ? this.sizeOf(e) * 0.5 : 1));
        (e.aura.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 4 + i) * 0.2;
      }
      if (e.dead) {
        e.deathT += dt;
        if (e.rig.flash) e.rig.flash.value = Math.max(0, 0.6 - e.deathT * 2);
        if (e.dbMark) e.dbMark.visible = false;
        if (e.danger) e.danger.visible = false;
        e.trail?.update(this.time);
        // the mocap fall takes longer than the procedural collapse before sinking away
        const sinkAt = e.rig.clip ? 2.3 : 0.8;
        if (e.rig.clip) e.rig.clip.update(dt, { speed: 0, runSpeed: 1, dirX: 0, dirZ: 1 });
        else animateDeath(e.rig, e.deathT, dt);
        e.rig.root.position.y = -Math.max(0, e.deathT - sinkAt) * 1.4;
        if (e.deathT > sinkAt + 1) {
          this.removeEnemy(e);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      const dx = this.player.pos.x - e.pos.x;
      const dz = this.player.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      const toP = Math.atan2(dx, dz);
      const boss = e.type === 'boss';
      if (boss && !e.fury && e.hp <= e.maxHp * 0.5 && e.brokenT <= 0 && !this.cine) this.startFury(e);
      if (boss && e.variant === 'trovao') this.stepThunder(e, dt);
      if (boss && e.variant === 'sombrio') this.stepShadow(e, dt, d);
      if (!boss && (e.variant === 'shinobi' || e.variant === 'raio')) this.stepBlink(e, dt, d);

      e.trail?.update(this.time);
      if (e.fx) for (const f of e.fx) f.update(this.time);
      e.cd -= dt;
      e.cd2 -= dt;
      if (e.defCd) e.defCd -= dt;
      e.flash -= dt;
      e.modeT += dt;
      e.postureT += dt;
      if (e.guardT > 0) e.guardT -= dt;

      // posture recovers after a pause, slower when wounded
      if (e.brokenT <= 0 && e.postureT > 1.3 && e.posture > 0) {
        const regen = (boss ? 18 : e.type === 'archer' ? 22 : 14) * (0.35 + 0.65 * Math.max(0, e.hp / e.maxHp));
        e.posture = Math.max(0, e.posture - regen * dt);
      }

      let mvx = 0;
      let mvz = 0;
      let spd = 0;
      const freezeAttacks = !!this.cine;

      if ((e.vanishT ?? 0) > 0) {
        // the Sombrio is gone: nothing to hit and nothing hitting, until it steps out behind the player
        e.vanishT = (e.vanishT ?? 0) - dt;
        if (e.vanishT <= 0) {
          if (e.type === 'boss') this.shadowStrike(e);
          else this.blinkArrive(e);
        }
      } else if (e.brokenT > 0) {
        e.brokenT -= dt;
        e.mode = 'broken';
        e.yaw = turnTo(e.yaw, toP, dt * 2);
        if (e.brokenT <= 0 && !(this.cine && this.cine.e === e)) {
          e.posture = e.maxPosture * 0.45;
          e.mode = 'recover';
          e.modeT = 0;
          e.rig.clip?.stop(0.35);
        }
      } else if (e.staggerT > 0) {
        e.staggerT -= dt;
        e.yaw = turnTo(e.yaw, toP, dt * 4);
      } else if ((e.dodgeT ?? 0) > 0) {
        // sidestepping a blow: quick hop away, then straight back in with a counter
        e.dodgeT = (e.dodgeT ?? 0) - dt;
        e.yaw = turnTo(e.yaw, toP, dt * 6);
        mvx = e.dodgeX ?? 0;
        mvz = e.dodgeZ ?? 0;
        spd = e.speed * 2.6;
        if (e.dodgeT <= 0) {
          e.dodgeT = 0;
          e.mode = 'attack';
          e.modeT = 0;
          e.comboLeft = 1;
          e.t = 1;
          e.cd2 = 0.15;
          e.token = true;
        }
      } else if (e.flee) {
        // routed: turn tail and run, then vanish
        e.fleeT = (e.fleeT ?? 0) + dt;
        e.yaw = turnTo(e.yaw, toP + Math.PI, dt * 8);
        mvx = -nx;
        mvz = -nz;
        spd = e.speed * 1.9;
        if (e.fleeT > 1.5) {
          this.puff(e.pos.x, e.pos.z, 10, 3);
          e.dead = true;
          e.deathT = 99;
        }
      } else if ((e.castT ?? 0) > 0) {
        // throwing stars: planted, facing the player
        e.castT = (e.castT ?? 0) - dt;
        e.yaw = turnTo(e.yaw, toP, dt * 9);
      } else if (e.type === 'archer' && e.rig.clip) {
        // ---- mocap archer: keep range and shoot (draw -> hold -> loose), kick anyone
        // who closes in, and (from wave 4) sidestep a swing it sees coming
        const ctl = e.rig.clip;
        e.yaw = turnTo(e.yaw, toP, dt * (e.bow ? 3.5 : 6));
        if (e.cd3 !== undefined) e.cd3 -= dt;
        const reacting = !!ctl.current && !e.bow && !e.kick; // dodge / hit reaction playing
        const swingStarting = this.act
          ? (this.act.kind === 'attack' || this.act.kind === 'special') && this.act.shot.t < 0.3
          : !!this.player.anim && this.player.anim.t < 0.1;
        if (e.kick) {
          e.kick.t += dt;
          if (!e.kick.done && e.kick.t >= 0.42) {
            e.kick.done = true;
            sfx.swing();
            // the foot is live through the kick's extension (a thrown kick, not a timer)
            const st: EnemyStrike = { kind: 'slash', windup: 0, t: 0, perilous: false, feint: false, reach: 2.3, dmg: 10, side: 0 };
            if (e.rig.clip) e.blade = { st, t: 0, dur: 0.5, hit: false, limb: 'foot', prev: makeSeg(), prevOk: false, prevL: makeSeg(), prevLOk: false };
            else this.resolveStrike(e, st);
          }
          if (e.kick.t >= 1.15) e.kick = undefined;
        } else if (e.bow) {
          this.stepArcherShot(e, nx, nz, dt);
        } else if (!reacting && !freezeAttacks && this.wave >= 4 && (e.cd3 ?? 0) <= 0 && d < 3.8 && swingStarting) {
          e.cd3 = 3.5;
          if (Math.random() < 0.65) this.enemyClip(e, Math.random() < 0.5 ? 'dodgeL' : 'dodgeR', { rootMotion: true, fadeIn: 0.06, fadeOut: 0.2 });
        } else if (!reacting && !freezeAttacks && d < 2.1 && e.cd2 <= 0) {
          e.kick = { t: 0, done: false };
          e.cd2 = 2.6;
          this.enemyClip(e, 'kick', { fadeIn: 0.08 });
        } else if (!reacting) {
          if (d < 5) {
            mvx = -nx;
            mvz = -nz;
            spd = e.speed;
          } else if (d > 14) {
            mvx = nx;
            mvz = nz;
            spd = e.speed;
          } else if (e.cd <= 0 && !freezeAttacks) {
            e.cd = 2.6 + Math.random() * 0.8 - Math.min(0.6, this.wave * 0.04);
            e.bow = { phase: 'draw', t: 0 };
            this.enemyClip(e, 'draw', { speed: 1.35, fadeIn: 0.12, fadeOut: 0.08 });
          } else {
            mvx = -nz * e.circleDir * 0.5;
            mvz = nx * e.circleDir * 0.5;
            spd = e.speed * 0.6;
            if (e.modeT > 2.5) {
              e.modeT = 0;
              e.circleDir *= -1;
            }
          }
        }
      } else if (e.type === 'archer') {
        e.yaw = turnTo(e.yaw, toP, dt * 6);
        if (d < 5) {
          mvx = -nx;
          mvz = -nz;
          spd = e.speed;
        } else if (d > 14) {
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.cd <= 0 && !e.anim && !freezeAttacks) {
          // draw the bow first (readable telegraph), release partway through
          e.cd = 2.4 + Math.random() * 0.8;
          e.anim = { kind: 'eshoot', t: 0, dur: 0.75, side: 0 };
          e.shotPending = true;
        } else {
          // sidestep while waiting for the next shot
          mvx = -nz * e.circleDir * 0.5;
          mvz = nx * e.circleDir * 0.5;
          spd = e.speed * 0.6;
          if (e.modeT > 2.5) {
            e.modeT = 0;
            e.circleDir *= -1;
          }
        }
        if (e.shotPending && e.anim && e.anim.t >= 0.45) {
          e.shotPending = false;
          this.fireArrows(e, e.pos.x + nx * 0.6, 1.5, e.pos.z + nz * 0.6);
        }
      } else if (e.strike) {
        // ---- winding up / striking ----
        const st = e.strike;
        st.t += dt;
        e.windup = Math.max(0, st.windup - st.t);
        if (st.t < st.windup * 0.8) e.yaw = turnTo(e.yaw, toP, dt * (boss ? 3.5 : 6));
        const k = Math.min(1, st.t / st.windup);
        if (e.tele) {
          e.tele.position.set(e.pos.x, 0.05, e.pos.z);
          (e.tele.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.42 * k;
          if (boss) e.tele.scale.setScalar(1.6 + k * 0.8);
        }
        // a flash on the blade just before a parry-able blow lands: the cue for pressing guard
        if (!st.warned && !st.feint && st.kind !== 'sweep' && !isFodder(e) && st.t >= st.windup - TELL_LEAD) {
          st.warned = true;
          this.tellFlash(e, st);
        }
        if (e.danger && e.danger.visible) {
          const pop = Math.min(1, st.t / 0.15);
          e.danger.scale.setScalar((boss ? 0.5 : 0.95) * (pop + Math.sin(st.t * 18) * 0.04));
        }
        // mocap enemies: a short lead before the clip's hit frame the blade becomes live -
        // the strike lands when it actually touches the player, not when a timer ends
        if (e.rig.clip && e.weapon && !e.blade && !st.feint && st.t >= st.windup - 0.06) {
          e.blade = { st, t: 0, dur: 0.3, hit: false, limb: st.limb, prev: makeSeg(), prevOk: false, prevL: makeSeg(), prevLOk: false };
        }
        if (st.feint && st.t >= st.windup * 0.6) {
          this.cancelStrike(e);
          e.rig.clip?.stop(0.3);
          e.mode = 'recover';
          e.modeT = 0;
          e.token = false;
          e.cd = 0.8;
        } else if (st.t >= st.windup) {
          const kindAnim = boss ? (st.kind === 'sweep' ? 'esweep' : 'esmash') : st.kind === 'thrust' ? 'ethrust' : st.kind === 'sweep' ? 'esweep' : 'eslash';
          e.anim = { kind: kindAnim, t: 0, dur: boss ? 0.55 : 0.42, side: st.side };
          if (st.kind === 'thrust') {
            // lunge into the thrust
            e.pos.x += Math.sin(e.yaw) * 1.1;
            e.pos.z += Math.cos(e.yaw) * 1.1;
          }
          if (boss) sfx.boom();
          else sfx.swing();
          // furious Oni: the slam sends a shockwave along the ground - jump it
          if (boss && st.kind === 'smash') {
            const ix = e.pos.x + Math.sin(e.yaw) * 3.3;
            const iz = e.pos.z + Math.cos(e.yaw) * 3.3;
            this.world.props.slam(ix, iz, e.fury ? 3.4 : 2.6);
            if (e.fury) this.spawnShock(ix, iz);
          }
          const live = e.blade;
          this.cancelStrike(e);
          if (live) e.blade = live;
          else this.resolveStrike(e, st);
          e.comboLeft--;
          if (e.comboLeft > 0 && e.brokenT <= 0 && e.staggerT <= 0) {
            e.cd2 = boss ? 0.35 : 0.2;
          } else {
            e.mode = 'recover';
            e.modeT = 0;
            e.token = false;
            e.cd = (boss ? 1.6 : 1.3) + Math.random() * 1.4 - Math.min(0.7, this.wave * 0.05);
            // spent after its heavy chain: a long recovery and a worn-down posture to punish
            if (e.variant === 'brute') {
              e.cd += 1.2;
              this.addEnemyPosture(e, 24);
            }
          }
        }
      } else if (e.mode === 'attack') {
        e.yaw = turnTo(e.yaw, toP, dt * 8);
        const want = boss ? 3.3 : e.variant === 'brute' ? 2.7 : e.variant === 'monk' ? 3.0 : 1.95;
        if (freezeAttacks) {
          e.mode = 'circle';
          e.token = false;
        } else if (d > want) {
          mvx = nx;
          mvz = nz;
          spd = e.speed * (boss ? 1 : 1.2);
        } else if (e.cd2 <= 0) {
          this.startStrike(e, e.t === 0);
          e.t++;
        }
      } else if (e.mode === 'recover') {
        e.yaw = turnTo(e.yaw, toP, dt * 6);
        if (e.modeT < 0.55 && !boss) {
          mvx = -nx;
          mvz = -nz;
          spd = e.speed * 0.55;
        }
        if (e.modeT > 0.8) {
          e.mode = 'circle';
          e.modeT = 0;
        }
      } else {
        // approach / circle / guard: keep a ring around the player and take turns attacking
        e.yaw = turnTo(e.yaw, toP, dt * 7);
        const ring = boss ? 4.2 : isFodder(e) ? 3 + (i % 4) * 0.5 : e.variant === 'brute' ? 3.9 : e.variant === 'monk' ? 4.4 + (i % 3) * 0.4 : 3.4 + (i % 3) * 0.55;
        const canAttack = !freezeAttacks && e.cd <= 0 && d < (boss ? 9 : 7);
        const fodder = isFodder(e);
        if (canAttack && (boss || (fodder ? fodderSwinging < FODDER_SWINGERS : granted < tokensFree))) {
          if (fodder) fodderSwinging++;
          else if (!boss) granted++;
          e.token = !boss && !fodder;
          e.mode = 'attack';
          e.modeT = 0;
          e.t = 0;
          e.cd2 = 0;
          const maxCombo = boss ? (e.fury ? 3 : 2) : e.variant === 'brute' ? 2 : Math.min(3, 1 + Math.floor(this.wave / 2) + (e.variant === 'monk' ? 1 : 0));
          e.comboLeft = fodder ? 1 : 1 + Math.floor(Math.random() * maxCombo);
        } else if (d > ring + 1.4) {
          e.mode = 'approach';
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.mode !== 'guard' || e.guardT <= 0) {
          e.mode = 'circle';
          const radial = (d - ring) * 0.9;
          mvx = -nz * e.circleDir * 0.6 + nx * radial;
          mvz = nx * e.circleDir * 0.6 + nz * radial;
          const ml = Math.hypot(mvx, mvz) || 1;
          mvx /= ml;
          mvz /= ml;
          spd = e.speed * 0.45;
          if (e.modeT > 2 + (i % 4) * 0.6) {
            e.modeT = 0;
            if (Math.random() < 0.5) e.circleDir *= -1;
          }
        }
      }

      // keep enemies from stacking into each other
      for (const o of this.enemies) {
        if (o === e || o.dead) continue;
        const ox = e.pos.x - o.pos.x;
        const oz = e.pos.z - o.pos.z;
        const od = Math.hypot(ox, oz);
        // faces waiting their turn keep a little more room between them than the ones trading blows
        const minD = e.r + o.r + (e.mode !== 'attack' && o.mode !== 'attack' ? 0.9 : 0.35);
        if (od < minD && od > 1e-4) {
          const push = ((minD - od) / minD) * 4 * dt;
          e.pos.x += (ox / od) * push;
          e.pos.z += (oz / od) * push;
        }
      }

      if (spd > 0 && (e.dodgeT ?? 0) <= 0) {
        // aimed at the player the path ends at the player; anything past them is no obstacle
        const s = this.steer(e, mvx, mvz, mvx * nx + mvz * nz > 0.9 ? d : 99, dt);
        mvx = s.x;
        mvz = s.z;
      }
      const px0 = e.pos.x;
      const pz0 = e.pos.z;
      e.pos.x += mvx * spd * dt;
      e.pos.z += mvz * spd * dt;
      e.pos.addScaledVector(e.kb, dt);
      e.kb.multiplyScalar(Math.exp(-6 * dt));
      this.collide(e.pos, e.r);
      if (spd > 0.01 && (e.dodgeT ?? 0) <= 0) {
        // pushing against something and getting nowhere: take the other side for a moment
        if (Math.hypot(e.pos.x - px0, e.pos.z - pz0) < spd * dt * 0.25) {
          e.stuckT = (e.stuckT ?? 0) + dt;
          if (e.stuckT > 0.45) {
            e.stuckT = 0;
            e.steerSide = -(e.steerSide || e.circleDir);
            e.steerT = 1.2;
            e.escapeT = 0.9;
          }
        } else e.stuckT = Math.max(0, (e.stuckT ?? 0) - dt * 2);
      }

      const moving = spd > 0 ? Math.min(1, spd / e.speed) : 0;
      e.moveAmt += (moving - e.moveAmt) * Math.min(1, dt * 8);
      e.phase += dt * 10 * e.moveAmt;
      if (e.anim) {
        e.anim.t += dt;
        if (e.anim.t >= e.anim.dur) e.anim = undefined;
      }
      const st = e.strike;
      const wind = st ? Math.min(1, st.t / st.windup) : 0;
      const hitK = Math.max(0, e.flash) / 0.14;
      if (e.rig.flash) e.rig.flash.value = hitK * hitK;
      if (e.rig.clip) {
        // movement in the samurai's own frame (+Z forward, +X its left) picks walk,
        // back-pedal or strafe; the strike/reaction clips play over it
        const c = Math.cos(e.yaw);
        const sn = Math.sin(e.yaw);
        const wx = mvx * spd;
        const wz = mvz * spd;
        const clipIn = {
          speed: Math.hypot(wx, wz),
          runSpeed: e.speed * 1.2,
          dirX: wx * c - wz * sn,
          dirZ: wx * sn + wz * c,
          guard: e.mode === 'guard' && e.guardT > 0,
          fight: e.variant === 'raio'
        };
        // a live blade window plays long frames as short steps (see updatePlayerClip)
        const bSteps = e.blade ? Math.min(8, Math.max(1, Math.ceil(dt * 60))) : 1;
        for (let bi = 0; bi < bSteps; bi++) {
          e.rig.clip.update(dt / bSteps, clipIn);
          if (e.blade) this.stepEnemyBlade(e, dt / bSteps);
        }
        // root travel of a move that owns it (the archer's dodge)
        e.rig.clip.consumeRoot(this.rootTmp);
        if (this.rootTmp.lengthSq() > 0) {
          e.pos.x += this.rootTmp.x * c + this.rootTmp.y * sn;
          e.pos.z += -this.rootTmp.x * sn + this.rootTmp.y * c;
        }
        this.updateBowFx(e);
      } else animateCharacter(e.rig, {
        moveAmt: e.moveAmt,
        phase: e.phase,
        air: false,
        t: this.time + i * 1.7,
        dt,
        anim: e.anim,
        windup: wind,
        windupKind: st ? st.kind : undefined,
        guard: e.mode === 'guard' && e.guardT > 0,
        broken: e.brokenT > 0,
        hit: hitK
      });

      e.rig.root.position.copy(e.pos);
      e.rig.root.rotation.y = e.yaw;

      // deathblow mark pulses while posture is broken
      if (e.dbMark) {
        e.dbMark.visible = e.brokenT > 0;
        if (e.dbMark.visible) e.dbMark.scale.setScalar((boss ? 0.28 : 0.42) * (1 + Math.sin(this.time * 12) * 0.18));
      }

      const pr = Math.min(1, e.posture / e.maxPosture);
      // a life bar only where it matters: the Oni, whoever is close, striking or staggered
      e.bar.visible = (e.hp < e.maxHp || pr > 0.01 || boss) && (boss || d < 9 || !!e.token || e.brokenT > 0);
      e.bar.position.set(e.pos.x, e.pos.y + (boss ? 5.3 : 2.6), e.pos.z);
      e.bar.quaternion.copy(this.camera.quaternion);
      e.barFg.scale.x = Math.max(0.001, e.hp / e.maxHp);
      if (e.postureBar) {
        e.postureBar.scale.x = Math.max(0.001, pr);
        const pm = e.postureBar.material as THREE.MeshBasicMaterial;
        if (e.brokenT > 0) pm.color.setRGB(1.6, 0.25 + Math.sin(this.time * 14) * 0.2, 0.15);
        else pm.color.setRGB(1, 0.85 - pr * 0.6, 0.3 - pr * 0.2);
      }
    }
  }

  // ---- Oni Trovão: bolts are marked on the ground (the first one leads the player a little,
  // the rest fall around), and strike a moment later
  private stepThunder(e: EnemyInstance, dt: number) {
    if (e.brokenT > 0 || e.staggerT > 0 || this.cine || this.state !== 'play') return;
    e.bossT = (e.bossT ?? 4.5) - dt;
    if (e.bossT > 0) return;
    e.bossT = e.fury ? 3.4 : 5;
    const P = this.player;
    const lim = R_ARENA - 2;
    for (let i = 0; i < (e.fury ? 4 : 3); i++) {
      let x = i === 0 ? P.pos.x + P.vel.x * 0.4 : P.pos.x + rand(-5.5, 5.5);
      let z = i === 0 ? P.pos.z + P.vel.z * 0.4 : P.pos.z + rand(-5.5, 5.5);
      const d = Math.hypot(x, z);
      if (d > lim) {
        x *= lim / d;
        z *= lim / d;
      }
      const ring = new THREE.Mesh(
        BOLT_RING,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
      );
      ring.position.set(x, 0.08, z);
      ring.scale.setScalar(0.4);
      ring.renderOrder = 7;
      const pillar = new THREE.Mesh(
        BOLT_PILLAR,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.05, 1.9), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
      );
      pillar.position.set(x, 11, z);
      pillar.visible = false;
      this.scene.add(ring, pillar);
      this.bolts.push({ x, z, t: 0, ring, pillar, struck: false });
    }
    sfx.danger();
  }

  // A column of light that only looks the part (teleports, a lightning-sword hit)
  private flashBolt(x: number, z: number, color: number) {
    const ring = new THREE.Mesh(BOLT_RING, new THREE.MeshBasicMaterial({ visible: false }));
    const pillar = new THREE.Mesh(
      BOLT_PILLAR,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.9), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    pillar.position.set(x, 11, z);
    pillar.scale.set(0.8, 1, 0.8);
    ring.visible = false;
    this.scene.add(ring, pillar);
    this.bolts.push({ x, z, t: BOLT_DELAY, ring, pillar, struck: true, visual: true });
  }

  // ---- The Shinobi and the Lutador do Raio: teleport. They slip out of sight and step out
  // near the player (front-left or front-right on screen, so it is seen), already starting a
  // chain; the Shinobi also throws a fan of stars from afar.
  private stepBlink(e: EnemyInstance, dt: number, d: number) {
    if (e.brokenT > 0 || e.staggerT > 0 || e.flee || this.cine || this.state !== 'play' || (e.vanishT ?? 0) > 0 || (e.castT ?? 0) > 0 || e.strike || (e.dodgeT ?? 0) > 0) return;
    const shinobi = e.variant === 'shinobi';
    e.abilT = (e.abilT ?? 3 + Math.random() * 2) - dt;
    if (shinobi) e.starCd = (e.starCd ?? 2.5 + Math.random() * 2) - dt;
    if (shinobi && (e.starCd ?? 1) <= 0 && d > 5.5 && d < 15) {
      e.starCd = 4.5 + Math.random() * 2;
      e.castT = 0.62;
      e.token = false;
      this.enemyClip(e, 'cast', { from: 0, speed: 1.25, fadeIn: 0.08, fadeOut: 0.25 });
      sfx.swing();
      this.timers.push({ at: this.time + 0.3, fn: () => this.releaseStars(e) });
      return;
    }
    // to close a gap - or, after a few idle seconds, to flank a target it can't get at
    if (e.abilT > 0 || (d < (shinobi ? 5.5 : 4.2) && e.abilT > -3.5)) return;
    e.abilT = shinobi ? 5.5 : 4.5;
    this.cancelStrike(e);
    e.token = false;
    this.blinkFx(e);
    sfx.dash();
    e.rig.clip?.stop(0.1);
    e.vanishT = shinobi ? 0.28 : 0.35;
    e.pos.set(0, -30, -39);
  }

  private blinkFx(e: EnemyInstance) {
    if (e.variant === 'raio') {
      this.flashBolt(e.pos.x, e.pos.z, 0xb69cff);
      this.emitParticles(e.pos.x, 1.4, e.pos.z, 22, 0xb69cff, 7, 2, 14, 0.45);
      sfx.boom();
    } else {
      this.emitParticles(e.pos.x, 1.3, e.pos.z, 22, 0x5ad0ff, 6, 2, 12, 0.4);
    }
    this.puff(e.pos.x, e.pos.z, 8, 3);
  }

  private blinkArrive(e: EnemyInstance) {
    const P = this.player;
    const toward = Math.atan2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
    const first = Math.random() < 0.5 ? 0.7 : -0.7;
    const dist = e.variant === 'shinobi' ? 2.5 : 2.2;
    let placed = false;
    for (const off of [first, -first, 0, 1.6, -1.6]) {
      const a = toward + off;
      const x = P.pos.x + Math.sin(a) * dist;
      const z = P.pos.z + Math.cos(a) * dist;
      if (Math.hypot(x, z) > R_ARENA - 2) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + e.r + 0.3)) continue;
      e.pos.set(x, 0, z);
      placed = true;
      break;
    }
    if (!placed) e.pos.set(P.pos.x * 0.6, 0, P.pos.z * 0.6);
    e.yaw = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z);
    this.blinkFx(e);
    sfx.swing();
    e.mode = 'attack';
    e.modeT = 0;
    e.t = 0;
    e.comboLeft = e.variant === 'shinobi' ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3);
    e.cd2 = 0.1;
    e.token = true;
  }

  // A fan of three stars at the player (they can be deflected, blocked or dodged)
  private releaseStars(e: EnemyInstance) {
    if (e.dead || e.flee || (e.vanishT ?? 0) > 0 || this.state !== 'play') return;
    e.rig.root.updateMatrixWorld(true);
    e.rig.handL.getWorldPosition(this.tmpH);
    const h = this.tmpH;
    const P = this.player;
    const base = Math.atan2(P.pos.x - h.x, P.pos.z - h.z);
    for (let i = -1; i <= 1; i++) {
      const a = base + i * 0.2;
      this.spawnProj({
        type: 'shuriken',
        friendly: false,
        pos: new THREE.Vector3(h.x, h.y, h.z),
        vel: new THREE.Vector3(Math.sin(a) * 17, 0, Math.cos(a) * 17),
        dmg: 7,
        life: 1.8,
        owner: e
      });
    }
    this.emitParticles(h.x, h.y, h.z, 10, 0x5ad0ff, 5, 1.5, 14, 0.3);
    sfx.swing();
  }

  private disposeBolt(b: { ring: THREE.Mesh; pillar: THREE.Mesh }) {
    this.scene.remove(b.ring, b.pillar);
    (b.ring.material as THREE.Material).dispose();
    (b.pillar.material as THREE.Material).dispose();
  }

  private updateBolts(dt: number) {
    const P = this.player;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const ringMat = b.ring.material as THREE.MeshBasicMaterial;
      if (!b.struck) {
        const k = Math.min(1, b.t / BOLT_DELAY);
        b.ring.scale.setScalar(BOLT_R * (0.25 + 0.75 * k));
        ringMat.opacity = 0.35 + 0.5 * k + Math.sin(b.t * 28) * 0.08;
        if (b.t >= BOLT_DELAY) {
          b.struck = true;
          b.pillar.visible = true;
          b.ring.scale.setScalar(BOLT_R);
          sfx.boom();
          this.world.props.slam(b.x, b.z, 1.5);
          this.shake = Math.max(this.shake, 0.3);
          this.emitParticles(b.x, 0.5, b.z, 22, 0x9fd0ff, 8, 2, 16, 0.4);
          const dx = P.pos.x - b.x;
          const dz = P.pos.z - b.z;
          const d = Math.hypot(dx, dz) || 0.001;
          if (this.state === 'play' && d < BOLT_R) {
            if (P.inv > 0) {
              if (P.dashInv) this.spawnLabel(P.pos.x, P.pos.y + 2.5, P.pos.z, 'ESQUIVOU!', '#8fe0c8', 1.1);
            } else this.damagePlayer(18, dx / d, dz / d);
          }
        }
      } else {
        const f = Math.max(0, 1 - (b.t - BOLT_DELAY) / 0.2);
        (b.pillar.material as THREE.MeshBasicMaterial).opacity = 0.9 * f;
        ringMat.opacity = 0.9 * f;
        b.pillar.scale.x = b.pillar.scale.z = 0.6 + 0.4 * f;
        if (f <= 0) {
          this.disposeBolt(b);
          this.bolts.splice(i, 1);
        }
      }
    }
  }

  // ---- Oni Sombrio: it slips out of sight and steps out near the player, already winding
  // up a sweep to jump (to the front-left or front-right on screen, so it is seen coming)
  private stepShadow(e: EnemyInstance, dt: number, d: number) {
    if (e.brokenT > 0 || e.staggerT > 0 || this.cine || this.state !== 'play' || (e.vanishT ?? 0) > 0) return;
    e.bossT = (e.bossT ?? 6) - dt;
    if (e.bossT > 0 || e.strike || d < 3) return;
    e.bossT = e.fury ? 5 : 7.5;
    this.cancelStrike(e);
    e.token = false;
    this.puff(e.pos.x, e.pos.z, 16, 4);
    this.emitParticles(e.pos.x, 1.6, e.pos.z, 24, 0x8050d0, 6, 2, 14, 0.5);
    sfx.dash();
    e.rig.clip?.stop(0.1);
    e.vanishT = 0.85;
    e.pos.set(0, -30, -39);
  }

  private shadowStrike(e: EnemyInstance) {
    const P = this.player;
    // on screen, ahead of the camera's view of the player
    const toward = Math.atan2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
    const first = Math.random() < 0.5 ? 0.7 : -0.7;
    let placed = false;
    for (const off of [first, -first, 0, 1.6]) {
      const a = toward + off;
      const x = P.pos.x + Math.sin(a) * 4.6;
      const z = P.pos.z + Math.cos(a) * 4.6;
      if (Math.hypot(x, z) > R_ARENA - 2) continue;
      if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + e.r + 0.3)) continue;
      e.pos.set(x, 0, z);
      placed = true;
      break;
    }
    if (!placed) e.pos.set(P.pos.x * 0.5, 0, P.pos.z * 0.5);
    e.yaw = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z);
    this.puff(e.pos.x, e.pos.z, 18, 4.5);
    this.emitParticles(e.pos.x, 1.6, e.pos.z, 26, 0x8050d0, 7, 2, 14, 0.5);
    sfx.boom();
    this.shake = Math.max(this.shake, 0.25);
    e.mode = 'attack';
    e.modeT = 0;
    e.t = 0;
    e.comboLeft = 1;
    e.cd2 = 0.1;
    e.forcePeril = true;
  }

  // The Oni at half life: a roar, a red aura, faster everything and longer chains; its
  // slams now throw a shockwave (see spawnShock)
  private startFury(e: EnemyInstance) {
    e.fury = true;
    this.cancelStrike(e);
    e.blade = undefined;
    e.mode = 'recover';
    e.modeT = 0;
    e.staggerT = Math.max(e.staggerT, 1.5);
    e.cd = Math.max(e.cd, 1.6);
    this.enemyClip(e, 'powerUp', { from: 0.3, to: 1.9, speed: 1.1, fadeIn: 0.15 });
    if (e.aura) this.disposeAura(e);
    e.aura = this.makeAura(e.variant ? BOSS_COLOR[e.variant] : 0xff3018, e.variant ? 3.1 : 2.6);
    this.shake = Math.max(this.shake, 0.45);
    sfx.boom();
    this.spawnLabel(e.pos.x, e.pos.y + 6.2, e.pos.z, 'FÚRIA!', '#ff3b24', 1.8);
    this.callbacks.onWaveChange(this.wave, 'A Fúria do Oni', 'Cada golpe pesado abala o chão: pule a onda de choque');
    this.lastBossKey = -1;
  }

  private disposeAura(e: EnemyInstance) {
    if (!e.aura) return;
    this.scene.remove(e.aura);
    e.aura.geometry.dispose();
    (e.aura.material as THREE.Material).dispose();
    e.aura = undefined;
  }

  private spawnShock(x: number, z: number) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.55, 0.2), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    mesh.position.set(x, 0.09, z);
    mesh.scale.setScalar(0.5);
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this.shocks.push({ x, z, r: 0.5, mesh, hit: false });
    this.shake = Math.max(this.shake, 0.3);
    this.emitParticles(x, 0.3, z, 18, 0xff8a40, 6, 2, 8, 0.5);
  }

  private disposeShock(sh: { mesh: THREE.Mesh }) {
    this.scene.remove(sh.mesh);
    sh.mesh.geometry.dispose();
    (sh.mesh.material as THREE.Material).dispose();
  }

  // Expanding ground ring: it hurts whoever it passes over while on the ground - jump it
  // (or dash through it)
  private updateShocks(dt: number) {
    const P = this.player;
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      const r0 = s.r;
      s.r += 12 * dt;
      this.world.props.shock(s.x, s.z, r0, s.r, s);
      // a low rolling wall of dust rides the ring
      for (let k = this.quality === 'low' ? 2 : 4; k > 0; k--) {
        const a = rand(0, TAU);
        this.puff(s.x + Math.sin(a) * s.r, s.z + Math.cos(a) * s.r, 1, 2.2, Math.sin(a), Math.cos(a));
      }
      s.mesh.scale.setScalar(s.r);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - s.r / 11));
      const dx = P.pos.x - s.x;
      const dz = P.pos.z - s.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (!s.hit && this.state === 'play' && Math.abs(d - s.r) < 0.75) {
        s.hit = true;
        if (P.pos.y > 0.4) {
          this.spawnLabel(P.pos.x, P.pos.y + 2.5, P.pos.z, 'SALTOU!', '#ffd166', 1.2);
        } else if (P.inv > 0) {
          if (P.dashInv) this.spawnLabel(P.pos.x, P.pos.y + 2.5, P.pos.z, 'ESQUIVOU!', '#8fe0c8', 1.1);
        } else {
          this.damagePlayer(16, dx / d, dz / d);
        }
      }
      if (s.r > 11) {
        this.disposeShock(s);
        this.shocks.splice(i, 1);
      }
    }
  }

  // Is the player's weapon cutting through the air right now (a swing with the blade moving fast)?
  private stepCutBlade(dt: number): boolean {
    const a = this.act;
    const w = this.weapons[this.activeWeaponIdx];
    this.cutActive = !!a && (a.kind === 'attack' || a.kind === 'special') && !!a.move && (a.move.eff ?? 'sword') === 'sword' && w?.kind === 'melee' && a.windows.length > 0 && !!this.player.rig.clip;
    if (!this.cutActive) return false;
    this.cutCur.a.copy(this.bladeCur.a);
    this.cutCur.b.copy(this.bladeCur.b);
    return this.cutPrevOk && this.cutCur.b.distanceTo(this.cutPrev.b) / Math.max(dt, 1e-3) >= CUT_MIN_SPEED;
  }

  // The blade's path since last frame against the shot's path this frame (a little generous,
  // like every other hit test: TUNE.hitAssist)
  private bladeCutsShot(p: ProjectileInstance, dt: number): boolean {
    const [c, d, pa, pb] = this.cutV;
    pa.set(p.pos.x - p.vel.x * dt, p.pos.y - p.vel.y * dt, p.pos.z - p.vel.z * dt);
    pb.copy(p.pos);
    const reach = 0.3 + 0.3 * TUNE.hitAssist;
    for (const k of [0.25, 0.5, 0.75, 1]) {
      c.lerpVectors(this.cutPrev.a, this.cutCur.a, k);
      d.lerpVectors(this.cutPrev.b, this.cutCur.b, k);
      if (segSegDist(c, d, pa, pb) < reach) return true;
    }
    return false;
  }

  // Does the shot come from inside the cone the player is facing?
  private shotComesFromFront(p: ProjectileInstance): boolean {
    if (TUNE.arrowDirectional <= 0.5) return true;
    const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
    const dot = (-p.vel.x / vl) * Math.sin(this.player.yaw) + (-p.vel.z / vl) * Math.cos(this.player.yaw);
    return dot >= Math.cos((TUNE.arrowCone * Math.PI) / 180);
  }

  // A shot is stopped by the weapon: cut out of the air by a swing, or parried with a timed
  // guard. Seen coming (inside the cone) it goes back at whoever loosed it. true = it lives on.
  private defendShot(p: ProjectileInstance, how: 'cut' | 'parry', front: boolean): boolean {
    const P = this.player;
    const mid = this.tmpV.copy(p.pos);
    this.impacts.spawn(mid, IMPACT_DEFLECT, 1.4, 0.14);
    this.emitParticles(mid.x, mid.y, mid.z, 16, 0xffb347, 7, 2, 16, 0.25);
    sfx.clang();
    this.waveStat.deflects++;
    this.deflectsTotal++;
    if (how === 'parry') this.playerDeflectAnim();
    if (!(TUNE.arrowReflect > 0.5 && front)) {
      this.spawnLabel(P.pos.x, P.pos.y + 2.5, P.pos.z, 'DESVIOU!', '#8fe0c8', 1);
      return false;
    }
    const o = p.owner && !p.owner.dead && !p.owner.flee ? p.owner : null;
    let dx = o ? o.pos.x - p.pos.x : -p.vel.x;
    let dz = o ? o.pos.z - p.pos.z : -p.vel.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    p.vel.set(dx * SHOT_BACK_SPEED, 0, dz * SHOT_BACK_SPEED);
    p.friendly = true;
    p.dmg = Math.round(p.dmg * 2.2);
    p.life = 1.4;
    p.hit = new Set();
    p.reflected = true;
    this.spawnLabel(P.pos.x, P.pos.y + 2.5, P.pos.z, 'REBATIDA!', '#ffd166', 1.3);
    this.parryZoom(true);
    return true;
  }

  // The swords really meet: the point of the enemy's blade nearest the player's chest is where the
  // blades cross, and the player's weapon is turned (for a moment) so its blade lies across that point.
  // Returns the meeting point (null: nothing to pose - a kick, no weapon, no blade).
  private clashPose(e: EnemyInstance): THREE.Vector3 | null {
    const P = this.player;
    const w = this.weapons[this.activeWeaponIdx];
    const mesh = P.weaponMeshes[this.activeWeaponIdx];
    if (!P.rig.clip || !mesh || !mesh.visible || !mesh.parent || w.kind !== 'melee' || !BLADE_SEG[w.id]) return null;
    if (e.blade?.limb === 'foot' || !this.readEnemyBlade(e, false, this.clashSeg)) return null;
    const seg = this.clashSeg;
    const chest = this.tmpH.set(P.pos.x, P.pos.y + 1.3, P.pos.z);
    const ab = this.tmpV.subVectors(seg.b, seg.a);
    const t = Math.max(0, Math.min(1, chest.clone().sub(seg.a).dot(ab) / Math.max(ab.lengthSq(), 1e-6)));
    const meet = seg.a.clone().addScaledVector(ab, t);
    // pose the weapon: its blade from the grip toward the meeting point, its edge facing the foe
    P.rig.root.updateMatrixWorld(true);
    const grip = mesh.getWorldPosition(new THREE.Vector3());
    const dist = grip.distanceTo(meet);
    if (dist < 0.3 || dist > 2.4) return meet;
    const o = this.clashObj;
    o.position.copy(grip);
    o.up.set(e.pos.x - grip.x, 0.2, e.pos.z - grip.z).normalize();
    o.lookAt(meet);
    o.updateMatrixWorld(true);
    const local = mesh.parent.getWorldQuaternion(this.clashQ).invert().multiply(o.quaternion);
    this.endClash();
    this.clash = { mesh, q: mesh.quaternion.clone(), t: CLASH_POSE_TIME };
    mesh.quaternion.copy(local);
    return meet;
  }

  private endClash() {
    if (!this.clash) return;
    this.clash.mesh.quaternion.copy(this.clash.q);
    this.clash = null;
  }

  private stepClash(dt: number) {
    if (!this.clash) return;
    this.clash.t -= dt;
    if (this.clash.t <= 0) this.endClash();
  }

  // A short push-in on a defence: rare, brief and never a lock on the controls
  private parryZoom(strong: boolean) {
    if (!this.settings.cinematicCamera || TUNE.parryZoom < 0.5) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (this.time - this.lastParryZoom < (strong ? 2.5 : 5)) return;
    this.lastParryZoom = this.time;
    this.punchT = 0;
    this.punchDur = strong ? 0.5 : 0.38;
  }

  // The tip of the blow's blade lights up for an instant (and ticks): guard pressed on it is a perfect parry
  private tellFlash(e: EnemyInstance, st: EnemyStrike) {
    const P = this.player.pos;
    if (Math.hypot(e.pos.x - P.x, e.pos.z - P.z) > st.reach + 2.2) return;
    const seg = this.clashSeg;
    const p = this.tmpV;
    if (!st.limb && this.readEnemyBlade(e, false, seg)) p.copy(seg.b);
    else p.set(e.pos.x, e.pos.y + 1.3, e.pos.z);
    const big = e.type === 'boss';
    this.impacts.spawn(p, IMPACT_TELL, big ? 2 : 1.05, 0.14);
    sfx.tell();
  }

  // Starts the defence scene when this parry is worth one (see TUNE.parryScene); false: not this time
  private startParryScene(e: EnemyInstance, meet: THREE.Vector3 | null, perfect: boolean, thrust: boolean): boolean {
    const lvl = Math.max(0, Math.min(3, Math.round(TUNE.parryScene)));
    if (lvl < 1 || this.parryScene || this.cine || this.state !== 'play') return false;
    if (!this.settings.cinematicCamera) return false;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    const big = e.type === 'boss' || !!e.captain;
    const worth = perfect || big || lvl >= 3 || (lvl >= 2 && (thrust || this.waveStat.deflects === 1));
    if (!worth || this.time - this.lastParryScene < PARRY_SCENE_GAP[lvl]) return false;
    const P = this.player.pos;
    // a crowd on top of the two fighters would make the shot unreadable (and the pause unfair)
    let near = 0;
    for (const o of this.enemies) if (o !== e && !o.dead && !o.flee && !isFodder(o) && Math.hypot(o.pos.x - P.x, o.pos.z - P.z) < 4.5) near++;
    if (near >= 2 && !big) return false;
    let ax = e.pos.x - P.x;
    let az = e.pos.z - P.z;
    const ad = Math.hypot(ax, az) || 1;
    ax /= ad;
    az /= ad;
    const mx = (P.x + e.pos.x) / 2;
    const mz = (P.z + e.pos.z) / 2;
    const dist = this.camera.aspect < 1 ? 4.3 : 3.4;
    // the camera stands to one side of the fighters, on whichever side no trunk or pillar is in the way
    const free = (side: number) => {
      const cx = mx - az * side * dist - ax * 0.5;
      const cz = mz + ax * side * dist - az * 0.5;
      return !this.solids.some((so) => so.h > 0.9 && Math.hypot(so.x - cx, so.z - cz) < so.r + 0.7);
    };
    this.parrySide = -this.parrySide;
    let side = this.parrySide;
    if (!free(side)) side = -side;
    const camOk = free(side);
    const heavy = perfect || big;
    this.parryScene = { t: 0, dur: heavy ? 0.85 : 0.65, e, mid: meet ? meet.clone() : new THREE.Vector3(mx, P.y + 1.35, mz), side, camOk, spark: 0 };
    this.lastParryScene = this.time;
    this.triggerSlowmo(heavy ? 0.5 : 0.36, heavy ? 0.2 : 0.3);
    // the blades hold where they met a little longer, and the player is untouchable for the moment
    if (this.clash) this.clash.t = Math.max(this.clash.t, 0.34);
    this.player.inv = Math.max(this.player.inv, 0.35);
    this.flashFx = Math.max(this.flashFx, heavy ? 0.4 : 0.22);
    this.spikeFx = Math.max(this.spikeFx, heavy ? 0.7 : 0.4);
    this.callbacks.onCinematic?.(true, 'duel');
    return true;
  }

  private endParryScene() {
    if (!this.parryScene) return;
    this.parryScene = null;
    if (!this.cine) this.callbacks.onCinematic?.(false);
  }

  // Runs after the normal camera: blends it into the low side shot while the scene lasts
  private applyParryScene(real: number, look: THREE.Vector3) {
    const s = this.parryScene;
    if (!s) return;
    s.t += real;
    if (s.t >= s.dur || this.cine || this.state !== 'play') {
      this.endParryScene();
      return;
    }
    const ss = (a: number, b: number, x: number) => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    const w = ss(0, 0.14, s.t) * (1 - ss(s.dur - 0.24, s.dur, s.t));
    // sparks stream off the crossed blades for the first part of the scene
    s.spark -= real;
    if (s.spark <= 0 && s.t < s.dur * 0.65) {
      s.spark = 0.06;
      this.emitParticles(s.mid.x, s.mid.y, s.mid.z, 6, 0xffe0a0, 7, 1.6, 12, 0.3);
      if (Math.random() < 0.4) this.impacts.spawn(s.mid, IMPACT_DEFLECT, 0.9 + Math.random() * 0.5, 0.09);
    }
    if (!s.camOk || w < 0.001) return;
    const P = this.player.pos;
    const e = s.e;
    let ax = e.pos.x - P.x;
    let az = e.pos.z - P.z;
    const ad = Math.hypot(ax, az) || 1;
    ax /= ad;
    az /= ad;
    const f = this.parryFocus.set((P.x + e.pos.x) / 2, P.y + 1.3, (P.z + e.pos.z) / 2);
    f.x += (s.mid.x - f.x) * 0.4;
    f.z += (s.mid.z - f.z) * 0.4;
    const portrait = this.camera.aspect < 1;
    const dist = portrait ? 4.3 : 3.4;
    const camX = f.x - az * s.side * dist - ax * 0.5;
    const camZ = f.z + ax * s.side * dist - az * 0.5;
    const camY = Math.max(0.5, P.y + 0.95);
    this.camera.position.x += (camX - this.camera.position.x) * w;
    this.camera.position.y += (camY - this.camera.position.y) * w;
    this.camera.position.z += (camZ - this.camera.position.z) * w;
    look.lerp(f, w);
    const fov = portrait ? 52 : 44;
    this.camera.fov += (fov - this.camera.fov) * w;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(look);
    this.camera.rotateZ(0.04 * s.side * w);
    // depth of field on the pair (high quality only, like the finisher's)
    this.cineW = w * 0.6;
    this.cineFocus.copy(f);
  }

  // While the guard is up the player turns toward an arrow or star coming from the side, so a defence
  // isn't lost to which way the stick was last pushed (never one from behind: that one is on you)
  private assistGuardFacing(dt: number) {
    if (TUNE.arrowDirectional <= 0.5 || !this.guarding()) return;
    const P = this.player;
    let best: ProjectileInstance | null = null;
    let bd = 16;
    for (const p of this.projectiles) {
      if (p.friendly || (p.type !== 'arrow' && p.type !== 'shuriken')) continue;
      const dx = P.pos.x - p.pos.x;
      const dz = P.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || d < 0.5) continue;
      if ((p.vel.x * dx + p.vel.z * dz) / (d * (Math.hypot(p.vel.x, p.vel.z) || 1)) < 0.8) continue;
      best = p;
      bd = d;
    }
    if (!best) return;
    // a shot off to the side is pulled into the cone; one from behind is not (turn to meet it)
    const want = Math.atan2(-best.vel.x, -best.vel.z);
    const off = Math.abs(wrap(want - P.yaw));
    if (off > ((TUNE.arrowCone * Math.PI) / 180) * 0.6 && off < 1.75) P.yaw = turnTo(P.yaw, want, Math.min(1, dt * 6));
  }

  // Warnings for what the player cannot see: an archer drawing its bow, a thrower casting, a
  // shot already on its way - shown as markers at the screen edge by the UI, with a chirp
  private stepThreats(dt: number) {
    this.threatT -= dt;
    if (this.threatT > 0) return;
    this.threatT = 0.1;
    const P = this.player.pos;
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    const half = Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect) * 0.85;
    const out: { a: number; u: number }[] = [];
    const live = new Set<EnemyInstance>();
    if (this.state === 'play' && !this.cine) {
      const angleOf = (x: number, z: number) => Math.atan2((x - P.x) * rx + (z - P.z) * rz, (x - P.x) * fx + (z - P.z) * fz);
      for (const e of this.enemies) {
        if (e.dead || e.flee) continue;
        const aiming = (e.type === 'archer' && ((!!e.bow && e.bow.phase !== 'release') || !!e.shotPending)) || (e.castT ?? 0) > 0;
        if (!aiming) continue;
        const a = angleOf(e.pos.x, e.pos.z);
        if (Math.abs(a) <= half) continue;
        live.add(e);
        out.push({ a: Math.round(a * 20) / 20, u: 0.7 });
        if (!this.warnedShooters.has(e)) {
          this.warnedShooters.add(e);
          sfx.warn();
        }
      }
      for (const p of this.projectiles) {
        if (p.friendly || (p.type !== 'arrow' && p.type !== 'shuriken')) continue;
        const dx = P.x - p.pos.x;
        const dz = P.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 18 || (p.vel.x * dx + p.vel.z * dz) / (d * (Math.hypot(p.vel.x, p.vel.z) || 1)) < 0.85) continue;
        const a = angleOf(p.pos.x, p.pos.z);
        if (Math.abs(a) > half) out.push({ a: Math.round(a * 20) / 20, u: 1 });
      }
    }
    for (const e of this.warnedShooters) if (!live.has(e)) this.warnedShooters.delete(e);
    const key = out.map((t) => `${t.a}:${t.u}`).join(',');
    if (key !== this.lastThreatKey) {
      this.lastThreatKey = key;
      this.callbacks.onThreats?.(out);
    }
  }

  private updateProjectiles(dt: number) {
    const swinging = this.stepCutBlade(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.grav) p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.type === 'kunai' || p.type === 'arrow') {
        p.mesh.lookAt(this.tmpV.copy(p.pos).add(p.vel));
      } else if (p.type === 'shuriken') {
        p.mesh.rotation.y += dt * 24;
      } else if (p.type === 'bomb') {
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.z += dt * 4;
      } else if (p.type === 'wave') {
        p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z) + Math.PI;
      }

      let dead = p.life <= 0 || Math.hypot(p.pos.x, p.pos.z) > 55;
      let exploded = false;
      if (!dead && p.grav && p.pos.y <= 0.05) {
        p.pos.y = 0.05;
        dead = true;
      }
      if (!dead && p.friendly) {
        for (const e of this.enemies) {
          if (e.dead || (p.hit && p.hit.has(e))) continue;
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < e.r + 0.45) {
            if (p.bomb) {
              this.explodeAt(p.pos.x, p.pos.y, p.pos.z, p.aoeR || 3.2, p.dmg, p.kb || 8);
              dead = true;
              exploded = true;
              break;
            }
            // knockback wants a unit direction, not the projectile's speed (which flung
            // targets tens of metres)
            const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
            this.hitEnemy(e, p.dmg, p.vel.x / vl, p.vel.z / vl, p.kb || 3, false);
            if (p.pierce) p.hit?.add(e);
            else {
              dead = true;
              break;
            }
          }
        }
      } else if (!dead && !p.friendly) {
        const ranged = TUNE.arrowDirectional > 0.5 && (p.type === 'arrow' || p.type === 'shuriken');
        let handled = false;
        // a weapon swung through its path cuts a shot out of the air (and, facing it, sends it back)
        if (ranged && swinging && this.player.inv <= 0 && this.bladeCutsShot(p, dt)) {
          handled = true;
          if (!this.defendShot(p, 'cut', this.shotComesFromFront(p))) dead = true;
        }
        if (!handled && Math.hypot(p.pos.x - this.player.pos.x, p.pos.z - this.player.pos.z) < 0.6) {
          dead = true;
          const canAct = this.player.staggerT <= 0 && this.player.inv <= 0;
          const mid = this.tmpV.copy(p.pos);
          // only what is faced can be parried or blocked; from the side or behind it just hits
          const front = !ranged || this.shotComesFromFront(p);
          if (canAct && front && this.time - this.player.guardPressT <= TUNE.parryWindow) {
            if (ranged) dead = !this.defendShot(p, 'parry', true);
            else {
              this.impacts.spawn(mid, IMPACT_DEFLECT, 1.4, 0.14);
              this.emitParticles(mid.x, mid.y, mid.z, 14, 0xffb347, 7, 2, 16, 0.25);
              this.playerDeflectAnim();
              sfx.clang();
            }
          } else if (canAct && front && this.guarding()) {
            this.impacts.spawn(mid, IMPACT_BLOCK, 1, 0.1);
            this.addPlayerPosture(10);
            sfx.block();
          } else {
            const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
            if (canAct && ranged && !front && this.guarding()) this.spawnLabel(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z, 'NAS COSTAS!', '#ff8a7a', 1.1);
            this.damagePlayer(p.dmg, p.vel.x / vl, p.vel.z / vl, true);
          }
        }
      }

      if (dead) {
        if (p.bomb && !exploded) {
          this.explodeAt(p.pos.x, p.pos.y, p.pos.z, p.aoeR || 3.2, p.dmg, p.kb || 8);
        }
        this.killProj(i);
      }
    }
    // this frame's weapon path becomes the "last frame" of the next
    if (this.cutActive) {
      this.cutPrev.a.copy(this.cutCur.a);
      this.cutPrev.b.copy(this.cutCur.b);
      this.cutPrevOk = true;
    } else this.cutPrevOk = false;
  }

  private updatePickups(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.m.position.y = 0.8 + Math.sin(p.t * 3) * 0.15;
      p.m.rotation.y += dt * 2;
      const got = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) < 1.3;
      if (got) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
        sfx.pick();
      }
      if (got || p.t > 16) {
        this.scene.remove(p.m);
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateScrolls(dt: number) {
    for (let i = this.scrolls.length - 1; i >= 0; i--) {
      const s = this.scrolls[i];
      s.t += dt;
      s.g.rotation.y += dt * 2;
      const bob = Math.sin(s.t * 3) * 0.1;
      s.g.position.y = 0.9 + bob;
      s.glyph.position.y = 1.75 + bob;
      // Blink during the last 4s before the scroll vanishes
      s.glyph.visible = s.t < 11 || Math.floor(s.t * 6) % 2 === 0;
      const got = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z) < 1.4;
      if (got) {
        this.player.special[s.w] = this.specialDuration();
        this.callbacks.onSpecialsUpdate({ ...this.player.special });
        const w = this.weapons[s.w];
        this.callbacks.onWaveChange(this.wave, SPECIALS[w.id]?.name ?? 'Especial', `${w.name}: especial por ${this.specialDuration()}s`);
        sfx.special();
      }
      if (got || s.t > 15) {
        this.removeScroll(i);
      }
    }
  }

  private drawMinimap() {
    const W = this.minimapCanvas.width;
    const c = W / 2;
    const s = (W / 2 - 6) / 30;
    this.mmCtx.clearRect(0, 0, W, W);
    this.mmCtx.save();
    this.mmCtx.beginPath();
    this.mmCtx.arc(c, c, c - 2, 0, TAU);
    this.mmCtx.clip();

    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    const toS = (x: number, z: number) => {
      const dx = x - this.player.pos.x;
      const dz = z - this.player.pos.z;
      return [c + (dx * rx + dz * rz) * s, c - (dx * fx + dz * fz) * s];
    };

    this.mmCtx.strokeStyle = 'rgba(239,230,210,.25)';
    this.mmCtx.lineWidth = 2;
    const o = toS(0, 0);
    this.mmCtx.beginPath();
    this.mmCtx.arc(o[0], o[1], R_ARENA * s, 0, TAU);
    this.mmCtx.stroke();

    // Conquista posts: a diamond (red while hostile, jade once taken); a far one rides the rim
    for (const post of this.posts) {
      let q = toS(post.x, post.z);
      const off = Math.hypot(q[0] - c, q[1] - c);
      const lim = c - 12;
      if (off > lim) q = [c + ((q[0] - c) / off) * lim, c + ((q[1] - c) / off) * lim];
      this.mmCtx.fillStyle = post.captured ? '#4fd6a8' : '#ff5a4a';
      this.mmCtx.strokeStyle = 'rgba(239,230,210,.85)';
      this.mmCtx.lineWidth = 1.5;
      this.mmCtx.beginPath();
      this.mmCtx.moveTo(q[0], q[1] - 7);
      this.mmCtx.lineTo(q[0] + 6, q[1]);
      this.mmCtx.lineTo(q[0], q[1] + 7);
      this.mmCtx.lineTo(q[0] - 6, q[1]);
      this.mmCtx.closePath();
      this.mmCtx.fill();
      this.mmCtx.stroke();
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      const q = toS(e.pos.x, e.pos.z);
      this.mmCtx.fillStyle = e.captain ? '#ffd166' : e.type === 'boss' ? '#f2a65a' : e.type === 'archer' ? '#d88ad0' : isFodder(e) ? '#b98a56' : '#e0404a';
      this.mmCtx.beginPath();
      this.mmCtx.arc(q[0], q[1], e.captain ? 6 : e.type === 'boss' ? 7 : isFodder(e) ? 2.5 : 4, 0, TAU);
      this.mmCtx.fill();
    }
    this.mmCtx.restore();

    // Player arrow
    const sx = Math.sin(this.player.yaw);
    const sz = Math.cos(this.player.yaw);
    this.mmCtx.save();
    this.mmCtx.translate(c, c);
    this.mmCtx.rotate(Math.atan2(sx * rx + sz * rz, sx * fx + sz * fz));
    this.mmCtx.fillStyle = '#efe6d2';
    this.mmCtx.beginPath();
    this.mmCtx.moveTo(0, -8);
    this.mmCtx.lineTo(5, 5);
    this.mmCtx.lineTo(-5, 5);
    this.mmCtx.closePath();
    this.mmCtx.fill();
    this.mmCtx.restore();
  }

  public resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.fx?.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.baseFov = this.camera.aspect < 1 ? 72 : 60;
    this.camera.fov = this.baseFov + this.fovKick;
    this.camera.updateProjectionMatrix();
  }

  // One frame of the fight itself: player, enemies, projectiles, goal and the wave clear
  private stepPlay(dt: number) {
    this.stepProgress(dt);
    this.updatePlayerMovementAndCamera(dt);
    this.updateEnemies(dt);
    this.updateShocks(dt);
    this.updateBolts(dt);
    this.updateProjectiles(dt);
    this.stepClash(dt);
    this.assistGuardFacing(dt);
    this.stepThreats(dt);
    this.updatePickups(dt);
    this.updateScrolls(dt);
    this.updateReticle(dt);
    this.stepGoal(dt);
    this.stepReinforcements(dt);
    if (this.mode === 'conquest') this.stepConquest(dt);

    const alive = this.waveQueue.length > 0 || this.enemies.some((e) => !e.dead);
    // a Resistir wave is not over while the clock runs, even with the field empty
    // (Conquista: between posts there is nobody to beat, so nothing is "cleared" until a post is woken)
    const betweenPosts = this.mode === 'conquest' && this.conq.active < 0;
    if (!alive && this.wave > 0 && !betweenPosts && !(this.goal && !this.goal.done && this.goal.id === 'resistir')) {
      if (!this.clearedShown) {
        this.clearedShown = true;
        const rank = this.waveRank();
        this.ranks.push(rank);
        this.bestRank = Math.max(this.bestRank, ['D', 'C', 'B', 'A', 'S'].indexOf(rank));
        if (!this.player.tookDamage) this.flawless++;
        let gain = this.addHonor('wave', HONOR.waveBase + HONOR.wavePer * this.wave) + this.addHonor('rank', HONOR.rank[rank]);
        if (this.waveMod) {
          gain += this.addHonor('mod', this.waveMod.honor);
          this.modWaves++;
        } else if (this.goal) {
          gain += this.addHonor('mod', this.goal.honor);
          this.modWaves++;
        }
        gain = Math.round(gain);
        this.player.score += 100 * this.wave;
        this.callbacks.onScoreChange(this.player.score);
        this.callbacks.onWaveChange(this.wave, `${this.mode === 'conquest' ? 'Posto tomado' : 'Onda limpa'} · Nota ${rank}`, `+${100 * this.wave} pontos · +${gain} 誉`);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
      }
      this.waveTimer += dt;
      if (this.waveTimer > 2.5) {
        this.waveTimer = 0;
        if (this.mode === 'conquest') this.captureOutpost();
        else this.nextWave();
      }
    }
  }

  public loop = () => {
    this.reqId = requestAnimationFrame(this.loop);
    const real = Math.min(this.clock.getDelta(), 0.05);
    if ((this.paused || this.cardOffer) && this.state === 'play') {
      this.render();
      return;
    }
    let dt = real;
    if (this.hitstop > 0) {
      this.hitstop -= real;
      dt = real * 0.08;
    } else if (this.slowmoT > 0) {
      this.slowmoT -= real;
      dt = real * this.slowmoScale;
    }
    this.time += dt;

    if (this.state === 'play') {
      this.stepPlay(dt);
    } else {
      this.reticle.visible = false;
      this.camYaw += real * 0.12;
      this.player.phase += real * 2;
      if (this.player.rig.clip) {
        this.player.rig.clip.update(real, { speed: 0, runSpeed: TUNE.moveMaxSpeed, dirX: 0, dirZ: 1, fight: this.weapons[this.activeWeaponIdx]?.kind === 'karate' });
      } else {
        animateCharacter(this.player.rig, {
          moveAmt: 0,
          phase: this.player.phase,
          air: false,
          t: this.time,
          dt: real,
          weapon: this.weapons[this.activeWeaponIdx]?.id
        });
      }
      this.player.rig.root.position.copy(this.player.pos);
      this.player.rig.root.rotation.y = this.player.yaw;
    }

    this.updateParticles(dt);
    this.impacts.update(dt);
    this.decals.update(dt);
    this.dust.update(dt);
    this.ghosts.update(real);
    this.updateChain(dt);
    this.updateLabels(dt);
    this.updateCamera(real);

    this.world.update(dt, this.time, this.player.pos, this.camera.position);
    this.renderer.toneMappingExposure = this.world.atm.exposure;
    this.applyRimBoost(this.world.atm.rimBoost);
    if (this.fx) {
      this.fx.setLook(this.world.atm.look);
      // sun position on screen for the light shafts (fade out when it leaves the view)
      const atm = this.world.atm;
      this.tmpV.copy(this.camera.position).addScaledVector(atm.sunDir, 200).project(this.camera);
      let rays = 0;
      if (this.profile.rays && this.tmpV.z < 1) {
        this.sunUv.set(this.tmpV.x * 0.5 + 0.5, this.tmpV.y * 0.5 + 0.5);
        const off = Math.max(Math.abs(this.tmpV.x), Math.abs(this.tmpV.y));
        rays = atm.rays * (1 - Math.min(1, Math.max(0, off - 1) / 0.6));
      }
      this.fx.setStylize(this.profile.ink ? 0.4 : 0, rays, this.sunUv, atm.sunGlow, this.camera.near, this.camera.far);
    }

    this.updateFx(real);
    this.drawDebug();
    this.render();
    this.drawMinimap();
  };

  // Kusarigama chain: shoots out from the hand to full reach and snaps back; during the
  // special it whirls around the player
  private updateChain(dt: number) {
    const striking = this.chainT < 0.36;
    const spinning = this.chainSpin > 0;
    if (!striking && !spinning) {
      this.chain.visible = false;
      return;
    }
    this.chainT += dt;
    if (spinning) this.chainSpin = Math.max(0, this.chainSpin - dt);
    this.player.rig.root.updateMatrixWorld(true);
    this.player.rig.hand.getWorldPosition(this.tmpH);
    let yaw = this.player.yaw;
    let len: number;
    if (spinning) {
      yaw += (0.45 - this.chainSpin) * Math.PI * 4.4;
      len = 6.5;
    } else {
      const t = this.chainT;
      len = 6.5 * (t < 0.14 ? t / 0.14 : Math.max(0, 1 - (t - 0.14) / 0.22));
    }
    this.chain.visible = len > 0.05;
    this.chain.position.copy(this.tmpH);
    this.chain.rotation.set(0, yaw, 0);
    this.chainLink.scale.set(1, 1, len);
    this.chainTip.position.set(0, 0, len);
    this.chainTip.rotation.set(0, 0, this.time * 20);
  }

  private trailPrevTip = new THREE.Vector3();
  private trailPrevOk = false;

  // The streak follows exactly the segment that cuts (the same one the hit test uses),
  // so what the player sees is what connects: the blade for sword and staff, wrist-to-hand
  // or shin-to-toe for punches and kicks. Kusarigama keeps its own short sickle span.
  private limbTrail(model: THREE.Object3D | undefined, eff: string, a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (!model) return false;
    const side = eff[0] === 'L' ? 'Left' : 'Right';
    const foot = eff === 'LF' || eff === 'RF';
    const end = model.getObjectByName(`mixamorig${side}${foot ? 'Foot' : 'Hand'}`);
    const up = model.getObjectByName(`mixamorig${side}${foot ? 'Leg' : 'ForeArm'}`);
    if (!end || !up) return false;
    end.getWorldPosition(b);
    up.getWorldPosition(a);
    a.lerp(b, foot ? 0.35 : 0.2);
    if (foot) {
      const toe = model.getObjectByName(`mixamorig${side}ToeBase`);
      if (toe) toe.getWorldPosition(b);
    }
    return true;
  }

  private updateBladeTrail(dt: number) {
    const w = this.weapons[this.activeWeaponIdx];
    const clip = this.player.rig.clip;
    const eff = this.act?.move?.eff;
    const limb = !!clip && !!eff && eff !== 'sword';
    const spec = w && (limb ? LIMB_TRAIL : TRAIL_SPEC[w.id]);
    if (spec && (this.player.anim || this.player.tornado > 0)) {
      let ok = true;
      if (limb) {
        this.player.rig.root.updateMatrixWorld(true);
        ok = this.limbTrail(this.player.rig.model, eff!, this.trailA, this.trailB);
      } else {
        const m = this.player.weaponMeshes[this.activeWeaponIdx];
        this.player.rig.root.updateMatrixWorld(true);
        const seg = clip ? BLADE_SEG[w.id] : undefined;
        m.localToWorld(this.trailA.set(0, 0, seg ? seg.base : spec.base));
        m.localToWorld(this.trailB.set(0, 0, seg ? seg.tip : spec.tip));
      }
      // mocap: the streak follows the blade only while it is really cutting the air, so
      // it shows the actual path of the swing and not the whole animation
      let show = ok;
      if (clip) {
        const speed = dt > 1e-4 ? this.trailB.distanceTo(this.trailPrevTip) / dt : 0;
        show = ok && this.trailPrevOk && speed > (limb ? 5 : 6.5);
      }
      this.trailPrevTip.copy(this.trailB);
      this.trailPrevOk = ok;
      if (show) {
        this.trail.setTint(this.player.special[this.activeWeaponIdx] > 0 ? TRAIL_SPECIAL : spec.tint);
        this.trail.push(this.trailA, this.trailB, this.time);
      }
    } else {
      this.trailPrevOk = false;
    }
    this.trail.update(this.time);
  }

  // Enemy swings leave a streak too: red-orange, on the live blade window only
  private enemyTrail(e: EnemyInstance, cur: BladeSeg, foot: boolean, prevTip: THREE.Vector3 | null, dt: number) {
    let tr = e.trail;
    if (!tr) tr = e.trail = new BladeTrail(this.scene);
    this.trailA.copy(cur.a);
    this.trailB.copy(cur.b);
    if (foot) this.trailA.y += 0.35 * this.sizeOf(e);
    const speed = prevTip && dt > 1e-4 ? this.trailB.distanceTo(prevTip) / dt : 0;
    if (speed > 6) {
      tr.setTint(e.type === 'boss' ? ENEMY_TRAIL_BOSS : e.variant === 'shinobi' ? SHINOBI_TRAIL : e.variant === 'raio' ? RAIO_TRAIL : ENEMY_TRAIL);
      tr.push(this.trailA, this.trailB, this.time);
    }
  }

  // Dark scenes lean on the characters' rim light to read their silhouettes
  private applyRimBoost(k: number) {
    const boost = (r: RigInstance) => {
      // (night asks for more rim light to read silhouettes, but never as much as it used to)
      if (r.rim && r.rimBase) r.rim.copy(r.rimBase).multiplyScalar(Math.min(k, 1.6) * TUNE.rim);
    };
    boost(this.player.rig);
    for (const e of this.enemies) boost(e.rig);
  }

  // Dev overlay (TUNE.hitDebug): hurtboxes, blade segments and contact points
  private drawDebug() {
    if (TUNE.hitDebug < 0.5) {
      if (this.dbg.mesh.visible) this.dbg.end(false);
      return;
    }
    const d = this.dbg;
    d.begin();
    const inflate = 0.1 + 0.3 * TUNE.hitAssist + this.bladeRadius;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const s = this.sizeOf(e);
      d.capsule(e.pos.x, e.pos.z, e.pos.y + HURT_BOTTOM * s, e.pos.y + HURT_TOP * s, e.r + inflate, 0x33ddff);
    }
    const P = this.player;
    d.capsule(P.pos.x, P.pos.z, P.pos.y + HURT_BOTTOM, P.pos.y + HURT_TOP, 0.45, 0x55ff77);
    if (this.act?.windows.length && this.bladePrevOk) {
      d.line(this.bladeCur.a, this.bladeCur.b, 0xffee55);
      d.line(this.bladePrev.a, this.bladePrev.b, 0x886622);
    }
    for (const b of this.enemyBlades) d.line(b.a, b.b, 0xff8833);
    this.dbgHits = this.dbgHits.filter((h) => this.time - h.t < 0.8);
    for (const h of this.dbgHits) d.cross(h.p, 0.25, 0xff3355);
    d.end(true);
  }

  private render() {
    this.renderer.info.reset();
    this.renderer.getDrawingBufferSize(this.bufSize);
    this.dust.setScale(this.bufSize.y, this.camera.fov);
    if (this.fx) this.fx.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // Grade uniforms driven by gameplay: desaturate in slow motion, red edge pulse on hits
  // (plus a faint persistent one at low health). Also watches frame rate for 'auto'.
  private updateFx(real: number) {
    this.hurtFx = Math.max(0, this.hurtFx - real * 2.2);
    this.landFx = Math.max(0, this.landFx - real * 6);
    const low = this.state === 'play' && this.player.hp > 0 && this.player.hp / this.player.maxHp < 0.3 ? 0.35 + Math.sin(this.time * 5) * 0.1 : 0;
    const wantDesat = this.slowmoT > 0 ? 1 : 0;
    this.desatFx += (wantDesat - this.desatFx) * Math.min(1, real * 10);
    if (this.fx) {
      this.fx.update(this.time, this.desatFx, Math.max(this.hurtFx, low));
      this.updateCinemaFx(real);
    }

    // Auto: first trade resolution (cheap, keeps every effect), then step the preset
    // down if even the lowest scale is too slow; climb back slowly when there is room.
    if (this.qualitySetting !== 'auto' || this.state !== 'play') return;
    this.fpsAcc += real;
    this.fpsFrames++;
    if (this.fpsAcc < 2) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    const minScale = this.quality === 'low' ? 0.75 : 0.6;
    if (fps < 40) {
      this.fastWindows = 0;
      if (this.resScale > minScale + 0.01) {
        this.setResScale(Math.max(minScale, this.resScale - 0.15));
        this.slowWindows = 0;
      } else if (++this.slowWindows >= 2 && this.quality !== 'low') {
        this.slowWindows = 0;
        this.resScale = 1;
        this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
      }
    } else if (fps > 56) {
      this.slowWindows = 0;
      if (++this.fastWindows >= 3 && this.resScale < 1) {
        this.fastWindows = 0;
        this.setResScale(Math.min(1, this.resScale + 0.1));
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
  }

  // Finisher post-processing: flash and colour split at the strike, a radial rush into it,
  // and depth of field on the fighters (high quality only)
  private updateCinemaFx(real: number) {
    this.flashFx = Math.max(0, this.flashFx - real * 6);
    this.spikeFx = Math.max(0, this.spikeFx - real * 3.2);
    const c = this.cine;
    let radial = 0;
    if (c && this.settings.cinematicCamera) {
      const ss = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
      radial = (c.struck ? 1 - ss(0, 0.35, c.after) : ss(c.hitAt * 0.4, c.hitAt, c.t) * 0.7) * (c.full ? 1 : 0.5);
    }
    const dof = this.profile.dof ? this.cineW : 0;
    if (dof > 0.01 || radial > 0.01) {
      this.camera.updateMatrixWorld();
      this.tmpV.copy(this.cineFocus).project(this.camera);
      this.fxUv.set(this.tmpV.x * 0.5 + 0.5, this.tmpV.y * 0.5 + 0.5);
      this.camera.getWorldDirection(this.fxFwd);
      const dist = this.tmpV.copy(this.cineFocus).sub(this.camera.position).dot(this.fxFwd);
      this.cineRange = Math.max(1.8, (c?.dist ?? 4) * 0.6);
      this.fx!.setCinema(this.flashFx, this.spikeFx, radial, this.fxUv, dof, dist, this.cineRange);
    } else {
      this.fx!.setCinema(this.flashFx, this.spikeFx, 0, this.fxUv, 0, 5, 3);
    }
  }

  private setResScale(k: number) {
    this.resScale = k;
    this.renderer.setPixelRatio(this.profile.pixelRatio * k);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.fx?.setSize(window.innerWidth, window.innerHeight);
  }

  public setQuality(setting: QualitySetting) {
    this.qualitySetting = setting;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.resScale = 1;
    this.applyQuality(setting === 'auto' ? detectQuality() : setting);
  }

  private applyQuality(q: Quality) {
    this.quality = q;
    const prof = qualityProfile(q);
    this.profile = prof;
    this.renderer.setPixelRatio(prof.pixelRatio * this.resScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.world.setQuality(prof);
    const shadowType = THREE.PCFShadowMap;
    if (this.sun.shadow.map?.width !== prof.shadowMap || this.renderer.shadowMap.type !== shadowType) {
      this.renderer.shadowMap.type = shadowType;
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.fx?.dispose();
    this.fx = null;
    if (prof.composer) {
      this.fx = new PostFX(this.renderer, this.scene, this.camera, prof.msaa, prof.bloom);
      this.fx.setLook(NINJA_LOOK);
      this.fx.setSize(window.innerWidth, window.innerHeight);
    }
    this.callbacks.onQualityChange?.(this.qualitySetting, q);
  }

  public destroy() {
    if (this.reqId) cancelAnimationFrame(this.reqId);
    this.rings.forEach((r) => {
      this.scene.remove(r.m);
      (r.m.material as THREE.Material).dispose();
    });
    this.rings = [];
    this.pGeo.dispose();
    this.bGeo.dispose();
    this.fx?.dispose();
    this.renderer.dispose();
  }
}
