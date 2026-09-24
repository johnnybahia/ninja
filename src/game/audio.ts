let AC: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let lastHitSfx = 0;

export function initAudio() {
  if (AC) {
    if (AC.state === 'suspended') AC.resume();
    return;
  }
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    AC = new AudioCtx();
    master = AC.createGain();
    master.gain.value = 0.45;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    AC = null;
  }
}

function tone(f1: number, f2: number, dur: number, type: OscillatorType = 'sine', vol = 0.25) {
  if (!AC || !master) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(dur: number, vol: number, freq: number, ftype: BiquadFilterType = 'bandpass') {
  if (!AC || !master || !noiseBuf) return;
  const t = AC.currentTime;
  const s = AC.createBufferSource();
  const f = AC.createBiquadFilter();
  const g = AC.createGain();
  s.buffer = noiseBuf;
  f.type = ftype;
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.03);
}

export const sfx = {
  swing: () => noise(0.13, 0.35, 2600),
  heavy: () => {
    noise(0.22, 0.4, 900);
    tone(160, 70, 0.2, 'triangle', 0.15);
  },
  hit: () => {
    const n = performance.now();
    if (n - lastHitSfx < 40) return;
    lastHitSfx = n;
    tone(190, 55, 0.12, 'square', 0.12);
    noise(0.08, 0.3, 1400);
  },
  sliceHit: () => {
    const n = performance.now();
    if (n - lastHitSfx < 40) return;
    lastHitSfx = n;
    tone(280, 75, 0.14, 'sawtooth', 0.18);
    noise(0.11, 0.42, 2200, 'bandpass');
  },
  comboSlice: () => {
    tone(360, 90, 0.2, 'sawtooth', 0.25);
    tone(120, 50, 0.25, 'triangle', 0.2);
    noise(0.18, 0.5, 1700, 'bandpass');
  },
  throw: () => tone(1100, 420, 0.09, 'triangle', 0.12),
  boom: () => {
    noise(0.7, 0.6, 500, 'lowpass');
    tone(90, 28, 0.6, 'sine', 0.45);
  },
  hurt: () => tone(260, 110, 0.25, 'sawtooth', 0.15),
  jump: () => tone(300, 620, 0.12, 'sine', 0.1),
  dash: () => noise(0.18, 0.3, 3500, 'highpass'),
  pick: () => {
    tone(620, 1240, 0.18, 'sine', 0.16);
  },
  special: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f, 0.22, 'triangle', 0.14), i * 70));
  },
  levelup: () => {
    [392, 494, 587, 784].forEach((f, i) => setTimeout(() => tone(f, f, 0.3, 'sine', 0.15), i * 90));
  },
  arrow: () => noise(0.1, 0.18, 4000, 'highpass'),
  wave: () => {
    tone(220, 220, 0.5, 'triangle', 0.14);
    setTimeout(() => tone(330, 330, 0.6, 'triangle', 0.12), 180);
  }
};
