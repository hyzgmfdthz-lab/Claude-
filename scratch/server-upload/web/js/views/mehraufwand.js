/**
 * Ansicht "Mehraufwand" - was muss passieren, damit kein Termin faellt?
 *
 * Aufbau nach ausdruecklicher Entscheidung der Abteilungsleitung:
 *   1. Kopfzeile: fehlende Stunden gross, Euro klein darunter
 *   2. Woche fuer Woche (Hauptteil, Arbeitsliste zum Abarbeiten)
 *   3. Die vier Wege nebeneinander - immer alle vier, auch der, der nichts
 *      bringt - und darunter das Paket fuer den ganzen Zeitraum
 *   4. Heatmap Arbeitsgang x Kalenderwoche (zugeklappt)
 *
 * Zeitraum: rollierend 13 Wochen ab dem Planungsstichtag.
 */

import { h, card, fold, fmt, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { openProject } from './projects.js';

/** @param {any} a */
export function render(a) {
  const wrap = h('div.view');
  wrap.append(h('div.empty', 'Mehraufwand wird gerechnet …'));
  lade(a, wrap);
  return wrap;
}

async function lade(a, wrap) {
  let m;
  try {
    m = await api.mehraufwand(a.scenarioId);
  } catch (err) {
    wrap.replaceChildren(h('div.note.note--error', err?.message ?? 'Der Mehraufwand konnte nicht gerechnet werden.'));
    return;
  }
  if (!m || m.wochen.length === 0) {
    wrap.replaceChildren(h('div.empty', 'Für diesen Stand gibt es keinen Zeitraum zum Rechnen.'));
    return;
  }
  wrap.replaceChildren(
    kopf(m),
    wochenKarte(a, m),
    massnahmenKarte(a, m),
    heatmapKarte(m),
  );
}

/* ------------------------------------------------------------------ *
 * 1. Kopfzeile
 * ------------------------------------------------------------------ */

function kopf(m) {
  const gedeckt = m.gedeckt;
  const euro = m.paket ? m.paket.kosten : 0;
  return h(`div.answer${gedeckt ? '.answer--ok' : '.answer--bad'}`,
    // Angezeigt wird ab dem Stichtag, nicht ab dem Wochenanfang davor -
    // sonst stuende dort ein Datum, an dem noch gar nicht gerechnet wird.
    h('div.answer__head', `Mehraufwand · ${fmt.date(m.stichtag > m.von ? m.stichtag : m.von)} `
      + `bis ${fmt.date(m.bis)} · ${m.wochen.length} Wochen`),
    h('div.mehr__zahl',
      gedeckt ? 'gedeckt' : fmt.h(m.stunden),
      !gedeckt && euro > 0
        ? h('span.mehr__euro', `≈ ${fmt.num(Math.round(euro))} € über das günstigste Paket`)
        : null),
    h('div.answer__text', m.summe),
    h('div.answer__sub', m.hinweis));
}

/* ------------------------------------------------------------------ *
 * 2. Woche fuer Woche
 * ------------------------------------------------------------------ */

function wochenKarte(a, m) {
  const max = Math.max(...m.wochen.map((w) => Math.max(w.faellig, w.kapazitaet)), 1);
  const zeilen = [];
  for (const w of m.wochen) {
    const detail = h('tr.mehr__detail', { style: { display: 'none' } },
      h('td', { colspan: 8 }, wochenDetail(a, m, w)));
    const zeile = h('tr.is-clickable', {
      onclick: () => { detail.style.display = detail.style.display === 'none' ? '' : 'none'; },
    },
    h('td', h('strong', `KW ${w.kw}`)),
    h('td.small.muted', `${fmt.dateShort(w.von)} – ${fmt.dateShort(w.bis)}`),
    h('td.num', fmt.h(w.faellig)),
    h('td.num', fmt.h(w.kapazitaet)),
    h('td', balken(w, max)),
    h('td.num', w.luecke > 0
      ? h(`span.pill.${w.luecke > m.stunden / 2 ? 'pill--red' : 'pill--amber'}`, fmt.h(w.luecke))
      : h('span.pill.pill--green', 'gedeckt')),
    h('td.small', w.stau.length
      ? h('span', w.stau[0].name, h('span.faint', ` ${fmt.h(w.stau[0].stunden)}`))
      : h('span.faint', 'kein Stau')),
    h('td.faint.small', w.auftraege.length ? '▸' : ''));
    zeilen.push(zeile, detail);
  }

  const tabelle = h('div.table-wrap', h('table.tbl.tbl--compact',
    h('thead', h('tr',
      h('th', 'KW'), h('th', 'Zeitraum'),
      h('th.num', 'fällig'), h('th.num', 'Kapazität'),
      h('th', { style: { width: '190px' } }, 'Verhältnis'),
      h('th.num', 'Lücke bis hier'), h('th', 'Engpass'), h('th', ''))),
    h('tbody', zeilen)));

  return card('Woche für Woche', tabelle, {
    flush: true,
    sub: 'Zeile anklicken: welche Aufträge fällig werden, was steht und was in dieser Woche helfen würde. '
      + '„Lücke bis hier" ist aufsummiert – sie sagt, wie viel bis zu dieser Woche fehlt, nicht nur in ihr.',
  });
}

/** Zwei dünne Balken übereinander - fällig oben, Kapazität darunter. */
function balken(w, max) {
  const b = (wert, klasse) => h('div.mehr__row',
    h('span.mehr__tag', klasse === 'kap' ? 'Kap.' : 'fällig'),
    h('div.mehr__track', h(`span.mehr__fill.mehr__fill--${klasse}`, {
      style: { width: `${Math.round((wert / max) * 100)}%` },
    })));
  return h('div.mehr__bars',
    b(w.faellig, w.faellig > w.kapazitaet ? 'over' : 'soll'),
    b(w.kapazitaet, 'kap'));
}

/** Aufgeklappte Woche: Aufträge, Stau, Maßnahmen für genau diese Woche. */
function wochenDetail(a, m, w) {
  const auftraege = w.auftraege.length === 0
    ? h('div.small.faint', 'In dieser Woche wird kein Auftrag fällig.')
    : h('div.table-wrap', h('table.tbl.tbl--compact',
      h('thead', h('tr',
        h('th', 'Auftrag'), h('th', 'Kunde'), h('th', 'Termin'),
        h('th.num', 'offen'), h('th.num', 'zu spät'), h('th', ''))),
      h('tbody', w.auftraege.map((p) => h('tr',
        h('td.mono', p.orderNo),
        h('td', p.customer || '–'),
        h('td.small', fmt.dateShort(p.dueDate)),
        h('td.num', fmt.h(p.stunden)),
        h('td.num', p.lateDays > 0
          ? h(`span.pill.${p.lateDays > 20 ? 'pill--red' : 'pill--amber'}`, `${p.lateDays} T`)
          : h('span.pill.pill--green', 'im Termin')),
        h('td', h('button.btn.btn--sm', {
          title: 'Auftrag öffnen – dort lässt sich der früheste Arbeitsbeginn von Hand setzen',
          onclick: (e) => { e.stopPropagation(); openProject(a, p.id); },
        }, 'Öffnen')))))));

  const stau = w.stau.length === 0
    ? h('div.small.faint', 'Am letzten Arbeitstag der Woche wartet nichts.')
    : h('div', w.stau.map((s) => h('div.small',
      s.name, ' ', h('strong', fmt.h(s.stunden)), ' warten')));

  return h('div.mehr__detailinner',
    h('div',
      h('div.card__title', { style: { marginBottom: '6px' } }, `Fällig in KW ${w.kw}`),
      auftraege),
    h('div',
      h('div.card__title', { style: { marginBottom: '6px' } }, 'Was steht'),
      stau,
      h('div.card__title', { style: { margin: '12px 0 6px' } }, 'Was in dieser Woche hilft'),
      wochenMassnahmen(m, w)));
}

/**
 * Was bis zu dieser Woche helfen würde.
 *
 * Gerechnet mit den Sätzen aus der Kapazitätsrechnung des Zeitraums, nicht
 * über den Daumen: Was eine Überstunde, ein Leiharbeiter und ein Samstag
 * im Zeitraum bringen, steht in den Maßnahmen darunter.
 */
function wochenMassnahmen(m, w) {
  if (w.luecke <= 0) return h('div.small.faint', 'Bis hierher ist alles gedeckt.');
  const wochen = m.wochen.filter((x) => x.weekKey <= w.weekKey).length;
  const proWoche = (schluessel) => {
    const ma = m.massnahmen.find((x) => x.key === schluessel);
    if (!ma || !ma.wert || ma.stunden <= 0) return null;
    return ma.stunden / m.wochen.length / ma.wert;
  };
  const ueberRate = proWoche('UEBERSTUNDEN');
  const leiheRate = proWoche('LEIHE');
  const samstagRate = (() => {
    const ma = m.massnahmen.find((x) => x.key === 'SAMSTAG');
    return ma && ma.wert > 0 ? ma.stunden / ma.wert : null;
  })();

  const zeile = (text, moeglich, warnung) => h('div.small',
    '· ', text,
    !moeglich && warnung ? h('span.pill.pill--red', { style: { marginLeft: '6px' } }, warnung) : null);

  const ueber = ueberRate ? Math.ceil((w.luecke / (ueberRate * wochen)) * 10) / 10 : null;
  const leihe = leiheRate ? Math.ceil(w.luecke / (leiheRate * wochen)) : null;
  const samstage = samstagRate ? Math.ceil(w.luecke / samstagRate) : null;

  return h('div',
    h('div.small', { style: { marginBottom: '5px' } },
      `Um die ${fmt.h(w.luecke)} bis KW ${w.kw} zu schließen – ${wochen} `
      + `${wochen === 1 ? 'Woche' : 'Wochen'} Zeit:`),
    ueber !== null && zeile(h('span', 'Überstunden ', h('strong', `${fmt.num(ueber, 1)} h`), ' je MA und Woche'),
      ueber <= 5, 'über der Grenze von 5 h'),
    leihe !== null && zeile(h('span', h('strong', String(leihe)), ' Leiharbeiter mehr ab sofort'), true, null),
    samstage !== null && zeile(h('span', h('strong', String(samstage)), ' Samstage mit 20 % der Mannschaft'),
      samstage <= wochen, `nur ${wochen} möglich`),
    h('div.small.faint', { style: { marginTop: '5px' } },
      'Aus der Kapazitätsrechnung, nicht geschätzt.'));
}

/* ------------------------------------------------------------------ *
 * 3. Die vier Wege und das Paket
 * ------------------------------------------------------------------ */

function massnahmenKarte(a, m) {
  if (m.gedeckt) {
    return card('Was muss passieren, damit es geht?',
      h('div.note', 'Nichts – die Kapazität reicht in diesem Zeitraum rechtzeitig aus.'),
      { sub: 'Vier Wege, in der Reihenfolge der Abteilungsleitung' });
  }
  const karten = h('div.mehr__massnahmen', m.massnahmen.map((ma) => massnahmeKarte(a, m, ma)));
  return card('Was muss passieren, damit es geht?',
    h('div', karten, paketBlock(a, m)), {
      sub: `Vier Wege, die ${fmt.h(m.stunden)} zu schließen – in der Reihenfolge der Abteilungsleitung, `
        + 'nebeneinander. Auch der Weg, der keine Stunden bringt, bleibt stehen: das ist selbst eine Aussage.',
    });
}

function massnahmeKarte(a, m, ma) {
  const ton = ma.stunden <= 0 ? 'null' : ma.reicht ? 'ok' : 'teil';
  return h(`div.mehr__m.mehr__m--${ton}`,
    h('div.mehr__rang', `${ma.rang}. Wahl`),
    h('div.mehr__name', ma.name),
    h('div.mehr__wert', ma.beschreibung),
    h('div.mehr__zeile', 'bringt ', h('strong', ma.stunden > 0 ? `+${fmt.h(ma.stunden)}` : 'keine Stunden')),
    h('div.mehr__cover', h('span', { style: { width: `${Math.min(100, ma.deckung)}%` } })),
    h('div.mehr__zeile', 'deckt die Lücke zu ', h('strong', `${ma.deckung} %`)),
    ma.kosten > 0 ? h('div.mehr__zeile', `≈ ${fmt.num(Math.round(ma.kosten))} €`) : null,
    ma.grenze ? h('div.mehr__zeile.mehr__warn', ma.grenze) : null,
    h('div.mehr__zeile.faint', ma.hinweis),
    ma.patch
      ? h('button.btn.btn--sm', {
        style: { marginTop: '8px' },
        onclick: () => uebernehmen(a, m, [ma.patch], ma.name, ma.beschreibung),
      }, 'In Szenario übernehmen')
      : null);
}

function paketBlock(a, m) {
  const p = m.paket;
  if (!p) return null;
  return h('div.note', { style: { marginTop: '12px' } },
    h('div', h('strong', 'Vorschlag der Anwendung für den ganzen Zeitraum: '), p.text),
    h('div.small', { style: { marginTop: '4px' } },
      `zusammen +${fmt.h(p.stunden)} · ≈ ${fmt.num(Math.round(p.kosten))} € · `
      + (p.reicht ? 'damit ist die Lücke gedeckt' : `es bleiben ${fmt.h(p.offen)} offen`)),
    h('div.small.faint', { style: { marginTop: '4px' } },
      'Gebaut in deiner Reihenfolge: erst Überstunden bis 5 h je Mitarbeiter und Woche, '
      + 'dann zweiter Platz, dann Leiharbeiter, dann Samstag – von jedem nur so viel wie nötig.'),
    h('div.btn-row', { style: { marginTop: '8px' } },
      h('button.btn.btn--primary.btn--sm', {
        onclick: () => uebernehmen(a, m, p.teile.map((t) => t.patch), 'Mehraufwand-Paket', p.text),
      }, 'Paket in Szenario übernehmen')));
}

/**
 * Uebernimmt eine Massnahme - immer in ein SZENARIO, nie in den laufenden
 * Plan. Ausdrueckliche Vorgabe: erst sehen, was uebrig bleibt, dann
 * entscheiden.
 */
async function uebernehmen(a, m, patches, name, text) {
  const ok = await confirmDialog('In ein Szenario übernehmen?',
    `${text}\n\nDie Anwendung legt dafür ein Szenario „Mehraufwand: ${name}" an und rechnet `
    + 'den vollen Plan neu. Der laufende Plan bleibt unverändert – das Szenario lässt sich '
    + 'jederzeit verwerfen.',
    'Übernehmen');
  if (!ok) return;
  try {
    const ziel = await api.applyMehraufwand(a.scenarioId, {
      patches: patches.filter(Boolean),
      name: `Mehraufwand: ${name}`.slice(0, 80),
      note: `${text} · ${m.summe}`,
    });
    await a.reload();
    toast(`Szenario „${ziel.name}" angelegt und geöffnet – hier siehst du, was übrig bleibt.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Die Maßnahme konnte nicht übernommen werden.', 'error');
  }
}

/* ------------------------------------------------------------------ *
 * 4. Heatmap
 * ------------------------------------------------------------------ */

function heatmapKarte(m) {
  const ops = [];
  for (const w of m.wochen) {
    for (const s of w.stau) if (!ops.some((o) => o.opId === s.opId)) ops.push({ opId: s.opId, name: s.name });
  }
  if (ops.length === 0) {
    return card('Wo es steht', h('div.small.faint', 'In diesem Zeitraum wartet an keinem Arbeitsgang Arbeit.'));
  }
  const tabelle = h('table.heat',
    h('thead', h('tr', h('th', ''), m.wochen.map((w) => h('th.heat__kw', String(w.kw))))),
    h('tbody', ops.map((o) => h('tr',
      h('th.heat__name', o.name),
      m.wochen.map((w) => {
        const s = w.stau.find((x) => x.opId === o.opId);
        const wert = s ? s.stunden : 0;
        return h('td', h(`div.heat__cell.heat__cell--${stufe(wert)}`, {
          title: `KW ${w.kw} · ${o.name} · ${fmt.h(wert)} warten`,
        }, wert > 0 ? fmt.num(wert) : ''));
      })))));

  return card('Wo es steht',
    fold('Heatmap: Arbeitsgang × Kalenderwoche',
      h('div',
        h('div.table-wrap', tabelle),
        h('div.heat__legend',
          h('span', h('span.key.heat__cell--0'), '0 h'),
          h('span', h('span.key.heat__cell--1'), 'bis 25 h'),
          h('span', h('span.key.heat__cell--2'), 'bis 75 h'),
          h('span', h('span.key.heat__cell--3'), 'bis 150 h'),
          h('span', h('span.key.heat__cell--4'), 'über 150 h')),
        h('div.small.faint', { style: { marginTop: '8px' } },
          'Stunden, die am letzten Arbeitstag der Woche an diesem Arbeitsgang warten – '
          + 'eine Momentaufnahme, keine Summe über die Tage. Genau diese Summe war der Fehler '
          + 'der alten Kennzahl „x Stunden nicht einplanbar".')),
      { open: false }),
    { flush: true });
}

function stufe(h1) {
  if (h1 <= 0) return '0';
  if (h1 <= 25) return '1';
  if (h1 <= 75) return '2';
  if (h1 <= 150) return '3';
  return '4';
}
