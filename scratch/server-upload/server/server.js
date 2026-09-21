/**
 * Lokaler Anwendungsserver.
 *
 * Startet einen HTTP-Server auf dem eigenen Rechner, liefert die Oberflaeche
 * aus und stellt die Planungsengine als JSON-Schnittstelle bereit.
 * Es werden keine externen Dienste benoetigt.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { openStore, defaultDataDir } from './store.js';
import { createApi, ApiError } from './api.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const BROWSER_DIR = path.join(__dirname, '..', 'browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Liest den Rumpf einer Anfrage. */
function readBody(req, limitBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new ApiError('Datei zu groß.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/** Liest den Sitzungsschluessel aus Kopfzeile oder Cookie. */
function tokenOf(req, query) {
  const header = req.headers['x-megc-token'];
  if (header) return String(header);
  const cookie = String(req.headers.cookie ?? '')
    .split(';').map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE_NAME);
  if (cookie) return decodeURIComponent(cookie[1] ?? '');
  // Downloads laufen ueber einen normalen Link und koennen keine Kopfzeile setzen.
  return query?.get('token') ?? '';
}

const COOKIE_NAME = 'megc_sitzung';

/** Cookie fuer die Sitzung (nur dieser Server, kein Skriptzugriff). */
function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict`;
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

function sendDownload(res, buffer, filename, mime) {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(buffer),
  });
  res.end(buffer);
}

/**
 * Baut den Anwendungsserver.
 * @param {{dataDir?:string, port?:number, host?:string}} [options]
 */
export function createServer(options = {}) {
  const store = openStore(options.dataDir ?? defaultDataDir());
  const api = createApi(store);

  /*
   * Laufzeitangaben fuer die Oberflaeche: Rechnername und Port ergeben den
   * Einladungslink, den die Kollegen im Browser oeffnen. Der Rechnername
   * bleibt stabil, auch wenn sich die IP-Adresse aendert.
   */
  const runtime = {
    kind: 'server',
    host: options.host ?? process.env.MEGC_HOST ?? '127.0.0.1',
    port: Number(options.port ?? process.env.MEGC_PORT ?? 7311),
    hostname: os.hostname(),
    storage: store.kind,
    location: store.location,
  };
  runtime.network = runtime.host === '0.0.0.0' || runtime.host === '::';
  runtime.invite = runtime.network ? `http://${runtime.hostname}:${runtime.port}/` : null;
  runtime.addresses = runtime.network
    ? Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => `http://${n.address}:${runtime.port}/`)
    : [];

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(parsed.pathname);

    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(api, req, res, pathname, parsed.searchParams, runtime);
        return;
      }

      /*
       * Gemeinsame Browsermodule.
       *
       * Der Excel- und ZIP-Leser liegt unter "browser/" und wird von beiden
       * Fassungen gebraucht: von der Einzeldatei, die ihn eingebaut hat,
       * und von der Serverfassung, die ihn hier ausliefert. Zwei Kopien
       * desselben Lesers waeren die schlechtere Loesung.
       */
      if (pathname.startsWith('/browser/')) {
        const geteilt = path.join(BROWSER_DIR, path.normalize(pathname.slice('/browser/'.length)).replace(/^([/\\])+/, ''));
        if (!geteilt.startsWith(BROWSER_DIR)) { res.writeHead(403); res.end('Zugriff verweigert'); return; }
        if (fs.existsSync(geteilt) && fs.statSync(geteilt).isFile()) { sendFile(res, geteilt); return; }
      }

      // Statische Dateien
      let file = pathname === '/' ? '/index.html' : pathname;
      const target = path.join(WEB_DIR, path.normalize(file).replace(/^([/\\])+/, ''));
      if (!target.startsWith(WEB_DIR)) { res.writeHead(403); res.end('Zugriff verweigert'); return; }
      if (fs.existsSync(target) && fs.statSync(target).isFile()) { sendFile(res, target); return; }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 500) process.stderr.write(`[Fehler] ${err.stack ?? err.message}\n`);
      // Zusatzkennung (z. B. PASSWORT_FEHLT) muss die Oberflaeche erreichen,
      // damit sie den Sonderfall behandeln kann.
      sendJson(res, status, { error: err.message ?? 'Unbekannter Fehler', code: err.code });
    }
  });

  return { server, api, store };
}

/** @param {any} api */
async function handleApi(api, req, res, pathname, query, runtime = null) {
  const seg = pathname.split('/').filter(Boolean).slice(1); // ohne 'api'
  const method = req.method ?? 'GET';
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? JSON.parse((await readBody(req)).toString('utf8') || '{}')
    : {};
  const [a, b, c] = seg;

  const route = `${method} /${[a, b && (isId(b) ? ':id' : b), c].filter(Boolean).join('/')}`;
  const token = tokenOf(req, query);

  // Anmeldung: die einzigen Aufrufe ohne gueltige Sitzung
  switch (route) {
    case 'POST /login': {
      const result = api.login(body);
      return sendJson(res, 200, result, {
        'Set-Cookie': sessionCookie(result.token, (result.sessionHours ?? 12) * 3600),
      });
    }
    case 'GET /login-info':
      return sendJson(res, 200, api.loginInfo(query.get('user')));
    case 'POST /logout':
      api.logout(token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    case 'GET /session': {
      const found = api.sessionUser(token);
      if (!found) return sendJson(res, 401, { error: 'Nicht angemeldet.', code: 'AUTH' });
      return sendJson(res, 200, found);
    }
    default: break;
  }

  // Alles Weitere setzt eine gueltige Anmeldung voraus.
  const session = api.sessionUser(token);
  if (!session) {
    return sendJson(res, 401, { error: 'Bitte anmelden.', code: 'AUTH' });
  }
  api.setActor(session.user);

  switch (route) {
    case 'GET /state': return sendJson(res, 200, { ...api.state(), runtime });
    case 'GET /revision': return sendJson(res, 200, api.revision());
    case 'GET /analysis':
      return sendJson(res, 200, api.analysis(query.get('scenario'), {
        from: query.get('from') || undefined, to: query.get('to') || undefined,
      }));
    case 'GET /scenario-config': return sendJson(res, 200, api.scenarioConfig(query.get('scenario')));
    case 'GET /validate': return sendJson(res, 200, api.validate(query.get('scenario')));
    case 'GET /required-staff': return sendJson(res, 200, api.requiredStaff(query.get('scenario')));
    case 'GET /backups': return sendJson(res, 200, api.backups());

    case 'POST /projects': return sendJson(res, 201, api.createProject(body));
    case 'POST /projects/reorder': return sendJson(res, 200, api.reorderProjects(body.ids));
    case 'PUT /projects/:id': return sendJson(res, 200, api.updateProject(b, body));
    case 'DELETE /projects/:id': return sendJson(res, 200, api.deleteProject(b));
    case 'POST /projects/:id/duplicate': return sendJson(res, 201, api.duplicateProject(b));

    case 'PUT /templates/:id': return sendJson(res, 200, api.updateTemplate(b, body));
    case 'POST /templates/reset': return sendJson(res, 200, api.resetTemplates());
    case 'PUT /workplaces': return sendJson(res, 200, api.updateWorkplaces(body.workplaces));

    case 'POST /scenarios': return sendJson(res, 201, api.createScenario(body));
    case 'PUT /scenarios/:id': return sendJson(res, 200, api.updateScenario(b, body));
    case 'DELETE /scenarios/:id': return sendJson(res, 200, api.deleteScenario(b));
    case 'POST /scenarios/:id/reset': return sendJson(res, 200, api.resetScenario(b));
    case 'POST /scenarios/:id/activate': return sendJson(res, 200, api.setActiveScenario(b));
    case 'POST /scenarios/:id/apply': return sendJson(res, 200, api.applyProposal(b, body));

    case 'POST /optimize': return sendJson(res, 200, api.optimize(body.scenario, body));
    case 'POST /impact': return sendJson(res, 200, api.impact(body.scenario, body.base));
    case 'POST /compare': return sendJson(res, 200, api.compare(body.ids));
    case 'POST /import': return sendJson(res, 200, api.importProjects(body));

    case 'POST /backups': return sendJson(res, 201, api.createBackup(body.label));
    case 'POST /backups/:id/restore': return sendJson(res, 200, api.restoreBackup(b));
    case 'POST /reset': return sendJson(res, 200, api.resetAll());

    // Staende, Protokoll, Aufholen
    case 'GET /states': return sendJson(res, 200, api.states());
    case 'POST /states': return sendJson(res, 201, api.saveState(body));
    case 'GET /states/:id': return sendJson(res, 200, api.stateSummary(b));
    case 'POST /states/:id/load': return sendJson(res, 200, api.loadState(b));
    case 'DELETE /states/:id': return sendJson(res, 200, api.deleteState(b));
    case 'GET /history': return sendJson(res, 200, api.history(query.get('scenario'), Number(query.get('limit')) || 60));
    case 'POST /history/undo': return sendJson(res, 200, api.undo(body.scenario));
    case 'POST /history/redo': return sendJson(res, 200, api.redo(body.scenario));
    case 'POST /history/jump': return sendJson(res, 200, api.jumpToHistory(body.id));
    case 'POST /history/entry': return sendJson(res, 200, api.updateHistoryEntry(body.id, body));
    case 'GET /what-helps': return sendJson(res, 200, api.whatHelps(query.get('scenario')));
    case 'GET /team': return sendJson(res, 200, api.team(query.get('scenario')));
    case 'GET /assignment': return sendJson(res, 200, api.assignment(query.get('scenario'), {
      from: query.get('from') || undefined, to: query.get('to') || undefined,
    }));
    case 'GET /person-plan': return sendJson(res, 200, api.personPlan(query.get('scenario'), query.get('person'), query.get('week')));
    case 'POST /attendance/parse': return sendJson(res, 200, api.parseAttendance(body.text, {
      year: body.year, codes: body.codes ?? {},
    }));
    case 'POST /attendance/apply': return sendJson(res, 200, api.applyAttendance(body.scenario, body));
    case 'GET /belegung': return sendJson(res, 200, api.belegung(query.get('scenario'), {
      mode: query.get('mode') || undefined,
      from: query.get('from') || undefined,
      to: query.get('to') || undefined,
    }));
    // Schichtplanung der Arbeitsplaetze
    case 'GET /schichtvorschlag': return sendJson(res, 200, api.schichtvorschlag(query.get('scenario')));
    case 'POST /schichtvorschlag/apply': return sendJson(res, 201, api.applySchichten(body.scenario, body));

    // Mehraufwand
    case 'GET /mehraufwand': return sendJson(res, 200, api.mehraufwand(query.get('scenario')));
    case 'POST /mehraufwand/apply': return sendJson(res, 201, api.applyMehraufwand(body.scenario, body));

    // Bestaetigte Befunde der Plausibilitaetspruefung
    case 'GET /acks': return sendJson(res, 200, api.acks());
    case 'POST /acks': return sendJson(res, 201, api.ackFinding(body));
    case 'POST /acks/delete': return sendJson(res, 200, api.unackFinding(body.key));
    case 'POST /acks/clear': return sendJson(res, 200, api.clearAcks());
    case 'GET /views': return sendJson(res, 200, api.views());
    case 'POST /views': return sendJson(res, 201, api.saveView(body));
    case 'POST /views/delete': return sendJson(res, 200, api.deleteView(body.id));
    case 'GET /reference': return sendJson(res, 200, api.reference(query.get('scenario')));
    case 'POST /reference': return sendJson(res, 200, api.setReferenceState(body.id ?? null));
    case 'POST /reference/fix': return sendJson(res, 201, api.fixCurrentAsReference(body));
    case 'GET /target': return sendJson(res, 200, api.target(query.get('scenario')));
    case 'POST /target': return sendJson(res, 200, api.setTargetState(body.id ?? null));
    case 'POST /target/fix': return sendJson(res, 201, api.fixCurrentAsTarget(body));
    case 'POST /target/promote': return sendJson(res, 200, api.promoteTargetToReference());
    case 'GET /changelog': return sendJson(res, 200, api.changeLog(Number(query.get('limit')) || 200));
    case 'GET /catch-up': return sendJson(res, 200, api.catchUp(token));
    case 'POST /seen': return sendJson(res, 200, api.markSeen(token));
    case 'POST /scenarios/:id/current-plan': return sendJson(res, 200, api.setCurrentPlan(b));
    case 'POST /current-plan': return sendJson(res, 200, api.setCurrentPlan(body.id ?? null));

    // Regeln der Abteilung
    case 'GET /rules': return sendJson(res, 200, api.rules(query.get('scenario')));
    case 'GET /rules/empty': return sendJson(res, 200, api.emptyRule(query.get('type')));
    case 'POST /rules/parse': return sendJson(res, 200, api.parseRule(body.text));
    case 'POST /rules': return sendJson(res, 201, api.createRule(body));
    case 'PUT /rules/:id': return sendJson(res, 200, api.updateRule(b, body));
    case 'DELETE /rules/:id': return sendJson(res, 200, api.deleteRule(b));
    case 'POST /rules/:id/enabled': return sendJson(res, 200, api.setRuleEnabled(b, body.enabled));
    case 'POST /rules/:id/impact': return sendJson(res, 200, api.ruleImpact(b, body.scenario));

    // Benutzerverwaltung
    case 'GET /users': return sendJson(res, 200, api.users());
    case 'POST /users': return sendJson(res, 201, api.createUser(body));
    case 'PUT /users/:id': return sendJson(res, 200, api.updateUser(b, body));
    case 'DELETE /users/:id': return sendJson(res, 200, api.deleteUser(b));
    case 'POST /users/:id/reset-password': return sendJson(res, 200, api.resetUserPassword(b));
    case 'POST /password': return sendJson(res, 200, api.changePassword(token, body));

    default: break;
  }

  // Downloads
  if (method === 'GET' && a === 'export') {
    const scenario = query.get('scenario');
    const format = query.get('format') ?? 'xlsx';
    const type = query.get('type') ?? 'projects';
    const stamp = new Date().toISOString().slice(0, 10);
    if (b === 'comparison') {
      const ids = (query.get('ids') ?? '').split(',').filter(Boolean);
      return sendDownload(res, api.exportComparison(ids), `Szenariovergleich_${stamp}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    if (b === 'template') {
      return sendDownload(res, api.importTemplate(), 'Importvorlage_Projekte.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    if (format === 'csv') {
      return sendDownload(res, Buffer.from(api.exportCsv(scenario, type), 'utf8'),
        `Armaturenbau_${type}_${stamp}.csv`, 'text/csv; charset=utf-8');
    }
    return sendDownload(res, api.exportWorkbook(scenario), `Armaturenbau_Planung_${stamp}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  throw new ApiError(`Unbekannte Schnittstelle: ${method} ${pathname}`, 404);
}

/*
 * Feste Wegstuecke der Schnittstelle.
 *
 * Der zweite Abschnitt eines Pfades ist normalerweise eine ID
 * ("/projects/PRJ-123"). Alles, was hier steht, ist stattdessen ein
 * festes Wort ("/views/delete") - sonst wuerde daraus ":id" und der
 * Aufruf liefe ins Leere.
 */
const RESERVED = new Set(['reorder', 'reset', 'template', 'comparison', 'restore', 'activate', 'apply',
  'undo', 'redo', 'jump', 'entry', 'delete', 'clear', 'promote',
  'duplicate', 'load', 'current-plan', 'reset-password', 'parse', 'empty', 'enabled', 'impact', 'fix']);
function isId(s) { return !RESERVED.has(s); }

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

/** Oeffnet den Standardbrowser. */
function openBrowser(target) {
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '""', target] : [target];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    // Fehlt das Hilfsprogramm (z. B. xdg-open), darf das den Server nicht beenden.
    child.on('error', () => { /* Browser bitte manuell oeffnen */ });
    child.unref();
  } catch { /* Browser konnte nicht geöffnet werden - kein Fehler */ }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.env.MEGC_PORT ?? 7311);
  const host = process.env.MEGC_HOST ?? '127.0.0.1';
  const { server, store } = createServer();
  const wildcard = host === '0.0.0.0' || host === '::';
  server.listen(port, host, () => {
    // Beim Netzbetrieb ist 0.0.0.0 keine aufrufbare Adresse - lokal 127.0.0.1 nutzen.
    const target = `http://${wildcard ? '127.0.0.1' : host}:${port}/`;
    const lines = [
      '',
      '  Armaturenbau MEGC - Produktionsplanung',
      '  ======================================',
      `  Oberfläche : ${target}`,
      `  Datenbank  : ${store.location} (${store.kind})`,
    ];
    if (wildcard) {
      const nets = os.networkInterfaces();
      const addresses = Object.values(nets).flat()
        .filter((n) => n && n.family === 'IPv4' && !n.internal)
        .map((n) => `http://${n.address}:${port}/`);
      lines.push('', '  Mehrbenutzerbetrieb aktiv. Diesen Link an die Kollegen geben:',
        `    http://${os.hostname()}:${port}/`,
        '', '  Falls der Rechnername nicht auflöst, diese Adressen verwenden:');
      for (const adr of addresses) lines.push(`    ${adr}`);
      lines.push('', '  Dieses Fenster muss geöffnet bleiben, solange gearbeitet wird.');
    } else {
      lines.push('', '  Nur auf diesem Rechner erreichbar.',
        '  Für den Zugriff von Kollegen: Start-Armaturenbau-Netzwerk.bat verwenden.');
    }
    lines.push('', '  Zum Beenden dieses Fenster schließen oder Strg+C drücken.', '', '');
    process.stdout.write(lines.join('\n'));
    if (process.env.MEGC_NO_BROWSER !== '1') openBrowser(target);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`\n  Der Port ${port} ist belegt. Läuft die Anwendung bereits?\n  Alternativ mit anderem Port starten: set MEGC_PORT=7312\n\n`);
      process.exit(1);
    }
    throw err;
  });
}
