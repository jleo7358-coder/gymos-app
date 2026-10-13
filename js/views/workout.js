// Workout tab: today's plan, the live workout, routines, exercises and the text parser.

import * as DB from '../db.js';
import {
  Q, S, Engine, Stats, Rest, Calendar, Routines, DAY_KIND, changed, orderedSets, exCompleted, routineItems,
  routineTotalSets, durationText, newExercise, setSummary, displayName,
} from '../engine.js';
import { nav, Screen } from '../nav.js';
import {
  View, icon, pill, emptyState, sheetHeader, menu, confirm, alert, presentSheet, dismissAll, patch, stepper, toggle, toast,
} from '../ui.js';
import {
  esc, fmt, norm, todayKey, ORDERED_WEEKDAYS, weekdayName, parseDecimal, minutesToTimeInput, timeInputToMinutes, uuid,
} from '../util.js';
import { parseRoutineText, cleanName } from '../parser.js';
import {
  setRow, installSetActions, startRest, SessionDetailScreen, ExercisePickerSheet, ExtraPickerSheet,
} from './common.js';

// ---------------------------------------------------------------------------------
// Root: home or live workout

export class WorkoutScreen extends Screen {
  constructor() {
    super('Workout');
    this.history = new Set();
    installSetActions(this, () => Engine.active, { completeAfterReps: true, applyToRemaining: true });
    Object.assign(this.actions, {
      start: () => { const info = Calendar.info(todayKey()); if (info.routine && !Engine.active) Engine.startPlanned(info.routine); },
      extra: () => presentSheet(new ExtraPickerSheet(todayKey())),
      viewSession: (el) => nav.push(new SessionDetailScreen(el.dataset.id)),
      routines: () => nav.push(new RoutineListScreen()),
      exercises: () => nav.push(new ExerciseListScreen()),
      parser: () => nav.push(new ParserImportScreen()),
      // live workout
      finish: () => this.confirmFinish(),
      headerMenu: () => menu([
        { label: 'Add exercise', icon: 'plus', handler: () => this.addExercise() },
        { label: 'Discard workout', icon: 'trash', destructive: true, handler: () => this.confirmDiscard() },
      ]),
      addExercise: () => this.addExercise(),
      rest: () => startRest(),
      exMenu: (el) => {
        const s = Engine.active; const se = s && s.exercises.find((e) => e.id === el.dataset.se);
        if (!se) return;
        const showing = this.history.has(se.id);
        menu([
          { label: 'Add set', icon: 'plus', handler: () => Engine.addSet(s, se) },
          { label: showing ? 'Hide history' : 'Show history', icon: 'clock', handler: () => { showing ? this.history.delete(se.id) : this.history.add(se.id); nav.refresh(); } },
          { label: 'Remove exercise', icon: 'trash', destructive: true, handler: () => confirm(`Remove ${se.name}?`, '', 'Remove', () => Engine.removeExercise(s, se.id)) },
        ], se.name);
      },
    });
  }
  get hideNav() { return !!Engine.active; }
  addExercise() {
    const s = Engine.active; if (!s) return;
    presentSheet(new ExercisePickerSheet('Add exercise', (ex) => Engine.addExercise(ex, s)), { height: 'large' });
  }
  confirmFinish() {
    const s = Engine.active; if (!s) return;
    confirm('Finish this workout?', `You completed ${S.completedSets(s)}/${S.totalSets(s)} sets.`, 'Finish', () => {
      const r = Engine.finish(s);
      if (r.prs.length) toast(`New best: ${r.prs.map((p) => p.name).join(', ')}`, 'good');
    }, false);
  }
  confirmDiscard() {
    const s = Engine.active; if (!s) return;
    confirm('Discard this workout?', 'All sets recorded in this session will be deleted.', 'Discard', () => Engine.discard(s));
  }
  render() { return Engine.active ? this.renderActive(Engine.active) : this.renderHome(); }

  renderHome() {
    const info = Calendar.info(todayKey());
    const routineCount = Q.routines().length;
    const exerciseCount = Q.exercises().length;
    let body;
    const s = info.session;
    if (s && s.status !== 'active') {
      body = `<div class="title3">${esc(s.routineName)}</div>
        <div class="sub muted num">${S.completedSets(s)}/${S.totalSets(s)} sets · ${durationText(s)} · ${fmt.integer(S.volume(s))} kg volume</div>
        <button class="link-btn left" data-act="viewSession" data-id="${s.id}">View workout</button>`;
    } else if (info.routine) {
      const items = routineItems(info.routine);
      body = `<div class="title3">${esc(info.routine.name)}</div>
        ${items.map((i) => `<div class="row-between"><span class="sub">${esc(displayName(i))}</span><span class="sub muted num">${esc(fmt.target(i.sets, i.repMin, i.repMax))}</span></div>`).join('')}
        ${items.length ? '' : '<div class="caption faint">This routine has no exercises yet.</div>'}
        <button class="btn primary" data-act="start">START WORKOUT</button>`;
    } else {
      body = `<div class="title3">Rest day</div><div class="sub muted">${routineCount === 0 ? 'No routines yet. Create a routine to plan your week.' : 'Nothing scheduled today.'}</div>`;
    }
    const prs = Engine.recentPRs;
    return `<div class="stack">
      <div class="card big">
        <div class="row-between"><div class="row-left"><span class="label">TODAY</span><span class="caption faint">${esc(fmt.weekdayDayMonth(new Date()))}</span></div>${pill(DAY_KIND[info.kind].label, info.kind)}</div>
        ${body}
        <button class="btn secondary" data-act="extra">START EXTRA WORKOUT</button>
      </div>
      ${prs.length ? `<div class="card"><div class="tag completed">NEW BEST</div>${prs.map((p) => `<div class="row-between"><span class="sub">${esc(p.name)}</span><span class="sub strong num">${esc(setSummary(p.weight, p.reps))}</span></div>`).join('')}</div>` : ''}
      <div class="list grouped">
        <button class="list-row" data-act="routines">${icon.list}<span class="grow">Routines</span><span class="faint">${routineCount}</span>${icon.chevron}</button>
        <button class="list-row" data-act="exercises">${icon.strength}<span class="grow">Exercises</span><span class="faint">${exerciseCount}</span>${icon.chevron}</button>
        <button class="list-row" data-act="parser">${icon.text}<span class="grow">Add routine from text</span>${icon.chevron}</button>
      </div>
    </div>`;
  }

  renderActive(s) {
    const restActive = Rest.isActive;
    const restLabel = fmt.duration(DB.settings().defaultRestSeconds);
    const cards = S.orderedExercises(s).map((se) => {
      const done = exCompleted(se).length, total = se.sets.length;
      const last = Stats.lastPerformance(se.exerciseId, se.name, s.startDate, s.id);
      let hist = '';
      if (this.history.has(se.id)) {
        const h = Stats.history(se.exerciseId, se.name).filter((p) => p.sessionId !== s.id).slice(0, 6);
        const best = h.reduce((b, p) => (!b || p.bestWeight > b.bestWeight ? p : b), null);
        hist = `<div class="hist">${h.length ? '' : '<div class="caption faint">No previous performances.</div>'}
          ${h.map((p) => `<div class="row-between"><span class="caption faint w48">${esc(fmt.dayMonth(p.date))}</span><span class="caption num grow ellipsis">${esc(p.setsSummary)}</span><span class="caption muted num">${fmt.integer(p.volume)} kg</span></div>`).join('')}
          ${best ? `<div class="caption muted">Best: ${esc(best.bestSummary)}</div>` : ''}</div>`;
      }
      return `<div class="card ex-card" data-key="${se.id}">
        <div class="row-between top"><span class="ex-name">${esc(se.name)}</span><div class="row-left"><span class="count ${done === total && total > 0 ? 'text-completed' : 'muted'}">${done}/${total}</span><button class="icon-btn" data-act="exMenu" data-se="${se.id}" aria-label="Exercise options">${icon.more}</button></div></div>
        <div class="row-between top">
          <div><div class="caption faint">Last</div>${last ? `<div class="sub strong num">${esc(last.bestSummary)}</div><div class="caption faint num ellipsis">${esc(last.setsSummary)} · ${esc(fmt.dayMonth(last.date))}</div>` : '<div class="sub faint">—</div>'}</div>
          <div class="right"><div class="caption faint">Target</div><div class="sub strong num">${esc(fmt.target(se.targetSets, se.repMin, se.repMax))}</div></div>
        </div>
        <div class="sets">${orderedSets(se).map((x) => setRow(x, se.id)).join('')}</div>
        ${done > 0 && !restActive ? `<button class="btn secondary" data-act="rest">${icon.timer} START REST · ${restLabel}</button>` : ''}
        ${hist}
      </div>`;
    }).join('');
    return `<div class="live">
      <div class="live-header">
        <div class="grow minw0"><div class="row-left">${s.isExtra ? '<span class="tag extra">EXTRA</span>' : ''}<span class="headline ellipsis">${esc(s.routineName)}</span></div>
          <div class="caption muted num"><span data-tick="elapsed">${fmt.duration(Engine.elapsed(s))}</span> · ${S.completedSets(s)}/${S.totalSets(s)} sets</div></div>
        <button class="icon-btn" data-act="headerMenu" aria-label="Workout options">${icon.more}</button>
        <button class="finish-btn" data-act="finish">Finish</button>
      </div>
      <div class="stack">
        ${cards}
        <button class="btn secondary" data-act="addExercise">${icon.plus} Add exercise</button>
        <button class="btn primary" data-act="finish">FINISH WORKOUT</button>
        <div class="floating-spacer"></div>
      </div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Routine list

class RoutineListScreen extends Screen {
  constructor() {
    super('Routines');
    Object.assign(this.actions, {
      open: (el) => nav.push(new RoutineEditorScreen(el.dataset.id)),
      new: () => { const r = Routines.create(); nav.push(new RoutineEditorScreen(r.id)); },
      parser: () => nav.push(new ParserImportScreen()),
      rowMenu: (el) => {
        const r = Q.routine(el.dataset.id); if (!r) return;
        menu([
          { label: 'Duplicate', icon: 'copy', handler: () => { const c = Routines.duplicate(r); nav.push(new RoutineEditorScreen(c.id)); } },
          { label: 'Delete', icon: 'trash', destructive: true, handler: () => confirm(`Delete ${r.name}?`, 'Recorded workouts are not affected.', 'Delete', () => Routines.remove(r)) },
        ], r.name);
      },
    });
  }
  row(r, wd) {
    return `<div class="list-row split" data-longpress="rowMenu" data-id="${r.id}">
      <button class="row-main" data-act="open" data-id="${r.id}">${wd ? `<span class="wd">${weekdayName(wd)}</span>` : ''}
        <span class="grow"><span class="block">${esc(r.name)}</span><span class="caption faint">${r.items.length} exercises · ${routineTotalSets(r)} sets${r.reminderEnabled && r.weekday ? ` · ${fmt.reminderTime(r.reminderMinutes)}` : ''}</span></span>${icon.chevron}</button>
      <button class="icon-btn" data-act="rowMenu" data-id="${r.id}" aria-label="Routine options">${icon.more}</button></div>`;
  }
  render() {
    const routines = Q.routines();
    const unscheduled = routines.filter((r) => !r.weekday);
    return `<div class="stack">
      <div class="section-label">Weekly schedule</div>
      <div class="list grouped">${ORDERED_WEEKDAYS.map((wd) => {
        const r = routines.find((x) => x.weekday === wd);
        return r ? this.row(r, wd) : `<div class="list-row"><span class="wd">${weekdayName(wd)}</span><span class="faint">Rest</span></div>`;
      }).join('')}</div>
      ${unscheduled.length ? `<div class="section-label">Templates (unscheduled)</div><div class="list grouped">${unscheduled.map((r) => this.row(r, null)).join('')}</div>` : ''}
      <div class="list grouped">
        <button class="list-row accent" data-act="new">${icon.plus}<span>New routine</span></button>
        <button class="list-row accent" data-act="parser">${icon.text}<span>New routine from text</span></button>
      </div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Routine editor

class RoutineEditorScreen extends Screen {
  constructor(id) {
    super('Routine');
    this.routineId = id;
    this.reorder = false;
    Object.assign(this.actions, {
      item: (el) => { const r = this.routine; const it = r && r.items.find((i) => i.id === el.dataset.id); if (it) presentSheet(new RoutineItemSheet(r, it)); },
      itemMenu: (el) => this.itemMenu(el.dataset.id),
      add: () => { const r = this.routine; if (!r) return; presentSheet(new ExercisePickerSheet('Add exercise', (ex) => {
        const it = { id: uuid(), order: r.items.length ? Math.max(...r.items.map((i) => i.order)) + 1 : 0, exerciseId: ex.id, name: ex.name, sets: 3, repMin: 8, repMax: 12, targetWeight: null };
        r.items.push(it); Routines.save(r);
        setTimeout(() => presentSheet(new RoutineItemSheet(r, it)), 300);
      }), { height: 'large' }); },
      reorder: () => { this.reorder = !this.reorder; nav.refresh(); },
      up: (el) => this.move(el.dataset.id, -1),
      down: (el) => this.move(el.dataset.id, 1),
      replaceDay: () => { const r = this.routine; if (r) nav.push(new ParserImportScreen(r.id)); },
      duplicateDay: () => { const r = this.routine; if (r) presentSheet(new DuplicateDaySheet(r)); },
      delete: () => { const r = this.routine; if (r) confirm(`Delete ${r.name}?`, 'Recorded workouts are not affected.', 'Delete', () => { Routines.remove(r); nav.pop(); }); },
    });
    this.changes = {
      name: (el) => { const r = this.routine; if (!r) return; r.name = el.value.trim() || 'Routine'; Routines.save(r); },
      day: (el) => { const r = this.routine; if (!r) return; const v = Number(el.value); Routines.assign(r, v || null); changed(); },
      reminder: (el) => { const r = this.routine; if (!r) return; r.reminderEnabled = el.checked; Routines.save(r); },
      time: (el) => { const r = this.routine; if (!r) return; r.reminderMinutes = timeInputToMinutes(el.value, r.reminderMinutes); Routines.save(r); },
    };
  }
  get routine() { return Q.routine(this.routineId); }
  move(id, d) {
    const r = this.routine; if (!r) return;
    const items = routineItems(r);
    const i = items.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    items.forEach((x, k) => { x.order = k; });
    r.items = items; Routines.save(r);
  }
  itemMenu(id) {
    const r = this.routine; const it = r && r.items.find((i) => i.id === id); if (!it) return;
    menu([
      { label: 'Replace exercise', icon: 'swap', handler: () => presentSheet(new ExercisePickerSheet(`Replace ${displayName(it)}`, (ex) => { it.exerciseId = ex.id; it.name = ex.name; Routines.save(r); }), { height: 'large' }) },
      { label: 'Duplicate', icon: 'copy', handler: () => {
        for (const e of r.items) if (e.order > it.order) e.order += 1;
        r.items.push({ ...it, id: uuid(), order: it.order + 1 }); Routines.save(r);
      } },
      { label: 'Delete', icon: 'trash', destructive: true, handler: () => { r.items = routineItems(r).filter((x) => x.id !== it.id).map((x, k) => ({ ...x, order: k })); Routines.save(r); } },
    ], displayName(it));
  }
  render() {
    const r = this.routine;
    if (!r) return emptyState('Routine not found', 'It may have been deleted.');
    this.title = r.name || 'Routine';
    const items = routineItems(r);
    return `<div class="stack">
      <div class="section-label">Routine</div>
      <div class="list grouped form">
        <label class="row"><span class="row-label">Name</span><input class="text-input" value="${esc(r.name)}" data-change="name" autocapitalize="words"></label>
        <label class="row"><span class="row-label">Day</span><select class="select" data-change="day">
          <option value="0" ${!r.weekday ? 'selected' : ''}>Unscheduled</option>
          ${ORDERED_WEEKDAYS.map((wd) => `<option value="${wd}" ${r.weekday === wd ? 'selected' : ''}>${weekdayName(wd)}</option>`).join('')}</select></label>
        ${r.weekday ? toggle('Reminder', r.reminderEnabled, 'reminder', 'Delivered through your Calendar — see Profile → Reminders') : ''}
        ${r.weekday && r.reminderEnabled ? `<label class="row"><span class="row-label">Time</span><input type="time" class="time-input" value="${minutesToTimeInput(r.reminderMinutes)}" data-change="time"></label>` : ''}
      </div>
      <div class="row-between section-label-row"><span class="section-label">Exercises · ${routineTotalSets(r)} sets</span>${items.length > 1 ? `<button class="link-btn small" data-act="reorder">${this.reorder ? 'Done' : 'Reorder'}</button>` : ''}</div>
      <div class="list grouped">
        ${items.map((it, k) => `<div class="list-row split" data-longpress="itemMenu" data-id="${it.id}">
          ${this.reorder ? `<div class="reorder-btns"><button class="icon-btn" data-act="up" data-id="${it.id}" ${k === 0 ? 'disabled' : ''}>${icon.up}</button><button class="icon-btn" data-act="down" data-id="${it.id}" ${k === items.length - 1 ? 'disabled' : ''}>${icon.down}</button></div>` : ''}
          <button class="row-main" data-act="item" data-id="${it.id}"><span class="grow"><span class="block">${esc(displayName(it))}</span>${it.targetWeight != null ? `<span class="caption faint">${esc(fmt.kg(it.targetWeight))} planned</span>` : ''}</span><span class="muted num">${esc(fmt.target(it.sets, it.repMin, it.repMax))}</span></button>
          <button class="icon-btn" data-act="itemMenu" data-id="${it.id}" aria-label="Exercise options">${icon.more}</button></div>`).join('')}
        <button class="list-row accent" data-act="add">${icon.plus}<span>Add exercise</span></button>
      </div>
      <div class="caption faint">Changes apply to future workouts only. Recorded workouts never change.</div>
      <div class="section-label">Whole day</div>
      <div class="list grouped">
        <button class="list-row accent" data-act="replaceDay">${icon.text}<span>Replace entire day from text</span></button>
        <button class="list-row accent" data-act="duplicateDay">${icon.copy}<span>Duplicate entire day</span></button>
        <button class="list-row destructive" data-act="delete">${icon.trash}<span>Delete routine</span></button>
      </div>
    </div>`;
  }
}

class RoutineItemSheet extends View {
  constructor(routine, item) {
    super();
    this.routine = routine; this.item = item;
    this.sets = item.sets; this.repMin = item.repMin; this.repMax = item.repMax;
    this.weightText = item.targetWeight != null ? fmt.editable(item.targetWeight) : '';
    this.actions = {
      cancel: () => this.close(),
      done: () => {
        Object.assign(this.item, { sets: this.sets, repMin: Math.min(this.repMin, this.repMax), repMax: Math.max(this.repMin, this.repMax), targetWeight: parseDecimal(this.weightText) });
        Routines.save(this.routine); this.close();
      },
      sets: (el) => { this.sets = Math.min(12, Math.max(1, this.sets + Number(el.dataset.d))); this.refresh(); },
      min: (el) => { this.repMin = Math.min(100, Math.max(1, this.repMin + Number(el.dataset.d))); if (this.repMax < this.repMin) this.repMax = this.repMin; this.refresh(); },
      max: (el) => { this.repMax = Math.min(100, Math.max(1, this.repMax + Number(el.dataset.d))); if (this.repMin > this.repMax) this.repMin = this.repMax; this.refresh(); },
    };
    this.inputs = { weight: (el) => { this.weightText = el.value; } };
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
  render() {
    return `${sheetHeader('Edit exercise', { right: 'Save' })}
      <div class="section-label">${esc(displayName(this.item))}</div>
      <div class="list grouped form">
        ${stepper(`Sets: ${this.sets}`, this.sets, 'sets', 1, 12)}
        ${stepper(`Min reps: ${this.repMin}`, this.repMin, 'min', 1, 100)}
        ${stepper(`Max reps: ${this.repMax}`, this.repMax, 'max', 1, 100)}
        <label class="row"><span class="row-label grow">Planned weight (optional)</span><input class="num-input" inputmode="decimal" placeholder="kg" value="${esc(this.weightText)}" data-input="weight"></label>
      </div>
      <div class="card"><span class="num">Target: ${esc(fmt.target(this.sets, Math.min(this.repMin, this.repMax), Math.max(this.repMin, this.repMax)))}</span></div>`;
  }
}

class DuplicateDaySheet extends View {
  constructor(routine) {
    super();
    this.routine = routine; this.name = `${routine.name} copy`; this.weekday = 0;
    this.actions = {
      cancel: () => this.close(),
      done: () => { Routines.duplicate(this.routine, this.name.trim() || `${this.routine.name} copy`, this.weekday || null); this.close(); toast('Routine duplicated'); },
    };
    this.inputs = { name: (el) => { this.name = el.value; } };
    this.changes = { day: (el) => { this.weekday = Number(el.value); } };
  }
  render() {
    return `${sheetHeader('Duplicate day', { right: 'Duplicate' })}
      <div class="list grouped form">
        <label class="row"><span class="row-label">Name</span><input class="text-input" value="${esc(this.name)}" data-input="name"></label>
        <label class="row"><span class="row-label">Assign to day</span><select class="select" data-change="day">
          <option value="0" ${!this.weekday ? 'selected' : ''}>Unscheduled</option>
          ${ORDERED_WEEKDAYS.map((wd) => `<option value="${wd}" ${this.weekday === wd ? 'selected' : ''}>${weekdayName(wd)}</option>`).join('')}</select></label>
      </div>
      <div class="caption faint">Creates a copy of all ${this.routine.items.length} exercises. Assigning a day replaces any routine already on that day.</div>`;
  }
}

// ---------------------------------------------------------------------------------
// Exercises

class ExerciseListScreen extends Screen {
  constructor() {
    super('Exercises');
    this.search = ''; this.showArchived = false;
    Object.assign(this.actions, {
      new: () => presentSheet(new ExerciseEditorSheet(null)),
      edit: (el) => presentSheet(new ExerciseEditorSheet(el.dataset.id)),
      rowMenu: (el) => {
        const e = Q.exercise(el.dataset.id); if (!e) return;
        menu([
          { label: e.isArchived ? 'Unarchive' : 'Archive', icon: 'list', handler: () => { e.isArchived = !e.isArchived; DB.put('exercises', e); changed(); } },
          { label: 'Delete', icon: 'trash', destructive: true, handler: () => confirm(`Delete ${e.name}?`, 'Recorded workouts keep their history. Routines keep the exercise name. Consider archiving instead.', 'Delete', () => { DB.remove('exercises', e.id); changed(); }) },
        ], e.name);
      },
    });
    this.inputs = { search: (el) => { this.search = el.value; nav.refresh(); } };
    this.changes = { archived: (el) => { this.showArchived = el.checked; nav.refresh(); } };
  }
  navRight() { return `<button class="nav-btn" data-act="new" aria-label="New exercise">${icon.plus}</button>`; }
  render() {
    const all = Q.exercises(true);
    const q = norm(this.search);
    const list = all.filter((e) => (this.showArchived || !e.isArchived) && (!q || norm(e.name).includes(q)));
    return `<div class="stack">
      <div class="search-box">${icon.search}<input type="search" placeholder="Search exercises" value="${esc(this.search)}" data-input="search" autocomplete="off"></div>
      ${all.length ? '' : emptyState('No exercises yet', 'Create the exercises you actually do. There is no built-in library.', 'strength')}
      ${list.length ? `<div class="list grouped">${list.map((e) => {
        const meta = [e.muscleGroup, e.equipment].filter(Boolean).join(' · ');
        return `<div class="list-row split" data-longpress="rowMenu" data-id="${e.id}"><button class="row-main" data-act="edit" data-id="${e.id}"><span class="grow"><span class="block ${e.isArchived ? 'faint' : ''}">${esc(e.name)}</span>${meta ? `<span class="caption faint">${esc(meta)}</span>` : ''}</span>${e.isArchived ? '<span class="caption faint">Archived</span>' : ''}</button>
          <button class="icon-btn" data-act="rowMenu" data-id="${e.id}" aria-label="Exercise options">${icon.more}</button></div>`;
      }).join('')}</div>` : ''}
      <div class="list grouped">${toggle('Show archived', this.showArchived, 'archived')}</div>
    </div>`;
  }
}

class ExerciseEditorSheet extends View {
  constructor(id) {
    super();
    this.exerciseId = id;
    const e = id ? Q.exercise(id) : null;
    this.name = e ? e.name : ''; this.mg = e ? e.muscleGroup : ''; this.eq = e ? e.equipment : '';
    this.inc = e && e.customIncrement != null ? fmt.editable(e.customIncrement) : '';
    this.warning = false;
    this.actions = { cancel: () => this.close(), done: () => this.save() };
    this.inputs = {
      name: (el) => { this.name = el.value; this.refreshHeader(); }, mg: (el) => { this.mg = el.value; },
      eq: (el) => { this.eq = el.value; }, inc: (el) => { this.inc = el.value; },
    };
  }
  refreshHeader() { const b = document.querySelector(`[data-view="${this.id}"] .sheet-header [data-act="done"]`); if (b) b.disabled = !this.name.trim(); }
  save() {
    const name = this.name.trim(); if (!name) return;
    const existing = Q.exerciseNamed(name);
    if (existing && existing.id !== this.exerciseId) { this.warning = true; const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); return; }
    const inc = parseDecimal(this.inc);
    if (this.exerciseId) {
      const e = Q.exercise(this.exerciseId);
      if (e) {
        Object.assign(e, { name, muscleGroup: this.mg.trim(), equipment: this.eq.trim(), customIncrement: inc && inc > 0 ? inc : null });
        const ops = [{ store: 'exercises', put: e }];
        for (const r of Q.routines()) {
          let touched = false;
          for (const it of r.items) if (it.exerciseId === e.id && it.name !== name) { it.name = name; touched = true; }
          if (touched) ops.push({ store: 'routines', put: r });
        }
        DB.batch(ops);
      }
    } else {
      DB.put('exercises', newExercise(name, { muscleGroup: this.mg.trim(), equipment: this.eq.trim(), customIncrement: inc && inc > 0 ? inc : null }));
    }
    changed();
    this.close();
  }
  render() {
    return `${sheetHeader(this.exerciseId ? 'Edit exercise' : 'New exercise', { right: 'Save', rightDisabled: !this.name.trim() })}
      <div class="section-label">Exercise</div>
      <div class="list grouped form"><label class="row"><input class="text-input full" placeholder="Name (e.g. Bench Press)" value="${esc(this.name)}" data-input="name" autocapitalize="words"></label></div>
      <div class="section-label">Optional</div>
      <div class="list grouped form">
        <label class="row"><input class="text-input full" placeholder="Muscle group" value="${esc(this.mg)}" data-input="mg" autocapitalize="words"></label>
        <label class="row"><input class="text-input full" placeholder="Equipment" value="${esc(this.eq)}" data-input="eq" autocapitalize="words"></label>
        <label class="row"><span class="row-label grow">Quick increment override</span><input class="num-input" inputmode="decimal" placeholder="kg" value="${esc(this.inc)}" data-input="inc"></label>
      </div>
      ${this.warning ? '<div class="caption text-partial">An exercise with this name already exists.</div>' : ''}`;
  }
}

// ---------------------------------------------------------------------------------
// Routine from text: paste → deterministic parse → "I understood this as:" → save

export class ParserImportScreen extends Screen {
  constructor(replaceRoutineId = null) {
    super(replaceRoutineId ? 'Replace day from text' : 'Routine from text');
    this.replaceId = replaceRoutineId;
    this.text = ''; this.result = null; this.days = []; this.saved = false;
    Object.assign(this.actions, {
      parse: () => { const r = parseRoutineText(this.text); this.result = r; this.days = r.days; this.saved = false; nav.refresh(); },
      edit: (el) => { const d = this.days[Number(el.dataset.d)]; const ex = d && d.exercises.find((x) => x.id === el.dataset.id); if (ex) presentSheet(new ParsedExerciseSheet(ex, (u) => { Object.assign(ex, u); nav.refresh(); })); },
      exMenu: (el) => { const d = this.days[Number(el.dataset.d)]; if (!d) return; menu([{ label: 'Remove', icon: 'trash', destructive: true, handler: () => { d.exercises = d.exercises.filter((x) => x.id !== el.dataset.id); nav.refresh(); } }]); },
      addEx: (el) => {
        const d = this.days[Number(el.dataset.d)]; if (!d) return;
        const ex = { id: uuid(), name: 'New exercise', sets: 3, repMin: 8, repMax: 12, weight: null, raw: '', isUncertain: false, note: null };
        d.exercises.push(ex); nav.refresh();
        presentSheet(new ParsedExerciseSheet(ex, (u) => { Object.assign(ex, u); nav.refresh(); }));
      },
      save: () => this.save(),
    });
    this.inputs = {
      text: (el) => { this.text = el.value; const b = document.querySelector(`[data-view="${this.id}"] [data-act="parse"]`); if (b) b.disabled = !this.text.trim(); },
      title: (el) => { const d = this.days[Number(el.dataset.d)]; if (d) d.title = el.value; },
    };
    this.changes = { wd: (el) => { const d = this.days[Number(el.dataset.d)]; if (d) { d.weekday = Number(el.value) || null; nav.refresh(); } } };
  }
  save() {
    if (this.replaceId) {
      const r = Q.routine(this.replaceId); if (!r) return;
      const ops = [];
      Routines.replaceItems(r, this.days.flatMap((d) => d.exercises), ops);
      ops.push({ store: 'routines', put: r });
      DB.batch(ops); changed();
      toast('Day replaced');
      nav.pop();
      return;
    }
    const ops = [];
    for (const d of this.days) {
      if (!d.exercises.length) continue;
      const title = d.title.trim() || (d.weekday ? `${weekdayName(d.weekday)} routine` : 'Routine');
      const r = { id: uuid(), name: title, weekday: null, scheduleStart: null, reminderEnabled: false, reminderMinutes: 16 * 60 + 30, createdAt: Date.now() + ops.length, isDemo: DB.demo.active, items: [] };
      Routines.replaceItems(r, d.exercises, ops);
      DB.state.routines.set(r.id, r);
      Routines.assign(r, d.weekday, false);
      ops.push({ store: 'routines', put: r });
    }
    DB.batch(ops); changed();
    this.saved = true; nav.refresh();
  }
  render() {
    const isReplace = !!this.replaceId;
    const conflicts = isReplace || this.saved ? [] : this.days.filter((d) => d.weekday).map((d) => {
      const r = Q.routines().find((x) => x.weekday === d.weekday);
      return r ? `${weekdayName(d.weekday)} currently has “${r.name}” — it will be unscheduled.` : null;
    }).filter(Boolean);
    const review = this.result ? `<div class="headline">I understood this as:</div>
      ${this.days.length ? '' : '<div class="sub text-partial">No exercises recognised. Check the format and try again.</div>'}
      ${this.days.map((d, di) => `<div class="card">
        ${isReplace ? (this.days.length > 1 ? `<div class="label">Day ${di + 1}</div>` : '') : `<div class="row-between"><input class="text-input plain strong grow" placeholder="Routine name" value="${esc(d.title)}" data-input="title" data-d="${di}">
          <select class="select small" data-change="wd" data-d="${di}"><option value="0" ${!d.weekday ? 'selected' : ''}>Unscheduled</option>${ORDERED_WEEKDAYS.map((wd) => `<option value="${wd}" ${d.weekday === wd ? 'selected' : ''}>${weekdayName(wd, true)}</option>`).join('')}</select></div>`}
        ${d.exercises.map((ex) => `<div class="parsed-row" data-longpress="exMenu" data-d="${di}" data-id="${ex.id}"><button class="row-main" data-act="edit" data-d="${di}" data-id="${ex.id}">
          <span class="grow"><span class="block">${esc(ex.name)}</span>${ex.note ? `<span class="caption text-partial">${esc(ex.note)}</span>` : ex.isUncertain ? '<span class="caption text-partial">Please check</span>' : ''}</span>
          <span class="right"><span class="block muted num">${esc(fmt.target(ex.sets, ex.repMin, ex.repMax))}</span>${ex.weight != null ? `<span class="caption faint">${esc(fmt.kg(ex.weight))}</span>` : ''}</span>${icon.pencil}</button>
          <button class="icon-btn" data-act="exMenu" data-d="${di}" data-id="${ex.id}" aria-label="Options">${icon.more}</button></div>`).join('')}
        <button class="link-btn left small" data-act="addEx" data-d="${di}">${icon.plus} Add exercise</button>
      </div>`).join('')}
      ${this.result.unparsedLines.length ? `<div class="card"><div class="sub strong text-missed">Not understood (ignored):</div>${this.result.unparsedLines.map((l) => `<div class="caption mono muted">${esc(l)}</div>`).join('')}</div>` : ''}
      ${conflicts.length ? `<div class="caption text-partial">${conflicts.map(esc).join('<br>')}</div>` : ''}
      ${this.saved ? `<div class="sub text-completed">✓ Saved</div>` : `<button class="btn primary" data-act="save" ${!this.days.length || this.days.every((d) => !d.exercises.length) ? 'disabled' : ''}>${isReplace ? 'REPLACE DAY' : this.days.length > 1 ? `SAVE ${this.days.length} ROUTINES` : 'SAVE ROUTINE'}</button>`}` : '';
    return `<div class="stack">
      <div class="section-label">Paste or type</div>
      <textarea class="textarea mono" rows="7" placeholder="Tuesday\nBench Press 3x6-8\nRow 3x8-10" data-input="text" autocapitalize="sentences">${esc(this.text)}</textarea>
      <div class="caption faint">Formats: “Bench Press 3x6-8”, “Bench Press — 3 sets — 6 to 8 reps”, “3x10 Lateral Raise”. First number = sets, second = reps. Weekday lines (“Tuesday”) start a new day.</div>
      <button class="btn secondary" data-act="parse" ${this.text.trim() ? '' : 'disabled'}>Parse</button>
      ${review}
    </div>`;
  }
}

class ParsedExerciseSheet extends View {
  constructor(ex, onSave) {
    super();
    this.ex = ex; this.onSave = onSave;
    this.name = ex.name; this.sets = ex.sets; this.repMin = ex.repMin; this.repMax = ex.repMax;
    this.weightText = ex.weight != null ? fmt.editable(ex.weight) : '';
    this.actions = {
      cancel: () => this.close(),
      done: () => {
        if (!this.name.trim()) return;
        this.onSave({ name: cleanName(this.name), sets: this.sets, repMin: Math.min(this.repMin, this.repMax), repMax: Math.max(this.repMin, this.repMax), weight: parseDecimal(this.weightText), isUncertain: false, note: null });
        this.close();
      },
      sets: (el) => { this.sets = Math.min(12, Math.max(1, this.sets + Number(el.dataset.d))); this.refresh(); },
      min: (el) => { this.repMin = Math.min(100, Math.max(1, this.repMin + Number(el.dataset.d))); if (this.repMax < this.repMin) this.repMax = this.repMin; this.refresh(); },
      max: (el) => { this.repMax = Math.min(100, Math.max(1, this.repMax + Number(el.dataset.d))); if (this.repMin > this.repMax) this.repMin = this.repMax; this.refresh(); },
    };
    this.inputs = { name: (el) => { this.name = el.value; }, weight: (el) => { this.weightText = el.value; } };
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
  render() {
    return `${sheetHeader('Correct exercise', { right: 'Save' })}
      <div class="list grouped form">
        <label class="row"><input class="text-input full" placeholder="Exercise name" value="${esc(this.name)}" data-input="name" autocapitalize="words"></label>
        ${stepper(`Sets: ${this.sets}`, this.sets, 'sets', 1, 12)}
        ${stepper(`Min reps: ${this.repMin}`, this.repMin, 'min', 1, 100)}
        ${stepper(`Max reps: ${this.repMax}`, this.repMax, 'max', 1, 100)}
        <label class="row"><span class="row-label grow">Planned weight (optional)</span><input class="num-input" inputmode="decimal" placeholder="kg" value="${esc(this.weightText)}" data-input="weight"></label>
      </div>
      ${this.ex.raw ? `<div class="caption mono faint">From: ${esc(this.ex.raw)}</div>` : ''}`;
  }
}

export { RoutineListScreen, RoutineEditorScreen, ExerciseListScreen };
