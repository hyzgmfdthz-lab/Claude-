/**
 * Anmeldung mit Kuerzel und Passwort.
 *
 * Jeder meldet sich mit seinem Kuerzel an. Beim ersten Mal vergibt man sein
 * Passwort selbst. Die Anmeldung ordnet Aenderungen Personen zu - sie ist
 * ausdruecklich keine Zugriffsbeschraenkung: alle duerfen dasselbe.
 */

import { h, mount, fmt } from '../ui.js';
import { api } from '../api.js';

/**
 * @param {any} app
 * @returns {HTMLElement}
 */
export function loginView(app) {
  const root = h('div.login');

  const state = {
    user: lastUser(),
    password: '',
    newPassword: '',
    repeat: '',
    mode: 'LOGIN',   // LOGIN | ERSTANMELDUNG
    busy: false,
    error: '',
    hint: '',
  };

  const draw = () => {
    mount(root, card(app, state, draw));
    const focus = root.querySelector('input[data-focus="1"]');
    if (focus instanceof HTMLInputElement) {
      focus.focus();
      focus.setSelectionRange(focus.value.length, focus.value.length);
    }
  };
  draw();
  return root;
}

function lastUser() {
  try { return localStorage.getItem('megc-armaturenbau:letztes-kuerzel') ?? ''; } catch { return ''; }
}
function rememberUser(id) {
  try { localStorage.setItem('megc-armaturenbau:letztes-kuerzel', id); } catch { /* egal */ }
}

function card(app, state, draw) {
  const submit = async () => {
    if (state.busy) return;
    const id = state.user.trim().toUpperCase();
    if (!id) { state.error = 'Bitte das Kürzel eintragen.'; draw(); return; }

    if (state.mode === 'ERSTANMELDUNG') {
      if (state.newPassword !== state.repeat) {
        state.error = 'Die beiden Passwörter stimmen nicht überein.';
        draw();
        return;
      }
    }

    state.busy = true;
    state.error = '';
    draw();
    try {
      const result = await api.login(state.mode === 'ERSTANMELDUNG'
        ? { user: id, newPassword: state.newPassword }
        : { user: id, password: state.password });

      // Erstanmeldung: es ist noch kein Passwort vergeben
      if (result?.needsPassword) {
        state.busy = false;
        state.mode = 'ERSTANMELDUNG';
        state.error = '';
        state.hint = `${result.hint} Damit melden Sie sich künftig an.`;
        draw();
        return;
      }

      rememberUser(id);
      await app.afterLogin(result);
    } catch (err) {
      state.busy = false;
      state.error = err?.message ?? 'Anmeldung nicht möglich.';
      state.password = '';
      draw();
    }
  };

  const onEnter = (e) => { if (e.key === 'Enter') submit(); };

  const feld = (label, key, opts = {}) => h('label.field',
    h('span', label),
    h('input', {
      type: opts.type ?? 'text',
      value: state[key],
      autocomplete: opts.autocomplete ?? 'off',
      'data-focus': opts.focus ? '1' : null,
      placeholder: opts.placeholder ?? '',
      disabled: state.busy,
      oninput: (e) => {
        state[key] = opts.upper ? e.target.value.toUpperCase() : e.target.value;
        if (opts.upper) e.target.value = state[key];
      },
      onkeydown: onEnter,
    }),
    opts.hint && h('div.field__hint', opts.hint));

  const erst = state.mode === 'ERSTANMELDUNG';

  return h('div.login__box',
    h('div.login__head',
      h('h1', 'Armaturenbau MEGC'),
      h('div.login__sub', 'Produktionsplanung · Hexagon Purus')),

    h('div.login__body',
      state.hint && h('div.note.note--info', state.hint),

      feld('Kürzel', 'user', {
        focus: !state.user || !erst, upper: true, placeholder: 'z. B. DOHE', autocomplete: 'username',
      }),

      erst
        ? h('div',
          feld('Neues Passwort', 'newPassword', { type: 'password', focus: true, autocomplete: 'new-password', hint: 'mindestens 6 Zeichen' }),
          feld('Passwort wiederholen', 'repeat', { type: 'password', autocomplete: 'new-password' }))
        : feld('Passwort', 'password', { type: 'password', focus: !!state.user, autocomplete: 'current-password' }),

      state.error && h('div.note.note--error', state.error),

      h('button.btn.btn--primary.login__go', { onclick: submit, disabled: state.busy },
        state.busy ? 'Einen Moment …' : (erst ? 'Passwort festlegen und öffnen' : 'Anmelden')),

      erst && h('button.btn.login__back', {
        onclick: () => { state.mode = 'LOGIN'; state.hint = ''; state.error = ''; draw(); },
      }, 'Zurück'),

      h('div.login__foot',
        'Passwort vergessen? Die Verwaltung kann es zurücksetzen; ',
        'danach vergeben Sie bei der nächsten Anmeldung ein neues.',
        h('br'),
        `Die Anmeldung gilt ${app.sessionHours ?? 12} Stunden, danach bitte erneut anmelden.`)));
}

/**
 * Meldung "Was ist seit Ihrem letzten Besuch passiert" (Aufholen).
 * @param {any} app
 * @param {{since:string|null, entries:any[], people:string[]}} data
 */
export function catchUpPanel(app, data) {
  if (!data || data.entries.length === 0) return null;
  return h('div.catchup',
    h('div.catchup__head',
      h('strong', `Seit Ihrem letzten Besuch: ${data.entries.length} Änderung${data.entries.length === 1 ? '' : 'en'}`),
      data.people.length ? h('span.faint', ` von ${data.people.join(', ')}`) : null,
      data.since ? h('span.faint', ` · zuletzt hier ${fmt.dateTime(data.since)}`) : null),
    h('ul.catchup__list',
      data.entries.slice(0, 12).map((e) => h('li',
        h('span.catchup__who', e.by || '–'),
        h('span.catchup__what', e.text),
        h('span.catchup__when', fmt.ago(e.at))))),
    data.entries.length > 12 && h('div.small.faint', `… und ${data.entries.length - 12} weitere. Alles unter „Stände".`),
    h('div.btn-row', { style: { marginTop: '8px' } },
      h('button.btn.btn--sm.btn--primary', { onclick: () => app.dismissCatchUp() }, 'Alles gelesen'),
      h('button.btn.btn--sm', { onclick: () => { app.navigate('states'); } }, 'Protokoll öffnen')));
}
