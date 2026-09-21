const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { runSchedule, createProject, round2 } = engine;

function mkPerson(id, skills, factor = 1) {
  return {
    id, label: id, role: '', kind: 'STAMM', factor, rate: null, shiftCapable: true,
    skills, absences: [], weeks: {}, pinnedOps: {}, startDate: null, endDate: null,
    defaultActive: true, active: true, note: '',
  };
}

const planningDate = '2026-09-21';
const config = {
  planningDate,
  horizonDays: 60,
  workTime: { regularHoursPerWeek: 35, workDays: [1, 2, 3, 4, 5], saturdayHours: 6 },
  productivity: { global: 1 },
  workforce: {
    team: {
      source: 'MANNSCHAFT',
      enforceSkills: true,
      people: [
        mkPerson('A', { SAEGEN: true, BIEGEN: true }),
        mkPerson('B', { AV: true }), // nicht fuer Saegen/Biegen qualifiziert
      ],
    },
  },
  resources: {},
  saturday: {},
  tacking: {},
  leadTimes: {},
};

const templates = {
  NEUBAU: {
    key: 'NEUBAU',
    steps: [
      { opId: 'SAEGEN', hours: 20 },
      { opId: 'BIEGEN', hours: 20 },
    ],
  },
};

const project = createProject({
  projectType: 'NEUBAU',
  dueDate: '2026-12-01',
  earliestStart: planningDate,
  materialAvailableFrom: planningDate,
  priority: 'P1',
});

const result = runSchedule({ config, projects: [project], templates });

// Tag mit der hoechsten gemeinsamen Belegung von SAEGEN+BIEGEN suchen
let maxCombined = 0;
let worstDay = null;
for (const d of result.daySeries) {
  const s = d.byOp.SAEGEN?.usedManHours ?? 0;
  const b = d.byOp.BIEGEN?.usedManHours ?? 0;
  if (s + b > maxCombined) { maxCombined = s + b; worstDay = d.date; }
}
console.log('groesste gemeinsame Tagesbelegung SAEGEN+BIEGEN:', round2(maxCombined), 'am', worstDay, '(erwartet <= 7)');
if (maxCombined > 7.01) {
  console.error('T02 FAILED: mehr als 7 Personalstunden/Tag fuer eine Person verplant');
  process.exit(1);
}
console.log('T02 PASSED');
