# OpenSpiderz

OpenSpiderz is a self-hosted workflow automation platform. It provides a visual workflow canvas, a queued DAG execution engine, webhooks and form triggers, encrypted workspace credentials, execution history, binary-file storage, and a growing set of integrations.

## What is included

- Visual React workflow editor built with React Flow and Zustand
- TypeScript DAG executor with parallel branch support, validation, execution history, expressions, and error handling
- Fastify API with JWT authentication, organizations, workspaces, roles, invitations, workflow versions, and audit logs
- PostgreSQL workflow and execution storage
- Redis/BullMQ background execution workers
- OAuth credential storage encrypted with AES-256-GCM
- Local filesystem or S3-compatible binary storage
- Built-in workflow nodes including Webhook, Form Trigger, HTTP Request, Code, Postgres, Google, Slack, Notion, Airtable, Outlook, Telegram, and file input

## Repository layout

```text
packages/
  shared/   Shared workflow types and schemas
  core/     DAG executor, expressions, triggers, worker runtime, binary abstractions
  nodes/    Built-in workflow node executors
  server/   Fastify API, PostgreSQL access, Redis queues, OAuth, storage
  web/      React/Vite workflow dashboard and visual workflow studio
```

## Prerequisites

- Node.js 22 LTS recommended (use a version manager if other projects require another Node version)
- npm 10+
- PostgreSQL 15+
- Redis 7+

Optional for production binary storage:

- AWS S3 or another S3-compatible service such as MinIO

## Local setup

1. Install workspace dependencies.

   ```powershell
   npm install
   ```

2. Create a local database.

   ```powershell
   createdb -U postgres spiderz
   ```

3. Copy the environment template and fill in its values.

   ```powershell
   Copy-Item .env.example .env
   ```

4. Generate secure secrets. `CREDENTIAL_ENCRYPTION_KEY` must be a base64-encoded 32-byte key.

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Use the first output for `CREDENTIAL_ENCRYPTION_KEY`; generate separate long random values for `JWT_SECRET` and `WEBHOOK_SIGNING_SECRET`.

5. Apply SQL migrations in numeric order.

   ```powershell
   Get-ChildItem packages\server\sql\*.sql | Sort-Object Name | ForEach-Object {
     psql -U postgres -d spiderz -f $_.FullName
   }
   ```

6. Start Redis. For example, if Redis is installed locally:

   ```powershell
   redis-server
   ```

7. Build and start the API, background worker, and web app in separate terminals.

   ```powershell
   npm run build
   npm run start:api
   ```

   ```powershell
   npm run start:worker
   ```

   ```powershell
   npm run dev:web
   ```

Open `http://localhost:5173`, create an account, create or join an organization workspace, and create a workflow.

## Environment configuration

At minimum, configure the values in `.env`:

```dotenv
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/spiderz
CREDENTIAL_ENCRYPTION_KEY=BASE64_32_BYTE_KEY
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
HOST=0.0.0.0
PORT=3000
WEBHOOK_SIGNING_SECRET=LONG_RANDOM_SECRET
JWT_SECRET=LONG_RANDOM_SECRET
CORS_ORIGIN=http://localhost:5173
BINARY_STORAGE_DRIVER=local
BINARY_LOCAL_PATH=./data/binary
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
```

Google OAuth settings are currently required during server startup. Other OAuth providers are optional and are enabled only after all of their values are present.

```dotenv
# Optional OAuth providers
SLACK_OAUTH_CLIENT_ID=...
SLACK_OAUTH_CLIENT_SECRET=...
SLACK_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/slack/callback

NOTION_OAUTH_CLIENT_ID=...
NOTION_OAUTH_CLIENT_SECRET=...
NOTION_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/notion/callback

AIRTABLE_OAUTH_CLIENT_ID=...
AIRTABLE_OAUTH_CLIENT_SECRET=...
AIRTABLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/airtable/callback

MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/outlook/callback
```

Do not commit `.env`, database dumps, generated binary files, or OAuth secrets.

### Binary storage

Use local storage for development:

```dotenv
BINARY_STORAGE_DRIVER=local
BINARY_LOCAL_PATH=./data/binary
```

Use S3-compatible storage in production:

```dotenv
BINARY_STORAGE_DRIVER=s3
S3_BUCKET=spiderz-binary
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# S3_ENDPOINT=https://your-s3-compatible-endpoint
# S3_FORCE_PATH_STYLE=true
```

## Everyday commands

```powershell
# Check all packages
npm run typecheck

# Build all packages
npm run build

# Run web tests
npm run test --workspace=@spiderz/web

# Start the API, worker, and development web server
npm run start:api
npm run start:worker
npm run dev:web
```

## How workflows run

1. A webhook, form, schedule, polling trigger, or manual test queues an execution.
2. BullMQ stores the work in Redis.
3. The worker loads the workflow from PostgreSQL and executes its DAG.
4. Each node receives upstream JSON data, evaluates expressions, and writes execution history.
5. Execution progress and logs are available in the workflow studio.

Production workflows should be enabled only after validating the development workflow and connected credentials.

##  Codex and GPT-5.6

OpenSpiderz was developed with AI assistance from Codex and GPT-5.6 as engineering tools, not as runtime dependencies.

They were used to help with:

- Designing the TypeScript monorepo and strict workflow interfaces
- Implementing and refining DAG execution, queue workers, OAuth, RBAC, storage, and integrations
- Building React Flow canvas interactions and responsive UI treatments
- Diagnosing TypeScript, package-installation, CORS, and local development issues
- Drafting tests, migration steps, setup documentation, and developer guidance



## Security notes

- Keep `CREDENTIAL_ENCRYPTION_KEY` stable. Changing it without a key-rotation migration makes existing encrypted credentials unreadable.
- Use HTTPS, a trusted reverse proxy, secure cookie/session settings where applicable, and a restricted `CORS_ORIGIN` in production.
- Do not expose the Redis port, PostgreSQL port, or local binary-storage directory publicly.
- Give third-party OAuth apps the minimum required scopes.
- Use managed backups and monitor worker failures, queue depth, and database capacity.

