/**
 * Schnellsuche (Strg+K).
 *
 * Bei 37 laufenden Auftraegen, 24 Kuerzeln und fuenf Bereichen ist Tippen
 * schneller als Klicken: Auftragsnummer eingeben, Enter, man ist im
 * Auftrag. Gesucht wird ueber Auftraege, Kunden, Mitarbeiter, Bereiche
 * und Arbeitsplaetze - alles aus dem bereits geladenen Zustand, also
 * ohne weitere Abfrage.
 */

import { h } from '../ui.js';
import { openProject } from './projects.js';

/** @param {any} a */
export function openPalette(a) {
  document.querySelectorAll('.palette, .palette-overlay').forEach((el) => el.remove());

  const treffer = h('div.palette__list');
  const feld = h('input', {
    type: 'text', placeholder: 'Auftrag, Kunde, Kürzel oder Bereich …', autocomplete: 'off',
  });
  const box = h('div.palette', feld, treffer);
  const overlay = h('div.overlay.palette-overlay', { style: { background: 'rgba(12,18,24,.35)' } });

  let liste = [];
  let aktiv = 0;

  const schliessen = () => {
    box.remove();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  const ausfuehren = (eintrag) => {
    if (!eintrag) return;
    schliessen();
    eintrag.run();
  };

  const zeichne = () => {
    treffer.replaceChildren(...(liste.length === 0
      ? [h('div.palette__item', h('span.faint', 'Nichts gefunden.'))]
      : liste.map((e, i) => h(`div.palette__item${i === aktiv ? '.is-active' : ''}`, {
        onclick: () => ausfuehren(e),
        onmouseenter: () => { aktiv = i; zeichne(); },
      },
      h('span.palette__kind', e.kind),
      h('span.palette__label', e.label),
      e.meta ? h('span.palette__meta', e.meta) : null))));
  };

  const suchen = () => {
    liste = finde(a, feld.value).slice(0, 30);
    aktiv = 0;
    zeichne();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); schliessen(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); aktiv = Math.min(aktiv + 1, liste.length - 1); zeichne(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); aktiv = Math.max(aktiv - 1, 0); zeichne(); return; }
    if (e.key === 'Enter') { e.preventDefault(); ausfuehren(liste[aktiv]); }
  };

  feld.addEventListener('input', suchen);
  overlay.addEventListener('mousedown', schliessen);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  document.body.appendChild(box);
  feld.focus();
  suchen();
}

/**
 * Sucht in Auftraegen, Mitarbeitern, Bereichen und Arbeitsgaengen.
 * @param {any} a @param {string} text
 */
function finde(a, text) {
  const q = String(text ?? '').trim().toLowerCase();
  const out = [];
  const passt = (...felder) => !q || felder.some((f) => String(f ?? '').toLowerCase().includes(q));

  for (const p of a.analysis?.projects ?? []) {
    if (!passt(p.orderNo, p.customer, p.name, p.id)) continue;
    out.push({
      kind: 'Auftrag',
      label: p.orderNo || p.name || p.id,
      meta: [p.customer, p.dueDate ? `Termin ${p.dueDate.split('-').reverse().join('.')}` : null,
        p.status === 'VERSPAETET' ? `${p.lateDays} Tage zu spät` : null].filter(Boolean).join(' · '),
      score: p.status === 'VERSPAETET' ? 0 : 1,
      run: () => { a.navigate('auftraege/liste'); openProject(a, p.id); },
    });
  }

  for (const t of a.analysis?.team?.byOperation ?? []) {
    if (!passt(t.name, t.opId)) continue;
    out.push({
      kind: 'Arbeitsgang',
      label: t.name,
      meta: `${t.qualified} Qualifizierte`,
      score: 2,
      run: () => { a.ui.board = { ...(a.ui.board ?? {}), mode: 'WORKPLACE' }; a.navigate('planung/belegung'); },
    });
  }

  for (const id of a.analysis?.team?.shiftBlocked ?? []) {
    if (!passt(id)) continue;
    out.push({
      kind: 'Mitarbeiter', label: id, meta: 'keine Schicht', score: 3,
      run: () => a.navigate('mannschaft/liste'),
    });
  }

  const bereiche = [
    ['Übersicht · Kennzahlen', 'uebersicht/kennzahlen'],
    ['Übersicht · Engpässe & Wirkung', 'uebersicht/engpass'],
    ['Planung · Belegung', 'planung/belegung'],
    ['Planung · Terminplan', 'planung/termine'],
    ['Planung · Vergleich', 'planung/vergleich'],
    ['Aufträge · Liste', 'auftraege/liste'],
    ['Aufträge · Arbeitsfolgen', 'auftraege/folgen'],
    ['Aufträge · Regeln', 'auftraege/regeln'],
    ['Mannschaft', 'mannschaft/liste'],
    ['Mannschaft · Anwesenheit je KW', 'mannschaft/anwesenheit'],
    ['Mannschaft · Urlaubsplanung einlesen', 'mannschaft/urlaub'],
    ['Mannschaft · Einsatzplan', 'mannschaft/einsatz'],
    ['Mannschaft · Aushang', 'mannschaft/aushang'],
    ['Einstellungen · Parameter', 'einstellungen/parameter'],
    ['Einstellungen · Stände', 'einstellungen/staende'],
    ['Einstellungen · Daten & Prüfung', 'einstellungen/daten'],
  ];
  for (const [label, route] of bereiche) {
    if (!passt(label)) continue;
    out.push({ kind: 'Bereich', label, meta: '', score: 4, run: () => a.navigate(route) });
  }

  return out.sort((x, y) => x.score - y.score);
}
