import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from './game/engine';
import { CharacterId, WeaponDef } from './game/types';
import { WEAPONS_KAGE, WEAPONS_BRAVO } from './game/constants';
import { ICON_URLS } from './game/icons';
import { initAudio } from './game/audio';
import { Settings, RotateCcw, Shield, Compass, Swords } from 'lucide-react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // UI State
  const [gameState, setGameState] = useState<'menu' | 'play' | 'over'>('menu');
  const [charId, setCharId] = useState<CharacterId>('kage');
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
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('kage_best_score') || 0);
    } catch {
      return 0;
    }
  });

  // Secondary weapon (bound to the old jump button, which had no defensive use).
  // The button always selects this exact weapon — no toggle-back — so a double-fired
  // tap (a known touch/mouse-compat quirk) can't cancel itself out by flipping twice.
  // Getting back to whatever you were using before is just a normal carousel tap.
  const [secondaryWeaponIdx, setSecondaryWeaponIdxState] = useState(1);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${charId}_secondary_weapon`);
      setSecondaryWeaponIdxState(saved !== null ? Number(saved) : 1);
    } catch {
      setSecondaryWeaponIdxState(1);
    }
  }, [charId]);

  const setSecondaryWeaponIdx = (idx: number) => {
    setSecondaryWeaponIdxState(idx);
    try {
      localStorage.setItem(`${charId}_secondary_weapon`, String(idx));
    } catch {}
  };

  const handleWeaponSwap = () => {
    engineRef.current?.setWeapon(secondaryWeaponIdx);
  };

  // Settings Modal
  const [showSettings, setShowSettings] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [autoCamera, setAutoCamera] = useState(true);
  const [autoTurnStick, setAutoTurnStick] = useState(true);

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
      onGameOver: (finalScore) => {
        setGameState('over');
        if (finalScore > bestScore) {
          setBestScore(finalScore);
          try {
            localStorage.setItem('kage_best_score', String(finalScore));
          } catch {}
        }
      }
    });

    engineRef.current = engine;
    setActiveWeapon(engine.weapons[0]);

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.destroy();
    };
  }, [bestScore, showBanner]);

  // Update Settings in Engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.settings.cameraSensitivity = sensitivity;
      engineRef.current.settings.autoCamera = autoCamera;
      engineRef.current.settings.autoTurnWithStick = autoTurnStick;
    }
  }, [sensitivity, autoCamera, autoTurnStick]);

  const handleStartGame = () => {
    initAudio();
    if (engineRef.current) {
      engineRef.current.setCharacter(charId);
      engineRef.current.start();
    }
    setGameState('play');
  };

  const handleCharSelect = (id: CharacterId) => {
    setCharId(id);
    initAudio();
    if (engineRef.current) {
      engineRef.current.setCharacter(id);
      engineRef.current.start();
    }
    setGameState('play');
  };

  const handleBackToMenu = () => {
    if (engineRef.current) {
      engineRef.current.backToMenu();
    }
    setShowSettings(false);
    setGameState('menu');
  };

  const handleWeaponSelect = (idx: number) => {
    if (engineRef.current) {
      engineRef.current.setWeapon(idx);
    }
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
        engineRef.current.tryAttack();
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
      engineRef.current.input.attackHeld = false;
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!engineRef.current || gameState !== 'play') return;
      engineRef.current.input.keys[e.code] = true;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) engineRef.current.jump();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        engineRef.current.dash();
      }
      if (/^Digit[1-7]$/.test(e.code)) {
        const idx = Number(e.code.slice(5)) - 1;
        engineRef.current.setWeapon(idx);
      }
      if (e.code === 'KeyQ') {
        const next = (engineRef.current.activeWeaponIdx + engineRef.current.weapons.length - 1) % engineRef.current.weapons.length;
        engineRef.current.setWeapon(next);
      }
      if (e.code === 'KeyE') {
        const next = (engineRef.current.activeWeaponIdx + 1) % engineRef.current.weapons.length;
        engineRef.current.setWeapon(next);
      }
      if (e.code === 'KeyR') {
        engineRef.current.recenterCamera();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!engineRef.current) return;
      engineRef.current.input.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  return (
    <div className={`relative w-full h-full select-none overflow-hidden ${charId === 'bravo' ? 'doom' : ''}`}>
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        id="game-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
                src={charId === 'bravo' ? ICON_URLS.bravo_portrait : ICON_URLS.kage_portrait}
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
            </div>
          </div>

          {/* Top Center-Right: Score */}
          <div className="absolute top-[calc(var(--sat)+12px)] right-[calc(var(--sar)+126px)] text-right font-extrabold text-2xl font-serif text-[var(--paper)] drop-shadow-md">
            {Math.round(score).toLocaleString('pt-BR')}
          </div>

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
          </div>

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

          {/* Touch Movement Guidance Tip */}
          <div className="absolute left-[calc(var(--sal)+24px)] bottom-[calc(var(--sab)+64px)] text-xs text-[var(--paper)]/60 pointer-events-none">
            Arraste na esquerda para mover e girar a câmera
          </div>

          {/* Bottom Right Controls: Weapon Selector & Action Buttons */}
          <div className="absolute right-[calc(var(--sar)+14px)] bottom-[calc(var(--sab)+14px)] flex flex-col items-end gap-3 pointer-events-auto">
            {/* Active weapon name */}
            <div className="text-xs font-bold text-[var(--ember)] drop-shadow-md pr-1">
              {activeWeapon?.name || 'Arma'}
            </div>

            {/* Weapon Carousel */}
            <div className="flex gap-1.5">
              {(engineRef.current?.weapons || (charId === 'kage' ? WEAPONS_KAGE : WEAPONS_BRAVO)).map((w: WeaponDef, idx: number) => {
                const isSelected = activeWeaponIdx === idx;
                const hasSpecial = specials[idx] && specials[idx] > 0;
                return (
                  <button
                    key={w.id}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleWeaponSelect(idx);
                    }}
                    className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-[rgba(239,230,210,0.35)] flex items-center justify-center p-1 transition-all ${
                      isSelected
                        ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.28)] scale-105'
                        : 'bg-[rgba(22,18,31,0.6)]'
                    } ${hasSpecial ? 'ring-2 ring-[#ffd166] animate-pulse' : ''}`}
                    title={w.name}
                  >
                    {ICON_URLS[w.id] && (
                      <img src={ICON_URLS[w.id]} alt={w.name} className="w-full h-full object-contain pointer-events-none" />
                    )}
                    {hasSpecial && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-4 text-[10px] bg-[#ffd166] text-[#16121f] font-bold rounded-full px-1">
                        {Math.ceil(specials[idx])}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Action buttons (Attack, Jump, Dash) */}
            <div className="relative w-48 h-42">
              {/* Dash button */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engineRef.current?.dash();
                }}
                className="absolute right-4 bottom-26 w-15 h-15 rounded-full border border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.65)] text-xs font-bold text-[var(--paper)] active:bg-[rgba(242,166,90,0.4)] shadow-md transition-transform active:scale-95"
              >
                Esquiva
              </button>

              {/* Weapon swap button (replaces the old jump button, which had no defensive use) */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleWeaponSwap();
                }}
                className={`absolute right-24 bottom-1 w-15 h-15 rounded-full border flex flex-col items-center justify-center gap-0.5 shadow-md transition-transform active:scale-95 ${
                  activeWeaponIdx === secondaryWeaponIdx
                    ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.28)]'
                    : 'border-[rgba(239,230,210,0.4)] bg-[rgba(22,18,31,0.65)] active:bg-[rgba(242,166,90,0.4)]'
                }`}
                title="Trocar para arma secundária"
              >
                {(() => {
                  const list = engineRef.current?.weapons || (charId === 'kage' ? WEAPONS_KAGE : WEAPONS_BRAVO);
                  const secW = list[secondaryWeaponIdx];
                  return secW && ICON_URLS[secW.id] ? (
                    <img src={ICON_URLS[secW.id]} alt={secW.name} className="w-7 h-7 object-contain pointer-events-none" />
                  ) : (
                    <Swords className="w-6 h-6 text-[var(--paper)] pointer-events-none" />
                  );
                })()}
                <span className="text-[9px] font-bold text-[var(--paper)] leading-none">Trocar</span>
              </button>

              {/* Main Attack button */}
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (engineRef.current) {
                    engineRef.current.input.attackHeld = true;
                    engineRef.current.tryAttack();
                  }
                }}
                onPointerUp={() => {
                  if (engineRef.current) engineRef.current.input.attackHeld = false;
                }}
                onPointerCancel={() => {
                  if (engineRef.current) engineRef.current.input.attackHeld = false;
                }}
                className="absolute right-0 bottom-0 w-22 h-22 rounded-full border-2 border-[var(--ember)] bg-[rgba(22,18,31,0.7)] text-[var(--paper)] flex items-center justify-center active:bg-[rgba(242,166,90,0.35)] shadow-xl transition-transform active:scale-95"
                aria-label="Atacar"
              >
                {activeWeapon && ICON_URLS[activeWeapon.id] ? (
                  <img
                    src={ICON_URLS[activeWeapon.id]}
                    alt="Attack"
                    className="w-12 h-12 object-contain pointer-events-none drop-shadow-md"
                  />
                ) : (
                  <Swords className="w-10 h-10 text-[var(--ember)]" />
                )}
              </button>
            </div>
          </div>
      </div>

      {/* Main Start Menu */}
      {gameState === 'menu' && (
        <div id="menu-overlay" className="fixed inset-0 flex items-center justify-center bg-[rgba(22,18,31,0.85)] backdrop-blur-md p-6 z-30 overflow-auto">
          <div className="max-w-md w-full text-center py-4">
            <div className="kanji-title font-serif text-8xl font-bold text-[var(--torii)] leading-none mb-2">
              {charId === 'kage' ? '影' : '死'}
            </div>
            <h1 className="font-serif text-4xl font-extrabold text-[var(--paper)] mb-2">
              {charId === 'kage' ? 'Kage' : 'Bravo'}
            </h1>
            <p className="text-sm text-[var(--paper)]/80 mb-4 px-4 leading-relaxed">
              {charId === 'kage'
                ? 'Defenda o templo ao entardecer. Enfrente samurais, arqueiros e o temido Oni com armas ninjas lendárias.'
                : 'Sobreviva ao apocalipse nas ruínas infestadas por infectados, cuspidores tóxicos e um Colosso voraz.'}
            </p>

            {bestScore > 0 && (
              <p className="text-xs text-[var(--ember)] font-bold mb-4">
                Recorde: {bestScore.toLocaleString('pt-BR')} pontos
              </p>
            )}

            {/* Character Selection */}
            <div className="flex gap-4 justify-center mb-6">
              <button
                onClick={() => handleCharSelect('kage')}
                className={`char-card flex flex-col items-center gap-1.5 w-32 py-3 px-2 rounded-xl border-2 transition-all cursor-pointer ${
                  charId === 'kage'
                    ? 'on border-[var(--ember)] bg-[rgba(242,166,90,0.25)] shadow-[0_0_16px_rgba(242,166,90,0.4)] scale-105'
                    : 'border-[rgba(239,230,210,0.2)] bg-[rgba(22,18,31,0.6)] opacity-70 hover:opacity-90'
                }`}
              >
                <span className="font-serif text-3xl font-bold text-[var(--ember)] leading-tight">影</span>
                <img
                  src={ICON_URLS.kage_portrait}
                  alt="Kage Ninja"
                  className="w-14 h-14 rounded-full border-2 border-[var(--torii)] object-cover shadow-md"
                />
                <span className="text-xs font-bold text-[var(--paper)]">Kage (Ninja)</span>
                <span className="text-[10px] text-[var(--ember)] font-medium">Katana & Shuriken</span>
              </button>
              <button
                onClick={() => handleCharSelect('bravo')}
                className={`char-card flex flex-col items-center gap-1.5 w-32 py-3 px-2 rounded-xl border-2 transition-all cursor-pointer ${
                  charId === 'bravo'
                    ? 'on border-[var(--ember)] bg-[rgba(242,166,90,0.25)] shadow-[0_0_16px_rgba(242,166,90,0.4)] scale-105'
                    : 'border-[rgba(239,230,210,0.2)] bg-[rgba(22,18,31,0.6)] opacity-70 hover:opacity-90'
                }`}
              >
                <span className="font-serif text-3xl font-bold text-[var(--ember)] leading-tight">兵</span>
                <img
                  src={ICON_URLS.bravo_portrait}
                  alt="Bravo Soldier"
                  className="w-14 h-14 rounded-full border-2 border-[#5a7848] object-cover shadow-md"
                />
                <span className="text-xs font-bold text-[var(--paper)]">Bravo (Soldier)</span>
                <span className="text-[10px] text-[#8ab870] font-medium">Fuzil & Bazuca</span>
              </button>
            </div>

            {/* Instructions list with touch camera explanation */}
            <div className="text-left text-xs bg-[rgba(22,18,31,0.6)] border border-[rgba(239,230,210,0.15)] rounded-lg p-3.5 mb-6 max-w-sm mx-auto space-y-1.5 text-[var(--paper)]/85">
              <div className="text-[var(--ember)] font-bold mb-1">🎮 Controles & Rotação Automática:</div>
              <div>• <b>Mover:</b> arraste no analógico esquerdo. O personagem vira para onde você apontar e a câmera acompanha o trajeto.</div>
              <div>• <b>Câmera:</b> gira junto automaticamente ao mover, ou arraste com o polegar direito para ajuste livre.</div>
              <div>• <b>Atacar:</b> segure o botão de ataque para mirar e golpear.</div>
              <div>• <b>Recentralizar:</b> toque no ícone da bússola para virar a câmera para frente.</div>
              <div>• <b>No PC:</b> WASD para mover, Mouse para câmera, Clique para atacar, Espaço para pular, Shift para esquiva.</div>
            </div>

            <p className="text-xs text-[var(--paper)]/60">Toque em um personagem acima para começar</p>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'over' && (
        <div className="fixed inset-0 flex items-center justify-center bg-[rgba(22,18,31,0.85)] backdrop-blur-md p-6 z-30">
          <div className="max-w-md w-full text-center py-4">
            <div className="font-serif text-8xl font-bold text-[var(--torii)] leading-none mb-3">散</div>
            <h2 className="font-serif text-3xl font-extrabold text-[var(--paper)] mb-2">Você caiu</h2>
            <p className="text-sm text-[var(--paper)]/85 mb-6 leading-relaxed">
              Pontuação Final: <b className="text-[var(--ember)]">{score.toLocaleString('pt-BR')}</b> pontos
              <br />
              Recorde: {bestScore.toLocaleString('pt-BR')} pontos
            </p>
            <button
              onClick={handleStartGame}
              className="font-serif font-extrabold text-lg bg-[var(--torii)] text-[var(--paper)] px-10 py-3.5 rounded-md hover:brightness-110 active:scale-95 transition-all shadow-lg cursor-pointer"
            >
              Recomeçar
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 z-40">
          <div className="bg-[var(--ink)] border border-[rgba(239,230,210,0.3)] rounded-xl max-w-sm w-full p-5 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-[var(--ember)] mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" /> Configurações de Rotação
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

              <div className="pt-1 border-t border-[rgba(239,230,210,0.1)]">
                <label className="block mb-2 font-bold">
                  Arma Secundária <span className="font-normal text-[var(--paper)]/60">(botão onde era Pular)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(engineRef.current?.weapons || (charId === 'kage' ? WEAPONS_KAGE : WEAPONS_BRAVO)).map(
                    (w: WeaponDef, idx: number) => (
                      <button
                        key={w.id}
                        onClick={() => setSecondaryWeaponIdx(idx)}
                        className={`w-9 h-9 rounded-full border flex items-center justify-center p-1 transition-all cursor-pointer ${
                          secondaryWeaponIdx === idx
                            ? 'border-[var(--ember)] bg-[rgba(242,166,90,0.28)] scale-105'
                            : 'border-[rgba(239,230,210,0.25)] bg-[rgba(22,18,31,0.6)]'
                        }`}
                        title={w.name}
                      >
                        {ICON_URLS[w.id] && (
                          <img src={ICON_URLS[w.id]} alt={w.name} className="w-full h-full object-contain pointer-events-none" />
                        )}
                      </button>
                    )
                  )}
                </div>
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
              <RotateCcw className="w-4 h-4" /> Voltar para Seleção de Personagem
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
