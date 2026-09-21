/**
 * Fachmodell Armaturenbau MEGC (Hexagon Purus)
 * ------------------------------------------------------------------
 * Kataloge, Typdefinitionen und Hilfsfunktionen des Datenmodells.
 * Dieses Modul enthaelt keine Rechenlogik.
 */

/* ------------------------------------------------------------------ *
 * Arbeitsgaenge (Prozesse)
 * ------------------------------------------------------------------ */

/**
 * Einheiten: Der Arbeitsinhalt aller Arbeitsgaenge wird in MANNSTUNDEN gefuehrt.
 * Beim Orbitalschweissen entspricht das der Summe der Personenstunden
 * (Beispiel: 90,25 h bei 2 Schweissern an 4 Maschinen = rund 45 h Durchlaufzeit).
 * Die Maschinenbelegung ergibt sich daraus: Maschinenstunden = Mannstunden x
 * Maschinen je Schweisser. Mannstunden und Maschinenstunden bleiben dadurch
 * getrennt auswertbar (Lastenheft §54).
 *
 * @typedef {Object} OperationDef
 * @property {string} id
 * @property {string} name
 * @property {string} short
 * @property {'MANUAL'|'MACHINE'|'INSPECTION'} kind
 * @property {string} unit          'Mannstunden' oder 'Maschinenstunden'
 * @property {number} manHourFactor Mannstunden je Einheit Arbeitsinhalt
 * @property {string} workplaceType Arbeitsplatztyp (fuer spaetere Belegungsplanung)
 * @property {boolean} [requiresNoBo]
 * @property {number[]} [allowedWeekdays]
 * @property {boolean} [machinesPerWorker] Maschinenbelegung ergibt sich aus den Mannstunden
 */

/** @type {OperationDef[]} */
export const OPERATIONS = [
  /*
   * Arbeitsvorbereitung (Auskunft der Abteilungsleitung 09/2026: "ja
   * Arbeitsvorbereitung"). Sie war bisher nicht erfasst, verbraucht aber
   * echte Stunden der Mannschaft: Fertigungsbegleitliste drucken,
   * Entnahmen buchen, Rohre entnehmen, Biegeprogramm simulieren. Ohne sie
   * rechnete die Planung diese Arbeit still zu 0 h.
   *
   * Kein Werkstattplatz: Die AV bindet Personal, aber keine Maschine und
   * keinen Platz - deshalb steht sie nicht in defaultPlaces().
   */
  { id: 'AV',          name: 'Arbeitsvorbereitung',          short: 'AV',   kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'AV' },
  { id: 'SAEGEN',      name: 'Sägen',                        short: 'Säg',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'SAEGE' },
  { id: 'ENTGRATEN',   name: 'Entgraten',                    short: 'Ent',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'ENTGRAT' },
  { id: 'BIEGEN',      name: 'Biegen',                       short: 'Bie',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'BIEGE' },
  { id: 'HEFTEN',      name: 'Heften',                       short: 'Hef',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'HEFTPLATZ' },
  { id: 'ORBITAL',     name: 'Orbitalschweißen',             short: 'Orb',  kind: 'MACHINE',    unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'ORBITAL', machinesPerWorker: true },
  { id: 'BEIZEN',      name: 'Beizen',                       short: 'Bei',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'BEIZE' },
  { id: 'VORMONTAGE',  name: 'Doppelklemmring-Vormontage',   short: 'Vor',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'MONTAGE' },
  { id: 'HYDRO',       name: 'Hydroprüfung / Abdrücken',     short: 'Hyd',  kind: 'INSPECTION', unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'HYDRO', requiresNoBo: true, allowedWeekdays: [2, 3, 4] },
  { id: 'ENDKONTROLLE',name: 'Endkontrolle',                 short: 'End',  kind: 'INSPECTION', unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'QS' },
  { id: 'REINIGEN',    name: 'Reinigen',                     short: 'Rei',  kind: 'MANUAL',     unit: 'Mannstunden',     manHourFactor: 1,   workplaceType: 'REINIGUNG' },
];

/** @type {Record<string, OperationDef>} */
export const OPERATION_BY_ID = Object.fromEntries(OPERATIONS.map((o) => [o.id, o]));

/** @param {string} id @returns {OperationDef|undefined} */
export function operation(id) {
  return OPERATION_BY_ID[id];
}

/** @param {string} id @returns {string} */
export function operationName(id) {
  return OPERATION_BY_ID[id]?.name ?? id;
}

/* ------------------------------------------------------------------ *
 * Projektarten und MEGC-Varianten
 * ------------------------------------------------------------------ */

/** @type {{id:string,name:string,hasVariant:boolean,startLeadWeeks:number}[]} */
export const PROJECT_TYPES = [
  { id: 'NEUBAU',    name: 'Neubau',              hasVariant: true,  startLeadWeeks: 3 },
  { id: 'UMBAU',     name: 'Umbau',               hasVariant: false, startLeadWeeks: 4 },
  { id: 'WKP',       name: 'Wiederkehrer ISO',    hasVariant: false, startLeadWeeks: 4 },
  { id: 'PRUEFER',   name: 'Prüfer',              hasVariant: false, startLeadWeeks: 4 },
  { id: 'REPARATUR', name: 'Reparatur',           hasVariant: false, startLeadWeeks: 2 },
  { id: 'SONDER',    name: 'Sonderprojekt',       hasVariant: false, startLeadWeeks: 4 },
  /**
   * Kleinauftraege und Zubehoer: Adapter, Zuleitungen, Muster, Nacharbeit.
   * Eigene, kuerzere Arbeitsfolge (Entgraten im Saegen, Schweissen als eine
   * Position). Solange keine Zeiten vorliegen, laeuft der Aufwand ueber
   * die Reserve je Woche.
   */
  { id: 'ZUBEHOER',  name: 'Kleinauftrag / Zubehör', hasVariant: false, startLeadWeeks: 1 },
];

export const VARIANTS = [
  { id: 'FT20', name: '20 ft' },
  { id: 'FT30', name: '30 ft' },
  { id: 'FT40', name: '40 ft' },
  { id: 'FT45', name: '45 ft' },
];

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

/** Status eines Arbeitsganges innerhalb eines Projektes. */
export const OP_STATUS = {
  OPEN: 'OFFEN',
  DONE: 'FERTIG',
  NO_EFFORT: 'X', // "x" aus der Altplanung: erzeugt keinen Aufwand
};

export const PROJECT_STATUS = {
  DONE: 'FERTIG',
  IN_TIME: 'IN_TIME',
  CRITICAL: 'KRITISCH',
  LATE: 'VERSPAETET',
};

/**
 * Schluessel der Arbeitsplan-Vorlage fuer eine Projektart/Variante.
 * @param {string} projectType
 * @param {string|null|undefined} variant
 * @returns {string}
 */
export function routingKey(projectType, variant) {
  const type = PROJECT_TYPES.find((t) => t.id === projectType);
  if (type && type.hasVariant && variant) return `${projectType}_${variant}`;
  return projectType;
}

/**
 * Anzeigename einer Projektart/Variante.
 * @param {string} projectType @param {string|null} [variant]
 */
export function routingLabel(projectType, variant) {
  const t = PROJECT_TYPES.find((x) => x.id === projectType);
  const v = VARIANTS.find((x) => x.id === variant);
  return t ? (t.hasVariant && v ? `${t.name} ${v.name}` : t.name) : projectType;
}

/* ------------------------------------------------------------------ *
 * Abhaengigkeitstypen im Arbeitsfolgen-Netz
 * ------------------------------------------------------------------ */

export const DEP_TYPE = {
  /** Ende-Start: Nachfolger startet erst, wenn Vorgaenger vollstaendig fertig ist. */
  FS: 'FS',
  /**
   * Ueberlappend: Nachfolger darf anteilig starten, sobald der Vorgaenger
   * einen definierten Arbeitsvorsprung (leadHours) erarbeitet hat.
   * Genutzt fuer Heften -> Orbitalschweißen.
   */
  OVERLAP: 'OVERLAP',
};

/* ------------------------------------------------------------------ *
 * Arbeitsplaetze (eigene Entitaeten, Vorbereitung Belegungsplanung)
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} Workplace
 * @property {string} id
 * @property {string} name
 * @property {string} type          Arbeitsplatztyp (siehe OperationDef.workplaceType)
 * @property {boolean} active
 * @property {number} capacityUnits gleichzeitig bearbeitbare Auftraege
 * @property {string} [area]        Hallenbereich / Flaeche
 * @property {string} [note]
 */

/* ------------------------------------------------------------------ *
 * Projekt
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} ProjectOperation
 * @property {string} opId
 * @property {number} [plannedHours] Sollstunden laut Arbeitsplan (ggf. projektspezifisch)
 * @property {number} [remainingHours] Reststunden (Variante B, praeziser)
 * @property {string} [status]       OP_STATUS
 */

/**
 * @typedef {Object} Project
 * @property {string} id            stabile, dauerhafte ID
 * @property {string} orderNo       Auftragsnummer
 * @property {string} customer
 * @property {string} name
 * @property {string} projectType
 * @property {string|null} variant
 * @property {string|null} dueDate  FERTIGSTELLUNG = Deadline Armaturenbau
 * @property {string|null} handoverDate "Fertig" der Gesamtanlage (nur Information!)
 * @property {string} priority      P1..P4
 * @property {number} sequence      manuelle Reihenfolge (kleiner = frueher)
 * @property {boolean} sequenceLocked manuell fixierte Reihenfolge/Prioritaet
 * @property {'PERCENT'|'PER_OPERATION'|'NONE'} progressMode
 * @property {number} progressPercent Gesamtfortschritt in % (Variante A)
 * @property {ProjectOperation[]} operations projektspezifische Uebersteuerung
 * @property {number|null} totalHoursOverride Gesamtstunden abweichend vom Arbeitsplan
 * @property {string|null} materialAvailableFrom
 * @property {boolean} missingParts
 * @property {string} missingPartsNote
 * @property {string|null} missingPartsSince
 * @property {string|null} earliestStart
 * @property {boolean} done         vollstaendig fertig gemeldet
 * @property {string[]} [formerIds] frueher genutzte Bezeichnungen/IDs (Umbenennungen)
 * @property {Record<string, any>} [ruleOverrides] aus Regeln der Abteilung abgeleitet (rules.js)
 * @property {string} [note]
 * @property {boolean} [active]
 */

/** Erzeugt eine stabile ID. @param {string} prefix @returns {string} */
export function makeId(prefix = 'P') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`.toUpperCase();
}

/**
 * Legt ein Projekt mit sinnvollen Vorbelegungen an.
 * @param {Partial<Project>} p
 * @returns {Project}
 */
export function createProject(p = {}) {
  return {
    id: p.id || makeId('PRJ'),
    orderNo: p.orderNo ?? '',
    customer: p.customer ?? '',
    name: p.name ?? '',
    projectType: p.projectType ?? 'NEUBAU',
    variant: p.variant ?? null,
    dueDate: p.dueDate ?? null,
    handoverDate: p.handoverDate ?? null,
    priority: p.priority ?? 'P3',
    sequence: p.sequence ?? 0,
    sequenceLocked: p.sequenceLocked ?? false,
    progressMode: p.progressMode ?? 'NONE',
    progressPercent: p.progressPercent ?? 0,
    operations: p.operations ?? [],
    totalHoursOverride: p.totalHoursOverride ?? null,
    materialAvailableFrom: p.materialAvailableFrom ?? null,
    /**
     * Fehlteile: Das Material ist nicht vollstaendig da.
     *
     * Wichtig fuer die Bewertung: Eine Verspaetung aus Fehlteilen ist KEIN
     * Kapazitaetsproblem - mehr Personal oder Schichten helfen dort nicht.
     * Ist ein Liefertermin bekannt, gehoert er in materialAvailableFrom;
     * ohne Termin plant die Anwendung normal weiter und weist die Ursache
     * getrennt aus.
     */
    missingParts: p.missingParts === true,
    missingPartsNote: p.missingPartsNote ?? '',
    missingPartsSince: p.missingPartsSince ?? null,
    earliestStart: p.earliestStart ?? null,
    done: p.done ?? false,
    formerIds: p.formerIds ?? [],
    note: p.note ?? '',
    active: p.active !== false,
  };
}

/** Tiefe Kopie fuer Szenarien (strukturierte Daten ohne Funktionen). */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Tiefes Mergen von Konfigurationsobjekten (Arrays werden ersetzt). */
export function deepMerge(base, override) {
  if (override === undefined || override === null) return deepClone(base);
  /*
   * Steht im Vorgabewert ausdruecklich null (etwa "noch nichts
   * eingelesen"), gibt es nichts zu mischen - dann gilt der neue Wert.
   * Ohne diese Zeile lief die Rechnung auf "Cannot use 'in' operator",
   * weil typeof null ebenfalls 'object' ist.
   */
  if (base === undefined || base === null) return deepClone(override);
  if (Array.isArray(base) || Array.isArray(override)) return deepClone(override);
  if (typeof base !== 'object' || typeof override !== 'object') return deepClone(override);
  const out = deepClone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : deepClone(v);
  }
  return out;
}

/** Rundet auf 2 Nachkommastellen (Stundenwerte). @param {number} n */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Rundet auf 1 Nachkommastelle. @param {number} n */
export function round1(n) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
