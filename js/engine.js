// Domain logic: queries, workout engine, rest timer, stats, PR detection, calendar.
// A direct port of the iPhone app's engines so behaviour stays identical.

import * as DB from './db.js';
import { state } from './db.js';
import {
  uuid, dayKey, todayKey, parseDay, weekday, daysBetween, startOfWeek, addDays, norm, fmt, sum, maxBy, daysInRange,
} from './util.js';

// ---------------------------------------------------------------------------------
// Change notification

export const bus = new EventTarget();
let changeCounter = 0;
export function changed() {
  changeCounter++;
  bus.dispatchEvent(new Event('change'));
}
export const counter = () => changeCounter;

// ---------------------------------------------------------------------------------
// Record helpers

export const sessionHelpers = {
  orderedExercises: (s) => [...s.exercises].sort((a, b) => a.order - b.order),
  totalSets: (s) => sum(s.exercises, (e) => e.sets.length),
  completedSets: (s) => sum(s.exercises, (e) => e.sets.filter((x) => x.done).length),
  isFullyCompleted(s) { const t = this.totalSets(s); return t > 0 && this.completedSets(s) === t; },
  volume: (s) => sum(s.exercises, exVolume),
  duration: (s, now = Date.now()) => Math.max(0, ((s.endDate ?? now) - s.startDate) / 1000),
  effectiveStatus: (s) => (s.status === 'active' && s.day < todayKey() ? 'partial' : s.status),
};
export const S = sessionHelpers;
export function durationText(s, now = Date.now()) { return s.noDuration ? '—' : fmt.duration(S.duration(s, now)); }

export const orderedSets = (e) => [...e.sets].sort((a, b) => a.index - b.index);
export const exCompleted = (e) => e.sets.filter((x) => x.done);
export function exVolume(e) { return sum(exCompleted(e), (x) => x.weight * x.reps); }
export function bestSet(e) {
  return maxBy(exCompleted(e), (a, b) => (a.weight !== b.weight ? a.weight > b.weight : a.reps > b.reps));
}
export const routineItems = (r) => [...r.items].sort((a, b) => a.order - b.order);
export const routineTotalSets = (r) => sum(r.items, (i) => i.sets);
export const setSummary = (w, r) => `${fmt.kg(w)} × ${r}`;

// ---------------------------------------------------------------------------------
// Queries

export const Q = {
  exercises(includeArchived = false) {
    return [...state.exercises.values()].filter((e) => includeArchived || !e.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  exercise: (id) => (id ? state.exercises.get(id) : undefined),
  exerciseNamed(name) {
    const t = norm(name);
    return [...state.exercises.values()].find((e) => norm(e.name) === t);
  },
  routines: () => [...state.routines.values()].sort((a, b) => a.createdAt - b.createdAt),
  routine: (id) => (id ? state.routines.get(id) : undefined),
  activeSession() {
    return [...state.sessions.values()].filter((s) => s.status === 'active').sort((a, b) => b.startDate - a.startDate)[0];
  },
  sessionsInRange(fromKey, toKey) {
    return [...state.sessions.values()].filter((s) => s.day >= fromKey && s.day <= toKey).sort((a, b) => a.startDate - b.startDate);
  },
  sessionsOn: (key) => Q.sessionsInRange(key, key),
  sessions(newestFirst = true) {
    return [...state.sessions.values()].sort((a, b) => (newestFirst ? b.startDate - a.startDate : a.startDate - b.startDate));
  },
  session: (id) => state.sessions.get(id),
  bodyStats(newestFirst = true) {
    return [...state.bodyStats.values()].sort((a, b) => (newestFirst ? b.date - a.date : a.date - b.date));
  },
  prs: () => [...state.prs.values()].sort((a, b) => b.date - a.date),
};

// ---------------------------------------------------------------------------------
// Performances & stats

/** One recorded performance of an exercise in a session (completed sets with reps only). */
export function performance(se, session) {
  if (!(session.status !== 'active' || S.completedSets(session) > 0)) return null;
  const completed = orderedSets(se).filter((x) => x.done && x.reps > 0);
  if (!completed.length) return null;
  const best = maxBy(completed, (a, b) => (a.weight !== b.weight ? a.weight > b.weight : a.reps > b.reps));
  const p = {
    id: se.id, sessionId: session.id, date: session.startDate, name: se.name,
    sets: completed.map((x) => ({ weight: x.weight, reps: x.reps })),
    bestWeight: best.weight, bestReps: best.reps,
    volume: sum(completed, (x) => x.weight * x.reps),
    targetSets: se.targetSets, repMin: se.repMin, repMax: se.repMax,
  };
  p.score = p.bestWeight * (1 + p.bestReps / 30);
  p.bestSummary = setSummary(p.bestWeight, p.bestReps);
  p.setsSummary = p.sets.map((x) => `${fmt.number(x.weight, 2)}×${x.reps}`).join('  ');
  return p;
}

function sessionExercisesFor(exerciseId, name) {
  const all = [];
  for (const s of state.sessions.values()) for (const e of s.exercises) all.push([e, s]);
  let items = exerciseId ? all.filter(([e]) => e.exerciseId === exerciseId) : [];
  if (!items.length) { const t = norm(name); items = all.filter(([e]) => norm(e.name) === t); }
  return items;
}

export const Stats = {
  /** Newest first. Matches by id, falls back to name. */
  history(exerciseId, name) {
    return sessionExercisesFor(exerciseId, name).map(([e, s]) => performance(e, s)).filter(Boolean).sort((a, b) => b.date - a.date);
  },
  lastPerformance(exerciseId, name, beforeMs, excludingSessionId) {
    return this.history(exerciseId, name).find((p) => p.date < beforeMs && p.sessionId !== excludingSessionId);
  },
  trend(values, minimumMeaningfulPercent = 2.5) {
    if (values.length < 2) return { dir: 'neutral', text: 'Insufficient data' };
    const latest = values[values.length - 1];
    const prev = values.slice(0, -1).slice(-3);
    const baseline = sum(prev) / prev.length;
    if (!(baseline > 0)) return { dir: 'neutral', text: 'Insufficient data' };
    const pct = ((latest - baseline) / baseline) * 100;
    if (Math.abs(pct) < minimumMeaningfulPercent) return { dir: 'neutral', text: 'Unchanged vs recent' };
    return { dir: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '+' : ''}${fmt.number(pct, 1)}% vs recent` };
  },
  progression(chrono) {
    const insufficient = { kind: 'insufficient', message: 'Not enough history yet.', stalled: false };
    if (chrono.length < 4) return insufficient;
    const first = chrono[0], last = chrono[chrono.length - 1];
    if (daysBetween(dayKey(first.date), dayKey(last.date)) < 21) return insufficient;
    const recent = chrono.slice(-3), earlier = chrono.slice(0, -3);
    const recentBest = Math.max(...recent.map((p) => p.score));
    const earlierBest = Math.max(...earlier.map((p) => p.score));
    if (!(earlierBest > 0)) return insufficient;
    const pct = ((recentBest - earlierBest) / earlierBest) * 100;
    if (pct >= 5) return { kind: 'progressing', stalled: false, message: `Progressing: +${fmt.number(pct, 1)}% over recent sessions.` };
    if (pct >= 2) return { kind: 'slow', stalled: false, message: `Slow progress: +${fmt.number(pct, 1)}% recently.` };
    const peak = maxBy(chrono, (a, b) => a.score > b.score);
    const weeks = Math.max(3, Math.floor(daysBetween(dayKey(peak ? peak.date : first.date), dayKey(last.date)) / 7));
    return { kind: 'stalled', stalled: true, message: `No meaningful progress in ${weeks} weeks. This needs to be worked on.` };
  },
  stats(exerciseId, name) {
    const hist = this.history(exerciseId, name);
    const best = maxBy(hist, (a, b) => (a.bestWeight !== b.bestWeight ? a.bestWeight > b.bestWeight : a.bestReps > b.bestReps));
    const bestVolume = maxBy(hist, (a, b) => a.volume > b.volume);
    const chrono = [...hist].reverse();
    let perWeek = 0;
    if (hist.length > 1) {
      const days = Math.max(7, daysBetween(dayKey(chrono[0].date), dayKey(chrono[chrono.length - 1].date)) + 1);
      perWeek = hist.length / (days / 7);
    } else if (hist.length === 1) perWeek = 1;
    const trend = this.trend(chrono.map((p) => p.score));
    return {
      history: hist, last: hist[0], best, bestVolume, sessionCount: hist.length, perWeek, trend,
      progression: this.progression(chrono),
      weightPoints: chrono.map((p) => ({ date: p.date, value: p.bestWeight })),
      volumePoints: chrono.map((p) => ({ date: p.date, value: p.volume })),
    };
  },
  weekSummary(date) {
    const start = startOfWeek(date);
    const end = addDays(start, 6);
    const sessions = Q.sessionsInRange(dayKey(start), dayKey(end)).filter((s) => s.status !== 'active');
    const lifts = new Map();
    for (const s of sessions) for (const e of s.exercises) {
      const b = bestSet(e);
      if (!b) continue;
      const cur = lifts.get(e.name);
      if (!cur || b.weight > cur.weight || (b.weight === cur.weight && b.reps > cur.reps)) lifts.set(e.name, { weight: b.weight, reps: b.reps });
    }
    const top = [...lifts.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.weight - a.weight).slice(0, 5);
    return {
      weekStart: start, sessions: sessions.length,
      completedSessions: sessions.filter((s) => s.status === 'completed').length,
      sets: sum(sessions, (s) => S.completedSets(s)),
      volume: sum(sessions, (s) => S.volume(s)),
      duration: sum(sessions, (s) => S.duration(s)),
      topLifts: top,
    };
  },
};

// ---------------------------------------------------------------------------------
// PR detection (exercise-specific thresholds)

export const PR = {
  minimumHistory: 2,
  percentThreshold: 0.04,
  evaluate(newWeight, newReps, history, exerciseId, name) {
    if (history.length < this.minimumHistory) return null;
    const prevBestWeight = Math.max(...history.map((h) => h.bestWeight));
    if (!(prevBestWeight > 0)) return null;
    const prevBestReps = Math.max(0, ...history.filter((h) => Math.abs(h.bestWeight - prevBestWeight) < 0.01).map((h) => h.bestReps));
    const chrono = [...history].sort((a, b) => a.date - b.date).map((h) => h.bestWeight);
    const diffs = [];
    for (let i = 1; i < chrono.length; i++) if (chrono[i] > chrono[i - 1]) diffs.push(chrono[i] - chrono[i - 1]);
    let typicalJump;
    if (!diffs.length) typicalJump = Math.max(1, prevBestWeight * 0.05);
    else { const sorted = [...diffs].sort((a, b) => a - b); typicalJump = Math.max(1, sorted[Math.floor(sorted.length / 2)]); }

    if (newWeight > prevBestWeight + 0.01) {
      const gain = newWeight - prevBestWeight;
      const required = Math.max(typicalJump, prevBestWeight * this.percentThreshold) - 0.001;
      const repsAcceptable = newReps >= Math.max(1, prevBestReps - 2);
      if (gain >= required && repsAcceptable) {
        return { exerciseId, name, weight: newWeight, reps: newReps, prevWeight: prevBestWeight, prevReps: prevBestReps, kind: 'weight' };
      }
      return null;
    }
    if (Math.abs(newWeight - prevBestWeight) < 0.01 && newReps > prevBestReps) {
      const gain = newReps - prevBestReps;
      const required = Math.max(2, Math.ceil(prevBestReps * 0.2));
      if (gain >= required) {
        return { exerciseId, name, weight: newWeight, reps: newReps, prevWeight: prevBestWeight, prevReps: prevBestReps, kind: 'reps' };
      }
    }
    return null;
  },
  /** Evaluate a finished session; returns the PR records to store (not yet saved). */
  detect(session) {
    const out = [];
    const existing = Q.prs();
    for (const se of S.orderedExercises(session)) {
      const best = bestSet(se);
      if (!best || best.reps <= 0) continue;
      const history = Stats.history(se.exerciseId, se.name).filter((h) => h.sessionId !== session.id && h.date <= session.startDate);
      const c = this.evaluate(best.weight, best.reps, history, se.exerciseId, se.name);
      if (!c) continue;
      if (existing.some((p) => p.sessionId === session.id && p.name === se.name)) continue;
      out.push({
        id: uuid(), exerciseId: c.exerciseId || null, name: c.name, date: session.startDate,
        weight: c.weight, reps: c.reps, prevWeight: c.prevWeight, prevReps: c.prevReps,
        sessionId: session.id, kind: c.kind, isDemo: !!session.isDemo,
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------
// Calendar

export const DAY_KIND = {
  rest: { label: 'REST', cls: 'rest' },
  planned: { label: 'PLANNED', cls: 'planned' },
  active: { label: 'IN PROGRESS', cls: 'active' },
  completed: { label: 'COMPLETED', cls: 'completed' },
  partial: { label: 'PARTIAL', cls: 'partial' },
  missed: { label: 'MISSED', cls: 'missed' },
};

export const Calendar = {
  routineFor(key, routines = Q.routines()) {
    const wd = weekday(key);
    return routines.find((r) => r.weekday === wd && !(r.scheduleStart && r.scheduleStart > key));
  },
  rank(s) { const st = S.effectiveStatus(s); return st === 'completed' ? 3 : st === 'partial' ? 2 : 1; },
  info(key, routines = Q.routines(), sessions = Q.sessionsOn(key)) {
    const today = todayKey();
    const routine = this.routineFor(key, routines);
    const scheduled = sessions.filter((s) => !s.isExtra);
    const extras = sessions.filter((s) => s.isExtra);
    const best = maxBy(scheduled, (a, b) => this.rank(a) > this.rank(b));
    let kind;
    if (best) {
      const st = S.effectiveStatus(best);
      kind = st === 'completed' ? 'completed' : st === 'partial' ? 'partial' : 'active';
    } else if (routine) kind = key < today ? 'missed' : 'planned';
    else kind = 'rest';
    const title = kind === 'rest' ? (extras.length ? '' : 'REST')
      : (kind === 'planned' || kind === 'missed') ? (routine?.name ?? best?.routineName ?? '')
        : (best?.routineName ?? routine?.name ?? '');
    return { key, kind, routine, session: best, extras, title };
  },
  infos(fromKey, toKey) {
    const routines = Q.routines();
    const sessions = Q.sessionsInRange(fromKey, toKey);
    const byDay = new Map();
    for (const s of sessions) { if (!byDay.has(s.day)) byDay.set(s.day, []); byDay.get(s.day).push(s); }
    const out = new Map();
    for (const k of daysInRange(fromKey, toKey)) out.set(k, this.info(k, routines, byDay.get(k) || []));
    return out;
  },
};

// ---------------------------------------------------------------------------------
// Rest timer: absolute dates, survives relaunch. Never auto-starts.

export const Rest = {
  get raw() { return DB.getKV('rest', null); },
  get isActive() { return !!(this.raw && this.raw.end); },
  remaining(now = Date.now()) { const r = this.raw; return r && r.end ? Math.max(0, (r.end - now) / 1000) : 0; },
  isFinished(now = Date.now()) { const r = this.raw; return !!(r && r.end && now >= r.end); },
  start(seconds) {
    const secs = Math.max(5, seconds ?? DB.settings().defaultRestSeconds);
    const now = Date.now();
    DB.setKV('rest', { start: now, end: now + secs * 1000, duration: secs, alerted: false });
    bus.dispatchEvent(new CustomEvent('rest', { detail: 'start' }));
    changed();
  },
  add(seconds) {
    const r = this.raw;
    if (!r || !r.end) return;
    const end = Math.max(Date.now(), r.end) + seconds * 1000;
    DB.setKV('rest', { ...r, end, duration: r.duration + seconds, alerted: false });
    bus.dispatchEvent(new CustomEvent('rest', { detail: 'add' }));
    changed();
  },
  stop() {
    if (!this.raw) return;
    DB.setKV('rest', null);
    bus.dispatchEvent(new CustomEvent('rest', { detail: 'stop' }));
    changed();
  },
  markAlerted() { const r = this.raw; if (r) DB.setKV('rest', { ...r, alerted: true }); },
  clearIfExpired(graceSeconds = 10) {
    const r = this.raw;
    if (r && r.end && (Date.now() - r.end) / 1000 > graceSeconds) this.stop();
  },
};

// ---------------------------------------------------------------------------------
// Workout engine. Every mutation is saved immediately.

const saveSession = (s) => DB.put('sessions', s);

export const Engine = {
  activeId: null,
  pendingRecoveryId: null,
  recentPRs: [],

  get active() { return this.activeId ? Q.session(this.activeId) : undefined; },
  get pendingRecovery() { return this.pendingRecoveryId ? Q.session(this.pendingRecoveryId) : undefined; },

  loadOnLaunch() {
    const s = Q.activeSession();
    if (!s) return;
    const age = Date.now() - s.startDate;
    if (s.day === todayKey() || age < 12 * 3600 * 1000) {
      // iOS often reloads web apps after a short trip to another app. If the workout was
      // touched recently, carry on silently; otherwise ask, like the iPhone app does.
      const lastActive = DB.getKV('lastActive', 0);
      if (Date.now() - lastActive < 45 * 60 * 1000) this.activeId = s.id;
      else this.pendingRecoveryId = s.id;
    } else {
      s.status = 'partial';
      const doneTimes = s.exercises.flatMap((e) => e.sets).map((x) => x.doneAt).filter(Boolean);
      s.endDate = doneTimes.length ? Math.max(...doneTimes) : s.startDate;
      saveSession(s);
      DB.setKV('rest', null);
    }
  },
  resumeRecovered() { const s = this.pendingRecovery; this.pendingRecoveryId = null; if (s) this.activeId = s.id; changed(); },
  finishRecovered() { const s = this.pendingRecovery; this.pendingRecoveryId = null; if (s) { this.activeId = s.id; this.finish(s); } },
  discardRecovered() { const s = this.pendingRecovery; this.pendingRecoveryId = null; if (s) this.discard(s); else changed(); },

  newSession({ day, routine, name, isExtra }) {
    return {
      id: uuid(), startDate: Date.now(), endDate: null, day,
      routineId: routine ? routine.id : null,
      routineName: name || (routine ? routine.name : 'Extra workout'),
      status: 'active', isExtra, isDemo: DB.demo.active, exercises: [],
    };
  },
  startPlanned(routine, day = todayKey()) {
    const s = this.newSession({ day, routine, isExtra: false });
    this.populate(s, routine);
    return this.begin(s);
  },
  startExtra(routine, name, day = todayKey()) {
    const s = this.newSession({ day, routine, name: name || (routine ? routine.name : 'Extra workout'), isExtra: true });
    if (routine) this.populate(s, routine);
    return this.begin(s);
  },
  begin(s) {
    saveSession(s);
    this.activeId = s.id;
    this.recentPRs = [];
    DB.setKV('lastActive', Date.now());
    changed();
    return s;
  },
  populate(s, routine) {
    routineItems(routine).forEach((item, i) => {
      const se = { id: uuid(), order: i, exerciseId: item.exerciseId || null, name: displayName(item), targetSets: item.sets, repMin: item.repMin, repMax: item.repMax, sets: [] };
      s.exercises.push(se);
      this.prefill(se, item.targetWeight, s);
    });
  },
  prefill(se, targetWeight, s) {
    const last = DB.settings().prefillFromLast ? Stats.lastPerformance(se.exerciseId, se.name, s.startDate, s.id) : null;
    for (let i = 0; i < Math.max(1, se.targetSets); i++) {
      const set = { id: uuid(), index: i, weight: 0, reps: 0, done: false, doneAt: null };
      if (last) { const src = last.sets[Math.min(i, last.sets.length - 1)]; set.weight = src.weight; set.reps = src.reps; }
      else if (targetWeight != null) { set.weight = targetWeight; set.reps = 0; }
      se.sets.push(set);
    }
  },
  touch(s) {
    saveSession(s);
    if (s.id === this.activeId) DB.setKV('lastActive', Date.now());
    changed();
  },
  addExercise(exercise, s, sets = 3, repMin = 8, repMax = 12) {
    const order = s.exercises.length ? Math.max(...s.exercises.map((e) => e.order)) + 1 : 0;
    const se = { id: uuid(), order, exerciseId: exercise.id, name: exercise.name, targetSets: sets, repMin, repMax, sets: [] };
    s.exercises.push(se);
    this.prefill(se, null, s);
    this.touch(s);
  },
  removeExercise(s, seId) {
    s.exercises = s.exercises.filter((e) => e.id !== seId);
    S.orderedExercises(s).forEach((e, i) => { e.order = i; });
    this.touch(s);
  },
  addSet(s, se) {
    const last = orderedSets(se).slice(-1)[0];
    const index = se.sets.length ? Math.max(...se.sets.map((x) => x.index)) + 1 : 0;
    se.sets.push({ id: uuid(), index, weight: last ? last.weight : 0, reps: last ? last.reps : 0, done: false, doneAt: null });
    this.touch(s);
  },
  removeSet(s, se, setId) {
    se.sets = se.sets.filter((x) => x.id !== setId);
    orderedSets(se).forEach((x, i) => { x.index = i; });
    this.touch(s);
  },
  updateSet(s, set, { weight, reps }) {
    if (weight != null) set.weight = Math.max(0, weight);
    if (reps != null) set.reps = Math.max(0, reps);
    this.touch(s);
  },
  applyWeightToRemaining(s, se, set, weight) {
    for (const x of orderedSets(se)) if (x.index >= set.index && !x.done) x.weight = Math.max(0, weight);
    this.touch(s);
  },
  complete(s, set) { set.done = true; set.doneAt = Date.now(); this.touch(s); },
  uncomplete(s, set) { set.done = false; set.doneAt = null; this.touch(s); },

  finish(s) {
    s.endDate = Date.now();
    s.status = S.isFullyCompleted(s) ? 'completed' : 'partial';
    const prs = PR.detect(s);
    DB.batch([{ store: 'sessions', put: s }, ...prs.map((p) => ({ store: 'prs', put: p }))]);
    this.recentPRs = prs;
    if (this.activeId === s.id) this.activeId = null;
    Rest.stop();
    changed();
    return { status: s.status, prs };
  },
  discard(s) {
    if (this.activeId === s.id) this.activeId = null;
    const prIds = Q.prs().filter((p) => p.sessionId === s.id).map((p) => p.id);
    DB.batch([{ store: 'sessions', del: s.id }, ...prIds.map((id) => ({ store: 'prs', del: id }))]);
    if (!this.activeId) Rest.stop();
    changed();
  },
  elapsed(s, now = Date.now()) { return Math.max(0, ((s.endDate ?? now) - s.startDate) / 1000); },
  externalDataWiped() {
    this.activeId = null; this.pendingRecoveryId = null; this.recentPRs = [];
    if (Rest.raw) Rest.stop(); else DB.setKV('rest', null);
  },
};

export function displayName(item) {
  const ex = Q.exercise(item.exerciseId);
  return ex ? ex.name : item.name;
}

// ---------------------------------------------------------------------------------
// Routine actions

export const Routines = {
  create(name = 'New routine') {
    const r = { id: uuid(), name, weekday: null, scheduleStart: null, reminderEnabled: false, reminderMinutes: 16 * 60 + 30, createdAt: Date.now(), isDemo: DB.demo.active, items: [] };
    DB.put('routines', r);
    changed();
    return r;
  },
  save(r) { DB.put('routines', r); changed(); },
  duplicate(r, name, weekdayValue = null) {
    const copy = {
      id: uuid(), name: name || `${r.name} copy`, weekday: null, scheduleStart: null, reminderEnabled: false,
      reminderMinutes: r.reminderMinutes, createdAt: Date.now(), isDemo: DB.demo.active,
      items: routineItems(r).map((i) => ({ ...i, id: uuid() })),
    };
    this.assign(copy, weekdayValue, false);
    DB.put('routines', copy);
    changed();
    return copy;
  },
  remove(r) { DB.remove('routines', r.id); changed(); },
  findOrCreateExercise(name, ops) {
    const existing = Q.exerciseNamed(name);
    if (existing) {
      if (existing.isArchived) { existing.isArchived = false; ops ? ops.push({ store: 'exercises', put: existing }) : DB.put('exercises', existing); }
      return existing;
    }
    const e = newExercise(name);
    if (ops) { ops.push({ store: 'exercises', put: e }); state.exercises.set(e.id, e); } else DB.put('exercises', e);
    return e;
  },
  replaceItems(r, parsed, ops) {
    r.items = parsed.map((p, i) => {
      const ex = this.findOrCreateExercise(p.name, ops);
      return { id: uuid(), order: i, exerciseId: ex.id, name: ex.name, sets: p.sets, repMin: p.repMin, repMax: p.repMax, targetWeight: p.weight ?? null };
    });
  },
  /** Assigns a weekday, un-assigning any other routine on that day. */
  assign(r, wd, persist = true) {
    const ops = [];
    if (wd) {
      for (const other of Q.routines()) {
        if (other.id !== r.id && other.weekday === wd) {
          other.weekday = null; other.scheduleStart = null;
          ops.push({ store: 'routines', put: other });
        }
      }
      if (r.weekday !== wd) r.scheduleStart = todayKey();
      r.weekday = wd;
    } else {
      r.weekday = null; r.scheduleStart = null;
    }
    if (persist) ops.push({ store: 'routines', put: r });
    if (ops.length) DB.batch(ops);
  },
};

export function newExercise(name, extra = {}) {
  return {
    id: uuid(), name: name.trim(), muscleGroup: '', equipment: '', customIncrement: null,
    createdAt: Date.now(), isArchived: false, isDemo: DB.demo.active, ...extra,
  };
}

export function hasDemoData() {
  return [...state.exercises.values()].some((e) => e.isDemo) || [...state.sessions.values()].some((s) => s.isDemo);
}
export function hasRealData() {
  return [...state.exercises.values()].some((e) => !e.isDemo) || [...state.sessions.values()].some((s) => !s.isDemo);
}

export { parseDay };
