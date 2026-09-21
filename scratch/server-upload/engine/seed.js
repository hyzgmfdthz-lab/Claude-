/**
 * Startdatenbestand (IST-Daten der bisherigen Planung).
 *
 * Quelle: Arbeitsmappe "Produktionsplanung Arbeitsplaetze", Planstand 09.09.2026
 * (Blatt "Daten" und "Gantt Projekte"), ergaenzt um die im Lastenheft
 * festgehaltenen Regeln. Die dort gefuehrte Auftragsliste ist die aktuellere
 * Quelle und ersetzt die aelteren Termine aus dem Lastenheft.
 *
 * Werte, die weder in der Quelldatei noch im Lastenheft belegt sind, bleiben
 * leer und werden von der Datenvalidierung gemeldet - sie werden NICHT erfunden.
 */

import { createProject, deepClone, OP_STATUS } from './model.js';
import { defaultConfig, defaultRoutingTemplates, defaultWorkplaces, defaultWeekly } from './defaults.js';
import { defaultDailyAvailable } from './verfuegbarkeit.js';

/**
 * Auftraege des Armaturenbaus (37 Auftraege, Planstand 09.09.2026).
 * @returns {any[]}
 */
export function seedProjects() {
  const P = (o) => createProject(o);
  return avErledigt([

    P({ id: 'PRJ-WGC40S00158', orderNo: 'WGC40-S00158', customer: "Infraserv", name: "Infraserv WGC40-S00158", projectType: 'WKP', variant: 'FT40', dueDate: '2026-10-18', handoverDate: '2026-09-10', priority: 'P3', sequence: 10, totalHoursOverride: 70.5 }),  // P01
    P({ id: 'PRJ-WGC40S00355', orderNo: 'WGC40-S00355', customer: "Lhyfe", name: "Lhyfe WGC40-S00355", projectType: 'UMBAU', variant: 'FT40', dueDate: '2026-09-11', handoverDate: '2026-09-12', priority: 'P3', sequence: 20, totalHoursOverride: 106.5 }),  // P02
    P({ id: 'PRJ-WGC40S00132', orderNo: 'WGC40-S00132', customer: "WAG", name: "WAG WGC40-S00132", projectType: 'WKP', variant: 'FT40', dueDate: '2026-11-02', handoverDate: '2026-09-21', priority: 'P3', sequence: 30, totalHoursOverride: 197.5 }),  // P03
    P({ id: 'PRJ-WGC40S00350', orderNo: 'WGC40-S00350', customer: "Linde BLX", name: "Linde BLX WGC40-S00350", projectType: 'UMBAU', variant: 'FT40', dueDate: '2026-09-25', handoverDate: '2026-10-08', priority: 'P3', sequence: 40, totalHoursOverride: 106.5 }),  // P04
    P({ id: 'PRJ-WGC20S00188', orderNo: 'WGC20-S00188', customer: "PAK PCE ISO", name: "PAK PCE ISO WGC20-S00188", projectType: 'WKP', variant: 'FT20', dueDate: '2026-12-10', handoverDate: '2026-09-21', priority: 'P3', sequence: 50, totalHoursOverride: 70.5 }),  // P05
    P({ id: 'PRJ-WGC30S00045', orderNo: 'WGC30-S00045', customer: "Lhyfe", name: "Lhyfe WGC30-S00045", projectType: 'UMBAU', variant: 'FT30', dueDate: '2026-10-01', handoverDate: '2026-09-23', priority: 'P3', sequence: 60, totalHoursOverride: 106.5 }),  // P06
    P({ id: 'PRJ-WGC20S00148', orderNo: 'WGC20-S00148', customer: "Lhyfe", name: "Lhyfe WGC20-S00148", projectType: 'UMBAU', variant: 'FT20', dueDate: '2026-10-01', handoverDate: '2026-09-24', priority: 'P3', sequence: 70, totalHoursOverride: 106.5 }),  // P07
    P({ id: 'PRJ-WGC40S00440', orderNo: 'WGC40-S00440', customer: "Koncar", name: "Koncar WGC40-S00440", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-28', handoverDate: '2026-10-06', priority: 'P3', sequence: 80, totalHoursOverride: 246.01 }),  // P08
    P({ id: 'PRJ-WGC40S00352', orderNo: 'WGC40-S00352', customer: "Linde BLX", name: "Linde BLX WGC40-S00352", projectType: 'UMBAU', variant: 'FT40', dueDate: '2026-10-23', handoverDate: '2026-10-06', priority: 'P3', sequence: 90, totalHoursOverride: 106.5 }),  // P09
    P({ id: 'PRJ-WGC40S00133', orderNo: 'WGC40-S00133', customer: "WAG", name: "WAG WGC40-S00133", projectType: 'WKP', variant: 'FT40', dueDate: '2027-01-06', handoverDate: '2026-10-14', priority: 'P3', sequence: 100, totalHoursOverride: 249.5 }),  // P10
    P({ id: 'PRJ-WGC40S00446', orderNo: 'WGC40-S00446', customer: "Messer DE", name: "Messer DE WGC40-S00446", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-05', handoverDate: '2026-10-16', priority: 'P3', sequence: 110, totalHoursOverride: 246.01 }),  // P11
    P({ id: 'PRJ-WGC40S00447', orderNo: 'WGC40-S00447', customer: "Messer SLO", name: "Messer SLO WGC40-S00447", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-05', handoverDate: '2026-10-20', priority: 'P3', sequence: 120, totalHoursOverride: 246.01 }),  // P12
    P({ id: 'PRJ-WGC40S00445', orderNo: 'WGC40-S00445', customer: "Messer DE", name: "Messer DE WGC40-S00445", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-05', handoverDate: '2026-10-23', priority: 'P3', sequence: 130, totalHoursOverride: 246.01 }),  // P13
    P({ id: 'PRJ-WGC30S00040', orderNo: 'WGC30-S00040', customer: "Lhyfe", name: "Lhyfe WGC30-S00040", projectType: 'UMBAU', variant: 'FT30', dueDate: '2026-10-22', handoverDate: '2026-10-24', priority: 'P3', sequence: 140, totalHoursOverride: 106.5 }),  // P14
    P({ id: 'PRJ-WGC20S00160', orderNo: 'WGC20-S00160', customer: "Lhyfe", name: "Lhyfe WGC20-S00160", projectType: 'UMBAU', variant: 'FT20', dueDate: '2026-10-22', handoverDate: '2026-10-26', priority: 'P3', sequence: 150, totalHoursOverride: 106.5 }),  // P15
    P({ id: 'PRJ-WGC40S00453', orderNo: 'WGC40-S00453', customer: "Orlen P1", name: "Orlen P1 WGC40-S00453", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-19', handoverDate: '2026-11-02', priority: 'P3', sequence: 160, totalHoursOverride: 246.01 }),  // P16
    P({ id: 'PRJ-WGC40S00448', orderNo: 'WGC40-S00448', customer: "Orlen P1", name: "Orlen P1 WGC40-S00448", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-19', handoverDate: '2026-11-04', priority: 'P3', sequence: 170, totalHoursOverride: 246.01 }),  // P17
    P({ id: 'PRJ-WGC30S00067', orderNo: 'WGC30-S00067', customer: "Messer FR", name: "Messer FR WGC30-S00067", projectType: 'NEUBAU', variant: 'FT30', dueDate: '2026-10-19', handoverDate: '2026-11-09', priority: 'P3', sequence: 180, totalHoursOverride: 246.01 }),  // P18
    P({ id: 'PRJ-WGC30S00066', orderNo: 'WGC30-S00066', customer: "Messer FR", name: "Messer FR WGC30-S00066", projectType: 'NEUBAU', variant: 'FT30', dueDate: '2026-10-19', handoverDate: '2026-11-11', priority: 'P3', sequence: 190, totalHoursOverride: 246.01 }),  // P19
    P({ id: 'PRJ-WGC40S00449', orderNo: 'WGC40-S00449', customer: "Orlen P1", name: "Orlen P1 WGC40-S00449", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-26', handoverDate: '2026-11-13', priority: 'P3', sequence: 200, totalHoursOverride: 246.01 }),  // P20
    P({ id: 'PRJ-WGC40S00454', orderNo: 'WGC40-S00454', customer: "Orlen P1", name: "Orlen P1 WGC40-S00454", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-26', handoverDate: '2026-11-18', priority: 'P3', sequence: 210, totalHoursOverride: 246.01 }),  // P21
    P({ id: 'PRJ-WGC30S00023', orderNo: 'WGC30-S00023', customer: "Lhyfe", name: "Lhyfe WGC30-S00023", projectType: 'UMBAU', variant: 'FT30', dueDate: '2026-11-12', handoverDate: '2026-11-18', priority: 'P3', sequence: 220, totalHoursOverride: 106.5 }),  // P22
    P({ id: 'PRJ-WGC40S00', orderNo: 'WGC40-S00%%%', customer: "Infraserv", name: "Infraserv WGC40-S00%%%", projectType: 'WKP', variant: 'FT40', dueDate: '2027-02-01', handoverDate: '2026-10-18', priority: 'P3', sequence: 230, operations: [{ opId: 'SAEGEN', status: 'X' }, { opId: 'ENTGRATEN', status: 'X' }, { opId: 'BIEGEN', status: 'X' }, { opId: 'HEFTEN', status: 'X' }, { opId: 'ORBITAL', plannedHours: 30 }, { opId: 'BEIZEN', plannedHours: 4 }, { opId: 'VORMONTAGE', status: 'X' }, { opId: 'HYDRO', plannedHours: 17 }, { opId: 'ENDKONTROLLE', plannedHours: 12 }, { opId: 'REINIGEN', plannedHours: 7.5 }], totalHoursOverride: null }),  // P23
    P({ id: 'PRJ-WGC20S00156', orderNo: 'WGC20-S00156', customer: "Lhyfe", name: "Lhyfe WGC20-S00156", projectType: 'UMBAU', variant: 'FT20', dueDate: '2026-11-12', handoverDate: '2026-11-18', priority: 'P3', sequence: 240, totalHoursOverride: 106.5 }),  // P24
    P({ id: 'PRJ-WGC40S00441', orderNo: 'WGC40-S00441', customer: "SWF", name: "SWF WGC40-S00441", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-16', handoverDate: '2026-11-27', priority: 'P3', sequence: 250, totalHoursOverride: 260 }),  // P25
    P({ id: 'PRJ-WGC40S00455', orderNo: 'WGC40-S00455', customer: "Orlen P1", name: "Orlen P1 WGC40-S00455", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-09', handoverDate: '2026-11-30', priority: 'P3', sequence: 260, totalHoursOverride: 246.01 }),  // P26
    P({ id: 'PRJ-WGC40S00450', orderNo: 'WGC40-S00450', customer: "Orlen P1", name: "Orlen P1 WGC40-S00450", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-09', handoverDate: '2026-12-03', priority: 'P3', sequence: 270, totalHoursOverride: 246.01 }),  // P27
    P({ id: 'PRJ-WGC20S00097', orderNo: 'WGC20-S00097', customer: "Orlen TC", name: "Orlen TC WGC20-S00097", projectType: 'PRUEFER', variant: 'FT20', dueDate: '2026-11-11', handoverDate: '2026-12-03', priority: 'P3', sequence: 280, totalHoursOverride: 106.5 }),  // P28
    P({ id: 'PRJ-WGC40S00456', orderNo: 'WGC40-S00456', customer: "Orlen P1", name: "Orlen P1 WGC40-S00456", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-16', handoverDate: '2026-12-10', priority: 'P3', sequence: 290, totalHoursOverride: 246.01 }),  // P29
    P({ id: 'PRJ-WGC40S00451', orderNo: 'WGC40-S00451', customer: "Orlen P1", name: "Orlen P1 WGC40-S00451", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-16', handoverDate: '2026-12-14', priority: 'P3', sequence: 300, totalHoursOverride: 246.01 }),  // P30
    P({ id: 'PRJ-WGC30S00029', orderNo: 'WGC30-S00029', customer: "Lhyfe", name: "Lhyfe WGC30-S00029", projectType: 'UMBAU', variant: 'FT30', dueDate: '2026-12-03', handoverDate: '2026-12-14', priority: 'P3', sequence: 310, totalHoursOverride: 106.5 }),  // P31
    P({ id: 'PRJ-WGC40S00457', orderNo: 'WGC40-S00457', customer: "Orlen P1", name: "Orlen P1 WGC40-S00457", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-27', handoverDate: '2026-12-21', priority: 'P3', sequence: 320, totalHoursOverride: 246.01 }),  // P32
    P({ id: 'PRJ-WGC40S00452', orderNo: 'WGC40-S00452', customer: "Orlen P1", name: "Orlen P1 WGC40-S00452", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-27', handoverDate: '2026-12-23', priority: 'P3', sequence: 330, totalHoursOverride: 246.01 }),  // P33
    P({ id: 'PRJ-WGC20S00163', orderNo: 'WGC20-S00163', customer: "Lhyfe", name: "Lhyfe WGC20-S00163", projectType: 'UMBAU', variant: 'FT20', dueDate: '2026-12-03', handoverDate: '2026-12-23', priority: 'P3', sequence: 340, totalHoursOverride: 106.5 }),  // P34
    P({ id: 'PRJ-WGC40S00459', orderNo: 'WGC40-S00459', customer: "Orlen Warsaw", name: "Orlen Warsaw WGC40-S00459", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-07', handoverDate: '2026-12-30', priority: 'P3', sequence: 350, totalHoursOverride: 246.01 }),  // P35
    P({ id: 'PRJ-WGC40S00458', orderNo: 'WGC40-S00458', customer: "Orlen Warsaw", name: "Orlen Warsaw WGC40-S00458", projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-14', handoverDate: '2027-01-01', priority: 'P3', sequence: 360, totalHoursOverride: 246.01 }),  // P36
    P({ id: 'PRJ-WGC30S00042', orderNo: 'WGC30-S00042', customer: "Lhyfe", name: "Lhyfe WGC30-S00042", projectType: 'UMBAU', variant: 'FT30', dueDate: '2026-12-15', handoverDate: '2027-01-04', priority: 'P3', sequence: 370, totalHoursOverride: 106.5 }),  // P37
  ]);
}

/**
 * Stichtag der bereits erledigten Arbeitsvorbereitung.
 *
 * Aussage der Abteilung (Stand 09/2026): "Wir haben alle Auftraege bis Ende
 * 2026 schon vorbereitet." Die Arbeitsvorbereitung ist damit fuer jeden
 * Auftrag mit Fertigstellung bis zu diesem Datum erledigt - die Stunden
 * zaehlen weiter zum Arbeitsinhalt, sie sind aber nicht mehr offen.
 * Auftraege mit spaeterer Fertigstellung bleiben offen.
 */
export const AV_ERLEDIGT_BIS = '2026-12-31';

/**
 * Setzt die Arbeitsvorbereitung fuer alle Auftraege mit Fertigstellung bis
 * AV_ERLEDIGT_BIS auf "fertig".
 * @param {any[]} projects
 * @returns {any[]}
 */
function avErledigt(projects) {
  for (const p of projects) {
    if (!p.dueDate || p.dueDate > AV_ERLEDIGT_BIS) continue;
    const ops = p.operations ?? (p.operations = []);
    const vorhanden = ops.find((/** @type {any} */ o) => o.opId === 'AV');
    if (vorhanden) { if (!vorhanden.status) vorhanden.status = OP_STATUS.DONE; continue; }
    ops.unshift({ opId: 'AV', status: OP_STATUS.DONE });
  }
  return projects;
}

/* ------------------------------------------------------------------ *
 * Szenarien der bisherigen Planung
 * ------------------------------------------------------------------ */

/** Kalenderwochen mit Samstagsarbeit laut bisheriger Planung (ohne KW40 wegen 03.10.). */
const SATURDAY_WEEKS = ['2026-W37', '2026-W38', '2026-W39', '2026-W41', '2026-W42',
  '2026-W43', '2026-W44', '2026-W45', '2026-W46', '2026-W47'];

function saturdayWeeks(quota) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const w of SATURDAY_WEEKS) out[w] = { enabled: true, quotaOverride: quota, headcountOverride: null };
  return out;
}

/**
 * Szenario "versetzte Besetzung + Samstagsarbeit" (S2 der bisherigen Planung).
 * @param {any} base
 */
function scenarioS2(base) {
  const c = deepClone(base);
  c.resources.operatingHoursPerDay = 12;
  c.resources.welders.default = 5;
  c.saturday.quota = 0.8;
  c.saturday.weeks = saturdayWeeks(0.8);
  return c;
}

/**
 * Szenario "Engpasspaket" (S3 der bisherigen Planung):
 * 14-Stunden-Fenster, 3. Heftplatz, Samstagsarbeit, je Stamm-Mitarbeiter eine
 * produktive Mehrstunde pro Tag bis KW43, Freigabe vier Wochen vorher.
 * @param {any} base
 */
function scenarioS3(base) {
  const c = scenarioS2(base);
  c.resources.operatingHoursPerDay = 14;
  c.resources.heftPlaces = 3;
  c.leadTimes.startWeeks = { ...c.leadTimes.startWeeks, NEUBAU: 4 };
  for (const w of ['2026-W37', '2026-W38', '2026-W39', '2026-W40', '2026-W41', '2026-W42', '2026-W43']) {
    c.workforce.weekly[w] = { ...(c.workforce.weekly[w] ?? {}), overtimePerEmployee: 5 };
  }
  return c;
}

/**
 * Vollstaendiger Startdatensatz.
 * @returns {any}
 */
export function seedDataset() {
  const config = defaultConfig();
  // Wochenweise Stammbesetzung aus der bisherigen Excel-Planung (KW 37-51).
  // Sie gehoert zum Datenbestand, nicht zu den Vorgabewerten - nur so lassen
  // sich die Wochenwerte in der Oberflaeche auch wieder entfernen.
  config.workforce.weekly = defaultWeekly();
  // Gemessene Tagesverfuegbarkeit (Liste der Abteilungsleitung, bereits um
  // 1 korrigiert). Sie hat Vorrang vor Mannschaft und Wochenzahlen.
  config.workforce.dailyAvailable = defaultDailyAvailable();
  const now = new Date().toISOString();
  const scenario = (id, name, description, cfg) => ({
    id, name, description,
    isBaseline: id === 'BASELINE',
    parentId: id === 'BASELINE' ? null : 'BASELINE',
    createdAt: now,
    config: cfg,
    projectOverrides: {},
    sequenceOverride: null,
    measures: [],
  });

  return {
    meta: {
      version: 2,
      createdAt: now,
      title: 'Armaturenbau MEGC – Produktionsplanung',
      source: 'Produktionsplanung Arbeitsplaetze, Planstand 09.09.2026',
    },
    projects: seedProjects(),
    templates: defaultRoutingTemplates(),
    workplaces: defaultWorkplaces(),
    scenarios: [
      scenario('BASELINE', 'Baseline · Regelbetrieb',
        'Regelbetrieb: 7 produktive Stunden je Tag, 2 Heftplaetze, 4 eingesetzte Orbitalschweisser, keine Samstagsarbeit.',
        config),
      scenario('SZN-S2', 'S2 · Versetzte Besetzung + Samstag',
        '12-Stunden-Betriebsfenster durch versetzte Besetzung, 5 Orbitalschweisser, Samstagsarbeit mit 80 % Besatz.',
        scenarioS2(config)),
      scenario('SZN-S3', 'S3 · Engpasspaket',
        '14-Stunden-Betriebsfenster, 3. Heftplatz, 5 Orbitalschweisser, Samstagsarbeit, eine produktive Mehrstunde je Stamm-Mitarbeiter und Tag bis KW43, Freigabe vier Wochen vorher.',
        scenarioS3(config)),
    ],
    activeScenarioId: 'BASELINE',
  };
}
