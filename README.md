# Aktienübersicht (Web)

Watchlist mit Kursen werktags um 09, 12, 15, 18 und 22 Uhr (Europe/Zurich) in der Handelswährung, Veränderung seit 09:00,
Prognosen (Tagesende, 7 Tage, 3 Monate, 12 Monate – Schätzung, keine Anlageberatung) mit Ist-Vergleich, Dividende,
Analysten-Kursziel (Konsens), News der letzten 72 Stunden und ein Depot, das auf allen Geräten gleich ist.
Web-App: https://bigyok61.github.io/aktienuebersicht/ – die macOS-App liest dieselben Dateien.

## Dateien
- `scripts/capture.py` – Erfassung (GitHub Actions, stündlich :25 UTC Mo–Fr). Idempotent: Werte zu Zeitpunkten,
  Schlusskurse und Prognosen werden nie überschrieben; verpasste Zeitpunkte werden aus dem ca. 10-tägigen
  5-Minuten-Verlauf nachgetragen (auch für neu hinzugefügte Titel).
- `scripts/aucrypt.py` – Verschlüsselung (AES-256-GCM, Schlüssel per PBKDF2-SHA256, 310 000 Iterationen, zufälliges Salt).
- `scripts/passwort.py` – Daten lokal anzeigen bzw. Passwort wechseln.
- `data/watchlist.enc.json` – Watchlist (Titel, Kategorien, Reihenfolge) – **verschlüsselt**
- `data/quotes.enc.json` – Kurse, Devisenkurse (CHF) je Zeitpunkt, Schlusskurse, Prognosen, Dividenden, Kursziele – **verschlüsselt**
- `data/news.enc.json` – Schlagzeilen (Titel, Link, Quelle, Zeit) – **verschlüsselt**
- `data/portfolio.enc.json` – Depot (Käufe, Kaufpreise, Devisenkurse am Kaufdatum) – **verschlüsselt**
- `data/experts.enc.json` – veröffentlichte Experten-Kursziele mit Quelle und Datum – **verschlüsselt**
- `data/alerts.enc.json` / `data/alertstate.enc.json` – Kursalarme bzw. bereits gesendete Push-Meldungen – **verschlüsselt**
- `scripts/alerts.py` – Push-Alarme via ntfy (eigener Workflow, alle 15 Min.)
- Chartdaten (`charts.enc.json`, komprimiert, verschlüsselt) werden nur auf GitHub Pages veröffentlicht, nicht committet.
- `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` – PWA, entschlüsselt im Browser (WebCrypto).

Im Repository liegen nie unverschlüsselte Daten (`.gitignore` und eine Prüfung im Workflow verhindern das).
Auch das Depot liegt nur verschlüsselt im Repository (`data/portfolio.enc.json`, gleiches Passwort) – Web-App und Mac-App
lesen und schreiben dieselbe Datei, darum ist es auf allen Geräten gleich.

## Depot (alle Geräte)
- **Lesen** geht immer (auch ohne Token): Die App lädt `data/portfolio.enc.json` und entschlüsselt sie im Browser bzw. auf dem Mac.
- **Speichern** braucht den GitHub-Token (siehe unten). Jede Änderung wird lokal sofort gesichert (Web: localStorage,
  Mac: `~/Library/Application Support/Aktienuebersicht/portfolio.json`) und gleich danach verschlüsselt ins Repository
  geschrieben. Ohne Token oder offline bleibt sie lokal und wird beim nächsten Laden mit Token nachgetragen.
- **Gleichzeitige Änderungen** auf zwei Geräten gehen nicht verloren: Die App holt vor dem Speichern den aktuellen Stand,
  führt pro Kauf zusammen (neuere Änderung gewinnt, gelöschte Käufe bleiben gelöscht) und speichert mit Konfliktprüfung (sha).
- **Erstes Mal / Umzug:** Gibt es auf einem Gerät noch ein altes lokales Depot (früher nur localStorage bzw. iCloud Drive),
  wird es beim ersten Anmelden mit Token hochgeladen. Liegt im Repository schon ein anderes Depot, fragt die App:
  «zusammenführen» (nichts geht verloren) oder «Stand aus dem Repo übernehmen» (lokale Sicherung bleibt erhalten).
- Export/Import (JSON) gibt es weiterhin; ein Import ersetzt das Depot auf allen Geräten.
- Depot-Änderungen lösen keine Kurserfassung aus; die Pages-Kopie wird beim nächsten Lauf aktualisiert (die Apps lesen direkt aus dem Repo).

## Verschlüsselungsformat
```json
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":310000,"salt":"<base64>","iv":"<base64, 12 Byte>","ct":"<base64 Chiffrat+Tag>"}
```
Alle Dateien verwenden dasselbe Salt; jede Verschlüsselung einen neuen IV. Klartext = UTF-8-JSON.

## Quellen (getestet am 2.10.2026 von GitHub-Runnern und vom Entwicklungsrechner)
| Quelle | Wofür | Bemerkung |
|---|---|---|
| CNBC (`ts-api.cnbc.com`, `quote.cnbc.com`) | Kurse je Zeitpunkt (5-Min.-Kerzen, ~10 Handelstage), Tagesschlusskurse (~2 Jahre), Devisen, Jahresdividende/Rendite | inoffiziell, ohne Schlüssel, Kurse bis 15 Min. verzögert, User-Agent nötig |
| TradingView Scanner | Jetzt-Kurse (Web: CORS erlaubt), Suche, Branche, Dividendentermine, Kursziel-Konsens (FactSet) | inoffiziell; Fundamentaldaten teils in USD → werden umgerechnet |
| Google News RSS | News 72 h | Links führen über news.google.com zum Originalartikel |
| Frankfurter (EZB) | Devisenkurs am Kaufdatum (Depot) | offiziell, frei |
| Yahoo Finance | – | von GitHub-Runnern HTTP 429 → nicht verwendet |
| Stooq | – | verlangt JavaScript/Bot-Prüfung → nicht verwendet |

## Prognosemodelle (bewusst einfach, deterministisch – Schätzung, keine Anlageberatung)
Erstellt einmal je Handelstag mit dem Kurs um 09:00 (Spot) und den Tagesschlusskursen **vor** diesem Tag.
- Tagesende: Spot + 0.5·Trend(5 Tage) − 0.3·(Spot − Vortagesschluss), begrenzt auf ±0.5 × mittlere Tagesspanne.
- 7 Tage / 3 Monate / 12 Monate (h = 5 / 63 / 252 Handelstage): Spot·exp(Drift + Rückkehr), Drift = Dämpfung·mittlere
  Log-Rendite·h (10 / 250 / 500 Tage, Dämpfung 0.3 / 0.5 / 0.5), Rückkehr zum 20-/200-Tage-Mittel (0.15 / 0.10 / 0.10),
  begrenzt auf ±1 Standardabweichung·√h.
Ziel: Schlusskurs am Zieltag (+0 / +7 Tage / +3 / +12 Monate), sonst nächster Handelstag; bis dahin wird das Zieldatum angezeigt.

## Entsperren
1. https://bigyok61.github.io/aktienuebersicht/ öffnen (auf dem iPhone in Safari: Teilen → «Zum Home-Bildschirm» = App).
2. Passwort eingeben → «Entsperren». Die Daten werden erst im Browser entschlüsselt; das Passwort verlässt das Gerät nie.
3. Optional «Passwort merken (auf diesem Gerät)»: Gespeichert wird nur der abgeleitete Schlüssel (localStorage).
   «Abmelden» (unten links) löscht ihn wieder.

## Watchlist und Kursalarme bearbeiten (GitHub-Token)
Ohne Token ist die App nur lesbar (Sortierung und eigene Reihenfolge werden lokal gespeichert). Zum Bearbeiten (Watchlist,
Kursalarme, Depot) braucht es
einmalig einen GitHub-Token, der nur dieses eine Repository ändern darf.

**Token erstellen (einmalig):**
1. github.com → Profilbild oben rechts → **Settings**
2. ganz unten links **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. Token name «Aktienübersicht», Ablaufdatum wählen (z. B. 1 Jahr)
4. Repository access: **Only select repositories** → nur **BigYok61/aktienuebersicht**
5. Permissions → Repository permissions → **Contents: Read and write** (alles andere bleibt «No access»)
6. **Generate token** → Token (`github_pat_…`) kopieren – er wird nur einmal angezeigt.

**Token eintragen:** Web-App → «Bearbeiten» → Token einfügen → «Token speichern». Der Token bleibt nur in diesem Browser
(localStorage) und wird nur an api.github.com gesendet. Mac-App: Einstellungen (⌘,) → GitHub-Token (Schlüsselbund).
Entfernen: «Bearbeiten» → «Token entfernen»; widerrufen: auf github.com unter Fine-grained tokens löschen.

**Watchlist:** «Bearbeiten» → Titel suchen und hinzufügen, löschen, Kategorie ändern, Reihenfolge ziehen, neue Kategorie.
Die App lädt `data/watchlist.enc.json` über die GitHub-API, entschlüsselt, ändert, verschlüsselt mit demselben Passwort neu
und committet. Der Commit startet die Erfassung; neue Titel erscheinen samt Verlauf nach ca. 3–5 Minuten.

**Kursalarme:** Titel öffnen → Karte «Kursalarme» → «unter»/«über», Kurs (in der Handelswährung), optional Notiz →
«Hinzufügen»; ✕ löscht einen Alarm. Gespeichert verschlüsselt in `data/alerts.enc.json`, geprüft alle 15 Minuten.

## Push-Alarme (ntfy)
`scripts/alerts.py` (Workflow «Push-Alarme», alle 15 Min. Mo–Fr, ca. 08:00–22:15 Zürcher Zeit) sendet über ntfy:
- Watchlist-Titel mit Tagesveränderung ≥ ±5 % (einmal je Titel, Tag und Richtung),
- beliebige US-Aktie mit ≥ ±10 % (Top-Gewinner/-Verlierer, einmal je Titel und Tag),
- eigene Kursalarme (z. B. TSLA unter 200),
- um 22:15 die Tagesbilanz (Indizes, grösste Bewegungen der Watchlist; das Depot erscheint dort nicht).

Empfangen: ntfy-App (iOS/Android) → «+» → Topic eintragen (bei der Einrichtung festgelegt, als Secret `NTFY_TOPIC` hinterlegt – privat halten; ein Secret lässt sich auf GitHub nicht auslesen, nur neu setzen).
Bereits gesendete Alarme stehen verschlüsselt in `data/alertstate.enc.json` (keine Doppelmeldungen).
Test-Push: `gh workflow run alerts.yml -R BigYok61/aktienuebersicht -f test=true`.

## Passwort ändern
Alle Dateien werden lokal mit dem neuen Passwort (neues Salt) neu verschlüsselt; danach bekommt GitHub das neue Secret.
Damit kein Workflow dazwischen mit dem falschen Passwort läuft, beide Workflows kurz pausieren:
```
cd aktienuebersicht
gh workflow disable capture.yml && gh workflow disable alerts.yml
git pull
read -rs AKTIEN_PASSWORD; export AKTIEN_PASSWORD          # altes Passwort (wird nicht angezeigt)
read -rs AKTIEN_PASSWORD_NEU; export AKTIEN_PASSWORD_NEU  # neues Passwort
pip install cryptography && python3 scripts/passwort.py change
git add data/*.enc.json && git commit -m "Passwort gewechselt" && git push
printf '%s' "$AKTIEN_PASSWORD_NEU" | gh secret set AKTIEN_PASSWORD
unset AKTIEN_PASSWORD AKTIEN_PASSWORD_NEU
gh workflow enable capture.yml && gh workflow enable alerts.yml && gh workflow run capture.yml
```
Die Web-App und die Mac-App fragen danach automatisch nach dem neuen Passwort (neues Salt erkannt); ein gemerkter
Schlüssel wird verworfen. Die Chartdaten werden beim nächsten Lauf neu aufgebaut.
Hinweis: Ältere Commits bleiben mit dem alten Passwort lesbar. Für einen vollständigen Schnitt zusätzlich die Git-Historie
neu aufsetzen (Repo neu anlegen oder History squashen).

## Lokal testen
`AKTIEN_PASSWORD=… python3 scripts/capture.py && python3 -m http.server 8000`
