/**
 * Tests der Bausteine fuer die Einzeldatei-Fassung.
 * Die Module sind reines JavaScript und daher auch unter Node pruefbar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { inflateRaw } from '../inflate.js';
import { writeXlsx, readXlsx, zip, unzip, writeCsv, readCsv, colName } from '../xlsx.js';
import { writeXlsx as nodeWriteXlsx, readXlsx as nodeReadXlsx } from '../../server/xlsx.js';

const enc = (s) => new TextEncoder().encode(s);

test('DEFLATE: entpackt alle Kompressionsstufen korrekt', () => {
  const proben = [
    Buffer.from(''),
    Buffer.from('A'),
    Buffer.from('Hallo Welt mit Umlauten: äöüß und <XML>&amp;'),
    Buffer.from('x'.repeat(120000)),
    crypto.randomBytes(65537),
  ];
  for (const p of proben) {
    for (const level of [0, 1, 6, 9]) {
      const back = Buffer.from(inflateRaw(new Uint8Array(zlib.deflateRawSync(p, { level }))));
      assert.ok(back.equals(p), `Abweichung bei ${p.length} Bytes, Stufe ${level}`);
    }
  }
});

test('DEFLATE: beschädigte Daten führen zu einer klaren Fehlermeldung', () => {
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff])), /DEFLATE/);
});

test('ZIP: schreiben und lesen', () => {
  const daten = enc('Inhalt mit Sonderzeichen: äöü <>&');
  const archiv = zip([{ name: 'ordner/datei.txt', data: daten }]);
  const zurueck = unzip(archiv);
  assert.deepEqual([...zurueck['ordner/datei.txt']], [...daten]);
});

test('XLSX: Rundlauf in der Browserfassung', () => {
  const sheets = [
    { name: 'Projekte', rows: [['Auftrag', 'Stunden'], ['WGC40-S00440', 246.01], ['Ümlaut & <Test>', 0]] },
    { name: 'Kapazität', rows: [['KW', 'Wert'], ['2026-W37', 153]] },
  ];
  const back = readXlsx(writeXlsx(sheets));
  assert.equal(back.length, 2);
  assert.equal(back[0].rows[1][0], 'WGC40-S00440');
  assert.equal(back[0].rows[1][1], 246.01);
  assert.equal(back[0].rows[2][0], 'Ümlaut & <Test>');
  assert.equal(back[1].rows[1][1], 153);
});

test('XLSX: beide Fassungen sind austauschbar', () => {
  const sheets = [{ name: 'Test', rows: [['A', 1.5, 'Text'], ['B', 0, 'Ende']] }];
  const soll = JSON.stringify(nodeReadXlsx(nodeWriteXlsx(sheets)));
  // Browser schreibt (gespeichert) -> Node liest (erwartet ggf. komprimiert)
  assert.equal(JSON.stringify(nodeReadXlsx(Buffer.from(writeXlsx(sheets)))), soll);
  // Node schreibt (komprimiert) -> Browser liest (über eigenen DEFLATE-Decoder)
  assert.equal(JSON.stringify(readXlsx(new Uint8Array(nodeWriteXlsx(sheets)))), soll);
});

test('XLSX: von Excel erzeugte Dateien mit gemeinsamer Zeichenkettentabelle', () => {
  // Excel verwendet sharedStrings statt inlineStr - das muss gelesen werden
  const sheetXml = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2"><v>42.5</v></c><c r="B2" t="s"><v>0</v></c></row></sheetData></worksheet>';
  const shared = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<si><t>Auftrag</t></si><si><t>Kunde &amp; Co</t></si></sst>';
  const archiv = zip([
    { name: '[Content_Types].xml', data: enc('<Types/>') },
    { name: 'xl/workbook.xml', data: enc('<workbook xmlns:r="x"><sheets><sheet name="Daten" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: enc(shared) },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheetXml) },
  ]);
  const back = readXlsx(archiv);
  assert.equal(back[0].name, 'Daten');
  assert.deepEqual(back[0].rows[0], ['Auftrag', 'Kunde & Co']);
  assert.deepEqual(back[0].rows[1], [42.5, 'Auftrag']);
});

test('CSV: Rundlauf mit Trennzeichen und Anführungszeichen', () => {
  const rows = [['A', 'B;mit Semikolon'], ['Text "zitiert"', 12.5]];
  const back = readCsv(writeCsv(rows));
  assert.equal(back[0][1], 'B;mit Semikolon');
  assert.equal(back[1][0], 'Text "zitiert"');
  assert.equal(back[1][1], '12,5');
});

test('Spaltenbezeichnungen', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(701), 'ZZ');
});
