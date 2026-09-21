const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { dashboardKpis } = engine;

const project = {
  status: 'VERSPAETET', // LATE (buildProjectResult stellt das fuer nicht fertigstellbare Auftraege so ein)
  dueDate: '2026-10-01',
  originalDueDate: '2026-10-01',
  forecastFinish: null, // nicht fertigstellbar
  lateDays: 30,
  remainingManHours: 10,
};

const result = {
  projects: [project],
  daySeries: [],
  blocked: [],
  config: { targets: { otd: 95 }, productivity: { global: 1 }, workTime: { regularHoursPerWeek: 37.5 }, planningDate: '2026-09-10' },
};

const k = dashboardKpis(result, {}, {});
console.log('otd:', k.otd, '(erwartet 0)');
console.log('otdOriginal:', k.otdOriginal, '(erwartet 0, vorher fehlerhaft 100)');
console.log('zielErreicht:', k.zielErreicht, '(erwartet false)');
if (k.otd !== 0 || k.otdOriginal !== 0 || k.zielErreicht !== false) {
  console.error('T01 FAILED');
  process.exit(1);
}
console.log('T01 PASSED');
