# Kurze Bedienungsanleitung

Produktionsplanung Armaturenbau MEGC · Hexagon Purus

## Starten

**Am Arbeitsplatz mit Node.js** (einmalig eingerichtet über `Einrichten.bat`):
Die Anwendung läuft im Hintergrund. Im Browser `http://<Rechnername>:7311/`
öffnen. Der Einladungslink für die Kollegen steht in der Kopfleiste unter
**🔗 Einladung** – die Kollegen brauchen keine Installation.

**Ohne Installation:** Die Datei `Armaturenbau-MEGC.html` doppelklicken.
Dann läuft alles im Browser; die Daten bleiben in diesem Browser und sind
für andere nicht sichtbar. Diese Fassung ist zum Ausprobieren gedacht.

**Anmelden:** Kürzel eingeben (STWUE, SVHE, DOHE, KEER, KEMI, SAZA …), beim
ersten Mal ein eigenes Passwort vergeben. Alle arbeiten im selben
Datenbestand; das Kürzel dient dem Änderungsnachweis.

## Die fünf Bereiche

| Bereich | Wofür |
|---|---|
| **Übersicht** | Halten wir die Termine? Wo klemmt es? Kommt mir etwas komisch vor? Zweiter Reiter: was dagegen hilft. |
| **Planung** | Belegungsgitter (wer oder was ist wann belegt), Terminplan als Gantt, Vergleich mit dem IST-Stand. |
| **Aufträge** | Auftragsliste mit Direktbearbeitung, Arbeitsfolgen, Regeln der Abteilung. |
| **Mannschaft** | Wer kann was, Anwesenheit je Kalenderwoche, Urlaubsplanung einlesen, Einsatzplan, Aushang. |
| **Einstellungen** | Parameter, gespeicherte Stände, Daten und Prüfung. |

In der Kopfleiste stehen immer: **Stand** (welches Szenario gerechnet wird),
**Zeitraum** der Auswertung, **Suche** (auch mit Strg+K), die
**Stellschrauben** und der Wechsel zwischen hell und dunkel.

## Der typische Ablauf

1. **Übersicht öffnen.** Die sechs Kacheln beantworten den Stand. Darunter
   steht in einem Satz, welche Termine reißen und woran es liegt.
2. **Auffälligkeiten ansehen.** Die Karte „Kommt das so hin?" sagt, wo eine
   Annahme die Messwerte überstimmt. Das ist der ehrlichste Teil der
   Anwendung – bitte zuerst lesen. Ist ein Thema abgestellt, schließt der
   Knopf **„Erledigt"** den Befund: Er zählt dann nicht mehr in Kachel und
   Ampel, bleibt aber unter „Bestätigt" nachlesbar und meldet sich von
   allein wieder, sobald er dringender wird. Zurücknehmen geht mit
   „Wieder anzeigen"; unter Daten & Prüfung lassen sich alle Bestätigungen
   auf einmal aufheben.
3. **Mehraufwand ansehen** (Übersicht → Mehraufwand). Oben steht, wie viele
   Stunden im laufenden Quartal fehlen, damit kein Termin fällt, und was das
   kostet. Darunter Woche für Woche: welche Aufträge fällig werden, was steht
   und was in dieser Woche helfen würde. Zeile anklicken klappt sie auf. Die
   vier Wege – Überstunden, zweiter Platz, Leiharbeiter, Samstag – stehen
   nebeneinander, mit dem Anteil, den jeder davon deckt. „In Szenario
   übernehmen" legt ein Szenario an und rechnet den vollen Plan neu; der
   laufende Plan bleibt unberührt.
4. **Belegung ansehen** (Planung → Belegung). Rot hinterlegte Zellen heißen:
   Hier wartete Arbeit, für die kein Platz war. Klick auf eine Zelle nennt
   die Aufträge darin.
5. **Stellschrauben bewegen** (Knopf in der Kopfleiste). Jede Änderung
   rechnet sofort durch; die Kennzahlen dahinter ändern sich mit.
6. **„Was bringt wirklich etwas?"** (Übersicht → Engpässe & Wirkung,
   Knopf „Durchrechnen"). Die Anwendung rechnet jeden Hebel einzeln durch
   und sagt auch, welcher **nichts** bringt oder sogar schadet.
7. **Stand speichern** (im Stellschrauben-Panel unten). Name und eine kurze
   Notiz sind Pflicht – die Kollegen sehen den Stand sofort unter
   Einstellungen → Stände.
8. **Vergleichen** (Planung → Vergleich). Gegen den festgelegten IST-Stand
   sieht man, was die Änderung wirklich gebracht hat.

## Wichtige Handgriffe

**Termin oder Priorität ändern:** direkt in der Auftragsliste, ohne Dialog.
Alles Weitere über „Bearbeiten" im Seitenpanel rechts.

**Urlaubsplanung einlesen:** Mannschaft → Urlaubsplanung einlesen. Den
Bereich in Excel markieren (Kopfzeile mit den Tagen und die Zeilen
darunter), kopieren, einfügen, **Tabelle ansehen**. Dann je Zeile das
Kürzel zuordnen und übernehmen. Zeilen ohne Zuordnung zählen nur als Anzahl
abwesender Personen je Tag.

**Die Spalten „Stau an Tagen" und „größter Tag h" lesen:** Der Stau ist eine
**Warteschlange**, keine Arbeitsmenge. „Stau an Tagen 83" heißt: An 83
Arbeitstagen wartete hier Arbeit, die nicht gebucht werden konnte. „größter
Tag 34 h" heißt: Am schlimmsten Tag standen 34 Stunden an. Beides sind
Kennzeichen des Engpasses – wie viele Stunden wirklich fehlen, steht unter
Übersicht → Mehraufwand.

**Schichtbetrieb einstellen:** Einstellungen → Parameter → Tabelle
**„Schichten und Plätze je Arbeitsgang"** (dieselbe Tabelle steht auch unter
Übersicht → Engpässe & Wirkung, direkt unter der Auslastung). Dort je
Arbeitsgang 1, 2 oder 3 Schichten wählen – oder mit den Knöpfen darüber alle
Arbeitsgänge auf einmal. Die Spalte **„läuft"** sagt, was tatsächlich gilt und
ob der Wert eigens gesetzt ist oder aus dem Standard kommt.

Wichtig: Das Feld **„Belegungszeit der Plätze je Tag"** in den
Prozessressourcen ist dieser Standard. Steht es auf 15 h, läuft *jeder*
Arbeitsgang zweischichtig, der auf „Standard" steht – auch ohne dass einer
davon einzeln umgestellt wurde. Und: Eine längere Belegungszeit schafft
**keine** Mannstunden. Die Leute müssen zusätzlich da sein, sonst wechselt die
engste Stelle auf „Mitarbeiterstunden".

**Schichten automatisch planen lassen:** Übersicht → Engpässe & Wirkung,
Karte **„Schichten automatisch planen"** → Knopf drücken. Die Anwendung sucht
die Schichteinteilung, die die meisten Verspätungstage abbaut: höchstens drei
Schichten, nur dort, wo eine weitere Schicht wirklich Termine rettet, und nur
so weit, wie die schichtfähigen Leute reichen. Sie zeigt

* die Wirkung auf Termine, wartende Arbeit und den Leerlauf im Einsatzplan,
* die Arbeitsgänge, die umgestellt werden,
* **was danach noch fehlt** – mit Arbeitsgang, Stundenzahl und Ursache (ein
  Platz, eine Maschine oder eine Regel wie „höchstens 4 Mitarbeiter je
  Auftrag"),
* und zugeklappt jeden geprüften, aber verworfenen Schritt mit Begründung.

Übernommen wird immer in ein **Szenario** („Schichtplan"), nie in den
laufenden Plan. Im Startdatenbestand bringt der Vorschlag 2.333 → 708
Verspätungstage; die Personentage ohne Arbeit gehen von 1.007 auf 399 zurück.
Die Mannschaft wechselt die Schicht dabei **wochenweise**, nicht tageweise –
nachzusehen im Einsatzplan unter Mannschaft.

**Wenn nur einer da wäre:** Aus Arbeitsschutz arbeitet niemand allein. Ein
Tag, an dem laut Anwesenheit nur eine Person zur Verfügung steht, wird mit
**0 h** gerechnet – nicht mit einer halben Mannschaft. Gezählt werden Köpfe,
zwei Halbtagskräfte sind also zulässig. Die Regel steht im Rechenweg
(„Mindestbesetzung") und meldet sich als Befund `ALLEIN_AM_TAG`, damit ein
leerer Tag nicht wie ein Rechenfehler aussieht. Abhilfe ist ein zweiter Mann,
keine Einstellung.

**Eine Stundenzahl prüfen:** Übersicht → Engpässe & Wirkung, oberste Karte
**„Woher die Kapazität kommt"**. Dort stehen Zeitraum, Arbeitstage, mittlere
Besetzung, Stunden je Tag, Produktivität und Reserve – und darunter dieselbe
Rechnung als Näherung, die sich auf einem Blatt Papier nachvollziehen lässt.

Die Näherung ist **Posten für Posten** aufgebaut, nicht als ein Produkt:

```
  Reguläre Arbeitstage    Tage × Besetzung × Stunden je Tag × Produktivität
    darin Überstunden     der Teil über der Regelarbeitszeit (7,50 h)
+ Samstage                eigene Länge (6 h) und eigene Besetzung (20 %)
− Betreuung neuer Kräfte
− Reserve Zubehör
= Näherung                muss die ausgewiesene Kapazität treffen
```

Bleibt unter „Unterschied" mehr als ein paar Stunden stehen, stimmt etwas
nicht – die Zeile ist die Selbstkontrolle der Anwendung.

Zwei Fallen beim Nachrechnen:

* **Wochenstunden nicht mit Kalendertagen multiplizieren.** 37,5 h + 4 h sind
  *Wochen*stunden. 110 Kalendertage sind **77 Arbeitstage** ≈ 15,4 Wochen.
  14 MA × 41,5 h × 15,4 Wochen ≈ 8.950 h brutto, nach Produktivität und
  Reserve rund **8.240 h**.
* **Überstunden gehören dazu.** Wer mit 7,50 h je Tag rechnet, während die
  Planung mit 8,30 h rechnet (4 h Überstunden je Woche), liegt bei 71
  Arbeitstagen und 14 MA um rund **900 h zu niedrig**. Die Karte weist die
  Überstunden deshalb als eigene Zeile aus.
* **Die Spalte „Platzstunden im Zeitraum" nicht addieren** (Einstellungen →
  Parameter → Einsetzbare Mitarbeiter je Arbeitsgang). Sie sagt je
  Arbeitsgang, wie lange seine *Plätze* belegt werden können – nicht, wie
  viele Mitarbeiterstunden es gibt. Alle Arbeitsgänge greifen auf dieselbe
  Mannschaft zu; addiert man die Spalte, zählt man die Leute elfmal. Die
  Mitarbeiterstunden stehen einmal darunter.

**Stunden je Arbeitsgang:** Übersicht → Engpässe & Wirkung, Karte **„Stunden
je Arbeitsgang"**. Arbeitsinhalt, offen, Stunden je Auftrag, eingeplant, was
nicht mehr hineinpasst und was an einer Grenze liegenblieb. Die Spalte
„offen" ergibt in der Summe genau die offene Arbeit aller Aufträge – die
Fußzeile sagt es ausdrücklich, und wenn es nicht stimmt, sagt sie auch das.

„Blieb liegen" ist **keine zweite Arbeitsmenge**: Es ist Arbeit aus der
Spalte „offen", die warten musste. Jede Arbeit zählt dort genau einmal, nicht
für jeden Wartetag erneut.

**Personal ändern – nur in der Mannschaft:** Gerechnet wird ausschließlich
mit den Personen, die im Reiter **Mannschaft** stehen. In den Einstellungen
gibt es dafür bewusst kein zweites Feld. Wer da ist, sagt die Karte **„Wer
wird gerechnet?"** oben in der Mannschaft: Kürzel, Eintritt, Stamm und
Leiharbeiter getrennt.

**Wenn Personal fehlt:** Die Anwendung sagt es, statt still Leute
dazuzurechnen – aber sie sagt es nur, wenn die Arbeit wirklich an den
**Leuten** wartet. Zwei Meldungen, je nach Lage:

**a) „Mehr Personal hilft hier nicht"** – der Regelfall im Startdatenbestand.
Die Arbeit wartet auf Plätze, Maschinen oder Prüffenster, nicht auf
Mitarbeiterstunden. Die Meldung nennt beide Zahlen gegenüber („1.449 h warten
auf Plätze, nur 71 h auf Mitarbeiterstunden") und die Auslastung der
Mannschaft. Ein Knopf zum Einplanen erscheint hier **nicht** – die Leute
würden nur danebenstehen. Stattdessen: **„Was wirklich hilft"** (Mehraufwand)
und **„Wer steht ohne Platz da?"** (Einsatzplan).

**b) „Zusätzliches Personal nötig"** – nur wenn die Mitarbeiterstunden die
Grenze sind. Die Meldung nennt Termin, fehlende Stunden, Wochen und Köpfe:
„Bis KW 48/2026 müssen 5.329 h fertig sein, verfügbar sind 4.649 h. Es fehlen
679 h. Verteilt auf die 12 Wochen bis dahin sind das 1,7 Mitarbeiter." Daneben
**„N Leiharbeiter einplanen"** (fragt Anzahl und Eintritt) und **„Erst
durchrechnen, was es bringt"**.

Wichtig zum Lesen: Die Kopfzahl ist der Bedarf **bis zur engsten Woche**,
nicht die Zahl der Leute, die dauerhaft fehlen. Und neue Leiharbeiter leisten
in den ersten Wochen nur 40/60/80 % und binden Betreuung.

**Einsatzplan – wer macht was:** Mannschaft → Einsatzplan. Verteilt wird nach
Qualifikation und Anwesenheit, ein Platz eine Person, ausgewählt nach
Auslastung (Stunden je Zeitanteil) – die Arbeit rotiert also über die
Mannschaft, und eine Halbtagskraft bekommt die Hälfte. Wer fertig ist, geht
an den nächsten freien Platz; geht jemandem der Tag aus, löst ein anderer ab.

Steht bei jemandem nichts, steht **warum** da:

* **„kein Platz frei"** – anwesend, aber alle Plätze dieses Arbeitsgangs sind
  belegt. Mehr Personal ändert daran nichts.
* **„keine Qualifikation"** – für die heute laufenden Arbeitsgänge nicht
  angehakt.
* **„keine Arbeit offen"** – an diesem Tag ist nichts einzuplanen.

Unter der Woche steht, wie viele Personentage ohne Arbeit waren. Ist der
häufigste Grund „kein Platz frei", ist die Mannschaft nicht zu klein, sondern
die Werkstatt zu eng – dann lohnt der Blick in den Mehraufwand.

**Wenn in der Wochenübersicht mehr Mitarbeiter stehen als in der Mannschaft:**
Das kann nur noch aus zwei Gründen passieren. Erstens: In der Mannschaft sind
Leiharbeiter mit Eintritt hinterlegt – dann stehen sie in „Wer wird
gerechnet?". Zweitens: Die Besetzung kommt aus der Rückfallebene
**Wochenzahlen** statt aus der Mannschaft; das sagt die Karte Personal in den
Einstellungen, mit dem Knopf „Auf Mannschaft umstellen".

**Alte Zahlenlisten:** In gewachsenen Datenbeständen stehen unter
Einstellungen → Parameter → Personal noch Anzahlen ohne Namen, als **„Alte
Zahlenlisten – ohne Wirkung"**. Sie gehen nicht in die Rechnung ein. Zwei
Wege: **„In die Mannschaft übernehmen"** legt je Person einen
Leiharbeiterplatz mit Eintritt an (danach zählen sie), **„Entfernen"** löscht
sie. An der Rechnung ändert das Entfernen nichts.

**Stamm oder Leiharbeiter richtigstellen:** Mannschaft → Spalte **Art**. Die
Auswahl entscheidet über Kostensatz (35 € gegen 55 €), Einarbeitungskurve
(40/60/80 %) und Betreuungsaufwand. Wer als Stamm geführt wird, aber
Leiharbeiter ist, wird zu günstig und zu produktiv gerechnet.

**Leiharbeiter dazuschalten:** Mannschaft → Anwesenheit je KW, Häkchen in der
gewünschten Woche. Wer einen Eintritt hinterlegt hat, ist ab dann dauerhaft
dabei. Ohne Einsatzende rechnet die Anwendung bis zum Ende des Horizonts mit.

**Schicht von Hand festlegen:** Mannschaft → Schichtplanung je KW. Ohne
Eintrag rotiert jede schichtfähige Person automatisch wochenweise durch die
Schichten (nie tageweise). Wird hier für eine Person und Woche eine Schicht
gewählt, gilt sie statt der Rotation - der Einsatzplan zieht sofort nach.
Nicht schichtfähige Personen (siehe Mannschaft → Spalte „Schicht") stehen
hier nicht, sie arbeiten immer in der Frühschicht. Läuft in der gewählten
Schicht kein Arbeitsgang, den die Person darf, steht sie im Einsatzplan mit
dem Grund „keine Arbeit in dieser Schicht" - das ist dann kein Fehler,
sondern die ehrliche Folge der Wahl.

**Aushang drucken:** Mannschaft → Aushang → Drucken. Eine Seite für alle.

**Ansicht speichern:** Filter einstellen, in der Reiterleiste rechts auf
**+**, Namen geben. Beim nächsten Mal ein Klick.

**Von wo nach wo – IST, heute, SOLL:** Einstellungen → Stände, oberste Karte
„Von wo nach wo".

1. **Heute als IST-Stand fixieren** – das ist der Ausgangspunkt. Er bleibt
   unverändert, egal was danach passiert; alle Kennzahlen zeigen zusätzlich
   die Abweichung dazu.
2. Stellschrauben bewegen, Maßnahmen aus dem Mehraufwand übernehmen,
   Defizite abarbeiten – so lange, bis die Termintreue passt.
3. **Heute als SOLL-Stand festlegen** – das ist der Plan, auf den
   hingearbeitet wird. Das Szenario dahinter wird zugleich als *aktueller
   Plan* markiert, damit alle wissen, woran sie sich orientieren.
4. Ist das Ziel erreicht, **„SOLL-Stand zum IST-Stand machen"**. Ab dann
   misst sich jede weitere Änderung an ihm, und das Ziel ist wieder offen.

**Etwas rückgängig machen:** Einstellungen → Stände. Dort liegen alle
gespeicherten Stände mit Notiz und Kürzel; jeder lässt sich laden.

## Was die Anwendung bewusst NICHT tut

- **Sie rechnet nichts schön.** Fehlt Kapazität, bleibt Arbeit liegen und der
  Termin verschiebt sich. Das ist keine Fehlfunktion.
- **Sie erfindet keine Zahlen.** Nicht belegte Werte sind als „zu validieren"
  gekennzeichnet (siehe `docs/ZU-VALIDIEREN.md`).
- **Sie verschiebt nichts von Hand.** Das Belegungsgitter ist das Ergebnis
  der Rechnung. Wer etwas ändern will, ändert Stellschrauben, Termin oder
  Reihenfolge.
- **Sie optimiert nicht auf Kosten.** Kosten werden ausgewiesen; die
  Termintreue steht darüber.
