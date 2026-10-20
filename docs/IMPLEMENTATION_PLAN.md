# Implementation Plan & Status

This document states **what actually exists and has been verified** versus what
remains. Nothing here is marked done on the strength of code alone — every
completed item was type-checked, linted and exercised by the test suite or a real
build.

## Verification snapshot

All of the following were executed against this checkout.

| Check                                          | Result            |
| ---------------------------------------------- | ----------------- |
| `pnpm build:shared`                            | pass              |
| `pnpm typecheck` (shared + server + desktop)   | pass              |
| `pnpm lint`                                    | pass (0 problems) |
| `pnpm --filter @pharmacy/shared test`          | 37 passed / 4 files |
| `pnpm --filter @pharmacy/server test`          | 57 passed / 5 files |
| `pnpm --filter @pharmacy/desktop test`         | 35 passed / 8 files |
| `pnpm build` (shared + server + desktop)       | pass              |
| `pnpm bootstrap`                               | pass (idempotent) |
| `electron-forge package`                       | pass → `out/PharmacyPOS-win32-x64/pharmacy-pos.exe` |
| Launching the packaged `pharmacy-pos.exe`      | pass (4 Electron processes, stable, exits cleanly) |
| Live API smoke test (`node dist/index.js`)     | pass (see below)  |
| Label print rendering (driven over CDP)        | pass (see below)  |

**Live API smoke test** — the built server was started and exercised over HTTP:

* `GET /healthz` → `{"status":"ok",…}`, `GET /readyz` → `{"status":"ready","checks":{"database":{"ok":true}}}`
* `POST /api/v1/auth/login` (`owner`) → 200 with access + refresh tokens and the
  full 24-permission list
* `GET /api/v1/products?q=para` → 200, 1 match, `costPrice` visible to OWNER
* `GET /api/v1/inventory/stock` → 200, `stockValue` `"2465.00"` for OWNER and
  `"0.00"` for CASHIER (`cost:view` enforced)
* `GET /api/v1/products/:id` → includes `totalStock` and `nearestExpiry`
* `POST /api/v1/inventory/receipts` → 201, `totalCost` `"22.75"`; re-receipting the
  same lot returned the **same batch id** and raised `totalStock` 29 → 36 → 43,
  proving the `ON CONFLICT` accumulation
* Error contract: unauthenticated → 401 `UNAUTHENTICATED`; missing permission →
  403 `FORBIDDEN` naming the permission; invalid body → 400 `VALIDATION_ERROR`
  with a flat `{field,message,code}` detail array; bad EAN-13 → 400 with the
  checksum message

**Label print rendering** — the real Electron renderer was driven over the
Chrome DevTools Protocol (in **both** the dev server and the packaged app), it
logged in, opened the products screen, selected the page, and opened the print
dialog. Chromium was then switched to the `print` media type and the output read
back:

* the app root is `display:none` and the label sheet is `display:block`, so only
  labels reach the paper
* each label cell measures exactly `241.88 × 128.5 px` = the configured
  **64 × 34 mm**
* a 25-label run produced a **322 mm** sheet = **2 A4 pages** (9 rows/page)
* for **every** label the bar pattern reconstructed from the rendered SVG rects
  was byte-identical to `@pharmacy/shared`'s EAN-13 encoder (95 modules)
* prices render with Latin digits + `ج.م`; **0 renderer console errors**

The packaged build runs the identical renderer from `app.asar` and produced the
same result, so printing is not a dev-only capability.

## Phase 1 — Repository inspection & planning ✅

* Working directory was empty; a greenfield monorepo was designed.
* Local PostgreSQL 17 cluster created inside the repo (`.dev/pgdata`, port
  **55432**) so development never depends on a system-wide install.

## Phase 2 — Foundations ✅

* pnpm workspace, strict shared `tsconfig.base.json`, Prettier, ESLint 9 flat
  config.
* `@pharmacy/shared` dual ESM/CJS build consumed by all runtimes.
* Shared contracts: Zod schemas (auth, product, category, supplier, inventory),
  permission matrix, money helpers, barcode validation/EAN-13 generation,
  pagination envelope, error codes.
* Local Postgres lifecycle script (`scripts/pg-dev.mjs`).

## Phase 3 — Data layer ✅

* Prisma schema: 12 models, 4 enums, snake_case tables, camelCase columns,
  `Decimal(14,2)` money, `@db.Date` calendar dates.
* `20261014095709_init` migration.
* Hand-written `20261014095734_pg_trgm_search_indexes` migration (`pg_trgm` GIN
  indexes for `ILIKE` catalogue search, FEFO/expiry indexes, ledger ordering).
* Seed: 6 role users, 2 warehouses, 9 categories, 5 suppliers, 32 Arabic
  products, 71 batches / 66 movements, including expired and near-expiry lots.

## Phase 4 — API server ✅

* Express + Helmet + CORS + Pino structured logging + correlation ids.
* Argon2id passwords; HS256 access tokens (15 min); opaque rotating refresh
  tokens stored only as SHA-256 hashes; per-account lockout after N failures and
  a per-IP rate limiter.
* RBAC enforced server-side on every protected route via `authorize(permission)`.
* Audit trail written inside the same transaction as each mutation.
* Modules: `health`, `auth`, `products`, `categories`, `suppliers`,
  `warehouses`, `inventory` (FEFO, batches, stock levels, movements, alerts,
  receipts, adjustments).
* OpenAPI document at `/api/openapi.json` and an offline HTML viewer at
  `/api/docs` (no CDN).
* 57 integration/unit tests against a dedicated `pharmacy_test` database,
  including real-transaction concurrency assertions.

## Phase 5 — Desktop shell ✅

* Electron 33 with `contextIsolation`, `sandbox`, no `nodeIntegration`, single
  instance lock, blocked navigation/new-windows, Arabic application menu.
* Main-process `ApiClient` owns all tokens, performs transparent refresh+retry,
  and persists the refresh token via `safeStorage`.
* Preload exposes a frozen, channel-allow-listed `window.pharmacy`.
* Application name is pinned in the main process (`app.setName('Pharmacy POS')`)
  so dev and packaged builds share one data directory,
  `%APPDATA%\Pharmacy POS`, which holds the `safeStorage`-encrypted refresh token
  (`session.bin`) and the terminal id. The packaged `productName` is verified to
  be `Pharmacy POS`.
* Forge + Vite plugin wiring, Squirrel and ZIP makers.

## Phase 6 — Renderer ✅

* Arabic-first RTL UI with a full English locale and an in-app toggle.
* TanStack Query data layer over the IPC bridge; Zustand stores for session and
  UI preferences; React Hook Form + Zod forms.
* Pages: login, dashboard, products (full CRUD + search + pagination), inventory
  (batches / stock levels / movements / alerts), suppliers, reports, settings.
* Permission-aware navigation and cost column visibility.
* Barcode labels: select products, choose copies per product, preview and print
  an A4 sheet grid (barcode + Arabic name + price) on an office printer via
  Electron's print pipeline; a one-click action assigns internal EAN-13 codes to
  products that have none.
* 35 renderer tests (formatting, i18n, auth store, login flow, app shell, label
  building, barcode SVG, print dialog).

## Known gaps / next phases

These are **not** implemented. They are deliberately listed so no one mistakes
the current build for a finished pharmacy system.

1. **POS / sales** — the `Role`/`MovementType`/permission model anticipates a
   register (`sales:create`, `register:operate`, `cashdrawer:open`) but there is
   no sales, cart, receipt, returns or payment module yet. Products and stock
   are the vertical slice; selling is not.
2. **Purchasing & suppliers ledger depth** — receipts increase a supplier
   balance, but there are no purchase orders, invoices, payments or
   supplier-return flows.
3. **Reporting** — the reports page shows operational aggregates from existing
   endpoints; there is no financial reporting, VAT return, or export to
   Excel/PDF.
4. **Barcode scanner hardware** — printing labels on an office printer is
   implemented, but there is no scanner/keyboard-wedge integration and nothing
   pretends to scan. Only EAN-13 and EAN-8 are encoded; GTIN-14 and Code 128
   barcodes are reported as unprintable rather than silently mis-encoded.
5. **Prescription/controlled-substance workflow** — flags are stored and
   displayed, but there is no prescription capture or regulatory register.
6. **Backup/restore UI** — permission exists; no implementation.
7. **Auto-update** — no update feed configured.
8. **Installer & code signing** — `electron-forge package` produces a runnable
   folder (`out/PharmacyPOS-win32-x64/pharmacy-pos.exe`), but
   `electron-forge make` (the Squirrel installer) has not been run and nothing is
   code-signed.
9. **Single-machine bundling** — the packaged app expects the API server at
   `PHARMACY_API_URL` (default `http://127.0.0.1:4000`). It does not bundle or
   spawn its own PostgreSQL + server yet, so an installed terminal still needs
   those running.

> Note: Electron Forge requires pnpm's `node-linker=hoisted` (already set in
> `.npmrc`); its default isolated linker cannot package the app.

## How to run

```bash
pnpm install
pnpm bootstrap       # start DB, create databases, write .env, migrate, seed
pnpm dev             # API + Electron together
```

Use `pnpm bootstrap`, **not** `pnpm setup` — the latter is a built-in pnpm
command that reconfigures pnpm itself.

Demo accounts (password `Pharma@2024`): `owner`, `manager`, `pharmacist`,
`cashier`, `inventory`, `accountant`.