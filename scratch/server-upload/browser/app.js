/**
 * Ersetzt in der Einzeldatei-Version das Schnittstellenmodul der Oberflaeche.
 *
 * Statt einen lokalen Server anzusprechen, laeuft die vollstaendige
 * Planungsengine unmittelbar im Browser. Die Schnittstelle ist identisch,
 * dadurch bleiben alle Ansichten unveraendert.
 */

import { createApi } from '../server/api.js';
import { openBrowserStore } from './store.js';
import { writeXlsx, readXlsx, writeCsv, readCsv, decodeBase64, encodeText } from './xlsx.js';
import { toast } from '../web/js/ui.js';

const store = openBrowserStore();
const core = createApi(store, {
  codec: { writeXlsx, readXlsx, writeCsv, readCsv, decodeBase64 },
});

/** Angemeldeter Bearbeiter (in der Einzeldatei-Fassung nur lokal). */
export const actor = { name: '', role: '', admin: false };

const TOKEN_KEY = 'megc-armaturenbau:sitzung';

/** Schluessel der laufenden Sitzung - dieselbe Logik wie in der Serverfassung. */
let token = (() => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
})();

/** @param {string} next */
export function setToken(next) {
  token = next ?? '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ohne Speicher: Anmeldung gilt nur fuer dieses Fenster */ }
}

export function currentToken() { return token; }

/** @param {{id?:string, name?:string, admin?:boolean}|null} next */
export function setActor(next) {
  actor.name = next?.id ?? next?.name ?? '';
  actor.role = '';
  actor.admin = !!next?.admin;
  core.setActor(next ?? {});
}

/** In der Einzeldatei laeuft alles im selben Fenster - nichts zu tun. */
export function setUnauthorizedHandler() {}

/** Zusatzangaben fuer die Oberflaeche. */
export const runtime = {
  mode: 'standalone',
  persistent: store.persistent,
  get lastError() { return store.lastError; },
};

/**
 * Fuehrt einen Aufruf aus und meldet Fehler wie die Serverfassung.
 * @param {Function} fn
 * @param {boolean} [quiet] true: die Ansicht meldet den Fehler selbst (Anmeldung)
 */
function call(fn, quiet = false) {
  return async (...args) => {
    try {
      const result = fn(...args);
      if (store.lastError) toast(store.lastError, 'error');
      return result;
    } catch (err) {
      if (!quiet) toast(err?.message ?? 'Unbekannter Fehler', 'error');
      throw err;
    }
  };
}

export const api = {
  /* ---------- Anmeldung (lokal, gleiche Regeln wie im Netzbetrieb) ---------- */
  login: call((payload) => {
    const result = core.login(payload);
    setToken(result.token);
    setActor(result.user);
    return result;
  }, true),
  loginInfo: call((user) => core.loginInfo(user), true),
  logout: call(() => { const r = core.logout(token); setToken(''); setActor(null); return r; }, true),
  session: call(() => {
    const found = core.sessionUser(token);
    if (!found) { const err = new Error('Nicht angemeldet.'); err.status = 401; throw err; }
    return found;
  }, true),
  changePassword: call((payload) => core.changePassword(token, payload), true),

  users: call(() => core.users()),
  createUser: call((payload) => core.createUser(payload)),
  updateUser: call((id, patch) => core.updateUser(id, patch)),
  deleteUser: call((id) => core.deleteUser(id)),
  resetUserPassword: call((id) => core.resetUserPassword(id)),

  /* ---------- Staende, Protokoll, Aufholen ---------- */
  states: call(() => core.states()),
  saveState: call((payload) => core.saveState(payload)),
  stateSummary: call((id) => core.stateSummary(id)),
  loadState: call((id) => core.loadState(id)),
  deleteState: call((id) => core.deleteState(id)),
  changeLog: call((limit) => core.changeLog(limit)),
  history: call((scenario, limit) => core.history(scenario, limit)),
  undo: call((scenario) => core.undo(scenario)),
  redo: call((scenario) => core.redo(scenario)),
  jumpToHistory: call((id) => core.jumpToHistory(id)),
  updateHistoryEntry: call((id, patch) => core.updateHistoryEntry(id, patch)),
  whatHelps: call((scenario) => core.whatHelps(scenario)),
  team: call((scenario) => core.team(scenario)),
  assignment: call((scenario, range) => core.assignment(scenario, range)),
  personPlan: call((scenario, person, week) => core.personPlan(scenario, person, week)),
  belegung: call((scenario, opts) => core.belegung(scenario, opts)),
  mehraufwand: call((scenario) => core.mehraufwand(scenario)),
  applyMehraufwand: call((scenario, payload) => core.applyMehraufwand(scenario, payload)),
  acks: call(() => core.acks()),
  ackFinding: call((payload) => core.ackFinding(payload)),
  unackFinding: call((key) => core.unackFinding(key)),
  clearAcks: call(() => core.clearAcks()),
  views: call(() => core.views()),
  saveView: call((payload) => core.saveView(payload)),
  deleteView: call((id) => core.deleteView(id)),
  parseAttendance: call((payload) => core.parseAttendance(payload?.text, payload ?? {})),
  applyAttendance: call((scenario, payload) => core.applyAttendance(scenario, payload)),
  reference: call((scenario) => core.reference(scenario)),
  setReference: call((id) => core.setReferenceState(id)),
  fixReference: call((payload) => core.fixCurrentAsReference(payload)),
  target: call((scenario) => core.target(scenario)),
  setTarget: call((id) => core.setTargetState(id)),
  fixTarget: call((payload) => core.fixCurrentAsTarget(payload)),
  promoteTarget: call(() => core.promoteTargetToReference()),
  catchUp: call(() => core.catchUp(token)),
  markSeen: call(() => core.markSeen(token)),
  setCurrentPlan: call((id) => core.setCurrentPlan(id)),

  /* ---------- Regeln ---------- */
  rules: call((scenario) => core.rules(scenario)),
  parseRule: call((text) => core.parseRule(text)),
  emptyRule: call((type) => core.emptyRule(type)),
  createRule: call((rule) => core.createRule(rule)),
  updateRule: call((id, patch) => core.updateRule(id, patch)),
  deleteRule: call((id) => core.deleteRule(id)),
  setRuleEnabled: call((id, enabled) => core.setRuleEnabled(id, enabled)),
  ruleImpact: call((id, scenario) => core.ruleImpact(id, scenario)),

  state: call(() => ({ ...core.state(), runtime })),
  analysis: call((scenario, range) => core.analysis(scenario, range)),
  scenarioConfig: call((scenario) => core.scenarioConfig(scenario)),
  validate: call((scenario) => core.validate(scenario)),
  requiredStaff: call((scenario) => core.requiredStaff(scenario)),
  revision: call(() => core.revision()),

  createProject: call((p) => core.createProject(p)),
  updateProject: call((id, patch) => core.updateProject(id, patch)),
  deleteProject: call((id) => core.deleteProject(id)),
  duplicateProject: call((id) => core.duplicateProject(id)),
  reorderProjects: call((ids) => core.reorderProjects(ids)),

  updateTemplate: call((key, tpl) => core.updateTemplate(key, tpl)),
  resetTemplates: call(() => core.resetTemplates()),
  updateWorkplaces: call((workplaces) => core.updateWorkplaces(workplaces)),

  createScenario: call((name, sourceId) => core.createScenario({ name, sourceId })),
  updateScenario: call((id, patch) => core.updateScenario(id, patch)),
  deleteScenario: call((id) => core.deleteScenario(id)),
  resetScenario: call((id) => core.resetScenario(id)),
  activateScenario: call((id) => core.setActiveScenario(id)),
  applyProposal: call((id, payload) => core.applyProposal(id, payload)),

  optimize: call((payload) => core.optimize(payload.scenario, payload)),
  impact: call((scenario, base) => core.impact(scenario, base)),
  compare: call((ids) => core.compare(ids)),
  importProjects: call((payload) => core.importProjects(payload)),

  backups: call(() => core.backups()),
  createBackup: call((label) => core.createBackup(label)),
  restoreBackup: call((id) => core.restoreBackup(id)),
  resetAll: call(() => core.resetAll()),

  /** Vollstaendige Datensicherung als Datei. */
  exportDataset: call(() => JSON.stringify(core.dataset, null, 1)),
  importDataset: call((json) => core.replaceDataset(JSON.parse(json))),
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Loest einen Dateidownload aus. */
export function saveFile(data, filename, mime) {
  const blob = data instanceof Uint8Array
    ? new Blob([data], { type: mime })
    : new Blob([encodeText(String(data))], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Bildet die Download-Adressen der Serverfassung nach, damit die Ansichten
 * unveraendert bleiben.
 * @param {string} path
 */
export function download(path) {
  const url = new URL(path, 'http://local/');
  const q = url.searchParams;
  const scenario = q.get('scenario') ?? undefined;
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    if (url.pathname === '/api/export/comparison') {
      const ids = (q.get('ids') ?? '').split(',').filter(Boolean);
      saveFile(core.exportComparison(ids), `Szenariovergleich_${stamp}.xlsx`, XLSX_MIME);
      return;
    }
    if (url.pathname === '/api/export/template') {
      saveFile(core.importTemplate(), 'Importvorlage_Projekte.xlsx', XLSX_MIME);
      return;
    }
    if (q.get('format') === 'csv') {
      const type = q.get('type') ?? 'projects';
      saveFile(core.exportCsv(scenario, type), `Armaturenbau_${type}_${stamp}.csv`, 'text/csv;charset=utf-8');
      return;
    }
    saveFile(core.exportWorkbook(scenario), `Armaturenbau_Planung_${stamp}.xlsx`, XLSX_MIME);
  } catch (err) {
    toast(err?.message ?? 'Export fehlgeschlagen', 'error');
  }
}
