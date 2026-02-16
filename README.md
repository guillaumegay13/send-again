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
INITIAL_OWNER_EMAIL=guillaume.gay@protonmail.com
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS IAM access key with SES permissions |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS IAM secret key |
| `AWS_REGION` | No | `eu-west-3` | AWS region where SES is configured |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | — | Supabase publishable key used for email/password login |
| `SUPABASE_SECRET_KEY` | Yes | — | Supabase server secret key used by API routes |
| `INITIAL_OWNER_EMAIL` | No | `guillaume.gay@protonmail.com` | Bootstrap owner account that is allowed and auto-linked to existing workspaces |
| `ALLOWED_AUTH_EMAILS` | No | `INITIAL_OWNER_EMAIL` | Comma-separated allowlist for login access |

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

## Production

```bash
npm run build
npm start
```
