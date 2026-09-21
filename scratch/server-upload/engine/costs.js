/**
 * Kosten der Kapazitaet.
 *
 * Grundlage sind die Angaben der Abteilungsleitung (09/2026):
 *   Stundenlohn Stamm      19-26 EUR (Mittelwert hinterlegt, je Person aenderbar)
 *   Arbeitgeberanteile     Faktor 1,3 auf den Lohn
 *   Mehrarbeit und Samstag je +35 % auf den Lohn
 *   Spaetschicht           24 EUR je Schicht, anteilig je Stunde
 *   Nachtschicht           +40 % auf den Lohn
 *   Leiharbeit             45-65 EUR je Stunde (Rechnungssatz, 55 hinterlegt)
 *
 * Wichtig: Beim Leiharbeiter ist der Satz ein RECHNUNGSSATZ - dort kommen
 * keine Arbeitgeberanteile mehr dazu. Beim eigenen Personal ist es der
 * Lohn, auf den der Faktor wirkt. Ohne diese Unterscheidung waere
 * Leiharbeit um 30 % zu teuer gerechnet, und jeder Vergleich waere falsch.
 *
 * Die Kosten werden ausschliesslich AUSGEWIESEN, nie optimiert: Die
 * Termintreue steht ueber den Kosten (Vorgabe der Abteilungsleitung).
 */

import { round2 } from './model.js';
import { rateOf } from './team.js';

/** Zuschlagsarten einer Arbeitsstunde. */
export const HOUR_KINDS = {
  REGULAR: 'Normalstunde',
  OVERTIME: 'Mehrarbeit',
  SATURDAY: 'Samstagsarbeit',
  LATE: 'Spätschicht',
  NIGHT: 'Nachtschicht',
};

/** Stunden je Schicht - Grundlage fuer die anteilige Spaetschichtzulage. */
const SHIFT_HOURS = 7.5;

/**
 * Kosten einer Arbeitsstunde.
 *
 * @param {any} config
 * @param {any} person Person aus der Mannschaft (oder null fuer den Mittelwert)
 * @param {keyof typeof HOUR_KINDS} [kind]
 */
export function hourlyCost(config, person, kind = 'REGULAR') {
  const c = config?.costs ?? {};
  const leihe = person?.kind === 'LEIHE';
  const satz = person ? rateOf(config, person) : Number(c.baseRate ?? 22.5);
  // Rechnungssatz der Leiharbeit enthaelt die Nebenkosten schon
  const faktor = leihe ? 1 : Math.max(1, Number(c.employerFactor ?? 1));
  const grund = satz * faktor;

  switch (kind) {
    case 'OVERTIME':
      return round2(grund * (1 + Number(c.overtimeSurchargePercent ?? 0) / 100));
    case 'SATURDAY':
      return round2(grund * (1 + Number(c.saturdaySurchargePercent ?? 0) / 100));
    case 'LATE': {
      const zulage = Number(c.lateShiftAllowancePerShift ?? 0) / SHIFT_HOURS;
      return round2(grund + (leihe ? 0 : zulage * faktor));
    }
    case 'NIGHT':
      return round2(grund * (1 + Number(c.nightSurchargePercent ?? 0) / 100));
    default:
      return round2(grund);
  }
}

/**
 * Kostenuebersicht fuer Oberflaeche und Bericht.
 * @param {any} config
 */
export function costRates(config) {
  const c = config?.costs ?? {};
  const stamm = { kind: 'STAMM' };
  const leihe = { kind: 'LEIHE' };
  return {
    currency: c.currency ?? 'EUR',
    wage: round2(Number(c.baseRate ?? 22.5)),
    employerFactor: Number(c.employerFactor ?? 1),
    rows: [
      {
        key: 'REGULAR',
        label: 'Normalstunde (Stamm)',
        cost: hourlyCost(config, stamm, 'REGULAR'),
        note: `Lohn ${round2(Number(c.baseRate ?? 22.5))} € × Faktor ${Number(c.employerFactor ?? 1)}`,
      },
      {
        key: 'OVERTIME',
        label: 'Mehrarbeit',
        cost: hourlyCost(config, stamm, 'OVERTIME'),
        note: `+${Number(c.overtimeSurchargePercent ?? 0)} % auf den Lohn`,
      },
      {
        key: 'SATURDAY',
        label: 'Samstagsarbeit',
        cost: hourlyCost(config, stamm, 'SATURDAY'),
        note: `+${Number(c.saturdaySurchargePercent ?? 0)} % auf den Lohn`,
      },
      {
        key: 'LATE',
        label: 'Spätschicht',
        cost: hourlyCost(config, stamm, 'LATE'),
        note: `${Number(c.lateShiftAllowancePerShift ?? 0)} € je Schicht, anteilig je Stunde`,
      },
      {
        key: 'NIGHT',
        label: 'Nachtschicht',
        cost: hourlyCost(config, stamm, 'NIGHT'),
        note: `+${Number(c.nightSurchargePercent ?? 0)} % auf den Lohn`,
      },
      {
        key: 'TEMP',
        label: 'Leiharbeiter',
        cost: hourlyCost(config, leihe, 'REGULAR'),
        note: 'Rechnungssatz, Spanne 45–65 € – Arbeitgeberanteile sind enthalten',
      },
    ],
  };
}

/**
 * Was ist guenstiger: eine Mehrarbeitsstunde oder eine Leiharbeitsstunde?
 * Diese eine Zahl entscheidet die Argumentation beim Betriebsrat.
 * @param {any} config
 */
export function overtimeVersusTemp(config) {
  const mehrarbeit = hourlyCost(config, { kind: 'STAMM' }, 'OVERTIME');
  const leihe = hourlyCost(config, { kind: 'LEIHE' }, 'REGULAR');
  return {
    overtime: mehrarbeit,
    temp: leihe,
    difference: round2(leihe - mehrarbeit),
    cheaper: mehrarbeit <= leihe ? 'OVERTIME' : 'TEMP',
    text: mehrarbeit <= leihe
      ? `Mehrarbeit ist mit ${mehrarbeit} €/h um ${round2(leihe - mehrarbeit)} €/h günstiger als Leiharbeit (${leihe} €/h).`
      : `Leiharbeit ist mit ${leihe} €/h um ${round2(mehrarbeit - leihe)} €/h günstiger als Mehrarbeit (${mehrarbeit} €/h).`,
  };
}
