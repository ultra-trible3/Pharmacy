-- DropIndex
DROP INDEX "products_active_ingredient_trgm_idx";

-- DropIndex
DROP INDEX "products_barcode_trgm_idx";

-- DropIndex
DROP INDEX "products_brand_trgm_idx";

-- DropIndex
DROP INDEX "products_manufacturer_trgm_idx";

-- DropIndex
DROP INDEX "products_name_ar_trgm_idx";

-- DropIndex
DROP INDEX "products_name_en_trgm_idx";

-- DropIndex
DROP INDEX "products_sku_trgm_idx";

-- DropIndex
DROP INDEX "stock_movements_created_at_idx";

-- DropIndex
DROP INDEX "stock_movements_type_created_at_idx";

-- CreateIndex
CREATE INDEX "sales_invoiceNumber_idx" ON "sales"("invoiceNumber");
