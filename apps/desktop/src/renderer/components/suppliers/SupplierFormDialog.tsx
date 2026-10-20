import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createSupplierSchema, moneySchema, updateSupplierSchema } from '@pharmacy/shared';
import { Badge, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { FieldError, Label } from '../ui/label';
import { toast } from '../ui/toast';
import { api, type SupplierDto } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';

/**
 * Renderer-side form schema built from the SAME field primitives the API uses
 * (`moneySchema`), so client and server can never disagree about what a valid
 * supplier looks like.
 *
 * On submit the values are re-parsed with the full `createSupplierSchema` /
 * `updateSupplierSchema`, which also normalises the opening balance into a
 * fixed 2-decimal string.
 */
const supplierFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'كود المورد غير صالح')
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/u, 'كود المورد غير صالح'),
  nameAr: z.string().trim().min(2, 'اسم المورد مطلوب').max(150),
  nameEn: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  taxNumber: z.string().trim().max(60).optional(),
  openingBalance: z.union([moneySchema, z.literal('')]),
  isActive: z.boolean(),
});

type SupplierFormValues = z.input<typeof supplierFormSchema>;

function emptyValues(): SupplierFormValues {
  return {
    code: '',
    nameAr: '',
    nameEn: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    openingBalance: '0.00',
    isActive: true,
  };
}

function toFormValues(supplier: SupplierDto): SupplierFormValues {
  return {
    code: supplier.code,
    nameAr: supplier.nameAr,
    nameEn: supplier.nameEn ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    taxNumber: supplier.taxNumber ?? '',
    openingBalance: '0.00',
    isActive: supplier.isActive,
  };
}

/** Drops empty strings so the strict create schema never receives `''`. */
function compact(values: SupplierFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierDto | null;
}): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = supplier !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (open) reset(supplier ? toFormValues(supplier) : emptyValues());
  }, [open, supplier, reset]);

  const mutation = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      if (isEdit) {
        // Empty text fields are sent as `''` so the shared schema clears the
        // column; the code and opening balance are immutable after creation.
        const parsed = updateSupplierSchema.safeParse({
          nameAr: values.nameAr,
          nameEn: values.nameEn ?? '',
          phone: values.phone ?? '',
          email: values.email ?? '',
          address: values.address ?? '',
          taxNumber: values.taxNumber ?? '',
          isActive: values.isActive,
        });
        if (!parsed.success) throw new Error(t('suppliers.invalid'));
        return api.suppliers.update(supplier.id, parsed.data);
      }
      const parsed = createSupplierSchema.safeParse(compact(values));
      if (!parsed.success) throw new Error(t('suppliers.invalid'));
      return api.suppliers.create(parsed.data);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('suppliers.updated') : t('suppliers.created'));
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutateAsync(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('common.edit') : t('suppliers.new')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="supplier-code">{t('suppliers.code')} *</Label>
              <Input
                id="supplier-code"
                className="numeric mt-1.5"
                dir="ltr"
                disabled={isEdit}
                {...register('code')}
              />
              <FieldError message={errors.code?.message} />
            </div>

            <div>
              <Label htmlFor="supplier-phone">{t('suppliers.phone')}</Label>
              <Input
                id="supplier-phone"
                className="numeric mt-1.5"
                dir="ltr"
                inputMode="tel"
                {...register('phone')}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="supplier-nameAr">{t('suppliers.nameAr')} *</Label>
              <Input id="supplier-nameAr" className="mt-1.5" {...register('nameAr')} />
              <FieldError message={errors.nameAr?.message} />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="supplier-nameEn">{t('suppliers.nameEn')}</Label>
              <Input id="supplier-nameEn" className="mt-1.5" dir="ltr" {...register('nameEn')} />
            </div>

            <div>
              <Label htmlFor="supplier-email">{t('suppliers.email')}</Label>
              <Input
                id="supplier-email"
                className="mt-1.5"
                dir="ltr"
                inputMode="email"
                {...register('email')}
              />
            </div>

            <div>
              <Label htmlFor="supplier-taxNumber">{t('suppliers.taxNumber')}</Label>
              <Input
                id="supplier-taxNumber"
                className="numeric mt-1.5"
                dir="ltr"
                {...register('taxNumber')}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="supplier-address">{t('suppliers.address')}</Label>
              <Input id="supplier-address" className="mt-1.5" {...register('address')} />
            </div>

            {!isEdit ? (
              <div>
                <Label htmlFor="supplier-openingBalance">{t('suppliers.openingBalance')}</Label>
                <Input
                  id="supplier-openingBalance"
                  className="numeric mt-1.5"
                  dir="ltr"
                  inputMode="decimal"
                  {...register('openingBalance')}
                />
                <FieldError message={errors.openingBalance?.message} />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t('suppliers.openingBalanceHint')}
                </p>
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-6">
              <input
                id="supplier-isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                {...register('isActive')}
              />
              <Label htmlFor="supplier-isActive">{t('products.active')}</Label>
            </div>
          </div>

          <DialogFooter>
            <Badge variant="outline">{isEdit ? supplier.code : t('suppliers.new')}</Badge>
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
