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
  planningDate, horizonDays: 20,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [mkPerson('A', { SAEGEN: true })] } },
  resources: {}, saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'SAEGEN', hours: 14 }] } };
// Material/Freigabe erst ab 28.09. - Personal ab 21.09. da
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: '2026-09-28', materialAvailableFrom: '2026-09-28', priority: 'P1' });

const result = runSchedule({ config, projects: [project], templates });
const plan = assignPeople(result, config, {});
const vorherigeWerktage = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
for (const d of vorherigeWerktage) {
  const tag = plan.days.find((x) => x.date === d);
  console.log(d, tag ? `im Plan, idle: ${JSON.stringify(tag.idle.map(i=>({id:i.id,grund:i.grund,stunden:i.stunden})))}` : 'FEHLT IM PLAN');
  if (!tag) { console.error('T07 FAILED: Tag fehlt im Einsatzplan'); process.exit(1); }
}
console.log('T07 (Mittel10) PASSED');
