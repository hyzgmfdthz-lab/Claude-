/**
 * Uebersicht - was ist los, und warum.
 *
 * Erste Ansicht nach der Anmeldung. Sie aendert nichts, sie beantwortet:
 * Halten wir die Termine, wo klemmt es, und kommt mir etwas komisch vor.
 * Gestellt wird an den Stellschrauben (Panel rechts, von hier aus mit
 * einem Klick erreichbar) - die Wirkung erscheint unverzueglich hier.
 *
 * Aufgeteilt in zwei Reiter, damit nicht wieder alles auf einer Seite
 * steht: "Kennzahlen" beantwortet den Stand, "Engpässe und Wirkung"
 * beantwortet, was dagegen hilft.
 */

import { h, card, fold, kpi, tile, fmt, table, statusPill, confirmDialog, modal, toast } from '../ui.js';
import { api } from '../api.js';
import { capacityChart, capacityLegend, utilizationMatrix } from '../charts.js';
import { openProject } from './projects.js';


/** Reiter 1: der Stand. */
export function render(a) {
  const an = a.analysis;
  const k = an.kpis;
  const weeks = an.weeks;

  return h('div.view',
    tileRow(a, k, an),
    answer(a),
    plausiCard(a),
    referenceLine(a),
    chartCard(a, weeks),
    h('div.grid.grid--2', weekTable(a, an), riskCard(a, an)),
    kpiRow(k, an));
}

/** Reiter 2: was hilft. */
export function renderEngpass(a) {
  const an = a.analysis;
  const cfg = a.scenarioCfg.config;
  return h('div.view',
    engpassKopf(a, an),
    kapazitaetRechenweg(a, an),
    stundenJeArbeitsgang(a, an),
    helpCard(a),
    workplaceCard(a, an),
    autoSchichtCard(a),
    shiftCard(a, an, cfg));
}

/**
 * Woher die Kapazitaet kommt - Zeile fuer Zeile.
 *
 * Gemeldet von der Abteilungsleitung (18.09.2026): "Die Zahlen und
 * Rechnungen sind nicht logisch. Ich habe 14 MA, es soll fuer 110 Tage
 * geplant werden ... 10731 h, das kann nicht stimmen."
 *
 * Der Grund war nicht ein Rechenfehler, sondern Schweigen: Die Anwendung
 * sagte nie, welchen ZEITRAUM eine Kapazitaetszahl abdeckt und woraus sie
 * besteht. Hier steht beides - und die Naeherung mit den Mittelwerten
 * daneben, damit man sie auf einem Blatt Papier nachrechnen kann.
 *
 * Zweite Rueckmeldung (18.09.2026): "Was hat 1 % in der Rechnung verloren?
 * Warum gibt es da so ein grosses Defizit?" Beides war berechtigt:
 *   - Die Produktivitaet (0,9333) wurde als "1 %" ausgegeben, weil der
 *     Prozentbaustein eine Zahl in Prozentpunkten erwartet.
 *   - Die Naeherung rechnete jeden Tag mit der REGELARBEITSZEIT. Bei 4 h
 *     Ueberstunden je Woche fehlten dadurch 943 h, und die Fusszeile schob
 *     es auf "Feiertage und Urlaub" - die stecken laengst in der mittleren
 *     Besetzung und in der Zahl der Arbeitstage.
 * Jetzt wird nach Tagesart getrennt gerechnet und jeder Posten benannt.
 */
function kapazitaetRechenweg(a, an) {
  const d = an.capacityDerivation;
  if (!d || d.workDays === 0) return null;
  const zeile = (was, wert, anmerkung) => h('tr',
    h('td', was),
    h('td', { style: { textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' } }, wert),
    h('td.small.muted', anmerkung ?? ''));
  /** Produktivitaet kommt als Faktor (0,9333) - fmt.pct erwartet Prozentpunkte. */
  const prozent = (faktor, stellen = 1) => fmt.pct((Number(faktor) || 0) * 100, stellen);

  return card('Woher die Kapazität kommt',
    h('div',
      h('div.small.muted', { style: { marginBottom: '8px' } },
        'Jede Kapazitätszahl gilt für einen Zeitraum. Ohne den Zeitraum lässt sich keine '
        + 'Stundenzahl prüfen – deshalb steht er hier zuerst.'),
      h('table.tbl',
        h('tbody',
          zeile('Zeitraum', `${fmt.date(d.from)} – ${fmt.date(d.to)}`,
            'bis zum spätesten Fertigstellungstermin'),
          zeile('Kalendertage', `${d.calendarDays}`,
            d.saturdayDays > 0
              ? `davon ${d.workDays} Arbeitstage – ${d.regularDays} reguläre und ${d.saturdayDays} Samstage`
              : `davon ${d.workDays} Arbeitstage`),
          /*
           * Arbeitsschutz sichtbar machen: Ein Tag mit nur einer Person
           * gibt keine Stunde her. Stand diese Zeile nicht da, sah ein
           * solcher Tag wie ein Rechenfehler aus.
           */
          d.minTogether > 1
            ? zeile('Mindestbesetzung', `${d.minTogether} Personen`,
              d.aloneDays > 0
                ? `Arbeitsschutz – niemand arbeitet allein. ${d.aloneDays} `
                  + `${d.aloneDays === 1 ? 'Tag' : 'Tage'} im Zeitraum sind deshalb mit 0 h `
                  + `gerechnet (${fmt.h(d.aloneHours)} entfallen).`
                : 'Arbeitsschutz – niemand arbeitet allein. Kein Tag im Zeitraum ist davon betroffen.')
            : null,
          zeile('Besetzung im Schnitt', `${fmt.num(d.regularHeadcount, 1)} MA`,
            'je regulärem Arbeitstag, nach Urlaub, Krankheit und Einarbeitung'),
          zeile('Stunden je MA und Tag', `${fmt.num(d.regularHoursPerDay, 2)} h`,
            d.overtimePerDay > 0.005
              ? `Regelarbeitszeit ${fmt.num(d.hoursPerDay, 2)} h `
                + `(${fmt.num(d.hoursPerWeek, 1)} h je Woche ÷ 5) + `
                + `${fmt.num(d.overtimePerDay, 2)} h Überstunden`
              : `${fmt.num(d.hoursPerWeek, 1)} h je Woche ÷ 5`),
          zeile('Produktivität', prozent(d.regularProductivity, 1),
            'Rüsten, Wege, Besprechungen'),
          d.saturdayDays > 0
            ? zeile('Samstage', `${fmt.num(d.saturdayHeadcount, 1)} MA × `
              + `${fmt.num(d.saturdayHoursPerDay, 2)} h`,
            `${d.saturdayDays} Samstage – eigene Länge und nur ein Teil der Mannschaft`)
            : null,

          /* --- Von hier an wird addiert, Posten für Posten --- */
          h('tr', { style: { borderTop: '2px solid var(--c-border)' } },
            h('td', 'Reguläre Arbeitstage'),
            h('td', { style: { textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' } },
              fmt.h(d.regularGrossHours)),
            h('td.small.muted', `${d.regularDays} Tage × ${fmt.num(d.regularHeadcount, 1)} MA × `
              + `${fmt.num(d.regularHoursPerDay, 2)} h × ${prozent(d.regularProductivity, 1)}`)),
          d.overtimeHours > 0.5
            ? zeile('darin Überstunden', `${fmt.h(d.overtimeHours)}`,
              `${fmt.num(d.overtimePerDay, 2)} h je MA und Tag über der Regelarbeitszeit – `
              + 'ohne sie fehlt genau dieser Betrag')
            : null,
          d.saturdayDays > 0
            ? zeile('+ Samstage', `${fmt.h(d.saturdayGrossHours)}`,
              `${d.saturdayDays} Tage × ${fmt.num(d.saturdayHeadcount, 1)} MA × `
              + `${fmt.num(d.saturdayHoursPerDay, 2)} h × ${prozent(d.saturdayProductivity, 1)}`)
            : null,
          d.mentoringTotal > 0.5
            ? zeile('− Betreuung neuer Kräfte', `− ${fmt.h(d.mentoringTotal)}`,
              `${fmt.num(d.mentoringPerDay, 2)} h je Arbeitstag – Einarbeitung von Leiharbeitern`)
            : null,
          zeile('− Reserve Zubehör', `− ${fmt.h(d.reserveTotal)}`,
            `${fmt.num(d.reservePerDay, 2)} h je Arbeitstag `
            + `(${fmt.num(d.reservePerWeek, 0)} h je Woche für Kleinarbeiten)`),
          h('tr', { style: { borderTop: '2px solid var(--c-border)' } },
            h('td', h('strong', 'Näherung mit diesen Mittelwerten')),
            h('td', { style: { textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' } },
              fmt.h(d.approxHours)),
            h('td.small.muted', 'die Posten darüber zusammengezählt')),
          zeile(h('strong', 'Ausgewiesene Kapazität'), h('strong', fmt.h(d.capacityHours)),
            'Tag für Tag gerechnet – das ist die Zahl in den Kennzahlen'),
          Math.abs(d.deviation) > 0.5
            ? zeile('Unterschied', `${d.deviation > 0 ? '+' : ''}${fmt.h(d.deviation)}`,
              'Rundung der Mittelwerte – Feiertage und Urlaub stecken schon in der '
              + 'Besetzung und in der Zahl der Arbeitstage')
            : null)),
      h('div.small.faint', { style: { marginTop: '8px' } },
        h('strong', 'Vorsicht bei Handrechnungen: '),
        'Wochenstunden dürfen nicht mit Kalendertagen multipliziert werden. '
        + `${fmt.num(d.hoursPerWeek, 1)} h je Woche sind ${fmt.num(d.hoursPerDay, 2)} h je Arbeitstag – `
        + `bei ${d.calendarDays} Kalendertagen sind das ${d.workDays} Arbeitstage, nicht ${d.calendarDays}.`,
        d.overtimeHours > 0.5
          ? h('div', { style: { marginTop: '4px' } },
            'Und: Überstunden gehören dazu. Wer mit ',
            `${fmt.num(d.hoursPerDay, 2)} h je Tag rechnet statt mit `,
            `${fmt.num(d.regularHoursPerDay, 2)} h, liegt in diesem Zeitraum um `,
            h('strong', fmt.h(d.overtimeHours)),
            ' zu niedrig.')
          : null)),
    { flush: true });
}

/**
 * Die Stunden, auf die Arbeitsgaenge gebucht.
 *
 * Vorgabe der Abteilungsleitung (18.09.2026): "buch bitte die Stunden auf
 * die Arbeitsgaenge bei Engpass & Wirkung, ich denke das macht die
 * Uebersicht einfacher."
 *
 * Die Tabelle ist so gebaut, dass sie sich nachrechnen laesst: Die Spalte
 * "offen" summiert sich genau auf die offene Arbeit aller Auftraege. Wer
 * die Zahlen anzweifelt, addiert die Spalte und vergleicht mit der
 * Fusszeile - das ist der Sinn.
 */
function stundenJeArbeitsgang(a, an) {
  const zeilen = (an.processBalance ?? []).filter((r) => r.contentManHours > 0.5 || r.blockedManHours > 0.5);
  if (zeilen.length === 0) return null;
  const summe = (feld) => zeilen.reduce((x, r) => x + (Number(r[feld]) || 0), 0);
  const offenGesamt = (an.projects ?? []).reduce((x, p) => x + (Number(p.remainingManHours) || 0), 0);

  return card('Stunden je Arbeitsgang',
    h('div',
      h('div.small.muted', { style: { marginBottom: '8px' } },
        `Zeitraum ${fmt.date(an.planningDate)} bis ${fmt.date(an.relevantUntil)}. `,
        h('strong', 'Nachrechnen erwünscht: '),
        'Die Spalte „offen" ergibt in der Summe genau die offene Arbeit aller Aufträge.'),
      table([
        { key: 'name', label: 'Arbeitsgang', render: (r) => h('strong', r.name) },
        { key: 'orders', label: 'Aufträge', num: true, render: (r) => (r.orders || '–') },
        {
          key: 'content',
          label: 'Arbeitsinhalt h',
          num: true,
          render: (r) => fmt.num(r.contentManHours),
        },
        {
          key: 'open',
          label: 'offen h',
          num: true,
          render: (r) => h('strong', fmt.num(r.openManHours)),
        },
        {
          key: 'perOrder',
          label: 'h je Auftrag',
          num: true,
          render: (r) => (r.orders > 0 ? fmt.num(r.contentManHours / r.orders, 1) : '–'),
        },
        {
          key: 'planned',
          label: 'eingeplant h',
          num: true,
          render: (r) => fmt.num(r.plannedManHours),
        },
        {
          key: 'notPlanned',
          label: 'nicht eingeplant h',
          num: true,
          render: (r) => (r.notPlannedManHours > 0.5
            ? h('span.pill.pill--red', fmt.num(r.notPlannedManHours))
            : h('span.faint', '–')),
        },
        {
          key: 'blocked',
          label: 'blieb liegen h',
          num: true,
          render: (r) => (r.blockedManHours > 0.5
            ? h('span', { title: `an ${r.blockedDays} Tagen, am stärksten ${fmt.num(r.blockedPeak, 1)} h`
                + `${r.blockedCause ? ` – ${r.blockedCause}` : ''}` },
              fmt.num(r.blockedManHours))
            : h('span.faint', '–')),
        },
        {
          key: 'blockedDays',
          label: 'an Tagen',
          num: true,
          render: (r) => (r.blockedDays > 0 ? `${r.blockedDays}` : h('span.faint', '–')),
        },
        {
          key: 'cause',
          label: 'bremst',
          render: (r) => (r.blockedCause ? h('span.small', r.blockedCause) : h('span.faint', '–')),
        },
      ], zeilen, { compact: true }),
      h('div.small', { style: { marginTop: '8px' } },
        h('strong', 'Summe: '),
        `Arbeitsinhalt ${fmt.h(summe('contentManHours'))}, offen ${fmt.h(summe('openManHours'))}, `
        + `eingeplant ${fmt.h(summe('plannedManHours'))}. `,
        Math.abs(summe('openManHours') - offenGesamt) < 1
          ? h('span.muted', `Stimmt mit der offenen Arbeit aller Aufträge überein (${fmt.h(offenGesamt)}).`)
          : h('span.pill.pill--red', `Weicht von der offenen Arbeit aller Aufträge ab (${fmt.h(offenGesamt)}) – bitte melden.`)),
      h('div.small.faint', { style: { marginTop: '6px' } },
        h('strong', '„blieb liegen" ist keine zweite Arbeitsmenge: '),
        'Es ist Arbeit aus der Spalte „offen", die an einer Grenze warten musste. '
        + 'Jede Arbeit zählt dort genau einmal – nicht für jeden Wartetag erneut.')),
    { flush: true });
}

/* ------------------------------------------------------------------ *
 * Die sechs Kacheln
 * ------------------------------------------------------------------ */

/**
 * Sechs Kacheln, festgelegt von der Abteilungsleitung: Termintreue,
 * zu spaet, Ueber Kapazitaet, groesster Engpass, freie Kapazitaet diese
 * Woche, Auffaelligkeiten. Bewusst FEST angeordnet - "sonst sieht jeder
 * etwas anderes und ihr redet aneinander vorbei".
 */
function tileRow(a, k, an) {
  const fehlt = Math.round(k.shortfallHours ?? 0);
  const pl = an.plausibility;
  const frei = freieKapazitaet(an);

  return h('div.tiles',
    tile('Termintreue', fmt.pct(k.otd, 0), {
      tone: k.otd >= 95 ? 'ok' : k.otd >= 75 ? 'warn' : 'bad',
      hint: `${k.inTime + k.critical} von ${k.totalProjects - k.done} offenen Aufträgen im Termin`,
    }),
    tile('Zu spät', k.late, {
      tone: k.late ? 'bad' : 'ok',
      hint: k.late
        ? `${fmt.num(k.totalLateDays, 0)} Verspätungstage · davon ${k.lateByMaterial} durch Fehlteile`
        : 'kein Auftrag liegt hinter seinem Termin',
    }),
    tile('Über Kapazität', fehlt > 0 ? `+${fmt.num(fehlt)}` : '0', {
      tone: fehlt > 0 ? 'bad' : 'ok',
      hint: fehlt > 0
        ? `Stunden zu viel bis ${fmt.week(k.shortfallWeek)} (${fmt.date(k.shortfallUntil)})`
        : 'die Kapazität reicht bis zu allen Terminen',
    }),
    /*
     * Frueher stand hier "x h nicht einplanbar". Diese Zahl war die Summe
     * einer Warteschlange ueber alle Tage - ein Auftrag, der fuenf Tage
     * wartete, zaehlte fuenfmal. Sie ist ersatzlos gestrichen; an ihre
     * Stelle tritt der Mehraufwand (siehe engine/mehraufwand.js).
     */
    tile('Größter Engpass', k.bottleneck?.label ?? 'keiner', {
      tone: k.bottleneck ? 'warn' : 'ok',
      small: true,
      hint: k.bottleneck
        ? (k.bottleneck.topOperation
          ? `vor allem ${opName(a, k.bottleneck.topOperation)}`
          : 'hier wartet die meiste Arbeit')
        : 'kein Prozess bremst',
      onclick: () => a.navigate('uebersicht/engpass'),
    }),
    tile('Freie Kapazität', frei.text, {
      tone: frei.tone,
      small: frei.small,
      hint: frei.hint,
    }),
    /*
     * FIX (gefunden 21.09.2026): "Aufträge gleichzeitig" und "Mitarbeiter
     * je Auftrag" werden bei Leerlauf automatisch gelockert (Nutzer-
     * entscheidung 21.09.2026). Diese Kachel ist der dafuer ausdruecklich
     * geforderte "sichtbare Hinweis" - ohne sie sah man keine Wirkung
     * beim Verstellen dieser Regler und keinen Grund dafuer.
     */
    (k.wipAusnahmen?.stunden ?? 0) > 0
      ? tile('WIP-Grenze gelockert', `${fmt.num(k.wipAusnahmen.stunden)} h`, {
        tone: 'info',
        small: true,
        hint: `an ${k.wipAusnahmen.tage} Tagen, weil sonst Mannschaftszeit leer gestanden hätte: `
          + Object.entries(k.wipAusnahmen.jeGrund).map(([g, h2]) => `${g} ${fmt.num(h2)} h`).join(', '),
      })
      : null,
    // Gezaehlt werden nur OFFENE Befunde - bestaetigte sind bewusst leise.
    tile('Auffälligkeiten', pl ? (pl.open ?? pl.items.length) : '–', {
      tone: pl?.worst === 'KRITISCH' ? 'bad' : pl?.worst === 'WARNUNG' ? 'warn' : pl?.open ? 'info' : 'ok',
      hint: pl ? pl.summary : 'keine Prüfung vorhanden',
      onclick: pl && pl.items.length ? () => plausiDialog(a) : undefined,
      title: 'Plausibilitätsprüfung ansehen',
    }));
}

/**
 * Freie Kapazitaet der laufenden Woche.
 *
 * Bewusst nicht "Kapazitaet gesamt": Was diese Woche noch frei ist,
 * entscheidet, ob man heute etwas dazwischenschieben kann.
 */
function freieKapazitaet(an) {
  const woche = an.weeks?.[0];
  if (!woche) return { text: '–', tone: 'info', hint: 'keine Woche im Zeitraum' };
  const frei = Math.round((woche.capacity ?? 0) - (woche.planned ?? 0));
  const quote = woche.capacity > 0 ? (woche.planned / woche.capacity) * 100 : 0;
  if (frei <= 0) {
    return {
      text: `${fmt.num(Math.abs(frei))} h zu viel`,
      small: true,
      tone: 'bad',
      hint: `${fmt.week(woche.weekKey)} ist mit ${fmt.pct(quote, 0)} verplant`,
    };
  }
  return {
    text: `${fmt.num(frei)} h`,
    tone: quote > 90 ? 'warn' : 'ok',
    hint: `${fmt.week(woche.weekKey)} ist mit ${fmt.pct(quote, 0)} verplant`,
  };
}

/** Kopfzeile des Reiters "Engpässe und Wirkung". */
function engpassKopf(a, an) {
  const k = an.kpis;
  const rang = (k.bottleneckRanking ?? []).slice(0, 3);
  return h('div.answer.answer--warn', { style: { marginBottom: '14px' } },
    h('div.answer__head', 'Was bremst, und was dagegen hilft'),
    h('div.answer__text', rang.length === 0
      ? 'Kein Engpass erkennbar – die Arbeit lässt sich einplanen.'
      : `${rang[0].label} bremst am stärksten: ${fmt.num(rang[0].manHours)} Stunden konnten nicht `
        + 'eingeplant werden.'),
    rang.length > 1 && h('div.answer__sub',
      'Dahinter: ',
      rang.slice(1).map((r) => `${r.label} (${fmt.num(r.manHours)} h)`).join(' · '),
      '. Wer den ersten Engpass löst, stößt auf den zweiten.'),
    h('div.answer__sub',
      h('strong', 'Reihenfolge des Vorgehens: '),
      'erst durchrechnen lassen, was wirklich etwas bringt, dann die Auslastung je Arbeitsplatz prüfen, '
      + 'dann die Schichtfrage.'));
}

/* ------------------------------------------------------------------ *
 * Stellschrauben
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Antwortzeile
 * ------------------------------------------------------------------ */

function answer(a) {
  const k = a.analysis.kpis;
  const box = h('div');
  const tone = k.late === 0 ? 'ok' : k.late <= 3 ? 'warn' : 'bad';

  const head = k.late === 0
    ? h('div.answer__text', 'Alle Termine werden gehalten.')
    : h('div.answer__text',
      `${k.late} von ${k.totalProjects} Aufträgen werden zu spät fertig`,
      k.maxLateDays ? ` – im schlimmsten Fall ${k.maxLateDays} Tage.` : '.');

  const sub = h('div.answer__sub',
    k.bottleneck
      ? h('span', h('strong', 'Wo es klemmt: '), `${k.bottleneck.label}`,
        k.bottleneck.topOperation ? ` (vor allem bei ${opName(a, k.bottleneck.topOperation)})` : '',
        // Frueher stand hier eine ueber alle Wartetage summierte
        // Warteschlange ("3.039 h") - eine Zahl in Stunden mal Tagen.
        // Jetzt: die Arbeit selbst, einmal gezaehlt, mit Tagen daneben.
        ` – dort mussten ${fmt.num(k.bottleneck.manHours)} Stunden Arbeit warten`
        + `${k.bottleneck.days ? `, an ${k.bottleneck.days} Tagen` : ''}`
        + `${k.bottleneck.peakHours ? ` (am stärksten ${fmt.num(k.bottleneck.peakHours, 1)} h an einem Tag)` : ''}.`)
      : 'Kein Engpass erkennbar.');

  const top3 = topEngpaesse(a);
  const fehlteile = fehlteilLine(a);

  const ueberhang = Math.round(k.shortfallHours ?? 0) > 0
    ? h('div.answer__sub',
      h('strong', 'Über Kapazität: '),
      `${fmt.num(k.shortfallHours)} Stunden mehr, als bis ${fmt.week(k.shortfallWeek)} `,
      `(${fmt.date(k.shortfallUntil)}) zur Verfügung stehen – `,
      `${fmt.num(k.shortfallDemand)} h Aufwand gegen ${fmt.num(k.shortfallCapacity)} h Kapazität bis dahin.`)
    : null;

    const staffLine = h('div.answer__sub', h('span.faint', 'Personalbedarf wird berechnet …'));
  loadStaff(a, staffLine);

  box.append(h(`div.answer.answer--${tone}`,
    h('div.answer__head', `Stand ${fmt.date(a.analysis.planningDate)} · ${a.analysis.projects.length} Aufträge`),
    head, sub, fehlteile, top3, ueberhang, staffLine, qualifikationsLine(a), besetzungsLine(a),
    plausiLine(a)));
  return box;
}

/* ------------------------------------------------------------------ *
 * Plausibilitaet
 * ------------------------------------------------------------------ */

/** Offene (nicht bestaetigte) Befunde. */
function offeneBefunde(pl) {
  return (pl?.items ?? []).filter((i) => !i.acknowledged);
}

/**
 * Einen Befund bestaetigen ("Thema ist abgestellt").
 *
 * Der Befund verschwindet aus Kachel und Ampel, bleibt aber unter
 * "bestätigt" nachlesbar und meldet sich wieder, wenn er dringender wird.
 */
async function bestaetige(a, item) {
  try {
    await api.ackFinding({ key: item.key, level: item.level, title: item.title });
    await a.reload();
    toast(`„${item.title}" ist bestätigt und zählt nicht mehr mit.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Der Befund konnte nicht bestätigt werden.', 'error');
  }
}

/** Bestaetigung zuruecknehmen. */
async function widerrufe(a, item) {
  try {
    await api.unackFinding(item.key);
    await a.reload();
    toast(`„${item.title}" zählt wieder mit.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Die Bestätigung konnte nicht aufgehoben werden.', 'error');
  }
}

/** Zahl und Kurzfassung der Auffaelligkeiten in der Antwortzeile. */
function plausiLine(a) {
  const pl = a.analysis.plausibility;
  const offen = offeneBefunde(pl);
  if (!pl || offen.length === 0) return null;
  const erste = offen[0];
  return h('div.answer__sub',
    h('strong', kritischSymbol(erste.level), ' Auffälligkeiten: '),
    pl.summary,
    ' – ',
    h('span', erste.title),
    '. ',
    h('button.btn.btn--sm', {
      style: { marginLeft: '6px' },
      onclick: () => plausiDialog(a),
    }, 'Alle ansehen'));
}

function kritischSymbol(level) {
  if (level === 'KRITISCH') return '⛔';
  if (level === 'WARNUNG') return '⚠';
  return 'ℹ';
}

/**
 * Karte "Kommt das so hin?".
 *
 * Auftrag der Abteilungsleitung: die Anwendung soll warnen, wenn ihr etwas
 * komisch vorkommt. Gezeigt werden die drei dringendsten Befunde - der
 * Rest steht im Fenster und vollstaendig unter "Daten & Prüfung".
 */
function plausiCard(a) {
  const pl = a.analysis.plausibility;
  if (!pl) return null;
  const offen = offeneBefunde(pl);
  const bestaetigt = pl.items.length - offen.length;
  if (offen.length === 0) {
    return card('Kommt das so hin?', h('div',
      h('div.small.muted', pl.items.length === 0
        ? 'Die Anwendung hat nichts Unplausibles gefunden.'
        : `Alle ${pl.items.length} Befunde sind bestätigt – es ist nichts Offenes übrig.`),
      bestaetigt > 0 && h('div.small.faint', { style: { marginTop: '6px' } },
        'Ein bestätigter Befund meldet sich wieder, wenn er dringender wird.')),
    {
      sub: 'Plausibilitätsprüfung',
      actions: bestaetigt > 0
        ? [h('button.btn.btn--sm', { onclick: () => plausiDialog(a) }, 'Bestätigte ansehen')]
        : [],
    });
  }
  const oben = offen.slice(0, 3);
  return card('Kommt das so hin?', h('div',
    h('div.plausi',
      ...oben.map((i) => plausiZeile(i, a))),
    offen.length > oben.length
      && h('div.small.faint', { style: { marginTop: '8px' } },
        `${offen.length - oben.length} weitere Befunde.`)),
  {
    sub: pl.summary,
    actions: [h('button.btn.btn--sm', { onclick: () => plausiDialog(a) }, 'Alle ansehen')],
  });
}

/**
 * Ein Befund als Block.
 *
 * Mit `a` bekommt der Block die Schaltflaeche "Erledigt" - ausdruecklicher
 * Wunsch der Abteilungsleitung: "Ich moechte Fehlermeldungen auch
 * bestaetigen und wegklicken koennen, wenn das Thema abgestellt ist."
 * Ohne `a` (Druckansicht, Listen) bleibt der Befund reine Anzeige.
 *
 * @param {any} i @param {any} [a]
 */
function plausiZeile(i, a) {
  const ton = i.acknowledged ? 'done' : i.level === 'KRITISCH' ? 'bad' : i.level === 'WARNUNG' ? 'warn' : 'info';
  return h(`div.plausi__item.plausi__item--${ton}`,
    h('div.plausi__head',
      h('span.plausi__mark', i.acknowledged ? '✓' : kritischSymbol(i.level)),
      h('strong', i.title),
      h('span.pill.pill--grey', { style: { marginLeft: 'auto' } }, i.area),
      a && (i.acknowledged
        ? h('button.btn.btn--sm', {
          title: 'Bestätigung aufheben – der Befund zählt wieder mit',
          onclick: () => widerrufe(a, i),
        }, 'Wieder anzeigen')
        : h('button.btn.btn--sm', {
          title: 'Thema ist abgestellt – Befund bestätigen und wegklicken',
          onclick: () => bestaetige(a, i),
        }, 'Erledigt'))),
    h('div.plausi__text', i.text),
    i.hint ? h('div.plausi__hint', i.hint) : null,
    i.ack?.reopened
      ? h('div.plausi__hint', `War am ${fmt.date(String(i.ack.at).slice(0, 10))} von `
        + `${i.ack.user || 'jemandem'} bestätigt – meldet sich wieder, weil er dringender geworden ist.`)
      : null,
    i.acknowledged
      ? h('div.plausi__hint', `Bestätigt am ${fmt.date(String(i.ack?.at ?? '').slice(0, 10))}`
        + (i.ack?.user ? ` von ${i.ack.user}` : '') + '.')
      : null);
}

/** Fenster mit allen Befunden, nach Bereich gruppiert. */
function plausiDialog(a) {
  const pl = a.analysis.plausibility;
  const offen = offeneBefunde(pl);
  const erledigt = pl.items.filter((i) => i.acknowledged);
  const bereiche = [];
  for (const i of offen) {
    let b = bereiche.find((x) => x.name === i.area);
    if (!b) { b = { name: i.area, items: [] }; bereiche.push(b); }
    b.items.push(i);
  }
  modal({
    title: 'Was der Anwendung komisch vorkommt',
    wide: true,
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        pl.summary + ' · Die Prüfung vergleicht das Ergebnis mit den Messwerten und den '
        + 'Angaben der Abteilungsleitung. Sie ändert nichts – sie sagt nur, wo eine Annahme '
        + 'die Wirklichkeit überstimmt. Was abgestellt ist, kann mit "Erledigt" bestätigt '
        + 'werden; es zählt dann nicht mehr mit, bleibt aber unten nachlesbar.'),
      ...bereiche.map((b) => h('div', { style: { marginBottom: '14px' } },
        h('div.card__title', { style: { marginBottom: '6px' } }, b.name),
        h('div.plausi', ...b.items.map((i) => plausiZeile(i, a))))),
      erledigt.length > 0 && h('div', { style: { marginBottom: '14px' } },
        h('div.card__title', { style: { marginBottom: '6px' } },
          `Bestätigt (${erledigt.length})`),
        h('div.plausi', ...erledigt.map((i) => plausiZeile(i, a))))),
  });
}

/**
 * Die drei groessten Engpaesse mit Stunden.
 *
 * Ein Begriff allein ("Orbitalmaschinen") reicht nicht: Wer eine
 * Stellschraube bewegt, muss sehen, ob der Engpass dahinter sofort der
 * naechste ist - sonst wundert er sich, warum die Aenderung wenig bringt.
 */
function topEngpaesse(a) {
  const liste = (a.analysis.kpis.bottleneckRanking ?? []).filter((c) => c.manHours > 0.5).slice(0, 3);
  if (liste.length === 0) return null;
  return h('div.answer__sub',
    h('strong', 'Die drei größten Engpässe: '),
    liste.map((c, i) => h('span',
      i > 0 ? ' · ' : '',
      `${i + 1}. ${c.label}`,
      c.topOperation ? ` (${opName(a, c.topOperation)})` : '',
      ` ${fmt.num(c.manHours)} h`)),
    liste.length > 1
      ? h('div.small.faint', { style: { marginTop: '2px' } },
        `Wird ${liste[0].label} entlastet, wandert die Bremse voraussichtlich auf ${liste[1].label} `
        + `(${fmt.num(liste[1].manHours)} h). Erst wenn beide gelöst sind, wirkt eine Maßnahme voll durch.`)
      : null);
}

/**
 * Verspaetungen aus Fehlteilen.
 *
 * Wer Material nicht hat, kann nicht arbeiten - da hilft weder Personal
 * noch Schichtbetrieb. Diese Verspaetungen gehoeren deshalb getrennt
 * ausgewiesen, sonst wird Personal fuer ein Lieferproblem beantragt.
 */
function fehlteilLine(a) {
  const k = a.analysis.kpis;
  const fehlteile = k.lateByMaterial ?? 0;
  const gemeldet = k.missingPartsProjects ?? 0;
  if (fehlteile === 0 && gemeldet === 0) return null;
  return h('div.answer__sub',
    h('strong', 'Fehlteile: '),
    fehlteile > 0
      ? h('span',
        `${fehlteile} von ${k.late} Verspätungen gehen auf Material zurück `,
        `(${fmt.num(k.lateDaysByMaterial ?? 0)} von ${fmt.num(k.totalLateDays)} Tagen). `,
        h('strong', 'Dort hilft keine Kapazität. '),
        `Auf die Kapazität gehen ${k.lateByCapacity} Verspätungen zurück.`)
      : `${gemeldet} Aufträge mit gemeldeten Fehlteilen – bisher ohne Terminwirkung.`);
}

/**
 * Woher die Besetzung kommt - und wo die Anwendung ihrer eigenen Zahl
 * nicht traut.
 *
 * Die gemessene Tagesliste der Abteilungsleitung schlaegt jede Annahme.
 * Wo es keine Messwerte gibt, rechnet die Mannschaftsliste - und wenn die
 * dort hoeher liegt als die Wirklichkeit zuletzt war, sagt die Anwendung
 * das ausdruecklich.
 */
function besetzungsLine(a) {
  const st = a.analysis.staffing;
  if (!st || !st.notes?.length) return null;
  const warnung = st.notes.find((n) => n.art === 'BESETZUNG');
  return h('div.answer__sub',
    h('strong', warnung ? 'Achtung, Besetzung: ' : 'Besetzung: '),
    st.notes.map((n) => n.text).join(' '),
    warnung && h('button.btn.btn--sm', {
      style: { marginLeft: '8px' },
      onclick: () => { a.ui.teamTab = 'anwesenheit'; a.navigate('team'); },
    }, 'Anwesenheit pflegen'));
}

/** Welche Qualifikation fehlt wie oft - statt nur "5 Mitarbeiter fehlen". */
function qualifikationsLine(a) {
  const fehlt = (a.analysis.missingQualification ?? []).filter((e) => e.missingStaff > 0).slice(0, 4);
  if (fehlt.length === 0) return null;
  return h('div.answer__sub',
    h('strong', 'Es fehlen: '),
    fehlt.map((e) => `${fmt.num(e.missingStaff, 1)} × ${e.name}`).join(', '),
    h('span.faint', ' (gerechnet über die Wochen, in denen Arbeit liegenblieb)'));
}

async function loadStaff(a, target) {
  try {
    const r = await api.requiredStaff(a.scenarioId);
    if (r.needed === 0) {
      target.replaceChildren(h('span', h('strong', 'Personal: '), 'reicht aus.'));
      return;
    }
    if (!r.solved) {
      target.replaceChildren(h('span',
        h('strong', 'Achtung: '),
        `Mehr Personal allein löst es nicht – auch mit ${r.triedStaff} zusätzlichen Mitarbeitern bleiben Termine offen. `,
        `Begrenzend ist dann: ${r.bottleneck}. ${adviceFor(r.bottleneckCause)}`));
      return;
    }
    target.replaceChildren(h('span',
      h('strong', 'Für 100 % Termintreue: '),
      `+${r.needed} Mitarbeiter ab ${fmt.week(r.fromWeek)} (${fmt.date(r.fromDate)}).`));
  } catch {
    target.replaceChildren(h('span.faint', 'Personalbedarf konnte nicht berechnet werden.'));
  }
}

/**
 * Rat zur engsten Stelle – passend zum tatsächlichen Begrenzer.
 * Ohne diesen Bezug schickt der Hinweis den Anwender an die falsche Stelle.
 */
function adviceFor(cause) {
  switch (cause) {
    case 'PROJECT_LIMIT':
      return 'Hier hilft der Regler „Mitarbeiter je Auftrag" – zurzeit dürfen nicht mehr Leute an einem Auftrag arbeiten.';
    case 'PARALLEL_PROJECTS':
      return 'Hier hilft der Regler „Aufträge gleichzeitig" – zurzeit laufen bewusst nur wenige Aufträge parallel.';
    case 'ORBITAL_MACHINE':
      return 'Hier helfen längere Belegungszeiten je Tag oder zusätzliche Orbitalmaschinen.';
    case 'ORBITAL_WELDER':
      return 'Hier helfen mehr eingesetzte Orbitalschweißer (ein Schweißer bedient zwei Maschinen).';
    case 'HEFTPLATZ':
      return 'Hier helfen der dritte Heftplatz oder längere Belegungszeiten je Tag.';
    case 'HYDRO_WINDOW':
    case 'NOBO':
      return 'Hier hilft nur eine erweiterte NoBo-Anwesenheit – siehe Einstellungen → Erweitert.';
    case 'HYDRO_STATION':
    case 'BEIZ_STATION':
      return 'Hier helfen längere Belegungszeiten je Tag oder ein zweiter Platz.';
    case 'MATERIAL':
    case 'RELEASE':
      return 'Hier hilft eine frühere Material- bzw. Startfreigabe – siehe Einstellungen → Erweitert.';
    case 'TACK_LEAD':
      return 'Hier hilft ein anderer Heftvorsprung – siehe Einstellungen → Erweitert.';
    default:
      return 'Hier helfen längere Belegungszeiten, mehr Plätze/Maschinen oder verschobene Termine.';
  }
}

function opName(a, opId) {
  return a.analysis.processBalance.find((p) => p.opId === opId)?.name ?? opId;
}

/* ------------------------------------------------------------------ *
 * Kennzahlen
 * ------------------------------------------------------------------ */

function kpiRow(k, an) {
  const fehlt = Math.round(k.shortfallHours ?? 0);
  return h('div.grid.grid--kpi', { style: { marginBottom: '14px' } },
    kpi('Im Termin', k.inTime + k.critical, { tone: 'green', hint: `davon ${k.critical} knapp` }),
    kpi('Zu spät', k.late, {
      tone: k.late ? 'red' : 'green',
      hint: k.late ? `${k.totalLateDays} Tage insgesamt` : 'keine Verspätung',
    }),
    kpi('Kapazität', fmt.num(k.availableHours), {
      unit: 'h', tone: 'grey', hint: `bis ${fmt.date(k.availableHoursUntil)}`,
    }),
    kpi('Aufwand', fmt.num(k.openHours), { unit: 'h', tone: 'grey', hint: 'noch offen' }),
    // Terminbezogen: wie viele Stunden liegen über der Kapazität, die bis zu
    // den Fertigstellungsterminen zur Verfügung steht?
    kpi('Über Kapazität', fehlt > 0 ? `+${fmt.num(fehlt)}` : '0', {
      unit: 'h',
      tone: fehlt > 0 ? 'red' : 'green',
      hint: fehlt > 0
        ? `so viele Stunden fehlen bis ${fmt.week(k.shortfallWeek)} (${fmt.date(k.shortfallUntil)})`
        : 'die Kapazität reicht bis zu allen Terminen',
    }),
    kpi('Termintreue', fmt.pct(k.otd, 0), {
      tone: k.otd >= 95 ? 'green' : k.otd >= 75 ? 'amber' : 'red',
    }),
    kpi('Engste Stelle', k.bottleneck?.label ?? 'keine', { tone: 'red' }),
    kpi('Auslastung Orbital', fmt.pct(k.orbitalUtilization, 0), {
      tone: k.orbitalUtilization > 90 ? 'red' : 'green',
      hint: `${an.orbital.avgWelders} Schweißer im Schnitt`,
    }));
}

/**
 * Eine Zeile zum IST-Stand - mehr nicht.
 *
 * Im Steuerstand werden Regler im Sekundentakt bewegt; acht mitlaufende
 * Abweichungen an den Kacheln machen sie unruhig und lenken vom absoluten
 * Wert ab. Der ausfuehrliche Vergleich steht im Bereich "Vergleich".
 */
function referenceLine(a) {
  const ref = a.reference;
  if (!ref) {
    return h('div.note.note--info', { style: { marginBottom: '14px' } },
      h('strong', 'Kein IST-Stand festgelegt. '),
      'Ohne ihn lässt sich nicht messen, was eine Änderung bringt. ',
      h('button.btn.btn--sm', { style: { marginLeft: '8px' }, onclick: () => a.navigate('vergleich') },
        'IST-Stand festlegen'));
  }
  const tage = ref.delta.totalLateDays;
  const otd = ref.delta.otd;
  const unveraendert = Math.abs(tage) < 0.5 && Math.abs(otd) < 0.05;
  const gut = tage < 0 || otd > 0;
  const geaendert = (ref.changes ?? []).length;

  /*
   * Der wichtigste Fall: Es wurde etwas geaendert, und es hat nichts
   * gebracht. Ohne Begruendung sucht man den Fehler bei der Anwendung -
   * mit Begruendung sieht man, dass der Engpass woanders liegt.
   */
  if (unveraendert && geaendert > 0) {
    return h('div.note.note--warn', { style: { marginBottom: '14px' } },
      h('strong', 'Diese Änderung bringt nichts. '),
      h('div', { style: { marginTop: '4px' } }, ohneWirkungText(a, ref)),
      h('button.btn.btn--sm', { style: { marginTop: '6px' }, onclick: () => a.navigate('vergleich') },
        'Vergleich öffnen'));
  }

  return h(`div.note.note--${unveraendert ? 'info' : gut ? 'ok' : 'warn'}`, { style: { marginBottom: '14px' } },
    h('strong', 'Gegen IST-Stand: '),
    unveraendert
      ? 'unverändert – die Stellschrauben entsprechen dem IST-Stand.'
      : h('span',
        `Termintreue ${otd > 0 ? '+' : ''}${fmt.num(otd, 1)} Punkte, `,
        `${tage < 0 ? `${fmt.num(-tage)} Verspätungstage weniger` : `${fmt.num(tage)} Verspätungstage mehr`}, `,
        `${Math.abs(ref.delta.late)} ${Math.abs(ref.delta.late) === 1 ? 'Auftrag' : 'Aufträge'} `,
        `${ref.delta.late <= 0 ? 'weniger' : 'mehr'} zu spät.`),
    h('button.btn.btn--sm', { style: { marginLeft: '8px' }, onclick: () => a.navigate('vergleich') }, 'Vergleich öffnen'));
}

/**
 * Begruendung, warum eine Aenderung wirkungslos blieb.
 *
 * Aufgebaut wie eine Antwort im Gespraech: was geaendert wurde, warum es an
 * dieser Stelle nichts aendert, was stattdessen begrenzt - und was der
 * naechste sinnvolle Schritt ist.
 */
function ohneWirkungText(a, ref) {
  const k = a.analysis.kpis;
  const engpaesse = (k.bottleneckRanking ?? []).filter((c) => c.manHours > 0.5);
  const erster = engpaesse[0];
  const geaendert = (ref.changes ?? []).map((c) => `${c.label} (${c.ist} → ${c.jetzt})`);

  const teile = [
    h('div', h('strong', 'Geändert wurde: '), geaendert.join(', '), '.'),
  ];

  if (erster) {
    const opText = erster.topOperation ? ` – vor allem bei ${opName(a, erster.topOperation)}` : '';
    teile.push(h('div',
      h('strong', 'Begrenzend ist aber: '),
      `${erster.label}${opText}. Dort mussten ${fmt.num(erster.manHours)} Stunden Arbeit warten`,
      erster.days ? `, an ${erster.days} Tagen` : '',
      erster.peakHours ? ` (am stärksten ${fmt.num(erster.peakHours, 1)} h an einem Tag)` : '',
      '. Solange diese Stelle nicht entlastet ist, läuft jede zusätzliche Kapazität an anderer Stelle ins Leere.'));
    teile.push(h('div', h('strong', 'Was hier hilft: '), adviceFor(erster.cause)));
    if (engpaesse[1]) {
      teile.push(h('div.small.faint',
        `Danach kommt ${engpaesse[1].label} mit ${fmt.num(engpaesse[1].manHours)} wartenden Stunden – `
        + 'beide zusammen entscheiden über den Termin.'));
    }
  } else {
    teile.push(h('div', 'Ein Engpass ist nicht erkennbar; begrenzend sind dann Reihenfolge, '
      + 'Vorlaufzeiten oder Materialtermine.'));
  }
  teile.push(h('div.small.faint',
    'Die Karte „Was bringt wirklich etwas?" rechnet jeden Hebel einzeln durch.'));
  return h('div', teile);
}

/* ------------------------------------------------------------------ *
 * Diagramm und Wochentabelle
 * ------------------------------------------------------------------ */

/**
 * Aufwand gegen Kapazitaet - fuer die ganze Abteilung oder einen einzelnen
 * Arbeitsgang.
 *
 * Die Abteilungssicht zeigt Mannstunden. Beim einzelnen Arbeitsgang sind es
 * dessen Platz- bzw. Maschinenstunden, und der Bedarf enthaelt auch die
 * Arbeit, die nicht eingeplant werden konnte - sonst sieht ein voller
 * Arbeitsplatz harmlos aus, obwohl die Arbeit nur liegengeblieben ist.
 */
function chartCard(a, weeks) {
  const gewaehlt = a.ui.chartOp ?? 'ALLE';
  const zeilen = a.analysis.workplaceLoad ?? [];
  const auswahl = h('select', {
    onchange: (e) => { a.ui.chartOp = e.target.value; a.render(); },
  },
  h('option', { value: 'ALLE', selected: gewaehlt === 'ALLE' }, 'Alle Mitarbeiterstunden'),
  zeilen.filter((r) => !r.isPool).map((r) => h('option', { value: r.opId, selected: r.opId === gewaehlt }, r.name)));

  const kopf = h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '8px' } },
    h('label.field', { style: { minWidth: '240px', margin: 0 } }, h('span', 'Ansicht'), auswahl));

  if (gewaehlt === 'ALLE') {
    return card('Aufwand gegen Kapazität je Kalenderwoche',
      h('div',
        kopf,
        capacityChart({
          labels: weeks.map((w) => fmt.week(w.weekKey)),
          sublabels: weeks.map((w) => fmt.dateShort(w.from)),
          demand: weeks.map((w) => w.demand),
          planned: weeks.map((w) => w.planned),
          capacity: weeks.map((w) => w.capacity),
          height: 260,
        }),
        capacityLegend()),
      { flush: true, sub: 'Säulen = Arbeitsaufwand, Linie = verfügbare Kapazität. Rot = mehr Aufwand als Kapazität.' });
  }

  const zeile = zeilen.find((r) => r.opId === gewaehlt);
  if (!zeile) { a.ui.chartOp = 'ALLE'; return chartCard(a, weeks); }
  const zellen = new Map(zeile.cells.map((c) => [c.weekKey, c]));
  const holen = (w, feld) => zellen.get(w.weekKey)?.[feld] ?? 0;
  /*
   * Fuer den Bedarfsbalken zaehlt die groesste TAGES-Warteschlange der
   * Woche, nicht ihre Summe: Die Summe waere in Stunden mal Tagen und
   * wuerde den Balken um ein Vielfaches aufblasen.
   */
  const stauMax = Math.max(0, ...weeks.map((w) => holen(w, 'blockedPeak')));
  const stauTage = weeks.reduce((x, w) => x + holen(w, 'blockedDays'), 0);

  return card(`${zeile.name}: Bedarf gegen Kapazität je Kalenderwoche`,
    h('div',
      kopf,
      capacityChart({
        labels: weeks.map((w) => fmt.week(w.weekKey)),
        sublabels: weeks.map((w) => fmt.dateShort(w.from)),
        demand: weeks.map((w) => holen(w, 'hours') + holen(w, 'blockedPeak')),
        planned: weeks.map((w) => holen(w, 'hours')),
        capacity: weeks.map((w) => holen(w, 'capacityHours')),
        height: 260,
      }),
      capacityLegend(),
      h('div.small.muted', { style: { marginTop: '6px' } },
        `${zeile.places ?? '–'} ${zeile.unit === 'Maschinenstunden' ? 'Maschinen' : 'Plätze'}`,
        ` · ${fmt.num(zeile.daysPerWeek, 1)} mögliche Tage je Woche`,
        stauTage > 0
          ? h('span', ` · Stau an ${stauTage} Tagen, am stärksten ${fmt.num(stauMax, 1)} h`
            + `${zeile.blockedCause ? ` (${zeile.blockedCause})` : ''}`)
          : ' · es blieb nichts liegen',
        zeile.sharedCapacityWith
          ? h('div.small.faint', { style: { marginTop: '4px' } },
            'Teilt sich Maschinen und Schweißer mit '
            + `${zeile.sharedCapacityWith === 'ORBITAL_STUMPFNAHT' ? 'Stumpfnaht' : 'Kehlnaht'} Orbital – `
            + 'die gezeigte Kapazität gilt für beide zusammen.')
          : null)),
    {
      flush: true,
      sub: 'Säulen = Bedarf einschließlich der Arbeit, die liegenblieb. Linie = mögliche Belegungszeit '
        + '(Plätze × Belegungszeit an Tagen, an denen der Arbeitsgang möglich ist).',
    });
}

function weekTable(a, an) {
  const missing = new Map(an.missingStaff.map((m) => [m.weekKey, m]));
  return card('Wochenübersicht',
    table([
      { key: 'weekKey', label: 'KW', render: (w) => h('strong', fmt.week(w.weekKey)) },
      { key: 'from', label: 'ab', render: (w) => fmt.date(w.from) },
      {
        key: 'avgHeadcount',
        label: 'Mitarbeiter',
        num: true,
        // Steht hier eine Zahl, die groesser ist als die Mannschaft, muss
        // dabeistehen, woher der Rest kommt - sonst sucht man sie vergebens
        // in der Mannschaftsliste.
        render: (w) => h('div',
          fmt.num(w.avgHeadcount, 1),
          w.avgExtraHeadcount > 0.05
            ? h('div.small.faint', { title: 'Aus den Listen „Leiharbeiter“/„Neueinstellungen“ unter Einstellungen → Parameter → Personal' },
              `davon ${fmt.num(w.avgExtraHeadcount, 1)} zusätzlich`)
            : null),
      },
      { key: 'capacity', label: 'Kapazität h', num: true, render: (w) => fmt.num(w.capacity) },
      { key: 'demand', label: 'Aufwand h', num: true, render: (w) => fmt.num(w.demand) },
      {
        key: 'diff',
        label: 'Differenz h',
        num: true,
        render: (w) => {
          const d = Math.round(w.capacity - w.demand);
          return h('span', { style: { fontWeight: 700, color: d < 0 ? 'var(--c-red)' : 'var(--c-green)' } },
            `${d > 0 ? '+' : ''}${fmt.num(d)}`);
        },
      },
      {
        key: 'staff',
        label: 'fehlende MA',
        num: true,
        render: (w) => {
          const m = missing.get(w.weekKey);
          return m && m.missingStaff > 0
            ? h('span.pill.pill--red', `+${fmt.num(m.missingStaff, 1)}`)
            : h('span.faint', '–');
        },
      },
      { key: 'saturday', label: 'Samstag', render: (w) => (w.saturday ? h('span.pill.pill--blue', 'ja') : h('span.faint', '–')) },
    ], an.weeks, { compact: true }),
    { flush: true, sub: '„Fehlende MA" = Mitarbeiter, die in dieser Woche zusätzlich nötig wären' });
}

/* ------------------------------------------------------------------ *
 * Belegungszeit und Plaetze je Arbeitsgang (Schichtbetrieb)
 * ------------------------------------------------------------------ */

/**
 * Schichtbetrieb je Arbeitsgang.
 *
 * Gefuehrt wird in SCHICHTEN, nicht in Stunden - so denkt die Werkstatt
 * ("die Saege faehrt zweischichtig"). Die Stunden stehen daneben, weil die
 * Rechnung sie braucht.
 */
const SCHICHTEN = [
  { hours: 7.5, schichten: 1, label: '1 Schicht · 7,5 h' },
  { hours: 12, schichten: 1.6, label: 'versetzte Besetzung · 12 h' },
  { hours: 15, schichten: 2, label: '2 Schichten · 15 h' },
  { hours: 22.5, schichten: 3, label: '3 Schichten · 22,5 h' },
  { hours: 24, schichten: 3.2, label: 'durchgehend · 24 h' },
];

/** Wie viele Schichten entsprechen dieser Belegungszeit? */
function schichtFaktor(stunden) {
  return Math.max(1, (Number(stunden) || 7.5) / 7.5);
}

/** Klartext zu einer Belegungszeit - dieselben Worte wie in der Prüfung. */
function schichtText(stunden) {
  const f = schichtFaktor(stunden);
  if (f >= 2.9) return '3 Schichten';
  if (f >= 1.9) return '2 Schichten';
  if (f > 1.05) return `versetzt ${fmt.num(Number(stunden), 1)} h`;
  return '1 Schicht';
}

/**
 * Schichten automatisch planen.
 *
 * Ausdrueckliche Vorgabe der Abteilungsleitung (18.09.2026): "Kein Platz
 * frei ist keine Option, plane dann an den Arbeitsplaetzen so die
 * Schichten, dass es maximal effizient ist unter Beruecksichtigung der
 * 2-3 Schicht ... wenn dann immernoch Arbeitsplaetze fehlen, sollen diese
 * angezeigt werden."
 *
 * Die Rechnung steckt im Motor (engine/schichtplan.js). Sie terminiert
 * jeden Schritt durch und nimmt eine Schicht nur an, wenn sie TERMINE
 * rettet - deshalb wird sie auf Abruf gerechnet, nicht bei jeder Anzeige.
 *
 * Uebernommen wird immer in ein SZENARIO, nie in den laufenden Plan -
 * dieselbe Regel wie beim Mehraufwand.
 */
function autoSchichtCard(a) {
  const inhalt = h('div');
  const knopf = h('button.btn.btn--primary', 'Schichten automatisch planen');
  let laeuft = false;

  const rechnen = async () => {
    if (laeuft) return;
    laeuft = true;
    knopf.disabled = true;
    knopf.textContent = 'rechnet …';
    inhalt.replaceChildren(h('div.note.note--info',
      'Der Schichtplan wird gerechnet. Jeder Schritt wird vollständig durchterminiert – '
      + 'das dauert einige Sekunden.'));
    try {
      const v = await api.schichtvorschlag(a.scenarioId);
      inhalt.replaceChildren(vorschlagAnzeige(a, v));
    } catch (err) {
      inhalt.replaceChildren(h('div.note.note--error',
        err?.message ?? 'Der Schichtplan konnte nicht gerechnet werden.'));
    } finally {
      laeuft = false;
      knopf.disabled = false;
      knopf.textContent = 'Schichten neu rechnen';
    }
  };
  knopf.onclick = rechnen;

  return card('Schichten automatisch planen',
    h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Die Anwendung sucht die Schichteinteilung, die die meisten Verspätungstage abbaut: ',
        h('strong', 'höchstens 3 Schichten'),
        ', nur an den Arbeitsgängen, an denen es etwas bringt, und nur so weit, wie die ',
        'schichtfähigen Leute reichen. Wer Schicht fährt, wechselt ',
        h('strong', 'wochenweise'),
        ' – nicht tageweise. Was danach noch fehlt, steht darunter.'),
      h('div.btn-row', { style: { marginBottom: '10px' } }, knopf),
      inhalt),
    {
      sub: 'Wird auf Abruf gerechnet. Übernommen wird immer in ein Szenario – '
        + 'der laufende Plan bleibt unverändert.',
    });
}

/** Ergebnis des Schichtvorschlags. */
function vorschlagAnzeige(a, v) {
  const besser = Math.round((v.verspaetungVorher ?? 0) - (v.verspaetungNachher ?? 0));
  const leerVor = v.leerlaufVorher?.personentage ?? null;
  const leerNach = v.leerlaufNachher?.personentage ?? null;

  const verworfen = (v.schritte ?? []).filter((s) => !s.angewendet);

  return h('div',
    h(`div.answer${besser > 0 ? '.answer--ok' : ''}`,
      h('div.answer__head', v.aenderungen.length === 0
        ? 'Die Schichten laufen schon so – es gibt nichts zu ändern'
        : `${v.aenderungen.length} ${v.aenderungen.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge'} `
          + 'auf Mehrschichtbetrieb'),
      h('div.answer__text',
        `Verspätung ${fmt.num(v.verspaetungVorher)} → ${fmt.num(v.verspaetungNachher)} Tage`,
        besser > 0 ? h('strong', ` (${fmt.num(besser)} Tage weniger)`) : null,
        ` · wartende Arbeit ${fmt.h(v.stauVorher)} → ${fmt.h(v.stauNachher)}`),
      h('div.answer__sub',
        leerVor != null && leerNach != null
          ? `Leerlauf im Einsatzplan ${fmt.num(leerVor)} → ${fmt.num(leerNach)} Personentage · `
          : '',
        `${fmt.num(v.schichtfaehig)} von ${fmt.num(v.mannschaft)} Leuten sind schichtfähig – `
        + 'mehr Schichten als diese Leute tragen können, plant die Anwendung nicht ein.')),

    v.aenderungen.length > 0
      ? h('div', { style: { marginTop: '10px' } },
        table([
          { key: 'name', label: 'Arbeitsgang', render: (r) => h('strong', r.name) },
          { key: 'von', label: 'bisher', render: (r) => h('span.pill.pill--grey', schichtText(r.stundenVon)) },
          { key: 'nach', label: 'geplant', render: (r) => h('span.pill.pill--blue', schichtText(r.stundenNach)) },
          {
            key: 'stunden',
            label: 'Belegungszeit',
            num: true,
            /*
             * Angezeigt wird die EINGESTELLTE Zeit. Die Planung rechnet ein
             * Fenster nie kuerzer als die Arbeitszeit einer Person - steht
             * unter Parameter 7 h, rechnet sie mit 7,5 h. Stuende hier die
             * wirksame Zahl, waere das ein Widerspruch zur Parameterseite.
             */
            render: (r) => h('div',
              h('span', `${fmt.num(r.eingestelltVon ?? r.stundenVon, 1)} h → ${fmt.num(r.stundenNach, 1)} h`),
              r.eingestelltVon != null && Math.abs(r.eingestelltVon - r.stundenVon) > 0.01
                ? h('div.small.faint', `gerechnet wird mit ${fmt.num(r.stundenVon, 1)} h – `
                  + 'kürzer als eine Arbeitszeit wird ein Platz nicht belegt')
                : null),
          },
        ], v.aenderungen, { compact: true }),
        h('div.btn-row', { style: { marginTop: '10px' } },
          h('button.btn.btn--primary', { onclick: () => uebernehmeSchichten(a, v) },
            'In ein Szenario übernehmen')))
      : null,

    /*
     * "Wenn dann immernoch Arbeitsplaetze fehlen, sollen diese angezeigt
     * werden." - auch dann, wenn nicht die Plaetze begrenzen, sondern eine
     * Regel. Sonst zeigt die Liste die kleinen Baustellen und schweigt
     * ueber die groesste.
     */
    (v.fehlendePlaetze ?? []).length > 0
      ? fold(`Was danach noch fehlt (${v.fehlendePlaetze.length})`,
        h('div',
          table([
            { key: 'name', label: 'Arbeitsgang', render: (r) => h('strong', r.name) },
            { key: 'stunden', label: 'wartet', num: true, render: (r) => h('span', fmt.h(r.stunden)) },
            { key: 'tage', label: 'an Tagen', num: true, render: (r) => h('span', fmt.num(r.tage)) },
            { key: 'spitze', label: 'größter Tag', num: true, render: (r) => h('span', fmt.h(r.spitze)) },
            {
              key: 'text',
              label: 'was fehlt',
              render: (r) => h('div',
                h('div', r.text),
                r.maxSchichtErreicht
                  ? h('div.small.faint', 'Hier laufen schon 3 Schichten – mehr Schichten gibt es nicht.')
                  : null),
            },
          ], v.fehlendePlaetze, { compact: true }),
          h('div.small.muted', { style: { marginTop: '6px' } },
            'Diese Stellen bleiben auch mit dem besten Schichtplan offen. Sie brauchen eine ',
            'Entscheidung: ein Platz mehr, eine Maschine mehr, eine gelockerte Regel – '
            + 'oder einen späteren Termin.')),
        { open: true })
      : h('div.note.note--ok', { style: { marginTop: '10px' } },
        'Mit diesem Schichtplan fehlt an keinem Arbeitsgang mehr ein Platz.'),

    verworfen.length > 0
      ? fold(`Geprüft und verworfen (${verworfen.length})`,
        table([
          { key: 'name', label: 'Arbeitsgang', render: (r) => h('strong', r.name) },
          {
            key: 'schritt',
            label: 'geprüft',
            render: (r) => h('span', `${fmt.num(Math.floor(r.von))} → ${fmt.num(Math.floor(r.nach))} Schichten`),
          },
          {
            key: 'grund',
            label: 'warum nicht',
            render: (r) => (r.grund === 'ZU_WENIG_SCHICHTFAEHIG'
              ? h('span', `dafür bräuchte es ${fmt.num(r.gebraucht)} schichtfähige Leute, `
                + `es sind ${fmt.num(r.vorhanden)}`)
              : h('span', 'rettet keinen einzigen Termin – '
                + `Verspätung ${fmt.num(r.verspaetungVorher)} → ${fmt.num(r.verspaetungNachher)} Tage`)),
          },
        ], verworfen, { compact: true }),
        { open: false })
      : null);
}

/** Uebernahme in ein Szenario - nie in den laufenden Plan. */
async function uebernehmeSchichten(a, v) {
  const text = v.aenderungen.map((x) => `${x.name}: ${schichtText(x.stundenNach)}`).join('\n');
  const ok = await confirmDialog('Schichtplan in ein Szenario übernehmen?',
    `${text}\n\nDie Anwendung legt ein Szenario „Schichtplan" an und rechnet den vollen Plan neu. `
    + 'Der laufende Plan bleibt unverändert – das Szenario lässt sich jederzeit verwerfen.\n\n'
    + 'Bitte die Schichteinteilung der Mannschaft danach im Einsatzplan prüfen: '
    + 'Schichten werden wochenweise gewechselt, nicht tageweise.',
    'Übernehmen');
  if (!ok) return;
  try {
    const ziel = await api.applySchichten(a.scenarioId, {
      name: 'Schichtplan',
      note: `Schichten geplant: ${v.aenderungen.map((x) => `${x.name} ${schichtText(x.stundenNach)}`).join(', ')}`
        + ` – Verspätung ${v.verspaetungVorher} → ${v.verspaetungNachher} Tage`,
    });
    await a.reload();
    toast(`Szenario „${ziel.name}" angelegt und geöffnet – hier siehst du, was übrig bleibt.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Der Schichtplan konnte nicht übernommen werden.', 'error');
  }
}

/**
 * Je Arbeitsgang: wie viele Schichten läuft er, wie viele Plätze gibt es?
 *
 * Steht unter der Auslastungsmatrix (dort sieht man, welcher Arbeitsplatz
 * überlastet ist) und zusätzlich unter Einstellungen → Parameter, weil es
 * eine Einrichtungsentscheidung ist.
 */
export function shiftCard(a, an, cfg) {
  const byOp = cfg.resources.byOperation ?? {};
  const ops = a.state.catalog.operations;
  const peak = new Map((an.workplaceLoad ?? []).map((r) => [r.opId, r]));
  const allgemein = Number(cfg.resources.operatingHoursPerDay) || 7.5;

  const setOp = (opId, patch) => a.patchConfig({
    resources: { byOperation: { ...byOp, [opId]: { ...(byOp[opId] ?? {}), ...patch } } },
  }, null);

  // Diese Arbeitsgaenge sind auch ohne eigenen Eintrag begrenzt (eigene Parameter).
  const immerBegrenzt = {
    HEFTEN: cfg.resources.heftPlaces,
    ORBITAL_KEHLNAHT: cfg.resources.orbitalMachinesActive ?? cfg.resources.orbitalMachines,
    ORBITAL_STUMPFNAHT: cfg.resources.orbitalMachinesActive ?? cfg.resources.orbitalMachines,
    HYDRO: cfg.resources.hydroStations,
    BEIZEN: cfg.resources.beizStations,
  };

  const zeile = (op) => {
    const own = byOp[op.id] ?? {};
    const row = peak.get(op.id);
    const eigenePlaetze = own.places ?? null;
    const grundwert = immerBegrenzt[op.id];
    return {
      op,
      own,
      stunden: own.operatingHours ?? null,
      // Platzzahl, die in der Rechnung wirkt (null = keine Begrenzung)
      wirksamePlaetze: eigenePlaetze ?? (grundwert != null && grundwert !== '' ? Number(grundwert) : null),
      vorschlag: row?.places ?? 1,
      peak: row?.peak ?? null,
    };
  };

  /** Platzzahlen aus der Arbeitsplatzliste übernehmen – dann rechnet die
   *  Planung mit denselben Plätzen, die die Auslastungsmatrix zeigt. */
  const plaetzeUebernehmen = () => {
    const next = { ...byOp };
    for (const op of ops) {
      const row = peak.get(op.id);
      if (!row) continue;
      next[op.id] = { ...(next[op.id] ?? {}), places: row.places };
    }
    a.patchConfig({ resources: { byOperation: next } }, 'Plätze aus der Arbeitsplatzliste übernommen');
  };

  /** Alle Arbeitsgaenge auf dieselbe Schichtzahl stellen. */
  const alleAuf = (stunden) => {
    const next = { ...byOp };
    for (const op of ops) next[op.id] = { ...(next[op.id] ?? {}), operatingHours: stunden };
    a.patchConfig({ resources: { byOperation: next } },
      `Alle Arbeitsgänge auf ${schichtText(stunden)} gestellt`);
  };

  const allgemeinLaenger = schichtFaktor(allgemein) > 1.05;

  return card('Schichten und Plätze je Arbeitsgang',
    h('div',
      // Der haeufigste Irrtum: Ein einziger allgemeiner Wert zieht jeden
      // Arbeitsgang mit, ohne dass jemand ihn einzeln umgestellt hat.
      allgemeinLaenger && h('div.note.note--warn', { style: { marginBottom: '10px' } },
        h('strong', `Achtung: Der allgemeine Wert steht auf ${fmt.num(allgemein, 1)} h `),
        `(${schichtText(allgemein)}). Er gilt für jeden Arbeitsgang, bei dem hier „Standard" steht – `
        + 'auch wenn du keinen davon einzeln umgestellt hast. ',
        h('button.btn.btn--sm', {
          style: { marginLeft: '6px' },
          onclick: () => a.patchConfig({ resources: { operatingHoursPerDay: 7.5 } },
            'Allgemeine Belegungszeit auf eine Schicht gesetzt'),
        }, 'Allgemein auf 1 Schicht')),
      h('div.btn-row', { style: { marginBottom: '10px', alignItems: 'center' } },
        h('span.small.muted', { style: { marginRight: '4px' } }, 'Alle Arbeitsgänge:'),
        h('button.btn.btn--sm', { onclick: () => alleAuf(7.5) }, '1 Schicht'),
        h('button.btn.btn--sm', { onclick: () => alleAuf(15) }, '2 Schichten'),
        h('button.btn.btn--sm', { onclick: () => alleAuf(22.5) }, '3 Schichten'),
        h('button.btn.btn--sm', {
          title: 'Eigene Werte entfernen – danach gilt überall wieder der allgemeine Wert',
          onclick: () => a.patchConfig({}, 'Eigene Werte je Arbeitsgang entfernt', { clear: ['resources.byOperation'] }),
        }, 'zurück auf Standard')),
      h('div.note.note--info', { style: { marginBottom: '10px' } },
        h('strong', 'Schichtbetrieb: '),
        'Die Belegungszeit sagt, wie lange ein Arbeitsplatz oder eine Maschine am Tag ',
        'besetzt sein kann – bei 3 Schichten also rund 22,5 h. ',
        h('strong', 'Die Mitarbeiter müssen dafür zusätzlich da sein: '),
        'die Belegungszeit allein schafft keine Mannstunden. Reicht das Personal nicht, ',
        'wechselt die engste Stelle auf „Mitarbeiterstunden" – das steht dann oben in der Antwortzeile.'),
      table([
        { key: 'name', label: 'Arbeitsgang', render: (r) => h('strong', r.op.name) },
        {
          key: 'places',
          label: 'Plätze',
          num: true,
          render: (r) => h('input', {
            type: 'number', min: 0, step: 1, style: { width: '70px' },
            value: r.own.places ?? '',
            placeholder: String(r.wirksamePlaetze ?? r.vorschlag ?? '–'),
            title: 'Wie viele Plätze/Maschinen gleichzeitig genutzt werden können.\n'
              + 'Leer = kein eigener Wert (es gilt der Planungsparameter bzw. keine Begrenzung).',
            onchange: (e) => setOp(r.op.id, { places: e.target.value === '' ? null : Number(e.target.value) }),
          }),
        },
        {
          key: 'wirkt',
          label: 'begrenzt die Planung',
          render: (r) => (r.wirksamePlaetze != null
            ? h('span.pill.pill--blue', `ja · ${fmt.num(r.wirksamePlaetze)} Plätze`)
            : h('span.pill.pill--grey', { title: 'Für diesen Arbeitsgang begrenzt nur das Personal. Platzzahl eintragen, damit die Belegungszeit wirkt.' }, 'nein')),
        },
        {
          key: 'schicht',
          label: 'Schichten',
          render: (r) => h('select', {
            style: { width: '230px' },
            title: 'Wie viele Schichten läuft dieser Arbeitsgang?',
            onchange: (e) => setOp(r.op.id, { operatingHours: e.target.value === '' ? null : Number(e.target.value) }),
          }, [
            // "Standard" nennt den allgemeinen Wert MIT Zahl - sonst ist nicht
            // zu sehen, dass ein einziger Wert alle Arbeitsgaenge mitzieht.
            h('option', { value: '', selected: r.stunden == null },
              `Standard · ${schichtText(allgemein)} (${fmt.num(allgemein, 1)} h)`),
            ...SCHICHTEN.map((sch) => h('option', {
              value: sch.hours, selected: r.stunden === sch.hours,
            }, sch.label)),
            ...(r.stunden != null && !SCHICHTEN.some((sch) => sch.hours === r.stunden)
              ? [h('option', { value: r.stunden, selected: true }, `eigener Wert · ${fmt.num(r.stunden, 1)} h`)]
              : []),
          ]),
        },
        {
          key: 'laeuft',
          label: 'läuft',
          render: (r) => {
            const stunden = r.stunden ?? allgemein;
            const eigen = r.stunden != null;
            const f = schichtFaktor(stunden);
            return h('div',
              h(`span.pill.${f >= 1.9 ? 'pill--amber' : f > 1.05 ? 'pill--blue' : 'pill--grey'}`,
                schichtText(stunden)),
              h('div.small.faint', eigen ? 'eigener Wert' : 'aus dem Standard'));
          },
        },
        {
          key: 'stunden',
          label: 'Belegung h',
          num: true,
          render: (r) => h('input', {
            type: 'number', min: 0, max: 24, step: '0.5', style: { width: '80px' },
            value: r.stunden ?? '',
            placeholder: fmt.num(allgemein, 1),
            title: 'Eigener Wert für diesen Arbeitsgang. Leer = allgemeine Belegungszeit.',
            onchange: (e) => setOp(r.op.id, { operatingHours: e.target.value === '' ? null : Number(e.target.value) }),
          }),
        },
        {
          key: 'peak',
          label: 'Spitzenauslastung',
          num: true,
          render: (r) => (r.peak == null
            ? h('span.faint', 'keine Begrenzung')
            : h('span', { style: { fontWeight: 700, color: r.peak > 100.5 ? 'var(--c-red)' : 'var(--c-text-muted)' } },
              fmt.pct(r.peak, 0))),
        },
      ], ops.map(zeile), { compact: true }),
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn.btn--sm', { onclick: plaetzeUebernehmen },
          'Plätze aus der Arbeitsplatzliste übernehmen')),
      h('div.small.muted', { style: { marginTop: '6px' } },
        'Steht in „begrenzt die Planung" ein ',
        h('strong', 'nein'),
        ', dann begrenzt bei diesem Arbeitsgang nur das Personal – die Belegungszeit bleibt dort ohne Wirkung. ',
        'Die Auslastung oben zeigt trotzdem, wie stark der Platz gefordert wäre. ',
        'Mit „Plätze aus der Arbeitsplatzliste übernehmen" rechnet die Planung mit genau diesen Plätzen.')),
    {
      flush: true,
      sub: 'Hier wird der Schichtbetrieb eingestellt – je Arbeitsgang einzeln oder für alle auf einmal. '
        + '„Standard" heißt: es gilt der allgemeine Wert (Einstellungen → Parameter).',
    });
}

function workplaceCard(a, an) {
  const st = (a.ui.matrix ??= { mode: 'woche', from: null, to: null, sort: 'FOLGE' });
  const alle = an.weeks;
  if (!alle.some((w) => w.weekKey === st.from)) st.from = alle[0]?.weekKey ?? null;
  if (!alle.some((w) => w.weekKey === st.to)) st.to = alle[alle.length - 1]?.weekKey ?? null;
  const von = alle.findIndex((w) => w.weekKey === st.from);
  const bis = alle.findIndex((w) => w.weekKey === st.to);
  const weeks = alle.slice(Math.max(0, Math.min(von, bis)), Math.max(von, bis) + 1);

  const setzen = (patch) => { Object.assign(st, patch); a.render(); };
  const keys = new Set(weeks.map((w) => w.weekKey));
  const summe = (row, feld) => {
    let x = 0;
    for (const c of row.cells) if (keys.has(c.weekKey)) x += c[feld] ?? 0;
    return x;
  };

  const rows = [...an.workplaceLoad];
  const pool = rows.filter((r) => r.isPool);
  const rest = rows.filter((r) => !r.isPool);
  // Sortiert wird weiter nach der Summe: Sie taugt als Rangfolge (haeufig
  // UND stark), nur nicht als Anzeige in Stunden.
  if (st.sort === 'BLOCKIERT') rest.sort((x, y) => summe(y, 'blockedHours') - summe(x, 'blockedHours'));
  else if (st.sort === 'AUSLASTUNG') {
    const q = (r) => {
      const k = summe(r, 'capacityHours');
      return k > 0 ? summe(r, 'hours') / k : 0;
    };
    rest.sort((x, y) => q(y) - q(x));
  }

  const wochenWahl = (label, wert, onChange) => h('label.field', { style: { minWidth: '120px' } },
    h('span', label),
    h('select', { onchange: (e) => onChange(e.target.value) },
      alle.map((w) => h('option', { value: w.weekKey, selected: w.weekKey === wert }, fmt.weekLong(w.weekKey)))));

  const kopf = h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '10px' } },
    h('div.seg',
      h('button', { class: st.mode === 'woche' ? 'is-active' : '', onclick: () => setzen({ mode: 'woche' }) }, 'Je Woche'),
      h('button', { class: st.mode === 'gesamt' ? 'is-active' : '', onclick: () => setzen({ mode: 'gesamt' }) }, 'Gesamtzeitraum')),
    wochenWahl('von', st.from, (v) => setzen({ from: v })),
    wochenWahl('bis', st.to, (v) => setzen({ to: v })),
    h('label.field', { style: { minWidth: '190px' } },
      h('span', 'Sortierung'),
      h('select', { onchange: (e) => setzen({ sort: e.target.value }) },
        [['FOLGE', 'Reihenfolge der Fertigung'], ['BLOCKIERT', 'Stau'], ['AUSLASTUNG', 'Auslastung']]
          .map(([v, l]) => h('option', { value: v, selected: v === st.sort }, l)))),
    h('button.btn.btn--sm', {
      onclick: () => setzen({ from: alle[0]?.weekKey, to: alle[alle.length - 1]?.weekKey, sort: 'FOLGE' }),
    }, 'Ganzer Zeitraum'));

  const eng = [...rest].sort((x, y) => summe(y, 'blockedHours') - summe(x, 'blockedHours'))[0];
  const engStunden = eng ? summe(eng, 'blockedHours') : 0;
  const engTage = eng ? summe(eng, 'blockedDays') : 0;
  const engMax = eng ? Math.max(0, ...eng.cells.filter((c) => keys.has(c.weekKey))
    .map((c) => Number(c.blockedPeak ?? 0))) : 0;

  return card('Auslastung je Arbeitsplatz',
    h('div',
      kopf,
      engStunden > 0 && h('div.note.note--warn', { style: { marginBottom: '10px' } },
        h('strong', `Größter Stau: ${eng.name}. `),
        `An ${engTage} Tagen wartete hier Arbeit, am stärksten ${fmt.num(engMax, 1)} h an einem Tag. `,
        `Hauptursache ${eng.blockedCause ?? 'unbekannt'}. `,
        'Genau hier klemmt es – die Auslastung allein zeigt das nicht, weil die Arbeit gar nicht erst '
        + 'gebucht werden konnte. ',
        h('span.faint', 'Der Stau ist eine Warteschlange, keine Arbeitsmenge: Wie viele Stunden '
          + 'wirklich fehlen, steht unter '),
        h('button.btn.btn--sm', { onclick: () => a.navigate('uebersicht/mehraufwand') }, 'Mehraufwand')),
      utilizationMatrix({ rows: [...pool, ...rest], weeks, mode: st.mode })),
    {
      sub: `${fmt.weekLong(weeks[0]?.weekKey)} bis ${fmt.weekLong(weeks[weeks.length - 1]?.weekKey)} · `
        + 'Anteil der möglichen Belegungszeit (Plätze × Belegungszeit an Tagen, an denen der Arbeitsgang möglich ist). '
        + 'Die Zeile „Mitarbeiterstunden gesamt" passt zum Diagramm oben.',
    });
}

/* ------------------------------------------------------------------ *
 * Was bringt wirklich etwas?
 * ------------------------------------------------------------------ */

/**
 * Jeder Hebel einzeln durchgerechnet.
 *
 * Beantwortet die Frage, mit der jede Diskussion anfaengt: "Was bringt
 * denn nun am meisten?" - und ebenso wichtig: was bringt gar nichts, weil
 * der Engpass woanders liegt.
 */
function helpCard(a) {
  const inhalt = h('div', h('div.small.faint',
    'Jede Maßnahme wird einzeln durchgerechnet – das dauert ein paar Sekunden.'));
  const karte = card('Was bringt wirklich etwas?', inhalt, {
    sub: 'Wirkung jedes Hebels für sich, sortiert nach gesparten Verspätungstagen.',
    actions: [h('button.btn.btn--sm.btn--primary', { onclick: () => rechne() }, 'Durchrechnen')],
  });

  const rechne = async () => {
    inhalt.replaceChildren(h('div.empty', 'Wird gerechnet …'));
    try {
      const r = await api.whatHelps(a.scenarioId);
      if (!r.measures || r.measures.length === 0) {
        inhalt.replaceChildren(h('div.empty', 'Keine Maßnahme nötig – alle Termine werden gehalten.'));
        return;
      }
      inhalt.replaceChildren(
        table([
          { key: 'label', label: 'Maßnahme', render: (m) => h('div', h('strong', m.label), h('div.small.muted', m.description)) },
          {
            key: 'savedLateDays',
            label: 'Tage gespart',
            num: true,
            render: (m) => h('span', { style: { fontWeight: 700, color: m.savedLateDays > 0 ? 'var(--c-green)' : 'var(--c-text-muted)' } },
              m.savedLateDays > 0 ? `−${fmt.num(m.savedLateDays, 1)}` : '–'),
          },
          {
            key: 'savedLate',
            label: 'Aufträge gerettet',
            num: true,
            render: (m) => (m.savedLate > 0 ? h('strong', fmt.num(m.savedLate)) : h('span.faint', '–')),
          },
          {
            key: 'otdGain',
            label: 'Termintreue',
            num: true,
            render: (m) => h('span', { style: { color: m.otdGain > 0 ? 'var(--c-green)' : 'var(--c-text-muted)' } },
              `${m.otdGain > 0 ? '+' : ''}${fmt.num(m.otdGain, 1)}`),
          },
          {
            key: 'bottleneckAfter',
            label: 'Engpass danach',
            render: (m) => h('span.small', m.movesBottleneck
              ? h('span', h('span.faint', `${m.bottleneckBefore ?? '–'} → `), m.bottleneckAfter ?? 'keiner')
              : (m.bottleneckAfter ?? 'keiner')),
          },
          {
            key: 'aktion',
            label: '',
            render: (m) => h('button.btn.btn--sm', {
              onclick: async () => {
                const ok = await confirmDialog('Maßnahme übernehmen?',
                  `„${m.label}" wird in den aktuellen Stand übernommen. Rückgängig geht es über „Zurücksetzen".`,
                  'Übernehmen');
                if (!ok) return;
                await api.applyProposal(a.scenarioId, { config: m.config, measures: [{ id: m.id, label: m.label }] });
                await a.recalc(`Übernommen: ${m.label}`);
              },
            }, 'Übernehmen'),
          },
        ], r.measures, { compact: true }),
        r.withoutEffect?.length > 0 && h('div.note.note--info', { style: { marginTop: '10px' } },
          h('strong', 'Ohne Wirkung: '),
          `${r.withoutEffect.slice(0, 6).join(', ')} – hier liegt der Engpass nicht.`),
        r.harmful?.length > 0 && h('div.note.note--warn', { style: { marginTop: '10px' } },
          h('strong', 'Verschlechtert den Plan: '),
          r.harmful.slice(0, 4).map((x) => `${x.label} (+${fmt.num(x.lostLateDays, 0)} Verspätungstage)`).join(', '),
          h('div.small', { style: { marginTop: '4px' } },
            'Neue Kräfte leisten in den ersten Wochen 40/60/80 % und binden 5/3/1 Stunden '
            + 'Betreuung der Stammmannschaft. Solange der Engpass nicht die Mannschaft ist '
            + `(hier: ${r.harmful[0].bottleneck ?? 'unbekannt'}), kostet das mehr, als es bringt.`)));
    } catch {
      inhalt.replaceChildren(h('div.note.note--error', 'Die Berechnung ist fehlgeschlagen.'));
    }
  };

  return karte;
}

/* ------------------------------------------------------------------ *
 * Gefährdete Aufträge
 * ------------------------------------------------------------------ */

function riskCard(a, an) {
  const risk = an.projects
    .filter((p) => p.status === 'VERSPAETET' || p.status === 'KRITISCH')
    .sort((x, y) => y.lateDays - x.lateDays);

  return card(`Gefährdete Aufträge (${risk.length})`,
    table([
      { key: 'orderNo', label: 'Auftrag', render: (p) => h('strong', p.orderNo || p.name) },
      { key: 'customer', label: 'Kunde' },
      { key: 'dueDate', label: 'Termin', render: (p) => fmt.date(p.dueDate) },
      { key: 'forecastFinish', label: 'wird fertig', render: (p) => (p.forecastFinish ? fmt.date(p.forecastFinish) : h('span.pill.pill--red', 'nicht planbar')) },
      { key: 'lateDays', label: 'zu spät', num: true, render: (p) => (p.lateDays ? h('span', { style: { color: 'var(--c-red)', fontWeight: 700 } }, `${p.lateDays} Tage`) : '–') },
      { key: 'status', label: 'Status', render: (p) => statusPill(p.status) },
      {
        key: 'material',
        label: 'Material',
        render: (p) => (p.missingParts
          ? h('span.pill.pill--red', { title: p.missingPartsNote || 'Fehlteile gemeldet' }, 'Fehlteil')
          : p.lateByMaterial
            ? h('span.pill.pill--amber', { title: `Material erst ab ${fmt.date(p.materialDate)}` }, 'Material')
            : h('span.faint', '–')),
      },
      {
        key: 'cause',
        label: 'Warum',
        render: (p) => {
          const c = an.rootCauses[p.id]?.causes?.[0];
          return c ? h('span.small', `${c.label}${c.opName ? ` bei ${c.opName}` : ''}`) : h('span.faint', '–');
        },
      },
    ], risk, { onRow: (p) => openProject(a, p.id), empty: 'Alle Aufträge liegen im Termin.' }),
    { flush: true, sub: 'Zeile anklicken für Einzelheiten und Ursachen' });
}
