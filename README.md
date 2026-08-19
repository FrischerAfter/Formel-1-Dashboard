# F1 Live Dashboard 2026 🏎️ (Node.js-Version)

Dein eigenes, lokal gehostetes F1-Dashboard (Dark Mode + Glasmorphism) mit **echten
Live-Daten und echten Bildern** direkt von motorsport-total.com – Fahrer- und
Konstrukteurswertung, nächstes Rennen mit Countdown & Streckenbild,
Lieblingsfahrer/-team mit großen Fotos.

Dies ist eine 1:1-Portierung der ursprünglichen Python-Version auf **Node.js**, damit
du sie komplett selbst hosten und starten kannst – ohne Python und ohne den PC
deines Freundes.

## Voraussetzungen
- [Node.js](https://nodejs.org) Version 18 oder neuer (bringt `fetch` und
  Web-Standards bereits mit). Prüfen mit: `node --version`
- Einmalig `npm install` (installiert `sharp` für das Freistellen von
  Logos/Streckenbild – die Starter-Skripte machen das automatisch, falls
  `node_modules` noch fehlt)

## ▶ Starten

**Windows:** Doppelklick auf `Dashboard starten.bat`
**macOS/Linux:** `./dashboard-starten.sh` (einmalig `chmod +x dashboard-starten.sh`)

**Alternativ manuell (alle Systeme):**
```bash
npm start
```
Dann im Browser `http://localhost:8712` öffnen.

Der Port lässt sich bei Bedarf über eine Umgebungsvariable ändern:
```bash
PORT=3000 npm start
```

## Warum ein kleiner Server?
Ein Browser darf fremde Webseiten aus Sicherheitsgründen (**CORS**) nicht per
`fetch()` auslesen. Deshalb gibt es `server.js`: Es holt die Seiten
**serverseitig** (kein CORS), liest Tabellen und Bild-URLs live aus und liefert
dem Frontend sauberes JSON unter `/api/data`. Die **Bilder** (Fahrerfotos,
Teamlogos, Autos, Strecke, Flaggen) lädt der Browser danach **direkt von
motorsport-total.com** – sie werden nirgends lokal gespeichert.

`server.js` nutzt ausschließlich **Node-Bordmittel** (`http`, `fetch`,
`TextDecoder`) – keine npm-Installation nötig, `npm start` startet direkt.

## Datenquellen (live bei jedem Refresh)
| Was | Quelle |
|-----|--------|
| Fahrerwertung (Pos, Name, Punkte) | `.../formel-1/ergebnisse/wm-stand/2026/fahrerwertung` |
| Fahrer→Team, Fotos, Logos, Autos | `.../formel-1/teams-und-fahrer` |
| Nächstes Rennen + Countdown + Slug | `.../formel-1/termin-kalender/2026` |
| Streckenbild | `.../formel-1/rennstrecken/<strecke>` |
| Konstrukteurswertung | live berechnet = Summe der Team-Fahrerpunkte |
| Rennergebnisse (Saison + je Rennen) | `.../formel-1/ergebnisse/2026` bzw. `.../ergebnisse/2026/<rennen>/rennen` |

Automatische Aktualisierung alle **60 Sekunden** (plus Button „Aktualisieren").

## Neuer Aufbau: obere Navigation (Tabs) statt einer langen Seite
Das Dashboard ist jetzt in 9 Bereiche aufgeteilt, durchklickbar über eine Tab-Leiste
oben (wie Browser-Tabs), angelehnt an die Struktur von app.formula1dashboard.com:

- **Home** – nächstes Rennen (inkl. Countdown & stilisierter Streckenanimation),
  Top 3 Fahrer, Top 3 Konstrukteure, Kurzfassung des letzten Rennens
- **Schedule** – kompletter Kalender als Liste + interaktive **3D-Weltkugel**
  (globe.gl/three.js) mit Pin auf dem nächsten Rennstandort
- **Results** – die bekannte Rennergebnis-Leiste mit Detail-Modal je Rennen
- **Driver Standings** / **Constructor Standings** – die bisherigen Wertungstabellen,
  jetzt als eigene Seiten
- **Drivers** / **Teams** – durchsuchbares Karten-Grid aller Fahrer/Teams (Foto/Logo,
  Team, Position, Punkte)
- **Stats** – der Saisonverlauf-Chart
- **Head to Head** – der Fahrervergleich

Alles läuft clientseitig in `app.js` (kein Reload beim Tab-Wechsel), die URL bekommt
dabei einen `#anker` für Lesezeichen/Zurück-Button.

### Karte (Schedule): echte 3D-Weltkugel statt flacher Karte
Nutzt **[globe.gl](https://github.com/vasturiano/globe.gl)** (baut auf three.js/WebGL
auf) über CDN (`unpkg.com`), komplett kostenlos und ohne Account/API-Key. Zeigt eine
drehbare 3D-Erde mit Atmosphären-Glow und Sternenhimmel im Hintergrund – dreht sich
von selbst langsam, bis man ein Rennen anklickt (dann fliegt die Kamera dorthin).
Mit Maus/Finger frei drehbar und zoombar.

Die Oberfläche wird nicht mehr aus einer einzigen (bei Nahzoom zwangsläufig
unscharfen) Textur gerendert, sondern über einen echten **Kachel-Explorer**
(„Tile Engine"): bei jedem Zoomlevel werden passende, hochauflösende
Satellitenkacheln von **Esri World Imagery** nachgeladen (kostenlos, kein API-Key
nötig – so funktioniert Google Earth im Prinzip auch, nur mit einer anderen
Kachelquelle). Dadurch lässt sich bis auf Streckenebene reinzoomen.
`controls.minDistance` ist entsprechend niedrig gesetzt, `globeTileEngineMaxLevel`
auf 19 (Straßen-/Grundstücksebene). Falls Esri für eine Region mal keine Kachel in
der höchsten Zoomstufe hat, zeigt die jeweils gröbere verfügbare Stufe.

Die Koordinaten der Rennstrecken stehen als kleine, statische Referenztabelle
(`CIRCUIT_GEO`) in `server.js` – sie ändern sich praktisch nie. Ist eine Strecke dort
(noch) nicht hinterlegt, taucht dafür einfach kein Pin auf und ein kurzer Hinweistext
erscheint.
> Hinweis: Das ist eine echte 3D-Kugel mit echten Satellitenkacheln, aber kein
> 1:1-Ersatz für Google Earth – Straßennamen, 3D-Gebäude oder Nachtlichter-Ansicht
> gibt es hier nicht, nur die Luftbilder selbst.

### Streckenanimation statt Foto
Das reale Streckenbild von motorsport-total.com war bei einigen Strecken ein
Luftbild-Foto und ließ sich nicht sauber auf "nur den Umriss" zuschneiden. Home
zeigt deshalb jetzt eine **selbst gezeichnete, animierte Kurven-Silhouette** (SVG,
läuft mit einem wandernden Lichtpunkt) – das ist bewusst eine stilisierte
Platzhalter-Animation und **keine geometrisch exakte Nachbildung der jeweiligen
Strecke**. Für exakte Streckenlayouts bräuchte es echte Vektordaten pro Strecke,
die ich derzeit aus keiner der geprüften Quellen zuverlässig ziehen kann.

### Streckenanimation: jetzt mit echten Streckenformen
Statt der generischen Platzhalter-Kurve nutzt Home jetzt **echte GPS-Streckenumrisse**
(Quelle: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), gemeinfreie
GeoJSON-Daten), umgerechnet in SVG-Pfade und als `assets/track-shapes.json` gebündelt
(~40&nbsp;KB, kein Internetzugriff zur Laufzeit nötig). Deckt praktisch den kompletten
2026-Kalender ab. Ist eine Strecke dort nicht hinterlegt, greift automatisch die
generische Platzhalter-Animation als Fallback.

### Namen/Umlaute korrigiert
motorsport-total liefert manche Textstellen (u.a. das Länder-Widget) als UTF-8-Bytes
innerhalb einer sonst Windows-1252-kodierten Seite – das erzeugte kaputte Zeichen wie
„HÃ¼lkenberg". Die Korrektur (`fixMojibake`) wird jetzt konsequent auf **alle**
gescrapten Texte angewendet, nicht mehr nur auf einzelne Stellen. Zusätzlich gibt es
eine kleine Tabelle (`NICE_COUNTRY_NAME`), die abgekürzte Ländernamen ohne Umlaute
(„Oesterreich", „Grossbritannien") auf die korrekte deutsche Schreibweise abbildet.

### Teams-Seite & Constructors Championship
Die Teams-Seite zeigt jetzt große Profilkarten (Logo, Motorenhersteller, Autobild,
Fahrer-Chips, Punkte/Position) statt kleiner Kacheln. Die Konstrukteurswertung hat
zusätzlich eine „Constructors Championship"-Balkenansicht (Punkte, Siege, Podien pro
Team) oberhalb der sortierbaren Tabelle bekommen – bewusst als Erweiterung der
bestehenden Seite statt als zehnter Menüpunkt, damit die Navigation klein bleibt.

### Home: Favoriten sind zurück
Lieblingsfahrer/-team lassen sich wieder auswählen und werden direkt auf der
Startseite groß angezeigt (Foto, Team, Position, Punkte, Nation).

### "Destructors Championship" – ehrliche Version
Das Original auf formula1dashboard.com zeigt geschätzte Unfall-Reparaturkosten pro
Fahrer, basierend auf **inoffiziellen Reddit-Schätzungen**. Dafür gibt es keine
verlässliche, seriöse Datenquelle, und erfundene Dollarbeträge zu echten Personen
wollte ich nicht ausgeben. Die Seite hier zeigt stattdessen eine echte
**Ausfall-Statistik**: alle DNFs der Saison je Fahrer, aus den tatsächlichen
Rennergebnis-Gründen zusammengezählt und grob in „Unfall/Kontakt" vs. „Technik" vs.
„Sonstige" eingeteilt (Stichwort-Erkennung im Ausfallgrund-Text) – mit aufklappbarer
Detailliste je Rennen.

### Teams-Seite: große Profile mit Original-Autobildern
Jedes Team bekommt jetzt eine große Zeile: links Logo, Chassisname, Motorenhersteller,
Fahrerfotos und Punkte/Position, rechts ein großes Autobild. Die 2026er-Autobilder
werden direkt von `cdn.formula1dashboard.com` eingebunden (wie gewünscht von der
verlinkten Referenzseite übernommen), die Team-Logos kommen weiterhin live von
motorsport-total.com.

### Bugfix: Ausfälle (DNF/DNS) bei den Rennergebnissen
Bisher wurden im Renn-Detailfenster nur Fahrer angezeigt, die auch ins Ziel
gekommen sind – Ausfälle fielen unter den Tisch, weil die Ausfälle-Tabelle
über den (fragilen) Überschriftentext gesucht wurde. Die Erkennung läuft jetzt
über den tatsächlichen Tabelleninhalt (Link auf ein Fahrerprofil + Pos.-Spalte),
unabhängig von Überschriften. Zusätzlich:
- Fahrer, die zwar noch eine gewertete Position haben, aber nicht aus eigener
  Kraft im Ziel ankamen (z.B. "Abflug" nach über 90% Renndistanz), bekommen
  jetzt ein rotes **DNF**-Badge direkt in der Hauptergebnisliste.
- Die separate Ausfälle-Tabelle zeigt **DNF** oder **DNS** statt nur "–",
  je nachdem was der Ausfallgrund hergibt.

### Drivers-Seite: Karten wie formula1dashboard.com/drivers, aber angepasst
Layout an die verlinkte Referenzseite angelehnt (Name, Team-Logo, Punkte,
Foto), aber **2 statt 3 Karten pro Reihe**, dafür höher statt breiter. Das
Fahrerfoto wird jetzt mit `object-fit: contain` in moderater, fester Größe
gezeigt statt auf die volle Kartenbreite gestreckt – dadurch bleibt es scharf
und wirkt nicht überdimensioniert. Name ist jetzt deutlich größer.

### Fahrerfotos: deine eigenen Bilder
18 der 22 Fahrerfotos sind jetzt deine eigenen, lokal hochgeladenen Bilder
(`assets/drivers/`) – für Hadjar, Gasly, Ocon und Perez wird bis dahin
automatisch das bisherige CDN-Foto verwendet.

### Bugfix: Auto beim Lieblingsfahrer fehlte manchmal
Gleicher Ursache wie der frühere Lieblingsfahrer-Foto-Bug: Die Auswahl hat sich
die **Position** gemerkt statt den Namen. Dadurch konnte es passieren, dass die
Fahrerkarte (und damit auch das Auto) nach einer Aktualisierung nicht mehr
gefunden wurde. Jetzt wird der Name gespeichert – Foto und Auto passen jetzt
immer zusammen.

## Neu: Strafen-Fix, stabilere Karte, Training/Qualifying/Sprint

### Strafen wurden fälschlich als DNF angezeigt
Bug gefunden: Jede Zusatzzeile unter einem Fahrer (egal ob Ausfallgrund oder
Zeitstrafe) wurde als "Fahrer ist ausgefallen" gewertet. Jetzt wird
unterschieden: Nur echte Ausfallgründe markieren einen Fahrer als DNF/DNS.
Zeitstrafen ("5 Sek. Zeitstrafe wegen Kollision" o.ä.) erscheinen stattdessen
als kleine gelbe Bemerkung unter dem Fahrernamen, die Position bleibt korrekt
erhalten.

### Globus: kein Wabbeln mehr, besser am Handy bedienbar
Zwei Ursachen für das "Wabbeln" beim Drehen gefunden und behoben:
- Flaggen-Pins auf der **Rückseite** der Erdkugel wurden nicht automatisch
  ausgeblendet (CSS2DRenderer macht das nicht von selbst) -> jetzt werden Pins
  jenseits von ~87° Winkelabstand zur Kamera weich ausgeblendet.
- Die Auto-Drehung lief weiter, auch während man selbst am Globus gedreht
  hat -> stoppt jetzt sofort bei jeder eigenen Interaktion.

Fürs Handy: `touch-action: none` auf dem Karten-Container gesetzt (Browser hat
vorher um die Touch-Geste konkurriert -> fühlte sich ungenau an), Pixel-Ratio
gedeckelt (weniger GPU-Last), zuverlässigere Reaktion auf Größenänderungen
(orientationchange/visualViewport zusätzlich zu resize), größere Tippziele für
die Flaggen auf kleinen Bildschirmen.

### Ergebnis-Ansicht: jetzt mit Training, Qualifying und Sprint
Das Renn-Detail-Fenster zeigt jetzt zusätzlich aufklappbare Bereiche für 1.–3.
Training, Qualifying, Sprint-Qualifying und Sprint (nur wenn die jeweilige
Session bei diesem Rennwochenende auch stattgefunden hat – z.B. Sprint gibt's
nur an Sprint-Wochenenden, das wird automatisch erkannt). Gleiche Quelle wie
das Rennergebnis, nur die passende Unterseite pro Session.

### Kartenabdeckung
Baut jetzt direkt in der Oberfläche einen Hinweis ein, falls für ein Rennen
keine Kartenposition hinterlegt ist ("X von Y Rennen ohne Kartenposition:
..."), damit sowas sofort auffällt statt nur still zu fehlen.

## Neu: Lieblingsfahrer verstärkt, Wetter, gestufter Countdown, Aufräumen

### Lieblingsfahrer wird jetzt überall hervorgehoben
Statt nur auf der Home-Seite sichtbar zu sein, bekommt dein gewählter
Lieblingsfahrer jetzt einen ⭐-Stern und eine goldene Hervorhebung in der
Fahrerwertung, auf der Drivers-Karten-Seite, und passende News (Titel enthält
seinen Nachnamen) werden nach oben sortiert und markiert.

### Wetter fürs Rennwochenende
Neues Widget auf der Home-Seite unter dem nächsten Rennen: aktuelle
Bedingungen am Streckenort plus 5-Tage-Vorschau, mit besonderer Markierung für
den eigentlichen Renntag (🏁), falls er innerhalb der 16-Tage-Vorhersage liegt.
Quelle: **Open-Meteo** (kostenlos, kein API-Key nötig), nutzt dieselben
Streckenkoordinaten wie die Karte.

### Gestufter Countdown (Training → Training → Quali → Rennen)
Der Countdown zählt jetzt nicht mehr nur bis zum Rennstart, sondern zur
jeweils nächsten Session des Wochenendes: 1. Training → 2. Training →
3. Training → (Sprint-Sessions, falls vorhanden) → Qualifying → Rennen. Eine
kleine Fortschritts-Leiste zeigt alle Sessions mit Uhrzeit, bereits gelaufene
werden abgehakt. Die exakten Zeiten kommen von motorsport-totals eigener
Kalenderseite (in MESZ/MEZ angegeben, wird korrekt in UTC umgerechnet).

### Code aufgeräumt
Rund 15 wirklich ungenutzte CSS-Klassen entfernt (Überbleibsel aus früheren
Layout-Versionen wie die alten kleinen Fahrer-/Team-Kacheln, die alte
Foto-Streckenanzeige, ungenutzte Destructors-Detailansicht).

## Frühere Features (weiterhin enthalten)
- **Rennergebnisse 2026**: Menü-Leiste mit allen Rennen der Saison (Flagge, Sieger, Datum);
  anklickbare, bereits ausgetragene Rennen öffnen ein Detail-Fenster mit dem vollständigen
  Rennergebnis (Position, Fahrer inkl. Foto/Teamfarbe, Team, Rückstand, Punkte) sowie den
  Ausfällen inkl. Grund. Noch nicht ausgetragene Rennen sind ausgegraut.
  Qualifying/Training werden absichtlich **nicht** angezeigt (Umfang bewusst kleingehalten).
  Punkte werden nach dem Standardschema (25-18-15-12-10-8-6-4-2-1 für P1-P10) berechnet;
  Zusatzpunkte (z. B. schnellste Runde) sind nicht enthalten.
- **Eigene Logos**: offizielles F1-Logo im Header, offizielle Team-Logos für Audi & Cadillac
  (lokal in `/assets`, überschreiben das gescrapte Logo für diese beiden Teams)
- **Teamfarb-Rahmen statt Punkt**: jede Zeile in den Wertungstabellen ist dauerhaft in der
  Teamfarbe umrandet (inkl. dezentem Farbverlauf im Hintergrund)
- **Podium-Hervorhebung**: Platz 1–3 bekommen 🥇🥈🥉 mit farbigem Glow (Gold/Silber/Bronze)
- **Punkte-Balken**: kleine Balkenanzeige neben den Punkten, proportional zum Führenden
- **Trend-Pfeile** (▲/▼ + Δ-Punkte): zeigen Positions-/Punkteänderungen seit der letzten
  Aktualisierung (Vergleich wird lokal im Browser via `localStorage` gespeichert)
- **Rennwochenende-Live-Badge**: erkennt rein clientseitig aus dem Renntermin, ob gerade
  Trainings-/Quali-/Renntag ist, und zeigt dann einen pulsierenden roten Punkt +
  „Rennwochenende" bzw. „Rennen läuft" statt „Nächstes Rennen"
- **F1-Startampel-Ladeanimation**: 5 Lichter gehen nacheinander an und wieder aus, statt
  eines generischen Spinners
- **Freigestellte Logos & Streckenbild**: `server.js` lädt Team-Logos und das Streckenbild
  serverseitig, entfernt automatisch den (meist weißen) Hintergrund und schneidet auf den
  Inhalt zu (`/api/img`-Proxy, Ergebnis wird 6&nbsp;Std. gecacht). Funktioniert sehr zuverlässig
  bei Logos auf flachem Hintergrund; das Streckenbild ist bei manchen Strecken ein echtes
  Luftbild-Foto statt einer reinen Vektor-Grafik – dort wird zwar auch zugeschnitten/freigestellt,
  ein perfekter "nur Umriss"-Effekt ist bei Fotos aber nicht garantiert. Ist `sharp` nicht
  installiert, wird automatisch unverändert das Originalbild angezeigt.
- **Saisonverlauf-Chart**: Liniendiagramm mit dem kumulierten Punktestand aller Fahrer nach
  jedem Rennen (`/api/season-progress`). Beim allerersten Laden werden dafür einmalig alle
  bisherigen Rennergebnisse gescraped (etwas mehr Serverlast); jedes Ergebnis wird danach
  dauerhaft im Speicher gecacht, da sich Rennergebnisse nach Rennende nicht mehr ändern.
  Fahrer lassen sich über die Legende ein-/ausblenden.
- **Fahrervergleich**: zwei Fahrer per Dropdown auswählen und Punkte, Siege und Podien direkt
  gegenüberstellen.

> **Ehrlicher Hinweis zu den Trend-Pfeilen/Live-Badge:** motorsport-total.com aktualisiert die
> Wertung erst **nach** offiziellem Rennende – es gibt keine Sekunde-für-Sekunde-Live-Timing
> während des Rennens. Die Pfeile und Punkte-Änderungen erscheinen erst, sobald sich die Quelle
> nach einem Rennwochenende aktualisiert hat; das Live-Badge zeigt nur an, dass gerade ein
> Rennwochenende läuft, nicht den tatsächlichen Streckenstatus.

## Dateien
- `Dashboard starten.bat` – Starter für Windows
- `dashboard-starten.sh` – Starter für macOS/Linux
- `server.js` – Backend / Live-Scraper (reines Node.js, keine Abhängigkeiten)
- `package.json` – `npm start`-Skript
- `index.html`, `style.css`, `app.js` – Frontend
- `assets/` – lokale Logos (F1, Audi-Team, Cadillac-Team)

## Unterschiede zur Python-Version
Nur das Backend wurde portiert (`server.py` → `server.js`), 1:1 dieselbe Logik
(gleiche Scraping-Regeln, gleiches JSON-Format unter `/api/data`). Frontend
(`index.html`, `style.css`, `app.js`) ist unverändert und funktioniert identisch.

## Eigenes Hosting (z. B. auf einem eigenen Server/VPS)
Der Server bindet standardmäßig auf allen Interfaces via `http.createServer` +
`server.listen(PORT)`. Für einen öffentlichen Server empfiehlt sich zusätzlich
ein Reverse-Proxy (z. B. Nginx oder Caddy) davor mit HTTPS, damit die
Verbindung verschlüsselt ist.

## Hinweise / Ehrlichkeit
- **Reine Darstellungs-Metadaten** stehen als Referenztabellen in `server.js`
  (Team-Anzeigenamen, Markenfarben, Fahrer-Nationalität, Länder-Flaggencodes).
  Sie ändern sich praktisch nie. **Alle Wertungs-, Renn- und Bilddaten sind live
  gescraped** – nichts davon ist fest verdrahtet.
- Ändert motorsport-total.com die Seitenstruktur, kann der Scraper angepasst
  werden müssen; das Dashboard zeigt dann ein Fehlerbanner und behält die
  zuletzt geladenen Daten.
