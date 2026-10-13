// Body tab: manual weekly check-ins (weight, height, age, optional body fat / waist / note).

import * as DB from '../db.js';
import { Q, Stats, changed } from '../engine.js';
import { nav, Screen } from '../nav.js';
import { View, icon, statTile, trendBadge, lineChart, emptyState, sheetHeader, menu, confirm, presentSheet, patch, stepper } from '../ui.js';
import { esc, fmt, uuid, addDays, startOfWeek, dayKey, parseDay, parseDecimal } from '../util.js';

const RANGES = [['4W', 28], ['3M', 91], ['1Y', 365], ['All', null]];

function bmi(e) {
  if (e.weightKg == null || !e.heightInches) return null;
  const m = e.heightInches * 0.0254;
  return e.weightKg / (m * m);
}
function bmiBand(v) { return v < 18.5 ? 'underweight' : v < 25 ? 'normal' : v < 30 ? 'overweight' : 'obese'; }
const heightText = (e) => (e && e.heightInches ? fmt.feetInches(e.heightInches) : null);

export class BodyScreen extends Screen {
  constructor(title = 'Body') {
    super(title);
    this.range = '3M';
    Object.assign(this.actions, {
      add: () => presentSheet(new BodyEntrySheet(Q.bodyStats()[0] || null, null), { height: 'large' }),
      edit: (el) => { const e = DB.state.bodyStats.get(el.dataset.id); if (e) presentSheet(new BodyEntrySheet(Q.bodyStats()[0], e), { height: 'large' }); },
      entryMenu: (el) => {
        const e = DB.state.bodyStats.get(el.dataset.id); if (!e) return;
        menu([
          { label: 'Edit entry', icon: 'pencil', handler: () => presentSheet(new BodyEntrySheet(Q.bodyStats()[0], e), { height: 'large' }) },
          { label: 'Delete entry', icon: 'trash', destructive: true, handler: () => confirm('Delete this entry?', `${fmt.dayMonthYear(e.date)} — ${e.weightKg != null ? fmt.kg(e.weightKg) : 'no weight'}. This cannot be undone.`, 'Delete', () => { DB.remove('bodyStats', e.id); changed(); }) },
        ]);
      },
      range: (el) => { this.range = el.dataset.r; nav.refresh(); },
    });
  }
  render() {
    const entries = Q.bodyStats();
    const latest = entries[0];
    const days = RANGES.find((r) => r[0] === this.range)[1];
    const chrono = [...entries].reverse();
    const ranged = days ? chrono.filter((e) => e.date >= addDays(new Date(), -days).getTime()) : chrono;
    const weekStart = startOfWeek(new Date()).getTime();
    const doneThisWeek = entries.some((e) => e.date >= weekStart);
    const s = DB.settings();

    const checkIn = `<div class="card">
      <div class="row-between"><div><div class="headline">Weekly check-in</div>
        <div class="caption ${doneThisWeek ? 'text-completed' : 'muted'}">${doneThisWeek ? `Done for this week — updated ${esc(fmt.dayMonthYear(latest.date))}` : s.fridayReminderEnabled ? `Due this week · reminder Fridays ${fmt.reminderTime(s.fridayReminderMinutes)}` : 'Due this week'}</div></div>
        <span class="big-check ${doneThisWeek ? 'on' : ''}">${doneThisWeek ? icon.check : icon.circle}</span></div>
      <button class="btn primary" data-act="add">${doneThisWeek ? 'ADD ANOTHER ENTRY' : "ADD THIS WEEK'S UPDATE"}</button>
    </div>`;
    if (!entries.length) return `<div class="stack">${checkIn}<div class="card">${emptyState('No entries yet', 'Add your first weekly check-in to start tracking body weight, height and more.', 'body')}</div></div>`;

    const weights = entries.map((e) => e.weightKg).filter((v) => v != null);
    let delta = null;
    if (weights.length >= 2) { const d = weights[0] - weights[1]; delta = Math.abs(d) < 0.05 ? 'no change' : `${d > 0 ? '+' : ''}${fmt.number(d, 1)} kg vs last`; }
    const b = latest ? bmi(latest) : null;
    const current = `<div class="section-label">Current</div>
      <div class="tiles">${statTile('Weight', latest.weightKg != null ? fmt.kg(latest.weightKg) : '—', delta)}${statTile('Height', heightText(latest) || '—')}${statTile('Age', latest.age != null ? String(latest.age) : '—')}</div>
      <div class="tiles">${statTile('BMI', b != null ? fmt.number(b, 1) : '—', b != null ? bmiBand(b) : null)}${statTile('Body fat', latest.bodyFatPercent != null ? `${fmt.number(latest.bodyFatPercent, 1)}%` : '—')}${statTile('Waist', latest.waistCm != null ? `${fmt.number(latest.waistCm, 1)} cm` : '—')}</div>`;

    const wv = ranged.map((e) => e.weightKg).filter((v) => v != null);
    const wTrend = Stats.trend(wv, 1);
    const wStats = wv.length >= 2 ? `<div class="caption faint num chart-foot">Start ${esc(fmt.kg(wv[0]))} · Now ${esc(fmt.kg(wv[wv.length - 1]))} · Change ${wv[wv.length - 1] - wv[0] > 0 ? '+' : ''}${fmt.number(wv[wv.length - 1] - wv[0], 1)} kg · Range ${fmt.number(Math.min(...wv), 1)}–${fmt.number(Math.max(...wv), 1)}</div>` : '';
    const weightCard = `<div class="card"><div class="row-between"><span class="sub strong">Body weight</span>${trendBadge(wTrend, null)}</div>
      <div class="segmented small">${RANGES.map(([r]) => `<button class="seg ${this.range === r ? 'on' : ''}" data-act="range" data-r="${r}">${r}</button>`).join('')}</div>
      ${lineChart(ranged.filter((e) => e.weightKg != null).map((e) => ({ date: e.date, value: e.weightKg })), { unit: 'kg' })}${wStats}</div>`;

    const extraChart = (title, unit, key) => {
      const pts = ranged.filter((e) => e[key] != null).map((e) => ({ date: e.date, value: e[key] }));
      if (!pts.length) return '';
      return `<div class="card"><div class="row-between"><span class="sub strong">${title}</span>${trendBadge(Stats.trend(pts.map((p) => p.value), 1), null)}</div>${lineChart(pts, { unit })}</div>`;
    };

    const weeks = [0, 1, 2].map((i) => Stats.weekSummary(addDays(new Date(), -7 * i)));
    const training = `<div class="card"><div class="label">Training — last 3 weeks</div>${weeks.map((w) => `<div class="week-row">
      <div class="row-between"><span class="sub strong">Week of ${esc(fmt.dayMonth(w.weekStart))}</span><span class="caption muted">${w.completedSessions}/${w.sessions} workouts</span></div>
      <div class="caption faint num">${w.sets} sets · ${fmt.integer(w.volume)} kg volume · ${fmt.minutes(w.duration)}</div>
      ${w.topLifts.length ? `<div class="caption muted clamp2">${w.topLifts.slice(0, 3).map((l) => `${esc(l.name)} ${fmt.number(l.weight, 1)}×${l.reps}`).join(' · ')}</div>` : ''}</div>`).join('')}</div>`;

    const list = `<div class="card"><div class="row-between"><span class="label">All entries</span><span class="caption faint">${entries.length}</span></div>
      ${entries.map((e) => {
        const extras = [e.bodyFatPercent != null ? `BF ${fmt.number(e.bodyFatPercent, 1)}%` : null, e.waistCm != null ? `waist ${fmt.number(e.waistCm, 1)} cm` : null, e.note || null].filter(Boolean);
        return `<button class="entry-row" data-act="edit" data-id="${e.id}" data-longpress="entryMenu">
          <div class="row-between"><span class="sub muted">${esc(fmt.dayMonthYear(e.date))}</span><span class="row-left num"><span class="sub strong">${e.weightKg != null ? esc(fmt.kg(e.weightKg)) : '—'}</span><span class="sub muted">${esc(heightText(e) || '—')}</span><span class="sub muted">${e.age != null ? `${e.age} y` : '—'}</span>${icon.chevron}</span></div>
          ${extras.length ? `<div class="caption faint ellipsis">${esc(extras.join(' · '))}</div>` : ''}</button>`;
      }).join('')}
      <div class="caption faint">Tap an entry to edit it. Long-press to delete.</div></div>`;

    return `<div class="stack">${checkIn}${current}${weightCard}${extraChart('Body fat', '%', 'bodyFatPercent')}${extraChart('Waist', 'cm', 'waistCm')}${training}${list}</div>`;
  }
}

class BodyEntrySheet extends View {
  constructor(previous, editing) {
    super();
    this.editing = editing;
    const src = editing || previous;
    this.date = dayKey(editing ? editing.date : Date.now());
    this.weightText = src && src.weightKg != null ? fmt.editable(src.weightKg) : '';
    const totalIn = src && src.heightInches ? Math.round(src.heightInches) : 70;
    this.feet = Math.min(7, Math.max(3, Math.floor(totalIn / 12)));
    this.inches = Math.min(11, Math.max(0, totalIn - this.feet * 12));
    this.age = src && src.age != null ? src.age : 30;
    this.bf = editing && editing.bodyFatPercent != null ? fmt.editable(editing.bodyFatPercent) : '';
    this.waist = editing && editing.waistCm != null ? fmt.editable(editing.waistCm) : '';
    this.note = editing && editing.note ? editing.note : '';
    this.error = null;
    this.actions = {
      cancel: () => this.close(),
      done: () => this.save(),
      age: (el) => { this.age = Math.min(100, Math.max(10, this.age + Number(el.dataset.d))); this.refresh(); },
    };
    this.inputs = {
      weight: (el) => { this.weightText = el.value; }, bf: (el) => { this.bf = el.value; },
      waist: (el) => { this.waist = el.value; }, note: (el) => { this.note = el.value; },
    };
    this.changes = {
      date: (el) => { if (el.value) this.date = el.value; },
      feet: (el) => { this.feet = Number(el.value); }, inches: (el) => { this.inches = Number(el.value); },
    };
  }
  refresh() { const el = document.querySelector(`[data-view="${this.id}"]`); if (el) patch(el, this.render()); }
  save() {
    const w = parseDecimal(this.weightText);
    if (this.weightText.trim() && w == null) return this.fail('Weight must be a number.');
    if (w != null && (w <= 0 || w > 400)) return this.fail('Weight must be between 0 and 400 kg.');
    const bf = parseDecimal(this.bf);
    if (this.bf.trim() && bf == null) return this.fail('Body fat must be a number.');
    if (bf != null && (bf < 1 || bf > 70)) return this.fail('Body fat must be between 1 and 70%.');
    const wc = parseDecimal(this.waist);
    if (this.waist.trim() && wc == null) return this.fail('Waist must be a number.');
    if (wc != null && (wc < 30 || wc > 250)) return this.fail('Waist must be between 30 and 250 cm.');
    if (this.date > dayKey(Date.now())) return this.fail("The date can't be in the future.");
    const note = this.note.trim();
    const day = parseDay(this.date);
    const now = new Date();
    // Keep the time of day for entries made today; otherwise noon on the chosen day.
    const date = this.date === dayKey(now) ? now.getTime() : (this.editing && dayKey(this.editing.date) === this.date ? this.editing.date : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime());
    const record = {
      id: this.editing ? this.editing.id : uuid(), date, weightKg: w, heightInches: this.feet * 12 + this.inches, age: this.age,
      bodyFatPercent: bf, waistCm: wc, note: note || null, isDemo: this.editing ? this.editing.isDemo : DB.demo.active,
    };
    DB.put('bodyStats', record);
    changed();
    this.close();
  }
  fail(msg) { this.error = msg; this.refresh(); }
  render() {
    const opt = (from, to, sel, unit) => { let h = ''; for (let i = from; i <= to; i++) h += `<option value="${i}" ${i === sel ? 'selected' : ''}>${i} ${unit}</option>`; return h; };
    return `${sheetHeader(this.editing ? 'Edit entry' : 'Weekly update', { right: 'Save' })}
      <div class="list grouped form">
        <label class="row"><span class="row-label grow">Date</span><input type="date" class="date-input" value="${this.date}" max="${dayKey(Date.now())}" data-change="date"></label>
        <label class="row"><span class="row-label grow">Body weight</span><input class="num-input" inputmode="decimal" placeholder="kg" value="${esc(this.weightText)}" data-input="weight"><span class="unit">kg</span></label>
        <div class="row"><span class="row-label grow">Height</span><select class="select" data-change="feet">${opt(3, 7, this.feet, 'ft')}</select><select class="select" data-change="inches">${opt(0, 11, this.inches, 'in')}</select></div>
        ${stepper(`Age: ${this.age}`, this.age, 'age', 10, 100)}
      </div>
      <div class="section-label">Optional</div>
      <div class="list grouped form">
        <label class="row"><span class="row-label grow">Body fat</span><input class="num-input" inputmode="decimal" placeholder="—" value="${esc(this.bf)}" data-input="bf"><span class="unit">%</span></label>
        <label class="row"><span class="row-label grow">Waist</span><input class="num-input" inputmode="decimal" placeholder="—" value="${esc(this.waist)}" data-input="waist"><span class="unit">cm</span></label>
        <label class="row"><input class="text-input full" placeholder="Note (e.g. morning, after breakfast)" value="${esc(this.note)}" data-input="note"></label>
      </div>
      ${this.error ? `<div class="caption text-missed">${esc(this.error)}</div>` : ''}`;
  }
}

export { heightText };
