/**
 * Tests der Anmeldung: Passwoerter, Sitzungen, Kuerzel.
 *
 * Die Rechenverfahren (SHA-256, PBKDF2) sind selbst umgesetzt, weil die
 * Anwendung ohne Fremdbibliotheken auskommt. Deshalb werden sie hier gegen
 * die Umsetzung von Node geprueft - sie muessen bitgleich rechnen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  sha256, hmacSha256, pbkdf2Sha256, toHex, encodeUtf8, randomHex, equalsConstantTime,
  hashPassword, verifyPassword, passwordProblem, normalizeUserId, defaultUsers,
  publicUser, createSession, tokenHashOf, PBKDF2_ITERATIONS, ADMIN_USER,
} from '../auth.js';

/* ---------------- Rechenverfahren ---------------- */

test('SHA-256 rechnet wie Node', () => {
  for (const text of ['', 'abc', 'Armaturenbau MEGC', 'ä ö ü ß – Umlaute', 'x'.repeat(1000)]) {
    assert.equal(
      toHex(sha256(encodeUtf8(text))),
      crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      `SHA-256 weicht ab bei "${text.slice(0, 20)}"`);
  }
});

test('HMAC-SHA256 rechnet wie Node', () => {
  for (const [key, msg] of [['schlüssel', 'nachricht'], ['', ''], ['k'.repeat(100), 'lang']]) {
    assert.equal(
      toHex(hmacSha256(encodeUtf8(key), encodeUtf8(msg))),
      crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(msg, 'utf8').digest('hex'));
  }
});

test('PBKDF2 rechnet wie Node', () => {
  /** @type {{pw:string, salt:string, iter:number, len:number}[]} */
  const faelle = [
    { pw: 'geheim123', salt: 'salz', iter: 1000, len: 32 },
    { pw: 'Planung2026', salt: 'abcdef0123456789', iter: 2000, len: 32 },
    { pw: 'ümläute', salt: 'salz', iter: 500, len: 64 },
  ];
  for (const { pw, salt, iter, len } of faelle) {
    assert.equal(
      toHex(pbkdf2Sha256(pw, salt, iter, len)),
      crypto.pbkdf2Sync(pw, salt, iter, len, 'sha256').toString('hex'),
      'PBKDF2 muss mit der Node-Umsetzung übereinstimmen');
  }
});

/* ---------------- Passwoerter ---------------- */

test('Passwort wird niemals im Klartext gespeichert', () => {
  const record = hashPassword('Planung2026');
  assert.equal(record.algo, 'PBKDF2-SHA256');
  assert.equal(record.iterations, PBKDF2_ITERATIONS);
  assert.ok(record.salt.length >= 16);
  assert.ok(!JSON.stringify(record).includes('Planung2026'));
});

test('Passwortprüfung: richtig ja, falsch nein', () => {
  const record = hashPassword('Planung2026');
  assert.equal(verifyPassword('Planung2026', record), true);
  assert.equal(verifyPassword('planung2026', record), false, 'Groß-/Kleinschreibung zählt');
  assert.equal(verifyPassword('Planung2027', record), false);
  assert.equal(verifyPassword('', record), false);
  assert.equal(verifyPassword('Planung2026', null), false);
  assert.equal(verifyPassword('Planung2026', { salt: '', hash: '', iterations: 1 }), false);
});

test('Gleiches Passwort ergibt unterschiedliche Nachweise (eigenes Salz)', () => {
  const a = hashPassword('Planung2026');
  const b = hashPassword('Planung2026');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(verifyPassword('Planung2026', a) && verifyPassword('Planung2026', b));
});

test('Mindestlänge des Passworts wird verlangt', () => {
  assert.ok(passwordProblem('abc'));
  assert.ok(passwordProblem('     '));
  assert.equal(passwordProblem('abcdef'), null);
  assert.equal(passwordProblem('Planung2026'), null);
});

test('Vergleich ohne frühen Abbruch', () => {
  assert.equal(equalsConstantTime('abc', 'abc'), true);
  assert.equal(equalsConstantTime('abc', 'abd'), false);
  assert.equal(equalsConstantTime('abc', 'abcd'), false);
});

/* ---------------- Kuerzel und Sitzungen ---------------- */

test('Kürzel werden vereinheitlicht', () => {
  assert.equal(normalizeUserId(' dohe '), 'DOHE');
  assert.equal(normalizeUserId('St Wue'), 'STWUE');
  assert.equal(normalizeUserId(null), '');
});

test('Startbestand der Kürzel enthält die Verwaltung genau einmal', () => {
  const users = defaultUsers();
  const ids = users.map((u) => u.id);
  for (const erwartet of ['DOHE', 'STWUE', 'SVHE', 'KEER', 'KEMI', 'SAZA']) {
    assert.ok(ids.includes(erwartet), `${erwartet} muss angelegt sein`);
  }
  const admins = users.filter((u) => u.admin);
  assert.equal(admins.length, 1);
  assert.equal(admins[0].id, ADMIN_USER);
  assert.ok(users.every((u) => u.password === null), 'Passwörter vergibt jeder selbst');
});

test('Sichtbare Benutzerangaben enthalten keinen Passwortnachweis', () => {
  const user = { ...defaultUsers()[0], password: hashPassword('Planung2026') };
  const sichtbar = publicUser(user);
  assert.equal(sichtbar.hasPassword, true);
  assert.equal(sichtbar.password, undefined);
  assert.ok(!JSON.stringify(sichtbar).includes(user.password.hash));
});

test('Sitzung: Schlüssel wird nur als Hashwert gespeichert', () => {
  const { token, record } = createSession('DOHE', 12);
  assert.ok(token.length >= 32);
  assert.notEqual(record.tokenHash, token);
  assert.equal(record.tokenHash, tokenHashOf(token));
  assert.equal(record.userId, 'DOHE');
  const dauer = Date.parse(record.expiresAt) - Date.parse(record.createdAt);
  assert.ok(Math.abs(dauer - 12 * 3600 * 1000) < 2000, 'Sitzung gilt 12 Stunden');
});

test('Zufallsschlüssel wiederholen sich nicht', () => {
  const werte = new Set(Array.from({ length: 200 }, () => randomHex(16)));
  assert.equal(werte.size, 200);
});
