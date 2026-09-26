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
