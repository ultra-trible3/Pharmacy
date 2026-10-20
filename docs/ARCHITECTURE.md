# Architecture

Offline-first **Pharmacy Management & POS** desktop application for Egyptian
pharmacies. Arabic-first (RTL) with a full English secondary locale, Egyptian
pound (EGP) money, and `Africa/Cairo` business dates.

## Repository layout

```
.
├── apps/
│   ├── server/          Node + Express + Prisma API (modular monolith)
│   └── desktop/         Electron shell + React renderer
├── packages/
│   └── shared/          Types, Zod schemas, permissions, money/barcode helpers
├── scripts/             Local Postgres cluster, setup, migrations
└── docs/                This documentation
```

pnpm workspaces. `@pharmacy/shared` is consumed by all three runtimes, so it is
built as a **dual ESM/CJS** package:

| Consumer           | Resolution | Output      |
| ------------------ | ---------- | ----------- |
| API server (ESM)   | `import`   | `dist/esm`  |
| Electron main (CJS)| `require`  | `dist/cjs`  |
| Renderer (Vite/ESM)| `import`   | `dist/esm`  |

`scripts/postbuild.mjs` writes `dist/cjs/package.json` (`{"type":"commonjs"}`)
so Node treats the CJS output correctly inside an ESM `package.json`.

## Process model

```
┌─────────────────────────── Electron ───────────────────────────┐
│  Main process (Node)                                           │
│   • ApiClient — owns tokens, talks HTTP to the API             │
│   • SessionStore — encrypted refresh token on disk             │
│   • ipcMain handlers — one per channel in `shared/ipc.ts`       │
│                                                                │
│        ▲  contextBridge (frozen object)   │  ipcRenderer        │
│        │                                  ▼                    │
│  Preload (sandboxed)  ─────────────────────────────► Renderer  │
│   window.pharmacy.{appInfo,health,auth,api}         React SPA   │
└────────────────────────────────────────────────────────────────┘
                                   │ HTTP (fetch, Node 18+)
                                   ▼
                      ┌────────────────────────────┐
                      │ Express API (127.0.0.1:4000)│
                      │ Prisma → PostgreSQL 55432   │
                      └────────────────────────────┘
```

### Why tokens live in the main process

The renderer never sees an access or refresh token. All API traffic is proxied
through `window.pharmacy.api.request({ method, path, body })`, which:

1. attaches the in-memory access token (`Authorization: Bearer …`),
2. on `401` performs **one** transparent refresh + retry,
3. returns a discriminated `ApiResponse<T>` — never a raw `Response`.

The refresh token is persisted with Electron `safeStorage` to
`userData/session.bin`. If OS-level encryption is unavailable the app refuses to
persist it rather than writing a plaintext credential to disk.

## Server layering

```
routes  →  validate (Zod) → authorize (RBAC) → service → repository/SQL → Prisma
```

* **`middleware/`** — request context + correlation id, authentication
  (JWT verification + session hydration), `authorize(permission)`,
  `validate({body,query,params})`, central error handler, rate limiter.
* **`lib/`** — Argon2id hashing, JWT signing, refresh-token hashing, audit
  trail, date helpers, typed `AppError` hierarchy.
* **`modules/<name>/`** — `*.routes.ts`, `*.service.ts`, (sometimes
  `*.repository.ts`) and `fefo.ts` for inventory allocation.

Errors are always the same envelope:

```json
{ "error": { "code": "CONFLICT", "message": "…", "details": [], "requestId": "…" } }
```

`ERROR_CODES` is shared, so the client switches on stable machine codes.

## Security posture

| Control                     | Setting                                             |
| --------------------------- | --------------------------------------------------- |
| `contextIsolation`          | `true`                                              |
| `nodeIntegration`           | `false`                                             |
| `sandbox`                   | `true`                                              |
| Renderer → Node access      | none (only the frozen preload object)               |
| New windows / navigation    | denied; external `https:` links open in the browser |
| IPC channels                | explicit allow-list in `shared/ipc.ts`              |
| SQL                         | Prisma parameterised queries / tagged `$queryRaw`   |
| Passwords                   | Argon2id (19 MiB, t=2, p=1, 32-byte tag)            |
| Refresh tokens              | 48 random bytes; only the SHA-256 hash is stored    |
| Login throttling            | per-IP rate limit **and** per-account lockout       |
| Sensitive reads             | `cost:view` gates cost price and stock valuation    |

## Domain rules worth knowing

* **FEFO is mandatory.** Outbound stock without an explicit batch is allocated
  against the earliest-expiring positive batches (`modules/inventory/fefo.ts`).
  An explicit batch that cannot cover the request fails with
  `INSUFFICIENT_STOCK` (409) instead of silently spilling over.
* **Money is a string.** `Decimal(14,2)` in Postgres, fixed 2-decimal strings on
  the wire. `normaliseDecimalString` is the only rounding primitive; float math
  is never used for money.
* **Quantities are integers.** Batch balances are never read-modify-written in
  JS; receipts use an `INSERT … ON CONFLICT DO UPDATE quantity = batches.quantity
  + EXCLUDED.quantity` upsert and outbound movements use a conditional
  `UPDATE … WHERE quantity + delta >= 0 RETURNING`, so concurrent callers cannot
  drive a balance negative or lose units.
* **Product deletion is conditional.** A product with batches or movements is
  deactivated (soft delete) so the stock ledger stays intact.
* **Every mutation is audited** into `audit_logs` inside the same transaction.

## Testing strategy

| Scope             | Tool                     | Location                     |
| ----------------- | ------------------------ | ---------------------------- |
| Shared primitives | Vitest                   | `packages/shared/src/**`     |
| API integration   | Vitest + supertest       | `apps/server/tests/**`       |
| FEFO unit         | Vitest                   | `apps/server/src/modules/inventory/fefo.test.ts` |
| Renderer UI       | Vitest + RTL + jsdom     | `apps/desktop/src/renderer/**` |

API tests run against a **separate `pharmacy_test` database** (`tests/setup.ts`
repoints `DATABASE_URL` at `TEST_DATABASE_URL` before any module loads) and
truncate tables between files, so they are order-independent and never touch
development data. Concurrency behaviour is asserted with `Promise.all` against
real transactions rather than mocked.
