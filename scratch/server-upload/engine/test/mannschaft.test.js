/**
 * Tests der Mannschaft: Qualifikationsmatrix, Abwesenheiten, Schichten
 * und der Einsatzplan je Mitarbeiter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, template, createProject } from './helpers.js';
import { defaultTeam, teamOn, skillShares, shiftCapability, qualifiedFor, peopleOf, rateOf, averageRate, mentoringHoursOfTeam } from '../team.js';
import { assignPeople, personWeek } from '../assignment.js';
import { runSchedule } from '../scheduler.js';
import {
  dayCapacity, placesFor, workersPerPlace, aushilfeVon,
} from '../capacity.js';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { analyze } from '../index.js';

const MO = '2026-09-07';

/** Konfiguration mit gepflegter Mannschaft. */
function mitTeam(mut = (t) => t, over = {}) {
  const c = testConfig(over);
  c.workforce.team = defaultTeam();
  mut(c.workforce.team);
  return c;
}

/* ---------------- Mannschaft ---------------- */

test('Mannschaft: neun Kürzel, 8,5 Mitarbeiter, Vorarbeiter zur Hälfte', () => {
  const c = mitTeam();
  const on = teamOn(c, MO);
  assert.equal(on.heads, 9, 'die Stammmannschaft ist anwesend');
  assert.equal(on.factor, 8.5);
  assert.equal(peopleOf(c).find((p) => p.id === 'STWUE').factor, 0.5);
});

test('Mannschaft: 15 Leiharbeiter, davon 5 zugesagt und 10 auf Abruf', () => {
  const c = mitTeam();
  const leihe = peopleOf(c).filter((p) => p.kind === 'LEIHE');
  assert.equal(leihe.length, 15);
  assert.equal(peopleOf(c).length, 24, 'neun Stammleute und 15 Leiharbeiter');
  assert.ok(leihe[0].label.startsWith('Leiharbeiter'), 'Name ist vorbelegt und überschreibbar');

  // Fuenf sind laut Auskunft vom 15.09.2026 real zugesagt: zwei ab dem
  // 15.09., einer ab Montag dem 21.09. und zwei ab dem 01.10.
  const zugesagt = leihe.filter((p) => p.startDate);
  assert.equal(zugesagt.length, 5);
  assert.deepEqual(zugesagt.map((p) => p.startDate),
    ['2026-09-15', '2026-09-15', '2026-09-21', '2026-10-01', '2026-10-01']);

  // Vor ihrem Eintritt zaehlt keiner von ihnen mit
  assert.equal(teamOn(c, '2026-09-07').factor, 8.5, 'am 07.09. ist nur die Stammmannschaft da');
  assert.equal(teamOn(c, '2026-09-14').factor, 8.5, 'am Tag vor dem Eintritt ebenso');
  // Ab dem Eintritt mit Einarbeitung: 40 % in der ersten Woche
  assert.equal(teamOn(c, '2026-09-15').factor, 9.3, 'zwei Zugesagte mit 40 %');
  assert.equal(teamOn(c, '2026-09-21').factor, 10.1, 'dazu der dritte, die ersten in Woche zwei');
  assert.equal(teamOn(c, '2026-11-02').factor, 13.5, 'ab November alle fünf voll eingearbeitet');

  // Die zehn uebrigen sind Platzhalter und zaehlen nur mit angehakter Woche
  const abruf = leihe.filter((p) => !p.startDate);
  assert.equal(abruf.length, 10);
  // Grundlinie ohne Abruf, damit die Einarbeitungskurve der beiden
  // Abgerufenen fuer sich messbar bleibt
  const grund = mitTeam();
  const basis = (datum) => teamOn(grund, datum).factor;
  for (const wk of ['2026-W42', '2026-W43', '2026-W44', '2026-W45']) {
    abruf[0].weeks[wk] = true;
    abruf[1].weeks[wk] = true;
  }
  assert.equal(teamOn(c, '2026-10-05').factor, basis('2026-10-05'), 'KW 41 ohne Abruf unverändert');
  const zusatzAbruf = (datum) => Math.round((teamOn(c, datum).factor - basis(datum)) * 100) / 100;
  assert.equal(zusatzAbruf('2026-10-12'), 0.8, 'erste Abrufwoche: zwei mal 40 %');
  assert.equal(zusatzAbruf('2026-10-19'), 1.2, 'zweite Woche: 60 %');
  assert.equal(zusatzAbruf('2026-10-26'), 1.6, 'dritte Woche: 80 %');
  assert.equal(zusatzAbruf('2026-11-02'), 2, 'ab der vierten Woche voll');
});

test('Einsatzfenster: vor dem Eintritt hilft auch eine angehakte Woche nicht', () => {
  const c = mitTeam((t) => {
    const p = t.people.find((x) => x.id === 'LEIHE-04');
    // Eintritt ist der 01.10. - die Woche davor wird trotzdem angehakt
    p.weeks['2026-W39'] = true;
  });
  assert.equal(teamOn(c, '2026-09-24').factor, 10.1, 'der Vierte ist am 24.09. noch nicht im Haus');

  // Mit Einsatzende faellt die Person danach wieder heraus
  const mitEnde = mitTeam((t) => {
    for (const p of t.people) if (p.kind === 'LEIHE') p.endDate = '2026-10-31';
  });
  assert.equal(teamOn(mitEnde, '2026-10-30').factor, 13.5, 'am 30.10. sind alle fünf da');
  assert.equal(teamOn(mitEnde, '2026-11-02').factor, 8.5, 'ab dem 02.11. nur noch die Stammmannschaft');
});

test('Mannschaft: Betreuung neuer Kräfte wird der Stammmannschaft abgezogen', () => {
  const c = mitTeam((t) => {
    // Platzhalter verwenden, damit nur die beiden Abgerufenen Betreuung brauchen
    const l = t.people.filter((p) => p.kind === 'LEIHE' && !p.startDate).slice(0, 2);
    for (const p of l) { p.weeks['2026-W42'] = true; p.weeks['2026-W43'] = true; }
  });
  const grund = mitTeam();
  // Vorgabe: 5/3/1 Betreuungsstunden je Person und Woche
  const zusatz = (datum) => mentoringHoursOfTeam(c, datum) - mentoringHoursOfTeam(grund, datum);
  assert.equal(zusatz('2026-10-12'), 10, 'zwei Neue in der ersten Woche: 2 × 5 h');
  assert.equal(zusatz('2026-10-19'), 6, 'zweite Woche: 2 × 3 h');
  assert.equal(mentoringHoursOfTeam(grund, '2026-09-07'), 0, 'ohne Neue keine Betreuung');

  // Und die Tageskapazität ist dadurch kleiner
  const ohne = dayCapacity(grund, '2026-10-12').poolHours;
  const mit = dayCapacity(c, '2026-10-12').poolHours;
  assert.ok(mit > ohne, 'zwei Leiharbeiter bringen trotz Betreuung mehr Stunden');
  assert.ok(dayCapacity(c, '2026-10-12').mentoringHours > 0, 'die Betreuung wird ausgewiesen');
});

test('Mannschaft: Kostensätze je Person', () => {
  const c = mitTeam();
  const stamm = peopleOf(c).find((p) => p.id === 'JARO');
  const leihe = peopleOf(c).find((p) => p.kind === 'LEIHE');
  // Stundenlohn 19-26 EUR laut Auskunft, hinterlegt ist der Mittelwert
  assert.equal(rateOf(c, stamm), 22.5);
  assert.equal(rateOf(c, leihe), 55, 'Rechnungssatz Leiharbeit, Spanne 45–65 €');
  stamm.rate = 26;
  assert.equal(rateOf(c, stamm), 26, 'je Person änderbar');
  leihe.rate = 65;
  assert.equal(rateOf(c, leihe), 65);
  assert.equal(averageRate(c, MO), 22.91, 'Mittelwert der anwesenden Mannschaft (JARO steht auf 26 €)');

  // Die Zuschläge stehen als Prozente bzw. Zulage bereit
  assert.equal(c.costs.overtimeSurchargePercent, 35);
  assert.equal(c.costs.saturdaySurchargePercent, 35);
  assert.equal(c.costs.nightSurchargePercent, 40);
  assert.equal(c.costs.lateShiftAllowancePerShift, 24);
});

test('Mannschaft: Abwesenheit nimmt die Person aus der Rechnung', () => {
  const c = mitTeam((t) => {
    t.people.find((p) => p.id === 'JARO').absences = [{ from: '2026-09-07', to: '2026-09-11', kind: 'URLAUB' }];
  });
  assert.equal(teamOn(c, '2026-09-07').factor, 7.5);
  assert.equal(teamOn(c, '2026-09-11').factor, 7.5);
  // Montag darauf ist er wieder da
  assert.equal(teamOn(c, '2026-09-14').factor, 8.5);
  assert.equal(teamOn(c, '2026-09-07').absent[0].id, 'JARO');
});

test('Mannschaft als Grundlage der Besetzung ersetzt die Wochenwerte', () => {
  const zahlen = mitTeam((t) => { t.source = 'ZAHLEN'; }, { workforce: { baseHeadcount: 4 } });
  const liste = mitTeam((t) => { t.source = 'MANNSCHAFT'; }, { workforce: { baseHeadcount: 4 } });
  assert.equal(dayCapacity(zahlen, MO).headcount.effective, 4);
  assert.equal(dayCapacity(liste, MO).headcount.effective, 8.5, 'aus der Liste kommen 8,5');
  assert.equal(dayCapacity(liste, MO).headcount.fromTeam, true);
});

test('Krankenquote wird von der Besetzung abgezogen', () => {
  const ohne = testConfig({ workforce: { baseHeadcount: 10, sickRate: 0 } });
  const mit = testConfig({ workforce: { baseHeadcount: 10, sickRate: 0.1 } });
  assert.equal(dayCapacity(ohne, MO).headcount.effective, 10);
  assert.equal(dayCapacity(mit, MO).headcount.effective, 9);
  assert.ok(dayCapacity(mit, MO).poolHours < dayCapacity(ohne, MO).poolHours);
});

/* ---------------- Qualifikationen ---------------- */

test('Qualifikationsmatrix begrenzt den Arbeitsgang hart', () => {
  // Nur zwei von neun dürfen hydro-prüfen
  const c = mitTeam((t) => {
    for (const p of t.people) p.skills.HYDRO = false;
    t.people.find((p) => p.id === 'JARO').skills.HYDRO = true;
    t.people.find((p) => p.id === 'SIDR').skills.HYDRO = true;
  });
  const shares = skillShares(c, MO);
  assert.ok(Math.abs(shares.HYDRO - 2 / 8.5) < 0.001, `Anteil 2/8,5 erwartet, war ${shares.HYDRO}`);
  assert.equal(shares.SAEGEN, 1);

  const cap = dayCapacity(c, '2026-09-08'); // Dienstag: Hydro erlaubt, NoBo da
  const alle = dayCapacity(testConfig(), '2026-09-08');
  assert.ok(cap.byOp.HYDRO.capUnits < alle.byOp.HYDRO.capUnits,
    'weniger Qualifizierte müssen weniger Kapazität ergeben');
  assert.deepEqual(cap.byOp.HYDRO.detail.qualified, ['JARO', 'SIDR']);
});

test('Ohne Qualifizierte steht der Arbeitsgang still', () => {
  const c = mitTeam((t) => { for (const p of t.people) p.skills.BIEGEN = false; });
  assert.equal(dayCapacity(c, MO).byOp.BIEGEN.capUnits, 0);
  assert.equal(qualifiedFor(c, 'BIEGEN').length, 0);

  const input = {
    config: c,
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { BIEGEN: 20 }) },
    projects: [createProject({ id: 'T1', orderNo: 'T-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-30' })],
  };
  const result = runSchedule(input);
  assert.equal(result.allocations.length, 0, 'ohne Qualifikation wird nichts eingeplant');
  assert.equal(result.projects[0].status, 'VERSPAETET');
});

test('Qualifikationen können abgeschaltet werden (Rechnung wie bisher)', () => {
  const c = mitTeam((t) => {
    t.enforceSkills = false;
    for (const p of t.people) p.skills.BIEGEN = false;
  });
  assert.equal(skillShares(c, MO), null);
  assert.ok(dayCapacity(c, MO).byOp.BIEGEN.capUnits > 0);
});

test('Schichtfähigkeit: STWUE und MAAP fahren keine Schicht', () => {
  const c = mitTeam();
  const s = shiftCapability(c);
  assert.equal(s.total, 14, 'neun Stammleute und die fünf zugesagten Leiharbeiter');
  assert.equal(s.capable, 12, 'STWUE und MAAP fahren keine Schicht');
  assert.deepEqual(s.blockedIds, ['STWUE', 'MAAP']);

  // Platzhalter ohne angehakte Woche zaehlen nicht mit
  const abruf = peopleOf(c).filter((p) => p.kind === 'LEIHE' && !p.startDate).slice(0, 2);
  for (const p of abruf) p.weeks['2026-W42'] = true;
  const mitLeihe = shiftCapability(c, '2026-10-12');
  assert.equal(mitLeihe.total, 16);
  assert.equal(mitLeihe.capable, 14);
});

/* ---------------- Einsatzplan ---------------- */

test('Einsatzplan verteilt die Stunden auf die Mannschaft', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const result = runSchedule(input);
  const plan = assignPeople(result, input.config);

  assert.ok(plan.days.length > 0);
  assert.equal(plan.people.length, 24, 'Stammleute und Leiharbeiterplätze');

  // Keine Person bekommt mehr als ihr Tagesbudget
  for (const d of plan.days) {
    const proPerson = {};
    for (const e of d.entries) {
      if (!e.personId) continue;
      proPerson[e.personId] = (proPerson[e.personId] ?? 0) + e.hours;
    }
    for (const [id, h] of Object.entries(proPerson)) {
      const f = peopleOf(input.config).find((p) => p.id === id).factor;
      assert.ok(h <= f * d.hoursPerEmployee + 0.02,
        `${id} am ${d.date}: ${h} h über dem Budget ${f * d.hoursPerEmployee} h`);
    }
  }

  // Der Vorarbeiter mit halbem Zeitanteil bekommt deutlich weniger
  const stwue = plan.people.find((p) => p.id === 'STWUE');
  const jaro = plan.people.find((p) => p.id === 'JARO');
  assert.ok(stwue.hours < jaro.hours * 0.75, `${stwue.hours} gegen ${jaro.hours}`);

  // Summe der verteilten Stunden plus offene Stunden = eingeplante Stunden
  const verteilt = plan.days.reduce((a, d) => a + d.entries.reduce((x, e) => x + e.hours, 0), 0);
  const geplant = result.allocations.reduce((a, x) => a + x.manHours, 0);
  assert.ok(Math.abs(verteilt - geplant) < 1, `${verteilt} gegen ${geplant}`);
});

test('Einsatzplan gibt nur Arbeit, die die Person auch darf', () => {
  const dataset = seedDataset();
  const input = materialize(dataset, 'BASELINE');
  for (const p of input.config.workforce.team.people) p.skills.ORBITAL = false;
  input.config.workforce.team.people.find((p) => p.id === 'TOBE').skills.ORBITAL = true;
  const result = runSchedule(input);
  const plan = assignPeople(result, input.config);
  const falsch = plan.days.flatMap((d) => d.entries)
    .filter((e) => e.opId === 'ORBITAL' && e.personId && e.personId !== 'TOBE');
  assert.equal(falsch.length, 0, 'nur TOBE darf orbital schweißen');
});

test('Wochenplan einer Person nennt Tag, Auftrag und Arbeitsgang', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const plan = assignPeople(runSchedule(input), input.config);
  const woche = personWeek(plan, 'JARO', plan.days[0].weekKey);
  assert.ok(woche.length > 0);
  const tag = woche.find((t) => t.entries.length > 0);
  assert.ok(tag, 'mindestens ein Tag mit Arbeit');
  assert.ok(tag.entries[0].orderNo, 'der Auftrag muss dranstehen');
  assert.ok(tag.entries[0].opName, 'der Arbeitsgang muss dranstehen');
  assert.ok(tag.hours > 0);
});

test('Urlaub erscheint im Einsatzplan und bringt keine Arbeit', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  input.config.workforce.team.people.find((p) => p.id === 'SYLA').absences = [
    { from: '2026-09-14', to: '2026-09-18', kind: 'URLAUB' },
  ];
  const plan = assignPeople(runSchedule(input), input.config);
  const tag = plan.days.find((d) => d.date === '2026-09-15');
  assert.ok(tag.absent.some((a) => a.id === 'SYLA' && a.kind === 'URLAUB'));
  assert.equal(tag.entries.filter((e) => e.personId === 'SYLA').length, 0);
});

/* ------------------------------------------------------------------ *
 * Einsatzplan - so, wie die Abteilungsleitung ihn aufstellt
 *
 * Gemeldet am 18.09.2026: "Der Einsatzplan ist auch verdreht und nicht
 * logisch. MAAP wird an manchen Tagen gar nicht geplant, obwohl anwesend."
 *
 * Der Vorwurf traf zu: Der Code gab der Person mit dem groessten
 * Restbudget ihr GANZES Tagesbudget auf einmal. Ueber den Horizont kam
 * heraus: JARO 1.170 h, TOBE 21 h, STWUE 3 h. Diese Tests halten fest,
 * dass das nicht wiederkommt.
 * ------------------------------------------------------------------ */

test('Einsatzplan: die Last verteilt sich gleichmäßig über die Mannschaft', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  const result = runSchedule(input);
  const plan = assignPeople(result, input.config, {});

  const imEinsatz = plan.people.filter((p) => p.hours > 0);
  assert.ok(imEinsatz.length >= 10, `nur ${imEinsatz.length} Personen im Einsatz`);

  /*
   * Gemessen wird die Auslastung, nicht die Stundenzahl: Eine
   * Halbtagskraft soll die HAELFTE bekommen, nicht dasselbe.
   */
  const last = imEinsatz.map((p) => p.hours / Math.max(0.1, p.factor));
  const min = Math.min(...last);
  const max = Math.max(...last);
  assert.ok(max / min < 1.15,
    `Spanne ${Math.round(min)} bis ${Math.round(max)} h je Zeitanteil – das ist keine gleichmäßige `
    + 'Verteilung (früher: 1.170 h gegen 21 h)');

  const halbe = plan.people.find((p) => p.factor === 0.5 && p.hours > 0);
  if (halbe) {
    const volle = imEinsatz.filter((p) => p.factor === 1);
    const mittel = volle.reduce((a, p) => a + p.hours, 0) / volle.length;
    assert.ok(Math.abs(halbe.hours - mittel / 2) < mittel * 0.15,
      `Halbtagskraft ${halbe.id} hat ${Math.round(halbe.hours)} h, Vollzeit im Mittel `
      + `${Math.round(mittel)} h – erwartet wäre etwa die Hälfte`);
  }
});

test('Einsatzplan: jede eingeplante Stunde bekommt einen Namen', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  const result = runSchedule(input);
  const plan = assignPeople(result, input.config, {});
  assert.equal(plan.unassignedHours, 0,
    `${plan.unassignedHours} h ohne Namen – die Plätze erlauben Ablösung, das muss aufgehen`);

  // Gegenprobe: die verteilten Stunden sind genau die eingeplanten
  const verteilt = plan.days.reduce((a, d) => a
    + d.entries.filter((e) => e.personId).reduce((x, e) => x + e.hours, 0), 0);
  const eingeplant = result.daySeries.reduce((a, d) => a + (d.poolUsed ?? 0), 0);
  assert.ok(Math.abs(verteilt - eingeplant) < 1,
    `${Math.round(verteilt)} h verteilt gegen ${Math.round(eingeplant)} h eingeplant`);
});

test('Einsatzplan: an einem Platz stehen nicht mehr Leute, als er zulässt', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  const cfg = input.config;
  const result = runSchedule(input);
  const plan = assignPeople(result, cfg, {});

  for (const tag of plan.days) {
    /** Gleichzeitig Arbeitende je Arbeitsgang - Ablösung zählt nicht dazu */
    const proOp = {};
    for (const e of tag.entries) {
      if (!e.personId) continue;
      (proOp[e.opId] ??= new Set()).add(e.personId);
    }
    for (const [opId, leute] of Object.entries(proOp)) {
      const plaetze = placesFor(cfg, opId);
      if (plaetze == null) continue;
      const jePlatz = Math.max(1, Number(workersPerPlace(cfg, opId) ?? 1));
      // Ablösung erlaubt mehr Köpfe als Plätze, aber nie mehr Stunden als
      // Platzstunden - genau das ist die harte Grenze.
      const stunden = tag.entries.filter((e) => e.personId && e.opId === opId)
        .reduce((a, e) => a + e.hours, 0);
      const opWindow = Number(cfg.resources?.byOperation?.[opId]?.operatingHoursPerDay
        ?? cfg.resources?.operatingHoursPerDay ?? 7.5);
      let platzStunden = Number(plaetze) * jePlatz * opWindow;
      /*
       * Aushilfe (Nutzeranforderung 25.09.2026) hebt die Platzgrenze
       * bewusst - eine sonst untaetige Person darf dort zusaetzlich
       * mithelfen. Die harte Grenze ist deshalb Platzstunden PLUS die
       * hinterlegte Aushilfe-Obergrenze, nicht mehr die reine Platzstunde.
       * Aushilfestunden kosten mehr Arbeitszeit als Inhalt (stundenfaktor)
       * - fuer den Vergleich mit tatsaechlich verplanten PERSONENSTUNDEN
       * zaehlt deshalb der Stundenfaktor mit, nicht nur der Arbeitsinhalt.
       */
      const hilfe = aushilfeVon(cfg, opId);
      if (hilfe) platzStunden += hilfe.max * hilfe.leistung * opWindow * hilfe.stundenfaktor;
      assert.ok(stunden <= platzStunden + 0.5,
        `${tag.date} ${opId}: ${stunden.toFixed(1)} h auf ${plaetze} Plätzen `
        + `(höchstens ${platzStunden.toFixed(1)} h), ${leute.size} Personen`);
    }
  }
});

test('Einsatzplan: wer anwesend ist und nichts bekommt, steht mit Grund da', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  const result = runSchedule(input);
  const plan = assignPeople(result, input.config, {});

  let leerTage = 0;
  const gruende = new Set();
  for (const tag of plan.days) {
    const mitArbeit = new Set(tag.entries.filter((e) => e.personId).map((e) => e.personId));
    for (const i of tag.idle ?? []) {
      leerTage += 1;
      gruende.add(i.grund);
      assert.ok(!mitArbeit.has(i.id),
        `${tag.date}: ${i.id} steht als ohne Arbeit, hat aber Einträge`);
      assert.ok(['KEIN_PLATZ_FREI', 'ARBEIT_VERTEILT', 'KEINE_QUALIFIKATION', 'SCHICHT_OHNE_ARBEIT', 'KEINE_ARBEIT'].includes(i.grund),
        `unbekannter Grund ${i.grund}`);
    }
  }
  assert.ok(leerTage > 0, 'im Startdatenbestand stehen Leute ohne Platz – das muss dastehen');
  /*
   * FIX Luecken-Report (Nutzeranforderung 21.09.2026): "kein Platz frei"
   * war zu oft die falsche Antwort - nachgemessen im Original-Datenbestand
   * (siehe original/Armaturenbau-MEGC.html): in den meisten Faellen war
   * der Platz gar nicht belegt, es fehlte schlicht freigegebene Arbeit.
   * Im echten Startdatenbestand dieser Codebasis bestaetigt sich das noch
   * deutlicher: JEDER Leerlauf geht auf verteilte/fehlende Arbeit zurueck,
   * keiner auf eine echte Platzgrenze.
   */
  assert.ok(gruende.has('ARBEIT_VERTEILT'),
    'der häufigste Grund im Startdatenbestand ist verteilte, nicht freigegebene Arbeit - nicht belegte Plätze');
  assert.ok(plan.days.some((tag) => (tag.idle ?? []).some((i) => i.grund === 'ARBEIT_VERTEILT' && i.warteUrsache?.ursache)),
    'mindestens ein ARBEIT_VERTEILT-Fall muss die wartende Ursache konkret benennen');

  /*
   * Und die Gegenprobe zur Meldung: Wenn so viele Personentage ohne Arbeit
   * dastehen, darf die Anwendung nicht nach Personal rufen.
   */
  const a = analyze(ds, 'BASELINE');
  assert.equal(a.plausibility.items.find((x) => x.code === 'PERSONAL_FEHLT'), undefined,
    'bei verteilter Arbeit ist "es fehlt Personal" die falsche Meldung');
});

test('Einsatzplan: niemand wird an einen Arbeitsgang gestellt, den er nicht darf', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  const cfg = input.config;
  const result = runSchedule(input);
  const plan = assignPeople(result, cfg, {});
  const leute = new Map((cfg.workforce.team.people ?? []).map((p) => [p.id, p]));
  for (const tag of plan.days) {
    for (const e of tag.entries) {
      if (!e.personId) continue;
      const p = leute.get(e.personId);
      assert.ok(p?.skills?.[e.opId],
        `${tag.date}: ${e.personId} ist für ${e.opId} nicht angehakt`);
    }
  }
});

test('Qualifikationsmatrix: der Einsatzplan folgt der Änderung', () => {
  /*
   * Vorgabe der Abteilungsleitung (18.09.2026): "Passe den Einsatzplan
   * automatisch an wenn ich die Qualimatrix anpasse." Gerechnet wurde das
   * immer neu - dieser Test haelt fest, dass es so bleibt, und dass der
   * Grund fuer den Leerlauf mitkommt.
   */
  const ds = seedDataset();
  const sz = ds.scenarios.find((x) => x.isBaseline) ?? ds.scenarios[0];
  const plane = () => {
    const input = materialize(ds, sz.id);
    return assignPeople(runSchedule(input), input.config, {});
  };

  const vorher = plane().people.find((p) => p.id === 'MAAP');
  assert.ok(vorher.hours > 0, 'MAAP muss im Ausgangsstand Arbeit haben');
  assert.ok(Object.keys(vorher.byOp).length > 3, 'und mehrere Arbeitsgänge');

  // Alle Haken bis auf Sägen entfernen
  const person = sz.config.workforce.team.people.find((p) => p.id === 'MAAP');
  for (const k of Object.keys(person.skills)) person.skills[k] = (k === 'SAEGEN');

  const nachher = plane().people.find((p) => p.id === 'MAAP');
  assert.deepEqual(Object.keys(nachher.byOp), ['SAEGEN'],
    'nach der Änderung darf MAAP nur noch sägen');
  assert.ok(nachher.hours !== vorher.hours, 'die Stundenzahl muss sich ändern');
  assert.ok((nachher.idleReasons?.KEINE_QUALIFIKATION ?? 0) > 0,
    'die Tage ohne passende Qualifikation müssen als Grund dastehen');
});

test('Qualifikationsmatrix: ein Arbeitsgang ohne Qualifizierte ist kritisch', () => {
  const ds = seedDataset();
  assert.equal(
    analyze(ds, 'BASELINE').plausibility.items
      .find((x) => x.code === 'ARBEITSGANG_OHNE_QUALIFIZIERTE'),
    undefined,
    'im Ausgangsstand ist überall jemand angehakt – keine Meldung');

  const sz = ds.scenarios.find((x) => x.isBaseline) ?? ds.scenarios[0];
  for (const p of sz.config.workforce.team.people) p.skills = { ...p.skills, HYDRO: false };
  const b = analyze(ds, sz.id).plausibility.items
    .find((x) => x.code === 'ARBEITSGANG_OHNE_QUALIFIZIERTE');
  assert.ok(b, 'ohne einen einzigen Hydro-Prüfer muss die Anwendung Alarm geben');
  assert.equal(b.level, 'KRITISCH');
  assert.equal(b.value.arbeitsgaenge.length, 1);
  assert.equal(b.value.arbeitsgaenge[0].opId, 'HYDRO');
  assert.ok(b.value.arbeitsgaenge[0].stunden > 0, 'die offenen Stunden müssen dabeistehen');
  assert.match(b.title, /1 Arbeitsgang ohne/);

  // Mehrzahl muss auch stimmen - "Arbeitsgangang" waere peinlich
  for (const p of sz.config.workforce.team.people) p.skills = { ...p.skills, BEIZEN: false };
  const b2 = analyze(ds, sz.id).plausibility.items
    .find((x) => x.code === 'ARBEITSGANG_OHNE_QUALIFIZIERTE');
  assert.match(b2.title, /2 Arbeitsgänge ohne/);
});

/* ------------------------------------------------------------------ *
 * Aushilfe / Helfer (Nutzeranforderung 25.09.2026)
 * ------------------------------------------------------------------ */

function helferPerson(id, skills) {
  return {
    id, label: id, role: '', kind: 'STAMM', factor: 1, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '',
  };
}

test('Aushilfe: eine sonst untätige Person wird als Helfer benannt statt "Arbeit vergeben" zu stehen', () => {
  /*
   * Nutzeranforderung 25.09.2026: "MAAP muss in dem Fall einem
   * Arbeitsgang zugewiesen werden, notfalls als Helfer bei der
   * Hydroprüfung oder Endkontrolle etc." Konstruiert direkt auf
   * assignPeople(), weil das Zustandekommen der Aushilfe-Kapazität
   * (Terminierung + Kapazitätsrechnung) bereits in anderen Tests
   * (capacity.test.js, scheduler.test.js) geprüft wird - hier geht es
   * ausschließlich darum, dass eine benannte Person daraus wird.
   */
  const config = testConfig({
    workforce: {
      baseHeadcount: 2,
      team: {
        source: 'MANNSCHAFT', enforceSkills: true,
        people: [helferPerson('A', { ENTGRATEN: true }), helferPerson('MAAP', {})],
      },
    },
    resources: {
      byOperation: {
        ENTGRATEN: {
          places: 1, workersPerPlace: 1,
          aushilfe: {
            max: 1, leistung: 0.5, stundenfaktor: 2, label: 'von Hand entgraten', text: 't',
          },
        },
      },
    },
  });
  const date = '2026-09-21';
  const result = {
    config, projects: [], blocked: [],
    daySeries: [{
      date, kind: 'REGULAR', weekKey: '2026-W39', hoursPerEmployee: 7.5, productivity: 1,
      byOp: { ENTGRATEN: { aushilfeManHours: 7.5 } },
    }],
    allocations: [{ date, projectId: 'P1', opId: 'ENTGRATEN', manHours: 15 }],
  };

  const plan = assignPeople(result, config, {});
  const tag = plan.days.find((d) => d.date === date);
  assert.deepEqual(tag.idle, [], 'niemand darf ohne Grund/Zuteilung dastehen, wenn Aushilfe möglich ist');

  const maap = tag.entries.find((e) => e.personId === 'MAAP');
  assert.ok(maap, 'MAAP muss eine Zeile im Einsatzplan bekommen, nicht nur "Arbeit vergeben"');
  assert.equal(maap.opId, 'ENTGRATEN');
  assert.equal(maap.helfer, true, 'die Zuteilung muss als Aushilfe erkennbar sein, nicht als reguläre Qualifikation');
  assert.equal(maap.hours, 7.5);

  const a = tag.entries.find((e) => e.personId === 'A');
  assert.ok(a && !a.helfer, 'die qualifizierte Person bleibt regulär, nicht als Helfer markiert');
});

test('Aushilfe: kein Helfer, wenn die Terminierung keine Aushilfe eingepreist hat', () => {
  /*
   * Gegenprobe: ohne aushilfeManHours an diesem Tag darf niemand als
   * Helfer eingesetzt werden, auch wenn eine Person untätig ist - sonst
   * würde die Aushilfe zur stillen Umgehung der Qualifikationsmatrix.
   */
  const config = testConfig({
    workforce: {
      baseHeadcount: 2,
      team: {
        source: 'MANNSCHAFT', enforceSkills: true,
        people: [helferPerson('A', { ENTGRATEN: true }), helferPerson('MAAP', {})],
      },
    },
  });
  const date = '2026-09-21';
  const result = {
    config, projects: [], blocked: [],
    daySeries: [{
      date, kind: 'REGULAR', weekKey: '2026-W39', hoursPerEmployee: 7.5, productivity: 1,
      byOp: { ENTGRATEN: { aushilfeManHours: 0 } },
    }],
    allocations: [{ date, projectId: 'P1', opId: 'ENTGRATEN', manHours: 7.5 }],
  };

  const plan = assignPeople(result, config, {});
  const tag = plan.days.find((d) => d.date === date);
  const maap = tag.entries.find((e) => e.personId === 'MAAP');
  assert.equal(maap, undefined, 'ohne eingepreiste Aushilfe darf MAAP nicht an ENTGRATEN eingesetzt werden');
  const idle = tag.idle.find((i) => i.id === 'MAAP');
  assert.ok(idle, 'MAAP steht stattdessen korrekt als ohne Arbeit da');
  assert.equal(idle.grund, 'KEINE_QUALIFIKATION');
});

/* ------------------------------------------------------------------ *
 * Luecken-Report (Nutzeranforderung 25.09.2026)
 * ------------------------------------------------------------------ */

test('Lücken-Report: ZAHLEN-Modus kann mehr Kapazität versprechen, als die reale Mannschaft trägt', () => {
  /*
   * "welcher Arbeit ist aus welchem Grund nicht freigegeben?" Ein
   * konkreter, real vorkommender Fall: Im Modus ZAHLEN rechnet die
   * Terminierung mit einer abstrakten Kopfzahl (baseHeadcount), die
   * Einsatzplanung verteilt aber nur an die tatsächlich benannten
   * Personen der Mannschaftsliste. Reicht die Namensliste nicht an die
   * Kopfzahl heran, entsteht echte, unbesetzbare Arbeit - keine
   * Terminierungslücke, sondern eine Besetzungslücke.
   */
  const config = testConfig({
    workforce: {
      baseHeadcount: 5,
      team: {
        source: 'ZAHLEN', enforceSkills: true,
        people: [helferPerson('A', { SAEGEN: true })],
      },
    },
  });
  const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 30 }] } };
  const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', priority: 'P1' });
  const result = runSchedule({ config, projects: [project], templates });
  const plan = assignPeople(result, config, {});

  assert.ok(plan.unassignedHours > 0, 'die Kopfzahl verspricht mehr, als die eine benannte Person leisten kann');
  const luecke = plan.luecken.find((l) => l.opId === 'SAEGEN');
  assert.ok(luecke, 'die unbesetzbare Arbeit muss im Lücken-Report stehen');
  assert.equal(luecke.hauptgrund, 'BUDGET_DER_QUALIFIZIERTEN_AUSGESCHOEPFT',
    'die einzige qualifizierte Person ist ausgeschöpft - kein Platzproblem');
  assert.equal(plan.lueckenJeGrund.BUDGET_DER_QUALIFIZIERTEN_AUSGESCHOEPFT, luecke.stunden);
});
