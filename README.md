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
| `SEND_JOB_BATCH_SIZE` | No | `50` | Number of recipients to fetch from queue per batch |
| `SEND_JOB_CONCURRENCY` | No | `4` | Parallel sends per batch in the worker |
| `SEND_JOB_MAX_RECIPIENTS_PER_JOB` | No | `250` | Max recipients processed per processor invocation |
| `SEND_JOB_MAX_JOBS` | No | `1` | Max number of jobs processed per invocation |
| `SEND_JOB_STALE_MS` | No | `180000` | Reclaim queued/running jobs after this heartbeat delay |
| `SEND_JOB_STALE_RECIPIENT_MS` | No | `180000` | Retry `sending` recipients after this delay |
| `SEND_JOB_PROCESSOR_TOKEN` | No | — | Optional shared secret required by `/api/send/process` |
| `SEND_JOB_STATUS_INLINE_PROCESS` | No | `true` | Let `GET /api/send/status` process active jobs inline (fallback when no cron worker runs) |
| `SEND_JOB_STATUS_INLINE_MAX_JOBS` | No | `3` | Max jobs processed per status poll when inline fallback is enabled |
| `SEND_JOB_STATUS_INLINE_MAX_RECIPIENTS` | No | `50` | Max recipients processed per status poll when inline fallback is enabled |

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
- `GET /api/send/jobs?workspace=<id>&status=queued,running` → list jobs for current user.
- `POST /api/send/process` → worker endpoint to process queued/running jobs.
- `GET /api/send/status` also runs an inline processing fallback for queued/running jobs by default.

Production recommendation:

- Use a cron or worker to call `POST /api/send/process` every minute.
- Keep `SEND_JOB_PROCESSOR_TOKEN` set and pass it in `x-send-job-token` or `Authorization: Bearer ...`.
- Keep inline fallback enabled unless you have a reliable external worker.

### SNS Webhook (for event tracking)

To receive delivery/open/click/bounce events:

1. Create an SNS topic in your AWS console
2. Configure your SES Configuration Set to publish events to that topic
3. Add an HTTPS subscription pointing to `https://your-domain/api/webhooks/sns`

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
