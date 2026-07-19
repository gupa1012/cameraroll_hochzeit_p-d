# Wedding Camera Roll — Commercialization Guidelines

## Objective

Autonomously turn Wedding Camera Roll into a reliable, profitable German wedding-photo service. Prioritize completed paid bookings, customer trust, and protection of irreplaceable customer photos over speculative features.

## Autonomous Delivery

- Make sensible, reversible product and technical decisions without waiting for approval when they improve conversion, reliability, security, or operations.
- Implement and validate the next highest-impact launch blocker after examining the current code and production state.
- Preserve the existing multi-space security model: secret guest URLs, separate per-space admin sessions, separate operator sessions, and no public space directory.
- Keep customer upload originals unchanged; derived previews must never replace originals.
- Do not enable paid marketing or describe the service as purchasable until checkout, payment-webhook verification, customer confirmation email, retention policy, and restore verification are complete.

## Required Human Input

Ask the owner only when a task requires information or authority an agent cannot safely create:

- legal review, statutory business/tax information, or binding policy decisions;
- opening/verifying third-party accounts or accepting contracts;
- API keys, passwords, payment credentials, email-domain DNS changes, or other secrets (the owner must enter secrets directly into a terminal or provider dashboard, never chat);
- irreversible production actions affecting customer data, billing, or public DNS.

For everything else, implement, test, deploy safely, and report the outcome.

## Launch Priorities

1. Verified Hetzner backup recovery drill.
2. Stripe Checkout with signed webhooks: create a paid Basic or Premium space only after `checkout.session.completed` has been verified server-side.
3. Transactional email: paid confirmation with guest link, admin access, QR code, invoice/receipt path, and retention reminders.
4. Enforce published plan limits and an explicit retention/deletion lifecycle.
5. Legal review of AGB, privacy policy, and billing/tax requirements.
6. Pilot with 5–10 paying or discounted real customers before paid acquisition.

## Current Product Decisions

- Target market: Germany, direct-to-couple wedding service.
- Legal form for the initial launch: Einzelunternehmen using the Kleinunternehmerregelung (§ 19 UStG).
- Commercial plans: Basic — 39 € once, 20 GiB, 6 months; Premium — 69 € once, 100 GiB, 12 months.
- Primary production backup: Hetzner Cloud Backups. The legacy same-disk systemd backup timer is disabled; an optional rclone second backup remains inactive until an independent remote is configured.
- Production domain: `ourbigday.space`.

## Build and Validation

- Run `npm test` before reporting code work complete. The command runs tests serially to avoid flaky Windows integration-test process timing.
- Validate health after production deployment using `/api/health` and externally through HTTPS.
- Keep operational documentation current in `docs/ops.md`; avoid exposing secrets in documentation, chat, logs, or commits.
