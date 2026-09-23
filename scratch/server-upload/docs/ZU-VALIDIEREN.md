# Parameter, die fachlich noch zu validieren sind

Stand: 16.09.2026

Grundsatz der Anwendung: **Nichts wird erfunden.** Wo ein Wert nicht belegt
ist, steht ein Startwert, der ausdrücklich als „zu validieren" gekennzeichnet
ist – in der Oberfläche mit einem Hinweiszeichen, im Datenmodell mit
`validated: false`. Diese Liste ist der vollständige Auszug daraus.

## 1. Besetzung und Leistung

| Parameter | Startwert | Woher | Was zu klären ist |
|---|---|---|---|
| `productivity.global` | 93,33 % | bisherige Planung (7,0 von 7,5 h) | bestätigt – bleibt als Regler |
| `workforce.sickRate` | 0 % | keine Quote hinterlegt | Steckt die Krankheit in der Produktivität, oder soll eine eigene Quote gerechnet werden? |
| `workforce.reserveHoursPerWeek` | 18 h/Woche | Auskunft „12–24 Mannstunden ca." | Mitte der Spanne. Genauer wird es erst mit Zeiten aus der Zubehörliste. |
| `workforce.team` | 9 Stammleute (8,5 FTE) + 15 Leiharbeiterplätze | Auskunft 09/2026 | Qualifikationsmatrix ist noch überall angehakt – wer was NICHT darf, fehlt. |
| `rampUp.temp` / `rampUp.hire` | 40 / 60 / 80 % | Auskunft 09/2026 | Erfahrungswert, nicht gemessen. |
| Betreuungsstunden | 5 / 3 / 1 h je Woche | Auskunft 09/2026 | Erfahrungswert. |
| `saturday.quota` | 20 % | Lastenheft §26 | Die alte Excel rechnete mit 80 %. |
| `resources.byOperation.ENDKONTROLLE.aushilfe` | leistung 0,5 / stundenfaktor 1 | 1:1 von der Hydroprüfung übernommen (Nutzeranforderung 25.09.2026: "wie Hydro") | Nur bei Hydro und Entgraten sind diese Werte von der Abteilung bestätigt. Bei Endkontrolle noch offen: bringt der Helfer wirklich dieselbe Zeitersparnis, oder kostet er (wie beim Entgraten) zusätzliche Arbeitszeit? |

## 2. Kosten

| Parameter | Startwert | Woher | Was zu klären ist |
|---|---|---|---|
| `costs.baseRate` | 22,50 €/h | Auskunft „Lohn 19–26 €" | Mittelwert der Spanne; je Person änderbar. |
| `costs.employerFactor` | 1,3 | Vorgabe der Abteilungsleitung | Gilt nicht für Leiharbeiter (Rechnungssatz). |
| `costs.tempRate` | 55 €/h | Auskunft „Spanne 45–65 €" | Mitte der Spanne; je Person änderbar. |
| Zuschläge | Mehrarbeit und Samstag 35 %, Spätschicht 24 € je Schicht, Nacht 40 % | Auskunft 09/2026 | Spät- und Nachtzuschlag sind Annahmen. |

Kosten werden **ausgewiesen, nicht optimiert**: Termintreue steht über den
Kosten (ausdrückliche Vorgabe).

## 3. Arbeitsgänge und Plätze

| Parameter | Startwert | Was zu klären ist |
|---|---|---|
| `skills.*` | alle 100 % | Eine belastbare Qualifikationsmatrix fehlt. Auskunft: „es fehlen 3 Orbitalschweißer und 2 Hefter" – das steht noch nicht in der Matrix. |
| `byOperation.AV` | 1 Vorgang gleichzeitig, 7,5 h je Auftrag | **Neu.** Beides ist Auskunft, nicht Messung. Können zwei Aufträge gleichzeitig vorbereitet werden, verschiebt sich der Engpass deutlich. |
| `projectLimits.maxParallelProjects` | 3 | Annahme der bisherigen Planung. |
| Arbeitsplan Reparatur | aus der Umbaufolge abgeleitet (60 h) | Nicht in der Quelldatei enthalten. |
| Arbeitsplan Sonderprojekt | aus der Neubaufolge abgeleitet (250 h) | Nicht in der Quelldatei enthalten. |
| Arbeitsplan Kleinauftrag/Zubehör | Folge steht, Zeiten 0 | Zeiten liegen nicht vor; der Aufwand läuft über die Reserve. |
| Kehlnaht/Stumpfnaht Orbital, Stundenaufteilung | festes Verhältnis 1:2 (Nutzerentscheidung 23.09.2026) | Auf ausdrücklichen Wunsch automatisch auf alle bestehenden Orbital-Zeiten angewandt statt echte Einzelwerte je Auftragsart abzuwarten – ist keine gemessene Aufteilung. |
| Molchen, Position im Arbeitsplan | nach Beizen, vor Vormontage | **Neu.** Keine Vorgabe zur genauen Position erhalten (23.09.2026) – naheliegende Annahme, mit der Abteilung abzugleichen. |
| Molchen, Platzgrenze | keine (nur Personal begrenzt) | Keine Angabe erhalten, ob es einen eigenen Arbeitsplatz mit fester Anzahl gibt. |
| Skill-Level je Person und Arbeitsgang | 2 (Fortgeschritten) für alle, die zuvor „kann" (Haken) waren | **Neu (23.09.2026).** Ersetzt den bisherigen Ja/Nein-Haken. Der Startwert 2 ist eine Annahme (entspricht dem alten „kann"), keine echten Stufen – die Abteilung muss die tatsächlichen Skill-Level je Person noch pflegen. |
| Arbeitsgangzeiten je MEGC-Variante | alle Neubauvarianten gleich | Eine Differenzierung nach 20/30/40/45 ft liegt nicht vor. |

## 4. Termine und Restriktionen

| Parameter | Startwert | Was zu klären ist |
|---|---|---|
| `nobo.weekdays` | Di, Mi, Do | Aus der Planung abgeleitet (Hydro Di–Do). Die tatsächliche NoBo-Anwesenheit ist zu bestätigen – der Kalender ist tagesgenau pflegbar. |
| `leadTimes.materialWeeks` | 4 Wochen | Lastenheft; je Auftrag überschreibbar. |

## 5. Datenstand

| Punkt | Was zu klären ist |
|---|---|
| Häkchen der Fertigmeldungen | Auskunft: „Häkchen sind nicht 100 % sauber geführt, viele Teile sind in Wahrheit fertig, zu erkennen am Lieferdatum." Die Plausibilitätsprüfung listet die betroffenen Aufträge. |
| Urlaubsplanung ab dem Stichtag | Noch nicht eingelesen. Bis dahin rechnet die Anwendung ab dem Stichtag mit einer Mannschaft ohne Abwesenheiten – gemessen waren 5,87 Mitarbeiter, geplant sind 9,46. |
| Einsatzende der Leiharbeiter | Die fünf zugesagten haben kein Ende hinterlegt und werden bis zum Ende des Horizonts mitgerechnet. |
| Tagesliste der Verfügbarkeit | Ist auf Anweisung um jeweils 1 verringert, weil die Ursprungsdatei falsch rechnet. Wird sie korrigiert, muss die Korrektur hier entfallen. |
