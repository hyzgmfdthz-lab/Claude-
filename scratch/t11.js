// T11 - Vorsprungwiderspruch: 80h Heften, Orbital nach 15% (=12h), max. 10h erlaubter Vorsprung.
const { __req } = require('./engine-bundle.js');
const engine = __req('engine/index.js');
const { validate, createProject } = engine;

const config = {
  planningDate: '2026-09-21',
  tacking: { maxLeadHours: 10, enforceMaxLead: true },
};
const templates = {
  NEUBAU: { key: 'NEUBAU', steps: [
    { opId: 'HEFTEN', hours: 80 },
    { opId: 'ORBITAL', hours: 90, predecessors: [{ opId: 'HEFTEN', type: 'OVERLAP', leadPercent: 15, limitLead: true }] },
  ] },
};
const project = createProject({ projectType: 'NEUBAU', dueDate: '2026-12-01', orderNo: 'T11' });
const findings = validate({ config, projects: [project], templates });
const treffer = findings.filter((f) => f.code === 'HEFTVORSPRUNG_WIDERSPRUCH');
console.log(treffer);
if (treffer.length === 0) {
  console.error('T11 FAILED: Widerspruch (12h Mindestvorsprung > 10h Maximum) wurde nicht erkannt');
  process.exit(1);
}
console.log('T11 PASSED');
