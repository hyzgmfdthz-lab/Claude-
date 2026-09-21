/**
 * Persistente lokale Datenhaltung.
 *
 * Bevorzugt SQLite (in Node ab Version 22 eingebaut, ohne Zusatzinstallation).
 * Steht SQLite nicht zur Verfuegung, wird automatisch auf eine Dateiablage mit
 * atomarem Schreiben umgeschaltet. Fuer den Anwender ist der Unterschied nicht
 * sichtbar (§81).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Automatische Sicherungen im Hintergrund (technisches Sicherheitsnetz). */
const MAX_SNAPSHOTS = 30;
/** Benannte Staende, die die Benutzer selbst anlegen. */
const MAX_STATES = 150;

/**
 * @typedef {Object} Store
 * @property {string} kind
 * @property {string} location
 * @property {() => any} load
 * @property {(data:any, label?:string) => void} save
 * @property {() => {id:string, createdAt:string, label:string}[]} snapshots
 * @property {(id:string) => any} restore
 * @property {(entry:any) => any} saveState
 * @property {() => any[]} states
 * @property {(id:string) => any} stateData
 * @property {(id:string) => boolean} deleteState
 * @property {() => void} close
 */

/** Standard-Datenverzeichnis. */
export function defaultDataDir() {
  if (process.env.MEGC_DATA_DIR) return process.env.MEGC_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'MEGC-Armaturenbau');
  }
  return path.join(home, '.megc-armaturenbau');
}

/**
 * Oeffnet die Datenhaltung.
 * @param {string} [dir]
 * @param {{forceFile?:boolean}} [options] forceFile erzwingt die Dateiablage (fuer Tests)
 * @returns {Store}
 */
export function openStore(dir = defaultDataDir(), options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (options.forceFile || process.env.MEGC_STORAGE === 'file') return fileStore(dir);
  try {
    return sqliteStore(path.join(dir, 'planung.db'));
  } catch (err) {
    process.stderr.write(`[Hinweis] SQLite nicht verfügbar (${err.message}) – es wird die Dateiablage verwendet.\n`);
    return fileStore(dir);
  }
}

/* ------------------------------------------------------------------ *
 * SQLite
 * ------------------------------------------------------------------ */

function sqliteStore(file) {
  // Dynamischer Zugriff, damit aeltere Node-Versionen sauber auf die
  // Dateiablage zurueckfallen koennen.
  const { DatabaseSync } = process.getBuiltinModule
    ? process.getBuiltinModule('node:sqlite')
    : require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      label      TEXT,
      value      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS states (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name       TEXT NOT NULL,
      note       TEXT,
      created_by TEXT,
      kind       TEXT,
      meta       TEXT,
      value      TEXT NOT NULL
    );
  `);

  return {
    kind: 'sqlite',
    location: file,
    load() {
      const row = db.prepare('SELECT value FROM documents WHERE key = ?').get('dataset');
      return row ? JSON.parse(String(row.value)) : null;
    },
    save(data, label = '') {
      const json = JSON.stringify(data);
      const now = new Date().toISOString();
      db.prepare('INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run('dataset', json, now);
      if (label) {
        db.prepare('INSERT INTO snapshots (id, created_at, label, value) VALUES (?, ?, ?, ?)')
          .run(`SNP-${Date.now()}`, now, label, json);
        db.exec(`DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT ${MAX_SNAPSHOTS})`);
      }
    },
    snapshots() {
      return db.prepare('SELECT id, created_at, label FROM snapshots ORDER BY created_at DESC')
        .all().map((r) => ({ id: String(r.id), createdAt: String(r.created_at), label: String(r.label ?? '') }));
    },
    restore(id) {
      const row = db.prepare('SELECT value FROM snapshots WHERE id = ?').get(id);
      return row ? JSON.parse(String(row.value)) : null;
    },

    /* -------- Benannte Staende -------- */

    saveState(entry) {
      db.prepare(`INSERT INTO states (id, created_at, name, note, created_by, kind, meta, value)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(entry.id, entry.createdAt, entry.name, entry.note ?? '', entry.createdBy ?? '',
          entry.kind ?? 'MANUAL', JSON.stringify(entry.meta ?? {}), JSON.stringify(entry.data));
      // Aeltester Stand faellt heraus, wenn die Obergrenze erreicht ist.
      db.exec(`DELETE FROM states WHERE id NOT IN (SELECT id FROM states ORDER BY created_at DESC LIMIT ${MAX_STATES})`);
      return stateRow(db.prepare('SELECT id, created_at, name, note, created_by, kind, meta FROM states WHERE id = ?').get(entry.id));
    },
    states() {
      return db.prepare('SELECT id, created_at, name, note, created_by, kind, meta FROM states ORDER BY created_at DESC')
        .all().map(stateRow);
    },
    stateData(id) {
      const row = db.prepare('SELECT value FROM states WHERE id = ?').get(id);
      return row ? JSON.parse(String(row.value)) : null;
    },
    deleteState(id) {
      const before = db.prepare('SELECT COUNT(*) AS n FROM states WHERE id = ?').get(id);
      db.prepare('DELETE FROM states WHERE id = ?').run(id);
      return Number(before?.n ?? 0) > 0;
    },

    close() { db.close(); },
  };
}

/** Datenbankzeile eines Standes in die Form der Oberflaeche bringen. */
function stateRow(r) {
  if (!r) return null;
  let meta = {};
  try { meta = JSON.parse(String(r.meta ?? '{}')); } catch { meta = {}; }
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    name: String(r.name ?? ''),
    note: String(r.note ?? ''),
    createdBy: String(r.created_by ?? ''),
    kind: String(r.kind ?? 'MANUAL'),
    meta,
  };
}

/* ------------------------------------------------------------------ *
 * Dateiablage (Rueckfallebene)
 * ------------------------------------------------------------------ */

function fileStore(dir) {
  const file = path.join(dir, 'planung.json');
  const snapDir = path.join(dir, 'snapshots');
  const stateDir = path.join(dir, 'staende');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const writeAtomic = (target, content) => {
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
  };

  return {
    kind: 'file',
    location: file,
    load() {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(data, label = '') {
      const json = JSON.stringify(data, null, 1);
      writeAtomic(file, json);
      if (label) {
        const id = `SNP-${Date.now()}`;
        writeAtomic(path.join(snapDir, `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), label, data }));
        const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json')).sort();
        while (files.length > MAX_SNAPSHOTS) fs.unlinkSync(path.join(snapDir, files.shift()));
      }
    },
    snapshots() {
      return fs.readdirSync(snapDir).filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')))
        .map((s) => ({ id: s.id, createdAt: s.createdAt, label: s.label }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    restore(id) {
      const f = path.join(snapDir, `${id}.json`);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf8')).data;
    },

    /* -------- Benannte Staende -------- */

    saveState(entry) {
      writeAtomic(path.join(stateDir, `${entry.id}.json`), JSON.stringify(entry));
      const files = fs.readdirSync(stateDir).filter((f) => f.endsWith('.json')).sort();
      while (files.length > MAX_STATES) fs.unlinkSync(path.join(stateDir, files.shift()));
      const { data: _data, ...head } = entry;
      return head;
    },
    states() {
      return fs.readdirSync(stateDir).filter((f) => f.endsWith('.json'))
        .map((f) => {
          const { data: _data, ...head } = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
          return head;
        })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    stateData(id) {
      const f = path.join(stateDir, `${id}.json`);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf8')).data;
    },
    deleteState(id) {
      const f = path.join(stateDir, `${id}.json`);
      if (!fs.existsSync(f)) return false;
      fs.unlinkSync(f);
      return true;
    },

    close() {},
  };
}
