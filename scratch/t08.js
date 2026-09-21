// T08/WIP-Ausnahme: "hoechstens 1 Auftrag gleichzeitig" + "hoechstens 1 MA je Auftrag"
// duerfen echten Leerlauf nicht erzwingen, wenn noch Personal frei waere.
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
  projectLimits: { maxParallelProjects: 1, maxWorkersPerProject: 1 },
  saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 40 }] } };
const p1 = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1', orderNo: 'P1' });
const p2 = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P2', orderNo: 'P2' });

const result = runSchedule({ config, projects: [p1, p2], templates });
const day1 = result.daySeries.find((d) => d.date === planningDate);
console.log('Tag 1 SAEGEN usedManHours:', day1.byOp.SAEGEN.usedManHours, '(erwartet 14 = 2 Personen x 7h, trotz max. 1 Auftrag/1 MA)');
console.log('poolCapacity:', day1.poolCapacity, 'poolUsed:', day1.poolUsed);
console.log('wipAusnahmen:', JSON.stringify(day1.wipAusnahmen));

if (day1.byOp.SAEGEN.usedManHours < 13.9) {
  console.error('T08 FAILED: WIP-Grenze erzwingt Leerlauf trotz freier, qualifizierter Person');
  process.exit(1);
}
if (!day1.wipAusnahmen || day1.wipAusnahmen.length === 0) {
  console.error('T08 FAILED: Ausnahme wurde genutzt, aber nicht sichtbar vermerkt');
  process.exit(1);
}
console.log('T08 PASSED');
