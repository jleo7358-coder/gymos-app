// Profile: personal stats summary, schedule, settings, reminders, backup & export,
// storage, data delete and demo data.

import * as DB from '../db.js';
import { state } from '../db.js';
import { Q, Engine, changed, hasDemoData, hasRealData, routineItems } from '../engine.js';
import * as Backup from '../backup.js';
import { loadDemo, resetDemo } from '../demo.js';
import { nav, Screen } from '../nav.js';
import {
  icon, pill, toggle, stepper, presentSheet, confirm, alert, toast, saveFile, pickFile, WeightKeypad, menu, emptyState,
} from '../ui.js';
import { esc, fmt, ORDERED_WEEKDAYS, weekdayName, minutesToTimeInput, timeInputToMinutes } from '../util.js';
import { BodyScreen, heightText } from './body.js';
import { RoutineListScreen } from './workout.js';

export class ProfileScreen extends Screen {
  constructor() {
    super('Profile');
    Object.assign(this.actions, {
      stats: () => nav.push(new BodyScreen('Personal stats')),
      routines: () => nav.push(new RoutineListScreen()),
      reminders: () => nav.push(new RemindersScreen()),
      settings: () => nav.push(new SettingsScreen()),
      backup: () => nav.push(new BackupScreen()),
      storage: () => nav.push(new StorageScreen()),
      delete: () => nav.push(new DataDeleteScreen()),
      demo: () => nav.push(new DemoScreen()),
      about: () => nav.push(new AboutScreen()),
    });
  }
  render() {
    const latest = Q.bodyStats()[0];
    const routines = Q.routines();
    const stat = (l, v) => `<div class="mini-stat"><span class="tile-label">${l}</span><span class="sub strong num">${esc(v)}</span></div>`;
    return `<div class="stack">
      <div class="section-label">Personal stats</div>
      <div class="list grouped"><button class="list-row" data-act="stats"><span class="grow"><span class="row-left gap16">${stat('Weight', latest && latest.weightKg != null ? fmt.kg(latest.weightKg) : '—')}${stat('Height', heightText(latest) || '—')}${stat('Age', latest && latest.age != null ? String(latest.age) : '—')}</span>
        <span class="caption faint block">${latest ? `Updated ${esc(fmt.dayMonthYear(latest.date))}` : 'No entries yet'}</span></span>${icon.chevron}</button></div>

      <div class="section-label">Training schedule</div>
      <div class="list grouped">
        ${ORDERED_WEEKDAYS.map((wd) => { const r = routines.find((x) => x.weekday === wd); return `<div class="list-row"><span class="wd short">${weekdayName(wd, true)}</span><span class="grow ${r ? '' : 'faint'}">${esc(r ? r.name : 'Rest')}</span>${r && r.reminderEnabled ? `<span class="caption faint">${fmt.reminderTime(r.reminderMinutes)}</span>` : ''}</div>`; }).join('')}
        <button class="list-row" data-act="routines"><span class="grow">Edit routines</span>${icon.chevron}</button>
        <button class="list-row" data-act="reminders"><span class="grow">Reminders</span>${icon.chevron}</button>
      </div>

      <div class="section-label">App</div>
      <div class="list grouped"><button class="list-row" data-act="settings"><span class="grow">Settings</span>${icon.chevron}</button>
        <button class="list-row" data-act="about"><span class="grow">Install &amp; offline use</span>${icon.chevron}</button></div>

      <div class="section-label">Data</div>
      <div class="list grouped">
        <button class="list-row" data-act="backup"><span class="grow">Backup &amp; export</span>${icon.chevron}</button>
        <button class="list-row" data-act="storage"><span class="grow">Storage</span>${icon.chevron}</button>
        <button class="list-row" data-act="delete"><span class="grow">Data delete</span>${icon.chevron}</button>
      </div>

      ${DB.demo.toolsHidden ? '' : `<div class="section-label">Developer</div><div class="list grouped"><button class="list-row" data-act="demo"><span class="grow">Demo data</span>${DB.demo.active ? pill('DEMO LOADED', 'partial') : ''}${icon.chevron}</button></div>`}

      <div class="list grouped"><div class="list-row"><span class="grow muted">Version</span><span class="faint">${esc(Backup.APP_VERSION)}</span></div></div>
      <div class="caption faint">All data stays on this iPhone. No account, no cloud, no tracking.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------

class SettingsScreen extends Screen {
  constructor() {
    super('Settings');
    Object.assign(this.actions, {
      addInc: () => presentSheet(new WeightKeypad({ initial: 0, title: 'Add increment', showApply: false, onDone: (v) => {
        const s = DB.settings();
        if (v > 0 && !s.increments.includes(v)) { DB.updateSettings({ increments: [...s.increments, v].sort((a, b) => a - b) }); changed(); }
      } })),
      removeInc: (el) => { const v = Number(el.dataset.v); const s = DB.settings(); if (s.increments.length <= 1) { toast('Keep at least one increment'); return; } DB.updateSettings({ increments: s.increments.filter((x) => x !== v) }); changed(); },
      rest: (el) => { const s = DB.settings(); DB.updateSettings({ defaultRestSeconds: Math.min(600, Math.max(15, s.defaultRestSeconds + 15 * Number(el.dataset.d))) }); changed(); },
      resetWidget: () => { DB.updateSettings({ timerWidgetX: DB.DEFAULT_SETTINGS.timerWidgetX, timerWidgetY: DB.DEFAULT_SETTINGS.timerWidgetY, timerWidgetMinimized: false }); changed(); toast('Widget position reset'); },
    });
    this.changes = {
      alert: (el) => { DB.updateSettings({ restAlertEnabled: el.checked }); changed(); },
      prefill: (el) => { DB.updateSettings({ prefillFromLast: el.checked }); changed(); },
      awake: (el) => { DB.updateSettings({ keepAwakeDuringWorkout: el.checked }); changed(); },
    };
  }
  render() {
    const s = DB.settings();
    return `<div class="stack">
      <div class="section-label">Quick weight increments</div>
      <div class="list grouped">${[...s.increments].sort((a, b) => a - b).map((v) => `<div class="list-row"><span class="grow num">± ${esc(fmt.number(v, 2))} kg</span><button class="icon-btn destructive" data-act="removeInc" data-v="${v}" aria-label="Remove">${icon.minus}</button></div>`).join('')}
        <button class="list-row accent" data-act="addInc">${icon.plus}<span>Add increment</span></button></div>
      <div class="caption faint">Shown as −/+ buttons in the weight keypad.</div>

      <div class="section-label">Rest timer</div>
      <div class="list grouped form">
        ${stepper(`Default rest: ${fmt.duration(s.defaultRestSeconds)}`, s.defaultRestSeconds, 'rest', 15, 600)}
        ${toggle('Sound when rest ends', s.restAlertEnabled, 'alert', 'Plays while GymOS is open on screen')}
      </div>

      <div class="section-label">Workout</div>
      <div class="list grouped form">
        ${toggle('Pre-fill sets from last performance', s.prefillFromLast, 'prefill')}
        ${toggle('Keep screen awake during workout', s.keepAwakeDuringWorkout, 'awake')}
      </div>

      <div class="section-label">Timer widget</div>
      <div class="list grouped"><button class="list-row accent" data-act="resetWidget"><span>Reset widget position</span></button></div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------

class RemindersScreen extends Screen {
  constructor() {
    super('Reminders');
    Object.assign(this.actions, {
      addToCalendar: () => this.exportCalendar(),
    });
    this.changes = {
      routine: (el) => { const r = Q.routine(el.dataset.id); if (r) { r.reminderEnabled = el.checked; DB.put('routines', r); changed(); } },
      routineTime: (el) => { const r = Q.routine(el.dataset.id); if (r) { r.reminderMinutes = timeInputToMinutes(el.value, r.reminderMinutes); DB.put('routines', r); changed(); } },
      friday: (el) => { DB.updateSettings({ fridayReminderEnabled: el.checked }); changed(); },
      fridayTime: (el) => { DB.updateSettings({ fridayReminderMinutes: timeInputToMinutes(el.value, DB.settings().fridayReminderMinutes) }); changed(); },
    };
  }
  async exportCalendar() {
    const events = Backup.reminderEvents();
    if (!events.length) { alert('No reminders turned on', 'Turn on at least one workout reminder or the Friday reminder first.'); return; }
    const r = await saveFile('GymOS-reminders.ics', Backup.remindersICS(), 'text/calendar');
    if (r === 'cancelled') return;
    DB.setKV('remindersExported', Date.now());
    nav.refresh();
    alert('One more step', 'Choose “Save to Files”. Then open the Files app, tap GymOS-reminders.ics and tap “Add All” to put the reminders in your Calendar.');
  }
  render() {
    const routines = Q.routines().filter((r) => r.weekday).sort((a, b) => ORDERED_WEEKDAYS.indexOf(a.weekday) - ORDERED_WEEKDAYS.indexOf(b.weekday));
    const s = DB.settings();
    const last = DB.getKV('remindersExported', 0);
    return `<div class="stack">
      <div class="card info"><div class="sub">Web apps can't schedule notifications on their own, so GymOS hands your reminders to the iPhone <b>Calendar</b>, which alerts you at the right time — even when GymOS is closed.</div>
        <div class="caption muted">Tap the button below, save the file, then open it from the Files app and tap “Add All”. After changing a reminder, add them again and delete the old “GymOS” events in Calendar if you see doubles.</div></div>

      <div class="section-label">Workout reminders</div>
      <div class="list grouped form">
        ${routines.length ? routines.map((r) => `<label class="row toggle-row"><span class="grow">${esc(r.name)}<span class="row-sub">${weekdayName(r.weekday)}</span></span><input type="checkbox" class="switch" data-change="routine" data-id="${r.id}" ${r.reminderEnabled ? 'checked' : ''}></label>
          ${r.reminderEnabled ? `<label class="row sub-row"><span class="row-label grow">Time</span><input type="time" class="time-input" value="${minutesToTimeInput(r.reminderMinutes)}" data-change="routineTime" data-id="${r.id}"></label>` : ''}`).join('')
          : '<div class="row faint">No scheduled routines. Assign routines to weekdays first.</div>'}
      </div>

      <div class="section-label">Weekly stats reminder</div>
      <div class="list grouped form">
        ${toggle('Friday reminder', s.fridayReminderEnabled, 'friday')}
        ${s.fridayReminderEnabled ? `<label class="row sub-row"><span class="row-label grow">Time</span><input type="time" class="time-input" value="${minutesToTimeInput(s.fridayReminderMinutes)}" data-change="fridayTime"></label>` : ''}
      </div>

      <button class="btn primary" data-act="addToCalendar">${icon.bell} ADD REMINDERS TO CALENDAR</button>
      <div class="caption faint">${last ? `Last added ${esc(fmt.dayMonthYear(last))} ${esc(fmt.time(last))}.` : 'Not added to Calendar yet.'} The rest-timer sound plays inside GymOS while it is open.</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------------

class BackupScreen extends Screen {
  constructor() {
    super('Backup & export');
    this.message = null; this.isError = false;
    Object.assign(this.actions, {
      export: () => this.export(),
      import: () => this.import(),
      restore: (el) => this.restore(el.dataset.id),
      exportLocal: (el) => this.exportLocal(el.dataset.id),
      deleteLocal: (el) => { Backup.deleteLocalBackup(el.dataset.id); nav.refresh(); },
      createLocal: async () => { try { await Backup.createLocalBackup('manual'); this.note('Local backup created.'); } catch (e) { this.note(e.message, true); } },
      csvWorkouts: () => saveFile('GymOS-workouts.csv', Backup.workoutsCSV(), 'text/csv').then(() => this.note('CSV exported.')),
      csvStats: () => saveFile('GymOS-personal-stats.csv', Backup.bodyStatsCSV(), 'text/csv').then(() => this.note('CSV exported.')),
      importCsv: () => this.importCsv(),
    });
  }
  note(text, err = false) { this.message = text; this.isError = err; nav.refresh(); }
  export() {
    let bytes;
    try { bytes = Backup.encode(Backup.buildPayload()); } catch (e) { this.note(e.message, true); return; }
    Backup.storeLocal(bytes, 'export').catch(() => {});
    DB.setKV('lastExport', Date.now());
    saveFile(Backup.suggestedFileName(), bytes).then((r) => { if (r !== 'cancelled') this.note('Backup exported.'); else nav.refresh(); });
  }
  async import() {
    const file = await pickFile();
    if (!file) return;
    let bytes, payload;
    try { bytes = new Uint8Array(await file.arrayBuffer()); payload = Backup.decode(bytes); }
    catch (e) { this.note(e.message || "This file isn't a GymOS backup.", true); return; }
    confirm('Importing this backup will replace your current workout data.',
      `Backup from ${fmt.dayMonthYear(payload.createdAt * 1000)}: ${Backup.payloadSummary(payload)}.\n\nYour current data is backed up locally first.`,
      'Replace', async () => {
        try { const p = await Backup.importReplacing(bytes); this.note(`Imported: ${Backup.payloadSummary(p)}.`); }
        catch (e) { this.note(e.message, true); }
      });
  }
  async restore(id) {
    confirm('Restore this local backup?', 'Importing this backup will replace your current workout data. Your current data is backed up first.', 'Replace', async () => {
      try {
        const bytes = await DB.getBackupBytes(id);
        if (!bytes) throw new Error("Couldn't read that backup.");
        const p = await Backup.importReplacing(bytes);
        this.note(`Restored: ${Backup.payloadSummary(p)}.`);
      } catch (e) { this.note(e.message, true); }
    });
  }
  async exportLocal(id) {
    const meta = state.backups.get(id);
    const bytes = await DB.getBackupBytes(id);
    if (!bytes || !meta) { this.note("Couldn't read that backup.", true); return; }
    saveFile(meta.name, bytes);
  }
  async importCsv() {
    const file = await pickFile('.csv,text/csv,text/plain');
    if (!file) return;
    try { const msg = await Backup.importCSV(await file.text()); this.note(msg); }
    catch (e) { this.note(e.message, true); }
  }
  render() {
    const locals = Backup.localBackups();
    const last = DB.getKV('lastExport', 0);
    return `<div class="stack">
      <div class="section-label">Full backup</div>
      <div class="list grouped">
        <button class="list-row accent" data-act="export">${icon.share}<span>Export backup (.gymbackup)</span></button>
        <button class="list-row accent" data-act="import">${icon.download}<span>Import backup…</span></button>
      </div>
      <div class="caption faint">A file containing all workouts, exercises, routines, personal stats, PR history and settings. Works with the iPhone app’s .gymbackup files in both directions. ${last ? `Last exported ${esc(fmt.dayMonthYear(last))}.` : 'Not exported yet.'} Choose “Save to Files” in the share sheet.</div>

      <div class="section-label">Local backups (${Backup.RETAINED_BACKUPS} most recent kept)</div>
      <div class="list grouped">
        ${locals.length ? '' : '<div class="list-row faint">No local backups yet.</div>'}
        ${locals.map((f) => `<div class="list-row col"><span class="caption mono ellipsis">${esc(f.name)}</span>
          <div class="row-between"><span class="caption faint">${esc(fmt.dayMonthYear(f.createdAt))} ${esc(fmt.time(f.createdAt))} · ${esc(fmt.bytes(f.size))}</span>
          <span class="row-left"><button class="link-btn small" data-act="restore" data-id="${f.id}">Restore</button><button class="link-btn small" data-act="exportLocal" data-id="${f.id}">Export</button><button class="link-btn small destructive" data-act="deleteLocal" data-id="${f.id}">Delete</button></span></div></div>`).join('')}
        <button class="list-row accent" data-act="createLocal"><span>Create local backup now</span></button>
      </div>
      <div class="caption faint">Stored inside the app. A new one is written on every export and before every import; the oldest is removed automatically. These live in the same place as your data, so also keep an exported file in Files or iCloud Drive.</div>

      <div class="section-label">Readable exports (CSV)</div>
      <div class="list grouped">
        <button class="list-row accent" data-act="csvWorkouts"><span>Export workouts as CSV</span></button>
        <button class="list-row accent" data-act="csvStats"><span>Export personal stats as CSV</span></button>
        <button class="list-row accent" data-act="importCsv"><span>Import a GymOS CSV…</span></button>
      </div>
      <div class="caption faint">CSV import adds workouts or personal stats exported by GymOS (iPhone or web) without replacing anything. Prefer the .gymbackup file — it also carries routines, exercises and records.</div>

      ${this.message ? `<div class="card"><div class="caption ${this.isError ? 'text-partial' : 'text-completed'}">${esc(this.message)}</div></div>` : ''}
    </div>`;
  }
}

// ---------------------------------------------------------------------------------

const CATEGORIES = [
  ['workouts', 'Workouts', 'All recorded sessions, sets and reps. Cannot be undone.'],
  ['exercises', 'Exercises', 'Exercise definitions. Recorded workouts keep their exercise names.'],
  ['routines', 'Routines', 'Routine templates and reminder times.'],
  ['personalStats', 'Personal stats', 'Body weight, height, age, body fat, waist and notes.'],
  ['prHistory', 'PR history', 'Detected personal records.'],
  ['backups', 'Local backups', 'Backup files stored inside the app.'],
  ['settings', 'App settings', 'Increments, rest defaults, reminder settings and widget position.'],
];
const STORE_FOR = { workouts: 'sessions', exercises: 'exercises', routines: 'routines', personalStats: 'bodyStats', prHistory: 'prs' };

function inventory() {
  const out = {};
  for (const [k] of CATEGORIES) {
    if (STORE_FOR[k]) {
      const arr = [...state[STORE_FOR[k]].values()];
      out[k] = { count: arr.length, bytes: arr.length ? new Blob([JSON.stringify(arr)]).size : 0 };
    }
  }
  out.backups = { count: Backup.localBackups().length, bytes: Backup.backupsSize() };
  out.settings = { count: 1, bytes: new Blob([JSON.stringify(DB.settings())]).size };
  return out;
}

class StorageScreen extends Screen {
  constructor() {
    super('Storage');
    this.estimate = null;
    this.actions.clean = async () => {
      try {
        const keys = await caches.keys();
        for (const k of keys) if (k === 'gymos-dynamic') await caches.delete(k);
      } catch {}
      toast('Temporary files cleaned');
      this.load();
    };
    this.load();
  }
  async load() {
    try { this.estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { this.estimate = null; }
    try { this.persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch {}
    nav.refresh();
  }
  render() {
    const inv = inventory();
    const db = Object.entries(inv).filter(([k]) => STORE_FOR[k]).reduce((a, [, v]) => a + v.bytes, 0);
    const row = (l, b) => `<div class="list-row"><span class="grow">${l}</span><span class="muted num">${esc(fmt.bytes(b))}</span></div>`;
    return `<div class="stack">
      <div class="section-label">Total</div>
      <div class="list grouped">
        ${this.estimate ? row('Everything (reported by iOS)', this.estimate.usage || 0) : ''}
        ${row('Database (≈)', db)}${row('Backups', inv.backups.bytes)}
      </div>
      <div class="section-label">By category (estimated)</div>
      <div class="list grouped">${CATEGORIES.map(([k, title]) => `<div class="list-row"><span class="grow"><span class="block">${title}</span><span class="caption faint">${inv[k].count} items</span></span><span class="muted num">≈ ${esc(fmt.bytes(inv[k].bytes))}</span></div>`).join('')}</div>
      <div class="caption faint">Workout history is never removed automatically. ${this.persisted === true ? 'Storage is marked persistent.' : ''}</div>
      <div class="list grouped"><button class="list-row accent" data-act="clean"><span>Clean temporary files</span></button></div>
    </div>`;
  }
}

class DataDeleteScreen extends Screen {
  constructor() {
    super('Data delete');
    this.selected = new Set(); this.message = null;
    this.changes = { cat: (el) => { el.checked ? this.selected.add(el.dataset.k) : this.selected.delete(el.dataset.k); nav.refresh(); } };
    this.actions.delete = () => {
      if (!this.selected.size) return;
      const names = CATEGORIES.filter(([k]) => this.selected.has(k)).map(([, t]) => t).sort();
      confirm(`Delete ${this.selected.size} categor${this.selected.size === 1 ? 'y' : 'ies'}?`, `${names.join(', ')}\n\nThis cannot be undone${this.selected.has('backups') ? '.' : ' (local backups are kept).'}`, 'Delete', () => this.perform(names));
    };
  }
  async perform(names) {
    const sel = this.selected;
    if (sel.has('workouts')) Engine.externalDataWiped();
    const ops = [];
    for (const [k, store] of Object.entries(STORE_FOR)) if (sel.has(k)) for (const id of state[store].keys()) ops.push({ store, del: id });
    if (sel.has('exercises') && !sel.has('routines')) {
      for (const r of state.routines.values()) {
        let touched = false;
        for (const it of r.items) if (it.exerciseId) { it.exerciseId = null; touched = true; }
        if (touched) ops.push({ store: 'routines', put: r });
      }
    }
    await DB.batch(ops);
    if (sel.has('backups')) await Backup.deleteAllLocalBackups();
    if (sel.has('settings')) await DB.resetSettings();
    this.message = `Deleted: ${names.join(', ')}.`;
    this.selected = new Set();
    changed();
  }
  render() {
    const inv = inventory();
    const bytes = [...this.selected].reduce((a, k) => a + inv[k].bytes, 0);
    return `<div class="stack">
      <div class="section-label">App data</div>
      <div class="list grouped form">${CATEGORIES.map(([k, title, detail]) => `<label class="row toggle-row"><span class="grow"><span class="row-between"><span>${title}</span><span class="caption muted num">≈ ${esc(fmt.bytes(inv[k].bytes))}</span></span><span class="row-sub">${detail}</span></span>
        <input type="checkbox" class="switch danger" data-change="cat" data-k="${k}" ${this.selected.has(k) ? 'checked' : ''}></label>`).join('')}</div>
      <div class="caption faint">Everything is off by default. Only the selected categories are deleted, after confirmation.</div>
      <div class="list grouped"><div class="list-row"><span class="grow">Selected</span><span class="muted num">${this.selected.size} categories · ≈ ${esc(fmt.bytes(bytes))}</span></div>
        <button class="list-row destructive" data-act="delete" ${this.selected.size ? '' : 'disabled'}><span>Delete selected…</span></button></div>
      ${this.message ? `<div class="caption muted">${esc(this.message)}</div>` : ''}
    </div>`;
  }
}

class DemoScreen extends Screen {
  constructor() {
    super('Demo data');
    this.message = null;
    Object.assign(this.actions, {
      load: async () => { await loadDemo(); this.message = 'Demo data loaded.'; nav.refresh(); },
      reset: () => confirm('Delete all demo data?', 'The app returns to a completely empty state and this section is hidden.', 'Reset', async () => { await resetDemo(); nav.popToRoot(); }),
    });
  }
  render() {
    const hasDemo = hasDemoData(), hasReal = hasRealData();
    return `<div class="stack">
      <div class="card"><div class="sub muted">Loads about five weeks of realistic fake workouts, routines and weekly body stats so every screen can be tested. Demo data is completely separate from real data and is removed by the reset.</div></div>
      <div class="list grouped">${hasDemo ? '<button class="list-row destructive" data-act="reset"><span>Reset demo data (delete all fake data)</span></button>'
        : `<button class="list-row accent" data-act="load" ${hasReal ? 'disabled' : ''}><span>Load demo data</span></button>`}</div>
      ${!hasDemo && hasReal ? '<div class="caption faint">Demo data can only be loaded into an empty app, so it never mixes with your real workouts.</div>' : ''}
      ${this.message ? `<div class="caption muted">${esc(this.message)}</div>` : ''}
      <div class="caption faint">After the reset this developer section disappears from the app.</div>
    </div>`;
  }
}

class AboutScreen extends Screen {
  constructor() { super('Install & offline use'); }
  render() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return `<div class="stack">
      <div class="card"><div class="row-between"><span class="sub strong">Home Screen app</span>${standalone ? pill('INSTALLED', 'completed') : pill('IN BROWSER', 'partial')}</div>
        <div class="sub muted">${standalone ? 'GymOS is running as a Home Screen app. It never expires and works offline.' : 'Open this page in Safari, tap Share → Add to Home Screen, then open GymOS from the Home Screen icon. Data entered in Safari stays in Safari, so install first.'}</div></div>
      <div class="card"><div class="sub strong">Your data</div>
        <div class="sub muted">Everything is stored only on this iPhone, inside the GymOS Home Screen app. Deleting the GymOS icon from the Home Screen deletes its data too — export a backup to Files first.</div></div>
      <div class="card"><div class="sub strong">Differences from the native app</div>
        <div class="sub muted">Reminders go through the Calendar app (Profile → Reminders). The rest-timer alert is a sound inside GymOS rather than a lock-screen notification, and there is no lock-screen Live Activity. Everything else works the same.</div></div>
    </div>`;
  }
}
