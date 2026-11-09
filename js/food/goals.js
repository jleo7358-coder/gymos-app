// Nutrition goals: body inputs (read-only from the Body tab), BMR/TDEE, calorie & macro
// targets, training-day calorie cycling, adaptive TDEE from weigh-ins + intake, and BMI.

import { Q, Calendar } from '../engine.js';
import { getKV, setKV } from './store.js';
import { NUTRIENTS, N, F } from './nutrients.js';
import { planDay, dayMacros } from './plan.js';
import { addDaysKey, todayKey, parseDay, MS_DAY, sum, clamp } from '../util.js';

export const ACTIVITY = [
  [1.2, 'Sedentary', 'Desk job, little exercise'],
  [1.375, 'Lightly active', 'Light exercise 1–3 days a week'],
  [1.55, 'Moderately active', 'Training 3–5 days a week'],
  [1.725, 'Very active', 'Hard training 6–7 days a week'],
  [1.9, 'Extremely active', 'Physical job plus hard training'],
];
export const GOALS = [['lose', 'Lose fat'], ['maintain', 'Maintain'], ['gain', 'Build muscle']];
export const RATES = [0.1, 0.25, 0.5, 0.75, 1];
const KCAL_PER_KG = 7700;

/** Diet-style fields a preset can set (see diets.js). */
export const DIET_DEFAULTS = {
  macroMode: 'perkg', proteinPerKg: 1.8, fatPct: 25, carbCap: 100, pct: { protein: 30, carbs: 40, fat: 30 },
  fibre: 30, sugarLimit: 90, satFatPct: 10, saltLimit: 6, nutrients: {}, window: null,
};
export const MACRO_MODES = [['perkg', 'Protein per kg + fat %'], ['carbcap', 'Fixed carbs (low carb / keto)'], ['percent', 'Percent split']];

export const DEFAULT_PROFILE = {
  sex: null, activity: 1.55, goal: 'maintain', rate: 0.5,
  ...DIET_DEFAULTS, diet: 'balanced',
  targetWeightKg: null, targetDate: null, startWeightKg: null, startDate: null,
  adaptive: true, cycling: false, cycleKcal: 200, useBodyFat: true,
  manual: { weightKg: null, heightCm: null, age: null },
  overrides: {}, waterMl: null, waterTrainingMl: 500,
};

export function profile() {
  const p = getKV('profile', {}) || {};
  return {
    ...DEFAULT_PROFILE, ...p, manual: { ...DEFAULT_PROFILE.manual, ...(p.manual || {}) }, overrides: { ...(p.overrides || {}) },
    pct: { ...DIET_DEFAULTS.pct, ...(p.pct || {}) }, nutrients: { ...(p.nutrients || {}) },
  };
}
export function updateProfile(patch) { return setKV('profile', { ...profile(), ...patch }); }
export const isConfigured = () => !!getKV('profile', null) && !!profile().sex;

// ---------------------------------------------------------------------------------
// Body inputs: latest Body-tab check-in values (never modified here), manual fallback.

export function bodyInputs(p = profile()) {
  const entries = Q.bodyStats(); // newest first
  const w = entries.find((e) => e.weightKg != null);
  const h = entries.find((e) => e.heightInches);
  const a = entries.find((e) => e.age != null);
  const bf = entries.find((e) => e.bodyFatPercent != null && Date.now() - e.date < 120 * MS_DAY);
  const ageNow = a ? a.age + Math.floor((Date.now() - a.date) / (365.25 * MS_DAY)) : null;
  return {
    weightKg: w ? w.weightKg : p.manual.weightKg,
    heightCm: h ? h.heightInches * 2.54 : p.manual.heightCm,
    age: ageNow != null ? ageNow : p.manual.age,
    bodyFat: bf ? bf.bodyFatPercent : null,
    fromBody: { weight: !!w, height: !!h, age: !!a },
    weightDate: w ? w.date : null,
  };
}

// ---------------------------------------------------------------------------------
// Formulas

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}
export function bmiBand(v) {
  if (v == null) return null;
  return v < 18.5 ? ['Underweight', 'partial'] : v < 25 ? ['Healthy', 'completed'] : v < 30 ? ['Overweight', 'partial'] : ['Obese', 'missed'];
}
export function healthyWeightRange(heightCm) {
  if (!heightCm) return null;
  const m2 = (heightCm / 100) ** 2;
  return [18.5 * m2, 24.9 * m2];
}
/** Mifflin-St Jeor, or Katch-McArdle when body fat is known. */
export function bmr({ weightKg, heightCm, age, sex, bodyFat }, useBodyFat = true) {
  if (useBodyFat && bodyFat != null && weightKg) {
    const lbm = weightKg * (1 - bodyFat / 100);
    return { value: 370 + 21.6 * lbm, method: 'Katch-McArdle' };
  }
  if (!weightKg || !heightCm || age == null) return null;
  const s = sex === 'female' ? -161 : sex === 'male' ? 5 : -78;
  return { value: 10 * weightKg + 6.25 * heightCm - 5 * age + s, method: 'Mifflin-St Jeor' };
}

/** Least-squares slope (y per x). */
function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = sum(points, (p) => p.x) / n, my = sum(points, (p) => p.y) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  return den ? num / den : null;
}

/** Adaptive TDEE from the last 4 weeks of logged intake and weigh-ins. */
export function adaptiveTDEE(formulaTDEE, today = todayKey()) {
  const end = addDaysKey(today, -1); // today is still in progress
  const start = addDaysKey(today, -28);
  const byDay = F.totalsByDay(start, end);
  const threshold = Math.max(800, (formulaTDEE || 2000) * 0.5);
  const logged = [...byDay.values()].map((d) => d.totals.kcal || 0).filter((k) => k >= threshold);
  const startMs = parseDay(addDaysKey(today, -35)).getTime();
  const weights = Q.bodyStats(false).filter((e) => e.weightKg != null && e.date >= startMs)
    .map((e) => ({ x: e.date / MS_DAY, y: e.weightKg }));
  const span = weights.length >= 2 ? weights[weights.length - 1].x - weights[0].x : 0;
  const status = {
    loggedDays: logged.length, weighIns: weights.length, spanDays: Math.round(span),
    ready: false, value: null, confidence: 0, avgIntake: logged.length ? sum(logged) / logged.length : null, weeklyChangeKg: null,
  };
  if (logged.length < 10 || weights.length < 2 || span < 10 || !formulaTDEE) return status;
  const s = slope(weights); // kg per day
  if (s == null) return status;
  let value = status.avgIntake - s * KCAL_PER_KG;
  value = clamp(value, formulaTDEE * 0.6, formulaTDEE * 1.5);
  status.ready = true;
  status.value = value;
  status.weeklyChangeKg = s * 7;
  status.confidence = Math.min(1, logged.length / 21) * Math.min(1, span / 21);
  return status;
}

export function trainingDaysPerWeek() {
  return new Set(Q.routines().filter((r) => r.weekday).map((r) => r.weekday)).size;
}
export const isTrainingDay = (day) => !!Calendar.routineFor(day);

const round = (v, to = 1) => Math.round(v / to) * to;

/** Everything the Goals screen shows, plus per-nutrient targets for a given day. */
export function compute(day = todayKey(), p = profile()) {
  const body = bodyInputs(p);
  const B = bmr({ ...body, sex: p.sex }, p.useBodyFat);
  const formula = B ? B.value * p.activity : null;
  const adaptive = adaptiveTDEE(formula, todayKey());
  const tdee = formula == null ? null : (p.adaptive && adaptive.ready ? formula + (adaptive.value - formula) * adaptive.confidence : formula);
  const plan = weightPlan(p, body);
  const rate = plan.rate;
  const delta = p.goal === 'lose' ? -rate * KCAL_PER_KG / 7 : p.goal === 'gain' ? rate * KCAL_PER_KG / 7 : 0;
  const floor = p.sex === 'male' ? 1500 : 1200;
  let base = tdee == null ? 2000 : tdee + delta;
  const floored = base < floor;
  base = Math.max(floor, base);

  const T = trainingDaysPerWeek();
  const training = isTrainingDay(day);
  let kcal = base, trainKcal = base, restKcal = base;
  if (p.cycling && T > 0 && T < 7) {
    trainKcal = base + p.cycleKcal;
    restKcal = base - (p.cycleKcal * T) / (7 - T);
    kcal = training ? trainKcal : restKcal;
  }
  // An imported weekly plan sets each weekday's calories (and protein/fat) directly.
  const pd = p.plan ? planDay(p.plan, day) : null;
  if (pd) kcal = pd.kcal;
  const ov = p.overrides || {};
  if (ov.kcal != null) kcal = ov.kcal;
  kcal = round(kcal, 10);

  const weight = body.weightKg || 75;
  const targets = { kcal, ...macroTargets(p, kcal, weight) };
  if (pd) {
    const hasMacros = p.plan.protein != null || p.plan.fat != null || Object.keys(pd.targets || {}).some((k) => ['protein', 'carbs', 'fat'].includes(k));
    if (hasMacros) {
      const m = dayMacros(p.plan, { ...pd, kcal }, targets.protein);
      targets.protein = m.protein; targets.carbs = Math.max(0, m.carbs); targets.fat = Math.max(0, m.fat);
    }
  }
  for (const k of ['protein', 'carbs', 'fat']) if (ov[k] != null) targets[k] = ov[k];
  targets.fibre = ov.fibre ?? p.fibre;
  targets.sugars = ov.sugars ?? p.sugarLimit;
  targets.satFat = ov.satFat ?? round(kcal * (p.satFatPct / 100) / 9);
  targets.salt = ov.salt ?? p.saltLimit;
  for (const n of NUTRIENTS) if (n.nrv != null) targets[n.key] = ov[n.key] ?? (p.nutrients[n.key] ?? n.nrv);
  // Plan-wide nutrient targets, then the day's own (your custom targets in Goals still win).
  if (pd) {
    for (const src of [p.plan.nutrients || {}, pd.targets || {}]) {
      for (const [k, v] of Object.entries(src)) if (!['protein', 'carbs', 'fat', 'kcal'].includes(k) && ov[k] == null) targets[k] = v;
    }
  }
  const waterBase = p.waterMl ?? round(35 * weight, 50);
  targets.water = pd ? (p.plan.water ?? waterBase) + (pd.water || 0) : waterBase + (training ? (p.waterTrainingMl || 0) : 0);

  return {
    day, body, bmr: B, formulaTDEE: formula, adaptive, tdee, delta, floored, floor, training, trainingDays: T,
    trainKcal: round(trainKcal, 10), restKcal: round(restKcal, 10), baseKcal: round(base, 10), targets, plan, planDay: pd,
    bmi: bmi(body.weightKg, body.heightCm), hasBody: !!(body.weightKg && body.heightCm && body.age != null),
  };
}

export const targetsFor = (day) => compute(day).targets;

/** Protein / carbs / fat in grams for a calorie target under the profile's macro method. */
export function macroTargets(p, kcal, weight) {
  if (p.macroMode === 'percent') {
    const t = (p.pct.protein || 0) + (p.pct.carbs || 0) + (p.pct.fat || 0) || 100;
    return {
      protein: round((kcal * (p.pct.protein / t)) / 4), carbs: round((kcal * (p.pct.carbs / t)) / 4), fat: round((kcal * (p.pct.fat / t)) / 9),
    };
  }
  const protein = round(p.proteinPerKg * weight);
  if (p.macroMode === 'carbcap') {
    const carbs = round(p.carbCap);
    return { protein, carbs, fat: Math.max(30, round((kcal - protein * 4 - carbs * 4) / 9)) };
  }
  const fat = round((p.fatPct / 100) * kcal / 9);
  return { protein, fat, carbs: Math.max(0, round((kcal - protein * 4 - fat * 9) / 4)) };
}

/**
 * Target weight plan: the weekly rate actually used (from a target date when set, kept within
 * safe limits), progress and the estimated finish date.
 */
export function weightPlan(p, body = bodyInputs(p)) {
  const w = body.weightKg;
  const out = { rate: p.rate, target: p.targetWeightKg, current: w, start: p.startWeightKg, byDate: false, capped: false, eta: null, toGo: null, progress: null, mismatch: false, reached: false };
  if (p.goal === 'maintain' || !p.targetWeightKg || !w) return out;
  const diff = p.targetWeightKg - w; // negative = need to lose
  out.toGo = Math.abs(diff);
  out.mismatch = (p.goal === 'lose' && diff > 0.05) || (p.goal === 'gain' && diff < -0.05);
  out.reached = !out.mismatch && Math.abs(diff) < 0.3;
  const maxRate = p.goal === 'lose' ? Math.max(0.25, Math.min(1, w * 0.01)) : 0.75;
  if (p.targetDate && !out.mismatch && !out.reached) {
    const weeks = Math.max(1, (parseDay(p.targetDate) - parseDay(todayKey())) / (7 * MS_DAY));
    const need = Math.abs(diff) / weeks;
    out.byDate = true;
    out.rate = Math.min(maxRate, Math.max(0.05, need));
    out.capped = need > maxRate;
  }
  if (!out.mismatch && !out.reached && out.rate > 0) {
    out.eta = Date.now() + (Math.abs(diff) / out.rate) * 7 * MS_DAY;
  }
  if (p.startWeightKg != null && Math.abs(p.startWeightKg - p.targetWeightKg) > 0.05) {
    out.progress = clamp((p.startWeightKg - w) / (p.startWeightKg - p.targetWeightKg), 0, 1);
  }
  return out;
}
export const kindOf = (key) => (N[key] ? N[key].kind : 'target');
