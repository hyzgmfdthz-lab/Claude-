# Armaturenbau MEGC – Produktionsplanung

Interaktives Produktionsplanungs-, Kapazitäts- und Szenariosimulationswerkzeug
für den **Armaturenbau der MEGC-Anlagen bei Hexagon Purus** – Behälterverrohrung,
Rohrbaugruppen, Armaturen, Verschraubungen, Ventile und Druckregelstrecken.

Die Anwendung beantwortet zwei Fragen:

> **Was passiert, wenn ich etwas ändere?**
> **Was müsste ich ändern, damit wir unsere Termine halten?**

---

## Unterlagen

| Datei | Inhalt |
|---|---|
| [`docs/BEDIENUNG.md`](docs/BEDIENUNG.md) | Kurze Bedienungsanleitung – Start, die fünf Bereiche, der typische Ablauf |
| [`docs/PLANUNGSLOGIK.md`](docs/PLANUNGSLOGIK.md) | Wie gerechnet wird: Kapazitätsgrenzen, Termine, Engpass, Wirkungsanalyse |
| [`docs/ZU-VALIDIEREN.md`](docs/ZU-VALIDIEREN.md) | Alle Startwerte, die fachlich noch zu bestätigen sind |
| [`docs/ABGLEICH-LASTENHEFT.md`](docs/ABGLEICH-LASTENHEFT.md) | Abgleich mit allen 99 Punkten des Lastenheftes, mit Nachweis |

---

## Zwei Fassungen

### A) Einzeldatei – ganz ohne Installation

**[`dist/Armaturenbau-MEGC.html`](dist/Armaturenbau-MEGC.html)** doppelklicken.
Fertig. Die Datei enthält Oberfläche, Planungsengine und Startdaten
vollständig; es wird keinerlei zusätzliche Software benötigt und keine
Internetverbindung.

Die Daten werden im Speicher des Browsers abgelegt. Sie sind damit an diesen
Rechner, dieses Benutzerkonto und diesen Browser gebunden – gemeinsames
Arbeiten ist auf diesem Weg nicht möglich (dafür Fassung C). Unter
„Daten & Prüfung" lässt sich der gesamte Datenbestand als Sicherungsdatei
speichern und wieder einlesen.

Neu erzeugen lässt sich die Datei mit `npm run build:html`.

### B) Lokale Anwendung mit Node.js – für den dauerhaften Einsatz

1. Einmalig **Node.js LTS** (Version 20 oder neuer) installieren:
   <https://nodejs.org/de/download>
2. **`Start-Armaturenbau.bat`** doppelklicken.
3. Der Browser öffnet sich mit <http://127.0.0.1:7311/>.

Es sind **keine weiteren Pakete, kein `npm install` und kein Build-Schritt**
erforderlich. Unter Linux/macOS: `./start.sh`.

Daten liegen lokal in einer SQLite-Datenbank unter
`%APPDATA%\MEGC-Armaturenbau\planung.db` (bzw. `~/.megc-armaturenbau/`),
mit automatischen Sicherungen – keine Cloud-Abhängigkeit.

### C) Zu mehreren arbeiten – Vorarbeiter, Teamleiter, Leiter

Ein Rechner der Abteilung stellt die Planung im Firmennetz bereit, die Kollegen
arbeiten im Browser mit demselben Datenbestand.

1. Auf diesem Rechner **`Start-Armaturenbau-Netzwerk.bat`** doppelklicken
   (Linux/macOS: `MEGC_HOST=0.0.0.0 ./start.sh`).
2. Das Fenster nennt die Adresse im Netz, z. B. `http://192.168.10.24:7311/` –
   diese Adresse an die Kollegen weitergeben.
3. Jeder meldet sich mit **Kürzel und eigenem Passwort** an (beim ersten Mal
   vergibt man es selbst). Alle haben dieselben Möglichkeiten; nur Kürzel
   anlegen und Passwörter zurücksetzen ist an ein Kürzel gebunden (ab Werk
   `DOHE`).
4. Speichert jemand etwas, meldet die Oberfläche der anderen oben rechts
   „… hat geändert – neu laden".

Es ist nur im Firmennetz erreichbar und unverschlüsselt (HTTP) – siehe
[`../docs/IT-FREIGABE.md`](../docs/IT-FREIGABE.md), Abschnitt 7.

| | A) Einzeldatei | B) Mit Node.js | C) Im Netz |
|---|---|---|---|
| Installation | keine | Node.js einmalig | Node.js auf einem Rechner |
| Datenhaltung | Browser-Speicher | SQLite-Datei | SQLite-Datei auf dem bereitstellenden Rechner |
| Automatische Sicherungen | 8 Stände | 30 Stände | 30 Stände |
| Gemeinsam arbeiten | nein | nein | ja, 5–10 Personen |
| Funktionsumfang | identisch | identisch | identisch |

---

## Funktionsumfang

**Datengrundlage**
* 37 Aufträge, Arbeitsgangzeiten, Wochenkapazitäten und Ressourcen aus der
  bisherigen Planung („Produktionsplanung Arbeitsplätze", Planstand 09.09.2026)
* Die drei Ausbaustufen dieser Planung sind als Szenarien hinterlegt
  (Regelbetrieb, versetzte Besetzung + Samstag, Engpasspaket)

**Planung**
* Projektverwaltung mit dauerhaften IDs, Projektarten (Neubau, Umbau,
  Wiederkehrer ISO, Prüfer, Reparatur, Sonderprojekt) und MEGC-Varianten
  20/30/40/45 ft
* Arbeitsfolgen je Projektart und Variante mit editierbaren Stunden je Arbeitsgang
* Abhängigkeitsnetz statt starrer Liste; Heften und Orbitalschweißen laufen
  überlappend mit einstellbarem Heftvorsprung (5–10 h)
* Kapazitätsbegrenzte Terminierung auf Tagesebene, Auswertung je Tag und je
  Kalenderwoche
* Sonderrestriktionen: Hydroprüfung nur Di–Do und nur bei NoBo-Anwesenheit,
  Material ab T-4 Wochen, Projektstart-Vorlaufzeiten

**Kapazität**
* Mitarbeiterkapazität mit globaler Produktivität, Überstunden, Samstagsarbeit
  (6 h, 20 %-Regel), Leiharbeitern und Neueinstellungen inkl. Einarbeitungs- und
  Betreuungskurven, wochenweise gepflegter Stammbesetzung
* Kapazität getrennt je Arbeitsgang/Qualifikation
* Prozessressourcen: 6 Orbitalschweißmaschinen, 1 Schweißer : 2 Maschinen,
  2 (optional 3) Heftplätze, WIP-Grenze für parallele Kernaufträge
* Betriebszeitfenster der Arbeitsplätze (versetzte Besetzung, Schichten bis
  24 h) je Arbeitsgang einstellbar, getrennt von der Arbeitszeit der
  Mitarbeiter
* Maschinenstunden und Mannstunden werden strikt getrennt geführt

**Auswertung**
* Ein Arbeitsbildschirm („Steuerstand"): links die Stellschrauben, rechts die
  Wirkung – jede Änderung rechnet sofort durch
* Antwortzeile im Klartext: wie viele Termine reißen, wo es klemmt und wie viele
  Mitarbeiter für 100 % Termintreue nötig wären. Helfen Mitarbeiter allein
  nicht, wird das gesagt und die begrenzende Stelle benannt
* Kennzahlen: im Termin, zu spät, Kapazität, Aufwand, **über Kapazität**
  (terminbezogener Fehlbetrag), Termintreue, engste Stelle, Auslastung Orbital
* Kapazitätsdiagramm je Kalenderwoche (Säulen Aufwand gegen Kapazitätslinie)
* Wochenübersicht mit fehlenden Mitarbeitern je Kalenderwoche
* Auslastung je Arbeitsplatz und Kalenderwoche als Matrix
* Interaktives Gantt auf Tages- und Wochenebene mit aufklappbaren Arbeitsgängen
* Ursachenanalyse im Klartext statt nur „Rot"

**Gemeinsam arbeiten**
* Anmeldung mit Kürzel und eigenem Passwort (Hashwerte, 12-Stunden-Sitzungen);
  ohne Anmeldung gibt die Schnittstelle keine Daten heraus
* **Stände**: kompletter Datenbestand mit Pflichtnotiz speichern, ansehen,
  laden – für alle sichtbar, täglich zusätzlich automatisch
* **Änderungsprotokoll** im Klartext und Aufholmeldung „seit Ihrem letzten
  Besuch"
* Fremde Änderungen werden gemeldet, statt stillschweigend überschrieben zu
  werden; ein Szenario kann als **Aktueller Plan** markiert werden

**Eigene Regeln**
* Regel als Satz eintragen („Verschraubungen können nach dem Biegen schon
  gemacht werden"), die Anwendung übersetzt sie und zeigt sie als Baukasten
* Arten: Reihenfolge, Vorlauf, Wochentage, Obergrenze, Auftragsreihenfolge
* Geltungsbereich: alle Aufträge, je Auftragsart/Variante oder einzelne
  Aufträge; einzeln ein-/ausschaltbar, Wirkung als Vergleich „mit/ohne"
* Widersprüchliche oder unmögliche Regeln werden gemeldet und nicht gespeichert
* Übersetzung vollständig lokal, ohne Internet und ohne Sprachmodell

**Simulation**
* Elf Stellschrauben direkt am Diagramm: Stammbesetzung, Leiharbeiter,
  Überstunden, Samstagsarbeit, parallele Aufträge, Mitarbeiter je Auftrag,
  Belegungszeit je Tag, Orbitalschweißer, Heftplätze, Produktivität
* Belegungszeit und Plätze **je Arbeitsgang** (Schichtmodelle bis 24 h) direkt
  unter der Auslastungsmatrix
* Gesamtfortschritt angearbeiteter Aufträge in Prozent direkt in der Liste
* Unveränderte Baseline zum Vergleich, dazu die Ausbaustufen der bisherigen
  Planung; benannte Zwischenstände zur nachträglichen Einsicht
* Berechnung des Personalbedarfs für 100 % Termintreue (Intervallhalbierung
  über vollständige Simulationen, ohne Einarbeitungsabschlag)
* Fremdvergabe ist ausgeschlossen

**Daten**
* Persistente lokale Datenhaltung mit automatischen Sicherungen
* Excel- und CSV-Import/-Export ohne Fremdbibliotheken
* Datenprüfung (doppelte Projekte, fehlende Termine, widersprüchlicher
  Fortschritt, unmögliche Hydrotermine …)
* Arbeitsplätze bereits als eigene Objekte – Grundlage für die spätere
  Belegungsplanung

---

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`../docs/BEDIENUNG.md`](../docs/BEDIENUNG.md) | Kurze Bedienungsanleitung |
| [`../docs/PLANUNGSLOGIK.md`](../docs/PLANUNGSLOGIK.md) | Vollständige Beschreibung der Rechenlogik |
| [`../docs/ARCHITEKTUR.md`](../docs/ARCHITEKTUR.md) | Bewertung der Architekturvarianten und Entscheidung |
| [`../docs/ZU-VALIDIEREN.md`](../docs/ZU-VALIDIEREN.md) | Liste der fachlich noch zu bestätigenden Parameter |

---

## Tests

```bash
npm test           # Engine und Browserbausteine
npm run test:all   # zusätzlich Schnittstelle, Datenhaltung, Excel, Bedienablauf,
                   # Anmeldung, Regeln, Stände, Mehrbenutzerbetrieb (217 Tests)
npm run lint       # statische Prüfung (lädt ESLint einmalig per npx)
npm run typecheck  # Typprüfung der JSDoc-Angaben (lädt TypeScript einmalig per npx)
```

`lint` und `typecheck` benötigen einmalig eine Internetverbindung, sind aber
reine Entwicklungswerkzeuge – für den Betrieb der Anwendung nicht erforderlich.

Alles zusammen – mehrfach hintereinander, wie vor einer Auslieferung:

```bash
npm run pruefen        # zwei vollständige Durchläufe (Standard)
npm run pruefen -- 3   # drei Durchläufe
```

Geprüft werden je Durchlauf: statische Prüfung, Typprüfung, alle
automatisierten Tests, Neuaufbau der Einzeldatei sowie – wenn Playwright
vorhanden ist – die Oberfläche beider Fassungen und die Dauerhaftigkeit der
Einzeldatei.

Zusätzlich steht ein Oberflächentest bereit, der die komplette Bedienoberfläche
in einem echten Browser prüft (93 Prüfungen: Anmeldung und Erstanmeldung, alle
Stellschrauben des Steuerstands, alle acht Bereiche, Auftragspflege,
Arbeitsfolgen, NoBo-Kalender, Regeln vom Satz bis zur Wirkung, Stände und
Änderungsprotokoll, Benutzerverwaltung, Datenprüfung, Excel-Export sowie zwei
gleichzeitig angemeldete Benutzer auf getrennten Browsern).
Er benötigt Playwright und ist deshalb nicht Teil der Anwendung:

```bash
npm install -g playwright && npx playwright install chromium

node server/server.js &          # Fassung B/C prüfen
node tools/ui-test.mjs

npm run build:html               # Fassung A prüfen
node tools/standalone-test.mjs   # Start aus der Datei, Speicherung, Excel, Sicherung
```

Abgedeckt sind unter anderem:

* Kapazität > Bedarf → Termine werden gehalten
* Bedarf > Kapazität → Arbeit wandert weiter, Termine verschieben sich
* Produktivität, Leiharbeiter, Überstunden, Samstagsarbeit, Schweißerzahl,
  Maschinenausfall, dritter Heftplatz
* NoBo-Tag entfernen → Hydroprüfung verschiebt sich
* Projekt hinzufügen/löschen, Termin vorziehen, Priorität und Reihenfolge ändern
* **Regressionstest Überlast:** Bei massiver Überlast *muss* die Software
  verspätete Projekte erzeugen – andernfalls schlägt der Test fehl
* **Regressionstest Reihenfolgetausch (Infraserv/PAK):** Beim Tauschen wird
  tatsächlich neu gerechnet, nicht nur der Status verschoben
* Grenzfälle: keine Projekte, keine Kapazität, fehlende Arbeitsfolge, Zyklen im
  Abhängigkeitsnetz, unsinnige Eingabewerte
* Excel-/CSV-Rundlauf, Import mit korrigierten Terminen, Sicherung und
  Wiederherstellung, HTTP-Schnittstelle, Rückfallebene der Datenhaltung
* Personalbedarfsrechnung: kleinste ausreichende Zahl, Gegenprobe mit einem
  Mitarbeiter weniger, ehrliche Antwort bei Maschinenengpass
* Auslastung je Arbeitsplatz: Maschinenstunden beim Orbitalschweißen,
  eingestellte Platzzahl, Überlast über 100 %
* Anmeldung: PBKDF2 bitgleich zu `node:crypto`, falsches Passwort, Ablauf nach
  12 Stunden, Abmelden, Passwortwechsel beendet andere Sitzungen, ohne
  Anmeldung liefert keine Schnittstelle Daten
* Regeln: beide Beispielsätze der Abteilung, Widerspruch, Kreis, Geltungsbereich
  und die tatsächliche Wirkung auf die Terminierung
* Stände: Pflichtnotiz, Sichtbarkeit für alle, Ansehen ohne Nebenwirkung,
  Laden, Löschrechte, tägliche Sicherung
* Mehrbenutzerbetrieb: Änderungsstand, Änderungsprotokoll im Klartext,
  Aufholmeldung, gleichzeitige Änderungen
* Determinismus: zehn aufeinanderfolgende Läufe liefern identische Ergebnisse

---

## Technik

| Schicht | Umsetzung |
|---|---|
| Planungsengine | JavaScript (ES-Module), ohne Abhängigkeiten, vollständig testbar |
| Server | Node.js (eingebautes `http`), lokal auf `127.0.0.1`, für den gemeinsamen Betrieb auf `0.0.0.0` |
| Datenhaltung | SQLite (`node:sqlite`), automatischer Rückfall auf Dateiablage |
| Oberfläche | ES-Module im Browser, eigene SVG-Diagramme, kein Build-Schritt |
| Excel | eigener XLSX-Leser/-Schreiber (Node: `zlib`; Browser: eigener DEFLATE-Decoder) |
| Einzeldatei | eigener Bündler (`tools/build-html.mjs`), eine HTML-Datei mit ~350 KB |

Die Engine (`engine/`) kennt weder DOM noch HTTP und ist dadurch unabhängig von
der Oberfläche automatisiert prüfbar.
