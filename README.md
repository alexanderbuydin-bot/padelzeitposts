# Padelzeit · Post-Abstimmung

Kleine Seite fürs Team: Instagram-Karussells ansehen, mit 👍 **Posten** oder 👎 **Nicht posten** abstimmen und kurz kommentieren.

- Kein Login: Beim ersten Öffnen fragt die Seite nach dem Vornamen, er bleibt im Browser gespeichert.
- Eine Stimme pro Person und Post. Nochmal tippen nimmt sie zurück, der andere Knopf wechselt sie.
- Stimmen und Kommentare der anderen erscheinen von selbst (alle 20 Sekunden).
- Unter jedem Post: **Alle Fotos** lädt die Slides (1080 px, Qualität 92) – am Telefon über das Teilen-Menü
  (iPhone „Bilder sichern“, Instagram, WhatsApp …), am PC als ZIP mit Ordner und `Text.txt`.
  **Text EN** / **Text DE** kopieren die fertige Bildunterschrift.
- Karte unter dem Bild **nach rechts wischen** (am PC: **⋯**): **Gepostet** schiebt den Post in „Schon gepostet",
  **Löschen** in den zugeklappten Papierkorb – von dort lässt er sich zurückholen. Gilt für alle, mit Name und Zeit.

## Lokal starten

Node 18 oder neuer, keine Abhängigkeiten:

```bash
npm start
```

Dann http://localhost:3000 öffnen. Die Daten landen in `data/db.json`.

## Auf Railway

1. Repo auf GitHub pushen.
2. Railway → **New Project** → **Deploy from GitHub repo** → dieses Repo. Railway erkennt Node und startet `npm start`.
3. **Volume anlegen**: Service → **Volumes** → **Add Volume**, Mount Path `/data`.
   Ohne Volume sind Stimmen und Kommentare nach jedem Deploy weg. Die Seite findet das Volume selbst
   (`RAILWAY_VOLUME_MOUNT_PATH`), eine Variable muss man dafür nicht setzen.
4. Optional: Variable `APP_PASSWORD` setzen. Dann fragt der Browser nach einem Passwort (Benutzername egal).
5. Settings → **Networking** → **Generate Domain** und den Link ans Team schicken.

Health-Check für Railway: `/healthz`.

## Neue Posts hinzufügen

1. Ordner in `Desktop\Posts` anlegen: Slides als `1_….jpg`, `2_….jpg` …, dazu `Beschreibung.txt`
   mit den Abschnitten `ENGLISH`, `DEUTSCH`, optional `QUELLEN`.
2. In `tools/build_posts.py` eine Zeile in `ORDER` ergänzen (oben = wird zuerst gezeigt).
3. Bilder und `public/posts.json` neu erzeugen (braucht Pillow: `pip install pillow`):

   ```bash
   python tools/build_posts.py
   ```

4. Committen und pushen, Railway deployt automatisch.

Die Stimmen hängen an der Post-ID, die aus dem Ordnernamen entsteht. Ordner also nicht umbenennen,
sonst fängt der Post bei null an.

## Aufbau

- `server.js` – liefert `public/` aus und die API (`/api/state`, `/api/vote`, `/api/comment`,
  `/api/comment/delete`, `/api/status`, `/api/rename`). Speichert alles in einer JSON-Datei.
- `public/` – die Seite (`index.html`, `style.css`, `app.js`, `zip.js` für den ZIP-Download am PC) und die
  Bilder unter `posts/`.
- `tools/build_posts.py` – erzeugt die Web-Bilder (1080 px und 540 px), die Download-Fassung unter
  `posts/<post>/dl/` (Dateinamen wie im Post-Ordner) und `posts.json`.
