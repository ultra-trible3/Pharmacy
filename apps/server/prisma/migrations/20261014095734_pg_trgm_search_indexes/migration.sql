-- Trigram indexes for fast, case-insensitive substring search.
--
-- The catalogue search endpoint issues `ILIKE '%term%'` predicates across the
-- Arabic/English names and the descriptive columns. A plain B-tree index cannot
-- serve a leading-wildcard LIKE, so pg_trgm GIN indexes are used instead.
--
-- These cannot be expressed in the Prisma schema, hence this hand-written
-- migration. `CREATE EXTENSION` requires a privileged role; the application
-- database owner created by the setup script has the required rights.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_name_ar_trgm_idx"
  ON "products" USING gin ("nameAr" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_name_en_trgm_idx"
  ON "products" USING gin ("nameEn" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx"
  ON "products" USING gin ("sku" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_barcode_trgm_idx"
  ON "products" USING gin ("barcode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_active_ingredient_trgm_idx"
  ON "products" USING gin ("activeIngredient" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_brand_trgm_idx"
  ON "products" USING gin ("brand" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_manufacturer_trgm_idx"
  ON "products" USING gin ("manufacturer" gin_trgm_ops);

-- Expiry-driven queries (FEFO allocation, batch listing and alerts) always
-- filter on a positive balance and order by expiry date.
CREATE INDEX IF NOT EXISTS "batches_available_expiry_idx"
  ON "batches" ("expiryDate", "productId")
  WHERE "quantity" > 0;

-- Ledger lookups are overwhelmingly "latest first" or type-scoped.
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx"
  ON "stock_movements" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "stock_movements_type_created_at_idx"
  ON "stock_movements" ("type", "createdAt" DESC);
