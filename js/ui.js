// Small UI toolkit: views with event delegation, DOM patching, sheets, alerts,
// action menus, the weight keypad, the reps wheel, charts and file saving.

import { esc, fmt, clamp, parseDecimal } from './util.js';
import * as DB from './db.js';

// ---------------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor)

const svg = (d, extra = '') => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  calendar: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
  dumbbell: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>'),
  body: svg('<circle cx="12" cy="4.5" r="2.2"/><path d="M5 9h14M12 9v6M12 15l-3.5 6.5M12 15l3.5 6.5"/>'),
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  back: svg('<path d="M15 4.5 7.5 12l7.5 7.5"/>', 'stroke-width="2.6"'),
  chevron: svg('<path d="m9 5 7 7-7 7"/>'),
  chevronLeft: svg('<path d="m15 5-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  check: svg('<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="m7.5 12.3 3 3 6-6.3" stroke="#000" stroke-width="2.4"/>'),
  circle: svg('<circle cx="12" cy="12" r="9.5"/>', 'stroke-width="1.6"'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  list: svg('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M7.5 9h9M7.5 12.5h9M7.5 16h5"/>'),
  text: svg('<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>'),
  strength: svg('<path d="M4 15.5 8.5 11M15.5 4 11 8.5M7 18l-3.5-3.5M18 7l-3.5-3.5M9 13l4-4M3 21l2-2M19 5l2-2"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  backspace: svg('<path d="M9 5h11v14H9l-6-7z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/>'),
  share: svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7.5h14V12"/>'),
  download: svg('<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1 6.1L12 17.2 6.6 20l1-6.1L3.1 9.5l6.2-.9z"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  swap: svg('<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'),
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  trendUp: svg('<path d="M4 17 10 11l4 4 6-6"/><path d="M15 9h5v5"/>', 'stroke-width="2.4"'),
  trendDown: svg('<path d="M4 7l6 6 4-4 6 6"/><path d="M15 15h5v-5"/>', 'stroke-width="2.4"'),
  trendFlat: svg('<path d="M5 12h14"/>', 'stroke-width="2.4"'),
};

// ---------------------------------------------------------------------------------
// DOM patching (keeps scroll position and focused inputs intact)

function syncAttributes(from, to) {
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
}

function morphNode(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName ||
      (from.nodeType === 1 && (from.getAttribute('data-key') || '') !== (to.getAttribute('data-key') || ''))) {
    from.replaceWith(to.cloneNode(true));
    return;
  }
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.hasAttribute && from.hasAttribute('data-static') && to.hasAttribute('data-static')) return;
  syncAttributes(from, to);
  const focused = document.activeElement === from;
  if (from.tagName === 'INPUT') {
    if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
    else if (!focused && from.value !== (to.getAttribute('value') ?? '')) from.value = to.getAttribute('value') ?? '';
    return;
  }
  if (from.tagName === 'TEXTAREA') {
    if (!focused && from.value !== to.textContent) from.value = to.textContent;
    return;
  }
  morphChildren(from, to);
  if (from.tagName === 'SELECT') {
    const sel = to.querySelector('option[selected]');
    const v = sel ? sel.getAttribute('value') : (to.querySelector('option')?.getAttribute('value') ?? '');
    if (from.value !== v) from.value = v;
  }
}

function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    if (i < a.length) morphNode(a[i], b[i]);
    else from.appendChild(b[i].cloneNode(true));
  }
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}

export function patch(container, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const tmp = document.createElement(container.tagName);
  tmp.append(tpl.content);
  morphChildren(container, tmp);
}

// ---------------------------------------------------------------------------------
// Views & event delegation

let seq = 0;
export const registry = new Map();

export class View {
  constructor() { this.id = 'v' + (++seq); this.actions = {}; this.inputs = {}; this.changes = {}; registry.set(this.id, this); }
  render() { return ''; }
  destroy() { registry.delete(this.id); }
}

function viewFor(el) {
  const host = el.closest('[data-view]');
  return host ? registry.get(host.getAttribute('data-view')) : null;
}

let suppressClickUntil = 0;

export function installDelegation(root) {
  // The click that follows a long-press must not reach the menu/sheet that just opened
  // (iOS delivers it to whatever is now under the finger).
  window.addEventListener('click', (ev) => {
    if (Date.now() < suppressClickUntil) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const view = viewFor(el);
    const fn = view && view.actions[el.getAttribute('data-act')];
    if (fn) { ev.preventDefault(); fn.call(view, el, ev); }
  });
  const handle = (kind) => (ev) => {
    const attr = kind === 'input' ? 'data-input' : 'data-change';
    const el = ev.target.closest(`[${attr}]`);
    if (!el) return;
    const view = viewFor(el);
    const map = view && (kind === 'input' ? view.inputs : view.changes);
    const fn = map && map[el.getAttribute(attr)];
    if (fn) fn.call(view, el, ev);
  };
  root.addEventListener('input', handle('input'));
  root.addEventListener('change', handle('change'));

  // Long press → data-longpress action
  let lp = null;
  root.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest('[data-longpress]');
    if (!el) return;
    const x = ev.clientX, y = ev.clientY;
    lp = { el, x, y, timer: setTimeout(() => {
      const view = viewFor(el);
      const fn = view && view.actions[el.getAttribute('data-longpress')];
      if (fn) { suppressClickUntil = Date.now() + 700; fn.call(view, el, ev); }
      lp = null;
    }, 550) };
  });
  const cancel = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('pointermove', (ev) => { if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 10) cancel(); });
  root.addEventListener('scroll', cancel, true);
  root.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-longpress]')) ev.preventDefault(); });
}

// ---------------------------------------------------------------------------------
// Modal layer: sheets, alerts, menus

const modals = [];
let modalRoot = null;
let onModalsChanged = () => {};
export function initModals(root, onChange) { modalRoot = root; onModalsChanged = onChange; }

export function renderModals() {
  for (const m of modals) {
    const body = m.el.querySelector('[data-view]');
    patch(body, m.view.render());
  }
}

/** opts: { height: 'auto'|'large'|number, dismissable } */
export function presentSheet(view, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal sheet-wrap';
  const h = opts.height === 'large' ? 'sheet-large' : opts.height === 'full' ? 'sheet-full' : '';
  wrap.innerHTML = `<div class="backdrop" data-close></div><div class="sheet ${h}"><div class="grabber"></div><div class="sheet-body" data-view="${view.id}"></div></div>`;
  modalRoot.appendChild(wrap);
  const entry = { el: wrap, view, opts };
  modals.push(entry);
  view.close = () => dismiss(entry);
  patch(wrap.querySelector('[data-view]'), view.render());
  if (view.mounted) view.mounted(wrap.querySelector('[data-view]'));
  wrap.querySelector('[data-close]').addEventListener('click', () => { if (opts.dismissable !== false) dismiss(entry); });
  attachSheetDrag(wrap, entry);
  requestAnimationFrame(() => wrap.classList.add('open'));
  onModalsChanged();
  return view;
}

function attachSheetDrag(wrap, entry) {
  const sheet = wrap.querySelector('.sheet');
  const grab = wrap.querySelector('.grabber');
  let startY = null, dy = 0;
  grab.addEventListener('pointerdown', (e) => { startY = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  grab.addEventListener('pointermove', (e) => { if (startY == null) return; dy = Math.max(0, e.clientY - startY); sheet.style.transform = `translateY(${dy}px)`; });
  const end = () => {
    if (startY == null) return;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 90 && entry.opts.dismissable !== false) dismiss(entry);
    startY = null;
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

export function dismiss(entry) {
  const i = modals.indexOf(entry);
  if (i < 0) return;
  modals.splice(i, 1);
  entry.el.classList.remove('open');
  entry.el.classList.add('closing');
  setTimeout(() => entry.el.remove(), 260);
  if (entry.view.onDismiss) entry.view.onDismiss();
  entry.view.destroy();
  onModalsChanged();
}
export function dismissAll() { while (modals.length) dismiss(modals[modals.length - 1]); }
export const hasModals = () => modals.length > 0;

class AlertView extends View {
  constructor(opts) { super(); this.opts = opts; this.actions.btn = (el) => this.press(Number(el.dataset.i)); }
  render() {
    const { title, message, buttons } = this.opts;
    const stacked = buttons.length > 2;
    return `<div class="alert-title">${esc(title)}</div>${message ? `<div class="alert-msg">${esc(message).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="alert-buttons ${stacked ? 'stacked' : ''}">${buttons.map((b, i) => `<button class="alert-btn ${b.role || ''}" data-act="btn" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
  }
  press(i) { const b = this.opts.buttons[i]; this.close(); if (b && b.handler) b.handler(); }
}

/** buttons: [{label, role: 'cancel'|'destructive'|'default', handler}] */
export function alert(title, message, buttons = [{ label: 'OK' }]) {
  const view = new AlertView({ title, message, buttons });
  const wrap = document.createElement('div');
  wrap.className = 'modal alert-wrap';
  wrap.innerHTML = `<div class="backdrop"></div><div class="alert" data-view="${view.id}"></div>`;
  modalRoot.appendChild(wrap);
  const entry = { el: wrap, view, opts: { dismissable: false } };
  modals.push(entry);
  view.close = () => dismiss(entry);
  patch(wrap.querySelector('[data-view]'), view.render());
  requestAnimationFrame(() => wrap.classList.add('open'));
  onModalsChanged();
}
export function confirm(title, message, confirmLabel, onConfirm, destructive = true) {
  alert(title, message, [{ label: 'Cancel', role: 'cancel' }, { label: confirmLabel, role: destructive ? 'destructive' : 'default', handler: onConfirm }]);
}

class MenuView extends View {
  constructor(title, items) { super(); this.title = title; this.items = items; this.actions.pick = (el) => { const it = this.items[Number(el.dataset.i)]; this.close(); if (it && it.handler) it.handler(); }; this.actions.cancel = () => this.close(); }
  render() {
    return `<div class="menu-card">${this.title ? `<div class="menu-title">${esc(this.title)}</div>` : ''}${this.items.map((it, i) =>
      `<button class="menu-item ${it.destructive ? 'destructive' : ''}" data-act="pick" data-i="${i}">${it.icon ? icon[it.icon] : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>
      <button class="menu-cancel" data-act="cancel">Cancel</button>`;
  }
}
/** items: [{label, icon?, destructive?, handler}] */
export function menu(items, title = '') {
  const view = new MenuView(title, items.filter(Boolean));
  const wrap = document.createElement('div');
  wrap.className = 'modal menu-wrap';
  wrap.innerHTML = `<div class="backdrop" data-close></div><div class="menu" data-view="${view.id}"></div>`;
  modalRoot.appendChild(wrap);
  const entry = { el: wrap, view, opts: {} };
  modals.push(entry);
  view.close = () => dismiss(entry);
  patch(wrap.querySelector('[data-view]'), view.render());
  wrap.querySelector('[data-close]').addEventListener('click', () => dismiss(entry));
  requestAnimationFrame(() => wrap.classList.add('open'));
  onModalsChanged();
}

let toastTimer = null;
export function toast(text, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = `toast show ${kind}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ---------------------------------------------------------------------------------
// Common fragments

export function sheetHeader(title, { left = 'Cancel', right = null, rightDisabled = false, leftAct = 'cancel', rightAct = 'done' } = {}) {
  return `<div class="sheet-header">
    <button class="link-btn" data-act="${leftAct}">${left ? esc(left) : ''}</button>
    <div class="sheet-title">${esc(title)}</div>
    <button class="link-btn strong" data-act="${rightAct}" ${rightDisabled ? 'disabled' : ''}>${right ? esc(right) : ''}</button>
  </div>`;
}

export function pill(text, cls) { return `<span class="pill ${cls}">${esc(text)}</span>`; }

export function statTile(label, value, sub = null, cls = '') {
  return `<div class="tile ${cls}"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ''}</div>`;
}

export function trendBadge(trend, higherIsBetter = null) {
  const ic = trend.dir === 'up' ? icon.trendUp : trend.dir === 'down' ? icon.trendDown : icon.trendFlat;
  let cls = 'neutral';
  if (higherIsBetter != null && trend.dir !== 'neutral') cls = (trend.dir === 'up') === higherIsBetter ? 'good' : 'bad';
  return `<span class="trend ${cls}">${ic}<span>${esc(trend.text)}</span></span>`;
}

export function emptyState(title, message, ic = 'list') {
  return `<div class="empty">${icon[ic] || ''}<div class="empty-title">${esc(title)}</div><div class="empty-msg">${esc(message)}</div></div>`;
}

export function stepper(label, value, act, min, max) {
  return `<div class="row stepper-row"><span>${esc(label)}</span><div class="stepper">
    <button class="step-btn" data-act="${act}" data-d="-1" ${value <= min ? 'disabled' : ''}>${icon.minus}</button>
    <button class="step-btn" data-act="${act}" data-d="1" ${value >= max ? 'disabled' : ''}>${icon.plus}</button></div></div>`;
}

export function toggle(label, on, change, sub = '') {
  return `<label class="row toggle-row"><span class="grow">${esc(label)}${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    <input type="checkbox" class="switch" data-change="${change}" ${on ? 'checked' : ''}></label>`;
}

// ---------------------------------------------------------------------------------
// Line chart (plain X/Y, one colour)

function niceTicks(min, max, count = 4) {
  if (min === max) { const pad = Math.abs(min) * 0.05 || 1; min -= pad; max += pad; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks };
}

export function lineChart(points, { unit = '', decimals = 1, includeZero = false, color = 'var(--accent)' } = {}) {
  if (points.length < 2) return `<div class="chart-empty">Not enough data for a chart yet.</div>`;
  const W = Math.round(clamp(window.innerWidth, 320, 640) - 58), H = 160;
  const padL = 40, padR = 8, padT = 8, padB = 22;
  const xs = points.map((p) => +p.date), ys = points.map((p) => p.value);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (includeZero) minY = Math.min(0, minY);
  const { lo, hi, ticks } = niceTicks(minY, maxY);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const sx = (x) => padL + (maxX === minX ? (W - padL - padR) / 2 : ((x - minX) / (maxX - minX)) * (W - padL - padR));
  const sy = (y) => padT + (hi === lo ? (H - padT - padB) / 2 : (1 - (y - lo) / (hi - lo)) * (H - padT - padB));
  const grid = ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${padL - 6}" y="${sy(t) + 3.5}" class="axis" text-anchor="end">${esc(fmt.number(t, decimals))}</text>`).join('');
  const nX = Math.min(4, points.length);
  const xl = [];
  for (let i = 0; i < nX; i++) {
    const x = minX + ((maxX - minX) * i) / Math.max(1, nX - 1);
    const anchor = i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle';
    xl.push(`<text x="${sx(x)}" y="${H - 5}" class="axis" text-anchor="${anchor}">${esc(fmt.dayMonth(x))}</text>`);
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(+p.date).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p) => `<circle cx="${sx(+p.date).toFixed(1)}" cy="${sy(p.value).toFixed(1)}" r="2.6" fill="${color}"><title>${esc(fmt.dayMonth(p.date))}: ${esc(fmt.number(p.value, decimals))} ${esc(unit)}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Chart">${grid}${xl.join('')}<path d="${path}" fill="none" stroke="${color}" stroke-width="1.6"/>${dots}</svg>`;
}

// ---------------------------------------------------------------------------------
// Weight keypad (typed value, decimal support, configurable quick increments)

export class WeightKeypad extends View {
  constructor({ initial = 0, override = null, title = 'Weight', showApply = true, onDone }) {
    super();
    this.text = initial > 0 ? fmt.editable(initial) : '';
    this.override = override; this.title = title; this.showApply = showApply; this.apply = false; this.onDone = onDone;
    this.actions = {
      cancel: () => this.close(),
      key: (el) => this.key(el.dataset.k),
      inc: (el) => { const v = Math.max(0, this.value + Number(el.dataset.v)); this.text = fmt.editable(Math.round(v * 100) / 100); this.refresh(); },
      apply: () => { this.apply = !this.apply; this.refresh(); },
      done: () => { const v = Math.round(this.value * 100) / 100; this.close(); this.onDone(v, this.apply); },
    };
  }
  get value() { return parseDecimal(this.text) ?? 0; }
  key(k) {
    if (k === 'del') this.text = this.text.slice(0, -1);
    else if (k === '.') { if (!this.text.includes('.')) this.text += this.text ? '.' : '0.'; }
    else if (this.text === '0') this.text = k;
    else if (this.text.length < 7) this.text += k;
    this.refresh();
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
  render() {
    const incs = DB.signedIncrements(this.override);
    return `${sheetHeader(this.title, { right: null })}
      <div class="keypad-display"><span class="kp-value">${esc(this.text || '0')}</span><span class="kp-unit">kg</span></div>
      <div class="inc-row">${incs.map((v) => `<button class="inc-btn" data-act="inc" data-v="${v}">${v > 0 ? '+' : '−'}${esc(fmt.number(Math.abs(v), 2))}</button>`).join('')}</div>
      ${keypadGrid(true)}
      ${this.showApply ? `<button class="check-row" data-act="apply">${this.apply ? icon.check : icon.circle}<span>Apply to remaining sets of this exercise</span></button>` : ''}
      <button class="btn primary" data-act="done">Done</button>`;
  }
}

export function keypadGrid(decimal) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : '', '0', 'del'];
  return `<div class="keypad">${keys.map((k) => k === '' ? '<span></span>' : `<button class="key" data-act="key" data-k="${k}">${k === 'del' ? icon.backspace : k}</button>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------------
// Reps wheel 0–12 (+ Custom for larger values)

const ITEM_H = 44;
export class RepsPicker extends View {
  constructor({ initial = 0, target = [8, 12], onDone }) {
    super();
    this.target = target; this.onDone = onDone;
    this.custom = initial > 12;
    this.customText = initial > 12 ? String(initial) : '';
    this.selection = initial > 12 ? 13 : Math.max(0, initial);
    this.actions = {
      cancel: () => this.close(),
      key: (el) => {
        const k = el.dataset.k;
        if (k === 'del') this.customText = this.customText.slice(0, -1);
        else if (this.customText.length < 3) this.customText = this.customText === '0' ? k : this.customText + k;
        this.refresh();
      },
      back: () => { this.custom = false; this.selection = Math.min(12, parseInt(this.customText, 10) || 0); this.refresh(); this.scrollToSelection(); },
      pickItem: (el) => { const i = Number(el.dataset.i); if (i === 13) { this.custom = true; this.refresh(); } else { this.selection = i; this.scrollToSelection(true); } },
      done: () => {
        if (!this.custom) this.selection = this.readWheel();
        const reps = this.custom ? (parseInt(this.customText, 10) || 0) : this.selection === 13 ? 0 : this.selection;
        if (!this.custom && this.selection === 13) { this.custom = true; this.refresh(); return; }
        this.close(); this.onDone(Math.max(0, reps));
      },
    };
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) { patch(el, this.render()); this.bindWheel(el); } }
  readWheel() {
    const w = document.querySelector(`[data-view="${this.id}"] .wheel`);
    if (!w) return this.selection;
    return clamp(Math.round(w.scrollTop / ITEM_H), 0, 13);
  }
  scrollToSelection(smooth = false) {
    requestAnimationFrame(() => {
      const w = document.querySelector(`[data-view="${this.id}"] .wheel`);
      if (w) w.scrollTo({ top: this.selection * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
      this.highlight();
    });
  }
  highlight() {
    const w = document.querySelector(`[data-view="${this.id}"] .wheel`);
    if (!w) return;
    const i = clamp(Math.round(w.scrollTop / ITEM_H), 0, 13);
    w.querySelectorAll('.wheel-item').forEach((el, k) => el.classList.toggle('sel', k === i));
  }
  bindWheel(root) {
    const w = root.querySelector('.wheel');
    if (!w || w._bound) return;
    w._bound = true;
    let t = null;
    w.addEventListener('scroll', () => {
      this.highlight();
      clearTimeout(t);
      t = setTimeout(() => {
        const i = this.readWheel();
        this.selection = i;
        if (i === 13) { this.custom = true; this.refresh(); }
      }, 160);
    }, { passive: true });
  }
  mounted(root) { this.bindWheel(root); this.scrollToSelection(); }
  render() {
    const [lo, hi] = this.target;
    const tText = lo === hi ? `Target ${lo}` : `Target ${lo}–${hi}`;
    const head = `<div class="sheet-header"><button class="link-btn" data-act="cancel">Cancel</button><div class="sheet-title">Reps <span class="muted small">${esc(tText)}</span></div><span class="link-btn"></span></div>`;
    if (this.custom) {
      return `${head}<div class="keypad-display"><span class="kp-value">${esc(this.customText || '0')}</span><span class="kp-unit">reps</span></div>
        ${keypadGrid(false)}<button class="link-btn center" data-act="back">Back to 0–12</button><button class="btn primary" data-act="done">Done</button>`;
    }
    const items = [];
    for (let n = 0; n <= 12; n++) items.push(`<div class="wheel-item ${n >= lo && n <= hi ? 'in-target' : ''}" data-act="pickItem" data-i="${n}">${n}</div>`);
    items.push(`<div class="wheel-item custom" data-act="pickItem" data-i="13">Custom</div>`);
    return `${head}<div class="wheel-wrap" data-static><div class="wheel-band"></div><div class="wheel">${'<div class="wheel-pad"></div>'}${items.join('')}<div class="wheel-pad"></div></div></div>
      <button class="btn primary" data-act="done">Done</button>`;
  }
}

// ---------------------------------------------------------------------------------
// Saving files (share sheet when available → "Save to Files")

export async function saveFile(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
