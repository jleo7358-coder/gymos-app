// Dates, formatting and small helpers. All day logic uses the device's local time zone.
// Weekdays use the same numbering as the iPhone app: 1 = Sunday ... 7 = Saturday.

export const MS_DAY = 86400000;
const LOCALE = 'en-GB';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase();
}

export const pad2 = (n) => String(n).padStart(2, '0');

export function toDate(x) { return x instanceof Date ? x : new Date(x); }

/** 'YYYY-MM-DD' in local time. */
export function dayKey(x = Date.now()) {
  const d = toDate(x);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayKey = () => dayKey(new Date());
export function startOfDay(x) { const d = toDate(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(x, n) { const d = startOfDay(x); d.setDate(d.getDate() + n); return d; }
export function addDaysKey(key, n) { return dayKey(addDays(parseDay(key), n)); }
export function setTime(x, hour, minute) { const d = startOfDay(x); d.setHours(hour, minute, 0, 0); return d; }
export function isToday(x) { return dayKey(x) === todayKey(); }
/** 1 = Sunday ... 7 = Saturday */
export function weekday(x) { return (typeof x === 'string' ? parseDay(x) : toDate(x)).getDay() + 1; }
export function daysBetween(a, b) {
  const ka = typeof a === 'string' ? parseDay(a) : startOfDay(a);
  const kb = typeof b === 'string' ? parseDay(b) : startOfDay(b);
  return Math.round((kb - ka) / MS_DAY);
}
/** Weeks start on Monday (UK). */
export const ORDERED_WEEKDAYS = [2, 3, 4, 5, 6, 7, 1];
export function startOfWeek(x) {
  const d = startOfDay(x);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d;
}
export function startOfMonth(x) { const d = toDate(x); return new Date(d.getFullYear(), d.getMonth(), 1); }
export function addMonths(x, n) { const d = startOfMonth(x); d.setMonth(d.getMonth() + n); return d; }
export function endOfMonth(x) { return addDays(addMonths(x, 1), -1); }
export function daysInRange(fromKey, toKey) {
  const out = [];
  let d = parseDay(fromKey);
  const end = parseDay(toKey);
  while (d <= end) { out.push(dayKey(d)); d.setDate(d.getDate() + 1); }
  return out;
}

const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekdayName(wd, short = false) {
  const i = Math.max(0, Math.min(6, wd - 1));
  return short ? WD_SHORT[i] : WD_LONG[i];
}

const nf = {};
function numberFormat(dec) {
  if (!nf[dec]) nf[dec] = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: dec });
  return nf[dec];
}
const dtf = (opts) => new Intl.DateTimeFormat(LOCALE, opts);
const F_DAY_MONTH = dtf({ day: 'numeric', month: 'short' });
const F_DAY_MONTH_YEAR = dtf({ day: 'numeric', month: 'short', year: 'numeric' });
const F_WD_DAY_MONTH = dtf({ weekday: 'short', day: 'numeric', month: 'short' });
const F_FULL = dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const F_MONTH_YEAR = dtf({ month: 'long', year: 'numeric' });
const F_TIME = dtf({ hour: '2-digit', minute: '2-digit' });

const asDate = (x) => (typeof x === 'string' ? parseDay(x) : toDate(x));

export const fmt = {
  number(v, dec = 1) { return numberFormat(dec).format(v); },
  integer(v) { return numberFormat(0).format(Math.round(v)); },
  kg(v) { return numberFormat(2).format(v) + ' kg'; },
  /** Locale-independent value for editable fields. */
  editable(v) {
    const r = Math.round(v * 100) / 100;
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  },
  target(sets, repMin, repMax) { return repMin === repMax ? `${sets} × ${repMin}` : `${sets} × ${repMin}–${repMax}`; },
  duration(sec) {
    const t = Math.max(0, Math.round(sec));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  },
  minutes(sec) {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  },
  feetInches(total) {
    const feet = Math.floor(total / 12);
    const inches = Math.round(total - feet * 12);
    return `${feet}′ ${inches}″`;
  },
  dayMonth(x) { return F_DAY_MONTH.format(asDate(x)); },
  dayMonthYear(x) { return F_DAY_MONTH_YEAR.format(asDate(x)); },
  weekdayDayMonth(x) { return F_WD_DAY_MONTH.format(asDate(x)); },
  fullDate(x) { return F_FULL.format(asDate(x)); },
  monthYear(x) { return F_MONTH_YEAR.format(asDate(x)); },
  time(x) { return F_TIME.format(asDate(x)); },
  reminderTime(minutes) { return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`; },
  bytes(n) {
    if (n < 1000) return `${n} bytes`;
    if (n < 1e6) return `${numberFormat(0).format(n / 1000)} KB`;
    return `${numberFormat(1).format(n / 1e6)} MB`;
  },
};

export function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse a user-typed decimal ("62,5" or "62.5"). Returns null when empty or invalid. */
export function parseDecimal(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function minutesToTimeInput(m) { return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; }
export function timeInputToMinutes(v, fallback) {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export function maxBy(arr, better) {
  let best = undefined;
  for (const x of arr) if (best === undefined || better(x, best)) best = x;
  return best;
}
