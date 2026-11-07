// Food & nutrition storage. A completely separate IndexedDB database ("gymos-food"), so the
// workout database is never opened for writing, upgraded or migrated by anything in here.

const DB_NAME = 'gymos-food';
const DB_VERSION = 1;
export const STORES = ['foods', 'entries', 'meals', 'days', 'kv'];
export const DATA_STORES = ['foods', 'entries', 'meals', 'days'];
const KEY_PATH = { foods: 'id', entries: 'id', meals: 'id', days: 'day', kv: 'key' };

let db = null;
let available = false;
const pending = new Set();

/** In-memory mirror for instant reads. */
export const state = {
  foods: new Map(),
  entries: new Map(),
  meals: new Map(),
  days: new Map(),
  kv: new Map(),
};

const keyOf = (store, obj) => obj[KEY_PATH[store]];

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function openConnection() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KEY_PATH[s] });
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      d.onclose = () => { if (db === d) db = null; };
      resolve(d);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Food storage is blocked by another open copy of GymOS.'));
  });
}

function runTransaction(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(stores, mode); } catch (e) { reject(e); return; }
    try { fn(t); } catch (e) { try { t.abort(); } catch {} reject(e); return; }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

const isConnectionError = (e) => !db || (e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(e.message || '')));
let reconnecting = null;
function reconnect() {
  if (!reconnecting) reconnecting = openConnection().then((d) => { db = d; }).finally(() => { reconnecting = null; });
  return reconnecting;
}
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

function track(p) {
  pending.add(p);
  p.catch((e) => window.dispatchEvent(new CustomEvent('gymos-save-error', { detail: e }))).finally(() => pending.delete(p));
  return p;
}

export async function open() {
  db = await openConnection();
  const t = db.transaction(STORES, 'readonly');
  await Promise.all(STORES.map(async (s) => {
    const rows = await req(t.objectStore(s).getAll());
    for (const row of rows) {
      if (s === 'kv') state.kv.set(row.key, row.value);
      else state[s].set(keyOf(s, row), row);
    }
  }));
  available = true;
}
export const isAvailable = () => available;

export function put(store, obj) {
  state[store].set(keyOf(store, obj), obj);
  return track(transaction([store], 'readwrite', (t) => t.objectStore(store).put(obj)));
}
export function remove(store, key) {
  state[store].delete(key);
  return track(transaction([store], 'readwrite', (t) => t.objectStore(store).delete(key)));
}
/** ops: [{store, put?: obj, del?: key}] in one atomic transaction. */
export function batch(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return Promise.resolve();
  for (const o of ops) {
    if (o.put) state[o.store].set(keyOf(o.store, o.put), o.put);
    else state[o.store].delete(o.del);
  }
  return track(transaction(stores, 'readwrite', (t) => {
    for (const o of ops) { const s = t.objectStore(o.store); if (o.put) s.put(o.put); else s.delete(o.del); }
  }));
}
/** Replace the given stores (backup import). Memory is swapped only after the commit. */
export async function replaceStores(collections) {
  const stores = Object.keys(collections).filter((s) => DATA_STORES.includes(s));
  if (!stores.length) return;
  await transaction(stores, 'readwrite', (t) => {
    for (const s of stores) {
      const os = t.objectStore(s);
      os.clear();
      for (const r of collections[s] || []) os.put(r);
    }
  });
  for (const s of stores) {
    state[s].clear();
    for (const r of collections[s] || []) state[s].set(keyOf(s, r), r);
  }
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
export function deleteKV(key) {
  state.kv.delete(key);
  return track(transaction(['kv'], 'readwrite', (t) => t.objectStore('kv').delete(key)));
}

export function flush() { return Promise.allSettled([...pending]); }
