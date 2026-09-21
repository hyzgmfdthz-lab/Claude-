/**
 * Fachliche Schnittstelle (REST) zwischen Oberflaeche und Planungsengine.
 * Enthaelt keine HTTP-Details - dadurch automatisiert testbar.
 */

import {
  analyze, materialize, duplicateScenario, resetScenario, getScenario,
  optimize, proposeSolutions, evaluate, summarize, kpiDelta, projectStatusDiff, whatHelps,
  requiredAdditionalStaff,
  createProject, makeId, deepClone, deepMerge, validate, validationSummary,
  seedDataset, defaultRoutingTemplates, defaultWorkplaces, defaultConfig,
  OPERATIONS, PROJECT_TYPES, VARIANTS, PRIORITIES, OPERATION_BY_ID,
  routingLabel, formatDE, parseDate, runSchedule, round2,
  defaultUsers, publicUser, normalizeUserId, hashPassword, verifyPassword,
  passwordProblem, createSession, tokenHashOf, SESSION_HOURS, ADMIN_USER,
  parseRuleText, checkRules, ruleSummary, hasError, emptyRule, RULE_TYPES,
  assignPeople, personWeek, defaultTeam, peopleOf, teamOn, ZUGESAGTE_LEIHE,
  planeSchichten, mitSchichten,
  SHIFTS, ABSENCE_KINDS,
  weekList,
  parseAttendanceMatrix, absentPerDay, absentPerWeek,
  board, BOARD_MODE,
  wendeBestaetigungenAn, PLAUSI_LEVEL,
  wendeMassnahmeAn, mehraufwand as rechneMehraufwand, runSchedule as planeDurch,
  AV_ERLEDIGT_BIS, OP_STATUS,
} from '../engine/index.js';
import { writeXlsx, readXlsx, writeCsv, readCsv } from './xlsx.js';

export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * Standard-Codec (Node). Die Einzeldatei-Version reicht eine eigene
 * Umsetzung ohne Node-Abhaengigkeiten herein.
 */
export const nodeCodec = {
  writeXlsx, readXlsx, writeCsv, readCsv,
  decodeBase64: (data) => Buffer.from(data, 'base64'),
};

/**
 * @param {import('./store.js').Store} store
 * @param {{codec?:any}} [options]
 */
export function createApi(store, options = {}) {
  const codec = options.codec ?? nodeCodec;
  /** @type {any} */
  let dataset = store.load();
  if (!dataset) {
    dataset = seedDataset();
    store.save(dataset, 'Erstinstallation');
  }
  migrate(dataset);

  /** Angemeldeter Bearbeiter (fuer Aenderungsnachweis im Mehrbenutzerbetrieb). */
  let actor = { name: '', role: '', admin: false };

  /** Hoechstzahl der Eintraege im Aenderungsprotokoll. */
  const MAX_LOG = 500;

  /**
   * Schreibt den Datenbestand und haelt fest, wer wann was geaendert hat.
   * @param {string} label Klartext fuer Protokoll und Sicherung
   */
  const persist = (label = '') => {
    dataset.meta.revision = Number(dataset.meta.revision ?? 0) + 1;
    dataset.meta.changedAt = new Date().toISOString();
    dataset.meta.changedBy = actor.name || '';
    dataset.meta.lastChange = label || dataset.meta.lastChange || '';
    if (label) {
      dataset.changeLog.unshift({
        id: makeId('LOG'),
        at: dataset.meta.changedAt,
        by: actor.name || '',
        text: label,
        revision: dataset.meta.revision,
      });
      if (dataset.changeLog.length > MAX_LOG) dataset.changeLog.length = MAX_LOG;
    }
    autoStateIfDue();
    store.save(dataset, label ? `${label}${actor.name ? ` – ${actor.name}` : ''}` : '');
  };

  /**
   * Einmal je Kalendertag wird der komplette Datenbestand als Stand
   * abgelegt - unabhaengig davon, ob jemand von Hand speichert.
   */
  const autoStateIfDue = () => {
    if (typeof store.saveState !== 'function') return;
    const today = new Date().toISOString().slice(0, 10);
    if (dataset.meta.lastAutoState === today) return;
    dataset.meta.lastAutoState = today;
    try {
      store.saveState({
        id: makeId('STD'),
        createdAt: new Date().toISOString(),
        name: `Tagessicherung ${formatDE(today)}`,
        note: 'Automatisch einmal täglich gesichert.',
        createdBy: 'Automatik',
        kind: 'AUTO',
        meta: stateMeta(),
        data: deepClone(dataset),
      });
    } catch { /* Sicherung darf das Arbeiten nie blockieren */ }
  };

  /** Kurzbeschreibung fuer die Standliste (ohne den Datenbestand zu laden). */
  const stateMeta = () => {
    try {
      const kpis = evaluate(materialize(dataset, dataset.activeScenarioId)).kpis;
      return {
        projects: dataset.projects.length,
        otd: round2(kpis.otd),
        late: kpis.late,
        scenario: getScenario(dataset, dataset.activeScenarioId).name,
        openHours: round2(kpis.openHours),
      };
    } catch {
      return { projects: dataset.projects?.length ?? 0 };
    }
  };

  /**
   * Kennzahlen des IST-Standes.
   *
   * Ein gespeicherter Stand aendert sich nie mehr - deshalb werden seine
   * Kennzahlen einmal gerechnet und dann behalten. Sonst muesste bei jeder
   * Anzeige eine zweite vollstaendige Simulation laufen.
   * @type {Map<string, any>}
   */
  const referenzCache = new Map();

  /**
   * Kennzahlen des SOLL-Standes - gleiche Ueberlegung wie beim IST-Stand.
   * @type {Map<string, any>}
   */
  const sollCache = new Map();

  /**
   * Versuchsverlauf.
   *
   * Beim Durchspielen verliert man den Faden: Was habe ich schon probiert,
   * was hat es gebracht, wie komme ich dorthin zurueck? Deshalb wird jede
   * Aenderung an den Stellschrauben mitgeschrieben - mit ihrer Wirkung und
   * mit dem Gegenstueck, das sie zurueckholt.
   *
   * Gespeichert wird nicht der komplette Stand, sondern die Aenderung und
   * ihr Gegenteil ("vorher stand hier 7"). Das bleibt klein und laesst sich
   * genau zurueckdrehen.
   */
  const VERLAUF_MAX = 200;

  /** Werte der genannten Pfade aus der aktuellen Konfiguration einsammeln. */
  const gegenstueck = (config, patch, prefix = '') => {
    /** @type {any} */
    const out = {};
    for (const [key, value] of Object.entries(patch ?? {})) {
      const pfad = prefix ? `${prefix}.${key}` : key;
      const jetzt = valueAt(config, pfad);
      if (value && typeof value === 'object' && !Array.isArray(value)
        && jetzt && typeof jetzt === 'object' && !Array.isArray(jetzt)) {
        out[key] = gegenstueck(config, value, pfad);
      } else {
        // null statt undefined: deepMerge soll den Wert wieder setzen
        out[key] = jetzt === undefined ? null : deepClone(jetzt);
      }
    }
    return out;
  };

  /**
   * Einen Verlaufseintrag anwenden - entweder sein Gegenstueck ("zurück")
   * oder die Aenderung selbst ("vor").
   */
  const verlaufAnwenden = (eintrag, richtung, opts = {}) => {
    const s = dataset.scenarios.find((x) => x.id === eintrag.scenarioId);
    if (!s) throw new ApiError('Das Szenario zu diesem Schritt gibt es nicht mehr.', 404);
    const zurueck = richtung === 'zurück';
    const config = zurueck ? eintrag.reverse : eintrag.patch;
    const clear = zurueck ? null : eintrag.clear;
    if (config) s.config = deepMerge(s.config, config);
    if (zurueck && eintrag.reverseClear) {
      for (const [pfad, wert] of Object.entries(eintrag.reverseClear)) {
        const teile = String(pfad).split('.');
        const letzter = teile.pop();
        let ziel = s.config;
        for (const t of teile) ziel = ziel?.[t];
        if (ziel && letzter) ziel[letzter] = deepClone(wert);
      }
    }
    for (const pfad of clear ?? []) {
      const teile = String(pfad).split('.');
      const letzter = teile.pop();
      let ziel = s.config;
      for (const t of teile) ziel = ziel?.[t];
      if (!ziel || !letzter) continue;
      ziel[letzter] = Array.isArray(ziel[letzter]) ? [] : {};
    }
    eintrag.undone = zurueck;
    if (!opts.still) {
      persist(`${zurueck ? 'Schritt zurück' : 'Schritt vor'}: ${eintrag.note || eintrag.label}`);
    }
    return { id: eintrag.id, label: eintrag.note || eintrag.label, direction: richtung };
  };

  /** Kennzahlen eines Szenarios - Grundlage fuer die Wirkung im Verlauf. */
  const kennzahlen = (scenarioId) => {
    try {
      return summarize(evaluate(materialize(dataset, scenarioId)).kpis);
    } catch {
      return null;
    }
  };

  /** Eintrag in den Verlauf schreiben. */
  const verlaufSchreiben = ({ scenarioId, label, patch, clear, reverse, reverseClear, kpisBefore }) => {
    dataset.history = Array.isArray(dataset.history) ? dataset.history : [];
    const kpis = kennzahlen(scenarioId);
    const vorher = kpisBefore ?? dataset.history.filter((e) => e.scenarioId === scenarioId).at(-1)?.kpis ?? null;
    const eintrag = {
      id: makeId('VER'),
      at: new Date().toISOString(),
      by: actor.name || 'unbekannt',
      scenarioId,
      label,
      note: '',
      pinned: false,
      patch: patch ? deepClone(patch) : null,
      clear: clear?.length ? [...clear] : null,
      reverse: reverse ? deepClone(reverse) : null,
      reverseClear: reverseClear ?? null,
      kpisBefore: vorher,
      kpis,
      effect: vorher && kpis
        ? {
          otd: round2(kpis.otd - vorher.otd),
          late: kpis.late - vorher.late,
          lateDays: round2(kpis.totalLateDays - vorher.totalLateDays),
          shortfall: round2((kpis.shortfallHours ?? 0) - (vorher.shortfallHours ?? 0)),
        }
        : null,
    };
    dataset.history.push(eintrag);
    if (dataset.history.length > VERLAUF_MAX) {
      dataset.history = dataset.history.slice(-VERLAUF_MAX);
    }
    return eintrag;
  };

  /** Sitzung anhand des Schluessels aufloesen; abgelaufene werden entfernt. */
  const sessionOf = (token) => {
    if (!token) return null;
    const now = Date.now();
    const before = dataset.sessions.length;
    dataset.sessions = dataset.sessions.filter((x) => Date.parse(x.expiresAt) > now);
    if (dataset.sessions.length !== before) store.save(dataset);
    const hash = tokenHashOf(token);
    const found = dataset.sessions.find((x) => x.tokenHash === hash);
    if (!found) return null;
    const user = dataset.users.find((u) => u.id === found.userId && u.active !== false);
    if (!user) return null;
    return { session: found, user };
  };

  const userOf = (id) => {
    const found = dataset.users.find((u) => u.id === normalizeUserId(id));
    if (!found) throw new ApiError(`Kürzel ${normalizeUserId(id)} ist nicht angelegt.`, 404);
    return found;
  };

  const requireAdmin = () => {
    if (!actor.admin) {
      const admins = dataset.users.filter((u) => u.admin && u.active !== false).map((u) => u.id);
      throw new ApiError(`Das darf nur die Verwaltung (${admins.join(', ') || ADMIN_USER}).`, 403);
    }
  };
  const project = (id) => {
    const p = dataset.projects.find((x) => x.id === id);
    if (!p) throw new ApiError(`Projekt ${id} nicht gefunden.`, 404);
    return p;
  };
  const scenario = (id) => {
    const s = dataset.scenarios.find((x) => x.id === id);
    if (!s) throw new ApiError(`Szenario ${id} nicht gefunden.`, 404);
    return s;
  };

  const api = {
    get dataset() { return dataset; },

    /** Bearbeiter festlegen (Mehrbenutzerbetrieb). */
    setActor(next) {
      actor = {
        name: normalizeUserId(next?.id ?? next?.name ?? '').slice(0, 20),
        role: String(next?.role ?? '').slice(0, 40),
        admin: !!next?.admin,
      };
      return actor;
    },

    get actor() { return actor; },

    /* -------------------- Anmeldung -------------------- */

    /**
     * Anmeldung mit Kuerzel und Passwort.
     *
     * Hat ein Kuerzel noch kein Passwort, wird bei der ersten Anmeldung
     * eines vergeben (Feld `newPassword`).
     *
     * @param {{user:string, password?:string, newPassword?:string}} payload
     */
    login({ user, password = '', newPassword = '' }) {
      const id = normalizeUserId(user);
      if (!id) throw new ApiError('Bitte das Kürzel eintragen.');
      const found = dataset.users.find((u) => u.id === id);
      if (!found || found.active === false) {
        throw new ApiError('Kürzel oder Passwort stimmt nicht.', 401);
      }

      if (!found.password) {
        // Erstanmeldung: eigenes Passwort vergeben. Das ist kein Fehler,
        // sondern ein regulaerer Zwischenschritt - deshalb eine normale
        // Antwort mit Hinweis statt einer Fehlermeldung.
        if (!newPassword) {
          return {
            needsPassword: true,
            user: found.id,
            hint: `Für ${found.id} ist noch kein Passwort vergeben. Bitte jetzt ein eigenes festlegen.`,
          };
        }
        const problem = passwordProblem(newPassword);
        if (problem) throw new ApiError(problem);
        found.password = hashPassword(newPassword);
        found.passwordSetAt = new Date().toISOString();
      } else if (!verifyPassword(password, found.password)) {
        throw new ApiError('Kürzel oder Passwort stimmt nicht.', 401);
      }

      const { token, record } = createSession(found.id);
      dataset.sessions.push(record);
      // Nur die jeweils letzten Sitzungen je Benutzer behalten
      dataset.sessions = dataset.sessions.filter((x) => Date.parse(x.expiresAt) > Date.now());
      const previousSeen = found.lastSeenAt;
      found.lastLoginAt = new Date().toISOString();
      // Eine Anmeldung ist keine Planungsaenderung: sie gehoert nicht ins
      // Aenderungsprotokoll und erzeugt keine Sicherung.
      store.save(dataset);
      return {
        token,
        expiresAt: record.expiresAt,
        user: publicUser(found),
        sessionHours: SESSION_HOURS,
        since: previousSeen ?? null,
      };
    },

    /** Abmelden. Die Sitzung wird sofort ungültig. */
    logout(token) {
      const hash = tokenHashOf(token);
      const before = dataset.sessions.length;
      dataset.sessions = dataset.sessions.filter((x) => x.tokenHash !== hash);
      if (dataset.sessions.length !== before) store.save(dataset);
      return { ok: true };
    },

    /** Prueft eine Sitzung. Liefert null, wenn sie fehlt oder abgelaufen ist. */
    sessionUser(token) {
      const found = sessionOf(token);
      if (!found) return null;
      return { user: publicUser(found.user), expiresAt: found.session.expiresAt };
    },

    /** Ist ueberhaupt schon ein Passwort vergeben? (Hinweis bei Erstanmeldung) */
    loginInfo(userId) {
      const id = normalizeUserId(userId);
      const found = dataset.users.find((u) => u.id === id && u.active !== false);
      return {
        exists: !!found,
        hasPassword: !!found?.password,
        admins: dataset.users.filter((u) => u.admin && u.active !== false).map((u) => u.id),
      };
    },

    /** Eigenes Passwort aendern. */
    changePassword(token, { oldPassword = '', newPassword = '' }) {
      const found = sessionOf(token);
      if (!found) throw new ApiError('Bitte erneut anmelden.', 401);
      const user = found.user;
      if (user.password && !verifyPassword(oldPassword, user.password)) {
        throw new ApiError('Das bisherige Passwort stimmt nicht.');
      }
      const problem = passwordProblem(newPassword);
      if (problem) throw new ApiError(problem);
      user.password = hashPassword(newPassword);
      user.passwordSetAt = new Date().toISOString();
      // Andere Sitzungen dieses Kuerzels beenden
      dataset.sessions = dataset.sessions.filter(
        (x) => x.userId !== user.id || x.tokenHash === tokenHashOf(token));
      persist(`Passwort geändert: ${user.id}`);
      return { ok: true };
    },

    /* -------------------- Benutzerverwaltung (nur Verwaltung) -------------------- */

    users() {
      return dataset.users.map(publicUser);
    },

    createUser({ id, label = '', admin = false }) {
      requireAdmin();
      const key = normalizeUserId(id);
      if (!/^[A-Z0-9]{2,10}$/.test(key)) {
        throw new ApiError('Das Kürzel darf nur aus 2 bis 10 Buchstaben oder Ziffern bestehen.');
      }
      if (dataset.users.some((u) => u.id === key)) throw new ApiError(`Das Kürzel ${key} gibt es bereits.`);
      const user = {
        id: key, label: String(label || key), admin: !!admin, password: null, active: true,
        createdAt: new Date().toISOString(), lastLoginAt: null, lastSeenAt: null,
      };
      dataset.users.push(user);
      persist(`Kürzel angelegt: ${key}`);
      return publicUser(user);
    },

    updateUser(id, patch = {}) {
      requireAdmin();
      const user = userOf(id);
      if (patch.label != null) user.label = String(patch.label);
      if (patch.admin != null) user.admin = !!patch.admin;
      if (patch.active != null) {
        user.active = !!patch.active;
        if (!user.active) dataset.sessions = dataset.sessions.filter((x) => x.userId !== user.id);
      }
      persist(`Kürzel geändert: ${user.id}`);
      return publicUser(user);
    },

    /** Passwort eines Kuerzels zuruecksetzen: es wird beim naechsten Anmelden neu vergeben. */
    resetUserPassword(id) {
      requireAdmin();
      const user = userOf(id);
      user.password = null;
      dataset.sessions = dataset.sessions.filter((x) => x.userId !== user.id);
      persist(`Passwort zurückgesetzt: ${user.id}`);
      return publicUser(user);
    },

    deleteUser(id) {
      requireAdmin();
      const user = userOf(id);
      if (user.admin && dataset.users.filter((u) => u.admin && u.active !== false).length <= 1) {
        throw new ApiError('Das letzte Kürzel der Verwaltung kann nicht gelöscht werden.');
      }
      dataset.users = dataset.users.filter((u) => u.id !== user.id);
      dataset.sessions = dataset.sessions.filter((x) => x.userId !== user.id);
      persist(`Kürzel gelöscht: ${user.id}`);
      return { deleted: user.id };
    },

    /* -------------------- Aenderungsprotokoll und Aufholen -------------------- */

    changeLog(limit = 200) {
      return dataset.changeLog.slice(0, Math.max(1, Math.min(MAX_LOG, Number(limit) || 200)));
    },

    /**
     * Was ist passiert, seit dieser Benutzer zuletzt hier war?
     * @param {string} token
     */
    catchUp(token, limit = 50) {
      const found = sessionOf(token);
      if (!found) throw new ApiError('Bitte erneut anmelden.', 401);
      const since = found.user.lastSeenAt;
      const entries = dataset.changeLog
        .filter((e) => (!since || e.at > since) && e.by !== found.user.id)
        .slice(0, limit);
      return {
        since: since ?? null,
        entries,
        total: entries.length,
        people: [...new Set(entries.map((e) => e.by).filter(Boolean))],
      };
    },

    /** Markiert alles als gelesen (Schaltflaeche "Alles gelesen"). */
    markSeen(token) {
      const found = sessionOf(token);
      if (!found) throw new ApiError('Bitte erneut anmelden.', 401);
      found.user.lastSeenAt = new Date().toISOString();
      store.save(dataset);
      return { lastSeenAt: found.user.lastSeenAt };
    },

    /* -------------------- Staende -------------------- */

    states() {
      if (typeof store.states !== 'function') return [];
      return store.states().map((st) => ({
        ...st,
        mayDelete: !!actor.name && (actor.admin || st.createdBy === actor.name),
      }));
    },

    /**
     * Speichert den kompletten Datenbestand als benannten Stand.
     * Die Notiz ist Pflicht - sie erklaert den Kollegen, worum es geht.
     */
    saveState({ name, note }) {
      if (typeof store.saveState !== 'function') throw new ApiError('Diese Datenhaltung kann keine Stände speichern.');
      const label = String(name ?? '').trim();
      const text = String(note ?? '').trim();
      if (!label) throw new ApiError('Bitte dem Stand einen Namen geben.');
      if (!text) throw new ApiError('Bitte kurz eintragen, worum es bei diesem Stand geht.');
      const entry = {
        id: makeId('STD'),
        createdAt: new Date().toISOString(),
        name: label.slice(0, 120),
        note: text.slice(0, 500),
        createdBy: actor.name || 'unbekannt',
        kind: 'MANUAL',
        meta: stateMeta(),
        data: deepClone(dataset),
      };
      const head = store.saveState(entry);
      // Zeitpunkt merken - die Oberflaeche erinnert daran, wenn lange
      // nichts gesichert wurde.
      dataset.meta.lastStateAt = entry.createdAt;
      persist(`Stand gespeichert: ${entry.name}`);
      return head;
    },

    /** Kennzahlen eines Standes, ohne den Arbeitsstand zu verändern. */
    stateSummary(id) {
      const data = store.stateData?.(id);
      if (!data) throw new ApiError('Stand nicht gefunden.', 404);
      const head = store.states().find((s) => s.id === id);
      const ev = evaluate(materialize(data, data.activeScenarioId));
      return {
        ...head,
        kpis: summarize(ev.kpis),
        projects: data.projects.length,
        scenario: getScenario(data, data.activeScenarioId).name,
        config: getScenario(data, data.activeScenarioId).config,
      };
    },

    /**
     * Laedt einen Stand in den gemeinsamen Arbeitsstand.
     * Der gespeicherte Stand selbst bleibt unveraendert - weitergearbeitet
     * wird immer im Arbeitsstand, gespeichert wird immer als NEUER Stand.
     */
    loadState(id) {
      const data = store.stateData?.(id);
      if (!data) throw new ApiError('Stand nicht gefunden.', 404);
      const head = store.states().find((s) => s.id === id);
      const users = dataset.users;
      const sessions = dataset.sessions;
      const log = dataset.changeLog;
      dataset = data;
      migrate(dataset);
      // Anmeldungen und Protokoll gehoeren zum Betrieb, nicht zum Planungsstand
      dataset.users = users;
      dataset.sessions = sessions;
      dataset.changeLog = log;
      persist(`Stand geladen: ${head?.name ?? id}`);
      return api.state();
    },

    deleteState(id) {
      const head = store.states?.().find((s) => s.id === id);
      if (!head) throw new ApiError('Stand nicht gefunden.', 404);
      if (!actor.admin && head.createdBy !== actor.name) {
        throw new ApiError('Löschen darf nur, wer den Stand angelegt hat – oder die Verwaltung.', 403);
      }
      store.deleteState(id);
      // War es der IST- oder SOLL-Stand, gibt es ab jetzt keinen Bezugspunkt mehr.
      referenzCache.delete(id);
      sollCache.delete(id);
      if (dataset.meta.referenceStateId === id) dataset.meta.referenceStateId = null;
      if (dataset.meta.targetStateId === id) dataset.meta.targetStateId = null;
      persist(`Stand gelöscht: ${head.name}`);
      return { deleted: id };
    },

    /** Aenderungsstand - zur Erkennung fremder Aenderungen. */
    revision() {
      return {
        revision: Number(dataset.meta.revision ?? 0),
        changedAt: dataset.meta.changedAt ?? null,
        changedBy: dataset.meta.changedBy ?? '',
        lastChange: dataset.meta.lastChange ?? '',
      };
    },

    /* -------------------- Stammdaten -------------------- */

    state() {
      return {
        meta: dataset.meta,
        activeScenarioId: dataset.activeScenarioId,
        projects: dataset.projects,
        templates: dataset.templates,
        workplaces: dataset.workplaces,
        scenarios: dataset.scenarios.map((s) => ({
          id: s.id, name: s.name, description: s.description,
          isBaseline: !!s.isBaseline, parentId: s.parentId ?? null, createdAt: s.createdAt,
          createdBy: s.createdBy ?? '', note: s.note ?? '',
          isCurrentPlan: dataset.currentPlanScenarioId === s.id,
        })),
        currentPlanScenarioId: dataset.currentPlanScenarioId ?? null,
        referenceStateId: dataset.meta.referenceStateId ?? null,
        targetStateId: dataset.meta.targetStateId ?? null,
        history: {
          count: (dataset.history ?? []).filter((e) => e.scenarioId === dataset.activeScenarioId).length,
          canUndo: (dataset.history ?? []).some((e) => e.scenarioId === dataset.activeScenarioId
            && e.by === (actor.name || '') && !e.undone && (e.reverse || e.reverseClear)),
          canRedo: (dataset.history ?? []).some((e) => e.scenarioId === dataset.activeScenarioId
            && e.by === (actor.name || '') && e.undone),
          lastSavedAt: dataset.meta.lastStateAt ?? null,
        },
        catalog: {
          operations: OPERATIONS,
          projectTypes: PROJECT_TYPES,
          variants: VARIANTS,
          priorities: PRIORITIES,
        },
        storage: { kind: store.kind, location: store.location },
        revision: api.revision(),
        actor,
      };
    },

    scenarioConfig(id) {
      const s = scenario(id);
      return { id: s.id, name: s.name, description: s.description, isBaseline: !!s.isBaseline, config: s.config, projectOverrides: s.projectOverrides ?? {}, sequenceOverride: s.sequenceOverride ?? null };
    },

    analysis(scenarioId, range) {
      const a = analyze(dataset, scenarioId || dataset.activeScenarioId, range ?? {});
      // Bestaetigte Befunde ("Thema ist abgestellt") leiser stellen.
      a.plausibility = wendeBestaetigungenAn(a.plausibility, dataset.meta.plausiAck ?? []);
      return a;
    },

    /* -------------------- Bestaetigte Befunde -------------------- */

    /**
     * Einen Befund der Plausibilitaetspruefung bestaetigen.
     *
     * Auftrag der Abteilungsleitung: "Ich moechte Fehlermeldungen auch
     * bestaetigen und wegklicken koennen, wenn das Thema abgestellt ist."
     *
     * Bewusst nicht "loeschen": Der Befund bleibt in der Liste, zaehlt aber
     * nicht mehr in Kachel und Ampel. Wird der Sachverhalt dringender,
     * meldet er sich von allein wieder (siehe wendeBestaetigungenAn).
     * Die Bestaetigung gilt fuer alle - eine Abteilung, ein Stand.
     *
     * @param {{key?:string, level?:string, note?:string, title?:string}} data
     */
    ackFinding(data = {}) {
      const key = String(data.key ?? '').trim();
      if (!key) throw new ApiError('Ohne Kennung lässt sich der Befund nicht merken.');
      const level = PLAUSI_LEVEL[data.level] ?? PLAUSI_LEVEL.HINWEIS;
      const liste = (dataset.meta.plausiAck ??= []);
      const vorhanden = liste.find((x) => x.key === key);
      const eintrag = vorhanden ?? { key };
      eintrag.level = level;
      eintrag.title = String(data.title ?? eintrag.title ?? '');
      eintrag.note = String(data.note ?? '');
      eintrag.user = actor.name || '';
      eintrag.at = new Date().toISOString();
      if (!vorhanden) liste.push(eintrag);
      persist(`Befund bestätigt: ${eintrag.title || key}`);
      return deepClone(eintrag);
    },

    /** Bestaetigung zuruecknehmen - der Befund zaehlt wieder mit. @param {string} key */
    unackFinding(key) {
      const liste = dataset.meta.plausiAck ?? [];
      const i = liste.findIndex((x) => x.key === key);
      if (i < 0) throw new ApiError('Dieser Befund ist nicht bestätigt.');
      const [weg] = liste.splice(i, 1);
      persist(`Bestätigung aufgehoben: ${weg.title || weg.key}`);
      return { deleted: weg.key };
    },

    /** Alle Bestaetigungen ansehen. */
    acks() {
      return (dataset.meta.plausiAck ?? []).map((x) => deepClone(x));
    },

    /** Alle Bestaetigungen aufheben (Neustart der Pruefung). */
    clearAcks() {
      const n = (dataset.meta.plausiAck ?? []).length;
      dataset.meta.plausiAck = [];
      if (n > 0) persist('Alle Bestätigungen aufgehoben');
      return { deleted: n };
    },

    /* -------------------- Mannschaft und Einsatzplan -------------------- */

    /**
     * Mannschaft eines Szenarios: Kuerzel, Qualifikationen, Abwesenheiten.
     */
    team(scenarioId) {
      const cfg = scenario(scenarioId || dataset.activeScenarioId).config;
      const team = cfg.workforce?.team ?? defaultTeam();
      return {
        source: team.source ?? 'ZAHLEN',
        enforceSkills: team.enforceSkills !== false,
        people: deepClone(team.people ?? []),
        operations: OPERATIONS.map((o) => ({ id: o.id, name: o.name })),
        shifts: SHIFTS,
        absenceKinds: ABSENCE_KINDS,
        sickRate: cfg.workforce?.sickRate ?? 0,
        /**
         * Wer am Stichtag WIRKLICH in die Rechnung eingeht - mit Namen.
         *
         * Rueckfrage aus der Abteilung: "Warum wird immer automatisch
         * Personal geplant, das nicht in der Mannschaftsliste ist?" Solange
         * nur eine Summe dasteht, bleibt das Raten. Deshalb liefert die
         * Schnittstelle die Namen mit - und die Zahl aus den Zahlenlisten
         * getrennt daneben.
         */
        gerechnet: gerechneteBesetzung(cfg),
      };
    },

    /**
     * Urlaubsplanung einlesen - reine Vorschau, aendert nichts.
     *
     * @param {string} text  eingefuegte Tabelle
     * @param {{year?:number, codes?:Record<string,boolean>}} [opts]
     */
    parseAttendance(text, opts = {}) {
      if (!String(text ?? '').trim()) throw new ApiError('Es wurde keine Tabelle eingefügt.');
      let m;
      try {
        m = parseAttendanceMatrix(text, opts);
      } catch (e) {
        throw new ApiError(e instanceof Error ? e.message : 'Die Tabelle konnte nicht gelesen werden.');
      }
      return {
        from: m.from,
        to: m.to,
        dates: m.dates,
        workdays: m.workdays,
        rows: m.rows.map((r) => ({
          index: r.index, label: r.label, days: r.days,
          anwesend: r.anwesend, abwesend: r.abwesend, unbekannt: r.unbekannt,
          absences: r.absences,
        })),
        unknownCodes: m.unknownCodes,
        warnings: m.warnings,
        perWeek: absentPerWeek(m, opts.codes ?? {}),
      };
    },

    /**
     * Eingelesene Urlaubsplanung uebernehmen.
     *
     * Zugeordnete Zeilen werden zur echten Abwesenheit der Person.
     * Nicht zugeordnete Zeilen gehen als Anzahl je Tag in die Rechnung -
     * besser als sie wegzuwerfen, aber ausdruecklich als solche gefuehrt.
     *
     * @param {string} scenarioId
     * @param {{text?:string, year?:number, codes?:Record<string,boolean>,
     *   mapping?:Record<string,string>, replace?:boolean}} [opts]
     */
    applyAttendance(scenarioId, opts = {}) {
      const s = scenario(scenarioId || dataset.activeScenarioId);
      const cfg = s.config;
      let m;
      try {
        m = parseAttendanceMatrix(opts.text, { year: opts.year, codes: opts.codes ?? {} });
      } catch (e) {
        throw new ApiError(e instanceof Error ? e.message : 'Die Tabelle konnte nicht gelesen werden.');
      }
      const mapping = opts.mapping ?? {};
      const people = cfg.workforce?.team?.people ?? [];
      const bekannt = new Set(people.map((p) => p.id));
      for (const personId of Object.values(mapping)) {
        if (!personId) continue;
        if (!bekannt.has(personId)) throw new ApiError(`Kürzel ${personId} gibt es nicht.`);
      }
      // Eine Person darf nicht zwei Zeilen bekommen
      const doppelt = Object.values(mapping).filter(Boolean);
      if (new Set(doppelt).size !== doppelt.length) {
        throw new ApiError('Ein Kürzel ist zwei Zeilen zugeordnet. Bitte je Zeile ein eigenes Kürzel.');
      }

      const von = m.from;
      const bis = m.to;
      let gesetzt = 0;
      const zugeordnet = new Set();
      for (const r of m.rows) {
        const personId = mapping[String(r.index)];
        if (!personId) continue;
        zugeordnet.add(r.index);
        const p = people.find((x) => x.id === personId);
        const alt = (p.absences ?? []).filter((a) => {
          if (opts.replace === false) return true;
          // Abwesenheiten im eingelesenen Zeitraum werden ersetzt
          const to = a.to || a.from;
          return to < von || a.from > bis;
        });
        p.absences = [...alt, ...r.absences.map((a) => ({
          from: a.from, to: a.to, kind: a.kind,
          note: `Urlaubsplanung (${a.code})`,
        }))];
        gesetzt += r.absences.length;
      }

      // Nicht zugeordnete Zeilen: Anzahl je Tag
      const offen = { dates: m.dates, rows: m.rows.filter((r) => !zugeordnet.has(r.index)) };
      const jeTag = absentPerDay(offen, opts.codes ?? {});
      const vorher = { ...(cfg.workforce.plannedAbsences ?? {}) };
      for (const d of m.dates) delete vorher[d];
      for (const [d, n] of Object.entries(jeTag)) if (n > 0) vorher[d] = n;
      cfg.workforce.plannedAbsences = vorher;
      cfg.workforce.attendanceCodes = { ...(cfg.workforce.attendanceCodes ?? {}), ...(opts.codes ?? {}) };
      cfg.workforce.attendanceImport = {
        from: von, to: bis, rows: m.rows.length,
        assigned: zugeordnet.size,
        open: m.rows.length - zugeordnet.size,
        codes: opts.codes ?? {},
        unknownCodes: m.unknownCodes.map((c) => c.code),
        importedAt: new Date().toISOString(),
        by: actor.name || 'unbekannt',
      };
      persist(`Urlaubsplanung ${formatDE(von)}–${formatDE(bis)} eingelesen `
        + `(${zugeordnet.size} von ${m.rows.length} Zeilen zugeordnet)`);
      return {
        from: von, to: bis,
        assigned: zugeordnet.size,
        open: m.rows.length - zugeordnet.size,
        absencesWritten: gesetzt,
        plannedAbsenceDays: Object.keys(jeTag).filter((d) => jeTag[d] > 0).length,
      };
    },

    /**
     * Einsatzplan: welche Person macht wann an welchem Auftrag was.
     * Wird auf Abruf gerechnet, nicht bei jeder Kennzahlenanzeige.
     */
    assignment(scenarioId, range = {}) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      if (peopleOf(input.config).length === 0) return null;
      const result = runSchedule(input);
      const plan = assignPeople(result, input.config, range);
      return {
        planningDate: input.config.planningDate,
        weeks: [...new Set(plan.days.map((d) => d.weekKey))],
        people: plan.people,
        unassignedHours: plan.unassignedHours,
        days: plan.days,
        schichtplan: plan.schichtplan,
        unbesetzteSchichten: plan.unbesetzteSchichten,
        /**
         * Luecken-Report (Nutzeranforderung 25.09.2026: "welcher Arbeit ist
         * aus welchem Grund nicht freigegeben?") - kam bisher gar nicht
         * beim Client an, obwohl engine/assignment.js es schon lieferte.
         */
        luecken: plan.luecken,
        lueckenJeGrund: plan.lueckenJeGrund,
        lueckenJeWocheUndOp: plan.lueckenJeWocheUndOp,
      };
    },

    /**
     * Belegungsgitter: Zeilen = Arbeitsplatz oder Mitarbeiter, Spalten = Tage.
     * Wird auf Abruf gerechnet, nicht bei jeder Kennzahlenanzeige.
     *
     * @param {string} scenarioId
     * @param {{mode?:string, from?:string, to?:string}} [opts]
     */
    belegung(scenarioId, opts = {}) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      const result = runSchedule(input);
      const person = opts.mode === BOARD_MODE.PERSON;
      const plan = person && peopleOf(input.config).length > 0
        ? assignPeople(result, input.config, { from: opts.from, to: opts.to })
        : null;
      return board(input, result, { ...opts, assignment: plan });
    },

    /* -------------------- Gespeicherte Ansichten -------------------- */

    /**
     * Ansichten des angemeldeten Kuerzels.
     *
     * Eine Ansicht ist eine Zusammenstellung von Filtern und Einstellungen
     * der Oberflaeche ("nur P1, nur Saegen, KW 40-44") unter einem Namen.
     * Bewusst am Server und nicht im Browser: Die Abteilungsleitung
     * arbeitet an mehreren Rechnern - eine Ansicht, die nur auf einem
     * Rechner existiert, waere keine Hilfe.
     *
     * Jeder sieht nur die eigenen Ansichten.
     */
    views() {
      const alle = dataset.meta.views ?? [];
      const wer = actor.name || '';
      return alle.filter((v) => v.user === wer).map((v) => deepClone(v));
    },

    /** @param {{name?:string, payload?:any, id?:string}} data */
    saveView(data = {}) {
      const name = String(data.name ?? '').trim();
      if (!name) throw new ApiError('Die Ansicht braucht einen Namen.');
      if (!actor.name) throw new ApiError('Ansichten werden je Kürzel gespeichert – bitte anmelden.');
      const liste = (dataset.meta.views ??= []);
      const vorhanden = liste.find((v) => v.user === actor.name
        && (v.id === data.id || v.name.toLowerCase() === name.toLowerCase()));
      const eintrag = vorhanden ?? { id: makeId('ANS'), user: actor.name };
      eintrag.name = name;
      eintrag.payload = deepClone(data.payload ?? {});
      eintrag.changedAt = new Date().toISOString();
      if (!vorhanden) liste.push(eintrag);
      persist(`Ansicht gespeichert: ${name}`);
      return deepClone(eintrag);
    },

    /** @param {string} id */
    deleteView(id) {
      const liste = dataset.meta.views ?? [];
      const i = liste.findIndex((v) => v.id === id && v.user === (actor.name || ''));
      if (i < 0) throw new ApiError('Diese Ansicht gibt es nicht (oder sie gehört einem anderen Kürzel).');
      const [weg] = liste.splice(i, 1);
      persist(`Ansicht gelöscht: ${weg.name}`);
      return { deleted: weg.id };
    },

    /** Wochenplan einer einzelnen Person. */
    personPlan(scenarioId, personId, weekKey) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      if (peopleOf(input.config).length === 0) return null;
      const plan = assignPeople(runSchedule(input), input.config);
      const wk = weekKey || plan.days[0]?.weekKey;
      return { personId, weekKey: wk, days: personWeek(plan, personId, wk) };
    },

    setActiveScenario(id) {
      scenario(id);
      dataset.activeScenarioId = id;
      persist();
      return { activeScenarioId: id };
    },

    /* -------------------- Projekte -------------------- */

    createProject(data) {
      const p = createProject({ ...data, id: data?.id || makeId('PRJ') });
      if (dataset.projects.some((x) => x.id === p.id)) throw new ApiError('Projekt-ID bereits vergeben.');
      if (!p.sequence) p.sequence = (Math.max(0, ...dataset.projects.map((x) => x.sequence ?? 0)) + 10);
      dataset.projects.push(p);
      persist(`Projekt angelegt: ${p.orderNo || p.name}`);
      return p;
    },

    updateProject(id, patch) {
      const p = project(id);
      const vorher = { ...p };
      const next = { ...p, ...patch, id: p.id };
      Object.assign(p, next);
      persist(`${p.orderNo || p.name}: ${describeProjectPatch(patch, vorher) || 'geändert'}`);
      return p;
    },

    deleteProject(id) {
      const idx = dataset.projects.findIndex((x) => x.id === id);
      if (idx < 0) throw new ApiError(`Projekt ${id} nicht gefunden.`, 404);
      const [removed] = dataset.projects.splice(idx, 1);
      for (const s of dataset.scenarios) {
        if (s.projectOverrides) delete s.projectOverrides[id];
        if (Array.isArray(s.sequenceOverride)) s.sequenceOverride = s.sequenceOverride.filter((x) => x !== id);
      }
      persist(`Projekt gelöscht: ${removed.orderNo || removed.name}`);
      return { deleted: id };
    },

    duplicateProject(id) {
      const p = project(id);
      const copy = deepClone(p);
      copy.id = makeId('PRJ');
      copy.orderNo = `${p.orderNo || 'KOPIE'}-K`;
      copy.name = `${p.name} (Kopie)`;
      copy.sequence = (p.sequence ?? 0) + 5;
      copy.formerIds = [];
      dataset.projects.push(copy);
      persist(`Projekt dupliziert: ${p.orderNo || p.name}`);
      return copy;
    },

    reorderProjects(ids) {
      if (!Array.isArray(ids)) throw new ApiError('Liste der Projekt-IDs erwartet.');
      ids.forEach((id, i) => {
        const p = dataset.projects.find((x) => x.id === id);
        if (p) p.sequence = (i + 1) * 10;
      });
      persist('Fertigungsreihenfolge geändert');
      return dataset.projects.map((p) => ({ id: p.id, sequence: p.sequence }));
    },

    /* -------------------- Arbeitsfolgen -------------------- */

    updateTemplate(key, tpl) {
      if (!dataset.templates[key]) throw new ApiError(`Arbeitsfolge ${key} nicht gefunden.`, 404);
      dataset.templates[key] = { ...dataset.templates[key], ...tpl, key };
      persist(`Arbeitsfolge geändert: ${key}`);
      return dataset.templates[key];
    },

    resetTemplates() {
      dataset.templates = defaultRoutingTemplates();
      persist('Arbeitsfolgen zurückgesetzt');
      return dataset.templates;
    },

    /* -------------------- Arbeitsplaetze -------------------- */

    updateWorkplaces(list) {
      if (!Array.isArray(list)) throw new ApiError('Liste erwartet.');
      dataset.workplaces = list;
      persist('Arbeitsplätze geändert');
      return dataset.workplaces;
    },

    /* -------------------- Szenarien -------------------- */

    createScenario({ name, sourceId = 'BASELINE', note = '' }) {
      const copy = duplicateScenario(dataset, sourceId || 'BASELINE', name);
      copy.createdBy = actor.name || '';
      copy.note = String(note || '');
      persist(`Szenario angelegt: ${copy.name}`);
      return copy;
    },

    /**
     * Markiert ein Szenario als den Plan, der gerade gilt.
     * Alle Kollegen sehen daran, woran sich die Fertigung orientiert.
     */
    setCurrentPlan(id) {
      if (id === null) {
        dataset.currentPlanScenarioId = null;
        persist('Aktueller Plan aufgehoben');
        return { currentPlanScenarioId: null };
      }
      const s = scenario(id);
      dataset.currentPlanScenarioId = s.id;
      persist(`Aktueller Plan: ${s.name}`);
      return { currentPlanScenarioId: s.id };
    },

    /**
     * Ändert ein Szenario.
     *
     * `patch.clear` nennt Pfade, die geleert werden sollen (z. B.
     * "workforce.weekly"). Das ist nötig, weil ein leeres Objekt beim
     * Zusammenführen nichts entfernen würde – dort stünden die alten
     * Einträge sonst weiter.
     */
    updateScenario(id, patch, options = {}) {
      const s = scenario(id);
      const parts = [];
      // Gegenstueck VOR der Aenderung sichern, sonst ist der alte Wert weg.
      const reverse = patch.config ? gegenstueck(s.config, patch.config) : null;
      const reverseClear = (patch.clear ?? []).length
        ? Object.fromEntries((patch.clear ?? []).map((pfad) => [pfad, deepClone(valueAt(s.config, pfad))]))
        : null;
      const kpisBefore = options.skipHistory ? null : kennzahlen(id);
      if (patch.name != null && String(patch.name) !== s.name) {
        parts.push(`umbenannt in „${patch.name}"`);
        s.name = String(patch.name);
      }
      if (patch.description != null) s.description = String(patch.description);
      if (patch.config) {
        parts.push(...describeConfigPatch(patch.config, s.config));
        s.config = deepMerge(s.config, patch.config);
      }
      if (patch.replaceConfig) { s.config = deepClone(patch.replaceConfig); parts.push('alle Werte ersetzt'); }
      for (const pfad of patch.clear ?? []) {
        const teile = String(pfad).split('.');
        const letzter = teile.pop();
        let ziel = s.config;
        for (const t of teile) ziel = ziel?.[t];
        if (!ziel || !letzter) continue;
        const alt = ziel[letzter];
        ziel[letzter] = Array.isArray(alt) ? [] : {};
        parts.push(CLEAR_LABELS[pfad] ?? `${pfad} geleert`);
      }
      if (patch.projectOverrides) s.projectOverrides = patch.projectOverrides;
      if (patch.sequenceOverride !== undefined) s.sequenceOverride = patch.sequenceOverride;
      if (patch.measures) s.measures = patch.measures;
      const label = parts.length ? parts.join(', ') : 'Szenario geändert';
      if (!options.skipHistory && (patch.config || patch.clear?.length || patch.replaceConfig)) {
        verlaufSchreiben({
          scenarioId: s.id,
          label,
          patch: patch.config ?? null,
          clear: patch.clear ?? null,
          reverse,
          reverseClear,
          kpisBefore,
        });
      }
      persist(parts.length
        ? `${s.name}: ${parts.join(', ')}`
        : `Szenario geändert: ${s.name}`);
      return s;
    },

    /* -------------------- Versuchsverlauf -------------------- */

    /**
     * Der Versuchsverlauf eines Szenarios - neueste Aenderung zuerst.
     * Zurueckgedreht werden darf nur, was man selbst geaendert hat.
     */
    history(scenarioId, limit = 60) {
      const id = scenarioId || dataset.activeScenarioId;
      const alle = (dataset.history ?? []).filter((e) => e.scenarioId === id);
      const liste = alle.slice(-Math.max(1, Number(limit) || 60)).reverse();
      return {
        scenarioId: id,
        total: alle.length,
        entries: liste.map((e) => ({
          id: e.id,
          at: e.at,
          by: e.by,
          label: e.label,
          note: e.note ?? '',
          pinned: !!e.pinned,
          kpis: e.kpis,
          effect: e.effect,
          /** Ohne Wirkung - in der Liste grau */
          withoutEffect: !!e.effect && Math.abs(e.effect.lateDays) < 0.5 && Math.abs(e.effect.otd) < 0.05,
          mine: e.by === (actor.name || ''),
          canUndo: e.by === (actor.name || '') && !!(e.reverse || e.reverseClear),
        })),
        pinned: alle.filter((e) => e.pinned).map((e) => e.id),
      };
    },

    /** Notiz oder Name eines Versuchs aendern. */
    updateHistoryEntry(entryId, { note, pinned }) {
      const e = (dataset.history ?? []).find((x) => x.id === entryId);
      if (!e) throw new ApiError('Dieser Schritt ist nicht mehr im Verlauf.', 404);
      if (note != null) e.note = String(note).slice(0, 200);
      if (pinned != null) {
        const angepinnt = (dataset.history ?? []).filter((x) => x.pinned && x.id !== entryId);
        if (pinned && angepinnt.length >= 3) {
          throw new ApiError('Es lassen sich höchstens drei Versuche gleichzeitig vergleichen.');
        }
        e.pinned = !!pinned;
      }
      persist(`Versuch beschriftet: ${e.note || e.label}`);
      return { id: e.id, note: e.note, pinned: e.pinned };
    },

    /**
     * Schritt zurueck: dreht die eigene letzte Aenderung zurueck.
     * Aenderungen der Kollegen bleiben unangetastet.
     */
    undo(scenarioId) {
      const id = scenarioId || dataset.activeScenarioId;
      const eigene = (dataset.history ?? [])
        .filter((e) => e.scenarioId === id && e.by === (actor.name || '') && !e.undone);
      const letzter = eigene.at(-1);
      if (!letzter) throw new ApiError('Es gibt keinen eigenen Schritt, der zurückgenommen werden kann.');
      return verlaufAnwenden(letzter, 'zurück');
    },

    /** Schritt vor: nimmt die letzte Ruecknahme wieder zurueck. */
    redo(scenarioId) {
      const id = scenarioId || dataset.activeScenarioId;
      const rueckgenommen = (dataset.history ?? [])
        .filter((e) => e.scenarioId === id && e.by === (actor.name || '') && e.undone);
      const letzter = rueckgenommen.at(-1);
      if (!letzter) throw new ApiError('Es gibt nichts, was wieder hergestellt werden könnte.');
      return verlaufAnwenden(letzter, 'vor');
    },

    /**
     * Auf den Stand eines Versuchs zurueckspringen: alle eigenen Schritte
     * danach werden zurueckgedreht.
     */
    jumpToHistory(entryId) {
      const alle = dataset.history ?? [];
      const index = alle.findIndex((e) => e.id === entryId);
      if (index < 0) throw new ApiError('Dieser Schritt ist nicht mehr im Verlauf.', 404);
      const ziel = alle[index];
      const danach = alle.slice(index + 1)
        .filter((e) => e.scenarioId === ziel.scenarioId && !e.undone);
      const fremd = danach.filter((e) => e.by !== (actor.name || ''));
      if (fremd.length > 0) {
        throw new ApiError(`Dazwischen liegen ${fremd.length} Änderungen von ${[...new Set(fremd.map((e) => e.by))].join(', ')}. `
          + 'Fremde Änderungen werden nicht zurückgenommen.');
      }
      for (const e of [...danach].reverse()) verlaufAnwenden(e, 'zurück', { still: true });
      persist(`Zurück zum Versuch: ${ziel.note || ziel.label}`);
      return { id: ziel.id, undone: danach.length };
    },

    deleteScenario(id) {
      const s = scenario(id);
      if (s.isBaseline) throw new ApiError('Die Baseline kann nicht gelöscht werden.');
      dataset.scenarios = dataset.scenarios.filter((x) => x.id !== id);
      if (dataset.activeScenarioId === id) dataset.activeScenarioId = 'BASELINE';
      persist(`Szenario gelöscht: ${s.name}`);
      return { deleted: id };
    },

    resetScenario(id) {
      const s = resetScenario(dataset, id);
      persist(`Szenario zurückgesetzt: ${s.name}`);
      return s;
    },

    /* -------------------- IST-Stand (Referenz) -------------------- */

    /**
     * Legt einen gespeicherten Stand als IST-Stand fest. Alle Kennzahlen
     * werden anschliessend zusaetzlich als Abweichung dazu gezeigt.
     */
    setReferenceState(id) {
      if (id === null) {
        dataset.meta.referenceStateId = null;
        persist('IST-Stand aufgehoben');
        return { referenceStateId: null };
      }
      const head = store.states?.().find((s) => s.id === id);
      if (!head) throw new ApiError('Stand nicht gefunden.', 404);
      dataset.meta.referenceStateId = id;
      persist(`IST-Stand festgelegt: ${head.name}`);
      return { referenceStateId: id, name: head.name };
    },

    /**
     * Speichert den aktuellen Stand und legt ihn sofort als IST-Stand fest.
     */
    fixCurrentAsReference({ name, note }) {
      const head = api.saveState({
        name: name || `IST-Stand ${formatDE(new Date().toISOString().slice(0, 10))}`,
        note: note || 'Als IST-Stand fixiert – Grundlage für alle Vergleiche.',
      });
      dataset.meta.referenceStateId = head.id;
      persist(`IST-Stand festgelegt: ${head.name}`);
      return head;
    },

    /**
     * Kennzahlen des IST-Standes und die Abweichung des aktuellen Standes.
     * Ohne festgelegten IST-Stand: null.
     */
    reference(scenarioId) {
      const id = dataset.meta.referenceStateId;
      if (!id) return null;
      const head = store.states?.().find((s) => s.id === id);
      if (!head) return null;
      const data = store.stateData?.(id);
      if (!data) return null;

      /*
       * Der IST-Stand friert die KAPAZITAETSSEITE ein - Besetzung, Schichten,
       * Plaetze, Maschinen, Regeln -, nicht den Auftragsbestand. Gerechnet
       * wird er deshalb mit den HEUTIGEN Auftraegen.
       *
       * Damit vergleicht man nicht Aepfel mit Birnen ("damals waren es
       * andere Auftraege"), sondern beantwortet die Frage, um die es geht:
       * Was wuerde aus dem heutigen Auftragsbestand unter den alten
       * Bedingungen - und was unter den jetzigen?
       */
      const istConfig = getScenario(data, data.activeScenarioId).config;
      const szenario = scenarioId || dataset.activeScenarioId;
      // Der IST-Stand haengt nur an den AUFTRAEGEN, nicht an den
      // Stellschrauben - sonst wuerde er bei jeder Reglerbewegung neu
      // gerechnet, obwohl sich an ihm nichts aendert.
      const auftragsStand = dataset.projects
        .map((p2) => `${p2.id}|${p2.dueDate}|${p2.progressPercent ?? ''}|${p2.active !== false ? 1 : 0}`).join(';');
      const cacheKey = `${id}:${szenario}:${auftragsStand.length}:${simpleHash(auftragsStand)}`;
      if (!referenzCache.has(cacheKey)) {
        referenzCache.clear();
        const alsIst = deepClone(dataset);
        const ziel = getScenario(alsIst, szenario);
        ziel.config = deepClone(istConfig);
        const ev = evaluate(materialize(alsIst, szenario));
        referenzCache.set(cacheKey, { kpis: summarize(ev.kpis), result: ev.result, weeks: ev.weeks });
      }
      const ist = referenzCache.get(cacheKey);
      const jetzt = evaluate(materialize(dataset, szenario));

      return {
        state: head,
        ist: ist.kpis,
        jetzt: summarize(jetzt.kpis),
        delta: kpiDelta(ist.kpis, jetzt.kpis),
        projectChanges: projectStatusDiff(ist.result, jetzt.result),
        /** Kapazitaetslinie des IST-Standes fuer das Diagramm */
        istWeeks: weekListOf(ist.weeks).map((w) => ({ weekKey: w.weekKey, capacity: w.capacity })),
        istConfig,
        /** Womit sich die Stellschrauben unterscheiden */
        changes: configDifferences(istConfig, getScenario(dataset, szenario).config),
      };
    },

    /* -------------------- SOLL-Stand (Ziel) -------------------- */

    /**
     * Legt einen gespeicherten Stand als SOLL-Stand fest.
     *
     * Der Ablauf der Abteilungsleitung: "Ist-Stand angeben, Defizite sehen
     * und nach und nach abstellen. Der IST-Stand bleibt unveraendert, ich
     * passe so lange an, bis wir eine akzeptable OTD haben. Ziel ist, den
     * Plan zu haben und als SOLL-Stand festzulegen - der SOLL-Stand wird
     * dann zukuenftig zum IST-Stand."
     *
     * Drei Punkte also: IST (woher), heute (woran gearbeitet wird), SOLL
     * (wohin). Erreicht die Wirklichkeit den SOLL, wird er mit
     * `promoteTargetToReference` zum neuen IST.
     *
     * @param {string|null} id
     */
    setTargetState(id) {
      if (id === null) {
        dataset.meta.targetStateId = null;
        persist('SOLL-Stand aufgehoben');
        return { targetStateId: null };
      }
      const head = store.states?.().find((s) => s.id === id);
      if (!head) throw new ApiError('Stand nicht gefunden.', 404);
      if (dataset.meta.referenceStateId === id) {
        throw new ApiError('Dieser Stand ist bereits der IST-Stand – ein Ziel muss sich davon unterscheiden.');
      }
      dataset.meta.targetStateId = id;
      persist(`SOLL-Stand festgelegt: ${head.name}`);
      return { targetStateId: id, name: head.name };
    },

    /**
     * Speichert den aktuellen Stand und legt ihn als SOLL-Stand fest.
     *
     * Das Szenario, aus dem der SOLL entstanden ist, wird zugleich als
     * "aktueller Plan" markiert - sonst wuesste die Mannschaft nicht,
     * woran sie sich orientieren soll.
     *
     * @param {{name?:string, note?:string}} data
     */
    fixCurrentAsTarget({ name, note } = {}) {
      const head = api.saveState({
        name: name || `SOLL-Stand ${formatDE(new Date().toISOString().slice(0, 10))}`,
        note: note || 'Als SOLL-Stand festgelegt – das ist der Plan, auf den hingearbeitet wird.',
      });
      dataset.meta.targetStateId = head.id;
      const aktiv = getScenario(dataset, dataset.activeScenarioId);
      if (aktiv) dataset.currentPlanScenarioId = aktiv.id;
      persist(`SOLL-Stand festgelegt: ${head.name}`);
      return head;
    },

    /**
     * Macht den SOLL-Stand zum neuen IST-Stand.
     *
     * Ausdrueckliche Vorgabe: "Der Sollstand wird dann zukuenftig zum
     * IST-Stand." Ab dann misst sich jede weitere Aenderung an ihm, und
     * das Ziel ist wieder offen.
     */
    promoteTargetToReference() {
      const id = dataset.meta.targetStateId;
      if (!id) throw new ApiError('Es ist kein SOLL-Stand festgelegt.');
      const head = store.states?.().find((s) => s.id === id);
      if (!head) throw new ApiError('Der SOLL-Stand ist nicht mehr vorhanden.', 404);
      dataset.meta.referenceStateId = id;
      dataset.meta.targetStateId = null;
      persist(`SOLL-Stand ist jetzt der IST-Stand: ${head.name}`);
      return { referenceStateId: id, targetStateId: null, name: head.name };
    },

    /**
     * Kennzahlen des SOLL-Standes und der Abstand des heutigen Standes dazu.
     * Ohne festgelegten SOLL-Stand: null.
     * @param {string} scenarioId
     */
    target(scenarioId) {
      const id = dataset.meta.targetStateId;
      if (!id) return null;
      const head = store.states?.().find((s) => s.id === id);
      if (!head) return null;
      const data = store.stateData?.(id);
      if (!data) return null;

      // Wie beim IST-Stand: eingefroren wird die KAPAZITAETSSEITE, gerechnet
      // wird mit den heutigen Auftraegen. Sonst vergleicht man zwei
      // verschiedene Auftragsbestaende und nennt es Fortschritt.
      const sollConfig = getScenario(data, data.activeScenarioId).config;
      const szenario = scenarioId || dataset.activeScenarioId;
      const auftragsStand = dataset.projects
        .map((p2) => `${p2.id}|${p2.dueDate}|${p2.progressPercent ?? ''}|${p2.active !== false ? 1 : 0}`).join(';');
      const cacheKey = `${id}:${szenario}:${auftragsStand.length}:${simpleHash(auftragsStand)}`;
      if (!sollCache.has(cacheKey)) {
        sollCache.clear();
        const alsSoll = deepClone(dataset);
        const ziel = getScenario(alsSoll, szenario);
        ziel.config = deepClone(sollConfig);
        const ev = evaluate(materialize(alsSoll, szenario));
        sollCache.set(cacheKey, { kpis: summarize(ev.kpis), result: ev.result });
      }
      const soll = sollCache.get(cacheKey);
      const jetzt = evaluate(materialize(dataset, szenario));
      const delta = kpiDelta(soll.kpis, jetzt.kpis);

      return {
        state: head,
        soll: soll.kpis,
        jetzt: summarize(jetzt.kpis),
        /** Abstand des heutigen Standes zum Ziel */
        delta,
        /** Ist das Ziel erreicht? Dann kann der SOLL zum IST werden. */
        erreicht: Number(jetzt.kpis.otd ?? 0) >= Number(soll.kpis.otd ?? 0)
          && Number(jetzt.kpis.late ?? 0) <= Number(soll.kpis.late ?? 0),
        sollConfig,
        /** Womit sich die Stellschrauben unterscheiden */
        changes: configDifferences(getScenario(dataset, szenario).config, sollConfig),
      };
    },

    /* -------------------- Regeln der Abteilung -------------------- */

    /** Alle Regeln mit Klartext und Befunden. */
    rules(scenarioId) {
      const disabled = new Set(
        getScenario(dataset, scenarioId || dataset.activeScenarioId).config?.rules?.disabled ?? []);
      const issues = checkRules(dataset.rules, { projects: dataset.projects });
      return {
        types: RULE_TYPES,
        rules: dataset.rules.map((r) => ({
          ...r,
          summary: ruleSummary(r, { projects: dataset.projects }),
          issues: issues[r.id] ?? [],
          blocked: hasError(issues[r.id]),
          activeHere: r.enabled !== false && !disabled.has(r.id),
        })),
      };
    },

    /** Satz in eine Regel uebersetzen - es wird nichts gespeichert. */
    parseRule(text) {
      const parsed = parseRuleText(text, { projects: dataset.projects });
      return {
        ...parsed,
        summary: parsed.rule ? ruleSummary(parsed.rule, { projects: dataset.projects }) : '',
      };
    },

    /** Leere Regel einer Art (fuer den Baukasten ohne Freitext). */
    emptyRule(type) {
      const rule = emptyRule(type);
      return { rule, summary: ruleSummary(rule, { projects: dataset.projects }) };
    },

    createRule(rule) {
      if (!rule || !rule.type) throw new ApiError('Es wurde keine Regel übergeben.');
      const next = { ...deepClone(rule), id: rule.id || makeId('REG'), createdBy: actor.name || '', createdAt: new Date().toISOString() };
      const issues = checkRules([...dataset.rules, next], { projects: dataset.projects })[next.id] ?? [];
      if (hasError(issues)) {
        throw new ApiError(`Die Regel ist so nicht möglich: ${issues.filter((i) => i.level === 'FEHLER').map((i) => i.text).join(' ')}`);
      }
      dataset.rules.push(next);
      persist(`Regel angelegt: ${ruleSummary(next, { projects: dataset.projects })}`);
      return { ...next, summary: ruleSummary(next, { projects: dataset.projects }), issues };
    },

    updateRule(id, patch) {
      const idx = dataset.rules.findIndex((r) => r.id === id);
      if (idx < 0) throw new ApiError('Regel nicht gefunden.', 404);
      const next = { ...dataset.rules[idx], ...deepClone(patch), id };
      const others = dataset.rules.filter((r) => r.id !== id);
      const issues = checkRules([...others, next], { projects: dataset.projects })[id] ?? [];
      if (hasError(issues)) {
        throw new ApiError(`Die Regel ist so nicht möglich: ${issues.filter((i) => i.level === 'FEHLER').map((i) => i.text).join(' ')}`);
      }
      dataset.rules[idx] = next;
      persist(`Regel geändert: ${ruleSummary(next, { projects: dataset.projects })}`);
      return { ...next, summary: ruleSummary(next, { projects: dataset.projects }), issues };
    },

    deleteRule(id) {
      const found = dataset.rules.find((r) => r.id === id);
      if (!found) throw new ApiError('Regel nicht gefunden.', 404);
      dataset.rules = dataset.rules.filter((r) => r.id !== id);
      persist(`Regel gelöscht: ${ruleSummary(found, { projects: dataset.projects })}`);
      return { deleted: id };
    },

    /** Regel ein- oder ausschalten (wirkt für alle Stände). */
    setRuleEnabled(id, enabled) {
      const found = dataset.rules.find((r) => r.id === id);
      if (!found) throw new ApiError('Regel nicht gefunden.', 404);
      found.enabled = !!enabled;
      persist(`Regel ${found.enabled ? 'eingeschaltet' : 'ausgeschaltet'}: ${ruleSummary(found, { projects: dataset.projects })}`);
      return { id, enabled: found.enabled };
    },

    /**
     * Wirkung einer Regel: Kennzahlen mit und ohne diese Regel.
     * Es wird nichts gespeichert.
     */
    ruleImpact(id, scenarioId) {
      const found = dataset.rules.find((r) => r.id === id);
      if (!found) throw new ApiError('Regel nicht gefunden.', 404);
      const sid = scenarioId || dataset.activeScenarioId;
      const withRule = evaluate(materialize(dataset, sid));
      const copy = deepClone(dataset);
      copy.rules = copy.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r));
      const without = evaluate(materialize(copy, sid));
      return {
        id,
        summary: ruleSummary(found, { projects: dataset.projects }),
        mit: summarize(withRule.kpis),
        ohne: summarize(without.kpis),
      };
    },

    /* -------------------- Simulation und Optimierung -------------------- */

    /** Wirkung einer Aenderung gegenueber einem Vergleichsszenario (§71). */
    impact(scenarioId, baseId = 'BASELINE') {
      const a = evaluate(materialize(dataset, baseId));
      const b = evaluate(materialize(dataset, scenarioId));
      return {
        base: { id: baseId, name: getScenario(dataset, baseId).name, kpis: summarize(a.kpis) },
        scenario: { id: scenarioId, name: getScenario(dataset, scenarioId).name, kpis: summarize(b.kpis) },
        delta: kpiDelta(a.kpis, b.kpis),
        projectChanges: projectStatusDiff(a.result, b.result),
      };
    },

    /**
     * Erzeugt Loesungsvorschlaege. Es werden KEINE Daten geaendert (§44).
     */
    optimize(scenarioId, { objective = 'MAX_OTD', mode = 'proposals', maxRounds = 4 } = {}) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      if (mode === 'single') {
        const r = optimize(input, { objective, maxRounds });
        return { proposals: [{ title: r.objectiveLabel, ...r }] };
      }
      const proposals = proposeSolutions(input, { maxRounds });
      if (proposals.length === 0) {
        const r = optimize(input, { objective, maxRounds });
        return { proposals: r.measures.length ? [{ title: r.objectiveLabel, ...r }] : [], noMeasuresNeeded: r.kpisBefore.late === 0 };
      }
      return { proposals };
    },

    /** Wirkung jedes einzelnen Hebels - "was bringt wirklich etwas?" */
    whatHelps(scenarioId, options = {}) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      return whatHelps(input, options);
    },

    /**
     * Uebernimmt einen Vorschlag - ausschliesslich nach ausdruecklicher
     * Bestaetigung durch den Anwender (§44).
     */
    applyProposal(scenarioId, { config, measures = null, asNewScenario = false, name = '' }) {
      if (!config) throw new ApiError('Es wurde keine Maßnahmenkonfiguration übergeben.');
      let target;
      if (asNewScenario) {
        target = duplicateScenario(dataset, scenarioId, name || 'Optimiert');
      } else {
        target = scenario(scenarioId);
        if (target.isBaseline) {
          throw new ApiError('Die Baseline darf nicht direkt überschrieben werden. Bitte ein Szenario anlegen.');
        }
      }
      target.config = deepClone(config);
      target.measures = measures ?? [];
      dataset.activeScenarioId = target.id;
      persist(`Maßnahmen übernommen: ${target.name}`);
      return target;
    },

    /* -------------------- Mehraufwand -------------------- */

    /**
     * Schichtvorschlag: Wie muessen die Arbeitsplaetze laufen, damit
     * niemand ohne Platz dasteht - und was fehlt danach noch?
     *
     * Vorgabe der Abteilungsleitung (18.09.2026): "Kein Platz frei ist
     * keine Option, plane dann an den Arbeitsplaetzen so die Schichten
     * dass es maximal effizient ist ... Wenn dann immernoch Arbeitsplaetze
     * fehlen sollen diese angezeigt werden."
     *
     * Wird auf Abruf gerechnet, nicht bei jeder Anzeige: Der Vorschlag
     * terminiert mehrere Staende durch (rund 1 s).
     * @param {string} scenarioId
     */
    schichtvorschlag(scenarioId) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      const result = planeDurch(input);
      const vorschlag = planeSchichten(input, result,
        (config) => planeDurch({ ...input, config }));
      return {
        ...vorschlag,
        /** Wirkung auf den Einsatzplan: wer stand vorher ohne Platz da? */
        leerlaufVorher: leerlaufSumme(assignPeople(result, input.config, {})),
        leerlaufNachher: vorschlag.patch
          ? leerlaufSumme(assignPeople(
            planeDurch({ ...input, config: mitSchichten(input.config, vorschlag.schichten) }),
            mitSchichten(input.config, vorschlag.schichten), {}))
          : null,
      };
    },

    /**
     * Uebernimmt den Schichtvorschlag - wie beim Mehraufwand immer in ein
     * SZENARIO, nie in den laufenden Plan.
     * @param {string} scenarioId
     * @param {{name?:string, note?:string}} data
     */
    applySchichten(scenarioId, data = {}) {
      const quelle = scenarioId || dataset.activeScenarioId;
      const input = materialize(dataset, quelle);
      const result = planeDurch(input);
      const vorschlag = planeSchichten(input, result, (config) => planeDurch({ ...input, config }));
      if (!vorschlag.patch) throw new ApiError('Die Schichten laufen schon so – es gibt nichts zu übernehmen.');
      const name = String(data.name || 'Schichtplan').slice(0, 80);
      const vorhanden = dataset.scenarios.find((sc) => sc.name === name && !sc.isBaseline);
      const ziel = vorhanden ?? duplicateScenario(dataset, quelle, name);
      ziel.config = mitSchichten(input.config, vorschlag.schichten);
      ziel.note = String(data.note
        || `Schichten geplant: ${vorschlag.aenderungen
          .map((a) => `${a.name} ${a.nach}`).join(', ')} – Verspätung `
          + `${vorschlag.verspaetungVorher} → ${vorschlag.verspaetungNachher} Tage`).slice(0, 400);
      ziel.createdBy = actor.name || '';
      dataset.activeScenarioId = ziel.id;
      persist(`Schichtplan übernommen: ${name}`);
      return { id: ziel.id, name: ziel.name, aenderungen: vorschlag.aenderungen };
    },

    /**
     * Mehraufwand eines Standes: was zusaetzlich geleistet werden muss,
     * damit kein Termin faellt - und die vier Wege dorthin.
     * @param {string} scenarioId
     */
    mehraufwand(scenarioId) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      return rechneMehraufwand(input, planeDurch(input));
    },

    /**
     * Uebernimmt eine Massnahme aus der Mehraufwand-Ansicht.
     *
     * Ausdrueckliche Vorgabe der Abteilungsleitung: immer in ein SZENARIO,
     * nie in den laufenden Plan. Der Anwender sieht dann sofort, was uebrig
     * bleibt, und kann das Szenario verwerfen, ohne dass etwas passiert
     * ist. Deshalb legt diese Funktion grundsaetzlich ein neues Szenario an
     * (oder ueberschreibt ein bereits so angelegtes gleichen Namens).
     *
     * @param {string} scenarioId Ausgangsstand
     * @param {{patches?:any[], name?:string, note?:string}} data
     */
    applyMehraufwand(scenarioId, data = {}) {
      const patches = Array.isArray(data.patches) ? data.patches.filter(Boolean) : [];
      if (patches.length === 0) throw new ApiError('Es wurde keine Maßnahme übergeben.');
      const quelle = scenarioId || dataset.activeScenarioId;
      const input = materialize(dataset, quelle);
      const ma = rechneMehraufwand(input, planeDurch(input));
      const wochenKeys = ma.wochen.map((/** @type {any} */ w) => w.weekKey);

      let config = deepClone(input.config);
      for (const patch of patches) config = wendeMassnahmeAn(config, patch, wochenKeys);

      const name = String(data.name || 'Mehraufwand-Paket').slice(0, 80);
      const vorhanden = dataset.scenarios.find((sc) => sc.name === name && !sc.isBaseline);
      const ziel = vorhanden ?? duplicateScenario(dataset, quelle, name);
      ziel.config = config;
      ziel.note = String(data.note || ma.summe || '');
      ziel.createdBy = actor.name || '';
      dataset.activeScenarioId = ziel.id;
      persist(`Mehraufwand übernommen: ${name}`);
      return { id: ziel.id, name: ziel.name };
    },

    compare(ids) {
      const list = (ids && ids.length ? ids : dataset.scenarios.map((s) => s.id)).slice(0, 6);
      return list.map((id) => {
        const s = getScenario(dataset, id);
        const ev = evaluate(materialize(dataset, id));
        return {
          id, name: s.name, isBaseline: !!s.isBaseline,
          kpis: summarize(ev.kpis),
          measures: s.measures ?? [],
          /*
           * Gezaehlt wird, was WIRKT. In der Betriebsart MANNSCHAFT sind das
           * die eingeplanten Leiharbeiter der Liste; die alten Zahlenlisten
           * gehen dort nicht mehr in die Rechnung ein und wuerden hier nur
           * eine Zahl vortaeuschen.
           */
          tempWorkers: eingeplantesZusatzpersonal(s.config, 'LEIHE'),
          newHires: eingeplantesZusatzpersonal(s.config, 'NEU'),
          overtime: s.config?.workforce?.overtimePerEmployeeDefault ?? 0,
          saturdays: Object.values(s.config?.saturday?.weeks ?? {}).filter((w) => w.enabled).length
            + (s.config?.saturday?.enabledDefault ? -1 : 0),
          heftPlaces: s.config?.resources?.heftPlaces,
          welders: s.config?.resources?.welders?.default,
          productivity: s.config?.productivity?.global,
        };
      });
    },

    /** Wie viele Mitarbeiter fehlen fuer 100 % Termintreue, ab wann? */
    requiredStaff(scenarioId, options = {}) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      return requiredAdditionalStaff(input, options);
    },

    validate(scenarioId) {
      const input = materialize(dataset, scenarioId || dataset.activeScenarioId);
      const issues = validate(input);
      return { issues, summary: validationSummary(issues) };
    },

    /* -------------------- Sicherung -------------------- */

    backups() { return store.snapshots(); },
    createBackup(label) { persist(label || `Sicherung ${new Date().toLocaleString('de-DE')}`); return store.snapshots()[0]; },
    restoreBackup(id) {
      const data = store.restore(id);
      if (!data) throw new ApiError('Sicherung nicht gefunden.', 404);
      dataset = data;
      migrate(dataset);
      persist('Sicherung zurückgespielt');
      return api.state();
    },
    resetAll() {
      // Anmeldungen und Protokoll gehoeren zum Betrieb und bleiben erhalten -
      // sonst waere nach dem Zuruecksetzen niemand mehr angemeldet.
      const users = dataset.users;
      const sessions = dataset.sessions;
      const log = dataset.changeLog;
      dataset = seedDataset();
      migrate(dataset);
      dataset.users = users;
      dataset.sessions = sessions;
      dataset.changeLog = log;
      persist('Auf Startdaten zurückgesetzt');
      return api.state();
    },

    /** Ersetzt den gesamten Datenbestand (Sicherungsdatei einlesen). */
    replaceDataset(next) {
      if (!next || !Array.isArray(next.projects) || !Array.isArray(next.scenarios)) {
        throw new ApiError('Die Datei enthält keinen gültigen Datenbestand.');
      }
      const users = dataset.users;
      const sessions = dataset.sessions;
      const log = dataset.changeLog;
      dataset = next;
      migrate(dataset);
      // Kuerzel und Passwoerter dieser Installation behalten - eine
      // eingelesene Sicherung darf niemanden aussperren.
      dataset.users = users;
      dataset.sessions = sessions;
      dataset.changeLog = log;
      persist('Datenbestand eingelesen');
      return api.state();
    },

    /* -------------------- Export / Import -------------------- */

    exportWorkbook(scenarioId) {
      const a = analyze(dataset, scenarioId || dataset.activeScenarioId);
      const sheets = exportSheets(a, dataset);
      // Ist ein IST-Stand festgelegt, gehoert der Vergleich in die Mappe -
      // sonst muesste man ihn beim Weitergeben von Hand nachbauen.
      const ref = api.reference(scenarioId);
      if (ref) sheets.push({ name: 'Vergleich IST', rows: referenceRows(ref) });
      return codec.writeXlsx(sheets);
    },

    exportCsv(scenarioId, type = 'projects') {
      const a = analyze(dataset, scenarioId || dataset.activeScenarioId);
      const sheets = exportSheets(a, dataset);
      const map = { projects: 0, operations: 1, capacity: 2, processes: 3, comparison: 4 };
      const sheet = sheets[map[type] ?? 0];
      return codec.writeCsv(sheet.rows);
    },

    exportComparison(ids) {
      const rows = comparisonRows(api.compare(ids));
      return codec.writeXlsx([{ name: 'Szenariovergleich', rows }]);
    },

    /**
     * Vollstaendiger Datenbestand als JSON - fuer Fehlersuche und als
     * Sicherung außerhalb der Anwendung.
     *
     * Nutzerauftrag (21.09.2026): "Kannst du der Netzwerkversion denselben
     * Datensicherung-Knopf geben wie die Einzeldatei-Fassung?" Die
     * Einzeldatei-Fassung konnte das schon immer (browser/app.js,
     * exportDataset) - nur lokal im Browser, ohne Serveranfrage. Die
     * Netzwerkversion hatte dafuer gar keine Schnittstelle. Nur die
     * Verwaltung darf das: der Export enthaelt auch Kuerzel und - falls
     * gesetzt - Passwort-Hashes der Mannschaft.
     */
    exportDataset() {
      if (!actor.admin) throw new ApiError('Nur die Verwaltung darf den vollständigen Datenbestand exportieren.', 403);
      return JSON.stringify(dataset, null, 1);
    },

    /**
     * Projektimport aus Excel/CSV.
     * @param {{format:string, data:string, mode?:string}} payload
     */
    importProjects({ format, data, mode = 'merge' }) {
      let rows;
      if (format === 'xlsx') {
        const sheets = codec.readXlsx(codec.decodeBase64(data));
        const sheet = sheets.find((s) => /projekt/i.test(s.name)) ?? sheets[0];
        if (!sheet) throw new ApiError('Die Datei enthält keine Tabelle.');
        rows = sheet.rows;
      } else {
        rows = codec.readCsv(data);
      }
      const result = importRows(dataset, rows, mode);
      persist(`Import: ${result.created} neu, ${result.updated} aktualisiert`);
      return result;
    },

    /** Vorlage fuer den Import. */
    importTemplate() {
      return codec.writeXlsx([{
        name: 'Projekte',
        rows: [
          ['Auftrag', 'Kunde', 'Projekt', 'Projektart', 'Variante', 'Fertigstellung', 'Fertigstellung neu', 'Fertig (Gesamtanlage)', 'Prioritaet', 'Reihenfolge', 'Gesamtstunden', 'Fortschritt %', 'Status', 'Bemerkung'],
          ['WGC40-S00500', 'Beispielkunde', 'Beispielprojekt', 'Neubau', '40 ft', '02.10.2026', '', '', 'P2', 10, '', 0, 'offen', ''],
        ],
      }]);
    },
  };

  return api;
}

/* ------------------------------------------------------------------ *
 * Aenderungsprotokoll - Klartext
 * ------------------------------------------------------------------ */

/**
 * Klartextbezeichnungen der Planungsparameter.
 * Damit steht im Protokoll "Belegungszeit je Tag: 12 h" statt eines Pfades.
 */
/** Klartext fuer geleerte Bereiche (Protokoll). */
const CLEAR_LABELS = {
  'workforce.weekly': 'Wochenwerte entfernt',
  'saturday.weeks': 'Samstagsarbeit: aus',
  'resources.byOperation': 'eigene Werte je Arbeitsgang entfernt',
  'resources.operatingHoursByWeek': 'wochenweise Belegungszeiten entfernt',
  'nobo.exceptions': 'NoBo-Kalender zurückgesetzt',
};

const PARAM_LABELS = {
  'planningDate': ['Planungsstichtag', 'date'],
  'horizonDays': ['Planungshorizont', 'tage'],
  'criticalSlackDays': ['Grenze für „knapp"', 'tage'],
  'productivity.global': ['Produktivität', 'prozent'],
  'workforce.baseHeadcount': ['Stammmitarbeiter', 'zahl'],
  'workforce.overtimePerEmployeeDefault': ['Überstunden je MA und Woche', 'stunden'],
  'workforce.maxNewHires': ['Neueinstellungen höchstens', 'zahl'],
  'workTime.regularHoursPerWeek': ['Wochenarbeitszeit', 'stunden'],
  'workTime.saturdayHours': ['Samstagsstunden', 'stunden'],
  'resources.operatingHoursPerDay': ['Belegungszeit je Tag', 'stunden'],
  'resources.heftPlaces': ['Heftplätze', 'zahl'],
  'resources.heftPlacesMax': ['Heftplätze technisch möglich', 'zahl'],
  'resources.welders.default': ['Orbitalschweißer im Einsatz', 'zahl'],
  'resources.welders.qualified': ['qualifizierte Orbitalschweißer', 'zahl'],
  'resources.orbitalMachines': ['Orbitalmaschinen', 'zahl'],
  'resources.orbitalMachinesActive': ['Orbitalmaschinen im Einsatz', 'zahl'],
  'resources.machinesPerWelder': ['Maschinen je Schweißer', 'zahl'],
  'resources.workersPerHeftPlace': ['Mitarbeiter je Heftplatz', 'zahl'],
  'projectLimits.maxParallelProjects': ['Aufträge gleichzeitig', 'zahl'],
  'projectLimits.maxWorkersPerProject': ['Mitarbeiter je Auftrag', 'zahl'],
  'saturday.quota': ['Samstagsquote', 'prozent'],
  'saturday.enabledDefault': ['Samstagsarbeit grundsätzlich', 'janein'],
  'leadTimes.materialWeeks': ['Material verfügbar (Wochen vorher)', 'wochen'],
  'tacking.minLeadHours': ['Heftvorsprung mindestens', 'stunden'],
  'tacking.targetLeadHours': ['Heftvorsprung Zielwert', 'stunden'],
  'tacking.maxLeadHours': ['Heftvorsprung höchstens', 'stunden'],
  'tacking.enforceMaxLead': ['Maximalvorsprung begrenzen', 'janein'],
  'sequencing.rule': ['Fertigungsreihenfolge', 'text'],
  'hydro.requireNoBo': ['Hydro nur bei NoBo', 'janein'],
  'outsourcing.enabled': ['Fremdvergabe', 'janein'],
};

/** Zahl im deutschen Format, ohne unnoetige Nachkommastellen. */
function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return (Math.round(n * 100) / 100).toLocaleString('de-DE');
}

function formatValue(value, kind) {
  if (value == null || value === '') return 'nicht gesetzt';
  switch (kind) {
    case 'prozent': return `${num(Number(value) * 100)} %`;
    case 'stunden': return `${num(value)} h`;
    case 'tage': return `${num(value)} Tage`;
    case 'wochen': return `${num(value)} Wochen`;
    case 'janein': return value ? 'ja' : 'nein';
    case 'date': return formatDE(String(value));
    case 'zahl': return num(value);
    default: return String(value);
  }
}

/**
 * Uebersetzt eine Parameteraenderung in verstaendliche Saetze fuer das
 * Aenderungsprotokoll ("Belegungszeit je Tag: 12 h").
 * @param {any} patch @param {any} [before] bisheriger Stand
 * @returns {string[]}
 */
export function describeConfigPatch(patch, before = null) {
  const out = [];

  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;

      // Sonderfaelle, die als Ganzes beschrieben werden
      if (path === 'workforce.tempWorkers' || path === 'workforce.newHires') {
        const list = Array.isArray(value) ? value : [];
        const sum = list.reduce((a, t) => a + (Number(t?.count) || 0), 0);
        const label = path.endsWith('tempWorkers') ? 'Leiharbeiter' : 'Neueinstellungen';
        out.push(sum > 0
          ? `${label}: ${num(sum)}${list[0]?.from ? ` ab ${formatDE(String(list[0].from))}` : ''}`
          : `${label}: keine`);
        continue;
      }
      if (path === 'workforce.weekly') {
        const n = Object.values(value ?? {}).filter((w) => w && Object.keys(w).length).length;
        out.push(n === 0 ? 'Wochenwerte entfernt' : `Wochenwerte für ${n} Kalenderwochen gepflegt`);
        continue;
      }
      if (path === 'saturday.weeks') {
        const n = Object.values(value ?? {}).filter((w) => w?.enabled).length;
        out.push(n === 0 ? 'Samstagsarbeit: aus' : `Samstagsarbeit: ${n} Wochen`);
        continue;
      }
      if (path === 'resources.byOperation') {
        for (const [opId, werte] of Object.entries(value ?? {})) {
          const name = OPERATION_BY_ID[opId]?.name ?? opId;
          if (werte?.operatingHours != null) out.push(`Belegungszeit ${name}: ${num(werte.operatingHours)} h`);
          else if (werte && 'operatingHours' in werte) out.push(`Belegungszeit ${name}: allgemeiner Wert`);
          if (werte?.places != null) out.push(`Plätze ${name}: ${num(werte.places)}`);
          else if (werte && 'places' in werte) out.push(`Plätze ${name}: keine Begrenzung`);
        }
        if (Object.keys(value ?? {}).length === 0) out.push('Eigene Werte je Arbeitsgang entfernt');
        continue;
      }
      if (path === 'nobo.exceptions') { out.push('NoBo-Kalender geändert'); continue; }
      if (path === 'nobo.weekdays') { out.push('NoBo-Anwesenheit geändert'); continue; }
      if (path === 'hydro.allowedWeekdays') { out.push('Hydro-Wochentage geändert'); continue; }
      if (path === 'skills') { out.push('Einsetzbare Mitarbeiter je Arbeitsgang geändert'); continue; }
      if (path === 'leadTimes.startWeeks') { out.push('Startvorlauf je Auftragsart geändert'); continue; }
      if (path === 'workforce.rampUp') { out.push('Einarbeitungskurven geändert'); continue; }
      if (path === 'holidays') { out.push('Feiertage geändert'); continue; }

      if (value && typeof value === 'object' && !Array.isArray(value)) { walk(value, path); continue; }

      const known = PARAM_LABELS[path];
      if (known) {
        const [label, kind] = known;
        const old = before ? valueAt(before, path) : undefined;
        const now = formatValue(value, kind);
        out.push(old !== undefined && old !== null && String(old) !== String(value)
          ? `${label}: ${formatValue(old, kind)} → ${now}`
          : `${label}: ${now}`);
      } else {
        out.push(`${path}: ${formatValue(value, 'text')}`);
      }
    }
  };

  walk(patch, '');
  return out.slice(0, 6);
}

/**
 * Klartext einer Auftragsaenderung fuer das Protokoll.
 * @param {any} patch @param {any} vorher
 */
export function describeProjectPatch(patch, vorher = {}) {
  const teile = [];
  const labels = {
    orderNo: 'Auftragsnummer', customer: 'Kunde', name: 'Bezeichnung',
    projectType: 'Auftragsart', variant: 'Variante', priority: 'Priorität',
    dueDate: 'Fertigstellung', handoverDate: 'Fertig (Gesamtanlage)',
    totalHoursOverride: 'Gesamtstunden', sequence: 'Position',
    earliestStart: 'frühester Start', materialAvailableFrom: 'Material verfügbar ab',
    note: 'Bemerkung', done: 'komplett fertig',
  };
  for (const [key, wert] of Object.entries(patch ?? {})) {
    if (key === 'progressPercent') {
      teile.push(`Fortschritt ${num(wert)} %${vorher.progressPercent != null && vorher.progressPercent !== wert ? ` (vorher ${num(vorher.progressPercent)} %)` : ''}`);
      continue;
    }
    if (key === 'progressMode') continue;
    if (key === 'operations') { teile.push('Arbeitsgangzeiten geändert'); continue; }
    if (key === 'sequenceLocked') { teile.push(wert ? 'Position fixiert' : 'Position freigegeben'); continue; }
    const label = labels[key];
    if (!label) continue;
    const alt = vorher[key];
    const neu = key.endsWith('Date') || key === 'earliestStart' || key === 'materialAvailableFrom'
      ? formatDE(String(wert ?? ''))
      : typeof wert === 'boolean' ? (wert ? 'ja' : 'nein') : String(wert ?? '–');
    teile.push(alt != null && String(alt) !== String(wert) && key.endsWith('Date')
      ? `${label}: ${formatDE(String(alt))} → ${neu}`
      : `${label}: ${neu}`);
  }
  return teile.slice(0, 4).join(', ');
}

/** Wert an einem Pfad ("a.b.c") lesen. */
/** Kleine Pruefsumme - erkennt geaenderte Auftragsdaten ohne Fremdbibliothek. */
function simpleHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

/** Wochen eines Ergebnisses als sortierte Liste (auch wenn es ein Objekt ist). */
function weekListOf(weeks) {
  if (!weeks) return [];
  return Array.isArray(weeks) ? weeks : weekList(weeks);
}

/**
 * Womit sich zwei Staende in den Stellschrauben unterscheiden.
 * Nur benannte Parameter - damit steht im Vergleich Klartext und keine
 * Liste technischer Pfade.
 */
function configDifferences(a, b) {
  const out = [];
  for (const [path, [label, kind]] of Object.entries(PARAM_LABELS)) {
    const ist = valueAt(a, path);
    const jetzt = valueAt(b, path);
    if (String(ist ?? '') === String(jetzt ?? '')) continue;
    out.push({ label, ist: formatValue(ist, kind), jetzt: formatValue(jetzt, kind) });
  }
  const zahl = (cfg, pfad) => Object.values(valueAt(cfg, pfad) ?? {}).length;
  const leihe = (cfg) => (cfg.workforce?.tempWorkers ?? []).reduce((x, t) => x + (Number(t.count) || 0), 0);
  if (leihe(a) !== leihe(b)) out.push({ label: 'Leiharbeiter', ist: String(leihe(a)), jetzt: String(leihe(b)) });
  const samstage = (cfg) => Object.values(cfg.saturday?.weeks ?? {}).filter((w) => w?.enabled).length;
  if (samstage(a) !== samstage(b)) {
    out.push({ label: 'Samstage', ist: `${samstage(a)} Wochen`, jetzt: `${samstage(b)} Wochen` });
  }
  if (zahl(a, 'workforce.weekly') !== zahl(b, 'workforce.weekly')) {
    out.push({
      label: 'Wochenwerte gepflegt',
      ist: `${zahl(a, 'workforce.weekly')} Wochen`,
      jetzt: `${zahl(b, 'workforce.weekly')} Wochen`,
    });
  }
  const hydro = (cfg) => (cfg.hydro?.allowedWeekdays ?? []).length;
  if (hydro(a) !== hydro(b)) out.push({ label: 'Hydro-Wochentage', ist: `${hydro(a)}`, jetzt: `${hydro(b)}` });
  const nobo = (cfg) => (cfg.nobo?.weekdays ?? []).length;
  if (nobo(a) !== nobo(b)) out.push({ label: 'NoBo-Tage je Woche', ist: `${nobo(a)}`, jetzt: `${nobo(b)}` });
  return out;
}

function valueAt(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/* ------------------------------------------------------------------ *
 * Import / Export - Hilfsfunktionen
 * ------------------------------------------------------------------ */

const TYPE_ALIASES = {
  neubau: 'NEUBAU', umbau: 'UMBAU', wkp: 'WKP', wiederkehrer: 'WKP', 'wkp / wiederkehrer': 'WKP',
  'wag wiederkehrer': 'WKP', reparatur: 'REPARATUR', sonder: 'SONDER', sonderprojekt: 'SONDER',
};
const VARIANT_ALIASES = {
  '20': 'FT20', '20 ft': 'FT20', '20ft': 'FT20', ft20: 'FT20',
  '30': 'FT30', '30 ft': 'FT30', '30ft': 'FT30', ft30: 'FT30',
  '40': 'FT40', '40 ft': 'FT40', '40ft': 'FT40', ft40: 'FT40',
  '45': 'FT45', '45 ft': 'FT45', '45ft': 'FT45', ft45: 'FT45',
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

function findColumn(header, names) {
  for (const n of names) {
    const i = header.findIndex((h) => norm(h) === norm(n));
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = header.findIndex((h) => norm(h).includes(norm(n)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Uebernimmt Zeilen aus einer Import-Tabelle.
 * Regel §51: Ist eine Spalte "Fertigstellung neu" (korrigierter/roter Termin)
 * gefuellt, gilt dieser Termin. Andernfalls der urspruengliche Termin.
 */
export function importRows(dataset, rows, mode = 'merge') {
  const headerIdx = rows.findIndex((r) => r && r.some((c) => /auftrag|projekt|kunde/i.test(String(c ?? ''))));
  if (headerIdx < 0) throw new ApiError('Es wurde keine Kopfzeile mit "Auftrag" oder "Projekt" gefunden.');
  const header = rows[headerIdx].map((c) => String(c ?? ''));

  const col = {
    orderNo: findColumn(header, ['Auftrag', 'Auftragsnummer', 'Auftrags-Nr']),
    customer: findColumn(header, ['Kunde']),
    name: findColumn(header, ['Projekt', 'Bezeichnung', 'Projektname']),
    type: findColumn(header, ['Projektart', 'Art']),
    variant: findColumn(header, ['Variante', 'MEGC', 'Größe']),
    due: findColumn(header, ['Fertigstellung']),
    dueNew: findColumn(header, ['Fertigstellung neu', 'Neuer Termin', 'Termin neu']),
    handover: findColumn(header, ['Fertig (Gesamtanlage)', 'Fertig']),
    priority: findColumn(header, ['Prioritaet', 'Priorität', 'Prio']),
    sequence: findColumn(header, ['Reihenfolge', 'Sequenz']),
    hours: findColumn(header, ['Gesamtstunden', 'Stunden', 'Aufwand']),
    progress: findColumn(header, ['Fortschritt']),
    status: findColumn(header, ['Status']),
    note: findColumn(header, ['Bemerkung', 'Notiz']),
    missing: findColumn(header, ['Fehlteil', 'Fehlteile', 'Material fehlt']),
  };
  if (col.due >= 0 && col.dueNew === col.due) col.dueNew = -1;

  let created = 0; let updated = 0; let skipped = 0;
  const messages = [];
  const seen = new Set();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cell = (i) => (i >= 0 ? row[i] : undefined);
    const orderNo = String(cell(col.orderNo) ?? '').trim();
    const name = String(cell(col.name) ?? '').trim();
    const customer = String(cell(col.customer) ?? '').trim();
    if (!orderNo && !name && !customer) continue;

    const dueRaw = cell(col.due);
    const dueNewRaw = cell(col.dueNew);
    const due = parseDate(String(dueNewRaw ?? '').trim() || String(dueRaw ?? '').trim());
    if (dueNewRaw && !parseDate(String(dueNewRaw))) {
      messages.push(`Zeile ${r + 1}: Korrigierter Termin "${dueNewRaw}" konnte nicht gelesen werden.`);
    }

    const statusText = norm(cell(col.status));
    const typeText = norm(cell(col.type));
    const variantText = norm(cell(col.variant));

    const patch = {
      orderNo,
      customer,
      name: name || customer || orderNo,
      projectType: TYPE_ALIASES[typeText] ?? (typeText ? undefined : undefined),
      variant: VARIANT_ALIASES[variantText] ?? undefined,
      dueDate: due ?? undefined,
      handoverDate: parseDate(String(cell(col.handover) ?? '')) ?? undefined,
      priority: /^p[1-4]$/i.test(String(cell(col.priority) ?? '').trim()) ? String(cell(col.priority)).trim().toUpperCase() : undefined,
      sequence: Number.isFinite(Number(cell(col.sequence))) && cell(col.sequence) !== '' ? Number(cell(col.sequence)) : undefined,
      totalHoursOverride: Number.isFinite(Number(cell(col.hours))) && String(cell(col.hours) ?? '') !== '' ? Number(cell(col.hours)) : undefined,
      note: cell(col.note) != null ? String(cell(col.note)) : undefined,
    };
    // Fehlteile: "ja", "x", "1" oder ein Freitext, der das fehlende Teil nennt
    if (col.missing >= 0) {
      const roh = String(cell(col.missing) ?? '').trim();
      if (roh) {
        patch.missingParts = !/^(nein|no|0|-)$/i.test(roh);
        if (patch.missingParts && !/^(ja|yes|x|1)$/i.test(roh)) patch.missingPartsNote = roh;
      }
    }
    if (col.progress >= 0 && String(cell(col.progress) ?? '') !== '') {
      const v = Number(String(cell(col.progress)).replace('%', '').replace(',', '.'));
      if (Number.isFinite(v)) { patch.progressMode = 'PERCENT'; patch.progressPercent = v <= 1 ? v * 100 : v; }
    }
    if (statusText === 'fertig') patch.done = true;
    if (statusText === 'x') patch.active = false;

    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

    const existing = dataset.projects.find((p) => (orderNo && p.orderNo === orderNo)
      || (!orderNo && name && p.name === name && p.customer === customer));

    if (existing) {
      if (seen.has(existing.id)) { skipped++; messages.push(`Zeile ${r + 1}: Auftrag ${orderNo} kommt mehrfach vor – nur die erste Zeile wurde übernommen.`); continue; }
      Object.assign(existing, patch);
      seen.add(existing.id);
      updated++;
    } else {
      if (mode === 'update-only') { skipped++; continue; }
      const p = createProject({ ...patch, projectType: patch.projectType ?? 'NEUBAU' });
      dataset.projects.push(p);
      seen.add(p.id);
      created++;
    }
  }

  if (mode === 'replace') {
    const before = dataset.projects.length;
    dataset.projects = dataset.projects.filter((p) => seen.has(p.id));
    messages.push(`${before - dataset.projects.length} nicht enthaltene Projekte wurden entfernt.`);
  }

  return { created, updated, skipped, messages, total: dataset.projects.length };
}

/** Erzeugt die Arbeitsblaetter fuer den Export. */
/** Vergleichsblatt fuer die Excel-Mappe (nur wenn ein IST-Stand steht). */
function referenceRows(ref) {
  const zahl = (v, digits = 0) => (v == null ? '' : Number(Number(v).toFixed(digits)));
  const rows = [
    ['Vergleich mit dem IST-Stand'],
    ['IST-Stand', ref.state.name, ref.state.createdBy, formatDE(String(ref.state.createdAt).slice(0, 10))],
    ['Gerechnet mit den heutigen Aufträgen – verglichen wird die Kapazitätsseite.'],
    [],
    ['Kennzahl', 'IST-Stand', 'aktuell', 'Veränderung'],
    ['Termintreue %', zahl(ref.ist.otd, 1), zahl(ref.jetzt.otd, 1), zahl(ref.delta.otd, 1)],
    ['Aufträge zu spät', ref.ist.late, ref.jetzt.late, ref.delta.late],
    ['Verspätung gesamt (Tage)', ref.ist.totalLateDays, ref.jetzt.totalLateDays, ref.delta.totalLateDays],
    ['Kapazität (h)', zahl(ref.ist.availableHours), zahl(ref.jetzt.availableHours), zahl(ref.delta.availableHours)],
    ['Offener Aufwand (h)', zahl(ref.ist.openHours), zahl(ref.jetzt.openHours), zahl(ref.delta.openHours)],
    ['Über Kapazität (h)', zahl(ref.ist.shortfallHours), zahl(ref.jetzt.shortfallHours), zahl(ref.delta.shortfallHours)],
    ['Engste Stelle', ref.ist.bottleneck ?? '', ref.jetzt.bottleneck ?? '', ''],
    [],
    ['Geänderte Stellschrauben', 'IST-Stand', 'aktuell'],
    ...(ref.changes ?? []).map((c) => [c.label, c.ist, c.jetzt]),
    [],
    ['Auftrag', 'Status IST', 'Status aktuell', 'Fertig IST', 'Fertig aktuell', 'Tage'],
    ...(ref.projectChanges ?? []).map((c) => [
      c.orderNo ?? c.id, c.from ?? 'neu', c.to,
      c.forecastBefore ? formatDE(c.forecastBefore) : '',
      c.forecastAfter ? formatDE(c.forecastAfter) : '',
      (c.lateDaysAfter ?? 0) - (c.lateDaysBefore ?? 0),
    ]),
  ];
  return rows;
}

export function exportSheets(a, dataset) {
  const statusText = {
    FERTIG: 'Fertig', IN_TIME: 'In Time', KRITISCH: 'Kritisch',
    VERSPAETET: 'Verspätet', OHNE_TERMIN: 'Ohne Termin',
  };

  const projects = [
    ['Auftrag', 'Kunde', 'Projekt', 'Projektart', 'Variante', 'Priorität', 'Reihenfolge',
      'Fertigstellung (Soll)', 'Prognose', 'Status', 'Verspätung (Tage)', 'Puffer (Tage)',
      'Gesamtstunden', 'Erledigt', 'Reststunden', 'Fortschritt %', 'Frühester Start', 'Hauptursache'],
    ...a.projects.map((p) => [
      p.orderNo, p.customer, p.name, routingLabel(p.projectType, p.variant),
      p.variant ?? '', p.priority, p.sequence,
      formatDE(p.dueDate), p.forecastFinish ? formatDE(p.forecastFinish) : 'nicht planbar',
      statusText[p.status] ?? p.status, p.lateDays, p.slackDays ?? '',
      p.totalManHours, p.doneManHours, p.remainingManHours, p.progressPercent,
      p.releaseDate ? formatDE(p.releaseDate) : '',
      a.rootCauses[p.id]?.causes?.[0]?.label ?? '',
    ]),
  ];

  const operations = [
    ['Auftrag', 'Arbeitsgang', 'Einheit', 'Soll', 'Erledigt', 'Rest', 'Geplante Mannstunden', 'Start', 'Ende'],
    ...a.projects.flatMap((p) => p.operations.filter((o) => o.totalUnits > 0).map((o) => [
      p.orderNo || p.name, o.name, o.unit, o.totalUnits, o.doneUnits, o.remainingUnits,
      o.plannedManHours, o.start ? formatDE(o.start) : '', o.end ? formatDE(o.end) : '',
    ])),
  ];

  const capacity = [
    ['Kalenderwoche', 'Von', 'Bis', 'Kapazität (h)', 'Bedarf (h)', 'Verplant (h)', 'Überlast (h)', 'Auslastung %', 'Ø Mitarbeiter', 'Samstag'],
    ...a.weeks.map((w) => [
      w.weekKey, formatDE(w.from), formatDE(w.to), w.capacity, w.demand, w.planned,
      w.overload, round2(w.utilization * 100), w.avgHeadcount, w.saturday ? 'ja' : 'nein',
    ]),
  ];

  const processes = [
    ['Prozess', 'Einheit', 'Bedarf (Mannstunden)', 'Kapazität (Mannstunden)', 'Verplant', 'Über-/Unterdeckung', 'Auslastung %'],
    ...a.processBalance.map((r) => [
      r.name, r.unit, r.demandManHours, r.capacityManHours, r.plannedManHours, r.balance, r.utilization,
    ]),
  ];

  const management = [
    ['Managementübersicht', ''],
    ['Szenario', a.scenario.name],
    ['Planungsstichtag', formatDE(a.planningDate)],
    ['Projekte gesamt', a.kpis.totalProjects],
    ['Fertig', a.kpis.done],
    ['In Time', a.kpis.inTime],
    ['Kritisch', a.kpis.critical],
    ['Verspätet', a.kpis.late],
    ['OTD %', a.kpis.otd],
    ['Offene Stunden', a.kpis.openHours],
    ['Verfügbare Stunden', a.kpis.availableHours],
    ['Überlaststunden', a.kpis.overloadHours],
    ['Erste Überlast', a.kpis.firstOverloadWeek ?? '-'],
    ['Größter Engpass', a.kpis.bottleneck?.label ?? '-'],
    ['Zusatzbedarf (MA-Wochen)', a.kpis.requiredFteWeeks],
    ['Auslastung Orbitalschweißen %', a.kpis.orbitalUtilization],
    ['Auslastung Heften %', a.kpis.heftUtilization],
    [''],
    ['Orbitalschweißen im Detail', ''],
    ['Vorhandene Maschinen', a.orbital.machinesInstalled],
    ['Aktive Maschinen', a.orbital.machinesActive],
    ['Maschinen je Schweißer', a.orbital.machinesPerWelder],
    ['Ø verfügbare Schweißer', a.orbital.avgWelders],
    ['Max. gleichzeitig bedienbar', a.orbital.maxSimultaneousMachines],
    ['Benötigte Maschinenstunden', a.orbital.machineHoursNeeded],
    ['Verfügbare Maschinenstunden', a.orbital.machineHoursCapacity],
    ['Mitarbeiterstunden', a.orbital.manHours],
    ['Begrenzender Faktor', a.orbital.limitedByLabel],
  ];

  const validation = [
    ['Ebene', 'Code', 'Meldung'],
    ...a.validation.issues.map((i) => [i.level, i.code, i.message]),
  ];

  void dataset; void OPERATION_BY_ID; void runSchedule;
  return [
    { name: 'Projekte', rows: projects },
    { name: 'Arbeitsgänge', rows: operations },
    { name: 'Kapazität je KW', rows: capacity },
    { name: 'Prozesse', rows: processes },
    { name: 'Management', rows: management },
    { name: 'Datenprüfung', rows: validation },
  ];
}

/** Zeilen fuer den Szenariovergleich. */
export function comparisonRows(list) {
  const head = ['Kennzahl', ...list.map((s) => s.name)];
  const row = (label, fn) => [label, ...list.map(fn)];
  return [
    head,
    row('OTD %', (s) => s.kpis.otd),
    row('Verspätete Projekte', (s) => s.kpis.late),
    row('Kritische Projekte', (s) => s.kpis.critical),
    row('Projekte in Time', (s) => s.kpis.inTime),
    row('Gesamtverspätung (Tage)', (s) => s.kpis.totalLateDays),
    row('Überlaststunden', (s) => s.kpis.overloadHours),
    row('Verfügbare Stunden', (s) => s.kpis.availableHours),
    row('Zusatzbedarf (MA-Wochen)', (s) => s.kpis.requiredFteWeeks),
    row('Leiharbeiter', (s) => s.tempWorkers),
    row('Neueinstellungen', (s) => s.newHires),
    row('Überstunden je MA/Woche', (s) => s.overtime),
    row('Samstage', (s) => Math.max(0, s.saturdays)),
    row('Heftplätze', (s) => s.heftPlaces),
    row('Orbitalschweißer', (s) => s.welders),
    row('Produktivität %', (s) => Math.round((s.productivity ?? 0) * 100)),
    row('Auslastung Orbital %', (s) => s.kpis.orbitalUtilization),
    row('Auslastung Heften %', (s) => s.kpis.heftUtilization),
    row('Größter Engpass', (s) => s.kpis.bottleneck ?? '-'),
  ];
}

/**
 * Wie viele zusaetzliche Kraefte sind eingeplant?
 *
 * MANNSCHAFT: Personen der Liste mit Eintritt oder angehakter Woche.
 * Rueckfallebene: die Anzahlen aus den Zahlenlisten.
 *
 * @param {any} cfg @param {'LEIHE'|'NEU'} art
 */
function eingeplantesZusatzpersonal(cfg, art) {
  if (cfg?.workforce?.team?.source === 'MANNSCHAFT') {
    return (cfg.workforce.team.people ?? []).filter((p) => p && p.active !== false
      && p.kind === art
      && (p.startDate || Object.values(p.weeks ?? {}).some(Boolean))).length;
  }
  const liste = art === 'LEIHE' ? cfg?.workforce?.tempWorkers : cfg?.workforce?.newHires;
  return (liste ?? []).reduce((a, t) => a + (Number(t?.count) || 0), 0);
}

/**
 * Wer geht am Stichtag in die Rechnung ein?
 *
 * Getrennt nach Herkunft, damit niemand raten muss:
 *   liste   - Personen aus der Mannschaftsliste, mit Kuerzel
 *   zusatz  - Anzahlen aus workforce.tempWorkers / newHires (ohne Namen)
 *
 * @param {any} cfg
 */
function gerechneteBesetzung(cfg) {
  const stichtag = cfg.planningDate;
  const ausListe = cfg.workforce?.team?.source === 'MANNSCHAFT';
  const on = ausListe ? teamOn(cfg, stichtag) : null;
  const anzahl = (liste) => (liste ?? []).reduce((a, x) => a + (Number(x?.count) || 0), 0);
  const zusatzTemp = anzahl(cfg.workforce?.tempWorkers);
  const zusatzHire = anzahl(cfg.workforce?.newHires);
  const personen = (on?.present ?? []).map((p) => ({
    id: p.id,
    label: p.label ?? '',
    kind: p.kind ?? 'STAMM',
    factor: Number(p.factor ?? 1),
    startDate: p.startDate ?? null,
  }));
  return {
    date: stichtag,
    source: cfg.workforce?.team?.source ?? 'ZAHLEN',
    /** Summe aus der Mannschaftsliste (FTE) */
    factor: round2(on?.factor ?? 0),
    heads: personen.length,
    personen,
    stamm: round2(personen.filter((p) => p.kind === 'STAMM').reduce((a, p) => a + p.factor, 0)),
    leihe: round2(personen.filter((p) => p.kind !== 'STAMM').reduce((a, p) => a + p.factor, 0)),
    /** Zeilen der Liste, die heute NICHT mitzaehlen (freie Plaetze, Abwesende) */
    nichtEingeplant: peopleOf(cfg).filter((p) => !personen.some((x) => x.id === p.id))
      .map((p) => ({ id: p.id, kind: p.kind ?? 'STAMM', startDate: p.startDate ?? null })),
    /** Anzahlen ohne Namen aus den Zahlenlisten */
    zusatz: { temp: zusatzTemp, hire: zusatzHire, summe: zusatzTemp + zusatzHire },
    /*
     * Kuerzel der tatsaechlich zugesagten Leiharbeiter (Auskunft vom
     * 15.09.2026). Alles darueber hinaus ist selbst eingeplant - die
     * Oberflaeche darf das nicht als "nicht von dir" ausgeben.
     */
    zugesagt: Object.keys(ZUGESAGTE_LEIHE),
  };
}

/**
 * Personentage ohne Arbeit, nach Grund - die Zahl, die den Blick auf die
 * Plaetze lenkt statt auf die Mannschaft.
 * @param {any} plan Ergebnis von assignPeople
 */
function leerlaufSumme(plan) {
  /** @type {Record<string, number>} */
  const gruende = {};
  let summe = 0;
  for (const t of plan.days ?? []) {
    for (const i of t.idle ?? []) {
      gruende[i.grund] = (gruende[i.grund] ?? 0) + 1;
      summe += 1;
    }
  }
  return { personentage: summe, gruende, ohneNamen: plan.unassignedHours ?? 0 };
}

/** Ergaenzt fehlende Felder aelterer Datenstaende. */
function migrate(dataset) {
  dataset.meta ??= { version: 1, createdAt: new Date().toISOString(), title: 'Armaturenbau MEGC' };
  dataset.projects ??= [];
  dataset.templates ??= defaultRoutingTemplates();
  dataset.workplaces ??= defaultWorkplaces();
  dataset.scenarios ??= [];
  if (!dataset.scenarios.some((s) => s.isBaseline)) {
    dataset.scenarios.unshift({
      id: 'BASELINE', name: 'Baseline', description: '', isBaseline: true,
      createdAt: new Date().toISOString(), config: defaultConfig(), projectOverrides: {}, sequenceOverride: null,
    });
  }
  for (const s of dataset.scenarios) {
    s.config = deepMerge(defaultConfig(), s.config ?? {});
    s.projectOverrides ??= {};
    s.measures ??= [];
  }
  // Gearbeitet wird auf einem eigenen Stand, damit Aenderungen sofort wirken
  // koennen, ohne die Baseline als Referenz zu verlieren.
  if (!dataset.scenarios.some((s) => s.id === 'ARBEITSSTAND')) {
    const base = dataset.scenarios.find((s) => s.isBaseline);
    dataset.scenarios.splice(1, 0, {
      id: 'ARBEITSSTAND',
      name: 'Arbeitsstand',
      description: 'Hier wird gearbeitet. Änderungen wirken sofort; die Baseline bleibt als Referenz unverändert.',
      isBaseline: false,
      parentId: 'BASELINE',
      createdAt: new Date().toISOString(),
      config: deepClone(base.config),
      projectOverrides: {},
      sequenceOverride: null,
      measures: [],
    });
    dataset.activeScenarioId = 'ARBEITSSTAND';
  }
  dataset.activeScenarioId ??= 'ARBEITSSTAND';
  dataset.meta.revision ??= 0;

  // Mehrbenutzerbetrieb: Kuerzel, Anmeldungen, Aenderungsprotokoll
  if (!Array.isArray(dataset.users) || dataset.users.length === 0) dataset.users = defaultUsers();
  for (const u of dataset.users) {
    u.id = normalizeUserId(u.id);
    u.label ??= u.id;
    u.admin = !!u.admin;
    u.active = u.active !== false;
    u.password ??= null;
    u.lastSeenAt ??= null;
    u.lastLoginAt ??= null;
  }
  if (!dataset.users.some((u) => u.admin && u.active)) {
    const first = dataset.users.find((u) => u.id === ADMIN_USER) ?? dataset.users[0];
    if (first) first.admin = true;
  }
  dataset.sessions = Array.isArray(dataset.sessions) ? dataset.sessions : [];
  dataset.changeLog = Array.isArray(dataset.changeLog) ? dataset.changeLog : [];
  dataset.currentPlanScenarioId ??= null;
  dataset.meta.referenceStateId ??= null;
  dataset.meta.targetStateId ??= null;
  dataset.rules = Array.isArray(dataset.rules) ? dataset.rules : [];
  dataset.history = Array.isArray(dataset.history) ? dataset.history : [];
  for (const p of dataset.projects) {
    const filled = createProject(p);
    for (const [k, v] of Object.entries(filled)) if (p[k] === undefined) p[k] = v;
  }

  /*
   * Einmalige Nachfuehrung: Arbeitsvorbereitung bis Ende 2026 erledigt.
   *
   * Auskunft der Abteilungsleitung (09/2026): "Wir haben alle Auftraege bis
   * Ende 2026 schon vorbereitet." Im Startdatenbestand steht das schon
   * (engine/seed.js); ein BEREITS LAUFENDER Bestand wuerde es sonst nie
   * bekommen, weil der Startbestand dort nicht noch einmal erzeugt wird.
   *
   * Nur einmal (Merker in meta) und nur dort, wo der Arbeitsgang nicht
   * ausdruecklich anders gefuehrt wird - sonst wuerde eine bewusste
   * Korrektur der Abteilungsleitung beim naechsten Start wieder
   * ueberschrieben.
   */
  if (dataset.meta.avErledigtBis !== AV_ERLEDIGT_BIS) {
    for (const p of dataset.projects) {
      if (!p.dueDate || p.dueDate > AV_ERLEDIGT_BIS) continue;
      const ops = (p.operations ??= []);
      if (ops.some((o) => o && o.opId === 'AV')) continue;
      ops.unshift({ opId: 'AV', status: OP_STATUS.DONE });
    }
    dataset.meta.avErledigtBis = AV_ERLEDIGT_BIS;
  }
}
