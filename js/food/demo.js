// Demo food log (two weeks), flagged isDemo so the demo reset removes exactly this.

import * as FS from './store.js';
import { state } from './store.js';
import { uuid, addDaysKey, todayKey, parseDay } from '../util.js';

const FOODS = [
  // name, brand, per-100 nutrients, serving [label, g]
  ['Porridge oats', 'Quaker', { kcal: 375, protein: 11, carbs: 60, fat: 8, fibre: 9, sugars: 1.1, satFat: 1.5, salt: 0.01, iron: 3.6, magnesium: 130, zinc: 2.5 }, ['1 bowl', 50]],
  ['Semi-skimmed milk', 'Tesco', { kcal: 50, protein: 3.6, carbs: 4.8, fat: 1.8, sugars: 4.8, satFat: 1.1, salt: 0.11, calcium: 124, vitB12: 0.9 }, ['1 glass', 250], 'ml'],
  ['Banana', null, { kcal: 89, protein: 1.1, carbs: 20.3, fat: 0.3, fibre: 2.6, sugars: 12.2, satFat: 0.1, salt: 0, potassium: 358, vitC: 8.7, vitB6: 0.37 }, ['1 medium', 118]],
  ['Whey protein', 'MyProtein', { kcal: 400, protein: 80, carbs: 6, fat: 7, sugars: 4, satFat: 4.5, salt: 0.5, calcium: 450 }, ['1 scoop', 25]],
  ['Chicken breast, grilled', null, { kcal: 165, protein: 31, carbs: 0, fat: 3.6, satFat: 1, salt: 0.18, niacin: 13, vitB6: 0.6, selenium: 27, phosphorus: 230 }, ['1 breast', 150]],
  ['Basmati rice, cooked', null, { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fibre: 0.4, sugars: 0.1, satFat: 0.1, salt: 0 }, ['1 portion', 180]],
  ['Broccoli', null, { kcal: 34, protein: 2.8, carbs: 4.4, fat: 0.4, fibre: 2.6, sugars: 1.7, satFat: 0, salt: 0.08, vitC: 89, vitK: 101, folate: 63 }, ['1 portion', 80]],
  ['Greek yoghurt 0%', 'Fage', { kcal: 54, protein: 10.3, carbs: 3, fat: 0, sugars: 3, satFat: 0, salt: 0.1, calcium: 110 }, ['1 pot', 170]],
  ['Wholemeal bread', 'Hovis', { kcal: 228, protein: 10.4, carbs: 37, fat: 2.5, fibre: 6.8, sugars: 3, satFat: 0.5, salt: 0.95, iron: 2.4 }, ['1 slice', 40]],
  ['Eggs, scrambled', null, { kcal: 160, protein: 11, carbs: 1.6, fat: 12, sugars: 1.4, satFat: 3.6, salt: 0.4, vitD: 2, vitB12: 1, selenium: 23 }, ['2 eggs', 120]],
  ['Salmon fillet', null, { kcal: 208, protein: 20, carbs: 0, fat: 13, satFat: 3.1, salt: 0.15, vitD: 11, vitB12: 3.2, selenium: 36 }, ['1 fillet', 120]],
  ['Sweet potato, baked', null, { kcal: 90, protein: 2, carbs: 20.7, fat: 0.2, fibre: 3.3, sugars: 6.5, satFat: 0, salt: 0.09, vitA: 961, potassium: 475 }, ['1 medium', 150]],
  ['Almonds', null, { kcal: 579, protein: 21, carbs: 9, fat: 50, fibre: 12.5, sugars: 4.4, satFat: 3.8, salt: 0, vitE: 25.6, magnesium: 270 }, ['1 handful', 30]],
  ['Pasta bolognese', null, { kcal: 150, protein: 8, carbs: 17, fat: 5, fibre: 1.5, sugars: 3, satFat: 2, salt: 0.6, iron: 1.3 }, ['1 plate', 400]],
];

export async function loadFoodDemo() {
  if (!FS.isAvailable()) return;
  const now = Date.now();
  const foods = FOODS.map(([name, brand, base, sv, unit], i) => ({
    id: uuid(), name, brand, barcode: null, source: i % 3 === 0 ? 'off' : 'custom', saved: i % 3 !== 0, basis: '100', unit: unit || 'g',
    base, servings: [{ label: sv[0], g: sv[1] }], fav: i < 3, createdAt: now - 20 * 86400000, useCount: 0, isDemo: true,
  }));
  const by = Object.fromEntries(foods.map((f) => [f.name, f]));
  const plan = [
    ['breakfast', ['Porridge oats', 1.2], ['Semi-skimmed milk', 1], ['Banana', 1]],
    ['lunch', ['Chicken breast, grilled', 1], ['Basmati rice, cooked', 1], ['Broccoli', 1]],
    ['snacks', ['Greek yoghurt 0%', 1], ['Whey protein', 1], ['Almonds', 1]],
    ['dinner', ['Salmon fillet', 1], ['Sweet potato, baked', 1.3], ['Broccoli', 1]],
  ];
  const alt = [
    ['breakfast', ['Eggs, scrambled', 1], ['Wholemeal bread', 2]],
    ['dinner', ['Pasta bolognese', 1]],
  ];
  const ops = foods.map((f) => ({ store: 'foods', put: f }));
  const today = todayKey();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let d = 14; d >= 0; d--) {
    const day = addDaysKey(today, -d);
    if (d === 9) continue; // a missed day
    const dayStart = parseDay(day).getTime();
    const meals = d % 3 === 0 ? [alt[0], plan[1], plan[2], alt[1]] : plan;
    const use = d === 0 ? meals.slice(0, 2) : meals;
    use.forEach(([meal, ...items], mi) => {
      items.forEach(([name, n], k) => {
        const f = by[name];
        const qty = Math.round(f.servings[0].g * n * (0.85 + rnd() * 0.35));
        ops.push({ store: 'entries', put: {
          id: uuid(), day, meal, ts: dayStart + (8 + mi * 4) * 3600000 + k * 60000, foodId: f.id, name: f.name, brand: f.brand,
          basis: '100', unit: f.unit, base: f.base, qty, servingLabel: f.servings[0].label, servingG: f.servings[0].g, portionLabel: null,
          source: f.source, note: null, isDemo: true,
        } });
      });
    });
    if (!state.days.has(day)) ops.push({ store: 'days', put: { day, waterMl: d === 0 ? 1000 : 1750 + Math.round(rnd() * 8) * 250, isDemo: true } });
  }
  ops.push({ store: 'meals', put: { id: uuid(), name: 'Usual breakfast', isDemo: true, createdAt: now, items: plan[0].slice(1).map(([name, n]) => {
    const f = by[name];
    return { foodId: f.id, name: f.name, brand: f.brand, basis: '100', unit: f.unit, base: f.base, qty: Math.round(f.servings[0].g * n), servingLabel: f.servings[0].label, servingG: f.servings[0].g, portionLabel: null, source: f.source, note: null };
  }) } });
  await FS.batch(ops);
}

export const hasRealFood = () => [...state.entries.values()].some((e) => !e.isDemo);

export async function resetFoodDemo() {
  if (!FS.isAvailable()) return;
  const ops = [];
  for (const store of ['foods', 'entries', 'meals', 'days']) {
    for (const [key, r] of state[store]) if (r.isDemo) ops.push({ store, del: key });
  }
  await FS.batch(ops);
}
