# 300-Punkte-Abgleich

Erstellt auf Anforderung der Abteilungsleitung (18.09.2026): *„bitte
berücksichtige bei dem check nochmal alle nachrichten des chats erstelle dir
eine 300 punkte abgleich. prüfe dann auf logik und alle rechenwege."*

**Zweck des Werkzeugs**, wie zuletzt festgelegt: **Planung und Steuerung** für
die Abteilungsleitung Armaturenbau (MEGC). Beides — der Plan wird gemacht
*und* nach ihm gesteuert.

**Lesart der Spalte Stand**

| Zeichen | Bedeutung |
|---|---|
| **ja** | umgesetzt und mit einer Prüfung abgedeckt |
| **teilweise** | umgesetzt, aber mit benannter Einschränkung |
| **abweichend** | bewusst anders gelöst als wörtlich verlangt — Begründung dabei |
| **offen** | noch nicht umgesetzt |
| **nicht prüfbar** | fehlende IST-Daten; es wird nichts erfunden |

Die Abweichungen sind am Ende noch einmal zusammengefasst (§291–300).

Stand der Zahlen: Startdatenbestand, Baseline, Stichtag 10.09.2026,
37 Aufträge, 6.501 h offene Arbeit.

---

## 1. Grundsätze der Zusammenarbeit (1–20)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 1 | Engine von der Oberfläche getrennt | ja | `engine/` ohne DOM-Zugriff, `web/js/views/` ohne Rechenlogik |
| 2 | Automatisierte Tests vorhanden | ja | 425 Engine- und Servertests, 328 Oberflächenprüfungen, 26 Prüfungen der Einzeldatei |
| 3 | Vor Auslieferung ausgiebig und mehrfach getestet | ja | Jede Lieferung: `test:all`, `ui-test`, `standalone-test`, `lint`, `typecheck`, `build:html` |
| 4 | Unbekannte IST-Werte werden nie erfunden | ja | `validated: false` an jedem Schätzwert, `docs/ZU-VALIDIEREN.md` |
| 5 | Keine Fremdvergabe als Lösungsweg | ja | Prüfung `§24 Fremdvergabe wird gemeldet`, nie als Maßnahme vorgeschlagen |
| 6 | Die Logik der Abteilungsleitung wird kritisch hinterfragt | ja | Heute in vier Fällen begründet widersprochen (§291–300) |
| 7 | Die Anwendung warnt bei Unplausiblem | ja | 12 Befunde im Startdatenbestand, `engine/plausibilitaet.js`; neu `ALLEIN_AM_TAG` |
| 8 | Alles bleibt im Haus, keine Cloud, keine KI im Betrieb | ja | Kein Netzzugriff im Code; Mockup bewusst nicht als Artifact veröffentlicht |
| 9 | Repository privat, Arbeit auf dem Feature-Zweig | ja | `Sarah-Zaher/APS`, Zweig `claude/happy-pasteur-6271im` |
| 10 | Echte Kunden- und Auftragsdaten nur lokal | ja | Seed im Repository, `Mehraufwand-Vorschlaege.html` aus git entfernt und in `.gitignore` |
| 11 | Keine Rückfragen zur Technik, nur zur Fachlichkeit | ja | Technische Entscheidungen getroffen, nicht erfragt |
| 12 | Logik vor Optik | ja | Engine zuerst, Maske in zweiter Fassung nach der Kritik |
| 13 | Zero-Dependency, kein Build-Schritt | ja | ES2022-Module, `package.json` ohne `dependencies` |
| 14 | Läuft mit Node ≥ 20 | ja | `engines.node: >=20`, `node:sqlite` mit JSON-Rückfallebene |
| 15 | Windows-Start ohne Fachkenntnis | ja | `Einrichten.bat`, `Start-Armaturenbau.bat`, `start-unsichtbar.vbs` |
| 16 | Mehrbenutzerbetrieb im Netz | ja | `Start-Armaturenbau-Netzwerk.bat`, `server/test/mehrbenutzer.test.js` |
| 17 | Dauerhafte Datenhaltung | ja | SQLite-Datei, Datensicherung als Datei ein-/auslesbar |
| 18 | Einzeldatei-Fassung ohne Server | ja | `dist/Armaturenbau-MEGC.html`, 26/26 Prüfungen |
| 19 | Änderungen werden nachvollziehbar protokolliert | ja | Protokoll mit Kürzel, `api.log` |
| 20 | Jede Lieferung mit Zahlen belegt, nicht behauptet | ja | Jede Antwort nennt Messwerte und deren Herkunft |

## 2. Feste Regeln der Abteilung (21–48)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 21 | Hydroprüfung nur Dienstag bis Donnerstag | ja | `hydro.allowedWeekdays = [2,3,4]`, Limiter `HYDRO_WINDOW` |
| 22 | Hydroprüfung nur bei NoBo-Anwesenheit | ja | `hydro.requireNoBo = true`, Limiter `NOBO` |
| 23 | Beides gleichzeitig, nicht alternativ | ja | Test „Hydro nur Di–Do UND nur mit NoBo" |
| 24 | NoBo-Anwesenheit tagesgenau übersteuerbar | ja | `nobo.exceptions`, Kalender in den Parametern |
| 25 | 6 Orbitalmaschinen | ja | `resources.orbitalMachines = 6` |
| 26 | Davon aktiv/einsatzbereit getrennt geführt | ja | `orbitalMachinesActive`, bei Ausfall reduzierbar |
| 27 | Ein Schweißer bedient zwei Maschinen | ja | `machinesPerWelder = 2` |
| 28 | Die Maschinen begrenzen die Schweißer, nicht umgekehrt | ja | `machineCap = (Maschinen ÷ je Schweißer) × Fenster` |
| 29 | Zahl der Schweißer kommt aus der Qualifikationsmatrix | ja | `weldersFor()` zählt in MANNSCHAFT-Betrieb die Angehakten — heute geändert |
| 30 | Die 2 in Ausbildung werden nicht mehr gesondert gerechnet | ja | Felder `qualified`/`inTraining` wirken nicht mehr — heute geändert |
| 31 | Kein zweiter Regler für dieselbe Größe | ja | Drei Schweißerfelder entfernt, Matrix ist die Quelle — heute geändert |
| 32 | Samstag 6 Stunden | ja | `saturday.hours = 6` |
| 33 | Samstag mit 20 % Beteiligung | ja | `saturday.quota = 0.2`, je Woche übersteuerbar |
| 34 | Samstag ohne Reserve und ohne Betreuungsabzug | ja | `dayCapacity`: beide nur an Regeltagen |
| 35 | Material T-4 Wochen | ja | `material.materialWeeks = 4` |
| 36 | Startvorlauf je Auftragsart getrennt | ja | Neubau 3, Umbau 4, WKP 4, Prüfer 4, Reparatur 2, Sonder 4, Zubehör 1 Wochen |
| 37 | Planungsstichtag 10.09.2026 | ja | `planningDate`, alle Auswertungen darauf bezogen |
| 38 | „Fertigstellung" ist der Armaturenbau-Termin, nicht die Auslieferung | ja | `dueDate` = Armaturenbau; `handoverDate` getrennt |
| 39 | Rechnung auf Tagesebene | ja | `daySeries`, 229 Tage |
| 40 | Anzeige zusätzlich als Wochenansicht | ja | `aggregateWeeks`, Wochenübersicht |
| 41 | Arbeitsplätze sind eigenständige Objekte | ja | `resources.byOperation`, Belegungsgitter, Auslastungsmatrix |
| 42 | 37,5 h Regelarbeitszeit je Woche | ja | `workTime.regularHoursPerWeek` |
| 43 | Montag bis Freitag | ja | `workTime.workDays = [1,2,3,4,5]` |
| 44 | Feiertage wirken tageweise | ja | `defaultHolidays()`, `dayKind` |
| 45 | Höchstens 4 Mitarbeiter je Auftrag | ja | `projectLimits.maxWorkersPerProject = 4`, Limiter `PROJECT_LIMIT` |
| 46 | Höchstens 3 Aufträge gleichzeitig | teilweise | `maxParallelProjects = 3`, aber `validated: false` — Wert ist zu bestätigen |
| 47 | Heften und Orbitalschweißen überlappen | ja | Heftvorsprung 5–10 h, `DEP_TYPE.OVERLAP` |
| 48 | **Niemand arbeitet allein, immer mindestens zu zweit** | ja | `workforce.minZusammen = 2`, erzwungen auf **Tagesebene** in `headcountFor`: ein Tag mit einer Person gibt 0 h. Gemessen an Köpfen, zwei Halbtagskräfte sind zulässig. Sichtbar im Rechenweg und als Befund `ALLEIN_AM_TAG` |

## 3. Kapazität und Rechenwege (49–95)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 49 | Tagesformel nachrechenbar | ja | `Besetzung × (Wochenstunden ÷ 5) × Produktivität − Betreuung − Reserve ÷ 5`; Test prüft jeden Arbeitstag |
| 50 | Beispiel: 6 MA × 7,5 h × 93,33 % − 3,6 h = 38,4 h | ja | Test „die Tagesformel gilt für jeden einzelnen Arbeitstag" |
| 51 | Jede Kapazitätszahl nennt ihren Zeitraum | ja | Karte „Woher die Kapazität kommt", `capacityDerivation` |
| 52 | Näherung mit Mittelwerten steht daneben | ja | Abweichung 4,7 h von 8.649 h (0,05 %) |
| 53 | Kapazität taggenau, nicht wochenweise gerundet | ja | Früher 9.012 h statt 8.649 h — 363 h zu viel; heute behoben |
| 54 | Vor einer Handrechnung „Wochenstunden × Kalendertage" wird gewarnt | ja | 110 Kalendertage = 77 Arbeitstage, ausdrücklich in der Karte |
| 55 | Betreuungsstunden gehen vom Pool ab | ja | `mentoringHoursPerDay`, jetzt auch in der Tagesreihe geführt |
| 56 | Reserve für Zubehör vorab abgezogen | ja | 18 h/Woche, als Schätzung gekennzeichnet |
| 57 | Reserve ist als Schätzung gekennzeichnet | ja | `reserveHoursValidated: false`, Spanne 12–24 h dokumentiert |
| 58 | Produktivität wirkt auf den Pool, nicht auf die Plätze | ja | `poolGross = Köpfe × Stunden × Produktivität` |
| 59 | Platzstunden sind keine Mannstunden | ja | Spalte umbenannt in „Platzstunden im Zeitraum", mit Warnung |
| 60 | Die Platzstundenspalte darf nicht addiert werden | ja | Warnung darunter; addiert ergäbe sie 21.826 h = dieselbe Mannschaft elfmal |
| 61 | Mitarbeiterstunden stehen einmal daneben | ja | In derselben Karte |
| 62 | Sechs Grenzen je Tag und Arbeitsgang | ja | Personal, Qualifikation, Plätze, Maschinen, Zeitfenster, NoBo |
| 63 | Die zuschlagende Grenze wird mitgeschrieben | ja | `limiter` je Tag und Arbeitsgang |
| 64 | Engpassrangfolge zählt jede Arbeit genau einmal | ja | Früher Stunden × Tage (3.039 h), heute 885 h; Test |
| 65 | Die alte Summe bleibt intern zum Sortieren | ja | `queueHoursDays`, nirgends als Stundenzahl gezeigt |
| 66 | Wartende Arbeit bleibt unter der offenen Arbeit | ja | Test „bleibt unter der offenen Arbeit" |
| 67 | Stau je Arbeitsgang mit Tagen und Tagesspitze | ja | `blockedByOperation`: Stunden, Tage, größter Tag, Hauptursache |
| 68 | „Stau je Tag" ist keine Stundensumme | ja | Früher 6.067 h auf einem Platz mit 340 möglichen Stunden; behoben |
| 69 | Stunden auf die Arbeitsgänge gebucht | ja | Karte „Stunden je Arbeitsgang" in Engpässe & Wirkung |
| 70 | Die Spalte „offen" summiert sich auf die offene Arbeit | ja | 6.501 h = Summe über alle Aufträge; Fußzeile weist es aus |
| 71 | Weicht sie ab, sagt die Anwendung das | ja | Rote Pille „bitte melden" in der Fußzeile |
| 72 | „Blieb liegen" ist keine zweite Arbeitsmenge | ja | Ausdrücklich unter der Tabelle erklärt |
| 73 | Stunden je Auftrag je Arbeitsgang ausgewiesen | ja | Spalte „h je Auftrag"; Orbital 65,8 h |
| 74 | Der Unterschied zu 90 h je Auftrag ist erklärt | ja | Arbeitsfolge führt 90,25 h für Neubau; Mischung 19 Neubau / 12 Umbau / 5 WKP / 1 Prüfer |
| 75 | Stunden kommen je Auftrag aus seinen echten Gesamtstunden | ja | `totalHoursOverride` je Auftrag, Vorlage gibt nur die Anteile |
| 76 | Mehraufwand ist die größte kumulierte Differenz | ja | 679 h bis KW 48, `engine/mehraufwand.js` |
| 77 | Mehraufwand über 13 rollierende Wochen | ja | `QUARTAL_WOCHEN = 13`, ab Stichtag |
| 78 | Mehraufwand nicht Teil der Analyse (Laufzeit) | ja | Analyse 286 ms statt 516 ms; Ansicht holt ihn einzeln |
| 79 | Überstundengrenze 5 h je MA und Woche | ja | `UEBERSTUNDEN_GRENZE = 5` |
| 80 | Vier Wege immer sichtbar, auch der wirkungslose | ja | Überstunden → Platz → Leihe → Samstag |
| 81 | Ein zweiter Sägeplatz schafft 0 Mannstunden | ja | Ausdrücklich so ausgewiesen, mit Hinweis welchen Stau er löst |
| 82 | Maßnahmen nur in ein Szenario, nie in den laufenden Plan | ja | `applyMehraufwand`, `applySchichten` |
| 83 | Personalbedarf kumuliert nach Terminen, nicht je Einzelwoche | ja | Früher 334 h → „10 MA", heute 679 h ÷ 12 Wochen → 1,7 MA |
| 84 | Kopfzahl = Stunden ÷ (Wochen × Wochenleistung) | ja | Test rechnet die Formel nach |
| 85 | Die Kopfzahl darf nie über der Einzelwochenrechnung liegen | ja | Eigener Test |
| 86 | Personal nur fordern, wenn Personal die Grenze ist | ja | Trennung „an den Leuten" (POOL, SKILL) gegen „an der Anlage" |
| 87 | Im Startdatenbestand: 1.449 h an der Anlage, 71 h an den Leuten | ja | Befund `MANNSCHAFT_NICHT_AUSLASTBAR` |
| 88 | Leerer Horizont ist keine freie Kapazität | ja | Befund `HORIZONT_OHNE_AUFTRAEGE`: ab KW 06/2027, 12 Wochen, 4.909 h |
| 89 | Auslastungsaussagen enden an der letzten Fertigstellung | ja | Ein Zeitraum (`range`) geht in jede Auswertung; Standard ist die letzte Fertigstellung mit offener Arbeit (22 Wochen, 8.649 h statt 34 Wochen, 13.921 h). Oberflächenprüfung: kürzerer Zeitraum 8.649 h → 4.740 h |
| 90 | Verspätung nach Ursache getrennt | ja | `lateByMaterial` gegen `lateByCapacity` |
| 91 | Fehlteile verschieben den frühesten Arbeitsbeginn, keine eigene Rechnung | ja | Ausdrückliche Entscheidung; Knopf „Öffnen" je Auftrag |
| 92 | Arbeitsvorbereitung 7,5 h je Auftrag | ja | `AV_STUNDEN` |
| 93 | AV bis 31.12.2026 erledigt | ja | `AV_ERLEDIGT_BIS`, mit Nachtrag für bestehende Installationen |
| 94 | Kosten werden ausgewiesen, nie optimiert | ja | Termintreue steht darüber |
| 95 | Leiharbeiter mit Rechnungssatz, ohne Arbeitgeberanteile | ja | 55 €/h gegen 35 €/h Stamm, in der Karte erklärt |

## 4. Mannschaft und Personal (96–140)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 96 | Rangfolge Tagesliste → Mannschaft → Wochenzahlen | ja | `headcountFor` |
| 97 | Tagesliste nur bis zum Stichtag | ja | Befund `TAGESLISTE_NACH_STICHTAG` |
| 98 | Tagesliste immer −1 rechnen | ja | Anweisung umgesetzt, Befund `TAGESLISTE_KORREKTUR` weist darauf hin |
| 99 | Die −1 gilt **nicht** für die Urlaubstabelle | ja | Ausdrücklich getrennt, nur die Tagesliste |
| 100 | Lücken in der Tagesliste werden gemeldet | ja | Befund `TAGESLISTE_LUECKE` |
| 101 | Personal ausschließlich im Reiter Mannschaft pflegen | ja | Zahlenlisten wirken nicht mehr; kein zweites Feld |
| 102 | Alte Zahlenlisten weder verrechnen noch löschen | ja | „Alte Zahlenlisten – ohne Wirkung" mit zwei Wegen |
| 103 | In der Rückfallebene wirken sie weiter | ja | Dort gibt es keine Mannschaftsliste |
| 104 | Meldung statt stiller Ergänzung | ja | `PERSONAL_FEHLT` bzw. `MANNSCHAFT_NICHT_AUSLASTBAR` |
| 105 | Karte „Wer wird gerechnet?" mit Kürzeln | ja | Namen, Eintritt, Stamm/Leihe getrennt |
| 106 | 9 Stammleute, 8,5 FTE | ja | Vorarbeiter mit Zeitanteil 0,5 |
| 107 | 5 zugesagte Leiharbeiter mit Eintritt | ja | `ZUGESAGTE_LEIHE`, Auskunft 15.09.2026 |
| 108 | Herkunft der Leiharbeiter korrekt benannt | ja | Zugesagte gegen selbst eingeplante getrennt |
| 109 | 15 Platzhalter, leere ausgeblendet | ja | Schalter „Leere Plätze anzeigen" |
| 110 | Art je Person änderbar (Stamm/Leihe/neu) | ja | Spalte „Art"; wirkt auf Satz, Kurve, Betreuung |
| 111 | Einarbeitung 40/60/80 % | ja | `rampUp.temp` |
| 112 | Betreuung 5/3/1 h je Woche | ja | `mentoringHoursPerWeek` |
| 113 | Einsatzfenster ist hart | ja | `startDate`/`endDate` |
| 114 | Leiharbeiter ohne Einsatzende werden gemeldet | ja | Befund `LEIHE_OHNE_ENDE` |
| 115 | Leiharbeiter wochenweise abrufbar | ja | Anwesenheit je KW |
| 116 | „Nur Stammmannschaft rechnen" als Schalter | ja | Mit Nennung der betroffenen Kürzel |
| 117 | Urlaub, Krankheit, Schulung, Demontage | ja | `ABSENCE_KINDS` |
| 118 | Fehlender Urlaub wird gemeldet | ja | Befund `URLAUB_UNGEPFLEGT` |
| 119 | Urlaubsplanung aus Excel einlesbar | ja | Zweistufig: ansehen, dann übernehmen |
| 120 | Zuordnung Zeile → Kürzel macht der Anwender | ja | Die Tabelle nennt keine Personen |
| 121 | Krankenquote wird gemeldet, wenn 0 | ja | Befund `KRANKENQUOTE_NULL` |
| 122 | Besetzungssprung Tagesliste → Mannschaft gemeldet | ja | Befund `BESETZUNG_SPRUNG` |
| 123 | Mannschaft gegen alte Wochenzahlen verglichen | ja | Befund `MANNSCHAFT_GEGEN_WOCHENZAHLEN` |
| 124 | Qualifikationsmatrix je Person und Arbeitsgang | ja | Karte „Wer darf was?" |
| 125 | Ist alles angehakt, wird gewarnt | ja | Befund `QUALIFIKATION_UNGEPFLEGT` |
| 126 | Arbeitsgang ohne Qualifizierte ist kritisch | ja | Befund `ARBEITSGANG_OHNE_QUALIFIZIERTE` — heute ergänzt |
| 127 | Wirkung einer Matrixänderung sofort sichtbar | ja | Spalte „im Plan": Stunden, Tage ohne Quali, Tage ohne Platz |
| 128 | Einsatzplan folgt der Matrix automatisch | ja | Test: MAAP nur Sägen → 481 h → 411 h, 87 Tage ohne Quali |
| 129 | Nur Kürzel, keine Klarnamen erzwungen | ja | Name frei, bei Leiharbeitern nutzbar |
| 130 | Schichtfähigkeit je Person | ja | `shiftCapable` |
| 131 | Nicht schichtfähige bleiben Frühschicht | ja | `wochenSchichten` |
| 132 | Kein Personal, das nicht in der Liste steht | ja | Test „achtzehn Personen in den Zahlenlisten dürfen keine Stunde erzeugen" |
| 133 | Bedarfsrechnung geht über die Mannschaft | ja | `mitZusatzPersonal` |
| 134 | Optimierervorschläge gehen über die Mannschaft | ja | Dieselbe Funktion |
| 135 | Kostensatz je Person überschreibbar | ja | Spalte €/h |
| 136 | Aushang für die Werkstatt druckbar | ja | Mannschaft → Aushang |
| 137 | Mehrbenutzer: Änderungen werden dem Kürzel zugeordnet | ja | Anmeldung, Protokoll |
| 138 | Fremde Änderungen werden gemeldet | ja | Aufholmeldung |
| 139 | Anmeldung ist keine Zugriffssicherung | ja | Ausdrücklich so benannt |
| 140 | Alle Bereiche für jeden | ja | Keine Rollentrennung — Absprache |

## 5. Einsatzplan (141–175)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 141 | Einsatzplan je Mitarbeiter und Tag | ja | Wer, wann, welcher Auftrag, welcher Arbeitsgang |
| 142 | Last gleichmäßig über die Mannschaft | ja | Einschichtig 478–485 h je Zeitanteil, mit Schichtbetrieb 442–487 h; früher 1.170 h gegen 21 h |
| 143 | Auswahl nach Auslastung, nicht nach absoluten Stunden | ja | Halbtagskraft 242 h gegen 484 h Vollzeit |
| 144 | Ein Platz, eine Person | ja | `places × workersPerPlace` je Schicht |
| 145 | Beim Orbital begrenzen die Schweißer, nicht die Maschinen | ja | `plaetzeAm`, `koepfeJeSchicht` |
| 146 | Ablösung erlaubt, wenn der Tag ausgeht | ja | Sonst blieben 20 h Sägen ohne Namen |
| 147 | Wer fertig ist, geht an den nächsten freien Platz | ja | Kein harter Tagesbann auf einen Arbeitsgang |
| 148 | Platzwechsel nur wenn nötig | ja | Bei Gleichstand bleibt jemand auf seinem Arbeitsgang |
| 149 | Reproduzierbar | ja | Bei Gleichstand entscheidet das Kürzel |
| 150 | Niemand an einem Arbeitsgang ohne Haken | ja | Eigener Test über alle Tage |
| 151 | Jede eingeplante Stunde bekommt einen Namen | teilweise | Einschichtig 0 h ohne Namen; mit geplanten Schichten 32,6 h (0,5 %) — siehe §294 |
| 152 | Leerlauf steht mit Grund da | ja | `KEIN_PLATZ_FREI`, `KEINE_QUALIFIKATION`, `KEINE_ARBEIT`, `SCHICHT_OHNE_ARBEIT` |
| 153 | Kein Gedankenstrich ohne Erklärung | ja | Farbige Pille mit Klartext und Erläuterung im Tooltip |
| 154 | Je Woche die Zahl der Personentage ohne Arbeit | ja | Fußzeile der Wochenansicht |
| 155 | Die Fußzeile sagt, dass mehr Personal daran nichts ändert | ja | Wenn der Grund „kein Platz frei" überwiegt |
| 156 | Schichtwechsel nur wochenweise, nie tageweise | ja | Nachgemessen: 0 Wechsel innerhalb einer Woche |
| 157 | Wochenweise Rotation, damit nicht immer dieselben nachts arbeiten | ja | Versatz je Woche |
| 158 | Schichtbesetzung nach Arbeit, nicht gleichmäßig | ja | Einschichtige Arbeitsgänge haben Vorrang in der Frühschicht |
| 159 | Besetzung im Startdatenbestand 8 Früh / 2 Spät / 2 Nacht | ja | Von 14 Personen |
| 160 | Keine Schicht mit nur einer Person | ja | `minZusammen = 2` in der Schichtbesetzung |
| 161 | Jeder Eintrag führt seine Schicht mit | ja | Feld `schicht` |
| 162 | Leiharbeiter im Einsatzplan als solche erkennbar | ja | Pille „Leihe" |
| 163 | Name der Leiharbeiter im Einsatzplan | ja | Neben dem Kürzel |
| 164 | Leere Zeilen nennen den Grund | ja | Eintritt, Einsatzende, Abwesenheit oder keine Zuteilung |
| 165 | Wochenweise Navigation | ja | „‹ Woche" / „Woche ›" |
| 166 | Abwesenheiten im Einsatzplan sichtbar | ja | Graue Pille mit Art |
| 167 | Umschalter „nur Eingeplante zeigen" | ja | Häkchen in der Kopfzeile |
| 168 | Wochenplan einer Person abrufbar | ja | `personWeek` |
| 169 | Stunden je Person je Woche | ja | `byWeek` |
| 170 | Stunden je Person je Arbeitsgang | ja | `byOp` |
| 171 | Abwesenheitstage je Person gezählt | ja | `absentDays` |
| 172 | Leerlauftage je Person gezählt | ja | `idleDays`, `idleReasons` |
| 173 | Der Plan wird auf Abruf gerechnet, nicht bei jeder Anzeige | ja | Eigener Endpunkt, ~39 ms |
| 174 | Einsatzplan reagiert auf jede Konfigurationsänderung | ja | Kein Zwischenspeicher, frische Rechnung je Abruf |
| 175 | Stunden ohne Namen werden gemeldet | ja | Befund `SCHICHT_NICHT_ZUGEORDNET` |

## 6. Schichten und Arbeitsplätze (176–215)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 176 | Schichten je Arbeitsgang einstellbar | ja | Tabelle „Schichten und Plätze je Arbeitsgang" |
| 177 | Tabelle an zwei Stellen erreichbar | ja | Engpässe & Wirkung und Einstellungen → Parameter |
| 178 | Spalte „läuft" sagt, was gilt und woher es kommt | ja | Eigener Wert oder Standard |
| 179 | Der allgemeine Wert wird als Falle benannt | ja | 15 h heißt überall zwei Schichten |
| 180 | Sammelknöpfe für alle Arbeitsgänge | ja | 1, 2, 3 Schichten |
| 181 | Mehr Belegungszeit schafft keine Mannstunden | ja | Test; Warnung in der Karte |
| 182 | Höchstens 3 Schichten | ja | `MAX_SCHICHTEN = 3` |
| 183 | Schichten automatisch planen | ja | `planeSchichten`, Endpunkt `/schichtvorschlag` |
| 184 | Nur dort mehrschichtig, wo es hilft — nicht überall | ja | 7 von 11 Arbeitsgängen; AV, Vormontage, Endkontrolle, Reinigen bleiben einschichtig |
| 185 | Jeder Schritt wird durchgerechnet und darf verworfen werden | ja | Schrittliste mit Grund `OHNE_WIRKUNG` |
| 186 | Verworfene Schritte blockieren nicht den Rest | ja | Reihum durch alle Kandidaten |
| 187 | Wirkung im Startdatenbestand: 2.333 → 708 Verspätungstage | ja | Gemessen; Sägen und Entgraten 3 Schichten, Biegen/Heften/Orbital/Beizen/Hydro 2 |
| 188 | Personentage ohne Arbeit 1.007 → 399 | ja | Gemessen (von 2.183 anwesenden Personentagen) |
| 189 | Schichtvorschlag nur mit schichtfähiger Mannschaft | ja | Abbruch mit Grund `ZU_WENIG_SCHICHTFAEHIG` |
| 190 | Nicht besetzbarer Schichtbetrieb ist kritisch | ja | Befund `SCHICHT_NICHT_BESETZBAR` |
| 191 | Nachtschicht wird benannt, nicht stillschweigend geplant | ja | Befund `NACHTSCHICHT` |
| 192 | Schichtmeldung nennt Herkunft und Ort | ja | Allgemeiner Wert gegen eigenen Wert |
| 193 | Fehlende Plätze werden nach der Schichtplanung ausgewiesen | ja | Beizen +2 Plätze, Sägen +1 Platz |
| 194 | In ganzen Plätzen, nicht in Bruchteilen | ja | Früher „+0,4 Plätze"; heute aufgerundet |
| 195 | Aus der Tagesspitze gerechnet, nicht aus der Gesamtmenge | ja | Beides ausgewiesen |
| 196 | Beim Orbital die richtige Kette | ja | Maschinen ÷ je Schweißer → Schweißer → Stunden, im Klartext |
| 197 | Rückstände unter 5 h gelten nicht als Platzproblem | ja | Sonst „1 Platz für 0,6 h" |
| 198 | Nur Rückstände, die an Plätzen hängen, lösen Schichten aus | ja | Vorgänger oder Material zählen nicht |
| 199 | Schichtvorschlag geht in ein Szenario | ja | `applySchichten` |
| 200 | Zweiter Sägeplatz technisch möglich | ja | `maxPlaces: 2` |
| 201 | Zweiter Entgratplatz möglich | ja | Auskunft „Engpass kann ggf. von Hand mitgeholfen werden" |
| 202 | Entgraten an zweiter Stelle der Arbeitsfolge | ja | Nach dem Sägen |
| 203 | 2 Heftplätze, technisch 3 möglich | ja | `heftPlaces`, `heftPlacesMax` |
| 204 | Mitarbeiter je Heftplatz einstellbar | ja | `workersPerHeftPlace` |
| 205 | Vormontage und Endkontrolle: zwei Personen je Platz | ja | `workersPerPlace = 2` |
| 206 | Hydro-Prüfstände zählbar | ja | `hydroStations` |
| 207 | Beizplätze zählbar | ja | `beizStations` |
| 208 | Platzgrenzen gemeinsam abschaltbar (nur zum Vergleich) | ja | `enforcePlaces`, nicht für den Dauerbetrieb |
| 209 | Belegungszeit je Kalenderwoche übersteuerbar | ja | `operatingHoursByWeek` |
| 210 | Auslastung je Arbeitsplatz und Woche als Matrix | ja | Belegungsgitter |
| 211 | Engpasstage je Arbeitsplatz | ja | `bottleneckDays` |
| 212 | Diagramm je Arbeitsgang umschaltbar | ja | Bedarf einschließlich liegengebliebener Arbeit |
| 213 | Beim Arbeitsgang stehen Plätze und mögliche Tage | ja | Unter dem Diagramm |
| 214 | Der Bedarfsbalken nutzt die Tagesspitze, nicht die Summe | ja | Sonst ein Vielfaches |
| 215 | Arbeitsplätze als eigene Stammdaten | ja | `workplaces` |

## 7. Aufträge, Termine, Material (216–245)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 216 | 37 Aufträge als IST-Daten eingepflegt | ja | Echte Auftragsnummern und Kunden |
| 217 | Auftragsarten: Neubau, Umbau, WKP, Prüfer, Reparatur, Sonder, Zubehör | ja | `projectType` |
| 218 | Varianten je Auftragsart | ja | z. B. FT40 |
| 219 | Gesamtstunden je Auftrag aus dem IST | ja | `totalHoursOverride` |
| 220 | Arbeitsfolge je Auftragsart | ja | Neun bis elf Arbeitsgänge |
| 221 | Wiederkehrer zusätzlich mit Reinigen | ja | 5 Aufträge |
| 222 | Fortschritt je Auftrag und Arbeitsgang | ja | `progressPercent`, `doneManHours` |
| 223 | Fortschritt wirkt auf die Reststunden | ja | Test |
| 224 | Priorität je Auftrag | ja | P1–P3 |
| 225 | Reihenfolgeregel wählbar | ja | EDD, Priorität, Puffer, kritisches Verhältnis, SPT, LPT |
| 226 | Manuell fixierte Aufträge behalten ihre Position | ja | `sequenceLocked` |
| 227 | Manuelles Vorziehen wirkt | ja | Test §45 |
| 228 | Fehlteile je Auftrag pflegbar | ja | Mit Notiz |
| 229 | Verspätung durch Fehlteile getrennt ausgewiesen | ja | Mehr Personal ändert daran nichts |
| 230 | Frühester Arbeitsbeginn je Auftrag von Hand setzbar | ja | Ausdrücklich statt einer Fehlteil-Rechnung |
| 231 | Fertigstellung in der Liste änderbar | ja | Direkt in der Tabelle |
| 232 | Auftrag über die Oberfläche anlegbar und löschbar | ja | Test |
| 233 | Laut Lieferdatum fertige Aufträge werden gemeldet | ja | Befund `FERTIG_LAUT_LIEFERDATUM` |
| 234 | Überfällige Aufträge zählen sofort als fällig | ja | In der Personalrechnung |
| 235 | Termintreue im Startdatenbestand 2,7 % | ja | 36 von 37 zu spät, 2.333 Verspätungstage |
| 236 | Überlast wird nicht schöngerechnet | ja | Test §88 |
| 237 | Regeln in Alltagssprache eingebbar | ja | `parseRuleText` |
| 238 | Wirkung einer Regel wird berechnet | ja | „verbessert die Termintreue um 5,4 Prozentpunkte" |
| 239 | Unverständliche Regeln werden abgewiesen | ja | Test |
| 240 | Widersprüchliche Regeln werden abgelehnt | ja | Test |
| 241 | Notiz zu einer Regel ist Pflicht | ja | Test |
| 242 | Geltungsbereich einer Regel wählbar | ja | Test |
| 243 | **Planungsvorgaben über Regeln einstellbar** | offen | Wunsch vom 18.09.2026 — siehe §297 |
| 244 | Materialtermin je Auftrag | ja | `materialDate`, T-4 Wochen |
| 245 | Startfreigabe getrennt vom Material | ja | `releaseDriver` |

## 8. Kennzahlen, Meldungen, Stände (246–280)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 246 | Sechs feste Kacheln | ja | Termintreue, zu spät, über Kapazität, Engpass, freie Kapazität, Auffälligkeiten |
| 247 | Feste Anordnung, damit alle dasselbe sehen | ja | Ausdrücklich so festgelegt |
| 248 | Antwortzeile in einem Satz | ja | Was klemmt und was hilft |
| 249 | Engpass nennt Stunden, Tage und Tagesspitze | ja | Nicht mehr „x h nicht einplanbar" |
| 250 | „Nicht einplanbar" ersatzlos gestrichen | ja | Alte Kennzahl wies 4.119 h statt 679 h aus |
| 251 | Mehraufwand als Hauptseite der Übersicht | ja | Woche für Woche, Stunden groß, Euro klein |
| 252 | Betroffene Aufträge nach Fälligkeitswoche gruppiert | ja | Kunde als Spalte |
| 253 | Paket mit 5-h-Obergrenze | ja | Reihenfolge Überstunden → Platz → Leihe → Samstag |
| 254 | Heatmap zuklappbar | ja | |
| 255 | Befunde bestätigen („Erledigt") | ja | Zählt nicht mehr, bleibt nachlesbar |
| 256 | Bestätigte Befunde melden sich bei höherer Dringlichkeit wieder | ja | `wendeBestaetigungenAn` |
| 257 | 13 Befunde im Startdatenbestand | ja | Vollständig aufgelistet |
| 258 | IST-Stand bleibt unverändert | ja | Einstellungen → Stände |
| 259 | SOLL-Stand festlegbar | ja | Karte „Von wo nach wo" |
| 260 | SOLL-Stand wird später zum IST-Stand | ja | „SOLL-Stand zum IST-Stand machen" |
| 261 | Baseline vor versehentlicher Änderung geschützt | ja | Rückfrage |
| 262 | Szenarien vergleichbar | ja | Bis zu drei nebeneinander |
| 263 | Wirkungslose Versuche werden als solche erkannt | ja | Test |
| 264 | Vergleich zählt, was wirkt | ja | Eingeplante Leiharbeiter der Mannschaft |
| 265 | Excel-Export mit sechs Blättern | ja | Test |
| 266 | Datensicherung als Datei | ja | Ein- und auslesbar |
| 267 | Zurücksetzen auf Startdaten | ja | Test |
| 268 | Dunkelmodus | ja | Keine leuchtenden Flächen, Eingabefelder dunkeltürkis |
| 269 | Ansichten speicherbar | ja | Filter mit Namen |
| 270 | Schnellsuche über Aufträge | ja | Springt in den Auftrag |
| 271 | Keine JavaScript-Fehler | ja | In jeder Oberflächenprüfung geprüft |
| 272 | Fünf Bereiche statt zehn Menüpunkten | ja | Zweite Maskenfassung |
| 273 | Stellschrauben im Panel rechts | ja | Drei Gruppen |
| 274 | Keine toten Regler | ja | Personal aus der Mannschaft, Schichten je Arbeitsgang |
| 275 | Jede Änderung wirkt sofort | ja | Sofortige Neuberechnung |
| 276 | Analyse unter 300 ms | ja | 286 ms; Robustheitstest |
| 277 | 60 Projekte unter 2 Sekunden | ja | Robustheitstest |
| 278 | Schichtvorschlag ~0,9 s, auf Abruf | ja | Gemessen |
| 279 | Bedienungsanleitung | ja | `docs/BEDIENUNG.md` |
| 280 | Planungslogik dokumentiert | ja | `docs/PLANUNGSLOGIK.md` mit allen Rechenwegen |

## 9. Was noch offen ist (281–290)

| # | Punkt | Stand | Nachweis |
|---|---|---|---|
| 281 | PDF-Bericht mit Briefkopf | offen | Es fehlt die Logodatei als PNG oder SVG |
| 282 | Ziehen mit der Maus im Belegungsgitter | offen | Bewusst zurückgestellt: wäre eine zweite Wahrheit neben der Rechnung |
| 283 | Hallenlayout und Flächenbelegung | offen | Ausdrücklich später |
| 284 | Zeiten der Kleinaufträge (Zubehör) | nicht prüfbar | Arbeitsfolge steht, Zeiten auf 0; läuft über die Reserve |
| 285 | Urlaubsplanung 2026 einlesen | offen | Muss von der Abteilungsleitung eingelesen werden |
| 286 | Aufträge 2027 einpflegen | offen | Deshalb ab KW 06/2027 kein Bedarf — die Anwendung sagt es jetzt |
| 287 | `maxParallelProjects` bestätigen | offen | Wert 3, `validated: false` |
| 288 | Zubehörliste mit Zeiten | offen | Grundlage für die Reserve von 18 h |
| 289 | Sägeplatz zwei: Entscheidung | offen | Technisch hinterlegt, betrieblich nicht entschieden |
| 290 | Orbitalmaschinen aufstocken: Entscheidung | offen | Rechnung zeigt rund 3 Maschinen Bedarf an der Spitze |

## 10. Wovon ich abweiche (291–300)

| # | Abweichung | Begründung |
|---|---|---|
| 291 | **„Kein Platz frei ist keine Option" — es bleibt Leerlauf.** | Die Schichtplanung senkt die Personentage ohne Arbeit von 1.007 auf 399, aber nicht auf null. Grund: Plätze und Maschinen begrenzen weiter (Beizen +2, Sägen +1, Orbital rund 3 Maschinen), und ab KW 06/2027 fehlen die Aufträge. Ich kann Leerlauf nicht wegplanen, der aus fehlenden Plätzen oder fehlenden Aufträgen kommt — ich kann ihn nur benennen. |
| 292 | **Die Schichtplanung ist nicht beweisbar optimal — aber nachgemessen.** | Sie arbeitet greedy: größter Rückstand zuerst, jeder Schritt durchgerechnet, wirkungslose verworfen. Ergebnis 708 Verspätungstage (von 2.333). Gegenprobe: 1.399 zufällige Kombinationen fanden in 120 s nichts Besseres als 725, und keine Nachbarschaft ±1 Schicht je Arbeitsgang ist besser — ein örtliches Optimum, begrenzt von den 12 schichtfähigen Köpfen. Eine vollständige Suche über 3^11 Kombinationen bleibt zu langsam. |
| 293 | **„Niemand arbeitet allein" — erledigt, auf ausdrückliche Entscheidung.** | Nach der Bestätigung („Gilt immer!") jetzt auch auf Tagesebene: Ein Tag mit nur einer Person gibt 0 h. Gemessen an Köpfen (zwei Halbtagskräfte sind zwei Personen). Im Startdatenbestand gibt es keinen solchen Tag, die Zahlen ändern sich dort also nicht — kommt einer vor, sagt die Anwendung es (`ALLEIN_AM_TAG`) und weist die entfallenen Stunden im Rechenweg aus. |
| 294 | **32,6 h der eingeplanten Arbeit haben im Schichtplan keinen Namen.** | 0,5 % von 6.500 h. Ursache: Die Terminierung rechnet mit Platzstunden, die Schichtzuordnung entsteht erst im Einsatzplan. Ich verstecke die Lücke nicht, sondern melde sie (`SCHICHT_NICHT_ZUGEORDNET`). Einschichtig sind es 0 h. |
| 295 | **Die Schweißerzahl kommt jetzt aus der Matrix — das ändert Zahlen.** | Vorgabe: „vergiss die 2 in Ausbildung orientier dich an der Qualimatrix." Folge: Im Startdatenbestand sind alle 14 Personen für Orbital angehakt, also rechnet die Anwendung mit bis zu 12,7 Schweißer-FTE statt mit 4. Das ist mehr, als real schweißen können. Auf Entscheidung vom 18.09.2026 („Braucht die Prüfung nicht drauf hinweisen") warnt die Anwendung nicht mehr dagegen — die Matrix ist die Wahrheit, sie muss gepflegt werden. |
| 296 | **Belegungsgitter und Terminplan zeigen bewusst weiter den ganzen Horizont.** | Jede Kennzahl und jede Auswertung folgt jetzt dem angewählten Zeitraum. Zwei Ansichten nicht: Belegungsgitter und Terminplan zeigen auch die Wochen dahinter, weil man dort sehen will, wo nichts liegt. Das ist eine Anzeige, keine Bewertung — und oben rechts jederzeit eingrenzbar. |
| 297 | **Planungsvorgaben über Regeln: noch nicht gebaut.** | Wunsch vom 18.09.2026. Der Regelparser versteht heute Reihenfolge- und Terminregeln, keine Kapazitätsvorgaben („Sägen höchstens 2 Schichten", „keine Nachtschicht", „mindestens zwei Personen je Platz"). Das ist ein eigener Schritt am Parser, und ich fange ihn nicht zwischen zwei anderen Änderungen an. |
| 298 | **Ich habe sechs eigene Rechnungen widerrufen.** | Die Engpasszahl (Stunden × Tage), die Personalmeldung (Einzelwoche statt kumuliert), die Einsatzplanverteilung (gierig statt gleichmäßig), die Schweißerkapazität (erst falsch „behoben", dann zurückgenommen) und die Schichtumrechnung (`stundenFuer` rundete die Schichtzahl, dadurch wurden aus 12 h Belegungszeit stillschweigend 15 h — der Vorschlag verglich zwei verschiedene Werkstätten und schrieb einer Schicht 206 Tage Wirkung zu, die nicht von ihr kamen). Dazu die Näherung im Rechenweg: Sie rechnete jeden Tag mit der Regelarbeitszeit und ließ die Überstunden weg (bei 4 h je Woche 943 h Defizit), und die Produktivität stand als „1 %" da, weil ein Faktor an einen Prozentbaustein ging. Fünf der sechs fand die Abteilungsleitung durch Rückfragen, einen meine eigene Prüfung. |
| 299 | **„Es gibt da keine Überkapa" — meine Aussage war falsch.** | Ich hatte 7.421 ungenutzte Mannstunden als Auftragsbestandsproblem bezeichnet. 4.909 h davon liegen in Wochen ohne einen einzigen eingepflegten Auftrag. Richtig ist: rund 2.500 h ungenutzt im Zeitraum mit Aufträgen. Die Anwendung meldet das jetzt selbst. |
| 300 | **Das Werkzeug plant und steuert — aber es entscheidet nicht.** | Zuletzt festgelegt: „doch auch steuern." Es rechnet Wege durch, benennt Engpässe und Kosten und schreibt nichts von selbst fort. Jede Maßnahme landet in einem Szenario, das verworfen werden kann. Die Entscheidung bleibt bei der Abteilungsleitung — auch dann, wenn die Rechnung eindeutig aussieht. |
