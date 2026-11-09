// Weekly eating plan: a readable text you can paste in (and edit), giving every weekday its own
// calorie target and label, fixed protein/fat, water, and a weight path with weekly milestones.
//
// Format (one item per line, # starts a comment):
//   GYMOS PLAN
//   name: Road to 95
//   start: 2026-11-10 105        (date, starting weight kg)
//   target: 95                   (target weight kg)
//   rate: 0.4                    (kg per week)
//   protein: 160                 (g every day)
//   fat: 80                      (g every day; carbs fill the rest)
//   water: 3000                  (ml every day)
//   mon: 2600 School walk        (calories, then a label; "+500ml" adds water that day)
//   ...
//   tip: Eat 3 meals with protein.

import { todayKey, parseDay, addDaysKey, MS_DAY, weekday, dayKey } from '../util.js';

const DAYS = { sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7 };
const DAY_NAMES = ['', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_ORDER = [2, 3, 4, 5, 6, 7, 1];

export class PlanError extends Error {}

export function parsePlan(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  if (!lines.length) throw new PlanError('The plan is empty.');
  const plan = { name: 'My plan', days: {}, tips: [] };
  const num = (v, what, lo, hi) => {
    const x = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(x) || x < lo || x > hi) throw new PlanError(`${what} must be a number between ${lo} and ${hi}.`);
    return x;
  };
  for (const line of lines) {
    if (/^gymos plan$/i.test(line)) continue;
    const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) throw new PlanError(`Couldn't read this line: “${line.slice(0, 40)}”`);
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'name') plan.name = val.slice(0, 40) || plan.name;
    else if (key === 'start') {
      const s = /^(\d{4}-\d{2}-\d{2})\s+([\d.,]+)/.exec(val);
      if (!s) throw new PlanError('start needs a date and a weight, e.g. “start: 2026-11-10 105”.');
      plan.startDate = s[1]; plan.startWeightKg = num(s[2], 'Start weight', 30, 300);
    } else if (key === 'target') plan.targetWeightKg = num(val, 'Target weight', 30, 300);
    else if (key === 'rate') plan.rate = num(val, 'Rate', 0.05, 1);
    else if (key === 'protein') plan.protein = num(val, 'Protein', 30, 400);
    else if (key === 'fat') plan.fat = num(val, 'Fat', 20, 300);
    else if (key === 'water') plan.water = num(val, 'Water', 500, 8000);
    else if (key === 'tip') plan.tips.push(val.slice(0, 160));
    else if (DAYS[key]) {
      const d = /^(\d{3,5})\s*(.*)$/.exec(val);
      if (!d) throw new PlanError(`${key} needs calories first, e.g. “${key}: 2600 School walk”.`);
      const kcal = num(d[1], `${key} calories`, 1000, 6000);
      let label = d[2].trim();
      let water = 0;
      const w = /\+\s*(\d{2,4})\s*ml/i.exec(label);
      if (w) { water = Number(w[1]); label = label.replace(w[0], '').replace(/\(\s*\)/g, '').trim(); }
      plan.days[DAYS[key]] = { kcal, label: label.slice(0, 40), water };
    } else throw new PlanError(`Unknown setting “${key}”.`);
  }
  const missing = DAY_ORDER.filter((wd) => !plan.days[wd]).map((wd) => DAY_NAMES[wd]);
  if (missing.length) throw new PlanError(`Add a calorie target for: ${missing.join(', ')}.`);
  if (plan.targetWeightKg != null && plan.startWeightKg == null) throw new PlanError('Add a start line, e.g. “start: 2026-11-10 105”.');
  if (plan.rate == null && plan.targetWeightKg != null) plan.rate = 0.4;
  return plan;
}

export function planToText(plan) {
  const out = ['GYMOS PLAN', `name: ${plan.name}`];
  if (plan.startDate) out.push(`start: ${plan.startDate} ${plan.startWeightKg}`);
  if (plan.targetWeightKg != null) out.push(`target: ${plan.targetWeightKg}`);
  if (plan.rate != null) out.push(`rate: ${plan.rate}`);
  if (plan.protein != null) out.push(`protein: ${plan.protein}`);
  if (plan.fat != null) out.push(`fat: ${plan.fat}`);
  if (plan.water != null) out.push(`water: ${plan.water}`);
  for (const wd of DAY_ORDER) {
    const d = plan.days[wd];
    out.push(`${DAY_NAMES[wd]}: ${d.kcal}${d.label ? ' ' + d.label : ''}${d.water ? ` +${d.water}ml` : ''}`);
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
