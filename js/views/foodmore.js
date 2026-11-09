// Food: goals & targets, AI settings, nutrient detail, trends, my foods, saved meals,
// and the BMI & body calculator.

import { nav, Screen } from '../nav.js';
import { icon, presentSheet, menu, confirm, toast, alert, pill, toggle, stepper, lineChart, emptyState, statTile, sheetHeader } from '../ui.js';
import { esc, fmt, todayKey, addDaysKey, daysInRange, parseDecimal, clamp, sum, norm, parseDay, weekdayName } from '../util.js';
import { changed, Q } from '../engine.js';
import { state, getKV } from '../food/store.js';
import { NUTRIENTS, N, GROUPS, MEALS, F, fmtN, entryTotals, coverage, averageTotals, mealLabel, defaultMeal } from '../food/nutrients.js';
import * as Goals from '../food/goals.js';
import * as Diets from '../food/diets.js';
import * as Plan from '../food/plan.js';
import * as Log from '../food/log.js';
import { ai, discoverModels, analyse, AIError } from '../food/ai.js';
import { bar, NumberSheet, SheetView, macroLine } from './foodui.js';
import { CustomFoodSheet, FoodAmountSheet } from './foodadd.js';

const upd = (patch) => { Goals.updateProfile(patch); changed(); };
const kcal = (v) => (v == null ? '—' : `${fmt.integer(v)} kcal`);

// ---------------------------------------------------------------------------------
// Goals & targets

export class GoalsScreen extends Screen {
  constructor() {
    super('Goals & targets');
    this.showMicros = false;
    Object.assign(this.actions, {
      sex: (el) => upd({ sex: el.dataset.v }),
      goal: (el) => upd({ goal: el.dataset.v }),
      protein: (el) => { const p = Goals.profile(); upd({ proteinPerKg: clamp(Math.round((p.proteinPerKg + 0.1 * Number(el.dataset.d)) * 10) / 10, 0.8, 3.3) }); },
      fatPct: (el) => { const p = Goals.profile(); upd({ fatPct: clamp(p.fatPct + 5 * Number(el.dataset.d), 15, 45) }); },
      cycleKcal: (el) => { const p = Goals.profile(); upd({ cycleKcal: clamp(p.cycleKcal + 50 * Number(el.dataset.d), 50, 600) }); },
      waterTraining: (el) => { const p = Goals.profile(); upd({ waterTrainingMl: clamp((p.waterTrainingMl || 0) + 250 * Number(el.dataset.d), 0, 1500) }); },
      manual: (el) => {
        const k = el.dataset.k; const p = Goals.profile();
        const meta = { weightKg: ['Weight', 'kg'], heightCm: ['Height', 'cm'], age: ['Age', 'years'] }[k];
        presentSheet(new NumberSheet({ title: meta[0], value: p.manual[k], unit: meta[1], hint: 'Used only until you add a weekly check-in in the Body tab.', onDone: (v) => upd({ manual: { ...p.manual, [k]: v } }) }));
      },
      body: () => nav.switchTab('body', true),
      target: (el) => this.editTarget(el.dataset.k),
      water: () => {
        const p = Goals.profile(); const c = Goals.compute();
        presentSheet(new NumberSheet({ title: 'Daily water', value: p.waterMl ?? (c.targets.water - (c.training ? p.waterTrainingMl : 0)), unit: 'ml', allowClear: true, hint: 'Default is 35 ml per kg of body weight.', onDone: (v) => upd({ waterMl: v }) }));
      },
      micros: () => { this.showMicros = !this.showMicros; nav.refresh(); },
      resetOverrides: () => confirm('Reset all custom targets?', 'Every target goes back to the calculated value.', 'Reset', () => upd({ overrides: {} })),
      calc: () => nav.push(new BodyCalcScreen()),
      diets: () => nav.push(new DietPresetsScreen()),
      plan: () => nav.push(new PlanScreen()),
      targetWeight: () => {
        const p = Goals.profile(); const w = Goals.bodyInputs(p).weightKg;
        presentSheet(new NumberSheet({
          title: 'Target weight', value: p.targetWeightKg, unit: 'kg', allowClear: p.targetWeightKg != null, clearLabel: 'Remove target',
          hint: w ? `You weigh ${fmt.kg(w)} now (latest Body check-in).` : 'Add a weekly check-in in the Body tab so progress can be tracked.',
          onDone: (v) => {
            if (v == null) { upd({ targetWeightKg: null, targetDate: null, startWeightKg: null, startDate: null }); return; }
            if (v < 30 || v > 300) { toast('Enter a weight between 30 and 300 kg'); return; }
            const patch = { targetWeightKg: v, startWeightKg: w ?? null, startDate: todayKey() };
            // Point the goal the right way if it doesn't match the target.
            if (w && v < w - 0.2 && Goals.profile().goal !== 'lose') patch.goal = 'lose';
            if (w && v > w + 0.2 && Goals.profile().goal !== 'gain') patch.goal = 'gain';
            upd(patch);
          },
        }));
      },
      clearDate: () => upd({ targetDate: null }),
      carbCap: (el) => { const p = Goals.profile(); upd({ carbCap: clamp(p.carbCap + (p.carbCap < 50 ? 5 : 10) * Number(el.dataset.d), 10, 400) }); },
      pct: (el) => {
        const p = Goals.profile(); const k = el.dataset.k; const pct = { ...p.pct };
        pct[k] = clamp(pct[k] + 5 * Number(el.dataset.d), 5, 80);
        pct.carbs = 100 - pct.protein - pct.fat;
        if (pct.carbs < 5) return;
        upd({ pct });
      },
      window: () => { const p = Goals.profile(); upd({ window: p.window ? null : { start: '12:00', end: '20:00' } }); },
    });
    this.changes = {
      targetDate: (el) => upd({ targetDate: el.value || null }),
      macroMode: (el) => upd({ macroMode: el.value }),
      winStart: (el) => { const p = Goals.profile(); upd({ window: { ...(p.window || {}), start: el.value || '12:00' } }); },
      winEnd: (el) => { const p = Goals.profile(); upd({ window: { ...(p.window || {}), end: el.value || '20:00' } }); },
      activity: (el) => upd({ activity: Number(el.value) }),
      rate: (el) => upd({ rate: Number(el.value) }),
      adaptive: (el) => upd({ adaptive: el.checked }),
      cycling: (el) => upd({ cycling: el.checked }),
      useBF: (el) => upd({ useBodyFat: el.checked }),
      windowToggle: () => this.actions.window(),
    };
  }
  editTarget(k) {
    const p = Goals.profile();
    const c = Goals.compute(todayKey(), { ...p, overrides: { ...p.overrides, [k]: undefined } });
    const n = N[k];
    presentSheet(new NumberSheet({
      title: `${n.label} target`, value: p.overrides[k] ?? c.targets[k], unit: n.unit, allowClear: p.overrides[k] != null,
      clearLabel: `Use calculated (${fmtN(k, c.targets[k])})`,
      hint: n.kind === 'limit' ? 'This is an upper limit — the bar turns red when you go over.' : k === 'kcal' ? 'A fixed calorie target replaces the calculated one (and training-day cycling).' : 'Your own target replaces the calculated value.',
      onDone: (v) => { const o = { ...Goals.profile().overrides }; if (v == null) delete o[k]; else o[k] = v; upd({ overrides: o }); },
    }));
  }
  render() {
    const p = Goals.profile();
    const c = Goals.compute(todayKey(), p);
    const b = c.body;
    const band = Goals.bmiBand(c.bmi);
    const src = (has) => (has ? '<span class="caption faint">Body tab</span>' : '');
    const manualRow = (k, label, value, unit, fromBody) => fromBody
      ? `<div class="list-row"><span class="grow">${label}</span>${src(true)}<span class="muted num">${value}</span></div>`
      : `<button class="list-row" data-act="manual" data-k="${k}"><span class="grow">${label}</span><span class="${value === '—' ? 'text-partial' : 'muted'} num">${value === '—' ? 'Set' : value}</span>${icon.chevron}</button>`;
    const bodyCard = `<div class="section-label">You</div>
      <div class="segmented">${[['male', 'Male'], ['female', 'Female']].map(([v, l]) => `<button class="seg ${p.sex === v ? 'on' : ''}" data-act="sex" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="list grouped">
        ${manualRow('weightKg', 'Weight', b.weightKg ? fmt.kg(b.weightKg) : '—', 'kg', b.fromBody.weight)}
        ${manualRow('heightCm', 'Height', b.heightCm ? `${fmt.integer(b.heightCm)} cm` : '—', 'cm', b.fromBody.height)}
        ${manualRow('age', 'Age', b.age != null ? String(b.age) : '—', 'years', b.fromBody.age)}
        ${b.bodyFat != null ? `<div class="list-row"><span class="grow">Body fat</span>${src(true)}<span class="muted num">${fmt.number(b.bodyFat, 1)}%</span></div>` : ''}
        <button class="list-row accent" data-act="body"><span class="grow">Update in Body tab</span>${icon.chevron}</button>
      </div>
      <div class="caption faint">Body values are read from your latest weekly check-in and are never changed here.</div>`;

    const goalCard = `<div class="section-label">Activity & goal</div>
      <div class="list grouped form">
        <label class="row"><span class="row-label grow">Activity</span><select class="select" data-change="activity">${Goals.ACTIVITY.map(([v, l]) => `<option value="${v}" ${p.activity === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="row"><span class="caption faint">${esc((Goals.ACTIVITY.find(([v]) => v === p.activity) || [0, '', ''])[2])}</span></div>
      </div>
      <div class="segmented">${Goals.GOALS.map(([v, l]) => `<button class="seg ${p.goal === v ? 'on' : ''}" data-act="goal" data-v="${v}">${l}</button>`).join('')}</div>
      ${p.goal !== 'maintain' ? `<div class="list grouped form">${c.plan.byDate ? `<div class="row"><span class="row-label grow">${p.goal === 'lose' ? 'Lose' : 'Gain'} per week</span><span class="muted num">${fmt.number(c.plan.rate, 2)} kg · set by your date</span></div>` : `<label class="row"><span class="row-label grow">${p.goal === 'lose' ? 'Lose' : 'Gain'} per week</span><select class="select" data-change="rate">${Goals.RATES.map((r) => `<option value="${r}" ${p.rate === r ? 'selected' : ''}>${fmt.number(r, 2)} kg (${fmt.integer(r * 7700 / 7)} kcal/day)</option>`).join('')}</select></label>`}</div>
        ${p.goal === 'gain' && p.rate > 0.5 ? '<div class="caption text-partial">Above ~0.5 kg a week most extra weight is fat. 0.25–0.5 kg suits a lean bulk.</div>' : ''}
        ${p.goal === 'lose' && b.weightKg && p.rate > b.weightKg * 0.01 ? '<div class="caption text-partial">More than 1% of body weight a week makes it hard to keep muscle.</div>' : ''}` : ''}
        <div class="list grouped form">
          <button class="list-row" data-act="targetWeight"><span class="grow">Target weight</span><span class="${p.targetWeightKg ? 'muted' : 'text-active'} num">${p.targetWeightKg ? fmt.kg(p.targetWeightKg) : 'Set'}</span>${icon.chevron}</button>
          ${p.targetWeightKg ? `<label class="row"><span class="row-label grow">Reach it by<span class="row-sub">Optional — sets the weekly rate for you</span></span><input type="date" class="date-input" value="${p.targetDate || ''}" min="${todayKey()}" data-change="targetDate"></label>
            ${p.targetDate ? '<button class="list-row accent" data-act="clearDate"><span>Use the weekly rate instead of a date</span></button>' : ''}` : ''}
        </div>
        ${p.goal === 'maintain' ? (p.targetWeightKg ? '<div class="caption faint">Set the goal to Lose fat or Build muscle to work towards this target.</div>' : '') : planNote(c.plan, p)}`;

    const proteinStep = stepper(`Protein: ${fmt.number(p.proteinPerKg, 1)} g per kg${b.weightKg ? ` (${fmt.integer(p.proteinPerKg * b.weightKg)} g)` : ''}`, p.proteinPerKg, 'protein', 0.8, 3.3);
    const pctStep = (k, label) => `<div class="row stepper-row"><span>${label}: ${p.pct[k]}%</span><div class="stepper">
      <button class="step-btn" data-act="pct" data-k="${k}" data-d="-1" ${p.pct[k] <= 5 ? 'disabled' : ''}>${icon.minus}</button><button class="step-btn" data-act="pct" data-k="${k}" data-d="1">${icon.plus}</button></div></div>`;
    const macroRows = p.macroMode === 'percent'
      ? `${pctStep('protein', 'Protein')}${pctStep('fat', 'Fat')}<div class="row"><span class="grow">Carbs: ${p.pct.carbs}%</span><span class="caption faint">the rest</span></div>`
      : p.macroMode === 'carbcap'
        ? `${proteinStep}${stepper(`Carbs: ${fmt.integer(p.carbCap)} g a day`, p.carbCap, 'carbCap', 10, 400)}<div class="row"><span class="caption faint">Fat fills the remaining calories.</span></div>`
        : `${proteinStep}${stepper(`Fat: ${p.fatPct}% of calories`, p.fatPct, 'fatPct', 15, 45)}<div class="row"><span class="caption faint">Carbohydrate fills the remaining calories. 1.6–2.2 g/kg protein suits most people who lift.</span></div>`;
    const macroCard = `<div class="section-label">Macros</div>
      <div class="list grouped form">
        <label class="row"><span class="row-label grow">Method</span><select class="select small" data-change="macroMode">${Goals.MACRO_MODES.map(([v, l]) => `<option value="${v}" ${p.macroMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${macroRows}
        <div class="row"><span class="grow muted">Today</span><span class="num muted">P ${fmt.integer(c.targets.protein)} · C ${fmt.integer(c.targets.carbs)} · F ${fmt.integer(c.targets.fat)} g</span></div>
      </div>
      <div class="list grouped form">
        ${toggle('Eating window (intermittent fasting)', !!p.window, 'windowToggle')}
        ${p.window ? `<label class="row sub-row"><span class="row-label grow">From</span><input type="time" class="time-input" value="${p.window.start}" data-change="winStart"></label>
          <label class="row sub-row"><span class="row-label grow">Until</span><input type="time" class="time-input" value="${p.window.end}" data-change="winEnd"></label>` : ''}
      </div>`;
    const pr = Diets.preset(p.diet);
    const dietCard = `<div class="section-label">Diet style</div>
      <div class="list grouped"><button class="list-row" data-act="diets"><span class="grow minw0"><span class="block">${esc(pr ? pr.name : 'Custom')}${pr && Diets.isCustomised(p) ? ' <span class="caption faint">(adjusted)</span>' : ''}</span>
        <span class="caption faint block clamp2">${esc(pr ? pr.desc : 'Your own settings.')}</span></span><span class="link-btn small">Presets</span>${icon.chevron}</button></div>`;

    const T = c.trainingDays;
    const optCard = `<div class="section-label">Options</div>
      <div class="list grouped form">
        ${toggle('Adaptive target', p.adaptive, 'adaptive', 'Learns your real maintenance from food logs and weigh-ins')}
        ${toggle('More calories on training days', p.cycling, 'cycling', T ? `${T} training day${T === 1 ? '' : 's'} a week from your routines; weekly total stays the same` : 'Assign routines to weekdays to use this')}
        ${p.cycling && T ? stepper(`Training day: +${p.cycleKcal} kcal`, p.cycleKcal, 'cycleKcal', 50, 600) : ''}
        ${b.bodyFat != null ? toggle('Use body fat for BMR', p.useBodyFat, 'useBF', 'Katch-McArdle formula (lean mass)') : ''}
      </div>`;

    const ad = c.adaptive;
    const adaptiveText = !p.adaptive ? 'Off' : ad.ready ? `${kcal(ad.value)} · ${fmt.integer(ad.confidence * 100)}% weight` : `Learning — ${ad.loggedDays}/10 logged days, ${ad.weighIns} weigh-ins over ${ad.spanDays}/10 days`;
    const resultCard = `<div class="section-label">Result</div>
      <div class="card">
        <div class="tiles">${statTile('BMI', c.bmi ? fmt.number(c.bmi, 1) : '—', band ? band[0] : null)}${statTile('BMR', c.bmr ? fmt.integer(c.bmr.value) : '—', c.bmr ? c.bmr.method : 'needs body stats')}${statTile('Maintenance', c.tdee ? fmt.integer(c.tdee) : '—', 'kcal / day')}</div>
        <div class="list-row slim"><span class="grow muted">Formula maintenance</span><span class="num">${kcal(c.formulaTDEE)}</span></div>
        <div class="list-row slim"><span class="grow muted">Adaptive estimate</span><span class="num caption right">${esc(adaptiveText)}</span></div>
        ${c.plan.byDate ? `<div class="list-row slim"><span class="grow muted">Rate to reach target by ${esc(fmt.dayMonth(p.targetDate))}</span><span class="num">${fmt.number(c.plan.rate, 2)} kg/week</span></div>` : ''}
        <div class="list-row slim"><span class="grow muted">Goal adjustment</span><span class="num">${c.delta ? `${c.delta > 0 ? '+' : '−'}${fmt.integer(Math.abs(c.delta))} kcal` : '—'}</span></div>
        <div class="list-row slim"><span class="grow strong">Daily calories</span><span class="num strong">${kcal(c.baseKcal)}</span></div>
        ${p.cycling && T && T < 7 && p.overrides.kcal == null ? `<div class="list-row slim"><span class="grow muted">Training / rest days</span><span class="num">${fmt.integer(c.trainKcal)} / ${fmt.integer(c.restKcal)}</span></div>` : ''}
        ${c.floored ? `<div class="caption text-partial">Raised to the minimum of ${fmt.integer(c.floor)} kcal. Very low intakes make it hard to get enough nutrients — consider a slower rate.</div>` : ''}
        ${!c.hasBody ? '<div class="caption text-partial">Add weight, height and age (Body tab) for accurate targets.</div>' : ''}
      </div>`;

    const row = (k) => {
      const n = N[k]; const custom = p.overrides[k] != null;
      return `<button class="list-row" data-act="target" data-k="${k}"><span class="grow">${esc(n.label)}${n.kind === 'limit' ? ' <span class="caption faint">max</span>' : ''}</span>${custom ? pill('CUSTOM', 'extra') : ''}<span class="muted num">${esc(fmtN(k, c.targets[k]))}</span>${icon.chevron}</button>`;
    };
    const targets = `<div class="section-label">Daily targets${c.training && p.cycling ? ' (today: training day)' : ''}</div>
      <div class="list grouped">${['kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugars', 'satFat', 'salt'].map(row).join('')}
        <button class="list-row" data-act="water"><span class="grow">Water</span>${p.waterMl != null ? pill('CUSTOM', 'extra') : ''}<span class="muted num">${fmt.number(c.targets.water / 1000, 2)} L</span>${icon.chevron}</button></div>
      <div class="list grouped form">${stepper(`Extra water on training days: ${p.waterTrainingMl || 0} ml`, p.waterTrainingMl || 0, 'waterTraining', 0, 1500)}</div>
      <button class="link-btn small left" data-act="micros">${this.showMicros ? 'Hide' : 'Show'} vitamin & mineral targets</button>
      ${this.showMicros ? `<div class="list grouped">${NUTRIENTS.filter((n) => n.nrv != null).map((n) => row(n.key)).join('')}</div><div class="caption faint">Defaults are UK/EU reference intakes (NRVs) for adults. Tap any target to set your own.</div>` : ''}
      ${Object.keys(p.overrides).length ? '<div class="list grouped"><button class="list-row destructive" data-act="resetOverrides"><span>Reset custom targets</span></button></div>' : ''}
      <div class="list grouped"><button class="list-row accent" data-act="calc">${icon.scale}<span class="grow">BMI & body calculator</span>${icon.chevron}</button></div>
      <div class="caption faint">Estimates for healthy adults, not medical advice. Targets update automatically as you log weigh-ins in the Body tab.</div>`;

    const planCard = p.plan ? `<button class="card info card-btn" data-act="plan"><div class="row-between"><span class="sub strong">Weekly plan: ${esc(p.plan.name)}</span>${icon.chevron}</div>
      <div class="caption muted">Calories${p.plan.protein != null ? ', protein' : ''}${p.plan.fat != null ? ', fat' : ''} and water come from your plan for each weekday (today ${fmt.integer(c.targets.kcal)} kcal). The settings below still set fibre, sugar, salt and vitamins.</div></button>` : '';
    return `<div class="stack">${planCard}${bodyCard}${dietCard}${goalCard}${macroCard}${optCard}${resultCard}${targets}</div>`;
  }
}

/** Target-weight progress and warnings (Goals screen). */
function planNote(plan, p) {
  if (!plan.target) return '';
  if (!plan.current) return '<div class="caption faint">Add a weigh-in in the Body tab to track progress to your target.</div>';
  if (plan.mismatch) return `<div class="caption text-partial">Your target (${fmt.kg(plan.target)}) is ${plan.target > plan.current ? 'above' : 'below'} your current weight, but the goal is to ${p.goal === 'lose' ? 'lose' : 'gain'}. Change the goal or the target.</div>`;
  if (plan.reached) return '<div class="caption text-completed">Target reached. Switch to Maintain, or set a new target.</div>';
  const pctDone = plan.progress != null ? `<div class="nbar-track"><div class="nbar-fill ok" style="width:${(plan.progress * 100).toFixed(1)}%"></div></div>
    <div class="row-between caption faint num"><span>Start ${fmt.kg(plan.start)}</span><span>Now ${fmt.kg(plan.current)}</span><span>Target ${fmt.kg(plan.target)}</span></div>` : '';
  return `<div class="card">${pctDone}
    <div class="sub num">${fmt.number(plan.toGo, 1)} kg to ${p.goal === 'lose' ? 'lose' : 'gain'} · about ${fmt.integer(plan.toGo / plan.rate)} weeks${plan.eta ? ` (${fmt.dayMonthYear(plan.eta)})` : ''}</div>
    ${plan.capped ? `<div class="caption text-partial">That date needs more than a safe rate, so it's capped at ${fmt.number(plan.rate, 2)} kg a week. The estimated finish date is shown instead.</div>` : ''}</div>`;
}

// ---------------------------------------------------------------------------------
// Weekly plan (imported text): a calorie target per weekday + weekly milestones

export class PlanImportSheet extends SheetView {
  constructor(initial = '') {
    super();
    this.text = initial; this.error = ''; this.parsed = null;
    this.actions = {
      cancel: () => this.close(),
      done: () => this.importIt(),
      template: () => { this.text = Plan.ROAD_TO_95; this.check(); this.refresh(); },
      paste: async () => { try { const t = await navigator.clipboard.readText(); if (t) { this.text = t; this.check(); this.refresh(); } } catch { toast('Long-press the box and choose Paste'); } },
    };
    this.inputs = { text: (el) => { this.text = el.value; this.check(); this.refreshPreview(); } };
    this.check();
  }
  check() {
    this.error = ''; this.parsed = null;
    if (!this.text.trim()) return;
    try { this.parsed = Plan.parsePlan(this.text); } catch (e) { this.error = e.message; }
  }
  refreshPreview() { const el = document.querySelector(`[data-view="${this.id}"] [data-plan-preview]`); if (el) el.innerHTML = this.preview(); }
  preview() {
    if (this.error) return `<div class="caption text-partial">${esc(this.error)}</div>`;
    const pl = this.parsed;
    if (!pl) return '<div class="caption faint">Paste a plan that starts with “GYMOS PLAN”.</div>';
    const fin = Plan.finishDate(pl);
    return `<div class="card"><div class="sub strong">${esc(pl.name)}</div>
      <div class="caption muted num">${fmt.integer(Plan.weeklyAverage(pl))} kcal a day on average${pl.protein != null ? ` · ${fmt.integer(pl.protein)} g protein` : ''}${pl.targetWeightKg != null ? ` · ${fmt.number(pl.startWeightKg, 1)} → ${fmt.number(pl.targetWeightKg, 1)} kg by about ${esc(fmt.dayMonthYear(fin))}` : ''}</div></div>`;
  }
  importIt() {
    this.check();
    if (!this.parsed) { this.error = this.error || 'Paste your plan first.'; this.refresh(); return; }
    const pl = this.parsed;
    const patch = { plan: pl, cycling: false };
    if (pl.targetWeightKg != null) {
      Object.assign(patch, {
        goal: pl.targetWeightKg < pl.startWeightKg ? 'lose' : pl.targetWeightKg > pl.startWeightKg ? 'gain' : 'maintain',
        rate: pl.rate, targetWeightKg: pl.targetWeightKg, startWeightKg: pl.startWeightKg, startDate: pl.startDate, targetDate: null,
      });
    }
    upd(patch);
    this.close();
    toast(`Plan “${pl.name}” imported`, 'good');
  }
  render() {
    return `${sheetHeader('Import plan', { right: 'Import' })}
      <textarea class="textarea mono plan-text" placeholder="GYMOS PLAN&#10;name: …&#10;mon: 2600 School walk&#10;…" data-input="text" autocapitalize="off" autocorrect="off" spellcheck="false">${esc(this.text)}</textarea>
      <div class="tiles"><button class="btn secondary" data-act="paste">Paste</button><button class="btn secondary" data-act="template">Road to 95</button></div>
      <div data-plan-preview>${this.preview()}</div>
      <div class="caption faint">Each weekday gets its own calorie target. Importing replaces any earlier plan; your food log isn't changed.</div>`;
  }
}

export class PlanScreen extends Screen {
  constructor() {
    super('Weekly plan');
    Object.assign(this.actions, {
      import: () => presentSheet(new PlanImportSheet(''), { height: 'large' }),
      edit: () => presentSheet(new PlanImportSheet(Plan.planToText(Goals.profile().plan)), { height: 'large' }),
      remove: () => confirm('Remove this plan?', 'Your targets go back to the ones calculated from your goal. Your food log and weigh-ins stay.', 'Remove', () => upd({ plan: null })),
      body: () => nav.switchTab('body', true),
    });
  }
  render() {
    const p = Goals.profile();
    const pl = p.plan;
    if (!pl) {
      return `<div class="stack"><div class="card">${emptyState('No plan yet', 'Import a weekly plan to give every day its own calorie target and see weekly weight milestones.', 'calendar')}</div>
        <button class="btn primary" data-act="import">IMPORT PLAN</button></div>`;
    }
    const today = todayKey();
    const todayWd = Plan.planDay(pl, today);
    const latest = Q.bodyStats().find((e) => e.weightKg != null);
    const st = latest ? Plan.planStatus(pl, latest.weightKg, latest.date) : null;
    const fin = Plan.finishDate(pl);
    const exp = Plan.expectedWeight(pl, today);
    const stText = !st ? (latest ? '' : 'Log a weigh-in in the Body tab to compare with the plan.')
      : st.state === 'on' ? `On track: ${fmt.kg(latest.weightKg)} vs ${fmt.kg(st.expected)} planned for ${fmt.dayMonth(latest.date)}.`
        : st.state === 'ahead' ? `Ahead of plan by ${fmt.number(-st.diff, 1)} kg (${fmt.kg(latest.weightKg)} vs ${fmt.kg(st.expected)}). Make sure you're eating enough.`
          : `Behind plan by ${fmt.number(st.diff, 1)} kg (${fmt.kg(latest.weightKg)} vs ${fmt.kg(st.expected)}). Check portions and snacks, and weigh in under the same conditions each time.`;
    const head = `<div class="card big"><div class="row-between"><span class="title3">${esc(pl.name)}</span>${st ? pill(st.state === 'on' ? 'ON TRACK' : st.state === 'ahead' ? 'AHEAD' : 'BEHIND', st.state === 'on' ? 'completed' : st.state === 'ahead' ? 'active' : 'partial') : ''}</div>
      ${pl.targetWeightKg != null ? `<div class="sub num">${fmt.number(pl.startWeightKg, 1)} kg → ${fmt.number(pl.targetWeightKg, 1)} kg · ${fmt.number(pl.rate, 2)} kg a week · finish ≈ ${esc(fmt.dayMonthYear(fin))}</div>
        <div class="caption muted num">Week ${st ? st.week : Math.max(1, Math.floor((parseDay(today) - parseDay(pl.startDate)) / (7 * 86400000)) + 1)} · aim for about ${fmt.kg(exp)} this week</div>` : ''}
      ${stText ? `<div class="caption ${st && st.state === 'behind' ? 'text-partial' : 'muted'}">${esc(stText)}</div>` : ''}</div>`;
    const week = `<div class="section-label">Every week</div><div class="list grouped">${Plan.DAY_ORDER.map((wd) => {
      const d = pl.days[wd]; const isToday = d === todayWd;
      return `<div class="list-row ${isToday ? 'today-row' : ''}"><span class="wd short">${weekdayName(wd, true)}</span><span class="grow minw0"><span class="block ellipsis">${esc(d.label || '—')}</span>${d.water ? `<span class="caption faint">+${d.water} ml water</span>` : ''}</span><span class="num ${isToday ? 'strong' : 'muted'}">${fmt.integer(d.kcal)} kcal</span></div>`;
    }).join('')}</div>
      <div class="caption faint num">Average ${fmt.integer(Plan.weeklyAverage(pl))} kcal a day${pl.protein != null ? ` · protein ${fmt.integer(pl.protein)} g` : ''}${pl.fat != null ? ` · fat ${fmt.integer(pl.fat)} g` : ''} every day${pl.water != null ? ` · water ${fmt.number(pl.water / 1000, 1)} L` : ''}. Carbs fill the rest of each day's calories.</div>`;
    const ms = Plan.milestones(pl, 4);
    const weighIns = Q.bodyStats(false).filter((e) => e.weightKg != null);
    const near = (day) => { const t = parseDay(day).getTime(); const w = weighIns.filter((e) => Math.abs(e.date - t) < 4 * 86400000); return w.length ? w[w.length - 1].weightKg : null; };
    const miles = ms.length ? `<div class="section-label">Milestones</div><div class="list grouped">${ms.map((m) => {
      const actual = m.day <= today ? near(m.day) : null;
      const ok = actual != null && (pl.targetWeightKg < pl.startWeightKg ? actual <= m.weight + 0.5 : actual >= m.weight - 0.5);
      return `<div class="list-row"><span class="grow"><span class="block">Week ${m.week}</span><span class="caption faint">${esc(fmt.dayMonthYear(m.day))}</span></span>
        ${actual != null ? `<span class="caption ${ok ? 'text-completed' : 'text-partial'} num">you: ${fmt.kg(actual)}</span>` : ''}<span class="num muted">${fmt.kg(m.weight)}</span></div>`;
    }).join('')}</div>` : '';
    const tips = (pl.tips || []).length ? `<div class="section-label">Tips</div><div class="card">${pl.tips.map((t) => `<div class="sub">• ${esc(t)}</div>`).join('')}</div>` : '';
    return `<div class="stack">${head}${week}${miles}${tips}
      <div class="list grouped"><button class="list-row accent" data-act="body"><span class="grow">Log a weigh-in (Body tab)</span>${icon.chevron}</button>
        <button class="list-row accent" data-act="edit"><span class="grow">Edit plan</span>${icon.chevron}</button>
        <button class="list-row accent" data-act="import"><span class="grow">Import a different plan</span>${icon.chevron}</button>
        <button class="list-row destructive" data-act="remove"><span>Remove plan</span></button></div>
      <div class="caption faint">Weigh in once a week, same day and time (morning, after the toilet, before food). Weight jumps around day to day, so judge progress over 2–3 weeks.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Diet style presets

export class DietPresetsScreen extends Screen {
  constructor() {
    super('Diet style');
    this.actions.pick = (el) => {
      const pr = Diets.preset(el.dataset.k); if (!pr) return;
      const p = Goals.profile();
      const hasOv = ['protein', 'carbs', 'fat', 'fibre', 'sugars', 'satFat', 'salt'].some((k) => p.overrides[k] != null);
      const goalText = pr.set.goal ? ` Your goal becomes ${pr.set.goal === 'lose' ? 'lose' : 'gain'} ${fmt.number(pr.set.rate, 2)} kg a week.` : ' Your current goal stays the same.';
      confirm(`Use “${pr.name}”?`, `${pr.desc}${goalText}${hasOv ? ' Your custom macro targets are replaced.' : ''}`, 'Use it', () => {
        Diets.applyPreset(pr.key); changed(); nav.pop(); toast(`Diet style: ${pr.name}`, 'good');
      }, false);
    };
  }
  render() {
    const p = Goals.profile();
    const card = (pr) => {
      const c = Goals.compute(todayKey(), Diets.withPreset(p, pr.key));
      const on = p.diet === pr.key;
      const goal = pr.set.goal ? `${pr.set.goal === 'lose' ? '−' : '+'}${fmt.number(pr.set.rate, 2)} kg/wk` : 'any goal';
      return `<button class="card card-btn diet ${on ? 'on' : ''}" data-act="pick" data-k="${pr.key}">
        <div class="row-between"><span class="sub strong">${esc(pr.name)}</span>${on ? pill('CURRENT', 'active') : `<span class="caption faint">${goal}</span>`}</div>
        <div class="caption muted">${esc(pr.desc)}</div>
        <div class="diet-macros num"><span><b>${fmt.integer(c.targets.kcal)}</b> kcal</span><span>P <b>${fmt.integer(c.targets.protein)}</b></span><span>C <b>${fmt.integer(c.targets.carbs)}</b></span><span>F <b>${fmt.integer(c.targets.fat)}</b> g</span></div>
      </button>`;
    };
    return `<div class="stack">
      <div class="caption muted">Each preset sets your macros and nutrient limits; cut and bulk styles also set your goal. Numbers are for you today. You can fine-tune anything afterwards.</div>
      ${Diets.GROUPS.map(([g, title]) => `<div class="section-label">${title}</div>${Diets.PRESETS.filter((x) => x.group === g).map(card).join('')}`).join('')}
      <div class="caption faint">Estimates for healthy adults, not medical advice. Very low-carb, aggressive cuts and DASH for blood pressure are best done with a doctor if you have a health condition.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// AI settings (Gemini key)

export class AISettingsScreen extends Screen {
  constructor() {
    super('AI settings');
    this.keyText = ai.key; this.models = null; this.testing = false; this.message = ''; this.err = false; this.show = false;
    Object.assign(this.actions, {
      save: () => this.save(),
      test: () => this.test(),
      tryIt: () => this.tryIt(),
      show: () => { this.show = !this.show; nav.refresh(); },
      paste: async () => { try { const t = await navigator.clipboard.readText(); if (t) { this.keyText = t.trim(); nav.refresh(); } } catch { toast('Long-press the field and choose Paste'); } },
      remove: () => confirm('Remove the API key?', 'AI photo and description logging stops working until you add a key again.', 'Remove', async () => { await ai.setKey(''); await ai.setModel(''); this.keyText = ''; this.models = null; this.message = 'Key removed.'; this.err = false; changed(); }),
    });
    this.inputs = { key: (el) => { this.keyText = el.value; } };
    this.changes = { model: (el) => { ai.setModel(el.value, true); this.message = el.value ? `Using ${el.value}.` : 'Choosing automatically.'; this.err = false; changed(); } };
  }
  async save() {
    const k = this.keyText.replace(/\s+/g, '');
    if (!k) { this.message = 'Paste your key first.'; this.err = true; nav.refresh(); return; }
    if (k.length < 20 || !/^[A-Za-z0-9_.\-]+$/.test(k)) { this.message = 'That doesn’t look like a complete key. Copy it again from AI Studio (it starts with “AIza” or “AQ.”).'; this.err = true; nav.refresh(); return; }
    await ai.setKey(k); await ai.setModel('');
    await this.test();
  }
  async tryIt() {
    if (!ai.hasKey) { this.message = 'Save a key first.'; this.err = true; nav.refresh(); return; }
    this.testing = true; this.message = 'Asking Gemini about “1 medium banana”…'; this.err = false; nav.refresh();
    const t0 = Date.now();
    try {
      const r = await analyse({ mode: 'text', text: '1 medium banana', onStatus: (s) => { this.message = s; nav.refresh(); } });
      const k = r.items[0] ? r.items[0].totals.kcal : null;
      this.message = `Works: ${r.model} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s${k != null ? ` (banana ≈ ${Math.round(k)} kcal)` : ''}.`; this.err = false;
    } catch (e) { this.message = `${e.message}${e.detail ? `\nGoogle said: ${e.detail}` : ''}`; this.err = true; }
    this.testing = false; changed();
  }
  async test() {
    if (!ai.hasKey) { this.message = 'Save a key first.'; this.err = true; nav.refresh(); return; }
    this.testing = true; this.message = ''; nav.refresh();
    try {
      this.models = await discoverModels();
      if (!this.models.length) throw new AIError('This key works but has no Gemini models available.');
      if (!ai.model || !this.models.includes(ai.model) || getKV('gemini.modelPick', '') !== 'user') await ai.setModel(this.models[0]);
      this.message = `Key works. Using ${ai.model}.`; this.err = false;
    } catch (e) { this.message = e.message; this.err = true; }
    this.testing = false; changed();
  }
  render() {
    const has = ai.hasKey;
    const models = this.models || (ai.model ? [ai.model] : []);
    return `<div class="stack">
      <div class="card info"><div class="sub">AI photo and description logging uses <b>Google Gemini</b>. You use your own free key, so there’s no account with GymOS and no cost for normal use.</div></div>
      <div class="section-label">Get a free key (2 minutes)</div>
      <div class="card steps">
        <div class="step"><span class="step-n">1</span><span>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with a Google account.</span></div>
        <div class="step"><span class="step-n">2</span><span>Tap <b>Create API key</b> (accept the terms if asked), then copy the key.</span></div>
        <div class="step"><span class="step-n">3</span><span>Come back here, paste it below and tap <b>Save & test</b>.</span></div>
      </div>
      <div class="section-label">Your key</div>
      <div class="list grouped form">
        <div class="row"><input class="text-input full mono" type="${this.show ? 'text' : 'password'}" placeholder="AIza… or AQ.…" value="${esc(this.keyText)}" data-input="key" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          <button class="link-btn small" data-act="show">${this.show ? 'Hide' : 'Show'}</button></div>
      </div>
      <div class="tiles"><button class="btn secondary" data-act="paste">Paste</button><button class="btn primary short" data-act="save" ${this.testing ? 'disabled' : ''}>${this.testing ? '<span class="spinner dark"></span>' : 'Save & test'}</button></div>
      ${this.message ? `<div class="caption pre-line ${this.err ? 'text-partial' : 'text-completed'}">${esc(this.message)}</div>` : ''}
      ${has ? `<div class="section-label">Model</div>
        <div class="list grouped form"><label class="row"><span class="row-label grow">Gemini model</span><select class="select small" data-change="model">${models.map((m) => `<option value="${esc(m)}" ${ai.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}${models.length ? '' : '<option value="">Automatic</option>'}</select></label>
          <button class="list-row accent" data-act="test" ${this.testing ? 'disabled' : ''}><span>Test key & refresh models</span></button>
          <button class="list-row accent" data-act="tryIt" ${this.testing ? 'disabled' : ''}><span>Run a food test</span></button>
          <button class="list-row destructive" data-act="remove"><span>Remove key</span></button></div>
        <div class="caption faint">The fastest current “flash” model is picked automatically. If Google retires a model, GymOS switches to a newer one.</div>` : ''}
      <div class="section-label">Privacy & limits</div>
      <div class="card"><div class="caption muted">The key is stored only on this iPhone and is never included in backups. Photos and descriptions are sent directly to Google only when you tap Analyse. On the free tier Google may use requests to improve its products and limits how many you can make per minute and per day — plenty for logging meals. Barcode scanning and search use Open Food Facts and don’t need a key.</div></div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// All nutrients for a day (or 7-day average)

export class NutrientsScreen extends Screen {
  constructor(day = todayKey()) {
    super('Nutrients');
    this.day = day; this.mode = 'day';
    Object.assign(this.actions, {
      mode: (el) => { this.mode = el.dataset.m; nav.refresh(); },
      prev: () => { this.day = addDaysKey(this.day, -1); nav.refresh(); },
      next: () => { if (this.day < todayKey()) { this.day = addDaysKey(this.day, 1); nav.refresh(); } },
    });
  }
  render() {
    const T = Goals.targetsFor(this.day);
    let tot, entries, label;
    if (this.mode === 'day') {
      entries = F.entriesOn(this.day); tot = F.dayTotals(this.day); label = fmt.weekdayDayMonth(this.day);
    } else {
      const from = addDaysKey(this.day, -6);
      const byDay = F.totalsByDay(from, this.day);
      tot = averageTotals(byDay); entries = F.entriesInRange(from, this.day);
      label = `${fmt.dayMonth(from)} – ${fmt.dayMonth(this.day)} · average of ${byDay.size} logged day${byDay.size === 1 ? '' : 's'}`;
    }
    const groups = GROUPS.map(([g, title]) => {
      const list = NUTRIENTS.filter((n) => n.group === g);
      const micro = g === 'vitamin' || g === 'mineral';
      return `<div class="section-label">${title}</div><div class="card">${list.map((n) => {
        const cov = micro ? coverage(entries, n.key) : null;
        return `${bar(n.key, tot[n.key] || 0, T[n.key])}${cov && cov.total && cov.have < cov.total ? `<div class="caption faint cov">Data for ${cov.have} of ${cov.total} foods</div>` : ''}`;
      }).join('')}</div>`;
    }).join('');
    return `<div class="stack">
      <div class="segmented">${[['day', 'Day'], ['week', '7-day average']].map(([k, l]) => `<button class="seg ${this.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}">${l}</button>`).join('')}</div>
      <div class="date-bar"><button class="nav-btn" data-act="prev" aria-label="Previous day">${icon.chevronLeft}</button><span class="date-title">${esc(label)}</span><button class="nav-btn" data-act="next" ${this.day >= todayKey() ? 'disabled' : ''} aria-label="Next day">${icon.chevron}</button></div>
      ${groups}
      <div class="caption faint">Vitamins and minerals only count foods that include them: products from Open Food Facts often list only some, AI estimates include most. Values are estimates.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Trends

function barChart(points, { target = null, unit = '' } = {}) {
  if (!points.length) return '<div class="chart-empty">Nothing logged in this period.</div>';
  const W = Math.round(clamp(window.innerWidth, 320, 640) - 58), H = 150;
  const padL = 40, padR = 6, padT = 8, padB = 20;
  const max = Math.max(...points.map((p) => p.value), target || 0) * 1.1 || 1;
  const step = Math.pow(10, Math.floor(Math.log10(max / 3)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 4) || step * 10;
  const ticks = []; for (let v = 0; v <= max; v += tickStep) ticks.push(v);
  const n = points.length, bw = (W - padL - padR) / n;
  const sy = (v) => padT + (1 - v / max) * (H - padT - padB);
  const grid = ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${padL - 6}" y="${sy(t) + 3.5}" class="axis" text-anchor="end">${esc(fmt.number(t, 0))}</text>`).join('');
  const bars = points.map((p, i) => {
    const x = padL + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7), y = sy(p.value);
    const cls = !target || !p.value ? 'b-none' : p.value > target * 1.1 ? 'b-over' : p.value >= target * 0.9 ? 'b-ok' : 'b-low';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, H - padB - y).toFixed(1)}" rx="2" class="${cls}"><title>${esc(fmt.dayMonth(p.day))}: ${esc(fmt.integer(p.value))} ${esc(unit)}</title></rect>`;
  }).join('');
  const labels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i, k, a) => `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 5}" class="axis" text-anchor="${k === 0 && a.length > 1 ? 'start' : k === a.length - 1 && a.length > 1 ? 'end' : 'middle'}">${esc(fmt.dayMonth(points[i].day))}</text>`).join('');
  const tl = target ? `<line x1="${padL}" x2="${W - padR}" y1="${sy(target)}" y2="${sy(target)}" class="target-line"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart">${grid}${bars}${tl}${labels}</svg>`;
}

export class TrendsScreen extends Screen {
  constructor() {
    super('Trends');
    this.range = 14;
    this.actions.range = (el) => { this.range = Number(el.dataset.r); nav.refresh(); };
  }
  render() {
    const today = todayKey();
    const from = addDaysKey(today, -(this.range - 1));
    const days = daysInRange(from, today);
    const byDay = F.totalsByDay(from, today);
    const T = Goals.targetsFor(today);
    const targets = new Map(days.map((d) => [d, Goals.targetsFor(d)]));
    const pts = (k) => days.map((d) => ({ day: d, value: byDay.has(d) ? (byDay.get(d).totals[k] || 0) : 0 }));
    const logged = days.filter((d) => byDay.has(d) && d !== today);
    const loggedAll = days.filter((d) => byDay.has(d));
    const avg = (k) => (loggedAll.length ? sum(loggedAll, (d) => byDay.get(d).totals[k] || 0) / loggedAll.length : null);
    const onTarget = logged.filter((d) => { const v = byDay.get(d).totals.kcal || 0; const t = targets.get(d).kcal; return v >= t * 0.9 && v <= t * 1.1; }).length;
    const proteinHit = logged.filter((d) => (byDay.get(d).totals.protein || 0) >= targets.get(d).protein * 0.9).length;
    const aK = avg('kcal'), aP = avg('protein'), aC = avg('carbs'), aF = avg('fat');
    const split = aK ? [['Protein', aP * 4], ['Carbs', aC * 4], ['Fat', aF * 9]].map(([l, k]) => [l, Math.round((k / aK) * 100)]) : null;
    const startMs = parseDay(from).getTime();
    const weights = Q.bodyStats(false).filter((e) => e.weightKg != null && e.date >= startMs - 86400000).map((e) => ({ date: e.date, value: e.weightKg }));
    const c = Goals.compute(today);
    const ad = c.adaptive;
    return `<div class="stack">
      <div class="segmented">${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([r, l]) => `<button class="seg ${this.range === r ? 'on' : ''}" data-act="range" data-r="${r}">${l}</button>`).join('')}</div>
      <div class="tiles">${statTile('Avg calories', aK != null ? fmt.integer(aK) : '—', `target ${fmt.integer(T.kcal)}`)}${statTile('Days logged', `${loggedAll.length}/${days.length}`, `${F.streak(today)}-day streak`)}${statTile('On target', logged.length ? `${onTarget}/${logged.length}` : '—', '±10% calories')}</div>
      <div class="card"><div class="row-between"><span class="sub strong">Calories</span><span class="caption faint">line = target</span></div>${barChart(pts('kcal'), { target: T.kcal, unit: 'kcal' })}</div>
      <div class="card"><div class="row-between"><span class="sub strong">Protein</span><span class="caption faint">${logged.length ? `target hit ${proteinHit}/${logged.length} days` : ''}</span></div>${barChart(pts('protein'), { target: T.protein, unit: 'g' })}</div>
      <div class="tiles">${statTile('Protein', aP != null ? `${fmt.integer(aP)} g` : '—', split ? `${split[0][1]}% of kcal` : null)}${statTile('Carbs', aC != null ? `${fmt.integer(aC)} g` : '—', split ? `${split[1][1]}% of kcal` : null)}${statTile('Fat', aF != null ? `${fmt.integer(aF)} g` : '—', split ? `${split[2][1]}% of kcal` : null)}</div>
      <div class="card"><div class="row-between"><span class="sub strong">Body weight</span><span class="caption faint">from Body tab</span></div>${lineChart(weights, { unit: 'kg' })}</div>
      <div class="card"><div class="sub strong">Your real maintenance</div>
        ${ad.ready ? `<div class="sub num">≈ ${fmt.integer(ad.value)} kcal/day</div>
          <div class="caption muted">You ate ${fmt.integer(ad.avgIntake)} kcal/day on average over ${ad.loggedDays} logged days while your weight changed ${ad.weeklyChangeKg >= 0 ? '+' : '−'}${fmt.number(Math.abs(ad.weeklyChangeKg), 2)} kg/week (${ad.weighIns} weigh-ins). Formula estimate: ${fmt.integer(c.formulaTDEE || 0)} kcal.</div>`
          : `<div class="caption muted">GymOS compares what you eat with how your weight changes to learn your true maintenance calories. It needs at least 10 fully logged days and 2 weigh-ins 10+ days apart in the last 4 weeks. So far: ${ad.loggedDays} days, ${ad.weighIns} weigh-ins over ${ad.spanDays} days.</div>`}
      </div>
      <div class="caption faint">Today is excluded from on-target counts until it’s over. Days with nothing logged show as empty.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// My foods

export class MyFoodsScreen extends Screen {
  constructor() {
    super('My foods');
    this.q = '';
    Object.assign(this.actions, {
      create: () => presentSheet(new CustomFoodSheet({}), { height: 'large' }),
      food: (el) => {
        const f = state.foods.get(el.dataset.id); if (!f) return;
        menu([
          { label: 'Log it', icon: 'plus', handler: () => presentSheet(new FoodAmountSheet({ food: f, day: todayKey(), meal: defaultMeal() }), { height: 'large' }) },
          { label: f.source === 'custom' ? 'Edit' : 'Edit as my own food', icon: 'pencil', handler: () => presentSheet(new CustomFoodSheet({ food: { ...f, source: 'custom' } }), { height: 'large' }) },
          { label: f.fav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', handler: () => Log.toggleFavourite(f) },
          { label: 'Delete', icon: 'trash', destructive: true, handler: () => confirm(`Delete “${f.name}”?`, 'Entries already logged keep their values.', 'Delete', () => Log.deleteFood(f.id)) },
        ], f.name);
      },
    });
    this.inputs = { q: (el) => { this.q = el.value; nav.refresh(); } };
  }
  render() {
    const q = norm(this.q);
    const all = F.foods().filter((f) => !q || norm(`${f.name} ${f.brand || ''} ${f.barcode || ''}`).includes(q));
    const mine = all.filter((f) => f.source === 'custom' || f.saved).sort((a, b) => a.name.localeCompare(b.name));
    const cached = all.filter((f) => !(f.source === 'custom' || f.saved)).sort((a, b) => (b.lastUsed || b.createdAt) - (a.lastUsed || a.createdAt));
    const row = (f) => `<button class="list-row" data-act="food" data-id="${f.id}"><span class="grow minw0"><span class="block ellipsis">${esc(f.name)}${f.fav ? ' <span class="text-partial">★</span>' : ''}</span><span class="caption faint ellipsis block">${esc([f.brand, f.barcode, `${fmtN('kcal', f.base.kcal || 0)} per ${f.basis === 'portion' ? (f.portionLabel || 'portion') : `100 ${f.unit}`}`].filter(Boolean).join(' · '))}</span></span>${icon.chevron}</button>`;
    return `<div class="stack">
      <div class="search-box">${icon.search}<input type="search" placeholder="Search" value="${esc(this.q)}" data-input="q"></div>
      <button class="btn secondary" data-act="create">${icon.plus} CREATE FOOD</button>
      <div class="section-label">My foods (${mine.length})</div>
      ${mine.length ? `<div class="list grouped">${mine.map(row).join('')}</div>` : '<div class="caption faint">Foods you create or save appear here.</div>'}
      <div class="section-label">Scanned & online (${cached.length})</div>
      ${cached.length ? `<div class="list grouped">${cached.map(row).join('')}</div>` : '<div class="caption faint">Products you scan or find online are kept here so they work offline.</div>'}
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Saved meals

export class SavedMealsScreen extends Screen {
  constructor() {
    super('Saved meals');
    this.actions.meal = (el) => {
      const m = state.meals.get(el.dataset.id); if (!m) return;
      menu([
        ...MEALS.map((x) => ({ label: `Log to today's ${x.label.toLowerCase()}`, icon: 'plus', handler: () => { const n = Log.logMeal(m, todayKey(), x.key); toast(`Added ${n} items to ${x.label}`, 'good'); } })),
        { label: 'Rename', icon: 'pencil', handler: () => presentSheet(new RenameSheet(m.name, (name) => Log.renameMeal(m, name))) },
        { label: 'Delete', icon: 'trash', destructive: true, handler: () => confirm(`Delete “${m.name}”?`, '', 'Delete', () => Log.deleteMeal(m.id)) },
      ], m.name);
    };
  }
  render() {
    const meals = F.meals();
    if (!meals.length) return `<div class="card">${emptyState('No saved meals', 'On the Food screen, tap ⋯ next to a meal and choose “Save as meal”.', 'list')}</div>`;
    return `<div class="stack">${meals.map((m) => {
      const t = {}; for (const it of m.items) for (const [k, v] of Object.entries(entryTotals(it))) t[k] = (t[k] || 0) + v;
      return `<button class="card card-btn" data-act="meal" data-id="${m.id}"><div class="row-between"><span class="sub strong">${esc(m.name)}</span><span class="meta">${fmtN('kcal', t.kcal || 0)}</span></div>
        <div class="caption faint num">${macroLine(t)} g</div><div class="caption muted clamp2">${esc(m.items.map((i) => i.name).join(', '))}</div></button>`;
    }).join('')}</div>`;
  }
}

class RenameSheet extends NumberSheet {
  constructor(name, onDone) { super({ title: 'Rename', onDone }); this.text = name; this.actions.done = () => { const n = this.text.trim(); if (n) { this.close(); onDone(n); } }; }
  render() {
    return `<div class="sheet-header"><button class="link-btn" data-act="cancel">Cancel</button><div class="sheet-title">Rename</div><button class="link-btn strong" data-act="done">Save</button></div>
      <div class="list grouped form"><label class="row"><input class="text-input full" value="${esc(this.text)}" data-input="v"></label></div>`;
  }
}

// ---------------------------------------------------------------------------------
// BMI & body calculator (nothing is saved unless you choose to)

export class BodyCalcScreen extends Screen {
  constructor() {
    super('Body calculator');
    const p = Goals.profile(); const b = Goals.bodyInputs(p);
    const latest = Q.bodyStats().find((e) => e.waistCm != null);
    this.v = {
      weight: b.weightKg ? fmt.editable(b.weightKg) : '', height: b.heightCm ? fmt.editable(Math.round(b.heightCm)) : '',
      age: b.age != null ? String(b.age) : '', bf: b.bodyFat != null ? fmt.editable(b.bodyFat) : '', waist: latest ? fmt.editable(latest.waistCm) : '',
    };
    this.sex = p.sex || 'male';
    this.actions.sex = (el) => { this.sex = el.dataset.v; nav.refresh(); };
    this.actions.useManual = () => {
      const w = parseDecimal(this.v.weight), h = parseDecimal(this.v.height), a = parseDecimal(this.v.age);
      upd({ sex: this.sex, manual: { weightKg: w, heightCm: h, age: a != null ? Math.round(a) : null } });
      toast('Saved for goals (Body tab values still take priority)', 'good');
    };
    this.inputs = { f: (el) => { this.v[el.dataset.k] = el.value; this.refreshResults(); } };
  }
  refreshResults() {
    const el = this._el && this._el.querySelector('[data-results]');
    if (el) el.innerHTML = this.results();
  }
  results() {
    const w = parseDecimal(this.v.weight), h = parseDecimal(this.v.height), a = parseDecimal(this.v.age);
    const bf = parseDecimal(this.v.bf), waist = parseDecimal(this.v.waist);
    if (!(w > 20 && w < 400) || !(h > 100 && h < 250)) return '<div class="caption faint">Enter weight and height to see results.</div>';
    const B = Goals.bmi(w, h); const band = Goals.bmiBand(B); const range = Goals.healthyWeightRange(h);
    const mif = a > 0 ? Goals.bmr({ weightKg: w, heightCm: h, age: a, sex: this.sex }, false) : null;
    const kat = bf > 2 && bf < 70 ? Goals.bmr({ weightKg: w, bodyFat: bf }, true) : null;
    const base = (kat || mif);
    const lbm = bf > 2 && bf < 70 ? w * (1 - bf / 100) : null;
    const ffmi = lbm ? lbm / ((h / 100) ** 2) + 6.1 * (1.8 - h / 100) : null;
    const whtr = waist > 30 ? waist / h : null;
    const row = (l, v, sub = '') => `<div class="list-row slim"><span class="grow">${l}${sub ? `<span class="row-sub">${sub}</span>` : ''}</span><span class="num muted right">${v}</span></div>`;
    return `<div class="card"><div class="row-between"><span class="label">BMI</span>${band ? pill(band[0].toUpperCase(), band[1]) : ''}</div>
        <div class="big-num num">${fmt.number(B, 1)}</div>
        <div class="bmi-scale"><div class="bmi-seg u"></div><div class="bmi-seg h"></div><div class="bmi-seg o"></div><div class="bmi-seg ob"></div><div class="bmi-mark" style="left:${clamp((B - 15) / 25 * 100, 0, 100).toFixed(1)}%"></div></div>
        <div class="bmi-ticks caption faint num">${[15, 18.5, 25, 30, 40].map((v) => `<span style="left:${((v - 15) / 25 * 100).toFixed(1)}%">${fmt.number(v, 1)}</span>`).join('')}</div>
        <div class="caption muted">Healthy weight for ${fmt.integer(h)} cm: ${fmt.number(range[0], 1)}–${fmt.number(range[1], 1)} kg. BMI doesn’t separate muscle from fat, so it reads high for many people who lift — waist-to-height and body fat tell you more.</div></div>
      <div class="list grouped">
        ${row('BMR (Mifflin-St Jeor)', mif ? kcal(mif.value) : 'needs age')}
        ${kat ? row('BMR (Katch-McArdle)', kcal(kat.value), 'from lean mass') : ''}
        ${lbm ? row('Lean body mass', fmt.kg(lbm)) : ''}
        ${lbm ? row('Fat mass', fmt.kg(w - lbm)) : ''}
        ${ffmi ? row('FFMI (normalised)', fmt.number(ffmi, 1), ffmi < 18 ? 'below average' : ffmi < 20 ? 'average' : ffmi < 22 ? 'above average' : ffmi < 25 ? 'excellent' : 'exceptional') : ''}
        ${whtr ? row('Waist-to-height ratio', fmt.number(whtr, 2), whtr < 0.4 ? 'low' : whtr < 0.5 ? 'healthy' : whtr < 0.6 ? 'increased risk' : 'high risk') : ''}
        ${row('Protein for lifters', `${fmt.integer(w * 1.6)}–${fmt.integer(w * 2.2)} g/day`, '1.6–2.2 g per kg')}
        ${row('Water', `${fmt.number(w * 35 / 1000, 1)} L/day`, '35 ml per kg, more when training')}
      </div>
      ${base ? `<div class="section-label">Maintenance calories by activity</div><div class="list grouped">${Goals.ACTIVITY.map(([m, l, d]) => row(l, kcal(base.value * m), d)).join('')}</div>` : ''}`;
  }
  render() {
    const f = (k, label, unit) => `<label class="row"><span class="row-label grow">${label}</span><input class="num-input" inputmode="decimal" placeholder="—" value="${esc(this.v[k])}" data-input="f" data-k="${k}"><span class="unit w-unit">${unit}</span></label>`;
    return `<div class="stack">
      <div class="segmented">${[['male', 'Male'], ['female', 'Female']].map(([v, l]) => `<button class="seg ${this.sex === v ? 'on' : ''}" data-act="sex" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="list grouped form">${f('weight', 'Weight', 'kg')}${f('height', 'Height', 'cm')}${f('age', 'Age', 'yrs')}${f('bf', 'Body fat (optional)', '%')}${f('waist', 'Waist (optional)', 'cm')}</div>
      <div class="caption faint">Pre-filled from your latest Body check-in. Changing values here doesn’t change your body stats.</div>
      <div data-results class="stack">${this.results()}</div>
      <button class="btn secondary" data-act="useManual">Use for goals if the Body tab is empty</button>
    </div>`;
  }
}
