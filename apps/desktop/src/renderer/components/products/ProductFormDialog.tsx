import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pill, Trash2, Wand2 } from 'lucide-react';
import { type ChangeEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_LABELS_AR,
  PRESCRIPTION_CLASSES,
  PRESCRIPTION_CLASS_LABELS_AR,
  barcodeSchema,
  createProductSchema,
  generateInternalEan13,
  moneySchema,
  percentSchema,
  skuSchema,
  updateProductSchema,
  type ProductListItem,
} from '@pharmacy/shared';
import { Badge, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { FieldError, Label } from '../ui/label';
import { Input, Select } from '../ui/input';
import { toast } from '../ui/toast';
import { ProductBarcode } from './ProductBarcode';
import { ProductThumb } from './ProductThumb';
import { api } from '../../lib/api';
import {
  fileToProductImageDataUrl,
  PRODUCT_IMAGE_ACCEPT,
  ProductImageFileError,
} from '../../lib/productImage';
import { useI18n } from '../../i18n/useI18n';
import { useAuthStore } from '../../store/auth';

/**
 * Renderer-side form schema built from the SAME field primitives the API uses
 * (`skuSchema`, `moneySchema`, `barcodeSchema`, `percentSchema`), so client and
 * server can never disagree about what a valid product looks like.
 *
 * On submit the values are re-parsed with the full `createProductSchema`, which
 * also normalises money into fixed 2-decimal strings.
 */

const productFormSchema = z.object({
  sku: skuSchema,
  barcode: z.union([barcodeSchema, z.literal('')]).optional(),
  nameAr: z.string().trim().min(2, 'الاسم العربي مطلوب').max(200),
  nameEn: z.string().trim().max(200).optional(),
  brand: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(150).optional(),
  activeIngredient: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().max(64).optional(),
  dosageForm: z.enum(DOSAGE_FORMS),
  strength: z.string().trim().max(80).optional(),
  packSize: z.string().trim().max(80).optional(),
  unit: z.string().trim().max(40).optional(),
  costPrice: moneySchema,
  salePrice: moneySchema,
  taxRate: percentSchema,
  minStock: z.coerce.number().int().min(0).max(1_000_000),
  /**
   * Stock is never stored on the product row: on save the balance is posted
   * to the default warehouse as a real stock movement. `stockLot`/`stockExpiry`
   * back the new batch that a stock increase books.
   */
  stock: z.coerce.number().int().min(0).max(1_000_000),
  stockLot: z.string().trim().max(60),
  stockExpiry: z.string().trim(),
  prescriptionClass: z.enum(PRESCRIPTION_CLASSES),
  isActive: z.boolean(),
});

type ProductFormValues = z.input<typeof productFormSchema>;

/** A photo change staged in the form and applied right after the save. */
type PendingImageChange = { type: 'set'; dataUrl: string } | { type: 'remove' } | null;

function emptyValues(): ProductFormValues {
  return {
    sku: '',
    barcode: '',
    nameAr: '',
    nameEn: '',
    brand: '',
    manufacturer: '',
    activeIngredient: '',
    categoryId: '',
    dosageForm: 'OTHER',
    strength: '',
    packSize: '',
    unit: '',
    costPrice: '0.00',
    salePrice: '',
    taxRate: '0.00',
    minStock: 5,
    stock: 0,
    stockLot: '',
    stockExpiry: '',
    prescriptionClass: 'OTC',
    isActive: true,
  };
}

function toFormValues(product: ProductListItem): ProductFormValues {
  return {
    sku: product.sku,
    barcode: product.barcode ?? '',
    nameAr: product.nameAr,
    nameEn: product.nameEn ?? '',
    brand: product.brand ?? '',
    manufacturer: product.manufacturer ?? '',
    activeIngredient: '',
    categoryId: product.categoryId ?? '',
    dosageForm: (DOSAGE_FORMS as readonly string[]).includes(product.dosageForm)
      ? (product.dosageForm as ProductFormValues['dosageForm'])
      : 'OTHER',
    strength: product.strength ?? '',
    packSize: product.packSize ?? '',
    unit: product.unit ?? '',
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    taxRate: product.taxRate,
    minStock: product.minStock,
    stock: product.totalStock,
    stockLot: '',
    stockExpiry: '',
    prescriptionClass: (PRESCRIPTION_CLASSES as readonly string[]).includes(
      product.prescriptionClass,
    )
      ? (product.prescriptionClass as ProductFormValues['prescriptionClass'])
      : 'OTC',
    isActive: product.isActive,
  };
}

/** Form-only fields that never belong to the product API payload. */
const STOCK_FORM_KEYS = new Set(['stock', 'stockLot', 'stockExpiry']);

/** Drops empty strings so the strict server schema never receives `''`. */
function compact(values: ProductFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (STOCK_FORM_KEYS.has(key)) continue;
    if (value === '' || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductListItem | null;
}): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = product !== null;

  // Photo changes are staged here and applied right after the product itself
  // is saved, so one Save never half-applies the record.
  const [imageChange, setImageChange] = useState<PendingImageChange>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categories = useQuery({
    queryKey: ['categories', 'options'],
    queryFn: () => api.categories.list({ pageSize: 200 }),
    staleTime: 5 * 60_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (open) {
      reset(product ? toFormValues(product) : emptyValues());
      setImageChange(null);
      setImageBusy(false);
    }
  }, [open, product, reset]);

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const originalStock = isEdit ? product.totalStock : 0;
      const requestedStock = Number(values.stock);
      const nextStock = Number.isFinite(requestedStock) ? requestedStock : originalStock;
      const stockDelta = nextStock - originalStock;
      const lotNumber = String(values.stockLot ?? '').trim();
      const expiryDate = String(values.stockExpiry ?? '').trim();

      // A stock increase books a NEW batch, and the server always demands a
      // lot number + expiry for those — catch it here while the dialog is
      // still open, before anything gets half-saved.
      if (stockDelta > 0 && (!lotNumber || !expiryDate)) {
        throw new Error(t('products.stockLotRequired'));
      }

      const payload = compact(values);
      let saved: ProductListItem;
      if (isEdit) {
        const parsed = updateProductSchema.safeParse(payload);
        if (!parsed.success) throw new Error('بيانات الصنف غير صالحة');
        saved = await api.products.update(product.id, parsed.data);
      } else {
        const parsed = createProductSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new Error(
            first ? `${first.path.join('.')}: ${first.message}` : 'بيانات غير صالحة',
          );
        }
        saved = await api.products.create(parsed.data);
      }

      // The record is saved at this point; a failed photo upload must not be
      // reported as a failed save.
      let imageFailed = false;
      if (imageChange?.type === 'set') {
        try {
          await api.products.setImage(saved.id, imageChange.dataUrl);
        } catch {
          imageFailed = true;
        }
      } else if (imageChange?.type === 'remove') {
        try {
          await api.products.removeImage(saved.id);
        } catch {
          imageFailed = true;
        }
      }

      // Stock lives in warehouse batches, never on the product row: apply
      // the requested balance to the default warehouse as a real movement
      // (increase books a batch; decrease is FEFO-allocated by the server).
      let stockFailed: string | null = null;
      if (stockDelta !== 0) {
        try {
          const warehouses = await api.warehouses.list();
          const warehouseId = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id;
          if (!warehouseId) throw new Error(t('products.stockNoWarehouse'));
          const costPrice = String(values.costPrice ?? '').trim();
          await api.inventory.adjust({
            productId: saved.id,
            warehouseId,
            type: stockDelta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            quantity: Math.abs(stockDelta),
            ...(stockDelta > 0
              ? { lotNumber, expiryDate, ...(costPrice ? { costPrice } : {}) }
              : {}),
            reason: isEdit ? t('products.stockAdjustReasonEdit') : t('products.stockAdjustReason'),
          });
        } catch (error) {
          stockFailed = error instanceof Error && error.message ? error.message : t('errors.generic');
        }
      }

      return { imageFailed, stockFailed };
    },
    onSuccess: async ({ imageFailed, stockFailed }) => {
      toast.success(isEdit ? t('products.updated') : t('products.created'));
      if (imageFailed) toast.error(t('products.imageUploadFailed'));
      if (stockFailed) toast.error(`${t('products.stockUpdateFailed')}: ${stockFailed}`);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product-image'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
    } catch {
      // `onError` already surfaces the toast; swallow so react-hook-form
      // never sees a rejected submit promise (unhandled rejection).
    }
  });

  const barcodeValue = watch('barcode') ?? '';

  const generateBarcode = (): void => {
    // A clock-derived sequence keeps manual codes in a high range so they can
    // never collide with the lower sequential codes the server reserves.
    const seed = String(Date.now()).slice(-11);
    setValue('barcode', generateInternalEan13(seed), { shouldValidate: true });
  };

  const hasStoredImage = isEdit && product.hasImage;

  // Stock edits are ledger movements, so the section only shows for roles
  // that may adjust inventory; everyone else still manages the product.
  const canAdjustStock = useAuthStore((s) => s.can('inventory:adjust'));
  const stockNow = Number(watch('stock'));
  const stockOriginal = isEdit ? product.totalStock : 0;
  // Increasing stock books a new batch, which needs a lot number + expiry.
  const needsStockLot = Number.isFinite(stockNow) && stockNow > stockOriginal;

  const previewImageClass = 'h-24 w-24 rounded-lg border border-border bg-white object-cover';
  const previewPlaceholderClass =
    'flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground';

  let imagePreview: ReactElement;
  if (imageChange?.type === 'set') {
    imagePreview = <img src={imageChange.dataUrl} alt="" className={previewImageClass} />;
  } else if (imageChange?.type === 'remove' || !isEdit || !product.hasImage) {
    imagePreview = (
      <div className={previewPlaceholderClass}>
        <Pill className="h-7 w-7" aria-hidden="true" />
      </div>
    );
  } else {
    imagePreview = (
      <ProductThumb
        productId={product.id}
        hasImage
        placeholderClassName={previewPlaceholderClass}
        imageClassName={previewImageClass}
      />
    );
  }

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires onChange.
    event.target.value = '';
    if (!file) return;

    setImageBusy(true);
    try {
      setImageChange({ type: 'set', dataUrl: await fileToProductImageDataUrl(file) });
    } catch (error) {
      const reason = error instanceof ProductImageFileError ? error.reason : 'processing-failed';
      toast.error(
        reason === 'too-large'
          ? t('products.imageTooLarge')
          : reason === 'not-an-image'
            ? t('products.imageInvalid')
            : t('errors.generic'),
      );
    } finally {
      setImageBusy(false);
    }
  };

  const handleImageRemove = (): void => {
    setImageChange({ type: 'remove' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? t('common.edit') : t('products.new')}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-start gap-4 rounded-lg border border-border bg-muted/30 p-3 md:col-span-2">
              {imagePreview}

              <div className="min-w-0 flex-1 space-y-2">
                <Label>{t('products.image')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={imageBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {imageBusy ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                    {imageChange?.type === 'set' || hasStoredImage
                      ? t('products.imageChange')
                      : t('products.imageUpload')}
                  </Button>
                  {imageChange?.type === 'set' || (imageChange === null && hasStoredImage) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={handleImageRemove}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('products.imageRemove')}
                    </Button>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {imageChange?.type === 'set'
                    ? t('products.imagePending')
                    : t('products.imageHint')}
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={PRODUCT_IMAGE_ACCEPT}
                className="hidden"
                onChange={handleImagePick}
              />
            </div>

            <div>
              <Label htmlFor="sku">{t('products.sku')} *</Label>
              <Input id="sku" className="numeric mt-1.5" dir="ltr" {...register('sku')} />
              <FieldError message={errors.sku?.message} />
            </div>

            <div>
              <Label htmlFor="barcode">{t('products.barcode')}</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="barcode"
                  className="numeric"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="6220000000000"
                  {...register('barcode')}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title={t('products.generateBarcode')}
                  aria-label={t('products.generateBarcode')}
                  onClick={generateBarcode}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
              <FieldError message={errors.barcode?.message} />
              {barcodeValue ? (
                <div className="mt-2 rounded border border-border bg-white p-2" dir="ltr">
                  <ProductBarcode
                    value={barcodeValue}
                    heightMm={12}
                    textClassName="numeric text-[11px] text-muted-foreground"
                  />
                  <span className="sr-only">{t('products.barcodePreview')}</span>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t('products.barcodeAutoHint')}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="nameAr">{t('products.nameAr')} *</Label>
              <Input id="nameAr" className="mt-1.5" {...register('nameAr')} />
              <FieldError message={errors.nameAr?.message} />
            </div>

            <div>
              <Label htmlFor="nameEn">{t('products.nameEn')}</Label>
              <Input id="nameEn" className="mt-1.5" dir="ltr" {...register('nameEn')} />
            </div>

            <div>
              <Label htmlFor="brand">{t('products.brand')}</Label>
              <Input id="brand" className="mt-1.5" {...register('brand')} />
            </div>

            <div>
              <Label htmlFor="manufacturer">{t('products.manufacturer')}</Label>
              <Input id="manufacturer" className="mt-1.5" {...register('manufacturer')} />
            </div>

            <div>
              <Label htmlFor="activeIngredient">{t('products.activeIngredient')}</Label>
              <Input
                id="activeIngredient"
                className="mt-1.5"
                {...register('activeIngredient')}
              />
            </div>

            <div>
              <Label htmlFor="categoryId">{t('products.category')}</Label>
              <Select id="categoryId" className="mt-1.5" {...register('categoryId')}>
                <option value="">{t('common.all')}</option>
                {(categories.data?.items ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameAr}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="dosageForm">{t('products.dosageForm')}</Label>
              <Select id="dosageForm" className="mt-1.5" {...register('dosageForm')}>
                {DOSAGE_FORMS.map((form) => (
                  <option key={form} value={form}>
                    {DOSAGE_FORM_LABELS_AR[form]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="prescriptionClass">{t('products.prescriptionClass')}</Label>
              <Select
                id="prescriptionClass"
                className="mt-1.5"
                {...register('prescriptionClass')}
              >
                {PRESCRIPTION_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>
                    {PRESCRIPTION_CLASS_LABELS_AR[cls]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="strength">{t('products.strength')}</Label>
              <Input id="strength" className="mt-1.5" {...register('strength')} />
            </div>

            <div>
              <Label htmlFor="packSize">{t('products.packSize')}</Label>
              <Input id="packSize" className="mt-1.5" {...register('packSize')} />
            </div>

            <div>
              <Label htmlFor="unit">{t('products.unit')}</Label>
              <Input id="unit" className="mt-1.5" {...register('unit')} />
            </div>

            <div>
              <Label htmlFor="costPrice">{t('products.costPrice')}</Label>
              <Input
                id="costPrice"
                className="numeric mt-1.5"
                dir="ltr"
                inputMode="decimal"
                {...register('costPrice')}
              />
              <FieldError message={errors.costPrice?.message} />
            </div>

            <div>
              <Label htmlFor="salePrice">{t('products.salePrice')} *</Label>
              <Input
                id="salePrice"
                className="numeric mt-1.5"
                dir="ltr"
                inputMode="decimal"
                {...register('salePrice')}
              />
              <FieldError message={errors.salePrice?.message} />
            </div>

            <div>
              <Label htmlFor="taxRate">{t('products.taxRate')}</Label>
              <Input
                id="taxRate"
                className="numeric mt-1.5"
                dir="ltr"
                inputMode="decimal"
                {...register('taxRate')}
              />
              <FieldError message={errors.taxRate?.message} />
            </div>

            <div>
              <Label htmlFor="minStock">{t('products.minStock')}</Label>
              <Input
                id="minStock"
                type="number"
                min={0}
                className="numeric mt-1.5"
                dir="ltr"
                {...register('minStock', { valueAsNumber: true })}
              />
              <FieldError message={errors.minStock?.message} />
            </div>

            {canAdjustStock ? (
              <>
                <div>
                  <Label htmlFor="stock">
                    {isEdit ? t('products.stock') : t('products.openingStock')} *
                  </Label>
                  <Input
                    id="stock"
                    type="number"
                    min={0}
                    className="numeric mt-1.5"
                    dir="ltr"
                    {...register('stock', { valueAsNumber: true })}
                  />
                  <FieldError message={errors.stock?.message} />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {isEdit
                      ? t('products.currentStock', { count: product.totalStock })
                      : t('products.stockHint')}
                  </p>
                </div>

                {needsStockLot ? (
                  <div>
                    <Label htmlFor="stockLot">{t('products.stockLot')} *</Label>
                    <Input id="stockLot" className="mt-1.5" dir="ltr" {...register('stockLot')} />
                    <FieldError message={errors.stockLot?.message} />
                  </div>
                ) : null}

                {needsStockLot ? (
                  <div>
                    <Label htmlFor="stockExpiry">{t('products.stockExpiry')} *</Label>
                    <Input
                      id="stockExpiry"
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      className="numeric mt-1.5"
                      dir="ltr"
                      {...register('stockExpiry')}
                    />
                    <FieldError message={errors.stockExpiry?.message} />
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="flex items-center gap-2 pt-6">
              <input
                id="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                {...register('isActive')}
              />
              <Label htmlFor="isActive">{t('products.active')}</Label>
            </div>
          </div>

          <DialogFooter>
            <Badge variant="outline">{isEdit ? product.sku : t('products.new')}</Badge>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {mutation.isPending ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
