-- Enforce a single default receiving warehouse at the database level.
-- Partial index: any number of rows with isDefault = false, at most one true.
CREATE UNIQUE INDEX "warehouses_single_default_key"
  ON "warehouses" ((isDefault)) WHERE "isDefault" = true;
