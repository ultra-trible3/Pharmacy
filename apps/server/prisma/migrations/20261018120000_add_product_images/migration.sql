-- Product photos: a lightweight marker on the product row plus the bytes in a
-- separate table, so catalogue queries never load image data implicitly.
ALTER TABLE "products" ADD COLUMN "imageUpdatedAt" TIMESTAMP(3);

CREATE TABLE "product_images" (
  "productId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("productId")
);

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
