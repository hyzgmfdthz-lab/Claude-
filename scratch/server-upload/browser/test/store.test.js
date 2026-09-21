/**
 * Tests der Browser-Datenhaltung (localStorage), insbesondere das
 * Verhalten bei vollem Speicher - siehe FIX-Kommentare in
 * browser/store.js ("Der Browser-Speicher ist voll", gemeldet 21.09.2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openBrowserStore } from '../store.js';

/** Simuliert localStorage mit einer festen Kapazitaet in Zeichen. */
function fakeLocalStorage(kapazitaet) {
  const map = new Map();
  const groesse = () => [...map.entries()].reduce((a, [k, v]) => a + k.length + v.length, 0);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const bisher = map.has(k) ? map.get(k).length : 0;
      const neu = groesse() - bisher + v.length;
      if (neu > kapazitaet) {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
  };
}

function mitFakeStorage(kapazitaet, fn) {
  const echtesWindow = globalThis.window;
  globalThis.window = { localStorage: fakeLocalStorage(kapazitaet) };
  try {
    return fn();
  } finally {
    if (echtesWindow === undefined) delete globalThis.window;
    else globalThis.window = echtesWindow;
  }
}

test('Browser-Speicher: reichlich Platz - alles wird normal gespeichert', () => {
  mitFakeStorage(10_000_000, () => {
    const store = openBrowserStore();
    store.save({ a: 1 }, 'Erste Sicherung');
    assert.equal(store.lastError, null);
    assert.deepEqual(store.load(), { a: 1 });
    assert.equal(store.snapshots().length, 1);
  });
});

test('Browser-Speicher: bei vollem Speicher faellt die aelteste Sicherung heraus, statt zu scheitern', () => {
  // Kapazitaet reicht fuer den aktuellen Datensatz plus ein bis zwei
  // Sicherungen, aber nicht fuer beliebig viele.
  mitFakeStorage(6_000, () => {
    const store = openBrowserStore();
    for (let i = 0; i < 10; i++) {
      store.save({ text: 'x'.repeat(300), i }, `Sicherung ${i}`);
    }
    // Der AKTUELLE Datensatz muss immer stimmen - das ist das Wichtigste.
    assert.deepEqual(store.load(), { text: 'x'.repeat(300), i: 9 });
    // Es sind nicht alle 10 Sicherungen uebrig geblieben (kein Platz),
    // aber wenigstens die neueren, nicht alle verloren.
    const snaps = store.snapshots();
    assert.ok(snaps.length > 0, 'wenigstens ein paar Sicherungen sollten passen');
    assert.ok(snaps.length < 10, 'bei so wenig Platz koennen nicht alle 10 passen');
    assert.equal(snaps[0].label, 'Sicherung 9', 'die neueste Sicherung bleibt erhalten');
  });
});

test('Browser-Speicher: der aktuelle Arbeitsstand hat Vorrang vor alten Sicherungen und Ständen', () => {
  /*
   * FIX-Kern: vorher wurde der Hauptdatensatz VOR den Sicherungen
   * geschrieben und scheiterte bei vollem Speicher einfach - die
   * Sicherungen blockierten den Platz, den der aktuelle Stand gebraucht
   * haette. Jetzt raeumt save() bei Bedarf zuerst Sicherungen/Staende weg.
   */
  mitFakeStorage(5_000, () => {
    const store = openBrowserStore();
    // Speicher mit Sicherungen und Staenden vollstopfen.
    for (let i = 0; i < 5; i++) store.save({ i }, `Sicherung ${i}`);
    for (let i = 0; i < 5; i++) {
      store.saveState({ id: `STD-${i}`, createdAt: new Date().toISOString(), name: `Stand ${i}`, data: { i, text: 'y'.repeat(200) } });
    }
    // Ein deutlich groesserer, aktueller Arbeitsstand kommt dazu - er MUSS
    // gespeichert werden, auch wenn dafuer alte Sicherungen/Staende weichen.
    const grosserStand = { text: 'z'.repeat(1500), aktuell: true };
    store.save(grosserStand);
    assert.deepEqual(store.load(), grosserStand,
      'der aktuelle Arbeitsstand darf nicht verloren gehen, nur weil alte Sicherungen den Speicher blockieren');
  });
});

test('Browser-Speicher: benannte Stände fallen bei vollem Speicher aelteste zuerst heraus', () => {
  mitFakeStorage(4_000, () => {
    const store = openBrowserStore();
    for (let i = 0; i < 20; i++) {
      store.saveState({
        id: `STD-${i}`, createdAt: new Date(2026, 0, i + 1).toISOString(),
        name: `Stand ${i}`, data: { text: 'x'.repeat(150), i },
      });
    }
    const staende = store.states();
    assert.ok(staende.length > 0 && staende.length < 20);
    assert.ok(staende.some((s) => s.name === 'Stand 19'), 'der neueste Stand muss erhalten bleiben');
  });
});
