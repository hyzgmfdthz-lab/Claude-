/**
 * Einlesen einer Anwesenheitsmatrix (Urlaubsplanung).
 *
 * Anders als bei der Tagesliste der Abteilungsleitung wird hier NICHT um 1
 * korrigiert: Die Urlaubstabelle zaehlt Personen, sie rechnet nicht
 * (Auskunft 15.09.2026: "nein, nicht fuer die Urlaubstabelle").
 *
 * Die Abteilung fuehrt die Urlaubsplanung als Tabelle: oben die Kalendertage,
 * darunter je Person eine Zeile mit Kuerzeln (T = da, A = abwesend, weitere
 * Kuerzel sind moeglich). Genau diese Tabelle laesst sich hier einfuegen -
 * abgetippt wird nichts.
 *
 * Bewusste Zurueckhaltung an drei Stellen:
 *   1. Welche Zeile zu welchem Kuerzel gehoert, sagt die Tabelle nicht. Der
 *      Einleser ordnet nichts von sich aus zu, sondern gibt die Zeilen mit
 *      ihren Zahlen zurueck, damit die Zuordnung in der Oberflaeche erfolgt.
 *   2. Unbekannte Kuerzel (zum Beispiel "DM") werden nicht geraten, sondern
 *      gemeldet - wie sie zu rechnen sind, entscheidet der Anwender.
 *   3. Leere Felder sind keine Abwesenheit. Sie sind Wochenenden, Feiertage
 *      oder einfach nicht gepflegt.
 */

import { addDays, isoWeek, weekday } from './calendar.js';

/** Bekannte Kuerzel und ihre Bedeutung. */
export const CODES = {
  T: { anwesend: true, label: 'anwesend' },
  A: { anwesend: false, label: 'abwesend', kind: 'URLAUB' },
  /**
   * Demontage: die Person ist an eine andere Abteilung verliehen
   * (Auskunft der Abteilungsleitung 15.09.2026). Sie steht dem
   * Armaturenbau an diesen Tagen nicht zur Verfuegung - fuer die
   * Kapazitaet zaehlt das wie eine Abwesenheit, ist aber eine eigene
   * Art, weil es keine Abwesenheit im Sinne von Urlaub ist.
   */
  DM: { anwesend: false, label: 'Demontage (an andere Abteilung verliehen)', kind: 'VERLEIH' },
  U: { anwesend: false, label: 'Urlaub', kind: 'URLAUB' },
  K: { anwesend: false, label: 'krank', kind: 'KRANK' },
  S: { anwesend: false, label: 'Schulung', kind: 'SCHULUNG' },
  X: { anwesend: false, label: 'abwesend', kind: 'SONST' },
};

/**
 * Liest eine eingefuegte Matrix.
 *
 * @param {string} text  Inhalt aus der Zwischenablage (Tabulatoren oder Semikolon)
 * @param {{year?:number, codes?:Record<string, boolean>}} [opts]
 *   year  - Jahr fuer Datumsangaben ohne Jahr (Vorgabe: laufendes Planjahr)
 *   codes - Deutung zusaetzlicher Kuerzel: true = anwesend, false = abwesend
 * @returns {{dates:string[], from:string, to:string, rows:any[],
 *   unknownCodes:{code:string, count:number, rows:number[]}[],
 *   warnings:string[], workdays:number, weekendFilled:number}}
 */
export function parseAttendanceMatrix(text, opts = {}) {
  const jahr = Number(opts.year) || new Date().getUTCFullYear();
  const deutung = opts.codes ?? {};
  const zeilen = String(text ?? '').replace(/\r/g, '').split('\n');
  const trenner = zeilen.some((z) => z.includes('\t')) ? '\t' : ';';
  const felder = zeilen.map((z) => z.split(trenner).map((f) => f.trim()));

  /* ---- Kopfzeile finden: die Zeile mit den meisten Datumsangaben ---- */
  let kopfIndex = -1;
  let beste = 0;
  for (let i = 0; i < felder.length; i++) {
    const treffer = felder[i].filter((f) => parseDay(f, jahr)).length;
    if (treffer > beste) { beste = treffer; kopfIndex = i; }
  }
  if (kopfIndex < 0 || beste < 3) {
    throw new Error('Keine Kopfzeile mit Datumsangaben gefunden. '
      + 'Erwartet wird eine Zeile wie "15.09.  16.09.  17.09. …".');
  }

  /* ---- Spalten auf Datumsangaben abbilden ---- */
  /** @type {{col:number, date:string}[]} */
  const spalten = [];
  for (let c = 0; c < felder[kopfIndex].length; c++) {
    const d = parseDay(felder[kopfIndex][c], jahr);
    if (d) spalten.push({ col: c, date: d });
  }
  const dates = spalten.map((s) => s.date);
  const warnings = [];

  // Jahreswechsel: laufen die Tage rueckwaerts, beginnt ein neues Jahr
  for (let i = 1; i < spalten.length; i++) {
    if (spalten[i].date < spalten[i - 1].date) {
      warnings.push(`Die Spalte ${felder[kopfIndex][spalten[i].col]} liegt vor der vorherigen `
        + 'Spalte. Vermutlich beginnt dort ein neues Jahr – bitte das Jahr angeben.');
      break;
    }
  }

  /* ---- Datenzeilen ---- */
  const rows = [];
  const unbekannt = new Map();
  let wochenendeGefuellt = 0;
  for (let i = kopfIndex + 1; i < felder.length; i++) {
    /** @type {Record<string, string>} */
    const codes = {};
    let inhalte = 0;
    let zahlen = 0;
    for (const s of spalten) {
      const roh = felder[i][s.col] ?? '';
      if (roh === '') continue;
      inhalte++;
      if (/^-?\d+([.,]\d+)?$/.test(roh)) { zahlen++; continue; }
      codes[s.date] = roh.toUpperCase();
    }
    // Leerzeilen und reine Zahlenzeilen (etwa Summen) uebergehen
    if (inhalte === 0 || Object.keys(codes).length === 0) continue;
    if (zahlen > 0 && Object.keys(codes).length === 0) continue;

    const zaehler = { anwesend: 0, abwesend: 0, unbekannt: 0 };
    for (const [d, code] of Object.entries(codes)) {
      const bekannt = CODES[code];
      const eigen = Object.prototype.hasOwnProperty.call(deutung, code) ? deutung[code] : null;
      if (bekannt) {
        if (bekannt.anwesend) zaehler.anwesend++; else zaehler.abwesend++;
      } else if (eigen !== null) {
        if (eigen) zaehler.anwesend++; else zaehler.abwesend++;
      } else {
        zaehler.unbekannt++;
        const e = unbekannt.get(code) ?? { code, count: 0, rows: [] };
        e.count++;
        if (!e.rows.includes(rows.length + 1)) e.rows.push(rows.length + 1);
        unbekannt.set(code, e);
      }
      if (weekday(d) > 5) wochenendeGefuellt++;
    }

    rows.push({
      /** Zeilennummer in der eingefuegten Tabelle (1-basiert, ohne Leerzeilen) */
      index: rows.length + 1,
      /** Zeilennummer in der Ursprungsdatei - hilft beim Wiedererkennen */
      sourceLine: i + 1,
      /** Vorschlag fuer die Bezeichnung, bis die Zuordnung erfolgt ist */
      label: `Zeile ${rows.length + 1}`,
      codes,
      days: Object.keys(codes).length,
      ...zaehler,
      /** Zusammenhaengende Abwesenheiten als Zeitraeume */
      absences: intervals(codes, deutung),
    });
  }

  if (rows.length === 0) throw new Error('Unter der Kopfzeile stehen keine Anwesenheitszeilen.');

  const arbeitstage = dates.filter((d) => weekday(d) <= 5).length;
  if (wochenendeGefuellt > 0) {
    warnings.push(`${wochenendeGefuellt} Einträge liegen auf einem Samstag oder Sonntag. `
      + 'Das kann stimmen (Sonderschicht), ist aber meist ein Zeichen für verschobene Spalten.');
  }
  const ungleich = rows.filter((r) => r.days !== rows[0].days).length;
  if (ungleich > 0) {
    warnings.push(`${ungleich} von ${rows.length} Zeilen haben eine andere Anzahl gepflegter Tage `
      + `als die erste Zeile (${rows[0].days}). Bitte prüfen, ob dort Tage fehlen.`);
  }

  return {
    dates,
    from: dates[0],
    to: dates[dates.length - 1],
    workdays: arbeitstage,
    rows,
    unknownCodes: [...unbekannt.values()].sort((a, b) => b.count - a.count),
    weekendFilled: wochenendeGefuellt,
    warnings,
  };
}

/**
 * Zusammenhaengende Abwesenheiten einer Zeile.
 * Ein Wochenende zwischen zwei Abwesenheitstagen unterbricht den Zeitraum
 * nicht - sonst entstuenden aus einer Urlaubswoche zwei Eintraege.
 * @param {Record<string,string>} codes
 * @param {Record<string, boolean>} deutung
 */
function intervals(codes, deutung = {}) {
  const tage = Object.keys(codes).sort();
  const out = [];
  /** @type {any} */
  let offen = null;
  const artOf = (code) => CODES[code]?.kind ?? 'URLAUB';
  const abwesend = (code) => {
    const b = CODES[code];
    if (b) return !b.anwesend;
    if (Object.prototype.hasOwnProperty.call(deutung, code)) return !deutung[code];
    return false;
  };
  for (const d of tage) {
    const code = codes[d];
    if (!abwesend(code)) { if (offen) { out.push(offen); offen = null; } continue; }
    const art = artOf(code);
    if (offen && offen.kind === art && bruecke(offen.to, d)) {
      offen.to = d;
      offen.days++;
    } else {
      if (offen) out.push(offen);
      offen = { from: d, to: d, kind: art, code, days: 1 };
    }
  }
  if (offen) out.push(offen);
  return out;
}

/** Liegen zwei Tage unmittelbar hintereinander (Wochenende uebersprungen)? */
function bruecke(vorher, nachher) {
  for (let n = 1; n <= 3; n++) {
    const d = addDays(vorher, n);
    if (d === nachher) return true;
    if (weekday(d) <= 5) return false;
  }
  return false;
}

/**
 * Datumsangabe einer Kopfspalte lesen.
 * Zugelassen sind '15.09.', '15.09.2026', '2026-09-15' und '15.9.'.
 * @param {string} feld @param {number} jahr
 * @returns {string|null} ISO-Datum
 */
export function parseDay(feld, jahr) {
  const s = String(feld ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(s);
  if (m) return iso(jahr, Number(m[2]), Number(m[1]));
  return null;
}

function iso(j, mo, t) {
  if (mo < 1 || mo > 12 || t < 1 || t > 31) return null;
  const d = new Date(Date.UTC(j, mo - 1, t));
  if (d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== t) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Wie viele Personen sind je Tag abwesend?
 * Unabhaengig davon, welche Zeile zu welchem Kuerzel gehoert - dafuer
 * braucht es keine Zuordnung.
 * @param {{dates:string[], rows:any[]}} matrix
 * @param {Record<string, boolean>} [deutung]
 */
export function absentPerDay(matrix, deutung = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const d of matrix.dates) {
    let n = 0;
    for (const r of matrix.rows) {
      const code = r.codes[d];
      if (!code) continue;
      const b = CODES[code];
      if (b) { if (!b.anwesend) n++; continue; }
      if (Object.prototype.hasOwnProperty.call(deutung, code) && !deutung[code]) n++;
    }
    out[d] = n;
  }
  return out;
}

/** Abwesende je Kalenderwoche - fuer die Anzeige. */
export function absentPerWeek(matrix, deutung = {}) {
  const tage = absentPerDay(matrix, deutung);
  /** @type {Record<string, {weekKey:string, personDays:number, days:number}>} */
  const out = {};
  for (const [d, n] of Object.entries(tage)) {
    if (weekday(d) > 5) continue;
    const wk = isoWeek(d).key;
    const e = (out[wk] ??= { weekKey: wk, personDays: 0, days: 0 });
    e.personDays += n;
    e.days++;
  }
  return out;
}
