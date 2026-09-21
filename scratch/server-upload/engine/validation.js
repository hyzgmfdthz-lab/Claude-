/**
 * Datenvalidierung (§79).
 */

import { PROJECT_TYPES, VARIANTS, PRIORITIES, OPERATION_BY_ID, routingKey } from './model.js';
import { isValidDate, cmpDate, formatDE, weekday } from './calendar.js';
import { resolveRouting } from './routing.js';
import { noboPresent } from './capacity.js';

const ERR = 'FEHLER';
const WARN = 'WARNUNG';
const INFO = 'HINWEIS';

/**
 * @param {{config:any, projects:any[], templates:Record<string,any>, workplaces?:any[]}} data
 * @returns {{level:string, code:string, message:string, projectId?:string, field?:string}[]}
 */
export function validate(data) {
  const out = [];
  const { config, projects, templates } = data;
  const add = (level, code, message, extra = {}) => out.push({ level, code, message, ...extra });

  /* ---- Projekte ---- */
  const seenIds = new Set();
  const seenOrders = new Map();

  for (const p of projects) {
    const label = p.orderNo || p.name || p.id;

    if (!p.id) add(ERR, 'ID_FEHLT', 'Projekt ohne eindeutige ID.');
    if (seenIds.has(p.id)) add(ERR, 'ID_DOPPELT', `Projekt-ID ${p.id} ist doppelt vergeben.`, { projectId: p.id });
    seenIds.add(p.id);

    if (p.orderNo) {
      if (seenOrders.has(p.orderNo)) {
        add(WARN, 'AUFTRAG_DOPPELT',
          `Auftragsnummer ${p.orderNo} wird von zwei Projekten verwendet (${seenOrders.get(p.orderNo)} und ${p.id}). Bitte prüfen, ob es sich um ein Doppelprojekt handelt.`,
          { projectId: p.id, field: 'orderNo' });
      }
      seenOrders.set(p.orderNo, p.id);
    } else {
      add(WARN, 'AUFTRAG_FEHLT', `${label}: Auftragsnummer fehlt.`, { projectId: p.id, field: 'orderNo' });
    }
    if (p.orderNo && /[%?*]|x{3,}/i.test(p.orderNo)) {
      add(WARN, 'AUFTRAG_UNVOLLSTAENDIG',
        `${label}: Die Auftragsnummer enthält noch Platzhalter und ist zu vervollständigen.`,
        { projectId: p.id, field: 'orderNo' });
    }

    if (!p.dueDate) {
      add(ERR, 'TERMIN_FEHLT', `${label}: Fertigstellungstermin (Deadline Armaturenbau) fehlt.`, { projectId: p.id, field: 'dueDate' });
    } else if (!isValidDate(p.dueDate)) {
      add(ERR, 'TERMIN_UNGUELTIG', `${label}: Fertigstellungstermin ist ungültig (${p.dueDate}).`, { projectId: p.id, field: 'dueDate' });
    } else if (cmpDate(p.dueDate, config.planningDate) < 0 && !p.done) {
      add(WARN, 'TERMIN_VERGANGEN',
        `${label}: Fertigstellung ${formatDE(p.dueDate)} liegt vor dem Planungsstichtag ${formatDE(config.planningDate)} und das Projekt ist nicht als fertig gemeldet → verspätet.`,
        { projectId: p.id, field: 'dueDate' });
    }

    if (p.handoverDate && p.dueDate && cmpDate(p.handoverDate, p.dueDate) < 0) {
      add(WARN, 'FERTIG_VOR_FERTIGSTELLUNG',
        `${label}: Termin "Fertig" (Gesamtanlage) liegt vor der Fertigstellung des Armaturenbaus.`, { projectId: p.id });
    }

    const type = PROJECT_TYPES.find((t) => t.id === p.projectType);
    if (!type) {
      add(ERR, 'PROJEKTART_UNGUELTIG', `${label}: Unbekannte Projektart "${p.projectType}".`, { projectId: p.id, field: 'projectType' });
    } else if (type.hasVariant) {
      if (!p.variant) {
        add(WARN, 'VARIANTE_FEHLT', `${label}: MEGC-Variante fehlt (20/30/40/45 ft).`, { projectId: p.id, field: 'variant' });
      } else if (!VARIANTS.some((v) => v.id === p.variant)) {
        add(ERR, 'VARIANTE_UNGUELTIG', `${label}: Unbekannte Variante "${p.variant}".`, { projectId: p.id, field: 'variant' });
      }
    }

    if (!PRIORITIES.includes(p.priority)) {
      add(WARN, 'PRIORITAET_UNGUELTIG', `${label}: Priorität "${p.priority}" ist unbekannt (erlaubt: P1–P4).`, { projectId: p.id, field: 'priority' });
    }

    const key = routingKey(p.projectType, p.variant);
    if (!templates[key] && !templates[p.projectType] && !Object.keys(templates).some((k) => k.startsWith(`${p.projectType}_`))) {
      add(ERR, 'ARBEITSFOLGE_FEHLT', `${label}: Keine Arbeitsfolge für ${key} hinterlegt.`, { projectId: p.id });
    }

    const routing = resolveRouting(p, templates, config);
    if (routing.usedFallbackTemplate) {
      add(WARN, 'ARBEITSFOLGE_ERSATZ',
        `${label}: Es wird eine Ersatz-Arbeitsfolge (${routing.templateKey}) verwendet, weil die Variante fehlt.`, { projectId: p.id });
    }
    if (routing.totalManHours <= 0 && !p.done) {
      add(WARN, 'STUNDEN_NULL', `${label}: Arbeitsinhalt ist 0 Stunden.`, { projectId: p.id });
    }

    for (const op of p.operations ?? []) {
      if (!OPERATION_BY_ID[op.opId]) {
        add(ERR, 'ARBEITSGANG_UNBEKANNT', `${label}: Unbekannter Arbeitsgang "${op.opId}".`, { projectId: p.id });
      }
      if (op.plannedHours != null && Number(op.plannedHours) < 0) {
        add(ERR, 'STUNDEN_NEGATIV', `${label}/${op.opId}: Negative Stunden.`, { projectId: p.id });
      }
      if (op.remainingHours != null && Number(op.remainingHours) < 0) {
        add(ERR, 'RESTSTUNDEN_NEGATIV', `${label}/${op.opId}: Negative Reststunden.`, { projectId: p.id });
      }
      if (op.status === 'FERTIG' && Number(op.remainingHours) > 0) {
        add(ERR, 'FERTIG_MIT_REST',
          `${label}/${op.opId}: Status "Fertig", aber Reststunden > 0.`, { projectId: p.id });
      }
    }

    if (p.done && routing.remainingManHours > 0) {
      add(ERR, 'PROJEKT_FERTIG_MIT_REST', `${label}: Als fertig gemeldet, aber ${routing.remainingManHours} h Restaufwand.`, { projectId: p.id });
    }
    if (p.progressMode === 'PERCENT' && (p.progressPercent < 0 || p.progressPercent > 100)) {
      add(ERR, 'FORTSCHRITT_UNGUELTIG', `${label}: Fortschritt ${p.progressPercent}% liegt außerhalb 0–100%.`, { projectId: p.id });
    }
    if (p.progressMode === 'PERCENT' && p.progressPercent > 0 && (p.operations ?? []).some((o) => o.remainingHours != null)) {
      add(INFO, 'FORTSCHRITT_WIDERSPRUCH',
        `${label}: Es sind sowohl Gesamtfortschritt (%) als auch Reststunden je Arbeitsgang gepflegt. Es gelten die Reststunden nur bei Fortschrittsart "Reststunden je Arbeitsgang".`,
        { projectId: p.id });
    }
  }

  /* ---- Arbeitsfolgen ---- */
  for (const [key, tpl] of Object.entries(templates)) {
    if (!tpl.steps?.length) {
      add(ERR, 'VORLAGE_LEER', `Arbeitsfolge ${key} enthält keine Arbeitsgänge.`);
      continue;
    }
    const ids = new Set(tpl.steps.map((s) => s.opId));
    for (const s of tpl.steps) {
      if (Number(s.hours) < 0) add(ERR, 'VORLAGE_STUNDEN_NEGATIV', `Arbeitsfolge ${key}/${s.opId}: negative Stunden.`);
      for (const pre of s.predecessors ?? []) {
        if (!ids.has(pre.opId)) {
          add(ERR, 'VORLAGE_VORGAENGER', `Arbeitsfolge ${key}/${s.opId}: Vorgänger "${pre.opId}" existiert nicht.`);
        }
      }
    }
    if (tpl.validated === false) {
      add(INFO, 'ZU_VALIDIEREN', `Arbeitsfolge ${tpl.label ?? key}: Stunden je Arbeitsgang sind Startwerte und müssen fachlich validiert werden.`);
    }
  }

  // Differenzierung der Neubau-Varianten (§6)
  const variantKeys = Object.keys(templates).filter((k) => k.startsWith('NEUBAU_'));
  if (variantKeys.length > 1) {
    const fingerprint = (k) => (templates[k].steps ?? []).map((st) => `${st.opId}:${st.hours}`).join('|');
    const first = fingerprint(variantKeys[0]);
    if (variantKeys.every((k) => fingerprint(k) === first)) {
      add(INFO, 'ZU_VALIDIEREN',
        'Alle Neubau-Varianten (20/30/40/45 ft) verwenden dieselben Arbeitsgangzeiten. '
        + 'Eine Differenzierung je MEGC-Variante ist fachlich zu ergänzen.');
    }
  }

  /* ---- Konfiguration ---- */
  if (!isValidDate(config.planningDate)) add(ERR, 'STICHTAG_UNGUELTIG', 'Planungsstichtag ist ungültig.');
  if (!(config.productivity?.global > 0)) add(ERR, 'PRODUKTIVITAET', 'Produktivitätsfaktor muss größer 0 sein.');
  if (config.productivity?.validated === false) {
    add(INFO, 'ZU_VALIDIEREN', `Globale Produktivität (${Math.round(config.productivity.global * 100)} %) ist ein zu validierender Startparameter.`);
  }
  if (config.workforce?.baseHeadcountValidated === false) {
    add(INFO, 'ZU_VALIDIEREN', `Mitarbeiterzahl Armaturenbau (${config.workforce.baseHeadcount}) ist ein zu validierender Startparameter.`);
  }
  if (config.workforce?.rampUp?.validated === false) {
    add(INFO, 'ZU_VALIDIEREN', 'Einarbeitungskurven für Leiharbeiter und Neueinstellungen sind zu validieren.');
  }
  if (config.resources?.welders?.validated === false) {
    add(INFO, 'ZU_VALIDIEREN', 'Verfügbarkeit der Orbitalschweißer je Wochentag ist zu validieren.');
  }
  if (Object.values(config.skills ?? {}).some((s) => s.validated === false)) {
    add(INFO, 'ZU_VALIDIEREN', 'Qualifikationsanteile je Arbeitsgang sind zu validieren.');
  }
  if (config.nobo?.validated === false) {
    add(INFO, 'ZU_VALIDIEREN', 'NoBo-Anwesenheitsplanung ist zu validieren.');
  }
  if (config.projectLimits?.maxParallelProjectsValidated === false && Number(config.projectLimits?.maxParallelProjects ?? 0) > 0) {
    add(INFO, 'ZU_VALIDIEREN',
      `Die Begrenzung auf ${config.projectLimits.maxParallelProjects} parallele Kernaufträge ist eine Planungsannahme `
      + 'und betrieblich zu bestätigen (0 = Parallelität ergibt sich aus den Ressourcen).');
  }
  if (config.saturday?.quotaValidated === false) {
    add(INFO, 'ZU_VALIDIEREN',
      `Samstagsquote ${Math.round((config.saturday.quota ?? 0) * 100)} % ist zu bestätigen `
      + '(Lastenheft: 20 %, bisherige Szenarienrechnung: 80 %).');
  }
  if ((config.nobo?.weekdays ?? []).length === 0 && Object.keys(config.nobo?.exceptions ?? {}).length === 0) {
    add(ERR, 'NOBO_FEHLT', 'Es ist keine NoBo-Anwesenheit hinterlegt – Hydroprüfungen sind dadurch nicht planbar.');
  }
  const noboDaysInHydroWindow = (config.nobo?.weekdays ?? []).filter((d) => (config.hydro?.allowedWeekdays ?? [2, 3, 4]).includes(d));
  if (config.hydro?.requireNoBo !== false && noboDaysInHydroWindow.length === 0) {
    const exceptionOk = Object.entries(config.nobo?.exceptions ?? {})
      .some(([d, v]) => v && (config.hydro?.allowedWeekdays ?? [2, 3, 4]).includes(weekday(d)));
    if (!exceptionOk) {
      add(ERR, 'HYDRO_UNMOEGLICH',
        'Kein NoBo-Anwesenheitstag liegt im zulässigen Hydro-Zeitfenster (Di–Do). Hydroprüfungen können nicht geplant werden.');
    }
  }
  for (const [d, v] of Object.entries(config.nobo?.exceptions ?? {})) {
    if (v && !(config.hydro?.allowedWeekdays ?? [2, 3, 4]).includes(weekday(d))) {
      add(WARN, 'NOBO_AUSSERHALB',
        `NoBo-Anwesenheit am ${formatDE(d)} liegt außerhalb des Hydro-Zeitfensters (Di–Do) und bringt dort keine Kapazität.`);
    }
  }
  if (Number(config.resources?.orbitalMachinesActive ?? 0) > Number(config.resources?.orbitalMachines ?? 0)) {
    add(ERR, 'MASCHINEN', 'Es sind mehr Orbitalmaschinen aktiv als vorhanden.');
  }
  if (Number(config.resources?.heftPlaces ?? 0) > Number(config.resources?.heftPlacesMax ?? 3)) {
    add(WARN, 'HEFTPLAETZE', 'Es sind mehr Heftplätze eingeplant als technisch vorgesehen.');
  }
  const t = config.tacking ?? {};
  if (Number(t.minLeadHours) > Number(t.maxLeadHours)) {
    add(ERR, 'HEFTVORSPRUNG', 'Mindestvorsprung Heften ist größer als der Maximalvorsprung.');
  }
  if (Number(config.workforce?.newHires?.reduce?.((a, h) => a + Number(h.count || 0), 0) ?? 0) > Number(config.workforce?.maxNewHires ?? 5)) {
    add(WARN, 'NEUEINSTELLUNGEN', `Es sind mehr Neueinstellungen geplant als vorgesehen (max. ${config.workforce?.maxNewHires}).`);
  }
  if (config.outsourcing?.enabled) {
    add(WARN, 'FREMDVERGABE', 'Fremdvergabe ist aktiviert, obwohl sie fachlich ausgeschlossen ist.');
  }

  void noboPresent;
  return out;
}

/** Zaehlt Meldungen nach Schweregrad. */
export function validationSummary(issues) {
  return {
    errors: issues.filter((i) => i.level === ERR).length,
    warnings: issues.filter((i) => i.level === WARN).length,
    infos: issues.filter((i) => i.level === INFO).length,
  };
}

export const LEVELS = { ERR, WARN, INFO };
