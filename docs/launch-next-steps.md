# Launch Checklist — Wedding Camera Roll

**Status:** 19.07.2026  
**Ziel:** Kontrollierter Markteintritt in Deutschland mit zahlenden Hochzeitspaaren.  
**Wichtig:** Noch **keine bezahlte Werbung, keine öffentlichen Buchungen und keine Verkaufsaussagen** starten. Der Zahlungs- und E-Mail-Prozess ist noch nicht produktiv geprüft.

## 1. Bereits erledigt

### Produkt und Betrieb

- [x] Multi-Space-App mit geheimen Gastlinks, getrenntem Brautpaar-Login und Betreiber-Backoffice.
- [x] Hochladen, Galerie, QR-Code, Moderation, Archiv, endgültiges Löschen und ZIP-Export der Originalbilder.
- [x] ZIP-Export enthält nur Originale und `manifest.json`, keine Thumbnails.
- [x] HEIC/HEIF-Vorschauen, EXIF-Rotation und Originaldatei-Erhalt.
- [x] Basic-Tarif: **39 € einmalig**, **20 GiB**, **6 Monate**.
- [x] Premium-Tarif: **69 € einmalig**, **100 GiB**, **12 Monate**.
- [x] Speicherlimit wird serverseitig pro Space durchgesetzt.
- [x] Operator-Backoffice zeigt Tarif, Verbrauch und Ablaufzeit.
- [x] Tests laufen seriell und bestehen vollständig: `npm test`.
- [x] Produktionsabhängigkeiten wurden auf bekannte Sicherheitslücken geprüft: `npm audit --omit=dev` meldet aktuell keine bekannten Schwachstellen.

### Infrastruktur und Datensicherheit

- [x] HTTPS, Nginx, Firewall, PM2 und Health-Endpunkte laufen auf `ourbigday.space`.
- [x] Hetzner Cloud Backups sind aktiviert; der erste Lauf war erfolgreich.
- [x] Der alte lokale Backup-Timer ist deaktiviert.
- [x] Die doppelte lokale Backup-Kopie wurde entfernt.
- [x] Hauptpartition nach Bereinigung: rund **24 GB frei**, **36 % belegt**.

### Rechtliches

- [x] Impressum und Datenschutzerklärung enthalten die hinterlegten Anbieter-Kontaktdaten.
- [ ] AGB, Datenschutzerklärung, Speicherdauer und Rechnungsprozess müssen vor dem öffentlichen Verkauf rechtlich geprüft werden.

## 2. Aktueller technischer Stand der Zahlungsfunktion

Die Codegrundlage für Stripe ist lokal vorbereitet, aber **noch nicht auf Produktion ausgerollt**:

- [x] Tarifwahl auf der Landingpage.
- [x] Stripe Checkout wird serverseitig erzeugt.
- [x] Ein Space wird zunächst nur als `pending` angelegt.
- [x] Erst ein signierter Stripe-Webhook mit bestätigter Zahlung schaltet den Space auf `active`.
- [x] Kostenlose Selbstanlage ist im Produktivmodus gesperrt.
- [x] Sichere Zahlungs-Erfolgsseite ist vorbereitet.
- [ ] Stripe-Testkonto, Test-Schlüssel und Webhook testen.
- [ ] Transaktionale Bestätigungs-E-Mail implementieren und prüfen.
- [ ] Erst danach produktiv ausrollen.

## 3. Was du jetzt selbst erledigen musst

Diese Aufgaben benötigen einen Menschen, weil sie Konten, Verträge, Identitätsprüfung, DNS oder Rechtsentscheidungen betreffen. **Keine Zugangsdaten, Secrets oder API-Schlüssel in den Chat schreiben.**

### A. Stripe-Testkonto anlegen — als Nächstes erforderlich

**Ziel:** Den vollständigen Buchungsablauf mit Stripe-Testzahlung testen, ohne echtes Geld einzuziehen.

1. Gehe zu Stripe und erstelle ein Konto für dein Einzelunternehmen.
2. Hinterlege deine echten Unternehmens- und Kontaktdaten.
3. Wähle die Kleinunternehmerregelung gemäß § 19 UStG, sofern Stripe danach fragt.
4. Öffne im Stripe-Dashboard den **Testmodus**.
5. Öffne **Entwickler → API-Schlüssel**. Den Test-Secret-Key brauchst du später direkt im Server-Terminal. Nicht hier senden.
6. Prüfe, dass du im Bereich **Entwickler → Webhooks** später einen Endpoint für diese URL anlegen kannst:
   - `https://ourbigday.space/api/stripe/webhook`
7. Noch keinen Webhook anlegen, bevor ich die getestete Zahlungsfunktion auf dem Server bereitgestellt habe.

**Danach hier schreiben:** `Stripe-Testkonto fertig`.

Dann übernehme ich:

- Deployment der getesteten Zahlungsfunktion,
- sichere Eingabe der Stripe-Geheimnisse direkt im Server-Terminal,
- Einrichten des Stripe-Test-Webhooks,
- Testbuchung mit Stripe-Testkarte,
- Prüfung, dass ein Space erst nach Webhook-Bestätigung aktiv wird,
- Prüfung, dass keine Zahlung doppelt verarbeitet werden kann.

### B. Resend-Konto für Kunden-E-Mails anlegen

**Entscheidung:** Wir verwenden **Resend** für die erste transaktionale E-Mail-Stufe. Der Dienst ist API-basiert, gut für kleine Teams und für Buchungs- sowie Erinnerungsmails geeignet.

1. Erstelle ein Resend-Konto.
2. Füge die Domain `ourbigday.space` als Versanddomain hinzu.
3. Resend zeigt DNS-Einträge für SPF und DKIM an.
4. Trage diese DNS-Einträge beim Domain-DNS-Provider ein.
5. Warte, bis Resend die Domain als verifiziert zeigt.
6. Lege eine erreichbare Absenderadresse fest, zum Beispiel `hallo@ourbigday.space` oder `support@ourbigday.space`.
7. Lege eine Weiterleitung dieser Adresse auf deine persönliche Support-Adresse an oder richte ein Postfach ein.
8. Den späteren Resend-API-Key ausschließlich direkt im Server-Terminal eingeben; nicht in Chat, Git oder Dokumentation einfügen.

**Danach hier schreiben:** `Resend-Domain verifiziert; Absender: <deine-Adresse>`.

Dann übernehme ich:

- Bestätigungsmail nach erfolgreicher Zahlung,
- Versand von Gastlink, QR-Code und Brautpaar-Zugang,
- sichere Passwort-/Zugangs-Wiederherstellung,
- Erinnerungen vor Ablauf und Löschung,
- Testversand an deine Adresse,
- Anpassung der Datenschutzerklärung um den tatsächlichen Mail-Dienst.

### C. Rechts- und Steuerprüfung beauftragen

**Ziel:** Öffentlicher Verkauf ohne vermeidbares rechtliches Risiko.

Bitte beauftrage eine fachkundige Stelle (Steuerberater und/oder Fachanwalt für IT-/Medienrecht) für diese konkreten Fragen:

1. Prüfen, ob die Kleinunternehmerregelung und die Rechnungsangaben korrekt umgesetzt werden.
2. Prüfen, welche Rechnungsnummern, Aufbewahrungspflichten und Zahlungsbelege erforderlich sind.
3. AGB prüfen lassen, besonders:
   - Bildrechte der hochladenden Gäste,
   - Rechte des Brautpaares,
   - Haftung bei Verlust oder Serviceausfall,
   - unzulässige Inhalte,
   - Vertragsschluss und Widerrufsrecht bei digitaler Leistung.
4. Datenschutzerklärung prüfen lassen, besonders:
   - Fotos von Gästen als personenbezogene Daten,
   - IP-Adressen und Gerätekennungen,
   - Hetzner Cloud Backups,
   - künftiger Resend-Versand,
   - konkrete Speicher- und Löschfristen.
5. Festlegen, ob die geplanten Speicherfristen verbindlich lauten sollen:
   - Basic: 6 Monate,
   - Premium: 12 Monate,
   - automatische Löschung nach Ende der gebuchten Laufzeit oder eine Nachfrist.

**Danach hier schreiben:** `Rechtsprüfung beauftragt` oder die verbindlich festgelegten Speicher-/Löschfristen.

### D. Recovery-Drill bei Hetzner durchführen

**Ziel:** Nachweisen, dass Kundendaten tatsächlich aus einem Hetzner-Backup wiederherstellbar sind.

1. In der Hetzner Cloud Console vom vorhandenen Backup einen **separaten temporären Testserver** erstellen.
2. Diesen Testserver nicht mit der Produktions-IP und nicht mit `ourbigday.space` verbinden.
3. Nach dem Start auf dem Testserver prüfen:
   - App läuft,
   - `/api/health` ist erfolgreich,
   - mindestens ein bestehender Space öffnet sich,
   - ein repräsentatives Bild ist sichtbar und herunterladbar,
   - Datenbank und `storage/` vorhanden sind.
4. Testserver danach wieder löschen, damit keine laufenden Kosten entstehen.
5. Datum, verwendetes Backup und Ergebnis notieren.

**Danach hier schreiben:** `Hetzner-Recovery-Drill erfolgreich` oder den Fehlertext.

Dann dokumentiere ich das Ergebnis als verifizierten Wiederherstellungsprozess.

## 4. Was ich danach autonom erledige

Sobald Stripe und Resend bereitstehen, arbeite ich diese Reihenfolge ohne weitere Produktentscheidungen ab:

1. Stripe-Testzahlung und signierten Webhook vollständig testen.
2. Bestätigungs-E-Mails plus Zugangs-Wiederherstellung implementieren.
3. Ablaufdatum und verbindlichen Lösch-/Reminder-Prozess implementieren.
4. Rechtlich geprüfte Texte und tatsächliche Dienstleisterangaben einarbeiten.
5. Zahlungs- und Mailflow auf Produktion ausrollen.
6. Produktions-Health, HTTPS und Rückabwicklung testen.
7. Pilotprozess für 5–10 echte Kunden erstellen.
8. Erst nach erfolgreichen Pilotbuchungen die Landingpage und Akquise auf Verkauf schalten.

## 5. Pilot und erste Umsätze

Nach technischem Go-live nicht direkt Geld in Werbung stecken.

1. Suche 5–10 Paare aus Freundeskreis, Empfehlungen, Hochzeitsplanern oder Fotografen.
2. Verkaufe den Pilot bewusst als begrenzte Beta mit klar kommuniziertem Rabatt.
3. Jede Buchung muss diesen Ablauf erfolgreich durchlaufen:
   - Landingpage versteht sich ohne Erklärung,
   - Tarif wird gewählt,
   - Zahlung klappt,
   - Bestätigungsmail kommt an,
   - Gastlink/QR funktionieren auf iPhone und Android,
   - ZIP-Export funktioniert,
   - Brautpaar versteht Ablauf und Speicherfrist.
4. Erfrage nach jeder Hochzeit aktiv Feedback und eine veröffentlichbare Bewertung.
5. Erst wenn mindestens 5 reale Buchungen ohne kritischen Supportfehler durchlaufen, beginne mit:
   - Partnern (Fotografen, Hochzeitsplaner, Locations),
   - organischem Instagram/Pinterest/SEO,
   - später kleinem, messbarem Werbebudget.

## 6. Klare Go/No-Go-Regel

### No-Go: Noch nicht bewerben

Nicht werben, solange mindestens einer dieser Punkte offen ist:

- Stripe-Livezahlung und signierter Webhook nicht getestet,
- Bestätigungs-E-Mail nicht zuverlässig zugestellt,
- verbindliche Speicher-/Löschfrist nicht umgesetzt,
- Recovery-Drill nicht erfolgreich,
- Rechtstexte und steuerlicher Prozess nicht geprüft.

### Go: Kontrollierter Pilot erlaubt

Pilotbuchungen sind erlaubt, wenn alle Punkte oben erfüllt sind und ausdrücklich als begrenzter Pilot begleitet werden.

### Go: Öffentliche Vermarktung erlaubt

Öffentliche Vermarktung startet erst nach erfolgreichem Pilot mit mindestens fünf echten Buchungen und ohne kritische Daten-, Zahlungs- oder E-Mail-Probleme.
