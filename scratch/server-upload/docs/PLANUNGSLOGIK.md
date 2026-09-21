# Beschreibung der Planungslogik

Stand: 16.09.2026 · gilt für `engine/`

Diese Beschreibung soll eine Zahl der Anwendung nachrechenbar machen. Jeder
Abschnitt nennt die Datei, in der es steht.

## 1. Wie gerechnet wird: vorwärts, tagesgenau, mit harten Grenzen

`engine/scheduler.js` terminiert **vorwärts ab dem Planungsstichtag** und
verteilt die Arbeit Tag für Tag. Es gibt keine Rückwärtsterminierung und
keinen Puffer: Was an einem Tag nicht in die vorhandene Kapazität passt,
bleibt liegen und wird am nächsten möglichen Tag versucht. Deshalb kann eine
Verspätung entstehen, ohne dass irgendwo eine Zahl „gerissen" wird.

Reihenfolge der Aufträge: nach Priorität (P1 zuerst), darin nach Termin. Eine
manuell fixierte Reihenfolge wird respektiert.

## 2. Was die Kapazität eines Tages begrenzt

`engine/capacity.js` rechnet für jeden Tag und jeden Arbeitsgang **sechs
Grenzen** und nimmt immer die engste:

1. **Mitarbeiterstunden** = Besetzung × Stunden je Mitarbeiter × Produktivität
2. **Qualifikation** – der Anteil der Mannschaft, der diesen Arbeitsgang kann
3. **Plätze** – Anzahl Plätze × Personen je Platz × Belegungszeit des Tages.
   Ein zweiter Platz ist nur dort vorgesehen, wo es ihn geben kann: Sägen,
   Arbeitsvorbereitung und Entgraten („Engpass kann ggf. von Hand
   mitgeholfen werden", Abteilungsleitung 09/2026). Biegen und Beizen
   bleiben bei einem Platz.
4. **Maschinen** – beim Orbitalschweißen: Maschinen und Schweißer getrennt,
   1 Schweißer bedient 2 Maschinen
5. **Zeitfenster** – Hydroprüfung nur Dienstag bis Donnerstag
6. **NoBo** – Hydroprüfung nur an Anwesenheitstagen

Die Grenze, die zuschlägt, wird mitgeschrieben (`limiter`). Daraus entsteht
später die Antwort „wo klemmt es".

**Davor steht eine Regel, die keine Rechnung ist: Niemand arbeitet allein.**
Arbeitsschutz, ausdrücklich bestätigt („Gilt immer! Es darf aus
Sicherheitsgründen niemand alleine arbeiten."). Stehen an einem Tag weniger
als `workforce.minZusammen` Personen zur Verfügung (Standard 2), ist die
Kapazität dieses Tages **null** – nicht „eine halbe Mannschaft". Gemessen
wird an **Köpfen**, nicht an Zeitanteilen: Zwei Halbtagskräfte sind zwei
Personen und damit zulässig, eine Vollzeitkraft allein nicht.

Damit ein solcher Tag nicht wie ein Rechenfehler aussieht, sagt die Anwendung
es zweimal: im Rechenweg („Mindestbesetzung", mit den entfallenen Stunden)
und als Befund `ALLEIN_AM_TAG`. Im Startdatenbestand kommt kein solcher Tag
vor – die Zahlen dort verschieben sich also nicht.

### Woher die Besetzung kommt

Drei Quellen, in dieser Rangfolge:

1. **Tagesliste** der Abteilungsleitung – gemessene Wirklichkeit, **nur bis
   zum Planungsstichtag**. Die Werte sind auf Anweisung um jeweils 1
   verringert, weil die Ursprungsdatei falsch rechnet.
2. **Mannschaftsliste** – ab dem Stichtag: anwesende Personen × Zeitanteil,
   abzüglich Urlaub, Krankheit, Schulung und Demontage (verliehen), abzüglich
   der Betreuungsstunden für neue Kräfte, mal Einarbeitungsgrad (40/60/80 %).
3. **Wochenzahlen** der alten Excel-Planung – nur noch Rückfallebene.

**Nur die Mannschaft zählt.** Solange die Mannschaft die Grundlage ist
(`workforce.team.source === 'MANNSCHAFT'`, der Regelfall), rechnet
`headcountFor` **ausschließlich** mit den Personen der Mannschaftsliste. Die
alten Listen **`tempWorkers`** und **`newHires`** – *Anzahlen ohne Namen* aus
der Excel-Zeit – gehen **nicht** mehr ein. Vorgabe der Abteilungsleitung vom
17.09.2026: „wenn zusätzliches Personal dazu kommen muss möchte ich eine
Meldung bekommen und das rein über den Reiter Mannschaft anpassen."

Vorher zählten sie still dazu. In der Wochenübersicht standen dadurch 24
Mitarbeiter in einer Abteilung mit neun, und in der Mannschaftsliste war
niemand davon zu finden. Beide Listen bleiben lesbar (sie werden nicht
stillschweigend gelöscht), werden aber als wirkungslos ausgewiesen:

* Einstellungen → Parameter → Personal zeigt sie unter **„Alte Zahlenlisten –
  ohne Wirkung"**, mit **„In die Mannschaft übernehmen"** (je Person ein
  Leiharbeiterplatz mit Eintritt – danach zählen sie) und **„Entfernen"**.
* Die Plausibilitätsprüfung meldet sie als Hinweis
  (`ZAHLENLISTEN_OHNE_WIRKUNG`).
* In der Rückfallebene **Wochenzahlen** wirken sie unverändert weiter – dort
  gibt es keine Mannschaftsliste, an der man es sonst pflegen könnte.

**Fehlt Personal, kommt eine Meldung, keine stille Ergänzung.** Wie diese
Meldung rechnet – und wie sie es zweimal falsch gemacht hat – steht unten
unter „Wann fehlt Personal wirklich?".

Auch Bedarfsrechnung und Optimierungsvorschläge gehen diesen Weg: Sie legen
über `mitZusatzPersonal()` (`engine/team.js`) Leiharbeiterplätze in der
Mannschaft an, statt eine Anzahl daneben zu führen. Genutzt werden dafür
zuerst die freien Platzhalter; erst wenn die aufgebraucht sind, kommen neue
Kürzel dazu.

Vorab abgezogen wird die **Reserve für Zubehör und Kleinarbeiten**
(18 h je Woche), weil diese Arbeit läuft, ohne in einem Auftrag zu stehen.

## 3. Wie aus Stunden ein Termin wird

Je Auftrag ergibt sich aus der Arbeitsfolge ein Abhängigkeitsnetz
(`engine/routing.js`): Sägen → Entgraten → Biegen → Heften → Orbitalschweißen
→ Beizen → Vormontage → Hydro → Endkontrolle, bei Wiederkehrern zusätzlich
Reinigen. Neu davor: **Arbeitsvorbereitung** (7,5 h je Auftrag).

Die Arbeitsvorbereitung gilt für jeden Auftrag mit Fertigstellung **bis zum
31.12.2026 als erledigt** (Auskunft der Abteilungsleitung 09/2026: „Wir haben
alle Aufträge bis Ende 2026 schon vorbereitet"). Ihre Stunden bleiben im
Arbeitsinhalt stehen, sind aber nicht mehr offen. Aufträge mit späterem
Termin führen sie weiter als offenen Arbeitsgang.

Heften und Orbitalschweißen laufen **überlappend**: Sobald ein Heftvorsprung
von 5–10 Stunden besteht, darf geschweißt werden. Alle anderen Übergänge sind
Ende-Start.

Der früheste Arbeitsbeginn ist der spätere von zwei Terminen:
Materialverfügbarkeit (Termin minus 4 Wochen, je Auftrag überschreibbar) und
Startregel der Projektart (Neubau 3, Umbau/WKP 4 Wochen).

Ist die letzte Stunde verteilt, ist das die **Prognose**. Liegt sie nach dem
Fertigstellungstermin, ist der Auftrag verspätet – um genau die Kalendertage
Differenz. Bleiben mehr als 15 Minuten Arbeit über den Horizont hinaus offen,
gilt der Auftrag im Horizont als nicht fertigstellbar.

## 4. Wie der Engpass bestimmt wird

Jede Stunde, die an einem Tag nicht eingeplant werden konnte, wird mit Grund
festgehalten (`result.blocked`). Daraus entstehen:

- die **Rangfolge der Engpässe** über alle Stunden (`bottleneckRanking`),
- die **Ursache je Auftrag** (`engine/rootcause.js`): Stunden, Arbeitsgang,
  Ursache, Anzahl Tage, Hydro-Wartezeit, Materialstand,
- die Spalte **„nicht einplanbar"** in der Auslastung je Arbeitsplatz.

Wichtig: **100 % Auslastung ist kein Engpass.** Ein Engpass ist, wenn Arbeit
wartet. Deshalb ist im Belegungsgitter die Zelle rot hinterlegt, wenn Stunden
liegengeblieben sind – nicht, wenn der Balken voll ist.

### Der „Stau" – und warum er keine Stundenzahl ist

`result.blocked` hält für **jeden Tag** fest, wie viele Stunden Arbeit
anstanden, aber nicht gebucht werden konnten. Ein Auftrag, der vier Tage auf
den Prüfstand wartet, steht dort **viermal** mit seinen Reststunden drin.

Beispiel aus dem Startdatenbestand (Auftrag WGC40-S00441, Hydroprüfung,
Arbeitsinhalt **17,3 h**):

| Tag | wartend | Ursache |
|---|---:|---|
| Fr 12.02. | 17,3 h | Zeitfenster (Hydro nur Di–Do) |
| Mo 15.02. | 17,3 h | Zeitfenster |
| Di 16.02. | 10,3 h | Prüfstand belegt (7 h wurden geprüft) |
| Mi 17.02. | 3,3 h | Prüfstand belegt |
| **Summe** | **48,3** | |

48,3 für einen Auftrag mit 17,3 h Arbeitsinhalt: Die Summe ist in
**Stunden × Tagen**, nicht in Stunden. Sie taugt als **Rangfolge** (wo staut
es sich oft und stark), nie als Arbeitsmenge.

Deshalb werden drei Größen getrennt geführt (`workplaceLoad`):

| Feld | Bedeutung | Einheit |
|---|---|---|
| `blockedHours` | Summe über alle Tage | Stunden × Tage – **nur intern**, zum Sortieren |
| `blockedPeak` | größte Warteschlange an **einem** Tag | Stunden |
| `blockedDays` | an wie vielen Tagen überhaupt etwas wartete | Tage |

Angezeigt werden nur die beiden unteren. Die Zeile „Mitarbeiterstunden
gesamt" weist gar keinen Stau aus: Vor der Mannschaft steht keine
Warteschlange, dort fehlen schlicht Stunden – diese Zahl steht im
Mehraufwand.

### Dasselbe Missverständnis ein zweites Mal – die Engpassrangfolge

Derselbe Fehler steckte noch an einer zweiten Stelle und wurde am
18.09.2026 gemeldet: *„laut der Engpassübersicht habe ich belegt 3145 h und
weitere 3286 können nicht eingeplant werden, das kann nicht passen."*

`bottleneckRanking()` hat `result.blocked` über **alle Wartetage** summiert
und das Ergebnis als „x Stunden konnten nicht eingeplant werden" ausgegeben:
im Startdatenbestand **3.039 h** für die Arbeitsplätze – obwohl an keinem
einzigen Tag mehr als **237 h** warteten und insgesamt nur **885 h** Arbeit
betroffen waren.

Jetzt wird jede Arbeit genau **einmal** gezählt: je Auftrag und Arbeitsgang
zählt die **größte** Wartemenge (das ist die offene Arbeit, die dort stand).
Damit bleibt die Zahl zwangsläufig unter dem Arbeitsinhalt – und genau das
prüft `engine/test/kapazitaet.test.js` nach.

| Ursache | alt (h × Tage) | jetzt (h) | Arbeitsgänge | Tage | größter Tag |
|---|---:|---:|---:|---:|---:|
| Arbeitsplätze | 3.039 | **885** | 91 | 94 | 237 h |
| Orbitalmaschinen | 852 | **321** | 25 | 71 | 34 h |
| Hydro-Prüfstand | 379 | **282** | 35 | 53 | 15 h |
| Beizplatz | 298 | **232** | 28 | 48 | 11 h |
| Mitarbeiter je Auftrag | 451 | **197** | 47 | 79 | 11 h |
| Hydro nur Di–Do | 377 | **180** | 25 | 30 | 34 h |
| Heftplätze | 102 | **97** | 20 | 21 | 10 h |

Die alte Zahl bleibt als `queueHoursDays` erhalten – sie taugt weiter als
Rangfolge, wird aber nirgends als Stundenzahl gezeigt.

### Die Stunden auf den Arbeitsgängen

Übersicht → Engpässe & Wirkung bucht die Stunden auf die Arbeitsgänge
(`processBalance`, Vorgabe vom 18.09.2026). Fünf Spalten, die sich
gegenseitig prüfen:

| Spalte | Bedeutung |
|---|---|
| `contentManHours` | Arbeitsinhalt aller Aufträge in diesem Arbeitsgang |
| `openManHours` | davon noch offen – **die Summe ergibt genau die offene Arbeit aller Aufträge** |
| `plannedManHours` | davon im Zeitraum eingeplant |
| `notPlannedManHours` | offen, aber im Zeitraum nicht mehr unterzubringen |
| `blockedManHours` | Arbeit aus „offen", die an einer Grenze warten musste (einmal gezählt) |

Die Gegenprobe steht in der Fußzeile der Tabelle: Weicht die Spalte „offen"
von der offenen Arbeit aller Aufträge ab, sagt die Anwendung das ausdrücklich.

Zahlen des Startdatenbestandes (37 Aufträge):

| Arbeitsgang | Aufträge | Inhalt h | h je Auftrag | blieb liegen h | Tage |
|---|---:|---:|---:|---:|---:|
| Orbitalschweißen | 37 | 2.436 | 65,8 | 388 | 118 |
| Heften | 36 | 1.035 | 28,0 | 161 | 82 |
| Entgraten | 36 | 507 | 13,7 | 319 | 49 |
| Endkontrolle | 37 | 503 | 13,6 | 3 | 1 |
| Sägen | 36 | 444 | 12,0 | 426 | 48 |
| Beizen | 37 | 443 | 12,0 | 232 | 48 |
| Hydroprüfung | 37 | 434 | 11,7 | 309 | 83 |
| Biegen | 36 | 359 | 9,7 | 136 | 25 |
| Vormontage | 36 | 301 | 8,1 | – | – |
| Arbeitsvorbereitung | 2 | 253 | – | 1 | 2 |
| Reinigen | 5 | 24 | 4,8 | 1 | 2 |
| **Summe offen** | | **6.501** | | | |

**65,8 h Orbitalschweißen je Auftrag – nicht 90 h.** Die Arbeitsfolge führt
für einen Neubau tatsächlich 90,25 h (WKP 91 h, Umbau 45 h). Der Mittelwert
liegt darunter, weil die Stunden **je Auftrag aus seinen echten
Gesamtstunden** heruntergebrochen werden und die Auftragsmischung gemischt
ist:

| Auftragsart | Aufträge | Orbital h | je Auftrag |
|---|---:|---:|---:|
| Neubau | 19 | 1.658 | 87,2 |
| Umbau | 12 | 504 | 42,0 |
| WKP | 5 | 232 | 46,5 |
| Prüfer | 1 | 42 | 42,0 |
| **Summe** | **37** | **2.436** | **65,8** |

Ein WKP-Auftrag mit 70,5 Gesamtstunden kann keine 91 h Orbitalschweißen
enthalten – die Vorlage gibt nur die **Anteile** vor, die Höhe kommt aus dem
Auftrag.

### Wann fehlt Personal wirklich?

Am 18.09.2026 zurückgewiesen: *„Hast du sie noch alle? Wie kommst du drauf
das 441h = 14 neue Leiharbeiter sind? … diese Fehlermeldung kriege ich im
Kopf überschlagen, das passt nicht."*

Der Vorwurf traf voll zu. Drei Fehler lagen übereinander:

1. **Falscher Bedarf.** Gewertet wurde `week.demand`. Das ist ein
   *geglättetes* Profil: Die Reststunden eines Auftrags werden gleichmäßig
   über das Fenster von Arbeitsbeginn bis Fertigstellung verteilt
   (`computeDemand`). Es sagt nicht, was in dieser Woche fertig sein **muss**.
2. **Falscher Zeitbezug.** Gewertet wurde die schlimmste **Einzelwoche**.
   Eine Lücke in einer Woche lässt sich aber aus der freien Kapazität der
   Wochen davor decken – Arbeit ist verschiebbar, solange der Termin hält.
3. **Falsche Umrechnung.** Die Stunden dieser einen Woche wurden durch die
   **Wochen**leistung eines Mitarbeiters geteilt. Das ergibt Köpfe für genau
   diese eine Woche – angeboten wurden sie als *dauerhafte* Leiharbeiter.

Im Startdatenbestand:

| Rechenweg | Ergebnis |
|---|---:|
| schlimmste Einzelwoche, geglättetes Profil | 334 h → **10 MA** |
| kumuliert, geglättetes Profil | 1.354 h |
| kumuliert nach **Terminen** (richtig) | **679 h** bis KW 48 |
| verteilt auf die 12 Wochen bis dahin | **1,7 MA** |

Faktor 6. Und die Mehraufwand-Ansicht wies die ganze Zeit 679 h aus – zwei
Ansichten, zwei Zahlen. Jetzt rechnen beide gleich:

* Bedarf = Arbeit, die nach ihrem **Termin** bis zu dieser Woche fertig sein
  muss; überfällige Aufträge zählen sofort.
* Verglichen wird **kumuliert**: alles bis zu dieser Woche gegen die
  Kapazität bis zu dieser Woche.
* Köpfe = fehlende Stunden ÷ (Wochen bis dahin × Wochenleistung).

**Die wichtigere Vorprüfung: Sind die Leute überhaupt die Grenze?**

Eine geringe Auslastung kann auch heißen, dass nicht mehr Arbeit da ist –
dann fehlt niemand. Entscheidend ist deshalb, **woran die Arbeit wartet**.
Die wartende Arbeit (`bottleneckRanking`) wird getrennt:

| an den Leuten | an der Anlage |
|---|---|
| Mitarbeiterstunden (`POOL`), Einsetzbare Mitarbeiter (`SKILL`) | Plätze, Maschinen, Prüffenster, Mitarbeiter je Auftrag, Wochentagsregeln |

Nur wenn die Arbeit überwiegend an den **Leuten** wartet, wird
`PERSONAL_FEHLT` gemeldet. Im Startdatenbestand warten **1.449 h** an der
Anlage und **71 h** an den Leuten – dort ist „es fehlt Personal" falsch.
Stattdessen kommt `MANNSCHAFT_NICHT_AUSLASTBAR`:

> Mehr Personal hilft hier nicht. Bis KW 48/2026 fehlen 679 h – aber nicht an
> Leuten. 1.449 h Arbeit warten auf Plätze, Maschinen oder Prüffenster, nur
> 71 h auf Mitarbeiterstunden. Begrenzend ist: Arbeitsplätze.

In dieser Lage erscheint der Knopf „N Leiharbeiter einplanen" **gar nicht**.

### Der Einsatzplan – ein Platz, eine Person

Ebenfalls am 18.09.2026: *„Der Einsatzplan ist auch verdreht und nicht
logisch. MAAP wird an manchen Tagen garnicht geplant obwohl anwesend."*

Der Kommentar im Code behauptete „gleichmäßige Auslastung", der Code gab der
Person mit dem größten Restbudget ihr **ganzes** Tagesbudget auf einmal
(`Math.min(rest, restStunden)`). Der Erste nahm 7,5 h, der Zweite den Rest,
alle weiteren gingen leer aus:

| | vorher | jetzt |
|---|---:|---:|
| JARO | 1.170 h | 484 h |
| MAAP | 281 h | 481 h |
| TOBE | 21 h | 483 h |
| STWUE (0,5 FTE) | 3 h | 242 h |
| ohne Namen | 0 h | **0 h** |

`assignPeople` verteilt jetzt so, wie die Abteilungsleitung planen würde:

1. Nur wer den Arbeitsgang darf (Qualifikationsmatrix).
2. Je Tag hat jede Person ein Budget: Zeitanteil × Arbeitszeit.
3. **Ein Platz, eine Person.** Die Zahl der gleichzeitig Eingesetzten ist auf
   `places × workersPerPlace` begrenzt – beim Orbitalschweißen auf die
   Schweißer, die die Maschinen bedienen können.
4. Knappe Qualifikationen zuerst.
5. Ausgewählt wird nach **Auslastung** (Stunden ÷ Zeitanteil), nicht nach
   absoluten Stunden – sonst bekäme eine Halbtagskraft dasselbe wie eine
   Vollzeitkraft. Bei Gleichstand bleibt jemand auf dem Arbeitsgang, den er
   schon macht; danach entscheidet das Kürzel (reproduzierbar).
6. **Ablösung ist erlaubt:** Geht jemandem der Tag aus, übernimmt ein anderer
   den Platz. Ohne das blieben 20 h Sägen ohne Namen, obwohl Leute frei
   waren – die Säge läuft 7 h, die eingeteilte Person hatte nur noch 3 h.
7. Wer anwesend ist und nichts bekommt, steht **mit Grund** da:
   `KEIN_PLATZ_FREI`, `KEINE_QUALIFIKATION` oder `KEINE_ARBEIT`.

**Der Befund dahinter.** Genau diese Leerlauf-Gründe legen offen, was beide
Fehlmeldungen verdeckt haben:

| | |
|---|---:|
| Mannstunden im Horizont | 13.921 h |
| davon einsetzbar | 6.500 h (**47 %**) |
| ungenutzt | 7.421 h |
| Personentage ohne Arbeit | 1.007 von 2.183 (**46 %**) |
| Platzstunden je Tag | 11 Plätze × 7 h = **77 h** |
| Mannstunden je Tag | **88 h** |

Die Mannschaft ist für diese Werkstatt zu groß, nicht zu klein. Was hilft,
ist ein zweiter Platz, längere Belegungszeit oder Samstagsarbeit – das
rechnet die Mehraufwand-Ansicht durch.

### Woher die Kapazität kommt – und welcher Zeitraum gilt

Ebenfalls am 18.09.2026 gemeldet: *„ich habe 14 MA zur Verfügung, es soll ab
heute für einen Zeitraum von 110 Tagen geplant werden … macht ca. 4525 h,
wenn ich aber in die Ansicht gehe, kommen wir auf eine Gesamtstundenzahl von
10731 h."*

Zwei echte Mängel steckten dahinter:

1. **Die Kapazität zählte die Randwoche komplett** – auch ihre Tage nach dem
   letzten Fertigstellungstermin. Im Startdatenbestand 9.012 h statt 8.649 h,
   also 363 h Kapazität, die es bis zum Termin nicht mehr gibt.
   `availableHours` rechnet jetzt **taggenau**.
2. **Kein Ausweis des Zeitraums.** Eine Stundenzahl ohne Zeitraum lässt sich
   nicht prüfen. Neu: `capacityDerivation` und die Karte **„Woher die
   Kapazität kommt"** in Engpässe & Wirkung. Je Arbeitstag gilt exakt:

   ```
   Besetzung × (Wochenstunden ÷ 5) × Produktivität − Reserve ÷ 5
   ```

   Beispiel: 6 MA × 7,5 h × 93,33 % − 3,6 h = **38,4 h** an diesem Tag.
   Aufsummiert über die Arbeitstage ergibt das genau die ausgewiesene
   Kapazität; die Näherung mit Mittelwerten steht daneben und weicht im
   Startdatenbestand um 4,7 h ab (Feiertage wirken tageweise).

**Die Handrechnung mit 4.525 h mischt Einheiten.** 41,5 h sind
*Wochenstunden*; mit 110 *Kalendertagen* multipliziert ergibt das keine
Größe, die es gibt. Richtig: 110 Kalendertage sind 77 Arbeitstage ≈ 15,4
Wochen. Bei 14 MA, 37,5 h + 4 h Überstunden und 93,33 % Produktivität minus
18 h Reserve je Woche sind das rund **8.240 h** – nicht 4.525 h, aber auch
nicht 10.731 h.

#### Die Näherung rechnet jetzt nach Tagesart getrennt

Nachgefragt am 18.09.2026: *„Was hat 1 % in der Rechnung verloren? Warum gibt
es da so ein großes Defizit?"* Beides waren Fehler, und beide saßen in der
Näherung:

* **„1 %" war die Produktivität.** Der Faktor 0,9333 ging an einen
  Prozentbaustein, der Prozentpunkte erwartet – aus 93,3 % wurde „1 %".
  Behoben; der Motor führt den Faktor, die Oberfläche rechnet ihn um.
* **Das Defizit waren die Überstunden.** Die Näherung multiplizierte jeden
  Tag mit der *Regelarbeitszeit* (37,5 h ÷ 5 = 7,50 h). Gerechnet hat die
  Planung mit 8,30 h – Regelarbeitszeit plus 4 h Überstunden je Woche. Bei
  71 Arbeitstagen fehlten so **943 h**, und die Fußzeile schob es auf
  „Feiertage und Urlaub". Das war falsch: Feiertage und Urlaub stecken längst
  in der mittleren Besetzung und in der Zahl der Arbeitstage.
* **Samstage sind der zweite Sonderfall.** Sie zählen als Arbeitstag, laufen
  aber mit eigener Länge (6 h) und nur mit einem Teil der Mannschaft (20 %).
  In einem gemeinsamen Mittelwert verschiebt das beide Seiten – im Test um
  4,4 % nach oben.

`capacityDerivation` rechnet deshalb **zwei Gruppen** mit eigenen
Mittelwerten und mit der Besetzung, mit der die Planung den Tag wirklich
gerechnet hat, und weist jeden Posten einzeln aus:

```
reguläre Arbeitstage   Tage × Besetzung × Stunden je Tag × Produktivität
  darin Überstunden    (Stunden je Tag − Regelarbeitszeit) × Besetzung
+ Samstage             Samstage × Samstagsbesetzung × Samstagsstunden × Produktivität
− Betreuung neuer Kräfte
− Reserve Zubehör
= Näherung
```

Die Abweichung zur taggenauen Summe liegt damit unter 0,1 % – mit
Überstunden, mit Samstagen und mit beidem. Vorher waren es 10 % bzw. 4,4 %.
Drei Tests halten das fest.

**Die 10.731 h stammen aus der falschen Spalte.** Die Karte „Einsetzbare
Mitarbeiter je Arbeitsgang" trug eine Spalte „Kapazität im Zeitraum" mit der
Einheit Mannstunden. Es sind aber **Platzstunden**: Plätze × Belegungszeit ×
mögliche Tage. Aufaddiert ergibt die Spalte 21.826 h – dieselbe Mannschaft
elfmal gezählt. Die Spalte heißt jetzt **„Platzstunden im Zeitraum"**,
darunter steht die Warnung, sie nicht zu addieren, und die
Mitarbeiterstunden des Zeitraums stehen einmal daneben.

### Schichten planen – und was eine Schicht in Stunden ist

`engine/schichtplan.js` beantwortet die Vorgabe „Kein Platz frei ist keine
Option": Welche Arbeitsgänge müssen zwei- oder dreischichtig laufen, damit
die anwesende Mannschaft überhaupt arbeiten kann?

Gerechnet wird greedy und nachlesbar: Der Arbeitsgang mit dem größten
Rückstand bekommt die nächste Schicht, der Stand wird **vollständig neu
durchterminiert**, und die Schicht wird nur übernommen, wenn sie mindestens
einen Verspätungstag einspart. Bringt sie nur eine schönere Warteschlange,
wird sie verworfen – schichtfähige Leute sind knapp und werden für Termine
ausgegeben, nicht für Statistik. Jeder verworfene Schritt steht mit Grund in
der Liste (`OHNE_WIRKUNG`, `ZU_WENIG_SCHICHTFAEHIG`).

Eine Schicht sind 7,5 h Belegungszeit; zwei sind 15 h, drei sind 22,5 h. Die
Umrechnung muss **verlustfrei in beide Richtungen** gehen, und genau daran ist
die erste Fassung gescheitert: Eine versetzte Besetzung von 12 h sind 1,6
Schichten, und die Umrechnung zurück machte daraus 15 h. Damit war der
Vergleich „mit Schichten / ohne Schichten" kein Vergleich mehr – jeder
Arbeitsgang bekam 3 h Belegungszeit geschenkt, die niemand eingestellt hatte.
Gemessen: 790 Verspätungstage in Wirklichkeit gegen 683 in der internen
Rechnung, und der ersten angenommenen Schicht wurden 206 Tage Wirkung
zugeschrieben, die nicht von ihr kamen. Behoben: Es wird nicht mehr gerundet,
und ein unveränderter Schichtstand fasst die Konfiguration nicht an. Zwei
Tests halten das fest („Nullmaßnahme").

Was auch mit drei Schichten offen bleibt, wird benannt – mit Arbeitsgang,
Stundenzahl, Wartetagen, größtem Tag und **Ursache**. Hängt der Rückstand
nicht an einem Platz, wäre „Plätze zusätzlich" die falsche Antwort: Beim
Orbitalschweißen begrenzt die Regel „höchstens 4 Mitarbeiter je Auftrag", bei
der Hydroprüfung das Zeitfenster Di–Do. Übernommen wird der Vorschlag immer
in ein Szenario, nie in den laufenden Plan.

## 5. Verspätung nach Ursache getrennt

`engine/kpi.js` trennt:

- **`lateByMaterial`** – der Auftrag wartet auf Fehlteile. Mehr Personal oder
  Schichten ändern daran nichts.
- **`lateByCapacity`** – hier hilft Kapazität.

Diese Trennung ist der Grund, warum ein Personalantrag mit dieser Anwendung
belastbar ist: Sie beantragt kein Personal für ein Lieferproblem.

## 6. Was eine Änderung bewirkt

`engine/optimizer.js` rechnet jeden Hebel **einzeln** durch und vergleicht
mit dem Ausgangsstand. Ergebnis je Hebel: gesparte Verspätungstage,
Termintreue, Engpass danach. Drei Gruppen:

- **wirksam** – nach Wirkung sortiert,
- **ohne Wirkung** – hier liegt der Engpass nicht,
- **verschlechtert den Plan** – neue Kräfte leisten in den ersten Wochen
  40/60/80 % und binden 5/3/1 Stunden Betreuung; solange nicht die Mannschaft
  der Engpass ist, kostet das mehr, als es bringt.

Im aktuellen Startbestand ist das Ergebnis eindeutig: Die **Plätze** sind der
Engpass, nicht das Personal. Zusätzliche Leiharbeiter bringen null
Verspätungstage; die längere Belegungszeit (versetzte Besetzung) bringt über
1.500.

## 6a. Mehraufwand – was muss passieren, damit es geht?

`engine/mehraufwand.js` beantwortet die Frage, die am Anfang jeder Woche
steht. Grundlage sind zwei Reihen über **13 Wochen ab dem Stichtag**
(rollierendes Quartal – ein Kalenderquartal wäre heute drei Wochen lang und
nächste Woche wieder dreizehn):

| je Woche | woher |
|---|---|
| **fällig** | offene Arbeit der Aufträge, deren Fertigstellung in dieser Woche liegt |
| **Kapazität** | Mitarbeiterstunden dieser Woche (`dayCapacity`, Pool) |

Beide werden aufsummiert. Die **größte Differenz** ist der Mehraufwand.
Im Startdatenbestand: bis KW 48 sind 5.329 h fällig, geleistet werden können
4.649 h – es fehlen **679 h**.

### Warum die alte Zahl falsch war

Vorher stand dort „4.119 Stunden nicht einplanbar". Das war die Summe der
**Tageswarteschlange** über 173 Tage: Ein Auftrag, der fünf Tage auf den
Sägeplatz wartete, wurde fünfmal gezählt. Die größte Warteschlange an einem
einzigen Tag betrug 141 h. Eine Zahl, die um ein Vielfaches zu hoch ist,
führt zu Maßnahmen, die viel zu groß sind. Die Kennzahl ist ersatzlos
gestrichen; wo eine Warteschlange weiter nützlich ist (Rangfolge der
Engpässe), heißt sie jetzt **„Stau"** und sagt dazu, dass sie je Tag zählt.

### Die vier Wege

Immer alle vier, in der Reihenfolge der Abteilungsleitung – auch der, der
nichts bringt:

1. **Überstunden**, höchstens 5 h je Mitarbeiter und Woche (Vorgabe)
2. **Zweiter Platz / Schicht** – schafft **keine** Mannstunden, löst aber den
   Stau. Nur dort vorgeschlagen, wo `maxPlaces` einen zweiten Platz zulässt.
3. **Leiharbeiter** – mit Einarbeitungskurve und Betreuungsaufwand
4. **Samstagsarbeit** – 20 % der Mannschaft, höchstens ein Samstag je Woche

Jeder Weg wird gerechnet, indem die Einstellung geändert und die
Kapazitätsreihe neu summiert wird – kein Schätzwert. Das **Paket** nimmt von
jedem Mittel nur so viel wie nötig, in derselben Reihenfolge.

Übernommen wird eine Maßnahme immer in ein **Szenario**, nie in den laufenden
Plan (`applyMehraufwand`). Danach rechnet die Anwendung den vollen Plan neu –
erst dort zeigt sich, was von der Verspätung wirklich übrig bleibt. Die
Stundenrechnung ist ausdrücklich eine **Untergrenze**: Sie zählt Stunden, nicht
Plätze.

## 6b. IST-Stand, heutiger Stand, SOLL-Stand

Der Arbeitsweg der Abteilungsleitung: „Ist-Stand angeben, Defizite sehen und
nach und nach abstellen. Der IST-Stand bleibt unverändert, ich passe so lange
an, bis wir eine akzeptable OTD haben. Ziel ist, den Plan zu haben und als
SOLL-Stand festzulegen – der SOLL-Stand wird dann zukünftig zum IST-Stand."

| Punkt | Bedeutung | wo |
|---|---|---|
| **IST-Stand** | woher wir kommen, bleibt unverändert | `meta.referenceStateId` |
| **heute** | woran gerade gearbeitet wird (aktives Szenario) | `activeScenarioId` |
| **SOLL-Stand** | der Plan, auf den hingearbeitet wird | `meta.targetStateId` |

Beide Bezugspunkte frieren die **Kapazitätsseite** ein (Besetzung, Schichten,
Plätze, Maschinen, Regeln), nicht den Auftragsbestand – gerechnet wird mit den
heutigen Aufträgen. Sonst verglichen man zwei verschiedene Auftragsbestände
und nennte es Fortschritt.

Ist das Ziel erreicht, macht `promoteTargetToReference` den SOLL zum neuen
IST; das Ziel ist danach wieder offen. Bedienung: Einstellungen → Stände →
Karte „Von wo nach wo".

## 7. Plausibilitätsprüfung

`engine/plausibilitaet.js` vergleicht das Ergebnis mit den Messwerten und den
Angaben der Abteilungsleitung und meldet unter anderem: geplante Besetzung
über der gemessenen, keine Abwesenheit gepflegt, Qualifikationsmatrix
überall angehakt, Schichtbetrieb nicht besetzbar, laut Lieferdatum fertige
Aufträge ohne Haken, Fehlteile ohne Termin, fehlende Zubehörreserve,
Produktivität über 100 %, Lücken in der Tagesliste.

### Befunde bestätigen

Jeder Befund hat eine Kennung aus Prüfung und Betroffenen (`befundKey`) –
bewusst nicht aus dem Text, denn die Zahlen darin ändern sich ständig, der
Sachverhalt nicht. Ein bestätigter Befund („Erledigt") bleibt in der Liste,
zählt aber weder in der Kachel noch in der Ampel. Steigt seine Dringlichkeit
später (aus einem Hinweis wird eine Warnung), meldet er sich von allein
wieder – sonst wäre eine einmalige Bestätigung ein dauerhafter blinder
Fleck. Gespeichert wird die Bestätigung mit Kürzel und Zeitpunkt am Server
(`dataset.meta.plausiAck`), sie gilt für alle Benutzer.

Die Prüfung ändert nichts. Sie sagt nur, wo eine Annahme die Wirklichkeit
überstimmt.

## 8. Was nicht gerechnet wird

- **Keine Fremdvergabe** (ausdrücklich ausgeschlossen).
- **Keine Kostenoptimierung** – Kosten werden ausgewiesen, Termintreue steht
  darüber.
- **Keine Materialplanung auf Einzelteilebene** – Material gilt pauschal ab
  Termin minus 4 Wochen als verfügbar, Fehlteile werden je Auftrag gemeldet.
- **Keine Handverschiebung im Belegungsgitter** – das Gitter ist das Ergebnis
  der Rechnung, nicht eine zweite Wahrheit daneben.
