const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, createProject } = engine;

function mkPerson(id, skills, factor = 1) {
  return { id, label: id, role: '', kind: 'STAMM', factor, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}
const planningDate = '2026-09-21';
const people = [];
for (let i = 1; i <= 6; i++) people.push(mkPerson('W' + i, { ORBITAL: true }));
const config = {
  planningDate, horizonDays: 10,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people } },
  resources: {
    orbitalMachines: 6, orbitalMachinesActive: 6, machinesPerWelder: 2,
    operatingHoursPerDay: 14,
    byOperation: { ORBITAL: { schichtBesetzung: [3, 3] } },
  },
  saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'ORBITAL', hours: 200 }] } };
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1' });
const result = runSchedule({ config, projects: [project], templates });
const day1 = result.daySeries.find((d) => d.date === planningDate);
console.log('ORBITAL Tag1 usedManHours:', day1.byOp.ORBITAL.usedManHours, '(erwartet 42)');
console.log('ORBITAL Tag1 capManHours:', day1.byOp.ORBITAL.capManHours);
if (Math.abs(day1.byOp.ORBITAL.usedManHours - 42) > 0.5) {
  console.error('T03 FAILED');
  process.exit(1);
}
console.log('T03 PASSED');
