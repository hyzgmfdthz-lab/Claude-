/**
 * Regeln der Abteilung.
 *
 * Der Anwender schreibt einen Satz ("Verschraubungen können nach dem Biegen
 * schon gemacht werden"). Daraus wird eine strukturierte Regel, die in der
 * Oberflaeche als Baukasten erscheint und dort nachgeschaerft werden kann.
 * Erst die strukturierte Regel wirkt auf die Planung - der Satz selbst ist
 * nur die Eingabehilfe.
 *
 * Die Uebersetzung laeuft vollstaendig lokal (Wortlisten und Muster), ohne
 * Internet und ohne Fremdbibliotheken.
 */

import { OPERATIONS, OPERATION_BY_ID, DEP_TYPE, PROJECT_TYPES, VARIANTS, makeId, deepClone } from './model.js';

/** Regelarten mit Klartextbezeichnung fuer die Oberflaeche. */
export const RULE_TYPES = {
  REIHENFOLGE: {
    id: 'REIHENFOLGE',
    label: 'Reihenfolge',
    description: 'Welcher Arbeitsgang darf wann beginnen?',
  },
  VORLAUF: {
    id: 'VORLAUF',
    label: 'Vorlauf',
    description: 'Arbeitsgänge dürfen früher beginnen als der übrige Auftrag.',
  },
  WOCHENTAGE: {
    id: 'WOCHENTAGE',
    label: 'Wochentage',
    description: 'Ein Arbeitsgang ist nur an bestimmten Wochentagen möglich.',
  },
  GRENZE: {
    id: 'GRENZE',
    label: 'Obergrenze',
    description: 'Höchstens so viele Mitarbeiter gleichzeitig an einem Arbeitsgang.',
  },
  AUFTRAGSFOLGE: {
    id: 'AUFTRAGSFOLGE',
    label: 'Auftragsreihenfolge',
    description: 'Ein Auftrag wird vor einem anderen gefertigt.',
  },
};

export const DEP_MODES = [
  { id: 'FS', label: 'erst danach (Vorgänger muss fertig sein)' },
  { id: 'OVERLAP', label: 'überlappend (darf schon beginnen)' },
  { id: 'PARALLEL', label: 'unabhängig (keine Abhängigkeit)' },
];

/** @type {[number, string][]} Wochentage fuer Regeltexte */
export const RULE_WEEKDAYS = [
  [1, 'Montag'], [2, 'Dienstag'], [3, 'Mittwoch'], [4, 'Donnerstag'], [5, 'Freitag'],
];

/* ------------------------------------------------------------------ *
 * Wortlisten
 * ------------------------------------------------------------------ */

/**
 * Sprachgebrauch der Abteilung je Arbeitsgang.
 * Die Liste ist bewusst grosszuegig - erkannt wird der laengste Treffer.
 */
export const OPERATION_WORDS = {
  SAEGEN: ['sägen', 'saegen', 'säge', 'saege', 'zuschnitt', 'ablängen', 'ablaengen', 'sägerei'],
  ENTGRATEN: ['entgraten', 'entgratung', 'entgrater'],
  BIEGEN: ['biegen', 'biegerei', 'rohrbiegen', 'gebogen'],
  HEFTEN: ['heften', 'heftplatz', 'heftplätze', 'tacken', 'geheftet', 'heftung'],
  ORBITAL: ['orbitalschweißen', 'orbitalschweissen', 'orbital', 'schweißen', 'schweissen', 'wig', 'orbitalmaschine'],
  BEIZEN: ['beizen', 'beize', 'passivieren', 'gebeizt'],
  VORMONTAGE: ['doppelklemmring', 'doppelklemmringmontage', 'dkr', 'verschraubung', 'verschraubungen',
    'klemmring', 'klemmringe', 'vormontage', 'montage der verschraubungen'],
  HYDRO: ['hydro', 'hydroprüfung', 'hydropruefung', 'abdrücken', 'abdruecken', 'druckprüfung', 'druckpruefung', 'druckprobe'],
  ENDKONTROLLE: ['endkontrolle', 'abnahme', 'endprüfung', 'endpruefung', 'schlusskontrolle'],
  REINIGEN: ['reinigen', 'reinigung', 'säubern', 'saeubern', 'putzen'],
};

/** Ausgeschriebene Zahlen, wie sie im Sprachgebrauch vorkommen. */
const ZAHLWORTE = {
  ein: 1, eine: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
};

/** Wandelt "3" oder "drei" in eine Zahl. */
function zahl(text) {
  if (text == null) return NaN;
  const roh = String(text).trim().toLowerCase().replace(',', '.');
  if (roh in ZAHLWORTE) return ZAHLWORTE[roh];
  const n = Number(roh);
  return Number.isFinite(n) ? n : NaN;
}

/** Vereinheitlicht den Text fuer die Suche (Kleinschreibung, Umlaute bleiben). */
function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Findet alle genannten Arbeitsgaenge mit ihrer Position im Satz.
 * @param {string} text
 * @returns {{opId:string, index:number, word:string}[]}
 */
export function findOperations(text) {
  const hay = normalize(text);
  /** @type {{opId:string, index:number, word:string}[]} */
  const hits = [];
  for (const [opId, words] of Object.entries(OPERATION_WORDS)) {
    let best = null;
    for (const word of [...words].sort((a, b) => b.length - a.length)) {
      const idx = hay.indexOf(word);
      if (idx >= 0 && (!best || word.length > best.word.length)) best = { opId, index: idx, word };
    }
    if (best) hits.push(best);
  }
  // Ueberlappende Treffer entfernen (z. B. "schweißen" in "orbitalschweißen")
  const sorted = hits.sort((a, b) => a.index - b.index);
  return sorted.filter((hit, i) => !sorted.some((other, j) => j !== i
    && other.index <= hit.index
    && other.index + other.word.length >= hit.index + hit.word.length
    && other.word.length > hit.word.length));
}

/* ------------------------------------------------------------------ *
 * Freitext -> Regel
 * ------------------------------------------------------------------ */

/**
 * Uebersetzt einen Satz in eine Regel.
 *
 * @param {string} text
 * @param {{projects?:any[]}} [ctx]
 * @returns {{ok:boolean, rule:any|null, issues:string[], understood:string[]}}
 */
export function parseRuleText(text, ctx = {}) {
  const raw = String(text ?? '').trim();
  const hay = normalize(raw);
  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  const understood = [];
  if (!hay) return { ok: false, rule: null, issues: ['Bitte die Regel als Satz eintragen.'], understood };

  const ops = findOperations(hay);
  const base = {
    id: makeId('REG'),
    text: raw,
    enabled: true,
    scope: { kind: 'ALL', projectTypes: [], variants: [], projectIds: [] },
    createdAt: new Date().toISOString(),
    createdBy: '',
  };

  /* ---- 1) Auftragsreihenfolge: zwei Auftragsnummern ---- */
  const orders = findOrders(hay, ctx.projects ?? []);
  if (orders.length >= 2 && /\bvor\b|\bzuerst\b|\bvorher\b/.test(hay)) {
    understood.push(`Aufträge erkannt: ${orders.map((o) => o.orderNo).join(', ')}`);
    return {
      ok: true,
      issues,
      understood,
      rule: {
        ...base,
        type: 'AUFTRAGSFOLGE',
        params: { beforeProjectId: orders[0].id, afterProjectId: orders[1].id },
        scope: { kind: 'ALL', projectTypes: [], variants: [], projectIds: [] },
      },
    };
  }

  /* ---- 2) Wochentage ---- */
  const wochentage = findWeekdays(hay);
  const zeitspanne = /\d+\s*(wochen|woche|tage|tagen|tag)/.test(hay);
  if (wochentage.days.length > 0 && !zeitspanne) {
    if (ops.length === 0) {
      return {
        ok: false,
        rule: null,
        understood,
        issues: ['Kein Arbeitsgang erkannt – bitte den Arbeitsgang nennen '
          + '(z. B. „Hydroprüfung darf nur Dienstag bis Donnerstag gemacht werden").'],
      };
    }
    const namen = wochentage.days.map((d) => RULE_WEEKDAYS.find(([n]) => n === d)?.[1]);
    understood.push(wochentage.negiert
      ? `Verneinung erkannt – erlaubt bleiben: ${namen.join(', ') || 'kein Tag'}`
      : `Wochentage erkannt: ${namen.join(', ')}`);
    if (wochentage.days.length === 0) {
      issues.push('So bliebe kein einziger Wochentag übrig – bitte prüfen.');
    }
    return {
      ok: wochentage.days.length > 0,
      issues,
      understood,
      rule: wochentage.days.length > 0
        ? { ...base, type: 'WOCHENTAGE', params: { opId: ops[0].opId, weekdays: wochentage.days } }
        : null,
    };
  }

  /* ---- 3) Obergrenze: hoechstens N Mitarbeiter ---- */
  const zahlMuster = '(\\d+|ein|eine|einem|einer|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)';
  const limit = hay.match(new RegExp(
    `(?:höchstens|hoechstens|maximal|max\\.?|nicht mehr als|nur|bis zu)\\s+${zahlMuster}\\s*`
    + '(?:mitarbeiter|mitarbeiterin|leute|personen|mann|kollegen|schweißer|schweisser)', 'i'))
    ?? hay.match(new RegExp(
      `${zahlMuster}\\s*(?:mitarbeiter|leute|personen|mann|kollegen)\\s*(?:gleichzeitig|parallel|zeitgleich)`, 'i'));
  if (limit && ops.length > 0 && Number.isFinite(zahl(limit[1]))) {
    const anzahl = zahl(limit[1]);
    understood.push(`Obergrenze erkannt: ${anzahl} Mitarbeiter gleichzeitig`);
    return {
      ok: true,
      issues,
      understood,
      rule: { ...base, type: 'GRENZE', params: { opId: ops[0].opId, maxWorkers: anzahl } },
    };
  }

  /* ---- 4) Vorlauf: "8-10 Wochen vor dem Heften starten" ---- */
  // Zeitspanne ("8-10 Wochen") oder einzelner Wert ("8 Wochen"), jeweils mit
  // dem Hinweis "vor/frueher/vorher" irgendwo im Satz.
  const range = hay.match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|bis)\s*(\d+(?:[.,]\d+)?)\s*(wochen|woche|tage|tagen|tag)/);
  const single = hay.match(/(\d+(?:[.,]\d+)?)\s*(wochen|woche|tage|tagen|tag)/);
  const lead = (range || single) && /\bvor\b|früher|frueher|vorher|vorziehen|vorlauf|im voraus|eher/.test(hay)
    ? (range ?? single)
    : null;
  if (lead && ops.length > 0) {
    const numbers = (range ? [range[1], range[2]] : [single[1]])
      .map((x) => Number(String(x).replace(',', '.')))
      .filter((x) => Number.isFinite(x));
    const unit = range ? range[3] : single[2];
    const weeks = /tag/.test(String(unit)) ? Math.max(...numbers) / 5 : Math.max(...numbers);
    // Bezug: der Arbeitsgang NACH "vor dem ..." ist der Anker
    const anchorIdx = hay.search(/\bvor\s+(dem|der|den)?\s*/);
    const anchor = ops.find((o) => anchorIdx >= 0 && o.index > anchorIdx) ?? null;
    const targets = ops.filter((o) => !anchor || o.opId !== anchor.opId);
    const ignoreMaterial = /(roh)?material (ist )?(vorhanden|verfügbar|verfuegbar|da)|material vorhanden/.test(hay);
    if (numbers.length > 1) {
      understood.push(`Zeitspanne ${numbers.join('–')} erkannt – es gilt der größte Wert (${weeks}).`);
    }
    if (anchor) understood.push(`Bezug: ${OPERATION_BY_ID[anchor.opId].name}`);
    if (ignoreMaterial) understood.push('Material gilt für diese Arbeitsgänge als vorhanden.');
    if (targets.length === 0) {
      return { ok: false, rule: null, understood, issues: ['Es ist nicht erkennbar, welche Arbeitsgänge früher beginnen dürfen.'] };
    }
    return {
      ok: true,
      issues,
      understood,
      rule: {
        ...base,
        type: 'VORLAUF',
        params: {
          opIds: targets.map((o) => o.opId),
          weeks: Math.round(weeks * 10) / 10,
          anchor: anchor ? 'OP' : 'DUE',
          anchorOpId: anchor?.opId ?? null,
          ignoreMaterial,
        },
      },
    };
  }

  /* ---- 5) Reihenfolge ---- */
  if (ops.length >= 2) {
    // "nach"/"sobald"/"bevor": der Arbeitsgang DAHINTER ist der Vorgaenger.
    const nachMarke = hay.search(/\b(nach|sobald|wenn|im anschluss an|anschließend an|anschliessend an|bevor|solange)\b/);
    // "vor": der Arbeitsgang DAVOR ist der Vorgaenger ("Beizen kommt vor der Vormontage").
    const vorMarke = hay.search(/\b(vor|vorher|zuerst|zunächst|zunaechst)\b/);
    const parallel = /\bparallel\b|\bgleichzeitig\b|\bzeitgleich\b|\bunabhängig\b|\bunabhaengig\b/.test(hay);
    const overlap = /\bschon\b|\bbereits\b|\büberlappend\b|\bueberlappend\b|\bsobald\b|\bwährend\b|\bwaehrend\b|\bangefangen\b|\bbegonnen\b/.test(hay);

    let target = ops[0];
    let predecessor = ops[1];
    if (nachMarke >= 0) {
      const dahinter = ops.find((o) => o.index > nachMarke);
      if (dahinter) {
        predecessor = dahinter;
        target = ops.find((o) => o.opId !== dahinter.opId) ?? ops[0];
      }
    } else if (vorMarke >= 0) {
      const davor = [...ops].reverse().find((o) => o.index < vorMarke);
      const dahinter = ops.find((o) => o.index > vorMarke);
      if (davor && dahinter && davor.opId !== dahinter.opId) {
        predecessor = davor;
        target = dahinter;
      }
    }
    const mode = parallel ? 'PARALLEL' : overlap ? 'OVERLAP' : 'FS';
    understood.push(`${OPERATION_BY_ID[target.opId].name} ${mode === 'PARALLEL' ? 'unabhängig von' : 'nach'} ${OPERATION_BY_ID[predecessor.opId].name}`);
    if (mode === 'OVERLAP') understood.push('Überlappend – darf beginnen, bevor der Vorgänger ganz fertig ist.');
    return {
      ok: true,
      issues,
      understood,
      rule: {
        ...base,
        type: 'REIHENFOLGE',
        params: { opId: target.opId, afterOpId: predecessor.opId, mode, leadHours: mode === 'OVERLAP' ? 0 : null },
      },
    };
  }

  /* ---- nichts erkannt ---- */
  if (ops.length === 1) {
    return {
      ok: false,
      rule: null,
      understood: [`Arbeitsgang erkannt: ${OPERATION_BY_ID[ops[0].opId].name}`],
      issues: ['Es fehlt die Aussage – zum Beispiel „… darf nach dem Biegen beginnen", '
        + '„… nur dienstags", „… höchstens 2 Mitarbeiter" oder „… 8 Wochen vor dem Heften".'],
    };
  }
  return {
    ok: false,
    rule: null,
    understood,
    issues: ['Kein Arbeitsgang erkannt. Bitte den Arbeitsgang mit Namen nennen, '
      + 'z. B. Sägen, Entgraten, Biegen, Heften, Orbitalschweißen, Beizen, '
      + 'Doppelklemmring-Vormontage, Hydroprüfung, Endkontrolle, Reinigen.'],
  };
}

/** Auftragsnummern im Text finden. */
function findOrders(hay, projects) {
  const found = [];
  for (const p of projects) {
    const no = normalize(p.orderNo ?? '');
    if (no && hay.includes(no)) found.push({ id: p.id, orderNo: p.orderNo, index: hay.indexOf(no) });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Wochentage im Text finden - moeglichst tolerant.
 *
 * Erkannt werden ausgeschriebene Namen und Abkuerzungen, Mehrzahl- und
 * Beugungsformen ("donnerstags", "an Donnerstagen", "Di.", "DO"), sowie
 * Zeitspannen in jeder Schreibweise ("Di-Do", "dienstags bis donnerstags",
 * "von Dienstag bis Donnerstag").
 *
 * @param {string} hay bereits kleingeschriebener Text
 * @returns {{days:number[], negiert:boolean}}
 */
function findWeekdays(hay) {
  /** @type {{tag:number, lang:string, kurz:string}[]} */
  const NAMEN = [
    { tag: 1, lang: 'montag', kurz: 'mo' },
    { tag: 2, lang: 'dienstag', kurz: 'di' },
    { tag: 3, lang: 'mittwoch', kurz: 'mi' },
    { tag: 4, lang: 'donnerstag', kurz: 'do' },
    { tag: 5, lang: 'freitag', kurz: 'fr' },
  ];
  const muster = /\b(montags?|montagen|mo|dienstags?|dienstagen|di|mittwochs?|mittwochen|mi|donnerstags?|donnerstagen|do|freitags?|freitagen|fr)\b\.?/g;

  /** @type {{tag:number, start:number, ende:number}[]} */
  const treffer = [];
  for (const m of hay.matchAll(muster)) {
    const wort = m[1];
    const eintrag = NAMEN.find((n) => wort === n.kurz || wort.startsWith(n.lang));
    if (!eintrag) continue;
    treffer.push({ tag: eintrag.tag, start: m.index ?? 0, ende: (m.index ?? 0) + m[0].length });
  }
  if (treffer.length === 0) return { days: [], negiert: false };

  const tage = new Set(treffer.map((t) => t.tag));

  // Zeitspannen: zwischen zwei Nennungen steht nur ein Bindestrich oder "bis"
  for (let i = 0; i < treffer.length - 1; i++) {
    const dazwischen = hay.slice(treffer[i].ende, treffer[i + 1].start);
    if (/^[\s.,]*(?:-|–|—|bis(?:\s+einschließlich|\s+einschliesslich)?)[\s.,]*$/.test(dazwischen)) {
      const von = Math.min(treffer[i].tag, treffer[i + 1].tag);
      const zu = Math.max(treffer[i].tag, treffer[i + 1].tag);
      for (let d = von; d <= zu; d++) tage.add(d);
    }
  }

  // Verneinung: "keine Hydroprüfung freitags", "außer montags", "nicht am Freitag"
  const negiert = /\b(kein|keine|keinen|nicht|niemals|außer|ausser|ohne)\b/.test(hay);
  const liste = [...tage].sort((a, b) => a - b);
  if (negiert) {
    return { days: [1, 2, 3, 4, 5].filter((d) => !tage.has(d)), negiert: true };
  }
  return { days: liste, negiert: false };
}

/* ------------------------------------------------------------------ *
 * Regel -> Klartext
 * ------------------------------------------------------------------ */

const opName = (id) => OPERATION_BY_ID[id]?.name ?? id;

/**
 * Beschreibt eine Regel in einem Satz (fuer Liste, Protokoll und Pruefung).
 * @param {any} rule
 * @param {{projects?:any[]}} [ctx]
 */
export function ruleSummary(rule, ctx = {}) {
  if (!rule) return '';
  const p = rule.params ?? {};
  let core = '';
  switch (rule.type) {
    case 'REIHENFOLGE':
      core = p.mode === 'PARALLEL'
        ? `${opName(p.opId)} ist unabhängig von ${opName(p.afterOpId)} (kann gleichzeitig laufen)`
        : p.mode === 'OVERLAP'
          ? `${opName(p.opId)} darf beginnen, sobald ${opName(p.afterOpId)} angefangen hat`
            + (Number(p.leadHours) > 0 ? ` (Vorsprung ${p.leadHours} h)` : '')
          : `${opName(p.opId)} beginnt erst, wenn ${opName(p.afterOpId)} fertig ist`;
      break;
    case 'VORLAUF':
      core = `${(p.opIds ?? []).map(opName).join(', ')} dürfen bis zu ${p.weeks} Wochen früher beginnen`
        + (p.anchor === 'OP' && p.anchorOpId ? ` (gedacht als Vorlauf vor ${opName(p.anchorOpId)})` : ' (gerechnet ab Fertigstellungstermin)')
        + (p.ignoreMaterial ? '; Material gilt als vorhanden' : '');
      break;
    case 'WOCHENTAGE':
      core = `${opName(p.opId)} nur ${(p.weekdays ?? []).map((d) => RULE_WEEKDAYS.find(([n]) => n === d)?.[1]).join(', ')}`;
      break;
    case 'GRENZE':
      core = `höchstens ${p.maxWorkers} Mitarbeiter gleichzeitig an ${opName(p.opId)}`;
      break;
    case 'AUFTRAGSFOLGE': {
      const no = (id) => (ctx.projects ?? []).find((x) => x.id === id)?.orderNo ?? id;
      core = `Auftrag ${no(p.beforeProjectId)} wird vor ${no(p.afterProjectId)} gefertigt`;
      break;
    }
    default:
      core = 'unbekannte Regelart';
  }
  return `${core} · ${scopeSummary(rule.scope, ctx)}`;
}

/** Klartext des Geltungsbereichs. */
export function scopeSummary(scope, ctx = {}) {
  if (!scope || scope.kind === 'ALL') return 'gilt für alle Aufträge';
  if (scope.kind === 'TYPE') {
    const types = (scope.projectTypes ?? []).map((t) => PROJECT_TYPES.find((x) => x.id === t)?.name ?? t);
    const variants = (scope.variants ?? []).map((v) => VARIANTS.find((x) => x.id === v)?.name ?? v);
    if (types.length === 0 && variants.length === 0) return 'gilt für alle Aufträge';
    return `gilt für ${[types.join(', '), variants.join(', ')].filter(Boolean).join(' / ')}`;
  }
  const nos = (scope.projectIds ?? []).map((id) => (ctx.projects ?? []).find((p) => p.id === id)?.orderNo ?? id);
  return nos.length ? `gilt für ${nos.join(', ')}` : 'gilt für keinen Auftrag (bitte Aufträge wählen)';
}

/* ------------------------------------------------------------------ *
 * Pruefung
 * ------------------------------------------------------------------ */

/**
 * Prueft Regeln auf Widersprueche und Unmoeglichkeiten.
 * Eine Regel mit Befund wird NICHT angewendet - und laesst sich nicht
 * speichern, solange der Befund besteht.
 *
 * @param {any[]} rules
 * @param {{projects?:any[], templates?:any}} [ctx]
 * @returns {Record<string, {level:'FEHLER'|'HINWEIS', text:string}[]>}
 */
export function checkRules(rules, ctx = {}) {
  /** @type {Record<string, any[]>} */
  const result = {};
  const add = (id, level, text) => { (result[id] ??= []).push({ level, text }); };
  const active = (rules ?? []).filter((r) => r && r.enabled !== false);

  for (const rule of rules ?? []) {
    const p = rule.params ?? {};
    switch (rule.type) {
      case 'REIHENFOLGE':
        if (!OPERATION_BY_ID[p.opId] || !OPERATION_BY_ID[p.afterOpId]) {
          add(rule.id, 'FEHLER', 'Unbekannter Arbeitsgang.');
        } else if (p.opId === p.afterOpId) {
          add(rule.id, 'FEHLER', 'Ein Arbeitsgang kann nicht von sich selbst abhängen.');
        }
        break;
      case 'VORLAUF':
        if (!(p.opIds ?? []).length) add(rule.id, 'FEHLER', 'Kein Arbeitsgang ausgewählt.');
        if (!(Number(p.weeks) > 0)) add(rule.id, 'FEHLER', 'Der Vorlauf muss größer als 0 sein.');
        if (Number(p.weeks) > 52) add(rule.id, 'HINWEIS', 'Mehr als ein Jahr Vorlauf – ist das beabsichtigt?');
        break;
      case 'WOCHENTAGE':
        if (!(p.weekdays ?? []).length) add(rule.id, 'FEHLER', 'Es ist kein Wochentag ausgewählt – so wäre der Arbeitsgang nie möglich.');
        if (rule.scope && rule.scope.kind !== 'ALL') {
          add(rule.id, 'HINWEIS', 'Wochentagsregeln gelten immer für alle Aufträge (der Arbeitsplatz steht allen gemeinsam zur Verfügung).');
        }
        break;
      case 'GRENZE':
        if (!(Number(p.maxWorkers) > 0)) add(rule.id, 'FEHLER', 'Die Obergrenze muss mindestens 1 sein.');
        break;
      case 'AUFTRAGSFOLGE':
        if (!p.beforeProjectId || !p.afterProjectId) add(rule.id, 'FEHLER', 'Es fehlt einer der beiden Aufträge.');
        else if (p.beforeProjectId === p.afterProjectId) add(rule.id, 'FEHLER', 'Beide Angaben zeigen auf denselben Auftrag.');
        break;
      default:
        add(rule.id, 'FEHLER', 'Unbekannte Regelart.');
    }
    if (rule.scope?.kind === 'PROJECT' && !(rule.scope.projectIds ?? []).length) {
      add(rule.id, 'FEHLER', 'Es ist kein Auftrag ausgewählt, für den die Regel gelten soll.');
    }
  }

  // Widersprueche zwischen Regeln
  for (const a of active) {
    for (const b of active) {
      if (a === b || a.type !== 'REIHENFOLGE' || b.type !== 'REIHENFOLGE') continue;
      if (!overlappingScope(a.scope, b.scope)) continue;
      if (a.params.opId === b.params.afterOpId && a.params.afterOpId === b.params.opId
        && a.params.mode !== 'PARALLEL' && b.params.mode !== 'PARALLEL') {
        add(a.id, 'FEHLER', `Widerspruch zu „${ruleSummary(b, ctx)}": beide Arbeitsgänge sollen jeweils auf den anderen warten.`);
      }
      if (a.id !== b.id && a.params.opId === b.params.opId && a.params.afterOpId !== b.params.afterOpId) {
        add(a.id, 'HINWEIS', `Eine weitere Regel bestimmt den Beginn von ${opName(a.params.opId)} – es gilt die zuletzt angelegte.`);
      }
    }
  }

  // Kreis ueber mehrere Regeln (A wartet auf B, B auf C, C wieder auf A)
  const edges = active.filter((r) => r.type === 'REIHENFOLGE' && r.params.mode !== 'PARALLEL')
    .map((r) => ({ from: r.params.afterOpId, to: r.params.opId, rule: r }));
  for (const start of edges) {
    // Vom Nachfolger aus weitersuchen: fuehrt ein Weg zurueck zum Vorgaenger,
    // warten die Arbeitsgaenge im Kreis aufeinander.
    const besucht = new Set();
    const offen = [start.to];
    let kreis = false;
    while (offen.length > 0) {
      const knoten = offen.pop();
      if (knoten === start.from) { kreis = true; break; }
      if (besucht.has(knoten)) continue;
      besucht.add(knoten);
      for (const e of edges) if (e.from === knoten) offen.push(e.to);
    }
    if (kreis) {
      add(start.rule.id, 'FEHLER',
        'Die Regeln ergeben einen Kreis: die Arbeitsgänge warten im Kreis aufeinander.');
    }
  }

  return result;
}

/** Ueberschneiden sich zwei Geltungsbereiche? */
function overlappingScope(a, b) {
  if (!a || !b) return true;
  if (a.kind === 'ALL' || b.kind === 'ALL') return true;
  if (a.kind === 'PROJECT' && b.kind === 'PROJECT') {
    return (a.projectIds ?? []).some((id) => (b.projectIds ?? []).includes(id));
  }
  if (a.kind === 'TYPE' && b.kind === 'TYPE') {
    const types = (a.projectTypes ?? []).some((t) => (b.projectTypes ?? []).includes(t));
    return types || (a.projectTypes ?? []).length === 0 || (b.projectTypes ?? []).length === 0;
  }
  return true;
}

/** Hat eine Regel einen Fehler (dann wirkt sie nicht)? */
export function hasError(issues) {
  return (issues ?? []).some((i) => i.level === 'FEHLER');
}

/* ------------------------------------------------------------------ *
 * Anwendung auf die Planung
 * ------------------------------------------------------------------ */

/** Gilt die Regel fuer diesen Auftrag? */
export function ruleAppliesTo(rule, project) {
  const scope = rule.scope ?? { kind: 'ALL' };
  if (scope.kind === 'ALL') return true;
  if (scope.kind === 'PROJECT') return (scope.projectIds ?? []).includes(project.id);
  if (scope.kind === 'TYPE') {
    const types = scope.projectTypes ?? [];
    const variants = scope.variants ?? [];
    const typeOk = types.length === 0 || types.includes(project.projectType);
    const variantOk = variants.length === 0 || variants.includes(project.variant);
    return typeOk && variantOk;
  }
  return false;
}

/**
 * Wendet die Regeln auf einen Planungsdatensatz an.
 *
 * Die Regeln erzeugen auftragsbezogene Uebersteuerungen der Arbeitsfolge
 * (`project.ruleOverrides`) sowie einzelne Ergaenzungen der Konfiguration.
 * Der eigentliche Planungsalgorithmus bleibt davon unberuehrt.
 *
 * @param {{config:any, projects:any[], templates:any, rules?:any[]}} input
 * @returns {{applied:any[], skipped:any[]}}
 */
export function applyRules(input) {
  const all = input.rules ?? [];
  const disabled = new Set(input.config?.rules?.disabled ?? []);
  const issues = checkRules(all, { projects: input.projects });
  const applied = [];
  const skipped = [];

  const active = all.filter((r) => {
    if (r.enabled === false || disabled.has(r.id)) { skipped.push({ id: r.id, reason: 'ausgeschaltet' }); return false; }
    if (hasError(issues[r.id])) { skipped.push({ id: r.id, reason: issues[r.id].find((i) => i.level === 'FEHLER').text }); return false; }
    return true;
  });
  if (active.length === 0) return { applied, skipped };

  for (const project of input.projects) {
    /** @type {Record<string, any>} */
    const overrides = {};
    for (const rule of active) {
      if (!ruleAppliesTo(rule, project)) continue;
      const p = rule.params ?? {};
      if (rule.type === 'REIHENFOLGE') {
        overrides[p.opId] = {
          ...(overrides[p.opId] ?? {}),
          predecessors: p.mode === 'PARALLEL' ? [] : [{
            opId: p.afterOpId,
            type: p.mode === 'OVERLAP' ? DEP_TYPE.OVERLAP : DEP_TYPE.FS,
            leadHours: p.mode === 'OVERLAP' ? (p.leadHours ?? 0) : null,
          }],
        };
        applied.push(rule.id);
      } else if (rule.type === 'VORLAUF') {
        for (const opId of p.opIds ?? []) {
          overrides[opId] = {
            ...(overrides[opId] ?? {}),
            releaseWeeksBeforeDue: Number(p.weeks) || 0,
            ignoreMaterial: !!p.ignoreMaterial,
          };
        }
        applied.push(rule.id);
      } else if (rule.type === 'GRENZE') {
        overrides[p.opId] = { ...(overrides[p.opId] ?? {}), maxWorkers: Number(p.maxWorkers) };
        applied.push(rule.id);
      }
    }
    if (Object.keys(overrides).length > 0) project.ruleOverrides = overrides;
  }

  // Wochentage wirken auf den Arbeitsplatz und damit auftragsuebergreifend
  for (const rule of active.filter((r) => r.type === 'WOCHENTAGE')) {
    input.config.operationWeekdays = {
      ...(input.config.operationWeekdays ?? {}),
      [rule.params.opId]: [...(rule.params.weekdays ?? [])],
    };
    applied.push(rule.id);
  }

  // Auftragsreihenfolge
  for (const rule of active.filter((r) => r.type === 'AUFTRAGSFOLGE')) {
    const before = input.projects.find((x) => x.id === rule.params.beforeProjectId);
    const after = input.projects.find((x) => x.id === rule.params.afterProjectId);
    if (!before || !after) continue;
    if ((before.sequence ?? 0) >= (after.sequence ?? 0)) {
      before.sequence = (after.sequence ?? 0) - 5;
      before.sequenceLocked = true;
    }
    applied.push(rule.id);
  }

  return { applied: [...new Set(applied)], skipped };
}

/** Neue, leere Regel einer bestimmten Art (fuer den Baukasten). */
export function emptyRule(type = 'REIHENFOLGE') {
  const base = {
    id: makeId('REG'),
    text: '',
    type,
    enabled: true,
    scope: { kind: 'ALL', projectTypes: [], variants: [], projectIds: [] },
    createdAt: new Date().toISOString(),
    createdBy: '',
  };
  const defaults = {
    REIHENFOLGE: { opId: OPERATIONS[0].id, afterOpId: OPERATIONS[1].id, mode: 'FS', leadHours: null },
    VORLAUF: { opIds: [OPERATIONS[0].id], weeks: 4, anchor: 'DUE', anchorOpId: null, ignoreMaterial: false },
    WOCHENTAGE: { opId: 'HYDRO', weekdays: [2, 3, 4] },
    GRENZE: { opId: OPERATIONS[0].id, maxWorkers: 2 },
    AUFTRAGSFOLGE: { beforeProjectId: null, afterProjectId: null },
  };
  return { ...base, params: deepClone(defaults[type] ?? {}) };
}
