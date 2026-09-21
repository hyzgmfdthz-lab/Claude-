// Gegenprobe: WIP-Grenze bleibt hart, wenn kein Poolrest uebrig ist (kein "erfundenes" Oeffnen).
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
  planningDate, horizonDays: 20,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [
    mkPerson('A', { SAEGEN: true }), mkPerson('B', { SAEGEN: true }),
  ] } },
  resources: {},
  // maxWorkersPerProject=2: P1 kann die volle Mannschaft (beide) allein binden.
  projectLimits: { maxParallelProjects: 1, maxWorkersPerProject: 2 },
  saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 40 }] } };
const p1 = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1', orderNo: 'P1' });
const p2 = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P2', orderNo: 'P2' });

const result = runSchedule({ config, projects: [p1, p2], templates });
const day1 = result.daySeries.find((d) => d.date === planningDate);
console.log('SAEGEN usedManHours:', day1.byOp.SAEGEN.usedManHours, '(erwartet 14 - P1 bindet mit maxWorkersPerProject=2 beide Personen)');
console.log('poolCapacity:', day1.poolCapacity, 'poolUsed:', day1.poolUsed);
console.log('wipAusnahmen:', JSON.stringify(day1.wipAusnahmen), '(erwartet: keine, da kein Poolrest fuer P2 uebrig war)');
if (Math.abs(day1.poolCapacity - day1.poolUsed) > 0.01) {
  console.error('FAILED: Pool nicht voll ausgelastet - Testaufbau prueft nicht den gewuenschten Fall');
  process.exit(2);
}
if (day1.wipAusnahmen) {
  console.error('FAILED: Ausnahme wurde vermerkt, obwohl kein Poolrest da war');
  process.exit(1);
}
console.log('Gegenprobe PASSED');
