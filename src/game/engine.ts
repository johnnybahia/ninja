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
  WEAPONS_BRAVO,
  SPECIALS,
  KARATE,
  WORLD_PAL
} from './constants';
import { sfx } from './audio';
import { MAT, GEO, buildRig, buildZombieRig, buildPlayerRig, animateRig, makeWeapon, mesh } from './rigs';

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
  private sunDisc!: THREE.Mesh;
  private hemi!: THREE.HemisphereLight;
  private ground!: THREE.Mesh;

  private solids: { x: number; z: number; r: number; h: number }[] = [];
  private occluders: THREE.Object3D[] = [];
  private barrelsGroup = new THREE.Group();
  private barrelPositions: { x: number; z: number; fire: THREE.Mesh }[] = [];
  private doomActive = false;

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
    rush: null as { t: number; hits: number; kicked: boolean; knife?: boolean } | null,
    recoil: 0,
    attackHeldT: 0,
    suppress: 0,
    suppressTick: 0,
    gunHoldT: 0,
    gloryCd: 0
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
  private scrolls: { g: THREE.Group; ring: THREE.Mesh; glyph: THREE.Mesh; x: number; z: number; t: number; w: number }[] = [];

  private projPools: Record<string, THREE.Group[]> = {};

  // Camera & Input
  public camYaw = Math.PI;
  public camPitch = 0.35;
  public camDist = 7.2;
  private shake = 0;
  private hitstop = 0;
  private spHit = false;
  private ptMult = 1;
  private lastHS = 0;
  private lastMove = new THREE.Vector3(0, 0, -1);

  public input = {
    jx: 0,
    jy: 0,
    keys: {} as Record<string, boolean>,
    attackHeld: false
  };

  public lookTouch = { id: null as number | null, lx: 0, ly: 0 };
  public joyTouch = { id: null as number | null, ox: 0, oy: 0 };

  public state: 'menu' | 'play' | 'over' = 'menu';
  public wave = 0;
  private waveTimer = 0;
  private clearedShown = false;
  private time = 0;
  private clock = new THREE.Clock();
  private reqId: number | null = null;
  private isRunning = false;

  private tmpV = new THREE.Vector3();
  private tmpH = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement, callbacks: GameEngineCallbacks) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.mmCtx = minimapCanvas.getContext('2d')!;
    this.callbacks = callbacks;

    this.initThree();
    this.initWorld();
    this.initPlayer();
    this.initSlashEffects();
    this.applyTheme(false);

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

    this.scene = new THREE.Scene();
    const SKY = 0x3b2b4f;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 30, 85);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 220);

    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x2a2040, 0.78);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffb27a, 0.95);
    this.sun.position.set(-30, 40, -25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 130 });
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun, this.sun.target);

    // Rim / Fill light for specular highlights on metal and character silhouettes
    const rimLight = new THREE.DirectionalLight(0x7590b8, 0.45);
    rimLight.position.set(30, 25, 30);
    this.scene.add(rimLight);

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(7, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffc98a, fog: false })
    );
    this.sunDisc.position.set(-80, 22, -120);
    this.scene.add(this.sunDisc);

    // General Particle Buffer
    for (let i = 0; i < this.PN; i++) this.pPos[i * 3 + 1] = -999;
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const points = new THREE.Points(
      this.pGeo,
      new THREE.PointsMaterial({
        size: 0.24,
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

  private addSolid(x: number, z: number, r: number, h: number) {
    this.solids.push({ x, z, r, h });
  }

  private initWorld() {
    this.ground = mesh(new THREE.CircleGeometry(95, 48).rotateX(-Math.PI / 2), MAT.ground, false, true);
    this.scene.add(this.ground);

    const plaza = mesh(new THREE.CircleGeometry(13, 40).rotateX(-Math.PI / 2), MAT.stone, false, true);
    plaza.position.y = 0.02;
    this.scene.add(plaza);

    const path = mesh(new THREE.BoxGeometry(3.2, 0.04, 12), MAT.stoneDark, false, true);
    path.position.set(0, 0.02, -17);
    this.scene.add(path);

    // Temple
    const tg = new THREE.Group();
    tg.position.set(0, 0, -29);
    const base = mesh(new THREE.BoxGeometry(16, 1.2, 11), MAT.stone, true, true);
    base.position.y = 0.6;
    tg.add(base);

    const floor = mesh(new THREE.BoxGeometry(14, 0.3, 9), MAT.wood, true, true);
    floor.position.y = 1.35;
    tg.add(floor);

    const pg = new THREE.CylinderGeometry(0.35, 0.35, 4.5, 10);
    [-6, -2, 2, 6].forEach((x) => {
      const p = mesh(pg, MAT.torii);
      p.position.set(x, 3.75, 4.2);
      tg.add(p);
      this.occluders.push(p);
    });

    const wall = mesh(new THREE.BoxGeometry(13, 4.5, 0.4), MAT.wood);
    wall.position.set(0, 3.75, -4);
    tg.add(wall);

    const sideG = new THREE.BoxGeometry(0.4, 4.5, 8);
    [-6.5, 6.5].forEach((x) => {
      const s = mesh(sideG, MAT.wood);
      s.position.set(x, 3.75, 0);
      tg.add(s);
      this.occluders.push(s);
    });

    const roof = mesh(new THREE.ConeGeometry(12, 4.5, 4), MAT.roof);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.78;
    roof.position.y = 8.2;
    tg.add(roof);

    const eave = mesh(new THREE.BoxGeometry(17.5, 0.35, 12.5), MAT.roof);
    eave.position.y = 6.05;
    tg.add(eave);

    this.scene.add(tg);
    this.occluders.push(base, wall, roof, eave);
    this.addSolid(-4, -29, 5.8, 10);
    this.addSolid(4, -29, 5.8, 10);

    // Torii Gate
    const toriiG = new THREE.Group();
    toriiG.position.set(0, 0, 17);
    const toriiP = new THREE.CylinderGeometry(0.28, 0.32, 6, 10);
    [-3.2, 3.2].forEach((x) => {
      const p = mesh(toriiP, MAT.torii);
      p.position.set(x, 3, 0);
      toriiG.add(p);
      this.occluders.push(p);
      this.addSolid(x, 17, 0.55, 7);
    });
    const tTop = mesh(new THREE.BoxGeometry(9.2, 0.5, 0.7), MAT.dark);
    tTop.position.y = 6.3;
    toriiG.add(tTop);
    const tTop2 = mesh(new THREE.BoxGeometry(8.4, 0.35, 0.5), MAT.torii);
    tTop2.position.y = 5.9;
    toriiG.add(tTop2);
    const tMid = mesh(new THREE.BoxGeometry(7.4, 0.3, 0.4), MAT.torii);
    tMid.position.y = 5;
    toriiG.add(tMid);
    this.scene.add(toriiG);

    // Trees & Rocks
    const trunkG = new THREE.CylinderGeometry(0.3, 0.42, 3.2, 7);
    const pineG = new THREE.ConeGeometry(2.1, 5.2, 7);
    const sakG = new THREE.IcosahedronGeometry(2.3, 0);

    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + rand(0, 0.15);
      const r = 30 + rand(0, 8);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (z < -19 && Math.abs(x) < 13) continue;
      if (z > 13 && Math.abs(x) < 6) continue;

      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const t = mesh(trunkG, MAT.trunk);
      t.position.y = 1.6;
      g.add(t);

      const s = 0.8 + rand(0, 0.5);
      const top = Math.random() < 0.4 ? mesh(sakG, MAT.sakura) : mesh(pineG, MAT.pine);
      top.position.y = 4.8;
      top.scale.setScalar(s);
      g.add(top);

      this.scene.add(g);
      this.occluders.push(t, top);
      this.addSolid(x, z, 0.9, 9);
    }

    // Japanese Stone Lanterns (Tōrō) along path and courtyard
    const lanternPts = [
      [-3.2, -6], [3.2, -6],
      [-3.2, -14], [3.2, -14],
      [-3.8, 12], [3.8, 12],
      [-9, 0], [9, 0]
    ];
    lanternPts.forEach(([lx, lz]) => {
      const lg = new THREE.Group();
      lg.position.set(lx, 0, lz);
      const lBase = mesh(new THREE.BoxGeometry(0.7, 0.35, 0.7), MAT.stone);
      lBase.position.y = 0.175;
      lg.add(lBase);
      const lPillar = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.8, 8), MAT.stone);
      lPillar.position.y = 0.75;
      lg.add(lPillar);
      const lShelf = mesh(new THREE.BoxGeometry(0.65, 0.15, 0.65), MAT.stone);
      lShelf.position.y = 1.2;
      lg.add(lShelf);
      const lGlow = mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), MAT.glow);
      lGlow.position.y = 1.48;
      lg.add(lGlow);
      const lRoof = mesh(new THREE.ConeGeometry(0.62, 0.35, 4), MAT.roof);
      lRoof.rotation.y = Math.PI / 4;
      lRoof.position.y = 1.88;
      lg.add(lRoof);
      this.scene.add(lg);
      this.occluders.push(lBase, lRoof);
      this.addSolid(lx, lz, 0.45, 2.2);
    });

    // Japanese War Banners (Sashimono)
    const bannerPts = [
      [-12, -22, 0.1], [12, -22, -0.1],
      [-15, 8, 0.15], [15, 8, -0.15],
      [-7, 22, 0.05], [7, 22, -0.05]
    ];
    bannerPts.forEach(([bx, bz, rotY]) => {
      const bg = new THREE.Group();
      bg.position.set(bx, 0, bz);
      bg.rotation.y = rotY;
      const pole = mesh(new THREE.CylinderGeometry(0.06, 0.08, 5.5, 8), MAT.woodDark);
      pole.position.y = 2.75;
      bg.add(pole);
      const bar = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6).rotateZ(Math.PI / 2), MAT.woodDark);
      bar.position.set(0.55, 5.2, 0);
      bg.add(bar);
      const cloth = mesh(new THREE.BoxGeometry(1.0, 3.6, 0.02), MAT.crimson);
      cloth.position.set(0.55, 3.3, 0);
      bg.add(cloth);
      const crest = mesh(new THREE.OctahedronGeometry(0.18, 0), MAT.gold);
      crest.position.set(0.55, 4.0, 0.02);
      bg.add(crest);
      this.scene.add(bg);
      this.addSolid(bx, bz, 0.3, 5.5);
    });

    // Zen Garden Mossy Stone Formations (Ishi)
    const rockPts = [
      [-10, -12, 1.1], [10, -12, 0.9],
      [-8, 16, 0.85], [8, 16, 1.05],
      [-16, -2, 1.3], [16, -2, 1.2],
      [-5, -24, 0.95], [5, -24, 0.9]
    ];
    rockPts.forEach(([rx, rz, s]) => {
      const rock = mesh(new THREE.DodecahedronGeometry(s, 1), MAT.stoneDark);
      rock.position.set(rx, s * 0.4, rz);
      rock.scale.set(1.2, 0.7, 1.1);
      this.scene.add(rock);
      this.occluders.push(rock);
      this.addSolid(rx, rz, s * 0.9, s * 1.5);
    });

    // Sacred Temple Torches (Kagaribi) with flickering fire
    const torchPts = [
      [-5.5, -23], [5.5, -23],
      [-2, 14], [2, 14]
    ];
    torchPts.forEach(([tx, tz]) => {
      const tg = new THREE.Group();
      tg.position.set(tx, 0, tz);
      // Tripod wooden legs
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2;
        const leg = mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), MAT.woodDark);
        leg.position.set(Math.sin(ang) * 0.28, 1.1, Math.cos(ang) * 0.28);
        leg.rotation.x = Math.cos(ang) * 0.18;
        leg.rotation.z = -Math.sin(ang) * 0.18;
        tg.add(leg);
      }
      // Iron Fire Bowl
      const bowl = mesh(new THREE.CylinderGeometry(0.35, 0.2, 0.25, 8), MAT.dark);
      bowl.position.y = 2.15;
      tg.add(bowl);
      // Fire flame glow
      const fire = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.45, 8),
        new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.9, fog: false })
      );
      fire.position.y = 2.45;
      tg.add(fire);
      this.scene.add(tg);
      this.addSolid(tx, tz, 0.35, 2.5);
    });

    // Doom Barrels
    this.barrelsGroup.visible = false;
    this.scene.add(this.barrelsGroup);
    const bodyG = new THREE.CylinderGeometry(0.42, 0.46, 0.9, 10);
    const rimG = new THREE.CylinderGeometry(0.44, 0.44, 0.06, 10);
    const fireG = new THREE.CylinderGeometry(0.3, 0.1, 0.3, 8);
    const rustM = new THREE.MeshLambertMaterial({ color: 0x3a2620 });
    const rimM = new THREE.MeshLambertMaterial({ color: 0x1c1512 });
    const fireM = new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.85, fog: false });

    const pts = [
      [6, -6],
      [-7, -3],
      [9, 8],
      [-9, 6],
      [3, 20],
      [-4, 22],
      [11, -18],
      [-12, -14]
    ];
    pts.forEach(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const b = mesh(bodyG, rustM);
      b.position.y = 0.45;
      g.add(b);
      const r1 = mesh(rimG, rimM);
      r1.position.y = 0.88;
      g.add(r1);
      const f = new THREE.Mesh(fireG, fireM);
      f.position.y = 1.05;
      g.add(f);
      this.barrelsGroup.add(g);
      this.barrelPositions.push({ x, z, fire: f });
    });
  }

  private initPlayer() {
    this.player.rig = buildPlayerRig(this.charId);
    this.scene.add(this.player.rig.root);

    this.weapons = this.charId === 'kage' ? WEAPONS_KAGE : WEAPONS_BRAVO;
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
    this.slashGeos = {
      katana: new THREE.RingGeometry(1.1, 2.9, 24, 1, -Math.PI / 2 - 1.05, 2.1).rotateX(-Math.PI / 2),
      bo: new THREE.RingGeometry(1.6, 3.5, 40).rotateX(-Math.PI / 2),
      kick: new THREE.RingGeometry(0.9, 2.8, 24, 1, -Math.PI / 2 - 1.5, 3.0).rotateX(-Math.PI / 2)
    };

    const slashMat = new THREE.MeshBasicMaterial({
      color: 0xfff0d8,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.slash = new THREE.Mesh(this.slashGeos.katana, slashMat);
    this.slash.visible = false;
    this.scene.add(this.slash);

    this.chainLink = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      MAT.metal
    );
    this.chainTip = mesh(new THREE.BoxGeometry(0.03, 0.34, 0.08), MAT.metal);
    this.chainTip.scale.setScalar(1.6);
    this.chain.add(this.chainLink, this.chainTip);
    this.chain.visible = false;
    this.scene.add(this.chain);
  }

  public setCharacter(id: CharacterId) {
    this.charId = id;
    this.applyTheme(id === 'bravo');
    if (this.state === 'play') return;

    this.scene.remove(this.player.rig.root);
    this.player.rig = buildPlayerRig(id);
    this.scene.add(this.player.rig.root);

    this.weapons = id === 'kage' ? WEAPONS_KAGE : WEAPONS_BRAVO;
    this.player.weaponMeshes = [];
    this.weapons.forEach((w) => {
      const m = makeWeapon(w.id);
      m.visible = false;
      this.player.rig.hand.add(m);
      this.player.weaponMeshes.push(m);
    });
    this.setWeapon(0);
  }

  public applyTheme(isDoom: boolean) {
    this.doomActive = isDoom;
    const T = WORLD_PAL[isDoom ? 'doom' : 'ninja'];
    this.scene.background = new THREE.Color(T.sky);
    if (this.scene.fog && 'far' in this.scene.fog) {
      this.scene.fog.color.set(T.sky);
      (this.scene.fog as THREE.Fog).far = T.fogFar;
    }
    MAT.ground.color.set(T.ground);
    MAT.stone.color.set(T.stone);
    MAT.stoneDark.color.set(T.stoneDark);
    MAT.wood.color.set(T.wood);
    MAT.roof.color.set(T.roof);
    MAT.torii.color.set(T.torii);
    MAT.trunk.color.set(T.trunk);
    MAT.pine.color.set(T.pine);
    MAT.sakura.color.set(T.sakura);
    MAT.glow.color.set(T.glow);

    this.sun.color.set(T.sun);
    this.sun.intensity = T.sunI;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.set(T.sunDisc);
    this.hemi.color.set(T.hemiSky);
    this.hemi.groundColor.set(T.hemiGround);

    this.barrelsGroup.visible = isDoom;
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
    this.player.suppress = 0;
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
    this.setWeapon(0);
  }

  public nextWave() {
    this.wave++;
    this.clearedShown = false;
    this.player.tookDamage = false;

    const isZ = this.charId === 'bravo';
    const boss = this.wave % 4 === 0;
    const nS = Math.min(isZ ? 13 : 9, (isZ ? 3 : 2) + this.wave);
    const nA = Math.min(isZ ? 6 : 4, Math.floor(this.wave / 2) + (isZ ? 1 : 0));

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

    const sub = boss
      ? isZ
        ? 'O colosso desperta'
        : 'O oni despertou'
      : `${nS} ${isZ ? 'infectados' : 'samurais'}${nA ? ` e ${nA} ${isZ ? 'cuspidores' : 'arqueiros'}` : ''}`;
    this.callbacks.onWaveChange(this.wave, `Onda ${this.wave}`, sub);
    sfx.wave();
  }

  private spawnEnemy(type: 'samurai' | 'archer' | 'boss', x: number, z: number) {
    const hpMul = 1 + (this.wave - 1) * 0.15;
    const isZ = this.charId === 'bravo';
    let rig: RigInstance;
    let hp = 60;
    let speed = 3.7;
    let r = 0.5;
    let h = 2.5;

    if (type === 'samurai') {
      rig = isZ
        ? buildZombieRig({ cloth: 0x3c4230, skin: 0x7c9159, hunch: 0.34 })
        : buildRig({ cloth: 0x7d2a2a, band: 0x1c1a22, skin: 0xd9a577 });
      if (!isZ) {
        const hMesh = mesh(GEO.helmet, MAT.dark);
        hMesh.position.y = 0.26;
        rig.head.add(hMesh);
        rig.hand.add(makeWeapon('katana'));
      }
      hp = (isZ ? 46 : 60) * hpMul;
      speed = isZ ? 3.0 : 3.7;
    } else if (type === 'archer') {
      rig = isZ
        ? buildZombieRig({ cloth: 0x4a3d55, skin: 0x8aa060, hunch: 0.22, eye: 0x8fff5a })
        : buildRig({ cloth: 0x3d5640, band: 0xb89a5a, skin: 0xd9a577 });
      if (!isZ) rig.handL.add(makeWeapon('bow'));
      hp = (isZ ? 34 : 40) * hpMul;
      speed = isZ ? 2.8 : 3.3;
    } else {
      rig = isZ
        ? buildZombieRig({
            cloth: 0x2e3a20,
            skin: 0x5a6b3f,
            scale: 2.1,
            hunch: 0.16,
            eye: 0xc8ff6a,
            armBend: -0.2,
            armTwist: 0.1
          })
        : buildRig({ cloth: 0x3a1414, band: 0xd4a24c, skin: 0xb03a2e, scale: 2.1 });
      if (isZ) {
        rig.hand.add(makeWeapon('club'));
      } else {
        rig.hand.add(makeWeapon('kanabo'));
      }
      hp = (isZ ? 400 : 480) * hpMul;
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
      isZ,
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

    if (type === 'boss') {
      enemy.tele = new THREE.Mesh(
        new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.3, depthWrite: false })
      );
      enemy.tele.visible = false;
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
    e.rig.mats.forEach((m) => m.dispose());
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

  private spawnBloodRing(x: number, y: number, z: number, maxR: number) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9b111e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const m = new THREE.Mesh(this.ringGeo, ringMat);
    m.position.set(x, Math.max(0.08, y * 0.4), z);
    m.scale.set(0.1, 0.1, 0.1);
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur: 0.28, maxR, startR: 0.2 });
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
    this.player.comboT = 0;
    this.player.tornado = 0;
    this.player.rush = null;
    this.player.suppress = 0;

    if (this.lastMove.lengthSq() > 0.01 && this.player.moveAmt > 0.1) {
      this.player.dashDir.copy(this.lastMove).normalize();
    } else {
      this.player.dashDir.set(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    }
    this.player.yaw = Math.atan2(this.player.dashDir.x, this.player.dashDir.z);
    sfx.dash();
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

    const t = this.findTarget(w.kind === 'karate' ? 4 : w.kind === 'flame' ? 5 : w.kind === 'melee' ? 6 : 26);
    if (t) {
      this.player.yaw = Math.atan2(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z);
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
    if (!w.gun) {
      this.player.anim = { kind: w.anim || 'slash', t: 0, dur: w.dur || 0.2, side: step };
    } else {
      this.player.anim = { kind: 'shoot', t: 0, dur: Math.min(w.cd, 0.16), side: 0 };
    }
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
        const a = this.player.yaw + (i - (n - 1) / 2) * (w.spread || 0) + (w.gun ? rand(-0.03, 0.03) : 0);
        let vy = 0;
        if (t && !w.gun) {
          const d = Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z);
          vy = (t.pos.y + (t.type === 'boss' ? 2.4 : 1.2) - (this.player.pos.y + 1.4)) / Math.max(0.2, d / (w.speed || 30));
        }
        this.spawnProj({
          type: w.gun ? 'tracer' : w.id,
          friendly: true,
          gun: !!w.gun,
          ptMult: w.pointMult || 1,
          pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
          vel: new THREE.Vector3(Math.sin(a) * (w.speed || 30), vy, Math.cos(a) * (w.speed || 30)),
          dmg: w.dmg[0],
          pierce: !!w.pierce,
          life: w.life || 1.2
        });
      }
      if (w.gun) {
        this.emitParticles(this.tmpH.x, this.tmpH.y, this.tmpH.z, w.id === 'shotgun' ? 14 : 6, 0xffe3a0, 3.5, 1, 6, 0.16);
        this.player.recoil = 0.12;
        if (w.id === 'shotgun') sfx.shotgun();
        else if (w.id === 'rifle') sfx.rifle();
        else if (w.id === 'minigun') sfx.minigun();
        else sfx.pistol();
      } else {
        sfx.throw();
      }
    } else if (w.kind === 'bomb') {
      if (w.rocket) {
        this.spawnProj({
          type: 'tracer',
          gun: true,
          ptMult: w.pointMult || 1,
          friendly: true,
          bomb: true,
          pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
          vel: new THREE.Vector3(fx * 26, 0, fz * 26),
          dmg: w.dmg[0],
          life: 2.2
        });
        this.player.recoil = 0.2;
        sfx.bazooka();
      } else {
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
    } else if (w.kind === 'flame') {
      this.meleeHit(w.range || 4.6, w.arc || 1.3, w.dmg[0], 1, false);
      for (let i = 0; i < 4; i++) {
        const a = this.player.yaw + rand(-0.35, 0.35);
        const d = rand(0.5, w.range || 4.6);
        this.emitParticles(this.tmpH.x + Math.sin(a) * d, this.tmpH.y, this.tmpH.z + Math.cos(a) * d, 2, 0xff7a2e, 1.5, 1.2, 3, 0.3);
      }
      sfx.flame();
    }
  }

  private trySpecial(w: WeaponDef) {
    const S = SPECIALS[w.id];
    if (!S) return;
    this.player.atkCd = S.cd;
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
        this.meleeHit(2.9, 2.1, 28, 6, true);
        this.spHit = false;
        this.spawnProj({
          type: 'wave',
          friendly: true,
          sp: true,
          pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y - 0.3, this.tmpH.z),
          vel: new THREE.Vector3(fx * 22, 0, fz * 22),
          dmg: 35,
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
          if (d < 7 + e.r) this.hitEnemy(e, 30, -dx / d, -dz / d, 6, true);
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
            dmg: 16,
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
          this.hitEnemy(tg, 60, -dx / d, -dz / d, 8, true);
          this.spHit = false;
          sfx.dash();
        }
        break;
      }
      case 'karate':
        this.player.rush = { t: 0, hits: 0, kicked: false };
        break;
      default:
        // Firearms default burst
        for (let i = -2; i <= 2; i++) {
          const a = this.player.yaw + i * 0.08;
          this.spawnProj({
            type: 'tracer',
            gun: true,
            sp: true,
            friendly: true,
            pierce: true,
            pos: new THREE.Vector3(this.tmpH.x, this.tmpH.y, this.tmpH.z),
            vel: new THREE.Vector3(Math.sin(a) * 60, 0, Math.cos(a) * 60),
            dmg: 24,
            life: 0.9
          });
        }
        sfx.pistol();
        break;
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
    dmg *= this.player.dmgMult;
    e.hp -= dmg;
    e.flash = 0.14;
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

    if (Math.random() < 0.15) this.dropScroll(e.pos.x, e.pos.z);
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

  private dropScroll(x: number, z: number) {
    const wIdx = Math.floor(Math.random() * this.weapons.length);
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
    const glyph = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: 0xffd166 })
    );
    g.position.set(x, 0.9, z);
    ring.position.set(x, 0.06, z);
    this.scene.add(g, ring, glyph);
    this.scrolls.push({ g, ring, glyph, x, z, t: 0, w: wIdx });
  }

  private removeScroll(i: number) {
    const k = this.scrolls[i];
    this.scene.remove(k.g, k.ring, k.glyph);
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
    this.player.hp = Math.max(0, this.player.hp - dmg);
    this.player.inv = 0.6;
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
      gun: o.gun,
      sp: o.sp,
      ptMult: o.ptMult,
      bomb: o.bomb,
      kb: o.kb,
      noSolid: o.noSolid
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
      this.emitParticles(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, 3, 0x7a5cc8, 0.6, 0, 0, 0.35);
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
      this.player.special[idx] -= dt;
      if (this.player.special[idx] <= 0) {
        delete this.player.special[idx];
        specialsChanged = true;
      }
    }
    if (specialsChanged) {
      this.callbacks.onSpecialsUpdate({ ...this.player.special });
    }

    this.player.st = Math.min(this.player.maxSt, this.player.st + 22 * dt);
    this.callbacks.onStaminaChange(this.player.st, this.player.maxSt);

    if (this.input.attackHeld) {
      this.tryAttack();
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
    animateRig(
      this.player.rig,
      this.player.moveAmt,
      this.player.phase,
      !this.player.grounded,
      this.time,
      this.player.anim
    );

    this.player.rig.root.position.copy(this.player.pos);
    this.player.rig.root.rotation.y = this.player.yaw;
    this.player.rig.root.visible = !(this.player.inv > 0 && this.player.dash <= 0 && Math.floor(this.time * 20) % 2 === 0);
  }

  private updateCamera(dt: number) {
    const camTarget = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.6, this.player.pos.z);
    const cp = Math.cos(this.camPitch);
    const camDir = new THREE.Vector3(
      Math.sin(this.camYaw) * cp,
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * cp
    );

    let want = this.camera.aspect < 1 ? 10.5 : 7.2;
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
        e.rig.body.rotation.x = -Math.min(Math.PI / 2, e.deathT * 5);
        e.rig.root.position.y = -Math.max(0, e.deathT - 0.7) * 1.4;
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
        if (d > 1.8) {
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.cd <= 0) {
          e.cd = 1.4;
          this.damagePlayer(12, nx, nz);
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
        } else if (e.cd <= 0) {
          e.cd = 2.4;
          this.spawnProj({
            type: e.isZ ? 'spit' : 'arrow',
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
        if (d > 3.2) {
          mvx = nx;
          mvz = nz;
          spd = e.speed;
        } else if (e.cd <= 0) {
          e.cd = 2.0;
          this.damagePlayer(24, nx, nz);
          sfx.boom();
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
      animateRig(e.rig, e.moveAmt, e.phase, false, this.time + i);

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
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      let dead = p.life <= 0 || Math.hypot(p.pos.x, p.pos.z) > 55;
      if (!dead && p.friendly) {
        for (const e of this.enemies) {
          if (e.dead || (p.hit && p.hit.has(e))) continue;
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < e.r + 0.45) {
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
      const got = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z) < 1.4;
      if (got) {
        this.player.special[s.w] = 20;
        this.callbacks.onSpecialsUpdate({ ...this.player.special });
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
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.fov = this.camera.aspect < 1 ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  public loop = () => {
    this.reqId = requestAnimationFrame(this.loop);
    const real = Math.min(this.clock.getDelta(), 0.05);
    let dt = real;
    if (this.hitstop > 0) {
      this.hitstop -= real;
      dt = real * 0.08;
    }
    this.time += dt;

    if (this.state === 'play') {
      this.updatePlayerMovementAndCamera(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateScrolls(dt);

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
      this.camYaw += real * 0.12;
      this.player.phase += real * 2;
      animateRig(this.player.rig, 0, this.player.phase, false, this.time, null);
      this.player.rig.root.position.copy(this.player.pos);
      this.player.rig.root.rotation.y = this.player.yaw;
    }

    this.updateParticles(dt);
    this.updateCamera(real);

    this.sun.position.set(this.player.pos.x - 30, 40, this.player.pos.z - 25);
    this.sun.target.position.set(this.player.pos.x, 0, this.player.pos.z);

    this.renderer.render(this.scene, this.camera);
    this.drawMinimap();
  };

  public destroy() {
    if (this.reqId) cancelAnimationFrame(this.reqId);
    this.rings.forEach((r) => {
      this.scene.remove(r.m);
      (r.m.material as THREE.Material).dispose();
    });
    this.rings = [];
    this.pGeo.dispose();
    this.bGeo.dispose();
    this.renderer.dispose();
  }
}
