// Small UI pieces shared by the Food screens: rings, progress bars, number sheet, photo picker.

import { View, patch, sheetHeader } from '../ui.js';
import { esc, fmt, clamp, parseDecimal } from '../util.js';
import { N, fmtN } from '../food/nutrients.js';

export class SheetView extends View {
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
}

/** Status of a value against a target: 'low' | 'ok' | 'over' (+ fraction). */
export function status(key, value, target) {
  if (!target) return { cls: 'none', frac: 0 };
  const frac = (value || 0) / target;
  const kind = N[key] ? N[key].kind : 'target';
  if (kind === 'limit') return { cls: frac > 1 ? 'over' : 'ok', frac };
  if (kind === 'energy') return { cls: frac > 1.1 ? 'over' : frac >= 0.9 ? 'ok' : 'low', frac };
  return { cls: frac >= 0.9 ? 'ok' : 'low', frac };
}

export function ring(value, target, { size = 120, stroke = 11, label = 'kcal', sub = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const st = status('kcal', value, target);
  const frac = clamp(st.frac, 0, 1);
  const over = st.frac > 1 ? clamp(st.frac - 1, 0, 1) : 0;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}" fill="none"/>
      ${frac > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill ${st.cls}" stroke-width="${stroke}" fill="none" stroke-linecap="round"
        stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
      ${over ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-over" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${(over * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
    </svg>
    <div class="ring-text"><span class="ring-value num">${esc(fmt.integer(value || 0))}</span><span class="ring-label">${esc(label)}</span>${sub ? `<span class="ring-sub">${esc(sub)}</span>` : ''}</div>
  </div>`;
}

/** One labelled progress bar. */
export function bar(key, value, target, { label = null, compact = false } = {}) {
  const st = status(key, value, target);
  const w = clamp(st.frac * 100, 0, 100);
  const n = N[key];
  const kind = n ? n.kind : 'target';
  const left = target ? (kind === 'limit' ? (value > target ? `${fmtN(key, value - target, false)} over` : `${fmtN(key, target - value, false)} left`)
    : value >= target ? (kind === 'energy' && st.cls === 'over' ? `${fmtN(key, value - target, false)} over` : 'reached') : `${fmtN(key, target - value, false)} to go`) : '';
  return `<div class="nbar ${compact ? 'compact' : ''}">
    <div class="row-between"><span class="nbar-label">${esc(label || (n ? n.label : key))}${kind === 'limit' ? '<span class="nbar-kind">limit</span>' : ''}</span>
      <span class="nbar-val num"><b>${esc(fmtN(key, value || 0, false))}</b><span class="faint"> / ${esc(target ? fmtN(key, target) : '—')}</span></span></div>
    <div class="nbar-track"><div class="nbar-fill ${st.cls} ${kind}" style="width:${w.toFixed(1)}%"></div></div>
    ${compact ? '' : `<div class="caption faint num">${esc(left)}</div>`}
  </div>`;
}

/** Sheet with a single number field (used for overrides, water, quantities). */
export class NumberSheet extends SheetView {
  constructor({ title, value = null, unit = '', placeholder = '', hint = '', allowClear = false, clearLabel = 'Use calculated', onDone }) {
    super();
    this.title = title; this.text = value != null ? fmt.editable(value) : ''; this.unit = unit; this.placeholder = placeholder;
    this.hint = hint; this.allowClear = allowClear; this.clearLabel = clearLabel; this.onDone = onDone; this.error = '';
    this.actions = {
      cancel: () => this.close(),
      done: () => {
        const v = parseDecimal(this.text);
        if (v == null || v < 0) { this.error = 'Enter a number.'; this.refresh(); return; }
        this.close(); this.onDone(v);
      },
      clear: () => { this.close(); this.onDone(null); },
    };
    this.inputs = { v: (el) => { this.text = el.value; } };
  }
  mounted(root) { setTimeout(() => root.querySelector('input')?.focus(), 250); }
  render() {
    return `${sheetHeader(this.title, { right: 'Save' })}
      <div class="list grouped form"><label class="row"><input class="text-input full" inputmode="decimal" placeholder="${esc(this.placeholder)}" value="${esc(this.text)}" data-input="v"><span class="unit">${esc(this.unit)}</span></label></div>
      ${this.hint ? `<div class="caption faint">${esc(this.hint)}</div>` : ''}
      ${this.error ? `<div class="caption text-missed">${esc(this.error)}</div>` : ''}
      ${this.allowClear ? `<button class="btn secondary" data-act="clear">${esc(this.clearLabel)}</button>` : ''}`;
  }
}

/** Opens the camera (capture) or the photo library and resolves with a File or null. */
export function pickPhoto(capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export const macroLine = (t) => `P ${fmtN('protein', t.protein || 0, false)} · C ${fmtN('carbs', t.carbs || 0, false)} · F ${fmtN('fat', t.fat || 0, false)}`;
