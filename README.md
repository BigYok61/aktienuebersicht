# Aktienübersicht (Web)

Watchlist mit Kursen werktags um 09, 12, 15, 18 und 22 Uhr (Europe/Zurich) in der Handelswährung, Veränderung seit 09:00,
Prognosen (Tagesende, 7 Tage, 3 Monate, 12 Monate – Schätzung, keine Anlageberatung) mit Ist-Vergleich, Dividende,
Analysten-Kursziel (Konsens), News der letzten 72 Stunden und ein rein lokales Depot.
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
- `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` – PWA, entschlüsselt im Browser (WebCrypto).

Im Repository liegen nie unverschlüsselte Daten (`.gitignore` und eine Prüfung im Workflow verhindern das).
Das Depot (Käufe, Bestände) wird **nie** ins Repository geschrieben: Web = localStorage, Mac = lokale Datei/iCloud Drive.

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

## Watchlist bearbeiten
Web-App: „Bearbeiten“ → GitHub-Token eintragen (wird nur im Browser gespeichert). Mac-App: Einstellungen (⌘,) → GitHub-Token
(Schlüsselbund). Die App lädt `data/watchlist.enc.json` über die GitHub-API, entschlüsselt, ändert, verschlüsselt mit demselben
Passwort neu und committet. Der Commit startet den Workflow, der neue Titel samt Verlauf der letzten Tage sofort nachlädt.
Ohne Token: Nur-Lesen; Sortierung und eigene Reihenfolge werden lokal gespeichert.

Token erstellen (einmalig): github.com → Profilbild → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token → Name „Aktienübersicht“, Ablaufdatum wählen → Repository access:
„Only select repositories“ → `BigYok61/aktienuebersicht` → Permissions → Repository permissions → Contents: „Read and write“ →
Generate token → Token (`github_pat_…`) kopieren und in der App eintragen.

## Passwort ändern
1. Neues Passwort als Secret setzen ist der letzte Schritt – zuerst lokal neu verschlüsseln:
   ```
   git pull
   read -rs AKTIEN_PASSWORD; export AKTIEN_PASSWORD        # altes Passwort
   read -rs AKTIEN_PASSWORD_NEU; export AKTIEN_PASSWORD_NEU  # neues Passwort
   pip install cryptography && python3 scripts/passwort.py change
   printf '%s' "$AKTIEN_PASSWORD_NEU" | gh secret set AKTIEN_PASSWORD -R BigYok61/aktienuebersicht
   git add data/*.enc.json && git commit -m "Passwort gewechselt" && git push
   unset AKTIEN_PASSWORD AKTIEN_PASSWORD_NEU
   ```
2. Web-App und Mac-App fragen danach automatisch nach dem neuen Passwort (neues Salt erkannt).
Hinweis: Ältere Commits bleiben mit dem alten Passwort lesbar. Für einen vollständigen Schnitt zusätzlich die Git-Historie
neu aufsetzen (Repo neu anlegen oder History squashen).

## Lokal testen
`AKTIEN_PASSWORD=… python3 scripts/capture.py && python3 -m http.server 8000`
