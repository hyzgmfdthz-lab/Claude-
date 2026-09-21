/**
 * Minimale Typangaben fuer die Node-Umgebung.
 *
 * Die Anwendung kommt ohne Abhaengigkeiten aus (auch ohne @types/node).
 * Damit die optionale Typpruefung (npm run typecheck) trotzdem nur echte
 * Fehler meldet, sind die benutzten Node-Globals hier grob erklaert.
 */
declare const process: any;
declare const Buffer: any;
declare const __dirname: string;
declare const __filename: string;
declare function require(id: string): any;

declare module 'node:test' {
  const test: any;
  export default test;
  export = test;
}
declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}
declare module 'node:fs' { const fs: any; export default fs; }
declare module 'node:os' { const os: any; export default os; }
declare module 'node:path' { const p: any; export default p; }
declare module 'node:url' { const u: any; export default u; }
declare module 'node:http' { const h: any; export default h; }
declare module 'node:zlib' { const z: any; export default z; }
declare module 'node:crypto' { const c: any; export default c; }
declare module 'node:child_process' { export const spawn: any; }
declare module 'node:sqlite' { export const DatabaseSync: any; }
