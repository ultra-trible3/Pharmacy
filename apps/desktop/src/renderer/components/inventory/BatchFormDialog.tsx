import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { dateOnlySchema, moneySchema, type InventoryBatchRow } from '@pharmacy/shared';
import { Badge, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { FieldError, Label } from '../ui/label';
import { Input, Select } from '../ui/input';
import { toast } from '../ui/toast';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';

const batchFormSchema = z.object({
  productId: z.string().trim().min(1, 'المنتج مطلوب'),
  warehouseId: z.string().trim().min(1, 'المخزن مطلوب'),
  lotNumber: z.string().trim().min(1, 'رقم التشغيلة مطلوب').max(60),
  expiryDate: dateOnlySchema,
  manufactureDate: dateOnlySchema.optional(),
  quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون أكبر من صفر').max(1_000_000),
  costPrice: moneySchema,
  salePrice: z.union([moneySchema, z.literal('')]).optional(),
});

type BatchFormValues = z.infer<typeof batchFormSchema>;

function emptyValues(): BatchFormValues {
  return {
    productId: '',
    warehouseId: '',
    lotNumber: '',
    expiryDate: '',
    manufactureDate: '',
    quantity: 1,
    costPrice: '0.00',
    salePrice: '',
  };
}

function toFormValues(batch: InventoryBatchRow): BatchFormValues {
  return {
    productId: batch.productId,
    warehouseId: batch.warehouseId,
    lotNumber: batch.lotNumber,
    expiryDate: batch.expiryDate,
    manufactureDate: batch.manufactureDate ?? '',
    quantity: batch.quantity,
    costPrice: batch.costPrice,
    salePrice: batch.salePrice ?? '',
  };
}

function compact(values: BatchFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function BatchFormDialog({
  open,
  onOpenChange,
  batch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: InventoryBatchRow | null;
}): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = batch !== null;

  const products = useQuery({
    queryKey: ['products', 'batchOptions'],
    queryFn: () => api.products.list({ page: 1, pageSize: 200 }),
    staleTime: 5 * 60_000,
  });
  const warehouses = useQuery({
    queryKey: ['warehouses', 'batchOptions'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (open) reset(batch ? toFormValues(batch) : emptyValues());
  }, [open, batch, reset]);

  const mutation = useMutation({
    mutationFn: async (values: BatchFormValues) => {
      const payload = compact(values);
      if (isEdit) {
        return api.inventory.updateBatch(batch!.batchId, payload);
      }
      return api.inventory.createBatch(payload);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('inventory.batchUpdated') : t('inventory.batchCreated'));
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutateAsync(values));

  const productOptions = (products.data?.items ?? []).map((p) => ({
    value: p.id,
    label: `${p.sku} — ${p.nameAr}`,
  }));
  const warehouseOptions = (warehouses.data ?? []).map((w) => ({
    value: w.id,
    label: w.nameAr,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? t('inventory.editBatch') : t('inventory.newBatch')}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="productId">{t('products.nameAr')} *</Label>
              <Select
                id="productId"
                className="mt-1.5"
                disabled={isEdit}
                {...register('productId')}
              >
                <option value="">{t('inventory.selectProduct')}</option>
                {productOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.productId?.message} />
            </div>

            <div>
              <Label htmlFor="warehouseId">{t('inventory.warehouse')} *</Label>
              <Select
                id="warehouseId"
                className="mt-1.5"
                disabled={isEdit}
                {...register('warehouseId')}
              >
                <option value="">{t('inventory.selectWarehouse')}</option>
                {warehouseOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.warehouseId?.message} />
            </div>

            <div>
              <Label htmlFor="lotNumber">{t('inventory.lotNumber')} *</Label>
              <Input id="lotNumber" className="mt-1.5" {...register('lotNumber')} />
              <FieldError message={errors.lotNumber?.message} />
            </div>

            <div>
              <Label htmlFor="expiryDate">{t('inventory.expiryDate')} *</Label>
              <Input id="expiryDate" type="date" className="mt-1.5" {...register('expiryDate')} />
              <FieldError message={errors.expiryDate?.message} />
            </div>

            <div>
              <Label htmlFor="manufactureDate">{t('pos.inventory.manufactureDate')}</Label>
              <Input
                id="manufactureDate"
                type="date"
                className="mt-1.5"
                {...register('manufactureDate')}
              />
              <FieldError message={errors.manufactureDate?.message} />
            </div>

            <div>
              <Label htmlFor="quantity">{t('inventory.quantity')} *</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                className="numeric mt-1.5"
                dir="ltr"
                {...register('quantity', { valueAsNumber: true })}
              />
              <FieldError message={errors.quantity?.message} />
            </div>

            <div>
              <Label htmlFor="costPrice">{t('products.costPrice')} *</Label>
              <Input
                id="costPrice"
                type="number"
                min={0}
                step="0.01"
                className="numeric mt-1.5"
                dir="ltr"
                {...register('costPrice')}
              />
              <FieldError message={errors.costPrice?.message} />
            </div>

            <div>
              <Label htmlFor="salePrice">{t('products.salePrice')}</Label>
              <Input
                id="salePrice"
                type="number"
                min={0}
                step="0.01"
                className="numeric mt-1.5"
                dir="ltr"
                {...register('salePrice')}
              />
              <FieldError message={errors.salePrice?.message} />
            </div>
          </div>

          <DialogFooter>
            <Badge variant="outline">
              {isEdit ? batch.batchId : t('inventory.newBatch')}
            </Badge>
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
