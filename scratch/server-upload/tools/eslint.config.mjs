/**
 * Statische Pruefung (optional, nicht Teil der Anwendung).
 *
 * Faengt Fehler, die erst beim Oeffnen einer Ansicht auffallen wuerden:
 * vergessene Hilfsfunktionen, Tippfehler in Namen, doppelte Deklarationen.
 *
 *   npm run lint
 *
 * ESLint wird dabei einmalig per npx geladen und nicht installiert.
 */

const BROWSER = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  location: 'readonly', navigator: 'readonly', console: 'readonly', fetch: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  Blob: 'readonly', URL: 'readonly', FileReader: 'readonly', Node: 'readonly', Event: 'readonly',
  CustomEvent: 'readonly', DOMParser: 'readonly', XMLSerializer: 'readonly', performance: 'readonly',
  atob: 'readonly', btoa: 'readonly', crypto: 'readonly', structuredClone: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly',
  HTMLInputElement: 'readonly', HTMLElement: 'readonly', HTMLSelectElement: 'readonly',
  HTMLTextAreaElement: 'readonly', SVGElement: 'readonly', File: 'readonly', FormData: 'readonly',
  ResizeObserver: 'readonly', MutationObserver: 'readonly',
};

const NODE = {
  process: 'readonly', Buffer: 'readonly', console: 'readonly', require: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', structuredClone: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', performance: 'readonly',
  fetch: 'readonly', crypto: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'valid-typeof': 'error',
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
};

export default [
  {
    files: ['web/js/**/*.js', 'browser/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: BROWSER },
    rules,
  },
  {
    // In Playwright-Tests laufen einzelne Funktionen im Browser (page.evaluate).
    files: ['tools/*-test.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...NODE, ...BROWSER } },
    rules,
  },
  {
    files: ['**/test/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: NODE },
    rules,
  },
  {
    files: ['engine/**/*.js', 'server/**/*.js', 'tools/**/*.mjs', 'tools/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: NODE },
    rules,
  },
];
