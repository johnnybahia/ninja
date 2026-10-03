import { useSyncExternalStore } from 'react';

// Offline play (see scripts/sw.template.js): the service worker stores the whole game on the first
// visit. This module registers it, follows the download, offers the install button and the
// "new version" prompt. Nothing here runs in dev (no sw.js there).

export interface PwaState {
  supported: boolean; // a service worker is running (not in dev, private tabs or plain http)
  phase: 'idle' | 'downloading' | 'ready'; // idle: not known yet
  pct: number; // download progress, 0-100
  update: boolean; // a newer version is installed and waiting for the player's OK
  installable: boolean; // the browser offered "install"; install() opens its dialog
  standalone: boolean; // already running as the installed app
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standaloneNow = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

let state: PwaState = { supported: false, phase: 'idle', pct: 0, update: false, installable: false, standalone: standaloneNow() };
const listeners = new Set<() => void>();
const set = (p: Partial<PwaState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

let deferred: InstallEvent | null = null;
if (typeof window !== 'undefined') {
  // kept for our own button (the browser's own menu entry keeps working too)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    set({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ installable: false, standalone: true });
  });
}

export const isIos = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export async function installApp() {
  if (!deferred) return;
  const ev = deferred;
  deferred = null;
  set({ installable: false });
  try {
    await ev.prompt();
    await ev.userChoice;
  } catch {
    /* dismissed */
  }
}

/** Switches to the waiting version and reloads once it has taken over. */
export async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    if (!reg?.waiting) return location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    location.reload();
  }
}

function onMessage(e: MessageEvent) {
  const d = e.data as { type?: string; done?: number; total?: number; fresh?: boolean; missing?: number } | null;
  if (!d || !d.type) return;
  if (d.type === 'progress' && d.fresh && d.total) {
    const pct = Math.round(((d.done ?? 0) / d.total) * 100);
    set(pct >= 100 ? { phase: 'ready', pct: 100 } : { phase: 'downloading', pct });
  } else if (d.type === 'status' && d.total) {
    set(d.missing ? { phase: 'downloading', pct: Math.round(((d.total - d.missing) / d.total) * 100) } : { phase: 'ready', pct: 100 });
  } else if (d.type === 'ready') {
    // the active worker finished installing/activating: ask what is stored, to be sure
    void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then((r) => r?.active?.postMessage({ type: 'STATUS' }));
  }
}

async function start() {
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    set({ supported: true });
    navigator.serviceWorker.addEventListener('message', onMessage);
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) set({ update: true });
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) set({ update: true });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    void navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'STATUS' }));
    // an installed app stays open for long: look for a new version when it comes back to the front
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => {});
    });
  } catch {
    /* no service worker here: the game just needs the connection, as before */
  }
}

/** Registers the service worker a few seconds after the page loaded, so the game's own loading goes first. */
export function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const go = () => setTimeout(() => void start(), 3000);
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const usePwa = (): PwaState => useSyncExternalStore(subscribe, () => state);
