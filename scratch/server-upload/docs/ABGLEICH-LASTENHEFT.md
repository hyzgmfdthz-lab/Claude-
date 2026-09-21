# Abgleich mit dem Lastenheft – alle 99 Punkte

Stand: 16.09.2026 · Zweig `claude/happy-pasteur-6271im`

Geprüft wurde jeder Punkt des ursprünglichen Lastenheftes gegen den
tatsächlichen Stand der Anwendung. Die Spalte **Nachweis** nennt die Stelle
im Programm, an der es umgesetzt ist, bzw. die Prüfung, die es belegt.

Bewertung:
- **ja** – vollständig umgesetzt und durch eine Prüfung belegt
- **teilweise** – umgesetzt, aber mit benannter Einschränkung
- **offen** – noch nicht umgesetzt

| Nr | Thema | Stand | Nachweis / Anmerkung |
|---:|---|---|---|
| – | Keine Excel-Verbesserung, eigene Architektur | ja | Eigenständige Anwendung: Engine (`engine/`), Server (`server/`), Oberfläche (`web/`). Drei Architekturvarianten wurden bewertet, Entscheidung: lokale Web-App mit lokalem Backend. |
| 1 | Fachbereich Armaturenbau | ja | Arbeitsfolge, Ressourcen und Begriffe durchgängig aus dem Armaturenbau; keine Montageschritte. |
| 2 | Mit allen Einflussgrößen spielen | ja | Stellschrauben-Panel (`web/js/views/stellschrauben.js`), 14 Größen; Wirkung sofort sichtbar. |
| 3 | Nicht schönrechnen | ja | `engine/scheduler.js` verbraucht nur vorhandene Kapazität; Test „§3 Es werden niemals mehr Stunden verbraucht als vorhanden". |
| 4 | Planungsebenen (Auftrag … Szenario) | ja | `engine/model.js` (Auftrag, Variante, Arbeitsfolge), `capacity.js` (Kapazität, Prozessressource, Sonderrestriktion), `scenario.js`. |
| 5 | Projektarten | ja | `PROJECT_TYPES`: Neubau, Umbau, WKP, Prüfer, Reparatur, Sonderprojekt, **neu** Kleinauftrag/Zubehör. Frei ergänzbar. |
| 6 | Neubau-Varianten 20/30/40/45 ft | ja | Vier getrennte Vorlagen; Stunden je Variante änderbar. Test „Arbeitsplan: eigene Vorlage je MEGC-Variante, Stunden getrennt änderbar (§6/§8)". |
| 7 | IST-Arbeitsfolge, Reinigen nur bei WKP | ja | `defaultNetwork(withCleaning)`; Reinigen nur in der WKP-Vorlage. |
| 8 | Arbeitsfolgen je Projektart editierbar | ja | Bereich Aufträge → Arbeitsfolgen; Änderung rechnet alle betroffenen Aufträge neu. |
| 9 | Heften und Orbital teilweise parallel | ja | Abhängigkeitsart `OVERLAP` in `engine/routing.js`. |
| 10 | Heftvorsprung 5/7,5/10 h | ja | `config.tacking`; in den Parametern editierbar. |
| 11 | Arbeitsfolge als Abhängigkeitsnetz | ja | `topoSort` über Vorgänger je Arbeitsgang, nicht als starre Liste. Test „Arbeitsfolge ist ein Abhängigkeitsnetz (topologische Sortierung, §11)". |
| 12 | 6 Orbitalmaschinen, Zahl änderbar | ja | `resources.orbitalMachines` / `orbitalMachinesActive`, Regler im Panel. |
| 13 | 1 Schweißer : 2 Maschinen, getrennte Grenzen | ja | `machinesPerWelder`; die Rechnung nimmt immer die engere Grenze. Test „Kapazität: Orbital – Maschinen und Schweißer als getrennte Restriktionen (§13)". |
| 14 | Orbitalschweißer je Tag/Woche editierbar | ja | `welders.byWeekday` und `welders.byDate` in den Parametern. |
| 15 | 2 Heftplätze, 3. aktivierbar | ja | `heftPlaces` / `heftPlacesMax`; als Maßnahme im Optimierer (`HEFT_PLACE`). |
| 16 | 3–4 Mitarbeiter je Projekt, konfigurierbar | ja | `projectLimits.maxWorkersPerProject`, zusätzlich `maxWorkers` je Arbeitsgang. |
| 17 | 2–3 Projekte parallel, nicht hart | ja | `maxParallelProjects` als Regler; die tatsächliche Parallelität ergibt sich aus Plätzen, Maschinen und Personal. |
| 18 | Mitarbeiterkapazität je Arbeitsgang | ja | Qualifikationsanteile (`skills`) und die Qualifikationsmatrix der Mannschaft begrenzen jeden Arbeitsgang. Engpass wird je Arbeitsgang ausgewiesen. |
| 19 | Globale Produktivität, editierbar, zu validieren | ja | `productivity.global` (Regler 60–110 %); Beispielrechnung als Test „Kapazität: Beispiel aus dem Lastenheft §19 (10 MA x 37,5 h x 85 %)". |
| 20 | 37,5 h je Woche, editierbar | ja | `workTime.regularHoursPerWeek`. |
| 21 | Leiharbeiter je Woche/Zeitraum | ja | Mannschaft: je Person Eintritt, Ende, Anwesenheit je Kalenderwoche, Qualifikationen. |
| 22 | Einarbeitungskurve konfigurierbar | ja | `rampUp.temp` / `rampUp.hire` (40/60/80 %) plus Betreuungsstunden 5/3/1 h – Werte aus Auskunft, editierbar. |
| 23 | Neueinstellungen als Hebel | ja | Personenart „Neueinstellung" in der Mannschaft; Maßnahme `HIRE` im Optimierer. |
| 24 | Fremdvergabe ausgeschlossen | ja | `outsourcing.enabled = false`; der Optimierer kennt die Maßnahme nicht. |
| 25 | Samstagsarbeit, 6 h | ja | `workTime.saturdayHours`, Samstage je Kalenderwoche schaltbar. |
| 26 | Samstagsbesatz 20 % dynamisch | ja | `saturday.quota` wirkt auf die jeweils verfügbare Besetzung. |
| 27 | Samstagsquote editierbar und überschreibbar | ja | `quota` je Stand, `quotaOverride` und `headcountOverride` je Woche. |
| 28 | Samstage für beliebige Wochen | ja | `saturday.weeks` ist nicht auf 2026 begrenzt. |
| 29 | Überstunden je MA und Woche | ja | Regler 0–10 h; Zusatzkapazität = Mitarbeiter × Überstunden × Produktivität, Qualifikationen wirken weiter. |
| 30 | Material T-4 Wochen, überschreibbar | ja | `leadTimes.materialWeeks`, je Auftrag „Material verfügbar ab". |
| 31 | Neubaustart T-3 Wochen | ja | `leadTimes.startWeeks.NEUBAU`. |
| 32 | Umbau/WKP T-4 Wochen | ja | `startWeeks.UMBAU/WKP`, je Auftrag überschreibbar (`earliestStart`). |
| 33 | Heftstart 3–4 Wochen vorher | teilweise | Ergibt sich aus Arbeitsfolge, Material- und Startregel; eine eigene Heftstart-Regel ist bewusst nicht zusätzlich hinterlegt, sonst gäbe es zwei Wahrheiten. |
| 34 | Fertigstellung = Deadline Armaturenbau | ja | `dueDate` ist die Deadline, `handoverDate` nur Information. Von der Abteilungsleitung ausdrücklich bestätigt. |
| 35 | Kein künstlicher Puffer | ja | Test „Kein künstlicher Puffer: der Fertigstellungstermin ist die Deadline (§35)". |
| 36 | Hydro nur Di–Do | ja | `hydro.allowedWeekdays`; im Panel einstellbar. |
| 37 | Hydro nur bei NoBo | ja | `hydro.requireNoBo`, `nobo.weekdays` und tagesgenaue Ausnahmen. |
| 38 | NoBo als Szenarioparameter | ja | Im Stellschrauben-Panel und im NoBo-Kalender; Test „NoBo steuert die möglichen Hydrotage (§37/§38)". |
| 39 | Tagesrechnung plus Wochenansicht | ja | Rechnung tagesgenau (`daySeries`), Wochenansicht in Diagramm, Wochentabelle und Belegungsgitter. |
| 40 | Ansichten Tag und Woche | ja | Belegungsgitter mit Zoom Tag/Woche/Monat, Gantt mit Tages- und Wochenebene. |
| 41 | Fortschritt in % oder je Arbeitsgang | ja | `progressMode` PERCENT / PER_OPERATION; Reststunden je Arbeitsgang haben Vorrang. |
| 42 | Statuslogik „x" und „Fertig" | ja | Import erkennt beides; fertige Arbeit geht nicht in die Zukunftskapazität. |
| 43 | Prioritäten P1–P4 | ja | In der Liste direkt änderbar; P1 ist die höchste. |
| 44 | Automatische Reihenfolgeoptimierung mit Freigabe | ja | `optimize(..., mode: 'proposals')` schlägt vor; Übernahme erst nach Bestätigung („Übernehmen"). |
| 45 | Manuelle Reihenfolge | ja | Pfeile in der Auftragsliste, `sequenceLocked`; Test „Manuell fixierte Reihenfolge wird respektiert (§43/§45)". |
| 46 | Bekannte Neubauprojekte als Startdaten | ja | `engine/seed.js`, 37 Aufträge mit den Terminen aus der Planung und den 12 Korrekturen vom 15.09.2026. |
| 47 | Bekannte Umbauten | ja | WGC40-S00355 (Lhyfe), WGC40-S00350 (Linde BLX) im Startbestand. |
| 48 | Wiederkehrer nicht doppelt führen | ja | Stabile IDs plus `formerIds`; Test „§48/§77 Umbenennung erzeugt kein zweites Projekt (stabile IDs)". |
| 49 | Infraserv/PAK als Regressionstest | ja | Test „§49 Reihenfolgetausch (Infraserv / PAK) rechnet wirklich neu". |
| 50 | Stichtag 10.09.2026, änderbar | ja | `planningDate`; Termin vorbei und Reststunden offen ⇒ verspätet. |
| 51 | Rote Termine sind die gültigen | ja | Beim Import gewinnt der neue Termin; die 12 Änderungen vom 15.09.2026 sind eingepflegt. |
| 52 | Hydro-Wartezeit wirkt auf den Termin | ja | Test „Hydroprüfung findet nie montags oder freitags statt (§52)"; Wartezeit steht in der Ursachenanalyse. |
| 53 | Kapazität je Arbeitsgang (Tag/Woche/Zeitraum) | ja | `processBalance`, Auslastungsmatrix je Arbeitsplatz und Woche, Diagramm je Arbeitsgang. |
| 54 | Orbitalschweißen getrennt auswerten | ja | `orbitalReport`: Maschinen, nutzbare Maschinen, Schweißer, Maschinen- und Mannstunden, Auslastung, Engpass. |
| 55 | Historische Taktlogik nicht erfinden | ja | Übernommen wurde nur 1 Schweißer : 2 Maschinen; alles Weitere ist editierbar. |
| 56 | Szenariohebel (Personal, Zeit, Leistung, Prozesse, Ressourcen, Aufträge) | ja | Alle genannten Größen sind einstellbar; Personal jetzt über die Mannschaft statt über Zahlenregler. |
| 57 | Wochenweise variable Kapazitäten | ja | Wochenwerte, Samstage je Woche, Belegungszeit je Woche, Anwesenheit je Kalenderwoche. |
| 58 | NoBo-Kalender mit Häkchen | ja | Bereich Einstellungen → Parameter, Kalender mit tagesgenauen Häkchen. |
| 59 | Dashboard mit 14 Kennzahlen | ja | Sechs Kacheln oben (festgelegt von der Abteilungsleitung), darunter die übrigen Kennzahlen. |
| 60 | Haupt-Kapazitätsdiagramm (Säulen gegen Kennlinie) | ja | `capacityChart`: Bedarf als Säulen, Kapazität als Kennlinie, zweite Kennlinie für den IST-Stand, Überlast rot. |
| 61 | Prozessdiagramme je Arbeitsgang | ja | Umschalter im Diagramm auf einen einzelnen Arbeitsgang. |
| 62 | Interaktives Gantt Tag/Woche | ja | Bereich Planung → Terminplan mit Kunde, Auftrag, Art, Variante, Soll, Prognose, Status. |
| 63 | Arbeitsgang-Gantt aufklappbar | ja | Projektzeile aufklappbar; je Arbeitsgang Balken. |
| 64 | Ursachenanalyse statt nur „rot" | ja | `engine/rootcause.js`: Stunden, Arbeitsgang, Ursache, Tage, Hydro-Wartezeit, Materialstand. |
| 65 | Mehrere Lösungsvarianten | ja | `proposeSolutions`: mehrere Pakete mit Wirkung und Begründung. |
| 66 | Lösungen engpassbezogen, nicht nach Gesamtstunden | ja | „Was bringt wirklich etwas?" rechnet jeden Hebel einzeln durch und weist wirkungslose und schädliche Hebel getrennt aus. Im Startbestand: Personal hilft nicht, die Plätze sind der Engpass. |
| 67 | Funktion „Was ist notwendig, um alle Termine zu halten?" | ja | Optimierer mit allen genannten Maßnahmen, ohne Fremdvergabe. |
| 68 | Fünf Optimierungsziele | ja | `OBJECTIVES`: OTD, Anzahl verspätet, Gesamtverspätung, Personaleinsatz, Samstagsarbeit. Kosten werden ausgewiesen, aber nicht optimiert (OTD steht über den Kosten). |
| 69 | Baseline und Szenarien | ja | Baseline bleibt unverändert; Test „Szenario: Baseline bleibt bei Duplikat unverändert (§69)". |
| 70 | Szenarien vergleichen, auch grafisch | ja | Bereich Planung → Vergleich: Kennzahlentabelle, Unterschiede, Diagramm mit IST-Linie, Auftragswechsel. |
| 71 | Wirkung meiner Änderung | ja | `impact()` mit Kennzahlendifferenz und Auftragswechseln; im Vergleich sichtbar. |
| 72 | Automatischer Vorschlag mit Begründung | ja | Vorschläge nennen Maßnahme, Wirkung und was noch fehlt. |
| 73 | FTE-Darstellung der Lücke | ja | `requiredFteWeeks` und „Personalbedarf" in der Antwortzeile. |
| 74 | Projektdetailansicht | ja | Seitenpanel rechts mit allen 17 genannten Angaben einschließlich Ursache und Fehlteilstand. |
| 75 | Projekte hinzufügen/löschen/duplizieren/ändern | ja | Alles in der Auftragsliste; Auswertungen rechnen neu. |
| 76 | Eine zentrale Datenquelle | ja | Alle Ansichten lesen `dataset.projects`; Test „§76 Eine zentrale Projektquelle: Gantt und Projektliste sind immer identisch". |
| 77 | Eindeutige dauerhafte IDs | ja | `makeId`; Name, Sortierung und Position haben keinen Einfluss auf die Identität. |
| 78 | Stichtag und Vergangenheit | ja | Status DONE / LATE / laufend / zukünftig; Termin vorbei + Rest ⇒ verspätet. |
| 79 | Datenvalidierung (9 Prüfungen) | ja | `engine/validation.js` deckt alle neun Fälle ab; Ergebnis unter Einstellungen → Daten & Prüfung. |
| 80 | Technologie: lokal, ohne Cloud, Windows, einfach | ja | Node ≥ 20 ohne Fremdbibliotheken; `Einrichten.bat` richtet Start, Firewall und Autostart ein. Zusätzlich eine Einzeldatei, die ohne jede Installation läuft. |
| 81 | Robuste lokale Datenhaltung | ja | `node:sqlite` mit JSON-Rückfallebene, automatische Sicherungen. |
| 82 | Excel-Import und -Export, optional PDF | teilweise | Import und Export als xlsx/csv vorhanden (Projektplan, Kapazität, Vergleich, Managementübersicht, Einsatzplan). **PDF-Bericht offen** – es fehlt die Logodatei für den Briefkopf. |
| 83 | Später Arbeitsplatz- und Belegungsplanung | teilweise | Belegungsgitter ist da (Arbeitsplatz/Mitarbeiter × Tag, Konflikte, Schichten). **Offen:** Ziehen mit der Maus, Hallenlayout, Flächenbelegung. Bewusst so: eine Handverschiebung wäre eine zweite Wahrheit neben der Rechnung. |
| 84 | Arbeitsplätze als eigene Objekte | ja | `dataset.workplaces` mit Typ, Bereich, Kapazität, aktiv/inaktiv; kein Textfeld im Projekt. |
| 85 | Langfristiges Zielbild (Auftrag → Tag/Schicht) | ja | Die Kette ist durchgerechnet: Auftrag → Arbeitsfolge → Kapazität → Ressource → Arbeitsplatz → Tag; Schicht über die Belegungszeit je Arbeitsgang. |
| 86 | Engine von der Oberfläche getrennt | ja | `engine/` kennt die Oberfläche nicht und wird eigenständig getestet. |
| 87 | 13 Testfälle | ja | Alle 13 sind als eigene Tests vorhanden (Kapazität > Bedarf, Bedarf > Kapazität, Produktivität, Leiharbeiter, Samstag, Schweißer, Maschine, 3. Heftplatz, NoBo, Projekt hinzufügen/löschen, Termin vorziehen, Priorität). |
| 88 | Regressionstest Überlastfall | ja | Test „§88 Künstlicher Überlastfall MUSS verspätete Projekte erzeugen". |
| 89 | Keine minutenlange Berechnung | ja | Test „eine vollständige Analyse dauert deutlich unter einer Sekunde"; gemessen rund 100 ms. |
| 90 | Keine Blackbox | ja | Jede Verspätung nennt Stunden, Arbeitsgang und Ursache; zusätzlich die Plausibilitätsprüfung „Kommt das so hin?". |
| 91 | MVP-Mindestumfang (34 Punkte) | ja | Alle 34 Punkte sind enthalten (siehe die Zeilen oben). |
| 92 | Nichts erfinden, „zu validieren" kennzeichnen | ja | `validated: false` an jedem Startwert, Liste in `docs/ZU-VALIDIEREN.md`, Kennzeichnung in der Oberfläche. |
| 93 | Bedienablauf in 15 Schritten | ja | Test „§93 Vollständiger Bedienablauf" geht alle 15 Schritte durch. |
| 94 | „Was passiert, wenn …?" und „Was müsste ich ändern?" | ja | Stellschrauben mit sofortiger Wirkung; „Was bringt wirklich etwas?" und der Optimierer beantworten die zweite Frage. |
| 95 | Vorgehen in 11 Phasen | ja | In dieser Reihenfolge gearbeitet: Fachmodell, Datenmodell, Architekturbewertung, Engine, Tests, Oberfläche, IST-Daten, Szenarien, Optimierung, vollständige Prüfung. |
| 96 | Keine Rückfrage zur Technik | ja | Technische Entscheidungen wurden getroffen, nicht erfragt; Rückfragen nur fachlich. |
| 97 | Qualitätsreihenfolge (Logik vor Optik) | ja | Engine und Rechnung zuerst, die Maske in der zweiten Fassung nach der Kritik vom 15.09.2026. |
| 98 | Ergebnis: 12 Lieferbestandteile | ja | Alle zwölf: lauffähiger Stand, Quellcode, Windows-Start (`Einrichten.bat`), dauerhafte Datenhaltung, eingepflegte IST-Daten, Oberfläche zur Pflege fehlender Werte, Szenarien, Lösungsvorschläge, Tests, Bedienungsanleitung (`docs/BEDIENUNG.md`), Planungslogik (`docs/PLANUNGSLOGIK.md`), zu validierende Parameter (`docs/ZU-VALIDIEREN.md`). |
| 99 | Oberstes Ziel: schnell verstehen | ja | Übersicht beantwortet die sieben genannten Fragen ohne Klick; Belegungsgitter zeigt, wo es klemmt. |

## Nachtrag 16.09.2026 – was nach der Rückmeldung dazukam

| Thema | Stand | Nachweis / Anmerkung |
|---|---|---|
| Mehraufwand statt „nicht einplanbar" | ja | `engine/mehraufwand.js`, Ansicht Übersicht → Mehraufwand. Die alte Kennzahl summierte eine Tageswarteschlange über 173 Tage und wies dadurch 4.119 h statt 679 h aus; sie ist ersatzlos gestrichen. Wo eine Warteschlange weiter nützlich ist, heißt sie „Stau" und sagt dazu, dass sie je Tag zählt. |
| Vier Wege nebeneinander | ja | Überstunden (max. 5 h je MA und Woche) → zweiter Platz → Leiharbeiter → Samstag, in dieser Reihenfolge; auch der Weg ohne Wirkung bleibt sichtbar. |
| Paket für das ganze Quartal | ja | `schnuerePaket` nimmt von jedem Mittel nur so viel wie nötig; „Paket in Szenario übernehmen" legt ein Szenario an und rechnet den vollen Plan neu. |
| Rollierendes Quartal | ja | 13 Wochen ab dem Stichtag, nicht das Kalenderquartal. |
| Befunde bestätigen | ja | „Erledigt" an jedem Befund; zählt nicht mehr in Kachel und Ampel, bleibt nachlesbar, meldet sich bei höherer Dringlichkeit wieder (`wendeBestaetigungenAn`). |
| Art je Kürzel (Stamm / Leihe / neu) | ja | Mannschaft → Spalte „Art"; wirkt auf Kostensatz, Einarbeitungskurve und Betreuungsaufwand. |
| AV bis Ende 2026 erledigt | ja | `AV_ERLEDIGT_BIS` in `engine/seed.js`; baut 360 Verspätungstage ab. |
| Zweiter Entgratplatz möglich | ja | `maxPlaces: 2` – „Engpass kann ggf. von Hand mitgeholfen werden". |
| IST → heute → SOLL | ja | Einstellungen → Stände, Karte „Von wo nach wo". IST bleibt unverändert, SOLL ist das Ziel, „SOLL-Stand zum IST-Stand machen" schließt den Kreis. |
| Fehlteile nicht als eigene Größe | bewusst so | Ausdrückliche Entscheidung der Abteilungsleitung: Statt einer getrennten Fehlteil-Rechnung wird der **früheste Arbeitsbeginn** des Auftrags von Hand gesetzt (Auftrag öffnen → „Frühester Arbeitsbeginn"). Aus der Mehraufwand-Ansicht führt je Auftrag ein Knopf „Öffnen" dorthin. |

## Nachtrag 17.09.2026 – Personal nur über die Mannschaft

| Thema | Stand | Nachweis / Anmerkung |
|---|---|---|
| Meldung statt stiller Ergänzung | ja | „Wenn zusätzliches Personal dazu kommen muss möchte ich eine Meldung bekommen und das rein über den Reiter Mannschaft anpassen." Befund `PERSONAL_FEHLT` (`engine/plausibilitaet.js`) nennt Wochen, fehlende Stunden und Köpfe; die Meldung steht im Reiter Mannschaft mit dem Knopf „N Leiharbeiter einplanen". |
| Eine einzige Stelle für Personal | ja | `headcountFor` (`engine/capacity.js`) rechnet in der Betriebsart MANNSCHAFT nur noch mit der Mannschaftsliste. Die alten Zahlenlisten `tempWorkers`/`newHires` zählten still dazu – in der Wochenübersicht standen dadurch 24 Mitarbeiter in einer Abteilung mit neun. |
| Altbestand nicht verrechnen, aber auch nicht verschwinden lassen | ja | Einstellungen → Parameter → Personal zeigt sie als „Alte Zahlenlisten – ohne Wirkung", mit „In die Mannschaft übernehmen" und „Entfernen"; Plausibilitätsbefund `ZAHLENLISTEN_OHNE_WIRKUNG`. In der Rückfallebene Wochenzahlen wirken sie weiter – dort gibt es keine Mannschaftsliste. |
| Bedarfsrechnung und Vorschläge gehen denselben Weg | ja | `mitZusatzPersonal()` (`engine/team.js`) legt Leiharbeiterplätze in der Mannschaft an; `requiredAdditionalStaff` und der Optimierer nutzen sie, statt eine Anzahl daneben zu führen. |
| Stau ist keine Stundenzahl | ja | „Stau je Tag" wies eine über alle Tage summierte Warteschlange als Stunden aus (6.067 h an einem Arbeitsplatz mit 340 möglichen Stunden). Jetzt getrennt: `blockedDays` (Tage mit Rückstand) und `blockedPeak` (größter Tageswert in Stunden). |
| Schichten je Arbeitsgang | ja | Tabelle „Schichten und Plätze je Arbeitsgang" in Einstellungen → Parameter und unter Übersicht → Engpässe & Wirkung; Spalte „läuft" sagt, ob der Wert eigens gesetzt ist oder aus dem Standard „Belegungszeit der Plätze je Tag" kommt. |

## Nachtrag 18.09.2026 – Zahlen, die sich nachrechnen lassen

| Thema | Stand | Nachweis / Anmerkung |
|---|---|---|
| Engpasszahl war Stunden × Tage | behoben | „belegt 3145 h und weitere 3286 können nicht eingeplant werden – das kann nicht passen." `bottleneckRanking` summierte eine Tageswarteschlange über alle Wartetage. Jede Arbeit zählt jetzt genau einmal: 3.039 h → 885 h bei den Arbeitsplätzen. |
| Stunden auf den Arbeitsgängen | ja | Karte „Stunden je Arbeitsgang" in Engpässe & Wirkung. Die Spalte „offen" summiert sich auf genau die offene Arbeit aller Aufträge (6.501 h); die Fußzeile weist das aus. |
| Kapazität ohne Zeitraum | behoben | Jede Kapazitätszahl nennt jetzt ihren Zeitraum. Neue Karte „Woher die Kapazität kommt" mit Arbeitstagen, Besetzung, Stunden je Tag, Produktivität, Reserve, Betreuung – und derselben Rechnung als Näherung (Abweichung 4,7 h von 8.649 h). |
| Kapazität zählte die Randwoche ganz | behoben | 9.012 h statt 8.649 h; `availableHours` rechnet taggenau. |
| Platzstunden als Mannstunden ausgewiesen | behoben | Spalte hieß „Kapazität im Zeitraum", addiert 21.826 h – dieselbe Mannschaft elfmal. Heißt jetzt „Platzstunden im Zeitraum", mit Warnung und den Mitarbeiterstunden einmal daneben. |
| „441 h = 14 Mitarbeiter" | behoben | „Hast du sie noch alle?" Die Meldung nahm die schlimmste Einzelwoche eines geglätteten Profils und teilte durch die Wochenleistung. Jetzt: kumuliert nach Terminen, geteilt durch die Wochen bis dahin – 679 h bis KW 48 = 1,7 MA statt 10 MA. |
| Personal nur fordern, wenn Personal die Grenze ist | ja | Neuer Befund `MANNSCHAFT_NICHT_AUSLASTBAR`: Im Startdatenbestand warten 1.449 h an der Anlage und 71 h an den Leuten. Der Knopf „N Leiharbeiter einplanen" erscheint dann gar nicht. |
| Einsatzplan war verdreht | behoben | „MAAP wird an manchen Tagen garnicht geplant obwohl anwesend." Der Code gab dem Ersten sein ganzes Tagesbudget: JARO 1.170 h gegen TOBE 21 h. Jetzt 478–485 h je Vollzeitkraft, 242 h für die Halbtagskraft, 0 h ohne Namen. |
| Leerlauf mit Grund | ja | „kein Platz frei" / „keine Qualifikation" / „keine Arbeit offen" statt Gedankenstrich; je Woche die Zahl der Personentage ohne Arbeit. |
| Die Werkstatt ist der Engpass, nicht die Mannschaft | Befund | Von 13.921 Mannstunden sind 6.500 h einsetzbar (47 %). An 1.007 von 2.183 anwesenden Personentagen ist kein Platz frei. 77 Platzstunden je Tag gegen 88 Mannstunden. Zweiter Platz, Belegungszeit oder Samstag – nicht Personal. |

## Was ausdrücklich offen ist

1. **PDF-Bericht mit Briefkopf** (§82). Es fehlt die Logodatei als PNG oder SVG.
   Im Kopf der Anwendung steht bis dahin ein SVG-Nachbau (`web/js/views/marke.js`).
2. **Ziehen mit der Maus im Belegungsgitter** (§83). Bewusst zurückgestellt:
   Eine Handverschiebung wäre eine zweite Wahrheit neben der Rechnung. Der
   nächste Schritt ist, sie als gespeicherte Festlegung zu bauen, die die
   Rechnung respektiert.
3. **Hallenlayout und Flächenbelegung** (§83). Weiterhin ausdrücklich später.
4. **Zeiten der Kleinaufträge** (Zubehör). Die Arbeitsfolge steht, die Zeiten
   stehen auf 0. Der Aufwand läuft bis dahin über die Reserve von 18 h je Woche.
5. **Urlaubsplanung 2026** ist einzulesen (Mannschaft → Urlaubsplanung einlesen).
   Ohne sie rechnet die Anwendung ab dem Stichtag mit einer Mannschaft ohne
   Abwesenheiten – die Plausibilitätsprüfung weist genau darauf hin.
