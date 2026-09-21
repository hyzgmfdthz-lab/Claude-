/**
 * Erzeugt die Einzeldatei-Fassung der Anwendung.
 *
 *   node tools/build-html.mjs
 *   -> dist/Armaturenbau-MEGC.html
 *
 * Die erzeugte Datei enthaelt Oberflaeche, Planungsengine, Startdaten und
 * Stylesheet vollstaendig. Sie laeuft ohne Server, ohne Installation und ohne
 * Internetverbindung durch einfaches Oeffnen im Browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/** Module, die in der Einzeldatei-Fassung ersetzt werden. */
const ALIAS = {
  'web/js/api.js': 'browser/app.js',
  'server/xlsx.js': 'browser/xlsx.js',
};

const ENTRY = 'web/js/main.js';

/** @param {string} id */
const read = (id) => fs.readFileSync(path.join(ROOT, id), 'utf8');

/** Loest einen Import relativ zum importierenden Modul auf. */
function resolveId(spec, fromId) {
  if (!spec.startsWith('.')) throw new Error(`Externe Abhängigkeit nicht erlaubt: ${spec} (in ${fromId})`);
  const abs = path.normalize(path.join(path.dirname(fromId), spec)).replace(/\\/g, '/');
  return ALIAS[abs] ?? abs;
}

/**
 * Wandelt ein ES-Modul in eine Registrierungsfunktion um.
 * @param {string} src @param {string} id
 */
function transform(src, id) {
  /** @type {Map<string,string>} */
  const exports = new Map();
  /** @type {Set<string>} */
  const deps = new Set();
  const req = (spec) => {
    const target = resolveId(spec, id);
    deps.add(target);
    return `__req(${JSON.stringify(target)})`;
  };

  let out = src;

  // export * from '...'
  out = out.replace(/^export\s+\*\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, spec) => `__reexport(__exports, ${req(spec)});`);

  // import { a, b as c } from '...'
  out = out.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_m, names, spec) => {
    const binding = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => {
      const parts = n.split(/\s+as\s+/);
      return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : parts[0].trim();
    }).join(', ');
    return `const { ${binding} } = ${req(spec)};`;
  });

  // import * as X from '...'
  out = out.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, name, spec) => `const ${name} = ${req(spec)};`);

  // import X from '...'
  out = out.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, name, spec) => `const ${name} = ${req(spec)}.default;`);

  // export { a, b as c };
  out = out.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_m, names) => {
    names.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => {
      const parts = n.split(/\s+as\s+/);
      exports.set((parts[1] ?? parts[0]).trim(), parts[0].trim());
    });
    return '';
  });

  out = out.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_m, asy, name) => {
    exports.set(name, name);
    return `${asy ?? ''}function ${name}`;
  });
  out = out.replace(/^export\s+(const|let|var)\s+(\w+)/gm, (_m, kw, name) => {
    exports.set(name, name);
    return `${kw} ${name}`;
  });
  out = out.replace(/^export\s+class\s+(\w+)/gm, (_m, name) => {
    exports.set(name, name);
    return `class ${name}`;
  });

  if (/^\s*(export|import)\s/m.test(out)) {
    const rest = out.split('\n').filter((l) => /^\s*(export|import)\s/.test(l));
    throw new Error(`Nicht umgewandelte Modulanweisung in ${id}:\n  ${rest.join('\n  ')}`);
  }

  const assigns = [...exports].map(([exp, loc]) => `  __exports[${JSON.stringify(exp)}] = ${loc};`).join('\n');
  return { code: `${out}\n${assigns}\n`, deps };
}

/* ---------------- Module einsammeln ---------------- */

const modules = new Map();
const queue = [ENTRY];
while (queue.length) {
  const id = queue.shift();
  if (modules.has(id)) continue;
  const { code, deps } = transform(read(id), id);
  modules.set(id, code);
  for (const d of deps) if (!modules.has(d)) queue.push(d);
}

/* ---------------- Zusammenbauen ---------------- */

const css = read('web/css/app.css');
const version = JSON.parse(read('package.json')).version;
const built = new Date().toISOString().slice(0, 10);

const runtime = `
var __defs = {};
var __cache = {};
function __reexport(target, src) {
  for (var k in src) { if (k !== 'default') target[k] = src[k]; }
}
function __req(id) {
  if (__cache[id]) return __cache[id].exports;
  var m = { exports: {} };
  __cache[id] = m;
  var def = __defs[id];
  if (!def) throw new Error('Modul nicht gefunden: ' + id);
  def(m.exports, __req);
  return m.exports;
}`;

const body = [...modules].map(([id, code]) =>
  `__defs[${JSON.stringify(id)}] = function (__exports, __req) {\n${code}\n};`).join('\n\n');

const script = `${runtime}\n\n${body}\n\n__req(${JSON.stringify(ENTRY)});`;

if (script.includes('</script')) throw new Error('Skript enthält eine schließende Script-Marke.');

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Armaturenbau MEGC – Produktionsplanung</title>
<meta name="generator" content="Armaturenbau MEGC ${version}, Einzeldatei-Fassung vom ${built}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='%2300727a'/><path d='M22 70V30h11v15h12V30h11v40H45V55H33v15z' fill='white'/></svg>">
<style>
${css}
</style>
</head>
<body>
<div id="app"><div class="empty">Anwendung wird geladen …</div></div>
<div class="toasts" id="toasts"></div>
<noscript><div class="note note--error" style="margin:20px">Für diese Anwendung muss JavaScript aktiviert sein.</div></noscript>
<script>
${script}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const target = path.join(ROOT, 'dist', 'Armaturenbau-MEGC.html');
fs.writeFileSync(target, html, 'utf8');

process.stdout.write(`Einzeldatei erstellt: ${target}\n`);
process.stdout.write(`  ${modules.size} Module, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB\n`);
