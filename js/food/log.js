// Food-log actions: logging, editing, water, copying days, saved meals, favourites.

import * as FS from './store.js';
import { state } from './store.js';
import { F, cleanNutrients } from './nutrients.js';
import { changed } from '../engine.js';
import * as DB from '../db.js';
import { uuid, addDaysKey } from '../util.js';

const isDemo = () => DB.demo.active;

/** Save (or update) a food in My foods / the cache. */
export function saveFood(food, extra = {}) {
  const f = { ...food, ...extra, base: cleanNutrients(food.base), updatedAt: Date.now() };
  if (!f.id) f.id = uuid();
  if (!f.createdAt) f.createdAt = Date.now();
  if (f.isDemo == null) f.isDemo = isDemo();
  FS.put('foods', f);
  changed();
  return f;
}

function touchFood(foodId) {
  const f = foodId && state.foods.get(foodId);
  if (!f) return;
  FS.put('foods', { ...f, useCount: (f.useCount || 0) + 1, lastUsed: Date.now() });
}

/** Snapshot an entry from a food (or ad-hoc data). */
export function makeEntry({ food = null, name, brand = null, basis, unit = 'g', base, qty, day, meal, servingLabel = null, servingG = null, portionLabel = null, source = 'manual', note = null }) {
  return {
    id: uuid(), day, meal, ts: Date.now(),
    foodId: food && state.foods.has(food.id) ? food.id : null,
    name: (name || (food && food.name) || 'Food').trim(), brand: brand ?? (food && food.brand) ?? null,
    basis: basis || (food && food.basis) || '100', unit: unit || (food && food.unit) || 'g',
    base: cleanNutrients(base || (food && food.base) || {}), qty: Number(qty) || 0,
    servingLabel, servingG, portionLabel, source: source || (food && food.source) || 'manual', note, isDemo: isDemo(),
  };
}

export function addEntries(entries) {
  if (!entries.length) return;
  FS.batch(entries.map((e) => ({ store: 'entries', put: e })));
  for (const e of entries) touchFood(e.foodId);
  changed();
}
export function addEntry(e) { addEntries([e]); return e; }

export function updateEntry(e, patch) {
  const next = { ...e, ...patch };
  FS.put('entries', next);
  changed();
  return next;
}
export function deleteEntry(id) { FS.remove('entries', id); changed(); }
export function deleteEntries(ids) { FS.batch(ids.map((id) => ({ store: 'entries', del: id }))); changed(); }

/** Copies entries to another day/meal (new ids). */
export function copyEntries(entries, day, meal = null) {
  const now = Date.now();
  const copies = entries.map((e, i) => ({ ...e, id: uuid(), day, meal: meal || e.meal, ts: now + i, isDemo: isDemo() }));
  addEntries(copies);
  return copies.length;
}
export function copyDay(fromDay, toDay) { return copyEntries(F.entriesOn(fromDay), toDay); }
export function copyMeal(fromDay, meal, toDay, toMeal = meal) { return copyEntries(F.entriesOn(fromDay).filter((e) => e.meal === meal), toDay, toMeal); }

// Water -------------------------------------------------------------------------

export function addWater(day, ml) {
  const d = F.dayRecord(day);
  FS.put('days', { ...d, day, waterMl: Math.max(0, Math.round((d.waterMl || 0) + ml)), isDemo: d.isDemo ?? isDemo() });
  changed();
}
export function setWater(day, ml) {
  const d = F.dayRecord(day);
  FS.put('days', { ...d, day, waterMl: Math.max(0, Math.round(ml)) });
  changed();
}

// Saved meals -------------------------------------------------------------------

const itemOf = (e) => {
  const { id, day, meal, ts, isDemo: _d, ...rest } = e;
  return rest;
};
export function saveMeal(name, entries) {
  const m = { id: uuid(), name: name.trim() || 'Meal', items: entries.map(itemOf), createdAt: Date.now(), isDemo: isDemo() };
  FS.put('meals', m);
  changed();
  return m;
}
export function logMeal(meal, day, mealKey) {
  const now = Date.now();
  const entries = meal.items.map((it, i) => ({ ...it, id: uuid(), day, meal: mealKey, ts: now + i, isDemo: isDemo() }));
  addEntries(entries);
  FS.put('meals', { ...meal, useCount: (meal.useCount || 0) + 1, lastUsed: now });
  return entries.length;
}
export function renameMeal(meal, name) { FS.put('meals', { ...meal, name }); changed(); }
export function deleteMeal(id) { FS.remove('meals', id); changed(); }

// Foods -------------------------------------------------------------------------

export function toggleFavourite(food) {
  const f = state.foods.get(food.id) || saveFood(food);
  FS.put('foods', { ...f, fav: !f.fav });
  changed();
  return !f.fav;
}
/** Hide rather than delete, so recents that point at it still have names. */
export function deleteFood(id) {
  const f = state.foods.get(id);
  if (!f) return;
  const used = [...state.entries.values()].some((e) => e.foodId === id);
  if (used) FS.put('foods', { ...f, hidden: true, fav: false, saved: false });
  else FS.remove('foods', id);
  changed();
}

/** Food record from a past entry (for "log again" from recents). */
export function foodFromEntry(e) {
  const f = e.foodId && state.foods.get(e.foodId);
  if (f) return f;
  return {
    id: null, name: e.name, brand: e.brand, basis: e.basis, unit: e.unit, base: e.base, source: e.source,
    servings: e.servingLabel && e.servingG ? [{ label: e.servingLabel, g: e.servingG }] : [],
    portionLabel: e.portionLabel, lastQty: e.qty,
  };
}

export const yesterday = (day) => addDaysKey(day, -1);
