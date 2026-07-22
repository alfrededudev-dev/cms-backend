# CMS Backend

Hono API for the CMS admin panel.

## Setup

1. Start PostgreSQL and create the database:

```bash
createdb cms_site_db
```

Or with Docker:

```bash
docker run --name cms-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=root -e POSTGRES_DB=cms_site_db -p 5432:5432 -d postgres:16
```

2. Configure and run the API:

```bash
cp .env.example .env
npm install
npm run dev
```

3. Create the first admin user (run once):

```bash
npm run db:seed -- admin@example.com your-secure-password
```

Optional display name:

```bash
npm run db:seed -- admin@example.com your-secure-password "Administrator"
```

## Scripts

- `npm run dev` — start API with hot reload
- `npm run build` — compile TypeScript
- `npm run start` — run compiled server
- `npm run db:generate` — generate SQL migrations from schema
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — create admin user in database

## Endpoints

- `GET /health`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — Bearer token required
