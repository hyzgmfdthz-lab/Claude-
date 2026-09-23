import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRouting, templateFor, topoSort, terminalOps } from '../routing.js';
import { defaultRoutingTemplates, defaultConfig } from '../defaults.js';
import { createProject, routingKey } from '../model.js';

const T = defaultRoutingTemplates();
const C = defaultConfig();

test('Arbeitsplan: Auswahl je Projektart und Variante (§5/§6/§8)', () => {
  assert.equal(routingKey('NEUBAU', 'FT20'), 'NEUBAU_FT20');
  assert.equal(routingKey('WKP', 'FT40'), 'WKP');
  assert.equal(templateFor(createProject({ projectType: 'NEUBAU', variant: 'FT45' }), T).key, 'NEUBAU_FT45');
  assert.equal(templateFor(createProject({ projectType: 'UMBAU' }), T).key, 'UMBAU');
});

test('Arbeitsplan: eigene Vorlage je MEGC-Variante, Stunden getrennt änderbar (§6/§8)', () => {
  const h = (v) => resolveRouting(createProject({ projectType: 'NEUBAU', variant: v }), T, C).totalManHours;
  // Aus der bisherigen Planung liegt nur eine Standard-Neubaufolge vor
  // (247,75 h); dazu kommen 7,5 h Arbeitsvorbereitung je Auftrag
  // (Auskunft 09/2026). Die Vorlagen bestehen dennoch getrennt, damit je
  // Variante differenziert werden kann.
  for (const v of ['FT20', 'FT30', 'FT40', 'FT45']) assert.equal(h(v), 255.25);
  const eigene = JSON.parse(JSON.stringify(T));
  eigene.NEUBAU_FT20.steps.find((s) => s.opId === 'ORBITAL_KEHLNAHT').hours = 60;
  const h20 = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT20' }), eigene, C).totalManHours;
  const h40 = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT40' }), eigene, C).totalManHours;
  assert.notEqual(h20, h40, 'Eine Variante muss getrennt änderbar sein');
});

test('Arbeitsplan: bestätigte Stunden der bisherigen Planung', () => {
  const hours = (key) => Object.fromEntries(T[key].steps.map((s) => [s.opId, s.hours]));
  assert.deepEqual(hours('NEUBAU_FT40'), {
    AV: 7.5,
    SAEGEN: 18, ENTGRATEN: 20.75, BIEGEN: 13, HEFTEN: 38.75,
    ORBITAL_KEHLNAHT: 30.08, ORBITAL_STUMPFNAHT: 60.17, HANDSCHWEISSEN: 0,
    BEIZEN: 17.75, MOLCHEN: 0, VORMONTAGE: 12.25, HYDRO: 17, ENDKONTROLLE: 20,
  });
  // Die Arbeitsvorbereitung kommt mit 7,5 h je Auftrag hinzu
  assert.equal(T.UMBAU.steps.reduce((a, s) => a + s.hours, 0), 114);
  assert.equal(T.WKP.steps.reduce((a, s) => a + s.hours, 0), 264.5);
  assert.equal(T.PRUEFER.steps.reduce((a, s) => a + s.hours, 0), 114);
  assert.equal(hours('UMBAU').AV, 7.5);

  /*
   * Kleinauftrag und Zubehoer: eigene, kuerzere Folge laut Haekchenliste
   * der Abteilung. Entgraten steckt im Saegen, Schweissen ist eine
   * Position. Die Zeiten liegen nicht vor und stehen auf 0 - erfunden
   * wird nichts.
   */
  assert.deepEqual(T.ZUBEHOER.steps.map((s) => s.opId),
    ['AV', 'SAEGEN', 'BIEGEN', 'ORBITAL_KEHLNAHT', 'ORBITAL_STUMPFNAHT', 'HANDSCHWEISSEN',
      'BEIZEN', 'MOLCHEN', 'VORMONTAGE', 'HYDRO', 'ENDKONTROLLE']);
  assert.equal(T.ZUBEHOER.steps.reduce((a, s) => a + s.hours, 0), 0);
  assert.equal(T.ZUBEHOER.validated, false);
});

test('Arbeitsplan: Ersatzvorlage bei fehlender Variante', () => {
  const r = resolveRouting(createProject({ projectType: 'NEUBAU', variant: null }), T, C);
  assert.equal(r.usedFallbackTemplate, true);
  assert.ok(r.totalManHours > 0);
});

test('Arbeitsplan: Gesamtstunden-Übersteuerung skaliert alle Arbeitsgänge', () => {
  const r = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT40', totalHoursOverride: 260 }), T, C);
  assert.equal(Math.round(r.totalManHours), 260);
  // Verhältnisse bleiben erhalten
  const base = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT40' }), T, C);
  const ratioBase = base.ops.find((o) => o.opId === 'HEFTEN').totalUnits / base.totalManHours;
  const ratioNew = r.ops.find((o) => o.opId === 'HEFTEN').totalUnits / r.totalManHours;
  assert.ok(Math.abs(ratioBase - ratioNew) < 0.001);
});

test('Fortschritt Variante A: Gesamtfortschritt in Prozent (§41)', () => {
  const p = createProject({ projectType: 'NEUBAU', variant: 'FT40', progressMode: 'PERCENT', progressPercent: 45 });
  const full = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT40' }), T, C);
  const r = resolveRouting(p, T, C);
  assert.ok(Math.abs(r.remainingManHours - full.totalManHours * 0.55) < 0.5);
  // Die ersten Arbeitsgänge gelten als erledigt
  assert.equal(r.ops.find((o) => o.opId === 'SAEGEN').remainingUnits, 0);
  assert.ok(r.ops.find((o) => o.opId === 'ENDKONTROLLE').remainingUnits > 0);
});

test('Fortschritt Variante B: Reststunden je Arbeitsgang sind führend (§41)', () => {
  const p = createProject({
    projectType: 'NEUBAU', variant: 'FT40', progressMode: 'PER_OPERATION',
    progressPercent: 90,
    operations: [
      { opId: 'SAEGEN', status: 'FERTIG' },
      { opId: 'BIEGEN', status: 'FERTIG' },
      { opId: 'HEFTEN', remainingHours: 12 },
      { opId: 'ORBITAL_KEHLNAHT', remainingHours: 65 },
    ],
  });
  const r = resolveRouting(p, T, C);
  assert.equal(r.ops.find((o) => o.opId === 'SAEGEN').remainingUnits, 0);
  assert.equal(r.ops.find((o) => o.opId === 'HEFTEN').remainingUnits, 12);
  assert.equal(r.ops.find((o) => o.opId === 'ORBITAL_KEHLNAHT').remainingUnits, 65);
  // Der Prozentwert wird ignoriert, wenn Reststunden gepflegt sind
  assert.ok(r.remainingManHours > 100);
});

test('Status "x" erzeugt keinen Aufwand (§42)', () => {
  const p = createProject({
    projectType: 'NEUBAU', variant: 'FT40',
    operations: [{ opId: 'BEIZEN', status: 'X' }],
  });
  const r = resolveRouting(p, T, C);
  const beizen = r.ops.find((o) => o.opId === 'BEIZEN');
  assert.equal(beizen.totalUnits, 0);
  assert.equal(beizen.remainingUnits, 0);
});

test('Status "Fertig" wird nicht erneut eingeplant (§42)', () => {
  const p = createProject({
    projectType: 'NEUBAU', variant: 'FT40',
    operations: [{ opId: 'SAEGEN', status: 'FERTIG' }],
  });
  const r = resolveRouting(p, T, C);
  const s = r.ops.find((o) => o.opId === 'SAEGEN');
  assert.equal(s.remainingUnits, 0);
  assert.ok(s.totalUnits > 0);
  assert.equal(s.doneUnits, s.totalUnits);
});

test('Reststunden größer als Sollstunden erhöhen den Gesamtaufwand', () => {
  const p = createProject({
    projectType: 'NEUBAU', variant: 'FT40', progressMode: 'PER_OPERATION',
    operations: [{ opId: 'HEFTEN', remainingHours: 500 }],
  });
  const r = resolveRouting(p, T, C);
  assert.equal(r.ops.find((o) => o.opId === 'HEFTEN').totalUnits, 500);
});

test('Arbeitsfolge ist ein Abhängigkeitsnetz (topologische Sortierung, §11)', () => {
  const r = resolveRouting(createProject({ projectType: 'WKP' }), T, C);
  const order = topoSort(r.ops).map((o) => o.opId);
  assert.deepEqual(order, ['AV', 'SAEGEN', 'ENTGRATEN', 'BIEGEN', 'HEFTEN',
    'ORBITAL_KEHLNAHT', 'ORBITAL_STUMPFNAHT', 'HANDSCHWEISSEN',
    'BEIZEN', 'MOLCHEN', 'VORMONTAGE', 'HYDRO', 'ENDKONTROLLE', 'REINIGEN']);
  assert.deepEqual(terminalOps(r.ops).map((o) => o.opId), ['REINIGEN']);
});

test('Orbitalschweißen wird in Mannstunden geführt (§54)', () => {
  const r = resolveRouting(createProject({ projectType: 'NEUBAU', variant: 'FT40' }), T, C);
  const orb = r.ops.find((o) => o.opId === 'ORBITAL_KEHLNAHT');
  // 30,08 h (ein Drittel von 90,25 h) sind summierte Personenstunden; die
  // Maschinenbelegung ergibt sich daraus ueber "Maschinen je Schweisser".
  assert.equal(orb.manHourFactor, 1);
  assert.equal(orb.totalUnits, 30.08);
  const heft = r.ops.find((o) => o.opId === 'HEFTEN');
  assert.equal(heft.manHourFactor, 1);
});

test('Projektspezifische Arbeitsgangstunden übersteuern die Vorlage', () => {
  const p = createProject({ projectType: 'NEUBAU', variant: 'FT40', operations: [{ opId: 'HEFTEN', plannedHours: 200 }] });
  const r = resolveRouting(p, T, C);
  assert.equal(r.ops.find((o) => o.opId === 'HEFTEN').totalUnits, 200);
});
