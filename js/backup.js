// .gymbackup export/import (same file format as the iPhone app, both directions),
// local backup retention (2 most recent), CSV export/import and calendar reminders.

import * as DB from './db.js';
import { state } from './db.js';
import { Q, S, Engine, PR, Routines, changed, orderedSets, routineItems, routineTotalSets } from './engine.js';
import { lzfseDecode, lzfseStore } from './lzfse.js';
import { uuid, dayKey, parseDay, setTime, pad2, weekday, addDays, todayKey, norm, fmt } from './util.js';

export const APP_VERSION = '1.0 (web)';
const MAGIC = [0x47, 0x59, 0x4d, 0x42]; // "GYMB"
const FORMAT_VERSION = 1;
export const RETAINED_BACKUPS = 2;

export class BackupError extends Error {}

// ---------------------------------------------------------------------------------
// Payload <-> records

const sec = (ms) => ms / 1000;
const midnightSec = (key) => parseDay(key).getTime() / 1000;
const int = (v) => Math.round(Number(v) || 0);
function compact(o) { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k]; return o; }

export function buildPayload() {
  return {
    formatVersion: FORMAT_VERSION,
    createdAt: sec(Date.now()),
    appVersion: APP_VERSION,
    demoActive: DB.demo.active,
    exercises: Q.exercises(true).map((e) => compact({
      id: e.id, n: e.name, mg: e.muscleGroup || '', eq: e.equipment || '', inc: e.customIncrement ?? undefined,
      c: sec(e.createdAt), ar: !!e.isArchived, d: !!e.isDemo,
    })),
    routines: Q.routines().map((r) => compact({
      id: r.id, n: r.name, wd: r.weekday ?? undefined, ss: r.scheduleStart ? midnightSec(r.scheduleStart) : undefined,
      re: !!r.reminderEnabled, rm: int(r.reminderMinutes), c: sec(r.createdAt), d: !!r.isDemo,
      ex: routineItems(r).map((i) => compact({
        id: i.id, o: int(i.order), eid: i.exerciseId || undefined, n: i.name, s: int(i.sets),
        rmin: int(i.repMin), rmax: int(i.repMax), w: i.targetWeight ?? undefined,
      })),
    })),
    sessions: Q.sessions(false).map((s) => compact({
      id: s.id, sd: sec(s.startDate), ed: s.endDate != null ? sec(s.endDate) : undefined, pd: midnightSec(s.day),
      rid: s.routineId || undefined, rn: s.routineName, st: s.status, ex: !!s.isExtra, d: !!s.isDemo,
      exercises: S.orderedExercises(s).map((e) => compact({
        id: e.id, o: int(e.order), eid: e.exerciseId || undefined, n: e.name, ts: int(e.targetSets),
        rmin: int(e.repMin), rmax: int(e.repMax),
        sets: orderedSets(e).map((x) => compact({
          id: x.id, i: int(x.index), w: Number(x.weight) || 0, r: int(x.reps), c: !!x.done, ca: x.doneAt != null ? sec(x.doneAt) : undefined,
        })),
      })),
    })),
    bodyStats: Q.bodyStats(false).map((b) => compact({
      id: b.id, t: sec(b.date), w: b.weightKg ?? undefined, h: b.heightInches ?? undefined, a: b.age != null ? int(b.age) : undefined,
      bf: b.bodyFatPercent ?? undefined, wc: b.waistCm ?? undefined, n: b.note || undefined, d: !!b.isDemo,
    })),
    prs: Q.prs().map((p) => compact({
      id: p.id, eid: p.exerciseId || undefined, n: p.name, t: sec(p.date), w: p.weight, r: int(p.reps),
      pw: p.prevWeight, pr: int(p.prevReps), sid: p.sessionId || undefined, k: p.kind, d: !!p.isDemo,
    })),
    settings: DB.exportSettingsDictionary(),
  };
}

export function payloadSummary(p) {
  return `${p.sessions.length} workouts · ${p.exercises.length} exercises · ${p.routines.length} routines · ${p.bodyStats.length} stat entries`;
}

function recordsFromPayload(p) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const ms = (s) => Math.round(Number(s) * 1000);
  const lo = (a, b) => Math.min(int(a), int(b));
  const hi = (a, b) => Math.max(int(a), int(b));
  return {
    exercises: arr(p.exercises).map((e) => ({
      id: e.id, name: e.n, muscleGroup: e.mg || '', equipment: e.eq || '', customIncrement: e.inc ?? null,
      createdAt: ms(e.c), isArchived: !!e.ar, isDemo: !!e.d,
    })),
    routines: arr(p.routines).map((r) => ({
      id: r.id, name: r.n, weekday: r.wd ?? null, scheduleStart: r.ss != null ? dayKey(ms(r.ss)) : null,
      reminderEnabled: !!r.re, reminderMinutes: r.rm ?? 16 * 60 + 30, createdAt: ms(r.c), isDemo: !!r.d,
      items: arr(r.ex).map((i) => ({
        id: i.id, order: int(i.o), exerciseId: i.eid ?? null, name: i.n, sets: Math.max(1, int(i.s)),
        repMin: lo(i.rmin, i.rmax), repMax: hi(i.rmin, i.rmax), targetWeight: i.w ?? null,
      })),
    })),
    sessions: arr(p.sessions).map((s) => ({
      id: s.id, startDate: ms(s.sd), endDate: s.ed != null ? ms(s.ed) : null, day: dayKey(ms(s.pd)),
      routineId: s.rid ?? null, routineName: s.rn, status: ['active', 'completed', 'partial'].includes(s.st) ? s.st : 'partial',
      isExtra: !!s.ex, isDemo: !!s.d,
      exercises: arr(s.exercises).map((e) => ({
        id: e.id, order: int(e.o), exerciseId: e.eid ?? null, name: e.n, targetSets: int(e.ts),
        repMin: lo(e.rmin, e.rmax), repMax: hi(e.rmin, e.rmax),
        sets: arr(e.sets).map((x) => ({ id: x.id, index: int(x.i), weight: Number(x.w) || 0, reps: int(x.r), done: !!x.c, doneAt: x.ca != null ? ms(x.ca) : null })),
      })),
    })),
    bodyStats: arr(p.bodyStats).map((b) => ({
      id: b.id, date: ms(b.t), weightKg: b.w ?? null, heightInches: b.h ?? null, age: b.a ?? null,
      bodyFatPercent: b.bf ?? null, waistCm: b.wc ?? null, note: b.n ?? null, isDemo: !!b.d,
    })),
    prs: arr(p.prs).map((x) => ({
      id: x.id, exerciseId: x.eid ?? null, name: x.n, date: ms(x.t), weight: x.w, reps: int(x.r),
      prevWeight: x.pw, prevReps: int(x.pr), sessionId: x.sid ?? null, kind: x.k, isDemo: !!x.d,
    })),
  };
}

// ---------------------------------------------------------------------------------
// Encode / decode

export function encode(payload) {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const body = lzfseStore(json);
  const out = new Uint8Array(6 + body.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  out[5] = 1; // LZFSE stream
  out.set(body, 6);
  return out;
}

export function decode(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let json;
  if (bytes.length > 6 && MAGIC.every((b, i) => bytes[i] === b)) {
    if (bytes[4] > FORMAT_VERSION) throw new BackupError(`Backup version ${bytes[4]} isn't supported by this app version.`);
    let raw;
    try { raw = lzfseDecode(bytes.subarray(6)); } catch { throw new BackupError("The backup file is damaged and couldn't be read."); }
    json = new TextDecoder().decode(raw);
  } else if (bytes.length && bytes[0] === 0x7b) {
    json = new TextDecoder().decode(bytes); // plain JSON payload
  } else {
    throw new BackupError("This file isn't a GymOS backup.");
  }
  let p;
  try { p = JSON.parse(json); } catch { throw new BackupError("The backup file is damaged and couldn't be read."); }
  if (!p || typeof p !== 'object' || !Array.isArray(p.sessions) || !Array.isArray(p.exercises)) {
    throw new BackupError("This file isn't a GymOS backup.");
  }
  for (const k of ['routines', 'bodyStats', 'prs']) if (!Array.isArray(p[k])) p[k] = [];
  return p;
}

export function suggestedFileName() {
  const d = new Date();
  return `GymOS-${dayKey(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}.gymbackup`;
}

// ---------------------------------------------------------------------------------
// Local backups

export function localBackups() {
  return [...state.backups.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function storeLocal(bytes, label) {
  const d = new Date();
  const name = `GymOS-${dayKey(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${label}.gymbackup`;
  const meta = { id: uuid(), createdAt: Date.now(), label, name, size: bytes.length };
  await DB.putBackup(meta, bytes);
  await prune();
  return meta;
}

export async function prune() {
  const files = localBackups();
  for (const f of files.slice(RETAINED_BACKUPS)) await DB.remove('backups', f.id);
}

export async function createLocalBackup(label = 'auto') {
  return storeLocal(encode(buildPayload()), label);
}

export async function exportBytes() {
  const bytes = encode(buildPayload());
  try { await storeLocal(bytes, 'export'); } catch {}
  DB.setKV('lastExport', Date.now());
  return bytes;
}

export function deleteLocalBackup(id) { return DB.remove('backups', id); }
export async function deleteAllLocalBackups() { await DB.clearStore('backups'); }
export function backupsSize() { return localBackups().reduce((a, b) => a + (b.size || 0), 0); }

// ---------------------------------------------------------------------------------
// Import (replace everything, after a safety copy)

export async function importReplacing(bytes) {
  const payload = decode(bytes);
  try { await createLocalBackup('pre-import'); } catch {}
  Engine.externalDataWiped();
  await DB.replaceAllData(recordsFromPayload(payload));
  DB.demo.active = !!payload.demoActive;
  await DB.applySettingsDictionary(payload.settings || {});
  changed();
  return payload;
}

// ---------------------------------------------------------------------------------
// CSV export (same columns as the iPhone app)

function csvField(s) {
  s = String(s ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function workoutsCSV() {
  const lines = ['date,start_time,routine,status,extra,exercise,set,weight_kg,reps,completed'];
  for (const s of Q.sessions(false)) {
    const t = new Date(s.startDate);
    for (const e of S.orderedExercises(s)) for (const x of orderedSets(e)) {
      lines.push([s.day, `${pad2(t.getHours())}:${pad2(t.getMinutes())}`, csvField(s.routineName), s.status,
        s.isExtra ? 'yes' : 'no', csvField(e.name), x.index + 1, Number(x.weight).toFixed(2), x.reps, x.done ? 'yes' : 'no'].join(','));
    }
  }
  return lines.join('\n');
}

export function bodyStatsCSV() {
  const lines = ['date,weight_kg,height_inches,age,body_fat_percent,waist_cm,note'];
  const f = (v, d) => (v == null ? '' : Number(v).toFixed(d));
  for (const b of Q.bodyStats(false)) {
    lines.push([dayKey(b.date), f(b.weightKg, 2), f(b.heightInches, 1), b.age ?? '', f(b.bodyFatPercent, 1), f(b.waistCm, 1), csvField(b.note || '')].join(','));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------
// CSV import (fallback for moving data from the iPhone app)

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Returns a description of what was imported. Adds to existing data (never replaces). */
export async function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new BackupError('The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  if (idx('exercise') >= 0 && idx('set') >= 0 && idx('weight_kg') >= 0) return importWorkoutRows(rows.slice(1), idx);
  if (idx('weight_kg') >= 0 && idx('height_inches') >= 0) return importStatRows(rows.slice(1), idx);
  throw new BackupError("This CSV wasn't exported by GymOS (unknown columns).");
}

async function importWorkoutRows(rows, idx) {
  const col = (r, n) => (idx(n) >= 0 ? (r[idx(n)] ?? '').trim() : '');
  const groups = new Map();
  for (const r of rows) {
    const key = [col(r, 'date'), col(r, 'start_time'), col(r, 'routine'), col(r, 'status'), col(r, 'extra')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const ops = [];
  const created = [];
  let skipped = 0;
  const existing = new Set(Q.sessions().map((s) => { const t = new Date(s.startDate); return `${s.day}|${pad2(t.getHours())}:${pad2(t.getMinutes())}|${norm(s.routineName)}`; }));
  for (const [, list] of groups) {
    const first = list[0];
    const day = col(first, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const [hh, mm] = (col(first, 'start_time') || '12:00').split(':').map(Number);
    const startDate = setTime(parseDay(day), hh || 0, mm || 0).getTime();
    const routineName = col(first, 'routine') || 'Workout';
    if (existing.has(`${day}|${pad2(hh || 0)}:${pad2(mm || 0)}|${norm(routineName)}`)) { skipped++; continue; }
    const status = ['completed', 'partial', 'active'].includes(col(first, 'status')) ? col(first, 'status') : 'partial';
    const session = {
      id: uuid(), startDate, endDate: startDate, noDuration: true, day, routineId: null, routineName,
      status: status === 'active' ? 'partial' : status, isExtra: col(first, 'extra') === 'yes', isDemo: false, exercises: [],
    };
    const byName = new Map();
    for (const r of list) {
      const name = col(r, 'exercise');
      if (!name) continue;
      if (!byName.has(name)) {
        const ex = Routines.findOrCreateExercise(name, ops);
        byName.set(name, { id: uuid(), order: byName.size, exerciseId: ex.id, name: ex.name, targetSets: 0, repMin: 0, repMax: 0, sets: [] });
      }
      const se = byName.get(name);
      const done = col(r, 'completed') === 'yes';
      const doneAt = done ? startDate : null;
      se.sets.push({ id: uuid(), index: se.sets.length, weight: Number(col(r, 'weight_kg')) || 0, reps: parseInt(col(r, 'reps'), 10) || 0, done, doneAt });
    }
    for (const se of byName.values()) {
      se.targetSets = se.sets.length;
      const reps = se.sets.map((x) => x.reps).filter((x) => x > 0);
      se.repMin = reps.length ? Math.min(...reps) : 8;
      se.repMax = reps.length ? Math.max(...reps) : 12;
      session.exercises.push(se);
    }
    if (!session.exercises.length) continue;
    created.push(session);
  }
  // Insert chronologically and detect PRs as if they had been finished in order.
  created.sort((a, b) => a.startDate - b.startDate);
  for (const s of created) {
    state.sessions.set(s.id, s);
    ops.push({ store: 'sessions', put: s });
    for (const p of PR.detect(s)) { state.prs.set(p.id, p); ops.push({ store: 'prs', put: p }); }
  }
  await DB.batch(ops);
  changed();
  return `${created.length} workouts imported${skipped ? `, ${skipped} already present` : ''}.`;
}

async function importStatRows(rows, idx) {
  const col = (r, n) => (idx(n) >= 0 ? (r[idx(n)] ?? '').trim() : '');
  const num = (v) => (v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const ops = [];
  let skipped = 0;
  const existing = new Set(Q.bodyStats().map((b) => `${dayKey(b.date)}|${b.weightKg ?? ''}`));
  for (const r of rows) {
    const day = col(r, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const w = num(col(r, 'weight_kg'));
    if (existing.has(`${day}|${w ?? ''}`)) { skipped++; continue; }
    const age = num(col(r, 'age'));
    ops.push({
      store: 'bodyStats', put: {
        id: uuid(), date: setTime(parseDay(day), 12, 0).getTime(), weightKg: w, heightInches: num(col(r, 'height_inches')),
        age: age == null ? null : Math.round(age), bodyFatPercent: num(col(r, 'body_fat_percent')), waistCm: num(col(r, 'waist_cm')),
        note: col(r, 'note') || null, isDemo: false,
      },
    });
  }
  await DB.batch(ops);
  changed();
  return `${ops.length} body stat entries imported${skipped ? `, ${skipped} already present` : ''}.`;
}

// ---------------------------------------------------------------------------------
// Reminders as a calendar file (web apps can't schedule local notifications)

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function icsLocal(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`; }
function icsUTC(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function nextOccurrence(wd, minutes) {
  for (let i = 0; i < 8; i++) {
    const day = addDays(new Date(), i);
    if (weekday(day) === wd) {
      const at = setTime(day, Math.floor(minutes / 60), minutes % 60);
      if (at > new Date() || i > 0) return at;
    }
  }
  return setTime(addDays(new Date(), 7), Math.floor(minutes / 60), minutes % 60);
}

export function reminderEvents() {
  const events = [];
  for (const r of Q.routines()) {
    if (!r.reminderEnabled || !r.weekday) continue;
    const n = r.items.length;
    events.push({
      uid: `gymos-workout-${r.id}@gymos`, weekday: r.weekday, minutes: r.reminderMinutes,
      title: `Workout today: ${r.name}`, body: `${n} exercise${n === 1 ? '' : 's'} · ${routineTotalSets(r)} sets planned`,
    });
  }
  const s = DB.settings();
  if (s.fridayReminderEnabled) {
    events.push({ uid: 'gymos-weekly-stats@gymos', weekday: 6, minutes: s.fridayReminderMinutes, title: 'Weekly update', body: 'Update your body weight and personal stats for this week.' });
  }
  return events;
}

export function remindersICS() {
  const now = new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GymOS//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:GymOS'];
  for (const e of reminderEvents()) {
    const start = nextOccurrence(e.weekday, e.minutes);
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsUTC(now)}`, `DTSTART:${icsLocal(start)}`, 'DURATION:PT15M',
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[e.weekday - 1]}`, `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(e.body)}`,
      'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export { todayKey, fmt };
