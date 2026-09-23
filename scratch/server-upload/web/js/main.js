/**
 * Anwendungsrahmen: Anmeldung, Navigation, Zustand, Mehrbenutzerbetrieb.
 */
import {
  h, mount, toast, fmt, modal, confirmDialog, choiceDialog, storageLabel,
  applyTheme, themeChoice, closePanels, panelOpen,
} from './ui.js';
import { api, setActor, setToken, setUnauthorizedHandler, currentToken, actor } from './api.js';

import { loginView, catchUpPanel } from './views/login.js';
import * as steuerstand from './views/steuerstand.js';
import * as mehraufwandView from './views/mehraufwand.js';
import * as belegung from './views/belegung.js';
import * as projects from './views/projects.js';
import * as ganttView from './views/gantt.js';
import * as routing from './views/routing.js';
import * as rules from './views/rules.js';
import * as mannschaft from './views/mannschaft.js';
import * as states from './views/states.js';
import * as vergleich from './views/vergleich.js';
import * as parameters from './views/parameters.js';
import * as data from './views/data.js';
import { openStellschrauben } from './views/stellschrauben.js';
import { openPalette } from './views/suche.js';
import { markenzeichen } from './views/marke.js';

/**
 * Fuenf Bereiche - so viele wie gaengige Ressourcenplaner auch haben.
 *
 * Vorher waren es zehn Menuepunkte. Die Abteilungsleitung dazu: "die
 * Anordnung und Uebersicht der Einstellmoeglichkeiten sind kritisch".
 * Jetzt fuehrt jeder Bereich seine Unterreiter oben, und die
 * Stellschrauben stehen als Panel rechts - von jeder Ansicht aus
 * erreichbar, damit man die Wirkung dort sieht, wo man arbeitet.
 *
 * Alle Benutzer sehen alle Bereiche und duerfen ueberall dasselbe.
 * Einzige Ausnahme: Kuerzel anlegen und Passwoerter zuruecksetzen darf
 * nur die Verwaltung (Einstellungen -> Benutzer).
 */
const AREAS = {
  uebersicht: {
    title: 'Übersicht',
    icon: '◉',
    tabs: [
      { id: 'kennzahlen', title: 'Kennzahlen', render: (a) => steuerstand.render(a) },
      { id: 'mehraufwand', title: 'Mehraufwand', render: (a) => mehraufwandView.render(a) },
      { id: 'engpass', title: 'Engpässe & Wirkung', render: (a) => steuerstand.renderEngpass(a) },
    ],
  },
  planung: {
    title: 'Planung',
    icon: '▦',
    tabs: [
      { id: 'belegung', title: 'Belegung', render: (a) => belegung.render(a) },
      { id: 'termine', title: 'Terminplan', render: (a) => ganttView.render(a) },
      { id: 'vergleich', title: 'Vergleich', render: (a) => vergleich.render(a) },
    ],
  },
  auftraege: {
    title: 'Aufträge',
    icon: '☰',
    tabs: [
      { id: 'liste', title: 'Liste', render: (a) => projects.render(a) },
      { id: 'folgen', title: 'Arbeitsfolgen', render: (a) => routing.render(a) },
      { id: 'regeln', title: 'Regeln', render: (a) => rules.render(a) },
    ],
  },
  mannschaft: {
    title: 'Mannschaft',
    icon: '☺',
    tabs: [
      { id: 'liste', title: 'Mannschaft', render: (a) => mannschaft.renderTab(a, 'mannschaft') },
      { id: 'anwesenheit', title: 'Anwesenheit je KW', render: (a) => mannschaft.renderTab(a, 'anwesenheit') },
      { id: 'schicht', title: 'Schichtplanung je KW', render: (a) => mannschaft.renderTab(a, 'schicht') },
      { id: 'urlaub', title: 'Urlaubsplanung einlesen', render: (a) => mannschaft.renderTab(a, 'urlaub') },
      { id: 'einsatz', title: 'Einsatzplan', render: (a) => mannschaft.renderTab(a, 'einsatz') },
      { id: 'aushang', title: 'Aushang', render: (a) => mannschaft.renderTab(a, 'aushang') },
    ],
  },
  einstellungen: {
    title: 'Einstellungen',
    icon: '⚙',
    tabs: [
      { id: 'parameter', title: 'Parameter', render: (a) => parameters.render(a) },
      { id: 'staende', title: 'Stände', render: (a) => states.render(a) },
      { id: 'daten', title: 'Daten & Prüfung', render: (a) => data.render(a) },
    ],
  },
};

/**
 * Frueher waren die Bereiche einzelne Menuepunkte. Damit jeder vorhandene
 * Sprung ("zum Auftrag", "zur Datenpruefung") weiter funktioniert, werden
 * die alten Namen auf Bereich und Reiter abgebildet.
 */
const LEGACY = {
  steuerstand: 'uebersicht/kennzahlen',
  gantt: 'planung/termine',
  belegung: 'planung/belegung',
  projects: 'auftraege/liste',
  routing: 'auftraege/folgen',
  rules: 'auftraege/regeln',
  team: 'mannschaft/liste',
  vergleich: 'planung/vergleich',
  states: 'einstellungen/staende',
  settings: 'einstellungen/parameter',
  data: 'einstellungen/daten',
};

/** Loest eine Route auf: "planung/belegung", "planung" oder "projects". */
function resolveRoute(route) {
  const roh = String(route ?? '').replace(/^#/, '');
  const ziel = LEGACY[roh] ?? roh;
  const [areaId, tabId] = ziel.split('/');
  const area = AREAS[areaId] ? areaId : 'uebersicht';
  const tabs = AREAS[area].tabs;
  const tab = tabs.find((t) => t.id === tabId)?.id ?? tabs[0].id;
  return { area, tab };
}

const START_VIEW = 'uebersicht/kennzahlen';

export const app = {
  /** @type {any} */ state: null,
  /** @type {any} */ analysis: null,
  /** @type {any} */ scenarioCfg: null,
  /** Vergleich mit dem fixierten IST-Stand (null = keiner festgelegt) @type {any} */
  reference: null,
  route: START_VIEW,
  /** Bereich und Reiter - aus der Route abgeleitet */
  area: 'uebersicht',
  tab: 'kennzahlen',
  /** @type {{id:string,label:string,admin:boolean}|null} */ user: null,
  sessionHours: 12,
  /** @type {any} */ catchUpData: null,
  /** Vom Server gemeldeter Änderungsstand – erkennt fremde Änderungen. */
  revision: 0,
  foreignChange: null,
  ready: false,

  ui: {
    ganttMode: 'week',
    ganttExpanded: new Set(),
    chartMode: 'week',
    processFilter: 'ALL',
    projectFilter: { text: '', status: 'ALL', type: 'ALL' },
    compareIds: null,
    proposals: null,
    settingsTab: 'haeufig',
    teamTab: 'mannschaft',
    /** Offenes Seitenpanel: null oder 'stellschrauben' */
    panel: null,
    /** Zeitraum der Auswertung (leer = Stichtag bis letzter Termin) */
    range: {},
    /** Zustand des Belegungsgitters */
    board: { mode: 'WORKPLACE', zoom: 'TAG', from: null, onlyBottleneck: false },
    /** Gespeicherte Ansichten je Benutzer */
    views: null,
    anwesenheitSeite: 0,
    einsatzWoche: null,
  },

  get scenarioId() { return this.state?.activeScenarioId ?? 'ARBEITSSTAND'; },
  get scenario() { return this.state?.scenarios.find((s) => s.id === this.scenarioId); },
  get isBaseline() { return !!this.scenario?.isBaseline; },
  get isAdmin() { return !!this.user?.admin; },

  /* ---------------- Anmeldung ---------------- */

  /** Nach erfolgreicher Anmeldung: Daten laden und Aufholmeldung holen. */
  async afterLogin(result) {
    setToken(result.token);
    setActor(result.user);
    this.user = result.user;
    this.sessionHours = result.sessionHours ?? 12;
    this.route = START_VIEW;
    this.area = 'uebersicht';
    this.tab = 'kennzahlen';
    // Ansichten gehoeren zum Kuerzel - beim Anmelden neu laden
    this.ui.views = null;
    await this.reload();
    try { this.catchUpData = await api.catchUp(); } catch { this.catchUpData = null; }
    this.render();
  },

  async logout() {
    try { await api.logout(); } catch { /* Abmelden gelingt immer lokal */ }
    setToken('');
    setActor(null);
    this.user = null;
    this.catchUpData = null;
    this.render();
  },

  async dismissCatchUp() {
    this.catchUpData = null;
    this.render();
    try { await api.markSeen(); } catch { /* nicht kritisch */ }
  },

  /* ---------------- Daten ---------------- */

  async reload() {
    this.state = await api.state();
    this.scenarioCfg = await api.scenarioConfig(this.scenarioId);
    this.analysis = await api.analysis(this.scenarioId, this.ui.range);
    this.revision = this.state.revision?.revision ?? 0;
    this.foreignChange = null;
    await this.loadReference();
    this.render();
  },

  async recalc(message) {
    this.scenarioCfg = await api.scenarioConfig(this.scenarioId);
    this.analysis = await api.analysis(this.scenarioId, this.ui.range);
    this.state = await api.state();
    this.revision = this.state.revision?.revision ?? 0;
    await this.loadReference();
    this.render();
    if (message) toast(message, 'ok');
  },

  /** Vergleich mit dem IST-Stand nachladen (nur wenn einer festgelegt ist). */
  async loadReference() {
    if (!this.state?.referenceStateId) { this.reference = null; return; }
    try { this.reference = await api.reference(this.scenarioId); } catch { this.reference = null; }
  },

  /**
   * Springt zu einem Bereich oder Reiter.
   * Zugelassen sind "planung", "planung/belegung" und die alten Namen
   * ("projects", "data" ...) - so bleibt jeder vorhandene Sprung gueltig.
   */
  navigate(route) {
    const ziel = resolveRoute(route);
    this.area = ziel.area;
    this.tab = ziel.tab;
    this.route = `${ziel.area}/${ziel.tab}`;
    location.hash = this.route;
    closePanels();
    this.ui.panel = null;
    this.render();
  },

  /** Wechselt nur den Reiter im aktuellen Bereich. */
  openTab(tabId) {
    const tabs = AREAS[this.area]?.tabs ?? [];
    if (!tabs.some((t) => t.id === tabId)) return;
    this.tab = tabId;
    this.route = `${this.area}/${tabId}`;
    location.hash = this.route;
    this.render();
  },

  /** Stellschrauben rechts auf- und zuklappen. */
  toggleStellschrauben() {
    if (panelOpen() && this.ui.panel === 'stellschrauben') {
      closePanels();
      this.ui.panel = null;
    } else {
      openStellschrauben(this);
    }
  },

  /**
   * Ändert einen Parameter des Arbeitsstands. Wirkt sofort.
   * Nur wenn versehentlich auf der Baseline gearbeitet wird, kommt eine Rückfrage.
   */
  async patchConfig(patch, message = 'Neu berechnet', options = {}) {
    if (this.isBaseline) {
      const choice = await choiceDialog(
        'Änderung an der Baseline',
        'Die Baseline ist der unveränderte Ausgangsstand. Gearbeitet wird normalerweise im „Arbeitsstand".',
        [
          { value: 'work', label: 'Im Arbeitsstand weiterarbeiten', primary: true },
          { value: 'baseline', label: 'Baseline trotzdem ändern' },
        ], null);
      if (choice === null) { this.render(); return; }
      if (choice === 'work') {
        await api.activateScenario('ARBEITSSTAND');
        this.state = await api.state();
      }
    }
    await api.updateScenario(this.scenarioId, { config: patch, clear: options.clear });
    await this.recalc(message);
  },

  render() {
    const root = document.getElementById('app');
    if (!this.ready) { mount(root, h('div.empty', 'Lade …')); return; }
    if (!this.user) { mount(root, loginView(this)); return; }
    if (!this.state) { mount(root, h('div.empty', 'Lade …')); return; }
    /*
     * FIX (Nutzermeldung 23.09.2026, "das Tool scrollt bei jeder Änderung
     * wieder nach oben"): render() baut das gesamte div.content bei JEDER
     * Änderung (jedes patchConfig -> recalc -> render) neu auf - das neue
     * Element beginnt zwangsläufig bei scrollTop 0. Bleibt Bereich und
     * Reiter gleich (eine Eingabe, keine Navigation), wird die Position
     * des ALTEN .content-Elements deshalb auf das neue übertragen, damit
     * eine Eingabe mitten in einer langen Tabelle nicht den Bildschirm
     * nach oben reißt. Wechselt Bereich oder Reiter (echte Navigation),
     * bleibt es bewusst bei scrollTop 0 - eine neue Seite startet oben.
     */
    const altesContent = root.querySelector('.content');
    const gleicheStelle = this._letzteRoute === `${this.area}/${this.tab}`;
    const scrollPosition = gleicheStelle ? (altesContent?.scrollTop ?? 0) : 0;
    this._letzteRoute = `${this.area}/${this.tab}`;
    mount(root, sidebar(this), h('div.main',
      topbar(this),
      tabbar(this),
      h('div.content',
        this.catchUpData && catchUpPanel(this, this.catchUpData),
        body(this))));
    const neuesContent = root.querySelector('.content');
    if (neuesContent && scrollPosition > 0) {
      neuesContent.scrollTop = scrollPosition;
      /*
       * Viele Ansichten (z. B. Mannschaft) rendern zunaechst ein Geruest
       * und laden ihren eigentlichen Inhalt NACHTRAEGLICH asynchron
       * (eigenes container.replaceChildren, ausserhalb dieses render()).
       * In diesem Moment ist .content oft noch zu kurz fuer die alte
       * Scrollposition - sie wird auf 0 gekappt, bevor der Inhalt da ist.
       * Ein ResizeObserver haelt die Position deshalb kurzzeitig nach, bis
       * der Nachlade-Inhalt steht, und schaltet sich danach von selbst ab.
       */
      const ro = new ResizeObserver(() => { neuesContent.scrollTop = scrollPosition; });
      ro.observe(neuesContent);
      setTimeout(() => ro.disconnect(), 1500);
    }
    // Ein offenes Stellschrauben-Panel bleibt offen und zeigt die neuen Werte
    if (this.ui.panel === 'stellschrauben') openStellschrauben(this);
  },
};

/* ------------------------------------------------------------------ *
 * Rahmen
 * ------------------------------------------------------------------ */

function sidebar(a) {
  const fehler = a.analysis?.validation.summary.errors ?? 0;
  const auffaellig = a.analysis?.plausibility?.counts ?? {};
  const badge = {
    einstellungen: fehler > 0 ? String(fehler) : null,
    uebersicht: (auffaellig.KRITISCH ?? 0) > 0 ? String(auffaellig.KRITISCH) : null,
  };

  return h('div.sidebar',
    h('div.sidebar__brand',
      h('span.sidebar__logo', markenzeichen(26)),
      h('div',
        h('h1', 'Armaturenbau MEGC'),
        h('span', 'Produktionsplanung · Hexagon Purus'))),
    h('div.sidebar__nav', h('div.navgroup',
      Object.keys(AREAS).map((key) => h(`div.navitem${a.area === key ? '.navitem--active' : ''}`,
        { onclick: () => a.navigate(key) },
        h('span.navitem__icon', AREAS[key].icon),
        h('span', AREAS[key].title),
        badge[key] && h('span.navitem__badge', badge[key]))))),
    h('div.sidebar__foot',
      `Stichtag ${fmt.date(a.analysis?.planningDate)}`, h('br'),
      storageLabel(a.state.storage.kind), h('br'),
      a.state.revision?.changedBy
        ? `Zuletzt geändert: ${a.state.revision.changedBy}`
        : `Rechenzeit ${a.analysis?.runtimeMs ?? 0} ms`));
}

/**
 * Reiterleiste des Bereichs.
 *
 * Bewusst mit derselben Auszeichnung wie die Reiter innerhalb der
 * Ansichten (".seg"), damit die Bedienung sich nicht an zwei Stellen
 * unterschiedlich anfuehlt.
 */
function tabbar(a) {
  const area = AREAS[a.area] ?? AREAS.uebersicht;
  return h('div.tabbar',
    h('div.seg', area.tabs.map((t) => h('button', {
      class: a.tab === t.id ? 'is-active' : '',
      onclick: () => a.openTab(t.id),
    }, t.title))),
    h('div.tabbar__spacer'),
    ansichtenSteuerung(a),
    h('div.tabbar__hint', hinweisZumReiter(a)));
}

/**
 * Gespeicherte Ansichten.
 *
 * Eine Ansicht haelt fest, wo man ist und was gefiltert ist - Bereich,
 * Reiter, Auftragsfilter, Belegungsgitter und Zeitraum. Beim naechsten Mal
 * ein Klick statt fuenf. Gespeichert wird am Server je Kuerzel, damit die
 * Ansicht auf jedem Rechner da ist.
 */
function ansichtenSteuerung(a) {
  if (a.ui.views === null) { ladeAnsichten(a); return h('span.small.faint', 'Ansichten …'); }
  const liste = a.ui.views ?? [];
  return h('div.topctl',
    h('label', 'Ansicht'),
    h('select', {
      title: 'Gespeicherte Ansicht öffnen',
      onchange: (e) => {
        const v = liste.find((x) => x.id === e.target.value);
        if (v) ansichtAnwenden(a, v);
      },
    },
    h('option', { value: '' }, liste.length ? '– wählen –' : '– keine gespeichert –'),
    liste.map((v) => h('option', { value: v.id }, v.name))),
    h('button.btn.btn--sm', {
      title: 'Aktuelle Einstellung als Ansicht speichern',
      onclick: () => ansichtSpeichern(a),
    }, '+'),
    liste.length > 0 && h('button.btn.btn--sm', {
      title: 'Eine gespeicherte Ansicht löschen',
      onclick: () => ansichtLoeschen(a),
    }, '×'));
}

async function ladeAnsichten(a) {
  try {
    a.ui.views = await api.views();
  } catch {
    a.ui.views = [];
  }
  a.render();
}

function ansichtAnwenden(a, v) {
  const d = v.payload ?? {};
  if (d.projectFilter) a.ui.projectFilter = { ...a.ui.projectFilter, ...d.projectFilter };
  if (d.board) a.ui.board = { ...a.ui.board, ...d.board };
  a.ui.range = d.range ?? {};
  toast(`Ansicht „${v.name}" geöffnet.`, 'ok');
  if (d.route) a.navigate(d.route); else a.recalc(null);
}

function ansichtSpeichern(a) {
  let name = '';
  const m = modal({
    title: 'Ansicht speichern',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Gespeichert werden Bereich, Reiter, Auftragsfilter, Einstellung des Belegungsgitters '
        + 'und der Zeitraum. Nur für Ihr Kürzel sichtbar.'),
      h('label.field', h('span', 'Name'),
        h('input', {
          type: 'text', placeholder: 'z. B. nur P1 und Sägen',
          oninput: (e) => { name = e.target.value; },
        }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          try {
            await api.saveView({
              name,
              payload: {
                route: a.route,
                projectFilter: { ...a.ui.projectFilter },
                board: { ...a.ui.board },
                range: { ...(a.ui.range ?? {}) },
              },
            });
            m.close();
            a.ui.views = null;
            toast('Ansicht gespeichert.', 'ok');
            a.render();
          } catch (err) {
            toast(err?.message ?? 'Die Ansicht konnte nicht gespeichert werden.', 'error');
          }
        },
      }, 'Speichern'),
    ],
  });
}

function ansichtLoeschen(a) {
  const liste = a.ui.views ?? [];
  const m = modal({
    title: 'Ansicht löschen',
    body: h('div.stack', ...liste.map((v) => h('div.btn-row',
      h('strong', { style: { minWidth: '160px' } }, v.name),
      h('button.btn.btn--sm.btn--danger', {
        onclick: async () => {
          try {
            await api.deleteView(v.id);
            m.close();
            a.ui.views = null;
            toast('Ansicht gelöscht.', 'ok');
            a.render();
          } catch (err) {
            toast(err?.message ?? 'Löschen fehlgeschlagen.', 'error');
          }
        },
      }, 'Löschen')))),
    actions: [h('button.btn', { onclick: () => m.close() }, 'Schließen')],
  });
}

function hinweisZumReiter(a) {
  if (a.area === 'planung' && a.tab === 'belegung') {
    return 'Rot hinterlegt = Arbeit wartet, hier war kein Platz';
  }
  if (a.area === 'uebersicht') return 'Stellschrauben rechts – die Wirkung erscheint sofort hier';
  if (a.area === 'mannschaft') return 'Die Mannschaft ist die Grundlage der Besetzung';
  if (a.area === 'auftraege' && a.tab === 'liste') return 'Termin, Priorität und Fertig direkt in der Liste änderbar';
  return '';
}

/**
 * Kopfleiste: links wo man ist, daneben der Puls der Planung, rechts die
 * Bedienelemente, die ueberall gelten - Stand, Zeitraum, Suche,
 * Stellschrauben.
 */
function topbar(a) {
  const k = a.analysis?.kpis;
  const plan = a.state.scenarios.find((s) => s.isCurrentPlan);
  const area = AREAS[a.area] ?? AREAS.uebersicht;
  const pl = a.analysis?.plausibility;

  const puls = h('div.topbar__pulse',
    h('div.pulse', h('div.pulse__value', `${a.analysis?.projects.length ?? 0}`),
      h('div.pulse__label', 'Aufträge')),
    h(`div.pulse.pulse--${k?.late ? 'bad' : 'ok'}`,
      h('div.pulse__value', `${k?.late ?? 0}`), h('div.pulse__label', 'zu spät')),
    h(`div.pulse.pulse--${(k?.otd ?? 0) >= 95 ? 'ok' : (k?.otd ?? 0) >= 75 ? 'warn' : 'bad'}`,
      h('div.pulse__value', fmt.pct(k?.otd, 0)), h('div.pulse__label', 'Termintreue')),
    Math.round(k?.shortfallHours ?? 0) > 0 && h('div.pulse.pulse--bad',
      h('div.pulse__value', `+${fmt.num(k.shortfallHours, 0)} h`),
      h('div.pulse__label', 'über Kapazität')));

  return h('div.topbar',
    h('div', h('div.topbar__title', area.title)),
    puls,
    h('div.topbar__spacer'),

    // Stand (Szenario) - ueberall gueltig
    h('div.topctl',
      h('label', 'Stand'),
      h('select', {
        title: 'Welcher Stand wird gerechnet und angezeigt?',
        onchange: async (e) => {
          await api.activateScenario(e.target.value);
          await a.reload();
        },
      }, a.state.scenarios.map((s) => h('option', {
        value: s.id, selected: s.id === a.scenarioId,
      }, s.name + (s.isBaseline ? ' (Ausgangsstand)' : ''))))),

    // Zeitraum der Auswertung
    zeitraumSteuerung(a),

    h('div.searchbox', { title: 'Auftrag, Kürzel oder Bereich suchen' },
      h('span.faint', '⌕'),
      h('input', {
        type: 'search', placeholder: 'Suchen …',
        onfocus: () => openPalette(a),
      }),
      h('kbd', 'Strg K')),

    h(`button.btn.btn--sm${a.ui.panel === 'stellschrauben' ? '.btn--primary' : ''}`, {
      title: 'Stellschrauben rechts öffnen – jede Änderung rechnet sofort durch',
      onclick: () => a.toggleStellschrauben(),
    }, '⚙ Stellschrauben'),

    pl && pl.counts.KRITISCH > 0 && h('button.btn.btn--sm', {
      style: { borderColor: 'var(--c-red)', color: 'var(--c-red)', fontWeight: 700 },
      title: 'Die Anwendung hält etwas für unplausibel',
      onclick: () => a.navigate('uebersicht/kennzahlen'),
    }, `⛔ ${pl.counts.KRITISCH}`),

    plan && h('span.pill.pill--blue', { title: `Aktueller Plan: ${plan.name}` },
      `Aktueller Plan: ${plan.name}`),

    a.state.runtime?.invite && h('button.btn.btn--sm', {
      title: 'Link für die Kollegen anzeigen und kopieren',
      onclick: () => inviteDialog(a),
    }, '🔗 Einladung'),

    a.foreignChange && h('button.btn.btn--sm', {
      style: { borderColor: 'var(--c-amber)', color: 'var(--c-amber)', fontWeight: 700 },
      title: 'Ein anderer Benutzer hat Änderungen gespeichert',
      onclick: () => a.reload(),
    }, `↻ ${a.foreignChange} hat geändert – neu laden`),

    themeButton(a),

    h('span.userchip', { title: 'Angemeldet – klicken für Passwort und Abmelden', onclick: () => userMenu(a) },
      h('span.userchip__dot'), a.user.id),

    h('button.btn.btn--sm', { onclick: () => a.recalc('Neu berechnet') }, '↻ Neu berechnen'));
}

/**
 * Zeitraum der Auswertung.
 *
 * Wirkt auf Kennzahlen, Diagramm und Wochentabelle. Leer heisst: vom
 * Stichtag bis zum letzten Termin - das ist der Regelfall.
 */
function zeitraumSteuerung(a) {
  const r = a.ui.range ?? {};
  const setze = async (feld, wert) => {
    a.ui.range = { ...r, [feld]: wert || null };
    await a.recalc(null);
  };
  return h('div.topctl',
    h('label', 'Zeitraum'),
    h('input', {
      type: 'date', value: r.from ?? '', title: 'Auswertung ab',
      onchange: (e) => setze('from', e.target.value),
    }),
    h('input', {
      type: 'date', value: r.to ?? '', title: 'Auswertung bis',
      onchange: (e) => setze('to', e.target.value),
    }),
    (r.from || r.to) && h('button.btn.btn--sm', {
      title: 'Zeitraum aufheben – wieder bis zum letzten Termin rechnen',
      onclick: async () => { a.ui.range = {}; await a.recalc(null); },
    }, '×'));
}

/** Hell, dunkel oder wie das Betriebssystem. */
function themeButton(a) {
  const folge = { auto: 'light', light: 'dark', dark: 'auto' };
  const zeichen = { auto: '◐', light: '☀', dark: '☾' };
  const text = { auto: 'Systemeinstellung', light: 'hell', dark: 'dunkel' };
  const jetzt = themeChoice();
  return h('button.btn.btn--sm', {
    title: `Darstellung: ${text[jetzt]} – klicken zum Wechseln`,
    onclick: () => { applyTheme(folge[jetzt] ?? 'auto'); a.render(); },
  }, zeichen[jetzt] ?? '◐');
}

/**
 * Einladungslink fuer die Kollegen.
 *
 * Nur dieser Rechner braucht Node.js - alle anderen oeffnen den Link im
 * Browser. Der Rechnername bleibt stabil, auch wenn sich die IP aendert;
 * die IP-Adressen stehen als Rueckfallebene daneben.
 */
function inviteDialog(a) {
  const rt = a.state.runtime ?? {};
  const text = `Produktionsplanung Armaturenbau MEGC\n\n${rt.invite}\n\n`
    + 'Im Browser öffnen, eigenes Kürzel eingeben, beim ersten Mal ein eigenes Passwort vergeben. '
    + 'Es ist keine Installation nötig.';
  const feld = h('input', {
    type: 'text', value: rt.invite ?? '', readonly: true,
    style: { fontWeight: '700', fontSize: '15px' },
    onclick: (e) => e.target.select(),
  });

  const m = modal({
    title: 'Einladung für die Kollegen',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Nur dieser Rechner braucht Node.js. Die Kollegen öffnen einfach diesen Link – '
        + 'ohne Installation. Voraussetzung: Dieser Rechner läuft, solange gearbeitet wird.'),
      h('label.field', h('span', 'Link'), feld),
      rt.addresses?.length > 0 && h('div.small.faint',
        'Falls der Rechnername im Netz nicht auflöst: ',
        rt.addresses.join(' · ')),
      h('div.note.note--info', { style: { marginTop: '10px' } },
        h('strong', 'Anmeldung: '),
        'Kürzel eingeben (STWUE, SVHE, DOHE, KEER, KEMI, SAZA …), beim ersten Mal ein eigenes '
        + 'Passwort vergeben. Alle arbeiten im selben Datenbestand.'),
      h('div.small.faint', { style: { marginTop: '8px' } },
        `Daten: ${rt.location ?? '–'} (${storageLabel(rt.storage)})`)),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Schließen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast('Einladung kopiert – jetzt in Teams oder E-Mail einfügen.', 'ok');
          } catch {
            feld.select();
            toast('Bitte mit Strg+C kopieren.', '');
          }
        },
      }, 'Einladungstext kopieren'),
    ],
  });
}

/** Menü hinter dem Kürzel: Passwort ändern, abmelden. */
function userMenu(a) {
  const m = modal({
    title: `Angemeldet als ${a.user.id}`,
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        a.user.admin
          ? 'Sie führen die Benutzerverwaltung: Kürzel anlegen und Passwörter zurücksetzen unter Einstellungen → Benutzer.'
          : 'Alle Benutzer haben dieselben Möglichkeiten – das Kürzel dient dem Änderungsnachweis.'),
      h('div.btn-row',
        h('button.btn', { onclick: () => { m.close(); changePasswordDialog(a); } }, 'Passwort ändern'),
        h('button.btn.btn--danger', { onclick: () => { m.close(); a.logout(); } }, 'Abmelden'))),
    actions: [h('button.btn', { onclick: () => m.close() }, 'Schließen')],
  });
}

function changePasswordDialog(a) {
  let oldPassword = '';
  let newPassword = '';
  let repeat = '';
  const feld = (label, set, hint) => h('label.field', h('span', label),
    h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => set(e.target.value) }),
    hint && h('div.field__hint', hint));
  const m = modal({
    title: 'Passwort ändern',
    body: h('div',
      feld('Bisheriges Passwort', (v) => { oldPassword = v; }),
      feld('Neues Passwort', (v) => { newPassword = v; }, 'mindestens 6 Zeichen'),
      feld('Neues Passwort wiederholen', (v) => { repeat = v; })),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (newPassword !== repeat) { toast('Die beiden Passwörter stimmen nicht überein.', 'error'); return; }
          try {
            await api.changePassword({ oldPassword, newPassword });
            m.close();
            toast('Passwort geändert. Andere Anmeldungen mit diesem Kürzel wurden beendet.', 'ok');
          } catch (err) {
            toast(err?.message ?? 'Passwort konnte nicht geändert werden.', 'error');
          }
        },
      }, 'Passwort ändern'),
    ],
  });
}

function body(a) {
  const area = AREAS[a.area] ?? AREAS.uebersicht;
  const tab = area.tabs.find((t) => t.id === a.tab) ?? area.tabs[0];
  try {
    return tab.render(a);
  } catch (err) {
    console.error(err);
    return h('div.note.note--error', h('strong', 'Fehler in der Ansicht: '), err.message);
  }
}

/* ------------------------------------------------------------------ *
 * Fremde Änderungen erkennen (Mehrbenutzerbetrieb)
 * ------------------------------------------------------------------ */

function watchForChanges(a) {
  if (!api.revision) return;
  setInterval(async () => {
    if (!a.state || !a.user) return;
    try {
      const r = await api.revision();
      if (Number(r.revision) > Number(a.revision) && !a.foreignChange) {
        a.foreignChange = r.changedBy || 'Jemand';
        a.render();
      }
    } catch { /* Netz kurz weg - beim naechsten Mal wieder versuchen */ }
  }, 8000);
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

window.addEventListener('hashchange', () => {
  const r = location.hash.replace('#', '');
  if (!r || !app.user) return;
  const ziel = resolveRoute(r);
  const route = `${ziel.area}/${ziel.tab}`;
  if (route !== app.route) {
    app.area = ziel.area;
    app.tab = ziel.tab;
    app.route = route;
    app.render();
  }
});

/**
 * Tastatur: Strg+K oeffnet die Schnellsuche, Escape schliesst Panels.
 * Die Abteilungsleitung dazu: "waere cool, muss nicht zwingend" - es
 * kostet wenig und spart bei 37 Auftraegen jeden Tag Klicks.
 */
window.addEventListener('keydown', (e) => {
  if (!app.user) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette(app);
  }
});

(async function start() {
  setUnauthorizedHandler(() => {
    app.user = null;
    app.state = null;
    app.catchUpData = null;
    toast('Die Anmeldung ist abgelaufen. Bitte erneut anmelden.', 'error');
    app.render();
  });

  try {
    applyTheme();
    const r = location.hash.replace('#', '');
    if (r) {
      const ziel = resolveRoute(r);
      app.area = ziel.area;
      app.tab = ziel.tab;
      app.route = `${ziel.area}/${ziel.tab}`;
    }

    // Laeuft noch eine gueltige Anmeldung? (Ohne Schluessel gar nicht erst fragen.)
    if (currentToken()) {
      try {
        const session = await api.session();
        if (session?.user) {
          app.user = session.user;
          setActor(session.user);
        }
      } catch { app.user = null; }
    }

    app.ready = true;
    if (app.user) {
      await app.reload();
      try { app.catchUpData = await api.catchUp(); } catch { app.catchUpData = null; }
    }
    app.render();
    watchForChanges(app);
  } catch (err) {
    app.ready = true;
    mount(document.getElementById('app'),
      h('div.note.note--error', { style: { margin: '20px' } },
        h('strong', 'Die Anwendung konnte nicht gestartet werden: '), err.message));
  }
}());

export { modal, confirmDialog, actor };
