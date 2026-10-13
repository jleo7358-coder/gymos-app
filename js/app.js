// App shell: tab bar, navigation stacks, floating timer, ticking, recovery, wake lock.

import * as DB from './db.js';
import { Engine, Rest, S, bus, changed } from './engine.js';
import { nav } from './nav.js';
import {
  View, icon, patch, installDelegation, initModals, renderModals, alert, toast, hasModals, dismissAll,
} from './ui.js';
import { fmt, esc, clamp } from './util.js';
import { scheduleChime, cancelChime, chimeNow, unlock, chimeScheduledFor } from './sound.js';
import { CalendarScreen } from './views/calendar.js';
import { WorkoutScreen } from './views/workout.js';
import { HistoryScreen } from './views/history.js';
import { BodyScreen } from './views/body.js';
import { ProfileScreen } from './views/profile.js';
import { startRest } from './views/common.js';

const TABS = [
  { key: 'calendar', label: 'Calendar', icon: 'calendar', make: () => new CalendarScreen() },
  { key: 'workout', label: 'Workout', icon: 'dumbbell', make: () => new WorkoutScreen() },
  { key: 'history', label: 'History', icon: 'history', make: () => new HistoryScreen() },
  { key: 'body', label: 'Body', icon: 'body', make: () => new BodyScreen() },
  { key: 'profile', label: 'Profile', icon: 'person', make: () => new ProfileScreen() },
];

const stacks = {};
const pageEls = {};
let current = 'calendar';
let root, tabBar, floatEl;
let renderQueued = false;

// ---------------------------------------------------------------------------------
// Rendering

function screenHTML(screen, depth) {
  const body = screen.render(); // may update screen.title
  const back = depth > 0 ? `<button class="nav-btn back" data-act="__back" aria-label="Back">${icon.back}</button>` : '';
  const nav = screen.hideNav ? '' : `<header class="navbar"><div class="nav-side left">${back}</div><div class="nav-title">${esc(screen.title)}</div><div class="nav-side right">${screen.navRight()}</div></header>`;
  return `${nav}<div class="screen-body ${screen.hideNav ? 'no-nav' : ''}">${body}</div>`;
}

function renderScreen(tabKey) {
  const stack = stacks[tabKey];
  const screen = stack[stack.length - 1];
  const el = screen._el;
  if (!el) return;
  patch(el, screenHTML(screen, stack.length - 1));
  if (!screen._mounted) { screen._mounted = true; if (screen.mounted) screen.mounted(el.querySelector('.screen-body')); }
}

function renderTabBar() {
  patch(tabBar, TABS.map((t) => `<button class="tab ${t.key === current ? 'on' : ''}" data-tab="${t.key}" aria-label="${t.label}">${icon[t.icon]}<span>${t.label}</span></button>`).join(''));
}

export function render() {
  renderQueued = false;
  renderScreen(current);
  renderTabBar();
  renderModals();
  renderFloat();
  applyWakeLock();
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function mountScreen(tabKey, screen, animate) {
  const page = pageEls[tabKey];
  const el = document.createElement('div');
  el.className = 'screen' + (animate ? ' push-in' : '');
  el.setAttribute('data-view', screen.id);
  screen._el = el;
  const stack = stacks[tabKey];
  const prev = stack[stack.length - 1];
  stack.push(screen);
  page.appendChild(el);
  renderScreen(tabKey);
  if (prev && prev._el) {
    if (animate) { prev._el.classList.add('push-out'); setTimeout(() => { prev._el.classList.add('hidden'); prev._el.classList.remove('push-out'); }, 300); }
    else prev._el.classList.add('hidden');
  }
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('push-in')));
}

function popScreen(tabKey, animate = true) {
  const stack = stacks[tabKey];
  if (stack.length <= 1) return;
  const top = stack.pop();
  const prev = stack[stack.length - 1];
  prev._el.classList.remove('hidden');
  renderScreen(tabKey);
  if (animate) {
    top._el.classList.add('pop-out');
    setTimeout(() => top._el.remove(), 300);
  } else top._el.remove();
  top.destroy();
}

function switchTab(key, popToRoot = false) {
  if (popToRoot) while (stacks[key].length > 1) popScreen(key, false);
  if (key !== current) {
    pageEls[current].classList.remove('active');
    current = key;
    pageEls[current].classList.add('active');
    nav.currentTab = key;
  } else if (!popToRoot && stacks[key].length > 1) {
    // Tapping the active tab returns to its root, like iOS.
    while (stacks[key].length > 1) popScreen(key, false);
  }
  render();
}

Object.assign(nav, {
  push(screen) { mountScreen(current, screen, true); renderModals(); renderFloat(); },
  pop() { popScreen(current); },
  popToRoot() { while (stacks[current].length > 1) popScreen(current, false); render(); },
  switchTab,
  refresh: queueRender,
  topScreen() { const s = stacks[current]; return s[s.length - 1]; },
});

// ---------------------------------------------------------------------------------
// Floating timer widget: workout elapsed + rest countdown. Draggable, minimisable.

class FloatView extends View {
  constructor() {
    super();
    this.actions = {
      min: () => { DB.updateSettings({ timerWidgetMinimized: true }); renderFloat(); },
      expand: () => { DB.updateSettings({ timerWidgetMinimized: false }); renderFloat(); },
      plus30: () => { Rest.add(30); if (DB.settings().restAlertEnabled) scheduleChime(Rest.raw.end); },
      stopRest: () => { Rest.stop(); cancelChime(); },
      rest: () => startRest(),
      open: () => { if (current !== 'workout') switchTab('workout', true); },
    };
  }
  render() {
    const s = Engine.active;
    if (!s) return '';
    const st = DB.settings();
    const now = Date.now();
    const resting = Rest.isActive;
    const remaining = Rest.remaining(now);
    const finished = Rest.isFinished(now);
    if (st.timerWidgetMinimized) {
      return `<button class="ft-mini ${resting ? (finished ? 'done' : 'resting') : ''}" data-act="expand">${fmt.duration(resting ? remaining : Engine.elapsed(s, now))}</button>`;
    }
    return `<div class="ft-card">
      <div class="ft-top" data-act="open"><div><div class="ft-label">WORKOUT</div><div class="ft-elapsed num">${fmt.duration(Engine.elapsed(s, now))}</div></div>
        <button class="ft-min" data-act="min" aria-label="Minimise">${icon.minus}</button></div>
      ${resting ? `<div class="ft-rest"><div class="ft-label ${finished ? 'text-completed' : 'text-partial'}">${finished ? 'REST DONE' : 'REST'}</div>
        <div class="ft-remaining num ${finished ? 'text-completed' : ''}">${fmt.duration(remaining)}</div>
        <div class="ft-btns"><button class="ft-small" data-act="plus30">+30</button><button class="ft-small" data-act="stopRest" aria-label="Stop rest">${icon.close}</button></div></div>`
        : `<button class="ft-small wide" data-act="rest">Rest ${fmt.duration(st.defaultRestSeconds)}</button>`}
    </div>`;
  }
}
const floatView = new FloatView();

function renderFloat() {
  const show = !!Engine.active && !hasModals();
  floatEl.classList.toggle('hidden', !show);
  if (!show) return;
  const st = DB.settings();
  patch(floatEl.firstElementChild, floatView.render());
  if (!dragging) positionFloat(st.timerWidgetX, st.timerWidgetY);
}

function positionFloat(nx, ny) {
  const w = floatEl.offsetWidth || 128, h = floatEl.offsetHeight || 100;
  const W = window.innerWidth, H = window.innerHeight;
  const x = clamp(nx * W - w / 2, 6, W - w - 6);
  const y = clamp(ny * H - h / 2, 50, H - h - 70);
  floatEl.style.transform = `translate(${x}px, ${y}px)`;
}

let dragging = null;
function installFloatDrag() {
  floatEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && !e.target.closest('.ft-mini') && !e.target.closest('.ft-top')) return;
    const r = floatEl.getBoundingClientRect();
    dragging = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = e.clientX - dragging.sx, dy = e.clientY - dragging.sy;
    if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
    dragging.moved = true;
    floatEl.style.transform = `translate(${dragging.ox + dx}px, ${dragging.oy + dy}px)`;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('pointerup', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const d = dragging; dragging = null;
    if (!d.moved) return;
    const r = floatEl.getBoundingClientRect();
    const nx = clamp((r.left + r.width / 2) / window.innerWidth, 0.12, 0.88);
    const ny = clamp((r.top + r.height / 2) / window.innerHeight, 0.06, 0.92);
    DB.updateSettings({ timerWidgetX: nx, timerWidgetY: ny });
    positionFloat(nx, ny);
    // Swallow the click that ends a drag.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
  });
}

// ---------------------------------------------------------------------------------
// Ticking (1 s): elapsed time, rest countdown, rest-complete chime

function tick() {
  const s = Engine.active;
  if (s) {
    const el = document.querySelectorAll('[data-tick="elapsed"]');
    el.forEach((n) => { n.textContent = fmt.duration(Engine.elapsed(s)); });
    if (!hasModals()) renderFloat();
  }
  const r = Rest.raw;
  if (r && r.end) {
    if (Date.now() >= r.end && !r.alerted) {
      Rest.markAlerted();
      if (document.visibilityState === 'visible') {
        if (DB.settings().restAlertEnabled && !chimeScheduledFor(r.end)) { cancelChime(); chimeNow(); }
        document.body.classList.add('rest-flash');
        setTimeout(() => document.body.classList.remove('rest-flash'), 2600);
      }
    }
    Rest.clearIfExpired(10);
  }
}

// ---------------------------------------------------------------------------------
// Keep the screen awake during a workout (if enabled)

let wakeLock = null;
let wakePending = false;
async function applyWakeLock() {
  const want = !!Engine.active && DB.settings().keepAwakeDuringWorkout && document.visibilityState === 'visible';
  if (wakePending) return;
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakePending = true;
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!want && wakeLock) {
      wakePending = true;
      const lock = wakeLock; wakeLock = null;
      await lock.release();
    }
  } catch { /* not supported or denied */ }
  finally {
    wakePending = false;
  }
  // State may have changed while the request was in flight.
  const stillWant = !!Engine.active && DB.settings().keepAwakeDuringWorkout && document.visibilityState === 'visible';
  if (stillWant !== !!wakeLock && navigator.wakeLock) setTimeout(applyWakeLock, 0);
}

// ---------------------------------------------------------------------------------
// Boot

function showRecovery() {
  const s = Engine.pendingRecovery;
  if (!s) return;
  alert('Active workout found', `${s.routineName} started ${fmt.time(s.startDate)} — ${S.completedSets(s)}/${S.totalSets(s)} sets done. Resume?`, [
    { label: 'Resume', handler: () => { Engine.resumeRecovered(); switchTab('workout', true); } },
    { label: 'Finish as-is', handler: () => Engine.finishRecovered() },
    { label: 'Discard', role: 'destructive', handler: () => Engine.discardRecovered() },
  ]);
}

export async function boot() {
  root = document.getElementById('app');
  const pages = document.getElementById('pages');
  tabBar = document.getElementById('tabbar');
  floatEl = document.getElementById('float-timer');
  floatEl.innerHTML = `<div data-view="${floatView.id}"></div>`;

  try { await DB.open(); }
  catch (e) {
    document.getElementById('boot-error').textContent = `GymOS couldn't open its storage: ${e.message || e}. Close other GymOS windows and reopen.`;
    document.getElementById('boot-error').hidden = false;
    return;
  }

  installDelegation(document.body);
  initModals(document.getElementById('modals'), () => { renderFloat(); });

  for (const t of TABS) {
    const page = document.createElement('section');
    page.className = 'page' + (t.key === current ? ' active' : '');
    pages.appendChild(page);
    pageEls[t.key] = page;
    stacks[t.key] = [];
    mountScreen(t.key, t.make(), false);
  }
  tabBar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { unlock(); switchTab(b.dataset.tab); } });
  installFloatDrag();
  installEdgeSwipe(pages);

  Engine.loadOnLaunch();
  bus.addEventListener('change', queueRender);
  bus.addEventListener('rest', (e) => { if (e.detail === 'stop') cancelChime(); });
  window.addEventListener('gymos-save-error', () => toast("Couldn't save — storage error. Export a backup.", 'bad'));
  window.addEventListener('resize', queueRender);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (Engine.active) DB.setKV('lastActive', Date.now());
      DB.flush();
    } else {
      Rest.clearIfExpired(60);
      // A new day may have started while the app was in the background.
      changed();
    }
    applyWakeLock();
  });
  window.addEventListener('pagehide', () => { if (Engine.active) DB.setKV('lastActive', Date.now()); });

  if (Engine.active) current = 'workout';
  for (const t of TABS) pageEls[t.key].classList.toggle('active', t.key === current);
  nav.currentTab = current;
  render();
  document.getElementById('splash')?.remove();
  setInterval(tick, 1000);
  if (Engine.pendingRecovery) showRecovery();
  // Re-arm a rest chime that was running before a reload.
  if (Rest.isActive && !Rest.isFinished() && DB.settings().restAlertEnabled) document.addEventListener('pointerdown', () => { unlock(); scheduleChime(Rest.raw.end); }, { once: true });
}

// iOS-style swipe from the left edge to go back.
function installEdgeSwipe(pages) {
  let start = null;
  pages.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX < 22 && stacks[current].length > 1 && !hasModals()) start = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  pages.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    if (t.clientX - start.x > 80 && Math.abs(t.clientY - start.y) < 80) popScreen(current);
    start = null;
  }, { passive: true });
}

export { dismissAll };
