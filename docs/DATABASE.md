# Database

PostgreSQL 17, accessed exclusively through Prisma. Schema:
[`apps/server/prisma/schema.prisma`](../apps/server/prisma/schema.prisma).

## Conventions

| Concern      | Choice                                                        |
| ------------ | ------------------------------------------------------------- |
| Table names  | snake_case plural via `@@map` (`products`, `stock_movements`) |
| Column names | camelCase, quoted (`"nameAr"`, `"costPrice"`)                 |
| Money        | `Decimal(14, 2)` — never float                                |
| Quantities   | `Int` (whole units/packs)                                     |
| Calendar dates (expiry, manufacture) | `@db.Date`                                 |
| Event timestamps | `TIMESTAMP(3)` (`createdAt`, `updatedAt`, `receivedAt`)   |
| IDs          | `TEXT` UUIDs (`gen_random_uuid()` in the seed)                |

## Enums

`Role` (OWNER, MANAGER, PHARMACIST, CASHIER, INVENTORY_CLERK, ACCOUNTANT),
`DosageForm`, `PrescriptionClass` (OTC, PRESCRIPTION, CONTROLLED),
`MovementType` (RECEIPT, ISSUE, ADJUSTMENT_IN/OUT, TRANSFER_IN/OUT,
RETURN_IN/OUT, COUNT_GAIN/LOSS).

## Models

```
User ──< Session
User ──< AuditLog
User ──< StockMovement (userId, nullable)
Category ──< Product
Supplier ──< Batch,  Supplier ──< StockMovement
Warehouse ──< Batch,  Warehouse ──< StockMovement
Product ──< Batch ──< StockMovement
```

`Batch` carries `(productId, warehouseId, lotNumber, expiryDate)` as a **unique
key**. That constraint is what makes idempotent, race-safe stock receipts
possible:

```sql
INSERT INTO batches (...) VALUES (...)
ON CONFLICT ("productId","warehouseId","lotNumber","expiryDate")
DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity
RETURNING id, quantity;
```

## Migrations

| Migration                                | Contents                                   |
| ---------------------------------------- | ------------------------------------------ |
| `20261014095709_init`                    | All tables, enums, FKs and base indexes     |
| `20261014095734_pg_trgm_search_indexes`  | Hand-written: `pg_trgm` GIN indexes + ledger ordering indexes |

The second is hand-written because Prisma cannot express expression indexes or
`CREATE EXTENSION`. It adds:

* `gin (… gin_trgm_ops)` on `products.nameAr`, `nameEn`, `sku`, `barcode`,
  `activeIngredient`, `brand`, `manufacturer` — the catalogue search issues
  `ILIKE '%term%'`, which a B-tree cannot serve;
* a partial `batches (expiryDate, productId) WHERE quantity > 0` index — the
  shape used by FEFO allocation, batch listing and expiry alerts;
* `stock_movements (createdAt DESC)` and `(type, createdAt DESC)` — the ledger is
  virtually always read newest-first or scoped by movement type.

## Databases

| Database        | Purpose                  | Env var             |
| --------------- | ------------------------ | ------------------- |
| `pharmacy`      | development / seeded demo| `DATABASE_URL`      |
| `pharmacy_test` | integration tests        | `TEST_DATABASE_URL` |

Both live on the repo-local cluster at `127.0.0.1:55432`.

## Commands

```bash
pnpm db:start          # start the local cluster
pnpm db:status         # show connection string + port
pnpm db:migrate        # create + apply a migration (dev)
pnpm db:migrate:test   # apply migrations to pharmacy_test
pnpm db:seed           # (re)seed demo data
pnpm db:reset          # drop, re-migrate and re-seed
pnpm db:stop           # stop the cluster
```

## Seed data

`prisma/seed.ts` creates 6 role users (password `Pharma@2024`), 2 warehouses,
9 categories, 5 suppliers, 32 Arabic products with GS1 Egypt barcodes, and 71
batches including deliberately near-expiry and already-expired lots so the
alerts screen has something real to show. Opening balances are written as
`RECEIPT` movements.

Login as `owner` for full access, or `cashier` to see the reduced permission set
(no cost prices, no stock adjustments).
