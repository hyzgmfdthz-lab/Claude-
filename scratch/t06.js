const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, assignPeople, createProject } = engine;

function mkPerson(id, skills, factor = 1) {
  return { id, label: id, role: '', kind: 'STAMM', factor, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}

const planningDate = '2026-09-21'; // Montag
const config = {
  planningDate, horizonDays: 10,
  workTime: { regularHoursPerWeek: 37.5, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 7 / 7.5 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [
    mkPerson('A', { SAEGEN: true }), mkPerson('B', { SAEGEN: true }),
  ] } },
  resources: { byOperation: { SAEGEN: { places: 2 } } },
  saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 14 }] } };
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1' });

const result = runSchedule({ config, projects: [project], templates });
const day1 = result.daySeries.find((d) => d.date === planningDate);
console.log('Tag 1 SAEGEN usedManHours:', day1.byOp.SAEGEN.usedManHours, '(erwartet 14, 2x7)');

const plan = assignPeople(result, config, {});
const tag1 = plan.days.find((d) => d.date === planningDate);
const stundenJePerson = {};
for (const e of tag1.entries) stundenJePerson[e.personId] = (stundenJePerson[e.personId] || 0) + e.hours;
console.log('Stunden je Person am Tag 1:', stundenJePerson, '(erwartet je 7, nicht 7.5/6.5)');

const ok = Object.values(stundenJePerson).every((h) => h <= 7.01);
if (!ok) { console.error('T06/Mittel09 FAILED: eine Person hat mehr als 7 h bekommen'); process.exit(1); }
console.log('T06 (Mittel09) PASSED');
