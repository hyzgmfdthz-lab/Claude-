// T13 - Kosten auf Rechnungszeit: zwei Leihkraefte, 12 volle Wochen,
// 37,5 bezahlte Stunden/Woche, 55 EUR/h, keine Mehrarbeit -> 900 h, 49.500 EUR.
const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { abrechnungsStunden } = engine;

const wochen = [];
let d = new Date('2026-09-14T00:00:00Z'); // Montag
for (let i = 0; i < 12; i++) {
  wochen.push({ weekKey: 'W' + i, von: d.toISOString().slice(0, 10) });
  d.setUTCDate(d.getUTCDate() + 7);
}
const config = { workTime: { regularHoursPerWeek: 37.5 } };
const stunden = abrechnungsStunden(config, wochen, '2026-09-14', 2);
const rate = 55; // config.costs.tempRate Standardwert
const kosten = Math.round(stunden * rate * 100) / 100;
console.log('Rechnungsstunden:', stunden, '(erwartet 900)');
console.log('Kosten:', kosten, '(erwartet 49500)');
if (stunden !== 900 || kosten !== 49500) {
  console.error('T13 FAILED');
  process.exit(1);
}
console.log('T13 PASSED');
