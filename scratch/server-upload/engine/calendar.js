/**
 * Kalender-Hilfsfunktionen der Planungsengine.
 *
 * Alle Datumsangaben werden intern als ISO-Datumsstring 'YYYY-MM-DD' gefuehrt.
 * Es wird bewusst NICHT mit Date-Objekten/Zeitzonen gerechnet, damit die Engine
 * deterministisch und zeitzonenunabhaengig ist.
 */

const MS_PER_DAY = 86400000;

/** @param {string} iso @returns {number} UTC-Timestamp */
function ts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** @param {number} t @returns {string} */
function isoFromTs(t) {
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Prueft ein ISO-Datum auf Gueltigkeit. @param {any} iso @returns {boolean} */
export function isValidDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return isoFromTs(ts(iso)) === iso;
}

/** @param {string} iso @param {number} days @returns {string} */
export function addDays(iso, days) {
  return isoFromTs(ts(iso) + days * MS_PER_DAY);
}

/** @param {string} iso @param {number} weeks @returns {string} */
export function addWeeks(iso, weeks) {
  return addDays(iso, weeks * 7);
}

/** Differenz in Kalendertagen (b - a). @param {string} a @param {string} b @returns {number} */
export function diffDays(a, b) {
  return Math.round((ts(b) - ts(a)) / MS_PER_DAY);
}

/** ISO-Wochentag: 1 = Montag ... 7 = Sonntag. @param {string} iso @returns {number} */
export function weekday(iso) {
  const wd = new Date(ts(iso)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** @param {string} a @param {string} b @returns {string} */
export function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return ts(a) <= ts(b) ? a : b;
}

/** @param {string} a @param {string} b @returns {string} */
export function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return ts(a) >= ts(b) ? a : b;
}

/** @param {string} a @param {string} b @returns {number} -1 | 0 | 1 */
export function cmpDate(a, b) {
  return ts(a) === ts(b) ? 0 : ts(a) < ts(b) ? -1 : 1;
}

/**
 * ISO-Kalenderwoche als Objekt.
 * @param {string} iso
 * @returns {{year:number, week:number, key:string}}
 */
export function isoWeek(iso) {
  const t = ts(iso);
  const d = new Date(t);
  // Donnerstag der laufenden Woche bestimmt das ISO-Jahr
  const wd = weekday(iso);
  const thursday = new Date(t + (4 - wd) * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / MS_PER_DAY / 7) + 1;
  void d;
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}` };
}

/** Kurzschreibweise 'KW41'. @param {string} iso @returns {string} */
export function weekKey(iso) {
  return isoWeek(iso).key;
}

/** @param {string} key z.B. '2026-W41' @returns {string} Montag dieser Woche */
export function weekStart(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(key);
  if (!m) throw new Error(`Ungueltiger Wochenschluessel: ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // 4. Januar liegt immer in KW1
  const jan4 = `${year}-01-04`;
  const mondayOfWeek1 = addDays(jan4, -(weekday(jan4) - 1));
  return addDays(mondayOfWeek1, (week - 1) * 7);
}

/** @param {string} iso @returns {string} Montag der Woche */
export function mondayOf(iso) {
  return addDays(iso, -(weekday(iso) - 1));
}

/**
 * Liste aller Kalendertage von..bis (inklusive).
 * @param {string} from @param {string} to @returns {string[]}
 */
export function dateRange(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cmpDate(cur, to) <= 0) {
    out.push(cur);
    cur = addDays(cur, 1);
    if (++guard > 20000) throw new Error('dateRange: Bereich zu gross');
  }
  return out;
}

/** Formatiert 'YYYY-MM-DD' als 'TT.MM.JJJJ'. @param {string} iso @returns {string} */
export function formatDE(iso) {
  if (!isValidDate(iso)) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Parst 'TT.MM.JJJJ' oder 'YYYY-MM-DD' zu ISO. @param {string} v @returns {string|null} */
export function parseDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (isValidDate(s)) return s;
  const m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}

export const WEEKDAY_NAMES = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WEEKDAY_SHORT = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
