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
  skinDemon: std(0xb33026, 0.62, 0.02),
  eyeCyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x36e2ff).multiplyScalar(2.5) }),
  eyeAmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb326).multiplyScalar(2.5) }),
  eyeDemon: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b1f).multiplyScalar(3) }),
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

export const WAVE_GEO = new THREE.RingGeometry(1.0, 1.7, 24, 1, -Math.PI / 2 - 1.1, 2.2)
  .rotateX(-Math.PI / 2)
  .translate(0, 0, -1.3);
export const WAVE_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0xffd166).multiplyScalar(2.2),
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

// ----------------------------------------------------
// PLAYER RIG BUILDER (KAGE) - ORIGINAL FACE
// ----------------------------------------------------
export function buildPlayerRig(_charId: 'kage' = 'kage'): RigInstance {

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

  {
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

  }

  return g;
}
