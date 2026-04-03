# Sitzungsnotiz — 2026-04-03

**Datum:** 2026-04-03

## Kurzstatus
- Multi-Space MVP implementiert (`server.js`).
- Landing: `public/index.html`; Operator: `public/operator.html`; Guest: `public/space.html`.
- Archivierter Single-Space-Prototyp: `archive/single-space-prototype/`.
- Lokaler Server läuft auf `0.0.0.0:3000`, LAN-URL: `http://192.168.178.103:3000`.
- `OPERATOR_PASSWORD` wurde temporär beim Start gesetzt (Wert nicht im Repo gespeichert).

## Nächste Schritte
- Stripe Checkout + Webhook-basierte Provisionierung.
- Bestätigungs-E-Mail + QR-Code-Erzeugung für Spaces.
- Hosting-Dokumentation aktualisieren (insb. `TRUST_PROXY`, `OPERATOR_PASSWORD`).
- Optional: Firewall-Regel für Port 3000, falls Geräte im WLAN die Verbindung blockieren.

## Technische Details
- Datenbank: `data/platform.sqlite`
- File-Storage: `storage/spaces/` (pro Space)
- Geheime Routen: `/g/:publicId/:guestToken`
- Vorbereitete Tabellen: `spaces`, `photos`, `operator_sessions`, `space_admin_sessions`, `checkout_sessions`

## Kurztests (Smoke)
- Operator-Login: OK
- Space-Erzeugung: OK (liefert guestUrl + temporäres adminPass)
- Guest-Config via echtem Token: OK
- Falscher Token: 404 (erwartet)
- Trust-proxy Warnung gefixt durch explizite `TRUST_PROXY`-Konfiguration

## Status
Pausiert — Fortsetzung später.

--
Diese Datei wurde automatisiert aus der aktuellen Session erstellt.
