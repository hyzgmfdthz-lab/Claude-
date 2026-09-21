// Reproduktion des Schicht-Mismatch: HEFTEN laeuft 2-schichtig (je 1 Platz),
// aber nicht genug qualifizierte Personen sind in Schicht 2 eingeteilt.
const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, assignPeople, createProject } = engine;

function mkPerson(id, skills, opts = {}) {
  return { id, label: id, role: '', kind: 'STAMM', factor: 1, rate: null,
    shiftCapable: opts.shiftCapable !== false,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '' };
}
const planningDate = '2026-09-21';
const config = {
  planningDate, horizonDays: 30,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: { team: { source: 'MANNSCHAFT', enforceSkills: true, people: [
    mkPerson('A', { HEFTEN: true }),
    mkPerson('B', { HEFTEN: true }),
    mkPerson('C', { HEFTEN: true }),
    mkPerson('D', { HEFTEN: true }),
  ] } },
  resources: {
    heftPlaces: 2, heftPlacesMax: 3,
    operatingHoursPerDay: 14,
    byOperation: { HEFTEN: { schichtBesetzung: [1, 1] } },
  },
  saturday: {}, tacking: {}, leadTimes: {},
};
const templates = { NEUBAU: { key: 'NEUBAU', steps: [{ opId: 'HEFTEN', hours: 400 }] } };
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', earliestStart: planningDate, materialAvailableFrom: planningDate, priority: 'P1' });
const result = runSchedule({ config, projects: [project], templates });
const plan = assignPeople(result, config, {});
console.log('unassignedHours:', plan.unassignedHours);
console.log('lueckenJeGrund:', JSON.stringify(plan.lueckenJeGrund));
if (plan.luecken.length > 0) {
  console.log('Beispiel-Luecke:', JSON.stringify(plan.luecken[0], null, 2));
}
