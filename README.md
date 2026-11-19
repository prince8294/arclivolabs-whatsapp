# ArclivoLabs CRM

A lightweight Next.js foundation for an ArclivoLabs WhatsApp CRM dashboard.

## Getting started

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and configure `MONGODB_URI`, `REDIS_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a random `AUTH_SECRET` (at least 32 characters).
3. Run `npm run dev`, then sign in at `/login` to manage categories and create campaigns.
4. Run `npm run worker` in a separate terminal. Campaign sending and recovery require this persistent worker and a reachable Redis instance.

Category, contact, template, campaign, and WhatsApp admin APIs require the server-side admin session; admin credentials, Meta credentials, and session/encryption secrets must never be exposed using `NEXT_PUBLIC_` variables.

The authenticated Contacts page is available at `/dashboard/contacts` (the earlier `/contacts` path redirects there). Contact numbers are validated and stored in E.164 format, and new marketing consent defaults to Unknown. CSV import accepts files up to 1.5 MB / 5,000 rows, requires column and category review, and writes in batches of 200. Existing opt-outs are preserved; imported consent evidence is recorded in the consent history.

The authenticated Inbox is available at `/dashboard/inbox`. It displays messages actually stored by the webhook or campaign sender; Meta does not provide unrestricted historical chat retrieval. Admins can send free-form manual replies only within 24 hours of the latest customer message, or explicitly select an approved template outside that window. Incoming messages are deduplicated and internally marked read when a conversation is opened; internal read state is separate from Meta delivery receipts.

Brand Leads is available at `/dashboard/leads`. Lead status is shared with the Inbox conversation, and follow-up dates and notes are internal reminders only. Removing a lead archives it from the active Leads list without deleting its contact, conversation, or message history. Lead CSV exports include only active records visible to the authenticated workspace and escape spreadsheet formula prefixes.

## Analytics and campaign reports

Authenticated reporting is available at `/dashboard/analytics`, with per-campaign results at `/dashboard/analytics/campaigns/<campaign-id>`. Date filters use UTC calendar days and select campaigns by creation date; status figures show each recipient's latest stored status, not status transitions during that date range. “Sent” includes sent, delivered, and read recipients; “Delivered” includes delivered and read. API acceptance is reported separately from confirmed sending.

Incoming replies are attributed only if stored WhatsApp message data explicitly links them to a campaign (and recipient for recipient/category-level attribution). Unlinked conversations are not assumed to be campaign replies. Lead totals count unique campaign contacts whose conversation is currently marked Interested. Per-campaign interested-lead rate uses unique interested responders divided by explicitly attributed unique responders. CSV exports are admin-authorized, include applied filters, and escape spreadsheet formula prefixes. Messaging cost remains unavailable unless reliable pricing and billing data are configured.

## Meta WhatsApp Cloud API

Open **Settings → WhatsApp Integration** at `/dashboard/settings/whatsapp`. Configure a WABA ID, Phone Number ID, Meta access token, App Secret, webhook verify token, and a currently supported Graph API version. The Connect flow makes server-side Graph API requests to verify account access and confirm that the phone number belongs to the selected WABA before recording a Connected status.

Credentials entered in the UI are encrypted with AES-256-GCM in MongoDB. Configure `META_CREDENTIALS_ENCRYPTION_KEY` as base64 encoding of exactly 32 random bytes; for example, generate it locally with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Back up this key securely. Changing or losing it makes previously stored Meta credentials unreadable; after setting a new key, enter all six configuration values in the settings form so the app can verify and re-encrypt them. Never commit `.env.local` or share Meta tokens. For production, prefer an appropriately authorized Meta System User access token over a short-lived developer token.

To rotate an expired or revoked token, obtain a replacement token with the required WhatsApp permissions in Meta, open **Update Credentials**, enter the new token (and any other values being rotated), then verify the connection. Secret inputs are write-only; blank values retain the currently stored secret. Rotate the App Secret and webhook verify token in Meta/settings as appropriate, then update and reconnect.

Configure Meta's webhook callback as `https://<your-public-host>/api/webhooks/whatsapp`, using the same verify token configured in the app. Subscribe the WhatsApp Business Account webhook to message and message-status events. The endpoint validates `X-Hub-Signature-256` against the raw request body, deduplicates events, stores incoming messages/statuses, and does not send automatic replies. Template and campaign sends are manual only. Campaign audience selection and sending require current documented promotional opt-in; opted-out, unknown-consent, suppressed, invalid, duplicate, or unmappable contacts are excluded and consent is checked again by the worker immediately before sending.

## Bulk messaging operations

The campaign queue uses BullMQ backed by Redis. Keep `npm run worker` running as a dedicated persistent process in every deployment that sends campaigns; do not rely on a short-lived serverless request to process a campaign. The worker and web application must use the same MongoDB and `REDIS_URL`. The queue applies bounded retries and pacing, and ambiguous network/timeout outcomes are marked uncertain rather than blindly resent. Delivery, read, and failure counts are updated from Meta webhook statuses, not inferred from an API acceptance response.

`REDIS_URL` must be the connection URL itself (`rediss://...` for Upstash), not the `redis-cli --tls -u ...` command shown beside it in the Upstash console. The application recognizes that common paste error, validates the extracted URL, and forces TLS for Upstash hosts. Configure the Redis database with a `noeviction` max-memory policy as required by BullMQ.

The web app now refuses to start a campaign unless Redis responds and a worker heartbeat is current. It writes recipient and template snapshots before enqueuing deterministic per-recipient job IDs, so Redis recovery cannot recreate a different audience or duplicate an accepted message. Active campaign details show Redis/worker health and durable queue diagnostics.

The Bulk Messaging page also supports reviewed personalized CSV campaigns. Required contact columns are detected and can be remapped; optional columns support exact per-row messages, an approved template name, up to three template variables, and explicit consent evidence. Preview checks every row for number validity, duplicate recipients, category matching, consent, suppression, the 24-hour customer service window, and required template values. Category, city, and consent filters never replace row-level messages. The import is stored only after final confirmation, with custom text and rendered template snapshots kept on `CampaignRecipient` rather than the Contact profile.

Personalized CSV text is sent unchanged only while the recipient's customer service window remains open. If it is closed at preview or immediately before sending, the recipient is excluded as **Template Required**; the application does not silently substitute or manufacture a template. Approved-template mode sends only the selected template and maps CSV variable values into its declared placeholders. Existing opt-outs always win, documented consent history is appended rather than erased, and manually excluded rows never enter BullMQ.

An administrator must explicitly confirm **Start Campaign**. There is no scheduling or automatic sending. Before production use, test with a small audience whose promotional consent has been explicitly documented, verify the returned Meta message IDs and webhook statuses, and confirm pause/cancel and failure handling. Meta pricing is not configured by this application, so it does not calculate or invent campaign cost estimates.

## Project structure

- `app/` — App Router routes and API endpoints
- `components/layout/` — responsive application shell, sidebar, and header
- `components/dashboard/` — dashboard overview
- `components/ui/` — shared placeholder presentation
- `lib/db/` — server-side MongoDB connection utility
- `lib/models/` — Mongoose category, contact, and WhatsApp models
- `lib/contacts/` — phone/consent validation and chunked CSV import processing
- `lib/auth/` — signed server-side admin sessions
- `.env.example` — server-only environment configuration template

Never expose database credentials or future Meta API tokens through `NEXT_PUBLIC_` variables.

## Production deployment and recovery

The production hostname is intended to be `https://crm.arclivolabs.com`; DNS and hosting are not configured by this repository. Set `APP_BASE_URL` to that canonical HTTPS origin for operations and configure the Meta webhook URL as `${APP_BASE_URL}/api/webhooks/whatsapp`. Add `crm` as a custom domain with the chosen web host, create the DNS record that host specifies, wait for DNS propagation, and enable its managed TLS certificate before accepting Meta webhooks. Do not publish the webhook over HTTP.

Deploy the Next.js application to a Node-compatible host (Vercel is suitable for the web app) with the server-only values from `.env.example`. Provision MongoDB with TLS, a dedicated least-privilege application user, network allowlisting, and automated backups. Use a managed Redis deployment with authentication/TLS where supported. Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build` in CI before deployment.

Run `npm run worker` as a separate persistent Node process on infrastructure that supports long-running services. Give the worker the same `MONGODB_URI`, `REDIS_URL`, Meta credential configuration, and encryption key as the web app. Configure a restart policy and monitor process exit, Redis connectivity, and failed BullMQ jobs. The worker currently uses concurrency 1 and a one-message-per-second limiter and periodically reconciles queued work; do not scale additional workers without reviewing account-level Meta throughput and the shared limiter behavior.

Vercel should host only the Next.js web application. Deploy the included `Dockerfile.worker` as a separate always-on worker service (for example on Render, Railway, Fly.io, or another container host), with no public port. Its required secrets are `MONGODB_URI`, `REDIS_URL`, and `META_CREDENTIALS_ENCRYPTION_KEY`; also provide the `META_*` values if the worker must fall back to environment credentials. Use an automatic restart policy and deploy the worker before enabling campaign starts. `/api/health` reports only boolean database, Redis, and worker readiness and never returns credentials or connection URLs.

In Meta Business settings, authorize the system user for the WhatsApp Business Account and phone number with the required `whatsapp_business_management` and `whatsapp_business_messaging` permissions. Set a supported Graph API version and verify the WABA and phone number from **Settings → WhatsApp Integration**; a successful connection test requires real Meta credentials and cannot be simulated by this application. Subscribe the WABA to message and message-status webhook events at `https://crm.arclivolabs.com/api/webhooks/whatsapp`. Test using an authorized WhatsApp test contact before any production campaign.

Keep `ADMIN_PASSWORD`, `AUTH_SECRET`, `META_CREDENTIALS_ENCRYPTION_KEY`, database credentials, Redis credentials, and Meta secrets in the host's secret manager. Use a unique high-entropy admin password and a random 32-byte encryption key encoded in base64. The login/API rate limiter is process-local; in multi-instance or serverless deployments, configure an edge/WAF rate limit for `/api/auth/login` and sensitive write endpoints as well. A host-level limit is required for protection across instances.

Back up MongoDB using the provider's encrypted point-in-time/snapshot facility and periodically verify restore into a separate database. A portable logical backup can be made with `mongodump --uri="$MONGODB_URI" --archive=arclivolabs.archive.gz --gzip`; store the archive outside the application host with restricted access. For recovery, restore into a new database first, validate categories, contacts, campaign recipients, message records, and indexes, then update the deployment connection string during a planned maintenance window. Preserve the matching `META_CREDENTIALS_ENCRYPTION_KEY`; without it, encrypted stored Meta credentials cannot be recovered and must be entered and verified again. Back up Redis only as an operational convenience—MongoDB is the durable campaign source of truth and the worker reconciles queued work after restart.

Before going live, run the checks above and perform a small, explicitly confirmed campaign only with documented opt-in. The repository does not include automated MongoDB/Redis/Meta end-to-end tests, and live Meta verification, DNS, TLS, backups, and hosting remain deployment-owner checks; do not treat them as passed until actually performed.
