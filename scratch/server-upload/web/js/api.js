/**
 * Zugriff auf die lokale Schnittstelle des Planungsservers.
 */
import { progress, toast } from './ui.js';

const TOKEN_KEY = 'megc-armaturenbau:sitzung';

/** Angemeldeter Bearbeiter (Mehrbenutzerbetrieb). */
export const actor = { name: '', role: '', admin: false };

/** Schluessel der laufenden Sitzung. */
let token = readToken();

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

/** @param {string} next */
export function setToken(next) {
  token = next ?? '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ohne Speicher: Anmeldung gilt nur fuer diese Sitzung */ }
}

export function currentToken() { return token; }

/** @param {{id?:string, name?:string, admin?:boolean}|null} next */
export function setActor(next) {
  actor.name = next?.id ?? next?.name ?? '';
  actor.role = '';
  actor.admin = !!next?.admin;
}

/** Wird gerufen, wenn die Anmeldung abgelaufen ist. */
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function headers(body) {
  /** @type {Record<string,string>} */
  const out = {};
  if (body) out['Content-Type'] = 'application/json';
  if (token) out['X-MEGC-Token'] = token;
  return out;
}

async function request(method, path, body, options = {}) {
  progress.start();
  try {
    const res = await fetch(path, {
      method,
      headers: headers(body),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.error ?? `Fehler ${res.status}`);
      // @ts-ignore - Zusatzangaben fuer die Oberflaeche
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  } catch (err) {
    if (err?.status === 401 && !options.quiet) {
      setToken('');
      onUnauthorized();
    } else if (!options.quiet) {
      toast(err.message, 'error');
    }
    throw err;
  } finally {
    progress.stop();
  }
}

export const api = {
  /* ---------- Anmeldung ---------- */
  login: (payload) => request('POST', '/api/login', payload, { quiet: true }),
  loginInfo: (user) => request('GET', `/api/login-info?user=${encodeURIComponent(user)}`, null, { quiet: true }),
  logout: () => request('POST', '/api/logout', {}, { quiet: true }),
  session: () => request('GET', '/api/session', null, { quiet: true }),
  changePassword: (payload) => request('POST', '/api/password', payload, { quiet: true }),

  users: () => request('GET', '/api/users'),
  createUser: (payload) => request('POST', '/api/users', payload),
  updateUser: (id, patch) => request('PUT', `/api/users/${encodeURIComponent(id)}`, patch),
  deleteUser: (id) => request('DELETE', `/api/users/${encodeURIComponent(id)}`, {}),
  resetUserPassword: (id) => request('POST', `/api/users/${encodeURIComponent(id)}/reset-password`, {}),

  /* ---------- Staende, Protokoll, Aufholen ---------- */
  states: () => request('GET', '/api/states'),
  saveState: (payload) => request('POST', '/api/states', payload),
  stateSummary: (id) => request('GET', `/api/states/${encodeURIComponent(id)}`),
  loadState: (id) => request('POST', `/api/states/${encodeURIComponent(id)}/load`, {}),
  deleteState: (id) => request('DELETE', `/api/states/${encodeURIComponent(id)}`, {}),
  changeLog: (limit) => request('GET', `/api/changelog?limit=${Number(limit) || 200}`),
  history: (scenario, limit) => request('GET', `/api/history?scenario=${encodeURIComponent(scenario ?? '')}&limit=${Number(limit) || 60}`),
  undo: (scenario) => request('POST', '/api/history/undo', { scenario }),
  redo: (scenario) => request('POST', '/api/history/redo', { scenario }),
  jumpToHistory: (id) => request('POST', '/api/history/jump', { id }),
  updateHistoryEntry: (id, patch) => request('POST', '/api/history/entry', { id, ...patch }),
  whatHelps: (scenario) => request('GET', `/api/what-helps?scenario=${encodeURIComponent(scenario ?? '')}`),
  team: (scenario) => request('GET', `/api/team?scenario=${encodeURIComponent(scenario ?? '')}`),
  assignment: (scenario, range = {}) => request('GET', `/api/assignment?scenario=${encodeURIComponent(scenario ?? '')}`
    + `&from=${encodeURIComponent(range.from ?? '')}&to=${encodeURIComponent(range.to ?? '')}`),
  personPlan: (scenario, person, week) => request('GET', `/api/person-plan?scenario=${encodeURIComponent(scenario ?? '')}`
    + `&person=${encodeURIComponent(person)}&week=${encodeURIComponent(week ?? '')}`),
  belegung: (scenario, opts = {}) => request('GET', `/api/belegung?scenario=${encodeURIComponent(scenario ?? '')}`
    + `&mode=${encodeURIComponent(opts.mode ?? '')}&from=${encodeURIComponent(opts.from ?? '')}`
    + `&to=${encodeURIComponent(opts.to ?? '')}`),
  schichtvorschlag: (scenario) => request('GET', `/api/schichtvorschlag?scenario=${encodeURIComponent(scenario ?? '')}`),
  applySchichten: (scenario, payload) => request('POST', '/api/schichtvorschlag/apply', { scenario, ...payload }),
  mehraufwand: (scenario) => request('GET', `/api/mehraufwand?scenario=${encodeURIComponent(scenario ?? '')}`),
  applyMehraufwand: (scenario, payload) => request('POST', '/api/mehraufwand/apply', { scenario, ...payload }),
  acks: () => request('GET', '/api/acks'),
  ackFinding: (payload) => request('POST', '/api/acks', payload),
  unackFinding: (key) => request('POST', '/api/acks/delete', { key }),
  clearAcks: () => request('POST', '/api/acks/clear', {}),
  views: () => request('GET', '/api/views'),
  saveView: (payload) => request('POST', '/api/views', payload),
  deleteView: (id) => request('POST', '/api/views/delete', { id }),
  parseAttendance: (payload) => request('POST', '/api/attendance/parse', payload),
  applyAttendance: (scenario, payload) => request('POST', '/api/attendance/apply', { scenario, ...payload }),
  reference: (scenario) => request('GET', `/api/reference?scenario=${encodeURIComponent(scenario ?? '')}`),
  setReference: (id) => request('POST', '/api/reference', { id }),
  fixReference: (payload) => request('POST', '/api/reference/fix', payload),
  target: (scenario) => request('GET', `/api/target?scenario=${encodeURIComponent(scenario ?? '')}`),
  setTarget: (id) => request('POST', '/api/target', { id }),
  fixTarget: (payload) => request('POST', '/api/target/fix', payload),
  promoteTarget: () => request('POST', '/api/target/promote', {}),
  catchUp: () => request('GET', '/api/catch-up'),
  markSeen: () => request('POST', '/api/seen', {}),
  setCurrentPlan: (id) => request('POST', '/api/current-plan', { id }),

  /* ---------- Regeln ---------- */
  rules: (scenario) => request('GET', `/api/rules?scenario=${encodeURIComponent(scenario ?? '')}`),
  parseRule: (text) => request('POST', '/api/rules/parse', { text }),
  emptyRule: (type) => request('GET', `/api/rules/empty?type=${encodeURIComponent(type)}`),
  createRule: (rule) => request('POST', '/api/rules', rule),
  updateRule: (id, patch) => request('PUT', `/api/rules/${encodeURIComponent(id)}`, patch),
  deleteRule: (id) => request('DELETE', `/api/rules/${encodeURIComponent(id)}`, {}),
  setRuleEnabled: (id, enabled) => request('POST', `/api/rules/${encodeURIComponent(id)}/enabled`, { enabled }),
  ruleImpact: (id, scenario) => request('POST', `/api/rules/${encodeURIComponent(id)}/impact`, { scenario }),

  state: () => request('GET', '/api/state'),
  analysis: (scenario, range = {}) => request('GET', `/api/analysis?scenario=${encodeURIComponent(scenario ?? '')}`
    + `&from=${encodeURIComponent(range?.from ?? '')}&to=${encodeURIComponent(range?.to ?? '')}`),
  scenarioConfig: (scenario) => request('GET', `/api/scenario-config?scenario=${encodeURIComponent(scenario)}`),
  validate: (scenario) => request('GET', `/api/validate?scenario=${encodeURIComponent(scenario ?? '')}`),
  requiredStaff: (scenario, zielOtd) => request('GET', `/api/required-staff?scenario=${encodeURIComponent(scenario ?? '')}`
    + (zielOtd != null ? `&zielOtd=${encodeURIComponent(zielOtd)}` : '')),
  revision: () => request('GET', '/api/revision'),

  createProject: (p) => request('POST', '/api/projects', p),
  updateProject: (id, patch) => request('PUT', `/api/projects/${encodeURIComponent(id)}`, patch),
  deleteProject: (id) => request('DELETE', `/api/projects/${encodeURIComponent(id)}`, {}),
  duplicateProject: (id) => request('POST', `/api/projects/${encodeURIComponent(id)}/duplicate`, {}),
  reorderProjects: (ids) => request('POST', '/api/projects/reorder', { ids }),

  updateTemplate: (key, tpl) => request('PUT', `/api/templates/${encodeURIComponent(key)}`, tpl),
  resetTemplates: () => request('POST', '/api/templates/reset', {}),
  updateWorkplaces: (workplaces) => request('PUT', '/api/workplaces', { workplaces }),

  createScenario: (name, sourceId) => request('POST', '/api/scenarios', { name, sourceId }),
  updateScenario: (id, patch) => request('PUT', `/api/scenarios/${encodeURIComponent(id)}`, patch),
  deleteScenario: (id) => request('DELETE', `/api/scenarios/${encodeURIComponent(id)}`, {}),
  resetScenario: (id) => request('POST', `/api/scenarios/${encodeURIComponent(id)}/reset`, {}),
  activateScenario: (id) => request('POST', `/api/scenarios/${encodeURIComponent(id)}/activate`, {}),
  applyProposal: (id, payload) => request('POST', `/api/scenarios/${encodeURIComponent(id)}/apply`, payload),

  optimize: (payload) => request('POST', '/api/optimize', payload),
  impact: (scenario, base) => request('POST', '/api/impact', { scenario, base }),
  compare: (ids) => request('POST', '/api/compare', { ids }),
  importProjects: (payload) => request('POST', '/api/import', payload),

  backups: () => request('GET', '/api/backups'),
  createBackup: (label) => request('POST', '/api/backups', { label }),
  restoreBackup: (id) => request('POST', `/api/backups/${encodeURIComponent(id)}/restore`, {}),
  resetAll: () => request('POST', '/api/reset', {}),
};

export function download(path) {
  const a = document.createElement('a');
  // Downloads laufen ueber einen normalen Link; der Schluessel wird deshalb
  // in der Adresse mitgegeben (das Sitzungs-Cookie reicht nicht in jedem Browser).
  a.href = token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : path;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
