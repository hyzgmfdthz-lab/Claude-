import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addWeeks, diffDays, weekday, isoWeek, weekStart, mondayOf,
  dateRange, formatDE, parseDate, isValidDate, cmpDate, minDate, maxDate,
} from '../calendar.js';

test('Kalender: Datumsarithmetik', () => {
  assert.equal(addDays('2026-09-10', 1), '2026-09-11');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addWeeks('2026-10-02', -4), '2026-09-04');
  assert.equal(diffDays('2026-09-10', '2026-09-25'), 15);
  assert.equal(diffDays('2026-09-25', '2026-09-10'), -15);
});

test('Kalender: Schaltjahr', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2024-02-29'), true);
});

test('Kalender: Wochentage', () => {
  assert.equal(weekday('2026-09-07'), 1); // Montag
  assert.equal(weekday('2026-09-12'), 6); // Samstag
  assert.equal(weekday('2026-09-13'), 7); // Sonntag
});

test('Kalender: ISO-Kalenderwochen', () => {
  assert.equal(isoWeek('2026-01-01').week, 1);
  assert.equal(isoWeek('2026-09-10').key, '2026-W37');
  assert.equal(isoWeek('2026-12-31').week, 53);
  assert.equal(weekStart('2026-W41'), '2026-10-05');
  assert.equal(weekday(weekStart('2026-W41')), 1);
  assert.equal(mondayOf('2026-09-10'), '2026-09-07');
  // Rundlauf: jede Woche startet montags und ist konsistent
  for (let i = 0; i < 60; i++) {
    const d = addDays('2026-01-01', i * 7);
    assert.equal(weekStart(isoWeek(d).key), mondayOf(d), `Woche ${d}`);
  }
});

test('Kalender: Formatierung und Parsing', () => {
  assert.equal(formatDE('2026-10-02'), '02.10.2026');
  assert.equal(parseDate('02.10.2026'), '2026-10-02');
  assert.equal(parseDate('2.10.2026'), '2026-10-02');
  assert.equal(parseDate('2026-10-02'), '2026-10-02');
  assert.equal(parseDate('Unsinn'), null);
  assert.equal(formatDE('kaputt'), '-');
});

test('Kalender: Vergleich und Bereiche', () => {
  assert.equal(cmpDate('2026-01-01', '2026-01-02'), -1);
  assert.equal(cmpDate('2026-01-02', '2026-01-02'), 0);
  assert.equal(minDate('2026-05-01', '2026-04-01'), '2026-04-01');
  assert.equal(maxDate('2026-05-01', '2026-04-01'), '2026-05-01');
  assert.equal(dateRange('2026-09-07', '2026-09-13').length, 7);
});
