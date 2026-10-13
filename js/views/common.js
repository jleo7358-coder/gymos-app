// Pieces shared by several tabs: session detail, exercise detail, exercise picker,
// extra-workout picker, set rows and session cards.

import * as DB from '../db.js';
import {
  Q, S, Engine, Stats, Rest, changed, orderedSets, exVolume, routineItems, routineTotalSets, durationText, newExercise, setSummary,
} from '../engine.js';
import { nav, Screen } from '../nav.js';
import {
  View, icon, pill, statTile, emptyState, sheetHeader, menu, confirm, presentSheet, dismissAll,
  WeightKeypad, RepsPicker, lineChart, trendBadge, patch,
} from '../ui.js';
import { esc, fmt, norm, todayKey } from '../util.js';
import { unlock, scheduleChime } from '../sound.js';

export { esc };

export function statusPill(kind, text) { return pill(text, kind); }

export function sessionCard(s, tag, cls) {
  const names = S.orderedExercises(s).map((e) => e.name).join(' · ');
  return `<button class="card card-btn" data-act="openSession" data-id="${s.id}">
    <div class="row-between"><div class="row-left"><span class="tag ${cls}">${esc(tag)}</span><span class="headline">${esc(s.routineName)}</span></div>${icon.chevron}</div>
    <div class="meta">${S.completedSets(s)}/${S.totalSets(s)} sets · ${s.status === 'active' ? 'in progress' : durationText(s)} · ${fmt.integer(S.volume(s))} kg vol</div>
    ${names ? `<div class="meta faint clamp2">${esc(names)}</div>` : ''}
  </button>`;
}

export function setRow(set, seId, { allowLongPress = true } = {}) {
  return `<div class="set-row ${set.done ? 'done' : ''}" ${allowLongPress ? `data-longpress="setMenu" data-set="${set.id}" data-se="${seId}"` : ''}>
    <span class="set-idx">${set.index + 1}</span>
    <button class="set-field" data-act="weight" data-set="${set.id}" data-se="${seId}">${set.weight > 0 ? esc(fmt.kg(set.weight)) : '— kg'}</button>
    <button class="set-field" data-act="reps" data-set="${set.id}" data-se="${seId}">${set.reps > 0 ? `${set.reps} reps` : '— reps'}</button>
    <button class="set-check ${set.done ? 'on' : ''}" data-act="toggleSet" data-set="${set.id}" data-se="${seId}" aria-label="${set.done ? 'Mark not done' : 'Mark done'}">${set.done ? icon.check : icon.circle}</button>
  </div>`;
}

export function findSet(session, seId, setId) {
  const se = session.exercises.find((e) => e.id === seId);
  const set = se && se.sets.find((x) => x.id === setId);
  return { se, set };
}

/** Shared set-editing actions (used by the active workout and the session detail screen). */
export function installSetActions(view, getSession, { completeAfterReps = true, applyToRemaining = true } = {}) {
  const get = (el) => { const s = getSession(); if (!s) return {}; return { s, ...findSet(s, el.dataset.se, el.dataset.set) }; };
  const openReps = (s, se, set, complete) => {
    presentSheet(new RepsPicker({
      initial: set.reps, target: [Math.min(se.repMin, se.repMax) || 1, Math.max(se.repMin, se.repMax) || 12],
      onDone: (reps) => { Engine.updateSet(s, set, { reps }); if (complete && reps > 0) Engine.complete(s, set); },
    }));
  };
  view.actions.weight = (el) => {
    const { s, se, set } = get(el); if (!set) return;
    const ex = Q.exercise(se.exerciseId);
    presentSheet(new WeightKeypad({
      initial: set.weight, override: applyToRemaining && ex ? ex.customIncrement : null, showApply: applyToRemaining,
      onDone: (v, apply) => { if (apply) Engine.applyWeightToRemaining(s, se, set, v); else Engine.updateSet(s, set, { weight: v }); },
    }));
  };
  view.actions.reps = (el) => { const { s, se, set } = get(el); if (set) openReps(s, se, set, false); };
  view.actions.toggleSet = (el) => {
    const { s, se, set } = get(el); if (!set) return;
    if (set.done) Engine.uncomplete(s, set);
    else if (set.reps <= 0 && completeAfterReps) openReps(s, se, set, true);
    else Engine.complete(s, set);
  };
  view.actions.setMenu = (el) => {
    const { s, se, set } = get(el); if (!set) return;
    menu([{ label: 'Remove set', icon: 'trash', destructive: true, handler: () => Engine.removeSet(s, se, set.id) }], `Set ${set.index + 1}`);
  };
}

export function startRest(seconds) {
  unlock();
  Rest.start(seconds);
  if (DB.settings().restAlertEnabled) scheduleChime(Rest.raw.end);
}

// ---------------------------------------------------------------------------------
// Session detail (recorded workout; sets can still be corrected)

export class SessionDetailScreen extends Screen {
  constructor(sessionId) {
    super('Workout');
    this.sessionId = sessionId;
    installSetActions(this, () => this.session, { completeAfterReps: false, applyToRemaining: false });
    this.actions.more = () => menu([{ label: 'Delete workout', icon: 'trash', destructive: true, handler: () => this.confirmDelete() }]);
    this.actions.addSet = (el) => { const s = this.session; const se = s && s.exercises.find((e) => e.id === el.dataset.se); if (se) Engine.addSet(s, se); };
  }
  get session() { return Q.session(this.sessionId); }
  confirmDelete() {
    confirm('Delete this workout?', 'This permanently removes the recorded sets. Backups are not affected.', 'Delete', () => {
      const s = this.session; if (s) Engine.discard(s); nav.pop();
    });
  }
  navRight() { return this.session ? `<button class="nav-btn" data-act="more" aria-label="More">${icon.more}</button>` : ''; }
  render() {
    const s = this.session;
    if (!s) return emptyState('Workout not found', 'It may have been deleted.');
    this.title = s.routineName;
    const prs = Q.prs().filter((p) => p.sessionId === s.id);
    const st = s.isExtra ? ['EXTRA', 'extra'] : S.effectiveStatus(s) === 'completed' ? ['COMPLETED', 'completed'] : S.effectiveStatus(s) === 'active' ? ['IN PROGRESS', 'active'] : ['PARTIAL', 'partial'];
    return `<div class="stack">
      <div class="row-between"><span class="sub muted">${esc(fmt.fullDate(s.day))}</span>${pill(st[0], st[1])}</div>
      <div class="tiles">${statTile('Sets', `${S.completedSets(s)}/${S.totalSets(s)}`)}${statTile('Duration', durationText(s))}${statTile('Volume', fmt.integer(S.volume(s)), 'kg')}</div>
      <div class="caption faint">Started ${esc(fmt.time(s.startDate))}${s.endDate && !s.noDuration ? ` · finished ${esc(fmt.time(s.endDate))}` : ''}</div>
      ${prs.length ? `<div class="card"><div class="tag completed">NEW BEST</div>${prs.map((p) => `<div class="row-between"><span class="sub">${esc(p.name)}</span><span class="sub strong num">${esc(setSummary(p.weight, p.reps))}</span></div>`).join('')}</div>` : ''}
      ${S.orderedExercises(s).map((se) => `<div class="card">
        <div class="row-between"><span class="ex-name">${esc(se.name)}</span><span class="caption faint num">${esc(fmt.target(se.targetSets, se.repMin, se.repMax))}</span></div>
        <div class="sets">${orderedSets(se).map((x) => setRow(x, se.id)).join('')}</div>
        <div class="row-between"><span class="caption muted num">Volume ${fmt.integer(exVolume(se))} kg</span><button class="link-btn small" data-act="addSet" data-se="${se.id}">${icon.plus} Add set</button></div>
      </div>`).join('')}
      <div class="caption faint">Tap a weight or rep value to correct it. Long-press a set to remove it. Corrections are saved immediately.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Exercise detail (best, last, frequency, trend, progression, charts, history)

export class ExerciseDetailScreen extends Screen {
  constructor(exerciseId, name) { super(name); this.exerciseId = exerciseId; this.name = name; }
  render() {
    const st = Stats.stats(this.exerciseId, this.name);
    const prs = Q.prs().filter((p) => (this.exerciseId ? p.exerciseId === this.exerciseId : false) || norm(p.name) === norm(this.name));
    return `<div class="stack">
      <div class="tiles">${statTile('Best', st.best ? st.best.bestSummary : '—')}${statTile('Last', st.last ? st.last.bestSummary : '—', st.last ? fmt.dayMonth(st.last.date) : null)}</div>
      <div class="tiles">${statTile('Sessions', String(st.sessionCount))}${statTile('Per week', fmt.number(st.perWeek, 1))}${statTile('Best volume', st.bestVolume ? fmt.integer(st.bestVolume.volume) : '—', 'kg')}</div>
      <div class="card"><div class="row-between"><span class="sub strong">Trend</span>${trendBadge(st.trend, true)}</div>
        <div class="sub ${st.progression.stalled ? 'text-missed' : 'muted'}">${esc(st.progression.message)}</div>
        ${st.progression.stalled ? '<div class="caption faint">Informational only — your routine is never changed automatically.</div>' : ''}</div>
      <div class="card"><div class="sub strong">Best weight over time</div>${lineChart(st.weightPoints, { unit: 'kg', decimals: 1 })}</div>
      <div class="card"><div class="sub strong">Volume per session</div>${lineChart(st.volumePoints, { unit: 'kg', decimals: 0 })}</div>
      ${prs.length ? `<div class="card"><div class="sub strong">Personal records</div>${prs.map((p) => `<div class="row-between"><span class="caption faint">${esc(fmt.dayMonthYear(p.date))}</span><span class="sub num">${esc(setSummary(p.prevWeight, p.prevReps))} → ${esc(setSummary(p.weight, p.reps))}</span></div>`).join('')}</div>` : ''}
      <div class="card"><div class="sub strong">History</div>
        ${st.history.length ? '' : '<div class="caption faint">No recorded sets yet.</div>'}
        ${st.history.map((p) => `<div class="hist-row"><div class="row-between"><span class="caption muted">${esc(fmt.weekdayDayMonth(p.date))}</span><span class="sub strong num">${esc(p.bestSummary)}</span></div>
          <div class="row-between"><span class="caption faint num">${esc(p.setsSummary)}</span><span class="caption faint num">${fmt.integer(p.volume)} kg</span></div></div>`).join('')}
      </div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Exercise picker (choose existing or create)

export class ExercisePickerSheet extends View {
  constructor(title, onPick) {
    super();
    this.title = title; this.onPick = onPick; this.search = '';
    this.actions = {
      cancel: () => this.close(),
      done: () => {},
      pick: (el) => { const ex = Q.exercise(el.dataset.id); this.close(); if (ex) this.onPick(ex); },
      create: () => {
        const name = this.search.trim(); if (!name) return;
        const e = newExercise(name); DB.put('exercises', e); changed(); this.close(); this.onPick(e);
      },
    };
    this.inputs = { search: (el) => { this.search = el.value; this.refresh(); } };
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
  mounted(root) { setTimeout(() => root.querySelector('input')?.focus(), 350); }
  render() {
    const q = norm(this.search);
    const all = Q.exercises();
    const list = q ? all.filter((e) => norm(e.name).includes(q)) : all;
    const t = this.search.trim();
    const canCreate = t && !Q.exerciseNamed(t);
    return `${sheetHeader(this.title, { right: null })}
      <div class="search-box">${icon.search}<input type="search" placeholder="Search or type a new name" value="${esc(this.search)}" data-input="search" autocomplete="off" autocapitalize="words"></div>
      <div class="list">
        ${canCreate ? `<button class="list-row accent" data-act="create">${icon.plus}<span>Create “${esc(t)}”</span></button>` : ''}
        ${list.map((e) => `<button class="list-row" data-act="pick" data-id="${e.id}"><span class="grow">${esc(e.name)}</span>${e.muscleGroup ? `<span class="caption faint">${esc(e.muscleGroup)}</span>` : ''}</button>`).join('')}
        ${!all.length && !canCreate ? '<div class="caption faint pad">Type a name above to create your first exercise.</div>' : ''}
      </div>`;
  }
}

// ---------------------------------------------------------------------------------
// Extra workout picker

export class ExtraPickerSheet extends View {
  constructor(day) {
    super();
    this.day = day;
    this.actions = {
      cancel: () => this.close(), done: () => {},
      empty: () => this.start(null, 'Extra workout'),
      routine: (el) => this.start(Q.routine(el.dataset.id), null),
    };
  }
  start(routine, name) {
    if (Engine.active) return;
    Engine.startExtra(routine, name, this.day);
    dismissAll();
    nav.switchTab('workout', true);
  }
  render() {
    const routines = Q.routines();
    return `${sheetHeader('Extra workout', { right: null })}
      <div class="list"><button class="list-row" data-act="empty">${icon.plus}<span>Empty workout (add exercises as you go)</span></button></div>
      ${routines.length ? `<div class="section-label">From a routine</div><div class="list">${routines.map((r) => `<button class="list-row" data-act="routine" data-id="${r.id}"><span class="grow">${esc(r.name)}</span><span class="caption faint">${r.items.length} ex · ${routineTotalSets(r)} sets</span></button>`).join('')}</div>` : ''}`;
  }
}

export function openSessionFromSheet(id) { dismissAll(); nav.push(new SessionDetailScreen(id)); }

export { Q, S, Engine, Stats, Rest, routineItems, routineTotalSets, durationText, todayKey, fmt, icon, pill, statTile, emptyState, menu, confirm, presentSheet };
