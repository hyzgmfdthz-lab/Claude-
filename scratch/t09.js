const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, createProject } = engine;

function mkPerson(id, skills) {
  return { id, label: id, role: '', kind: 'STAMM', factor: 1, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}
const planningDate = '2026-09-21';
const config = {
  planningDate, horizonDays: 60,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [
    mkPerson('A', { SAEGEN: true }), mkPerson('B', { AV: true }),
  ] } },
  resources: {}, saturday: {}, tacking: {}, leadTimes: {},
};
// Keine op-eigene earliestStartWeeksBeforeDue - NUR die Regel (releaseWeeksBeforeDue)
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 7 }] } };
const project = createProject({
  projectType: 'NEUBAU', dueDate: '2026-12-01',
  missingParts: true, materialAvailableFrom: '2026-10-01',
  priority: 'P1',
});
// Regel der Abteilung: "Saegen darf frueh starten" - 20 Wochen vor Termin (weit vor dem 01.10.)
project.ruleOverrides = { SAEGEN: { releaseWeeksBeforeDue: 20 } };
const result = runSchedule({ config, projects: [project], templates });
const before = result.daySeries.slice(0, 6).map(d => ({date: d.date, saegen: d.byOp.SAEGEN?.usedManHours ?? 0}));
console.log(before);
const startedVorMaterial = before.some(d => d.saegen > 0);
if (startedVorMaterial) {
  console.error('Bedingt11 BUG BESTAETIGT: Saegen startet trotz gemeldeter Fehlteile vor 01.10.');
  process.exit(2);
}
console.log('T09/Bedingt11 PASSED (Fehlteilsperre haelt)');
