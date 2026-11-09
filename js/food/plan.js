// Weekly eating plan: a readable text you can paste in (and edit), giving every weekday its own
// calories, macros and nutrient targets, plus a weight path with weekly milestones.
//
// Format (one item per line, # starts a comment):
//   GYMOS PLAN
//   name: Road to 95
//   start: 2026-11-10 105        (date, starting weight kg)
//   target: 95                   (target weight kg)
//   rate: 0.4                    (kg per week)
//   protein: 160                 (g every day unless a day says otherwise)
//   fat: 80                      (g every day; carbs fill the rest)
//   water: 3000                  (ml every day)
//   fibre: 30   calcium: 1000    (any nutrient target for every day)
//   mon: 2600 School walk        (calories, then a label; "+500ml" adds water that day)
//   tue: 2800 Lifting | protein 190 carbs 330 fibre 35
//                                (after "|": that day's own targets; the one macro left out fills the calories)
//   tip: Eat 3 meals with protein.

import { todayKey, parseDay, addDaysKey, MS_DAY, weekday, dayKey } from '../util.js';
import { NUTRIENTS, N } from './nutrients.js';

const DAYS = { sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7 };
const DAY_NAMES = ['', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_ORDER = [2, 3, 4, 5, 6, 7, 1];
const MACROS = ['protein', 'carbs', 'fat'];

// Words accepted for each nutrient (lower case, spaces removed).
const ALIASES = { carb: 'carbs', carbohydrate: 'carbs', carbohydrates: 'carbs', fiber: 'fibre', sugar: 'sugars',
  satfat: 'satFat', saturatedfat: 'satFat', saturates: 'satFat', sodium: null, kcal: 'kcal', calories: 'kcal' };
for (const n of NUTRIENTS) {
  ALIASES[n.key.toLowerCase()] = n.key;
  ALIASES[n.label.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')] = n.key;
}
ALIASES.vitamind = 'vitD'; ALIASES.vitaminc = 'vitC'; ALIASES.vitamina = 'vitA'; ALIASES.b12 = 'vitB12'; ALIASES.vitaminb12 = 'vitB12';
const nutrientKey = (word) => { const k = String(word).toLowerCase().replace(/[^a-z0-9]/g, ''); return k in ALIASES ? ALIASES[k] : undefined; };

export class PlanError extends Error {}

const num = (v, what, lo, hi) => {
  const x = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(x) || x < lo || x > hi) throw new PlanError(`${what} must be a number between ${lo} and ${hi}.`);
  return x;
};
const LIMITS = { protein: [20, 400], carbs: [0, 900], fat: [15, 300] };
function nutrientValue(key, v) {
  const [lo, hi] = LIMITS[key] || [0, 100000];
  return num(v, N[key] ? N[key].label : key, lo, hi);
}

/** "protein 190 carbs 330 sat fat 25" → { protein: 190, carbs: 330, satFat: 25 } */
function parseTargets(text, where) {
  const out = {};
  const re = /([a-z][a-z ]*?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:g|mg|µg|ug|mcg)?(?=\s|$|,|;)/gi;
  let m; let any = false;
  while ((m = re.exec(text))) {
    const k = nutrientKey(m[1]);
    if (k === undefined || k === null) throw new PlanError(`${where}: unknown nutrient “${m[1].trim()}”.`);
    if (k === 'kcal') throw new PlanError(`${where}: put calories straight after the day name.`);
    out[k] = nutrientValue(k, m[2]);
    any = true;
  }
  if (!any && text.trim()) throw new PlanError(`${where}: write targets like “protein 190 carbs 330”.`);
  return out;
}

export function parsePlan(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  if (!lines.length) throw new PlanError('The plan is empty.');
  const plan = { name: 'My plan', days: {}, tips: [], nutrients: {} };
  for (const line of lines) {
    if (/^gymos plan$/i.test(line)) continue;
    const m = /^([a-z][a-z0-9 ()]*?)\s*:\s*(.*)$/i.exec(line);
    if (!m) throw new PlanError(`Couldn't read this line: “${line.slice(0, 40)}”`);
    const key = m[1].toLowerCase().replace(/\s+/g, ' ').trim(); const val = m[2].trim();
    if (key === 'name') plan.name = val.slice(0, 40) || plan.name;
    else if (key === 'start') {
      const s = /^(\d{4}-\d{2}-\d{2})\s+([\d.,]+)/.exec(val);
      if (!s) throw new PlanError('start needs a date and a weight, e.g. “start: 2026-11-10 105”.');
      plan.startDate = s[1]; plan.startWeightKg = num(s[2], 'Start weight', 30, 300);
    } else if (key === 'target') plan.targetWeightKg = num(val, 'Target weight', 30, 300);
    else if (key === 'rate') plan.rate = num(val, 'Rate', 0.05, 1);
    else if (key === 'protein') plan.protein = nutrientValue('protein', val);
    else if (key === 'fat') plan.fat = nutrientValue('fat', val);
    else if (key === 'water') plan.water = num(val, 'Water', 500, 8000);
    else if (key === 'tip') plan.tips.push(val.slice(0, 160));
    else if (DAYS[key]) {
      const [main, extra = ''] = val.split('|');
      const d = /^(\d{3,5})\s*(.*)$/.exec(main.trim());
      if (!d) throw new PlanError(`${key} needs calories first, e.g. “${key}: 2600 School walk”.`);
      const kcal = num(d[1], `${key} calories`, 1000, 6000);
      let label = d[2].trim();
      let water = 0;
      const w = /\+\s*(\d{2,4})\s*ml/i.exec(label);
      if (w) { water = Number(w[1]); label = label.replace(w[0], '').replace(/\(\s*\)/g, '').trim(); }
      const t = parseTargets(extra, key);
      const given = MACROS.filter((k) => t[k] != null);
      if (given.length === 3) {
        const sum = t.protein * 4 + t.carbs * 4 + t.fat * 9;
        if (Math.abs(sum - kcal) > 150) throw new PlanError(`${key}: protein, carbs and fat add up to ${Math.round(sum)} kcal, not ${kcal}. Leave one out and it will fill the rest.`);
      }
      plan.days[DAYS[key]] = { kcal, label: label.slice(0, 40), water, targets: t };
    } else {
      const k = nutrientKey(key);
      if (k === undefined || k === null || k === 'kcal') throw new PlanError(`Unknown setting “${key}”.`);
      if (k === 'carbs') throw new PlanError('Set carbs per day (after “|”), or leave them to fill the calories.');
      plan.nutrients[k] = nutrientValue(k, val);
    }
  }
  const missing = DAY_ORDER.filter((wd) => !plan.days[wd]).map((wd) => DAY_NAMES[wd]);
  if (missing.length) throw new PlanError(`Add a calorie target for: ${missing.join(', ')}.`);
  if (plan.targetWeightKg != null && plan.startWeightKg == null) throw new PlanError('Add a start line, e.g. “start: 2026-11-10 105”.');
  if (plan.rate == null && plan.targetWeightKg != null) plan.rate = 0.4;
  // Every day must leave something sensible for the macro that fills the rest.
  for (const wd of DAY_ORDER) {
    const m = dayMacros(plan, plan.days[wd], 75);
    if (m.carbs < 0 || m.fat < 15) throw new PlanError(`${DAY_NAMES[wd]}: the macros don't fit in ${plan.days[wd].kcal} kcal. Lower protein/fat or raise calories.`);
  }
  return plan;
}

/**
 * Protein / carbs / fat for one plan day. The day's own numbers win, then the plan-wide ones;
 * whichever macro is still missing (carbs first) fills the day's calories.
 */
export function dayMacros(plan, d, fallbackProtein) {
  const t = d.targets || {};
  const m = { protein: t.protein ?? plan.protein ?? fallbackProtein, carbs: t.carbs ?? null, fat: t.fat ?? null };
  if (m.carbs == null && m.fat == null) m.fat = plan.fat ?? Math.round((d.kcal * 0.25) / 9);
  if (m.carbs == null) m.carbs = Math.round((d.kcal - m.protein * 4 - m.fat * 9) / 4);
  else if (m.fat == null) m.fat = Math.round((d.kcal - m.protein * 4 - m.carbs * 4) / 9);
  else if (t.protein == null && plan.protein == null) m.protein = Math.round((d.kcal - m.carbs * 4 - m.fat * 9) / 4);
  return m;
}

const fmtNum = (v) => String(Math.round(v * 100) / 100);
function targetsText(t) {
  return Object.entries(t || {}).map(([k, v]) => `${k === 'satFat' ? 'satfat' : k.toLowerCase()} ${fmtNum(v)}`).join(' ');
}

export function planToText(plan) {
  const out = ['GYMOS PLAN', `name: ${plan.name}`];
  if (plan.startDate) out.push(`start: ${plan.startDate} ${plan.startWeightKg}`);
  if (plan.targetWeightKg != null) out.push(`target: ${plan.targetWeightKg}`);
  if (plan.rate != null) out.push(`rate: ${plan.rate}`);
  if (plan.protein != null) out.push(`protein: ${plan.protein}`);
  if (plan.fat != null) out.push(`fat: ${plan.fat}`);
  if (plan.water != null) out.push(`water: ${plan.water}`);
  for (const [k, v] of Object.entries(plan.nutrients || {})) out.push(`${k === 'satFat' ? 'satfat' : k.toLowerCase()}: ${fmtNum(v)}`);
  for (const wd of DAY_ORDER) {
    const d = plan.days[wd];
    const extra = targetsText(d.targets);
    out.push(`${DAY_NAMES[wd]}: ${d.kcal}${d.label ? ' ' + d.label : ''}${d.water ? ` +${d.water}ml` : ''}${extra ? ` | ${extra}` : ''}`);
  }
  for (const t of plan.tips || []) out.push(`tip: ${t}`);
  return out.join('\n');
}

export const planDay = (plan, day = todayKey()) => (plan ? plan.days[weekday(day)] || null : null);
export const weeklyAverage = (plan) => DAY_ORDER.reduce((a, wd) => a + plan.days[wd].kcal, 0) / 7;

/** Expected weight on a date if the plan runs at its rate (never past the target). */
export function expectedWeight(plan, day) {
  if (!plan || plan.startWeightKg == null || plan.targetWeightKg == null) return null;
  const weeks = Math.max(0, (parseDay(day) - parseDay(plan.startDate)) / (7 * MS_DAY));
  const dir = plan.targetWeightKg < plan.startWeightKg ? -1 : 1;
  const w = plan.startWeightKg + dir * plan.rate * weeks;
  return dir < 0 ? Math.max(plan.targetWeightKg, w) : Math.min(plan.targetWeightKg, w);
}

export function finishDate(plan) {
  if (!plan || plan.targetWeightKg == null) return null;
  const weeks = Math.abs(plan.startWeightKg - plan.targetWeightKg) / plan.rate;
  return addDaysKey(plan.startDate, Math.ceil(weeks * 7));
}

/** Milestones every `every` weeks from the start to the target. */
export function milestones(plan, every = 4) {
  const end = finishDate(plan);
  if (!end) return [];
  const out = [];
  for (let k = every; ; k += every) {
    const d = addDaysKey(plan.startDate, k * 7);
    if (d >= end) { out.push({ day: end, weight: plan.targetWeightKg, week: Math.ceil((parseDay(end) - parseDay(plan.startDate)) / (7 * MS_DAY)) }); break; }
    out.push({ day: d, weight: expectedWeight(plan, d), week: k });
    if (out.length > 60) break;
  }
  return out;
}

/** Where you are against the plan: latest weigh-in vs the expected weight on that day. */
export function planStatus(plan, latestWeight, latestDate) {
  if (!plan || plan.targetWeightKg == null || latestWeight == null || !latestDate) return null;
  const day = dayKey(latestDate);
  if (day < plan.startDate) return null;
  const expected = expectedWeight(plan, day);
  const losing = plan.targetWeightKg < plan.startWeightKg;
  const diff = losing ? latestWeight - expected : expected - latestWeight; // > 0 = behind
  const week = Math.floor((parseDay(todayKey()) - parseDay(plan.startDate)) / (7 * MS_DAY)) + 1;
  return { expected, diff, week, state: diff > 0.75 ? 'behind' : diff < -0.75 ? 'ahead' : 'on' };
}

/** Ready-made plan: start 105 kg → 95 kg at 0.4 kg a week, built around school walks, two
 *  upper-body lifting days and rugby on Wednesday and Sunday. */
export const ROAD_TO_95 = `GYMOS PLAN
name: Road to 95
start: 2026-11-09 105
target: 95
rate: 0.4
protein: 160
fat: 80
water: 2500
mon: 2600 School walk
tue: 2800 Upper-body lifting
wed: 3000 Rugby training +500ml
thu: 2600 School walk
fri: 2800 Upper-body lifting
sat: 2500 Rest day
sun: 3100 Rugby session +750ml
tip: Protein at every meal: chicken, eggs, mince, tuna, Greek yoghurt, milk.
tip: Rugby days: a proper carb meal 2–3 hours before (rice, pasta, potatoes).
tip: Swap sugary and energy drinks for water or zero-sugar drinks.
tip: Sleep 8–10 hours. It's when you build muscle and grow.
tip: Weigh in once a week, same morning, before food. Judge progress over 2–3 weeks.`;

/** Carb-cycle version: more carbs on Wednesday (rugby) and Saturday (fuel up before Sunday's
 *  match), more protein on the lifting days (Tuesday, Friday). UK reference intakes for 15–18-year-old boys. */
export const ROAD_TO_95_CARB_CYCLE = `GYMOS PLAN
name: Road to 95 – carb cycle
start: 2026-11-09 105
target: 95
rate: 0.4
protein: 160
fat: 80
water: 2500
# Every day
fibre: 30
sugars: 70
satfat: 28
salt: 6
calcium: 1000
iron: 11.3
zinc: 9.5
magnesium: 300
potassium: 3500
vitamin d: 10
# Each day: calories, label, then that day's own targets
mon: 2600 School walk | protein 160 fat 80
tue: 2800 Upper-body lifting – high protein | protein 190 fat 80
wed: 3100 Rugby training – high carb +500ml | protein 150 fat 70 fibre 35 sugars 90 salt 7
thu: 2600 School walk | protein 160 fat 80
fri: 2800 Upper-body lifting – high protein | protein 190 fat 80
sat: 2700 Fuel up for Sunday – high carb | protein 140 fat 60 fibre 35 sugars 80
sun: 2900 Rugby session +750ml | protein 160 fat 75 sugars 90 salt 7
tip: High-protein days (Tue, Fri): protein in every meal plus a shake or Greek yoghurt after lifting.
tip: High-carb days (Wed, Sat): rice, pasta, potatoes, oats, bread and fruit. Keep fat lower so the calories go to carbs.
tip: Saturday's carbs top up your muscle fuel for Sunday's rugby. Eat a big carb meal on Saturday evening.
tip: Rugby days: a carb meal 2–3 hours before, then protein and carbs within an hour after. Extra salt and water replace sweat.
tip: Milk, yoghurt and cheese cover calcium; red meat, beans and fortified cereal cover iron. Both matter while you're growing.
tip: Weigh in once a week, same morning, before food. Judge progress over 2–3 weeks.`;

export const TEMPLATES = [
  { key: 'carbcycle', name: 'Road to 95 – carb cycle', text: () => ROAD_TO_95_CARB_CYCLE },
  { key: 'simple', name: 'Road to 95 – simple', text: () => ROAD_TO_95 },
];
