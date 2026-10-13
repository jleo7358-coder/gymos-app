// Calendar (home): paged months, colour-coded days, day detail sheet.

import { Calendar, DAY_KIND, Engine, Q, routineItems, routineTotalSets } from '../engine.js';
import { nav, Screen } from '../nav.js';
import { View, icon, pill, presentSheet, sheetHeader, dismissAll } from '../ui.js';
import { esc, fmt, dayKey, todayKey, startOfMonth, addMonths, endOfMonth, weekday, ORDERED_WEEKDAYS, weekdayName, parseDay } from '../util.js';
import { sessionCard, ExtraPickerSheet, SessionDetailScreen, openSessionFromSheet } from './common.js';

const MONTHS_BACK = 24, MONTHS_FORWARD = 12;

export class CalendarScreen extends Screen {
  constructor() {
    super('Calendar');
    this.offset = 0;
    this.actions.prev = () => this.move(-1);
    this.actions.next = () => this.move(1);
    this.actions.today = () => { this.offset = 0; nav.refresh(); };
    this.actions.day = (el) => presentSheet(new DayDetailSheet(el.dataset.day));
  }
  move(d) {
    const n = this.offset + d;
    if (n < -MONTHS_BACK || n > MONTHS_FORWARD) return;
    this.offset = n;
    nav.refresh();
  }
  navRight() { return `<button class="nav-btn text" data-act="today" ${this.offset === 0 ? 'disabled' : ''}>Today</button>`; }
  mounted(root) {
    // Horizontal swipe changes month.
    let sx = null, sy = null;
    root.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.move(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  render() {
    const month = addMonths(new Date(), this.offset);
    const first = startOfMonth(month);
    const last = endOfMonth(month);
    const infos = Calendar.infos(dayKey(first), dayKey(last));
    const lead = ORDERED_WEEKDAYS.indexOf(weekday(first));
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="day-cell empty"></div>');
    const today = todayKey();
    for (const [key, info] of infos) {
      const n = parseDay(key).getDate();
      let label;
      if (info.kind === 'rest') {
        label = info.extras.length ? '<span class="cell-label extra">EXTRA</span>' : '<span class="cell-label rest">REST</span>';
      } else {
        label = `<span class="cell-label kind-${info.kind}">${esc(info.title.toUpperCase())}</span>`;
      }
      const dot = info.extras.length && info.kind !== 'rest' ? '<span class="dot extra"></span>' : '';
      cells.push(`<button class="day-cell ${info.kind === 'rest' && !info.extras.length ? 'dim' : ''}" data-act="day" data-day="${key}">
        <span class="day-num ${key === today ? 'today' : ''}">${n}</span>${label}<span class="dots">${dot}</span></button>`);
    }
    while (cells.length % 7) cells.push('<div class="day-cell empty"></div>');
    return `<div class="cal">
      <div class="month-header">
        <button class="nav-btn" data-act="prev" ${this.offset <= -MONTHS_BACK ? 'disabled' : ''} aria-label="Previous month">${icon.chevronLeft}</button>
        <div class="month-title">${esc(fmt.monthYear(first))}</div>
        <button class="nav-btn" data-act="next" ${this.offset >= MONTHS_FORWARD ? 'disabled' : ''} aria-label="Next month">${icon.chevron}</button>
      </div>
      <div class="weekday-row">${ORDERED_WEEKDAYS.map((wd) => `<span>${weekdayName(wd, true).toUpperCase()}</span>`).join('')}</div>
      <div class="month-grid">${cells.join('')}</div>
      <div class="legend">${[['completed', 'Done'], ['partial', 'Partial'], ['missed', 'Missed'], ['planned', 'Planned'], ['extra', 'Extra']].map(([c, t]) => `<span><i class="dot ${c}"></i>${t}</span>`).join('')}</div>
    </div>`;
  }
}

class DayDetailSheet extends View {
  constructor(key) {
    super();
    this.key = key;
    this.actions = {
      cancel: () => this.close(),
      done: () => this.close(),
      openSession: (el) => openSessionFromSheet(el.dataset.id),
      start: () => {
        const info = Calendar.info(this.key);
        if (!info.routine || Engine.active) return;
        Engine.startPlanned(info.routine, this.key);
        dismissAll();
        nav.switchTab('workout', true);
      },
      extra: () => presentSheet(new ExtraPickerSheet(this.key)),
    };
  }
  render() {
    const info = Calendar.info(this.key);
    const isToday = this.key === todayKey();
    const isPast = this.key < todayKey();
    const kind = DAY_KIND[info.kind];
    let gym = '';
    if (info.session) gym = sessionCard(info.session, 'GYM', info.kind);
    else if (info.routine) {
      const r = info.routine;
      gym = `<div class="card"><div class="row-between"><div class="row-left"><span class="tag ${info.kind}">GYM</span><span class="headline">${esc(r.name)}</span></div><span class="caption muted">${routineTotalSets(r)} sets</span></div>
        ${info.kind === 'missed' ? '<div class="caption text-missed">Missed — should have trained:</div>' : ''}
        ${routineItems(r).map((i) => `<div class="row-between"><span class="sub">${esc(i.name)}</span><span class="sub muted num">${esc(fmt.target(i.sets, i.repMin, i.repMax))}</span></div>`).join('')}</div>`;
    } else if (!info.extras.length) {
      gym = '<div class="card row-left"><span class="tag rest">REST</span><span class="sub muted">No workout planned</span></div>';
    }
    const extras = info.extras.map((s) => sessionCard(s, 'EXTRA', 'extra')).join('');
    const busy = !!Engine.active;
    return `<div class="sheet-header"><span class="link-btn"></span><div class="sheet-title"></div><button class="link-btn strong" data-act="done">Done</button></div>
      <div class="stack">
        <div class="row-between"><span class="headline">${esc(fmt.fullDate(this.key))}</span>${pill(kind.label, info.kind)}</div>
        ${gym}${extras}
        <div class="stack-tight">
          ${isToday && info.kind === 'planned' && info.routine ? `<button class="btn primary" data-act="start" ${busy ? 'disabled' : ''}>START WORKOUT</button>` : ''}
          <button class="btn secondary" data-act="extra" ${busy ? 'disabled' : ''}>${isPast ? 'LOG EXTRA WORKOUT' : 'START EXTRA WORKOUT'}</button>
          ${busy ? '<div class="caption faint center">A workout is already in progress.</div>' : ''}
        </div>
      </div>`;
  }
}

export { SessionDetailScreen };
