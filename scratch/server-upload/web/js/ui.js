/**
 * Kleine Oberflaechen-Hilfsbibliothek (ohne Fremdbibliotheken).
 */

/**
 * Erzeugt ein DOM-Element.
 * @param {string} tag  z.B. 'div.card__body' oder 'button.btn.btn--primary'
 * @param {any} [props]
 * @param {...any} children
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = String(tag).split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');

  // Zweites Argument ist nur dann ein Eigenschaftsobjekt, wenn es wirklich
  // ein einfaches Objekt ist. Sonst (auch bei 0, '' oder false) ist es ein Kind.
  const isProps = props !== null && props !== undefined && typeof props === 'object'
    && !Array.isArray(props) && !(props instanceof Node);
  if (!isProps) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = `${el.className} ${v}`.trim();
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(6)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Laengere Textwerte in Kennzahlen kleiner darstellen. */
function valueClass(value) {
  const len = String(value ?? '').length;
  if (len > 22) return ' kpi__value--xs';
  if (len > 12) return ' kpi__value--sm';
  return '';
}

/** SVG-Element erzeugen. */
export function s(tag, props = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k === 'className' ? 'class' : k, String(v));
  }
  for (const c of children.flat(6)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Inhalt eines Containers ersetzen. */
export function mount(container, ...nodes) {
  container.replaceChildren();
  append(container, nodes);
  return container;
}

/* ---------------- Formatierung ---------------- */

export const fmt = {
  /** @param {string|null} iso */
  date(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 10) return '–';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  },
  dateShort(iso) {
    if (!iso) return '–';
    const [, m, d] = iso.split('-');
    return `${d}.${m}.`;
  },
  /** @param {number} n */
  h(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    return `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} h`;
  },
  num(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    return Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  pct(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    return `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
  },
  /** Zeitpunkt aus ISO-Angabe: "12.09.2026, 14:20". */
  dateTime(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '–';
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  /** Grobe Zeitangabe: "vor 5 Minuten". */
  ago(iso) {
    if (!iso) return '–';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '–';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'gerade eben';
    if (min < 60) return `vor ${min} Min.`;
    const std = Math.round(min / 60);
    if (std < 24) return `vor ${std} Std.`;
    const tage = Math.round(std / 24);
    return tage <= 30 ? `vor ${tage} Tagen` : fmt.date(String(iso).slice(0, 10));
  },
  week(key) { return key ? `KW ${String(key).slice(-2)}` : '–'; },
  weekLong(key) { return key ? `KW ${String(key).slice(-2)}/${String(key).slice(0, 4)}` : '–'; },
  signed(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}${v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  },
};

export const STATUS = {
  FERTIG: { label: 'Fertig', cls: 'pill--grey' },
  IN_TIME: { label: 'In Time', cls: 'pill--green' },
  KRITISCH: { label: 'Kritisch', cls: 'pill--amber' },
  VERSPAETET: { label: 'Verspätet', cls: 'pill--red' },
  OHNE_TERMIN: { label: 'Ohne Termin', cls: 'pill--violet' },
};

/** @param {string} status */
export function statusPill(status) {
  const s0 = STATUS[status] ?? { label: status, cls: 'pill--grey' };
  return h(`span.pill.${s0.cls}`, s0.label);
}

/** Kennzeichnet einen zu validierenden Startparameter (§92). */
export function validateTag(title = 'Startwert – muss fachlich validiert werden.') {
  return h('span.tag-validate', { title }, 'zu validieren');
}

/* ---------------- Tabelle ---------------- */

/**
 * @param {{key:string,label:string,num?:boolean,width?:string,render?:(row:any)=>any}[]} columns
 * @param {any[]} rows
 * @param {{onRow?:(row:any)=>void, foot?:any[], empty?:string, compact?:boolean}} [opts]
 */
export function table(columns, rows, opts = {}) {
  const thead = h('thead', h('tr', columns.map((c) => h(`th${c.num ? '.num' : ''}`, { style: c.width ? { width: c.width } : null }, c.label))));
  const tbody = h('tbody',
    rows.length === 0
      ? h('tr', h('td', { colspan: columns.length }, h('div.empty', opts.empty ?? 'Keine Daten vorhanden.')))
      : rows.map((row) => {
        const tr = h(`tr${opts.onRow ? '.is-clickable' : ''}`,
          columns.map((c) => h(`td${c.num ? '.num' : ''}${c.mono ? '.mono' : ''}`, c.render ? c.render(row) : row[c.key])));
        if (opts.onRow) tr.addEventListener('click', () => opts.onRow(row));
        return tr;
      }));
  const parts = [thead, tbody];
  if (opts.foot) parts.push(h('tfoot', h('tr', opts.foot.map((v, i) => h(`td${columns[i]?.num ? '.num' : ''}`, v)))));
  return h('div.table-wrap', h(`table.tbl${opts.compact ? '.tbl--compact' : ''}`, parts));
}

/* ---------------- Karten ---------------- */

export function card(title, body, opts = {}) {
  return h('div.card',
    (title || opts.actions) && h('div.card__head',
      h('div', h('div.card__title', title), opts.sub && h('div.card__sub', opts.sub)),
      opts.actions && h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, opts.actions)),
    h(`div.card__body${opts.flush ? '.card__body--flush' : ''}`, body));
}

export function kpi(label, value, opts = {}) {
  return h(`div.kpi${opts.tone ? `.kpi--${opts.tone}` : ''}`,
    h('div.kpi__label', label),
    h(`div.kpi__value${valueClass(value)}`, value, opts.unit && h('small', ` ${opts.unit}`)),
    opts.delta !== undefined && opts.delta !== null
      && h(`div.kpi__delta.${opts.deltaTone === 'down' ? 'kpi__delta--down' : 'kpi__delta--up'}`, opts.delta),
    opts.hint && h('div.kpi__hint', opts.hint));
}

/* ---------------- Eingaben ---------------- */

/**
 * @param {string} label
 * @param {any} value
 * @param {(v:any)=>void} onChange
 */
export function field(label, value, onChange, opts = {}) {
  const input = h('input', {
    type: opts.type ?? 'text',
    value: value ?? '',
    min: opts.min, max: opts.max, step: opts.step, placeholder: opts.placeholder,
    disabled: opts.disabled,
    onchange: (e) => {
      const t = e.target;
      onChange(opts.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value);
    },
  });
  return h('label.field', h('span', label, opts.validate && validateTag(opts.validateHint)), input, opts.hint && h('div.small.faint', opts.hint));
}

export function selectField(label, value, options, onChange, opts = {}) {
  const sel = h('select', {
    disabled: opts.disabled,
    onchange: (e) => onChange(e.target.value),
  }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  return h('label.field', h('span', label, opts.validate && validateTag(opts.validateHint)), sel, opts.hint && h('div.small.faint', opts.hint));
}

export function checkField(label, checked, onChange, opts = {}) {
  return h('label.field', h('span', opts.groupLabel ?? ''), h('div.inline-check',
    h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) }),
    h('span', label)));
}

/* ---------------- Modal / Toast ---------------- */

/**
 * @param {{title:string, body:any, actions?:any[], wide?:boolean, onClose?:()=>void}} opts
 */
/**
 * Kachel der Uebersicht.
 *
 * Bewusst anders als `kpi`: eine Kachel traegt eine Zahl, die man in
 * einer halben Sekunde liest, und darunter einen Satz, der sie erklaert.
 * @param {string} label @param {any} value
 * @param {{tone?:string, hint?:any, small?:boolean, onclick?:(e:any)=>void, title?:string}} [opts]
 */
export function tile(label, value, opts = {}) {
  return h(`div.tile${opts.tone ? `.tile--${opts.tone}` : ''}${opts.onclick ? '.tile--clickable' : ''}`,
    { onclick: opts.onclick, title: opts.title },
    h('div.tile__label', label),
    h(`div.tile__value${opts.small ? '.tile__value--sm' : ''}`, value),
    opts.hint ? h('div.tile__hint', opts.hint) : null);
}

/**
 * Zuklappbare Gruppe.
 *
 * Die Abteilungsleitung hat die Menge der Stellschrauben ausdruecklich
 * gelobt und ihre Anordnung kritisiert. Deshalb sind sie gruppiert und
 * standardmaessig zu - offen ist nur, woran gerade gearbeitet wird.
 *
 * @param {string} title @param {any} body
 * @param {{open?:boolean, count?:string, onToggle?:(offen:boolean)=>void}} [opts]
 */
export function fold(title, body, opts = {}) {
  const inhalt = h('div.fold__body', body);
  let offen = opts.open !== false;
  const mark = h('span.fold__mark', offen ? '▾' : '▸');
  if (!offen) inhalt.style.display = 'none';
  const kopf = h('button.fold__head', {
    type: 'button',
    onclick: () => {
      offen = !offen;
      inhalt.style.display = offen ? '' : 'none';
      mark.textContent = offen ? '▾' : '▸';
      opts.onToggle?.(offen);
    },
  }, mark, h('span', title), opts.count ? h('span.fold__count', opts.count) : null);
  return h('div.fold', kopf, inhalt);
}

/**
 * Seitenpanel rechts.
 *
 * Ersetzt das Fenster in der Bildmitte: Wer einen Auftrag ansieht, soll
 * die Liste dahinter weiter sehen. Es ist immer nur EIN Panel offen.
 *
 * @param {{title:string, sub?:string, body:any, actions?:any, wide?:boolean,
 *   onClose?:()=>void}} opts
 */
export function panel(opts) {
  document.querySelectorAll('.panel').forEach((el) => el.remove());
  const box = h(`div.panel${opts.wide ? '.panel--wide' : ''}`,
    h('div.panel__head',
      h('div',
        h('div.panel__title', opts.title),
        opts.sub ? h('div.panel__sub', opts.sub) : null),
      h('button.panel__close', { title: 'Schließen', onclick: () => close() }, '×')),
    h('div.panel__body', opts.body),
    opts.actions ? h('div.panel__foot', opts.actions) : null);
  let zu = false;
  const close = () => {
    if (zu) return;
    zu = true;
    box.remove();
    document.body.classList.remove('has-panel');
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(box);
  document.body.classList.add('has-panel');
  return { close, element: box };
}

/** Ist gerade ein Seitenpanel offen? */
export function panelOpen() {
  return document.querySelectorAll('.panel').length > 0;
}

/** Alle Seitenpanels schliessen. */
export function closePanels() {
  document.querySelectorAll('.panel').forEach((el) => el.remove());
  document.body.classList.remove('has-panel');
}

/* ---------------- Hell und dunkel ---------------- */

/** Gespeicherte Vorliebe anwenden (hell, dunkel oder Systemeinstellung). */
export function applyTheme(mode) {
  const wahl = mode ?? localStorage.getItem('megc-theme') ?? 'auto';
  const dunkel = wahl === 'dark'
    || (wahl === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dunkel ? 'dark' : 'light';
  try { localStorage.setItem('megc-theme', wahl); } catch { /* privates Fenster */ }
  return wahl;
}

/** Aktuelle Wahl (auto, light, dark). */
export function themeChoice() {
  try { return localStorage.getItem('megc-theme') ?? 'auto'; } catch { return 'auto'; }
}

export function modal(opts) {
  const overlay = h('div.overlay');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h(`div.modal${opts.wide ? '.modal--wide' : ''}`,
    h('div.modal__head', h('div.modal__title', opts.title), h('button.modal__close', { onclick: close, title: 'Schließen' }, '×')),
    h('div.modal__body', opts.body),
    opts.actions && h('div.modal__foot', opts.actions));
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { close, element: box };
}

/**
 * Sicherheitsabfrage vor Datenaenderungen.
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message, confirmLabel = 'Übernehmen') {
  return choiceDialog(title, message, [
    { value: false, label: 'Abbrechen' },
    { value: true, label: confirmLabel, primary: true },
  ], false);
}

/**
 * Dialog mit mehreren gleichrangigen Antwortmöglichkeiten.
 * @param {string} title
 * @param {any} message
 * @param {{value:any,label:string,primary?:boolean,danger?:boolean}[]} choices
 * @param {any} [cancelValue] Ergebnis beim Schließen ueber X/Escape
 * @returns {Promise<any>}
 */
export function choiceDialog(title, message, choices, cancelValue = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };
    const m = modal({
      title,
      body: typeof message === 'string' ? h('div', { style: { whiteSpace: 'pre-wrap' } }, message) : message,
      actions: choices.map((c) => h(`button.btn${c.primary ? '.btn--primary' : ''}${c.danger ? '.btn--danger' : ''}`, {
        onclick: () => { finish(c.value); m.close(); },
      }, c.label)),
      onClose: () => finish(cancelValue),
    });
  });
}

export function toast(message, kind = '') {
  const el = h(`div.toast${kind ? `.toast--${kind}` : ''}`, message);
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, kind === 'error' ? 7000 : 3800);
}

/** Fortschrittsbalken am oberen Rand. */
export const progress = {
  el: null,
  start() {
    this.stop();
    this.el = h('div.loading-bar', { style: { width: '30%' } });
    document.body.appendChild(this.el);
    setTimeout(() => { if (this.el) this.el.style.width = '75%'; }, 120);
  },
  stop() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.style.width = '100%';
    setTimeout(() => el.remove(), 220);
  },
};

/** Lesbare Bezeichnung der Datenhaltung. @param {string} kind */
export function storageLabel(kind) {
  return {
    sqlite: 'Datenbank: SQLite',
    file: 'Datenbank: Dateiablage',
    browser: 'Speicher: Browser (lokal)',
    memory: 'Nur Arbeitsspeicher – bitte sichern!',
  }[kind] ?? 'Datenhaltung unbekannt';
}

/** Farbliche Bewertung einer Auslastung. */
export function utilTone(pct) {
  if (pct >= 100) return 'over';
  if (pct >= 90) return 'warn';
  return '';
}

export function bar(pct, opts = {}) {
  const p = Math.max(0, Math.min(150, Number(pct) || 0));
  return h('div.bar-h', { title: opts.title ?? `${Math.round(p)} %` },
    h(`i.${utilTone(p)}`, { style: { width: `${Math.min(100, p)}%` } }));
}
