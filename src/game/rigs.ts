import * as THREE from 'three';
import { RigInstance } from './types';
import { rand, TAU } from './constants';

const std = (color: number, roughness = 0.5, metalness = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

export const MAT = {
  ground: std(0x55603f, 0.9, 0.0),
  stone: std(0x7a7064, 0.85, 0.05),
  stoneDark: std(0x48423d, 0.9, 0.05),
  wood: std(0x5a3122, 0.75, 0.02),
  woodDark: std(0x381e15, 0.8, 0.02),
  roof: std(0x28232c, 0.8, 0.1),
  torii: std(0xbd2e26, 0.6, 0.05),
  trunk: std(0x442e23, 0.9, 0.0),
  pine: std(0x27402d, 0.85, 0.0),
  sakura: std(0xefa3b8, 0.7, 0.0),
  rock: std(0x686461, 0.9, 0.05),
  glow: new THREE.MeshBasicMaterial({ color: 0xffb548 }),
  metal: std(0xe8edf5, 0.18, 0.92),
  chrome: std(0xf4f8fc, 0.12, 0.98),
  gold: std(0xf6ba38, 0.26, 0.88),
  bronze: std(0xbf7834, 0.35, 0.82),
  dark: std(0x16131c, 0.78, 0.15),
  clothNinja: std(0x181520, 0.82, 0.0),
  bone: std(0xe8dfc8, 0.65, 0.02),
  gunmetal: std(0x363a42, 0.32, 0.78),
  crimson: std(0xa61c24, 0.62, 0.05),
  blood: std(0x820e15, 0.45, 0.1),
  skin: std(0xdca880, 0.68, 0.0),
  skinBravo: std(0xc28a68, 0.68, 0.0),
  skinDemon: std(0xb33026, 0.62, 0.02),
  skinZombie: std(0x758c56, 0.8, 0.0),
  camo: std(0x444f33, 0.85, 0.0),
  vest: std(0x282b22, 0.8, 0.05),
  hazard: std(0xf0b820, 0.4, 0.1),
  laser: new THREE.MeshBasicMaterial({ color: 0x00ff88 }),
  redDot: new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  eyeCyan: new THREE.MeshBasicMaterial({ color: 0x36e2ff }),
  eyeAmber: new THREE.MeshBasicMaterial({ color: 0xffb326 }),
  eyeDemon: new THREE.MeshBasicMaterial({ color: 0xff3b1f }),
  eyeZombie: new THREE.MeshBasicMaterial({ color: 0x9eff4a }),
  arrowFeather: std(0xdedede, 0.8, 0.0)
};

export const GEO = {
  torso: new THREE.BoxGeometry(0.72, 0.8, 0.42),
  hips: new THREE.BoxGeometry(0.62, 0.28, 0.4),
  head: new THREE.SphereGeometry(0.27, 14, 12),
  eye: new THREE.BoxGeometry(0.34, 0.07, 0.06),
  band: new THREE.BoxGeometry(0.58, 0.08, 0.58),
  tail: new THREE.BoxGeometry(0.06, 0.04, 0.5).translate(0, 0, -0.25),
  leg: new THREE.BoxGeometry(0.21, 0.74, 0.23).translate(0, -0.37, 0),
  arm: new THREE.BoxGeometry(0.17, 0.68, 0.19).translate(0, -0.34, 0),
  scarf: new THREE.BoxGeometry(0.3, 0.05, 0.95).translate(0, 0, -0.47),
  belt: new THREE.BoxGeometry(0.75, 0.1, 0.45),
  helmet: new THREE.ConeGeometry(0.42, 0.34, 10),
  horn: new THREE.ConeGeometry(0.08, 0.42, 8)
};

export const GEO_Z = {
  hips: new THREE.BoxGeometry(0.6, 0.26, 0.38),
  torsoA: new THREE.BoxGeometry(0.68, 0.54, 0.4),
  torsoB: new THREE.BoxGeometry(0.5, 0.3, 0.44).translate(0.09, -0.1, 0.02),
  rib: new THREE.BoxGeometry(0.18, 0.22, 0.08),
  wound: new THREE.BoxGeometry(0.22, 0.16, 0.06),
  head: new THREE.SphereGeometry(0.25, 12, 10),
  jaw: new THREE.BoxGeometry(0.2, 0.1, 0.2).translate(0, -0.16, 0.02),
  hair1: new THREE.BoxGeometry(0.05, 0.22, 0.05),
  hair2: new THREE.BoxGeometry(0.04, 0.16, 0.04),
  leg: new THREE.BoxGeometry(0.2, 0.74, 0.22).translate(0, -0.37, 0),
  armUpper: new THREE.BoxGeometry(0.16, 0.36, 0.18).translate(0, -0.18, 0),
  armFore: new THREE.BoxGeometry(0.135, 0.34, 0.155).translate(0, -0.17, 0.01),
  scarfStub: new THREE.BoxGeometry(0.001, 0.001, 0.001)
};

export const GUN_G = {
  pistolSlide: new THREE.BoxGeometry(0.085, 0.1, 0.34).translate(0, 0.05, 0.05),
  pistolFrame: new THREE.BoxGeometry(0.09, 0.09, 0.18).translate(0, -0.005, -0.02),
  pistolGrip: new THREE.BoxGeometry(0.075, 0.19, 0.095).translate(0, -0.15, -0.09),
  pistolTrigger: new THREE.TorusGeometry(0.045, 0.012, 6, 12).translate(0, -0.05, -0.02),
  pistolSight: new THREE.BoxGeometry(0.02, 0.02, 0.03).translate(0, 0.105, 0.2),
  shotBarrel: new THREE.CylinderGeometry(0.04, 0.045, 0.82, 10).rotateX(Math.PI / 2).translate(0, 0.03, 0.32),
  shotPump: new THREE.BoxGeometry(0.075, 0.075, 0.28).translate(0, -0.01, 0.14),
  shotStock: new THREE.BoxGeometry(0.09, 0.14, 0.4).translate(0, -0.02, -0.15),
  shotTrigger: new THREE.TorusGeometry(0.045, 0.011, 6, 12).translate(0, -0.06, -0.03),
  rifleBody: new THREE.BoxGeometry(0.08, 0.13, 0.6).translate(0, 0, 0.05),
  rifleBarrel: new THREE.CylinderGeometry(0.02, 0.022, 0.4, 10).rotateX(Math.PI / 2).translate(0, 0.01, 0.52),
  rifleMag: new THREE.BoxGeometry(0.06, 0.24, 0.09).rotateX(-0.25).translate(0, -0.19, 0.02),
  rifleStock: new THREE.BoxGeometry(0.06, 0.1, 0.22).translate(0, -0.01, -0.42),
  rifleGrip: new THREE.BoxGeometry(0.06, 0.15, 0.07).rotateX(-0.3).translate(0, -0.13, -0.18),
  rifleTrigger: new THREE.TorusGeometry(0.045, 0.011, 6, 12).translate(0, -0.08, -0.1),
  rifleSight: new THREE.BoxGeometry(0.02, 0.05, 0.02).translate(0, 0.1, 0.15),
  flameTank: new THREE.CylinderGeometry(0.11, 0.11, 0.5, 12).rotateZ(Math.PI / 2).translate(-0.15, -0.05, -0.15),
  flameCap: new THREE.CylinderGeometry(0.115, 0.115, 0.04, 12).rotateZ(Math.PI / 2),
  flameNozzle: new THREE.CylinderGeometry(0.035, 0.05, 0.55, 10).rotateX(Math.PI / 2).translate(0, 0, 0.2),
  flameGrip: new THREE.BoxGeometry(0.05, 0.16, 0.06).translate(0, -0.1, 0.05),
  miniBody: new THREE.BoxGeometry(0.13, 0.16, 0.4).translate(0, 0, 0.05),
  miniDrum: new THREE.CylinderGeometry(0.09, 0.09, 0.14, 12).rotateX(Math.PI / 2).translate(0, -0.14, -0.02),
  miniBarrel: new THREE.CylinderGeometry(0.024, 0.024, 0.62, 8).rotateX(Math.PI / 2),
  miniMuzzle: new THREE.CylinderGeometry(0.11, 0.08, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, 0.78),
  bazookaTube: new THREE.CylinderGeometry(0.11, 0.11, 1.3, 14).rotateX(Math.PI / 2).translate(0, 0, 0.3),
  bazookaRim: new THREE.TorusGeometry(0.11, 0.018, 8, 16).translate(0, 0, 0.95),
  bazookaGrip: new THREE.BoxGeometry(0.05, 0.16, 0.06).translate(0, -0.13, 0.15),
  bazookaSight: new THREE.BoxGeometry(0.04, 0.09, 0.04).translate(0, 0.13, 0.1),
  knifeBlade: new THREE.BoxGeometry(0.03, 0.06, 0.5),
  knifeGuard: new THREE.BoxGeometry(0.13, 0.03, 0.05).translate(0, 0, -0.22),
  knifeGrip: new THREE.BoxGeometry(0.045, 0.045, 0.2).translate(0, 0, -0.36)
};

export const WG = {
  blade: new THREE.BoxGeometry(0.038, 0.09, 1.15),
  bladeTip: new THREE.ConeGeometry(0.065, 0.14, 6).rotateX(Math.PI / 2),
  tsuba: new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12).rotateZ(Math.PI / 2),
  grip: new THREE.BoxGeometry(0.055, 0.055, 0.3),
  kashira: new THREE.BoxGeometry(0.07, 0.065, 0.045),
  staff: new THREE.CylinderGeometry(0.045, 0.045, 2.6, 10).rotateX(Math.PI / 2),
  kHandle: new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8).rotateX(Math.PI / 2),
  kBlade: new THREE.BoxGeometry(0.03, 0.34, 0.08),
  star: new THREE.CylinderGeometry(0.2, 0.2, 0.025, 4),
  kunai: new THREE.ConeGeometry(0.07, 0.4, 4).rotateX(Math.PI / 2),
  kGrip: new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8).rotateX(Math.PI / 2),
  ring: new THREE.TorusGeometry(0.05, 0.013, 6, 12),
  bomb: new THREE.SphereGeometry(0.17, 12, 10),
  fuse: new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6),
  shaft: new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6).rotateX(Math.PI / 2),
  tip: new THREE.ConeGeometry(0.04, 0.12, 6).rotateX(Math.PI / 2),
  bow: new THREE.TorusGeometry(0.55, 0.025, 6, 20, Math.PI),
  kanabo: new THREE.CylinderGeometry(0.07, 0.14, 1.7, 10).rotateX(Math.PI / 2)
};

export const TRACER_GEO = new THREE.CylinderGeometry(0.02, 0.02, 1, 6).rotateX(Math.PI / 2);
export const TRACER_MAT = new THREE.MeshBasicMaterial({
  color: 0xfff2b8,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export const WAVE_GEO = new THREE.RingGeometry(1.0, 1.7, 24, 1, -Math.PI / 2 - 1.1, 2.2)
  .rotateX(-Math.PI / 2)
  .translate(0, 0, -1.3);
export const WAVE_MAT = new THREE.MeshBasicMaterial({
  color: 0xffd166,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true, recv = false) {
  const obj = new THREE.Mesh(geo, m);
  obj.castShadow = cast;
  obj.receiveShadow = recv;
  return obj;
}

// ----------------------------------------------------
// ENEMY SAMURAI / ARCHER / ONI RIG BUILDER
// ----------------------------------------------------
export function buildRig(o: { cloth: number; band: number; skin?: number; scale?: number }): RigInstance {
  const isBoss = (o.scale || 1) > 1.5;
  const cloth = std(o.cloth, 0.75, 0.05);
  const band = std(o.band, 0.5, 0.3);
  const skin = isBoss ? MAT.skinDemon : std(o.skin || 0xd9a577, 0.65, 0.0);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent = body) => {
    const me = mesh(geo, m);
    me.position.set(x, y, z);
    parent.add(me);
    return me;
  };

  // Hips & Torso
  add(GEO.hips, cloth, 0, 0.86, 0);
  add(GEO.torso, cloth, 0, 1.3, 0);
  add(GEO.belt, band, 0, 0.98, 0);

  // Chest Armor Plate (Dō)
  const chestPlate = add(new THREE.BoxGeometry(0.74, 0.52, 0.44), isBoss ? MAT.stoneDark : MAT.dark, 0, 1.38, 0.02);
  chestPlate.scale.set(1.02, 1, 1.02);

  // Samurai Shoulder Armor Pads (Sode)
  const sodeGeo = new THREE.BoxGeometry(0.24, 0.38, 0.08);
  const sodeL = add(sodeGeo, isBoss ? MAT.dark : MAT.gold, -0.5, 1.62, 0);
  sodeL.rotation.z = 0.22;
  const sodeR = add(sodeGeo, isBoss ? MAT.dark : MAT.gold, 0.5, 1.62, 0);
  sodeR.rotation.z = -0.22;

  // Head
  const head = new THREE.Group();
  head.position.y = 1.96;
  body.add(head);
  add(GEO.head, cloth, 0, 0, 0, head);

  // Eyes
  let eyeMesh: THREE.Mesh;
  if (isBoss) {
    // Menacing Demon Eyes
    eyeMesh = add(new THREE.BoxGeometry(0.36, 0.09, 0.08), MAT.eyeDemon, 0, 0.03, 0.24, head);
    // Twin Demon Horns
    const hornL = add(GEO.horn, MAT.bone, -0.16, 0.28, 0.04, head);
    hornL.rotation.set(-0.2, 0, -0.35);
    const hornR = add(GEO.horn, MAT.bone, 0.16, 0.28, 0.04, head);
    hornR.rotation.set(-0.2, 0, 0.35);
    // Horn gold rings
    const rGeo = new THREE.TorusGeometry(0.08, 0.02, 6, 12);
    add(rGeo, MAT.gold, -0.16, 0.22, 0.04, head);
    add(rGeo, MAT.gold, 0.16, 0.22, 0.04, head);
  } else {
    eyeMesh = add(GEO.eye, skin, 0, 0.02, 0.235, head);
    // Headband
    add(GEO.band, band, 0, 0.1, 0, head);
    const t1 = add(GEO.tail, band, 0.06, 0.1, -0.28, head);
    t1.rotation.set(0.5, 0.15, 0);
    const t2 = add(GEO.tail, band, -0.06, 0.08, -0.28, head);
    t2.rotation.set(0.7, -0.15, 0);
  }

  // Legs & Shin Armor
  const legL = new THREE.Group();
  legL.position.set(-0.17, 0.78, 0);
  body.add(legL);
  add(GEO.leg, cloth, 0, 0, 0, legL);
  add(new THREE.BoxGeometry(0.23, 0.32, 0.25), MAT.dark, 0, -0.42, 0.01, legL);

  const legR = new THREE.Group();
  legR.position.set(0.17, 0.78, 0);
  body.add(legR);
  add(GEO.leg, cloth, 0, 0, 0, legR);
  add(new THREE.BoxGeometry(0.23, 0.32, 0.25), MAT.dark, 0, -0.42, 0.01, legR);

  // Arms & Bracers
  const armL = new THREE.Group();
  armL.position.set(-0.47, 1.66, 0);
  body.add(armL);
  add(GEO.arm, cloth, 0, 0, 0, armL);
  add(new THREE.BoxGeometry(0.19, 0.28, 0.21), MAT.dark, 0, -0.45, 0, armL);

  const armR = new THREE.Group();
  armR.position.set(0.47, 1.66, 0);
  body.add(armR);
  add(GEO.arm, cloth, 0, 0, 0, armR);
  add(new THREE.BoxGeometry(0.19, 0.28, 0.21), MAT.dark, 0, -0.45, 0, armR);

  const hand = new THREE.Group();
  hand.position.y = -0.68;
  armR.add(hand);

  const handL = new THREE.Group();
  handL.position.y = -0.68;
  armL.add(handL);

  const scarf = add(GEO.scarf, band, 0, 1.66, -0.22);
  root.scale.setScalar(o.scale || 1);

  return {
    root,
    body,
    head,
    eye: eyeMesh,
    legL,
    legR,
    legBaseY: legL.position.y,
    armL,
    armR,
    hand,
    handL,
    scarf,
    mats: [cloth, band, skin]
  };
}

// ----------------------------------------------------
// ZOMBIE / INFECTED RIG BUILDER
// ----------------------------------------------------
export function buildZombieRig(o: {
  cloth: number;
  skin?: number;
  scale?: number;
  hunch?: number;
  eye?: number;
  armBend?: number;
  armTwist?: number;
}): RigInstance {
  const cloth = std(o.cloth, 0.85, 0.02);
  const skin = std(o.skin || 0x758c56, 0.8, 0.0);
  const rot = std(0x221d18, 0.9, 0.0);
  const wound = std(0x6e1418, 0.5, 0.05);
  const boneM = std(0xdcd4ba, 0.65, 0.02);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent = body) => {
    const me = mesh(geo, m);
    me.position.set(x, y, z);
    parent.add(me);
    return me;
  };

  const legL = new THREE.Group();
  legL.position.set(-0.16, 0.78, 0);
  body.add(legL);
  add(GEO_Z.leg, cloth, 0, 0, 0, legL);

  const legR = new THREE.Group();
  legR.position.set(0.16, 0.78, 0);
  body.add(legR);
  add(GEO_Z.leg, cloth, 0, 0, 0, legR);

  const spine = new THREE.Group();
  spine.position.set(0, 0.86, 0);
  spine.rotation.x = o.hunch ?? 0.3;
  body.add(spine);
  add(GEO_Z.hips, cloth, 0, 0, 0, spine);

  const t1 = add(GEO_Z.torsoA, cloth, -0.02, 0.42, -0.01, spine);
  t1.rotation.z = 0.03;
  add(GEO_Z.torsoB, rot, 0, 0.42, -0.01, spine);
  add(GEO_Z.rib, boneM, -0.16, 0.5, 0.2, spine);
  const wd = add(GEO_Z.wound, wound, 0.12, 0.55, 0.19, spine);
  wd.rotation.z = 0.25;

  // Toxic pustules / bio-glow
  const pustule = add(new THREE.SphereGeometry(0.09, 8, 6), MAT.eyeZombie, 0.16, 0.65, 0.18, spine);
  pustule.scale.set(1.2, 0.8, 1);

  const head = new THREE.Group();
  head.position.set(0.02, 1.12, 0.06);
  spine.add(head);
  add(GEO_Z.head, skin, 0, 0, 0, head);

  const eye = mesh(GEO.eye, new THREE.MeshBasicMaterial({ color: o.eye || 0x9eff4a }));
  eye.scale.set(0.7, 1, 1);
  eye.position.set(0, 0.02, 0.2);
  head.add(eye);
  add(GEO_Z.jaw, skin, 0, -0.02, 0.06, head);

  [
    [-0.08, 0.16, -0.05, 0.35],
    [0.06, 0.18, -0.08, -0.3],
    [0.14, 0.15, -0.03, 0.6],
    [-0.02, 0.2, -0.1, 0]
  ].forEach(([x, y, z, rz]) => {
    const hh = add(Math.random() < 0.5 ? GEO_Z.hair1 : GEO_Z.hair2, rot, x, y, z, head);
    hh.rotation.set(rand(-0.3, 0.3), rand(-0.3, 0.3), rz);
  });

  const arm = (side: number) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.44, 0.8, 0);
    spine.add(sh);
    add(GEO_Z.armUpper, cloth, 0, 0, 0, sh);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.36, 0);
    elbow.rotation.set((o.armBend ?? -0.55) * (side < 0 ? 1 : 0.4), 0, side * (o.armTwist ?? 0.35));
    sh.add(elbow);
    add(GEO_Z.armFore, skin, 0, 0, 0, elbow);
    const hnd = new THREE.Group();
    hnd.position.y = -0.34;
    elbow.add(hnd);
    return { sh, hnd };
  };

  const aL = arm(-1);
  const aR = arm(1);
  const scarf = new THREE.Group();
  root.scale.setScalar(o.scale || 1);

  return {
    root,
    body,
    head,
    eye,
    legL,
    legR,
    legBaseY: legL.position.y,
    armL: aL.sh,
    armR: aR.sh,
    hand: aR.hnd,
    handL: aL.hnd,
    scarf,
    mats: [cloth, skin]
  };
}

// ---------- Avatar do jogador (Texturas Faciais Originais) ----------
export const FACE_URI =
  'data:image/jpeg;base64,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';

function crestTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = '#b8323c';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 32, 17, 0, TAU);
    g.stroke();
    g.fillStyle = '#b8323c';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU - Math.PI / 2;
      g.beginPath();
      g.ellipse(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 6, 3, a + Math.PI / 2, 0, TAU);
      g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

export const FACE_URI2 =
  'data:image/jpeg;base64,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';

function camoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#4a5233';
    g.fillRect(0, 0, 64, 64);
    const blot = (col: string, n: number) => {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        g.save();
        g.translate(rand(0, 64), rand(0, 64));
        g.rotate(rand(0, TAU));
        g.beginPath();
        g.ellipse(0, 0, rand(4, 10), rand(3, 6), 0, 0, TAU);
        g.fill();
        g.restore();
      }
    };
    blot('#33381f', 10);
    blot('#6b6a42', 8);
    blot('#232a1c', 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

// ----------------------------------------------------
// PLAYER RIG BUILDER (KAGE & BRAVO) - HIGH FIDELITY & ORIGINAL FACES
// ----------------------------------------------------
export function buildPlayerRig(charId: 'kage' | 'bravo'): RigInstance {
  const isBravo = charId === 'bravo';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const B = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent = body) => {
    const me = mesh(geo, m);
    me.position.set(x, y, z);
    parent.add(me);
    return me;
  };

  if (!isBravo) {
    // ==========================================
    // KAGE: SHINOBI COM FOTO FACIAL ORIGINAL
    // ==========================================
    const skin = MAT.skin;
    const gi = new THREE.MeshLambertMaterial({ color: 0xf2efe8 });
    const giShade = new THREE.MeshLambertMaterial({ color: 0xd6d0c4 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x2a201a });
    const beard = new THREE.MeshLambertMaterial({ color: 0x3b302a });
    const belt = new THREE.MeshLambertMaterial({ color: 0x5a3a22 });
    const trim = new THREE.MeshLambertMaterial({ color: 0xb8323c });
    const pauldron = new THREE.MeshLambertMaterial({ color: 0x3a2e28 });
    const scabbard = new THREE.MeshLambertMaterial({ color: 0x241c17 });
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, map: new THREE.TextureLoader().load(FACE_URI) });
    const crestMat = new THREE.MeshBasicMaterial({ map: crestTexture(), transparent: true, depthWrite: false });

    add(B(0.72, 0.3, 0.48), gi, 0, 0.88, 0);
    add(B(0.82, 0.84, 0.52), gi, 0, 1.34, 0);
    const crest = add(B(0.22, 0.22, 0.02), crestMat, 0, 1.4, 0.265);
    crest.material = crestMat;

    [-1, 1].forEach((k) => {
      const l = add(B(0.07, 0.56, 0.02), giShade, k * 0.1, 1.5, 0.265);
      l.rotation.z = k * 0.45;
    });

    add(B(0.88, 0.055, 0.56), trim, 0, 1.62, 0);
    add(B(0.84, 0.1, 0.54), belt, 0, 1.0, 0);
    add(B(0.15, 0.11, 0.06), belt, 0, 1.0, 0.29);

    const tails = new THREE.Group();
    tails.position.set(0, 0.97, 0.3);
    body.add(tails);
    [-1, 1].forEach((k) => {
      const t = add(B(0.06, 0.34, 0.02), trim, k * 0.04, -0.17, 0, tails);
      t.rotation.z = k * 0.15;
    });

    [-1, 1].forEach((k) => {
      const pd = add(B(0.26, 0.09, 0.3), pauldron, k * 0.5, 1.74, 0);
      pd.rotation.z = k * 0.12;
    });

    const sc = new THREE.Group();
    sc.position.set(-0.18, 1.55, -0.24);
    sc.rotation.set(0.1, 0, 0.55);
    body.add(sc);
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.95, 8), scabbard, 0, 0, 0, sc);
    add(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 8), trim, 0, 0.44, 0, sc);

    add(B(0.24, 0.12, 0.24), skin, 0, 1.8, 0);

    const head = new THREE.Group();
    head.position.y = 2.1;
    body.add(head);

    // Cabeça do Kage com a foto original no plano frontal
    const headBox = mesh(B(0.56, 0.6, 0.5), [skin, skin, hair, beard, faceMat, hair]);
    head.add(headBox);

    add(B(0.58, 0.1, 0.52), hair, 0, 0.33, -0.01, head);
    add(B(0.6, 0.08, 0.54), trim, 0, 0.245, 0, head);

    [[0.07, 0.18, -0.28, 0.4], [-0.06, 0.15, -0.3, -0.35]].forEach(([x, y, z, rz]) => {
      const tl = add(B(0.07, 0.05, 0.4), trim, x, y, z, head);
      tl.rotation.set(0.3, 0.1, rz);
    });

    add(B(0.58, 0.44, 0.06), hair, 0, 0.1, -0.27, head);
    [-1, 1].forEach((k) => {
      add(B(0.04, 0.16, 0.3), hair, k * 0.29, 0.18, -0.08, head);
      add(B(0.05, 0.13, 0.08), skin, k * 0.3, 0.02, 0.02, head);
      add(B(0.04, 0.24, 0.3), beard, k * 0.29, -0.17, -0.02, head);
    });
    add(B(0.5, 0.05, 0.36), beard, 0, -0.31, 0.04, head);

    const leg = (x: number) => {
      const l = new THREE.Group();
      l.position.set(x, 0.8, 0);
      body.add(l);
      add(B(0.28, 0.72, 0.3), gi, 0, -0.36, 0, l);
      add(B(0.29, 0.05, 0.31), trim, 0, -0.58, 0, l);
      add(B(0.16, 0.07, 0.28), skin, 0, -0.75, 0.05, l);
      return l;
    };
    const legL = leg(-0.18);
    const legR = leg(0.18);

    const arm = (x: number) => {
      const a = new THREE.Group();
      a.position.set(x, 1.7, 0);
      body.add(a);
      add(B(0.25, 0.5, 0.27), gi, 0, -0.25, 0, a);
      add(B(0.26, 0.045, 0.28), trim, 0, -0.47, 0, a);
      add(B(0.15, 0.2, 0.17), skin, 0, -0.58, 0, a);
      add(B(0.16, 0.13, 0.18), skin, 0, -0.72, 0, a);
      return a;
    };
    const armL = arm(-0.53);
    const armR = arm(0.53);

    const hand = new THREE.Group();
    hand.position.y = -0.74;
    armR.add(hand);

    const handL = new THREE.Group();
    handL.position.y = -0.74;
    armL.add(handL);

    const scarf = new THREE.Group();
    body.add(scarf);

    return {
      root,
      body,
      head,
      eye: headBox,
      legL,
      legR,
      legBaseY: legL.position.y,
      armL,
      armR,
      hand,
      handL,
      scarf,
      tails,
      mats: [gi, skin, hair, trim]
    };
  } else {
    // ==========================================
    // BRAVO: COM FOTO FACIAL ORIGINAL E TRAJE TÁTICO
    // ==========================================
    const skin = new THREE.MeshLambertMaterial({ color: 0xc08868 });
    const band = new THREE.MeshLambertMaterial({ color: 0xb8262c });
    const bandDk = new THREE.MeshLambertMaterial({ color: 0x7a1a1f });
    const metal = new THREE.MeshLambertMaterial({ color: 0xc9a04a });
    const strapMat = new THREE.MeshLambertMaterial({ color: 0x3a2e1c });
    const boot = new THREE.MeshLambertMaterial({ color: 0x27221c });
    const camo = new THREE.MeshLambertMaterial({ map: camoTexture() });
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, map: new THREE.TextureLoader().load(FACE_URI2) });

    add(B(0.7, 0.3, 0.46), camo, 0, 0.88, 0);
    add(B(0.76, 0.84, 0.48), skin, 0, 1.34, 0);
    add(B(0.84, 0.09, 0.5), strapMat, 0, 1.0, 0);
    add(B(0.15, 0.1, 0.06), metal, 0, 1.0, 0.28);

    // Bandolier: anchored at the shoulder and hanging down to the opposite hip
    // (was centered on its pivot, which poked the strap up through the neck/head)
    const bando = new THREE.Group();
    bando.position.set(0, 1.78, 0.05);
    bando.rotation.z = 0.55;
    body.add(bando);
    add(B(0.16, 1.0, 0.05), strapMat, 0, -0.5, 0.2, bando);
    for (let i = -2; i <= 2; i++) {
      add(B(0.09, 0.16, 0.09), metal, 0, i * 0.18 - 0.5, 0.26, bando);
    }

    const tails = new THREE.Group();
    tails.position.set(0, 0.97, 0.3);
    body.add(tails);

    add(B(0.24, 0.12, 0.24), skin, 0, 1.8, 0);

    const head = new THREE.Group();
    head.position.y = 2.1;
    body.add(head);

    // Cabeça do Bravo com a foto original no plano frontal
    const headBox = mesh(B(0.56, 0.6, 0.5), [skin, skin, band, skin, faceMat, skin]);
    head.add(headBox);

    add(B(0.58, 0.13, 0.53), band, 0, 0.16, 0, head);
    const kt1 = add(B(0.06, 0.04, 0.42), bandDk, 0.08, 0.14, -0.32, head);
    kt1.rotation.set(0.15, 0.2, 0.1);
    const kt2 = add(B(0.06, 0.04, 0.36), bandDk, -0.06, 0.1, -0.3, head);
    kt2.rotation.set(0.3, -0.15, -0.1);

    const leg = (x: number) => {
      const l = new THREE.Group();
      l.position.set(x, 0.8, 0);
      body.add(l);
      add(B(0.28, 0.66, 0.3), camo, 0, -0.33, 0, l);
      add(B(0.19, 0.16, 0.22), boot, 0, -0.72, 0.03, l);
      return l;
    };
    const legL = leg(-0.18);
    const legR = leg(0.18);

    const arm = (x: number) => {
      const a = new THREE.Group();
      a.position.set(x, 1.7, 0);
      body.add(a);
      add(B(0.19, 0.5, 0.21), skin, 0, -0.25, 0, a);
      add(B(0.15, 0.2, 0.17), skin, 0, -0.58, 0, a);
      add(B(0.16, 0.13, 0.18), skin, 0, -0.72, 0, a);
      return a;
    };
    const armL = arm(-0.49);
    const armR = arm(0.49);

    const hand = new THREE.Group();
    hand.position.y = -0.74;
    armR.add(hand);

    const handL = new THREE.Group();
    handL.position.y = -0.74;
    armL.add(handL);

    const scarf = new THREE.Group();
    body.add(scarf);

    return {
      root,
      body,
      head,
      eye: headBox,
      legL,
      legR,
      legBaseY: legL.position.y,
      armL,
      armR,
      hand,
      handL,
      scarf,
      tails,
      mats: [skin, band, strapMat]
    };
  }
}

// ----------------------------------------------------
// ANIMATION RIG UPDATE (LOCOMOTION & WEAPON ATTACKS)
// ----------------------------------------------------
export function animateRig(
  r: RigInstance,
  moveAmt: number,
  phase: number,
  air: boolean,
  t: number,
  anim?: { kind: string; t: number; dur: number; side: number } | null
) {
  const s = Math.sin(phase);
  const idle = 1 - moveAmt;
  const breathe = Math.sin(t * 1.7) * 0.02 * idle;

  // Default locomotion for legs (the hip pivot's Y stays at legBaseY; only rotation animates the stride)
  if (air) {
    r.legL.rotation.x = -0.9;
    r.legR.rotation.x = 0.35;
  } else {
    r.legL.rotation.x = s * 0.85 * moveAmt;
    r.legR.rotation.x = -s * 0.85 * moveAmt;
  }

  // Base arm rotations
  r.armL.rotation.x = -s * 0.65 * moveAmt;
  r.armL.rotation.y = 0;
  r.armL.rotation.z = -0.08 - idle * 0.03;

  r.armR.rotation.x = s * 0.45 * moveAmt - 0.15;
  r.armR.rotation.y = 0;
  r.armR.rotation.z = 0.08 + idle * 0.03;

  r.body.position.y = Math.abs(s) * 0.065 * moveAmt + breathe;
  r.body.rotation.set(0.1 * moveAmt, Math.sin(t * 0.9) * 0.015 * idle, Math.sin(t * 1.3) * 0.012 * idle);

  // Scarf & Headband physics
  if (r.scarf && 'rotation' in r.scarf) {
    (r.scarf as THREE.Object3D).rotation.x = 0.1 + moveAmt * 0.85 + Math.sin(t * 9) * 0.1;
  }
  if (r.tails) {
    r.tails.rotation.x = -0.2 - moveAmt * 0.7 + Math.sin(t * 10) * 0.15;
    r.tails.rotation.y = Math.cos(t * 8) * 0.1;
  }

  // ====================================================
  // WEAPON ATTACK MOVEMENTS (KATANA, BŌ, KUNAI, KARATÊ, ETC.)
  // ====================================================
  if (anim && anim.dur > 0) {
    const p = Math.min(1, Math.max(0, anim.t / anim.dur));
    const kind = anim.kind;
    const side = anim.side || 0;

    if (kind === 'slash') {
      if (side === 0) {
        // Slash 1: Diagonal downward swing from high right to low left
        if (p < 0.28) {
          const k = p / 0.28;
          r.armR.rotation.set(-2.0 * k, 0.5 * k, 0.6 * k);
          r.armL.rotation.set(0.4 * k, 0.3 * k, -0.5 * k);
          r.body.rotation.y = 0.35 * k;
        } else {
          const k = (p - 0.28) / 0.72;
          r.armR.rotation.set(-2.0 + 3.1 * k, 0.5 - 1.1 * k, 0.6 - 1.1 * k);
          r.armL.rotation.set(0.4 - 0.2 * k, 0.3 - 0.5 * k, -0.5 + 0.2 * k);
          r.body.rotation.y = 0.35 - 0.8 * k;
        }
      } else if (side === 1) {
        // Slash 2: Horizontal backhand cut from left to right
        if (p < 0.28) {
          const k = p / 0.28;
          r.armR.rotation.set(-1.1 * k, -0.9 * k, -0.5 * k);
          r.armL.rotation.set(0.3 * k, -0.3 * k, -0.6 * k);
          r.body.rotation.y = -0.42 * k;
        } else {
          const k = (p - 0.28) / 0.72;
          r.armR.rotation.set(-1.1 + 1.7 * k, -0.9 + 2.0 * k, -0.5 + 1.1 * k);
          r.armL.rotation.set(0.3 - 0.2 * k, -0.3 + 0.4 * k, -0.6 + 0.3 * k);
          r.body.rotation.y = -0.42 + 0.9 * k;
        }
      } else {
        // Slash 3: Overhead Heavy Finisher with both arms and body lunge
        if (p < 0.35) {
          const k = p / 0.35;
          r.armR.rotation.set(-2.6 * k, 0.1 * k, -0.2 * k);
          r.armL.rotation.set(-2.4 * k, -0.1 * k, 0.2 * k);
          r.body.rotation.x = -0.3 * k;
          r.body.position.y += 0.25 * k;
        } else {
          const k = (p - 0.35) / 0.65;
          r.armR.rotation.set(-2.6 + 3.8 * k, 0.1 - 0.2 * k, -0.2);
          r.armL.rotation.set(-2.4 + 3.6 * k, -0.1 + 0.2 * k, 0.2);
          r.body.rotation.x = -0.3 + 0.5 * k;
          r.body.position.y += 0.25 * (1 - k);
        }
      }
      r.body.position.y += Math.sin(p * Math.PI) * 0.12;
    } else if (kind === 'shoot') {
      // Firearm shooting recoil and stance
      const rec = Math.sin(p * Math.PI);
      r.armR.rotation.set(-Math.PI / 2 + 0.3 * rec, 0.1, 0);
      r.armL.rotation.set(-Math.PI / 2.3 + 0.2 * rec, 0.4, 0.1);
      r.body.rotation.y = -0.1 * rec;
    } else if (kind === 'spin') {
      // Bō Whirlwind Staff 360 Spin
      r.body.rotation.y = p * Math.PI * 2;
      r.armR.rotation.set(-1.4, 0, 1.2);
      r.armL.rotation.set(-1.4, 0, -1.2);
      r.body.position.y += Math.sin(p * Math.PI) * 0.15;
    } else if (kind === 'chain') {
      // Kusarigama Chain Strike
      if (p < 0.3) {
        r.armR.rotation.set(-2.0 * (p / 0.3), 0.3, 0.4);
      } else {
        const k = (p - 0.3) / 0.7;
        r.armR.rotation.set(-2.0 + 3.1 * k, -0.4 * k, -0.2 * k);
      }
      r.armL.rotation.set(0.3, 0.3, -0.3);
    } else if (kind === 'throw') {
      // Shuriken / Kunai / Bomb Throw
      if (p < 0.35) {
        const k = p / 0.35;
        r.armR.rotation.set(-1.9 * k, 0.2 * k, 0.6 * k);
        r.body.rotation.y = 0.25 * k;
      } else {
        const k = (p - 0.35) / 0.65;
        r.armR.rotation.set(-1.9 + 3.0 * k, 0.2 - 0.5 * k, 0.6 - 0.8 * k);
        r.body.rotation.y = 0.25 - 0.5 * k;
      }
      r.armL.rotation.set(0.3, 0.2, -0.3);
    } else if (kind === 'punchR') {
      // Karate Right Straight Punch
      const punchK = Math.sin(p * Math.PI);
      r.armR.rotation.set(-Math.PI / 2 * punchK, -0.25 * punchK, 0);
      r.armL.rotation.set(0.2, 0.1, -0.2);
      r.body.rotation.y = -0.35 * punchK;
    } else if (kind === 'punchL') {
      // Karate Left Reverse Punch
      const punchK = Math.sin(p * Math.PI);
      r.armL.rotation.set(-Math.PI / 2 * punchK, 0.25 * punchK, 0);
      r.armR.rotation.set(0.2, -0.1, 0.2);
      r.body.rotation.y = 0.35 * punchK;
    } else if (kind === 'frontKick') {
      // Karate Front Snap Kick
      const kickK = Math.sin(p * Math.PI);
      r.legR.rotation.x = -1.65 * kickK;
      r.legR.position.y = r.legBaseY + 0.28 * kickK;
      r.body.rotation.x = -0.28 * kickK;
      r.armR.rotation.set(0.4 * kickK, 0, 0.4 * kickK);
      r.armL.rotation.set(0.4 * kickK, 0, -0.4 * kickK);
    } else if (kind === 'roundKick') {
      // Karate Roundhouse Spin Kick
      r.body.rotation.y = p * Math.PI * 2;
      const kickK = Math.sin(p * Math.PI);
      r.legR.rotation.x = -1.2 * kickK;
      r.legR.rotation.z = 1.35 * kickK;
      r.armR.rotation.set(0.3, 0, 0.5);
      r.armL.rotation.set(0.3, 0, -0.5);
    }
  }
}

// ----------------------------------------------------
// WEAPONS 3D BUILDER - HIGH DETAIL & POLISH
// ----------------------------------------------------
export function makeWeapon(id: string): THREE.Group {
  const g = new THREE.Group();
  if (id === 'karate') return g;

  if (id === 'tracer') {
    const m = new THREE.Mesh(TRACER_GEO, TRACER_MAT);
    m.scale.z = 1.6;
    g.add(m);
    return g;
  }

  if (id === 'spit') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8fff3a }));
    g.add(m);
    return g;
  }

  if (id === 'club') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.5, 10), MAT.gunmetal);
    m.position.z = 0.6;
    g.add(m);
    const n = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), MAT.dark);
    n.position.z = 1.3;
    g.add(n);
    return g;
  }

  if (id === 'wave') {
    const m = new THREE.Mesh(WAVE_GEO, WAVE_MAT);
    g.add(m);
    return g;
  }

  const addM = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rot?: [number, number, number]) => {
    const me = mesh(geo, m);
    me.position.set(x, y, z);
    if (rot) me.rotation.set(rot[0], rot[1], rot[2]);
    g.add(me);
    return me;
  };

  switch (id) {
    // ------------------------------------------------
    // KATANA: MASTERWORK JAPONESA COM HAMON E TSUBA DE OURO
    // ------------------------------------------------
    case 'katana': {
      // Blade: Polished Steel with curve
      addM(new THREE.BoxGeometry(0.032, 0.088, 1.2), MAT.metal, 0, 0, 0.72);
      // Hamon cutting edge highlight
      addM(new THREE.BoxGeometry(0.012, 0.02, 1.18), MAT.chrome, 0, 0.045, 0.72);
      // Sharp Tanto Blade Tip
      addM(new THREE.ConeGeometry(0.055, 0.18, 6).rotateX(Math.PI / 2), MAT.metal, 0, 0.01, 1.39);

      // Golden Habaki (Blade Collar)
      addM(new THREE.BoxGeometry(0.042, 0.098, 0.08), MAT.gold, 0, 0, 0.14);

      // Ornate Gold & Black Tsuba (Crossguard)
      addM(new THREE.CylinderGeometry(0.12, 0.12, 0.025, 16).rotateZ(Math.PI / 2), MAT.dark, 0, 0, 0.09);
      addM(new THREE.TorusGeometry(0.12, 0.015, 6, 16).rotateY(Math.PI / 2), MAT.gold, 0, 0, 0.09);

      // Braided Tsuka Handle (Black ray-skin with gold accents)
      addM(new THREE.BoxGeometry(0.052, 0.056, 0.32), MAT.dark, 0, 0, -0.08);
      addM(new THREE.BoxGeometry(0.056, 0.06, 0.04), MAT.gold, 0, 0, -0.04);
      addM(new THREE.BoxGeometry(0.056, 0.06, 0.04), MAT.gold, 0, 0, -0.14);

      // Golden Kashira Pommel Butt-cap
      addM(new THREE.BoxGeometry(0.065, 0.065, 0.05), MAT.gold, 0, 0, -0.25);
      break;
    }

    // ------------------------------------------------
    // BŌ: BASTÃO DE FERRO E MADEIRA SAGRADA
    // ------------------------------------------------
    case 'bo': {
      // Main dark ironwood shaft
      addM(new THREE.CylinderGeometry(0.042, 0.042, 2.7, 12).rotateX(Math.PI / 2), MAT.woodDark, 0, 0, 0.25);
      // Gold capped tips on both ends
      addM(new THREE.CylinderGeometry(0.052, 0.052, 0.22, 12).rotateX(Math.PI / 2), MAT.gold, 0, 0, 1.5);
      addM(new THREE.CylinderGeometry(0.052, 0.052, 0.22, 12).rotateX(Math.PI / 2), MAT.gold, 0, 0, -1.0);
      // Center grip wrap rings
      [-0.12, 0, 0.12].forEach((pz) => {
        addM(new THREE.TorusGeometry(0.046, 0.008, 6, 12).rotateY(Math.PI / 2), MAT.gold, 0, 0, 0.25 + pz);
      });
      break;
    }

    // ------------------------------------------------
    // KUSARIGAMA: FOICE NINJA COM CORRENTE
    // ------------------------------------------------
    case 'kama': {
      // Hardwood handle with gold rings
      addM(new THREE.CylinderGeometry(0.034, 0.034, 0.58, 10).rotateX(Math.PI / 2), MAT.wood, 0, 0, 0.2);
      addM(new THREE.CylinderGeometry(0.042, 0.042, 0.06, 10).rotateX(Math.PI / 2), MAT.gold, 0, 0, 0.46);
      addM(new THREE.CylinderGeometry(0.042, 0.042, 0.06, 10).rotateX(Math.PI / 2), MAT.gold, 0, 0, -0.06);

      // Curved steel sickle blade with razor edge
      addM(new THREE.BoxGeometry(0.026, 0.38, 0.08), MAT.metal, 0, 0.18, 0.48);
      addM(new THREE.ConeGeometry(0.05, 0.16, 4).rotateZ(-Math.PI / 2), MAT.metal, 0, 0.37, 0.48);

      // Steel chain link loop at bottom
      addM(new THREE.TorusGeometry(0.05, 0.014, 6, 12), MAT.metal, 0, 0, -0.11);
      break;
    }

    // ------------------------------------------------
    // SHURIKEN: ESTRELA NINJA DE 4 PONTAS
    // ------------------------------------------------
    case 'shuriken': {
      // Polished metal cross blades
      const b1 = addM(WG.star, MAT.metal, 0, 0, 0);
      const b2 = addM(WG.star, MAT.metal, 0, 0, 0);
      b2.rotation.y = Math.PI / 4;
      // Center ring opening with gold collar
      addM(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), MAT.gold, 0, 0, 0);
      break;
    }

    // ------------------------------------------------
    // KUNAI: ADAGA DE ARREMESSO
    // ------------------------------------------------
    case 'kunai': {
      // Diamond steel blade
      addM(WG.kunai, MAT.metal, 0, 0, 0.32);
      // Cord-wrapped handle
      addM(WG.kGrip, MAT.dark, 0, 0, 0);
      // Pommel ring
      addM(WG.ring, MAT.metal, 0, 0, -0.16);
      break;
    }

    // ------------------------------------------------
    // BOMBA: GRANADA NINJA COM PAVIO EM CHAMAS
    // ------------------------------------------------
    case 'bomb': {
      // Cast iron sphere with fragmentation bands
      addM(new THREE.SphereGeometry(0.18, 14, 12), MAT.dark, 0, 0, 0.05);
      addM(new THREE.TorusGeometry(0.182, 0.015, 6, 16), MAT.metal, 0, 0, 0.05);
      // Brass fuse cap
      addM(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 10), MAT.gold, 0, 0.2, 0.05);
      // Rope fuse
      addM(WG.fuse, MAT.bone, 0, 0.26, 0.05);
      // Burning Sparkle on fuse
      addM(new THREE.SphereGeometry(0.035, 8, 8), MAT.glow, 0, 0.33, 0.05);
      break;
    }

    // ------------------------------------------------
    // FLECHA (ARQUEIRO)
    // ------------------------------------------------
    case 'arrow': {
      addM(WG.shaft, MAT.wood, 0, 0, 0);
      addM(WG.tip, MAT.metal, 0, 0, 0.5);
      // Fletching feathers
      addM(new THREE.BoxGeometry(0.005, 0.06, 0.14), MAT.arrowFeather, 0, 0, -0.42);
      addM(new THREE.BoxGeometry(0.06, 0.005, 0.14), MAT.arrowFeather, 0, 0, -0.42);
      break;
    }

    // ------------------------------------------------
    // ARCO YUMI (ARQUEIRO)
    // ------------------------------------------------
    case 'bow': {
      const bw = addM(WG.bow, MAT.wood, 0, 0, 0.05);
      bw.rotation.set(0, Math.PI / 2, Math.PI / 2);
      // Bow grip wrapping
      addM(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 8), MAT.gold, 0, 0, 0.05);
      break;
    }

    // ------------------------------------------------
    // KANABO (CLAVA DE FERRO COM ESPINHOS DO ONI)
    // ------------------------------------------------
    case 'kanabo': {
      // Heavy iron octagonal club
      addM(new THREE.CylinderGeometry(0.08, 0.16, 1.8, 10).rotateX(Math.PI / 2), MAT.dark, 0, 0, 0.75);
      // Handle wrap
      addM(new THREE.CylinderGeometry(0.055, 0.055, 0.4, 10).rotateX(Math.PI / 2), MAT.wood, 0, 0, -0.2);
      // Gold pommel
      addM(new THREE.SphereGeometry(0.08, 10, 8), MAT.gold, 0, 0, -0.42);
      // 3D Pyramidal Steel Spikes bristling along the club
      const spikeGeo = new THREE.ConeGeometry(0.04, 0.12, 5).rotateZ(-Math.PI / 2);
      for (let s = 0; s < 6; s++) {
        const zOff = 0.4 + s * 0.22;
        [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].forEach((rot) => {
          const spk = addM(spikeGeo, MAT.metal, 0, 0, zOff);
          spk.rotation.z = rot;
        });
      }
      break;
    }

    // ================================================
    // ARMAS DE FOGO & MILITARES DO BRAVO
    // ================================================

    // ------------------------------------------------
    // FACA TÁTICA COMBAT TANTO
    // ------------------------------------------------
    case 'knife': {
      addM(GUN_G.knifeBlade, MAT.metal, 0, 0.03, 0.4);
      // Sawback serration spine
      addM(new THREE.BoxGeometry(0.015, 0.02, 0.25), MAT.gunmetal, 0, 0.065, 0.3);
      addM(GUN_G.knifeGuard, MAT.gunmetal, 0, 0, 0.22);
      addM(GUN_G.knifeGrip, MAT.dark, 0, 0, 0.36);
      break;
    }

    // ------------------------------------------------
    // PISTOLA TÁTICA (DOIS TONS COM LASER VERDE)
    // ------------------------------------------------
    case 'pistol': {
      // Brushed Stainless Steel Slide
      addM(GUN_G.pistolSlide, MAT.metal, 0, 0.02, 0.14);
      // Front slide serrations
      addM(new THREE.BoxGeometry(0.087, 0.08, 0.08), MAT.gunmetal, 0, 0.07, 0.22);
      // Polymer lower receiver & grip
      addM(GUN_G.pistolFrame, MAT.dark, 0, 0.02, 0.14);
      addM(GUN_G.pistolGrip, MAT.dark, 0, 0.02, 0.14);
      addM(GUN_G.pistolTrigger, MAT.gunmetal);
      addM(GUN_G.pistolSight, MAT.gunmetal);
      // Under-barrel tactical laser module with glowing green diode
      addM(new THREE.BoxGeometry(0.05, 0.04, 0.14), MAT.gunmetal, 0, -0.03, 0.24);
      addM(new THREE.SphereGeometry(0.014, 6, 6), MAT.laser, 0, -0.03, 0.32);
      break;
    }

    // ------------------------------------------------
    // ESPINGARDA TÁTICA (SHOTGUN COM HEAT SHIELD)
    // ------------------------------------------------
    case 'shotgun': {
      // Dual Barrel & Magazine Tube
      addM(GUN_G.shotBarrel, MAT.gunmetal, 0, 0, 0.05);
      addM(new THREE.CylinderGeometry(0.032, 0.032, 0.72, 10).rotateX(Math.PI / 2), MAT.dark, 0, -0.045, 0.35);
      // Ventilated top heat shield rib
      addM(new THREE.BoxGeometry(0.03, 0.02, 0.7), MAT.metal, 0, 0.075, 0.35);
      // Ribbed pump forend grip
      addM(GUN_G.shotPump, MAT.dark, 0, 0, 0.05);
      // Polished walnut stock
      addM(GUN_G.shotStock, MAT.wood, 0, 0, 0.05);
      addM(GUN_G.shotTrigger, MAT.gunmetal);
      break;
    }

    // ------------------------------------------------
    // FUZIL DE ASSALTO TÁTICO COM RED-DOT HOLOGRÁFICO
    // ------------------------------------------------
    case 'rifle': {
      // Main receiver & quad-rail handguard
      addM(GUN_G.rifleBody, MAT.dark, 0, 0, 0.15);
      addM(GUN_G.rifleBarrel, MAT.gunmetal, 0, 0, 0.15);
      // Birdcage flash hider / muzzle brake
      addM(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8).rotateX(Math.PI / 2), MAT.metal, 0, 0.01, 0.76);
      // Curved 30-round magazine
      addM(GUN_G.rifleMag, MAT.gunmetal, 0, 0, 0.15);
      addM(GUN_G.rifleStock, MAT.dark, 0, 0, 0.15);
      addM(GUN_G.rifleGrip, MAT.dark, 0, 0, 0.15);
      addM(GUN_G.rifleTrigger, MAT.metal);

      // Holographic Sight (EOTech style) with glowing red reticle
      addM(new THREE.BoxGeometry(0.07, 0.09, 0.16), MAT.dark, 0, 0.12, 0.12);
      addM(new THREE.BoxGeometry(0.05, 0.06, 0.01), MAT.redDot, 0, 0.13, 0.18);
      break;
    }

    // ------------------------------------------------
    // LANÇA-CHAMAS COM TANQUES E CHAMA PILOTO
    // ------------------------------------------------
    case 'flame': {
      // Dual high pressure tanks with yellow hazard stripe
      addM(GUN_G.flameTank, MAT.torii, 0, 0, 0.1);
      addM(new THREE.CylinderGeometry(0.112, 0.112, 0.06, 12).rotateZ(Math.PI / 2), MAT.hazard, -0.15, -0.05, -0.05);
      // Pressure gauge dial
      addM(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 10).rotateX(Math.PI / 2), MAT.chrome, -0.15, 0.08, -0.15);
      // Shrouded flame nozzle
      addM(GUN_G.flameNozzle, MAT.gunmetal, 0, 0, 0.25);
      addM(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10).rotateX(Math.PI / 2), MAT.dark, 0, 0, 0.45);
      addM(GUN_G.flameGrip, MAT.dark, 0, 0, 0.25);
      // Brass pilot ignition flame
      addM(new THREE.ConeGeometry(0.025, 0.08, 6).rotateX(Math.PI / 2), MAT.glow, 0, -0.04, 0.58);
      break;
    }

    // ------------------------------------------------
    // METRALHADORA GIRATÓRIA (MINIGUN)
    // ------------------------------------------------
    case 'minigun': {
      addM(GUN_G.miniBody, MAT.dark, 0, 0, 0.1);
      addM(GUN_G.miniDrum, MAT.gunmetal, 0, 0, 0.1);

      // 6 Rotating Steel Barrels held by circular bracket rings
      const barrelRadius = 0.065;
      for (let b = 0; b < 6; b++) {
        const ang = (b / 6) * TAU;
        const bx = Math.sin(ang) * barrelRadius;
        const by = Math.cos(ang) * barrelRadius;
        addM(GUN_G.miniBarrel, MAT.metal, bx, by, 0.42);
      }
      // Support bracket rings
      addM(new THREE.TorusGeometry(0.085, 0.015, 8, 16).rotateY(Math.PI / 2), MAT.dark, 0, 0, 0.45);
      addM(new THREE.TorusGeometry(0.085, 0.015, 8, 16).rotateY(Math.PI / 2), MAT.dark, 0, 0, 0.72);

      // Heavy Muzzle Crown
      addM(GUN_G.miniMuzzle, MAT.gunmetal, 0, 0, 0.1);
      break;
    }

    // ------------------------------------------------
    // LANÇADOR DE FOGUETES M45 (BAZOOKA)
    // ------------------------------------------------
    case 'bazooka': {
      // Heavy Olive Drab / Camo Tube
      addM(GUN_G.bazookaTube, MAT.camo, 0, 0, 0.3);
      // Warning Hazard Stripes on tube
      addM(new THREE.TorusGeometry(0.114, 0.02, 8, 16), MAT.hazard, 0, 0, 0.5);
      addM(GUN_G.bazookaRim, MAT.dark, 0, 0, 0.1);
      addM(GUN_G.bazookaGrip, MAT.dark, 0, 0, 0.1);

      // Targeting scope with rubber eyecup
      addM(GUN_G.bazookaSight, MAT.dark, 0, 0, 0.1);
      addM(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 10).rotateX(Math.PI / 2), MAT.gunmetal, -0.14, 0.14, 0.35);

      // Protruding Rocket Warhead Tip in muzzle
      addM(new THREE.ConeGeometry(0.09, 0.24, 8).rotateX(Math.PI / 2), MAT.crimson, 0, 0, 1.05);
      break;
    }
  }

  return g;
}
