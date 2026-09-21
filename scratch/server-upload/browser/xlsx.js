/**
 * Excel- und CSV-Unterstuetzung fuer die Einzeldatei-Version.
 *
 * Arbeitet ausschliesslich mit Uint8Array (kein Node-Buffer, kein zlib).
 * Geschrieben wird unkomprimiert (ZIP-Verfahren "gespeichert"), gelesen
 * werden auch komprimierte Archive ueber den eigenen DEFLATE-Decoder.
 */

import { inflateRaw } from './inflate.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

/**
 * Erzeugt ein ZIP-Archiv (Verfahren "gespeichert").
 * @param {{name:string, data:Uint8Array}[]} entries
 * @returns {Uint8Array}
 */
export function zip(entries) {
  const prepared = entries.map((e) => ({ name: enc.encode(e.name), data: e.data, crc: crc32(e.data) }));
  let size = 0;
  for (const e of prepared) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  size += 22;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets = [];

  for (const e of prepared) {
    offsets.push(p);
    view.setUint32(p, 0x04034b50, true);
    view.setUint16(p + 4, 20, true);
    view.setUint16(p + 6, 0x0800, true); // UTF-8
    view.setUint16(p + 8, 0, true);      // gespeichert
    view.setUint16(p + 10, 0, true);
    view.setUint16(p + 12, 0x21, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.data.length, true);
    view.setUint32(p + 22, e.data.length, true);
    view.setUint16(p + 26, e.name.length, true);
    view.setUint16(p + 28, 0, true);
    p += 30;
    out.set(e.name, p); p += e.name.length;
    out.set(e.data, p); p += e.data.length;
  }

  const cdStart = p;
  prepared.forEach((e, i) => {
    view.setUint32(p, 0x02014b50, true);
    view.setUint16(p + 4, 20, true);
    view.setUint16(p + 6, 20, true);
    view.setUint16(p + 8, 0x0800, true);
    view.setUint16(p + 10, 0, true);
    view.setUint16(p + 12, 0, true);
    view.setUint16(p + 14, 0x21, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.data.length, true);
    view.setUint32(p + 24, e.data.length, true);
    view.setUint16(p + 28, e.name.length, true);
    view.setUint32(p + 38, 0, true);
    view.setUint32(p + 42, offsets[i], true);
    p += 46;
    out.set(e.name, p); p += e.name.length;
  });

  view.setUint32(p, 0x06054b50, true);
  view.setUint16(p + 8, prepared.length, true);
  view.setUint16(p + 10, prepared.length, true);
  view.setUint32(p + 12, p - cdStart, true);
  view.setUint32(p + 16, cdStart, true);
  p += 22;

  return out.subarray(0, p);
}

/**
 * Liest ein ZIP-Archiv.
 * @param {Uint8Array} buf
 * @returns {Record<string, Uint8Array>}
 */
export function unzip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  /** @type {Record<string, Uint8Array>} */
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-/XLSX-Datei.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out[name] = method === 0 ? raw : inflateRaw(raw);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

const esc = (s) => String(s ?? '')
  .replace(CONTROL_CHARS, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = (row ?? []).map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * @param {{name:string, rows:any[][]}[]} sheets
 * @returns {Uint8Array}
 */
export function writeXlsx(sheets) {
  const safe = sheets.map((s, i) => ({
    name: (s.name || `Blatt${i + 1}`).replace(/[\\/*?:[\]]/g, '-').slice(0, 31),
    rows: s.rows ?? [],
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
</Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) })),
  ]);
}

function decodeXmlText(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXmlText(x[1])).join(''));
  }
  return out;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * @param {Uint8Array} buf
 * @returns {{name:string, rows:any[][]}[]}
 */
export function readXlsx(buf) {
  const files = unzip(buf);
  const text = (name) => (files[name] ? dec.decode(files[name]) : '');
  const wb = text('xl/workbook.xml');
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));

  const relXml = text('xl/_rels/workbook.xml.rels');
  /** @type {Record<string,string>} */
  const relMap = {};
  for (const m of relXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[m[1]] = m[2].replace(/^\//, '').replace(/^xl\//, '');
  }

  const sheetDefs = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/>/g)]
    .map((m, i) => ({ name: decodeXmlText(m[1]), target: relMap[m[2]] ?? `worksheets/sheet${i + 1}.xml` }));

  const list = sheetDefs.length ? sheetDefs : Object.keys(files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .map((f, i) => ({ name: `Blatt${i + 1}`, target: f.replace(/^xl\//, '') }));

  return list.map((def) => {
    const xml = text(`xl/${def.target}`);
    /** @type {any[][]} */
    const rows = [];
    for (const rowM of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rIdx = Number(rowM[1]) - 1;
      /** @type {any[]} */
      const row = [];
      for (const cM of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cM[1];
        const inner = cM[2] ?? '';
        const ref = /r="([^"]+)"/.exec(attrs)?.[1] ?? '';
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
        const ci = colIndex(ref);
        let value = null;
        if (type === 'inlineStr') {
          value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXmlText(x[1])).join('');
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          if (v == null) value = null;
          else if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'str' || type === 'e') value = decodeXmlText(v);
          else value = Number(v);
        }
        row[ci] = value;
      }
      rows[rIdx] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return { name: def.name, rows };
  });
}

/* ------------------------------------------------------------------ *
 * CSV und Hilfsfunktionen
 * ------------------------------------------------------------------ */

const BOM = '﻿';

export function writeCsv(rows, sep = ';') {
  const body = rows.map((r) => (r ?? []).map((v) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /["\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(sep)).join('\r\n');
  return BOM + body;
}

export function readCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const firstLine = clean.split('\n')[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  /** @type {any[][]} */
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Base64 -> Bytes (Browser). @param {string} b64 @returns {Uint8Array} */
export function decodeBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Textkodierung fuer Downloads. */
export function encodeText(text) {
  return enc.encode(text);
}
