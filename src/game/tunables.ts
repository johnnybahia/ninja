// Live-tunable movement-feel constants, pulled out of engine.ts/animation.ts so the
// debug tuning panel (see TunePanel.tsx) can edit them while the game is running,
// instead of every "does this feel better?" iteration needing a code change + redeploy.
// Everything else in the game (weapon poses, combat numbers, enemy AI, ...) stays as
// plain inline constants - only the handful of values that shape how the character
// moves, turns and the camera follows are centralized here.

export interface Tunable {
  key: keyof typeof TUNE;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const TUNE = {
  turnSpeedIdle: 26,
  turnSpeedAttacking: 14,
  camSteerSpeed: 2.6,
  camFollowSpeed: 0.6,
  moveMaxSpeed: 7.6,
  accelToward: 12,
  accelDecay: 9,
  dashSpeed: 23,
  attackSpeed: 1,
  hitAssist: 0.6,
  hitDebug: 0,
  // enemy resistance (ritmo da luta): how often a samurai blocks, parries or sidesteps a blow
  // that connects, how tough enemies are, and how dangerous arrows are
  enemyBlock: 1,
  enemyParry: 0.1,
  enemyDodge: 0.08,
  enemyHp: 2,
  enemyHpScale: 0.2,
  enemyPosture: 1.5,
  blockPosture: 0.7,
  arrowDmg: 11,
  arrowLead: 0.5,
  camLeadAmount: 0.12,
  legSwingBase: 0.55,
  legSwingRun: 0.38,
  kneeSwingBase: 0.55,
  kneeSwingRun: 0.75,
  armSwingBase: 0.45,
  armSwingRun: 0.4
};

export const TUNE_DEFAULTS: typeof TUNE = { ...TUNE };

// Order here is display order in the panel.
export const TUNABLES: Tunable[] = [
  { key: 'turnSpeedIdle', label: 'Giro do personagem (parado)', min: 4, max: 40, step: 0.5 },
  { key: 'turnSpeedAttacking', label: 'Giro do personagem (atacando)', min: 2, max: 30, step: 0.5 },
  { key: 'camSteerSpeed', label: 'Câmera: velocidade ao girar com o direcional', min: 0.5, max: 8, step: 0.1 },
  { key: 'camFollowSpeed', label: 'Câmera: velocidade ao se ajustar atrás', min: 0.1, max: 2, step: 0.05 },
  { key: 'camLeadAmount', label: 'Câmera: quanto olha à frente do movimento', min: 0, max: 0.4, step: 0.01 },
  { key: 'moveMaxSpeed', label: 'Velocidade máxima de corrida', min: 3, max: 14, step: 0.2 },
  { key: 'accelToward', label: 'Aceleração ao mover o direcional', min: 3, max: 30, step: 0.5 },
  { key: 'accelDecay', label: 'Freio ao soltar o direcional', min: 3, max: 30, step: 0.5 },
  { key: 'dashSpeed', label: 'Velocidade da esquiva/dash', min: 8, max: 40, step: 1 },
  { key: 'attackSpeed', label: 'Velocidade dos golpes (Rōnin)', min: 0.6, max: 2, step: 0.05 },
  { key: 'hitAssist', label: 'Folga do acerto (0 = realista, 1 = generoso)', min: 0, max: 1, step: 0.05 },
  { key: 'hitDebug', label: 'Mostrar caixas de acerto (0/1)', min: 0, max: 1, step: 1 },
  { key: 'enemyBlock', label: 'Inimigo: chance de bloquear (×)', min: 0, max: 2, step: 0.05 },
  { key: 'enemyParry', label: 'Inimigo: chance de aparar (quica o golpe)', min: 0, max: 0.4, step: 0.01 },
  { key: 'enemyDodge', label: 'Inimigo: chance de esquivar', min: 0, max: 0.4, step: 0.01 },
  { key: 'enemyHp', label: 'Inimigo: vida (×)', min: 0.5, max: 3, step: 0.05 },
  { key: 'enemyPosture', label: 'Inimigo: postura máxima (×, maior = mais difícil quebrar)', min: 0.5, max: 3, step: 0.05 },
  { key: 'blockPosture', label: 'Postura ganha ao bloquear (×)', min: 0.3, max: 2, step: 0.05 },
  { key: 'enemyHpScale', label: 'Inimigo: vida extra por onda', min: 0, max: 0.4, step: 0.01 },
  { key: 'arrowDmg', label: 'Flecha: dano', min: 2, max: 30, step: 1 },
  { key: 'arrowLead', label: 'Flecha: tiros que antecipam seu movimento', min: 0, max: 1, step: 0.05 },
  { key: 'legSwingBase', label: 'Balanço da perna (andando)', min: 0.1, max: 1.2, step: 0.02 },
  { key: 'legSwingRun', label: 'Balanço extra da perna (correndo)', min: 0, max: 1.2, step: 0.02 },
  { key: 'kneeSwingBase', label: 'Flexão do joelho (andando)', min: 0.1, max: 1.2, step: 0.02 },
  { key: 'kneeSwingRun', label: 'Flexão extra do joelho (correndo)', min: 0, max: 1.5, step: 0.02 },
  { key: 'armSwingBase', label: 'Balanço do braço (andando)', min: 0.1, max: 1.0, step: 0.02 },
  { key: 'armSwingRun', label: 'Balanço extra do braço (correndo)', min: 0, max: 1.0, step: 0.02 }
];

const STORAGE_KEY = 'kage-tune-v1';

export function loadTune() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<typeof TUNE>;
    for (const k of Object.keys(TUNE) as (keyof typeof TUNE)[]) {
      if (typeof saved[k] === 'number') TUNE[k] = saved[k] as number;
    }
  } catch {
    // corrupt/blocked storage - just keep the defaults
  }
}

export function saveTune() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(TUNE));
  } catch {
    // private mode / storage blocked - tuning still works for this session, just won't persist
  }
}

export function resetTune() {
  Object.assign(TUNE, TUNE_DEFAULTS);
  saveTune();
}
