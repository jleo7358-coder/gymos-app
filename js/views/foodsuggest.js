// "Fill my day": what's left of today's targets, the best fits from your own foods (offline),
// and AI meal ideas that close the gap. Any suggestion can be logged in one tap.

import { nav } from '../nav.js';
import { icon, sheetHeader, toast, alert } from '../ui.js';
import { esc, fmt, todayKey } from '../util.js';
import { state } from '../food/store.js';
import { MEALS, F, mealLabel, defaultMeal, entryTotals, scale, factorFor, addInto, fmtN } from '../food/nutrients.js';
import * as Goals from '../food/goals.js';
import * as Diets from '../food/diets.js';
import * as Log from '../food/log.js';
import { ai, suggestMeals, AIError } from '../food/ai.js';
import { SheetView, macroLine } from './foodui.js';

/** What's left of the day's targets (negative = over). */
export function remainingFor(day = todayKey()) {
  const c = Goals.compute(day);
  const T = c.targets;
  const t = F.dayTotals(day);
  return {
    kcal: T.kcal - (t.kcal || 0), protein: T.protein - (t.protein || 0), carbs: T.carbs - (t.carbs || 0), fat: T.fat - (t.fat || 0),
    fibre: T.fibre - (t.fibre || 0), sugarsLeft: T.sugars - (t.sugars || 0), satFatLeft: T.satFat - (t.satFat || 0), saltLeft: T.salt - (t.salt || 0),
    targets: T, compute: c,
  };
}

/** Worth showing the "fill my day" prompt? */
export function hasGap(day = todayKey()) {
  const r = remainingFor(day);
  return r.kcal > 250 || r.protein > 25;
}

/**
 * Best single foods from your own list (favourites, My foods, recent) for the gap, offline.
 * Scores how much of the protein/carb/fat gap a sensible portion closes without going over calories.
 */
export function localSuggestions(rem, limit = 6) {
  const seen = new Set();
  const foods = [];
  const add = (f) => { const k = (f.id || '') + '|' + f.name.toLowerCase(); if (!seen.has(f.name.toLowerCase()) && f.base && f.base.kcal) { seen.add(f.name.toLowerCase()); seen.add(k); foods.push(f); } };
  F.favourites().forEach(add);
  F.myFoods().forEach(add);
  F.recents(60).map(Log.foodFromEntry).forEach(add);
  const T = rem.targets;
  const want = { protein: Math.max(0, rem.protein), carbs: Math.max(0, rem.carbs), fat: Math.max(0, rem.fat) };
  const totalWant = want.protein + want.carbs + want.fat;
  if (rem.kcal < 60 || totalWant < 5) return [];
  const out = [];
  for (const f of foods) {
    const opts = [];
    if (f.basis === 'portion') opts.push({ qty: 1, label: f.portionLabel || 'portion' }, { qty: 2, label: `2 × ${f.portionLabel || 'portion'}` });
    else {
      const s = f.servings && f.servings[0];
      if (s) for (const n of [0.5, 1, 1.5, 2]) opts.push({ qty: s.g * n, label: `${n === 1 ? '' : `${n} × `}${s.label}`, servingLabel: s.label, servingG: s.g });
      else for (const g of [50, 100, 150, 200, 250]) opts.push({ qty: g, label: `${g} ${f.unit || 'g'}` });
    }
    let best = null;
    for (const o of opts) {
      const t = scale(f.base, factorFor(f.basis, o.qty));
      // One food should fit inside what's left, and stay meal-sized when a lot is left.
      if ((t.kcal || 0) > Math.min(rem.kcal + 30, 900)) continue;
      // Reward closing each gap (weighted by how big that gap is), penalise overshooting.
      let score = 0;
      for (const k of ['protein', 'carbs', 'fat']) {
        const got = t[k] || 0; const need = want[k];
        const weight = need / (totalWant || 1) + (k === 'protein' ? 0.25 : 0);
        score += weight * Math.min(got, need) / Math.max(need, 1);
        if (got > need + 5) score -= 0.4 * (got - need) / Math.max(T[k] || 100, 1);
      }
      if (rem.sugarsLeft != null && (t.sugars || 0) > Math.max(0, rem.sugarsLeft)) score -= 0.2;
      if (rem.satFatLeft != null && (t.satFat || 0) > Math.max(0, rem.satFatLeft)) score -= 0.2;
      if (!best || score > best.score) best = { food: f, ...o, totals: t, score };
    }
    if (best && best.score > 0.05) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export class FillGapSheet extends SheetView {
  constructor({ day = todayKey(), meal = null }) {
    super();
    this.day = day; this.meal = meal || (day === todayKey() ? defaultMeal() : 'snacks');
    this.note = ''; this.phase = 'idle'; this.error = ''; this.errorDetail = ''; this.status = ''; this.result = null;
    this.actions = {
      cancel: () => this.close(), done: () => this.close(),
      meal: (el) => { this.meal = el.dataset.m; this.refresh(); },
      ask: () => this.ask(),
      addLocal: (el) => this.addLocal(Number(el.dataset.i)),
      addOption: (el) => this.addOption(Number(el.dataset.i)),
      chip: (el) => { this.note = el.dataset.t; this.refresh(); },
      setup: async () => { this.close(); const { AISettingsScreen } = await import('./foodmore.js'); nav.switchTab('food', true); nav.push(new AISettingsScreen()); },
    };
    this.inputs = { note: (el) => { this.note = el.value; } };
  }
  onDismiss() { this.closed = true; clearInterval(this.ticker); }
  context(rem) {
    const p = Goals.profile();
    const pr = Diets.preset(p.diet);
    const likes = [...new Set([...F.favourites(), ...F.recents(40).map(Log.foodFromEntry)].map((f) => f.name))];
    const now = new Date();
    return {
      meal: mealLabel(this.meal), timeOfDay: this.day === todayKey() ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : null,
      dayLabel: rem.compute.planDay ? rem.compute.planDay.label : rem.compute.training ? 'training day' : null,
      diet: pr && p.diet !== 'balanced' ? pr.name : null, likes, note: this.note.trim(),
      split: rem.kcal > 1100,
    };
  }
  async ask() {
    if (!ai.hasKey) { this.error = 'AI ideas need your Gemini key.'; this.errorDetail = ''; this.refresh(); return; }
    const rem = remainingFor(this.day);
    if (rem.kcal < 80 && rem.protein < 10) { this.error = 'You have hit your targets for today. Nothing left to fill.'; this.refresh(); return; }
    this.phase = 'loading'; this.error = ''; this.errorDetail = ''; this.status = ''; this.started = Date.now(); this.refresh();
    this.ticker = setInterval(() => { if (this.phase === 'loading') this.refresh(); }, 1000);
    try {
      this.result = await suggestMeals({ remaining: rem, context: this.context(rem), onStatus: (t) => { this.status = t; this.refresh(); } });
      this.phase = 'done';
    } catch (e) {
      this.phase = 'idle';
      this.error = e instanceof AIError ? e.message : `Something went wrong: ${e.message || e}`;
      this.errorDetail = e instanceof AIError && e.detail ? `Google said: ${e.detail}` : '';
    }
    clearInterval(this.ticker);
    if (!this.closed) this.refresh();
  }
  addLocal(i) {
    const s = this.local && this.local[i];
    if (!s) return;
    const f = s.food;
    const e = Log.makeEntry({
      food: f.id && state.foods.has(f.id) ? state.foods.get(f.id) : null, name: f.name, brand: f.brand, basis: f.basis, unit: f.unit, base: f.base,
      qty: s.qty, day: this.day, meal: this.meal, servingLabel: s.servingLabel || null, servingG: s.servingG || null,
      portionLabel: f.basis === 'portion' ? (f.portionLabel || 'portion') : null, source: f.source || 'manual',
    });
    Log.addEntry(e);
    toast(`Added ${f.name} · ${fmt.integer(entryTotals(e).kcal || 0)} kcal`, 'good');
    this.refresh();
  }
  addOption(i) {
    const o = this.result && this.result.options[i];
    if (!o || o.added) return;
    const entries = o.items.map((it) => Log.makeEntry({
      name: it.name, basis: it.grams ? '100' : 'portion', unit: 'g', base: it.grams ? it.base : it.totals, qty: it.grams || 1,
      day: this.day, meal: this.meal, source: 'ai', portionLabel: it.grams ? null : (it.portion || 'portion'),
      servingLabel: it.grams && it.portion ? it.portion : null, servingG: it.grams && it.portion ? it.grams : null,
    }));
    Log.addEntries(entries);
    o.added = true;
    toast(`Added “${o.title}” to ${mealLabel(this.meal)} · ${fmt.integer(o.totals.kcal || 0)} kcal`, 'good');
    this.refresh();
  }
  gapHTML(rem) {
    const chip = (label, v, unit, cls = '') => `<div class="gap-chip ${cls} ${v <= 0 ? 'met' : ''}"><span class="tile-label">${label}</span><span class="num">${v <= 0 ? '✓' : `${fmt.integer(v)}${unit}`}</span></div>`;
    return `<div class="gap-row">${chip('Calories', rem.kcal, '')}${chip('Protein', rem.protein, ' g', 'p')}${chip('Carbs', rem.carbs, ' g', 'c')}${chip('Fat', rem.fat, ' g', 'f')}</div>
      ${rem.fibre > 3 ? `<div class="caption faint num">Fibre ${fmt.integer(rem.fibre)} g to go${rem.sugarsLeft != null ? ` · sugar room ${fmt.integer(Math.max(0, rem.sugarsLeft))} g` : ''}${rem.saltLeft != null ? ` · salt room ${fmt.number(Math.max(0, rem.saltLeft), 1)} g` : ''}</div>` : ''}`;
  }
  fit(o, rem) {
    // How close an option lands to the calories and protein left.
    const k = o.totals.kcal || 0; const p = o.totals.protein || 0;
    const kcalPct = rem.kcal > 0 ? Math.round((k / rem.kcal) * 100) : 0;
    const protPct = rem.protein > 0 ? Math.round(Math.min(p, rem.protein) / rem.protein * 100) : 100;
    return `${kcalPct}% of calories left · ${protPct}% of protein gap`;
  }
  render() {
    const rem = remainingFor(this.day);
    this.local = localSuggestions(rem);
    const loading = this.phase === 'loading';
    const mealSeg = `<div class="segmented small">${MEALS.map((m) => `<button class="seg ${this.meal === m.key ? 'on' : ''}" data-act="meal" data-m="${m.key}">${esc(m.label)}</button>`).join('')}</div>`;
    const localHTML = this.local.length ? `<div class="section-label">From your foods</div><div class="list grouped">${this.local.map((s, i) => `<div class="list-row split"><div class="row-main"><span class="grow minw0"><span class="block ellipsis">${esc(s.food.name)}</span><span class="caption faint ellipsis block num">${esc(s.label)} · ${fmtN('kcal', s.totals.kcal || 0)} · ${macroLine(s.totals)} g</span></span></div>
        <button class="icon-btn accent-btn" data-act="addLocal" data-i="${i}" aria-label="Add ${esc(s.food.name)}">${icon.plus}</button></div>`).join('')}</div>` : '';
    const chips = ['Quick, no cooking', 'Proper meal', 'Snack I can take to school', 'High protein, low calories', 'I have chicken and rice'];
    const ideas = this.result ? `<div class="section-label">AI meal ideas</div>${this.result.options.map((o, i) => `<div class="card idea ${o.added ? 'added' : ''}">
        <div class="row-between top"><div class="minw0"><div class="sub strong">${esc(o.title)}</div><div class="caption muted">${esc(o.why)}</div></div>${o.prep ? `<span class="caption faint nowrap">${o.prep} min</span>` : ''}</div>
        <div class="idea-items">${o.items.map((it) => `<div class="row-between"><span class="caption minw0 ellipsis">${esc(it.name)} <span class="faint">${esc(it.portion || (it.grams ? `${fmt.integer(it.grams)} g` : ''))}</span></span><span class="caption faint num nowrap">${fmt.integer(it.totals.kcal || 0)}</span></div>`).join('')}</div>
        <div class="row-between"><span class="num sub"><b>${fmt.integer(o.totals.kcal || 0)} kcal</b> <span class="caption muted">${macroLine(o.totals)} g</span></span>
          <button class="btn primary short idea-add" data-act="addOption" data-i="${i}" ${o.added ? 'disabled' : ''}>${o.added ? 'Added' : 'Add'}</button></div>
        <div class="caption faint">${esc(this.fit(o, rem))}</div></div>`).join('')}
      <div class="caption faint">Values are AI estimates. Added items go into ${esc(mealLabel(this.meal))} and you can adjust the grams afterwards.</div>` : '';
    const met = rem.kcal < 80 && rem.protein < 10;
    return `${sheetHeader('Fill my day', { left: '', right: 'Done' })}
      <div class="caption muted">Left for ${this.day === todayKey() ? 'today' : esc(fmt.weekdayDayMonth(this.day))}${rem.compute.planDay && rem.compute.planDay.label ? ` · ${esc(rem.compute.planDay.label)}` : ''}</div>
      ${this.gapHTML(rem)}
      ${met ? '<div class="card"><div class="sub text-completed">Targets hit for today. Nice work.</div></div>' : ''}
      ${mealSeg}
      ${localHTML}
      ${met ? '' : `<div class="section-label">Ask AI for ideas</div>
      ${ai.hasKey ? `<div class="chip-row">${chips.map((c) => `<button class="chip ${this.note === c ? 'on' : ''}" data-act="chip" data-t="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <textarea class="textarea short" placeholder="Optional: what you fancy, what's in the fridge, foods to avoid…" data-input="note">${esc(this.note)}</textarea>
        <button class="btn primary" data-act="ask" ${loading ? 'disabled' : ''}>${loading ? `<span class="spinner dark"></span> THINKING… ${Math.floor((Date.now() - this.started) / 1000)}s` : `${icon.sparkle} ${this.result ? 'NEW IDEAS' : 'SUGGEST MEALS'}`}</button>
        ${loading ? `<div class="caption muted">${esc(this.status || 'Usually takes 5–20 seconds.')}</div>` : ''}`
        : '<button class="btn secondary" data-act="setup">Set up AI to get meal ideas</button>'}
      ${this.error ? `<div class="caption text-partial">${esc(this.error)}</div>` : ''}
      ${this.error && this.errorDetail ? `<div class="caption faint mono">${esc(this.errorDetail)}</div>` : ''}`}
      ${ideas}`;
  }
}
