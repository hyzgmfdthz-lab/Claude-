/**
 * Datenpruefung, Import/Export, Arbeitsplaetze und Sicherungen (§79/§82/§84).
 */
import { h, card, table, fmt, toast, confirmDialog, statusPill, storageLabel } from '../ui.js';
import { api, download } from '../api.js';

export function render(a) {
  const v = a.analysis.validation;
  const levelPill = (lvl) => h(`span.pill.${lvl === 'FEHLER' ? 'pill--red' : lvl === 'WARNUNG' ? 'pill--amber' : 'pill--blue'}`, lvl);

  const backupsBox = h('div', h('div.empty', 'Sicherungen werden geladen …'));
  loadBackups(a, backupsBox);

  return h('div.view',
    plausiCard(a),

    card('Datenprüfung',
      table([
        { key: 'level', label: 'Ebene', render: (i) => levelPill(i.level) },
        { key: 'code', label: 'Prüfregel', render: (i) => h('span.small.mono', i.code) },
        { key: 'message', label: 'Meldung' },
        {
          key: 'action',
          label: '',
          render: (i) => (i.projectId
            ? h('button.btn.btn--sm', {
              onclick: () => { a.navigate('projects'); a.ui.projectFilter.text = i.projectId; },
            }, 'Auftrag öffnen')
            : null),
        },
      ], v.issues, { compact: true, empty: 'Keine Auffälligkeiten – der Datenbestand ist vollständig.' }),
      {
        flush: true,
        sub: `${v.summary.errors} Fehler · ${v.summary.warnings} Warnungen · ${v.summary.infos} Hinweise`,
      }),

    h('div.grid.grid--2',
      card('Export',
        h('div.stack',
          h('div.small.muted', 'Alle Exporte beziehen sich auf das aktive Szenario.'),
          h('div.btn-row',
            h('button.btn.btn--primary', { onclick: () => download(`/api/export?scenario=${a.scenarioId}&format=xlsx`) },
              'Gesamtplanung als Excel'),
            h('button.btn', { onclick: () => download(`/api/export?scenario=${a.scenarioId}&format=csv&type=projects`) }, 'Projektplan (CSV)'),
            h('button.btn', { onclick: () => download(`/api/export?scenario=${a.scenarioId}&format=csv&type=capacity`) }, 'Kapazitätsplanung (CSV)'),
            h('button.btn', { onclick: () => download(`/api/export?scenario=${a.scenarioId}&format=csv&type=processes`) }, 'Auslastung je Arbeitsgang (CSV)'),
            h('button.btn', { onclick: () => download(`/api/export/comparison?ids=${a.state.scenarios.map((s) => s.id).join(',')}`) }, 'Szenariovergleich')),
          h('div.small.faint',
            'Die Excel-Datei enthält: Projekte, Arbeitsgänge, Kapazität je Kalenderwoche, Auslastung je Arbeitsgang, '
            + 'Managementübersicht und das Ergebnis der Datenprüfung.')),
        { sub: 'Excel und CSV' }),

      card('Import',
        h('div.stack',
          h('div.small.muted',
            'Excel- oder CSV-Datei mit Projektdaten einlesen. Erkannt werden u. a. die Spalten ',
            h('em', 'Auftrag, Kunde, Projekt, Projektart, Variante, Fertigstellung, Fertigstellung neu, Priorität, Gesamtstunden, Fortschritt, Status'), '. ',
            'Ist eine Spalte „Fertigstellung neu“ (korrigierter Termin) gefüllt, gilt dieser Termin.'),
          h('label.field', h('span', 'Vorgehen bei vorhandenen Projekten'),
            h('select', { id: 'imp-mode' },
              h('option', { value: 'merge' }, 'Ergänzen und aktualisieren (empfohlen)'),
              h('option', { value: 'update-only' }, 'Nur vorhandene Projekte aktualisieren'),
              h('option', { value: 'replace' }, 'Datenbestand vollständig ersetzen'))),
          h('input', { type: 'file', id: 'imp-file', accept: '.xlsx,.csv,.txt' }),
          h('div.btn-row',
            h('button.btn.btn--primary', { onclick: () => runImport(a) }, 'Datei einlesen'),
            h('button.btn', { onclick: () => download('/api/export/template') }, 'Importvorlage herunterladen'))))),

    card('Arbeitsplätze',
      h('div',
        h('div.small.muted', { style: { marginBottom: '8px' } },
          'Arbeitsplätze sind eigene Objekte. Sie werden bereits jetzt geführt, damit später die ',
          'Arbeitsplatz- und Belegungsplanung (Auftrag → Arbeitsgang → Arbeitsplatz → Tag/Schicht) ergänzt werden kann.'),
        table([
          { key: 'id', label: 'Kennung', render: (w) => h('span.mono.small', w.id) },
          {
            key: 'name',
            label: 'Bezeichnung',
            render: (w) => h('input', {
              type: 'text', value: w.name, style: { width: '210px' },
              onchange: (e) => saveWorkplaces(a, w.id, { name: e.target.value }),
            }),
          },
          { key: 'type', label: 'Typ', render: (w) => h('span.pill.pill--grey', w.type) },
          {
            key: 'area',
            label: 'Bereich',
            render: (w) => h('input', {
              type: 'text', value: w.area ?? '', style: { width: '140px' },
              onchange: (e) => saveWorkplaces(a, w.id, { area: e.target.value }),
            }),
          },
          {
            key: 'capacityUnits',
            label: 'Plätze',
            num: true,
            render: (w) => h('input', {
              type: 'number', min: 0, value: w.capacityUnits, style: { width: '70px' },
              onchange: (e) => saveWorkplaces(a, w.id, { capacityUnits: Number(e.target.value) }),
            }),
          },
          {
            key: 'active',
            label: 'Aktiv',
            render: (w) => h('input', {
              type: 'checkbox', checked: w.active,
              onchange: (e) => saveWorkplaces(a, w.id, { active: e.target.checked }),
            }),
          },
        ], a.state.workplaces, { compact: true })),
      { sub: 'Vorbereitung der späteren Belegungsplanung' }),

    card('Sicherungen', backupsBox, {
      actions: [
        h('button.btn', {
          onclick: async () => {
            const label = prompt('Bezeichnung der Sicherung:', `Sicherung ${new Date().toLocaleString('de-DE')}`);
            if (!label) return;
            await api.createBackup(label);
            await a.reload();
            toast('Sicherung erstellt.', 'ok');
          },
        }, 'Sicherung erstellen'),
        h('button.btn.btn--danger', {
          onclick: async () => {
            const ok = await confirmDialog('Alles zurücksetzen?',
              'Der gesamte Datenbestand wird auf die Auslieferungsdaten zurückgesetzt. '
              + 'Vorhandene Projekte, Szenarien und Parameter gehen verloren.\n\n'
              + 'Es wird empfohlen, vorher eine Sicherung zu erstellen. Wirklich fortfahren?', 'Zurücksetzen');
            if (!ok) return;
            await api.resetAll();
            await a.reload();
            toast('Auf Startdaten zurückgesetzt.', 'ok');
          },
        }, 'Auf Startdaten zurücksetzen'),
      ],
    }),

    card('Speicherort',
      h('div',
        h('div.small.muted',
          h('div', h('strong', 'Datenhaltung: '), storageLabel(a.state.storage.kind)),
          h('div', h('strong', 'Ort: '), h('span.mono', a.state.storage.location)),
          h('div', { style: { marginTop: '6px' } },
            'Alle Daten bleiben ausschließlich auf diesem Rechner. Eine Internetverbindung ist nicht erforderlich.')),
        a.state.runtime?.mode === 'standalone' && h('div', { style: { marginTop: '12px' } },
          h('div.note.note--info',
            h('strong', 'Einzeldatei-Fassung: '),
            'Die Daten liegen im Speicher dieses Browsers. Sie sind an diesen Rechner, dieses Benutzerkonto und ',
            'diesen Browser gebunden und gehen verloren, wenn die Browserdaten gelöscht werden. ',
            'Speichern Sie daher regelmäßig eine Sicherungsdatei.'),
          h('div.btn-row',
            h('button.btn.btn--primary', { onclick: () => saveDataset(a) }, 'Datensicherung speichern'),
            h('input', { type: 'file', id: 'ds-file', accept: '.json', style: { maxWidth: '260px' } }),
            h('button.btn', { onclick: () => loadDataset(a) }, 'Sicherungsdatei einlesen'))))));
}

/** Vollständigen Datenbestand als Datei speichern (Einzeldatei-Fassung). */
async function saveDataset(a) {
  const json = await api.exportDataset();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Armaturenbau_Datensicherung_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Datensicherung gespeichert.', 'ok');
}

/** Datenbestand aus einer Sicherungsdatei einlesen. */
async function loadDataset(a) {
  const input = document.getElementById('ds-file');
  const file = input?.files?.[0];
  if (!file) { toast('Bitte zuerst eine Sicherungsdatei auswählen.', 'error'); return; }
  const ok = await confirmDialog('Datenbestand ersetzen?',
    `Der gesamte aktuelle Stand wird durch den Inhalt von "${file.name}" ersetzt. Fortfahren?`, 'Einlesen');
  if (!ok) return;
  await api.importDataset(await file.text());
  await a.reload();
  toast('Datenbestand eingelesen.', 'ok');
}

async function saveWorkplaces(a, id, patch) {
  const list = a.state.workplaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
  await api.updateWorkplaces(list);
  a.state.workplaces = list;
  toast('Arbeitsplätze gespeichert.', 'ok');
}

async function runImport(a) {
  const input = document.getElementById('imp-file');
  const mode = document.getElementById('imp-mode').value;
  const file = input?.files?.[0];
  if (!file) { toast('Bitte zuerst eine Datei auswählen.', 'error'); return; }

  const isXlsx = /\.xlsx$/i.test(file.name);
  const payload = { format: isXlsx ? 'xlsx' : 'csv', mode };

  if (isXlsx) {
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    payload.data = btoa(binary);
  } else {
    payload.data = await file.text();
  }

  if (mode === 'replace') {
    const ok = await confirmDialog('Datenbestand ersetzen?',
      'Projekte, die nicht in der Datei enthalten sind, werden gelöscht. Fortfahren?', 'Ersetzen');
    if (!ok) return;
  }

  const r = await api.importProjects(payload);
  await a.reload();
  toast(`Import abgeschlossen: ${r.created} neu, ${r.updated} aktualisiert, ${r.skipped} übersprungen.`, 'ok');
  if (r.messages?.length) {
    toast(r.messages.slice(0, 3).join(' | '), 'error');
  }
}

async function loadBackups(a, container) {
  try {
    const list = await api.backups();
    container.replaceChildren(table([
      { key: 'createdAt', label: 'Zeitpunkt', render: (b) => new Date(b.createdAt).toLocaleString('de-DE') },
      { key: 'label', label: 'Bezeichnung' },
      {
        key: 'action',
        label: '',
        render: (b) => h('button.btn.btn--sm', {
          onclick: async () => {
            const ok = await confirmDialog('Sicherung zurückspielen?',
              `Der aktuelle Stand wird durch die Sicherung vom ${new Date(b.createdAt).toLocaleString('de-DE')} ersetzt. Fortfahren?`,
              'Zurückspielen');
            if (!ok) return;
            await api.restoreBackup(b.id);
            await a.reload();
            toast('Sicherung zurückgespielt.', 'ok');
          },
        }, 'Zurückspielen'),
      },
    ], list, { compact: true, empty: 'Noch keine Sicherungen vorhanden.' }));
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Sicherungen konnten nicht geladen werden.'));
  }
}

export { statusPill, fmt };

/* ------------------------------------------------------------------ *
 * Plausibilitaet
 * ------------------------------------------------------------------ */

/**
 * Vollstaendige Liste der Plausibilitaetsbefunde.
 *
 * Die Datenpruefung darunter sieht nur den Datenbestand. Hier steht, was
 * am ERGEBNIS auffaellt - etwa eine Besetzung, die nach dem letzten
 * Messtag ohne Grund nach oben springt.
 */
function plausiCard(a) {
  const pl = a.analysis.plausibility;
  if (!pl) return null;
  const symbol = (l) => (l === 'KRITISCH' ? '\u26d4' : l === 'WARNUNG' ? '\u26a0' : '\u2139');
  const ton = (l) => (l === 'KRITISCH' ? 'pill--red' : l === 'WARNUNG' ? 'pill--amber' : 'pill--grey');
  return card('Plausibilitätsprüfung',
    table([
      { key: 'level', label: '', render: (i) => h(`span.pill.${ton(i.level)}`, symbol(i.level), ' ', i.level) },
      { key: 'area', label: 'Bereich' },
      {
        key: 'title',
        label: 'Befund',
        render: (i) => h('div',
          h('strong', i.title),
          h('div.small.muted', i.text),
          i.hint ? h('div.small.faint', i.hint) : null),
      },
      { key: 'code', label: 'Prüfung', render: (i) => h('span.small.mono', i.code) },
      {
        key: 'ack',
        label: '',
        // "Erledigt" macht einen Befund leise, ohne ihn zu loeschen.
        render: (i) => (i.acknowledged
          ? h('div',
            h('button.btn.btn--sm', { onclick: () => widerrufen(a, i) }, 'Wieder anzeigen'),
            h('div.small.faint', `bestätigt${i.ack?.user ? ` von ${i.ack.user}` : ''}`))
          : h('button.btn.btn--sm', {
            title: 'Thema ist abgestellt – Befund bestätigen und wegklicken',
            onclick: () => bestaetigen(a, i),
          }, 'Erledigt')),
      },
    ], pl.items, { compact: true, empty: 'Die Anwendung hat nichts Unplausibles gefunden.' }),
    {
      flush: true,
      sub: `${pl.summary} · Vergleich des Ergebnisses mit den Messwerten und den Angaben der Abteilungsleitung`,
      actions: (pl.acknowledged ?? 0) > 0
        ? [h('button.btn.btn--sm', {
          onclick: async () => {
            const ok = await confirmDialog('Alle Bestätigungen aufheben?',
              `${pl.acknowledged} bestätigte Befunde zählen danach wieder mit.`, 'Aufheben');
            if (!ok) return;
            await api.clearAcks();
            await a.reload();
            toast('Alle Bestätigungen aufgehoben.', 'ok');
          },
        }, 'Alle Bestätigungen aufheben')]
        : [],
    });
}

/** Befund bestaetigen ("Thema ist abgestellt"). */
async function bestaetigen(a, i) {
  try {
    await api.ackFinding({ key: i.key, level: i.level, title: i.title });
    await a.reload();
    toast(`„${i.title}" ist bestätigt und zählt nicht mehr mit.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Der Befund konnte nicht bestätigt werden.', 'error');
  }
}

/** Bestaetigung zuruecknehmen. */
async function widerrufen(a, i) {
  try {
    await api.unackFinding(i.key);
    await a.reload();
    toast(`„${i.title}" zählt wieder mit.`, 'ok');
  } catch (err) {
    toast(err?.message ?? 'Die Bestätigung konnte nicht aufgehoben werden.', 'error');
  }
}
