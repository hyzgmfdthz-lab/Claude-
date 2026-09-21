# Übergabe an Claude – Armaturenbau MEGC

Version: Runde 01, 20.09.2026. Zweck: Implementierung durch Claude, anschließend unabhängige Prüfung durch ChatGPT/Codex anhand der tatsächlich gelieferten Datei.

## Arbeitsauftrag

Bitte korrigiere den vorhandenen Produktionsplaner auf Basis dieses Auftrags und des beigefügten Prüfpakets. Die vorhandene Oberfläche, Projektdaten und bereits funktionierenden Funktionen sollen erhalten bleiben. Keine parallele Neuentwicklung und keine Änderung der privaten Sichtbarkeit.

Dominik entscheidet fachliche Regeln. Claude implementiert und liefert Belege. ChatGPT/Codex prüft die neue Datei unabhängig und erstellt anschließend die nächste versionierte Fehlerliste. Ein grüner eigener Testlauf ist eine wichtige Voraussetzung, aber noch keine unabhängige Abnahme.

Die Behauptungen im letzten Claude-Verlauf – unter anderem OTD-Korrektur, automatische Zusatzplätze und Korrekturen 05/09/10 – sind bis zur Prüfung des neuen Artefakts **gemeldet, noch nicht unabhängig bestätigt**. Der genannte Commit `45b2c1b` ist ein Bezugspunkt im Verlauf; der aktuelle vollständige Commit und der tatsächlich ausgelieferte Dateistand müssen mitgegeben werden.

## 1. Bestätigte fachliche Grundlage

| ID | Regel | Umsetzung |
|---|---|---|
| R01 | Neubau, Umbau, WKP/Wiederkehrer, Reparatur und Sonderprojekte; MEGC 20/30/40/45 ft | Stunden und Arbeitsfolgen editierbar erhalten. Gleiche Variantenzeiten nicht ohne Messwerte künstlich unterscheiden; Herkunft und Validierungsstand anzeigen. |
| R02 | Sechs Orbitalmaschinen; ein Schweißer bedient zwei Maschinen | Personal- und Maschinenbindung gleichzeitig prüfen. 90,25 h Orbital je Standard-Neubau sind Personalstunden, keine Maschinenstunden. Unter der bestehenden Regel ergeben drei gleichzeitig eingesetzte Schweißer mit je sieben produktiven Stunden 21 Personalstunden/Tag. |
| R03 | Zwei Heftplätze; ein dritter ist möglich | Zusatzplatz nur mit tatsächlich verfügbarer, qualifizierter Besetzung wirksam. |
| R04 | Heften und Orbital dürfen überlappen | Zulässigen Vorsprung und freigegebene Teilmengen abbilden. Keine pauschale Ende-Start-Kette daraus machen. Widersprüche zwischen Prozent- und Stundenregeln vor dem Planlauf erkennen. |
| R05 | Hydroprüfung nur Dienstag bis Donnerstag | Zusätzliche Samstage oder Schichten öffnen dieses Prüffenster nicht automatisch. |
| R06 | Personal bleibt in der festgelegten Schicht | Schichtzuordnung innerhalb der Woche stabil halten; bestätigte manuelle Bindungen beachten. Aufträge dürfen innerhalb dieser Besetzung gewechselt und vorgezogen werden. |
| R07 | Maximale Mehrarbeit werktags: fünf Stunden je Mitarbeiter und Woche, zusätzlich Samstagsarbeit als Stellschraube | Persönlich und kumuliert prüfen. Bereits eingeplante Mehrarbeit verbraucht dieses Budget. Bei bereits fünf Stunden beträgt der weitere Spielraum werktags null. |
| R08 | Samstag: bisher sechs Stunden und 20 % Besetzung sind der aktuelle Stand | Diese Angaben sind keine bestätigte Obergrenze. Abweichende Vorschläge mit konkreten Personen/Stunden/Daten und offenem Verfügbarkeitsstatus ausweisen. Keine unbegrenzte Teilnahme stillschweigend annehmen. |
| R09 | Drei zusätzliche Leihkräfte sind bereits da; eine weitere startet am 21.09.2026, eine am 01.10.2026 | Diese Personen sind bereits in der Mannschaftsliste enthalten. Bestehende IDs und Startdaten abgleichen, nicht fünf weitere Personen anlegen. Bei Mehrdeutigkeit die betroffenen Datensätze benennen. |
| R10 | Der Planer soll zusätzlichen Leihbedarf je Kalenderwoche bestimmen | Bereits anwesende und zugesagte Kräfte berücksichtigen; darüber hinausgehenden Bedarf getrennt nach Personenzahl, Qualifikation, Stunden und erforderlichem Eintritt anzeigen. Eintritt und Einarbeitung vor der Bedarfswoche beachten. |
| R11 | Aktuell dürfen alle Mitarbeiter alle Arbeitsgänge ausführen | Dies ist inzwischen ausdrücklich bestätigt. Die Qualifikationsmatrix bleibt bearbeitbar; der Rechenkern muss auch eingeschränkte Qualifikationen korrekt behandeln. |
| R12 | Leiharbeit regulär 55 €/Rechnungsstunde; werktägliche Mehrarbeit +25 % | Mehrarbeitssatz 68,75 €/h. Auf den Rechnungssatz keinen Arbeitgeberfaktor zusätzlich anwenden. |
| R13 | Stammpersonal: Mehrarbeitszuschlag 35 % | Vom Lohn und der bestätigten Zuschlagsbasis rechnen. Der hinterlegte Arbeitgeberfaktor 1,3 und Stammlohn 22,50 € bleiben gesondert gekennzeichnete Rechenannahmen, soweit nicht anderweitig ausdrücklich bestätigt. |
| R14 | Ziel: annähernd 90–95 % Liefertreue, Kosten der Spitzen sichtbar machen | Gegen ursprüngliche Zusagen und einen unveränderten Auftragsbestand messen. Ziel als Planungsziel behandeln; keine Zusage ohne ausführbaren Plan. |

Die vorstehende Qualifikationsbestätigung aktualisiert den älteren Auditbericht. Ebenso ersetzt die Kostenregel für Leihmehrarbeit die frühere pauschale Anwendung von 35 % auf alle Personen.

## 2. Feste Schicht – bewegliche Aufträge

Dominiks letzte Klarstellung lautet sinngemäß: Mitarbeiter sollen nicht beliebig die Schicht wechseln. Stattdessen können Aufträge vorgezogen und in der tatsächlich besetzten Schicht abgearbeitet werden.

Das bedeutet für die Engine:

1. Zuerst vorhandene Personen, ihre Schichtfenster, Abwesenheiten, persönlichen Budgets, Qualifikationen und feste Bindungen bestimmen.
2. Für jedes freie Zeitintervall alle fachlich ausführbaren Arbeitsgänge über alle zulässigen Aufträge ermitteln. Nicht nur den gerade betrachteten Auftrag prüfen.
3. Prioritäten, feste Reihenfolgen und manuelle Sperren berücksichtigen. Ist der bevorzugte Vorgang blockiert, nach einem anderen zulässigen Vorgang suchen.
4. Person, Arbeitsplatz/Maschinen, Zeitintervall und gegebenenfalls Helfer gemeinsam reservieren. Dieselbe Person und derselbe Platz dürfen nicht doppelt belegt werden.
5. Bei einem vorgezogenen Auftrag bleiben Materialverfügbarkeit, technische Freigaben, Vorgänger, zulässige Überlappung und Prüftage wirksam.
6. Historische Regeln „Start erst drei/vier Wochen vor Termin“ nicht ungeprüft als physische Sperre behandeln. Pro Regel unterscheiden: echte Freigabebedingung oder organisatorisches Ziel. Bestehende Regeln nicht still entfernen; blockierende Regeln mit Auftrag und Wirkung zur Entscheidung ausweisen.
7. Wo kein zulässiger Vorgang existiert, freie produktive Stunden und die tatsächlich blockierenden Bedingungen ausweisen. Das Vorziehen von Arbeit darf nicht durch erfundene Freigaben oder Schichtwechsel erzwungen werden.

Beispiel: Mitarbeiter A ist die ganze Woche Frühschicht zugeordnet. Auftrag X wartet auf Material. Auftrag Y ist vollständig freigegeben und kann mit A an einem freien Platz bearbeitet werden. A arbeitet in seiner Frühschicht an Y. Weder wird A dafür in die Spätschicht versetzt, noch wird die Materialsperre von X aufgehoben.

## 3. Stundenarten und Schichten eindeutig halten

Getrennt führen: Anwesenheits-/Rechnungsstunden, produktive Personalstunden, abgearbeiteter Arbeitsinhalt sowie Maschinen-/Platzbelegung. Ein Helfer kann den Arbeitsinhalt schneller erledigen und dabei insgesamt mehr Personalstunden verbrauchen.

Sieben produktive Stunden bei 7,5 Anwesenheitsstunden sind im Regelbetrieb schlüssig. Ein Schichtfenster von sieben Anwesenheitsstunden bei Produktivitätsfaktor 1 ist dagegen ein anderer Testfall. Die beiden Fälle nicht vermischen.

Die Schichtzahl darf nicht aus 14/7,5 abgerundet werden und die zweite Besetzung verschwinden lassen. Einfaches Aufrunden darf ebenso wenig eine volle zusätzliche Schicht schenken. Konkrete Zeitfenster und deren Besetzung sind entscheidend; Schichtfenster, produktive Zeit und ausgewiesene Buchungen müssen übereinstimmen. Betriebliche Mindestbesetzung aus dem bisherigen Regelbestand berücksichtigen und tatsächlich gleichzeitig prüfen, nicht nur anhand der Köpfe des ganzen Tages.

Rundung ausschließlich nachvollziehbar behandeln: mit hinreichender interner Genauigkeit rechnen, Darstellung separat runden. Keine persönlichen Budgets oder erledigten Arbeitsinhalte erhöhen, um unzugeordnete Reststunden verschwinden zu lassen. Bei einem behaupteten Rundungsfehler ungerundete Eingaben, Rohbuchungen, Restbudgets und die Rechenidentität vorher/nachher zeigen. Numerische Toleranz darf keine reale Kapazität ersetzen.

## 4. Offene oder widersprüchliche Regeln – nicht selbst erfinden

| Thema | Nachgewiesener Kenntnisstand | Behandlung |
|---|---|---|
| Sägen, Entgraten, Hydro | Bestätigt ist Unterstützung am vorhandenen Platz. | Zusatzleistung und zusätzliche Personalbindung je Arbeitsgang sind noch offen. Bereits belegte Werte erhalten; weitere Werte nur als klar gekennzeichnete Szenarioannahme verwenden. |
| Zweiter Sägeplatz | Im neuen Claude-Verlauf automatisch geöffnet; widerspricht der hier zuletzt bestätigten Unterscheidung Helfer/Zusatzplatz. | Konkrete spätere Nutzerbestätigung benennen oder als offene Regel zurückstellen. Helfer nicht als zweite Maschine modellieren. |
| Zusatzplätze | Heften, Vormontage und Endkontrolle sind als Möglichkeiten genannt. Heften zwei auf drei ist bekannt. | Für Vormontage und Endkontrolle maxima aus einer ausdrücklichen Bestätigung belegen. Claudes Aussage „Endkontrolle vier bestätigt“ ist in dieser Prüfung bisher nur eine Änderungsbehauptung. |
| AV, Biegen, Beizen, Reinigen | Keine zusätzlichen Plätze/Helfer aus der letzten fachlichen Einschränkung. | Nicht automatisch erweitern. |
| Heftvorsprung | Bestehende Angabe fünf bis zehn Stunden; Prozentregeln können widersprechen. | Bezugsgröße klären und anzeigen: Personalstundenäquivalent, Losmenge oder zeitlicher Abstand sind nicht austauschbar. |
| Material/Fehlteile | Unklar, ob jedes fehlende Teil den ganzen Auftrag sperrt. | Vollständige Sperre und Sperre einzelner Arbeitsgänge getrennt modellieren. Bei vollständiger Sperre keine Umgehung über eine Frühstartregel. |
| Leiharbeit am Samstag | 25 % sind ausdrücklich für Mehrarbeit genannt; Samstagsabrechnung und Kombination mit Schichtzulagen noch nicht eindeutig. | Eigenes editierbares Feld mit Status „zu bestätigen“. Keinen Samstagsgesamtpreis als bestätigt ausweisen, solange die Regel offen ist. |
| Leihverfügbarkeit | Fünf Personen vorhanden/zugesagt; zusätzliche Verfügbarkeit nicht bestätigt. | Weitere benötigte Kräfte als Bedarf ausweisen. Ein Bedarfsszenario ist noch kein personell gesicherter Produktionsplan. |

Ein unbekannter Wert ist weder null noch unbegrenzt. Eine solche Annahme kann als Sensitivität untersucht werden, muss aber im Ergebnis und Ausdruck sichtbar bleiben.

## 5. Auftrag für die nächste Iteration

### Runde 01: ausführbare Terminierung

1. Aktuellen Stand der gemeldeten Korrekturen 01/05/09/10 mit neuer Datei und passenden Gegenproben sichern. Die bisherigen 411 grünen Tests ersetzen diese Gegenproben nicht.
2. Kritisch02 beheben: Personal-, Zeit-, Qualifikations- und Ressourcenreservierung schon in der Terminierung verbinden. Die nachträgliche Einsatzanzeige muss aus denselben Buchungen entstehen. Ein Termin darf nicht auf unbesetzten Reststunden beruhen.
3. Gleichzeitig die unmittelbar verbundenen Fälle 03/04/09 und die Regel „feste Schicht, bewegliche Aufträge“ absichern. Keine kosmetische Nachkorrektur der Termine ohne Prüfung der weiteren Abhängigkeiten.
4. Unfertige Arbeit bleibt offen. Vorschläge mit noch unbestätigtem Personal getrennt von abgesicherten Zusagen kennzeichnen. Eine Toleranz von 3 % namenloser Arbeit gilt nicht als Besetzungsnachweis.
5. Vorher/nachher mit identischem Datenexport vergleichen. Zahlen dürfen besser oder schlechter werden; aus der Richtung der Änderung allein folgt keine Richtigkeit.

Anschließend unabhängige Prüfung, bevor weitere Optimierungslogik darauf aufbaut.

### Weitere Runden, abhängig vom Prüfergebnis

- Zeitraumabgrenzung und vollständige Kapazitätskonten; Maßnahmen rechtzeitig vor jeder Fälligkeit bewerten (Audit06/08).
- Leihbedarf je KW und gemeinsam gerechnete Maßnahmenkombinationen. Keine bloße Umrechnung eines Gesamtdefizits in Köpfe ohne Qualifikations-, Platz-, Schicht- und Terminprüfung.
- Kostenrechnung auf tatsächlich zu bezahlender Zeit; vorhandene Kosten und zusätzliche Maßnahmenkosten getrennt ausweisen. Bestehende Mehrarbeit und bereits zugesagte Leihkräfte nicht nochmals als neue Maßnahme zählen.
- Management- und Betriebsratsausdruck aus demselben geprüften Szenario erzeugen; danach Bedienung, Export/Import und weitere Regressionen prüfen.

## 6. Verbindliche Gegenproben

Die unabhängige Prüfung verwendet die folgenden Eigenschaften. Falls sich APIs ändern, die Testanbindung anpassen, aber nicht die fachlichen Erwartungen abschwächen. Original-Gegenproben stehen im beigefügten Armaturenbau-Pruefpaket.zip.

| Test | Aufbau | Erwartung |
|---|---|---|
| T01 – OTD ohne Fertigstellung | Ein fälliger Auftrag, keine ausführbare Fertigstellung | Nicht als pünktlich zählen; bei diesem Ein-Auftrag-Bestand 0 % statt 100 %. Allgemein: im Nenner verbleiben, nicht pauschal jede Gesamtzielerreichung verhindern, wenn andere Aufträge das Prozentziel dennoch erfüllen. |
| T02 – gemeinsame Qualifikation | Zwei Personen; nur A darf Sägen und Biegen; je 7 h unabhängig, A hat insgesamt 7 produktive Stunden/Tag | Nicht 14 h am selben Tag fertigmelden. Person A höchstens 7 h; zweite Person erzeugt keine passende Zusatzkapazität. |
| T03 – echte Teil-/Folgeschicht | Sechs Schweißer, sechs Maschinen, zwei Maschinen je Schweißer, 14-h-Fenster, je 7 h produktiv bei Faktor 1; passende feste Schichtfenster 0–7 und 7–14 | 42 Personalstunden können bei dieser Besetzung innerhalb des Tages ausgeführt werden. Alle 42 h mit Personen und Ressourcen belegbar; keine zweite volle Schicht über das Fenster hinaus. |
| T04 – serieller Ganztag | Drei voll verfügbare, qualifizierte Personen; 35-h-Woche auf Mo–Fr, Produktivität 1, 7-h-Tagesfenster, keine Reserve/Abwesenheiten/Helfer. AV 7 h, anschließend Sägen 7 h als echte Ende-Start-Abhängigkeit. Je Vorgang max. eine Person/ein Platz. Start Montag 21.09.2026. | Fertigstellung frühestens Dienstag 22.09.2026. Eine Gegenprobe mit nur einer verfügbaren Person oder 7,5 h Tagesbudget prüft etwas anderes. |
| T05 – kurzer serieller Ablauf | Wie T04, aber AV 1 h, danach Sägen 1 h | Beide dürfen am selben Tag nacheinander fertig werden. Keine pauschale Verschiebung jedes Nachfolgers um einen ganzen Tag. |
| T06 – persönliches Budget | Zwei Personen mit je 7 produktiven Stunden, 7,5 Anwesenheitsstunden, zwei Plätze, 14 h frei ausführbare Arbeit | Beide Budgets einhalten; nicht 7,5 + 6,5 h buchen. |
| T07 – vollständiger Kalender | Personal ab 21.09. verfügbar, Arbeit erst ab 28.09. freigegeben | Die fünf vorherigen Werktage und ihre freien Stunden erscheinen mit Ursache. Teilweise freie Tage ebenfalls vollständig bilanzieren. |
| T08 – feste Schicht, freier Auftrag | A bleibt wochenweise Frühschicht; X blockiert; Y freigegeben und ausführbar | Y in A's Frühschicht bearbeiten. Keine automatische Versetzung und keine fiktive Freigabe von X. |
| T09 – Vorziehen mit Sperren | Freies Personal, aber Y hat eine echte vollständige Materialsperre oder nicht erledigten zwingenden Vorgänger | Y nicht ausführen. Blockierende Bedingung konkret ausweisen. |
| T10 – Hydrofenster | Arbeit freigegeben, Samstag besetzt | Keine Hydroprüfung am Samstag; zulässige andere Arbeiten dürfen laufen. |
| T11 – Vorsprungwiderspruch | 80 h Heften, Orbital nach 15 %, maximal 10 h kompatibel definierter Heftvorsprung | Widerspruch 12 h Mindestfortschritt gegenüber 10 h Maximum erkennen und erklären; keine stille Endlossperre. |
| T12 – Tagesfilter | Nur 21.09.2026 auswerten | Alle zeitbezogenen Stunden aus diesem Tag; keine ganze Woche und keine früheren Prozessstunden mitsummieren. OTD-Bezugsbestand ausdrücklich separat benennen. |
| T13 – Kosten auf Rechnungszeit | Zwei Leihkräfte, 12 vollständige Wochen mit je 37,5 bezahlten Stunden, 55 €/h, keine Mehrarbeit | 900 h und 49.500 €, unabhängig vom reduzierten Output während der Einarbeitung. |
| T14 – unterschiedliche Zuschläge | Eine Leihkraft leistet 5 zusätzliche werktägliche Stunden | 5 × 55 × 1,25 = 343,75 € Zusatzkosten. Stammpersonal separat mit 35 % gemäß hinterlegter Basis. |
| T15 – bestehende Mehrarbeit | Person hat bereits 5 h Mehrarbeit in der KW | Keine weiteren werktäglichen Überstunden vorschlagen; maximal 5 h insgesamt, nicht 5 h je Maßnahme/Auftrag. |
| T16 – Leihstarts ohne Duplikate | Drei bereits da, weitere bestehende Personen starten am 21.09. und 01.10. | Vier aktive ab 21.09., fünf ab 01.10., sofern die anderen weiterhin verfügbar sind. Keine zehn durch erneutes Anlegen; Abwesenheiten und Einarbeitung weiter beachten. |
| T17 – rechtzeitige Deckung | Bis Freitag fehlen 14 h; eine Maßnahme schafft 7 h bis Freitag und weitere 7 h erst danach | Nicht „rechtzeitig gedeckt“ melden. Beide Zeitabschnitte getrennt ausweisen. |
| T18 – persönliche Bindung und Abwesenheit | Mitarbeiter im Urlaub oder fest einem Arbeitsgang zugewiesen | Keine Buchung in Abwesenheit oder an einem gesperrten anderen Arbeitsgang; Konflikt sichtbar. |

Für T04 ist die Behauptung „nicht reproduzierbar“ erst aussagekräftig, wenn genau diese Ressourcen, Wochenzeit, Produktivität, Abhängigkeit und maxWorkers-Werte gegenübergestellt wurden. Der Originaltest reproduzierte in der geprüften HTML beide vollen Arbeiten am 21.09.2026.

## 7. Kennzahlen und Berichte

OTD = belegbar pünktliche Aufträge / festgelegter Bestand mit Liefertermin. Ursprüngliche Zusage, aktuelle Zusage und Ist-/Prognosefertigstellung getrennt erhalten. Historisch verspätete Aufträge werden durch Terminverschiebung nicht rückwirkend pünktlich. Bei 37 Aufträgen: 34 pünktlich = 91,89 %, 35 = 94,59 %, mindestens 95 % erfordern 36 pünktliche Aufträge.

Für jedes Szenario zeigen:

- Betrachtungszeitraum, Planungsstichtag, unveränderter Bezugsbestand und Version.
- Pünktlich, verspätet, nicht planbar; Gesamtverspätungstage als zusätzliche Kennzahl.
- Verfügbare produktive Stunden, verplante produktive Personalstunden und freie Reststunden je Person/KW; Nebenaufgaben, Einarbeitung und Reserve mit eindeutiger Abgrenzung.
- Unzugeordnete Arbeit und Kapazitätsverletzungen separat; kein Verstecken durch Auslastungsdurchschnitt oder Rundung.
- Vorhandene/zugesagte Leihkräfte und zusätzlich erforderliche Leihkräfte je KW mit Qualifikationen, Eintritt und Einarbeitung.
- Bereits eingeplante gegenüber zusätzlich vorgeschlagenen Mehrarbeits- und Samstagsstunden.
- Bezahlte Stunden, produktiver Nettobeitrag, zusätzliche Ausgaben und verbleibende Terminlücke. Ein angenommener Satz kennzeichnet die Kostensumme ebenfalls als vorläufig.

Managementausdruck: Baseline und verglichene Pakete, Wirkung auf OTD und betroffene Aufträge, zusätzliche Kosten und offene Annahmen. „Günstigstes Paket“ nur bei belegtem Vergleich im benannten Suchraum; sonst „günstigstes untersuchtes Paket“ oder „untersuchter Vorschlag“.

Betriebsratsausdruck: Anlass, konkret betroffene KW/Termine, Personen bzw. Qualifikationsgruppen, werktägliche Mehrarbeit, Samstagsdaten mit Zeiten/Besetzung, Leiheinsatzdauer, Alternativen, erwartete Wirkung, Befristung und erneute Bedarfsprüfung. Vorgeschlagene Maßnahmen nicht als bereits genehmigt darstellen.

## 8. Rückgabeformat für jede Runde

Bitte nach der Umsetzung liefern:

1. **Tatsächlich lauffähige neue HTML-Datei** oder ein vollständig reproduzierbares Quellpaket einschließlich Buildanweisung. Dateiname mit Runde und Version.
2. **Datenexport des geprüften Zustands** mit Projekten, ursprünglichen Terminen, Mannschaft, Startdaten, Qualifikationen, Kalendern, Regeln, Arbeitsfolgen, Szenarien und Kostenparametern. Browserlokale Änderungen ausdrücklich einschließen. Falls der Export vollständig in der HTML enthalten ist, das bestätigen und den aktiven Stand eindeutig identifizieren.
3. **Vollständiger Commit bzw. Versionsstand und SHA-256 der gelieferten Datei.** Genannten Alt-Commit nicht als Nachweis der neueren Datei verwenden.
4. **Änderungsliste pro Audit-/Test-ID:** vorheriges Verhalten, konkrete Änderung, Ergebnis der Gegenprobe, verbleibende Einschränkung. Nicht betroffene Funktionen nennen, wenn Migrationen nötig waren.
5. **Ausführbare Tests und frische Ausgaben der neuen Version.** Keine alten JSON-Ergebnisse als neuen Testlauf ausgeben. Geänderte Tests mit fachlicher Begründung markieren.
6. **Vorher-/Nachher-Vergleich auf identischem Export:** OTD, verspätete/nicht planbare Aufträge, Verspätungstage, produktive Kapazität, belegte/freie/unzugeordnete Stunden und Maßnahmenkosten. Mehrere Zeitfenster nur ausdrücklich beschriftet vergleichen.
7. **Offene Fragen und Annahmen**, insbesondere Helferleistung, tatsächliche Zusatzplätze, Samstagssätze/-verfügbarkeit und Materialfreigaben.

Ein reiner Chatbericht oder die Anzahl grüner Tests genügt nicht zur Abnahme. Bei einem nicht erfüllten Test den konkreten Restfehler nennen und keine vollständige Freigabe behaupten.

## 9. Ablauf der Zusammenarbeit

Dominik gibt diese Datei und das bisherige Prüfpaket an Claude. Claude liefert die genannten Artefakte zurück. Dominik lädt die neue HTML und den Datenexport hier hoch. ChatGPT/Codex prüft reproduzierbar und erstellt Runde 02 mit den Zuständen **bestanden**, **fehlgeschlagen**, **nicht prüfbar** oder **fachliche Entscheidung offen**. Die nächste Runde bearbeitet die verbleibenden Punkte, ohne die bereits bestätigten Regeln erneut umzudeuten.

Die Schleife endet, wenn die kritischen Gegenproben bestehen, Daten-/Stunden-/Kostenkonten zusammenpassen und die gewünschte Liefertreue unter den ausgewiesenen realen oder ausdrücklich angenommenen Maßnahmen nachgewiesen ist – oder eine verbleibende Zielabweichung nachvollziehbar ausgewiesen wird. Keine Veröffentlichung oder Änderung der Sichtbarkeit ohne Dominiks Freigabe.
