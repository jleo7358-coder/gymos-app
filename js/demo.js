// ~5 weeks of realistic fake data for testing every screen. Everything is flagged isDemo
// and the reset removes it all. Never called automatically.

import * as DB from './db.js';
import { Q, S, PR, Engine, changed, hasDemoData, routineItems } from './engine.js';
import { uuid, dayKey, todayKey, startOfWeek, addDays, setTime, weekday } from './util.js';
import { state } from './db.js';

function rngFactory(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadDemo() {
  if (hasDemoData()) return;
  DB.demo.active = true;
  const rand = rngFactory(20260918);
  const rint = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const today = new Date();
  const todayK = todayKey();
  const weekStart0 = startOfWeek(addDays(today, -28));
  const ops = [];
  const put = (store, obj) => { state[store].set(obj.id, obj); ops.push({ store, put: obj }); };

  const ex = (name, mg, eq) => {
    const e = { id: uuid(), name, muscleGroup: mg, equipment: eq, customIncrement: null, createdAt: weekStart0.getTime(), isArchived: false, isDemo: true };
    put('exercises', e);
    return e;
  };
  const bench = ex('Bench Press', 'Chest', 'Barbell');
  const incline = ex('Incline Dumbbell Press', 'Chest', 'Dumbbell');
  const row = ex('Bent Over Row', 'Back', 'Barbell');
  const pulldown = ex('Lat Pulldown', 'Back', 'Cable');
  const ohp = ex('Shoulder Press', 'Shoulders', 'Barbell');
  const lateral = ex('Lateral Raise', 'Shoulders', 'Dumbbell');
  const curl = ex('Bicep Curl', 'Arms', 'Dumbbell');
  const pushdown = ex('Tricep Pushdown', 'Arms', 'Cable');
  const squat = ex('Squat', 'Legs', 'Barbell');
  const rdl = ex('Romanian Deadlift', 'Legs', 'Barbell');
  const legPress = ex('Leg Press', 'Legs', 'Machine');
  const legCurl = ex('Leg Curl', 'Legs', 'Machine');

  // Lateral Raise deliberately never progresses (stall example).
  const progression = new Map([
    [bench.id, [57.5, 57.5, 60, 60, 62.5, 65, 65]], [incline.id, [22, 22, 24, 24, 26, 26]],
    [row.id, [60, 60, 62.5, 65, 65, 67.5]], [pulldown.id, [55, 55, 57.5, 57.5, 60, 60]],
    [ohp.id, [35, 35, 35, 37.5, 37.5, 37.5, 40, 40, 40, 42.5]], [lateral.id, [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]],
    [curl.id, [12, 12, 14, 14, 14, 14, 16]], [pushdown.id, [25, 25, 27.5, 27.5, 30, 30, 30]],
    [squat.id, [80, 82.5, 85, 90, 92.5, 95]], [rdl.id, [70, 72.5, 75, 77.5, 80, 82.5]],
    [legPress.id, [140, 140, 150, 150, 160, 170]], [legCurl.id, [40, 40, 45, 45, 45, 50]],
  ]);
  const performed = new Map();

  // Mon / Wed / Fri — deliberately NOT the user's own schedule.
  const routine = (name, wd, items) => {
    const r = {
      id: uuid(), name, weekday: wd, scheduleStart: dayKey(weekStart0), reminderEnabled: wd != null, reminderMinutes: 16 * 60 + 30,
      createdAt: weekStart0.getTime() + Object.keys(ops).length, isDemo: true,
      items: items.map(([e, sets, rmin, rmax], i) => ({ id: uuid(), order: i, exerciseId: e.id, name: e.name, sets, repMin: rmin, repMax: rmax, targetWeight: null })),
    };
    put('routines', r);
    return r;
  };
  const upperA = routine('Upper A', 2, [[bench, 3, 6, 8], [row, 3, 6, 8], [ohp, 2, 6, 10], [lateral, 3, 10, 12], [pushdown, 2, 10, 12]]);
  const lower = routine('Lower', 4, [[squat, 3, 5, 6], [rdl, 3, 8, 10], [legPress, 3, 10, 12], [legCurl, 3, 10, 12]]);
  const upperB = routine('Upper B', 6, [[incline, 3, 8, 10], [pulldown, 3, 8, 10], [ohp, 3, 6, 8], [curl, 3, 10, 12], [lateral, 2, 12, 15]]);
  const arms = routine('Arms', null, [[curl, 3, 10, 12], [pushdown, 3, 10, 12], [lateral, 3, 12, 15]]);

  const plan = [
    { 2: 'c', 4: 'c', 6: 'c' }, { 2: 'c', 4: 'p', 6: 'c' }, { 2: 'c', 4: 'm', 6: 'c' },
    { 2: 'p', 4: 'c', 6: 'c' }, { 2: 'c', 4: 'c', 6: 'c' },
  ];

  const buildSession = (r, day, outcome, extra) => {
    const start = setTime(day, 17 + rint(0, 1), rint(0, 45)).getTime();
    const s = { id: uuid(), startDate: start, endDate: null, day: dayKey(day), routineId: r.id, routineName: r.name, status: 'active', isExtra: extra, isDemo: true, exercises: [] };
    const items = routineItems(r);
    const stopAfter = outcome === 'p' ? Math.max(1, Math.floor(items.length / 2)) : items.length;
    let clock = start + rint(120, 300) * 1000;
    items.forEach((item, i) => {
      const n = performed.get(item.exerciseId) || 0;
      const list = progression.get(item.exerciseId) || [20];
      const weight = list[Math.min(n, list.length - 1)];
      performed.set(item.exerciseId, n + 1);
      const se = { id: uuid(), order: i, exerciseId: item.exerciseId, name: item.name, targetSets: item.sets, repMin: item.repMin, repMax: item.repMax, sets: [] };
      for (let k = 0; k < item.sets; k++) {
        let reps = rint(item.repMin, item.repMax);
        if (k === item.sets - 1 && rint(0, 2) === 0) reps = Math.max(item.repMin - 1, reps - 1);
        const complete = i < stopAfter || (i === stopAfter && outcome === 'p' && k === 0);
        let doneAt = null;
        if (complete) { clock += rint(75, 150) * 1000; doneAt = clock; }
        se.sets.push({ id: uuid(), index: k, weight, reps, done: complete, doneAt });
      }
      s.exercises.push(se);
    });
    s.endDate = clock + rint(60, 240) * 1000;
    s.status = S.isFullyCompleted(s) ? 'completed' : 'partial';
    state.sessions.set(s.id, s);
    ops.push({ store: 'sessions', put: s });
    for (const p of PR.detect(s)) put('prs', p);
  };

  for (let week = 0; week < 5; week++) {
    const dayPlan = plan[week];
    for (const wdStr of Object.keys(dayPlan).sort()) {
      const wd = Number(wdStr);
      const outcome = dayPlan[wd];
      const day = addDays(weekStart0, week * 7 + ((wd - weekday(weekStart0) + 7) % 7));
      if (dayKey(day) >= todayK || outcome === 'm') continue;
      buildSession(wd === 2 ? upperA : wd === 4 ? lower : upperB, day, outcome, false);
    }
    if (week === 1 || week === 3) {
      const day = addDays(weekStart0, week * 7 + (week === 1 ? 5 : 6));
      if (dayKey(day) < todayK) buildSession(arms, day, 'c', true);
    }
  }

  const weights = [82.4, 82.0, 81.9, 81.5, 81.6];
  const bodyFat = [17.8, 17.7, 17.6, 17.5, 17.5];
  const waist = [84.0, 83.5, 83.5, 83.0, 82.5];
  weights.forEach((w, i) => {
    const friday = addDays(weekStart0, i * 7 + ((6 - weekday(weekStart0) + 7) % 7));
    if (dayKey(friday) > todayK) return;
    put('bodyStats', {
      id: uuid(), date: setTime(friday, 18, 5).getTime(), weightKg: w, heightInches: 71, age: 27,
      bodyFatPercent: bodyFat[i], waistCm: waist[i], note: i === 0 ? 'Morning, before breakfast' : null, isDemo: true,
    });
  });

  await DB.batch(ops);
  changed();
}

export async function resetDemo() {
  Engine.externalDataWiped();
  const ops = [];
  for (const store of ['sessions', 'routines', 'exercises', 'bodyStats', 'prs']) {
    for (const r of state[store].values()) if (r.isDemo) ops.push({ store, del: r.id });
  }
  await DB.batch(ops);
  DB.demo.active = false;
  DB.demo.toolsHidden = true;
  changed();
}

export { Q };
