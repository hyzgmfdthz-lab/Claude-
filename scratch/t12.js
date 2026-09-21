// T12 - Tagesfilter: nur 21.09.2026 auswaehlen darf keine Wochen-/Horizontsummen liefern.
const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const ds = engine.seedDataset();
const einTag = engine.analyze(ds, ds.activeScenarioId, { from: '2026-09-21', to: '2026-09-21' });
console.log('orbital.days:', einTag.kpis.orbital.days, '(erwartet <= 1)');
console.log('orbital.capacity:', einTag.kpis.orbital.capacity, 'used:', einTag.kpis.orbital.used);
console.log('heft.days:', einTag.kpis.heft.days, '(erwartet <= 1)');
if (einTag.kpis.orbital.days > 1 || einTag.kpis.heft.days > 1) {
  console.error('T12 FAILED: Ein-Tages-Auswahl zaehlt mehrere Tage');
  process.exit(1);
}
console.log('T12 PASSED');
