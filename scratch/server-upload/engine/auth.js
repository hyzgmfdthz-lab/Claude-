/**
 * Anmeldung: Benutzer, Passwoerter, Sitzungen.
 *
 * Die Anwendung kommt ohne Fremdbibliotheken aus. Deshalb sind SHA-256,
 * HMAC und PBKDF2 hier selbst umgesetzt - in reinem JavaScript, damit sie
 * in Node UND im Browser (Einzeldatei-Fassung) bitgleich rechnen. Ein
 * Datenbestand laesst sich dadurch zwischen beiden Fassungen austauschen,
 * ohne dass Passwoerter neu gesetzt werden muessen.
 *
 * WICHTIG, ausdruecklich festgehalten: Die Anmeldung ordnet Aenderungen
 * Personen zu und haelt Unbeteiligte fern. Sie ist KEIN Schutz gegen einen
 * ernsthaften Angreifer im Netz - die Verbindung ist unverschluesselt
 * (HTTP im Firmennetz), siehe docs/IT-FREIGABE.md.
 */

/* ------------------------------------------------------------------ *
 * SHA-256
 * ------------------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 einer Bytefolge.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} 32 Byte
 */
export function sha256(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;
  // Auffuellen nach FIPS 180-4: 0x80, Nullen, 64-Bit-Laenge
  const padded = new Uint8Array((((len + 9) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}

/* ------------------------------------------------------------------ *
 * HMAC und PBKDF2
 * ------------------------------------------------------------------ */

/** @param {Uint8Array} key @param {Uint8Array} message */
export function hmacSha256(key, message) {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018). Liefert dasselbe Ergebnis wie
 * crypto.pbkdf2Sync(..., 'sha256') - im Test nachgewiesen.
 *
 * @param {string} password
 * @param {string} salt
 * @param {number} iterations
 * @param {number} dkLen Laenge in Byte
 */
export function pbkdf2Sha256(password, salt, iterations, dkLen = 32) {
  const pw = encodeUtf8(password);
  const saltBytes = encodeUtf8(salt);
  const out = new Uint8Array(dkLen);
  const blocks = Math.ceil(dkLen / 32);
  for (let i = 1; i <= blocks; i++) {
    const input = new Uint8Array(saltBytes.length + 4);
    input.set(saltBytes);
    new DataView(input.buffer).setUint32(saltBytes.length, i, false);
    let u = hmacSha256(pw, input);
    const acc = u.slice();
    for (let c = 1; c < iterations; c++) {
      u = hmacSha256(pw, u);
      for (let k = 0; k < 32; k++) acc[k] ^= u[k];
    }
    out.set(acc.subarray(0, Math.min(32, dkLen - (i - 1) * 32)), (i - 1) * 32);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */

/** @param {string} text */
export function encodeUtf8(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out = [];
  for (const ch of String(text)) {
    let c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Zufallsbytes als Hex. Nutzt den Zufallsgenerator der Laufzeit. */
export function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return toHex(bytes);
}

/** Vergleich ohne fruehen Abbruch (Laufzeit verraet nichts ueber den Inhalt). */
export function equalsConstantTime(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Passwoerter
 * ------------------------------------------------------------------ */

/** Standardanzahl der Wiederholungen. Reine JS-Rechnung, daher massvoll. */
export const PBKDF2_ITERATIONS = 12000;

export const PASSWORD_MIN_LENGTH = 6;

/**
 * Erzeugt den gespeicherten Passwortnachweis. Das Passwort selbst wird
 * niemals gespeichert.
 * @param {string} password
 */
export function hashPassword(password, salt = randomHex(16), iterations = PBKDF2_ITERATIONS) {
  return {
    algo: 'PBKDF2-SHA256',
    salt,
    iterations,
    hash: toHex(pbkdf2Sha256(password, salt, iterations, 32)),
  };
}

/**
 * @param {string} password
 * @param {{salt:string, iterations:number, hash:string}|null|undefined} record
 */
export function verifyPassword(password, record) {
  if (!record || !record.hash || !record.salt) return false;
  const check = toHex(pbkdf2Sha256(password, record.salt, Number(record.iterations) || PBKDF2_ITERATIONS, 32));
  return equalsConstantTime(check, record.hash);
}

/** Prueft ein neues Passwort auf die Mindestanforderung. */
export function passwordProblem(password) {
  const p = String(password ?? '');
  if (p.trim().length < PASSWORD_MIN_LENGTH) {
    return `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Benutzer
 * ------------------------------------------------------------------ */

/** Kuerzel vereinheitlichen: Grossbuchstaben, keine Leerzeichen. */
export function normalizeUserId(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Kuerzel, das die Benutzerverwaltung uebernimmt.
 * Nur dieses Kuerzel darf Kuerzel anlegen/loeschen und Passwoerter
 * zuruecksetzen. Alles Fachliche duerfen alle gleichermassen.
 */
export const ADMIN_USER = 'DOHE';

/**
 * Benutzer des Armaturenbaus (Startbestand).
 * Weitere Kuerzel legt die Verwaltung an; sein Passwort vergibt jeder selbst
 * bei der ersten Anmeldung.
 */
export function defaultUsers() {
  const mk = (id, label = id, admin = false) => ({
    id, label, admin, password: null, active: true,
    createdAt: new Date().toISOString(), lastLoginAt: null, lastSeenAt: null,
  });
  return [
    mk('DOHE', 'DOHE (Verwaltung)', true),
    mk('STWUE'),
    mk('SVHE'),
    mk('KEER'),
    mk('KEMI'),
    mk('SAZA'),
  ];
}

/** Sichtbare Angaben eines Benutzers (ohne Passwortnachweis). */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    label: u.label ?? u.id,
    admin: !!u.admin,
    active: u.active !== false,
    hasPassword: !!u.password,
    createdAt: u.createdAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

/** Gueltigkeitsdauer einer Anmeldung: 12 Stunden. */
export const SESSION_HOURS = 12;

/** Erzeugt eine Sitzung. Gespeichert wird nur der Hashwert des Schluessels. */
export function createSession(userId, hours = SESSION_HOURS) {
  const token = randomHex(24);
  const now = Date.now();
  return {
    token,
    record: {
      tokenHash: toHex(sha256(encodeUtf8(token))),
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + hours * 3600 * 1000).toISOString(),
    },
  };
}

/** @param {string} token */
export function tokenHashOf(token) {
  return toHex(sha256(encodeUtf8(String(token ?? ''))));
}
