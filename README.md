# Pharmacy Management System

Offline-first **pharmacy management & point-of-sale** desktop application for
Egyptian pharmacies. Arabic-first (RTL) with a full English locale, Egyptian
pound (EGP) money and `Africa/Cairo` business dates.

> **Status:** working vertical slice — secure Electron shell, PostgreSQL + Prisma
> data layer, authentication/RBAC/audit, full **product catalogue CRUD** with fast
> search, and **batch/FEFO inventory tracking**. Selling (POS), purchasing,
> financial reporting and hardware integration are **not implemented yet**; see
> [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the honest gap
> list.

## Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Desktop   | Electron 33 + React 18 + TypeScript + Vite + Electron Forge             |
| UI        | Tailwind CSS 3 + Radix primitives + TanStack Query + Zustand + RHF + Zod |
| API       | Node.js + Express + Pino + OpenAPI (`/api/docs`)                        |
| Data      | PostgreSQL 17 + Prisma (versioned migrations)                           |
| Monorepo  | pnpm workspaces + a dual ESM/CJS shared package                         |
| Testing   | Vitest, supertest, React Testing Library (113 tests)                    |

## Requirements

* **Node.js 20.11+**
* **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.7.0 --activate`)
* **PostgreSQL 17** installed locally — binaries are auto-detected under
  `C:\Program Files\PostgreSQL\*`. The repo runs its **own isolated cluster on
  port 55432**, so your system PostgreSQL service is never touched.

## Quick start

```bash
corepack enable
pnpm install
pnpm bootstrap      # starts the DB, creates databases, writes .env, migrates, seeds
pnpm dev            # API server + Electron app together
```

`pnpm bootstrap` is idempotent — re-run it any time. (Note: use
`pnpm bootstrap`, **not** `pnpm setup` — `setup` is a built-in pnpm command that
reconfigures pnpm itself.)

Then sign in with any demo account (password `Pharma@2024`):

| Username    | Role            | What it demonstrates                          |
| ----------- | --------------- | --------------------------------------------- |
| `owner`     | OWNER           | Everything, including cost prices and values  |
| `manager`   | MANAGER         | All operations except destructive ones        |
| `pharmacist`| PHARMACIST      | Dispensing + stock adjustments                |
| `cashier`   | CASHIER         | Read-only catalogue; **no** cost prices       |
| `inventory` | INVENTORY_CLERK | Receiving, adjusting, stock counts            |
| `accountant`| ACCOUNTANT      | Read-only, cost-visible                       |

## Common commands

```bash
pnpm dev                 # API + desktop together
pnpm dev:server          # API only     → http://127.0.0.1:4000
pnpm dev:desktop         # Electron only

pnpm test                # all packages
pnpm typecheck           # all packages
pnpm lint                # ESLint (flat config, root)
pnpm build               # shared + server + desktop

pnpm db:start / db:stop / db:status
pnpm db:migrate / db:seed / db:reset
```

## Documentation

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — process model, security posture,
  token custody, domain rules, testing strategy.
* [`docs/DATABASE.md`](docs/DATABASE.md) — schema conventions, migrations,
  FEFO/index rationale, seed data.
* [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phase-by-phase
  status and the list of things that are **not** done.

## Troubleshooting

* **The dev window is blank after adding an export to `packages/shared`.**
  Vite pre-bundles dependencies into `node_modules/.vite`, keyed by a content
  hash. When `@pharmacy/shared` gains a new export the cached bundle goes stale
  and the renderer dies with *"does not provide an export named ..."*. The
  renderer config excludes `@pharmacy/shared` from pre-bundling to prevent this;
  if you still hit it, delete `apps/desktop/node_modules/.vite` and restart.
* **`electron-forge start -- --remote-debugging-port=9333` prints a blank
  window with no error.** Check the renderer console over CDP
  (`GET http://127.0.0.1:9333/json/list`) — a module/MIME failure shows up there,
  not in the terminal.

## Security highlights

* Renderer holds **no tokens**; all HTTP goes through a frozen preload bridge to a
  main-process client that owns the session and refreshes transparently.
* `contextIsolation` on, `nodeIntegration` off, `sandbox` on, navigation and new
  windows blocked, strict IPC channel allow-list.
* Argon2id passwords; HS256 access token + rotating opaque refresh token stored
  only as a SHA-256 hash; per-account lockout and per-IP rate limiting.
* RBAC enforced **server-side** on every protected route; sensitive reads gated by
  `cost:view`.
* Parameterised queries only; every mutation written to an audit trail in the same
  transaction.

## License

UNLICENSED — private project.
