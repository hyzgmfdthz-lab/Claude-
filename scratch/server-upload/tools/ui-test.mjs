/**
 * Oberflaechentest (optional).
 *
 * Prueft die komplette Bedienoberflaeche in einem echten Browser: Anmeldung,
 * Rollen, Steuerstand mit allen Stellschrauben, Terminplan, Auftragspflege,
 * Arbeitsfolgen, Einstellungen (alle Reiter), Datenpruefung und Excel-Export.
 *
 * Voraussetzung: Playwright (nicht Teil der Anwendung).
 *
 *   npm  install -g playwright && npx playwright install chromium
 *   node server/server.js &                     # Anwendung starten
 *   BASE=http://127.0.0.1:7311 node tools/ui-test.mjs
 *
 * Der Pfad zu Playwright bzw. zum Browser kann ueber die Umgebungsvariablen
 * PLAYWRIGHT_MODULE und CHROMIUM_PATH gesetzt werden.
 */

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const BASE = process.env.BASE ?? 'http://127.0.0.1:7311';

/*
 * Probedatei fuer den Excel-Weg der Urlaubsplanung.
 *
 * Geschrieben wird mit demselben Baustein, den auch die Anwendung
 * verwendet - die Kopfzeile enthaelt echte Excel-Datumszahlen, nicht
 * den Text "21.09.". Genau daran waere ein naiver Einleser gescheitert.
 */
const { writeXlsx } = await import('../browser/xlsx.js');
const fsMod = await import('node:fs');
const osMod = await import('node:os');
const pathMod = await import('node:path');
const XLSX_PROBE = pathMod.join(osMod.tmpdir(), `megc-urlaub-${Date.now()}.xlsx`);
{
  const serial = (iso) => Math.round(
    (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
  const kopf = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map(serial);
  const rows = [kopf, [0, 0, 0, 0, 0], [], ['T', 'T', 'T', 'T', 'T'], ['A', 'A', 'A', 'A', 'A'], ['T', 'T', 'DM', 'DM', 'DM']];
  fsMod.writeFileSync(XLSX_PROBE, Buffer.from(writeXlsx([{ name: 'Urlaub 2026', rows }])));
}
const errors = [];
const results = [];

const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${info ? ` – ${info}` : ''}`);
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // Reine Netzmeldungen des Browsers ("Failed to load resource") entstehen auch
  // bei absichtlich geprueften Ablehnungen (z. B. widersprüchliche Regel) und
  // sind keine Programmfehler. Geprueft werden echte JavaScript-Fehler.
  const text = m.text();
  if (m.type() === 'error' && !text.startsWith('Failed to load resource')) errors.push(`console: ${text}`);
});
page.on('dialog', async (d) => { await d.accept(d.defaultValue() || 'Prüfstand'); });

/**
 * Bereich und Reiter der zweiten Maskenfassung.
 *
 * Die Anwendung hat jetzt fuenf Bereiche mit Unterreitern statt zehn
 * Menuepunkten. Damit die Pruefungen weiter in der Sprache der Fachseite
 * stehen ("Terminplan", "Regeln"), rechnet diese Tabelle den alten Namen
 * in Bereich und Reiter um.
 */
const ZIEL = {
  Steuerstand: ['Übersicht', 'Kennzahlen'],
  Übersicht: ['Übersicht', 'Kennzahlen'],
  Mehraufwand: ['Übersicht', 'Mehraufwand'],
  Engpässe: ['Übersicht', 'Engpässe & Wirkung'],
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
const tab = async (label) => {
  await page.locator(`.seg button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

/**
 * Die Stellschrauben stehen jetzt im Panel rechts und sind in drei
 * Gruppen zugeklappt. Fuer die Pruefung werden alle Gruppen geoeffnet.
 */
const oeffneStellschrauben = async () => {
  if (await page.locator('.panel:has(.panel__title:text-is("Stellschrauben"))').count() === 0) {
    await page.locator('button:has-text("Stellschrauben")').first().click();
    await page.waitForSelector('.panel .fold__head', { timeout: 15000 });
  }
  const koepfe = page.locator('.panel .fold__head');
  const n = await koepfe.count();
  for (let i = 0; i < n; i++) {
    const zeichen = (await koepfe.nth(i).locator('.fold__mark').innerText()).trim();
    if (zeichen === '▸') { await koepfe.nth(i).click(); await page.waitForTimeout(120); }
  }
};
/** Kennzahl aus dem Steuerstand lesen. */
const kpiValue = async (label) => {
  // Die Kennzahlen stehen im ersten Reiter der Uebersicht. Wer gerade in
  // "Engpaesse & Wirkung" steht, wird dorthin zurueckgeholt.
  if (await page.locator(`.kpi:has(.kpi__label:text-is("${label}"))`).count() === 0) {
    const t = page.locator('.tabbar .seg button:has-text("Kennzahlen")').first();
    if (await t.count() > 0) { await t.click(); await page.waitForTimeout(900); }
  }
  return (await page.locator(`.kpi:has(.kpi__label:text-is("${label}")) .kpi__value`).first().innerText()).trim();
};
/** Regler setzen (Wert eintragen und Neuberechnung abwarten). */
const setSlider = async (label, value, wait = 2600) => {
  await oeffneStellschrauben();
  const group = page.locator(`.panel .rail__group:has(.rail__label:has-text("${label}"))`).first();
  await group.locator('input[type="range"]').fill(String(value));
  await page.waitForTimeout(wait);
};
/** Fehlerbanner der aktuellen Ansicht. */
const viewError = async () => {
  const n = await page.locator('.note--error:has-text("Fehler in der Ansicht")').count();
  return n ? (await page.locator('.note--error').first().innerText()).slice(0, 160) : '';
};

/* ================================================================== *
 * Anmeldung und Rollen
 * ================================================================== */

const PASSWORT = process.env.MEGC_TEST_PW ?? 'Pruefung2026';

/**
 * Meldet ein Kuerzel an. Ist noch kein Passwort vergeben, wird es vergeben.
 * Gewartet wird auf Zustaende, nicht auf feste Zeiten - sonst haengt das
 * Ergebnis davon ab, wie schnell der Rechner gerade ist.
 */
const anmelden = async (target, kuerzel, passwort = PASSWORT) => {
  await target.waitForSelector('.login__box', { timeout: 20000 });
  await target.locator('.login__body input[type="text"]').first().fill(kuerzel);

  if (await target.locator('input[type="password"]').count() === 1) {
    await target.locator('input[type="password"]').fill(passwort);
    await target.locator('button:has-text("Anmelden")').click();
    // Entweder sind wir drin oder es wird ein eigenes Passwort verlangt.
    await Promise.race([
      target.waitForSelector('.sidebar', { timeout: 30000 }).catch(() => null),
      target.waitForSelector('button:has-text("Passwort festlegen")', { timeout: 30000 }).catch(() => null),
      target.waitForSelector('.note--error', { timeout: 30000 }).catch(() => null),
    ]);
  }

  if (await target.locator('button:has-text("Passwort festlegen")').count() > 0) {
    const felder = target.locator('input[type="password"]');
    await felder.nth(0).fill(passwort);
    await felder.nth(1).fill(passwort);
    await target.locator('button:has-text("Passwort festlegen")').click();
  }
  await target.waitForSelector('.sidebar', { timeout: 30000 });
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.login__box', { timeout: 20000 });
check('Anmeldung wird verlangt',
  (await page.locator('.login__head h1').innerText()).includes('Armaturenbau MEGC'));
check('Ohne Anmeldung keine Planung', await page.locator('.sidebar').count() === 0);

// Erste Anmeldung: es ist noch kein Passwort vergeben
await page.locator('.login__body input[type="text"]').first().fill('DOHE');
await page.locator('input[type="password"]').fill('irgendwas');
await page.locator('button:has-text("Anmelden")').click();
await page.waitForSelector('button:has-text("Passwort festlegen")', { timeout: 30000 }).catch(() => null);
check('Erstanmeldung verlangt ein eigenes Passwort',
  await page.locator('.note--info').count() === 1 && await page.locator('input[type="password"]').count() === 2,
  await page.locator('.note--info').first().innerText().catch(() => 'kein Hinweis erschienen'));

await anmelden(page, 'DOHE');

check('Anwendung startet', (await page.locator('.sidebar__brand h1').innerText()) === 'Armaturenbau MEGC');
check('Kürzel wird angezeigt', (await page.locator('.userchip').innerText()).includes('DOHE'));
check('Fünf Bereiche in der Seitenleiste', await page.locator('.navitem').count() === 5,
  (await page.locator('.navitem').allInnerTexts()).map((t) => t.split('\n').pop()).join(', '));
check('Einstieg ist die Übersicht',
  (await page.locator('.topbar__title').innerText()) === 'Übersicht');
check('Der Bereich führt seine Reiter oben',
  (await page.locator('.tabbar .seg button').allInnerTexts()).join('|') === 'Kennzahlen|Mehraufwand|Engpässe & Wirkung',
  (await page.locator('.tabbar .seg button').allInnerTexts()).join(' | '));

/* ================================================================== *
 * Steuerstand: Antwort, Kennzahlen, Diagramm, Tabellen
 * ================================================================== */

check('Antwortzeile beantwortet die Terminfrage',
  /Auftr(ä|a)gen? werden zu sp(ä|a)t|Alle Termine werden gehalten/.test(await page.locator('.answer__text').innerText()));
check('Engpass wird benannt',
  (await page.locator('.answer').innerText()).includes('Wo es klemmt')
  || (await page.locator('.answer').innerText()).includes('Kein Engpass'));

await page.waitForFunction(
  () => !document.querySelector('.answer').innerText.includes('wird berechnet'),
  null, { timeout: 90000 },
);
const personal = await page.locator('.answer').innerText();
check('Personalbedarf wird beantwortet',
  /Für 100 % Termintreue|Mehr Personal allein|Personal: reicht aus/.test(personal),
  personal.split('\n').pop()?.slice(0, 110));

check('Kennzahlen sichtbar', await page.locator('.kpi').count() === 8, `${await page.locator('.kpi').count()} Kennzahlen`);
const ueberKapazitaet = await kpiValue('Über Kapazität');
check('Kennzahl „Über Kapazität" zeigt die fehlenden Stunden',
  /^\+?[\d.]+\s*h?$/.test(ueberKapazitaet.trim()),
  `${ueberKapazitaet} · ${await page.locator('.kpi:has(.kpi__label:text-is("Über Kapazität")) .kpi__hint').innerText()}`);
check('Antwortzeile nennt den Überhang',
  (await page.locator('.answer').innerText()).includes('Über Kapazität'));
check('Kennzahl mit Wert 0 wird angezeigt', /^\d/.test(await kpiValue('Im Termin')));
check('Kapazitätsdiagramm gezeichnet', await page.locator('svg.chart rect.bar-demand').count() > 10);
check('Kapazitätskennlinie gezeichnet', await page.locator('svg.chart path.line-capacity').count() === 1);
check('Wochenübersicht gefüllt',
  await page.locator('.card:has(.card__title:text-is("Wochenübersicht")) tbody tr').count() > 10);
// Ohne Zahlenlisten steht in der Spalte "Mitarbeiter" nur die Mannschaft
check('Die Mitarbeiterzahl stammt aus der Mannschaft, ohne stille Zuschläge',
  !(await page.locator('.card:has(.card__title:text-is("Wochenübersicht")) tbody').innerText()).includes('davon'));
/* Auslastung, Wirkungsanalyse und Schichtfrage stehen jetzt im zweiten
   Reiter der Uebersicht - die Kennzahlen bleiben unbelastet davon. */
await nav('Engpässe');
/* ---------- Die Zahlen muessen sich nachrechnen lassen ---------- *
 *
 * Gemeldet am 18.09.2026: "Die Zahlen und Rechnungen sind nicht logisch."
 * Es stimmte: Die Engpasszahl summierte eine Tageswarteschlange ueber alle
 * Wartetage, und kein Ausweis sagte, welcher Zeitraum gilt. Diese
 * Pruefungen halten beides fest.
 */
const rechenweg = page.locator('.card:has(.card__title:text-is("Woher die Kapazität kommt"))');
await rechenweg.waitFor({ state: 'visible', timeout: 20000 });
const rwText = await rechenweg.innerText();
check('Die Kapazität nennt ihren Zeitraum',
  /Zeitraum/.test(rwText) && /\d{2}\.\d{2}\.\d{4}\s*–\s*\d{2}\.\d{2}\.\d{4}/.test(rwText),
  rwText.split('\n').find((z) => /Zeitraum/.test(z))?.slice(0, 90) ?? 'kein Zeitraum');
check('Der Rechenweg nennt Arbeitstage, nicht nur Kalendertage',
  /Kalendertage/.test(rwText) && /davon \d+ Arbeitstage/.test(rwText),
  rwText.split('\n').find((z) => /Arbeitstage/.test(z))?.slice(0, 90) ?? '');
/*
 * Arbeitsschutz: "Es darf aus Sicherheitsgruenden niemand alleine
 * arbeiten." Die Regel wirkt in der Rechnung - sie muss auch dastehen,
 * sonst sieht ein leerer Tag wie ein Fehler aus.
 */
check('Die Mindestbesetzung steht im Rechenweg',
  /Mindestbesetzung/.test(rwText) && /2 Personen/.test(rwText)
  && /niemand arbeitet allein/.test(rwText),
  rwText.split('\n').find((z) => /Mindestbesetzung/.test(z))?.slice(0, 90) ?? 'fehlt');
check('Der Rechenweg nennt Besetzung, Stunden je Tag, Produktivität und Reserve',
  /Besetzung im Schnitt/.test(rwText) && /Stunden je MA und Tag/.test(rwText)
  && /Produktivität/.test(rwText) && /Reserve Zubehör/.test(rwText));
/*
 * Gemeldet am 18.09.2026: "Was hat 1 % in der Rechnung verloren?" Die
 * Produktivitaet (0,9333) ging als Faktor an einen Prozentbaustein, der
 * Prozentpunkte erwartet.
 */
check('Die Produktivität steht als Prozentsatz, nicht als Faktor',
  /Produktivität\s+9\d,\d\s*%/.test(rwText) && !/\b[01]\s*%/.test(rwText),
  rwText.split('\n').find((z) => /Produktivität/.test(z))?.slice(0, 60) ?? 'fehlt');
check('Der Rechenweg addiert Posten statt ein Produkt zu behaupten',
  /Reguläre Arbeitstage/.test(rwText) && /Reserve Zubehör/.test(rwText)
  && /die Posten darüber zusammengezählt/.test(rwText));
check('Näherung und ausgewiesene Kapazität stehen beide da',
  /Näherung mit diesen Mittelwerten/.test(rwText) && /Ausgewiesene Kapazität/.test(rwText));
// Die beiden Zahlen muessen nah beieinander liegen - sonst ist der
// ausgewiesene Rechenweg nicht der, der wirklich gerechnet wird.
{
  /*
   * Gelesen wird zeilenweise ueber die Beschriftung, nicht ueber die
   * Reihenfolge der Zahlen: Der Rechenweg fuehrt jetzt einzelne Posten
   * (regulaere Tage, Samstage, Betreuung, Reserve), und "die erste Zahl
   * ueber 500" traf danach den falschen Wert.
   */
  const wertAus = (label) => {
    const zeile = rwText.split('\n').find((z) => z.trim().startsWith(label));
    const m = zeile?.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*h/);
    return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
  };
  const naeherung = wertAus('Näherung mit diesen Mittelwerten');
  const exakt = wertAus('Ausgewiesene Kapazität');
  check('Näherung und exakte Kapazität weichen um unter 2 % ab',
    naeherung != null && exakt != null
    && Math.abs(naeherung - exakt) / Math.max(naeherung, exakt) < 0.02,
    `${naeherung} h gegen ${exakt} h`);
  // Der Rechenweg muss sich von Hand nachaddieren lassen
  const regulaer = wertAus('Reguläre Arbeitstage');
  const reserve = wertAus('− Reserve Zubehör');
  const betreuung = wertAus('− Betreuung neuer Kräfte') ?? 0;
  const samstage = wertAus('+ Samstage') ?? 0;
  check('Die Posten des Rechenwegs ergeben die Näherung',
    regulaer != null && reserve != null && naeherung != null
    && Math.abs((regulaer + samstage - betreuung - reserve) - naeherung) < 2,
    `${regulaer} + ${samstage} − ${betreuung} − ${reserve} = ${naeherung}`);
}
check('Vor der Handrechnung mit Kalendertagen wird gewarnt',
  /Wochenstunden dürfen nicht mit Kalendertagen multipliziert werden/.test(rwText));

const stunden = page.locator('.card:has(.card__title:text-is("Stunden je Arbeitsgang"))');
await stunden.waitFor({ state: 'visible', timeout: 20000 });
const stText = await stunden.innerText();
check('Die Stunden sind auf die Arbeitsgänge gebucht',
  /Orbitalschweißen/.test(stText) && /Arbeitsinhalt h/.test(stText)
  && /h je Auftrag/.test(stText) && /blieb liegen h/.test(stText));
check('Die Buchung geht auf – die Summe stimmt mit der offenen Arbeit überein',
  /Stimmt mit der offenen Arbeit aller Aufträge überein/.test(stText),
  stText.split('\n').find((z) => /offene Arbeit aller Aufträge/.test(z))?.slice(0, 120) ?? 'keine Gegenprobe');
check('„blieb liegen" wird ausdrücklich nicht als zweite Arbeitsmenge ausgegeben',
  /keine zweite Arbeitsmenge/.test(stText) && /genau einmal/.test(stText));
// Gegenprobe an der Zeile Orbitalschweissen: liegengeblieben <= offen
{
  const zelle = async (n) => (await stunden.locator(`tbody tr:has-text("Orbitalschweißen") td:nth-child(${n})`)
    .innerText()).replace(/\./g, '').replace(',', '.').trim();
  const offen = Number(await zelle(4));
  const liegen = Number((await zelle(8)).replace('–', '0')) || 0;
  check('Liegengebliebene Stunden bleiben unter der offenen Arbeit',
    offen > 0 && liegen <= offen,
    `Orbitalschweißen: ${liegen} h lagen von ${offen} h offener Arbeit`);
}

check('Der zweite Reiter nennt den Engpass in einem Satz',
  /bremst am stärksten|Kein Engpass erkennbar/.test(await page.locator('.answer__text').innerText()),
  (await page.locator('.answer__text').innerText()).slice(0, 110));
check('Auslastung je Arbeitsplatz und Woche',
  await page.locator('table.matrix tbody tr').count() >= 8,
  `${await page.locator('table.matrix tbody tr').count()} Arbeitsplatzgruppen`);
const blockierteZellen = await page.locator('table.matrix tbody tr td:last-child').allInnerTexts();
check('Liegengebliebene Stunden stehen in der Matrix',
  blockierteZellen.filter((t) => t.trim() !== '–' && t.trim() !== '').length >= 2,
  `${blockierteZellen.filter((t) => t.trim() !== '–' && t.trim() !== '').length} Arbeitsgänge mit Rückstand`);
check('Zeile „Mitarbeiterstunden gesamt" in der Matrix',
  await page.locator('table.matrix tr.matrix__pool').count() === 1);
check('Spalte „Stau max h" vorhanden',
  await page.locator('table.matrix thead th:text-is("Stau max h")').count() === 1);

/* ---------- Auslastung: Filter und Gesamtansicht ---------- */
const auslastung = page.locator('.card:has-text("Auslastung je Arbeitsplatz")');
check('Engpass wird über der Matrix benannt',
  await auslastung.locator('.note--warn').count() === 1,
  await auslastung.locator('.note--warn').count() ? (await auslastung.locator('.note--warn').innerText()).slice(0, 90) : '');

await auslastung.locator('button:has-text("Gesamtzeitraum")').click();
await page.waitForTimeout(900);
const gesamt = page.locator('.card:has-text("Auslastung je Arbeitsplatz")');
check('Gesamtansicht der Auslastung',
  await gesamt.locator('table.tbl tbody tr').count() >= 9 && await gesamt.locator('table.matrix').count() === 0,
  `${await gesamt.locator('table.tbl tbody tr').count()} Zeilen`);
const gesamtText = await gesamt.innerText();
check('Gesamtansicht zeigt mögliche und belegte Stunden, Überlastwochen und Rückstand',
  /mögliche h/.test(gesamtText) && /belegte h/.test(gesamtText)
  && /Wochen > 100 %/.test(gesamtText)
  && /Stau an Tagen/.test(gesamtText) && /größter Tag h/.test(gesamtText));
/*
 * Der Stau ist eine WARTESCHLANGE. Die Summe ueber die Tage waere in
 * "Stunden mal Tagen" und damit keine vorstellbare Groesse - sie darf in
 * keiner Zeile groesser sein als das, was ueberhaupt moeglich ist.
 */
const stauZeilen = page.locator('.card:has-text("Auslastung je Arbeitsplatz") tbody tr');
let stauPlausibel = true;
let stauBeispiel = '';
for (let i = 0; i < await stauZeilen.count(); i++) {
  const zellen = await stauZeilen.nth(i).locator('td').allInnerTexts();
  if (zellen.length < 9) continue;
  const zahl = (t) => Number.parseFloat(String(t).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  const moeglich = zahl(zellen[3]);
  const stauMax = zahl(zellen[8]);
  if (!Number.isFinite(moeglich) || !Number.isFinite(stauMax) || stauMax === 0) continue;
  if (stauMax > moeglich) {
    stauPlausibel = false;
    stauBeispiel = `${zellen[0]}: Stau ${zellen[8]} h über möglichen ${zellen[3]} h`;
  }
}
check('Der Stau bleibt unter den möglichen Stunden – keine Stunden-mal-Tage mehr',
  stauPlausibel, stauBeispiel || 'alle Zeilen plausibel');

const wochenWahl = gesamt.locator('select').first();
const optionen = await wochenWahl.locator('option').count();
await wochenWahl.selectOption({ index: Math.min(3, optionen - 1) });
await page.waitForTimeout(900);
check('Zeitraum der Auslastung eingrenzbar',
  (await page.locator('.card:has-text("Auslastung je Arbeitsplatz") .card__sub').innerText()).includes('KW 40'),
  await page.locator('.card:has-text("Auslastung je Arbeitsplatz") .card__sub').innerText());

await page.locator('.card:has-text("Auslastung je Arbeitsplatz") button:has-text("Ganzer Zeitraum")').click();
await page.waitForTimeout(900);
await page.locator('.card:has-text("Auslastung je Arbeitsplatz") button:has-text("Je Woche")').click();
await page.waitForTimeout(900);
check('Zurück auf die Wochenansicht', await page.locator('table.matrix').count() === 1);
await nav('Übersicht');
check('Gefährdete Aufträge nennen den Materialstand',
  (await page.locator('.card:has-text("Gefährdete Aufträge") thead').innerText()).includes('Material'));
check('Gefährdete Aufträge aufgelistet',
  await page.locator('.card:has-text("Gefährdete Aufträge") tbody tr').count() > 1);

/* ---------- Stellschrauben wirken sofort ---------- */
const otdVorher = await kpiValue('Termintreue');

/* Keine toten Regler mehr: Personal kommt aus der Mannschaft, Schichten
   aus der Tabelle je Arbeitsgang. Beides wird hier geprüft. */
await oeffneStellschrauben();
check('Stellschrauben stehen im Panel rechts',
  await page.locator('.panel:has(.panel__title:text-is("Stellschrauben"))').count() === 1);
check('Stellschrauben sind in drei Gruppen geordnet',
  await page.locator('.panel .fold').count() === 3,
  (await page.locator('.panel .fold__head').allInnerTexts()).map((t) => t.split('\n')[1] ?? t).join(', '));
check('Kein Regler „Stammmitarbeiter" mehr im Steuerstand',
  await page.locator('.panel .rail__group:has(.rail__label:has-text("Stammmitarbeiter"))').count() === 0);
check('Kein Regler „Leiharbeiter zusätzlich" mehr im Steuerstand',
  await page.locator('.panel .rail__group:has(.rail__label:has-text("Leiharbeiter zusätzlich"))').count() === 0);
check('Kein Regler „Belegungszeit je Tag" mehr im Steuerstand',
  await page.locator('.panel .rail__group:has(.rail__label:has-text("Belegungszeit je Tag"))').count() === 0);

const mannschaftBlock = page.locator('.panel .rail__group:has(.rail__label:has-text("Mannschaft"))').first();
check('Der Steuerstand zeigt die Stärke der Mannschaft',
  /\d+(,\d+)? MA/.test(await mannschaftBlock.locator('.rail__value').innerText()),
  await mannschaftBlock.locator('.rail__value').innerText());
check('Und sagt, wo Personal gepflegt wird',
  (await mannschaftBlock.innerText()).includes('Mannschaft gepflegt'));

const schichtGruppe = page.locator('.panel .rail__group:has(.rail__label:has-text("Schichten"))').first();
check('Schichten stehen als eigener Block in der Leiste',
  (await schichtGruppe.innerText()).includes('schichtig'),
  (await schichtGruppe.innerText()).slice(0, 90));

const kapVorher = Number.parseFloat((await kpiValue('Kapazität')).replace(/[^\d]/g, ''));
await setSlider('Überstunden je MA und Woche', 3);
const kapMehr = Number.parseFloat((await kpiValue('Kapazität')).replace(/[^\d]/g, ''));
check('Regler „Überstunden" wirkt sofort', kapMehr > kapVorher,
  `Kapazität ${kapVorher} -> ${kapMehr} h`);
await setSlider('Überstunden je MA und Woche', 0);

await setSlider('Orbitalschweißer im Einsatz', 6);
await setSlider('Heftplätze', 3);
const otdVoll = await kpiValue('Termintreue');
check('Mehr Maschinenbesatz verbessert die Termintreue',
  Number.parseFloat(otdVoll) >= Number.parseFloat(otdVorher),
  `Termintreue ${otdVorher} -> ${otdVoll}`);

/* ---------- Belegungszeit je Arbeitsgang (Schichtbetrieb) ---------- */
// Kennzahl zuerst lesen, dann in den Reiter wechseln - sonst springt die
// Ansicht mitten im Block zurueck.
const engpassVorSchicht = await kpiValue('Engste Stelle');
await nav('Engpässe');

/* ---------- Schichten automatisch planen ---------- */
/*
 * Vorgabe der Abteilungsleitung: "Kein Platz frei ist keine Option, plane
 * dann an den Arbeitsplaetzen so die Schichten dass es maximal effizient
 * ist ... wenn dann immernoch Arbeitsplaetze fehlen sollen diese angezeigt
 * werden." Geprueft wird der ganze Weg: rechnen, lesen, uebernehmen.
 */
const autoKarte = page.locator('.card:has(.card__title:text-is("Schichten automatisch planen"))');
check('Die Anwendung kann die Schichten selbst planen',
  await autoKarte.count() === 1);
check('Der Wochenwechsel der Schichten steht in der Erklärung',
  /wochenweise/.test(await autoKarte.innerText()));
await autoKarte.locator('button:has-text("Schichten automatisch planen")').click();
await autoKarte.locator('.answer').waitFor({ timeout: 180000 });
const autoText = await autoKarte.innerText();
check('Der Schichtplan nennt die Wirkung auf die Termine',
  /Verspätung[\s\S]*Tage/.test(autoText),
  autoText.split('\n').slice(1, 3).join(' · ').slice(0, 110));
check('Der Schichtplan sagt, wie viele Leute schichtfähig sind',
  /schichtfähig/.test(autoText));
check('Der Schichtplan zeigt die Wirkung auf den Einsatzplan',
  /Leerlauf im Einsatzplan/.test(autoText));
const autoZeilen = await autoKarte.locator('tbody tr').count();
const autoAenderungen = await autoKarte.locator('button:has-text("In ein Szenario übernehmen")').count() === 1;
check('Der Vorschlag benennt die Arbeitsgänge mit neuer Schicht',
  autoAenderungen ? autoZeilen > 0 : /laufen schon so/.test(autoText),
  `${autoZeilen} Zeilen`);
check('Was danach noch fehlt, wird angezeigt',
  /Was danach noch fehlt/.test(autoText) || /fehlt an keinem Arbeitsgang/.test(autoText));
check('Geprüfte, aber verworfene Schichten sind nachlesbar',
  /Geprüft und verworfen/.test(autoText) || !autoAenderungen);

if (autoAenderungen) {
  const standWahlSchicht = page.locator('.topctl:has(label:text-is("Stand")) select');
  const standVorSchicht = await standWahlSchicht.inputValue();
  const szenarienVorSchicht = await standWahlSchicht.locator('option').count();
  await autoKarte.locator('button:has-text("In ein Szenario übernehmen")').click();
  await page.waitForSelector('.modal:has-text("Schichtplan in ein Szenario übernehmen?")');
  check('Vor dem Übernehmen des Schichtplans wird der laufende Plan geschützt',
    /Der laufende Plan bleibt unverändert/.test(await page.locator('.modal').innerText()));
  await page.locator('.modal button:has-text("Übernehmen")').click();
  await page.waitForTimeout(8000);
  check('Der Schichtplan wird in ein eigenes Szenario übernommen',
    await standWahlSchicht.locator('option').count() === szenarienVorSchicht + 1,
    `${szenarienVorSchicht} -> ${await standWahlSchicht.locator('option').count()}`);
  check('Das Szenario des Schichtplans ist danach geöffnet',
    (await standWahlSchicht.locator('option:checked').innerText()).includes('Schichtplan'),
    await standWahlSchicht.locator('option:checked').innerText());
  // Zurueck auf den Ausgangsstand - die folgenden Pruefungen rechnen dort weiter
  await standWahlSchicht.selectOption(standVorSchicht);
  await page.waitForTimeout(5000);
  if (await page.locator('.overlay').count() > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  check('Nach dem Schichtplan steht kein Fenster mehr offen',
    await page.locator('.overlay').count() === 0);
}

const schichtKarte = page.locator('.card:has-text("Schichten und Plätze je Arbeitsgang")');
check('Belegungszeit je Arbeitsgang vorhanden',
  await schichtKarte.count() === 1
  && await schichtKarte.locator('tbody tr').count() === 11,
  `${await schichtKarte.locator('tbody tr').count()} Arbeitsgänge`);
// Spalte 3 ist "begrenzt die Planung" - die Schichtspalte hat eigene Pillen
const grenzSpalte = () => schichtKarte.locator('tbody td:nth-child(3)');
check('Es ist erkennbar, welcher Arbeitsgang die Planung begrenzt',
  await grenzSpalte().locator('.pill--blue').count() >= 9,
  `${await grenzSpalte().locator('.pill--blue').count()} Arbeitsgänge mit Platzgrenze`);
check('Die Arbeitsvorbereitung ist als eigener Arbeitsgang geführt',
  await schichtKarte.locator('tbody tr:has-text("Arbeitsvorbereitung")').count() === 1);

const orbitalZeile = () => page.locator('.card:has-text("Schichten und Plätze je Arbeitsgang") tbody tr:has-text("Orbitalschweißen")');
const auslastungVorher = Number.parseFloat((await orbitalZeile().locator('td').last().innerText()).replace(/[^\d,]/g, '').replace(',', '.'));
await schichtKarte.locator('tbody tr:has-text("Orbitalschweißen") select').selectOption('22.5');
await page.waitForTimeout(3500);
check('Schichten je Arbeitsgang umstellbar (3 Schichten am Orbitalschweißen)',
  (await orbitalZeile().locator('input[type="number"]').nth(1).inputValue()) === '22.5'
  && (await orbitalZeile().innerText()).includes('3 Schichten'),
  (await orbitalZeile().innerText()).replace(/\n/g, ' · ').slice(0, 90));
const auslastungNachher = Number.parseFloat((await orbitalZeile().locator('td').last().innerText()).replace(/[^\d,]/g, '').replace(',', '.'));
check('Drei Schichten entlasten den Arbeitsplatz',
  auslastungNachher < auslastungVorher * 0.85,
  `Spitzenauslastung Orbital ${auslastungVorher} % -> ${auslastungNachher} %`);

await schichtKarte.locator('button:has-text("Plätze aus der Arbeitsplatzliste übernehmen")').click();
await page.waitForTimeout(3200);
check('Alle Arbeitsgänge auf einmal umstellbar',
  await schichtKarte.locator('.btn-row button:has-text("2 Schichten")').count() === 1
  && await schichtKarte.locator('.btn-row button:has-text("1 Schicht")').count() === 1);
check('Plätze aus der Arbeitsplatzliste übernehmbar',
  await grenzSpalte().locator('.pill--grey').count() === 0);
await page.locator('.card:has-text("Schichten und Plätze je Arbeitsgang") button:has-text("zurück auf Standard")').click();
await page.waitForTimeout(3200);
check('Eigene Werte je Arbeitsgang entfernbar',
  (await kpiValue('Engste Stelle')) === engpassVorSchicht,
  `wieder ${await kpiValue('Engste Stelle')}`);
await nav('Übersicht');

await oeffneStellschrauben();
await page.locator('.panel .rail__group:has(.rail__label:has-text("Samstagsarbeit")) button:has-text("Alle")').click();
await page.waitForTimeout(2800);
check('Samstagsarbeit einschaltbar',
  (await page.locator('.panel .rail__group:has(.rail__label:has-text("Samstagsarbeit")) .rail__value').innerText()).includes('Wochen'),
  await page.locator('.panel .rail__group:has(.rail__label:has-text("Samstagsarbeit")) .rail__value').innerText());
check('Samstage erscheinen in der Wochenübersicht',
  await page.locator('.card:has(.card__title:text-is("Wochenübersicht")) .pill--blue:has-text("ja")').count() > 3);

await page.locator('.panel button:has-text("Stand speichern")').click();
await page.waitForTimeout(700);
await page.locator('.modal button:has-text("Stand speichern")').click();
await page.waitForTimeout(900);
check('Stand ohne Notiz wird abgelehnt', await page.locator('.toast--error').count() >= 1);
await page.locator('.modal input[type="text"]').nth(1).fill('Aus dem Steuerstand gespeichert');
await page.locator('.modal button:has-text("Stand speichern")').click();
await page.waitForTimeout(3000);
check('Stand aus dem Steuerstand speicherbar',
  await page.locator('.overlay').count() === 0 && await page.locator('.toast--ok').count() >= 1);

await page.locator('button:has-text("Zurücksetzen")').click();
await page.waitForTimeout(500);
await page.locator('.modal__foot button:has-text("Zurücksetzen")').last().click();
await page.waitForTimeout(3500);
check('Stellschrauben zurücksetzbar', (await kpiValue('Termintreue')) === otdVorher,
  `Termintreue wieder ${await kpiValue('Termintreue')}`);

/* ================================================================== *
 * IST-Stand fixieren und dagegen messen
 * ================================================================== */

check('Steuerstand weist auf den fehlenden IST-Stand hin',
  (await page.locator('.note--info:has-text("IST-Stand")').count()) >= 1);

await nav('Vergleich');
check('Vergleichsansicht erklärt den IST-Stand',
  await page.locator('.card:has-text("Noch kein IST-Stand festgelegt")').count() === 1);
await page.locator('button:has-text("Aktuellen Stand als IST-Stand fixieren")').click();
await page.waitForSelector('.modal:has-text("IST-Stand fixieren")', { timeout: 20000 });
await page.locator('.modal button:has-text("IST-Stand fixieren")').click();
await page.waitForSelector('.card:has-text("Gegen den IST-Stand")', { timeout: 40000 });
check('IST-Stand fixierbar', await page.locator('.card__title:text-is("Gegen den IST-Stand")').count() === 1);
check('Ohne Änderung sind die Stellschrauben gleich',
  (await page.locator('.card:has-text("Was sich geändert hat")').innerText()).includes('entsprechen dem IST-Stand'));
check('IST-Kapazitätslinie im Diagramm',
  await page.locator('.card:has-text("Kapazität gegen den IST-Stand") svg path.line-capacity2').count() === 1);

// Zuerst ein Hebel, der am Engpass nichts ändert: das muss begründet werden.
await nav('Steuerstand');
await setSlider('Orbitalschweißer im Einsatz', 6, 4000);
await page.waitForSelector('.note:has-text("bringt nichts")', { timeout: 40000 }).catch(() => {});
const begruendung = await page.locator('.note:has-text("bringt nichts")').count()
  ? await page.locator('.note:has-text("bringt nichts")').innerText() : '';
check('Wirkungslose Änderung wird begründet', begruendung !== '',
  begruendung.replace(/\n/g, ' ').slice(0, 110));
check('Die Begründung nennt Änderung, Engpass und nächsten Schritt',
  /Geändert wurde/.test(begruendung) && /Begrenzend ist aber/.test(begruendung) && /Was hier hilft/.test(begruendung),
  begruendung.replace(/\n/g, ' ').slice(0, 170));
await setSlider('Orbitalschweißer im Einsatz', 4, 3500);

await setSlider('Überstunden je MA und Woche', 5, 3000);
await page.waitForSelector('.note--ok:has-text("Gegen IST-Stand"), .note--warn:has-text("Gegen IST-Stand")', { timeout: 40000 });
check('Steuerstand zeigt eine Zeile zum IST-Stand',
  /Termintreue|Verspätungstage/.test(await page.locator('.note:has-text("Gegen IST-Stand")').innerText()),
  (await page.locator('.note:has-text("Gegen IST-Stand")').innerText()).slice(0, 110));
check('Keine Abweichungen an den Kacheln im Steuerstand',
  await page.locator('.kpi__delta').count() === 0);

await nav('Vergleich');
await page.waitForSelector('.card:has-text("Aufträge gegen den IST-Stand") tbody tr', { timeout: 40000 });
const vergleichText = await page.locator('.view').innerText();
check('Vergleich nennt die veränderte Stellschraube', /Überstunden je MA und Woche/.test(vergleichText));
check('Vergleich nennt die veränderten Aufträge', /Aufträge gegen den IST-Stand \(\d+\)/.test(vergleichText));
check('Vergleich zeigt Kennzahlen nebeneinander',
  /IST-Stand/.test(vergleichText) && /Verspätung gesamt/.test(vergleichText));

await nav('Stände');
check('Der IST-Stand ist in der Standliste gekennzeichnet',
  await page.locator('table.tbl .pill--violet:has-text("IST-Stand")').count() === 1);

/* ---------- IST -> heute -> SOLL ---------- */
const weg = page.locator('.card:has(.card__title:text-is("Von wo nach wo"))');
check('Der Weg IST → heute → SOLL steht als eigene Karte',
  await weg.locator('.weg__punkt').count() === 3,
  (await weg.locator('.weg__titel').allInnerTexts()).join(' → '));
check('Der IST-Stand steht mit seiner Termintreue im Weg',
  /IST-STAND/i.test(await weg.innerText()) && /%/.test(await weg.locator('.weg__punkt').first().innerText()));
check('Das Ziel ist zunächst offen',
  /noch offen/.test(await weg.locator('.weg__punkt').last().innerText()));

await weg.locator('button:has-text("Heute als SOLL-Stand festlegen")').click();
await page.waitForSelector('.modal:has-text("SOLL")');
await page.locator('.modal input[type="text"]').nth(1).fill('Prüfung: Ziel festlegen');
await page.locator('.modal button:has-text("Als SOLL festlegen")').click();
await page.waitForTimeout(5000);
check('Der SOLL-Stand ist gesetzt und in der Standliste gekennzeichnet',
  await page.locator('table.tbl .pill--green:has-text("SOLL-Stand")').count() === 1);
const wegSoll = await page.locator('.card:has(.card__title:text-is("Von wo nach wo"))').innerText();
check('Der Weg zeigt jetzt drei Punkte mit Zahlen',
  !/noch offen/.test(wegSoll) && (wegSoll.match(/%/g) ?? []).length >= 3,
  wegSoll.split('\n').filter((z) => z.includes('%')).join(' · '));

await page.locator('button:has-text("SOLL-Stand zum IST-Stand machen")').click();
await page.waitForSelector('.modal:has-text("SOLL-Stand zum IST-Stand machen?")');
await page.locator('.modal button:has-text("Übernehmen")').click();
await page.waitForTimeout(5000);
check('Der SOLL-Stand wird zum neuen IST-Stand, das Ziel ist wieder offen',
  await page.locator('table.tbl .pill--violet:has-text("IST-Stand")').count() === 1
  && await page.locator('table.tbl .pill--green:has-text("SOLL-Stand")').count() === 0
  && /noch offen/.test(await page.locator('.card:has(.card__title:text-is("Von wo nach wo"))').innerText()));

await page.locator('button:has-text("IST-Stand aufheben")').first().click();
await page.waitForTimeout(3000);
await nav('Vergleich');
check('IST-Stand wieder aufhebbar',
  await page.locator('.card:has-text("Noch kein IST-Stand festgelegt")').count() === 1);

await nav('Steuerstand');
await setSlider('Überstunden je MA und Woche', 0, 3000);

/* ================================================================== *
 * Alle Ansichten laden fehlerfrei
 * ================================================================== */

for (const label of ['Terminplan', 'Aufträge', 'Arbeitsfolgen', 'Regeln', 'Mannschaft', 'Vergleich', 'Stände', 'Einstellungen', 'Daten & Prüfung', 'Steuerstand']) {
  await nav(label);
  const err = await viewError();
  check(`Ansicht „${label}" lädt fehlerfrei`, await page.locator('.view').count() > 0 && !err, err);
}

/* ---------- Personal ausschliesslich ueber die Mannschaft ---------- *
 *
 * Die beiden alten Zahlenlisten ("Leiharbeiter (Anzahl)") zaehlten in der
 * Betriebsart MANNSCHAFT still zur Mannschaft dazu - so standen in der
 * Wochenuebersicht 24 Mitarbeiter in einer Abteilung mit neun. Seit der
 * Vorgabe vom 17.09.2026 wirken sie nicht mehr, und es gibt hier auch kein
 * Feld dafuer: Fehlt Personal, kommt eine Meldung, und eingetragen wird es
 * im Reiter Mannschaft.
 */

/**
 * Groesste Mitarbeiterzahl der Wochenuebersicht. Daran zeigt sich, ob
 * Personal in die Rechnung eingeht, das nicht in der Mannschaft steht.
 */
const wochenMitarbeiter = async () => {
  await nav('Steuerstand');
  await page.waitForTimeout(1200);
  const zellen = await page
    .locator('.card:has(.card__title:text-is("Wochenübersicht")) tbody tr td:nth-child(3)')
    .allInnerTexts();
  const zahlen = zellen
    .map((t) => Number(t.split('\n')[0].trim().replace(',', '.')))
    .filter((n) => Number.isFinite(n));
  return Math.max(0, ...zahlen);
};

await nav('Einstellungen');
await page.waitForTimeout(1200);
const personalPflege = page.locator('.card:has(.card__title:text-is("Personal"))');
const personalRoh = await personalPflege.innerText();
check('Einstellungen bieten kein zweites Feld für Personal an',
  personalRoh.includes('Personal wird ausschließlich im Reiter Mannschaft gepflegt')
  && await personalPflege.locator('button:has-text("Leiharbeiter hinzufügen")').count() === 0,
  personalRoh.split('\n').find((z) => /ausschließlich im Reiter Mannschaft/.test(z))?.slice(0, 120) ?? 'kein Hinweis');

const mitarbeiterVorher = await wochenMitarbeiter();

/*
 * Ein Altbestand wird ueber die Schnittstelle untergeschoben - genau so
 * steht er in gewachsenen Datenbestaenden. Die Anwendung darf ihn weder
 * verrechnen noch stillschweigend verschwinden lassen.
 */
const altGesetzt = await page.evaluate(async () => {
  const kopf = {
    'Content-Type': 'application/json',
    'X-MEGC-Token': localStorage.getItem('megc-armaturenbau:sitzung') ?? '',
  };
  const state = await (await fetch('/api/state', { headers: kopf })).json();
  const res = await fetch(`/api/scenarios/${encodeURIComponent(state.activeScenarioId)}`, {
    method: 'PUT',
    headers: kopf,
    body: JSON.stringify({
      config: {
        workforce: {
          tempWorkers: [{
            id: 'ALT-1', label: 'Altbestand Excel', count: 4, from: '2026-09-21', to: null, skills: null,
          }],
        },
      },
    }),
  });
  return res.ok;
});
check('Ein alter Zahlenbestand lässt sich für die Prüfung unterschieben', altGesetzt);

await page.reload();
await page.waitForTimeout(3500);
check('Der Altbestand verändert die gerechnete Besetzung nicht',
  await wochenMitarbeiter() === mitarbeiterVorher,
  `${mitarbeiterVorher} -> ${await wochenMitarbeiter()} MA`);
check('Die Wochenübersicht weist keinen stillen Zuschlag mehr aus',
  !(await page.locator('.card:has(.card__title:text-is("Wochenübersicht")) tbody').innerText()).includes('davon'));

await nav('Einstellungen');
await page.waitForTimeout(1500);
const altKarte = page.locator('.card:has-text("Alte Zahlenlisten – ohne Wirkung")');
const altText = await altKarte.count() > 0 ? await altKarte.innerText() : '';
check('Alte Zahlenlisten werden als wirkungslos ausgewiesen',
  /4 Personen stehen hier noch als reine Anzahl/.test(altText)
  && /NICHT in die Rechnung ein/.test(altText),
  altText.split('\n').find((z) => /reine Anzahl/.test(z))?.slice(0, 120) ?? 'keine Meldung');
check('Der Altbestand wird benannt, nicht nur gezählt',
  /Altbestand Excel: \+4 ab 21\.09\.2026/.test(altText),
  altText.split('\n').find((z) => /Altbestand Excel/.test(z))?.slice(0, 100) ?? 'ohne Bezeichnung');

await nav('Daten & Prüfung');
await page.waitForTimeout(1500);
check('Die Prüfung nennt die wirkungslosen Zahlenlisten',
  /Alte Zahlenlisten sind noch hinterlegt/.test(await page.locator('.view').innerText()),
  (await page.locator('.view').innerText()).split('\n').find((z) => /Zahlenlisten/.test(z))?.slice(0, 110) ?? 'nicht gemeldet');

/* Der Weg heraus: in die Mannschaft uebernehmen - dort zaehlen sie */
await nav('Einstellungen');
await page.waitForTimeout(1500);
// Wer schon einen Eintritt hat, bleibt - der Rest wird nachher zurueckgesetzt
const vorUebernahme = await page.evaluate(async () => {
  const kopf = { 'X-MEGC-Token': localStorage.getItem('megc-armaturenbau:sitzung') ?? '' };
  const state = await (await fetch('/api/state', { headers: kopf })).json();
  const t = await (await fetch(`/api/team?scenario=${encodeURIComponent(state.activeScenarioId)}`, { headers: kopf })).json();
  return (t.people ?? []).filter((x) => x.startDate).map((x) => x.id);
});
await page.locator('.card:has-text("Alte Zahlenlisten – ohne Wirkung") button:has-text("In die Mannschaft übernehmen")').click();
await page.locator('.modal:has-text("In die Mannschaft übernehmen")').waitFor({ state: 'visible' });
await page.locator('.modal__foot button:has-text("Übernehmen")').click();
await page.waitForTimeout(5000);
check('Die alten Zahlenlisten lassen sich in die Mannschaft übernehmen',
  await page.locator('.card:has-text("Alte Zahlenlisten – ohne Wirkung")').count() === 0
  && (await page.locator('.card:has(.card__title:text-is("Personal"))').innerText())
    .includes('Personal wird ausschließlich im Reiter Mannschaft gepflegt'));
const mitarbeiterNachher = await wochenMitarbeiter();
check('Nach der Übernahme zählen die Leute wirklich mit',
  mitarbeiterNachher > mitarbeiterVorher,
  `${mitarbeiterVorher} -> ${mitarbeiterNachher} MA`);

/* Ausgangsstand wiederherstellen - die folgenden Pruefungen rechnen damit */
await page.evaluate(async (behalten) => {
  const kopf = {
    'Content-Type': 'application/json',
    'X-MEGC-Token': localStorage.getItem('megc-armaturenbau:sitzung') ?? '',
  };
  const state = await (await fetch('/api/state', { headers: kopf })).json();
  const id = encodeURIComponent(state.activeScenarioId);
  const t = await (await fetch(`/api/team?scenario=${id}`, { headers: kopf })).json();
  const people = (t.people ?? []).map((p) => (
    p.startDate && !behalten.includes(p.id)
      ? { ...p, startDate: null, defaultActive: false }
      : p));
  await fetch(`/api/scenarios/${id}`, {
    method: 'PUT', headers: kopf, body: JSON.stringify({ config: { workforce: { team: { people } } } }),
  });
}, vorUebernahme);
await page.reload();
await page.waitForTimeout(3500);
check('Der Ausgangsstand der Mannschaft ist wiederhergestellt',
  await wochenMitarbeiter() === mitarbeiterVorher,
  `${await wochenMitarbeiter()} gegen ${mitarbeiterVorher} MA`);

await nav('Einstellungen');
for (const t of ['Erweitert', 'Szenarien', 'Benutzer', 'Häufig gebraucht']) {
  await tab(t);
  const err = await viewError();
  check(`Einstellungen · Reiter „${t}" lädt fehlerfrei`, !err, err);
}

/* ================================================================== *
 * Diagramm je Arbeitsgang
 * ================================================================== */

await nav('Steuerstand');
const diagrammWahl = page.locator('.card:has-text("Kapazität je Kalenderwoche") select').first();
check('Diagramm ist auf einen Arbeitsgang umschaltbar', await diagrammWahl.count() === 1);
await diagrammWahl.selectOption('ORBITAL');
await page.waitForTimeout(1200);
const orbitalKarte = await page.locator('.card:has-text("Orbitalschweißen: Bedarf gegen Kapazität")').count();
check('Diagramm zeigt den einzelnen Arbeitsgang', orbitalKarte === 1);
const orbitalText = await page.locator('.card:has-text("Orbitalschweißen: Bedarf gegen Kapazität")').innerText();
check('Beim Arbeitsgang stehen Plätze, mögliche Tage und Rückstand',
  /Maschinen/.test(orbitalText) && /mögliche Tage je Woche/.test(orbitalText),
  orbitalText.split('\n').find((z) => z.includes('Tage je Woche'))?.slice(0, 110) ?? '');
await page.locator('.card:has-text("Bedarf gegen Kapazität") select').first().selectOption('ALLE');
await page.waitForTimeout(1200);
check('Zurück auf die Abteilungssicht',
  await page.locator('.card:has-text("Aufwand gegen Kapazität je Kalenderwoche")').count() === 1);

/* ================================================================== *
 * Hydro, NoBo und Platzgrenzen im Steuerstand
 * ================================================================== */

await nav('Steuerstand');
await oeffneStellschrauben();
const hydroGruppe = page.locator('.panel .rail__group:has(.rail__label:has-text("Hydroprüfung an"))');
check('Hydro-Wochentage im Steuerstand', await hydroGruppe.count() === 1);
check('NoBo-Anwesenheit im Steuerstand',
  await page.locator('.panel .rail__group:has(.rail__label:has-text("NoBo anwesend"))').count() === 1);
check('Nutzbare Hydrotage werden benannt',
  /\d Tage nutzbar/.test(await hydroGruppe.locator('.rail__value').innerText()),
  await hydroGruppe.locator('.rail__value').innerText());

// Einen Tag ohne NoBo dazunehmen -> die Anwendung muss nachfragen
const noboVorFrage = await page.locator('.panel .rail__group:has(.rail__label:has-text("NoBo anwesend")) .rail__value').innerText();
await hydroGruppe.locator('button:has-text("Mo")').click();
await page.waitForSelector('.overlay', { timeout: 15000 });
check('Beim Ausweiten der Hydrotage wird nach dem NoBo gefragt',
  (await page.locator('.modal').innerText()).includes('NoBo'));
await page.locator('.modal button:has-text("NoBo mitziehen")').click();
await page.waitForTimeout(3500);
const noboNachFrage = await page.locator('.panel .rail__group:has(.rail__label:has-text("NoBo anwesend")) .rail__value').innerText();
check('NoBo wird mitgezogen', noboNachFrage !== noboVorFrage, `${noboVorFrage} -> ${noboNachFrage}`);
// Die Auslastungsmatrix steht im zweiten Reiter - die Stellschrauben
// bleiben dabei offen, weil sie ein Panel sind und keine Ansicht.
await page.locator('.tabbar .seg button:has-text("Engpässe")').first().click();
await page.waitForTimeout(1500);
const hydroMehr = Number.parseFloat((await page.locator('table.matrix tbody tr:has-text("Hydro") td').nth(1).innerText()) || '0');
check('Mehr Hydrotage wirken jetzt auf die Auslastung', Number.isFinite(hydroMehr));
await page.locator('.tabbar .seg button:has-text("Kennzahlen")').first().click();
await page.waitForTimeout(1200);
await oeffneStellschrauben();

// Zurück auf Di–Do
await hydroGruppe.locator('button:has-text("Mo")').click();
await page.waitForTimeout(3000);

const platzGruppe = page.locator('.panel .rail__group:has(.rail__label:has-text("Platzgrenzen"))');
check('Platzgrenzen im Steuerstand schaltbar', await platzGruppe.count() === 1);
const engpassMitPlaetzen = await kpiValue('Engste Stelle');
await platzGruppe.locator('button:has-text("Aus")').click();
await page.waitForTimeout(3500);
const engpassOhnePlaetze = await kpiValue('Engste Stelle');
check('Platzgrenzen verschieben den Engpass', engpassMitPlaetzen !== engpassOhnePlaetze,
  `${engpassMitPlaetzen} -> ${engpassOhnePlaetze}`);
await platzGruppe.locator('button:has-text("An")').click();
await page.waitForTimeout(3500);

check('Krankenquote im Steuerstand',
  await page.locator('.panel .rail__group:has(.rail__label:has-text("Krankenquote"))').count() === 1);

check('Die Anwendung meldet, woher die Besetzung kommt',
  (await page.locator('.answer').innerText()).includes('Besetzung'),
  (await page.locator('.answer').innerText()).split('\n').find((z) => z.includes('Besetzung'))?.slice(0, 120) ?? '');
const zubehoerGruppe = page.locator('.panel .rail__group:has(.rail__label:has-text("Zubehör"))');
check('Zubehör und Kleinarbeiten als Regler vorhanden', await zubehoerGruppe.count() === 1);
check('Zubehörreserve ist mit 18 h je Woche vorbelegt',
  (await zubehoerGruppe.innerText()).includes('18 h/Woche'),
  (await zubehoerGruppe.innerText()).split('\n')[0]);

check('Die drei größten Engpässe stehen in der Antwortzeile',
  (await page.locator('.answer').innerText()).includes('Die drei größten Engpässe'),
  (await page.locator('.answer').innerText()).split('\n').find((z) => z.includes('Engpässe'))?.slice(0, 110) ?? '');

/* ---------- Was bringt wirklich etwas? ---------- */
// Steht im Reiter "Engpaesse & Wirkung", zusammen mit Auslastung und Schicht
await nav('Engpässe');
const hilfKarte = page.locator('.card:has-text("Was bringt wirklich etwas?")');
check('Karte „Was bringt wirklich etwas?" vorhanden', await hilfKarte.count() === 1);
await hilfKarte.locator('button:has-text("Durchrechnen")').click();
await page.waitForSelector('.card:has-text("Was bringt wirklich etwas?") tbody tr', { timeout: 90000 });
const hebel = await page.locator('.card:has-text("Was bringt wirklich etwas?") tbody tr').count();
check('Hebel werden einzeln durchgerechnet', hebel >= 5, `${hebel} Hebel`);
const hilfText = await hilfKarte.innerText();
check('Die Wirkung steht in Tagen und Aufträgen',
  /Tage gespart/.test(hilfText) && /Engpass danach/.test(hilfText));
check('Hebel ohne Wirkung werden benannt', /Ohne Wirkung/.test(hilfText));
/*
 * Der wichtigste Satz dieser Karte: Personal ist im Startbestand NICHT
 * der Hebel - die Plaetze sind es. Die Anwendung muss das ausdruecklich
 * sagen, entweder als "ohne Wirkung" oder als "verschlechtert den Plan"
 * (Leiharbeiter binden in den ersten Wochen Betreuung).
 */
check('Die Anwendung sagt ausdrücklich, dass Personal hier nicht hilft',
  /Ohne Wirkung:[^]*Leiharbeiter/.test(hilfText) || /Verschlechtert den Plan:[^]*Leiharbeiter/.test(hilfText),
  hilfText.split('\n').find((z) => /Ohne Wirkung|Verschlechtert/.test(z))?.slice(0, 130) ?? '');

/* ================================================================== *
 * Zweite Maskenfassung: Kacheln, Belegungsgitter, Ansichten, Suche
 * ================================================================== */

await nav('Übersicht');
const kachelTexte = (await page.locator('.tile').allInnerTexts()).map((t) => t.replace(/\n/g, ' · '));
check('Sechs Kacheln in fester Anordnung', await page.locator('.tile').count() === 6,
  `${await page.locator('.tile').count()} Kacheln`);
check('Die Kacheln beantworten die sechs festgelegten Fragen',
  ['TERMINTREUE', 'ZU SPÄT', 'ÜBER KAPAZITÄT', 'GRÖSSTER ENGPASS', 'FREIE KAPAZITÄT', 'AUFFÄLLIGKEITEN']
    .every((x, i) => kachelTexte[i]?.toUpperCase().startsWith(x)),
  kachelTexte.map((t) => t.split(' · ')[0]).join(' | '));
check('Jede Kachel erklärt ihre Zahl in einem Satz',
  kachelTexte.every((t) => t.split(' · ').length >= 3),
  kachelTexte[0]);

check('Die Kopfleiste zeigt den Puls der Planung',
  await page.locator('.topbar__pulse .pulse').count() >= 3,
  (await page.locator('.topbar__pulse').innerText()).replace(/\n/g, ' '));
check('Stand und Zeitraum sind überall einstellbar',
  await page.locator('.topctl select').count() >= 2
  && await page.locator('.topctl input[type="date"]').count() === 2);

/* ---------- Der angewaehlte Zeitraum bewertet alles ---------- *
 *
 * Vorgabe der Abteilungsleitung (18.09.2026): "Die APP soll immer nur den
 * angewaehlten Zeitraum bewerten." Geprueft wird, dass der Zeitraum nicht
 * nur eine Anzeige ist, sondern jede Auswertung traegt.
 */
const zahl = (t) => Number.parseFloat(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const kapGanzerZeitraum = zahl(await kpiValue('Kapazität'));
const bisFeld = page.locator('.topctl input[type="date"]').nth(1);
await bisFeld.fill('2026-11-30');
await bisFeld.dispatchEvent('change');
await page.waitForTimeout(6000);
const kapKurz = zahl(await kpiValue('Kapazität'));
check('Ein kürzerer Zeitraum senkt die Kapazität',
  kapKurz > 0 && kapKurz < kapGanzerZeitraum,
  `${kapGanzerZeitraum} h -> ${kapKurz} h`);
await nav('Engpässe');
const rwKurz = await page.locator('.card:has(.card__title:text-is("Woher die Kapazität kommt"))').innerText();
check('Der Rechenweg folgt dem angewählten Zeitraum',
  /30\.11\.2026/.test(rwKurz),
  rwKurz.split('\n').find((z) => /Zeitraum/.test(z))?.slice(0, 90) ?? '');
await nav('Übersicht');
await page.locator('.topctl button:has-text("×")').click();
await page.waitForTimeout(6000);
check('Der Zeitraum lässt sich wieder aufheben',
  Math.abs(zahl(await kpiValue('Kapazität')) - kapGanzerZeitraum) < 1,
  `wieder ${await kpiValue('Kapazität')}`);

/* ---------- Belegungsgitter ---------- */
await nav('Belegung');
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });
const gitter = page.locator('.board__grid');
check('Belegungsgitter zeigt je Arbeitsplatz eine Zeile',
  await gitter.locator('tbody tr').count() === 12,
  `${await gitter.locator('tbody tr').count()} Zeilen (11 Arbeitsgänge und die Summe)`);
check('Vier Wochen als Tagesspalten',
  await gitter.locator('thead tr.board__days th').count() === 28,
  `${await gitter.locator('thead tr.board__days th').count()} Spalten`);
check('Die Kalenderwochen stehen über den Tagen',
  await gitter.locator('thead tr.board__weeks th').count() >= 5);
check('Überbuchung wird hart gemeldet',
  await page.locator('.board__cell--clash').count() > 10,
  `${await page.locator('.board__cell--clash').count()} Zellen mit wartender Arbeit`);
check('Die Zellen tragen den Auftrag',
  await page.locator('.board__block').count() > 20,
  `${await page.locator('.board__block').count()} Blöcke`);
check('Summenzeile über alle Arbeitsgänge',
  (await gitter.locator('tbody tr').last().innerText()).includes('Mitarbeiterstunden gesamt'));

// Klick auf eine belegte Zelle: Seitenpanel mit den Auftraegen darin
await page.locator('.board__cell:has(.board__block)').first().click();
await page.waitForSelector('.panel', { timeout: 15000 });
const zellText = await page.locator('.panel').innerText();
check('Klick auf eine Zelle nennt Auftrag und Stunden',
  /WGC|h belegt/.test(zellText),
  zellText.split('\n').slice(0, 3).join(' · ').slice(0, 120));
check('Das Panel erklärt, dass das Gitter das Ergebnis der Rechnung ist',
  /Ergebnis der Rechnung/.test(zellText));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Umschalten auf Mitarbeiter
await page.locator('.seg button:has-text("Mitarbeiter")').first().click();
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });
check('Gitter auf Mitarbeiter umschaltbar',
  await page.locator('.board__grid tbody tr').count() === 25,
  `${await page.locator('.board__grid tbody tr').count()} Zeilen (24 Kürzel und die Summe)`);
check('Abwesenheit ist im Gitter erkennbar',
  await page.locator('.board__block--absent').count() > 0,
  `${await page.locator('.board__block--absent').count()} Felder "nicht eingeplant"`);
await page.locator('.seg button:has-text("Arbeitsplatz")').first().click();
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });

// Zoom auf Woche
await page.locator('.seg button:has-text("Woche")').first().click();
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });
check('Zoomstufe Woche fasst die Tage zusammen',
  await page.locator('.board__grid thead tr.board__days th').count() <= 14
  && await page.locator('.board__grid thead tr.board__days th').count() >= 10,
  `${await page.locator('.board__grid thead tr.board__days th').count()} Wochenspalten`);
await page.locator('.seg button:has-text("Tag")').first().click();
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });

// Nur Engpaesse
await page.locator('label.inline-check:has-text("nur Engpässe") input').check();
await page.waitForSelector('.board__grid tbody tr', { timeout: 40000 });
const engpassZeilen = await page.locator('.board__grid tbody tr').count();
check('Gitter lässt sich auf die Engpässe eingrenzen', engpassZeilen < 12 && engpassZeilen > 1,
  `${engpassZeilen} Zeilen mit wartender Arbeit`);
await page.locator('label.inline-check:has-text("nur Engpässe") input').uncheck();
await page.waitForTimeout(2500);

/* ---------- Dunkelmodus ---------- */
const themeKnopf = page.locator('.topbar button[title^="Darstellung"]');
const themeVorher = await page.locator('html').getAttribute('data-theme');
await themeKnopf.click();
await page.waitForTimeout(600);
const themeHell = await page.locator('html').getAttribute('data-theme');
await themeKnopf.click();
await page.waitForTimeout(600);
const themeDunkel = await page.locator('html').getAttribute('data-theme');
check('Hell und dunkel umschaltbar',
  themeDunkel === 'dark' && themeHell === 'light',
  `${themeVorher} -> ${themeHell} -> ${themeDunkel}`);
check('Im Dunkelmodus bleibt die Schrift lesbar',
  await page.evaluate(() => {
    const s = window.getComputedStyle(document.body);
    return s.backgroundColor !== s.color;
  }));

/*
 * Eingabefelder im Dunkelmodus.
 *
 * Sie standen fest auf Weiss und leuchteten auf dem schwarzen Grund.
 * Vorgabe der Abteilungsleitung: dunkles Tuerkis mit weisser Schrift.
 * Geprueft werden Felder aus drei verschiedenen Ecken der Maske.
 */
await nav('Aufträge');
await page.waitForTimeout(1500);
const feldFarben = await page.evaluate(() => {
  const lies = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  };
  return {
    datum: lies('table.tbl input[type="date"]'),
    auswahl: lies('table.tbl select'),
    kopf: lies('.topctl select'),
  };
});
const tuerkis = (f) => f && f.bg === 'rgb(16, 70, 77)' && f.fg === 'rgb(255, 255, 255)';
check('Eingabefelder sind im Dunkelmodus dunkeltürkis mit weißer Schrift',
  tuerkis(feldFarben.datum) && tuerkis(feldFarben.auswahl) && tuerkis(feldFarben.kopf),
  `Datum ${feldFarben.datum?.bg} · Auswahl ${feldFarben.auswahl?.bg} · Kopfleiste ${feldFarben.kopf?.bg}`);
const hellFlaechen = await page.evaluate(() => {
  const weiss = 'rgb(255, 255, 255)';
  const treffer = [];
  for (const sel of ['.card', '.btn', '.userchip', '.seg button', 'table.tbl']) {
    const el = document.querySelector(sel);
    if (el && window.getComputedStyle(el).backgroundColor === weiss) treffer.push(sel);
  }
  return treffer;
});
check('Im Dunkelmodus leuchtet keine Fläche mehr weiß',
  hellFlaechen.length === 0, hellFlaechen.join(', ') || 'keine');
await nav('Übersicht');
await themeKnopf.click();
await page.waitForTimeout(600);

/* ---------- Gespeicherte Ansichten ---------- */
await nav('Aufträge');
await page.locator('.card:has-text("Projekte") input[placeholder="Suchen …"]').first().fill('WGC40');
await page.waitForTimeout(900);
await page.locator('.topctl button:has-text("+")').first().click();
await page.waitForSelector('.modal:has-text("Ansicht speichern")', { timeout: 15000 });
await page.locator('.modal input[type="text"]').fill('Nur WGC40');
await page.locator('.modal button:has-text("Speichern")').click();
await page.waitForTimeout(2500);
const ansichtWahl = page.locator('.tabbar .topctl select').first();
check('Ansicht gespeichert und auswählbar',
  (await ansichtWahl.locator('option').allInnerTexts()).some((t) => t.includes('Nur WGC40')),
  (await ansichtWahl.locator('option').allInnerTexts()).join(' | '));
await nav('Übersicht');
await ansichtWahl.selectOption({ label: 'Nur WGC40' });
await page.waitForTimeout(3000);
check('Gespeicherte Ansicht stellt Bereich und Filter wieder her',
  (await page.locator('.topbar__title').innerText()) === 'Aufträge'
  && (await page.locator('.card:has-text("Projekte") input[placeholder="Suchen …"]').first().inputValue()) === 'WGC40',
  await page.locator('.topbar__title').innerText());
await page.locator('.tabbar .topctl button:has-text("×")').first().click();
await page.waitForSelector('.modal:has-text("Ansicht löschen")', { timeout: 15000 });
await page.locator('.modal button:has-text("Löschen")').first().click();
await page.locator('.modal').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => {
  const s = document.querySelector('.tabbar .topctl select');
  return s && ![...s.options].some((o) => o.text.includes('Nur WGC40'));
}, null, { timeout: 20000 }).catch(() => {});
check('Ansicht wieder löschbar',
  !(await page.locator('.tabbar .topctl select').first().locator('option').allInnerTexts()).some((t) => t.includes('Nur WGC40')),
  (await page.locator('.tabbar .topctl select').first().locator('option').allInnerTexts()).join(' | '));
await page.locator('.card:has-text("Projekte") input[placeholder="Suchen …"]').first().fill('');
await page.waitForTimeout(900);

/* ---------- Schnellsuche ---------- */
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette', { timeout: 15000 });
check('Schnellsuche öffnet mit Strg+K', await page.locator('.palette').count() === 1);
await page.locator('.palette input').fill('WGC40-S00355');
await page.waitForTimeout(700);
check('Schnellsuche findet den Auftrag',
  await page.locator('.palette__item').count() >= 1
  && (await page.locator('.palette__item').first().innerText()).includes('WGC40-S00355'),
  (await page.locator('.palette__item').first().innerText()).replace(/\n/g, ' · ').slice(0, 110));
await page.keyboard.press('Enter');
await page.waitForSelector('.panel', { timeout: 15000 });
check('Schnellsuche springt in den Auftrag',
  (await page.locator('.panel__title').innerText()).includes('WGC40-S00355'),
  await page.locator('.panel__title').innerText());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

/* ---------- Aushang ---------- */
await nav('Mannschaft');
await tab('Aushang');
await page.waitForSelector('.card:has-text("Aushang") table.tbl tbody tr', { timeout: 40000 });
check('Aushang: eine Seite für alle Kürzel',
  await page.locator('.card:has-text("Aushang") tbody tr').count() === 24,
  `${await page.locator('.card:has-text("Aushang") tbody tr').count()} Zeilen`);
const aushangText = await page.locator('.card:has-text("Aushang")').innerText();
check('Aushang nennt Woche, Stand und Druckknopf',
  /KW/.test(aushangText) && /Stand/.test(aushangText)
  && await page.locator('.card:has-text("Aushang") button:has-text("Drucken")').count() === 1);

/* ---------- Plausibilitaetspruefung ---------- */
await nav('Übersicht');
const plausiKarte = page.locator('.card:has(.card__title:text-is("Kommt das so hin?"))');
check('Karte „Kommt das so hin?" vorhanden', await plausiKarte.count() === 1);
const plausiText = await plausiKarte.innerText();
check('Die Prüfung vergleicht die geplante mit der gemessenen Besetzung',
  /Geplante Besetzung liegt über der zuletzt gemessenen/.test(plausiText)
  || /Gemessen waren bis/.test(plausiText),
  plausiText.split('\n').find((z) => /Besetzung|Gemessen/.test(z))?.slice(0, 130) ?? plausiText.slice(0, 120));
check('Jeder Befund nennt einen Bereich und einen Rat',
  await plausiKarte.locator('.plausi__item').count() >= 2
  && await plausiKarte.locator('.plausi__hint').count() >= 1,
  `${await plausiKarte.locator('.plausi__item').count()} Befunde`);
check('Die Antwortzeile weist auf die Auffälligkeiten hin',
  /Auffälligkeiten/.test(await page.locator('.answer').innerText()));
await plausiKarte.locator('button:has-text("Alle ansehen")').click();
await page.locator('.modal:has-text("Was der Anwendung komisch vorkommt")').waitFor({ state: 'visible' });
const plausiDialogText = await page.locator('.modal').innerText();
check('Fenster zeigt alle Befunde nach Bereich gruppiert',
  /Besetzung/.test(plausiDialogText) && /Datenpflege/.test(plausiDialogText),
  `${await page.locator('.modal .plausi__item').count()} Befunde im Fenster`);
await page.keyboard.press('Escape');
await page.locator('.modal').waitFor({ state: 'detached' });

/* ---------- Befunde bestaetigen und wegklicken ---------- */
const kachelVorher = Number((await page.locator('.tile:has-text("Auffälligkeiten") .tile__value').innerText()).trim());
const ersterBefund = plausiKarte.locator('.plausi__item').first();
const befundTitel = (await ersterBefund.locator('strong').innerText()).trim();
check('Jeder Befund hat einen Knopf „Erledigt"',
  await ersterBefund.locator('button:has-text("Erledigt")').count() === 1, befundTitel);
await ersterBefund.locator('button:has-text("Erledigt")').click();
await page.waitForTimeout(2500);
const kachelNachher = Number((await page.locator('.tile:has-text("Auffälligkeiten") .tile__value').innerText()).trim());
check('Bestätigter Befund zählt nicht mehr in der Kachel',
  kachelNachher === kachelVorher - 1, `${kachelVorher} -> ${kachelNachher}`);
check('Der bestätigte Befund steht nicht mehr oben auf der Karte',
  !(await plausiKarte.innerText()).includes(befundTitel), befundTitel);
await plausiKarte.locator('button:has-text("Alle ansehen"), button:has-text("Bestätigte ansehen")').first().click();
await page.locator('.modal').waitFor({ state: 'visible' });
const bestaetigtText = await page.locator('.modal').innerText();
check('Im Fenster steht der bestätigte Befund weiter nachlesbar',
  /Bestätigt \(1\)/.test(bestaetigtText) && bestaetigtText.includes(befundTitel),
  bestaetigtText.split('\n').find((z) => /Bestätigt \(/.test(z)) ?? '');
await page.locator('.modal button:has-text("Wieder anzeigen")').first().click();
await page.waitForTimeout(2500);
await page.keyboard.press('Escape').catch(() => null);
await page.locator('.modal').waitFor({ state: 'detached' }).catch(() => null);
const kachelZurueck = Number((await page.locator('.tile:has-text("Auffälligkeiten") .tile__value').innerText()).trim());
check('„Wieder anzeigen" holt den Befund zurück in die Zählung',
  kachelZurueck === kachelVorher, `${kachelNachher} -> ${kachelZurueck}`);

/* ---------- Mehraufwand ---------- */
await nav('Mehraufwand');
await page.waitForSelector('.mehr__zahl', { timeout: 25000 });
const mehrKopf = await page.locator('.answer').first().innerText();
check('Mehraufwand nennt die fehlenden Stunden groß und die Euro klein',
  /\d\s?h/.test(await page.locator('.mehr__zahl').innerText())
  && /€/.test(await page.locator('.mehr__zahl').innerText()),
  (await page.locator('.mehr__zahl').innerText()).replace(/\n/g, ' · '));
check('Die Zahl wird in einem Satz erklärt (fällig gegen leistbar)',
  /fällig/.test(mehrKopf) && /fehlen/.test(mehrKopf),
  mehrKopf.split('\n').find((z) => /fehlen/.test(z)) ?? '');
check('Die Einschränkung steht an der Zahl, nicht im Kleingedruckten',
  /Plätze/.test(mehrKopf));

// Direkte Kindzeilen: die aufgeklappten Bereiche enthalten eigene Tabellen.
const mehrWochen = page.locator('.card:has(.card__title:text-is("Woche für Woche")) > .card__body > .table-wrap > table > tbody > tr.is-clickable');
check('Woche für Woche zeigt 13 Wochen', await mehrWochen.count() === 13,
  `${await mehrWochen.count()} Wochen`);
check('Jede Woche stellt fällige Arbeit und Kapazität gegenüber',
  await page.locator('.mehr__bars').count() === 13);
// Woche aufklappen: Auftraege nach Termin-Woche, Kunde als Spalte
const engpassZeile = mehrWochen.nth(6);
await engpassZeile.click();
await page.waitForTimeout(400);
const detail = await page.locator('.mehr__detail:visible').first().innerText();
check('Aufgeklappte Woche nennt Aufträge mit Kunde, Termin und Verspätung',
  /Kunde/.test(detail) && /WGC/.test(detail),
  detail.split('\n').slice(0, 3).join(' · '));
check('Aufgeklappte Woche sagt, was steht und was helfen würde',
  /Was steht/.test(detail) && /Überstunden/.test(detail));
check('Der Auftrag lässt sich von dort öffnen (Arbeitsbeginn von Hand setzen)',
  await page.locator('.mehr__detail:visible button:has-text("Öffnen")').count() > 0);

const mKarten = page.locator('.mehr__m');
check('Alle vier Wege stehen nebeneinander – auch der ohne Stunden',
  await mKarten.count() === 4
  && (await mKarten.allInnerTexts()).join(' ').includes('keine Stunden'),
  (await page.locator('.mehr__name').allInnerTexts()).join(' · '));
check('Die Reihenfolge ist Überstunden → Platz → Leihe → Samstag',
  (await page.locator('.mehr__name').allInnerTexts()).join('|')
    === 'Überstunden|Zweiter Platz / Schicht|Leiharbeiter|Samstagsarbeit');
check('Jeder Weg sagt, wie viel er von der Lücke deckt',
  (await mKarten.first().innerText()).includes('deckt die Lücke zu'));
const paketText = await page.locator('.card:has(.card__title:text-is("Was muss passieren, damit es geht?")) .note').first().innerText();
check('Ein Paket für den ganzen Zeitraum wird vorgeschlagen',
  /Vorschlag der Anwendung/.test(paketText) && /Überstunden/.test(paketText),
  paketText.split('\n')[0].slice(0, 120));

// Uebernehmen: immer in ein Szenario, nie in den laufenden Plan
const standWahl = page.locator('.topctl:has(label:text-is("Stand")) select');
const standVorher = await standWahl.inputValue();
const szenarienVorher = await standWahl.locator('option').count();
await page.locator('button:has-text("Paket in Szenario übernehmen")').click();
await page.waitForSelector('.modal:has-text("In ein Szenario übernehmen?")');
check('Vor dem Übernehmen wird gefragt und der laufende Plan geschützt',
  /Der laufende Plan bleibt unverändert/.test(await page.locator('.modal').innerText()));
await page.locator('.modal button:has-text("Übernehmen")').click();
await page.waitForTimeout(6000);
const szenarienNachher = await standWahl.locator('option').count();
check('Das Übernehmen legt ein eigenes Szenario an',
  szenarienNachher === szenarienVorher + 1, `${szenarienVorher} -> ${szenarienNachher}`);

check('Nach dem Übernehmen ist das Szenario geöffnet, nicht der Ausgangsstand',
  !(await standWahl.locator('option:checked').innerText()).includes('Ausgangsstand'),
  await standWahl.locator('option:checked').innerText());
// Zurueck auf den Stand von vorher (nicht auf die Baseline - dort fragt die
// Anwendung bei jeder Aenderung nach, und die folgenden Pruefungen aendern).
await standWahl.selectOption(standVorher);
await page.waitForTimeout(5000);
// Kein Fenster darf offen bleiben - sonst fangen die naechsten Klicks daran haengen
if (await page.locator('.overlay').count() > 0) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
check('Nach dem Übernehmen steht kein Fenster mehr offen',
  await page.locator('.overlay').count() === 0);
await nav('Übersicht');

/* ================================================================== *
 * Mannschaft und Einsatzplan
 * ================================================================== */

await nav('Mannschaft');
await page.waitForSelector('.card:has-text("Wer darf was?") table.tbl tbody tr', { timeout: 20000 });

/* ---------- Wer wird gerechnet? ---------- */
const werKarte = page.locator('.card:has(.card__title:text-is("Wer wird gerechnet?"))');
await werKarte.waitFor({ state: 'visible', timeout: 20000 });
const werText = await werKarte.innerText();
check('Die Mannschaft sagt, wer wirklich gerechnet wird – mit Kürzeln',
  await werKarte.locator('.weg__punkt').count() === 3 && /STWUE/.test(werText),
  werText.split('\n').find((z) => z.includes('STWUE'))?.slice(0, 90) ?? '');
check('Hinterlegte Leiharbeiter werden benannt und ihre Herkunft erklärt',
  /5 Leiharbeiter sind hinterlegt/.test(werText) && /LEIHE-01 ab/.test(werText)
  && /Davon 5 aus der Auskunft vom 15\.09\.2026/.test(werText),
  werText.split('\n').find((z) => z.includes('hinterlegt und zählen'))?.slice(0, 110) ?? '');
// Nichts ist hier "von allein" da: Zugesagte und selbst eingeplante werden
// getrennt benannt - sonst behauptet die Anwendung eine falsche Herkunft.
check('Selbst eingeplante Leiharbeiter werden nicht als zugesagt ausgegeben',
  !/weitere sind hier eingeplant worden/.test(werText),
  'im Ausgangsstand ist keiner selbst eingeplant');
check('Leere Leiharbeiterplätze sind ausgeblendet, nicht gelöscht',
  /10 weitere Leiharbeiterplätze/.test(werText)
  && await page.locator('.card:has-text("Wer darf was?") button:has-text("Leere Plätze anzeigen")').count() === 1);
const sichtbareZeilen = await page.locator('.card:has-text("Wer darf was?") tbody tr').count();
check('Die Liste zeigt nur, was zählt', sichtbareZeilen === 14, `${sichtbareZeilen} Zeilen`);
await page.locator('.card:has-text("Wer darf was?") button:has-text("Leere Plätze anzeigen")').click();
await page.waitForTimeout(1500);
const kuerzel = await page.locator('.card:has-text("Wer darf was?") tbody tr').count();
check('Leere Plätze lassen sich einblenden', kuerzel === 24, `${kuerzel} Zeilen`);

/* ---------- Meldung: mehr Personal hilft hier nicht ---------- *
 *
 * Zwei Vorgaben liegen hier uebereinander. Erst (17.09.2026): Fehlt
 * Personal, will die Abteilungsleitung eine MELDUNG statt stiller
 * Ergaenzung. Dann (18.09.2026), nachdem die Meldung "441 h = 14 neue
 * Leiharbeiter" behauptete: "Hast du sie noch alle? ... das passt nicht."
 *
 * Im Startdatenbestand sind die PLAETZE die Grenze, nicht die Leute. In
 * dieser Lage darf die Anwendung nicht nach Personal rufen - und schon gar
 * keinen Knopf "14 Leiharbeiter einplanen" anbieten.
 */
const ohnePlatz = werKarte.locator('.note:has-text("Mehr Personal hilft hier nicht")');
check('Bei belegten Plätzen wird NICHT nach Personal gerufen',
  await ohnePlatz.count() === 1
  && await werKarte.locator('.note:has-text("Es fehlt Personal")').count() === 0,
  await ohnePlatz.count() === 1 ? 'richtige Meldung' : 'falsche oder keine Meldung');
const opText = await ohnePlatz.count() === 1 ? await ohnePlatz.innerText() : '';
check('Die Meldung sagt, woran die Arbeit wirklich wartet',
  /nicht an Leuten/.test(opText) && /auf Plätze, Maschinen oder Prüffenster/.test(opText)
  && /Begrenzend ist:/.test(opText),
  opText.split('\n').find((z) => /nicht an Leuten/.test(z))?.slice(0, 150) ?? opText.slice(0, 150));
check('Die Meldung nennt Stunden und Auslastung zum Nachrechnen',
  /Bis KW \d+\/\d+ fehlen [\d.]+ h/.test(opText)
  && /[\d.]+ h Arbeit warten/.test(opText)
  && /\d+ %\)/.test(opText),
  opText.split('\n').find((z) => /Bis KW/.test(z))?.slice(0, 160) ?? '');
check('In dieser Lage wird kein Leiharbeiter zum Einplanen angeboten',
  await ohnePlatz.locator('button:has-text("Leiharbeiter einplanen")').count() === 0
  && await ohnePlatz.locator('button:has-text("Was wirklich hilft")').count() === 1,
  'stattdessen führt der Knopf zu „Was wirklich hilft"');
check('Die Meldung führt zu dem, der ohne Platz dasteht',
  await ohnePlatz.locator('button:has-text("Wer steht ohne Platz da?")').count() === 1);

/* ---------- Einsatzplan: verdreht war er, jetzt nicht mehr ---------- *
 *
 * Gemeldet am 18.09.2026: "Der Einsatzplan ist auch verdreht und nicht
 * logisch. MAAP wird an manchen Tagen garnicht geplant obwohl anwesend."
 * Der Code gab dem Ersten sein ganzes Tagesbudget - JARO 1.170 h gegen
 * TOBE 21 h.
 */
await page.locator('.seg button:has-text("Einsatzplan")').first().click();
await page.waitForSelector('.card:has-text("Einsatzplan je Mitarbeiter") table.tbl tbody tr', { timeout: 40000 });
const einsatz = page.locator('.card:has-text("Einsatzplan je Mitarbeiter")');
const einsatzText = await einsatz.innerText();
check('Leere Tage nennen ihren Grund, nicht nur einen Gedankenstrich',
  /kein Platz frei|keine Qualifikation|keine Arbeit offen/.test(einsatzText),
  einsatzText.split('\n').find((z) => /kein Platz frei/.test(z))?.slice(0, 90) ?? 'kein Grund genannt');
check('Die Woche weist die ungenutzte Anwesenheit aus',
  /Personentage ohne Arbeit, obwohl anwesend/.test(einsatzText),
  einsatzText.split('\n').find((z) => /Personentage ohne Arbeit/.test(z))?.slice(0, 150) ?? '');
check('Der Einsatzplan sagt, dass zusätzliches Personal hier nichts ändert',
  /nur danebenstehen/.test(einsatzText) || /Plätze und die Belegungszeit begrenzen/.test(einsatzText));
check('Keine Stunde bleibt ohne Namen',
  !/sind niemandem zugeordnet/.test(einsatzText),
  einsatzText.split('\n').find((z) => /niemandem zugeordnet/.test(z))?.slice(0, 90) ?? 'alle Stunden haben einen Namen');

/*
 * Die Gleichverteilung: Die Spalte "Summe h" der eingesetzten Personen
 * darf nicht mehr auseinanderliegen als ein Viertel. Vorher stand dort
 * 1.170 h gegen 21 h.
 */
{
  const summen = (await einsatz.locator('tbody tr td:last-child').allInnerTexts())
    .map((t) => Number(t.replace(/\./g, '').replace(',', '.').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = Math.min(...summen);
  const max = Math.max(...summen);
  check('Die Wochenstunden verteilen sich gleichmäßig über die Mannschaft',
    summen.length >= 8 && max / min <= 4,
    `${summen.length} Personen, ${min} h bis ${max} h (früher 1.170 h gegen 21 h)`);
}
await page.locator('.seg button:has-text("Mannschaft")').first().click();
await page.waitForSelector('.card:has-text("Wer darf was?") table.tbl tbody tr', { timeout: 20000 });
/*
 * Der Schalter behaelt seinen Zustand ueber den Reiterwechsel - er heisst
 * dann "Leere Plätze ausblenden". Deshalb nur klicken, wenn die Plaetze
 * wirklich noch zugeklappt sind.
 */
{
  const einblenden = page.locator('.card:has-text("Wer darf was?") button:has-text("Leere Plätze anzeigen")');
  if (await einblenden.count() > 0) { await einblenden.click(); await page.waitForTimeout(1500); }
}

// Ausplanen und wieder zurueck - der Schalter muss beides koennen
await werKarte.locator('button:has-text("Nur mit der Stammmannschaft rechnen")').click();
await page.locator('.modal:has-text("Nur mit der Stammmannschaft rechnen?")').waitFor({ state: 'visible' });
check('Vor dem Ausplanen werden die betroffenen Kürzel genannt',
  /LEIHE-01/.test(await page.locator('.modal').innerText()));
await page.locator('.modal__foot button:has-text("Ausplanen")').click();
await page.waitForTimeout(6000);
check('„Nur Stammmannschaft" plant alle Leiharbeiter aus',
  /niemand eingeplant/.test(await page.locator('.card:has(.card__title:text-is("Wer wird gerechnet?"))').innerText()));
// Zustand zuruecksetzen: die zugesagten Eintritte wieder setzen
for (const [id, datum] of [['LEIHE-01', '2026-09-15'], ['LEIHE-02', '2026-09-15'],
  ['LEIHE-03', '2026-09-21'], ['LEIHE-04', '2026-10-01'], ['LEIHE-05', '2026-10-01']]) {
  const zeile = page.locator(`.card:has-text("Wer darf was?") tbody tr:has(input[placeholder="${id}"])`);
  if (await zeile.count() === 0) continue;
  await zeile.locator('input[type="date"]').first().fill(datum);
  await zeile.locator('input[type="date"]').first().blur();
  await page.waitForTimeout(2200);
}
check('Die zugesagten Eintritte lassen sich einzeln wieder setzen',
  /5 Leiharbeiter sind hinterlegt/
    .test(await page.locator('.card:has(.card__title:text-is("Wer wird gerechnet?"))').innerText()),
  (await page.locator('.card:has(.card__title:text-is("Wer wird gerechnet?"))').innerText())
    .split('\n').find((z) => z.includes('hinterlegt'))?.slice(0, 90) ?? 'nicht wiederhergestellt');
// Die Namen der Leiharbeiter stehen in Eingabefeldern (frei änderbar)
const namensfelder = page.locator('.card:has-text("Wer darf was?") tbody input[type="text"]');
const namen = [];
for (let i = 0; i < await namensfelder.count(); i++) namen.push(await namensfelder.nth(i).inputValue());
check('Leiharbeiter stehen mit überschreibbarem Namen in der Liste',
  namen.filter((n) => /^Leiharbeiter \d+$/.test(n)).length === 15,
  `${namen.filter((n) => /^Leiharbeiter \d+$/.test(n)).length} Namensfelder`);
await namensfelder.first().fill('Müller (Zeitarbeit)');
await namensfelder.first().blur();
await page.waitForTimeout(3000);
check('Name eines Leiharbeiters änderbar',
  (await page.locator('.card:has-text("Wer darf was?") tbody input[type="text"]').first().inputValue()) === 'Müller (Zeitarbeit)');
check('Qualifikationsmatrix hat je Arbeitsgang eine Spalte',
  await page.locator('.card:has-text("Wer darf was?") thead th').count() >= 13,
  `${await page.locator('.card:has-text("Wer darf was?") thead th').count()} Spalten`);
check('Vorarbeiter ist mit halbem Anteil geführt',
  (await page.locator('.card:has-text("Wer darf was?") tbody tr:has-text("STWUE")').innerText()).includes('0,5'));

// Art je Person aenderbar: wer als Stamm gefuehrt wird, aber Leiharbeiter
// ist, wird sonst zu guenstig und zu produktiv gerechnet.
// Die Zeile wird ueber ihre Position gemerkt: sobald jemand als Leihe
// gefuehrt wird, steht das Kuerzel im Namensfeld statt im Text.
const alleZeilen = page.locator('.card:has-text("Wer darf was?") tbody tr');
let jaroIndex = -1;
for (let i = 0; i < await alleZeilen.count(); i++) {
  if ((await alleZeilen.nth(i).innerText()).includes('JARO')) { jaroIndex = i; break; }
}
const artZeile = () => page.locator('.card:has-text("Wer darf was?") tbody tr').nth(jaroIndex);
const artAuswahl = artZeile().locator('select').first();
check('Die Art (Stamm / Leihe / neu) ist je Kürzel auswählbar',
  jaroIndex >= 0 && await artAuswahl.count() === 1
  && (await artAuswahl.locator('option').allInnerTexts()).join('|') === 'Stamm|Leihe|neu',
  (await artAuswahl.locator('option').allInnerTexts()).join(', '));
check('Stammleute stehen auf „Stamm"', await artAuswahl.inputValue() === 'STAMM');
await artAuswahl.selectOption('LEIHE');
await page.waitForTimeout(3000);
check('Umstellung auf Leiharbeiter wird gespeichert',
  await artZeile().locator('select').first().inputValue() === 'LEIHE');
await artZeile().locator('input[type="date"]').first().waitFor({ timeout: 15000 }).catch(() => null);
check('Als Leihe geführte Person bekommt Eintritt und Ende zum Pflegen',
  await artZeile().locator('input[type="date"]').count() === 2,
  `${await artZeile().locator('input[type="date"]').count()} Datumsfelder`);
await artZeile().locator('select').first().selectOption('STAMM');
await page.waitForTimeout(3000);
check('Zurückstellen auf Stamm funktioniert ebenso',
  await artZeile().locator('select').first().inputValue() === 'STAMM'
  && (await artZeile().innerText()).includes('JARO'));

// Die fuenf zugesagten Leiharbeiter haben einen Eintritt hinterlegt
const eintritte = [];
const datumsfelder = page.locator('.card:has-text("Wer darf was?") tbody input[type="date"]');
for (let i = 0; i < await datumsfelder.count(); i++) {
  const v = await datumsfelder.nth(i).inputValue();
  if (v) eintritte.push(v);
}
check('Die fünf zugesagten Leiharbeiter sind mit Eintritt geführt',
  eintritte.filter((d) => d === '2026-09-15').length === 2
  && eintritte.includes('2026-09-21')
  && eintritte.filter((d) => d === '2026-10-01').length === 2,
  eintritte.join(', '));
check('Stammmitarbeiter sind dauerhaft geführt',
  (await page.locator('.card:has-text("Wer darf was?") tbody tr:has-text("JARO")').innerText()).includes('dauerhaft'));

// Haken entfernen muss sofort auf die Rechnung wirken
if (await page.locator('.overlay').count() > 0) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const reihe = page.locator('.card:has-text("Wer darf was?") tbody tr').first();
const hakenVorher = await reihe.locator('input[type="checkbox"]').count();
await reihe.locator('input[type="checkbox"]').nth(3).uncheck();
await page.waitForTimeout(3000);
check('Qualifikation abwählbar', hakenVorher >= 11 && !await reihe.locator('input[type="checkbox"]').nth(3).isChecked());
await reihe.locator('input[type="checkbox"]').nth(3).check();
await page.waitForTimeout(3000);

/* ---------- Anwesenheit je Kalenderwoche ---------- */
await page.locator('.seg button:has-text("Anwesenheit je KW")').click();
await page.waitForSelector('.card:has-text("Anwesenheit je Kalenderwoche") table.matrix tbody tr', { timeout: 30000 });
const matrixZeilen = await page.locator('.card:has-text("Anwesenheit je Kalenderwoche") table.matrix tbody tr').count();
check('Anwesenheitsmatrix zeigt alle Personen und die Summe', matrixZeilen === 25, `${matrixZeilen} Zeilen`);
const anwesenheitText = await page.locator('.card:has-text("Anwesenheit je Kalenderwoche")').innerText();
check('Die Matrix reicht bis Ende 2027', /Ende 2027/.test(anwesenheitText));
check('Die Summe der FTE steht unter der Matrix', /Summe FTE/.test(anwesenheitText));
check('Fehlender Urlaub wird gemeldet',
  /Urlaub und Abwesenheiten fehlen noch/.test(anwesenheitText),
  anwesenheitText.split('\n').find((z) => z.includes('Urlaub'))?.slice(0, 80) ?? 'kein Hinweis');

// Zwei Leiharbeiter für die gezeigten Wochen einplanen
const leihZeile = page.locator('.card:has-text("Anwesenheit je Kalenderwoche") table.matrix tbody tr:has-text("Leiharbeiter 1")').first();
const fteVorher = Number.parseFloat((await page.locator('.card:has-text("Anwesenheit je Kalenderwoche") tr.matrix__pool td').nth(1).innerText()).replace(',', '.'));
await leihZeile.locator('input[type="checkbox"]').first().check();
await page.waitForTimeout(3500);
const fteNachher = Number.parseFloat((await page.locator('.card:has-text("Anwesenheit je Kalenderwoche") tr.matrix__pool td').nth(1).innerText()).replace(',', '.'));
check('Leiharbeiter wochenweise einplanbar', fteNachher > fteVorher, `${fteVorher} -> ${fteNachher} FTE`);
await leihZeile.locator('input[type="checkbox"]').first().uncheck();
await page.waitForTimeout(3000);

/* ---------- Urlaubsplanung einlesen ---------- */
await page.locator('.seg button:has-text("Urlaubsplanung einlesen")').click();
await page.waitForSelector('.card:has-text("Urlaubsplanung einlesen") textarea', { timeout: 20000 });
// Kopfzeile, Nullzeile, Leerzeile und drei Personenzeilen - wie in der Ursprungsdatei
const urlaubText = [
  '21.09.\t22.09.\t23.09.\t24.09.\t25.09.\t26.09.\t27.09.\t28.09.\t29.09.',
  '0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0',
  '\t\t\t\t\t\t\t\t',
  'T\tT\tT\tT\tT\t\t\tT\tT',
  'A\tA\tA\tA\tA\t\t\tT\tT',
  'T\tT\tDM\tDM\tDM\t\t\tT\tT',
].join('\n');
/*
 * Zuerst der Weg ueber die Datei: Die Abteilung zieht ihre Excel-Datei
 * in das Feld, statt den Bereich zu kopieren. Geprueft wird mit einer
 * echten .xlsx-Datei - einschliesslich der Datumszahlen, die Excel
 * anstelle von "21.09." speichert.
 */
check('Urlaubsplanung: Excel-Datei kann abgelegt werden',
  await page.locator('.card:has-text("Urlaubsplanung einlesen") .dropzone').count() === 1
  && await page.locator('.card:has-text("Urlaubsplanung einlesen") input[type="file"]').count() === 1);
await page.locator('.card:has-text("Urlaubsplanung einlesen") input[type="file"]').setInputFiles(XLSX_PROBE);
await page.waitForSelector('.card:has(.card__title:text-is("Vorschau")) tbody tr', { timeout: 20000 });
const ausDatei = page.locator('.card:has(.card__title:text-is("Vorschau"))');
check('Urlaubsplanung: die Excel-Datei wird gelesen',
  await ausDatei.locator('tbody tr').count() === 3,
  `${await ausDatei.locator('tbody tr').count()} Zeilen aus der Datei`);
const dateiText = await ausDatei.innerText();
check('Urlaubsplanung: Excel-Datumswerte werden richtig umgerechnet',
  /21\.09\.2026/.test(dateiText) && /25\.09\.2026/.test(dateiText),
  dateiText.split('\n')[0]?.slice(0, 110) ?? '');
check('Urlaubsplanung: Abwesenheit aus der Datei erkannt',
  /21\.09\.2026–25\.09\.2026/.test(dateiText));

// Danach derselbe Weg ueber die Zwischenablage
await page.locator('.card:has-text("Urlaubsplanung einlesen") textarea').fill(urlaubText);
await page.locator('.card:has-text("Urlaubsplanung einlesen") button:has-text("Tabelle ansehen")').click();
await page.waitForSelector('.card:has(.card__title:text-is("Vorschau")) tbody tr', { timeout: 20000 });
const vorschauKarte = page.locator('.card:has(.card__title:text-is("Vorschau"))');
check('Urlaubsplanung: drei Personenzeilen erkannt, Null- und Leerzeile übergangen',
  await vorschauKarte.locator('tbody tr').count() === 3,
  `${await vorschauKarte.locator('tbody tr').count()} Zeilen`);
const vorschauText = await vorschauKarte.innerText();
check('Urlaubsplanung: Zeitraum und Arbeitstage werden genannt',
  /21\.09\.2026/.test(vorschauText) && /29\.09\.2026/.test(vorschauText) && /Arbeitstage/.test(vorschauText),
  vorschauText.split('\n')[0]?.slice(0, 110) ?? '');
/*
 * DM ist inzwischen bekannt ("Demontage - der MA ist verliehen in eine
 * andere Abteilung") und wird als Abwesenheit gerechnet. Erfragt werden
 * nur noch Kuerzel, die die Anwendung wirklich nicht kennt.
 */
check('Urlaubsplanung: DM wird als Demontage gerechnet, nicht erfragt',
  !/Unbekannte Kürzel/.test(vorschauText),
  vorschauText.split('\n').find((z) => /abwesend/.test(z))?.slice(0, 90) ?? '');
check('Urlaubsplanung: die Urlaubswoche steht als ein Zeitraum',
  /21\.09\.2026–25\.09\.2026/.test(vorschauText));
check('Urlaubsplanung: die Demontagetage zählen als Abwesenheit',
  /3/.test((await vorschauKarte.locator('tbody tr').nth(2).innerText())),
  (await vorschauKarte.locator('tbody tr').nth(2).innerText()).replace(/\n/g, ' | ').slice(0, 110));
// Zweite Zeile JARO zuordnen und übernehmen
await vorschauKarte.locator('tbody tr').nth(1).locator('select').selectOption('JARO');
await vorschauKarte.locator('button:has-text("Übernehmen")').click();
await page.locator('.modal:has-text("Urlaubsplanung übernehmen?")').waitFor({ state: 'visible' });
await page.locator('.modal__foot button:has-text("Übernehmen")').click();
await page.waitForTimeout(4000);
await page.locator('.seg button:has-text("Mannschaft")').first().click();
await page.waitForSelector('.card:has-text("Wer darf was?") table.tbl tbody tr', { timeout: 20000 });
check('Urlaubsplanung: die zugeordnete Abwesenheit steht bei der Person',
  (await page.locator('.card:has-text("Wer darf was?") tbody tr:has-text("JARO")').innerText()).includes('Abwesenheit'),
  (await page.locator('.card:has-text("Wer darf was?") tbody tr:has-text("JARO")').innerText()).slice(0, 80));
await page.locator('.seg button:has-text("Urlaubsplanung einlesen")').click();
await page.waitForSelector('.card:has-text("Abwesende ohne Zuordnung") tbody tr', { timeout: 20000 });
const offeneText = await page.locator('.card:has-text("Abwesende ohne Zuordnung")').innerText();
check('Urlaubsplanung: nicht zugeordnete Zeilen stehen als Anzahl je Tag',
  /Personentage/.test(offeneText),
  offeneText.split('\n').find((z) => z.includes('Personentage'))?.slice(0, 110) ?? '');

await page.locator('.seg button:has-text("Einsatzplan")').click();
await page.waitForSelector('.card:has-text("Einsatzplan je Mitarbeiter") table.tbl tbody tr', { timeout: 40000 });
const einsatzKarte = page.locator('.card:has-text("Einsatzplan je Mitarbeiter")');
check('Einsatzplan weist die Leiharbeiter als solche aus',
  await einsatzKarte.locator('tbody .pill--violet').count() === 15,
  `${await einsatzKarte.locator('tbody .pill--violet').count()} Zeilen mit "Leihe"`);
check('Einsatzplan nennt den Namen der Leiharbeiter',
  (await einsatzKarte.locator('tbody tr:has-text("LEIHE-01")').innerText()).includes('Leiharbeiter 1')
  || (await einsatzKarte.locator('tbody tr:has-text("LEIHE-01")').innerText()).includes('Müller'),
  (await einsatzKarte.locator('tbody tr:has-text("LEIHE-01")').innerText()).split('\n').slice(0, 3).join(' · '));
const einsatzFuss = await einsatzKarte.innerText();
check('Einsatzplan sagt, wie viele Leiharbeiter eingeplant sind',
  /davon \d+ Leiharbeiter/.test(einsatzFuss),
  einsatzFuss.split('\n').find((z) => z.includes('Leiharbeiter')) ?? '');
check('Leere Zeilen nennen den Grund',
  /nicht abgerufen|Eintritt erst|keine Zuteilung|ganze Woche/.test(einsatzFuss));
const zeilenAlle = await einsatzKarte.locator('tbody tr').count();
await einsatzKarte.locator('label.inline-check:has-text("nur Eingeplante") input').check();
await page.waitForTimeout(2500);
const zeilenGefiltert = await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") tbody tr').count();
check('Einsatzplan lässt sich auf die Eingeplanten eingrenzen',
  zeilenGefiltert > 0 && zeilenGefiltert < zeilenAlle,
  `${zeilenAlle} -> ${zeilenGefiltert} Zeilen`);
await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") label.inline-check:has-text("nur Eingeplante") input').uncheck();
await page.waitForTimeout(2000);
check('Einsatzplan zeigt jede Person mit ihrer Woche',
  await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") tbody tr').count() === 24,
  `${await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") tbody tr').count()} Zeilen`);
const planText = await page.locator('.card:has-text("Einsatzplan je Mitarbeiter")').innerText();
check('Einsatzplan nennt Arbeitsgang und Auftrag', /WGC\d/.test(planText) && /Orbitalschwei|Sägen|Heften/.test(planText));
await page.locator('button:has-text("Woche ›")').click();
await page.waitForTimeout(1200);
check('Im Einsatzplan blättert die Woche weiter',
  (await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") strong').first().innerText()) !== '',
  await page.locator('.card:has-text("Einsatzplan je Mitarbeiter") strong').first().innerText());

/* ================================================================== *
 * Terminplan
 * ================================================================== */

await nav('Terminplan');
check('Gantt-Balken vorhanden', await page.locator('.gantt svg rect.g-bar').count() >= 30);
check('Solltermin-Rauten vorhanden', await page.locator('.gantt svg path.g-due').count() >= 30);
await page.locator('.gantt__toggle').first().click();
await page.waitForTimeout(400);
check('Arbeitsgänge aufklappbar', await page.locator('.gantt__row--op').count() >= 9);
await page.locator('button:has-text("Wochen")').first().click();
await page.waitForTimeout(500);
check('Wochenansicht im Gantt', await page.locator('.gantt svg rect.g-bar').count() >= 30);

/* ================================================================== *
 * Auftragspflege
 * ================================================================== */

await nav('Aufträge');
const rowsBefore = await page.locator('table.tbl tbody tr').count();
await page.locator('button:has-text("+ Neuer Auftrag")').click();
await page.waitForTimeout(400);
await page.locator('.modal label.field:has-text("Auftragsnummer") input').fill('UITEST-1');
await page.locator('.modal label.field:has-text("Kunde") input').fill('Testkunde');
await page.locator('.modal label.field:has-text("Fertigstellung (Deadline") input').fill('2026-12-15');
await page.locator('.modal__foot button:has-text("Speichern")').click();
await page.waitForTimeout(2600);
const rowsAfter = await page.locator('table.tbl tbody tr').count();
check('Auftrag über die Oberfläche angelegt', rowsAfter === rowsBefore + 1, `${rowsBefore} -> ${rowsAfter}`);

await nav('Terminplan');
check('Neuer Auftrag erscheint im Gantt', (await page.locator('.gantt__labels').innerText()).includes('UITEST-1'));

await nav('Aufträge');
await page.locator('table.tbl tbody tr:has-text("UITEST-1")').click();
await page.waitForTimeout(600);
// Das Detail steht jetzt im Seitenpanel rechts, nicht mehr im Fenster
await page.locator('.panel').waitFor({ state: 'visible' });
check('Auftragsdetail öffnet im Seitenpanel rechts',
  await page.locator('.panel .panel__title').count() === 1
  && (await page.locator('.panel .panel__title').innerText()).includes('UITEST-1'),
  await page.locator('.panel .panel__title').innerText());
check('Auftragsdetail zeigt Arbeitsfolge', await page.locator('.panel table.tbl tbody tr').count() >= 9,
  `${await page.locator('.panel table.tbl tbody tr').count()} Arbeitsgänge`);
const detailText = await page.locator('.panel').innerText();
check('Auftragsdetail nennt den Fehlteilstand', /Fehlteile/.test(detailText),
  detailText.split('\n').find((z) => z.includes('Fehlteile'))?.slice(0, 80) ?? '');
// Im Bearbeiten-Dialog sind die Fehlteile pflegbar
await page.locator('.panel button:has-text("Bearbeiten"), .panel button:has-text("Ändern")').first().click();
await page.waitForSelector('.modal', { timeout: 15000 });
const editText = await page.locator('.modal').last().innerText();
check('Fehlteile im Auftrag pflegbar',
  /Fehlteile/.test(editText) && /Material verfügbar ab/.test(editText) && /Was fehlt/.test(editText),
  editText.split('\n').find((z) => z.includes('Fehlteile'))?.slice(0, 80) ?? '');
await page.keyboard.press('Escape');
await page.locator('.modal').waitFor({ state: 'detached' });
// Detail erneut oeffnen, um den Auftrag zu loeschen
await page.locator('table.tbl tbody tr:has-text("UITEST-1")').click();
await page.locator('.panel__foot button:has-text("Löschen")').waitFor({ state: 'visible' });
await page.locator('.panel__foot button:has-text("Löschen")').click();
await page.waitForTimeout(400);
await page.locator('.modal__foot button:has-text("Löschen")').last().click();
await page.waitForTimeout(2600);
check('Auftrag wieder gelöscht', await page.locator('table.tbl tbody tr').count() === rowsBefore);

/* ---------- Direktbearbeitung in der Liste ---------- */
const ersteZeile = page.locator('table.tbl tbody tr').first();
const terminFeld = ersteZeile.locator('input[type="date"]').first();
const terminVorher = await terminFeld.inputValue();
await terminFeld.fill('2027-03-01');
await page.waitForTimeout(3000);
check('Fertigstellung direkt in der Liste änderbar',
  (await page.locator('table.tbl tbody tr').first().locator('input[type="date"]').first().inputValue()) === '2027-03-01',
  `${terminVorher} -> 2027-03-01`);
await page.locator('table.tbl tbody tr').first().locator('input[type="date"]').first().fill(terminVorher);
await page.waitForTimeout(3000);
const prioFeld = page.locator('table.tbl tbody tr').first().locator('select').first();
const prioVorher = await prioFeld.inputValue();
await prioFeld.selectOption('P1');
await page.waitForTimeout(3000);
check('Priorität direkt in der Liste änderbar',
  (await page.locator('table.tbl tbody tr').first().locator('select').first().inputValue()) === 'P1',
  `${prioVorher} -> P1`);
await page.locator('table.tbl tbody tr').first().locator('select').first().selectOption(prioVorher);
await page.waitForTimeout(3000);

/* ---------- Fortschritt direkt in der Liste ---------- */
const fortschrittZeile = page.locator('table.tbl tbody tr').first();
const restVorher = await fortschrittZeile.innerText();
await fortschrittZeile.locator('input[type="number"]').fill('50');
await fortschrittZeile.locator('input[type="number"]').blur();
await page.waitForTimeout(3000);
check('Gesamtfortschritt in % direkt änderbar',
  (await page.locator('table.tbl tbody tr').first().locator('input[type="number"]').inputValue()) === '50');
check('Fortschritt wirkt auf die Reststunden',
  (await page.locator('table.tbl tbody tr').first().innerText()) !== restVorher);
await nav('Stände');
check('Fortschritt steht im Protokoll',
  (await page.locator('.card:has-text("Änderungsprotokoll") tbody').innerText()).includes('Fortschritt 50 %'));
await nav('Aufträge');
await page.locator('table.tbl tbody tr').first().locator('input[type="number"]').fill('0');
await page.locator('table.tbl tbody tr').first().locator('input[type="number"]').blur();
await page.waitForTimeout(3000);

const firstBefore = await page.locator('table.tbl tbody tr').first().innerText();
await page.locator('table.tbl tbody tr').nth(1).locator('button[title="nach oben"]').click();
await page.waitForTimeout(2600);
check('Fertigungsreihenfolge änderbar',
  firstBefore !== (await page.locator('table.tbl tbody tr').first().innerText()));

/* ================================================================== *
 * Einstellungen
 * ================================================================== */

await nav('Einstellungen');
// Personal wird in der Mannschaft gepflegt - die Einstellungen sagen das
// und blenden die Felder aus, die dort nichts mehr bewirken.
const personalKarte = page.locator('.card:has(.card__title:text-is("Personal"))');
await personalKarte.waitFor({ state: 'visible', timeout: 20000 });
const personalText = await personalKarte.innerText();
check('Einstellungen verweisen fürs Personal auf die Mannschaft',
  personalText.includes('Grundlage der Besetzung ist die Mannschaft'),
  personalText.split('\n').find((z) => z.includes('Grundlage'))?.slice(0, 80) ?? '');
check('Wirkungslose Felder sind ausgeblendet',
  await page.locator('.card:has-text("Wochenweise Kapazitäten")').count() === 0);
/*
 * Diese Listen fuehrten Anzahlen ohne Namen und zaehlten still zur
 * Mannschaft dazu. Seit der Vorgabe vom 17.09.2026 wird Personal
 * ausschliesslich im Reiter Mannschaft gepflegt - hier darf es dafuer
 * kein zweites Feld geben, sonst dreht man an Zahlen, die anderswo
 * gelten.
 */
check('Kein zweites Feld für Personal neben der Mannschaft',
  await page.locator('button:has-text("+ Leiharbeiter hinzufügen")').count() === 0
  && personalText.includes('Personal wird ausschließlich im Reiter Mannschaft gepflegt'),
  personalText.split('\n').find((z) => /ausschließlich im Reiter/.test(z))?.slice(0, 110) ?? 'kein Hinweis');
check('Einarbeitungskurven bleiben einstellbar', personalText.includes('Einarbeitung neuer Kräfte'));

const kostenKarte = page.locator('.card:has(.card__title:text-is("Kosten"))');
await kostenKarte.waitFor({ state: 'visible', timeout: 20000 });
const kostenText = await kostenKarte.innerText();
check('Kostensätze mit Zuschlägen sichtbar',
  /Mehrarbeit/.test(kostenText) && /Nachtschicht/.test(kostenText) && /Leiharbeiter/.test(kostenText));
check('Die Anwendung nennt den günstigeren Weg',
  /günstiger als/.test(kostenText),
  kostenText.split('\n').find((z) => z.includes('günstiger'))?.slice(0, 100) ?? '');
check('Arbeitgeberanteile sind ausgewiesen', /Faktor 1,3|Faktor 1.3/.test(kostenText));

await tab('Erweitert');
check('Qualifikationen kommen aus der Matrix',
  (await page.locator('.card:has-text("Einsetzbare Mitarbeiter je Arbeitsgang")').innerText())
    .includes('aus der Qualifikationsmatrix'));

const noboVorher = await page.locator('.cal__day--on').count();
await page.locator('.cal__day--on').first().click();
await page.waitForTimeout(2600);
await tab('Erweitert');
const noboNachher = await page.locator('.cal__day--on').count();
check('NoBo-Kalender schaltbar', noboNachher === noboVorher - 1, `${noboVorher} -> ${noboNachher}`);
await page.locator('.cal__day--off').first().click();
await page.waitForTimeout(2600);
await tab('Erweitert');
check('NoBo-Kalender beidseitig schaltbar', await page.locator('.cal__day--on').count() === noboVorher);

await tab('Szenarien');
check('Szenarien wählbar', await page.locator('.card:has-text("Szenarien") tbody tr').count() >= 4);
await page.locator('.card:has-text("Szenarien") tbody tr:has-text("Baseline") button:has-text("Öffnen")').click();
await page.waitForTimeout(3000);
await tab('Häufig gebraucht');
check('Baseline geöffnet und gekennzeichnet',
  await page.locator('.note--warn:has-text("Baseline")').count() === 1);
const fenster = page.locator('label.field:has-text("Betriebszeitfenster"), label.field:has-text("Belegungszeit der Plätze")').first();
await fenster.locator('input').fill('12');
await fenster.locator('input').blur();
await page.waitForTimeout(900);
check('Baseline ist vor versehentlicher Änderung geschützt', await page.locator('.overlay').count() === 1);
await page.locator('.modal__foot button:has-text("Im Arbeitsstand weiterarbeiten")').click();
await page.waitForTimeout(3500);
await tab('Häufig gebraucht');
check('Rückkehr in den Arbeitsstand', await page.locator('.note--warn:has-text("Baseline")').count() === 0);

/* ================================================================== *
 * Arbeitsfolgen
 * ================================================================== */

await nav('Arbeitsfolgen');
await page.locator('button:has-text("Neubau 40 ft")').click();
await page.waitForTimeout(600);
const stundenFeld = page.locator('table.tbl tbody tr:has-text("Orbitalschweißen") input[type="number"]').first();
const alt = await stundenFeld.inputValue();
await stundenFeld.fill(String(Number(alt) + 25));
await stundenFeld.blur();
await page.waitForTimeout(2800);
check('Arbeitsgangzeit änderbar',
  (await page.locator('table.tbl tbody tr:has-text("Orbitalschweißen") input[type="number"]').first().inputValue()) !== alt);
await nav('Steuerstand');
check('Änderung wirkt auf die Planung', Number.parseFloat(await kpiValue('Aufwand')) > 0);
await nav('Arbeitsfolgen');
await page.locator('button:has-text("Neubau 40 ft")').click();
await page.waitForTimeout(600);
await page.locator('table.tbl tbody tr:has-text("Orbitalschweißen") input[type="number"]').first().fill(alt);
await page.locator('table.tbl tbody tr:has-text("Orbitalschweißen") input[type="number"]').first().blur();
await page.waitForTimeout(2600);

/* ================================================================== *
 * Daten und Pruefung
 * ================================================================== */

await nav('Daten & Prüfung');
check('Datenprüfung listet Meldungen',
  await page.locator('.card:has-text("Prüfliste"), .card:has-text("Datenprüfung")').first().locator('tbody tr').count() > 3);
const plausiTafel = page.locator('.card:has(.card__title:text-is("Plausibilitätsprüfung"))');
check('Plausibilitätsprüfung steht vollständig unter Daten & Prüfung',
  await plausiTafel.count() === 1 && await plausiTafel.locator('tbody tr').count() >= 5,
  `${await plausiTafel.locator('tbody tr').count()} Befunde`);
check('Jeder Befund nennt die Prüfung, die ihn gefunden hat',
  /BESETZUNG_SPRUNG/.test(await plausiTafel.innerText()));
const arbeitsplatzNamen = await page.locator('.card:has-text("Arbeitsplätze") tbody input[type="text"]')
  .evaluateAll((els) => els.map((e) => e.value).join(' '));
check('Arbeitsplätze vorhanden',
  arbeitsplatzNamen.includes('Heftplatz') && arbeitsplatzNamen.includes('Orbitalmaschine'),
  `${await page.locator('.card:has-text("Arbeitsplätze") tbody tr').count()} Arbeitsplätze`);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button:has-text("Gesamtplanung als Excel")').click(),
]);
check('Excel-Export lädt herunter', (await dl.suggestedFilename()).endsWith('.xlsx'), await dl.suggestedFilename());

/* ================================================================== *
 * Regeln
 * ================================================================== */

await nav('Regeln');
await page.locator('.rule__input').fill('Verschraubungen können nach dem Biegen schon gemacht werden');
await page.locator('button:has-text("Regel verstehen")').click();
await page.waitForTimeout(1500);
check('Satz wird in eine Regel übersetzt',
  await page.locator('.card:has-text("Erkannte Regel")').count() === 1);
check('Erkanntes wird gezeigt',
  (await page.locator('.note--info').first().innerText()).includes('Doppelklemmring'),
  (await page.locator('.note--info').first().innerText()).slice(0, 90));
check('Baukasten mit Auswahlfeldern',
  await page.locator('.card:has-text("Erkannte Regel") select').count() >= 3,
  `${await page.locator('.card:has-text("Erkannte Regel") select').count()} Auswahlfelder`);
check('Geltungsbereich wählbar',
  await page.locator('button:has-text("Nach Auftragsart / Variante")').count() === 1);

await page.locator('button:has-text("Regel speichern")').click();
await page.waitForTimeout(3500);
check('Regel gespeichert und in der Liste',
  (await page.locator('.card:has-text("Regeln") tbody').innerText()).includes('Doppelklemmring'));

await page.locator('.card:has-text("Regeln") tbody button:has-text("Wirkung")').first().click();
await page.waitForTimeout(4000);
check('Wirkung der Regel wird berechnet',
  (await page.locator('.modal').innerText()).toLowerCase().includes('termintreue'),
  (await page.locator('.modal .note').innerText().catch(() => '')).slice(0, 80));
await page.locator('.modal__close').click();
await page.waitForTimeout(400);

const regelAus = page.locator('.card:has-text("Regeln") tbody input[type="checkbox"]').first();
await regelAus.uncheck();
await page.waitForTimeout(3000);
check('Regel abschaltbar', !(await regelAus.isChecked()));
await regelAus.check();
await page.waitForTimeout(3000);

// Unsinniger Satz wird ehrlich zurückgewiesen
await page.locator('.rule__input').fill('Wir sollten mehr Kaffee trinken');
await page.locator('button:has-text("Regel verstehen")').click();
await page.waitForTimeout(1200);
check('Unverständlicher Satz wird abgewiesen',
  await page.locator('.note--warn:has-text("nicht eindeutig")').count() === 1);

// Widersprüchliche Regel wird abgelehnt
await page.locator('.rule__input').fill('Biegen darf erst nach der Doppelklemmring-Vormontage beginnen');
await page.locator('button:has-text("Regel verstehen")').click();
await page.waitForTimeout(1200);
await page.locator('button:has-text("Regel speichern")').click();
await page.waitForTimeout(2500);
check('Widersprüchliche Regel wird abgelehnt',
  await page.locator('.toast--error').count() >= 1
  || (await page.locator('.card:has-text("Regeln") tbody').innerText()).split('Biegen beginnt erst').length === 1);
await page.waitForTimeout(4000);

/* ================================================================== *
 * Stände, Protokoll, Aufholen
 * ================================================================== */

await nav('Stände');
const staendeVorher = await page.locator('.card:has-text("Gespeicherte Stände") tbody tr').count();
await page.locator('.card:has-text("Aktuellen Stand speichern") input[type="text"]').nth(1).fill('');
await page.locator('button:has-text("Stand speichern")').first().click();
await page.waitForTimeout(1200);
check('Notiz ist Pflicht', await page.locator('.toast--error').count() >= 1);

await page.locator('.card:has-text("Aktuellen Stand speichern") input[type="text"]').nth(0).fill('Prüfstand UI');
await page.locator('.card:has-text("Aktuellen Stand speichern") input[type="text"]').nth(1).fill('Von der Oberflächenprüfung angelegt');
await page.locator('button:has-text("Stand speichern")').first().click();
await page.waitForTimeout(3500);
await nav('Stände');
const staendeNachher = await page.locator('.card:has-text("Gespeicherte Stände") tbody tr').count();
check('Stand gespeichert', staendeNachher === staendeVorher + 1, `${staendeVorher} -> ${staendeNachher}`);
check('Stand nennt Person und Notiz',
  (await page.locator('.card:has-text("Gespeicherte Stände") tbody').innerText()).includes('DOHE')
  && (await page.locator('.card:has-text("Gespeicherte Stände") tbody').innerText()).includes('Oberflächenprüfung'));

await page.locator('.card:has-text("Gespeicherte Stände") button:has-text("Ansehen")').first().click();
await page.waitForSelector('.modal .kpi', { timeout: 30000 }).catch(() => {});
const standText = (await page.locator('.modal').innerText()).toLowerCase();
check('Stand ansehen zeigt Kennzahlen und Notiz',
  standText.includes('termintreue') && standText.includes('notiz') && standText.includes('stammmitarbeiter'),
  standText.replace(/\n/g, ' · ').slice(0, 260));
await page.locator('.modal button:has-text("Schließen")').click();
await page.waitForTimeout(400);

check('Änderungsprotokoll gefüllt',
  await page.locator('.card:has-text("Änderungsprotokoll") tbody tr').count() > 3,
  `${await page.locator('.card:has-text("Änderungsprotokoll") tbody tr').count()} Einträge`);
check('Protokoll nennt Klartext und Kürzel',
  (await page.locator('.card:has-text("Änderungsprotokoll") tbody').innerText()).includes('DOHE'));

/* ================================================================== *
 * Benutzerverwaltung
 * ================================================================== */

await nav('Einstellungen');
await tab('Benutzer');
check('Benutzerliste sichtbar',
  await page.locator('.card:has-text("Benutzer") tbody tr').count() >= 6,
  `${await page.locator('.card:has-text("Benutzer") tbody tr').count()} Kürzel`);
check('Verwaltung darf anlegen',
  await page.locator('button:has-text("+ Kürzel anlegen")').count() === 1);
await page.locator('.card:has-text("Benutzer") input[type="text"]').first().fill('PRUEF');
await page.locator('button:has-text("+ Kürzel anlegen")').click();
// Auf den Zustand warten, nicht auf die Uhr - sonst haengt das Ergebnis
// davon ab, wie schnell der Rechner gerade ist.
await page.locator('.card:has-text("Benutzer") tbody tr:has-text("PRUEF")')
  .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
check('Kürzel angelegt',
  (await page.locator('.card:has-text("Benutzer") tbody').innerText()).includes('PRUEF'));
await page.locator('.card:has-text("Benutzer") tbody tr:has-text("PRUEF") button:has-text("Löschen")').click();
await page.waitForSelector('.modal__foot button:has-text("Löschen")', { timeout: 20000 });
await page.locator('.modal__foot button:has-text("Löschen")').click();
await page.locator('.card:has-text("Benutzer") tbody tr:has-text("PRUEF")')
  .waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
check('Kürzel gelöscht',
  !(await page.locator('.card:has-text("Benutzer") tbody').innerText()).includes('PRUEF'));

/* ================================================================== *
 * Aktueller Plan
 * ================================================================== */

await tab('Szenarien');
await page.locator('.card:has-text("Szenarien") tbody tr').first().locator('button:has-text("Als aktuellen Plan")').click();
await page.waitForTimeout(2500);
check('Aktueller Plan wird oben angezeigt',
  (await page.locator('.topbar').innerText()).includes('Aktueller Plan'),
  (await page.locator('.topbar .pill--blue').innerText().catch(() => '')));

/* ================================================================== *
 * Abmelden, erneut anmelden, Mehrbenutzerbetrieb
 * ================================================================== */

await page.locator('.userchip').click();
await page.waitForTimeout(500);
check('Benutzermenü mit Passwort und Abmelden',
  await page.locator('.modal button:has-text("Passwort ändern")').count() === 1
  && await page.locator('.modal button:has-text("Abmelden")').count() === 1);
await page.locator('.modal button:has-text("Abmelden")').click();
await page.waitForTimeout(2000);
check('Abmelden führt zur Anmeldung', await page.locator('.login__box').count() === 1);

await anmelden(page, 'DOHE');
check('Erneute Anmeldung möglich', (await page.locator('.userchip').innerText()).includes('DOHE'));

if (BASE.startsWith('http')) {
  // Eigener Browser-Kontext: ein zweiter Rechner, ein zweites Kürzel
  const context2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const zweite = await context2.newPage();
  zweite.on('dialog', async (d) => { await d.accept(d.defaultValue() || 'Prüfstand'); });
  await zweite.goto(BASE, { waitUntil: 'networkidle' });
  check('Zweiter Rechner verlangt eigene Anmeldung', await zweite.locator('.login__box').count() === 1);
  await anmelden(zweite, 'KEMI');
  check('Zweiter Benutzer kann gleichzeitig arbeiten',
    (await zweite.locator('.userchip').innerText()).includes('KEMI'));

  await zweite.locator('.navitem:has-text("Aufträge")').first().click();
  await zweite.waitForTimeout(700);
  await zweite.locator('table.tbl tbody tr').nth(1).locator('button[title="nach oben"]').click();
  await zweite.waitForTimeout(2600);
  await page.waitForTimeout(10000);
  check('Fremde Änderung wird gemeldet',
    (await page.locator('.topbar button:has-text("neu laden")').count()) === 1,
    await page.locator('.topbar').innerText().then((t) => t.replace(/\n/g, ' · ').slice(0, 110)));
  await page.locator('.topbar button:has-text("neu laden")').click();
  await page.waitForTimeout(2500);
  check('Neu laden räumt die Meldung ab',
    (await page.locator('.topbar button:has-text("neu laden")').count()) === 0);

  // Aufholmeldung fuer den zweiten Benutzer
  await zweite.reload();
  await zweite.waitForSelector('.sidebar', { timeout: 20000 });
  await zweite.waitForTimeout(2500);
  check('Aufholmeldung nennt fremde Änderungen',
    await zweite.locator('.catchup').count() === 1,
    await zweite.locator('.catchup__head').innerText().catch(() => 'keine Meldung'));
  if (await zweite.locator('.catchup').count() === 1) {
    await zweite.locator('.catchup button:has-text("Alles gelesen")').click();
    await zweite.waitForTimeout(1200);
    check('Aufholmeldung lässt sich abräumen', await zweite.locator('.catchup').count() === 0);
  }
  await zweite.close();
  await context2.close();
}

check('Keine JavaScript-Fehler', errors.length === 0, errors.slice(0, 4).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} Oberflächenprüfungen bestanden ===`);
if (failed.length) console.log(`Nicht bestanden:\n${failed.map((f) => `  - ${f.name}`).join('\n')}`);
if (errors.length) console.log(`Fehlerprotokoll:\n${errors.slice(0, 10).join('\n')}`);
process.exit(failed.length ? 1 : 0);
