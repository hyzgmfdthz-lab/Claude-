/**
 * Prueft die Einzeldatei-Fassung im Browser (optional, benoetigt Playwright).
 *
 *   node tools/build-html.mjs
 *   node tools/standalone-test.mjs
 *
 * Geprueft werden Start aus einer lokalen Datei, dauerhafte Speicherung,
 * Excel-Export, Datensicherung als Datei und deren Wiedereinlesen.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { readXlsx } from '../server/xlsx.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const FILE = process.env.HTML_FILE ?? path.join(ROOT, 'dist', 'Armaturenbau-MEGC.html');
const BASE = url.pathToFileURL(FILE).href;

const results = [];
const errors = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${info ? ` – ${info}` : ''}`);
};

const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'megc-dl-'));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', async (d) => { await d.accept(d.defaultValue() || 'Dauerhaftigkeitstest'); });

/** Bereich und Reiter der zweiten Maskenfassung (siehe tools/ui-test.mjs). */
const ZIEL = {
  Steuerstand: ['Übersicht', 'Kennzahlen'],
  Übersicht: ['Übersicht', 'Kennzahlen'],
  Belegung: ['Planung', 'Belegung'],
  Terminplan: ['Planung', 'Terminplan'],
  Vergleich: ['Planung', 'Vergleich'],
  Aufträge: ['Aufträge', 'Liste'],
  Arbeitsfolgen: ['Aufträge', 'Arbeitsfolgen'],
  Regeln: ['Aufträge', 'Regeln'],
  Mannschaft: ['Mannschaft', 'Mannschaft'],
  Stände: ['Einstellungen', 'Stände'],
  Einstellungen: ['Einstellungen', 'Parameter'],
  'Daten & Prüfung': ['Einstellungen', 'Daten & Prüfung'],
};

const nav = async (label) => {
  const [area, reiter] = ZIEL[label] ?? [label, null];
  await page.locator(`.navitem:has-text("${area}")`).first().click();
  await page.waitForTimeout(500);
  if (reiter) {
    const t = page.locator(`.tabbar .seg button:has-text("${reiter}")`).first();
    if (await t.count() > 0) { await t.click(); await page.waitForTimeout(700); }
  }
  await page.waitForTimeout(300);
};

const PASSWORT = 'Pruefung2026';

/** Anmeldung mit Kuerzel und Passwort (Erstanmeldung vergibt das Passwort). */
const anmelden = async (kuerzel = 'DOHE', passwort = PASSWORT) => {
  if (await page.locator('.login__box').count() === 0) return;
  await page.locator('.login__body input[type="text"]').first().fill(kuerzel);
  if (await page.locator('input[type="password"]').count() === 1) {
    await page.locator('input[type="password"]').fill(passwort);
    await page.locator('button:has-text("Anmelden")').click();
    // Auf einen Zustand warten, nicht auf eine feste Zeit
    await Promise.race([
      page.waitForSelector('.sidebar', { timeout: 30000 }).catch(() => null),
      page.waitForSelector('button:has-text("Passwort festlegen")', { timeout: 30000 }).catch(() => null),
      page.waitForSelector('.note--error', { timeout: 30000 }).catch(() => null),
    ]);
  }
  if (await page.locator('button:has-text("Passwort festlegen")').count() > 0) {
    const felder = page.locator('input[type="password"]');
    await felder.nth(0).fill(passwort);
    await felder.nth(1).fill(passwort);
    await page.locator('button:has-text("Passwort festlegen")').click();
  }
  await page.waitForSelector('.sidebar', { timeout: 30000 });
};

/* -------- Start aus der lokalen Datei -------- */
await page.goto(BASE);
await page.waitForSelector('.login__box', { timeout: 20000 });
check('Anmeldung gilt auch in der Einzeldatei',
  await page.locator('.login__body input[type="text"]').count() === 1
  && await page.locator('.sidebar').count() === 0);
await anmelden('DOHE');
check('Start durch Öffnen der Datei', (await page.locator('.sidebar__brand h1').innerText()) === 'Armaturenbau MEGC');
check('Engine rechnet im Browser',
  (await page.locator('.topbar__pulse').innerText()).replace(/\s+/g, ' ').toUpperCase().includes('37 AUFTRÄGE'),
  (await page.locator('.topbar__pulse').innerText()).replace(/\n/g, ' '));
check('Steuerstand beantwortet die Terminfrage',
  (await page.locator('.answer__text').innerText()).length > 20);
check('Keine externe Ressource nötig', !(await page.content()).includes('src="http'));

const speicher = await page.locator('.sidebar__foot').innerText();
const dauerhaft = speicher.includes('Browser');
check('Dauerhafte Speicherung verfügbar', dauerhaft, speicher.split('\n').pop());

/* -------- Änderung anlegen und Seite neu laden -------- */
await nav('Aufträge');
const vorher = await page.locator('table.tbl tbody tr').count();
await page.locator('button:has-text("+ Neuer Auftrag")').click();
await page.waitForTimeout(400);
await page.locator('.modal label.field:has-text("Auftragsnummer") input').fill('DAUER-1');
await page.locator('.modal label.field:has-text("Kunde") input').fill('Dauerhaftigkeitstest');
await page.locator('.modal label.field:has-text("Fertigstellung (Deadline") input').fill('2026-12-20');
await page.locator('.modal__foot button:has-text("Speichern")').click();
await page.waitForTimeout(2400);
check('Auftrag angelegt', await page.locator('table.tbl tbody tr').count() === vorher + 1);

await page.reload();
await page.waitForSelector('.sidebar', { timeout: 20000 });
check('Anmeldung übersteht das Neuladen', await page.locator('.userchip').count() === 1);
await nav('Aufträge');
const nachNeuladen = (await page.locator('table.tbl').innerText()).includes('DAUER-1');
check('Daten überstehen das Neuladen', nachNeuladen);

/* -------- Excel-Export prüfen -------- */
await nav('Daten & Prüfung');
const [xlsxDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button:has-text("Gesamtplanung als Excel")').click(),
]);
const xlsxPath = path.join(downloads, await xlsxDownload.suggestedFilename());
await xlsxDownload.saveAs(xlsxPath);
const sheets = readXlsx(fs.readFileSync(xlsxPath));
check('Excel-Datei ist gültig und lesbar', sheets.length === 6, `${sheets.length} Arbeitsblätter`);
check('Excel enthält alle Projekte', sheets[0].rows.length >= 38, `${sheets[0].rows.length - 1} Zeilen`);
check('Excel enthält die Testdaten', sheets[0].rows.some((r) => r[0] === 'DAUER-1'));
check('Excel enthält die Kapazitätsplanung',
  sheets.some((s) => s.name === 'Kapazität je KW' && s.rows.length > 5));

/* -------- Datensicherung als Datei -------- */
const [jsonDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button:has-text("Datensicherung speichern")').click(),
]);
const jsonPath = path.join(downloads, await jsonDownload.suggestedFilename());
await jsonDownload.saveAs(jsonPath);
const sicherung = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
check('Datensicherung enthält den Datenbestand',
  Array.isArray(sicherung.projects) && sicherung.projects.length >= 38,
  `${sicherung.projects?.length} Projekte, ${sicherung.scenarios?.length} Szenarien`);

/* -------- Testauftrag löschen, Sicherung wieder einlesen -------- */
await nav('Aufträge');
await page.locator('table.tbl tbody tr:has-text("DAUER-1")').click();
await page.locator('.panel__foot button:has-text("Löschen")').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('.panel__foot button:has-text("Löschen")').click();
await page.waitForTimeout(400);
await page.locator('.modal__foot button:has-text("Löschen")').last().click();
await page.waitForTimeout(2400);
check('Testauftrag gelöscht', !(await page.locator('table.tbl').innerText()).includes('DAUER-1'));

await nav('Daten & Prüfung');
await page.locator('#ds-file').setInputFiles(jsonPath);
await page.locator('button:has-text("Sicherungsdatei einlesen")').click();
await page.waitForTimeout(600);
await page.locator('.modal__foot button:has-text("Einlesen")').click();
await page.waitForTimeout(2800);
await nav('Aufträge');
check('Sicherung erfolgreich zurückgespielt', (await page.locator('table.tbl').innerText()).includes('DAUER-1'));

/* -------- Aufräumen: Startdaten wiederherstellen -------- */
await nav('Daten & Prüfung');
await page.locator('button:has-text("Auf Startdaten zurücksetzen")').click();
await page.waitForTimeout(500);
await page.locator('.modal__foot button:has-text("Zurücksetzen")').click();
await page.waitForTimeout(2500);
check('Zurücksetzen auf Startdaten',
  (await page.locator('.topbar__pulse').innerText()).replace(/\s+/g, ' ').toUpperCase().includes('37 AUFTRÄGE'),
  (await page.locator('.topbar__pulse').innerText()).replace(/\n/g, ' '));

/* -------- Abmelden, anderes Kürzel, Stände und Regeln -------- */
await page.locator('.userchip').click();
await page.waitForTimeout(500);
await page.locator('.modal button:has-text("Abmelden")').click();
await page.waitForTimeout(1500);
check('Abmelden führt zur Anmeldung', await page.locator('.login__box').count() === 1);

await anmelden('KEMI');
check('Zweites Kürzel meldet sich an', (await page.locator('.userchip').innerText()).includes('KEMI'));
check('Alle Bereiche für jeden', await page.locator('.navitem').count() === 5,
  `${await page.locator('.navitem').count()} Bereiche`);

await nav('Stände');
await page.locator('.card:has-text("Aktuellen Stand speichern") input[type="text"]').nth(0).fill('Einzeldatei-Prüfung');
await page.locator('.card:has-text("Aktuellen Stand speichern") input[type="text"]').nth(1).fill('Stand aus der Einzeldatei');
await page.locator('button:has-text("Stand speichern")').first().click();
await page.waitForTimeout(3000);
await nav('Stände');
check('Stand in der Einzeldatei gespeichert',
  (await page.locator('.card:has-text("Gespeicherte Stände") tbody').innerText()).includes('Einzeldatei-Prüfung'));
check('Protokoll führt das Kürzel',
  (await page.locator('.card:has-text("Änderungsprotokoll") tbody').innerText()).includes('KEMI'));

await nav('Regeln');
await page.locator('.rule__input').fill('Hydroprüfung nur dienstags und mittwochs');
await page.locator('button:has-text("Regel verstehen")').click();
await page.waitForTimeout(1200);
check('Regel wird auch in der Einzeldatei übersetzt',
  await page.locator('.card:has-text("Erkannte Regel")').count() === 1);
await page.locator('button:has-text("Regel speichern")').click();
await page.waitForTimeout(3000);
check('Regel in der Einzeldatei gespeichert',
  (await page.locator('.card:has-text("Regeln") tbody').innerText()).includes('Hydroprüfung'));

await page.reload();
await page.waitForSelector('.sidebar', { timeout: 20000 });
await nav('Regeln');
check('Regel übersteht das Neuladen',
  (await page.locator('.card:has-text("Regeln") tbody').innerText()).includes('Hydroprüfung'));

check('Keine JavaScript-Fehler', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
fs.rmSync(downloads, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} Prüfungen der Einzeldatei-Fassung bestanden ===`);
if (errors.length) console.log(`Fehlerprotokoll:\n${errors.slice(0, 8).join('\n')}`);
process.exit(failed ? 1 : 0);
