/**
 * Tests des Mehraufwands.
 *
 * Kern der Pruefung ist die Ehrlichkeit der Zahl: Die abgeloeste Kennzahl
 * "x Stunden nicht einplanbar" hat eine Warteschlange ueber alle Tage
 * aufsummiert und dadurch ein Vielfaches ausgewiesen. Hier wird nachgerechnet,
 * dass die neue Zahl genau das NICHT tut - und dass sie sich aus zwei
 * nachvollziehbaren Reihen ergibt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { analyze } from '../index.js';
import { runSchedule } from '../scheduler.js';
import { dayCapacity } from '../capacity.js';
import { weekKey } from '../calendar.js';
import {
  mehraufwand, wendeMassnahmeAn, MASSNAHME, QUARTAL_WOCHEN, UEBERSTUNDEN_GRENZE,
} from '../mehraufwand.js';

function stand() {
  const ds = seedDataset();
  const input = materialize(ds, ds.activeScenarioId);
  return { input, result: runSchedule(input) };
}

test('Zeitraum sind 13 Wochen ab dem Stichtag (rollierendes Quartal)', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  assert.equal(m.wochen.length, QUARTAL_WOCHEN);
  assert.equal(m.wochen[0].weekKey, weekKey(input.config.planningDate));
  // Lueckenlos aufeinanderfolgende Wochen
  for (let i = 1; i < m.wochen.length; i++) {
    assert.ok(m.wochen[i].weekKey > m.wochen[i - 1].weekKey);
  }
});

test('Die fehlenden Stunden sind die größte aufsummierte Differenz', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  let kumKap = 0;
  let kumFaellig = 0;
  let groesste = 0;
  for (const w of m.wochen) {
    kumKap += w.kapazitaet;
    kumFaellig += w.faellig;
    groesste = Math.max(groesste, kumFaellig - kumKap);
    assert.ok(Math.abs(w.kumKapazitaet - kumKap) < 0.5, `${w.weekKey}: Kapazität stimmt nicht`);
    assert.ok(Math.abs(w.kumFaellig - kumFaellig) < 0.5, `${w.weekKey}: fällige Stunden stimmen nicht`);
  }
  assert.ok(Math.abs(m.stunden - Math.max(0, groesste)) < 0.5,
    `${m.stunden} h gegen nachgerechnete ${Math.round(groesste)} h`);
  assert.equal(m.engpassWoche, m.wochen.find((w) => w.luecke === m.stunden)?.weekKey);
});

test('Die Kapazität der Wochen stimmt mit der Kapazitätsrechnung überein', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  const w = m.wochen[5];
  let summe = 0;
  for (const d of result.daySeries) {
    if (weekKey(d.date) === w.weekKey) summe += dayCapacity(input.config, d.date).poolHours ?? 0;
  }
  assert.ok(Math.abs(w.kapazitaet - summe) < 0.5, `${w.kapazitaet} gegen ${summe}`);
});

test('Die fällige Arbeit einer Woche ist die offene Arbeit ihrer Aufträge', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  for (const w of m.wochen) {
    const summe = w.auftraege.reduce((a, p) => a + p.stunden, 0);
    assert.ok(Math.abs(w.faellig - summe) < 1, `${w.weekKey}: ${w.faellig} gegen ${summe}`);
    for (const p of w.auftraege) assert.equal(weekKey(p.dueDate), w.weekKey);
  }
});

test('Der Mehraufwand ist ein Bruchteil der alten Kennzahl – kein Vielfaches', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  // So rechnete die alte Kennzahl: Summe der Warteschlange ueber ALLE Tage
  const alt = result.blocked.filter((b) => !b.info).reduce((a, b) => a + b.manHours, 0);
  assert.ok(alt > m.stunden * 2,
    `die alte Zahl (${Math.round(alt)} h) war ein Vielfaches der neuen (${m.stunden} h)`);
  // Und so viel kann ueberhaupt nur an einem Tag warten
  const proTag = {};
  for (const b of result.blocked) {
    if (b.info) continue;
    proTag[b.date] = (proTag[b.date] ?? 0) + b.manHours;
  }
  const groessterTag = Math.max(...Object.values(proTag));
  assert.ok(alt > groessterTag * 5, 'die alte Zahl zählte dieselbe Arbeit an vielen Tagen erneut');
});

test('Der Stau je Woche ist eine Momentaufnahme, keine Summe über die Tage', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  for (const w of m.wochen) {
    if (w.stau.length === 0) continue;
    const summe = w.stau.reduce((a, s) => a + s.stunden, 0);
    const proTag = {};
    for (const b of result.blocked) {
      if (b.info || weekKey(b.date) !== w.weekKey) continue;
      proTag[b.date] = (proTag[b.date] ?? 0) + b.manHours;
    }
    const groessterTag = Math.max(0, ...Object.values(proTag));
    assert.ok(summe <= groessterTag + 1,
      `${w.weekKey}: ${summe} h dürfen nicht über dem größten Tageswert ${groessterTag} h liegen`);
  }
});

/* ------------------------------------------------------------------ *
 * Massnahmen
 * ------------------------------------------------------------------ */

test('Alle vier Wege werden immer gezeigt – auch der, der nichts bringt', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  assert.deepEqual(m.massnahmen.map((x) => x.key),
    [MASSNAHME.UEBERSTUNDEN, MASSNAHME.PLATZ, MASSNAHME.LEIHE, MASSNAHME.SAMSTAG]);
  const platz = m.massnahmen.find((x) => x.key === MASSNAHME.PLATZ);
  assert.equal(platz.stunden, 0, 'ein zweiter Platz schafft keine Mannstunden');
  assert.match(platz.hinweis, /Stau/, 'dafür sagt er, welchen Stau er löst');
  for (const x of m.massnahmen) {
    assert.ok(x.beschreibung.length > 5, `${x.key}: Beschreibung fehlt`);
    assert.ok(x.hinweis.length > 10, `${x.key}: Hinweis fehlt`);
    assert.equal(typeof x.deckung, 'number');
  }
});

test('Überstunden bleiben bei der Obergrenze von 5 h je Mitarbeiter und Woche', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  const ueber = m.massnahmen.find((x) => x.key === MASSNAHME.UEBERSTUNDEN);
  assert.ok(ueber.wert <= UEBERSTUNDEN_GRENZE, `${ueber.wert} h überschreiten die Grenze`);
  assert.ok(ueber.stunden > 0);
});

test('Ein zweiter Platz wird nur dort vorgeschlagen, wo es ihn geben kann', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  const platz = m.massnahmen.find((x) => x.key === MASSNAHME.PLATZ);
  if (!platz.patch) return; // kein Stau - dann gibt es auch nichts vorzuschlagen
  const eintrag = input.config.resources.byOperation[platz.patch.opId];
  assert.ok(Number(eintrag?.maxPlaces ?? 0) > Number(eintrag?.places ?? 1),
    `${platz.patch.opId} hat gar keinen zweiten Platz hinterlegt`);
});

test('Das Paket hält die vorgegebene Reihenfolge ein', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  assert.ok(m.paket, 'im Startdatenbestand fehlen Stunden – es muss ein Paket geben');
  const rang = { UEBERSTUNDEN: 1, PLATZ: 2, LEIHE: 3, SAMSTAG: 4 };
  const folge = m.paket.teile.map((t) => rang[t.key]);
  assert.deepEqual(folge, [...folge].sort((a, b) => a - b), 'Reihenfolge Überstunden → Platz → Leihe → Samstag');
  assert.ok(m.paket.kosten > 0);
});

/*
 * FIX Hoch06 (Audit 20.09.2026): "deckt die Lücke" muss RECHTZEITIG heißen.
 *
 * Vorher stoppte die Paketzusammenstellung, sobald die Summe der
 * Zusatzstunden über den GANZEN Zeitraum die Lücke deckte - hier reichen
 * 5 h Überstunden je Woche über 13 Wochen (731,9 h) für die Lücke von
 * 679,1 h. Die Engpasswoche liegt aber schon in KW 48 (Woche 12 von 13):
 * bis dahin sind erst 668,9 h Überstunden tatsächlich angefallen - 10,2 h
 * zu wenig genau dort, wo es zählt. Das alte "reicht: true" war falsch
 * beruhigend; das neue Feld rechtzeitigStunden zeigt die echte Lücke.
 */
test('Das Paket deckt die Lücke im echten Startdatenbestand nur über den ganzen Zeitraum, nicht rechtzeitig zur Engpasswoche', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  assert.ok(m.paket, 'im Startdatenbestand fehlen Stunden – es muss ein Paket geben');
  assert.equal(m.paket.offen, 0, 'über den ganzen Zeitraum gerechnet sieht das Paket ausreichend aus');
  assert.ok(m.paket.rechtzeitigStunden < m.stunden,
    'bis zur Engpasswoche selbst ist das Paket noch nicht vollständig wirksam');
  assert.equal(m.paket.reicht, false,
    'die Lücke ist zur Engpasswoche selbst noch nicht gedeckt, auch wenn die Gesamtsumme passt');
});

test('Eine Maßnahme lässt sich in eine Konfiguration übersetzen', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  const keys = m.wochen.map((w) => w.weekKey);

  const mitUeber = wendeMassnahmeAn(input.config, { typ: MASSNAHME.UEBERSTUNDEN, wert: 3 }, keys);
  assert.equal(mitUeber.workforce.weekly[keys[0]].overtimePerEmployee, 3);
  assert.equal(input.config.workforce.weekly[keys[0]]?.overtimePerEmployee ?? 0, 0,
    'der Ausgangsstand darf sich nicht ändern');

  const mitSamstag = wendeMassnahmeAn(input.config, { typ: MASSNAHME.SAMSTAG, wert: 2 }, keys);
  assert.equal(mitSamstag.saturday.weeks[keys[0]].enabled, true);
  assert.equal(mitSamstag.saturday.weeks[keys[1]].enabled, true);

  // Nur die Platzhalter ohne Eintritt werden gezogen - die fuenf zugesagten
  // Leiharbeiter bleiben unberuehrt.
  const vorherOhne = input.config.workforce.team.people
    .filter((p) => p.kind === 'LEIHE' && !p.startDate).map((p) => p.id);
  const mitLeihe = wendeMassnahmeAn(input.config, { typ: MASSNAHME.LEIHE, wert: 2, ab: '2026-09-21' }, keys);
  const neu = mitLeihe.workforce.team.people
    .filter((p) => vorherOhne.includes(p.id) && p.startDate === '2026-09-21');
  assert.equal(neu.length, 2);
  assert.ok(neu.every((p) => p.defaultActive === true), 'sie sind ab dem Eintritt dauerhaft dabei');

  const mitPlatz = wendeMassnahmeAn(input.config, { typ: MASSNAHME.PLATZ, opId: 'SAEGEN' }, keys);
  assert.equal(mitPlatz.resources.byOperation.SAEGEN.places, 2);
});

test('Eine übernommene Maßnahme baut die Verspätung tatsächlich ab', () => {
  const { input, result } = stand();
  const m = mehraufwand(input, result);
  const keys = m.wochen.map((w) => w.weekKey);
  const vorher = result.projects.reduce((a, p) => a + (p.lateDays ?? 0), 0);

  const config = wendeMassnahmeAn(input.config, { typ: MASSNAHME.UEBERSTUNDEN, wert: 5 }, keys);
  const nachher = runSchedule({ ...input, config });
  const danach = nachher.projects.reduce((a, p) => a + (p.lateDays ?? 0), 0);
  assert.ok(danach < vorher, `${vorher} -> ${danach} Verspätungstage`);
});

test('Der Mehraufwand hängt nicht an der Analyse und bremst sie nicht', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  // Bewusst NICHT Teil der Analyse: er rechnet mehrere Kapazitaetsdurchgaenge
  // und wuerde jede Reglerbewegung sichtbar verlangsamen.
  assert.equal(a.mehraufwand, undefined);

  const { input, result } = stand();
  const m = mehraufwand(input, result);
  assert.equal(m.wochen.length, QUARTAL_WOCHEN);
  assert.ok(m.summe.length > 20, 'die Zahl wird in einem Satz erklärt');
  assert.match(m.hinweis, /Plätze/, 'die Einschränkung steht an der Zahl');
});

test('Der Mehraufwand rechnet jede Einstellung nur einmal durch', () => {
  const { input, result } = stand();
  const t0 = Date.now();
  mehraufwand(input, result);
  const dauer = Date.now() - t0;
  assert.ok(dauer < 400, `Zu langsam: ${dauer} ms – der Merker für die Kapazitätsdurchgänge greift nicht`);
});
