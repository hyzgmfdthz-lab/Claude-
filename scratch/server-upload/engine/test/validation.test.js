import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validationSummary, LEVELS } from '../validation.js';
import { defaultConfig, defaultRoutingTemplates } from '../defaults.js';
import { createProject, deepClone } from '../model.js';
import { seedDataset } from '../seed.js';

function base(projects = [], mut = (c) => c) {
  const config = defaultConfig();
  mut(config);
  return { config, projects, templates: defaultRoutingTemplates() };
}
const codes = (issues) => issues.map((i) => i.code);

test('Validierung: fehlender Fertigstellungstermin', () => {
  const i = validate(base([createProject({ id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: null })]));
  assert.ok(codes(i).includes('TERMIN_FEHLT'));
});

test('Validierung: doppelte Projekte und doppelte Auftragsnummern', () => {
  const p = createProject({ id: 'A', orderNo: 'X-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' });
  const q = createProject({ id: 'A', orderNo: 'X-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' });
  const i = validate(base([p, q]));
  assert.ok(codes(i).includes('ID_DOPPELT'));
  assert.ok(codes(i).includes('AUFTRAG_DOPPELT'));
});

test('Validierung: fehlende Variante', () => {
  const i = validate(base([createProject({ id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: null, dueDate: '2026-10-01' })]));
  assert.ok(codes(i).includes('VARIANTE_FEHLT'));
});

test('Validierung: negative Stunden und Reststunden', () => {
  const i = validate(base([createProject({
    id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01',
    operations: [{ opId: 'HEFTEN', plannedHours: -5, remainingHours: -1 }],
  })]));
  assert.ok(codes(i).includes('STUNDEN_NEGATIV'));
  assert.ok(codes(i).includes('RESTSTUNDEN_NEGATIV'));
});

test('Validierung: Status "Fertig" mit Reststunden > 0', () => {
  const i = validate(base([createProject({
    id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01',
    operations: [{ opId: 'HEFTEN', status: 'FERTIG', remainingHours: 10 }],
  })]));
  assert.ok(codes(i).includes('FERTIG_MIT_REST'));
});

test('Validierung: widersprüchlicher Fortschritt', () => {
  const i = validate(base([createProject({
    id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01',
    progressMode: 'PERCENT', progressPercent: 150,
  })]));
  assert.ok(codes(i).includes('FORTSCHRITT_UNGUELTIG'));
});

test('Validierung: fehlende Arbeitsfolge', () => {
  const data = base([createProject({ id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })]);
  data.templates = {};
  const i = validate(data);
  assert.ok(codes(i).includes('ARBEITSFOLGE_FEHLT'));
});

test('Validierung: unmögliche Hydrotermine ohne NoBo im Zeitfenster', () => {
  const i = validate(base([], (c) => { c.nobo.weekdays = [1, 5]; }));
  assert.ok(codes(i).includes('HYDRO_UNMOEGLICH'));
  const j = validate(base([], (c) => { c.nobo.weekdays = []; c.nobo.exceptions = {}; }));
  assert.ok(codes(j).includes('NOBO_FEHLT'));
});

test('Validierung: NoBo-Tag außerhalb des Hydro-Fensters', () => {
  const i = validate(base([], (c) => { c.nobo.exceptions['2026-09-07'] = true; }));
  assert.ok(codes(i).includes('NOBO_AUSSERHALB'));
});

test('Validierung: mehr aktive Maschinen als vorhanden', () => {
  const i = validate(base([], (c) => { c.resources.orbitalMachinesActive = 8; c.resources.orbitalMachines = 6; }));
  assert.ok(codes(i).includes('MASCHINEN'));
});

test('Validierung: Heftvorsprung min > max', () => {
  const i = validate(base([], (c) => { c.tacking.minLeadHours = 20; c.tacking.maxLeadHours = 5; }));
  assert.ok(codes(i).includes('HEFTVORSPRUNG'));
});

test('Validierung: Fremdvergabe wird gemeldet (§24)', () => {
  const i = validate(base([], (c) => { c.outsourcing.enabled = true; }));
  assert.ok(codes(i).includes('FREMDVERGABE'));
});

test('Validierung: zu viele Neueinstellungen (§23)', () => {
  const i = validate(base([], (c) => {
    c.workforce.newHires = [{ id: 'H', label: 'x', count: 9, from: '2026-10-01' }];
  }));
  assert.ok(codes(i).includes('NEUEINSTELLUNGEN'));
});

test('Validierung: zu validierende Startparameter werden gemeldet (§92)', () => {
  const i = validate(base());
  const infos = i.filter((x) => x.code === 'ZU_VALIDIEREN');
  assert.ok(infos.length >= 3, 'Offene Punkte müssen als "zu validieren" gemeldet werden');
  assert.ok(infos.some((x) => /NoBo/.test(x.message)), 'NoBo-Anwesenheit');
  assert.ok(infos.some((x) => /Qualifikation/.test(x.message)), 'Qualifikationsanteile');
  assert.ok(infos.some((x) => /Variante/.test(x.message)), 'Variantendifferenzierung');
  assert.ok(infos.some((x) => /parallel/i.test(x.message)), 'WIP-Grenze');
  // Bestätigte Werte dürfen NICHT mehr gemeldet werden
  assert.equal(infos.some((x) => /Produktivität/.test(x.message)), false);
  assert.equal(infos.some((x) => /Einarbeitungskurve/.test(x.message)), false);
});

test('Validierung: sauberer Datenbestand erzeugt keine Fehler', () => {
  const config = defaultConfig();
  config.productivity.validated = true;
  config.workforce.baseHeadcountValidated = true;
  config.workforce.rampUp.validated = true;
  config.resources.welders.validated = true;
  config.nobo.validated = true;
  config.projectLimits.maxParallelProjectsValidated = true;
  config.saturday.quotaValidated = true;
  for (const s of Object.values(config.skills)) s.validated = true;
  const templates = defaultRoutingTemplates();
  for (const t of Object.values(templates)) { t.validated = true; t.note = ''; }
  templates.NEUBAU_FT20.steps[0].hours = 17; // Variantendifferenzierung vorhanden
  const projects = [createProject({ id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2027-10-01' })];
  const i = validate({ config, projects, templates });
  assert.equal(validationSummary(i).errors, 0);
  assert.equal(i.filter((x) => x.level === LEVELS.WARN).length, 0);
  assert.equal(i.length, 0, JSON.stringify(i));
});

test('Validierung: Startdatenbestand ist vollständig, offene Punkte sind gekennzeichnet', () => {
  const data = seedDataset();
  const i = validate({ config: data.scenarios[0].config, projects: data.projects, templates: data.templates });
  const s = validationSummary(i);
  assert.equal(s.errors, 0, `Der Startdatenbestand darf keine Fehler enthalten: ${JSON.stringify(i.filter((x) => x.level === 'FEHLER'))}`);
  // Die unvollständige Auftragsnummer des Wiederkehrers muss auffallen
  assert.ok(i.some((x) => x.code === 'AUFTRAG_UNVOLLSTAENDIG'), 'Platzhalter-Auftragsnummer muss gemeldet werden');
  assert.ok(s.infos >= 3);
  void deepClone;
});
