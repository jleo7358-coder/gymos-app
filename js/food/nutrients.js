// Nutrient catalogue, food/entry maths and food-log queries.

import { state } from './store.js';
import { fmt, sum, addDaysKey, daysInRange, norm } from '../util.js';

/**
 * kind: 'target' = aim to reach, 'limit' = stay under, 'energy' = aim close to.
 * off: Open Food Facts nutriment key (values there are in g, or kcal for energy).
 * mult: factor from the OFF unit (g) to ours.
 */
export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', short: 'kcal', unit: 'kcal', group: 'energy', kind: 'energy', off: 'energy-kcal', mult: 1 },
  { key: 'protein', label: 'Protein', short: 'P', unit: 'g', group: 'macro', kind: 'target', off: 'proteins', mult: 1 },
  { key: 'carbs', label: 'Carbohydrate', short: 'C', unit: 'g', group: 'macro', kind: 'target', off: 'carbohydrates', mult: 1 },
  { key: 'fat', label: 'Fat', short: 'F', unit: 'g', group: 'macro', kind: 'target', off: 'fat', mult: 1 },
  { key: 'fibre', label: 'Fibre', unit: 'g', group: 'other', kind: 'target', off: 'fiber', mult: 1 },
  { key: 'sugars', label: 'Sugars', unit: 'g', group: 'other', kind: 'limit', off: 'sugars', mult: 1 },
  { key: 'satFat', label: 'Saturated fat', unit: 'g', group: 'other', kind: 'limit', off: 'saturated-fat', mult: 1 },
  { key: 'salt', label: 'Salt', unit: 'g', group: 'other', kind: 'limit', off: 'salt', mult: 1 },
  { key: 'vitA', label: 'Vitamin A', unit: 'µg', group: 'vitamin', kind: 'target', off: 'vitamin-a', mult: 1e6, nrv: 800 },
  { key: 'vitC', label: 'Vitamin C', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-c', mult: 1e3, nrv: 80 },
  { key: 'vitD', label: 'Vitamin D', unit: 'µg', group: 'vitamin', kind: 'target', off: 'vitamin-d', mult: 1e6, nrv: 10 },
  { key: 'vitE', label: 'Vitamin E', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-e', mult: 1e3, nrv: 12 },
  { key: 'vitK', label: 'Vitamin K', unit: 'µg', group: 'vitamin', kind: 'target', off: 'vitamin-k', mult: 1e6, nrv: 75 },
  { key: 'thiamin', label: 'Thiamin (B1)', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-b1', mult: 1e3, nrv: 1.1 },
  { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-b2', mult: 1e3, nrv: 1.4 },
  { key: 'niacin', label: 'Niacin (B3)', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-pp', mult: 1e3, nrv: 16 },
  { key: 'vitB6', label: 'Vitamin B6', unit: 'mg', group: 'vitamin', kind: 'target', off: 'vitamin-b6', mult: 1e3, nrv: 1.4 },
  { key: 'folate', label: 'Folate (B9)', unit: 'µg', group: 'vitamin', kind: 'target', off: 'vitamin-b9', mult: 1e6, nrv: 200 },
  { key: 'vitB12', label: 'Vitamin B12', unit: 'µg', group: 'vitamin', kind: 'target', off: 'vitamin-b12', mult: 1e6, nrv: 2.5 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', group: 'mineral', kind: 'target', off: 'calcium', mult: 1e3, nrv: 800 },
  { key: 'iron', label: 'Iron', unit: 'mg', group: 'mineral', kind: 'target', off: 'iron', mult: 1e3, nrv: 14 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', group: 'mineral', kind: 'target', off: 'magnesium', mult: 1e3, nrv: 375 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', group: 'mineral', kind: 'target', off: 'potassium', mult: 1e3, nrv: 3500 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', group: 'mineral', kind: 'target', off: 'zinc', mult: 1e3, nrv: 10 },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg', group: 'mineral', kind: 'target', off: 'phosphorus', mult: 1e3, nrv: 700 },
  { key: 'selenium', label: 'Selenium', unit: 'µg', group: 'mineral', kind: 'target', off: 'selenium', mult: 1e6, nrv: 55 },
  { key: 'iodine', label: 'Iodine', unit: 'µg', group: 'mineral', kind: 'target', off: 'iodine', mult: 1e6, nrv: 150 },
];
export const N = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));
export const KEYS = NUTRIENTS.map((n) => n.key);
export const MICROS = NUTRIENTS.filter((n) => n.group === 'vitamin' || n.group === 'mineral');
export const GROUPS = [['energy', 'Energy'], ['macro', 'Macronutrients'], ['other', 'Fibre, sugars, fat & salt'], ['vitamin', 'Vitamins'], ['mineral', 'Minerals']];

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
];
export const mealLabel = (k) => (MEALS.find((m) => m.key === k) || MEALS[3]).label;
export function defaultMeal(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
}

/** Format a nutrient amount for display. */
export function fmtN(key, v, withUnit = true) {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = N[key] ? N[key].unit : 'g';
  let s;
  if (key === 'kcal') s = fmt.integer(v);
  else if (u === 'g') s = fmt.number(v, v < 10 ? 1 : 0);
  else s = fmt.number(v, v < 10 ? 1 : 0);
  return withUnit ? `${s}${u === 'kcal' ? ' kcal' : ' ' + u}` : s;
}

/** Keep only finite, non-negative numbers. */
export function cleanNutrients(n) {
  const out = {};
  if (!n) return out;
  for (const k of KEYS) {
    const v = Number(n[k]);
    if (n[k] != null && n[k] !== '' && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Foods & entries
//
// A food stores nutrients per basis: '100' = per 100 g (or 100 ml), 'portion' = per one portion.
// An entry is a snapshot of the food at the time it was logged (later edits to the food
// never change history): { base, basis, qty } where qty is grams/ml or a portion count.

export function scale(base, factor) {
  const out = {};
  for (const k of Object.keys(base || {})) out[k] = base[k] * factor;
  return out;
}
export const factorFor = (basis, qty) => (basis === 'portion' ? qty : qty / 100);
export const entryTotals = (e) => scale(e.base, factorFor(e.basis, e.qty));

export function addInto(acc, n) { for (const k of Object.keys(n)) acc[k] = (acc[k] || 0) + n[k]; return acc; }

export function amountText(e) {
  if (e.basis === 'portion') {
    const q = fmt.number(e.qty, 2);
    return e.portionLabel ? `${q} × ${e.portionLabel}` : `${q} portion${e.qty === 1 ? '' : 's'}`;
  }
  const u = e.unit || 'g';
  if (e.servingLabel && e.servingG) {
    const count = e.qty / e.servingG;
    const c = Math.abs(count - Math.round(count * 4) / 4) < 0.01 ? fmt.number(count, 2) : null;
    if (c) return `${count === 1 ? '' : `${c} × `}${e.servingLabel}${/\d\s*(g|ml)\b/i.test(e.servingLabel) && count === 1 ? '' : ` (${fmt.integer(e.qty)} ${u})`}`;
  }
  return `${fmt.number(e.qty, 1)} ${u}`;
}

// ---------------------------------------------------------------------------------
// Queries

export const F = {
  entriesOn(day) {
    const out = [];
    for (const e of state.entries.values()) if (e.day === day) out.push(e);
    return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  },
  entriesInRange(fromKey, toKey) {
    const out = [];
    for (const e of state.entries.values()) if (e.day >= fromKey && e.day <= toKey) out.push(e);
    return out;
  },
  dayTotals(day) {
    const t = {};
    for (const e of this.entriesOn(day)) addInto(t, entryTotals(e));
    return t;
  },
  /** Map day → totals for every day in the range that has entries. */
  totalsByDay(fromKey, toKey) {
    const m = new Map();
    for (const e of this.entriesInRange(fromKey, toKey)) {
      if (!m.has(e.day)) m.set(e.day, { totals: {}, count: 0 });
      const d = m.get(e.day);
      addInto(d.totals, entryTotals(e)); d.count++;
    }
    return m;
  },
  water(day) { const d = state.days.get(day); return d ? d.waterMl || 0 : 0; },
  dayRecord(day) { return state.days.get(day) || { day, waterMl: 0 }; },
  foods() { return [...state.foods.values()].filter((f) => !f.hidden); },
  food(id) { return id ? state.foods.get(id) : null; },
  foodByBarcode(code) {
    for (const f of state.foods.values()) if (f.barcode === code) return f;
    return null;
  },
  favourites() { return this.foods().filter((f) => f.fav).sort((a, b) => a.name.localeCompare(b.name)); },
  myFoods() { return this.foods().filter((f) => f.source === 'custom' || f.saved).sort((a, b) => a.name.localeCompare(b.name)); },
  /** Recently logged distinct foods (by food id or name), newest first. */
  recents(limit = 40) {
    const all = [...state.entries.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const seen = new Set(); const out = [];
    for (const e of all) {
      const k = e.foodId || 'n:' + norm(e.name) + '|' + (e.basis === 'portion' ? 'p' : 'g');
      if (seen.has(k)) continue;
      seen.add(k); out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  },
  meals() { return [...state.meals.values()].sort((a, b) => a.name.localeCompare(b.name)); },
  searchLocal(q, limit = 30) {
    q = norm(q);
    if (!q) return { foods: [], entries: [] };
    const words = q.split(' ');
    const match = (s) => { const n = norm(s); return words.every((w) => n.includes(w)); };
    const foods = this.foods().filter((f) => match(`${f.name} ${f.brand || ''}`) || f.barcode === q)
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, limit);
    const ids = new Set(foods.map((f) => f.id));
    const fromLog = this.recents(300).filter((e) => !(e.foodId && ids.has(e.foodId)) && match(`${e.name} ${e.brand || ''}`)).slice(0, 10);
    return { foods, entries: fromLog };
  },
  loggedDays(fromKey, toKey) {
    const set = new Set();
    for (const e of this.entriesInRange(fromKey, toKey)) set.add(e.day);
    return set;
  },
  streak(today) {
    let n = 0; let d = today;
    const days = new Set([...state.entries.values()].map((e) => e.day));
    if (!days.has(d)) d = addDaysKey(d, -1); // today not logged yet doesn't break the streak
    while (days.has(d)) { n++; d = addDaysKey(d, -1); }
    return n;
  },
};

export function averageTotals(byDay, keys = KEYS) {
  const days = [...byDay.values()];
  const out = {};
  if (!days.length) return out;
  for (const k of keys) {
    const vals = days.map((d) => d.totals[k]).filter((v) => v != null);
    if (vals.length) out[k] = sum(vals) / days.length;
  }
  return out;
}

/** How many of the day's entries carry data for a nutrient (micronutrient coverage). */
export function coverage(entries, key) {
  if (!entries.length) return { have: 0, total: 0 };
  return { have: entries.filter((e) => e.base && e.base[key] != null).length, total: entries.length };
}

export { daysInRange };
