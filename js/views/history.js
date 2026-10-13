// History: workouts, exercises (with stats) and personal records, with search and date range.

import { Q, S, performance, durationText, setSummary } from '../engine.js';
import { nav, Screen } from '../nav.js';
import { icon, pill, emptyState } from '../ui.js';
import { esc, fmt, norm, addDays, dayKey, startOfMonth } from '../util.js';
import { SessionDetailScreen, ExerciseDetailScreen } from './common.js';

const RANGES = [['all', 'All', null], ['30', '30 days', 30], ['90', '90 days', 90], ['365', '1 year', 365]];

export class HistoryScreen extends Screen {
  constructor() {
    super('History');
    this.mode = 'workouts'; this.range = 'all'; this.search = '';
    Object.assign(this.actions, {
      mode: (el) => { this.mode = el.dataset.mode; nav.refresh(); },
      session: (el) => nav.push(new SessionDetailScreen(el.dataset.id)),
      exercise: (el) => nav.push(new ExerciseDetailScreen(el.dataset.eid || null, el.dataset.name)),
    });
    this.inputs = { search: (el) => { this.search = el.value; nav.refresh(); } };
    this.changes = { range: (el) => { this.range = el.value; nav.refresh(); } };
  }
  data() {
    const q = norm(this.search);
    const days = RANGES.find((r) => r[0] === this.range)[2];
    const startKey = days ? dayKey(addDays(new Date(), -days)) : null;
    let all = Q.sessions().filter((s) => s.status !== 'active');
    if (startKey) all = all.filter((s) => s.day >= startKey);
    if (q) all = all.filter((s) => norm(s.routineName).includes(q) || s.exercises.some((e) => norm(e.name).includes(q)));

    const groups = new Map();
    for (const s of all) for (const e of s.exercises) {
      const p = performance(e, s);
      if (!p) continue;
      const key = e.exerciseId || norm(e.name);
      if (!groups.has(key)) groups.set(key, { key, exerciseId: e.exerciseId, name: e.name, perfs: [] });
      const g = groups.get(key); g.name = e.name; g.perfs.push(p);
    }
    const exercises = [...groups.values()].map((g) => {
      const sorted = g.perfs.sort((a, b) => b.date - a.date);
      const best = sorted.reduce((b, p) => (!b || p.bestWeight > b.bestWeight || (p.bestWeight === b.bestWeight && p.bestReps > b.bestReps) ? p : b), null);
      return { ...g, last: sorted[0], best, count: sorted.length };
    }).filter((r) => !q || norm(r.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name));

    let prs = Q.prs();
    if (days) { const cut = addDays(new Date(), -days).getTime(); prs = prs.filter((p) => p.date >= cut); }
    if (q) prs = prs.filter((p) => norm(p.name).includes(q));
    return { sessions: all, exercises, prs };
  }
  render() {
    const { sessions, exercises, prs } = this.data();
    const count = this.mode === 'workouts' ? `${sessions.length} workouts` : this.mode === 'exercises' ? `${exercises.length} exercises` : `${prs.length} records`;
    let list = '';
    if (this.mode === 'workouts') {
      if (!sessions.length) list = emptyState('No workouts', 'Finished workouts appear here.', 'history');
      const months = new Map();
      for (const s of sessions) { const k = dayKey(startOfMonth(s.startDate)); if (!months.has(k)) months.set(k, []); months.get(k).push(s); }
      for (const [k, arr] of months) {
        list += `<div class="section-label">${esc(fmt.monthYear(k))}</div><div class="list grouped">${arr.map((s) => {
          const st = S.effectiveStatus(s);
          return `<button class="list-row" data-act="session" data-id="${s.id}"><span class="grow"><span class="block">${esc(s.routineName)} ${s.isExtra ? pill('EXTRA', 'extra') : ''}</span><span class="caption faint">${esc(fmt.weekdayDayMonth(s.day))}</span></span>
            <span class="right"><span class="block num text-${st}">${S.completedSets(s)}/${S.totalSets(s)} sets</span><span class="caption faint num">${durationText(s)} · ${fmt.integer(S.volume(s))} kg</span></span>${icon.chevron}</button>`;
        }).join('')}</div>`;
      }
    } else if (this.mode === 'exercises') {
      list = exercises.length ? `<div class="list grouped">${exercises.map((r) => `<button class="list-row" data-act="exercise" data-eid="${r.exerciseId || ''}" data-name="${esc(r.name)}">
        <span class="grow"><span class="block">${esc(r.name)}</span><span class="caption faint">${r.count} sessions</span></span>
        <span class="right"><span class="block num">${esc(r.last ? r.last.bestSummary : '—')}</span><span class="caption faint num">Best ${esc(r.best ? r.best.bestSummary : '—')}</span></span>${icon.chevron}</button>`).join('')}</div>`
        : emptyState('No exercise history', 'Exercises with recorded sets appear here.', 'strength');
    } else {
      list = prs.length ? `<div class="list grouped">${prs.map((p) => `<div class="list-row"><span class="grow"><span class="tag completed">NEW BEST</span><span class="block">${esc(p.name)}</span><span class="caption faint">${esc(fmt.dayMonthYear(p.date))}</span></span>
        <span class="right"><span class="block strong num">${esc(setSummary(p.weight, p.reps))}</span><span class="caption faint num">was ${esc(setSummary(p.prevWeight, p.prevReps))}</span></span></div>`).join('')}</div>`
        : emptyState('No records yet', 'Meaningful personal records are detected automatically when you finish a workout.', 'star');
    }
    return `<div class="stack">
      <div class="segmented">${[['workouts', 'Workouts'], ['exercises', 'Exercises'], ['prs', 'PRs']].map(([m, t]) => `<button class="seg ${this.mode === m ? 'on' : ''}" data-act="mode" data-mode="${m}">${t}</button>`).join('')}</div>
      <div class="search-box">${icon.search}<input type="search" placeholder="Exercise or routine" value="${esc(this.search)}" data-input="search" autocomplete="off"></div>
      <div class="row-between"><label class="range">${icon.calendar}<select class="select plain small" data-change="range">${RANGES.map(([v, t]) => `<option value="${v}" ${this.range === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><span class="caption faint">${count}</span></div>
      ${list}
    </div>`;
  }
}
