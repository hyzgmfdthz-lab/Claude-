/**
 * Planungsparameter / Szenariohebel (§56/§57/§58).
 * Alle Aenderungen wirken sofort auf die Simulation des aktiven Szenarios.
 */
import {
  h, card, field, selectField, checkField, table, fmt, toast, validateTag, confirmDialog, modal,
} from '../ui.js';
import { api } from '../api.js';
import { shiftCard } from './steuerstand.js';

const WEEKDAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr']];

/** Wirkt die Qualifikationsmatrix der Mannschaft? */
function matrixGilt(cfg) {
  const team = cfg.workforce?.team;
  return !!team && team.enforceSkills !== false && (team.people ?? []).length > 0;
}

/** Rechnet die Anwendung gerade aus der Mannschaftsliste? */
function ausListe(cfg) {
  return cfg.workforce?.team?.source === 'MANNSCHAFT';
}

/** Anzahl der Kalenderwochen mit eigenen Personalwerten. */
function weeklyCount(cfg) {
  return Object.values(cfg.workforce?.weekly ?? {}).filter((w) => w && Object.keys(w).length > 0).length;
}

export function render(a) {
  const cfg = a.scenarioCfg.config;
  const an = a.analysis;
  const set = (patch, msg) => a.patchConfig(patch, msg ?? 'Parameter geändert – neu berechnet');
  const tab = a.ui.settingsTab ?? 'haeufig';
  const go = (t) => { a.ui.settingsTab = t; a.render(); };

  const tabs = h('div.seg', { style: { marginBottom: '14px' } },
    h('button', { class: tab === 'haeufig' ? 'is-active' : '', onclick: () => go('haeufig') }, 'Häufig gebraucht'),
    h('button', { class: tab === 'erweitert' ? 'is-active' : '', onclick: () => go('erweitert') }, 'Erweitert'),
    h('button', { class: tab === 'szenarien' ? 'is-active' : '', onclick: () => go('szenarien') }, 'Szenarien'),
    h('button', { class: tab === 'benutzer' ? 'is-active' : '', onclick: () => go('benutzer') }, 'Benutzer'));

  if (tab === 'staende' || tab === 'szenarien') return h('div.view', tabs, scenarioCard(a));
  if (tab === 'benutzer') return h('div.view', tabs, userCard(a));
  if (tab === 'erweitert') return h('div.view', tabs, advanced(a, cfg, an, set));

  return h('div.view', tabs,
    a.isBaseline && h('div.note.note--warn',
      h('strong', 'Sie arbeiten auf der Baseline. '),
      'Die Baseline ist der unveränderte Ausgangsstand zum Vergleich. ',
      'Beim ersten Ändern eines Werts fragt die Anwendung, ob stattdessen im „Arbeitsstand“ weitergearbeitet werden soll.'),

    h('div.grid.grid--2',
      card('Planungsrahmen', h('div.grid.grid--form',
        field('Planungsstichtag', cfg.planningDate, (v) => set({ planningDate: v }), {
          type: 'date', hint: 'Projekte mit Termin davor und offenem Rest gelten als verspätet.',
        }),
        field('Planungshorizont (Tage)', cfg.horizonDays, (v) => set({ horizonDays: v }), { type: 'number', min: 30, max: 1500 }),
        field('Ab wann gilt ein Termin als knapp (Tage)', cfg.criticalSlackDays, (v) => set({ criticalSlackDays: v }), {
          type: 'number', min: 0, max: 30, hint: 'Ab diesem Restpuffer gilt ein Projekt als kritisch.',
        }),
        h('div', h('div.small.faint', 'Heute'), h('div', { style: { fontWeight: 600, paddingTop: '3px' } },
          h('button.btn.btn--sm', { onclick: () => set({ planningDate: new Date().toISOString().slice(0, 10) }) }, 'Stichtag auf heute setzen'))))),

      card('Arbeitszeit und Produktivität', h('div',
        h('div.grid.grid--form',
          field('Regelarbeitszeit (h je MA und Woche)', cfg.workTime.regularHoursPerWeek, (v) => set({ workTime: { regularHoursPerWeek: v } }), { type: 'number', step: '0.5', min: 1 }),
          field('Samstagsstunden', cfg.workTime.saturdayHours, (v) => set({ workTime: { saturdayHours: v } }), { type: 'number', step: '0.5', min: 0 }),
          field('Überstunden je MA und Woche', cfg.workforce.overtimePerEmployeeDefault, (v) => set({ workforce: { overtimePerEmployeeDefault: v } }), { type: 'number', step: '0.5', min: 0, max: 20 })),
        h('label.field',
          h('span', `Globale Produktivität: ${Math.round(cfg.productivity.global * 100)} %`,
            cfg.productivity.validated === false && validateTag('Startwert – bitte anhand von IST-Daten validieren.')),
          h('input', {
            type: 'range', min: 50, max: 110, step: 1, value: Math.round(cfg.productivity.global * 100),
            oninput: (e) => { e.target.nextSibling.textContent = `${e.target.value} %`; },
            onchange: (e) => set({ productivity: { global: Number(e.target.value) / 100 } }),
          }),
          h('span.small.muted', `${Math.round(cfg.productivity.global * 100)} %`)),
        h('div.small.muted', `Beispielrechnung: ${cfg.workforce.baseHeadcount} MA × ${cfg.workTime.regularHoursPerWeek} h × `
          + `${Math.round(cfg.productivity.global * 100)} % = ${fmt.h(cfg.workforce.baseHeadcount * cfg.workTime.regularHoursPerWeek * cfg.productivity.global)} produktive Wochenkapazität.`)))),

    card('Personal',
      h('div',
        ausListe(cfg)
          ? h('div',
            h('div.note.note--info',
              h('strong', 'Grundlage der Besetzung ist die Mannschaft. '),
              'Wer da ist, welchen Zeitanteil er hat und in welcher Kalenderwoche er eingeplant ist, '
              + 'steht im Bereich Mannschaft – auch die Leiharbeiter. ',
              h('button.btn.btn--sm', { style: { marginLeft: '6px' }, onclick: () => a.navigate('team') },
                'Mannschaft öffnen')),
            h('div.small.muted', { style: { marginTop: '8px' } },
              'Die Felder „Stammmitarbeiter“ und die Wochenwerte wirken in dieser Betriebsart nicht – '
              + 'sie sind deshalb ausgeblendet, damit nicht an Zahlen gedreht wird, die nichts verändern.'),
            weeklyCount(cfg) > 0 && h('div.small.faint', { style: { marginTop: '6px' } },
              `Aus der bisherigen Excel-Planung sind noch Wochenwerte für ${weeklyCount(cfg)} Kalenderwochen `
              + 'hinterlegt. Sie werden nur noch als Vergleich in der Mannschaft angezeigt.'),
            h('div.grid.grid--form', { style: { marginTop: '10px' } },
              field('Mitarbeiter je Auftrag', cfg.projectLimits.maxWorkersPerProject, (v) => set({ projectLimits: { maxWorkersPerProject: v } }), {
                type: 'number', min: 0, hint: '0 = keine Begrenzung. Erfahrungswert 3–4.',
                validate: cfg.projectLimits.maxWorkersPerProjectValidated === false,
              }),
              field('Aufträge gleichzeitig', cfg.projectLimits.maxParallelProjects, (v) => set({ projectLimits: { maxParallelProjects: v } }), {
                type: 'number', min: 0, hint: '0 = ergibt sich aus Personal und Ressourcen.',
                validate: cfg.projectLimits.maxParallelProjectsValidated === false,
              })),
            h('hr.sep'),
            h('div.card__title', 'Einarbeitung neuer Kräfte',
              cfg.workforce.rampUp.validated === false && validateTag('Prozentwerte sind noch festzulegen.')),
            h('div.small.muted', { style: { marginBottom: '6px' } },
              'Gilt für Leiharbeiter und Neueinstellungen aus der Mannschaft: Leistung je Einsatzwoche, '
              + 'danach 100 %. Die Betreuungsstunden werden der Stammmannschaft abgezogen.'),
            h('div.grid.grid--2',
              rampEditor('Leistung Leiharbeiter (%)', cfg.workforce.rampUp.temp, (v) => set({ workforce: { rampUp: { temp: v } } })),
              rampEditor('Leistung Neueinstellungen (%)', cfg.workforce.rampUp.hire, (v) => set({ workforce: { rampUp: { hire: v } } })),
              rampEditor('Betreuung Leiharbeiter (h/Woche)', cfg.workforce.rampUp.mentoringHoursPerWeek?.temp ?? [], (v) => set({ workforce: { rampUp: { mentoringHoursPerWeek: { ...cfg.workforce.rampUp.mentoringHoursPerWeek, temp: v } } } }), { raw: true }),
              rampEditor('Betreuung Neueinstellungen (h/Woche)', cfg.workforce.rampUp.mentoringHoursPerWeek?.hire ?? [], (v) => set({ workforce: { rampUp: { mentoringHoursPerWeek: { ...cfg.workforce.rampUp.mentoringHoursPerWeek, hire: v } } } }), { raw: true })),
            /*
             * Diese beiden Listen waren hier frueher ausgeblendet, mit dem
             * Hinweis, sie wuerden "in dieser Betriebsart nicht wirken".
             * Das stimmte nicht: Sie kommen ZUSAETZLICH zur Mannschaft
             * dazu. Wer sie nicht sieht, sucht die Leute vergeblich in der
             * Mannschaftsliste - genau das ist passiert.
             */
            zusatzPersonal(a, cfg, an, set))
          : h('div',
            h('div.note.note--warn',
              h('strong', 'Rückfallebene: '),
              'Die Besetzung kommt aus Zahlen und Wochenwerten, nicht aus der Mannschaft. ',
              h('button.btn.btn--sm', {
                style: { marginLeft: '6px' },
                onclick: () => set({ workforce: { team: { source: 'MANNSCHAFT' } } }, 'Grundlage: Mannschaft'),
              }, 'Auf Mannschaft umstellen')),
            h('div.grid.grid--form', { style: { marginTop: '10px' } },
              field(weeklyCount(cfg) > 0 ? 'Stammmitarbeiter (Standardwert)' : 'Stammmitarbeiter',
                cfg.workforce.baseHeadcount, (v) => set({ workforce: { baseHeadcount: v } }), {
                  type: 'number', min: 0, validate: cfg.workforce.baseHeadcountValidated === false,
                  hint: weeklyCount(cfg) > 0
                    ? `Achtung: In ${weeklyCount(cfg)} Kalenderwochen sind abweichende Wochenwerte hinterlegt – diese haben Vorrang.`
                    : 'Gilt für alle Wochen ohne eigenen Eintrag.',
                }),
              field('Mitarbeiter je Auftrag', cfg.projectLimits.maxWorkersPerProject, (v) => set({ projectLimits: { maxWorkersPerProject: v } }), {
                type: 'number', min: 0, hint: '0 = keine Begrenzung. Erfahrungswert 3–4.',
              }),
              field('Aufträge gleichzeitig', cfg.projectLimits.maxParallelProjects, (v) => set({ projectLimits: { maxParallelProjects: v } }), {
                type: 'number', min: 0, hint: '0 = ergibt sich aus Personal und Ressourcen.',
              }),
              field('Neueinstellungen höchstens', cfg.workforce.maxNewHires, (v) => set({ workforce: { maxNewHires: v } }), { type: 'number', min: 0 })),
            weeklyCount(cfg) > 0 && h('div.note.note--info', { style: { marginTop: '4px' } },
              h('strong', 'Wochenweise Besetzung aktiv: '),
              `Für ${weeklyCount(cfg)} Kalenderwochen ist die Stammbesetzung einzeln gepflegt. `,
              h('button.btn.btn--sm', {
                style: { marginLeft: '6px' },
                onclick: async () => {
                  const ok = await confirmDialog('Wochenwerte entfernen?',
                    'Alle wochenspezifischen Werte für Stammbesetzung, Abwesenheiten, Überstunden und Produktivität '
                    + 'werden gelöscht. Fortfahren?', 'Wochenwerte entfernen');
                  if (!ok) return;
                  a.patchConfig({}, 'Wochenwerte entfernt', { clear: ['workforce.weekly'] });
                },
              }, 'Wochenwerte entfernen')),
            h('hr.sep'),
            h('div.card__title', 'Leiharbeiter'),
            workerList(a, cfg, 'tempWorkers', set),
            h('hr.sep'),
            h('div.card__title', 'Neueinstellungen'),
            workerList(a, cfg, 'newHires', set)))),

    card('Kosten',
      h('div',
        h('div.small.muted', { style: { marginBottom: '8px' } },
          'Die Kosten werden nur ausgewiesen, nie optimiert – die Termintreue steht darüber. '
          + 'Beim Leiharbeiter ist der Satz ein Rechnungssatz; Arbeitgeberanteile kommen dort nicht dazu.'),
        h('div.grid.grid--form',
          /*
           * Nutzervorgabe (23.09.2026): "Schmeiß den Hinweis zu Validieren
           * bei den Kosten raus." Die validate/validateHint-Markierungen
           * (amberfarbenes "zu validieren"-Schild) sind hier entfernt; die
           * reine Sacherklärung (hint) bleibt, wo sie eigenständig
           * informativ ist.
           */
          field('Stundenlohn Stamm (€)', cfg.costs?.baseRate ?? 22.5, (v) => set({ costs: { baseRate: v } }), {
            type: 'number', min: 0, step: 0.5,
            hint: 'Lohn, nicht Vollkosten.',
          }),
          field('Arbeitgeberanteile (Faktor)', cfg.costs?.employerFactor ?? 1.3, (v) => set({ costs: { employerFactor: v } }), {
            type: 'number', min: 1, step: 0.05,
            hint: 'Wirkt auf den Lohn, nicht auf Leiharbeit.',
          }),
          field('Mehrarbeit (% Zuschlag)', cfg.costs?.overtimeSurchargePercent ?? 35, (v) => set({ costs: { overtimeSurchargePercent: v } }), { type: 'number', min: 0, step: 5 }),
          field('Samstag (% Zuschlag)', cfg.costs?.saturdaySurchargePercent ?? 35, (v) => set({ costs: { saturdaySurchargePercent: v } }), { type: 'number', min: 0, step: 5 }),
          field('Spätschicht (€ je Schicht)', cfg.costs?.lateShiftAllowancePerShift ?? 24, (v) => set({ costs: { lateShiftAllowancePerShift: v } }), { type: 'number', min: 0, step: 1, hint: 'wird anteilig je Stunde gerechnet' }),
          field('Nachtschicht (% Zuschlag)', cfg.costs?.nightSurchargePercent ?? 40, (v) => set({ costs: { nightSurchargePercent: v } }), { type: 'number', min: 0, step: 5 }),
          field('Leiharbeiter (€ je Stunde)', cfg.costs?.tempRate ?? 55, (v) => set({ costs: { tempRate: v } }), {
            type: 'number', min: 0, step: 1,
          })),
        an.costs && h('div', { style: { marginTop: '10px' } },
          table([
            { key: 'label', label: 'Art der Stunde' },
            { key: 'cost', label: '€ je Stunde', num: true, render: (z) => h('strong', fmt.num(z.cost, 2)) },
            { key: 'note', label: 'Rechenweg', render: (z) => h('span.small.faint', z.note) },
          ], an.costs.rows, { compact: true }),
          h('div.note.note--info', { style: { marginTop: '8px' } },
            h('strong', 'Für die Argumentation: '), an.costs.comparison.text)))),

    card('Samstagsarbeit',
      h('div',
        h('div.grid.grid--form',
          field('Samstagsquote (% der verfügbaren MA)', Math.round(cfg.saturday.quota * 100), (v) => set({ saturday: { quota: (v ?? 0) / 100 } }), {
            type: 'number', min: 0, max: 100,
            validate: cfg.saturday.quotaValidated === false,
            validateHint: 'Lastenheft: 20 %; die bisherige Szenarienrechnung verwendete 80 %.',
            hint: `Aktuell entspricht das rund ${Math.round(cfg.workforce.baseHeadcount * cfg.saturday.quota)} Mitarbeitern.`,
          }),
          checkField('Samstagsarbeit grundsätzlich in allen Wochen', cfg.saturday.enabledDefault,
            (v) => set({ saturday: { enabledDefault: v } }), { groupLabel: 'Standard' })),
        h('div.field-row',
          h('label.field', h('span', 'Zeitraum aktivieren von'), h('input', { type: 'date', id: 'sa-from' })),
          h('label.field', h('span', 'bis'), h('input', { type: 'date', id: 'sa-to' })),
          h('button.btn', {
            onclick: () => {
              const from = document.getElementById('sa-from').value;
              const to = document.getElementById('sa-to').value;
              if (!from || !to) { toast('Bitte Zeitraum angeben.', 'error'); return; }
              const weeks = { ...(cfg.saturday.weeks ?? {}) };
              for (const w of an.weeks) {
                if (w.from >= from && w.from <= to) weeks[w.weekKey] = { ...(weeks[w.weekKey] ?? {}), enabled: true };
              }
              set({ saturday: { weeks } }, 'Samstagsarbeit aktiviert');
            },
          }, 'Samstagsarbeit aktivieren'),
          h('button.btn', {
            onclick: () => a.patchConfig({}, 'Samstagsarbeit zurückgesetzt', { clear: ['saturday.weeks'] }),
          }, 'Alle Samstage zurücksetzen'))),
      { sub: 'Der Samstagsbesatz wird dynamisch aus der Quote und der verfügbaren Mitarbeiterzahl berechnet.' }),

    !ausListe(cfg) && card('Wochenweise Kapazitäten',
      weeklyTable(a, cfg, an, set),
      { flush: true, sub: 'Leere Felder = Standardwert. Änderungen wirken nur in der jeweiligen Kalenderwoche.' }),

    h('div.grid.grid--2',
      card('Prozessressourcen', h('div.grid.grid--form',
        field('Orbitalschweißmaschinen (vorhanden)', cfg.resources.orbitalMachines, (v) => set({ resources: { orbitalMachines: v } }), { type: 'number', min: 0 }),
        field('davon aktiv/einsatzbereit', cfg.resources.orbitalMachinesActive, (v) => set({ resources: { orbitalMachinesActive: v } }), { type: 'number', min: 0, hint: 'Bei Maschinenausfall reduzieren.' }),
        field('Maschinen je Orbitalschweißer', cfg.resources.machinesPerWelder, (v) => set({ resources: { machinesPerWelder: v } }), { type: 'number', min: 1, step: '0.5' }),
        /*
         * Hier standen DREI Felder fuer dieselbe Groesse: "Eingesetzte
         * Orbitalschweisser je Tag", "Qualifizierte gesamt" und "davon in
         * Ausbildung" - und die Qualifikationsmatrix bestimmte es ein
         * viertes Mal. Gemeldet am 18.09.2026: "hier sind wieder zwei
         * Regler fuer einen Wert" und "vergiss die 2 in Ausbildung
         * orientier dich an der Qualimatrix". Gerechnet wird jetzt aus der
         * Matrix; die Felder bleiben nur in der Rueckfallebene.
         */
        ausListe(cfg)
          ? null
          : field('Eingesetzte Orbitalschweißer je Tag', cfg.resources.welders.default, (v) => set({ resources: { welders: { default: v } } }), {
            type: 'number', min: 0, validate: cfg.resources.welders.validated === false,
            hint: 'Nur in der Rückfallebene. Mit der Mannschaft zählt die Qualifikationsmatrix.',
          }),
        field('Belegungszeit der Plätze je Tag (h)', cfg.resources.operatingHoursPerDay ?? '', (v) => set({ resources: { operatingHoursPerDay: v } }), {
          type: 'number', min: 0, step: '0.5',
          hint: 'Gilt für JEDEN Arbeitsgang, der unten auf „Standard" steht – 15 h heißt also überall '
            + 'zwei Schichten. Einzeln wird das in der Tabelle darunter eingestellt. '
            + 'Verlängert NICHT die Arbeitszeit einzelner Mitarbeiter. Leer = wie Mitarbeiterarbeitszeit.',
        }),
        field('Heftplätze', cfg.resources.heftPlaces, (v) => set({ resources: { heftPlaces: v } }), { type: 'number', min: 0, max: cfg.resources.heftPlacesMax, hint: `technisch möglich: ${cfg.resources.heftPlacesMax}` }),
        field('Mitarbeiter je Heftplatz', cfg.resources.workersPerHeftPlace, (v) => set({ resources: { workersPerHeftPlace: v } }), {
          type: 'number', min: 0, step: '0.5', validate: cfg.resources.workersPerHeftPlaceValidated === false,
        }),
        field('Hydro-Prüfstände', cfg.resources.hydroStations ?? '', (v) => set({ resources: { hydroStations: v } }), { type: 'number', min: 0, hint: 'leer = keine Platzbegrenzung' }),
        field('Beizplätze', cfg.resources.beizStations ?? '', (v) => set({ resources: { beizStations: v } }), { type: 'number', min: 0, hint: 'leer = keine Platzbegrenzung' }))),

      card(ausListe(cfg) ? 'Orbitalschweißer – kommen aus der Mannschaft' : 'Orbitalschweißer je Wochentag',
        ausListe(cfg)
          ? h('div',
            h('div.note.note--info',
              h('strong', 'Wer orbital schweißen darf, steht in der Mannschaft. '),
              'Gerechnet wird mit den Personen, die dort beim Orbitalschweißen angehakt sind und '
              + 'am jeweiligen Tag da sind – mit ihrem Zeitanteil. Feste Zahlen je Tag oder '
              + 'Wochentag gibt es hier bewusst nicht mehr: Es wären zwei Regler für einen Wert. ',
              h('button.btn.btn--sm', { style: { marginLeft: '6px' }, onclick: () => a.navigate('team') },
                'Mannschaft öffnen')),
            h('div.small.muted', { style: { marginTop: '8px' } },
              `Derzeit sind ${an.team?.byOperation?.find((x) => x.opId === 'ORBITAL_KEHLNAHT')?.qualified ?? '–'} `
              + `für Kehlnaht und ${an.team?.byOperation?.find((x) => x.opId === 'ORBITAL_STUMPFNAHT')?.qualified ?? '–'} `
              + 'für Stumpfnaht Orbital angehakt (beide teilen sich dieselben Maschinen). Die Maschinen begrenzen zusätzlich: '
              + `${cfg.resources.orbitalMachinesActive} Maschinen ÷ ${cfg.resources.machinesPerWelder} `
              + `je Schweißer = höchstens ${Math.floor(Number(cfg.resources.orbitalMachinesActive)
                / Math.max(1, Number(cfg.resources.machinesPerWelder)))} gleichzeitig.`))
          : h('div',
            h('div.grid.grid--form', WEEKDAYS.map(([d, label]) => field(label, cfg.resources.welders.byWeekday?.[d] ?? '',
            (v) => {
              const bw = { ...(cfg.resources.welders.byWeekday ?? {}) };
              if (v === null || v === '') delete bw[d]; else bw[d] = v;
              set({ resources: { welders: { byWeekday: bw } } });
            }, { type: 'number', min: 0, placeholder: String(cfg.resources.welders.default) }))),
          h('div.small.muted', 'Leer = Standardwert. Tagesgenaue Ausnahmen können über die Wochentabelle ergänzt werden.'),
          h('div.note.note--info', { style: { marginTop: '10px' } },
            `Aktuell effektiv bedienbare Maschinen: ${fmt.num(an.orbital.maxSimultaneousMachines, 1)} `
            + `(begrenzt durch: ${an.orbital.limitedByLabel}).`)))),

    /*
     * Dieselbe Karte wie unter Uebersicht -> Engpaesse & Wirkung, bewusst
     * zweimal erreichbar: Dort gehoert sie in den Arbeitsfluss (neben die
     * Auslastung), hier in die Einrichtung - gesucht wird sie unter
     * "Parameter". Eine Funktion, zwei Wege.
     */
    shiftCard(a, an, cfg));
}

/** Seltener gebrauchte Einstellungen. */
function advanced(a, cfg, an, set) {
  return h('div',
    h('div.note.note--info',
      h('strong', 'Selten gebraucht: '),
      'Diese Werte sind einmal eingerichtet und bleiben meist unverändert. '
      + 'Änderungen wirken sich unmittelbar auf alle Termine aus.'),
    card('NoBo-Anwesenheit und Hydroprüfung',
      h('div',
        h('div.field-row', { style: { marginBottom: '10px' } },
          h('div',
            h('div.small.muted', { style: { marginBottom: '4px' } }, 'Regelanwesenheit NoBo ', validateTag('Anwesenheitsplanung ist zu bestätigen.')),
            h('div.btn-row', WEEKDAYS.map(([d, label]) => h('label.inline-check',
              h('input', {
                type: 'checkbox', checked: (cfg.nobo.weekdays ?? []).includes(d),
                onchange: (e) => {
                  const days = new Set(cfg.nobo.weekdays ?? []);
                  if (e.target.checked) days.add(d); else days.delete(d);
                  set({ nobo: { weekdays: [...days].sort() } }, 'NoBo-Anwesenheit geändert');
                },
              }), h('span', label))))),
          h('div', { style: { marginLeft: '20px' } },
            h('div.small.muted', { style: { marginBottom: '4px' } }, 'Zulässige Hydro-Wochentage'),
            h('div.btn-row', WEEKDAYS.map(([d, label]) => h('label.inline-check',
              h('input', {
                type: 'checkbox', checked: (cfg.hydro.allowedWeekdays ?? []).includes(d),
                onchange: (e) => {
                  const days = new Set(cfg.hydro.allowedWeekdays ?? []);
                  if (e.target.checked) days.add(d); else days.delete(d);
                  set({ hydro: { allowedWeekdays: [...days].sort() } }, 'Hydro-Zeitfenster geändert');
                },
              }), h('span', label)))),
            h('label.inline-check', { style: { marginTop: '6px' } },
              h('input', {
                type: 'checkbox', checked: cfg.hydro.requireNoBo !== false,
                onchange: (e) => set({ hydro: { requireNoBo: e.target.checked } }),
              }), h('span.small', 'Hydroprüfung nur bei NoBo-Anwesenheit')))),
        noboCalendar(a, cfg, an, set)),
      { sub: 'Klicken Sie einzelne Tage an, um die Anwesenheit abweichend von der Regel zu setzen.' }),

    h('div.grid.grid--2',
      card('Vorlaufzeiten und Material', h('div.grid.grid--form',
        field('Material verfügbar (Wochen vor Fertigstellung)', cfg.leadTimes.materialWeeks, (v) => set({ leadTimes: { materialWeeks: v } }), { type: 'number', min: 0, step: '0.5' }),
        ...a.state.catalog.projectTypes.map((t) => field(`Projektstart ${t.name} (Wochen vorher)`,
          cfg.leadTimes.startWeeks[t.id] ?? 0,
          (v) => set({ leadTimes: { startWeeks: { ...cfg.leadTimes.startWeeks, [t.id]: v } } }),
          { type: 'number', min: 0, step: '0.5' })))),

      card('Heften und Orbitalschweißen', h('div',
        h('div.grid.grid--form',
          field('Heften muss vorlaufen – mindestens (h)', cfg.tacking.minLeadHours, (v) => set({ tacking: { minLeadHours: v } }), { type: 'number', min: 0, step: '0.5' }),
          field('Heften soll vorlaufen – Zielwert (h)', cfg.tacking.targetLeadHours, (v) => set({ tacking: { targetLeadHours: v } }), { type: 'number', min: 0, step: '0.5' }),
          field('Heften darf vorlaufen – höchstens (h)', cfg.tacking.maxLeadHours, (v) => set({ tacking: { maxLeadHours: v } }), { type: 'number', min: 0, step: '0.5' })),
        checkField('Maximalvorsprung begrenzen (Heften läuft dem Orbitalschweißen nicht davon)',
          cfg.tacking.enforceMaxLead !== false, (v) => set({ tacking: { enforceMaxLead: v } })),
        h('hr.sep'),
        selectField('Fertigungsreihenfolge', cfg.sequencing.rule, [
          { value: 'PRIORITY_DUE', label: 'Priorität, dann Termin (Standard)' },
          { value: 'MANUAL', label: 'Manuelle Reihenfolge' },
          { value: 'EDD', label: 'Frühester Termin zuerst (EDD)' },
          { value: 'PRIORITY', label: 'Nur Priorität' },
          { value: 'SLACK', label: 'Geringster Puffer zuerst' },
          { value: 'CR', label: 'Kritisches Verhältnis' },
          { value: 'SPT', label: 'Kürzeste Arbeit zuerst' },
          { value: 'LPT', label: 'Längste Arbeit zuerst' },
        ], (v) => set({ sequencing: { rule: v } }, 'Reihenfolge geändert – neu berechnet')),
        checkField('Manuell fixierte Projekte behalten ihre Position',
          cfg.sequencing.respectLocked !== false, (v) => set({ sequencing: { respectLocked: v } }))))),

    card('Einsetzbare Mitarbeiter je Arbeitsgang',
      h('div',
        matrixGilt(cfg)
          ? h('div',
            h('div.note.note--info',
              h('strong', 'Diese Werte kommen aus der Qualifikationsmatrix. '),
              'Wer welchen Arbeitsgang darf, wird in der Mannschaft angehakt – hier stehen nur die Folgen. ',
              h('button.btn.btn--sm', { style: { marginLeft: '6px' }, onclick: () => a.navigate('team') },
                'Mannschaft öffnen')),
            table([
              { key: 'name', label: 'Arbeitsgang' },
              {
                key: 'qualified',
                label: 'Qualifizierte',
                num: true,
                render: (op) => {
                  const z = an.team?.byOperation?.find((x) => x.opId === op.id);
                  return z
                    ? h('span', { style: { fontWeight: 600, color: z.qualified === 0 ? 'var(--c-red)' : null } },
                      `${z.qualified}`)
                    : '–';
                },
              },
              {
                key: 'share',
                label: 'Anteil der Mannschaft',
                num: true,
                render: (op) => {
                  const z = an.team?.byOperation?.find((x) => x.opId === op.id);
                  return z ? fmt.pct(z.share, 0) : '–';
                },
              },
              {
                key: 'cap',
                /*
                 * Diese Spalte hiess "Kapazitaet im Zeitraum" und wurde als
                 * verfuegbare Mannstunden gelesen - gemeldet von der
                 * Abteilungsleitung am 18.09.2026 ("10.731 h, das kann
                 * nicht stimmen"). Sie sind es NICHT: Es ist die
                 * Belegungszeit der Plaetze (Plaetze x Belegungszeit x
                 * moegliche Tage). Aufaddieren ergibt Unsinn, weil
                 * dieselben Leute in jeder Zeile stecken.
                 */
                label: 'Platzstunden im Zeitraum',
                num: true,
                render: (op) => fmt.h(an.processBalance.find((p) => p.opId === op.id)?.capacityManHours ?? 0),
              },
              {
                key: 'open',
                label: 'offene Arbeit h',
                num: true,
                render: (op) => fmt.h(an.processBalance.find((p) => p.opId === op.id)?.openManHours ?? 0),
              },
            ], an.processBalance.map((p) => ({ id: p.opId, name: p.name })), { compact: true }),
            h('div.note.note--warn', { style: { marginTop: '8px' } },
              h('strong', 'Die Spalte „Platzstunden" nicht aufaddieren. '),
              'Sie sagt je Arbeitsgang, wie lange seine Plätze im Zeitraum '
              + `${fmt.date(an.planningDate)} bis ${fmt.date(an.relevantUntil)} überhaupt belegt werden können `
              + '(Plätze × Belegungszeit × mögliche Tage). Das sind keine zusätzlichen Mitarbeiterstunden – '
              + 'alle Arbeitsgänge greifen auf dieselbe Mannschaft zu. ',
              h('div', { style: { marginTop: '6px' } },
                h('strong', 'Mitarbeiterstunden im selben Zeitraum: '),
                `${fmt.h(an.kpis?.availableHours ?? 0)} – einmal gezählt, für alle Arbeitsgänge zusammen.`)))
          : h('div',
            h('div.small.muted', { style: { marginBottom: '8px' } },
              'Anteil der Mitarbeiter, die den jeweiligen Arbeitsgang ausführen können. ',
              'Die Qualifikationsmatrix in der Mannschaft ist derzeit abgeschaltet. ', validateTag()),
            table([
              { key: 'name', label: 'Arbeitsgang' },
              {
                key: 'share',
                label: 'Anteil einsetzbar (%)',
                num: true,
                render: (op) => h('input', {
                  type: 'number', min: 0, max: 100, step: 5, style: { width: '90px' },
                  value: Math.round((cfg.skills[op.id]?.share ?? 0) * 100),
                  onchange: (e) => set({ skills: { [op.id]: { share: Number(e.target.value) / 100 } } }),
                }),
              },
              {
                key: 'headcount',
                label: 'oder feste Kopfzahl',
                num: true,
                render: (op) => h('input', {
                  type: 'number', min: 0, step: 1, style: { width: '90px' }, placeholder: '–',
                  value: cfg.skills[op.id]?.headcount ?? '',
                  onchange: (e) => set({ skills: { [op.id]: { headcount: e.target.value === '' ? null : Number(e.target.value) } } }),
                }),
              },
              {
                key: 'cap',
                label: 'Kapazität im Zeitraum',
                num: true,
                render: (op) => fmt.h(an.processBalance.find((p) => p.opId === op.id)?.capacityManHours ?? 0),
              },
            ], an.processBalance.map((p) => ({ id: p.opId, name: p.name })), { compact: true }))),
      { flush: true, sub: 'Ein Arbeitsgang ohne Qualifizierte kann nicht eingeplant werden.' }),

    card('Fremdvergabe',
      h('div',
        checkField('Fremdvergabe zulassen', !!cfg.outsourcing.enabled, async (v) => {
          if (v) {
            const ok = await confirmDialog('Fremdvergabe aktivieren?',
              'Laut aktueller Planungsvorgabe ist Fremdvergabe ausgeschlossen. Wirklich aktivieren?', 'Aktivieren');
            if (!ok) { a.render(); return; }
          }
          set({ outsourcing: { enabled: v } });
        }),
        h('div.small.muted', 'Ist die Option deaktiviert, schlägt der Optimierer niemals eine externe Fertigung vor.'))));
}

/** Gespeicherte Stände und Vergleichsstände. */
function scenarioCard(a) {
  const box = h('div');
  let neuName = '';

  box.append(
    card('Szenarien',
      h('div',
        h('div.small.muted', { style: { marginBottom: '10px' } },
          'Ein Szenario ist eine benannte Sammlung von Stellschrauben („+3 Leiharbeiter ab KW 42"). ',
          'Der „Arbeitsstand" ist Ihr laufender Stand, die „Baseline" der unveränderte Ausgangsstand. ',
          'Ein Szenario kann als ',
          h('strong', 'Aktueller Plan'),
          ' markiert werden – die Kollegen sehen dann oben, woran sich die Fertigung orientiert.'),
        table([
          {
            key: 'name',
            label: 'Szenario',
            render: (s) => h('div',
              h('strong', s.name),
              s.id === a.scenarioId && h('span.pill.pill--blue', { style: { marginLeft: '6px' } }, 'geöffnet'),
              s.isCurrentPlan && h('span.pill.pill--green', { style: { marginLeft: '6px' } }, 'Aktueller Plan'),
              s.description && h('div.small.muted', s.description)),
          },
          { key: 'createdBy', label: 'von', render: (s) => h('span.mono.small', s.createdBy || '–') },
          {
            key: 'action',
            label: '',
            render: (s) => h('div.btn-row',
              s.id !== a.scenarioId && h('button.btn.btn--sm', {
                onclick: async () => { await api.activateScenario(s.id); await a.reload(); },
              }, 'Öffnen'),
              !s.isCurrentPlan && h('button.btn.btn--sm', {
                onclick: async () => { await api.setCurrentPlan(s.id); await a.reload(); toast('Als aktueller Plan markiert.', 'ok'); },
              }, 'Als aktuellen Plan'),
              s.isCurrentPlan && h('button.btn.btn--sm', {
                onclick: async () => { await api.setCurrentPlan(null); await a.reload(); },
              }, 'Markierung aufheben'),
              !s.isBaseline && s.id !== 'ARBEITSSTAND' && h('button.btn.btn--sm.btn--danger', {
                onclick: async () => {
                  const ok = await confirmDialog('Szenario löschen?', `„${s.name}" wird gelöscht.`, 'Löschen');
                  if (!ok) return;
                  await api.deleteScenario(s.id);
                  await a.reload();
                },
              }, 'Löschen')),
          },
        ], a.state.scenarios, { compact: true }),

        h('hr.sep'),
        h('div.field-row',
          h('label.field', { style: { marginBottom: 0 } },
            h('span', 'Neues Szenario aus dem aktuellen Stand'),
            h('input', {
              type: 'text', placeholder: 'z. B. Mit 3 Leiharbeitern ab KW 42',
              oninput: (e) => { neuName = e.target.value; },
            })),
          h('button.btn', {
            style: { marginTop: '18px' },
            onclick: async () => {
              if (!neuName.trim()) { toast('Bitte einen Namen eintragen.', 'error'); return; }
              const s = await api.createScenario(neuName.trim(), a.scenarioId);
              await api.activateScenario(s.id);
              await a.reload();
              toast('Szenario angelegt und geöffnet.', 'ok');
            },
          }, '+ Szenario anlegen'))),
      { sub: 'Szenarien sind für alle sichtbar. Für einen vollständigen Rücksprungpunkt (mit Aufträgen) dient der Bereich „Stände".' }));

  return box;
}

/* ---------------- Benutzer (nur Verwaltung) ---------------- */

function userCard(a) {
  const box = h('div');
  const liste = h('div', h('div.empty', 'Benutzer werden geladen …'));
  let neuId = '';
  let neuLabel = '';

  const reload = async () => {
    try {
      const users = await api.users();
      liste.replaceChildren(table([
        { key: 'id', label: 'Kürzel', render: (u) => h('strong.mono', u.id) },
        { key: 'label', label: 'Name / Bemerkung', render: (u) => h('span.small.muted', u.label || '–') },
        {
          key: 'hasPassword',
          label: 'Passwort',
          render: (u) => (u.hasPassword
            ? h('span.pill.pill--green', 'vergeben')
            : h('span.pill.pill--amber', 'wird bei der ersten Anmeldung vergeben')),
        },
        { key: 'admin', label: 'Verwaltung', render: (u) => (u.admin ? h('span.pill.pill--blue', 'ja') : h('span.faint', '–')) },
        { key: 'lastLoginAt', label: 'zuletzt angemeldet', render: (u) => (u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : h('span.faint', 'noch nie')) },
        {
          key: 'action',
          label: '',
          render: (u) => a.isAdmin && h('div.btn-row',
            h('button.btn.btn--sm', {
              onclick: async () => {
                const ok = await confirmDialog('Passwort zurücksetzen?',
                  `${u.id} vergibt bei der nächsten Anmeldung ein neues Passwort. Laufende Anmeldungen von ${u.id} werden beendet.`,
                  'Zurücksetzen');
                if (!ok) return;
                await api.resetUserPassword(u.id);
                toast(`Passwort von ${u.id} zurückgesetzt.`, 'ok');
                reload();
              },
            }, 'Passwort zurücksetzen'),
            // Das eigene Kuerzel laesst sich nicht loeschen - sonst waere man
            // mitten im Arbeiten ausgesperrt.
            u.id !== a.user?.id && h('button.btn.btn--sm.btn--danger', {
              onclick: async () => {
                const ok = await confirmDialog('Kürzel löschen?', `${u.id} kann sich danach nicht mehr anmelden.`, 'Löschen');
                if (!ok) return;
                await api.deleteUser(u.id);
                reload();
              },
            }, 'Löschen')),
        },
      ], users, { compact: true }));
    } catch {
      liste.replaceChildren(h('div.note.note--error', 'Benutzer konnten nicht geladen werden.'));
    }
  };
  reload();

  box.append(
    card('Benutzer',
      h('div',
        h('div.note.note--info',
          h('strong', 'Alle dürfen dasselbe. '),
          'Das Kürzel dient dem Änderungsnachweis und der Anmeldung. ',
          'Nur die Verwaltung (Kürzel mit dem Vermerk „Verwaltung") kann Kürzel anlegen, löschen und Passwörter zurücksetzen.'),
        liste,
        a.isAdmin && h('div', { style: { marginTop: '12px' } },
          h('hr.sep'),
          h('div.card__title', 'Neues Kürzel anlegen'),
          h('div.field-row',
            h('label.field', { style: { marginBottom: 0 } }, h('span', 'Kürzel'),
              h('input', {
                type: 'text', placeholder: 'z. B. MAMU', maxLength: 10,
                oninput: (e) => { neuId = e.target.value.toUpperCase(); e.target.value = neuId; },
              })),
            h('label.field', { style: { marginBottom: 0 } }, h('span', 'Name (freiwillig)'),
              h('input', { type: 'text', oninput: (e) => { neuLabel = e.target.value; } })),
            h('button.btn.btn--primary', {
              style: { marginTop: '18px' },
              onclick: async () => {
                if (!neuId.trim()) { toast('Bitte ein Kürzel eintragen.', 'error'); return; }
                await api.createUser({ id: neuId.trim(), label: neuLabel.trim() });
                toast(`${neuId} angelegt. Das Passwort vergibt ${neuId} bei der ersten Anmeldung selbst.`, 'ok');
                neuId = '';
                reload();
              },
            }, '+ Kürzel anlegen'))),
        !a.isAdmin && h('div.small.muted', { style: { marginTop: '10px' } },
          'Neue Kürzel und Passwort-Zurücksetzungen macht die Verwaltung.')),
      { sub: 'Die Anmeldung ordnet Änderungen Personen zu – sie ist keine Zugriffssicherung.' }));

  return box;
}

/* ---------------- Bausteine ---------------- */

/**
 * Zusaetzliche Kraefte NEBEN der Mannschaft.
 *
 * Die Mannschaft fuehrt Personen mit Kuerzel. Diese beiden Listen fuehren
 * ANZAHLEN ohne Namen - sie sind die Sprache der Bedarfsrechnung ("+4
 * Leiharbeiter ab KW 42") und der Vorschlaege aus "Was bringt wirklich
 * etwas?". Beides zaehlt zusammen; wer das nicht sieht, wundert sich ueber
 * 29 Mitarbeiter in einer Abteilung mit neun.
 */
function zusatzPersonal(a, cfg, an, set) {
  const summe = (key) => (cfg.workforce[key] ?? []).reduce((x, w) => x + (Number(w.count) || 0), 0);
  const zusatz = summe('tempWorkers') + summe('newHires');
  if (zusatz === 0) {
    return h('div',
      h('hr.sep'),
      h('div.card__title', 'Zusätzliche Kräfte'),
      h('div.small.muted', { style: { marginTop: '6px' } },
        'Personal wird ausschließlich im Reiter Mannschaft gepflegt – auch Leiharbeiter und '
        + 'Neueinstellungen. Hier gibt es dafür bewusst kein zweites Feld.'));
  }

  /*
   * Diese Listen sind Altbestand. Seit der Vorgabe vom 17.09.2026 ("rein
   * ueber den Reiter Mannschaft anpassen") gehen sie in der Betriebsart
   * MANNSCHAFT nicht mehr in die Rechnung ein. Sie werden nicht
   * stillschweigend geloescht - beides waere falsch: verrechnen UND
   * verschwinden lassen.
   */
  const eintraege = [...(cfg.workforce.tempWorkers ?? []), ...(cfg.workforce.newHires ?? [])]
    .filter((w) => Number(w.count) > 0);
  const frueheste = eintraege.map((w) => w.from).filter(Boolean).sort()[0] ?? an.planningDate;

  return h('div',
    h('hr.sep'),
    h('div.card__title', 'Alte Zahlenlisten – ohne Wirkung'),
    h('div.note.note--warn', { style: { marginTop: '6px' } },
      h('strong', `${zusatz} Personen stehen hier noch als reine Anzahl. `),
      'Sie gehen NICHT in die Rechnung ein, solange die Mannschaft die Grundlage ist – '
      + 'Personal wird ausschließlich im Reiter Mannschaft gepflegt. ',
      h('div.small', { style: { marginTop: '6px' } },
        eintraege.map((w) => `${w.label || 'ohne Bezeichnung'}: +${w.count}`
          + `${w.from ? ` ab ${fmt.date(w.from)}` : ''}`).join(' · ')),
      h('div.btn-row', { style: { marginTop: '8px' } },
        h('button.btn.btn--sm.btn--primary', {
          title: 'Legt für jede Person einen Leiharbeiterplatz in der Mannschaft an – dort zählt sie',
          onclick: () => inDieMannschaft(a, cfg, zusatz, frueheste),
        }, 'In die Mannschaft übernehmen'),
        h('button.btn.btn--sm', {
          onclick: async () => {
            const ok = await confirmDialog('Alte Zahlenlisten entfernen?',
              'Die Einträge werden gelöscht. An der Rechnung ändert sich nichts – '
              + 'sie wirken ohnehin nicht mehr.', 'Entfernen');
            if (!ok) return;
            a.patchConfig({}, 'Alte Zahlenlisten entfernt',
              { clear: ['workforce.tempWorkers', 'workforce.newHires'] });
          },
        }, 'Entfernen'),
        h('button.btn.btn--sm', { onclick: () => a.navigate('team') }, 'Mannschaft öffnen'))));
}

/**
 * Uebertraegt die alten Anzahlen in die Mannschaft: je Person ein
 * Leiharbeiterplatz mit Eintritt. Danach sind die Listen leer.
 */
async function inDieMannschaft(a, cfg, anzahl, ab) {
  let datum = ab || a.analysis.planningDate;
  const m = modal({
    title: 'In die Mannschaft übernehmen',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        `${anzahl} Leiharbeiter werden in der Mannschaft eingeplant – je Person ein Kürzel mit `
        + 'Eintrittsdatum. Danach zählen sie in der Rechnung, und die alten Zahlenlisten werden '
        + 'geleert. Namen und Qualifikationen lassen sich anschließend in der Mannschaft pflegen.'),
      h('label.field', h('span', 'Eintritt'),
        h('input', { type: 'date', value: datum, onchange: (e) => { datum = e.target.value; } }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!datum) { toast('Bitte ein Eintrittsdatum angeben.', 'error'); return; }
          const people = (cfg.workforce?.team?.people ?? []).map((p) => ({ ...p }));
          let offen = anzahl;
          for (const p of people) {
            if (offen === 0) break;
            if (p.kind !== 'LEIHE') continue;
            if (p.startDate || Object.values(p.weeks ?? {}).some(Boolean)) continue;
            p.startDate = datum;
            p.defaultActive = true;
            offen -= 1;
          }
          let nummer = people.length + 1;
          while (offen > 0) {
            const id = `LEIHE-${String(nummer).padStart(2, '0')}`;
            nummer += 1;
            if (people.some((p) => p.id === id)) continue;
            people.push({
              id, label: `Leiharbeiter ${nummer - 1}`, role: '', kind: 'LEIHE', factor: 1, rate: 55,
              shiftCapable: true, skills: {}, absences: [], weeks: {},
              startDate: datum, endDate: null, defaultActive: true, active: true,
              note: 'aus den alten Zahlenlisten übernommen',
            });
            offen -= 1;
          }
          try {
            await a.patchConfig({ workforce: { team: { people } } }, null);
            await a.patchConfig({}, `${anzahl} Leiharbeiter in die Mannschaft übernommen`,
              { clear: ['workforce.tempWorkers', 'workforce.newHires'] });
            m.close();
            toast('Übernommen – die Leute stehen jetzt in der Mannschaft.', 'ok');
          } catch (err) {
            toast(err?.message ?? 'Das hat nicht geklappt.', 'error');
          }
        },
      }, 'Übernehmen'),
    ],
  });
}

function workerList(a, cfg, key, set) {
  const list = cfg.workforce[key] ?? [];
  const isTemp = key === 'tempWorkers';
  return h('div',
    table([
      {
        key: 'label',
        label: 'Bezeichnung',
        render: (w) => h('input', {
          type: 'text', value: w.label ?? '', style: { width: '160px' },
          onchange: (e) => update(w.id, { label: e.target.value }),
        }),
      },
      {
        key: 'count',
        label: 'Anzahl',
        num: true,
        render: (w) => h('input', {
          type: 'number', min: 0, value: w.count, style: { width: '70px' },
          onchange: (e) => update(w.id, { count: Number(e.target.value) }),
        }),
      },
      {
        key: 'from',
        label: 'ab',
        render: (w) => h('input', {
          type: 'date', value: w.from ?? '', style: { width: '140px' },
          onchange: (e) => update(w.id, { from: e.target.value }),
        }),
      },
      isTemp && {
        key: 'to',
        label: 'bis (optional)',
        render: (w) => h('input', {
          type: 'date', value: w.to ?? '', style: { width: '140px' },
          onchange: (e) => update(w.id, { to: e.target.value || null }),
        }),
      },
      {
        key: 'del',
        label: '',
        render: (w) => h('button.btn.btn--sm.btn--danger', {
          onclick: () => set({ workforce: { [key]: list.filter((x) => x.id !== w.id) } }, 'Eintrag entfernt'),
        }, 'Entfernen'),
      },
    ].filter(Boolean), list, { compact: true, empty: isTemp ? 'Keine Leiharbeiter eingeplant.' : 'Keine Neueinstellungen eingeplant.' }),
    h('button.btn.btn--sm', {
      style: { marginTop: '8px' },
      onclick: () => set({
        workforce: {
          [key]: [...list, {
            id: `W-${Date.now()}`, label: isTemp ? 'Leiharbeiter' : 'Neueinstellung',
            count: isTemp ? 2 : 1, from: a.analysis.planningDate, to: null, skills: null,
          }],
        },
      }, 'Eintrag hinzugefügt'),
    }, isTemp ? '+ Leiharbeiter hinzufügen' : '+ Neueinstellung hinzufügen'));

  function update(id, patch) {
    set({ workforce: { [key]: list.map((w) => (w.id === id ? { ...w, ...patch } : w)) } });
  }
}

function rampEditor(label, curve, onChange, opts = {}) {
  const raw = !!opts.raw;
  const values = Array.isArray(curve) ? curve : [];
  const inputs = values.map((v, i) => h('label.field', { style: { width: '92px', marginBottom: 0 } },
    h('span', `Woche ${i + 1}`),
    h('input', {
      type: 'number', min: 0, max: raw ? 40 : 100, step: raw ? 0.5 : 1,
      value: raw ? v : Math.round(v * 100),
      onchange: (e) => {
        const next = values.slice();
        next[i] = raw ? Number(e.target.value) : Number(e.target.value) / 100;
        onChange(next);
      },
    })));
  const buttons = h('div', { style: { paddingTop: '16px' } },
    h('button.btn.btn--sm', { onclick: () => onChange([...values, raw ? 0 : 0.9]) }, '+'),
    values.length > 0 && h('button.btn.btn--sm', {
      style: { marginLeft: '4px' },
      onclick: () => onChange(values.slice(0, -1)),
    }, '\u2212'));
  return h('div',
    h('div.small', { style: { fontWeight: 600, marginBottom: '5px' } }, label),
    h('div.btn-row', inputs, buttons),
    h('div.small.faint', raw
      ? `danach 0 h (ab Woche ${values.length + 1})`
      : `danach 100 % (ab Woche ${values.length + 1})`));
}

function weeklyTable(a, cfg, an, set) {
  const weeks = an.weeks;
  const ov = cfg.workforce.weekly ?? {};
  const sat = cfg.saturday.weeks ?? {};
  const upd = (key, patch) => set({ workforce: { weekly: { ...ov, [key]: { ...(ov[key] ?? {}), ...patch } } } });
  const updSat = (key, patch) => set({ saturday: { weeks: { ...sat, [key]: { ...(sat[key] ?? {}), ...patch } } } });
  const numInput = (value, placeholder, onChange, opts = {}) => h('input', {
    type: 'number', value: value ?? '', placeholder, style: { width: '72px' },
    min: opts.min ?? 0, step: opts.step ?? 1,
    onchange: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)),
  });

  return table([
    { key: 'weekKey', label: 'KW', render: (w) => h('strong', fmt.week(w.weekKey)) },
    { key: 'from', label: 'Von', render: (w) => fmt.date(w.from) },
    {
      key: 'base',
      label: 'Stamm-MA',
      num: true,
      render: (w) => numInput(ov[w.weekKey]?.base, String(cfg.workforce.baseHeadcount), (v) => upd(w.weekKey, { base: v })),
    },
    {
      key: 'absent',
      label: 'Abwesend',
      num: true,
      render: (w) => numInput(ov[w.weekKey]?.absent, '0', (v) => upd(w.weekKey, { absent: v })),
    },
    {
      key: 'ot',
      label: 'Überstd./MA',
      num: true,
      render: (w) => numInput(ov[w.weekKey]?.overtimePerEmployee, String(cfg.workforce.overtimePerEmployeeDefault),
        (v) => upd(w.weekKey, { overtimePerEmployee: v }), { step: 0.5 }),
    },
    {
      key: 'prod',
      label: 'Produktivität %',
      num: true,
      render: (w) => numInput(ov[w.weekKey]?.productivity != null ? Math.round(ov[w.weekKey].productivity * 100) : null,
        String(Math.round(cfg.productivity.global * 100)),
        (v) => upd(w.weekKey, { productivity: v == null ? null : v / 100 })),
    },
    {
      key: 'sat',
      label: 'Samstag',
      render: (w) => h('label.inline-check',
        h('input', {
          type: 'checkbox', checked: sat[w.weekKey]?.enabled ?? cfg.saturday.enabledDefault,
          onchange: (e) => updSat(w.weekKey, { enabled: e.target.checked }),
        })),
    },
    {
      key: 'satHead',
      label: 'Sa-Besatz',
      num: true,
      render: (w) => numInput(sat[w.weekKey]?.headcountOverride,
        String(Math.round((w.avgHeadcount || cfg.workforce.baseHeadcount) * cfg.saturday.quota)),
        (v) => updSat(w.weekKey, { headcountOverride: v })),
    },
    { key: 'cap', label: 'Kapazität', num: true, render: (w) => fmt.h(w.capacity) },
    { key: 'demand', label: 'Bedarf', num: true, render: (w) => fmt.h(w.demand) },
    {
      key: 'over',
      label: 'Überlast',
      num: true,
      render: (w) => (w.overload > 0 ? h('span.pill.pill--red', fmt.h(w.overload)) : h('span.faint', '–')),
    },
  ], weeks, { compact: true });
}
function noboCalendar(a, cfg, an, set) {
  const months = {};
  for (const d of an.days) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay() || 7;
    if (wd > 5) continue;
    (months[d.date.slice(0, 7)] ??= []).push(d.date);
  }
  const allowed = cfg.hydro.allowedWeekdays ?? [2, 3, 4];
  const exceptions = cfg.nobo.exceptions ?? {};
  const present = (date) => (Object.prototype.hasOwnProperty.call(exceptions, date)
    ? !!exceptions[date]
    : (cfg.nobo.weekdays ?? []).includes(new Date(`${date}T00:00:00Z`).getUTCDay() || 7));

  return h('div.cal__months', Object.entries(months).slice(0, 6).map(([month, dates]) => h('div.cal__month',
    h('h4', new Date(`${month}-01T00:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })),
    h('div.cal', dates.map((date) => {
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      const inWindow = allowed.includes(wd);
      const on = present(date);
      return h(`div.cal__day${!inWindow ? '.cal__day--blocked' : on ? '.cal__day--on' : '.cal__day--off'}`, {
        title: inWindow
          ? `${date}: NoBo ${on ? 'anwesend' : 'nicht anwesend'} – klicken zum Umschalten`
          : `${date}: Hydroprüfung an diesem Wochentag nicht zulässig`,
        onclick: () => {
          if (!inWindow) return;
          set({ nobo: { exceptions: { ...exceptions, [date]: !on } } }, 'NoBo-Kalender geändert');
        },
      }, h('small', ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr'][wd]), date.slice(8));
    })))));

}
