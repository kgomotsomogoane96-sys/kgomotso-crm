# Lead Desk

The CRM for KgomotsoConversions. Next.js 16 + Postgres + Drizzle.
Eleven screens, one function contract, every write stamped and undoable.

## Run it

```bash
cp .env.example .env        # fill in DATABASE_URL and DESK_PASSWORD
npm install
npm run db:push             # creates the four tables — required, once per database
npm run dev
```

Open http://localhost:3000. On an empty database the app seeds itself with a
demo desk the first time it is loaded.

### With Neon (or any hosted Postgres)

1. Create a project, then copy **two** connection strings from **Connect**:
   - **pooled** (host contains `-pooler`) → `DATABASE_URL` for the app, locally and on Vercel
   - **direct** (pooling toggle off) → use it once, for `npm run db:push`
2. `DATABASE_URL="<direct url>" npm run db:push`
3. Put the **pooled** string in `.env` and in your Vercel environment variables.

Use the pooled string for anything that runs on a serverless platform —
one connection per function invocation will exhaust a small database otherwise.

## Deploy

Any Node host works; this was set up against Vercel.

- Framework preset: Next.js
- Environment variables: `DATABASE_URL` (pooled), `DESK_PASSWORD`
- Run `npm run db:push` against the production database once, from your machine.
  Deploying does not create tables.

**`DESK_PASSWORD` is not optional in production.** With it unset the app refuses
to serve rather than leaving every lead world-readable.

## The contract

`/contract` inside the app states the rules the desk enforces. The short version:

- every record and child has an immutable ID; every date is ISO
- `mark_sent` is the only route to Sent, and it generates the cadence follow-ups
- a reply stops every nudge
- nothing is Won without money and a payment date
- TRADING requires proof plus an http(s) source
- records are archived, never deleted
- every write is stamped, logged and undoable
- `GET /api/export` returns `{"schema":"lead-desk/1"}` with everything inline — no login, one click

## Function API

Every screen is a thin shell over the same functions:

```
POST /api/fn/:name        { "args": { … }, "actor": "Kgomotso" }
GET  /api/fn/:name?args=…  (read-only calls)
GET  /api/desk            the whole workspace
GET  /api/export?format=json|csv
POST /api/import          non-destructive merge
```

## Map

```
src/app/          one route per screen, all force-dynamic
src/components/   CrmApp (the shell), LeadFile, ui, motion
src/lib/desk.ts   every function, the rules, the audit/history/undo machinery
src/lib/seed.ts   the demo desk
src/db/           Drizzle schema + pooled pg client
middleware.ts     single-password gate
```
