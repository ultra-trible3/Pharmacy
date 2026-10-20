import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createWarehouseSchema, updateWarehouseSchema } from '@pharmacy/shared';
import { Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { FieldError, Label } from '../ui/label';
import { toast } from '../ui/toast';
import { api, type WarehouseDto } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';

const warehouseFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'كود المخزن قصير جدًا')
    .max(20, 'كود المخزن طويل جدًا')
    .regex(/^[A-Za-z0-9_-]+$/u, 'كود المخزن غير صالح'),
  nameAr: z.string().trim().min(2, 'اسم المخزن مطلوب').max(120),
  nameEn: z.string().trim().max(120),
  address: z.string().trim().max(300),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

type WarehouseFormValues = z.input<typeof warehouseFormSchema>;

function emptyValues(): WarehouseFormValues {
  return {
    code: '',
    nameAr: '',
    nameEn: '',
    address: '',
    isDefault: false,
    isActive: true,
  };
}

function toFormValues(warehouse: WarehouseDto): WarehouseFormValues {
  return {
    code: warehouse.code,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn ?? '',
    address: warehouse.address ?? '',
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
  };
}

/**
 * Create/edit dialog for storage locations. The code is the stable handle on
 * receipts, so it is only editable while the warehouse is being created.
 */
export function WarehouseFormDialog({
  open,
  onOpenChange,
  warehouse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseDto | null;
}): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = warehouse !== null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: emptyValues(),
  });

  const isDefault = watch('isDefault');

  useEffect(() => {
    if (open) reset(warehouse ? toFormValues(warehouse) : emptyValues());
  }, [open, warehouse, reset]);

  // A default receiving point must also be active, mirroring the API rule.
  useEffect(() => {
    if (isDefault) setValue('isActive', true);
  }, [isDefault, setValue]);

  const mutation = useMutation({
    mutationFn: async (values: WarehouseFormValues) => {
      if (isEdit) {
        const parsed = updateWarehouseSchema.safeParse({
          nameAr: values.nameAr,
          nameEn: values.nameEn,
          address: values.address,
          isDefault: values.isDefault,
          isActive: values.isActive,
        });
        if (!parsed.success) throw new Error(t('warehouses.invalid'));
        return api.warehouses.update(warehouse.id, parsed.data);
      }

      const parsed = createWarehouseSchema.safeParse({
        code: values.code,
        nameAr: values.nameAr,
        ...(values.nameEn ? { nameEn: values.nameEn } : {}),
        ...(values.address ? { address: values.address } : {}),
        isDefault: values.isDefault,
        isActive: values.isActive,
      });
      if (!parsed.success) throw new Error(t('warehouses.invalid'));
      return api.warehouses.create(parsed.data);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('warehouses.updated') : t('warehouses.created'));
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutateAsync(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? t('warehouses.editTitle') : t('warehouses.createTitle')}
        description={t('warehouses.formDescription')}
      >
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="warehouse-code">{t('warehouses.code')} *</Label>
              <Input
                id="warehouse-code"
                className="numeric mt-1.5"
                dir="ltr"
                disabled={isEdit}
                {...register('code')}
              />
              <FieldError message={errors.code?.message} />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {isEdit ? t('warehouses.codeImmutable') : t('warehouses.codeHint')}
              </p>
            </div>

            <div>
              <Label htmlFor="warehouse-nameAr">{t('warehouses.nameAr')} *</Label>
              <Input id="warehouse-nameAr" className="mt-1.5" {...register('nameAr')} />
              <FieldError message={errors.nameAr?.message} />
            </div>

            <div>
              <Label htmlFor="warehouse-nameEn">{t('warehouses.nameEn')}</Label>
              <Input
                id="warehouse-nameEn"
                className="mt-1.5"
                dir="ltr"
                {...register('nameEn')}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="warehouse-address">{t('warehouses.address')}</Label>
              <Input id="warehouse-address" className="mt-1.5" {...register('address')} />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <input
                id="warehouse-isDefault"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-input"
                {...register('isDefault')}
              />
              <div>
                <Label htmlFor="warehouse-isDefault">{t('warehouses.isDefault')}</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('warehouses.isDefaultHint')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <input
                id="warehouse-isActive"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-input"
                disabled={isDefault}
                {...register('isActive')}
              />
              <div>
                <Label htmlFor="warehouse-isActive">{t('warehouses.isActive')}</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('warehouses.isActiveHint')}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
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
