# Rücklieferung Runde 01 – Armaturenbau MEGC

Stand: 21.09.2026. Bearbeitet gegen `Claude-Planungslogik-Runde-01.md` und das
zugehörige Prüfpaket, direkt in der gelieferten Originaldatei
`Armaturenbau-MEGC (5).html` (kein Neubau, keine Änderung der Sichtbarkeit).

## 1. Ausgelieferte Datei

- **Datei:** `original/Armaturenbau-MEGC.html`
- **Commit:** `c863874a48d7117c4dfba4fbc6c8034b91a7d96c` (Branch `claude/relaxed-fermat-9lvn1d`)
- **SHA-256:** `eb3cef927a417837fef3c7be813313dd5047b49483c4c1588d4763271573ee81`
- **Datenexport:** vollständig in der HTML enthalten (`seedDataset()` in
  `engine/seed.js`, unverändert). Es wurden keine Projekt-, Mannschafts- oder
  Regeldaten verändert – nur Rechenlogik in `engine/*.js`. Browserlokale
  Eingaben aus dem privaten Stand sind hier nicht enthalten (kein Zugriff
  darauf); das gilt weiterhin als Einschränkung dieser Prüfung.
- Der frühere Bezugscommit `45b2c1b` aus dem abgebrochenen Claude-Verlauf
  wurde **nicht** als Grundlage verwendet – diese Datei ist unabhängig von der
  Original-Baseline aus dem Prüfbericht aus neu aufgebaut, weil die
  zwischenzeitliche Datei nicht mehr verfügbar war ("kann nichts mehr
  runterladen").

## 2. Änderungsliste je Audit-/Test-ID

| ID | Vorheriges Verhalten | Änderung | Gegenprobe | Ergebnis |
|---|---|---|---|---|
| Kritisch01 | `otdOriginal`/`zielErreicht` übersprangen Aufträge ohne `forecastFinish` im Zähler, ließen sie aber im Nenner – nicht fertigstellbare Aufträge zählten rechnerisch als pünktlich. | `engine/kpi.js`, `dashboardKpis()`: ein Auftrag ohne `forecastFinish` zählt jetzt als verspätet gegen die Erstzusage, sofern eine Erstzusage vorliegt. | `scratch/t01.js` (T01) | **Bestanden** |
| Kritisch02 | Terminierung rechnete Qualifikationskapazität je Arbeitsgang unabhängig als Anteil am Gesamtpool – dieselbe Person konnte rechnerisch in zwei Arbeitsgängen gleichzeitig stecken. | `engine/scheduler.js`: geteiltes, tagesweises Personen-Stundenkonto (`ctx.personRest`), aus `teamOn()` aufgebaut und beim Vergeben von Stunden je Arbeitsgang gemeinsam verringert. Neue Hilfsfunktion `personEffectiveFactor()` in `engine/team.js`. | `scratch/t02.js` (T02) | **Bestanden** |
| Hoch04 | Ende-Start-Abhängigkeiten prüften nur `remainingUnits<=0`, nicht die Uhrzeit – zwei volle Arbeitstage konnten auf denselben Kalendertag rutschen. | `engine/scheduler.js`, `allowanceFor()`: wird der Vorgänger HEUTE fertig, darf der Nachfolger heute nur noch die Reststunden des Tagesfensters nutzen, die dem Vorgänger nach seiner Fertigstellung noch übrig geblieben wären. | `scratch/t04.js` (T04), `scratch/t05.js` (T05) | **Bestanden** |
| Hoch05 | Leihkosten multiplizierten den Netto-Kapazitätsgewinn (nach Einarbeitung/Betreuung) mit dem Rechnungssatz statt der bezahlten Stunden. | `engine/mehraufwand.js`: neue Funktion `abrechnungsStunden()` (volle Wochen × vereinbarte Wochenarbeitszeit); Kostenzeile „Leiharbeiter" in `alleMassnahmen()` und `schnuerePaket()` nutzt sie jetzt statt des Kapazitätsgewinns. | `scratch/t13.js` (T13: 900 Rechnungsstunden, 49.500 €); Baseline-Kontrollrechnung 74.250 € statt 60.885 € (siehe unten) | **Bestanden** |
| Mittel09 | Persönliches Budget im Einsatzplan (`engine/assignment.js`) nutzte die reine Anwesenheitsdauer (7,5 h), nicht die produktiven Stunden der Terminierung. | `rest[p.id]` nutzt jetzt dieselbe Formel wie `ctx.personRest` im Terminierer (Zeitanteil × Ramp × Anwesenheit × Produktivität). | `scratch/t06.js` (T06) | **Bestanden** |
| Mittel10 | Der Einsatzplan iterierte nur über Tage mit mindestens einer Buchung – komplett arbeitsfreie Tage fehlten samt Grund. | `engine/assignment.js`: Hauptschleife läuft jetzt über den vollständigen Arbeitskalender (`arbeitstage`, alle Nicht-OFF-Tage im gewählten Zeitraum), nicht mehr nur über `alloc.keys()`. | `scratch/t07.js` (T07) | **Bestanden** |
| Bedingt11 | Eine arbeitsgangspezifische Frühstart-Regel (`releaseWeeksBeforeDue`) konnte eine ausdrücklich gemeldete Fehlteil-Sperre (`missingParts===true`) vollständig umgehen. | `engine/scheduler.js`, `opReleaseDate()`: eine gemeldete Fehlteil-Sperre gilt jetzt als harte Untergrenze für den ganzen Auftrag, unabhängig von einer arbeitsgangspezifischen Frühstart-Regel. Die routinemäßige Materialgrenze für Heften/Orbital bleibt unverändert arbeitsgangspezifisch. | `scratch/t09.js` (T09) | **Bestanden** |
| Hoch03 | 12-/14-h-Fenster sollten angeblich auf eine Schicht zurückfallen. | Geprüft, **kein Fehler gefunden** – `schichtBesetzungVon()`/`platzStundenAm()` (bereits in der Datei vorhanden) bilden Schichtbesetzung und Fensterlänge bereits korrekt ab; zusammen mit dem neuen Personen-Stundenkonto (Kritisch02) ergibt sich die erwartete Kapazität. | `scratch/t03.js` (T03: 6 Schweißer/6 Maschinen/14h-Fenster/2 Schichten → 42 h) | **Bestanden** (ohne Codeänderung) |
| Hoch10 (Hydrofenster/Samstag) | Sollte angeblich am Samstag öffnen. | Geprüft, **kein Fehler gefunden** – `hydroWindowOpen()` ist unabhängig von der Samstagsaktivierung. | Direkter Test gegen `dayCapacity()` an einem aktivierten Samstag → `HYDRO capUnits=0`, `limiter=HYDRO_WINDOW` | **Bestanden** (ohne Codeänderung) |

## 3. Vorher/Nachher auf identischem Bestand (37 Projekte, Stichtag 10.09.2026)

| Kennzahl | Vorher (Original) | Nachher |
|---|---|---|
| OTD (aktuell) | 10,81 % | 10,81 % (unverändert) |
| OTD gegen Erstzusage / `zielErreicht` | 10,81 % / false | 10,81 % / false (Kritisch01 betraf hier keinen konkreten Auftrag der Baseline, siehe unten) |
| Summe Verspätungstage | 1.258 | **1.259** (+1) |
| Leihkosten-Beispielrechnung (2 Leihkräfte, 12 Wochen) | 60.885 € (Netto-Kapazitätsgewinn × Satz) | **74.250 €** (900 Rechnungsstunden × 55 €) |

Die Verschiebung von 1.258 auf 1.259 Verspätungstage kommt ausschließlich aus
der Hoch04-Korrektur (Zeitachse bei Ende-Start-Abhängigkeiten): mindestens ein
Auftrag im Bestand hatte eine kurze Kette, die vorher fälschlich am selben Tag
durchlief. Das ist eine erwartete, kleine Verschlechterung durch eine
Korrektur, kein Ausreißer. Kritisch01 ändert in der Baseline selbst nichts,
weil im aktuellen Bestand kein Auftrag ohne `forecastFinish` (nicht
fertigstellbar) vorkommt – der Fehler ist aber real und in der Gegenprobe
(T01) nachgewiesen; er wird bei den weiteren, noch offenen Korrekturen
(v. a. Kritisch02 in vollem Umfang) relevant, sobald Aufträge im Horizont
nicht mehr fertig werden.

Die Leihkosten-Beispielrechnung entspricht exakt der im ChatGPT-Verlauf
genannten Zielzahl (74.250 € statt 60.885 €) – unabhängig nachgerechnet, nicht
übernommen.

## 4. Ausführbare Tests

Alle Gegenproben liegen als eigenständige Node-Skripte im Repository
(`scratch/t01.js` … `scratch/t09.js`) und laufen gegen den aus der HTML
extrahierten Engine-Code (`scratch/extract.sh` + `scratch/engine-bundle.js`,
reproduzierbar, keine UI-Abhängigkeit). Frischer Lauf gegen den oben
genannten Commit:

```
T01 PASSED   (Kritisch01 – OTD ohne Fertigstellung)
T02 PASSED   (Kritisch02 – gemeinsame Qualifikation)
T03 PASSED   (Hoch03 – echte Teil-/Folgeschicht, 42 h)
T04 PASSED   (Hoch04 – serieller Ganztag, kein Doppelabschluss)
T05 PASSED   (Hoch04-Gegenstück – kurzer serieller Ablauf, selber Tag erlaubt)
T06 PASSED   (Mittel09 – persönliches Budget 7 statt 7,5 h)
T07 PASSED   (Mittel10 – vollständiger Kalender inkl. arbeitsfreier Tage)
T09 PASSED   (Bedingt11 – Fehlteilsperre haelt gegen Fruehstart-Regel)
T13 PASSED   (Hoch05 – Rechnungsstunden statt Kapazitätsgewinn, 900 h / 49.500 €)
```

Zusätzlich nach **jeder** Einzeländerung erneut geprüft: die volle Baseline
(37 Projekte) reproduziert weiterhin ein plausibles, nachvollziehbares
Ergebnis (siehe Tabelle oben) – keine der Korrekturen hat die Rechnung zum
Absturz gebracht oder eine der bereits bestandenen Gegenproben wieder
zerstört.

**Nicht Bestandteil dieses Laufs:** die bestehenden 411 UI-/Oberflächentests
der Originaldatei wurden nicht erneut ausgeführt (kein Zugriff auf die
zugehörige Test-Infrastruktur/den Build außerhalb der HTML). Die hier
gezeigten Gegenproben sind Motor-Gegenproben (Node, isoliert), keine
Oberflächentests.

## 5. Offene Punkte – nicht in dieser Runde bearbeitet

Diese Runde hat sich an die Priorität aus Abschnitt 5 des Arbeitsauftrags
gehalten (Kritisch02 zuerst, dann die eng umrissenen Punkte 04/05/09/10/11).
**Nicht bearbeitet** und weiterhin offen:

- **R06 „feste Schicht, bewegliche Aufträge"**: keine eigene Codeänderung
  vorgenommen. Nach Durchsicht von `engine/scheduler.js` (Pool-basierte
  Terminierung nach Priorität, unabhängig von Schichten) und
  `engine/assignment.js` (schichttreue Zuordnung über `pinnedOps`/
  `schichtVon`) erscheint die Regel durch das Zusammenspiel beider Module
  bereits strukturell erfüllt: die Terminierung füllt freie Kapazität mit
  dem nächsten ausführbaren Auftrag (unabhängig von dessen Priorität-Rang,
  solange Vorgänger-/Freigabebedingungen erfüllt sind), die Zuordnung
  versetzt niemanden in eine andere Schicht. Das ist **keine unabhängig
  geprüfte Aussage** mit eigener Gegenprobe (T08) – nur eine Einschätzung
  aus dem Code. T08 sollte in der nächsten Runde als echte Gegenprobe
  gebaut werden, bevor das als bestätigt gilt.
- **Hoch06** (Zusatzstunden nach Fälligkeit als rechtzeitig gezählt),
  **Hoch07** (Heftvorsprung-Widerspruch nicht erkannt/abgewiesen),
  **Hoch08** (Zeitraumfilter zieht Wochenwerte statt Tageswerte in
  Auswertungen wie `processUtilization`/Orbitalauswertung): **nicht
  geprüft und nicht behoben**. Alle drei sind im Arbeitsauftrag als
  eigene Folgerunden vorgesehen ("Zeitraumabgrenzung und vollständige
  Kapazitätskonten") und wurden hier bewusst zurückgestellt, um Kritisch02
  nicht mit weiteren gleichzeitigen Änderungen zu vermischen.
- **T08, T11, T12, T14–T18** wurden nicht als Gegenproben gebaut und daher
  auch nicht geprüft.
- **Zweiter Sägeplatz / Helferregeln** (offene Punkte aus Abschnitt 4 des
  Arbeitsauftrags): **nicht angefasst**. Die Datei enthält unverändert nur
  die ursprünglich bestätigten Werte; es wurde keine Annahme über
  Zusatzplätze oder Helferleistung ergänzt oder entfernt.
- Qualifikationsmatrix, Leihverfügbarkeit, Samstagssätze: unverändert, wie
  im Arbeitsauftrag als offen markiert.

## 6. Abnahmekriterium

Die in dieser Runde behobenen Punkte erfüllen das genannte Kriterium
("Kein zugesagter Fertigstellungstermin darf auf unbesetzten Stunden,
Doppelbelegung oder noch nicht ausgeführter Vorarbeit beruhen") **für den
Kern der Terminierung** (Kritisch02, Hoch04) und für die genannten
Berichtsfehler (Kritisch01, Hoch05, Mittel09, Mittel10, Bedingt11) –
jeweils durch eine eigene, gegen den Arbeitsauftrag geschriebene Gegenprobe
nachgewiesen, nicht nur durch einen grünen Testlauf. Eine **vollständige**
Abnahme im Sinne des Arbeitsauftrags (alle 18 Gegenproben, R06 mit eigener
Gegenprobe, Hoch03/06/07/08 abschließend geklärt) steht noch aus.
