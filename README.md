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
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS IAM access key with SES permissions |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS IAM secret key |
| `AWS_REGION` | No | `eu-west-3` | AWS region where SES is configured |

### Database

The app uses SQLite (via `better-sqlite3`). The database is created automatically at `data/send-again.db` on first run — no setup required.

The `data/` directory is git-ignored.

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
