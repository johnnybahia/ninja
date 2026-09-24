import * as THREE from 'three';
import {
  CharacterId,
  CharacterDef,
  WeaponDef,
  RigInstance,
  EnemyInstance,
  ProjectileInstance,
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
import { BladeTrail, ImpactPool, softDotTexture } from './vfx';
import { PostFX, NINJA_LOOK, Quality, QualitySetting, qualityProfile, detectQuality } from './postfx';
import { MAT, makeWeapon, mesh } from './rigs';
import { buildCharacter } from './characters';
import { animateCharacter, animateDeath } from './animation';

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
  katana: { base: 0.25, tip: 1.45, tint: new THREE.Color(1.25, 1.4, 1.75) },
  bo: { base: -0.95, tip: 1.55, tint: new THREE.Color(1.7, 1.25, 0.6) },
  kama: { base: 0.3, tip: 0.62, tint: new THREE.Color(1.3, 1.55, 1.35) }
};
const TRAIL_SPECIAL = new THREE.Color(2.2, 1.6, 0.5);
const IMPACT_NORMAL = new THREE.Color(2.2, 1.9, 1.5);
const IMPACT_HEAVY = new THREE.Color(2.6, 1.7, 0.9);
const IMPACT_CRIT = new THREE.Color(3.0, 2.2, 0.7);
const IMPACT_HURT = new THREE.Color(2.6, 0.5, 0.35);
const IMPACT_DODGE = new THREE.Color(1.2, 2.2, 2.6);

export interface GameEngineCallbacks {
  onHpChange: (hp: number, maxHp: number) => void;
  onStaminaChange: (st: number, maxSt: number) => void;
  onXpChange: (xp: number, xpNext: number, level: number) => void;
  onScoreChange: (score: number) => void;
  onComboChange: (combo: number) => void;
  onWaveChange: (wave: number, text: string, sub: string) => void;
  onWeaponChange: (weaponIdx: number, weapon: WeaponDef) => void;
  onSpecialsUpdate: (specials: Record<number, number>) => void;
  onGameOver: (score: number, wave: number, level: number, kills: number, bestCombo: number) => void;
  onQualityChange?: (setting: QualitySetting, effective: Quality) => void;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private callbacks: GameEngineCallbacks;

  public settings: GameSettings = {
    cameraSensitivity: 1.0,
    autoCamera: true,
    autoTurnWithStick: true
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
    attackHeldT: 0
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
    attackHeld: false
  };

  public lookTouch = { id: null as number | null, lx: 0, ly: 0 };
  public joyTouch = { id: null as number | null, ox: 0, oy: 0 };

  public state: 'menu' | 'play' | 'over' = 'menu';
  public paused = false;
  public loadout: number[] | null = null;
  public wave = 0;
  private waveTimer = 0;
  private clearedShown = false;
  private time = 0;
  private clock = new THREE.Clock();
  private reqId: number | null = null;
  private isRunning = false;

  private tmpV = new THREE.Vector3();
  private tmpH = new THREE.Vector3();
  private trailA = new THREE.Vector3();
  private trailB = new THREE.Vector3();

  // Rendering quality & post-processing
  private fx: PostFX | null = null;
  public qualitySetting: QualitySetting = 'auto';
  public quality: Quality = 'high';
  private fpsAcc = 0;
  private fpsFrames = 0;
  private slowWindows = 0;
  private hurtFx = 0;
  private trail!: BladeTrail;
  private impacts!: ImpactPool;
  private camTarget = new THREE.Vector3(0, 1.6, 5);
  private fovKick = 0;
  private baseFov = 60;
  private prevYaw = Math.PI;
  private desatFx = 0;

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement, callbacks: GameEngineCallbacks) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.mmCtx = minimapCanvas.getContext('2d')!;
    this.callbacks = callbacks;

    this.initThree();
    this.initWorld();
    this.initPlayer();
    this.initSlashEffects();
    this.setQuality(this.qualitySetting);

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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.setWeapon(0);
  }

  private initSlashEffects() {
    this.trail = new BladeTrail(this.scene);
    this.impacts = new ImpactPool(this.scene);

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

  public setCharacter(id: CharacterId) {
    this.charId = id;
    if (this.state === 'play') return;

    this.scene.remove(this.player.rig.root);
    this.player.rig.dispose?.();
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
    this.setWeapon(0);
  }

  public setWeapon(idx: number) {
    if (idx < 0 || idx >= this.weapons.length) return;
    this.activeWeaponIdx = idx;
    this.player.weaponMeshes.forEach((m, k) => {
      m.visible = k === idx;
    });
    this.callbacks.onWeaponChange(idx, this.weapons[idx]);
  }

  public recenterCamera() {
    // Alinha a câmera diretamente atrás do personagem com suavidade
    this.camYaw = wrap(this.player.yaw - Math.PI);
    this.camPitch = 0.35;
  }

  public start() {
    this.reset();
    this.paused = false;
    this.state = 'play';
    this.nextWave();
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

    this.player.hp = 60;
    this.player.maxHp = 60;
    this.player.st = 100;
    this.player.maxSt = 100;
    this.player.score = 0;
    this.player.level = 1;
    this.player.xp = 0;
    this.player.xpNext = 800;
    this.player.dmgMult = 1;
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
    this.attackQueueT = 0;
    this.input.attackHeld = false;
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
    this.clearedShown = false;
    this.player.tookDamage = false;

    const boss = this.wave % 4 === 0;
    const nS = Math.min(9, 2 + this.wave);
    const nA = Math.min(4, Math.floor(this.wave / 2));

    const list: ('samurai' | 'archer' | 'boss')[] = [];
    for (let i = 0; i < nS; i++) list.push('samurai');
    for (let i = 0; i < nA; i++) list.push('archer');
    if (boss) list.push('boss');

    list.forEach((type) => {
      for (let k = 0; k < 30; k++) {
        const a = Math.random() * TAU;
        const r = rand(20, 34);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 13) continue;
        if (this.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + (type === 'boss' ? 1.5 : 0.8))) continue;
        this.spawnEnemy(type, x, z);
        break;
      }
    });

    const sub = boss ? 'O oni despertou' : `${nS} samurais${nA ? ` e ${nA} arqueiros` : ''}`;
    this.callbacks.onWaveChange(this.wave, `Onda ${this.wave}`, sub);
    sfx.wave();
  }

  private spawnEnemy(type: 'samurai' | 'archer' | 'boss', x: number, z: number) {
    const hpMul = 1 + (this.wave - 1) * 0.15;
    let rig: RigInstance;
    let hp = 60;
    let speed = 3.7;
    let r = 0.5;
    let h = 2.5;

    if (type === 'samurai') {
      rig = buildCharacter('samurai');
      rig.hand.add(makeWeapon('katana'));
      hp = 60 * hpMul;
      speed = 3.7;
    } else if (type === 'archer') {
      rig = buildCharacter('archer');
      rig.handL.add(makeWeapon('bow'));
      hp = 40 * hpMul;
      speed = 3.3;
    } else {
      rig = buildCharacter('oni', 2.1);
      rig.hand.add(makeWeapon('kanabo'));
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
    bar.add(bg, fg);
    bar.visible = false;
    if (type === 'boss') bar.scale.setScalar(2);
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
      barFg: fg
    };

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

    this.scene.add(rig.root);
    this.emitParticles(x, 1, z, 26, 0x8a7aa8, 5, 2, 3, 0.9);
    this.enemies.push(enemy);
    return enemy;
  }

  private removeEnemy(e: EnemyInstance) {
    this.scene.remove(e.rig.root);
    this.scene.remove(e.bar);
    if (e.tele) this.scene.remove(e.tele);
    e.rig.dispose?.();
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
      ctx.font = 'bold 42px "Zen Kaku Gothic New", sans-serif';
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
    if (roll >= 1.1) {
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
    this.player.vy = this.player.jumps === 0 ? 10.5 : 9.5;
    this.player.jumps++;
    this.player.grounded = false;
    this.emitParticles(this.player.pos.x, this.player.pos.y + 0.2, this.player.pos.z, 10, 0xbfb3d8, 3, 1, 4, 0.4);
    sfx.jump();
  }

  public dash() {
    if (this.state !== 'play' || this.player.dash > 0 || this.player.st < 28) return;
    this.player.st -= 28;
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
    this.player.dash = 0.2;
    this.player.inv = Math.max(this.player.inv, 0.3);
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
    if (this.player.atkCd > 0 || this.state !== 'play') return;
    const w = this.weapons[this.activeWeaponIdx];
    if (this.player.rush || this.player.tornado > 0) return;

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

    const fx = Math.sin(this.player.yaw);
    const fz = Math.cos(this.player.yaw);
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

  public hitEnemy(e: EnemyInstance, dmg: number, nx: number, nz: number, kb: number, heavy: boolean) {
    if (e.dead) return;
    const rolled = this.rollDamage(dmg * this.player.dmgMult, true);
    dmg = rolled.dmg;
    e.hp -= dmg;
    e.flash = 0.14;
    {
      const nl = Math.hypot(nx, nz) || 1;
      const sc = e.rig.root.scale.x;
      this.tmpV.set(e.pos.x - (nx / nl) * e.r * 0.7, e.pos.y + 1.25 * sc, e.pos.z - (nz / nl) * e.r * 0.7);
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
    e.kb.x += nx * kb * res;
    e.kb.z += nz * kb * res;

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
    this.emitBlood(e.pos.x, e.pos.y + 1.1, e.pos.z, nx, nz, bloodCount, isCombo, isComboFinisher);

    // Hitstop cinemático e tremor de impacto proporcional ao combo
    const now = performance.now();
    if (now - this.lastHS > 90) {
      this.hitstop = isComboFinisher ? 0.08 : isCombo ? 0.05 : 0.03;
      this.lastHS = now;
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
  }

  private killEnemy(e: EnemyInstance) {
    e.dead = true;
    e.deathT = 0;
    e.bar.visible = false;
    if (e.tele) e.tele.visible = false;

    this.player.kills++;
    const pts = e.type === 'boss' ? 1200 : e.type === 'archer' ? 120 : 80;
    this.player.score += pts;
    this.callbacks.onScoreChange(this.player.score);

    this.player.killCombo = this.player.killComboT > 0 ? this.player.killCombo + 1 : 1;
    this.player.killComboT = 2.2;
    this.player.bestCombo = Math.max(this.player.bestCombo, Math.max(this.player.killCombo, this.player.hitCombo));
    this.callbacks.onComboChange(Math.max(this.player.killCombo, this.player.hitCombo));

    this.addXp(pts);

    // Erupção de sangue estelar ao eliminar o inimigo
    this.emitBlood(e.pos.x, e.pos.y + 1.2, e.pos.z, 0, 0, e.type === 'boss' ? 65 : 42, true, true);
    this.emitParticles(e.pos.x, 1, e.pos.z, 28, 0x9a88c0, 5, 3, 4, 1);

    // Bosses always drop a scroll; other kills roll against the loadout-proportional rate
    if (e.type === 'boss' || this.rollScroll()) this.dropScroll(e.pos.x, e.pos.z);
    else if (Math.random() < 0.2) this.dropPickup(e.pos.x, e.pos.z);
  }

  private addXp(pts: number) {
    this.player.xp += pts;
    if (this.player.xp >= this.player.xpNext) {
      this.player.xp -= this.player.xpNext;
      this.player.level++;
      this.player.maxHp = Math.min(140, this.player.maxHp + 8);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
      this.player.dmgMult += 0.03;
      this.player.xpNext = Math.round(this.player.xpNext * 1.35);
      sfx.levelup();
      this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
    }
    this.callbacks.onXpChange(this.player.xp, this.player.xpNext, this.player.level);
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

  public damagePlayer(dmg: number, nx: number, nz: number) {
    if (this.player.inv > 0 || this.state !== 'play') return;
    const rolled = this.rollDamage(dmg, false); // incoming damage: variance + label only, no crit bonus
    dmg = rolled.dmg;
    this.player.hp = Math.max(0, this.player.hp - dmg);
    this.player.inv = 0.6;
    this.hurtFx = 1;
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
      this.state = 'over';
      this.callbacks.onGameOver(
        Math.round(this.player.score),
        this.wave,
        this.player.level,
        this.player.kills,
        this.player.bestCombo
      );
    }
  }

  // Resolves a telegraphed melee attack (samurai/boss) at the moment its windup ends.
  // A dash active right then is rewarded as a "perfect" dodge (tight timing); a dash
  // whose movement already ended but whose i-frames are still running counts as a
  // normal dodge. Either way the hit never lands. Otherwise damage applies as usual.
  private resolveEnemyMeleeHit(dmg: number, nx: number, nz: number) {
    if (this.player.inv > 0) {
      if (this.player.dashInv) {
        const perfect = this.player.dash > 0;
        this.spawnLabel(
          this.player.pos.x,
          this.player.pos.y + 2.5,
          this.player.pos.z,
          perfect ? 'PERFEITO!' : 'ESQUIVOU!',
          perfect ? '#ffd166' : '#8fe0c8',
          perfect ? 1.55 : 1.1
        );
        this.triggerSlowmo(perfect ? 0.5 : 0.22, perfect ? 0.22 : 0.42);
        this.impacts.spawn(this.tmpV.set(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z), IMPACT_DODGE, perfect ? 2.4 : 1.6, 0.3);
        this.fovKick = perfect ? -5 : -2.5;
        if (perfect) {
          this.player.st = Math.min(this.player.maxSt, this.player.st + 18);
          this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);
        }
        sfx.dash();
      }
      return;
    }
    this.damagePlayer(dmg, nx, nz);
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
      grav: o.grav
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
      const turnK = this.player.anim ? 14 : 26;
      this.player.yaw = turnTo(this.player.yaw, moveAngle, dt * turnK);

      // 2. O DIRECIONAL GIRA A CÂMERA DINAMICAMENTE
      if (this.settings.autoTurnWithStick) {
        // Ao desviar para a esquerda/direita com o analógico, a câmera gira suavemente junto
        const steerSens = 2.6 * this.settings.cameraSensitivity;
        this.camYaw += -ix * steerSens * dt;
      }

      // 3. AJUSTE AUTOMÁTICO DE ROTAÇÃO DA CÂMERA (Auto-Follow & Virada para Trás)
      if (this.settings.autoCamera && this.lookTouch.id === null) {
        const camBehindPlayer = wrap(this.player.yaw - Math.PI);
        // Se estiver indo para trás (puxando para baixo), a câmera gira suavemente atrás do personagem
        const isPullingBack = iy > 0.15;
        const autoSpeed = isPullingBack
          ? 3.8 * this.settings.cameraSensitivity * Math.min(1.2, iy * 1.5)
          : 1.8 * this.settings.cameraSensitivity * amt;

        this.camYaw = turnTo(this.camYaw, camBehindPlayer, dt * autoSpeed);
      }
    }

    if (this.player.dash > 0) {
      this.player.dash -= dt;
      this.player.pos.addScaledVector(this.player.dashDir, 23 * dt);
      this.player.vel.set(0, 0, 0);
      this.emitParticles(this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z, 3, 0x8a86c8, 0.7, 0.2, 0, 0.4);
    } else {
      const penalty = this.player.anim ? 0.6 : this.player.tornado > 0 ? 0.55 : 1;
      const maxSp = 7.6 * penalty;
      const dvx = amt > 0.05 ? (mx / amt) * maxSp * amt : 0;
      const dvz = amt > 0.05 ? (mz / amt) * maxSp * amt : 0;
      const accelK = 1 - Math.exp(-(amt > 0.05 ? 12 : 9) * dt);
      this.player.vel.x += (dvx - this.player.vel.x) * accelK;
      this.player.vel.z += (dvz - this.player.vel.z) * accelK;
      this.player.pos.x += this.player.vel.x * dt;
      this.player.pos.z += this.player.vel.z * dt;
    }

    const velAmt = Math.min(1, Math.hypot(this.player.vel.x, this.player.vel.z) / 7.6);
    this.player.moveAmt +=
      ((this.player.dash > 0 ? 1 : Math.max(amt > 0.05 ? amt : 0, velAmt * 0.7)) - this.player.moveAmt) *
      Math.min(1, dt * 12);

    this.player.pos.addScaledVector(this.player.kb, dt);
    this.player.kb.multiplyScalar(Math.exp(-7 * dt));
    this.player.vy -= 28 * dt;
    this.player.pos.y += this.player.vy * dt;

    if (this.player.pos.y <= 0) {
      if (!this.player.grounded && this.player.vy < -6) {
        this.emitParticles(this.player.pos.x, 0.1, this.player.pos.z, 8, 0xbfb3d8, 2.5, 0.5, 4, 0.35);
      }
      this.player.pos.y = 0;
      this.player.vy = 0;
      this.player.grounded = true;
      this.player.jumps = 0;
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

    this.player.st = Math.min(this.player.maxSt, this.player.st + 22 * dt);
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
    const yawRate = dt > 0 ? wrap(this.player.yaw - this.prevYaw) / dt : 0;
    this.prevYaw = this.player.yaw;
    if (this.player.rig.flash) this.player.rig.flash.value = this.hurtFx * this.hurtFx * 0.35;
    animateCharacter(this.player.rig, {
      moveAmt: this.player.moveAmt,
      phase: this.player.phase,
      air: !this.player.grounded,
      t: this.time,
      dt,
      anim: this.player.anim,
      weapon: this.weapons[this.activeWeaponIdx]?.id,
      dash: this.player.dash > 0,
      turn: yawRate,
      hit: this.hurtFx * 0.8
    });
    this.updateBladeTrail();

    this.player.rig.root.position.copy(this.player.pos);
    this.player.rig.root.rotation.y = this.player.yaw;
    this.player.rig.root.visible = !(this.player.inv > 0 && this.player.dash <= 0 && Math.floor(this.time * 20) % 2 === 0);
  }

  private updateCamera(dt: number) {
    // soft follow: the frame trails the player slightly, which reads as weight
    const kx = 1 - Math.exp(-14 * dt);
    const ky = 1 - Math.exp(-9 * dt);
    this.camTarget.x += (this.player.pos.x - this.camTarget.x) * kx;
    this.camTarget.z += (this.player.pos.z - this.camTarget.z) * kx;
    this.camTarget.y += (this.player.pos.y + 1.6 - this.camTarget.y) * ky;
    const camTarget = this.camTarget;
    this.fovKick *= Math.exp(-5 * dt);
    const fov = this.baseFov + this.fovKick;
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

    const want = this.camDistOverride ?? (this.camera.aspect < 1 ? 10.5 : 7.2);
    this.camDist += (want - this.camDist) * Math.min(1, dt * 8);

    this.camera.position.copy(camTarget).addScaledVector(camDir, this.camDist);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-9 * dt);
    }
    this.camera.lookAt(camTarget);
  }

  private updateEnemies(dt: number) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        e.deathT += dt;
        if (e.rig.flash) e.rig.flash.value = Math.max(0, 0.6 - e.deathT * 2);
        animateDeath(e.rig, e.deathT, dt);
        e.rig.root.position.y = -Math.max(0, e.deathT - 0.8) * 1.4;
        if (e.deathT > 1.8) {
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

      e.cd -= dt;
      e.cd2 -= dt;
      e.flash -= dt;

      let mvx = 0;
      let mvz = 0;
      let spd = 0;

      if (e.type === 'samurai') {
        e.yaw = turnTo(e.yaw, toP, dt * 7);
        if (e.windup && e.windup > 0) {
          e.windup -= dt;
          if (e.tele) {
            e.tele.position.set(e.pos.x, 0.05, e.pos.z);
            const k = 1 - Math.max(0, e.windup) / 0.42;
            (e.tele.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.4 * k;
          }
          if (e.windup <= 0) {
            e.windup = 0;
            if (e.tele) e.tele.visible = false;
            e.cd = 1.4;
            const dNow = Math.hypot(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z);
            e.anim = { kind: 'eslash', t: 0, dur: 0.42, side: 0 };
            if (dNow <= 2.1) this.resolveEnemyMeleeHit(12, nx, nz);
          }
        } else if (d > 1.8) {
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.cd <= 0) {
          e.cd = 999;
          e.windup = 0.42;
          if (e.tele) {
            e.tele.visible = true;
            e.tele.position.set(e.pos.x, 0.05, e.pos.z);
            e.tele.scale.setScalar(1.1);
            (e.tele.material as THREE.MeshBasicMaterial).opacity = 0.18;
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
        } else if (e.cd <= 0 && !e.anim) {
          // draw the bow first (readable telegraph), release partway through
          e.cd = 2.4;
          e.anim = { kind: 'eshoot', t: 0, dur: 0.75, side: 0 };
          e.shotPending = true;
        }
        if (e.shotPending && e.anim && e.anim.t >= 0.45) {
          e.shotPending = false;
          this.spawnProj({
            type: 'arrow',
            friendly: false,
            pos: new THREE.Vector3(e.pos.x + nx * 0.6, 1.5, e.pos.z + nz * 0.6),
            vel: new THREE.Vector3(nx * 22, 0, nz * 22),
            dmg: 8,
            life: 2
          });
          sfx.arrow();
        }
      } else {
        // Boss
        e.yaw = turnTo(e.yaw, toP, dt * 4);
        if (e.windup && e.windup > 0) {
          e.windup -= dt;
          if (e.tele) {
            e.tele.position.set(e.pos.x, 0.05, e.pos.z);
            const k = 1 - Math.max(0, e.windup) / 0.55;
            e.tele.scale.setScalar(1.6 + k * 0.7);
            (e.tele.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.35 * k;
          }
          if (e.windup <= 0) {
            e.windup = 0;
            if (e.tele) e.tele.visible = false;
            e.cd = 2.0;
            const dNow = Math.hypot(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z);
            e.anim = { kind: 'esmash', t: 0, dur: 0.55, side: 0 };
            if (dNow <= 3.6) {
              this.resolveEnemyMeleeHit(24, nx, nz);
              sfx.boom();
            }
          }
        } else if (d > 3.2) {
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.cd <= 0) {
          e.cd = 999;
          e.windup = 0.55;
          if (e.tele) {
            e.tele.visible = true;
            e.tele.position.set(e.pos.x, 0.05, e.pos.z);
            e.tele.scale.setScalar(1.6);
            (e.tele.material as THREE.MeshBasicMaterial).opacity = 0.2;
          }
        }
      }

      e.pos.x += mvx * spd * dt;
      e.pos.z += mvz * spd * dt;
      e.pos.addScaledVector(e.kb, dt);
      e.kb.multiplyScalar(Math.exp(-6 * dt));
      this.collide(e.pos, e.r);

      const moving = spd > 0 ? Math.min(1, spd / e.speed) : 0;
      e.moveAmt += (moving - e.moveAmt) * Math.min(1, dt * 8);
      e.phase += dt * 10 * e.moveAmt;
      if (e.anim) {
        e.anim.t += dt;
        if (e.anim.t >= e.anim.dur) e.anim = undefined;
      }
      const wind =
        e.windup && e.windup > 0 ? 1 - e.windup / (e.type === 'boss' ? 0.55 : 0.42) : 0;
      const hitK = Math.max(0, e.flash) / 0.14;
      if (e.rig.flash) e.rig.flash.value = hitK * hitK;
      animateCharacter(e.rig, {
        moveAmt: e.moveAmt,
        phase: e.phase,
        air: false,
        t: this.time + i * 1.7,
        dt,
        anim: e.anim,
        windup: wind,
        hit: hitK
      });

      e.rig.root.position.copy(e.pos);
      e.rig.root.rotation.y = e.yaw;

      e.bar.visible = e.hp < e.maxHp || e.type === 'boss';
      e.bar.position.set(e.pos.x, e.pos.y + (e.type === 'boss' ? 5.3 : 2.6), e.pos.z);
      e.bar.quaternion.copy(this.camera.quaternion);
      e.barFg.scale.x = Math.max(0.001, e.hp / e.maxHp);
    }
  }

  private updateProjectiles(dt: number) {
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
            this.hitEnemy(e, p.dmg, p.vel.x, p.vel.z, p.kb || 3, false);
            if (p.pierce) p.hit?.add(e);
            else {
              dead = true;
              break;
            }
          }
        }
      } else if (!dead && !p.friendly) {
        if (Math.hypot(p.pos.x - this.player.pos.x, p.pos.z - this.player.pos.z) < 0.6) {
          this.damagePlayer(p.dmg, p.vel.x, p.vel.z);
          dead = true;
        }
      }

      if (dead) {
        if (p.bomb && !exploded) {
          this.explodeAt(p.pos.x, p.pos.y, p.pos.z, p.aoeR || 3.2, p.dmg, p.kb || 8);
        }
        this.killProj(i);
      }
    }
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
        this.player.special[s.w] = SPECIAL_DURATION;
        this.callbacks.onSpecialsUpdate({ ...this.player.special });
        const w = this.weapons[s.w];
        this.callbacks.onWaveChange(this.wave, SPECIALS[w.id]?.name ?? 'Especial', `${w.name}: especial por ${SPECIAL_DURATION}s`);
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

    for (const e of this.enemies) {
      if (e.dead) continue;
      const q = toS(e.pos.x, e.pos.z);
      this.mmCtx.fillStyle = e.type === 'boss' ? '#f2a65a' : e.type === 'archer' ? '#d88ad0' : '#e0404a';
      this.mmCtx.beginPath();
      this.mmCtx.arc(q[0], q[1], e.type === 'boss' ? 7 : 4, 0, TAU);
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

  public loop = () => {
    this.reqId = requestAnimationFrame(this.loop);
    const real = Math.min(this.clock.getDelta(), 0.05);
    if (this.paused && this.state === 'play') {
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
      this.updatePlayerMovementAndCamera(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateScrolls(dt);
      this.updateReticle(dt);

      const alive = this.enemies.some((e) => !e.dead);
      if (!alive && this.wave > 0) {
        if (!this.clearedShown) {
          this.clearedShown = true;
          this.callbacks.onWaveChange(this.wave, 'Onda Limpa', `+${100 * this.wave} pontos`);
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
          this.callbacks.onHpChange(this.player.hp, this.player.maxHp);
        }
        this.waveTimer += dt;
        if (this.waveTimer > 2.5) {
          this.waveTimer = 0;
          this.nextWave();
        }
      }
    } else {
      this.reticle.visible = false;
      this.camYaw += real * 0.12;
      this.player.phase += real * 2;
      animateCharacter(this.player.rig, {
        moveAmt: 0,
        phase: this.player.phase,
        air: false,
        t: this.time,
        dt: real,
        weapon: this.weapons[this.activeWeaponIdx]?.id
      });
      this.player.rig.root.position.copy(this.player.pos);
      this.player.rig.root.rotation.y = this.player.yaw;
    }

    this.updateParticles(dt);
    this.impacts.update(dt);
    this.updateChain(dt);
    this.updateLabels(dt);
    this.updateCamera(real);

    this.world.update(dt, this.time, this.player.pos, this.camera.position);

    this.updateFx(real);
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

  private updateBladeTrail() {
    const w = this.weapons[this.activeWeaponIdx];
    const spec = w && TRAIL_SPEC[w.id];
    if (spec && (this.player.anim || this.player.tornado > 0)) {
      const m = this.player.weaponMeshes[this.activeWeaponIdx];
      this.player.rig.root.updateMatrixWorld(true);
      m.localToWorld(this.trailA.set(0, 0, spec.base));
      m.localToWorld(this.trailB.set(0, 0, spec.tip));
      this.trail.setTint(this.player.special[this.activeWeaponIdx] > 0 ? TRAIL_SPECIAL : spec.tint);
      this.trail.push(this.trailA, this.trailB, this.time);
    }
    this.trail.update(this.time);
  }

  private render() {
    this.renderer.info.reset();
    if (this.fx) this.fx.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // Grade uniforms driven by gameplay: desaturate in slow motion, red edge pulse on hits
  // (plus a faint persistent one at low health). Also watches frame rate for 'auto'.
  private updateFx(real: number) {
    this.hurtFx = Math.max(0, this.hurtFx - real * 2.2);
    const low = this.state === 'play' && this.player.hp > 0 && this.player.hp / this.player.maxHp < 0.3 ? 0.35 + Math.sin(this.time * 5) * 0.1 : 0;
    const wantDesat = this.slowmoT > 0 ? 1 : 0;
    this.desatFx += (wantDesat - this.desatFx) * Math.min(1, real * 10);
    if (this.fx) this.fx.update(this.time, this.desatFx, Math.max(this.hurtFx, low));

    if (this.qualitySetting !== 'auto' || this.state !== 'play' || this.quality === 'low') return;
    this.fpsAcc += real;
    this.fpsFrames++;
    if (this.fpsAcc >= 4) {
      const fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.slowWindows = fps < 38 ? this.slowWindows + 1 : 0;
      if (this.slowWindows >= 2) {
        this.slowWindows = 0;
        this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
      }
    }
  }

  public setQuality(setting: QualitySetting) {
    this.qualitySetting = setting;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.slowWindows = 0;
    this.applyQuality(setting === 'auto' ? detectQuality() : setting);
  }

  private applyQuality(q: Quality) {
    this.quality = q;
    const prof = qualityProfile(q);
    this.renderer.setPixelRatio(prof.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.world.setQuality(prof);
    const shadowType = prof.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
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
