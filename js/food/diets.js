// Diet style presets. Applying one sets the goal (for cut/bulk styles), the macro method and
// any nutrient limits that define the diet. Everything stays editable afterwards.

import { profile, updateProfile, DIET_DEFAULTS } from './goals.js';

export const GROUPS = [
  ['loss', 'Fat loss'],
  ['gain', 'Muscle gain'],
  ['maintain', 'Maintain & perform'],
  ['lowcarb', 'Low carb'],
  ['health', 'Health & lifestyle'],
];

/**
 * set: profile fields. goal/rate only on cut and bulk styles; others keep your current goal.
 * macroMode: 'perkg' (protein g/kg, fat % of kcal, carbs = rest) | 'carbcap' (protein g/kg, carbs fixed g,
 * fat = rest) | 'percent' (protein/carbs/fat as % of kcal).
 */
export const PRESETS = [
  // Fat loss
  { key: 'cut', group: 'loss', name: 'Steady cut', desc: 'Lose about 0.5 kg a week while keeping strength. The safe default for most people.',
    set: { goal: 'lose', rate: 0.5, macroMode: 'perkg', proteinPerKg: 2.0, fatPct: 25 } },
  { key: 'shred', group: 'loss', name: 'Aggressive cut', desc: 'About 0.75 kg a week with very high protein to protect muscle. Best for 8–12 weeks.',
    set: { goal: 'lose', rate: 0.75, macroMode: 'perkg', proteinPerKg: 2.4, fatPct: 20 } },
  { key: 'minicut', group: 'loss', name: 'Mini cut', desc: 'A short, hard 2–6 week cut (1 kg a week) to strip fat between bulks.',
    set: { goal: 'lose', rate: 1, macroMode: 'perkg', proteinPerKg: 2.5, fatPct: 20 } },
  { key: 'gentle', group: 'loss', name: 'Gentle fat loss', desc: 'About 0.25 kg a week. Easier to stick to, little hunger, training stays strong.',
    set: { goal: 'lose', rate: 0.25, macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 30 } },
  { key: 'recomp', group: 'loss', name: 'Body recomposition', desc: 'A small deficit with high protein: lose fat and build muscle slowly at the same time.',
    set: { goal: 'lose', rate: 0.25, macroMode: 'perkg', proteinPerKg: 2.2, fatPct: 25 } },
  // Muscle gain
  { key: 'leanbulk', group: 'gain', name: 'Lean bulk', desc: 'Gain about 0.25 kg a week. Mostly muscle, minimal fat.',
    set: { goal: 'gain', rate: 0.25, macroMode: 'perkg', proteinPerKg: 2.0, fatPct: 25 } },
  { key: 'bulk', group: 'gain', name: 'Standard bulk', desc: 'About 0.5 kg a week. Faster strength gains, some fat gain.',
    set: { goal: 'gain', rate: 0.5, macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 25 } },
  { key: 'fastgain', group: 'gain', name: 'Fast gain', desc: 'About 0.75 kg a week, for people who struggle to put on weight. Extra fat makes it easier to eat.',
    set: { goal: 'gain', rate: 0.75, macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 30 } },
  // Maintain & perform
  { key: 'balanced', group: 'maintain', name: 'Balanced', desc: 'The default: 1.8 g/kg protein, 25% fat, carbs for the rest. Works with any goal.',
    set: { macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 25 } },
  { key: 'highprotein', group: 'maintain', name: 'High protein', desc: '2.2 g/kg protein. More fullness and muscle support at any calorie level.',
    set: { macroMode: 'perkg', proteinPerKg: 2.2, fatPct: 25 } },
  { key: 'endurance', group: 'maintain', name: 'High carb / endurance', desc: 'Lower fat, lots of carbs to fuel hard training, cardio and sport.',
    set: { macroMode: 'perkg', proteinPerKg: 1.6, fatPct: 20 } },
  { key: 'zone', group: 'maintain', name: 'Zone 40/30/30', desc: '40% carbs, 30% protein, 30% fat of your calories.',
    set: { macroMode: 'percent', pct: { protein: 30, carbs: 40, fat: 30 } } },
  // Low carb
  { key: 'lowcarb', group: 'lowcarb', name: 'Low carb', desc: 'About 100 g carbs a day, protein high, fat fills the rest.',
    set: { macroMode: 'carbcap', proteinPerKg: 2.0, carbCap: 100, sugarLimit: 50 } },
  { key: 'keto', group: 'lowcarb', name: 'Keto', desc: 'About 25 g carbs a day to stay in ketosis. Fat is your main fuel; keep fibre up with vegetables.',
    set: { macroMode: 'carbcap', proteinPerKg: 1.6, carbCap: 25, sugarLimit: 20, satFatPct: 13, fibre: 25 } },
  { key: 'paleo', group: 'lowcarb', name: 'Paleo', desc: 'Whole foods, no grains or added sugar: 30% protein, 30% carbs, 40% fat.',
    set: { macroMode: 'percent', pct: { protein: 30, carbs: 30, fat: 40 }, sugarLimit: 50, fibre: 30 } },
  // Health & lifestyle
  { key: 'mediterranean', group: 'health', name: 'Mediterranean', desc: 'Olive oil, fish, beans and vegetables: more healthy fat, little saturated fat, lots of fibre.',
    set: { macroMode: 'perkg', proteinPerKg: 1.6, fatPct: 35, satFatPct: 8, fibre: 35, sugarLimit: 60 } },
  { key: 'dash', group: 'health', name: 'DASH (heart health)', desc: 'Low salt, high potassium, calcium and magnesium. Designed to lower blood pressure.',
    set: { macroMode: 'perkg', proteinPerKg: 1.6, fatPct: 27, satFatPct: 6, saltLimit: 3.8, fibre: 35, sugarLimit: 50,
      nutrients: { potassium: 4700, calcium: 1250, magnesium: 500 } } },
  { key: 'plant', group: 'health', name: 'Plant-based', desc: 'Vegetarian or vegan: a little more protein (plant protein absorbs less), lots of fibre, and an eye on iron, B12 and calcium.',
    set: { macroMode: 'perkg', proteinPerKg: 2.0, fatPct: 25, fibre: 40, nutrients: { iron: 18, calcium: 1000 } } },
  { key: 'lowfat', group: 'health', name: 'Low fat', desc: '20% of calories from fat, little saturated fat, more carbs.',
    set: { macroMode: 'perkg', proteinPerKg: 1.6, fatPct: 20, satFatPct: 7 } },
  { key: 'if168', group: 'health', name: '16:8 fasting', desc: 'Balanced macros, eaten inside an 8-hour window (12:00–20:00). The window shows on the Food tab.',
    set: { macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 25, window: { start: '12:00', end: '20:00' } } },
];

export const preset = (key) => PRESETS.find((x) => x.key === key) || null;

/** The profile a preset would produce (for previews), without saving. */
export function withPreset(p, key) {
  const pr = preset(key);
  if (!pr) return p;
  const macroOverrides = ['protein', 'carbs', 'fat', 'fibre', 'sugars', 'satFat', 'salt'];
  const overrides = { ...p.overrides };
  for (const k of macroOverrides) delete overrides[k];
  for (const k of Object.keys(pr.set.nutrients || {})) delete overrides[k];
  return { ...p, ...DIET_DEFAULTS, ...pr.set, overrides, diet: key };
}

export function applyPreset(key) {
  const next = withPreset(profile(), key);
  return updateProfile(next);
}

/** True when settings have been changed since the preset was applied. */
export function isCustomised(p) {
  const pr = preset(p.diet);
  if (!pr) return false;
  const want = { ...DIET_DEFAULTS, ...pr.set };
  return Object.keys(want).some((k) => JSON.stringify(p[k] ?? null) !== JSON.stringify(want[k] ?? null));
}
