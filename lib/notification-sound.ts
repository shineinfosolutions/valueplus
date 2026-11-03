/**
 * A short two-tone chime for a new notification while the app is open. It is made
 * with the browser's audio (no sound file). Browsers only allow sound after the person
 * has touched the screen once, so the first tap or key press unlocks it.
 */

let ctx: AudioContext | null = null;
let listening = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Call once: the first touch / click / key press makes sound allowed from then on. */
export function installSoundUnlock() {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") void c.resume();
    ["pointerdown", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, unlock));
  };
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, unlock, { passive: true }));
}

let lastPlayed = 0;

export function playNotificationSound() {
  // Several notifications arriving together make one chime, not a burst.
  if (Date.now() - lastPlayed < 1500) return;
  lastPlayed = Date.now();
  const c = audio();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume();
    const start = c.currentTime + 0.02;
    [
      { freq: 880, at: 0 },
      { freq: 1318.5, at: 0.18 },
    ].forEach(({ freq, at }) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.35, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.32);
      osc.connect(gain).connect(c.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.35);
    });
  } catch {
    /* no sound is better than an error */
  }
}
