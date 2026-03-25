# Send Again

Open source email campaign platform. Compose HTML emails, manage contacts, send via Amazon SES, and track delivery — from the dashboard or programmatically via the REST API.

**Cloud version** — [send-again.com](https://send-again.com) — 1,000 free credits, no setup required.

## Features

- **REST API** — send emails, manage contacts, and query delivery status programmatically
- **AI Compose** — describe what you want, get HTML email generated for you
- **HTML Preview** — live preview as you write
- **Campaigns** — organize sends into campaigns with per-campaign analytics
- **Event Tracking** — opens, clicks, bounces, complaints via SNS webhooks
- **Contact Management** — CSV and API import, automatic unsubscribe/bounce handling
- **Automatic DNS Setup** — Namecheap, Cloudflare, and Route53 integration for SPF/DKIM
- **High Deliverability** — powered by Amazon SES with domain verification built in
- **Billing** — optional credit-based billing via Polar (pay-as-you-go packs)
- **API Keys** — scoped API keys (`contacts.read`, `contacts.write`, `send.read`, `send.write`)

## Cloud vs Self-Hosted

| | Cloud ([send-again.com](https://send-again.com)) | Self-Hosted |
|---|---|---|
| Setup | None — sign up and go | You manage infra |
| SES | Managed | Bring your own AWS account |
| Billing | 1,000 free credits, then credit packs | No limits (or configure your own) |
| Updates | Automatic | Pull from GitHub |

## Self-Hosting

### Prerequisites

- Node.js 20+
- A Supabase project
- An AWS account with SES configured (verified domain + configuration set with SNS)

### Install

```bash
git clone https://github.com/guillaumegay13/send-again.git
cd send-again
npm install
```

### Environment variables

Create a `.env.local` file:

```env
# Required
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=eu-west-3
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key

# Recommended
APP_BASE_URL=https://your-domain.com
UNSUBSCRIBE_SECRET=replace-with-random-secret
INITIAL_OWNER_EMAIL=you@example.com

# Optional — AI compose
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini

# Optional — DNS automation
NAMECHEAP_API_USER=your-api-user
NAMECHEAP_USERNAME=your-username
NAMECHEAP_API_KEY=your-api-key
NAMECHEAP_CLIENT_IP=your-whitelisted-ipv4
CLOUDFLARE_API_TOKEN=your-cloudflare-token
CLOUDFLARE_ZONE_ID=optional-zone-id
ROUTE53_HOSTED_ZONE_ID=optional-hosted-zone-id

# Optional — Send job worker
SEND_JOB_PROCESSOR_TOKEN=optional-worker-token
SEND_JOB_BATCH_SIZE=50
SEND_JOB_CONCURRENCY=4
SEND_JOB_MAX_RECIPIENTS_PER_JOB=250

# Optional — Billing (Polar)
BILLING_ENFORCED=false
FREE_TIER_INITIAL_CREDITS=1000
POLAR_ACCESS_TOKEN=your-polar-token
POLAR_SERVER=sandbox
POLAR_CREDIT_PACKS_JSON=[{"id":"topup_10","name":"$10 Top-up","productId":"your-product-id","credits":10000,"amountCents":1000,"currency":"usd"}]
POLAR_WEBHOOK_SECRET=your-webhook-secret
```

See the full [environment variable reference](#environment-variable-reference) below.

### Database

The app uses Supabase Postgres. Run the schema in Supabase SQL Editor:

```sql
-- paste and run supabase/schema.sql
```

Then create your user in Supabase Authentication (Email provider):

1. Go to Authentication > Users
2. Create a user with your email and password
3. Sign in at your app URL

### Run

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

## API

- Developer docs UI: `/docs`
- OpenAPI spec: `/api/openapi.json`

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/send` | Enqueue a send job (or dry-run count) |
| `GET` | `/api/send/status?jobId=<id>` | Live job progress |
| `GET` | `/api/send/jobs?workspace=<id>` | List send jobs |
| `POST` | `/api/send/process` | Worker endpoint for send job processing |
| `GET/POST` | `/api/campaigns/process` | Worker endpoint for campaign progression and send job processing |
| `GET/POST/DELETE` | `/api/contacts` | List, import, or explicitly delete contacts |
| `GET/DELETE` | `/api/contacts/[email]` | Get or delete a contact |
| `GET/POST/DELETE` | `/api/keys` | Manage API keys |

### Authentication

- **Supabase JWT** — works on all endpoints
- **API key** (`sk_...`) — works on `/api/contacts`, `/api/send`, `/api/send/status`, `/api/send/jobs`

### Billing endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/billing/status?workspace=<id>` | Credit balance and billing state |
| `GET` | `/api/billing/packs?workspace=<id>` | Available top-up packs |
| `POST` | `/api/billing/checkout` | Create a Polar checkout session |
| `POST` | `/api/billing/portal` | Create a Polar customer portal session |

## SNS Webhook Setup

To receive delivery/open/click/bounce/complaint events:

1. Create an SNS topic in AWS
2. Configure your SES Configuration Set to publish events to that topic
3. Add an HTTPS subscription pointing to `https://your-domain/api/webhooks/sns`

## Production Recommendations

- On Vercel, use Vercel Cron to call `GET /api/campaigns/process` every minute
- For non-Vercel workers, call `POST /api/campaigns/process` or `POST /api/send/process`
- Set `CRON_SECRET` for Vercel Cron auth
- Set `SEND_JOB_PROCESSOR_TOKEN` and pass it via `x-send-job-token` or `Authorization: Bearer ...` for external workers
- Keep the inline fallback enabled unless you have a reliable external worker

## Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS IAM access key with SES permissions |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS IAM secret key |
| `AWS_REGION` | No | `eu-west-3` | AWS region for SES |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | — | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Yes | — | Supabase server secret key |
| `APP_BASE_URL` | No | request origin | Public base URL for unsubscribe links |
| `UNSUBSCRIBE_SECRET` | No | `SUPABASE_SECRET_KEY` | Secret for signing unsubscribe links |
| `OPENAI_API_KEY` | No | — | Enables AI email generation |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | Model for AI generation |
| `INITIAL_OWNER_EMAIL` | No | — | Bootstrap owner account |
| `ALLOWED_AUTH_EMAILS` | No | `INITIAL_OWNER_EMAIL` | Comma-separated login allowlist |
| `NAMECHEAP_API_USER` | No | — | Namecheap API user for DNS automation |
| `NAMECHEAP_USERNAME` | No | — | Namecheap username |
| `NAMECHEAP_API_KEY` | No | — | Namecheap API key |
| `NAMECHEAP_CLIENT_IP` | No | — | Whitelisted IPv4 for Namecheap API |
| `NAMECHEAP_SANDBOX` | No | `false` | Use Namecheap sandbox API |
| `CLOUDFLARE_API_TOKEN` | No | — | Cloudflare token for DNS automation |
| `CLOUDFLARE_ZONE_ID` | No | — | Cloudflare Zone ID (auto-detected if omitted) |
| `ROUTE53_HOSTED_ZONE_ID` | No | — | Route53 hosted zone (auto-detected if omitted) |
| `SEND_JOB_BATCH_SIZE` | No | `50` | Recipients per batch |
| `SEND_JOB_CONCURRENCY` | No | `4` | Parallel sends per batch |
| `SEND_JOB_MAX_RECIPIENTS_PER_JOB` | No | `250` | Max recipients per processor invocation |
| `SEND_JOB_MAX_JOBS` | No | `1` | Max jobs per invocation |
| `SEND_JOB_STALE_MS` | No | `180000` | Reclaim stale jobs after this delay |
| `SEND_JOB_STALE_RECIPIENT_MS` | No | `180000` | Retry stale recipients after this delay |
| `CRON_SECRET` | No | — | Shared secret used by Vercel Cron via `Authorization: Bearer ...` for `GET /api/campaigns/process` |
| `SEND_JOB_PROCESSOR_TOKEN` | No | — | Shared secret for manual/background `POST` calls to the processor endpoints |
| `SEND_JOB_AFTER_MAX_ITERATIONS` | No | `20` | Max processing loops via `after()` |
| `SEND_JOB_STATUS_INLINE_PROCESS` | No | `true` | Let status endpoint process jobs inline |
| `SEND_JOB_STATUS_INLINE_MAX_JOBS` | No | `3` | Max jobs per inline status poll |
| `SEND_JOB_STATUS_INLINE_MAX_RECIPIENTS` | No | `50` | Max recipients per inline status poll |
| `BILLING_ENFORCED` | No | `false` | Enforce credit checks on send |
| `FREE_TIER_INITIAL_CREDITS` | No | `1000` | Free credits on workspace creation |
| `BILLING_UNLIMITED_AUTH_EMAILS` | No | — | Emails that bypass credit enforcement |
| `BILLING_UNLIMITED_USER_IDS` | No | — | User IDs that bypass credit enforcement |
| `POLAR_ACCESS_TOKEN` | No | — | Polar organization token |
| `POLAR_SERVER` | No | `sandbox` | Polar environment (`sandbox`/`production`) |
| `POLAR_CREDIT_PACKS_JSON` | No | — | JSON array of top-up pack definitions |
| `POLAR_PRODUCT_ID` | No | — | Fallback product ID |
| `POLAR_DEFAULT_PACK_CREDITS` | No | `10000` | Fallback pack credits |
| `POLAR_DEFAULT_PACK_AMOUNT_CENTS` | No | `1000` | Fallback pack price (cents) |
| `POLAR_DEFAULT_PACK_CURRENCY` | No | `usd` | Fallback pack currency |
| `POLAR_WEBHOOK_SECRET` | No | — | Polar webhook signature secret |
| `POLAR_CREDIT_METADATA_KEY` | No | `email_credits` | Product metadata key for credit resolution |

## License

MIT
