const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, createProject } = engine;

function mkPerson(id, skills, factor = 1) {
  return { id, label: id, role: '', kind: 'STAMM', factor, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}
const planningDate = '2026-09-21'; // Montag
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
    { opId: 'AV', hours: 7, maxWorkers: 1 },
    { opId: 'SAEGEN', hours: 7, maxWorkers: 1, predecessors: [{ opId: 'AV', type: 'FS' }] },
  ] },
};
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1' });
const result = runSchedule({ config, projects: [project], templates });
for (const d of result.daySeries.slice(0, 3)) {
  console.log(d.date, 'AV:', d.byOp.AV?.usedManHours, 'SAEGEN:', d.byOp.SAEGEN?.usedManHours);
}
const av21 = result.daySeries.find(d=>d.date==='2026-09-21').byOp.AV.usedManHours;
const saegen21 = result.daySeries.find(d=>d.date==='2026-09-21').byOp.SAEGEN.usedManHours;
console.log('Beide 7h am 21.09.?', av21, saegen21, '(erwartet: SAEGEN am 21.09. = 0, erst am 22.09.)');
if (saegen21 > 0.01) {
  console.error('T04/Hoch04: BUG BESTAETIGT - beide Arbeitsgaenge am selben Tag fertig');
  process.exit(2);
}
console.log('T04 PASSED (bereits korrekt)');
