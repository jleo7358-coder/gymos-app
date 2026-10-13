// Rest-complete chime. Web apps can't post notifications on their own schedule, so the
// rest alert is a sound played while GymOS is open (the audio is unlocked by the START REST tap).

let ctx = null;
let scheduled = [];
let scheduledFor = null;

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state !== 'running') ctx.resume();
    // A silent blip keeps iOS from blocking later playback.
    const o = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0.0001; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.02);
  } catch {}
}

function tone(at, freq, dur) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at); o.stop(at + dur + 0.05);
  return o;
}

/** Schedule the chime for an absolute time (ms). Replaces any previous schedule. */
export function scheduleChime(atMs) {
  cancelChime();
  if (!ctx) return false;
  try {
    if (ctx.state !== 'running') ctx.resume();
    const delay = Math.max(0, (atMs - Date.now()) / 1000);
    const t = ctx.currentTime + delay;
    scheduled = [tone(t, 880, 0.18), tone(t + 0.22, 880, 0.18), tone(t + 0.44, 1175, 0.35)];
    scheduledFor = atMs;
    return true;
  } catch { return false; }
}

export function cancelChime() {
  for (const o of scheduled) { try { o.stop(); } catch {} }
  scheduled = [];
  scheduledFor = null;
}

/** True when a chime for this end time was scheduled while audio was running. */
export function chimeScheduledFor(atMs) {
  return scheduledFor === atMs && !!ctx && ctx.state === 'running';
}

export function chimeNow() {
  if (!ctx) return;
  try { if (ctx.state !== 'running') ctx.resume(); const t = ctx.currentTime + 0.01; tone(t, 880, 0.18); tone(t + 0.22, 880, 0.18); tone(t + 0.44, 1175, 0.35); } catch {}
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch {}
}
