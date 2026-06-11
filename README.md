# invoice-service-de

A standalone TypeScript microservice for generating **§14 UStG-compliant German invoices**, triggered by payment webhooks from Stripe and Mollie.

German tax logic lives here, not in your main application.

## Why this exists

German law (§14 UStG) requires every invoice to contain specific fields, use sequential gap-free invoice numbers, and be retained for 8 years. B2B invoices involving EU business customers require **ZUGFeRD/Factur-X** hybrid PDFs with embedded EN16931 XML.

This service handles all of that in one place, decoupled from your main app via a single internal webhook.

## Features

- **§14 UStG compliant** PDF invoices for B2C customers
- **ZUGFeRD / Factur-X-EN16931** hybrid PDF+XML for B2B (via [`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu))
- **Reverse charge** auto-applied for EU B2B customers with a VAT ID
- **Gap-free sequential invoice numbers** (`RE-YYYY-NNNN`), atomically assigned
- **Idempotent** — duplicate payment webhooks return the existing invoice (409)
- **Pluggable email**: Resend, Postmark, or SMTP
- **Pluggable storage**: local filesystem or any S3-compatible object store (AWS, Cloudflare R2, Minio)
- Single Docker container, ships with a `docker-compose.yml` for local development

## Architecture

```
main app
│
│  POST /invoices   (internal webhook, shared secret)
▼
invoice-service-de
├── validates + deduplicates on paymentId
├── assigns next RE-YYYY-NNNN (atomic, gap-free)
├── generates PDF via pdfkit
├── B2B: embeds ZUGFeRD XML → Factur-X-EN16931 hybrid
├── stores PDF (local volume or S3)
└── emails invoice to customer
```

## Quick start

```bash
cp .env.example .env
# fill in .env

docker compose up
```

The service runs on port `3001` (host) → `3000` (container). Postgres is included in the compose file.

Run migrations:

```bash
docker compose exec invoice-service npx prisma migrate deploy
```

## API

### `POST /invoices`

Trigger invoice generation after a successful payment.

**Auth:** `Authorization: Bearer <INVOICE_SERVICE_SECRET>`

**Request body:**

```json
{
  "paymentId": "pi_abc123",
  "paymentProvider": "stripe",
  "paidAt": "2026-06-10T14:32:00Z",
  "customer": {
    "name": "Max Mustermann",
    "email": "max@example.com",
    "address": {
      "street": "Musterstraße 1",
      "city": "Berlin",
      "zip": "10115",
      "country": "DE"
    },
    "vatId": "DE123456789",
    "type": "b2c"
  },
  "lineItems": [
    {
      "description": "AI Research Credits — 100 Credits",
      "quantity": 1,
      "unitPriceNet": 8.40,
      "vatRate": 19
    }
  ],
  "currency": "EUR",
  "amountGross": 10.00
}
```

| Field | Notes |
|---|---|
| `paymentProvider` | `"stripe"` or `"mollie"` |
| `paidAt` | ISO 8601 — used as Leistungsdatum |
| `customer.vatId` | Optional. Presence implies B2B; triggers ZUGFeRD + reverse charge for non-DE EU customers |
| `customer.type` | `"b2c"` or `"b2b"` — inferred from `vatId` if omitted |
| `lineItems[].vatRate` | `0`, `7`, or `19` — the main app decides the correct rate |
| `amountGross` | Sanity-checked against computed line item totals (±€0.02 tolerance) |

**Responses:**

| Status | Meaning |
|---|---|
| `201 Created` | `{ "invoiceNumber": "RE-2026-0042", "invoiceId": "uuid" }` |
| `409 Conflict` | Already processed — returns existing invoice + `"duplicate": true` |
| `400 Bad Request` | Validation error |
| `401 Unauthorized` | Missing or wrong secret |
| `500 Internal Server Error` | Generation or storage failed |

### `GET /invoices/:invoiceId`

Returns invoice metadata and a PDF download URL (signed S3 URL or local path).

### `GET /health`

Returns `200 OK` if the database is reachable, `503` otherwise.

## VAT logic

The service **validates** VAT rates but does not decide them — your main app passes the correct rate per line item.

| Customer | Expected vatRate |
|---|---|
| B2C, DE | `19` (standard) or `7` (reduced) |
| B2C, non-DE EU | Depends on OSS registration — pass from main app |
| B2C, non-EU | `0` |
| B2B, DE | `19` |
| B2B, EU with vatId, non-DE | `0` + reverse charge notice auto-added |
| B2B, non-EU | `0` |

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `INVOICE_SERVICE_SECRET` | ✓ | Shared secret for webhook auth (min 16 chars) |
| `SELLER_NAME` | ✓ | Your company name |
| `SELLER_ADDRESS_STREET` | ✓ | |
| `SELLER_ADDRESS_CITY` | ✓ | |
| `SELLER_ADDRESS_ZIP` | ✓ | |
| `SELLER_STEUERNUMMER` | * | German Steuernummer — at least one of this or `SELLER_VAT_ID` required |
| `SELLER_VAT_ID` | * | USt-IdNr (e.g. `DE123456789`) — required for cross-border EU B2B |
| `SELLER_LOGO_PATH` | | Path to logo image included in PDFs |
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `STORAGE_TYPE` | | `local` (default) or `s3` |
| `STORAGE_PATH` | | Directory for local PDF storage (default: `./invoices`) |
| `S3_BUCKET` | s3 | |
| `S3_ENDPOINT` | s3 | Leave empty for AWS; set for Minio/R2 |
| `S3_ACCESS_KEY` | s3 | |
| `S3_SECRET_KEY` | s3 | |
| `EMAIL_PROVIDER` | | `resend` (default), `postmark`, or `smtp` |
| `EMAIL_FROM` | ✓ | Sender address |
| `RESEND_API_KEY` | resend | |
| `POSTMARK_API_KEY` | postmark | |
| `SMTP_HOST` | smtp | |
| `SMTP_PORT` | smtp | Default: `587` |
| `SMTP_USER` | smtp | |
| `SMTP_PASS` | smtp | |
| `PORT` | | HTTP port (default: `3000`) |

## Stack

| | |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Fastify |
| Invoice generation | pdfkit (PDF) + [@e-invoice-eu/core](https://github.com/gflohr/e-invoice-eu) (ZUGFeRD/Factur-X) |
| ORM | Prisma + PostgreSQL |
| Validation | Zod |
| Email | Resend SDK / Postmark / Nodemailer (SMTP) |
| Storage | Local filesystem / AWS S3 / Cloudflare R2 / Minio |

## Out of scope (v1)

- XRechnung (pure XML) — ZUGFeRD covers B2B with a human-readable PDF
- PEPPOL delivery network
- Invoice correction / cancellation (Stornorechnung)
- Multi-currency (EUR only)
- Webhook retry queue (email failures are flagged, manual resend planned)
- Admin UI

## Legal notice

This software generates invoices intended to comply with §14 UStG. You are responsible for verifying compliance with applicable tax law for your specific situation. This is not legal or tax advice.
