/**
 * Startkonfiguration (Baseline-Parameter) der Planungsengine.
 *
 * Die Werte stammen aus der bisherigen Planung des Armaturenbaus
 * (Arbeitsmappe "Produktionsplanung Arbeitsplaetze", Planstand 09.09.2026)
 * sowie aus den im Lastenheft festgehaltenen Regeln.
 *
 * Alles, was dort NICHT belegt ist, ist mit `validated: false` gekennzeichnet
 * und in der Oberflaeche als "zu validieren" sichtbar
 * (siehe docs/ZU-VALIDIEREN.md).
 */

import { OPERATIONS, DEP_TYPE } from './model.js';
import { defaultTeam } from './team.js';

/* ------------------------------------------------------------------ *
 * Arbeitsplan-Vorlagen
 * ------------------------------------------------------------------ */

/**
 * Arbeitsgangzeiten in MANNSTUNDEN je Arbeitsplan.
 * Quelle: Blatt "Daten", Zeilen 56-65 der bisherigen Planung.
 * Orbitalschweissen = summierte Personenstunden (90,25 h entsprechen rund
 * 45 h Durchlaufzeit bei zwei gleichzeitig eingesetzten Schweissern).
 */
/**
 * Arbeitsvorbereitung je Auftrag.
 *
 * Auskunft der Abteilungsleitung: pauschal eine Schicht (7,5 h) je
 * Auftrag, unabhaengig von der Groesse - dazu gehoeren
 * Fertigungsbegleitliste, Entnahmen, Rohrentnahme und die Simulation des
 * Biegeprogramms. Die Stunden zaehlen gegen die Mannschaft.
 */
const AV_STUNDEN = 7.5;

/**
 * Teilt eine bisherige Orbitalschweiss-Zeit im Verhaeltnis 1:2 auf Kehlnaht
 * und Stumpfnaht auf (Nutzerauftrag 23.09.2026, Beispiel "90 Stunden, davon
 * 30h Kehlnaht und 60h Stumpfnaht" - festes Verhaeltnis, auf Wunsch des
 * Nutzers auf alle Arbeitsplaene angewandt statt echte Einzelwerte
 * abzuwarten). Stumpfnaht wird als Rest gerechnet, damit die Summe exakt
 * der bisherigen Orbitalzeit entspricht (keine Rundungsdrift).
 * @param {number} total
 */
export function splitOrbital(total) {
  const kehlnaht = Math.round((total / 3) * 100) / 100;
  return { ORBITAL_KEHLNAHT: kehlnaht, ORBITAL_STUMPFNAHT: Math.round((total - kehlnaht) * 100) / 100 };
}

const HOURS = {
  /** Neubau: Summe 247,75 h + 7,5 h Arbeitsvorbereitung */
  NEUBAU: {
    AV: AV_STUNDEN, SAEGEN: 18, ENTGRATEN: 20.75, BIEGEN: 13, HEFTEN: 38.75,
    ...splitOrbital(90.25), HANDSCHWEISSEN: 0,
    BEIZEN: 17.75, MOLCHEN: 0, VORMONTAGE: 12.25, HYDRO: 17, ENDKONTROLLE: 20,
  },
  /** Umbau und Pruefer: Summe 106,5 h + 7,5 h Arbeitsvorbereitung */
  UMBAU: {
    AV: AV_STUNDEN, SAEGEN: 6, ENTGRATEN: 6.5, BIEGEN: 7.5, HEFTEN: 19.5,
    ...splitOrbital(45), HANDSCHWEISSEN: 0,
    BEIZEN: 6, MOLCHEN: 0, VORMONTAGE: 4, HYDRO: 5.5, ENDKONTROLLE: 6.5,
  },
  /** Wiederkehrer ISO: Summe 257 h (einschliesslich Reinigen) + 7,5 h AV */
  WKP: {
    AV: AV_STUNDEN, SAEGEN: 18, ENTGRATEN: 21, BIEGEN: 13, HEFTEN: 39,
    ...splitOrbital(91), HANDSCHWEISSEN: 0,
    BEIZEN: 18, MOLCHEN: 0, VORMONTAGE: 12.5, HYDRO: 17, ENDKONTROLLE: 20, REINIGEN: 7.5,
  },
  /**
   * Kleinauftrag / Zubehoer.
   *
   * Arbeitsfolge nach der Haekchenliste der Abteilung: Arbeitsvorbereitung
   * (Fertigungsbegleitliste, Entnahmen, Rohre entnommen, Simulation
   * Biegeprogramm), Rohre saegen (Entgraten ist darin enthalten), Biegen,
   * Schweissen (eine Position, nicht nach Sektions-, Sammelleitung und
   * Schrank getrennt), Beizen, Verschraubungen setzen (= Vormontage),
   * Abdruecken (= Hydro), Endabnahme (= Endkontrolle).
   *
   * Die Zeiten stehen bewusst auf 0: Sie liegen nicht vor. Der Aufwand
   * des Zubehoers geht ueber die Reserve (12-24 Mannstunden je Woche) in
   * die Rechnung ein - dieselben Stunden also, nicht zusaetzlich.
   */
  ZUBEHOER: {
    AV: 0, SAEGEN: 0, BIEGEN: 0, ORBITAL_KEHLNAHT: 0, ORBITAL_STUMPFNAHT: 0, HANDSCHWEISSEN: 0,
    BEIZEN: 0, MOLCHEN: 0, VORMONTAGE: 0, HYDRO: 0, ENDKONTROLLE: 0,
  },
};

/**
 * Platzhalter fuer Projektarten, die in der Quelldatei nicht enthalten sind.
 * Anteilig aus der Neubaufolge abgeleitet - ausdruecklich zu validieren.
 */
function scaled(base, total) {
  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = Math.round((v / sum) * total * 100) / 100;
  return out;
}

/**
 * Standard-Abhaengigkeitsnetz der Arbeitsfolge.
 *
 * Grundsaetzliche Prozessfolge = Ende-Start. Ausnahme laut Lastenheft §9/§10
 * und laut bisheriger Planung: Heften -> Orbitalschweissen laeuft
 * baugruppenweise ueberlappend mit definiertem Heftvorsprung.
 */
function defaultNetwork(withCleaning) {
  const net = [
    { opId: 'AV', predecessors: [] },
    { opId: 'SAEGEN', predecessors: [{ opId: 'AV', type: DEP_TYPE.FS }] },
    { opId: 'ENTGRATEN', predecessors: [{ opId: 'SAEGEN', type: DEP_TYPE.FS }] },
    { opId: 'BIEGEN', predecessors: [{ opId: 'ENTGRATEN', type: DEP_TYPE.FS }] },
    { opId: 'HEFTEN', predecessors: [{ opId: 'BIEGEN', type: DEP_TYPE.FS }] },
    /*
     * Kehlnaht und Stumpfnaht Orbital (Nutzerauftrag 23.09.2026): beide
     * ueberlappend mit Heften, KEIN Reihenfolgezwang zueinander ("Überlappend
     * möglich" - beide koennen parallel laufen, sie teilen sich nur den
     * Maschinen-/Schweißer-Pool, siehe scheduler.js). Handschweißen ebenso
     * ueberlappend - eigene Qualifikation, standardmaessig 0 h.
     */
    { opId: 'ORBITAL_KEHLNAHT', predecessors: [{ opId: 'HEFTEN', type: DEP_TYPE.OVERLAP }] },
    { opId: 'ORBITAL_STUMPFNAHT', predecessors: [{ opId: 'HEFTEN', type: DEP_TYPE.OVERLAP }] },
    { opId: 'HANDSCHWEISSEN', predecessors: [{ opId: 'HEFTEN', type: DEP_TYPE.OVERLAP }] },
    {
      opId: 'BEIZEN',
      predecessors: [
        { opId: 'ORBITAL_KEHLNAHT', type: DEP_TYPE.FS },
        { opId: 'ORBITAL_STUMPFNAHT', type: DEP_TYPE.FS },
        { opId: 'HANDSCHWEISSEN', type: DEP_TYPE.FS },
      ],
    },
    /*
     * Molchen (Nutzerauftrag 23.09.2026): nach Beizen, vor Vormontage -
     * keine Vorgabe zur genauen Position erhalten, das ist eine
     * naheliegende Annahme (Leitung innen reinigen, bevor verschraubt und
     * geprueft wird). Standardmaessig 0 h wie Handschweißen, blockiert
     * dadurch nichts, bis je Auftrag Stunden eingetragen werden.
     */
    { opId: 'MOLCHEN', predecessors: [{ opId: 'BEIZEN', type: DEP_TYPE.FS }] },
    { opId: 'VORMONTAGE', predecessors: [{ opId: 'MOLCHEN', type: DEP_TYPE.FS }] },
    { opId: 'HYDRO', predecessors: [{ opId: 'VORMONTAGE', type: DEP_TYPE.FS }] },
    { opId: 'ENDKONTROLLE', predecessors: [{ opId: 'HYDRO', type: DEP_TYPE.FS }] },
  ];
  if (withCleaning) {
    net.push({ opId: 'REINIGEN', predecessors: [{ opId: 'ENDKONTROLLE', type: DEP_TYPE.FS }] });
  }
  return net;
}

/**
 * Arbeitsfolge der Kleinauftraege und des Zubehoers.
 *
 * Genau die Haekchen der Abteilungsliste, in dieser Reihenfolge. Zwei
 * Unterschiede zur grossen Folge: Entgraten ist im Saegen enthalten, und
 * Schweissen ist eine Position (nicht nach Sektionsleitung, Sammelleitung
 * und Schrank getrennt).
 */
function zubehoerNetwork() {
  return [
    { opId: 'AV', predecessors: [] },
    { opId: 'SAEGEN', predecessors: [{ opId: 'AV', type: DEP_TYPE.FS }] },
    { opId: 'BIEGEN', predecessors: [{ opId: 'SAEGEN', type: DEP_TYPE.FS }] },
    { opId: 'ORBITAL_KEHLNAHT', predecessors: [{ opId: 'BIEGEN', type: DEP_TYPE.FS }] },
    { opId: 'ORBITAL_STUMPFNAHT', predecessors: [{ opId: 'BIEGEN', type: DEP_TYPE.FS }] },
    { opId: 'HANDSCHWEISSEN', predecessors: [{ opId: 'BIEGEN', type: DEP_TYPE.FS }] },
    {
      opId: 'BEIZEN',
      predecessors: [
        { opId: 'ORBITAL_KEHLNAHT', type: DEP_TYPE.FS },
        { opId: 'ORBITAL_STUMPFNAHT', type: DEP_TYPE.FS },
        { opId: 'HANDSCHWEISSEN', type: DEP_TYPE.FS },
      ],
    },
    { opId: 'MOLCHEN', predecessors: [{ opId: 'BEIZEN', type: DEP_TYPE.FS }] },
    { opId: 'VORMONTAGE', predecessors: [{ opId: 'MOLCHEN', type: DEP_TYPE.FS }] },
    { opId: 'HYDRO', predecessors: [{ opId: 'VORMONTAGE', type: DEP_TYPE.FS }] },
    { opId: 'ENDKONTROLLE', predecessors: [{ opId: 'HYDRO', type: DEP_TYPE.FS }] },
  ];
}

/**
 * Baut eine Arbeitsplan-Vorlage aus einer Stundentabelle.
 * @param {string} key @param {string} label @param {Record<string,number>} hours
 * @param {{validated?:boolean, note?:string, network?:any[]}} [meta]
 */
function buildTemplate(key, label, hours, meta = {}) {
  const withCleaning = Number(hours.REINIGEN ?? 0) > 0;
  const netz = meta.network ?? defaultNetwork(withCleaning);
  return {
    key,
    label,
    validated: meta.validated !== false,
    note: meta.note ?? '',
    steps: netz.map((n) => ({
      opId: n.opId,
      hours: Number(hours[n.opId] ?? 0),
      predecessors: n.predecessors,
      /** Frueheste Aufnahme relativ zum Fertigstellungstermin (Wochen) */
      earliestStartWeeksBeforeDue: null,
      /** Maximale gleichzeitige Mitarbeiter dieses Projektes an diesem Arbeitsgang */
      maxWorkers: null,
    })),
  };
}

const VARIANT_NOTE = 'Werte aus der bisherigen Planung (Standard-Neubaufolge, 247,75 h). '
  + 'Eine Differenzierung nach MEGC-Variante liegt noch nicht vor – alle Neubau-Varianten '
  + 'verwenden daher zunächst dieselben Zeiten.';

/** @returns {Record<string, any>} */
export function defaultRoutingTemplates() {
  return {
    NEUBAU_FT20: buildTemplate('NEUBAU_FT20', 'Neubau 20 ft', HOURS.NEUBAU, { note: VARIANT_NOTE }),
    NEUBAU_FT30: buildTemplate('NEUBAU_FT30', 'Neubau 30 ft', HOURS.NEUBAU, { note: VARIANT_NOTE }),
    NEUBAU_FT40: buildTemplate('NEUBAU_FT40', 'Neubau 40 ft', HOURS.NEUBAU, { note: VARIANT_NOTE }),
    NEUBAU_FT45: buildTemplate('NEUBAU_FT45', 'Neubau 45 ft', HOURS.NEUBAU, { note: VARIANT_NOTE }),
    UMBAU: buildTemplate('UMBAU', 'Umbau', HOURS.UMBAU, { note: 'Werte aus der bisherigen Planung (106,5 h).' }),
    PRUEFER: buildTemplate('PRUEFER', 'Prüfer', HOURS.UMBAU, { note: 'Verwendet die Arbeitsfolge "Umbau / Prüfer" (106,5 h).' }),
    WKP: buildTemplate('WKP', 'Wiederkehrer ISO', HOURS.WKP, { note: 'Werte aus der bisherigen Planung (257 h inkl. Reinigen).' }),
    ZUBEHOER: buildTemplate('ZUBEHOER', 'Kleinauftrag / Zubehör', HOURS.ZUBEHOER, {
      network: zubehoerNetwork(),
      validated: false,
      note: 'Arbeitsfolge laut Häkchenliste der Abteilung. Die Zeiten liegen noch nicht vor und '
        + 'stehen auf 0 – der Aufwand des Zubehörs geht bis dahin über die Reserve '
        + '(12–24 Mannstunden je Woche) in die Rechnung ein.',
    }),
    REPARATUR: buildTemplate('REPARATUR', 'Reparatur', scaled(HOURS.UMBAU, 60), {
      validated: false, note: 'Nicht in der Quelldatei enthalten – Startwert, fachlich zu validieren.',
    }),
    SONDER: buildTemplate('SONDER', 'Sonderprojekt', scaled(HOURS.NEUBAU, 250), {
      validated: false, note: 'Nicht in der Quelldatei enthalten – Startwert, fachlich zu validieren.',
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Arbeitsplaetze
 * ------------------------------------------------------------------ */

/**
 * Arbeitsplaetze laut Blatt "Arbeitsplaetze" der bisherigen Planung.
 * @returns {import('./model.js').Workplace[]}
 */
export function defaultWorkplaces() {
  const wp = [];
  const add = (id, name, type, active = true, note = '') =>
    wp.push({ id, name, type, active, capacityUnits: 1, area: 'Armaturenbau', note });
  add('SA01', 'Säge', 'SAEGE');
  add('EN01', 'Entgraten', 'ENTGRAT');
  add('BI01', 'Biegen', 'BIEGE');
  add('HE01', 'Heftplatz 1', 'HEFTPLATZ');
  add('HE02', 'Heftplatz 2', 'HEFTPLATZ');
  add('HE03', 'Heftplatz 3 · Reserve', 'HEFTPLATZ', false, 'Nur im Engpassszenario zugelassen.');
  for (let i = 1; i <= 6; i++) add(`OR0${i}`, `Orbitalmaschine ${i}`, 'ORBITAL');
  add('BE01', 'Beizen', 'BEIZE');
  add('MO01', 'Molchen', 'MOLCHEN', true, 'Keine Platzgrenze hinterlegt – dazu liegt keine Angabe vor.');
  add('DK01', 'DKR-Vormontage 1', 'MONTAGE');
  add('DK02', 'DKR-Vormontage 2 · Reserve', 'MONTAGE', false, 'Ohne zusätzliche Besetzung Reserve.');
  add('HY01', 'Hydroprüfung', 'HYDRO', true, 'Ausschließlich Dienstag bis Donnerstag.');
  add('EK01', 'Endkontrolle', 'QS');
  add('RE01', 'Reinigen', 'REINIGUNG');
  add('HS01', 'Handschweißplatz', 'HANDSCHWEISSEN');
  // Arbeitsvorbereitung: Schreibtischarbeit, kein Werkstattplatz. Sie
  // bindet Personal und steht deshalb als eigener "Platz" ohne Begrenzung.
  add('AV01', 'Arbeitsvorbereitung', 'AV', true, 'Kein Werkstattplatz – bindet nur Personal.');
  return wp;
}

/* ------------------------------------------------------------------ *
 * Planungsparameter (Szenario-Konfiguration)
 * ------------------------------------------------------------------ */

/**
 * Qualifikationsanteile je Arbeitsgang.
 * Eine belastbare Qualifikationsmatrix liegt bisher nicht vor; es wird daher
 * zunaechst keine Einschraenkung angesetzt (Anteil 100 %). Die Orbitalkapazitaet
 * wird separat ueber die qualifizierten Schweisser begrenzt.
 */
/**
 * Plaetze der Werkstatt und wie viele Personen dort gleichzeitig arbeiten
 * koennen (Auskunft der Abteilungsleitung, 09/2026).
 *
 * Heften und Orbitalschweissen stehen weiterhin in eigenen Feldern
 * (heftPlaces, orbitalMachinesActive) - sie sind im Steuerstand als eigene
 * Regler gefuehrt.
 */
export function defaultPlaces() {
  return {
    /*
     * Arbeitsvorbereitung: ein Vorgang gleichzeitig, eine Person.
     * Kein Werkstattplatz, aber auch nicht beliebig parallel - die
     * Fertigungsbegleitliste eines Auftrages macht einer. Wie viele
     * Auftraege gleichzeitig vorbereitet werden koennen, ist NICHT
     * belegt und ausdruecklich zu validieren.
     */
    AV: { places: 1, maxPlaces: 2, workersPerPlace: 1, note: 'ein Vorgang gleichzeitig – zu validieren' },
    SAEGEN: { places: 1, maxPlaces: 2, workersPerPlace: 1, note: 'ein Platz, ein zweiter ist bei Bedarf einrichtbar' },
    /*
     * Entgraten: eine Maschine fuer einen Mann. Im Engpass kann ein
     * zweiter von Hand entgraten - langsamer, aber es verkuerzt den
     * Durchlauf.
     *
     * `leistung: 0.5` - ein Mann von Hand schafft in 7,5 h so viel wie die
     * Maschine in 3,75 h.
     * `stundenfaktor: 2` - dieselbe Menge kostet deshalb die DOPPELTE
     * Arbeitszeit. Ohne diesen Faktor waere die Aushilfe geschenkt.
     */
    ENTGRATEN: {
      places: 1, maxPlaces: 2, workersPerPlace: 1,
      aushilfe: {
        max: 1, leistung: 0.5, stundenfaktor: 2, validated: true,
        label: 'von Hand entgraten',
        text: 'Ein zweiter Mitarbeiter entgratet von Hand: halbe Leistung, doppelte Arbeitszeit '
          + 'für dieselbe Menge – dafür ist der Arbeitsgang schneller durch.',
      },
      note: 'ein Platz, eine Person – im Engpass kann von Hand mitgeholfen werden',
    },
    BIEGEN: { places: 1, workersPerPlace: 1 },
    BEIZEN: { places: 1, workersPerPlace: 1 },
    /*
     * Doppelklemmring-Vormontage: zwei Plaetze, JE EINE Person - nicht
     * "je zwei Personen" (das waere doppelte Kapazitaet, die es nicht
     * gibt). Bestaetigt von der Abteilungsleitung 19.09.2026: "2
     * Arbeitsplaetze und 2 Personen, pro Arbeitsplatz eine Person. Noch
     * mehr Plaetze waeren machbar wenn noetig."
     */
    VORMONTAGE: { places: 2, maxPlaces: 4, workersPerPlace: 1, note: 'zwei Plätze, je eine Person – weitere Plätze sind bei Bedarf machbar' },
    /*
     * Hydropruefung: ein Pruefstand. Einer kann vormontieren und dem
     * Pruefer zuarbeiten.
     *
     * `leistung: 0.5` - der Arbeitsgang wird ein Drittel kuerzer.
     * `stundenfaktor: 1` - der Zuarbeiter nimmt dem Pruefer Arbeit AB, die
     *   Mannstunden bleiben also gleich, nur auf zwei Leute verteilt.
     *   Anders als beim Entgraten kostet das nichts extra.
     */
    HYDRO: {
      places: 1, workersPerPlace: 1,
      aushilfe: {
        max: 1, leistung: 0.5, stundenfaktor: 1, validated: true,
        label: 'dem Prüfer zuarbeiten',
        text: 'Ein Mitarbeiter montiert vor und arbeitet dem Prüfer zu. Der Prüfstand ist '
          + 'dadurch ein Drittel kürzer belegt; zusätzliche Arbeitszeit kostet es nicht.',
      },
      note: 'ein Prüfstand, eine Prüfung, eine Person rüstet und prüft – im Engpass kann ein Helfer zuarbeiten',
    },
    /*
     * Endkontrolle: zwei Plaetze, JE EINE Person - derselbe Punkt wie bei
     * der Vormontage. "Zusätzliche Plätze sind bei Heften, Vormontage und
     * Endkontrolle eine Möglichkeit" - ohne maxPlaces war ein
     * zusaetzlicher Platz als Massnahme gar nicht waehlbar
     * (patchPlatz in engine/mehraufwand.js braucht maxPlaces>0).
     *
     * Aushilfe (Nutzeranforderung 25.09.2026, ausdruecklich bestaetigt):
     * "wie Hydro" - ein Helfer bereitet vor und arbeitet dem Pruefer zu.
     * ACHTUNG: anders als bei Hydro/Entgraten liegen hierfuer noch KEINE
     * von der Abteilung bestaetigten Werte vor - leistung/stundenfaktor
     * sind vorlaeufig 1:1 von Hydro uebernommen (validated: false) und
     * muessen noch bestaetigt werden.
     */
    ENDKONTROLLE: {
      places: 2, maxPlaces: 3, workersPerPlace: 1,
      aushilfe: {
        max: 1, leistung: 0.5, stundenfaktor: 1, validated: false,
        label: 'dem Prüfer zuarbeiten',
        text: 'Ein Mitarbeiter bereitet vor und arbeitet dem Prüfer zu (Werte vorläufig von der '
          + 'Hydroprüfung übernommen, noch zu bestätigen).',
      },
      note: 'zwei Plätze, je eine Person – dritter Platz als Maßnahme möglich, im Engpass kann ein '
        + 'Helfer zuarbeiten (Werte zu validieren)',
    },
    REINIGEN: { places: 1, workersPerPlace: 1 },
    /*
     * Handschweißen (Nutzerauftrag 23.09.2026): "1 Handschweißplatz 1
     * Mann" - fester, kleiner Platz, kein Aushilfe-Mechanismus.
     */
    HANDSCHWEISSEN: { places: 1, workersPerPlace: 1, note: 'ein Platz, ein Mann' },
  };
}

function defaultSkills() {
  /** @type {Record<string,{share:number, headcount:number|null, validated:boolean}>} */
  const out = {};
  for (const op of OPERATIONS) {
    out[op.id] = { share: 1, headcount: null, validated: false };
  }
  return out;
}

/**
 * Wochenweise Stammbesetzung laut bisheriger Planung (Blatt "Daten", K/L).
 * Wird vom Startdatenbestand gesetzt, nicht von den Vorgabewerten.
 */
export function defaultWeekly() {
  const base = {
    '2026-W37': 6, '2026-W38': 7, '2026-W39': 8, '2026-W40': 8, '2026-W41': 9,
    '2026-W42': 9, '2026-W43': 7, '2026-W44': 6, '2026-W45': 8, '2026-W46': 9,
    '2026-W47': 9, '2026-W48': 9, '2026-W49': 9, '2026-W50': 9, '2026-W51': 8,
  };
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = { base: v };
  return out;
}

/**
 * Ostersonntag eines Jahres (Gauss/Meeus, gregorianisch).
 * @param {number} jahr @returns {Date}
 */
function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

/**
 * Gesetzliche Feiertage in Nordrhein-Westfalen.
 *
 * Bewusst gerechnet und nicht abgeschrieben: In der ersten Fassung standen
 * hier Ostertermine von Hand, und zwei davon waren falsch (Karfreitag 2027
 * stand auf dem 02.04., richtig ist der 26.03.). Ein falscher Feiertag
 * verschiebt jeden nachfolgenden Termin - deshalb wird gerechnet.
 *
 * Die Liste bleibt frei editierbar (Betriebsruhe, Brueckentage).
 *
 * @param {number} [vonJahr] @param {number} [bisJahr]
 */
export function defaultHolidays(vonJahr = 2026, bisJahr = 2028) {
  /** @type {string[]} */
  const out = [];
  const iso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);
  const plus = (/** @type {Date} */ d, /** @type {number} */ n) => {
    const x = new Date(d.getTime());
    x.setUTCDate(x.getUTCDate() + n);
    return iso(x);
  };
  for (let j = vonJahr; j <= bisJahr; j++) {
    const o = ostersonntag(j);
    out.push(
      `${j}-01-01`,      // Neujahr
      plus(o, -2),       // Karfreitag
      plus(o, 1),        // Ostermontag
      `${j}-05-01`,      // Tag der Arbeit
      plus(o, 39),       // Christi Himmelfahrt
      plus(o, 50),       // Pfingstmontag
      plus(o, 60),       // Fronleichnam (in NRW gesetzlich)
      `${j}-10-03`,      // Tag der Deutschen Einheit
      `${j}-11-01`,      // Allerheiligen (in NRW gesetzlich)
      `${j}-12-25`,
      `${j}-12-26`,
    );
  }
  return out.sort();
}

/** @returns {any} Standard-Szenarioparameter (Regelbetrieb) */
export function defaultConfig() {
  return {
    planningDate: '2026-09-10',
    horizonDays: 420,
    criticalSlackDays: 3,

    workTime: {
      regularHoursPerWeek: 37.5,
      workDays: [1, 2, 3, 4, 5],
      saturdayHours: 6,
      validated: true,
    },

    productivity: {
      // 7,0 produktive Stunden je Mitarbeiter und Tag laut bisheriger Planung
      // (37,5 h / 5 Tage = 7,5 h vertraglich; 7,0 / 7,5 = 93,3 %).
      global: 0.9333,
      validated: true,
      note: 'Entspricht 7,0 produktiven Stunden je Mitarbeiter und Tag (Planbasis der bisherigen Planung).',
    },

    workforce: {
      baseHeadcount: 9,
      baseHeadcountValidated: true,
      overtimePerEmployeeDefault: 0,
      /** Wochenspezifische Uebersteuerungen, Schluessel '2026-W41' */
      /**
       * Wochenweise Uebersteuerung. Hier absichtlich LEER: die konkreten
       * Wochenwerte des Armaturenbaus stehen im Startdatenbestand
       * (seed.js). Stuenden sie in den Vorgabewerten, kaeme jeder
       * geloeschte Wochenwert beim naechsten Rechnen zurueck.
       * @type {Record<string, any>}
       */
      weekly: {},
      /** @type {{id:string,label:string,count:number,from:string,to:string|null,skills:string[]|null}[]} */
      tempWorkers: [],
      /**
       * Neueinstellungen als Zahlenkohorten - LEER.
       *
       * Fruehere Annahme der Excel-Planung waren drei Kohorten (2 ab KW38,
       * 2 ab KW40, 1 ab KW42). Sie sind entfallen: Seit die Mannschaft und
       * die gemessene Tagesliste die Grundlage sind, wuerden sie doppelt
       * zaehlen - die Messwerte enthalten die tatsaechlich anwesenden
       * Leute bereits. Neueinstellungen werden in der Mannschaft als
       * Person mit Eintritt gefuehrt.
       * @type {{id:string,label:string,count:number,from:string,to:string|null,skills:string[]|null}[]}
       */
      newHires: [],
      maxNewHires: 5,
      /**
       * Zubehoer und Kleinarbeiten.
       *
       * Neben den Auftraegen laeuft laufend Arbeit, die nicht einzeln
       * geplant wird: Adapter, Zuleitungen, Nacharbeit, Muster. Sie
       * verbraucht echte Stunden. Damit der Plan nicht zu optimistisch
       * wird, gehen diese Stunden vorab von der Kapazitaet ab.
       *
       * Auskunft der Abteilungsleitung 09/2026: rund 12-24 Mannstunden je
       * Woche. Angesetzt ist die Mitte (18 h) - ausdruecklich als Schaetzung
       * gekennzeichnet, nicht als Messwert.
       */
      /**
       * Niemand arbeitet allein.
       *
       * Vorgabe der Abteilungsleitung: "keiner darf alleine arbeiten immer
       * mindestens zu zweit." Das ist eine Arbeitsschutzregel, keine
       * Stellschraube - sie begrenzt, ob eine Schicht ueberhaupt gefahren
       * werden darf und ob ein Tag besetzt ist.
       */
      minZusammen: 2,
      minZusammenNote: 'Arbeitsschutz: keiner arbeitet allein. Eine Schicht mit nur einer '
        + 'Person wird nicht gefahren, ein Tag mit nur einer Person gilt als nicht besetzbar.',
      reserveHoursPerWeek: 18,
      reserveHoursValidated: false,
      reserveHoursNote: 'Auskunft der Abteilungsleitung 09/2026: "12-24 Mannstunden ca." '
        + 'je Woche. Angesetzt ist die Mitte der Spanne (18 h). Die Spanne selbst ist eine '
        + 'Schaetzung - zu validieren, sobald die Zubehoerliste mit Zeiten vorliegt.',

      /**
       * Krankenquote: pauschaler Abzug von der Besetzung. Steht bewusst auf
       * 0, weil in der bisherigen Planung keine Quote hinterlegt war - sie
       * steckte in der Produktivitaet. Im Steuerstand einstellbar.
       */
      sickRate: 0,
      sickRateValidated: false,
      /** Mannschaft mit Kuerzeln, Qualifikationen und Abwesenheiten */
      team: defaultTeam(),

      /**
       * Gemessene Verfuegbarkeit je Kalendertag (Tagesliste der
       * Abteilungsleitung, bereits um 1 korrigiert). Sie hat Vorrang vor
       * Mannschaft und Wochenzahlen - Messwerte schlagen Annahmen.
       * Der Startdatenbestand fuellt sie; hier bleibt sie leer.
       * @type {Record<string, number>}
       */
      dailyAvailable: {},
      useDailyAvailable: true,

      /**
       * Geplante Abwesenheiten aus der eingelesenen Urlaubsplanung, fuer
       * die noch kein Kuerzel zugeordnet ist.
       *
       * Die Urlaubsplanung der Abteilung nennt die Personen nicht. Wer
       * welche Zeile ist, wird in der Oberflaeche zugeordnet; bis dahin
       * waere die Angabe verloren. Deshalb steht hier die ANZAHL der
       * abwesenden Personen je Tag. Sie geht von der Staerke aus der
       * Mannschaft ab - gerechnet mit einem Zeitanteil von 1,0 je Person,
       * weil die Zeile nichts anderes hergibt. Zugeordnete Zeilen stehen
       * dagegen als echte Abwesenheit bei der Person und sind hier NICHT
       * enthalten (sonst zaehlte es doppelt).
       * @type {Record<string, number>}
       */
      plannedAbsences: {},
      /**
       * Deutung zusaetzlicher Kuerzel der Urlaubsplanung.
       * true = die Person ist da, false = sie fehlt. Leer heisst: noch
       * nicht entschieden - dann wird das Kuerzel nur gemeldet.
       * @type {Record<string, boolean>}
       */
      attendanceCodes: {},
      /** Herkunft der letzten eingelesenen Urlaubsplanung @type {any} */
      attendanceImport: null,
      rampUp: {
        temp: [0.4, 0.6, 0.8],
        hire: [0.4, 0.6, 0.8],
        /** Betreuungsstunden je Person und Woche, danach 0 */
        mentoringHoursPerWeek: { temp: [5, 3, 1], hire: [5, 3, 1] },
        validated: true,
        note: 'Leistung 40/60/80/100 %, Betreuung 5/3/1/0 h je Person und Woche (Annahme der bisherigen Planung).',
      },
    },

    /**
     * Kostensaetze (Auskunft der Abteilungsleitung 09/2026).
     * OTD steht ueber den Kosten - die Kosten werden nur ausgewiesen,
     * nie optimiert.
     */
    costs: {
      /**
       * Stundenlohn eines Stammmitarbeiters. Auskunft 09/2026: 19-26 EUR,
       * hier der Mittelwert - je Person in der Mannschaft aenderbar.
       * ACHTUNG: Lohn, nicht Vollkosten. Arbeitgeberanteile kommen ueber
       * `employerFactor` dazu.
       */
      baseRate: 22.5,
      baseRateValidated: false,
      /**
       * Aufschlag fuer Arbeitgeberanteile auf den Lohn (Vorgabe der
       * Abteilungsleitung: 1,3). Gilt NICHT fuer Leiharbeiter - deren
       * Satz ist ein Rechnungssatz und enthaelt die Nebenkosten schon.
       */
      employerFactor: 1.3,
      employerFactorValidated: false,
      /** Mehrarbeit: Zuschlag in Prozent, wochentags wie samstags */
      overtimeSurchargePercent: 35,
      saturdaySurchargePercent: 35,
      /** Spaetschicht: Zulage je vollstaendige Schicht, anteilig je Stunde */
      lateShiftAllowancePerShift: 24,
      /** Nachtschicht: Zuschlag in Prozent auf den Stundenlohn */
      nightSurchargePercent: 40,
      /** Leiharbeiter: Rechnungssatz, Spanne 45-65 EUR, je Person aenderbar */
      tempRate: 55,
      tempRateValidated: false,
      currency: 'EUR',
      validated: false,
    },

    saturday: {
      // Lastenheft §26/§27: 20 % der verfuegbaren Mitarbeiter.
      // Die bisherige Excel-Planung rechnete in den Szenarien mit 80 %.
      quota: 0.20,
      quotaValidated: false,
      /** @type {Record<string, {enabled:boolean, quotaOverride:number|null, headcountOverride:number|null}>} */
      weeks: {},
      enabledDefault: false,
    },

    skills: defaultSkills(),

    resources: {
      orbitalMachines: 6,
      orbitalMachinesActive: 6,
      machinesPerWelder: 2,
      welders: {
        default: 4,
        byWeekday: {},
        /** @type {Record<string, number>} tagesgenaue Uebersteuerung */
        byDate: {},
        /** Insgesamt qualifizierte Orbitalschweisser (Auskunft 09/2026: 6) */
        qualified: 6,
        /** Davon noch in Ausbildung - zaehlen nicht als voll einsetzbar */
        inTraining: 2,
        validated: true,
      },
      heftPlaces: 2,
      heftPlacesMax: 3,
      workersPerHeftPlace: 1,
      workersPerHeftPlaceValidated: true,
      /**
       * Betriebszeitfenster der Arbeitsplaetze und Maschinen je Tag.
       * Durch versetzte Besetzung laenger als die Arbeitszeit einer Person.
       */
      operatingHoursPerDay: 7,
      /** @type {Record<string, number>} wochenweise Uebersteuerung */
      operatingHoursByWeek: {},
      /**
       * Eigene Werte je Arbeitsgang. Leer = es gilt der allgemeine Wert.
       *   operatingHours: Belegungszeit dieses Arbeitsganges je Tag
       *   places:         Anzahl der Plaetze/Maschinen (null = keine Begrenzung)
       * @type {Record<string, {operatingHours?:number|null, places?:number|null}>}
       */
      byOperation: defaultPlaces(),
      /**
       * Platzgrenzen gemeinsam abschaltbar - fuer den Vergleich "mit und
       * ohne". Heftplaetze und Orbitalmaschinen wirken immer.
       */
      enforcePlaces: true,
      // Ein Prueffstand, eine Pruefung gleichzeitig (Auskunft 09/2026)
      hydroStations: 1,
      beizStations: 1,
      /**
       * Aushilfe an Arbeitsgaengen gemeinsam abschaltbar (Nutzeranforderung
       * 25.09.2026: "notfalls als Helfer bei der Hydroprüfung oder
       * Endkontrolle etc."). Je Arbeitsgang steht die eigentliche
       * Einstellung unter byOperation[opId].aushilfe.
       */
      aushilfeAktiv: true,
    },

    nobo: {
      /** Regel-Anwesenheit als ISO-Wochentage (2 = Di, 3 = Mi, 4 = Do) */
      weekdays: [2, 3, 4],
      /** @type {Record<string, boolean>} tagesgenaue Uebersteuerung */
      exceptions: {},
      validated: false,
      note: 'Aus der bisherigen Planung abgeleitet (Hydroprüfung Di–Do ohne weitere Einschränkung). '
        + 'Die tatsächliche NoBo-Anwesenheit ist zu bestätigen.',
    },

    hydro: {
      allowedWeekdays: [2, 3, 4],
      requireNoBo: true,
    },

    leadTimes: {
      materialWeeks: 4,
      startWeeks: { NEUBAU: 3, UMBAU: 4, WKP: 4, PRUEFER: 4, REPARATUR: 2, SONDER: 4, ZUBEHOER: 1 },
      validated: true,
    },

    tacking: {
      minLeadHours: 5,
      targetLeadHours: 7.5,
      maxLeadHours: 10,
      enforceMaxLead: true,
    },

    projectLimits: {
      maxWorkersPerProject: 4,
      maxWorkersPerProjectValidated: true,
      /** WIP-Grenze: Kernauftraege gleichzeitig (Annahme der bisherigen Planung) */
      maxParallelProjects: 3,
      maxParallelProjectsValidated: false,
    },

    sequencing: {
      rule: 'PRIORITY_DUE',
      respectLocked: true,
    },

    outsourcing: {
      enabled: false,
      note: 'Fremdvergabe ist für die aktuelle Planung ausgeschlossen.',
    },

    /**
     * Regeln der Abteilung (siehe rules.js).
     * Hier steht nur, welche Regeln in DIESEM Stand ausgeschaltet sind -
     * die Regeln selbst gelten fuer alle Staende gemeinsam.
     */
    rules: {
      /** @type {string[]} */
      disabled: [],
    },

    /**
     * Wochentage je Arbeitsgang. Wird aus den Regeln gefuellt und darf
     * nicht von Hand gepflegt werden.
     * @type {Record<string, number[]>}
     */
    operationWeekdays: {},

    holidays: defaultHolidays(),
  };
}
