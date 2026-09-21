const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, createProject } = engine;

function mkPerson(id, skills, factor = 1) {
  return { id, label: id, role: '', kind: 'STAMM', factor, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}
const planningDate = '2026-09-21';
const config = {
  planningDate, horizonDays: 10,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [
    mkPerson('A', { AV: true, SAEGEN: true }),
    mkPerson('B', { AV: true, SAEGEN: true }),
    mkPerson('C', { AV: true, SAEGEN: true }),
  ] } },
  resources: {}, saturday: {}, tacking: {}, leadTimes: {},
};
const templates = {
  NEUBAU: { key: 'NEUBAU', steps: [
    { opId: 'AV', hours: 1, maxWorkers: 1 },
    { opId: 'SAEGEN', hours: 1, maxWorkers: 1, predecessors: [{ opId: 'AV', type: 'FS' }] },
  ] },
};
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1' });
const result = runSchedule({ config, projects: [project], templates });
const d1 = result.daySeries.find(d=>d.date==='2026-09-21');
console.log('AV:', d1.byOp.AV.usedManHours, 'SAEGEN:', d1.byOp.SAEGEN.usedManHours, '(beide erwartet 1, am selben Tag)');
if (d1.byOp.AV.usedManHours < 0.99 || d1.byOp.SAEGEN.usedManHours < 0.99) {
  console.error('T05 FAILED: kurze Vorgaenge unnoetig auf zwei Tage verteilt');
  process.exit(1);
}
console.log('T05 PASSED');
