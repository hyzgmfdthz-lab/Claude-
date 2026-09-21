/**
 * Datenhaltung der Einzeldatei-Version.
 *
 * Speichert im Browser (localStorage). Steht dieser nicht zur Verfuegung
 * - etwa weil der Browser die Speicherung fuer lokale Dateien unterbindet -,
 * wird automatisch im Arbeitsspeicher weitergearbeitet und die Oberflaeche
 * weist darauf hin. Die Daten lassen sich in beiden Faellen jederzeit als
 * Sicherungsdatei speichern und wieder einlesen.
 */

const KEY = 'megc-armaturenbau:dataset';
const SNAP_KEY = 'megc-armaturenbau:snapshots';
const STATE_KEY = 'megc-armaturenbau:staende';
const MAX_SNAPSHOTS = 8;
/**
 * Benannte Staende der Einzeldatei-Fassung.
 *
 * Der Browser-Speicher fasst nur wenige Megabyte; ein Stand enthaelt den
 * kompletten Datenbestand. Deshalb hier deutlich weniger als in der
 * Serverfassung (dort 150). Wer viele Staende braucht, nutzt die
 * Serverfassung - siehe docs/BEDIENUNG.md.
 */
const MAX_STATES = 12;

function probe() {
  try {
    const t = '__megc_test__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @returns {import('../server/store.js').Store & {persistent:boolean, lastError:string|null}}
 */
export function openBrowserStore() {
  const ls = probe();
  /** @type {any} */
  let memory = null;
  /** @type {any[]} */
  let memorySnaps = [];
  let lastError = null;

  const readRaw = (key) => {
    if (!ls) return null;
    try { return ls.getItem(key); } catch { return null; }
  };
  const writeRaw = (key, value) => {
    if (!ls) return false;
    try { ls.setItem(key, value); lastError = null; return true; }
    catch (err) {
      lastError = err?.name === 'QuotaExceededError'
        ? 'Der Browser-Speicher ist voll. Bitte ältere Sicherungen entfernen oder die Daten als Datei speichern.'
        : `Speichern im Browser nicht möglich: ${err?.message ?? err}`;
      return false;
    }
  };

  const loadSnaps = () => {
    if (!ls) return memorySnaps;
    try { return JSON.parse(readRaw(SNAP_KEY) ?? '[]'); } catch { return []; }
  };
  /*
   * FIX (gemeldet 21.09.2026, "Der Browser-Speicher ist voll"): schrieb bei
   * vollem Speicher gar nicht mehr - auch nicht die neueste, gerade erst
   * angelegte Sicherung. Anders als bei den benannten Staenden (siehe
   * saveStates unten) fiel hier bei Speichermangel keine aeltere Sicherung
   * heraus, um Platz zu schaffen - der Schreibversuch scheiterte einfach
   * jedes Mal komplett und wiederholte sich bei jeder weiteren Aktion.
   * Gleiche Loesung wie bei den Staenden: aelteste Sicherung faellt heraus,
   * bis es wieder passt.
   */
  const saveSnaps = (list) => {
    memorySnaps = list;
    if (!ls) return true;
    let attempt = list;
    while (attempt.length > 0) {
      if (writeRaw(SNAP_KEY, JSON.stringify(attempt))) {
        memorySnaps = attempt;
        return true;
      }
      attempt = attempt.slice(0, -1);
    }
    // Selbst ganz ohne Sicherungen kein Platz - dann ist wenigstens der
    // Fehler sichtbar (lastError von writeRaw), aber der Arbeitsstand
    // bleibt im Speicher erhalten (memory/memorySnaps oben).
    writeRaw(SNAP_KEY, '[]');
    return false;
  };

  /** @type {any[]} */
  let memoryStates = [];
  const loadStates = () => {
    if (!ls) return memoryStates;
    try { return JSON.parse(readRaw(STATE_KEY) ?? '[]'); } catch { return []; }
  };
  const saveStates = (list) => {
    memoryStates = list;
    if (!ls) return true;
    // Passt die Liste nicht mehr in den Browser-Speicher, faellt der
    // aelteste Stand heraus, bis es passt - lieber weniger Staende als
    // eine Fehlermeldung beim Speichern.
    let attempt = list;
    while (attempt.length > 0) {
      if (writeRaw(STATE_KEY, JSON.stringify(attempt))) {
        memoryStates = attempt;
        return true;
      }
      attempt = attempt.slice(0, -1);
    }
    return false;
  };

  return {
    kind: ls ? 'browser' : 'memory',
    location: ls ? 'Browser-Speicher dieses Rechners' : 'Arbeitsspeicher (nicht dauerhaft)',
    get persistent() { return !!ls; },
    get lastError() { return lastError; },

    load() {
      if (!ls) return memory;
      const raw = readRaw(KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },

    save(data, label = '') {
      memory = data;
      const json = JSON.stringify(data);
      /*
       * FIX (gemeldet 21.09.2026, "Der Browser-Speicher ist voll"): der
       * AKTUELLE Arbeitsstand - die Daten, mit denen gerade wirklich
       * gearbeitet wird - ist wichtiger als jede Sicherung. Passte er
       * bisher bei vollem Speicher nicht mehr hinein, scheiterte der
       * Schreibversuch einfach; die Sicherungen (oft der groessere Teil
       * der Speichernutzung) blieben unangetastet. Jetzt raeumen bei
       * fehlendem Platz zuerst die Sicherungen, dann die benannten
       * Staende Platz frei - erst wenn beides leer ist und es immer noch
       * nicht passt, bleibt der aktuelle Stand nur im Arbeitsspeicher
       * dieser Sitzung (sichtbarer Fehler ueber lastError).
       */
      if (!writeRaw(KEY, json)) {
        let snaps = loadSnaps();
        while (!writeRaw(KEY, json) && snaps.length > 0) {
          snaps = snaps.slice(0, -1);
          saveSnaps(snaps);
        }
        let staende = loadStates();
        while (!writeRaw(KEY, json) && staende.length > 0) {
          staende = staende.slice(0, -1);
          saveStates(staende);
        }
      }
      if (label) {
        const list = loadSnaps();
        list.unshift({ id: `SNP-${Date.now()}`, createdAt: new Date().toISOString(), label, value: json });
        while (list.length > MAX_SNAPSHOTS) list.pop();
        saveSnaps(list);
      }
    },

    snapshots() {
      return loadSnaps().map((s) => ({ id: s.id, createdAt: s.createdAt, label: s.label }));
    },

    restore(id) {
      const found = loadSnaps().find((s) => s.id === id);
      if (!found) return null;
      try { return JSON.parse(found.value); } catch { return null; }
    },

    /* -------- Benannte Staende -------- */

    saveState(entry) {
      const { data, ...head } = entry;
      const list = loadStates();
      list.unshift({ ...head, value: JSON.stringify(data) });
      while (list.length > MAX_STATES) list.pop();
      saveStates(list);
      return head;
    },
    states() {
      return loadStates().map(({ value: _value, ...head }) => head);
    },
    stateData(id) {
      const found = loadStates().find((s) => s.id === id);
      if (!found) return null;
      try { return JSON.parse(found.value); } catch { return null; }
    },
    deleteState(id) {
      const list = loadStates();
      const next = list.filter((s) => s.id !== id);
      if (next.length === list.length) return false;
      saveStates(next);
      return true;
    },

    close() {},
  };
}
