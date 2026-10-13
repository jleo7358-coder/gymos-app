// On-device storage (IndexedDB) with an in-memory mirror for instant reads.
// Every change is written straight away; nothing ever leaves the phone.

const DB_NAME = 'gymos';
const DB_VERSION = 1;
export const STORES = ['exercises', 'routines', 'sessions', 'bodyStats', 'prs', 'backups', 'kv'];
const DATA_STORES = ['exercises', 'routines', 'sessions', 'bodyStats', 'prs'];

let db = null;
let pending = new Set();
let lastError = null;

/** In-memory mirror. Backups keep metadata only; the bytes stay in IndexedDB. */
export const state = {
  exercises: new Map(),
  routines: new Map(),
  sessions: new Map(),
  bodyStats: new Map(),
  prs: new Map(),
  backups: new Map(),
  kv: new Map(),
};

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function runTransaction(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(stores, mode, { durability: 'strict' }); }
    catch (e) {
      if (e && e.name === 'TypeError') { try { t = db.transaction(stores, mode); } catch (e2) { reject(e2); return; } }
      else { reject(e); return; }
    }
    try { fn(t); } catch (e) { try { t.abort(); } catch {} reject(e); return; }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

const isConnectionError = (e) => !db || (e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(e.message || '')));

/** Runs a transaction; if iOS dropped the database connection (common after the phone sleeps),
 *  reopens it and retries once. Writes always use the current in-memory records. */
async function transaction(stores, mode, fn) {
  try {
    if (!db) await reconnect();
    return await runTransaction(stores, mode, fn);
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    await reconnect();
    return runTransaction(stores, mode, fn);
  }
}

let reconnecting = null;
function reconnect() {
  if (!reconnecting) {
    reconnecting = openConnection().then((d) => { db = d; }).finally(() => { reconnecting = null; });
  }
  return reconnecting;
}

function openConnection() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
      }
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      d.onclose = () => { if (db === d) db = null; };
      resolve(d);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database is blocked by another open copy of GymOS.'));
  });
}

function track(p) {
  pending.add(p);
  p.then(() => { lastError = null; }, (e) => {
    lastError = e;
    window.dispatchEvent(new CustomEvent('gymos-save-error', { detail: e }));
  }).finally(() => pending.delete(p));
  return p;
}

export async function open() {
  db = await openConnection();
  const t = db.transaction(STORES, 'readonly');
  const loads = STORES.map(async (s) => {
    const rows = await req(t.objectStore(s).getAll());
    for (const row of rows) {
      if (s === 'kv') state.kv.set(row.key, row.value);
      else if (s === 'backups') { const { bytes, ...meta } = row; state.backups.set(row.id, meta); }
      else state[s].set(row.id, row);
    }
  });
  await Promise.all(loads);
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}

export function put(store, obj) {
  state[store].set(obj.id, obj);
  return track(transaction([store], 'readwrite', (t) => t.objectStore(store).put(obj)));
}

export function remove(store, id) {
  state[store].delete(id);
  return track(transaction([store], 'readwrite', (t) => t.objectStore(store).delete(id)));
}

/** Many puts/deletes in one atomic transaction. ops: [{store, put?: obj, del?: id}] */
export function batch(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return Promise.resolve();
  for (const o of ops) {
    if (o.put) state[o.store].set(o.put.id, o.put);
    else state[o.store].delete(o.del);
  }
  return track(transaction(stores, 'readwrite', (t) => {
    for (const o of ops) {
      const s = t.objectStore(o.store);
      if (o.put) s.put(o.put); else s.delete(o.del);
    }
  }));
}

/** Replace every app-owned record (used by backup import). Written first; memory is only
 *  swapped once the database has committed, so a failed import changes nothing. */
export async function replaceAllData(collections) {
  await transaction(DATA_STORES, 'readwrite', (t) => {
    for (const s of DATA_STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const r of collections[s] || []) os.put(r);
    }
  });
  for (const s of DATA_STORES) state[s].clear();
  for (const s of DATA_STORES) for (const r of collections[s] || []) state[s].set(r.id, r);
}

export function clearStore(store) {
  state[store].clear();
  return track(transaction([store], 'readwrite', (t) => t.objectStore(store).clear()));
}

export function getKV(key, fallback) { return state.kv.has(key) ? state.kv.get(key) : fallback; }
export function setKV(key, value) {
  state.kv.set(key, value);
  return track(transaction(['kv'], 'readwrite', (t) => t.objectStore('kv').put({ key, value })));
}

// Backups (bytes kept only in IndexedDB)
export function putBackup(meta, bytes) {
  state.backups.set(meta.id, meta);
  return track(transaction(['backups'], 'readwrite', (t) => t.objectStore('backups').put({ ...meta, bytes })));
}
export async function getBackupBytes(id) {
  if (!db) await reconnect();
  const row = await new Promise((resolve, reject) => {
    const t = db.transaction(['backups'], 'readonly');
    const r = t.objectStore('backups').get(id);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return row ? row.bytes : null;
}

export function flush() { return Promise.allSettled([...pending]); }
export function lastSaveError() { return lastError; }
export const isOpen = () => !!db;

// ---------------------------------------------------------------------------------
// Settings (stored in kv). Same keys/defaults as the iPhone app.

export const DEFAULT_SETTINGS = {
  increments: [1, 2.5, 5],
  defaultRestSeconds: 90,
  restAlertEnabled: true,
  fridayReminderEnabled: true,
  fridayReminderMinutes: 18 * 60,
  timerWidgetX: 0.84,
  timerWidgetY: 0.86,
  timerWidgetMinimized: false,
  keepAwakeDuringWorkout: false,
  prefillFromLast: true,
};

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(getKV('settings', {}) || {}) };
}
export function updateSettings(patch) {
  const next = { ...settings(), ...patch };
  return setKV('settings', next);
}
export function resetSettings() { return setKV('settings', { ...DEFAULT_SETTINGS }); }

export function signedIncrements(override) {
  if (override && override > 0) return [-override * 2, -override, override, override * 2];
  const pos = settings().increments.filter((x) => x > 0).sort((a, b) => a - b);
  return [...pos].reverse().map((x) => -x).concat(pos);
}

/** Settings as the string dictionary used inside backup files. */
export function exportSettingsDictionary() {
  const s = settings();
  return {
    increments: s.increments.map(String).join(','),
    defaultRestSeconds: String(s.defaultRestSeconds),
    restAlertEnabled: String(s.restAlertEnabled),
    liveActivityEnabled: 'true',
    fridayReminderEnabled: String(s.fridayReminderEnabled),
    fridayReminderMinutes: String(s.fridayReminderMinutes),
    keepAwakeDuringWorkout: String(s.keepAwakeDuringWorkout),
    prefillFromLast: String(s.prefillFromLast),
  };
}
export function applySettingsDictionary(d = {}) {
  const patch = {};
  if (d.increments) {
    const v = d.increments.split(',').map(Number).filter((x) => Number.isFinite(x) && x > 0);
    if (v.length) patch.increments = v;
  }
  const int = (k) => { const v = parseInt(d[k], 10); if (Number.isFinite(v)) patch[k] = v; };
  const bool = (k) => { if (d[k] === 'true' || d[k] === 'false') patch[k] = d[k] === 'true'; };
  int('defaultRestSeconds'); int('fridayReminderMinutes');
  bool('restAlertEnabled'); bool('fridayReminderEnabled'); bool('keepAwakeDuringWorkout'); bool('prefillFromLast');
  return updateSettings(patch);
}

export const demo = {
  get active() { return !!getKV('demo.active', false); },
  set active(v) { setKV('demo.active', !!v); },
  get toolsHidden() { return !!getKV('demo.toolsHidden', false); },
  set toolsHidden(v) { setKV('demo.toolsHidden', !!v); },
};

/** Test hook: simulates iOS dropping the database connection. */
export function __simulateConnectionLoss() { if (db) db.close(); }
