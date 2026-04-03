# Multi-Space MVP Architektur

## Zielbild

Die Anwendung wird von einer einzelnen Hochzeitsgalerie zu einer kleinen Plattform mit drei Oberflächen erweitert:

- Landingpage unter `/`
- Geheime Gast-Spaces unter `/g/:publicId/:guestToken`
- Betreiber-Backoffice unter `/operator`

## Zugriffsschutz

- Öffentliche Gast-Spaces sind nicht über lesbare Slugs erreichbar.
- Der Gastzugang basiert auf einem langen kryptografischen Token.
- Ohne echten Link oder QR-Code ist ein Space praktisch nicht erratbar.
- Bilder und Thumbnails werden ebenfalls nur unter dem geheimen Space-Pfad ausgeliefert.

## Rollen

### Gast

- Sieht und lädt Fotos im eigenen Space hoch
- Kein Benutzerkonto
- Kein Zugriff auf andere Spaces

### Space-Admin

- Meldet sich pro Space mit eigenem Passwort an
- Verwaltet nur Fotos innerhalb dieses Spaces
- Nutzt eine serverseitige Session statt Klartext-Passwort im Browser

### Betreiber

- Meldet sich getrennt unter `/operator` an
- Sieht alle Spaces systemweit
- Kann Spaces sperren oder freischalten
- Kann Gast-Links rotieren und Admin-Passwörter zurücksetzen

## Datenmodell

Aktuell vorbereitet:

- `spaces`
- `photos`
- `space_admin_sessions`
- `operator_sessions`
- `checkout_sessions`

Stripe und Mailversand sind noch nicht angebunden, aber das Grundschema dafür ist bereits vorhanden.

## Nächste Ausbaustufen

1. Stripe Checkout Session erzeugen
2. Webhook mit Signaturprüfung einbauen
3. Space-Provisionierung nach erfolgreicher Zahlung
4. Bestätigungsmail mit Gast-Link und Admin-Zugang
5. QR-Code-Erzeugung für den Gast-Link