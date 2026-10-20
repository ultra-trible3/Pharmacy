import { z } from 'zod';
import { DOSAGE_FORMS, PRESCRIPTION_CLASSES } from '../constants.js';
import { isValidProductBarcode } from '../barcode.js';
import { normaliseDecimalString } from '../money.js';
import { optionalTrimmedString, paginationSchema } from './common.js';

/**
 * Monetary value accepted as a number or string and normalised to a fixed
 * 2-decimal string so that it never round-trips through a JS float.
 */
export const moneySchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const raw = typeof value === 'string' ? value.trim() : value;
    if (raw === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'قيمة مالية مطلوبة' });
      return z.NEVER;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'قيمة مالية غير صحيحة' });
      return z.NEVER;
    }
    if (num < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'القيمة المالية لا يمكن أن تكون سالبة' });
      return z.NEVER;
    }
    if (num > 99_999_999.99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'القيمة المالية كبيرة جدًا' });
      return z.NEVER;
    }
    return normaliseDecimalString(raw, 2);
  });

/** Percentage 0-100 with at most 2 decimals, normalised to a string. */
export const percentSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const raw = typeof value === 'string' ? value.trim() : value;
    const num = Number(raw);
    if (raw === '' || !Number.isFinite(num) || num < 0 || num > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'النسبة يجب أن تكون بين 0 و 100' });
      return z.NEVER;
    }
    return normaliseDecimalString(raw, 2);
  });

export const barcodeSchema = z
  .string()
  .trim()
  .refine(isValidProductBarcode, 'باركود غير صالح (تحقق من الرقم أو خانة التحقق)');

export const skuSchema = z
  .string()
  .trim()
  .min(2, 'كود المنتج قصير جدًا')
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'يُسمح بالحروف والأرقام و . _ - فقط');

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

/** Image formats accepted as a product photo. */
export const PRODUCT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ProductImageMimeType = (typeof PRODUCT_IMAGE_MIME_TYPES)[number];

/** Upper bound (in bytes) on the decoded photo. Clients downscale before upload. */
export const PRODUCT_IMAGE_MAX_BYTES = 1_000_000;

/** `data:image/png;base64,...` with well-formed base64 and an accepted format. */
const PRODUCT_IMAGE_DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp));base64,(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * A self-contained image data URL. Kept as a string so the same value can be
 * previewed in the renderer, validated by the API and stored without a
 * multipart round-trip.
 */
export const productImageDataUrlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const match = PRODUCT_IMAGE_DATA_URL_RE.exec(value);
    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'صيغة الصورة غير مدعومة (PNG أو JPG أو WebP فقط)',
      });
      return;
    }
    const base64 = value.slice(value.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const bytes = (base64.length / 4) * 3 - padding;
    if (bytes > PRODUCT_IMAGE_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'حجم الصورة كبير جدًا' });
    }
  });

export const setProductImageSchema = z.object({ dataUrl: productImageDataUrlSchema }).strict();
export type SetProductImageInput = z.infer<typeof setProductImageSchema>;

/**
 * Detects PNG / JPEG / WebP from a file's leading bytes. The declared MIME type
 * of an upload is only a hint; the content decides what is stored.
 */
export function sniffProductImageMimeType(bytes: Uint8Array): ProductImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

export const createProductSchema = z
  .object({
    sku: skuSchema,
    barcode: barcodeSchema.optional(),
    altBarcodes: z.array(barcodeSchema).max(10).default([]),
    nameAr: z.string().trim().min(2, 'الاسم العربي مطلوب').max(200),
    nameEn: optionalTrimmedString(200),
    brand: optionalTrimmedString(120),
    manufacturer: optionalTrimmedString(150),
    categoryId: optionalTrimmedString(64),
    dosageForm: z.enum(DOSAGE_FORMS).default('OTHER'),
    strength: optionalTrimmedString(80),
    packSize: optionalTrimmedString(80),
    unit: optionalTrimmedString(40),
    activeIngredient: optionalTrimmedString(200),
    costPrice: moneySchema.default('0.00'),
    salePrice: moneySchema,
    taxRate: percentSchema.default('0.00'),
    minStock: z.coerce.number().int().min(0).max(1_000_000).default(5),
    prescriptionClass: z.enum(PRESCRIPTION_CLASSES).default('OTC'),
    notes: optionalTrimmedString(1000),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial().strict();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productQuerySchema = paginationSchema.extend({
  /** Free text: matches name (ar/en), SKU, barcode and active ingredient. */
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(64).optional(),
  prescriptionClass: z.enum(PRESCRIPTION_CLASSES).optional(),
  dosageForm: z.enum(DOSAGE_FORMS).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Only products whose total stock is at or below their minimum threshold. */
  lowStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z.enum(['nameAr', 'nameEn', 'sku', 'salePrice', 'createdAt', 'updatedAt']).default('nameAr'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export interface ProductListItem {
  id: string;
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  brand: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  categoryNameAr: string | null;
  dosageForm: string;
  strength: string | null;
  packSize: string | null;
  unit: string | null;
  costPrice: string;
  salePrice: string;
  taxRate: string;
  minStock: number;
  prescriptionClass: string;
  isActive: boolean;
  /** Aggregated across warehouses. */
  totalStock: number;
  /** Earliest batch expiry with remaining stock, ISO date or null. */
  nearestExpiry: string | null;
  /**
   * True when a photo is stored for this product. The bytes are fetched
   * separately via `GET /products/:id/image` so catalogue queries stay small.
   */
  hasImage: boolean;

  // Best-sellers extensions (from /sales/best-sellers)
  unitsSold?: number;
  invoicesCount?: number;
  revenue?: string;
  rank?: number;

  // Recently-sold extensions (from /sales/recent)
  lastSoldAt?: string;
  lastQuantity?: number;
  lastInvoiceId?: string;

  // Product detail extensions
  activeIngredient?: string | null;
}
