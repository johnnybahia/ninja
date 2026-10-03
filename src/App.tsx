import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from './game/engine';
import { CharacterId, WeaponDef } from './game/types';
import { WEAPONS_KAGE, WEAPON_INFO, KARATE, SPECIALS } from './game/constants';
import { ICON_URLS } from './game/icons';
import { initAudio } from './game/audio';
import type { Quality, QualitySetting } from './game/postfx';
import type { AtmosMode } from './game/atmosphere';
import type { ThemeMode } from './game/theme';
import { Settings, RotateCcw, Shield, Compass, Swords, ChevronLeft, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { TunePanel } from './TunePanel';
import { loadTune } from './game/tunables';
import { getLoadProgress, onLoadProgress } from './game/models';
import { bankRun, bonusesFor, buyUpgrade, loadMeta, metaPersistent, saveMeta, type MetaSave, type RunSummary } from './game/meta';
import { ensureDaily, localDate } from './game/missions';
import { Missions } from './ui/Missions';
import { PlayerName, type NameMode } from './ui/PlayerName';
import { Ranking } from './ui/Ranking';
import type { RunBoard } from './ui/RunSummary';
import { confirmedThisSession, confirmSession, fetchRanking, flushPending, loadPlayer, rankingEnabled, savePlayer, submitScore, type Player } from './game/ranking';
import type { CardOffer } from './game/cards';
import { CardPicker } from './ui/CardPicker';
import { Temple } from './ui/Temple';
import { RunSummary as RunSummaryScreen, type RunResult } from './ui/RunSummary';

const SLOT_COUNT = 2;
const SLOT_LABELS = ['Principal', 'Secundária'];
// Default pairs a close-range weapon with a ranged one: Katana + Shuriken.
const DEFAULT_SLOTS: Record<CharacterId, number[]> = { kage: [0, 3], samurai: [0, 3] };

const CHAR_NAME: Record<CharacterId, string> = { kage: 'Kage, o Shinobi', samurai: 'O Rōnin' };

// Loadout picked on the Arsenal screen, saved per character; falls back to the default
// pair if missing or invalid (e.g. an older 4-button save).
function loadSlots(id: CharacterId): number[] {
  const total = WEAPONS_KAGE.length;
  const fallback = DEFAULT_SLOTS[id];
  try {
    const raw = localStorage.getItem(`${id}_loadout`);
    if (!raw) return fallback;
    const arr: unknown = JSON.parse(raw);
    const valid =
      Array.isArray(arr) &&
      arr.length === SLOT_COUNT &&
      arr.every((v) => Number.isInteger(v) && v >= 0 && v < total) &&
      new Set(arr).size === SLOT_COUNT;
    return valid ? (arr as number[]) : fallback;
  } catch {
    return fallback;
  }
}

const fmtNum = (n: number, minFrac = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: minFrac, maximumFractionDigits: 2 });

// Base damage shown on the Arsenal card: range across combo hits, "×N" for multi-shot.
function dmgText(w: WeaponDef) {
  const d = w.kind === 'karate' ? KARATE.map((m) => m.dmg) : w.dmg;
  const lo = Math.min(...d);
  const hi = Math.max(...d);
  const base = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return w.count && w.count > 1 ? `${base}×${w.count}` : base;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // UI State
  const [gameState, setGameState] = useState<'menu' | 'arsenal' | 'play' | 'over'>('menu');
  const [charId, setCharId] = useState<CharacterId>('samurai');
  const [hp, setHp] = useState(60);
  const [maxHp, setMaxHp] = useState(60);
  const [stamina, setStamina] = useState(100);
  const [maxStamina, setMaxStamina] = useState(100);
  const [xp, setXp] = useState(0);
  const [xpNext, setXpNext] = useState(800);
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [banner, setBanner] = useState<{ main: string; sub: string } | null>(null);
  const [activeWeaponIdx, setActiveWeaponIdx] = useState(0);
  const [activeWeapon, setActiveWeapon] = useState<WeaponDef | null>(null);
  const [specials, setSpecials] = useState<Record<number, number>>({});
  const [posture, setPosture] = useState(0);
  const [heals, setHeals] = useState(3);
  const [dbReady, setDbReady] = useState(false);
  const [cinematic, setCinematic] = useState<false | 'full' | 'short'>(false);
  // progression: permanent Honra upgrades, the run's Honra, level-up cards, boss bar
  const [meta, setMeta] = useState<MetaSave>(() => ensureDaily(loadMeta(), localDate()));
  const metaRef = useRef(meta);
  const [persistOk, setPersistOk] = useState(() => metaPersistent());
  const [showTemple, setShowTemple] = useState(false);
  // global ranking: who is playing (saved on this browser), whether they confirmed it this
  // session, and the place the last run earned
  const rankOn = rankingEnabled();
  const [player, setPlayer] = useState<Player | null>(() => (rankOn ? loadPlayer() : null));
  const [rankActive, setRankActive] = useState(() => rankOn && !!loadPlayer() && confirmedThisSession());
  const [nameMode, setNameMode] = useState<NameMode | null>(() => (!rankOn ? null : loadPlayer() ? (confirmedThisSession() ? null : 'confirm') : 'new'));
  const [showRanking, setShowRanking] = useState(false);
  const [rankRefresh, setRankRefresh] = useState(0);
  const [runBoard, setRunBoard] = useState<RunBoard | null>(null);
  const rankActiveRef = useRef(rankActive);
  rankActiveRef.current = rankActive;
  useEffect(() => {
    // a score that couldn't be sent last time goes out now
    if (rankActive) void flushPending();
  }, [rankActive]);
  const finishName = (p: Player) => {
    savePlayer(p);
    confirmSession();
    setPlayer(p);
    setRankActive(true);
    setNameMode(null);
    void flushPending().then(() => setRankRefresh((n) => n + 1));
  };
  const [runHonor, setRunHonor] = useState(0);
  const [cardOffer, setCardOffer] = useState<CardOffer[] | null>(null);
  const [bossBar, setBossBar] = useState<{ hp: number; max: number; fury: boolean; name: string } | null>(null);
  const [waveMod, setWaveMod] = useState<{ id: string; name: string; glyph: string; desc: string } | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('kage_best_score') || 0);
    } catch {
      return 0;
    }
  });
  const bestScoreRef = useRef(bestScore);

  // Action buttons: SLOT_COUNT slots, each bound to a weapon picked on the Arsenal screen
  // before the run (locked during play). Pressing a slot selects its weapon and attacks
  // right away; holding keeps firing.
  const weaponList = WEAPONS_KAGE;
  const [loadouts, setLoadouts] = useState<Record<CharacterId, number[]>>(() => ({
    kage: loadSlots('kage'),
    samurai: loadSlots('samurai')
  }));
  const [startingGame, setStartingGame] = useState(false);
  // model download progress (0-100) for the start button's bar, and the black fade the
  // screen dips through when a run starts
  const [loadPct, setLoadPct] = useState(() => Math.round(getLoadProgress() * 100));
  const [fadeIn, setFadeIn] = useState(false);
  useEffect(() => onLoadProgress((f) => setLoadPct(Math.round(f * 100))), []);
  const slots = loadouts[charId];
  const slotsRef = useRef(slots);
  const heldSlotRef = useRef<number | null>(null);
  const [editSlot, setEditSlot] = useState(0);
  const [inspectIdx, setInspectIdx] = useState(slots[0]);

  useEffect(() => {
    slotsRef.current = slots;
    if (engineRef.current) engineRef.current.loadout = slots;
  }, [slots]);

  // Assigning a weapon that's already on the other slot swaps the two slots.
  const assignSlot = (slot: number, weaponIdx: number) => {
    const next = [...slots];
    const other = next.indexOf(weaponIdx);
    if (other !== -1 && other !== slot) next[other] = next[slot];
    next[slot] = weaponIdx;
    setLoadouts((prev) => ({ ...prev, [charId]: next }));
    try {
      localStorage.setItem(`${charId}_loadout`, JSON.stringify(next));
    } catch {}
  };

  const handleArsenalPick = (weaponIdx: number) => {
    setInspectIdx(weaponIdx);
    assignSlot(editSlot, weaponIdx);
    // Axelay-style cursor: after filling the primary, move on to the secondary slot
    if (editSlot < SLOT_COUNT - 1) setEditSlot(editSlot + 1);
    engineRef.current?.setWeapon(weaponIdx);
  };

  const openArsenal = (id: CharacterId) => {
    const eng = engineRef.current;
    if (eng) {
      if (eng.state !== 'menu') eng.backToMenu();
      // Runs in the background (the samurai means an async GLB load) while the Arsenal
      // screen opens right away below - setWeapon re-applies the saved loadout once the
      // character is actually ready, since setCharacter resets it to a default mid-swap.
      eng.setCharacter(id).then(() => eng.setWeapon(loadouts[id][0]));
    }
    setShowSettings(false);
    setEditSlot(0);
    setInspectIdx(loadouts[id][0]);
    setGameState('arsenal');
  };

  const handleSlotDown = (slot: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    initAudio();
    heldSlotRef.current = slot;
    eng.setWeapon(slots[slot]);
    eng.input.attackHeld = true;
    eng.pressAttack();
  };

  const handleSlotUp = (slot: number) => {
    if (heldSlotRef.current !== slot) return;
    heldSlotRef.current = null;
    if (engineRef.current) engineRef.current.input.attackHeld = false;
  };

  // Settings Modal
  const [showSettings, setShowSettings] = useState(false);

  // Movement-tuning panel: dev/QA only, opt-in via ?tune=1 - never shown to a regular
  // player who didn't ask for it.
  const [tuneEnabled] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('tune') === '1';
    } catch {
      return false;
    }
  });
  const [showTune, setShowTune] = useState(false);
  useEffect(() => {
    if (tuneEnabled) loadTune();
  }, [tuneEnabled]);
  const [qualitySetting, setQualitySetting] = useState<QualitySetting>(() => {
    try {
      const v = localStorage.getItem('kage_quality');
      return v === 'high' || v === 'medium' || v === 'low' ? v : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [effectiveQuality, setEffectiveQuality] = useState<Quality>('high');
  const qualityRef = useRef(qualitySetting);
  const [atmosMode, setAtmosMode] = useState<AtmosMode>(() => {
    try {
      const v = localStorage.getItem('kage_atmos');
      return v === 'every' || v === 'random' ? v : 'two';
    } catch {
      return 'two';
    }
  });
  const atmosRef = useRef(atmosMode);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('kage_theme') === 'off' ? 'off' : 'three';
    } catch {
      return 'three';
    }
  });
  const themeRef = useRef(themeMode);
  // how a run is played: waves in the middle of the arena, or Conquista (take the enemy posts)
  const [gameMode, setGameMode] = useState<'waves' | 'conquest'>(() => {
    try {
      if (new URLSearchParams(location.search).get('mode') === 'conquista') return 'conquest';
      return localStorage.getItem('kage_mode_v1') === 'conquest' ? 'conquest' : 'waves';
    } catch {
      return 'waves';
    }
  });
  const [runMode, setRunMode] = useState<'waves' | 'conquest'>('waves');
  const [sensitivity, setSensitivity] = useState(1.0);
  const [autoCamera, setAutoCamera] = useState(true);
  const [autoTurnStick, setAutoTurnStick] = useState(true);
  const [cineCam, setCineCam] = useState(() => {
    try {
      return localStorage.getItem('kage_cine') !== '0';
    } catch {
      return true;
    }
  });

  // Virtual Joystick visual state
  const [joyActive, setJoyActive] = useState(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });

  // Banner timer
  const bannerTimerRef = useRef<number | null>(null);
  const showBanner = useCallback((main: string, sub: string) => {
    setBanner({ main, sub });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = window.setTimeout(() => setBanner(null), 2000);
  }, []);

  // Banks a finished (or abandoned) run's Honra into the saved progress
  const bank = useCallback((summary: RunSummary, prevBest: number): RunResult => {
    const m0 = metaRef.current;
    // a practice run (?wave=N) shows its summary but saves nothing
    if (engineRef.current?.practice) return { summary, before: m0.honor, after: m0.honor, prevBest, prevBestWave: m0.bestWave, missions: [], streak: null };
    const out = bankRun(m0, summary, localDate());
    metaRef.current = out.meta;
    setMeta(out.meta);
    setPersistOk(saveMeta(out.meta));
    return { summary, before: m0.honor, after: out.meta.honor, prevBest, prevBestWave: m0.bestWave, missions: out.done, streak: out.streak };
  }, []);

  const buy = useCallback((id: string) => {
    const m1 = buyUpgrade(metaRef.current, id);
    if (!m1) return;
    metaRef.current = m1;
    setMeta(m1);
    setPersistOk(saveMeta(m1));
    if (engineRef.current) engineRef.current.metaBonus = bonusesFor(m1);
  }, []);

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // Initialize Game Engine
  useEffect(() => {
    if (!canvasRef.current || !minimapRef.current) return;

    const engine = new GameEngine(canvasRef.current, minimapRef.current, {
      onHpChange: (h, mh) => {
        setHp(h);
        setMaxHp(mh);
      },
      onStaminaChange: (st, mst) => {
        setStamina(st);
        setMaxStamina(mst);
      },
      onXpChange: (x, xn, lvl) => {
        setXp(x);
        setXpNext(xn);
        setLevel(lvl);
      },
      onScoreChange: (s) => setScore(s),
      onComboChange: (c) => setCombo(c),
      onWaveChange: (_w, text, sub) => showBanner(text, sub),
      onWeaponChange: (idx, w) => {
        setActiveWeaponIdx(idx);
        setActiveWeapon(w);
      },
      onSpecialsUpdate: (sp) => setSpecials(sp),
      onPostureChange: (p, max) => setPosture(max > 0 ? p / max : 0),
      onHealsChange: (n) => setHeals(n),
      onDeathblowReady: (r) => setDbReady(r),
      onCinematic: (on, kind) => setCinematic(on ? kind ?? 'full' : false),
      onQualityChange: (_setting, effective) => setEffectiveQuality(effective),
      onHonorChange: (h) => setRunHonor(h),
      onCardOffer: (offer) => setCardOffer(offer),
      onBossChange: (b) => setBossBar(b),
      onWaveMod: (m) => setWaveMod(m),
      onGameOver: (finalScore, wave, _level, _kills, _combo, summary) => {
        const prevBest = bestScoreRef.current;
        if (finalScore > prevBest && !engineRef.current?.practice) {
          bestScoreRef.current = finalScore;
          setBestScore(finalScore);
          try {
            localStorage.setItem('kage_best_score', String(finalScore));
          } catch {}
        }
        setRunResult(bank(summary, prevBest));
        setGameState('over');
        setRunBoard(null);
        if (rankActiveRef.current && !engineRef.current?.practice && engineRef.current?.mode === 'waves') {
          // best-effort and off the game's path: the table shows "atualizando" until it arrives
          const before = loadPlayer();
          const base = { score: finalScore, wave, isBest: finalScore > (before?.sent ?? 0), name: before?.name ?? '' };
          setRunBoard({ ...base, state: 'sending', data: null, pending: false });
          void submitScore(finalScore, wave)
            .then(() => fetchRanking(loadPlayer()?.id))
            .then((d) => {
              const pending = !!loadPlayer()?.pending;
              setRunBoard({ ...base, state: d && !d.stale ? 'ready' : 'offline', data: d, pending });
              setRankRefresh((n) => n + 1);
            });
        }
      }
    });

    engineRef.current = engine;
    // Dev-only handle for automated visual checks; stripped from production builds
    if (import.meta.env.DEV) (window as any).__engine = engine;
    engine.loadout = slotsRef.current;
    engine.metaBonus = bonusesFor(metaRef.current);
    engine.setQuality(qualityRef.current);
    engine.atmosMode = atmosRef.current;
    engine.themeMode = themeRef.current;
    setActiveWeapon(engine.weapons[0]);

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.destroy();
    };
  }, [showBanner, bank]);

  // Freeze the game while a menu is open so enemies can't hit you mid-configuration
  useEffect(() => {
    if (engineRef.current) engineRef.current.paused = showSettings;
    if (showSettings) {
      heldSlotRef.current = null;
      if (engineRef.current) engineRef.current.input.attackHeld = false;
    }
  }, [showSettings]);

  // Update Settings in Engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.settings.cameraSensitivity = sensitivity;
      engineRef.current.settings.autoCamera = autoCamera;
      engineRef.current.settings.autoTurnWithStick = autoTurnStick;
      engineRef.current.settings.cinematicCamera = cineCam;
    }
    try {
      localStorage.setItem('kage_cine', cineCam ? '1' : '0');
    } catch {}
  }, [sensitivity, autoCamera, autoTurnStick, cineCam]);

  const handleStartGame = async () => {
    initAudio();
    const eng = engineRef.current;
    if (eng) {
      // Almost always already resolved by the time the player reaches this button (the
      // load kicked off in the background back on the character-select screen) - this
      // await only matters if they raced through on a slow connection, so the game never
      // starts with a not-yet-ready rig.
      setStartingGame(true);
      setFadeIn(true);
      await eng.setCharacter(charId);
      setStartingGame(false);
      if (charId === 'samurai' && eng.charId !== 'samurai') {
        showBanner('Não foi possível carregar o Rōnin', 'Jogando com o Kage');
      }
      eng.loadout = slots;
      eng.metaBonus = bonusesFor(metaRef.current);
      eng.mode = gameMode;
      setRunMode(gameMode);
      setRunResult(null);
      setCardOffer(null);
      setBossBar(null);
      setWaveMod(null);
      setRunHonor(0);
      eng.start();
      // let the first frame of the run render behind the black, then fade it away
      requestAnimationFrame(() => requestAnimationFrame(() => setFadeIn(false)));
    }
    setGameState('play');
  };

  const handleCharSelect = (id: CharacterId) => {
    setCharId(id);
    initAudio();
    openArsenal(id);
  };

  const handleBackToMenu = () => {
    if (engineRef.current) {
      // an abandoned run still pays its Honra out
      const left = engineRef.current.takeRunSummary();
      if (left && left.honor.total > 0) {
        bank(left, bestScoreRef.current);
        showToast(`+${left.honor.total} 誉 guardados`);
      }
      engineRef.current.backToMenu();
    }
    setCardOffer(null);
    setBossBar(null);
    setWaveMod(null);
    setShowSettings(false);
    setGameState('menu');
  };

  const handleRecenterCamera = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (engineRef.current) {
      engineRef.current.recenterCamera();
    }
  };

  // Touch handlers for Canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gameState !== 'play' || !engineRef.current) return;
    initAudio();

    if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        engineRef.current.input.attackHeld = true;
        engineRef.current.pressAttack();
      } else if (e.button === 2) {
        engineRef.current.guardDown();
      }
      return;
    }

    // Touch controls: Left half = Virtual Joystick, Right half = Camera Look
    if (e.clientX < window.innerWidth * 0.48 && engineRef.current.joyTouch.id === null) {
      engineRef.current.joyTouch.id = e.pointerId;
      engineRef.current.joyTouch.ox = e.clientX;
      engineRef.current.joyTouch.oy = e.clientY;
      setJoyPos({ x: e.clientX, y: e.clientY });
      setKnobPos({ x: 0, y: 0 });
      setJoyActive(true);
    } else if (engineRef.current.lookTouch.id === null) {
      engineRef.current.lookTouch.id = e.pointerId;
      engineRef.current.lookTouch.lx = e.clientX;
      engineRef.current.lookTouch.ly = e.clientY;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engineRef.current || gameState !== 'play') return;

    if (e.pointerType === 'mouse') {
      const dx = e.movementX;
      const dy = e.movementY;
      engineRef.current.camYaw -= dx * 0.0028 * sensitivity;
      engineRef.current.camPitch = Math.max(0.08, Math.min(1.2, engineRef.current.camPitch + dy * 0.002 * sensitivity));
      return;
    }

    if (e.pointerId === engineRef.current.joyTouch.id) {
      let dx = e.clientX - engineRef.current.joyTouch.ox;
      let dy = e.clientY - engineRef.current.joyTouch.oy;
      const d = Math.hypot(dx, dy);
      const maxRadius = 55;
      if (d > maxRadius) {
        dx = (dx / d) * maxRadius;
        dy = (dy / d) * maxRadius;
      }
      engineRef.current.input.jx = dx / maxRadius;
      engineRef.current.input.jy = dy / maxRadius;
      setKnobPos({ x: dx, y: dy });
    } else if (e.pointerId === engineRef.current.lookTouch.id) {
      const dx = e.clientX - engineRef.current.lookTouch.lx;
      const dy = e.clientY - engineRef.current.lookTouch.ly;
      engineRef.current.lookTouch.lx = e.clientX;
      engineRef.current.lookTouch.ly = e.clientY;
      engineRef.current.camYaw -= dx * 0.0075 * sensitivity;
      engineRef.current.camPitch = Math.max(
        0.08,
        Math.min(1.2, engineRef.current.camPitch + dy * 0.005 * sensitivity)
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engineRef.current) return;
    if (e.pointerId === engineRef.current.joyTouch.id) {
      engineRef.current.joyTouch.id = null;
      engineRef.current.input.jx = 0;
      engineRef.current.input.jy = 0;
      setJoyActive(false);
    }
    if (e.pointerId === engineRef.current.lookTouch.id) {
      engineRef.current.lookTouch.id = null;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 2) engineRef.current.guardUp();
      else engineRef.current.input.attackHeld = false;
    }
  };

  // Keyboard controls
  // opening the menu on a new day rolls the missions over
  useEffect(() => {
    if (gameState !== 'menu') return;
    const m2 = ensureDaily(metaRef.current, localDate());
    if (m2 !== metaRef.current) {
      metaRef.current = m2;
      setMeta(m2);
      setPersistOk(saveMeta(m2));
    }
  }, [gameState]);

  const cardOfferRef = useRef<CardOffer[] | null>(null);
  useEffect(() => {
    cardOfferRef.current = cardOffer;
    if (!cardOffer) return;
    // whatever was held when the cards opened must not stay held underneath them
    const eng = engineRef.current;
    if (eng) {
      eng.joyTouch.id = null;
      eng.lookTouch.id = null;
      eng.input.jx = 0;
      eng.input.jy = 0;
      for (const k of Object.keys(eng.input.keys)) eng.input.keys[k] = false;
    }
    setJoyActive(false);
    heldSlotRef.current = null;
  }, [cardOffer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!engineRef.current || gameState !== 'play' || cardOfferRef.current) return;
      engineRef.current.input.keys[e.code] = true;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) engineRef.current.jump();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        engineRef.current.dash();
      }
      // Desktop: 1/2 pick the weapon on that action button, Q/E swap between the buttons
      const loadout = slotsRef.current;
      if (/^Digit[1-2]$/.test(e.code)) {
        engineRef.current.setWeapon(loadout[Number(e.code.slice(5)) - 1]);
      }
      if (e.code === 'KeyQ' || e.code === 'KeyE') {
        const cur = Math.max(0, loadout.indexOf(engineRef.current.activeWeaponIdx));
        const step = e.code === 'KeyE' ? 1 : loadout.length - 1;
        engineRef.current.setWeapon(loadout[(cur + step) % loadout.length]);
      }
      if (e.code === 'KeyF' && !e.repeat) engineRef.current.guardDown();
      if (e.code === 'KeyR' && !e.repeat) engineRef.current.heal();
      if (e.code === 'KeyC') engineRef.current.recenterCamera();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!engineRef.current) return;
      engineRef.current.input.keys[e.code] = false;
      if (e.code === 'KeyF') engineRef.current.guardUp();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        id="game-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Floating Virtual Joystick */}
      {joyActive && (
        <div
          className="fixed pointer-events-none rounded-full border-2 border-[rgba(239,230,210,0.45)] bg-[rgba(22,18,31,0.35)] backdrop-blur-xs transition-opacity duration-150 z-20"
          style={{
            width: 120,
            height: 120,
            left: joyPos.x - 60,
            top: joyPos.y - 60
          }}
        >
          <div
            className="absolute rounded-full bg-[rgba(239,230,210,0.85)] shadow-lg"
            style={{
              width: 52,
              height: 52,
              left: 34 + knobPos.x,
              top: 34 + knobPos.y,
              boxShadow: '0 0 16px rgba(242,166,90,0.6)'
            }}
          />
        </div>
      )}

      {/* In-Game HUD (Always mounted in DOM so minimapRef is ready on initial mount) */}
      <div
        className={`fixed inset-0 z-10 transition-opacity duration-200 ${
          gameState === 'play' ? 'opacity-100 pointer-events-none' : 'opacity-0 pointer-events-none invisible'
        }`}
      >
          {/* Top Left: Character Avatar & Health, Stamina, XP, Wave */}
          <div className="absolute top-[calc(var(--sat)+12px)] left-[calc(var(--sal)+12px)] flex items-center gap-2.5 pointer-events-auto">
            {/* Character Portrait Photo */}
            <div className="relative shrink-0">
              <img
                src={charId === 'samurai' ? ICON_URLS.samurai_portrait : ICON_URLS.kage_portrait}
                alt="Player Avatar"
                className="w-12 h-12 rounded-full border-2 border-[var(--ember)] shadow-md object-cover bg-black/60"
              />
            </div>
            <div className="w-[min(42vw,190px)]">
              {/* HP Bar */}
              <div className="h-3.5 rounded-sm bg-[rgba(22,18,31,0.75)] border border-[rgba(239,230,210,0.35)] overflow-hidden mb-1 shadow-sm">
                <div
                  className="h-full bg-linear-to-r from-[#8e1f28] to-[var(--torii)] transition-transform duration-100 origin-left"
                  style={{ transform: `scaleX(${Math.max(0, hp / maxHp)})` }}
                />
              </div>
              {/* Stamina Bar */}
              <div className="h-2 rounded-sm bg-[rgba(22,18,31,0.7)] border border-[rgba(239,230,210,0.25)] overflow-hidden mb-1">
                <div
                  className="h-full bg-[var(--ember)] transition-transform duration-100 origin-left"
                  style={{ transform: `scaleX(${Math.max(0, stamina / maxStamina)})` }}
                />
              </div>
              {/* XP Bar */}
              <div className="h-1 rounded-sm bg-[rgba(22,18,31,0.5)] overflow-hidden mb-1">
                <div
                  className="h-full bg-[var(--jade)] transition-transform duration-100 origin-left"
                  style={{ transform: `scaleX(${Math.max(0, xp / xpNext)})` }}
                />
              </div>
              {/* Wave & Level Text */}
              <div className="flex justify-between text-xs font-bold text-[var(--paper)] drop-shadow-sm px-0.5">
                <span>Onda {engineRef.current?.wave || 1}</span>
                <span className="text-[var(--jade)]">Nível {level}</span>
              </div>
              {waveMod && (
                <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[rgba(255,209,102,0.5)] bg-[rgba(22,18,31,0.7)] px-2 py-0.5 text-[10px] font-bold text-[#ffd166]" title={waveMod.desc}>
                  <span className="font-serif text-xs leading-none">{waveMod.glyph}</span>
                  {waveMod.name}
                </div>
              )}
            </div>
          </div>

          {/* Top Center-Right: Score and this run's Honra */}
          <div className="absolute top-[calc(var(--sat)+12px)] right-[calc(var(--sar)+126px)] text-right font-extrabold text-2xl font-serif text-[var(--paper)] drop-shadow-md">
            {Math.round(score).toLocaleString('pt-BR')}
            <div className="text-xs font-bold text-[var(--ember)] leading-none mt-0.5">{runHonor} 誉</div>
          </div>

          {/* Boss life bar (the notch marks where the first deathblow leaves it) */}
          {bossBar && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[calc(var(--sat)+10px)] w-[min(38vw,380px)] pointer-events-none">
              <div className={`text-center font-serif text-xs font-extrabold tracking-[0.3em] drop-shadow mb-0.5 ${bossBar.fury ? 'text-[#ff5a3a]' : 'text-[var(--paper)]'}`}>
                {bossBar.name}{bossBar.fury ? ' · 怒' : ''}
              </div>
              <div className="relative h-2.5 rounded-sm bg-[rgba(10,8,14,0.75)] border border-[rgba(239,230,210,0.4)] overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 transition-[width] duration-200 ${bossBar.fury ? 'bg-[#ff5a1a] animate-pulse' : 'bg-[#d8242a]'}`}
                  style={{ width: `${Math.max(0, Math.min(100, (bossBar.hp / bossBar.max) * 100))}%` }}
                />
                <div className="absolute inset-y-0 left-1/2 w-px bg-[rgba(239,230,210,0.6)]" />
              </div>
            </div>
          )}

          {/* Minimap */}
          <canvas
            ref={minimapRef}
            width={200}
            height={200}
            className="absolute top-[calc(var(--sat)+10px)] right-[calc(var(--sar)+10px)] w-24 h-24 rounded-full border-1.5 border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.55)] pointer-events-auto"
          />

          {/* Camera Recenter & Settings Buttons */}
          <div className="absolute top-[calc(var(--sat)+115px)] right-[calc(var(--sar)+12px)] flex flex-col gap-2 pointer-events-auto">
            <button
              onClick={handleRecenterCamera}
              className="w-10 h-10 rounded-full bg-[rgba(22,18,31,0.65)] border border-[rgba(239,230,210,0.3)] text-[var(--paper)] flex items-center justify-center active:scale-95 transition-transform"
              title="Recentralizar Câmera atrás do Ninja"
              aria-label="Recentralizar Câmera"
            >
              <Compass className="w-5 h-5 text-[var(--ember)]" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-10 h-10 rounded-full bg-[rgba(22,18,31,0.65)] border border-[rgba(239,230,210,0.3)] text-[var(--paper)] flex items-center justify-center active:scale-95 transition-transform"
              title="Configurações de Câmera e Toque"
              aria-label="Configurações"
            >
              <Settings className="w-5 h-5 text-[var(--paper)]" />
            </button>
            {tuneEnabled && (
              <button
                onClick={() => setShowTune(!showTune)}
                className="w-10 h-10 rounded-full bg-[rgba(22,18,31,0.65)] border border-[rgba(239,230,210,0.3)] text-[var(--paper)] flex items-center justify-center active:scale-95 transition-transform"
                title="Ajuste de movimento"
                aria-label="Ajuste de movimento"
              >
                <SlidersHorizontal className="w-5 h-5 text-[var(--ember)]" />
              </button>
            )}
          </div>

          {tuneEnabled && showTune && <TunePanel onClose={() => setShowTune(false)} />}

          {/* Banner message */}
          {banner && (
            <div className="absolute left-0 right-0 top-[calc(var(--sat)+64px)] text-center pointer-events-none drop-shadow-lg transition-opacity duration-300">
              <span className="block font-serif text-2xl sm:text-3xl font-extrabold tracking-wide text-[var(--paper)]">
                {banner.main}
              </span>
              <span className="block text-xs sm:text-sm text-[var(--ember)] font-medium mt-1">
                {banner.sub}
              </span>
            </div>
          )}

          {/* Combo indicator com feedback de sangue e impacto */}
          {combo > 1 && (
            <div className="absolute left-1/2 top-[calc(var(--sat)+130px)] -translate-x-1/2 text-center pointer-events-none drop-shadow-2xl transition-all">
              <div className="font-serif text-xl sm:text-2xl font-black tracking-wider bg-linear-to-r from-[#ff4d4d] via-[#ffd166] to-[#ff2a45] bg-clip-text text-transparent drop-shadow-[0_0_16px_rgba(230,0,38,0.7)] animate-pulse">
                {combo}× GOLPES!
              </div>
              <div className="text-[10px] sm:text-xs font-extrabold text-[#ffd166] tracking-widest uppercase mt-0.5 drop-shadow-md">
                {combo >= 7
                  ? '⚔️ Massacre Sangrento!'
                  : combo >= 5
                  ? '🩸 Frenesi Cortante!'
                  : combo >= 3
                  ? '⚡ Corte Triplo!'
                  : '⚔️ Corte Duplo!'}
              </div>
            </div>
          )}

          {toast && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+120px)] px-3 py-1 rounded-full text-xs font-bold bg-[rgba(22,18,31,0.85)] border border-[rgba(239,230,210,0.3)] text-[var(--ember)] pointer-events-none">
              {toast}
            </div>
          )}

          {/* Touch Movement Guidance Tip */}
          <div className="absolute left-[calc(var(--sal)+24px)] bottom-[calc(var(--sab)+64px)] max-w-[calc(100vw-262px)] text-xs leading-snug text-[var(--paper)]/60 pointer-events-none">
            Arraste na esquerda para mover e girar a câmera
          </div>

          {/* Player posture: grows from the center; red and pulsing near a guard break */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+196px)] w-[min(46vw,220px)] transition-opacity duration-300 pointer-events-none ${
              posture > 0.02 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="relative h-2 rounded-full bg-[rgba(10,8,14,0.7)] border border-[rgba(239,230,210,0.25)] overflow-hidden">
              <div
                className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 rounded-full ${posture > 0.8 ? 'animate-pulse' : ''}`}
                style={{
                  width: `${Math.min(100, posture * 100)}%`,
                  background: posture > 0.8 ? '#ff3b24' : posture > 0.5 ? '#ff8a30' : '#ffcf5a',
                  boxShadow: posture > 0.8 ? '0 0 10px rgba(255,59,36,0.9)' : 'none'
                }}
              />
            </div>
          </div>

          {/* Bottom Right Controls: arc of action buttons around the primary attack */}
          <div className="absolute right-[calc(var(--sar)+14px)] bottom-[calc(var(--sab)+14px)] flex flex-col items-end gap-2 pointer-events-none">
            <div className="text-xs font-bold text-[var(--ember)] drop-shadow-md pr-1">
              {activeWeapon?.name || 'Arma'}
            </div>

            <div className="relative w-56 h-40">
              {slots.map((weaponIdx, s) => {
                const w = weaponList[weaponIdx];
                const isActive = activeWeaponIdx === weaponIdx;
                const hasSpecial = specials[weaponIdx] > 0;
                const deathblow = s === 0 && dbReady;
                // Big primary in the corner, secondary right above it
                const pos = ['right-0 bottom-0 w-20 h-20', 'right-1 bottom-[92px] w-15 h-15'][s];
                return (
                  <button
                    key={s}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleSlotDown(s);
                    }}
                    onPointerUp={() => handleSlotUp(s)}
                    onPointerCancel={() => handleSlotUp(s)}
                    onPointerLeave={() => handleSlotUp(s)}
                    className={`absolute ${pos} rounded-full flex items-center justify-center pointer-events-auto shadow-lg transition-transform active:scale-95 ${
                      deathblow
                        ? 'border-2 border-[#ff3b24] bg-[rgba(200,20,10,0.45)] shadow-[0_0_18px_rgba(255,40,20,0.8)]'
                        : isActive
                        ? 'border-2 border-[var(--ember)] bg-[rgba(242,166,90,0.25)]'
                        : 'border border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.7)]'
                    } ${hasSpecial && !deathblow ? 'ring-2 ring-[#ffd166] animate-pulse' : ''}`}
                    aria-label={deathblow ? 'Golpe final' : `Atacar com ${w?.name}`}
                    title={w?.name}
                  >
                    {deathblow ? (
                      <span className="font-serif text-2xl font-black text-[#fff0e0] animate-pulse drop-shadow-[0_0_6px_rgba(255,40,20,1)] pointer-events-none">忍殺</span>
                    ) : w && ICON_URLS[w.id] ? (
                      <img
                        src={ICON_URLS[w.id]}
                        alt={w.name}
                        className={`${s === 0 ? 'w-12 h-12' : 'w-9 h-9'} object-contain pointer-events-none drop-shadow-md`}
                      />
                    ) : (
                      <Swords className="w-8 h-8 text-[var(--ember)] pointer-events-none" />
                    )}
                    {hasSpecial && !deathblow && (
                      <span className="absolute -top-1 -right-1 min-w-4 text-[10px] bg-[#ffd166] text-[#16121f] font-bold rounded-full px-1">
                        {Math.ceil(specials[weaponIdx])}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Guard: hold to block, tap on the enemy's strike to deflect */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  initAudio();
                  engineRef.current?.guardDown();
                }}
                onPointerUp={() => engineRef.current?.guardUp()}
                onPointerCancel={() => engineRef.current?.guardUp()}
                onPointerLeave={() => engineRef.current?.guardUp()}
                className="absolute right-[84px] bottom-[64px] w-[66px] h-[66px] rounded-full border-2 border-[rgba(143,224,200,0.6)] bg-[rgba(22,18,31,0.7)] flex flex-col items-center justify-center pointer-events-auto shadow-md active:bg-[rgba(143,224,200,0.3)] active:scale-95 transition-transform"
                aria-label="Defesa"
              >
                <Shield className="w-6 h-6 text-[#8fe0c8] pointer-events-none" />
                <span className="text-[10px] font-bold text-[var(--paper)] leading-none mt-0.5 pointer-events-none">Defesa</span>
              </button>

              {/* Dash */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engineRef.current?.dash();
                }}
                className="absolute right-[96px] bottom-0 w-14 h-14 rounded-full border border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.65)] text-[11px] font-bold text-[var(--paper)] pointer-events-auto active:bg-[rgba(242,166,90,0.4)] shadow-md transition-transform active:scale-95"
                aria-label="Esquiva"
              >
                Esquiva
              </button>

              {/* Jump (clears perilous sweeps) */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engineRef.current?.jump();
                }}
                className="absolute right-[164px] bottom-1 w-[50px] h-[50px] rounded-full border border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.65)] flex flex-col items-center justify-center pointer-events-auto shadow-md active:bg-[rgba(242,166,90,0.4)] active:scale-95 transition-transform"
                aria-label="Pulo"
              >
                <ArrowUp className="w-4 h-4 text-[var(--paper)] pointer-events-none" />
                <span className="text-[10px] font-bold text-[var(--paper)] leading-none pointer-events-none">Pulo</span>
              </button>

              {/* Healing gourd */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engineRef.current?.heal();
                }}
                disabled={heals <= 0}
                className={`absolute right-[158px] bottom-[72px] w-[46px] h-[46px] rounded-full border flex items-center justify-center pointer-events-auto shadow-md active:scale-95 transition-transform ${
                  heals > 0 ? 'border-[rgba(122,255,176,0.6)] bg-[rgba(22,18,31,0.7)]' : 'border-[rgba(239,230,210,0.15)] bg-[rgba(22,18,31,0.4)] opacity-50'
                }`}
                aria-label="Cura"
              >
                <span className="text-lg leading-none pointer-events-none">🍶</span>
                <span className="absolute -top-1 -right-1 min-w-4 text-[10px] bg-[#7affb0] text-[#16121f] font-bold rounded-full px-1 pointer-events-none">
                  {heals}
                </span>
              </button>
            </div>
          </div>
      </div>

      {/* Deathblow cinematic: letterbox bars and a brushed 忍殺 */}
      <div className={`fixed inset-0 z-20 pointer-events-none transition-opacity duration-150 ${cinematic === 'full' ? 'opacity-100' : 'opacity-0'}`}>
        <div className={`absolute left-0 right-0 top-0 bg-black transition-all duration-200 ${cinematic === 'full' ? 'h-[11vh]' : 'h-0'}`} />
        <div className={`absolute left-0 right-0 bottom-0 bg-black transition-all duration-200 ${cinematic === 'full' ? 'h-[11vh]' : 'h-0'}`} />
        {cinematic === 'full' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="deathblow-kanji font-serif font-black text-[#e8231a] select-none">忍殺</div>
          </div>
        )}
      </div>

      {/* Main Start Menu */}
      {gameState === 'menu' && (
        <div id="menu-overlay" className="fixed inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(16,12,24,0.78),rgba(16,12,24,0.42))] backdrop-blur-[2px] p-6 z-30 overflow-auto">
          <div className="max-w-md w-full text-center py-4">
            <div className="kanji-title font-serif text-8xl font-bold text-[var(--torii)] leading-none mb-2">
              影
            </div>
            <h1 className="font-serif text-4xl font-extrabold text-[var(--paper)] mb-2">Kage</h1>
            <p className="text-sm text-[var(--paper)]/80 mb-4 px-4 leading-relaxed">
              Defenda o templo ao entardecer. Enfrente samurais, arqueiros e o temido Oni com armas ninjas lendárias.
            </p>

            {bestScore > 0 && (
              <p className="text-xs text-[var(--ember)] font-bold mb-2">
                Recorde: {bestScore.toLocaleString('pt-BR')} pontos
              </p>
            )}
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setShowTemple(true)}
                className="inline-flex items-center gap-2 text-xs font-bold border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-1.5 rounded-full active:scale-95 transition-all cursor-pointer"
              >
                <span className="font-serif text-base text-[var(--ember)] leading-none">誉</span>
                Templo da Honra · {meta.honor.toLocaleString('pt-BR')}
              </button>
              {rankOn && (
                <button
                  onClick={() => setShowRanking(true)}
                  className="inline-flex items-center gap-2 text-xs font-bold border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-1.5 rounded-full active:scale-95 transition-all cursor-pointer"
                >
                  <span className="font-serif text-base text-[var(--ember)] leading-none">頂</span>
                  Ranking
                </button>
              )}
            </div>

            <Missions meta={meta} today={localDate()} />

            {/* Kage is hidden for now (kept in code, not deleted, in case it comes back) -
                O Rōnin is the only selectable character while it's the one being tuned. */}
            <div className="flex flex-col items-center gap-3 mb-6">
              <button
                onClick={() => handleCharSelect('samurai')}
                className="char-card on flex items-center gap-3 w-64 py-3 px-4 rounded-xl border-2 border-[var(--ember)] bg-[rgba(242,166,90,0.2)] shadow-[0_0_16px_rgba(242,166,90,0.35)] transition-all cursor-pointer active:scale-95"
              >
                <img
                  src={ICON_URLS.samurai_portrait}
                  alt="O Rōnin"
                  className="w-14 h-14 rounded-full border-2 border-[var(--torii)] object-cover shadow-md"
                />
                <span className="flex flex-col items-start text-left">
                  <span className="text-sm font-bold text-[var(--paper)]">{CHAR_NAME.samurai}</span>
                  <span className="text-[11px] text-[var(--ember)] font-medium">
                    {loadouts.samurai.map((i) => WEAPONS_KAGE[i].name).join(' & ')}
                  </span>
                </span>
              </button>
            </div>

            {/* Instructions list with touch camera explanation */}
            <div className="text-left text-xs bg-[rgba(22,18,31,0.6)] border border-[rgba(239,230,210,0.15)] rounded-lg p-3.5 mb-6 max-w-sm mx-auto space-y-1.5 text-[var(--paper)]/85">
              <div className="text-[var(--ember)] font-bold mb-1">🎮 Controles & Rotação Automática:</div>
              <div>• <b>Mover:</b> arraste no analógico esquerdo. O personagem vira para onde você apontar e a câmera acompanha o trajeto.</div>
              <div>• <b>Câmera:</b> gira junto automaticamente ao mover, ou arraste com o polegar direito para ajuste livre.</div>
              <div>• <b>Armas:</b> antes de entrar você escolhe 2 armas no Arsenal. Elas ficam fixas até morrer.</div>
              <div>• <b>Atacar:</b> toque no botão da arma (segure para disparo contínuo).</div>
              <div>• <b>Defesa:</b> segure para defender. Toque no instante do golpe inimigo para <b>aparar</b> (faíscas) e quebrar a postura dele.</div>
              <div>• <b>忍殺 Golpe final:</b> com a postura quebrada (ponto vermelho), ataque de perto para executar.</div>
              <div>• <b>危 Perigo:</b> rasteira = pule; estocada = apare no tempo certo ou esquive.</div>
              <div>• <b>Cura:</b> 3 goles da cabaça por onda.</div>
              <div>• <b>Recentralizar:</b> toque no ícone da bússola para virar a câmera para frente.</div>
              <div>• <b>No PC:</b> WASD move, mouse gira a câmera, clique esquerdo ataca, clique direito ou F defende, Espaço pula, Shift esquiva, R cura, 1/2 ou Q/E trocam a arma, C recentraliza.</div>
            </div>

          </div>
        </div>
      )}

      {/* Arsenal: pick the 2 weapons for the run (Axelay-style pre-mission loadout) */}
      {gameState === 'arsenal' && (
        <div id="menu-overlay" className="fixed inset-0 flex justify-center bg-[rgba(22,18,31,0.88)] backdrop-blur-md p-4 z-30 overflow-y-auto">
          <div className="max-w-md w-full my-auto py-2">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setGameState('menu')}
                className="flex items-center gap-0.5 py-1.5 pr-3 text-xs font-bold text-[var(--paper)]/70 cursor-pointer active:scale-95"
              >
                <ChevronLeft className="w-4 h-4" /> Voltar
              </button>
              <span className="text-xs font-bold text-[var(--paper)]/60">{CHAR_NAME[charId]}</span>
            </div>

            <div className="text-center mb-4">
              <div className="kanji-title font-serif text-5xl font-bold text-[var(--torii)] leading-none mb-1">武</div>
              <h2 className="font-serif text-2xl font-extrabold text-[var(--paper)]">Arsenal</h2>
              <p className="text-[11px] text-[var(--paper)]/60 mt-1">
                Escolha 2 armas. Elas ficam fixas até o fim da partida.
              </p>
            </div>

            {/* The 2 slots */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {slots.map((weaponIdx, s) => {
                const w = weaponList[weaponIdx];
                const selected = editSlot === s;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setEditSlot(s);
                      setInspectIdx(weaponIdx);
                    }}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all cursor-pointer ${
                      selected
                        ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.2)] shadow-[0_0_14px_rgba(242,166,90,0.35)]'
                        : 'border-[rgba(239,230,210,0.2)] bg-[rgba(22,18,31,0.6)]'
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${selected ? 'text-[var(--ember)]' : 'text-[var(--paper)]/60'}`}>
                      {SLOT_LABELS[s]}
                    </span>
                    <div className={`w-14 h-14 rounded-full border flex items-center justify-center bg-black/30 ${selected ? 'border-[var(--ember)]' : 'border-[rgba(239,230,210,0.35)]'}`}>
                      {w && ICON_URLS[w.id] && (
                        <img src={ICON_URLS[w.id]} alt={w.name} className="w-10 h-10 object-contain pointer-events-none" />
                      )}
                    </div>
                    <span className="text-sm font-bold text-[var(--paper)] leading-tight">{w?.name}</span>
                    <span className="text-[10px] text-[var(--paper)]/60 leading-tight">{w && WEAPON_INFO[w.id]?.tag}</span>
                  </button>
                );
              })}
            </div>

            {/* Weapon grid for the selected slot */}
            <div className="text-xs font-bold text-[var(--paper)] mb-2">
              Escolha a arma {editSlot === 0 ? 'principal' : 'secundária'}:
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {weaponList.map((w: WeaponDef, idx: number) => {
                const onSlot = slots.indexOf(idx);
                const inspected = inspectIdx === idx;
                return (
                  <button
                    key={w.id}
                    onClick={() => handleArsenalPick(idx)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-all cursor-pointer ${
                      onSlot !== -1
                        ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.18)]'
                        : 'border-[rgba(239,230,210,0.15)] bg-[rgba(22,18,31,0.6)] active:bg-[rgba(242,166,90,0.15)]'
                    } ${inspected ? 'ring-1 ring-[var(--paper)]/50' : ''}`}
                  >
                    <div className="w-8 h-8 shrink-0 rounded-full bg-black/30 flex items-center justify-center">
                      {ICON_URLS[w.id] && (
                        <img src={ICON_URLS[w.id]} alt={w.name} className="w-6 h-6 object-contain pointer-events-none" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-[var(--paper)] leading-tight truncate">{w.name}</div>
                      <div className="text-[9px] text-[var(--paper)]/55 leading-normal truncate">{WEAPON_INFO[w.id]?.tag}</div>
                    </div>
                    {onSlot !== -1 && (
                      <span className="text-[9px] font-bold rounded px-1 bg-[var(--ember)] text-[var(--ink)]">
                        {onSlot === 0 ? 'P' : 'S'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Details of the last touched weapon */}
            {weaponList[inspectIdx] && (() => {
              const w = weaponList[inspectIdx];
              const mult = w.pointMult ?? 1;
              return (
                <div className="rounded-lg border border-[rgba(239,230,210,0.15)] bg-[rgba(22,18,31,0.6)] p-3 mb-4 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-[var(--ember)]">{w.name}</span>
                    <span className="text-[9px] font-bold rounded px-1.5 py-0.5 bg-[rgba(239,230,210,0.12)] text-[var(--paper)]/80">
                      {WEAPON_INFO[w.id]?.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--paper)]/80 leading-snug">{WEAPON_INFO[w.id]?.desc}</p>
                  {SPECIALS[w.id] && (
                    <p className="text-[11px] text-[#ffd166] mt-1">
                      Especial: <b>{SPECIALS[w.id].name}</b>
                    </p>
                  )}
                  <div className="flex gap-4 text-[10px] text-[var(--paper)]/60 mt-2">
                    <span>
                      Dano <b className="text-[var(--paper)]">{dmgText(w)}</b>
                    </span>
                    <span>
                      Recarga <b className="text-[var(--paper)]">{fmtNum(w.cd)}s</b>
                    </span>
                    <span>
                      Pontos{' '}
                      <b className={mult > 1 ? 'text-[var(--jade)]' : mult < 1 ? 'text-[#ff8a7a]' : 'text-[var(--paper)]'}>
                        ×{fmtNum(mult, 1)}
                      </b>
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="mb-3">
              <div className="flex rounded-md border border-[rgba(239,230,210,0.3)] overflow-hidden text-sm font-bold" role="group" aria-label="Modo de jogo">
                {(['waves', 'conquest'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setGameMode(m);
                      try {
                        localStorage.setItem('kage_mode_v1', m);
                      } catch {}
                    }}
                    aria-pressed={gameMode === m}
                    className={`flex-1 py-2 cursor-pointer transition-colors ${gameMode === m ? 'bg-[var(--ember)] text-[var(--ink)]' : 'text-[var(--paper)]/80'}`}
                  >
                    {m === 'waves' ? 'Ondas' : '旗 Conquista'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--paper)]/70 mt-1.5 text-center leading-snug">
                {gameMode === 'waves' ? 'Inimigos chegam em ondas até você cair. Vale para o ranking.' : 'Tome os 3 postos inimigos espalhados pelo campo: derrote o capitão de cada guarnição. Não conta para o ranking.'}
              </p>
            </div>

            <button
              onClick={handleStartGame}
              disabled={startingGame}
              className="go-btn relative overflow-hidden w-full font-serif font-extrabold text-lg bg-[var(--torii)] text-[var(--paper)] py-3.5 rounded-md hover:brightness-110 active:scale-95 transition-all shadow-lg cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {startingGame && <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-200" style={{ width: `${loadPct}%` }} />}
              <span className="relative">{startingGame ? `Carregando… ${loadPct}%` : 'Entrar em combate'}</span>
            </button>
          </div>
        </div>
      )}

      {/* black dip when a run starts */}
      <div className={`fixed inset-0 z-[60] bg-black pointer-events-none transition-opacity duration-700 ${fadeIn ? 'opacity-100' : 'opacity-0'}`} />
      {/* Game Over Screen */}
      {gameState === 'over' && runResult && (
        <RunSummaryScreen
          result={runResult}
          meta={meta}
          starting={startingGame}
          loadPct={loadPct}
          onAgain={handleStartGame}
          onBuy={buy}
          onTemple={() => setShowTemple(true)}
          onArsenal={() => openArsenal(charId)}
          board={runBoard}
          mode={runMode}
          onJoin={rankOn && !rankActive && runMode === 'waves' ? () => setNameMode(player ? 'confirm' : 'new') : undefined}
          onRanking={rankOn && rankActive ? () => setShowRanking(true) : undefined}
        />
      )}

      {/* Level-up cards */}
      {gameState === 'play' && cardOffer && <CardPicker level={level} offer={cardOffer} onPick={(id) => engineRef.current?.pickCard(id)} />}

      {showRanking && (
        <Ranking
          playerId={player?.id ?? null}
          playerName={player?.name ?? null}
          active={rankActive}
          refreshKey={rankRefresh}
          onJoin={() => {
            setShowRanking(false);
            setNameMode(player ? 'confirm' : 'new');
          }}
          onRename={() => {
            setShowRanking(false);
            setNameMode('rename');
          }}
          onClose={() => setShowRanking(false)}
        />
      )}
      {nameMode && <PlayerName mode={nameMode} current={player} onMode={setNameMode} onDone={finishName} onSkip={() => setNameMode(null)} />}

      {showTemple && <Temple meta={meta} persistent={persistOk} onBuy={buy} onClose={() => setShowTemple(false)} />}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 z-40">
          <div className="bg-[var(--ink)] border border-[rgba(239,230,210,0.3)] rounded-xl max-w-sm w-full p-5 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-[var(--ember)] mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" /> Configurações
            </h3>

            <div className="space-y-4 text-xs text-[var(--paper)]">
              <div>
                <label className="block mb-1 font-bold">Sensibilidade da Câmera: {sensitivity.toFixed(1)}x</label>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                  className="w-full accent-[var(--ember)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--paper)]/60 mt-0.5">
                  <span>Baixa</span>
                  <span>Normal</span>
                  <span>Alta</span>
                  <span>Rápida</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[rgba(239,230,210,0.1)]">
                <span>Girar câmera com o direcional:</span>
                <input
                  type="checkbox"
                  checked={autoTurnStick}
                  onChange={(e) => setAutoTurnStick(e.target.checked)}
                  className="w-4 h-4 accent-[var(--ember)]"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[rgba(239,230,210,0.1)]">
                <span>Ajuste automático de câmera atrás:</span>
                <input
                  type="checkbox"
                  checked={autoCamera}
                  onChange={(e) => setAutoCamera(e.target.checked)}
                  className="w-4 h-4 accent-[var(--ember)]"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[rgba(239,230,210,0.1)]">
                <span>Câmera cinematográfica nos golpes finais:</span>
                <input
                  type="checkbox"
                  checked={cineCam}
                  onChange={(e) => setCineCam(e.target.checked)}
                  className="w-4 h-4 accent-[var(--ember)]"
                />
              </div>

              <div className="py-1 border-t border-[rgba(239,230,210,0.1)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold">Qualidade gráfica:</span>
                  {qualitySetting === 'auto' && (
                    <span className="text-[10px] text-[var(--paper)]/60">
                      agora: {effectiveQuality === 'high' ? 'Alta' : effectiveQuality === 'medium' ? 'Média' : 'Baixa'}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      ['auto', 'Auto'],
                      ['high', 'Alta'],
                      ['medium', 'Média'],
                      ['low', 'Baixa']
                    ] as [QualitySetting, string][]
                  ).map(([q, label]) => (
                    <button
                      key={q}
                      onClick={() => {
                        setQualitySetting(q);
                        qualityRef.current = q;
                        engineRef.current?.setQuality(q);
                        try {
                          localStorage.setItem('kage_quality', q);
                        } catch {}
                      }}
                      className={`py-1.5 rounded border text-[11px] font-bold cursor-pointer ${
                        qualitySetting === q
                          ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.25)] text-[var(--paper)]'
                          : 'border-[rgba(239,230,210,0.2)] text-[var(--paper)]/70'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--paper)]/50 mt-1">Auto reduz a qualidade se o jogo ficar lento.</p>
              </div>

              <div className="py-1 border-t border-[rgba(239,230,210,0.1)]">
                <div className="font-bold mb-1.5">Mudança de atmosfera:</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['every', 'Cada onda'],
                      ['two', 'A cada 2'],
                      ['random', 'Aleatória']
                    ] as [AtmosMode, string][]
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => {
                        setAtmosMode(m);
                        atmosRef.current = m;
                        if (engineRef.current) engineRef.current.atmosMode = m;
                        try {
                          localStorage.setItem('kage_atmos', m);
                        } catch {}
                      }}
                      className={`py-1.5 rounded border text-[11px] font-bold cursor-pointer ${
                        atmosMode === m
                          ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.25)] text-[var(--paper)]'
                          : 'border-[rgba(239,230,210,0.2)] text-[var(--paper)]/70'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--paper)]/50 mt-1">Entardecer, Noite de lua e Amanhecer com névoa.</p>
              </div>

              <div className="py-1 border-t border-[rgba(239,230,210,0.1)]">
                <div className="font-bold mb-1.5">Mudança de cenário:</div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ['three', 'A cada 3 ondas'],
                      ['off', 'Desligada']
                    ] as [ThemeMode, string][]
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => {
                        setThemeMode(m);
                        themeRef.current = m;
                        if (engineRef.current) engineRef.current.themeMode = m;
                        try {
                          localStorage.setItem('kage_theme', m);
                        } catch {}
                      }}
                      className={`py-1.5 rounded border text-[11px] font-bold cursor-pointer ${
                        themeMode === m
                          ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.25)] text-[var(--paper)]'
                          : 'border-[rgba(239,230,210,0.2)] text-[var(--paper)]/70'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--paper)]/50 mt-1">Sakura, Outono, Inverno e Brasas; a troca acontece no início da onda.</p>
              </div>

            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="mt-5 w-full py-2.5 rounded-md bg-[var(--torii)] font-bold text-sm text-[var(--paper)] cursor-pointer active:scale-98"
            >
              Salvar e Voltar
            </button>

            <button
              onClick={handleBackToMenu}
              className="mt-2 w-full py-2.5 rounded-md border border-[rgba(239,230,210,0.3)] font-bold text-sm text-[var(--paper)] flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
            >
              <RotateCcw className="w-4 h-4" /> Voltar ao Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
