// Food tab: daily diary with calorie ring, macros, water, meals and nutrient progress.

import { nav, Screen } from '../nav.js';
import { icon, presentSheet, menu, confirm, toast, alert, pill } from '../ui.js';
import { esc, fmt, todayKey, addDaysKey, daysBetween } from '../util.js';
import * as FS from '../food/store.js';
import { state } from '../food/store.js';
import { MEALS, F, fmtN, entryTotals, amountText, mealLabel, defaultMeal } from '../food/nutrients.js';
import * as Goals from '../food/goals.js';
import * as Diets from '../food/diets.js';
import * as Log from '../food/log.js';
import { ring, bar, NumberSheet, macroLine } from './foodui.js';
import { AddFoodSheet, FoodAmountSheet, ScanSheet, QuickAddSheet, openAI } from './foodadd.js';
import { GoalsScreen, NutrientsScreen, TrendsScreen, MyFoodsScreen, SavedMealsScreen, AISettingsScreen, BodyCalcScreen } from './foodmore.js';

let rootScreen = null;
/** Switch to the Food tab showing a given day (used by the Calendar). */
export function openFoodDay(day) {
  nav.switchTab('food', true);
  if (rootScreen) { rootScreen.day = day; nav.refresh(); }
}

export class FoodScreen extends Screen {
  constructor() {
    super('Food');
    rootScreen = this;
    this.day = todayKey();
    Object.assign(this.actions, {
      prev: () => { this.day = addDaysKey(this.day, -1); nav.refresh(); },
      next: () => { if (this.day < todayKey()) { this.day = addDaysKey(this.day, 1); nav.refresh(); } },
      today: () => { this.day = todayKey(); nav.refresh(); },
      more: () => menu([
        { label: 'Goals & targets', icon: 'target', handler: () => nav.push(new GoalsScreen()) },
        { label: 'Trends', icon: 'chart', handler: () => nav.push(new TrendsScreen()) },
        { label: 'All nutrients', icon: 'pill', handler: () => nav.push(new NutrientsScreen(this.day)) },
        { label: 'My foods', icon: 'food', handler: () => nav.push(new MyFoodsScreen()) },
        { label: 'Saved meals', icon: 'list', handler: () => nav.push(new SavedMealsScreen()) },
        { label: 'BMI & body calculator', icon: 'scale', handler: () => nav.push(new BodyCalcScreen()) },
        { label: 'AI settings', icon: 'sparkle', handler: () => nav.push(new AISettingsScreen()) },
      ]),
      goals: () => nav.push(new GoalsScreen()),
      nutrients: () => nav.push(new NutrientsScreen(this.day)),
      add: (el) => presentSheet(new AddFoodSheet({ day: this.day, meal: el.dataset.meal || this.defaultMeal() }), { height: 'large' }),
      scan: () => presentSheet(new ScanSheet({ day: this.day, meal: this.defaultMeal() }), { height: 'large' }),
      aiPhoto: () => openAI({ mode: 'photo', day: this.day, meal: this.defaultMeal() }),
      aiText: () => openAI({ mode: 'text', day: this.day, meal: this.defaultMeal() }),
      search: () => presentSheet(new AddFoodSheet({ day: this.day, meal: this.defaultMeal() }), { height: 'large' }),
      entry: (el) => { const e = state.entries.get(el.dataset.id); if (e) presentSheet(new FoodAmountSheet({ food: Log.foodFromEntry(e), entry: e }), { height: 'large' }); },
      entryMenu: (el) => this.entryMenu(state.entries.get(el.dataset.id)),
      mealMenu: (el) => this.mealMenu(el.dataset.meal),
      water: (el) => Log.addWater(this.day, Number(el.dataset.ml)),
      waterCustom: () => presentSheet(new NumberSheet({ title: 'Water today', value: F.water(this.day), unit: 'ml', hint: 'Total for the day, including drinks you count as water.', onDone: (v) => Log.setWater(this.day, v) })),
      copyYesterday: () => {
        const from = Log.yesterday(this.day);
        const n = Log.copyDay(from, this.day);
        toast(n ? `Copied ${n} item${n === 1 ? '' : 's'} from ${fmt.weekdayDayMonth(from)}` : 'Nothing logged the day before');
      },
      setup: () => nav.push(new GoalsScreen()),
    });
  }
  defaultMeal() { return this.day === todayKey() ? defaultMeal() : 'snacks'; }
  navRight() { return `<button class="nav-btn" data-act="more" aria-label="More">${icon.more}</button>`; }
  mounted(root) {
    // Swipe left/right on the date bar to change day.
    let sx = null, sy = null;
    root.addEventListener('touchstart', (e) => { if (!e.target.closest('.date-bar, .food-summary')) return; const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? this.actions.next : this.actions.prev)();
    }, { passive: true });
  }
  entryMenu(e) {
    if (!e) return;
    const others = MEALS.filter((m) => m.key !== e.meal);
    menu([
      { label: 'Edit', icon: 'pencil', handler: () => this.actions.entry({ dataset: { id: e.id } }) },
      { label: 'Add again', icon: 'plus', handler: () => { Log.copyEntries([e], this.day === todayKey() ? todayKey() : this.day); toast(`Added ${e.name} again`, 'good'); } },
      ...others.map((m) => ({ label: `Move to ${m.label}`, icon: 'swap', handler: () => Log.updateEntry(e, { meal: m.key }) })),
      this.day !== todayKey() ? { label: 'Copy to today', icon: 'copy', handler: () => { Log.copyEntries([e], todayKey()); toast('Copied to today', 'good'); } } : null,
      { label: 'Delete', icon: 'trash', destructive: true, handler: () => Log.deleteEntry(e.id) },
    ], e.name);
  }
  mealMenu(meal) {
    const items = F.entriesOn(this.day).filter((e) => e.meal === meal);
    const prev = Log.yesterday(this.day);
    const prevItems = F.entriesOn(prev).filter((e) => e.meal === meal);
    menu([
      { label: `Add to ${mealLabel(meal)}`, icon: 'plus', handler: () => this.actions.add({ dataset: { meal } }) },
      prevItems.length ? { label: `Copy ${mealLabel(meal).toLowerCase()} from ${fmt.weekdayDayMonth(prev)}`, icon: 'copy', handler: () => { const n = Log.copyMeal(prev, meal, this.day); toast(`Copied ${n} item${n === 1 ? '' : 's'}`, 'good'); } } : null,
      items.length ? { label: 'Save as meal', icon: 'star', handler: () => presentSheet(new MealNameSheet(mealLabel(meal), (name) => { Log.saveMeal(name, items); toast(`Saved “${name}”`, 'good'); })) } : null,
      items.length && this.day !== todayKey() ? { label: 'Copy to today', icon: 'copy', handler: () => { Log.copyEntries(items, todayKey(), meal); toast('Copied to today', 'good'); } } : null,
      items.length ? { label: `Clear ${mealLabel(meal).toLowerCase()}`, icon: 'trash', destructive: true, handler: () => confirm(`Delete ${items.length} item${items.length === 1 ? '' : 's'}?`, `${mealLabel(meal)} · ${fmt.weekdayDayMonth(this.day)}`, 'Delete', () => Log.deleteEntries(items.map((e) => e.id))) } : null,
    ], mealLabel(meal));
  }
  /** Target-weight progress and the fasting window under the summary. */
  goalLine(c, day) {
    const p = Goals.profile();
    const bits = [];
    const pl = c.plan;
    if (pl && pl.target && pl.current && p.goal !== 'maintain') {
      if (pl.reached) bits.push('<span class="text-completed">Target weight reached</span>');
      else if (!pl.mismatch) bits.push(`<span>${fmt.number(pl.toGo, 1)} kg to ${fmt.kg(pl.target)}${pl.eta ? ` · ≈ ${esc(fmt.dayMonth(pl.eta))}` : ''}</span>`);
    }
    if (p.window && day === todayKey()) {
      const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
      const toMin = (t) => { const [h, mm] = String(t).split(':').map(Number); return h * 60 + (mm || 0); };
      const a = toMin(p.window.start), b = toMin(p.window.end);
      const open = a <= b ? m >= a && m < b : m >= a || m < b;
      bits.push(`<span class="${open ? 'text-completed' : 'muted'}">Eating window ${esc(p.window.start)}–${esc(p.window.end)} · ${open ? 'open' : 'closed'}</span>`);
    }
    const pr = p.diet && p.diet !== 'balanced' ? Diets.preset(p.diet) : null;
    if (pr) bits.unshift(`<span>${esc(pr.name)}</span>`);
    return bits.length ? `<div class="goal-line caption faint num">${bits.join('<span class="dotsep">·</span>')}</div>` : '';
  }
  render() {
    if (!FS.isAvailable()) return `<div class="card"><div class="sub text-partial">Food storage couldn't be opened. Close GymOS completely and open it again. Your workouts are not affected.</div></div>`;
    const day = this.day, today = todayKey();
    const c = Goals.compute(day);
    const T = c.targets;
    const entries = F.entriesOn(day);
    const tot = {}; for (const e of entries) for (const [k, v] of Object.entries(entryTotals(e))) tot[k] = (tot[k] || 0) + v;
    const eaten = tot.kcal || 0;
    const remaining = T.kcal - eaten;
    const rel = day === today ? 'Today' : day === addDaysKey(today, -1) ? 'Yesterday' : '';
    const dateBar = `<div class="date-bar"><button class="nav-btn" data-act="prev" aria-label="Previous day">${icon.chevronLeft}</button>
      <button class="date-title" data-act="today">${rel ? `<b>${rel}</b> · ` : ''}${esc(fmt.weekdayDayMonth(day))}</button>
      <button class="nav-btn" data-act="next" ${day >= today ? 'disabled' : ''} aria-label="Next day">${icon.chevron}</button></div>`;
    const setup = Goals.isConfigured() ? '' : `<button class="card info card-btn" data-act="setup"><div class="row-between"><span class="sub strong">Set your goals</span>${icon.chevron}</div>
      <div class="caption muted">Targets below use defaults. Add your sex, activity and goal to get personal calorie, protein and nutrient targets${c.hasBody ? '' : ' (and a weekly check-in in the Body tab)'}.</div></button>`;
    const dayPill = c.trainingDays && Goals.profile().cycling ? pill(c.training ? 'TRAINING DAY' : 'REST DAY', c.training ? 'active' : 'rest') : (c.training ? pill('TRAINING DAY', 'active') : '');
    const summary = `<div class="card food-summary"><div class="sum-top">
        ${ring(eaten, T.kcal, { label: 'eaten' })}
        <div class="sum-stats">
          <div><span class="tile-label">Target</span><span class="sum-num num">${fmt.integer(T.kcal)}</span></div>
          <div><span class="tile-label">${remaining >= 0 ? 'Remaining' : 'Over'}</span><span class="sum-num num ${remaining < -T.kcal * 0.1 ? 'text-missed' : remaining < 0 ? 'text-partial' : ''}">${fmt.integer(Math.abs(remaining))}</span></div>
          <div>${dayPill}</div>
        </div></div>
      <div class="macro-bars">${bar('protein', tot.protein, T.protein, { compact: true })}${bar('carbs', tot.carbs, T.carbs, { compact: true, label: 'Carbs' })}${bar('fat', tot.fat, T.fat, { compact: true })}</div>
      ${this.goalLine(c, day)}
    </div>`;
    const quick = `<div class="quick-grid">
      <button class="qa" data-act="scan">${icon.barcode}<span>Scan</span></button>
      <button class="qa" data-act="aiPhoto">${icon.camera}<span>AI photo</span></button>
      <button class="qa" data-act="aiText">${icon.sparkle}<span>Describe</span></button>
      <button class="qa" data-act="search">${icon.search}<span>Search</span></button></div>`;
    const water = F.water(day);
    const wFrac = Math.min(1, water / (T.water || 1));
    const waterCard = `<div class="card water"><div class="row-between"><span class="row-left">${icon.drop}<span class="sub strong">Water</span></span>
        <button class="link-btn small num" data-act="waterCustom">${fmt.number(water / 1000, 2)} / ${fmt.number(T.water / 1000, 2)} L</button></div>
      <div class="nbar-track"><div class="nbar-fill water ${water >= T.water ? 'ok' : ''}" style="width:${(wFrac * 100).toFixed(1)}%"></div></div>
      <div class="water-btns"><button class="ft-small" data-act="water" data-ml="-250" ${water <= 0 ? 'disabled' : ''}>−250</button><button class="ft-small" data-act="water" data-ml="250">+250 ml</button><button class="ft-small" data-act="water" data-ml="500">+500 ml</button><button class="ft-small" data-act="water" data-ml="750">+750</button></div></div>`;
    const meals = MEALS.map((m) => {
      const list = entries.filter((e) => e.meal === m.key);
      const mt = {}; for (const e of list) for (const [k, v] of Object.entries(entryTotals(e))) mt[k] = (mt[k] || 0) + v;
      return `<div class="card meal"><div class="row-between"><span class="headline">${m.label}</span><span class="row-left"><span class="meta">${list.length ? `${fmt.integer(mt.kcal || 0)} kcal` : ''}</span><button class="icon-btn" data-act="mealMenu" data-meal="${m.key}" aria-label="${m.label} options">${icon.more}</button></span></div>
        ${list.length ? `<div class="caption faint num">${macroLine(mt)} g</div>` : ''}
        ${list.map((e) => { const t = entryTotals(e); return `<button class="food-row" data-act="entry" data-id="${e.id}" data-longpress="entryMenu">
          <span class="minw0 grow"><span class="block ellipsis">${esc(e.name)}${e.source === 'ai' ? ' <span class="src-tag">AI</span>' : ''}</span><span class="caption faint ellipsis block">${esc([e.brand, amountText(e)].filter(Boolean).join(' · '))}</span></span>
          <span class="sub num">${fmt.integer(t.kcal || 0)}</span></button>`; }).join('')}
        <button class="link-btn small left" data-act="add" data-meal="${m.key}">${icon.plus} Add food</button></div>`;
    }).join('');
    const others = `<div class="card"><div class="row-between"><span class="sub strong">Nutrients</span><button class="link-btn small" data-act="nutrients">All nutrients ${icon.chevron}</button></div>
      ${bar('fibre', tot.fibre, T.fibre)}${bar('sugars', tot.sugars, T.sugars)}${bar('satFat', tot.satFat, T.satFat)}${bar('salt', tot.salt, T.salt)}</div>`;
    const prevHas = F.entriesOn(addDaysKey(day, -1)).length > 0;
    const empty = !entries.length && prevHas ? `<button class="btn secondary" data-act="copyYesterday">${icon.copy} COPY ${fmt.weekdayDayMonth(addDaysKey(day, -1)).toUpperCase()}</button>` : '';
    const streak = F.streak(today);
    const foot = `<div class="caption faint center">${streak > 1 ? `${streak}-day logging streak · ` : ''}${c.adaptive.ready && Goals.profile().adaptive ? 'Targets adapt to your weigh-ins' : 'Target from your body stats'} · <button class="link-btn small" data-act="goals">Goals</button></div>`;
    return `<div class="stack">${dateBar}${setup}${summary}${quick}${empty}${meals}${waterCard}${others}${foot}</div>`;
  }
}

class MealNameSheet extends NumberSheet {
  constructor(defaultName, onDone) {
    super({ title: 'Save as meal', onDone });
    this.text = defaultName;
    this.actions.done = () => { const n = this.text.trim(); if (!n) return; this.close(); onDone(n); };
  }
  render() {
    return `<div class="sheet-header"><button class="link-btn" data-act="cancel">Cancel</button><div class="sheet-title">Save as meal</div><button class="link-btn strong" data-act="done">Save</button></div>
      <div class="list grouped form"><label class="row"><input class="text-input full" placeholder="Meal name (e.g. Usual breakfast)" value="${esc(this.text)}" data-input="v"></label></div>
      <div class="caption faint">Saved meals appear under “Meals” when adding food, so you can log them in one tap.</div>`;
  }
}
