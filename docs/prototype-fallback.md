# Single-Space Fallback

Der ursprüngliche Mini-Prototyp wurde vor dem Multi-Space-Umbau bewusst im Repo konserviert.

## Archivierter Stand

Pfad: `archive/single-space-prototype/`

Enthalten sind:

- `server.js`
- `public/index.html`
- `package.json`
- `package-lock.json`
- `README.md`
- `HOSTING.md`
- `setup-server.sh`

## Zweck

- Referenz für das ursprüngliche Single-Space-Verhalten
- Fallback, falls der neue Multi-Space-MVP vorübergehend zurückgebaut werden muss
- Vergleichsbasis für Regressionen in Upload, Galerie und Admin-Flow

## Rückfall lokal starten

1. Den Inhalt aus `archive/single-space-prototype/` in eine separate Arbeitskopie übernehmen.
2. Dort `npm install` ausführen.
3. Den archivierten Server wie früher mit `npm start` starten.

Der archivierte Stand bleibt absichtlich unangetastet und wird nicht als produktive Zielarchitektur weiterentwickelt.