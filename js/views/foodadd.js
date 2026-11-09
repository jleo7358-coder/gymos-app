// Adding food: search/recents sheet, amount sheet, quick add, custom food, barcode scanner,
// AI photo / label / description analysis with an editable review.

import { nav } from '../nav.js';
import { icon, presentSheet, sheetHeader, alert, confirm, toast, menu, toggle, emptyState } from '../ui.js';
import { esc, fmt, parseDecimal, todayKey, uuid } from '../util.js';
import { state } from '../food/store.js';
import { NUTRIENTS, N, MEALS, F, mealLabel, fmtN, entryTotals, scale, factorFor, amountText, addInto, cleanNutrients } from '../food/nutrients.js';
import * as Log from '../food/log.js';
import * as OFF from '../food/off.js';
import { ai, analyse, imageToBase64, AIError } from '../food/ai.js';
import { Scanner, scanImageFile, cameraErrorMessage } from '../food/scan.js';
import { SheetView, pickPhoto, macroLine } from './foodui.js';

const mealSeg = (cur, act = 'meal') => `<div class="segmented small">${MEALS.map((m) => `<button class="seg ${cur === m.key ? 'on' : ''}" data-act="${act}" data-m="${m.key}">${esc(m.label)}</button>`).join('')}</div>`;

/** Per-serving or per-100 summary for a food row. */
function foodSub(f) {
  const parts = [];
  if (f.brand) parts.push(f.brand);
  if (f.basis === 'portion') parts.push(`${fmtN('kcal', f.base.kcal || 0)} per ${f.portionLabel || 'portion'}`);
  else if (f.servings && f.servings[0]) parts.push(`${fmtN('kcal', (f.base.kcal || 0) * f.servings[0].g / 100)} per ${f.servings[0].label}`);
  else parts.push(`${fmtN('kcal', f.base.kcal || 0)} per 100 ${f.unit || 'g'}`);
  return parts.join(' · ');
}
const sourceTag = (s) => ({ off: 'OFF', ai: 'AI', custom: 'MINE', quick: 'QUICK' }[s] || '');

// ---------------------------------------------------------------------------------
// Add food (search, recents, favourites, my foods, saved meals, entry points)

export class AddFoodSheet extends SheetView {
  constructor({ day = todayKey(), meal }) {
    super();
    this.day = day; this.meal = meal; this.q = ''; this.tab = 'recent';
    this.online = null; this.onlineFor = ''; this.loading = false; this.error = '';
    this.added = 0;
    this.actions = {
      cancel: () => this.close(), done: () => this.close(),
      meal: (el) => { this.meal = el.dataset.m; this.refresh(); },
      tab: (el) => { this.tab = el.dataset.t; this.refresh(); },
      searchOnline: () => this.searchOnline(),
      clearQ: () => { this.q = ''; this.online = null; this.error = ''; this.refresh(); },
      food: (el) => this.openFood(this.foodFor(el)),
      foodMenu: (el) => this.foodMenu(this.foodFor(el)),
      recent: (el) => { const e = state.entries.get(el.dataset.id); if (e) this.openFood(Log.foodFromEntry(e), e.qty); },
      quickRecent: (el) => { const e = state.entries.get(el.dataset.id); if (!e) return; Log.addEntry(Log.makeEntry({ ...e, food: e.foodId ? state.foods.get(e.foodId) : null, day: this.day, meal: this.meal })); this.didAdd(e.name, entryTotals(e).kcal); },
      savedMeal: (el) => { const m = state.meals.get(el.dataset.id); if (!m) return; const n = Log.logMeal(m, this.day, this.meal); this.didAdd(m.name, m.items.reduce((a, it) => a + (entryTotals(it).kcal || 0), 0), n); },
      scan: () => presentSheet(new ScanSheet({ day: this.day, meal: this.meal, onAdded: (n, k) => this.didAdd(n, k) }), { height: 'large' }),
      aiPhoto: () => openAI({ mode: 'photo', day: this.day, meal: this.meal, onAdded: (n, k, c) => this.didAdd(n, k, c) }),
      aiText: () => openAI({ mode: 'text', day: this.day, meal: this.meal, text: this.q, onAdded: (n, k, c) => this.didAdd(n, k, c) }),
      quick: () => presentSheet(new QuickAddSheet({ day: this.day, meal: this.meal, name: this.q, onAdded: (n, k) => this.didAdd(n, k) }), { height: 'large' }),
      create: () => presentSheet(new CustomFoodSheet({ name: this.q, onSaved: (f) => this.openFood(f) }), { height: 'large' }),
    };
    this.inputs = { q: (el) => { this.q = el.value; if (!this.q.trim()) { this.online = null; this.error = ''; } this.refresh(); } };
  }
  mounted(root) {
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-input="q"]')) { e.preventDefault(); e.target.blur(); this.searchOnline(); } });
  }
  foodFor(el) {
    if (el.dataset.src === 'online') return this.online && this.online[Number(el.dataset.i)];
    return state.foods.get(el.dataset.id);
  }
  didAdd(name, kcal, count = 1) {
    this.added += count;
    toast(`Added ${count > 1 ? `${count} items` : name} · ${fmt.integer(kcal || 0)} kcal`, 'good');
    this.refresh();
  }
  openFood(food, qty = null) {
    if (!food) return;
    presentSheet(new FoodAmountSheet({ food, day: this.day, meal: this.meal, qty, onAdded: (n, k) => this.didAdd(n, k) }), { height: 'large' });
  }
  foodMenu(f) {
    if (!f) return;
    menu([
      { label: f.fav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', handler: () => { Log.toggleFavourite(f); this.refresh(); } },
      f.source === 'custom' ? { label: 'Edit food', icon: 'pencil', handler: () => presentSheet(new CustomFoodSheet({ food: f }), { height: 'large' }) } : null,
    ], f.name);
  }
  async searchOnline() {
    const q = this.q.trim();
    if (!q || this.loading) return;
    if (/^\d{8,14}$/.test(q)) { this.lookupCode(q); return; }
    this.loading = true; this.error = ''; this.refresh();
    try { this.online = await OFF.search(q); this.onlineFor = q; }
    catch (e) { this.error = e.message; this.online = null; }
    this.loading = false; this.refresh();
  }
  async lookupCode(code) {
    this.loading = true; this.error = ''; this.refresh();
    try {
      const local = F.foodByBarcode(code);
      const r = local ? { found: true, food: local } : await OFF.lookupBarcode(code);
      if (r.found && r.food) this.openFood(r.food);
      else this.error = r.found ? 'That product has no nutrition information.' : 'No product found for that barcode.';
    } catch (e) { this.error = e.message; }
    this.loading = false; this.refresh();
  }
  foodRow(f, extra = '') {
    return `<div class="list-row split"><button class="row-main" ${extra} data-longpress="foodMenu">
        <span class="grow minw0"><span class="block ellipsis">${esc(f.name)}${f.fav ? ' <span class="text-partial">★</span>' : ''}</span><span class="caption faint ellipsis block">${esc(foodSub(f))}</span></span>
        ${sourceTag(f.source) ? `<span class="src-tag">${sourceTag(f.source)}</span>` : ''}${icon.chevron}</button></div>`;
  }
  entryRow(e) {
    const t = entryTotals(e);
    return `<div class="list-row split"><button class="row-main" data-act="recent" data-id="${e.id}">
        <span class="grow minw0"><span class="block ellipsis">${esc(e.name)}</span><span class="caption faint ellipsis block">${esc([e.brand, amountText(e), fmtN('kcal', t.kcal || 0)].filter(Boolean).join(' · '))}</span></span></button>
        <button class="icon-btn accent-btn" data-act="quickRecent" data-id="${e.id}" aria-label="Add again">${icon.plus}</button></div>`;
  }
  renderBrowse() {
    const tabs = [['recent', 'Recent'], ['fav', 'Favourites'], ['mine', 'My foods'], ['meals', 'Meals']];
    let list = '';
    if (this.tab === 'recent') {
      const r = F.recents(40);
      list = r.length ? `<div class="list grouped">${r.map((e) => this.entryRow(e)).join('')}</div><div class="caption faint">Tap to change the amount, ＋ to add the same again.</div>`
        : emptyState('Nothing logged yet', 'Search, scan a barcode or snap a photo to log your first food.', 'food');
    } else if (this.tab === 'fav') {
      const f = F.favourites();
      list = f.length ? `<div class="list grouped">${f.map((x) => this.foodRow(x, `data-act="food" data-id="${x.id}"`)).join('')}</div>` : emptyState('No favourites', 'Tap the star on any food to keep it here.', 'star');
    } else if (this.tab === 'mine') {
      const f = F.myFoods();
      list = `${f.length ? `<div class="list grouped">${f.map((x) => this.foodRow(x, `data-act="food" data-id="${x.id}"`)).join('')}</div>` : emptyState('No custom foods', 'Create foods you eat often, or from a nutrition label.', 'food')}
        <button class="btn secondary" data-act="create">${icon.plus} CREATE FOOD</button>`;
    } else {
      const m = F.meals();
      list = m.length ? `<div class="list grouped">${m.map((x) => { const k = x.items.reduce((a, it) => a + (entryTotals(it).kcal || 0), 0); return `<div class="list-row split"><button class="row-main" data-act="savedMeal" data-id="${x.id}"><span class="grow minw0"><span class="block ellipsis">${esc(x.name)}</span><span class="caption faint">${x.items.length} items · ${fmtN('kcal', k)}</span></span></button><button class="icon-btn accent-btn" data-act="savedMeal" data-id="${x.id}" aria-label="Add meal">${icon.plus}</button></div>`; }).join('')}</div>`
        : emptyState('No saved meals', 'On the Food screen, tap ⋯ on a meal and choose “Save as meal”.', 'list');
    }
    return `<div class="segmented small">${tabs.map(([k, l]) => `<button class="seg ${this.tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>${list}`;
  }
  renderSearch() {
    const q = this.q.trim();
    const local = F.searchLocal(q);
    const isCode = /^\d{8,14}$/.test(q);
    let online = '';
    if (this.loading) online = '<div class="card center"><span class="spinner"></span><span class="caption muted">Searching Open Food Facts…</span></div>';
    else if (this.error) online = `<div class="card"><div class="caption text-partial">${esc(this.error)}</div></div>`;
    else if (this.online && this.onlineFor === q) {
      online = this.online.length ? `<div class="section-label">Open Food Facts</div><div class="list grouped">${this.online.map((f, i) => this.foodRow(f, `data-act="food" data-src="online" data-i="${i}"`)).join('')}</div>`
        : '<div class="caption faint center">No products found online. Try fewer words, describe it to the AI, or quick add.</div>';
    }
    const hasLocal = local.foods.length || local.entries.length;
    return `${hasLocal ? `<div class="section-label">On this phone</div><div class="list grouped">${local.foods.map((f) => this.foodRow(f, `data-act="food" data-id="${f.id}"`)).join('')}${local.entries.map((e) => this.entryRow(e)).join('')}</div>` : ''}
      ${!(this.online && this.onlineFor === q) && !this.loading ? `<button class="btn secondary" data-act="searchOnline">${icon.search} ${isCode ? 'LOOK UP BARCODE' : `SEARCH ONLINE FOR “${esc(q.slice(0, 24))}”`}</button>` : ''}
      ${online}
      <div class="list grouped">
        <button class="list-row accent" data-act="aiText">${icon.sparkle}<span class="grow">Describe “${esc(q.slice(0, 28))}” to AI</span></button>
        <button class="list-row accent" data-act="quick">${icon.bolt}<span class="grow">Quick add calories</span></button>
        <button class="list-row accent" data-act="create">${icon.plus}<span class="grow">Create “${esc(q.slice(0, 28))}” as a food</span></button>
      </div>`;
  }
  render() {
    return `${sheetHeader(`Add to ${mealLabel(this.meal)}`, { left: this.added ? '' : 'Cancel', right: this.added ? 'Done' : null })}
      ${mealSeg(this.meal)}
      <div class="search-box">${icon.search}<input type="search" placeholder="Search foods or type a barcode" value="${esc(this.q)}" data-input="q" enterkeyhint="search" autocomplete="off" autocorrect="off">${this.q ? `<button class="icon-btn" data-act="clearQ" aria-label="Clear">${icon.close}</button>` : ''}</div>
      ${this.q.trim() ? '' : `<div class="quick-grid">
        <button class="qa" data-act="scan">${icon.barcode}<span>Scan</span></button>
        <button class="qa" data-act="aiPhoto">${icon.camera}<span>AI photo</span></button>
        <button class="qa" data-act="aiText">${icon.sparkle}<span>Describe</span></button>
        <button class="qa" data-act="quick">${icon.bolt}<span>Quick add</span></button>
      </div>`}
      ${this.q.trim() ? this.renderSearch() : this.renderBrowse()}`;
  }
}

// ---------------------------------------------------------------------------------
// Amount sheet: choose quantity/serving, preview nutrition, add or edit an entry

export class FoodAmountSheet extends SheetView {
  /** food: food record (may be unsaved, e.g. an online result). entry: existing entry when editing. */
  constructor({ food, entry = null, day = todayKey(), meal = 'snacks', qty = null, onAdded = null }) {
    super();
    this.food = food; this.entry = entry; this.onAdded = onAdded;
    this.day = entry ? entry.day : day; this.meal = entry ? entry.meal : meal;
    const src = entry || food;
    this.basis = src.basis || '100';
    this.unit = src.unit || 'g';
    this.base = { ...(src.base || {}) };
    this.servings = (food && food.servings) ? [...food.servings] : [];
    if (entry && entry.servingLabel && entry.servingG && !this.servings.some((s) => s.label === entry.servingLabel)) this.servings.push({ label: entry.servingLabel, g: entry.servingG });
    this.showAll = false;
    // Initial unit: serving index, or 'g' / 'portion'
    if (this.basis === 'portion') { this.sel = 'portion'; this.text = fmt.editable(entry ? entry.qty : (qty || 1)); }
    else {
      const initQty = entry ? entry.qty : qty;
      const si = entry && entry.servingLabel ? this.servings.findIndex((s) => s.label === entry.servingLabel) : (initQty == null && this.servings.length ? 0 : -1);
      if (si >= 0) { this.sel = String(si); this.text = fmt.editable(initQty != null ? initQty / this.servings[si].g : 1); }
      else { this.sel = 'g'; this.text = fmt.editable(initQty != null ? initQty : 100); }
    }
    this.actions = {
      cancel: () => this.close(),
      done: () => this.save(),
      meal: (el) => { this.meal = el.dataset.m; this.refresh(); },
      fav: () => { const now = Log.toggleFavourite(this.ensureSaved()); toast(now ? 'Added to favourites' : 'Removed from favourites'); this.refresh(); },
      all: () => { this.showAll = !this.showAll; this.refresh(); },
      step: (el) => { const v = Math.max(0, (parseDecimal(this.text) || 0) + Number(el.dataset.d) * this.stepSize()); this.text = fmt.editable(Math.round(v * 100) / 100); this.refresh(); },
      del: () => confirm('Delete this entry?', this.entry.name, 'Delete', () => { Log.deleteEntry(this.entry.id); this.close(); }),
      saveMine: () => { const f = this.ensureSaved({ saved: true }); toast(`Saved “${f.name}” to My foods`, 'good'); this.refresh(); },
    };
    this.inputs = { qty: (el) => { this.text = el.value; this.refreshPreview(); } };
    this.changes = {
      unit: (el) => {
        const g = this.grams();
        this.sel = el.value;
        if (this.sel === 'g') this.text = fmt.editable(Math.round(g));
        else if (this.sel !== 'portion') this.text = fmt.editable(Math.round((g / this.servings[Number(this.sel)].g) * 100) / 100);
        this.refresh();
      },
      day: (el) => { if (el.value) this.day = el.value; },
    };
  }
  stepSize() { return this.sel === 'g' ? (this.unit === 'ml' ? 50 : 10) : this.sel === 'portion' ? 0.5 : 0.5; }
  amount() { return parseDecimal(this.text) || 0; }
  /** Quantity in the entry's basis: grams/ml, or portions. */
  grams() {
    if (this.sel === 'portion' || this.sel === 'g') return this.amount();
    const s = this.servings[Number(this.sel)];
    return s ? this.amount() * s.g : this.amount();
  }
  totals() { return scale(this.base, factorFor(this.basis, this.grams())); }
  saved() { return this.food && this.food.id && state.foods.has(this.food.id) ? state.foods.get(this.food.id) : null; }
  ensureSaved(extra = {}) {
    const existing = this.saved();
    if (existing) { if (Object.keys(extra).length) { const f = Log.saveFood(existing, extra); this.food = f; return f; } return existing; }
    const byCode = this.food.barcode ? F.foodByBarcode(this.food.barcode) : null;
    const f = Log.saveFood({ ...this.food, ...(byCode ? { id: byCode.id, fav: byCode.fav } : { id: this.food.id || uuid() }), servings: this.servings }, extra);
    this.food = f;
    return f;
  }
  save() {
    const q = this.grams();
    if (!(q > 0)) { toast('Enter an amount'); return; }
    const serving = this.sel !== 'g' && this.sel !== 'portion' ? this.servings[Number(this.sel)] : null;
    if (this.entry) {
      Log.updateEntry(this.entry, { qty: q, meal: this.meal, day: this.day, servingLabel: serving ? serving.label : null, servingG: serving ? serving.g : null });
      this.close();
      return;
    }
    // Online/scanned products are cached so they appear in recents and work offline.
    const food = this.food.source === 'off' || this.food.source === 'custom' ? this.ensureSaved() : this.saved();
    const e = Log.makeEntry({
      food, name: this.food.name, brand: this.food.brand, basis: this.basis, unit: this.unit, base: this.base, qty: q,
      day: this.day, meal: this.meal, servingLabel: serving ? serving.label : null, servingG: serving ? serving.g : null,
      portionLabel: this.food.portionLabel || null, source: this.food.source || 'manual',
    });
    Log.addEntry(e);
    this.close();
    if (this.onAdded) this.onAdded(e.name, entryTotals(e).kcal);
    else toast(`Added ${e.name} · ${fmt.integer(entryTotals(e).kcal || 0)} kcal`, 'good');
  }
  refreshPreview() {
    const el = document.querySelector(`[data-view="${this.id}"] [data-preview]`);
    if (el) el.innerHTML = this.preview();
  }
  preview() {
    const t = this.totals();
    const tile = (k, l) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value">${esc(fmtN(k, t[k] || 0, false))}<span class="tile-unit">${k === 'kcal' ? '' : N[k].unit}</span></div></div>`;
    const others = NUTRIENTS.filter((n) => !['kcal', 'protein', 'carbs', 'fat'].includes(n.key) && t[n.key] != null);
    const shown = this.showAll ? others : others.filter((n) => n.group === 'other');
    return `<div class="tiles">${tile('kcal', 'Calories')}${tile('protein', 'Protein')}${tile('carbs', 'Carbs')}${tile('fat', 'Fat')}</div>
      ${shown.length ? `<div class="list grouped">${shown.map((n) => `<div class="list-row slim"><span class="grow">${esc(n.label)}</span><span class="muted num">${esc(fmtN(n.key, t[n.key]))}</span></div>`).join('')}</div>` : ''}
      ${others.some((n) => n.group === 'vitamin' || n.group === 'mineral') ? `<button class="link-btn small left" data-act="all">${this.showAll ? 'Hide vitamins & minerals' : 'Show vitamins & minerals'}</button>` : ''}`;
  }
  render() {
    const f = this.food;
    const saved = this.saved();
    const fav = saved && saved.fav;
    const opts = this.basis === 'portion'
      ? `<option value="portion" selected>${esc(f.portionLabel || 'portion')}</option>`
      : `${this.servings.map((s, i) => `<option value="${i}" ${this.sel === String(i) ? 'selected' : ''}>${esc(/\d\s*(g|ml)\b/i.test(s.label) ? s.label : `${s.label} (${fmt.number(s.g, 1)} ${this.unit})`)}</option>`).join('')}<option value="g" ${this.sel === 'g' ? 'selected' : ''}>${this.unit}</option>`;
    const per = this.basis === 'portion' ? `per ${f.portionLabel || 'portion'}` : `per 100 ${this.unit}`;
    return `${sheetHeader(this.entry ? 'Edit entry' : 'Add food', { right: this.entry ? 'Save' : 'Add' })}
      <div class="row-between top"><div class="minw0"><div class="headline">${esc(f.name)}</div><div class="caption muted">${esc([f.brand, `${fmtN('kcal', this.base.kcal || 0)} ${per}`].filter(Boolean).join(' · '))}</div>
        ${f.perServingOnly ? '<div class="caption text-partial">This product only lists values per serving — check the amount.</div>' : ''}</div>
        <button class="icon-btn ${fav ? 'fav-on' : ''}" data-act="fav" aria-label="Favourite">${icon.star}</button></div>
      <div class="list grouped form">
        <div class="row"><span class="row-label">Amount</span>
          <div class="stepper qty-stepper"><button class="step-btn" data-act="step" data-d="-1">${icon.minus}</button>
          <input class="num-input qty" inputmode="decimal" value="${esc(this.text)}" data-input="qty" aria-label="Amount">
          <button class="step-btn" data-act="step" data-d="1">${icon.plus}</button></div></div>
        <label class="row"><span class="row-label grow">Unit</span><select class="select" data-change="unit">${opts}</select></label>
        ${this.entry ? `<label class="row"><span class="row-label grow">Date</span><input type="date" class="date-input" value="${this.day}" data-change="day"></label>` : ''}
      </div>
      ${mealSeg(this.meal)}
      <div data-preview class="stack">${this.preview()}</div>
      ${this.entry ? '<button class="btn secondary destructive-text" data-act="del">Delete entry</button>'
        : (!saved || !saved.saved) && f.source !== 'custom' ? '<button class="link-btn small center" data-act="saveMine">Save to My foods</button>' : ''}`;
  }
}

// ---------------------------------------------------------------------------------
// Quick add (calories and optional macros)

const QUICK_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugars', 'satFat', 'salt'];
export class QuickAddSheet extends SheetView {
  constructor({ day, meal, name = '', onAdded }) {
    super();
    this.day = day; this.meal = meal; this.name = name; this.v = {}; this.save = false; this.error = ''; this.onAdded = onAdded;
    this.actions = {
      cancel: () => this.close(), done: () => this.submit(),
      meal: (el) => { this.meal = el.dataset.m; this.refresh(); },
    };
    this.inputs = { name: (el) => { this.name = el.value; }, n: (el) => { this.v[el.dataset.k] = el.value; this.refreshTotal(); } };
    this.changes = { saveFood: (el) => { this.save = el.checked; } };
  }
  base() { const o = {}; for (const k of QUICK_FIELDS) { const x = parseDecimal(this.v[k]); if (x != null) o[k] = x; } return o; }
  refreshTotal() {
    const el = document.querySelector(`[data-view="${this.id}"] [data-calc]`);
    if (!el) return;
    const b = this.base();
    const fromMacros = (b.protein || 0) * 4 + (b.carbs || 0) * 4 + (b.fat || 0) * 9;
    el.textContent = fromMacros && b.kcal == null ? `≈ ${fmt.integer(fromMacros)} kcal from macros` : '';
  }
  submit() {
    const b = this.base();
    if (b.kcal == null) { const m = (b.protein || 0) * 4 + (b.carbs || 0) * 4 + (b.fat || 0) * 9; if (m > 0) b.kcal = Math.round(m); }
    if (!(b.kcal >= 0) || b.kcal == null) { this.error = 'Enter calories (or macros).'; this.refresh(); return; }
    const name = this.name.trim() || 'Quick add';
    let food = null;
    if (this.save) food = Log.saveFood({ name, basis: 'portion', unit: 'g', base: b, source: 'custom', saved: true, servings: [], portionLabel: 'portion' });
    const e = Log.makeEntry({ food, name, basis: 'portion', base: b, qty: 1, day: this.day, meal: this.meal, source: 'quick', portionLabel: food ? 'portion' : null });
    Log.addEntry(e);
    this.close();
    if (this.onAdded) this.onAdded(name, b.kcal); else toast(`Added ${fmt.integer(b.kcal)} kcal`, 'good');
  }
  render() {
    const field = (k) => `<label class="row"><span class="row-label grow">${esc(N[k].label)}</span><input class="num-input" inputmode="decimal" placeholder="—" value="${esc(this.v[k] || '')}" data-input="n" data-k="${k}"><span class="unit w-unit">${N[k].unit}</span></label>`;
    return `${sheetHeader('Quick add', { right: 'Add' })}
      ${mealSeg(this.meal)}
      <div class="list grouped form"><label class="row"><input class="text-input full" placeholder="Name (optional)" value="${esc(this.name)}" data-input="name"></label></div>
      <div class="list grouped form">${QUICK_FIELDS.slice(0, 4).map(field).join('')}</div>
      <div class="caption faint" data-calc></div>
      <div class="section-label">Optional</div>
      <div class="list grouped form">${QUICK_FIELDS.slice(4).map(field).join('')}</div>
      <div class="list grouped form">${toggle('Save to My foods', this.save, 'saveFood')}</div>
      ${this.error ? `<div class="caption text-missed">${esc(this.error)}</div>` : ''}`;
  }
}

// ---------------------------------------------------------------------------------
// Create / edit a custom food (also used to review an AI-read nutrition label)

export class CustomFoodSheet extends SheetView {
  constructor({ food = null, name = '', barcode = '', prefill = null, onSaved = null, title = null }) {
    super();
    const f = food || prefill || {};
    this.editing = food;
    this.titleText = title || (food ? 'Edit food' : 'Create food');
    this.name = f.name || name; this.brand = f.brand || ''; this.barcode = f.barcode || barcode || '';
    this.mode = f.basis === 'portion' ? 'portion' : f.unit === 'ml' ? 'ml' : 'g';
    const s = (f.servings && f.servings[0]) || null;
    this.servingLabel = s ? s.label : (f.portionLabel && f.basis === 'portion' ? f.portionLabel : '');
    this.servingG = s ? fmt.editable(s.g) : '';
    this.v = {};
    for (const [k, x] of Object.entries(f.base || {})) this.v[k] = fmt.editable(Math.round(x * 100) / 100);
    this.more = Object.keys(this.v).some((k) => N[k] && (N[k].group === 'vitamin' || N[k].group === 'mineral'));
    this.error = ''; this.onSaved = onSaved;
    this.actions = {
      cancel: () => this.close(), done: () => this.submit(),
      mode: (el) => { this.mode = el.dataset.m; this.refresh(); },
      more: () => { this.more = !this.more; this.refresh(); },
      del: () => confirm(`Delete “${this.editing.name}”?`, 'Entries already logged keep their values.', 'Delete', () => { Log.deleteFood(this.editing.id); this.close(); }),
    };
    this.inputs = {
      name: (el) => { this.name = el.value; }, brand: (el) => { this.brand = el.value; }, barcode: (el) => { this.barcode = el.value; },
      sl: (el) => { this.servingLabel = el.value; }, sg: (el) => { this.servingG = el.value; },
      n: (el) => { this.v[el.dataset.k] = el.value; },
    };
  }
  submit() {
    const name = this.name.trim();
    if (!name) return this.fail('Enter a name.');
    const base = {};
    for (const n of NUTRIENTS) { const x = parseDecimal(this.v[n.key]); if (x != null) { if (x < 0) return this.fail(`${n.label} can't be negative.`); base[n.key] = x; } }
    if (base.kcal == null) { const m = (base.protein || 0) * 4 + (base.carbs || 0) * 4 + (base.fat || 0) * 9; if (!m) return this.fail('Enter calories (or the macros).'); base.kcal = Math.round(m); }
    const sg = parseDecimal(this.servingG);
    const servings = this.mode !== 'portion' && sg > 0 ? [{ label: this.servingLabel.trim() || `serving`, g: sg }] : [];
    const code = this.barcode.replace(/\D/g, '');
    const food = {
      ...(this.editing || {}), id: this.editing ? this.editing.id : uuid(), name, brand: this.brand.trim() || null, barcode: code || null,
      basis: this.mode === 'portion' ? 'portion' : '100', unit: this.mode === 'ml' ? 'ml' : 'g', base: cleanNutrients(base), servings,
      portionLabel: this.mode === 'portion' ? (this.servingLabel.trim() || 'portion') : null, source: 'custom', saved: true, hidden: false,
    };
    // Re-use an earlier cached product with the same barcode.
    const prev = code && !this.editing ? F.foodByBarcode(code) : null;
    if (prev) { food.id = prev.id; food.fav = prev.fav; food.useCount = prev.useCount; }
    const saved = Log.saveFood(food);
    this.close();
    toast(this.editing ? 'Food updated' : `Saved “${name}”`, 'good');
    if (this.onSaved) this.onSaved(saved);
  }
  fail(m) { this.error = m; this.refresh(); }
  render() {
    const per = this.mode === 'portion' ? 'per portion' : `per 100 ${this.mode}`;
    const field = (n) => `<label class="row"><span class="row-label grow">${esc(n.label)}</span><input class="num-input" inputmode="decimal" placeholder="—" value="${esc(this.v[n.key] || '')}" data-input="n" data-k="${n.key}"><span class="unit w-unit">${n.unit}</span></label>`;
    return `${sheetHeader(this.titleText, { right: 'Save' })}
      <div class="list grouped form">
        <label class="row"><input class="text-input full" placeholder="Name (e.g. Protein oats)" value="${esc(this.name)}" data-input="name" autocapitalize="sentences"></label>
        <label class="row"><input class="text-input full" placeholder="Brand (optional)" value="${esc(this.brand)}" data-input="brand"></label>
        <label class="row"><span class="row-label grow">Barcode</span><input class="text-input" inputmode="numeric" placeholder="optional" value="${esc(this.barcode)}" data-input="barcode"></label>
      </div>
      <div class="section-label">Nutrition is given</div>
      <div class="segmented small">${[['g', 'Per 100 g'], ['ml', 'Per 100 ml'], ['portion', 'Per portion']].map(([k, l]) => `<button class="seg ${this.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}">${l}</button>`).join('')}</div>
      <div class="list grouped form">
        <label class="row"><span class="row-label grow">${this.mode === 'portion' ? 'Portion name' : 'Serving name'}</span><input class="text-input" placeholder="${this.mode === 'portion' ? 'e.g. 1 bowl' : 'e.g. 1 bar'}" value="${esc(this.servingLabel)}" data-input="sl"></label>
        ${this.mode !== 'portion' ? `<label class="row"><span class="row-label grow">Serving size</span><input class="num-input" inputmode="decimal" placeholder="optional" value="${esc(this.servingG)}" data-input="sg"><span class="unit w-unit">${this.mode}</span></label>` : ''}
      </div>
      <div class="section-label">Nutrition ${per}</div>
      <div class="list grouped form">${NUTRIENTS.filter((n) => n.group === 'energy' || n.group === 'macro').map(field).join('')}</div>
      <div class="list grouped form">${NUTRIENTS.filter((n) => n.group === 'other').map(field).join('')}</div>
      <button class="link-btn small left" data-act="more">${this.more ? 'Hide vitamins & minerals' : 'Add vitamins & minerals'}</button>
      ${this.more ? `<div class="list grouped form">${NUTRIENTS.filter((n) => n.group === 'vitamin' || n.group === 'mineral').map(field).join('')}</div>` : ''}
      ${this.error ? `<div class="caption text-missed">${esc(this.error)}</div>` : ''}
      ${this.editing ? '<button class="btn secondary destructive-text" data-act="del">Delete food</button>' : ''}`;
  }
}

// ---------------------------------------------------------------------------------
// Barcode scanner

export class ScanSheet extends SheetView {
  constructor({ day, meal, onAdded = null }) {
    super();
    this.day = day; this.meal = meal; this.onAdded = onAdded;
    this.readerId = 'reader-' + this.id; this.fileId = 'scanfile-' + this.id;
    this.status = 'starting'; this.message = ''; this.code = ''; this.busy = false;
    this.scanner = new Scanner(this.readerId);
    this.actions = {
      cancel: () => this.close(), done: () => this.close(),
      lookup: () => { const c = this.code.replace(/\D/g, ''); if (c) this.handle(c); },
      photo: () => this.fromPhoto(),
      retry: () => this.startCamera(),
    };
    this.inputs = { code: (el) => { this.code = el.value; } };
  }
  mounted(root) {
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-input="code"]')) { e.preventDefault(); e.target.blur(); this.actions.lookup(); } });
    this.startCamera();
  }
  onDismiss() { this.closed = true; this.scanner.stop(); }
  async startCamera() {
    this.status = 'starting'; this.message = ''; this.refresh();
    try {
      await this.scanner.start((code) => this.handle(code));
      if (this.closed) { this.scanner.stop(); return; }
      this.status = 'scanning';
    } catch (e) {
      this.status = 'error'; this.message = cameraErrorMessage(e);
    }
    this.refresh();
  }
  async fromPhoto() {
    const file = await pickPhoto(true);
    if (!file) return;
    await this.scanner.stop();
    this.status = 'paused'; this.busy = true; this.message = 'Reading barcode from photo…'; this.refresh();
    const code = await scanImageFile(file, this.fileId);
    this.busy = false;
    if (code) this.handle(code);
    else { this.message = "Couldn't find a barcode in that photo. Get closer, keep it sharp and flat, or type the numbers."; this.refresh(); }
  }
  async handle(code) {
    if (this.busy && this.status !== 'paused') return;
    await this.scanner.stop();
    this.code = code; this.status = 'paused'; this.busy = true; this.message = `Looking up ${code}…`; this.refresh();
    let r;
    const local = F.foodByBarcode(code);
    if (local && !local.hidden) r = { found: true, food: local };
    else {
      try { r = await OFF.lookupBarcode(code); }
      catch (e) {
        this.busy = false; this.message = e.message; this.refresh();
        if (local) r = { found: true, food: local }; else return;
      }
    }
    this.busy = false;
    if (this.closed) return;
    if (r.found && r.food) {
      this.close();
      presentSheet(new FoodAmountSheet({ food: r.food, day: this.day, meal: this.meal, onAdded: this.onAdded }), { height: 'large' });
      return;
    }
    this.message = r.found ? `${r.name || 'This product'} is in Open Food Facts but has no nutrition values.` : `No product found for ${code}.`;
    this.refresh();
    alert(r.found ? 'No nutrition data' : 'Product not found', `${this.message}\n\nYou can photograph the nutrition label and let the AI read it, or type the values in yourself. It will be saved with this barcode for next time.`, [
      { label: 'Read label with AI', handler: () => { this.close(); openAI({ mode: 'label', day: this.day, meal: this.meal, barcode: code, onAdded: this.onAdded }); } },
      { label: 'Enter manually', handler: () => { this.close(); presentSheet(new CustomFoodSheet({ barcode: code, name: r.name || '', onSaved: (f) => presentSheet(new FoodAmountSheet({ food: f, day: this.day, meal: this.meal, onAdded: this.onAdded }), { height: 'large' }) }), { height: 'large' }); } },
      { label: 'Scan again', role: 'cancel', handler: () => this.startCamera() },
    ]);
  }
  render() {
    const st = this.status;
    return `${sheetHeader('Scan barcode', { left: 'Close', right: null })}
      <div class="scan-wrap"><div id="${this.readerId}" class="scan-reader" data-static></div>
        ${st === 'scanning' ? '<div class="scan-hint">Line the barcode up inside the box</div>' : ''}
        ${st === 'starting' ? '<div class="scan-over"><span class="spinner"></span><span>Starting camera…</span></div>' : ''}
        ${st === 'error' ? `<div class="scan-over">${icon.camera}<span>${esc(this.message)}</span><button class="link-btn" data-act="retry">Try again</button></div>` : ''}
        ${st === 'paused' ? `<div class="scan-over">${this.busy ? '<span class="spinner"></span>' : icon.barcode}<span>${esc(this.message)}</span>${this.busy ? '' : '<button class="link-btn" data-act="retry">Scan again</button>'}</div>` : ''}
      </div>
      <div id="${this.fileId}" class="hidden" data-static></div>
      <div class="list grouped form"><div class="row"><input class="text-input full" inputmode="numeric" placeholder="Or type the barcode number" value="${esc(this.code)}" data-input="code" enterkeyhint="search"><button class="link-btn strong" data-act="lookup">Look up</button></div></div>
      <button class="btn secondary" data-act="photo">${icon.camera} USE A PHOTO OF THE BARCODE</button>
      <div class="caption faint">Products come from Open Food Facts, a free public database. Scanned products are saved on this phone, so scanning them again works offline.</div>`;
  }
}

// ---------------------------------------------------------------------------------
// AI: meal photo, nutrition label, or text description → editable review

export function openAI(opts) {
  if (!ai.hasKey) {
    alert('Set up AI first', 'AI food recognition uses Google Gemini with your own free API key. It takes about two minutes to set up.', [
      { label: 'Not now', role: 'cancel' },
      { label: 'Set up', handler: async () => { const { dismissAll } = await import('../ui.js'); dismissAll(); const { AISettingsScreen } = await import('./foodmore.js'); nav.switchTab('food', true); nav.push(new AISettingsScreen()); } },
    ]);
    return;
  }
  presentSheet(new AISheet(opts), { height: 'large' });
}

export class AISheet extends SheetView {
  constructor({ mode = 'photo', day, meal, text = '', barcode = null, onAdded = null }) {
    super();
    this.mode = mode; this.day = day; this.meal = meal; this.text = text; this.barcode = barcode; this.onAdded = onAdded;
    this.image = null; this.preview = null; this.phase = 'input'; this.error = ''; this.result = null; this.items = [];
    this.actions = {
      cancel: () => this.close(), done: () => (this.phase === 'review' ? this.addAll() : this.run()),
      mode: (el) => { this.mode = el.dataset.m; this.error = ''; this.refresh(); },
      take: () => this.pick(true), choose: () => this.pick(false),
      clearPhoto: () => { this.image = null; this.preview = null; this.refresh(); },
      run: () => this.run(),
      back: () => { this.phase = 'input'; this.refresh(); },
      toggleItem: (el) => { const it = this.items[Number(el.dataset.i)]; it.on = !it.on; this.refresh(); },
      editItem: (el) => this.editItem(Number(el.dataset.i)),
      meal: (el) => { this.meal = el.dataset.m; this.refresh(); },
      saveItem: (el) => { const it = this.items[Number(el.dataset.i)]; const f = Log.saveFood(this.itemFood(it), { saved: true }); it.foodId = f.id; toast(`Saved “${it.name}” to My foods`, 'good'); this.refresh(); },
    };
    this.inputs = {
      text: (el) => { this.text = el.value; },
      grams: (el) => { const it = this.items[Number(el.dataset.i)]; const g = parseDecimal(el.value); if (g != null && g >= 0) { it.grams = g; this.refreshTotals(); } },
    };
  }
  async pick(capture) {
    const file = await pickPhoto(capture);
    if (!file) return;
    try { const r = await imageToBase64(file); this.image = r.base64; this.preview = r.preview; this.error = ''; }
    catch (e) { this.error = e.message; }
    this.refresh();
  }
  async run() {
    if (this.phase === 'loading') return;
    if (this.mode !== 'text' && !this.image) { this.error = this.mode === 'label' ? 'Take a photo of the nutrition label first.' : 'Take or choose a photo first.'; this.refresh(); return; }
    if (this.mode === 'text' && !this.text.trim()) { this.error = 'Describe what you ate.'; this.refresh(); return; }
    this.phase = 'loading'; this.error = ''; this.status = ''; this.started = Date.now(); this.refresh();
    this.ticker = setInterval(() => { if (this.phase === 'loading') this.refresh(); }, 1000);
    try {
      const r = await analyse({ mode: this.mode, image: this.mode === 'text' ? null : this.image, text: this.text.trim(), onStatus: (t) => { this.status = t; this.refresh(); } });
      clearInterval(this.ticker);
      if (this.closed) return;
      if (!r.items.length) { this.phase = 'input'; this.error = r.isFood ? "The AI couldn't estimate this. Add a short description and try again." : "No food was recognised. Try a clearer photo or describe it."; this.refresh(); return; }
      if (this.mode === 'label') { this.labelToFood(r.items[0]); return; }
      this.result = r;
      this.items = r.items.map((it) => ({ ...it, on: true, grams: it.grams || null, origGrams: it.grams || null }));
      this.phase = 'review';
    } catch (e) {
      this.phase = 'input'; this.error = e instanceof AIError ? e.message : `Something went wrong: ${e.message || e}`;
    }
    clearInterval(this.ticker);
    this.refresh();
  }
  onDismiss() { this.closed = true; clearInterval(this.ticker); }
  labelToFood(item) {
    // Values come back per 100 g; review them as a custom food linked to the barcode.
    const servingG = parseDecimal((/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(item.portion) || [])[1]);
    const prefill = { name: item.name, base: item.totals, basis: '100', unit: /ml/i.test(item.portion) ? 'ml' : 'g', barcode: this.barcode, servings: servingG ? [{ label: item.portion.replace(/\s*\(.*\)/, '').trim() || 'serving', g: servingG }] : [] };
    this.close();
    presentSheet(new CustomFoodSheet({ prefill, title: 'Check label values', onSaved: (f) => presentSheet(new FoodAmountSheet({ food: f, day: this.day, meal: this.meal, onAdded: this.onAdded }), { height: 'large' }) }), { height: 'large' });
    toast('Check the values read from the label, then save', '');
  }
  itemTotals(it) { return it.grams ? scale(it.base, it.grams / 100) : it.totals; }
  itemFood(it) {
    return it.grams
      ? { id: it.foodId || uuid(), name: it.name, basis: '100', unit: 'g', base: it.base, source: 'ai', servings: it.origGrams ? [{ label: it.portion || 'portion', g: it.origGrams }] : [] }
      : { id: it.foodId || uuid(), name: it.name, basis: 'portion', unit: 'g', base: it.totals, source: 'ai', portionLabel: it.portion || 'portion', servings: [] };
  }
  editItem(i) {
    const it = this.items[i];
    const food = this.itemFood(it);
    // Edit as a full amount sheet; the edited entry replaces this AI item.
    presentSheet(new FoodAmountSheet({ food, day: this.day, meal: this.meal, qty: it.grams || 1, onAdded: (n, k) => { it.on = false; it.added = true; this.refresh(); if (this.onAdded) this.onAdded(n, k); else toast(`Added ${n}`, 'good'); } }), { height: 'large' });
  }
  totalsAll() { const t = {}; for (const it of this.items) if (it.on) addInto(t, this.itemTotals(it)); return t; }
  refreshTotals() {
    const root = document.querySelector(`[data-view="${this.id}"]`);
    if (!root) return;
    this.items.forEach((it, i) => { const el = root.querySelector(`[data-item-kcal="${i}"]`); if (el) el.textContent = `${fmtN('kcal', this.itemTotals(it).kcal || 0)} · ${macroLine(this.itemTotals(it))}`; });
    const t = root.querySelector('[data-ai-total]');
    if (t) t.innerHTML = this.totalHTML();
  }
  totalHTML() { const t = this.totalsAll(); return `<span class="headline num">${fmtN('kcal', t.kcal || 0)}</span><span class="caption muted num">${macroLine(t)} g</span>`; }
  addAll() {
    const chosen = this.items.filter((it) => it.on);
    if (!chosen.length) { this.close(); return; }
    const entries = chosen.map((it) => Log.makeEntry({
      name: it.name, basis: it.grams ? '100' : 'portion', unit: 'g', base: it.grams ? it.base : it.totals, qty: it.grams || 1,
      day: this.day, meal: this.meal, source: 'ai', portionLabel: it.grams ? null : (it.portion || 'portion'),
      servingLabel: it.origGrams && it.portion ? it.portion : null, servingG: it.origGrams && it.portion ? it.origGrams : null,
      food: it.foodId ? state.foods.get(it.foodId) : null,
    }));
    Log.addEntries(entries);
    const kcal = entries.reduce((a, e) => a + (entryTotals(e).kcal || 0), 0);
    this.close();
    if (this.onAdded) this.onAdded(entries[0].name, kcal, entries.length);
    else toast(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} · ${fmt.integer(kcal)} kcal`, 'good');
  }
  renderReview() {
    const on = this.items.filter((it) => it.on).length;
    return `${sheetHeader('Check & add', { left: 'Back', leftAct: 'back', right: on ? `Add ${on}` : 'Close' })}
      ${mealSeg(this.meal)}
      <div class="card ai-total"><div class="row-between"><span class="label">Total</span><span class="caption faint">${esc(this.result.model)}</span></div><div class="row-between" data-ai-total>${this.totalHTML()}</div></div>
      ${this.items.map((it, i) => {
        const t = this.itemTotals(it);
        const conf = it.confidence != null ? (it.confidence >= 0.75 ? ['HIGH', 'completed'] : it.confidence >= 0.45 ? ['MEDIUM', 'partial'] : ['LOW', 'missed']) : null;
        return `<div class="card ai-item ${it.on ? '' : 'off'}">
          <div class="row-between top"><button class="check-row grow" data-act="toggleItem" data-i="${i}">${it.on ? icon.check : icon.circle}<span class="minw0"><span class="block strong">${esc(it.name)}</span><span class="caption muted">${esc(it.portion)}</span></span></button>
            ${conf ? `<span class="pill ${conf[1]}">${conf[0]}</span>` : ''}</div>
          ${it.added ? '<div class="caption text-completed">Added with your edits</div>' : `<div class="row-between">
            ${it.grams != null ? `<label class="grams-field"><input class="num-input" inputmode="decimal" value="${esc(fmt.editable(it.grams))}" data-input="grams" data-i="${i}"><span class="unit">g</span></label>` : '<span class="caption faint">1 portion</span>'}
            <span class="caption muted num right" data-item-kcal="${i}">${fmtN('kcal', t.kcal || 0)} · ${macroLine(t)}</span></div>
          <div class="row-left"><button class="link-btn small" data-act="editItem" data-i="${i}">Adjust & add separately</button>${it.foodId ? '' : `<button class="link-btn small" data-act="saveItem" data-i="${i}">Save to My foods</button>`}</div>`}
        </div>`;
      }).join('')}
      ${this.result.notes ? `<div class="caption faint">${esc(this.result.notes)}</div>` : ''}
      <div class="caption faint">AI estimates can be off by 20% or more, especially for oils, sauces and portion sizes. Adjust the grams if you know better.</div>`;
  }
  render() {
    if (this.phase === 'review') return this.renderReview();
    const loading = this.phase === 'loading';
    const modes = [['photo', 'Meal photo'], ['label', 'Label'], ['text', 'Describe']];
    return `${sheetHeader('AI food log', { right: loading ? null : 'Analyse' })}
      <div class="segmented small">${modes.map(([k, l]) => `<button class="seg ${this.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}" ${loading ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      ${this.mode !== 'text' ? (this.preview
        ? `<div class="photo-prev"><img src="${this.preview}" alt="Selected photo"><button class="icon-btn photo-x" data-act="clearPhoto" aria-label="Remove photo">${icon.close}</button></div>`
        : `<div class="tiles"><button class="qa big" data-act="take">${icon.camera}<span>Take photo</span></button><button class="qa big" data-act="choose">${icon.list}<span>Choose photo</span></button></div>`) : ''}
      <textarea class="textarea short" placeholder="${this.mode === 'text' ? 'e.g. 2 scrambled eggs on 2 slices of wholemeal toast with butter, and a black coffee' : this.mode === 'label' ? 'Optional: product name' : 'Optional details: e.g. large portion, cooked in olive oil, no sauce'}" data-input="text">${esc(this.text)}</textarea>
      ${this.error ? `<div class="caption text-partial">${esc(this.error)}</div>` : ''}
      <button class="btn primary" data-act="run" ${loading ? 'disabled' : ''}>${loading ? `<span class="spinner dark"></span> ANALYSING… ${Math.floor((Date.now() - this.started) / 1000)}s` : `${icon.sparkle} ANALYSE`}</button>
      ${loading ? `<div class="caption muted">${esc(this.status || 'Usually takes 5–20 seconds.')}</div>` : ''}
      <div class="caption faint">${this.mode === 'label' ? 'Photograph the nutrition table straight on. The values are read and shown for you to check before saving.' : 'Tip: include something for scale (a fork or your hand) and mention hidden extras like oil or dressing.'} Photos and text are sent to Google Gemini for analysis and are not stored by GymOS.</div>`;
  }
}
