# Send Again

Email campaign tool built with Next.js and Amazon SES. Manage contacts, send HTML emails with template variables, and track deliveries/opens/clicks/bounces via SNS webhooks.

## Setup

### Prerequisites

- Node.js 20+
- An AWS account with SES configured (verified domain)
- An SES Configuration Set with SNS notifications enabled (for tracking events)

### Install

```bash
npm install
```

### Environment variables

Create a `.env.local` file at the project root:

```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=eu-west-3
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
APP_BASE_URL=https://your-app-domain.com
UNSUBSCRIBE_SECRET=replace-with-random-secret
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
INITIAL_OWNER_EMAIL=guillaume.gay@protonmail.com
SEND_JOB_PROCESSOR_TOKEN=optional-worker-token
SEND_JOB_BATCH_SIZE=50
SEND_JOB_CONCURRENCY=4
SEND_JOB_MAX_RECIPIENTS_PER_JOB=250
NAMECHEAP_API_USER=your-namecheap-api-user
NAMECHEAP_USERNAME=your-namecheap-username
NAMECHEAP_API_KEY=your-namecheap-api-key
NAMECHEAP_CLIENT_IP=your-whitelisted-public-ipv4
NAMECHEAP_SANDBOX=false
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
CLOUDFLARE_ZONE_ID=optional-cloudflare-zone-id
ROUTE53_HOSTED_ZONE_ID=optional-route53-hosted-zone-id
BILLING_ENFORCED=false
FREE_TIER_INITIAL_CREDITS=1000
POLAR_ACCESS_TOKEN=your-polar-organization-access-token
POLAR_SERVER=sandbox
POLAR_CREDIT_PACKS_JSON=[{"id":"topup_10","name":"$10 Top-up","productId":"your-polar-product-id","credits":10000,"amountCents":1000,"currency":"usd"}]
POLAR_PRODUCT_ID=optional-fallback-product-id
POLAR_DEFAULT_PACK_CREDITS=10000
POLAR_DEFAULT_PACK_AMOUNT_CENTS=1000
POLAR_DEFAULT_PACK_CURRENCY=usd
POLAR_WEBHOOK_SECRET=your-polar-webhook-secret
POLAR_CREDIT_METADATA_KEY=email_credits
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS IAM access key with SES permissions |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS IAM secret key |
| `AWS_REGION` | No | `eu-west-3` | AWS region where SES is configured |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | — | Supabase publishable key used for email/password login |
| `SUPABASE_SECRET_KEY` | Yes | — | Supabase server secret key used by API routes |
| `APP_BASE_URL` | No | request origin | Public base URL used in unsubscribe links (set this in production) |
| `UNSUBSCRIBE_SECRET` | No | `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` | Secret used to sign unsubscribe links |
| `OPENAI_API_KEY` | No | — | Enables vibe generation for body/footer HTML |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | Model used for vibe generation |
| `INITIAL_OWNER_EMAIL` | No | `guillaume.gay@protonmail.com` | Bootstrap owner account that is allowed and auto-linked to existing workspaces |
| `ALLOWED_AUTH_EMAILS` | No | `INITIAL_OWNER_EMAIL` | Comma-separated allowlist for login access |
| `NAMECHEAP_API_USER` | No | — | Optional fallback for DNS automation in Settings > Email Deliverability Setup |
| `NAMECHEAP_USERNAME` | No | — | Optional fallback for DNS automation in Settings > Email Deliverability Setup |
| `NAMECHEAP_API_KEY` | No | — | Optional fallback for DNS automation in Settings > Email Deliverability Setup |
| `NAMECHEAP_CLIENT_IP` | No | — | Optional fallback IPv4 (must be whitelisted in Namecheap API access) |
| `NAMECHEAP_SANDBOX` | No | `false` | Optional fallback to target Namecheap sandbox API (`true`/`false`) |
| `CLOUDFLARE_API_TOKEN` | No | — | Optional fallback Cloudflare token for DNS automation in Settings > Email Deliverability Setup |
| `CLOUDFLARE_ZONE_ID` | No | — | Optional fallback Cloudflare Zone ID (if omitted, zone is auto-detected) |
| `ROUTE53_HOSTED_ZONE_ID` | No | — | Optional fallback Route53 hosted zone id (if omitted, best zone match is auto-detected) |
| `SEND_JOB_BATCH_SIZE` | No | `50` | Number of recipients to fetch from queue per batch |
| `SEND_JOB_CONCURRENCY` | No | `4` | Parallel sends per batch in the worker |
| `SEND_JOB_MAX_RECIPIENTS_PER_JOB` | No | `250` | Max recipients processed per processor invocation |
| `SEND_JOB_MAX_JOBS` | No | `1` | Max number of jobs processed per invocation |
| `SEND_JOB_STALE_MS` | No | `180000` | Reclaim queued/running jobs after this heartbeat delay |
| `SEND_JOB_STALE_RECIPIENT_MS` | No | `180000` | Retry `sending` recipients after this delay |
| `SEND_JOB_PROCESSOR_TOKEN` | No | — | Optional shared secret required by `/api/send/process` |
| `SEND_JOB_AFTER_MAX_ITERATIONS` | No | `20` | Max `processSendJobs()` loops scheduled via Next.js `after()` after enqueue |
| `SEND_JOB_STATUS_INLINE_PROCESS` | No | `true` | Let `GET /api/send/status` process active jobs inline (fallback when no cron worker runs) |
| `SEND_JOB_STATUS_INLINE_MAX_JOBS` | No | `3` | Max jobs processed per status poll when inline fallback is enabled |
| `SEND_JOB_STATUS_INLINE_MAX_RECIPIENTS` | No | `50` | Max recipients processed per status poll when inline fallback is enabled |
| `BILLING_ENFORCED` | No | `false` | Enforce credit checks in the send worker (`true`/`false`) |
| `FREE_TIER_INITIAL_CREDITS` | No | `1000` | One-time free credits granted to a workspace when billing profile is created |
| `POLAR_ACCESS_TOKEN` | No | — | Polar organization access token (required for checkout, portal, and webhook sync) |
| `POLAR_SERVER` | No | `sandbox` | Polar environment (`sandbox` or `production`) |
| `POLAR_CREDIT_PACKS_JSON` | No | — | JSON array of top-up packs (`id`, `name`, `productId`, `credits`, `amountCents`, `currency`) exposed to checkout |
| `POLAR_PRODUCT_ID` | No | — | Optional fallback product ID if `POLAR_CREDIT_PACKS_JSON` is not set |
| `POLAR_DEFAULT_PACK_CREDITS` | No | `10000` | Optional fallback credits for the fallback `POLAR_PRODUCT_ID` |
| `POLAR_DEFAULT_PACK_AMOUNT_CENTS` | No | `1000` | Optional fallback fixed price (in cents) for the fallback `POLAR_PRODUCT_ID` |
| `POLAR_DEFAULT_PACK_CURRENCY` | No | `usd` | Optional fallback currency for the fallback `POLAR_PRODUCT_ID` |
| `POLAR_WEBHOOK_SECRET` | No | — | Secret used to verify `/api/webhooks/polar` signatures |
| `POLAR_CREDIT_METADATA_KEY` | No | `email_credits` | Product metadata key used as fallback to resolve credits on `order.paid` |

### Database

The app uses Supabase Postgres.

Run the schema once in Supabase SQL Editor:

```sql
-- paste and run:
-- supabase/schema.sql
```

Then create your user in Supabase Authentication (Email provider enabled):

1. Go to Authentication > Users in Supabase.
2. Create user `guillaume.gay@protonmail.com` with a password.
3. Sign in from the app with that email/password.

### Async Send API

- `POST /api/send` → enqueue send job (or dry-run count).
- `GET /api/send/status?jobId=<id>` → live job progress/status.
- `GET /api/send/jobs?workspace=<id>&status=queued,running` → list send jobs.
- `POST /api/send/process` → worker endpoint to process queued/running jobs.
- `GET /api/send/status` also runs an inline processing fallback for queued/running jobs by default.
- `POST /api/send` schedules post-response processing via Next.js `after()`.
- Auth:
  - Supabase JWT works on all API endpoints.
  - API key (`sk_...`) works on `/api/contacts`, `POST /api/send`, `GET /api/send/status`, and `GET /api/send/jobs`.
  - API key scopes: `contacts.read`, `contacts.write`, `send.read`, `send.write`.
  - Existing keys keep full access by default (backward compatible).
- `POST /api/send/process` uses `SEND_JOB_PROCESSOR_TOKEN` (if configured), not workspace API keys.
- If billing is enforced and credits are insufficient, `POST /api/send` returns `402` with billing details.

### Polar Billing API

- `GET /api/billing/packs?workspace=<id>` → list available top-up packs for the workspace.
- `POST /api/billing/checkout` → create a Polar checkout session for a selected top-up pack (workspace owner only).
- `POST /api/billing/portal` → create a Polar customer portal session (workspace owner only).
- `GET /api/billing/status?workspace=<id>` → current billing state + credit balance.
- `POST /api/webhooks/polar` → Polar webhook endpoint.

Polar access token scopes required:

- `checkouts:write`
- `customer_sessions:write`
- `customers:read`
- `customers:write`

Production recommendation:

- Use a cron or worker to call `POST /api/send/process` every minute.
- Keep `SEND_JOB_PROCESSOR_TOKEN` set and pass it in `x-send-job-token` or `Authorization: Bearer ...`.
- Keep inline fallback enabled unless you have a reliable external worker.

Polar setup checklist:

1. Create one-time Polar products for each top-up pack (for example `$10`, `$25`, `$50`).
2. Configure `POLAR_CREDIT_PACKS_JSON` with product IDs, credit amounts, and fixed prices (`amountCents`) for each top-up pack.
3. Optionally set product metadata key `email_credits` (or your `POLAR_CREDIT_METADATA_KEY`) as a fallback.
4. Set webhook URL to `https://your-domain/api/webhooks/polar` and subscribe at least:
   - `order.paid`
   - `subscription.created`
   - `subscription.updated`
   - `subscription.active`
   - `subscription.canceled`
   - `subscription.revoked`
   - `customer.state_changed`

### SNS Webhook (for event tracking)

To receive delivery/open/click/bounce/complaint/reject events:

1. Create an SNS topic in your AWS console
2. Configure your SES Configuration Set to publish events to that topic
3. Add an HTTPS subscription pointing to `https://your-domain/api/webhooks/sns`

Note: SES "Delivery" means the recipient mailbox provider accepted the message. Inbox vs spam-folder placement is not exposed as a dedicated SNS event.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Unsubscribe Suppression

- Run the latest `supabase/schema.sql` to create `contact_unsubscribes`.
- Unsubscribe links are persisted in `contact_unsubscribes` (workspace + email).
- Re-imports (CSV/manual/`POST /api/contacts`) automatically skip suppressed emails.
- Sends also enforce suppression, including already queued jobs.

## Production

```bash
npm run build
npm start
```
