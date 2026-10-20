import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  createExpenseSchema,
  updateExpenseSchema,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS_AR,
  EXPENSE_CATEGORY_LABELS_EN,
  type CreateExpenseInput,
  type ExpenseDto,
} from '@pharmacy/shared';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { FieldError, Label } from '../ui/label';
import { Input, Select } from '../ui/input';
import { toast } from '../ui/toast';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';

type FormValues = z.infer<typeof createExpenseSchema>;

function emptyValues(): FormValues {
  return {
    category: 'OTHER',
    descriptionAr: '',
    descriptionEn: '',
    amount: '',
    paidAt: '',
    warehouseId: '',
    notes: '',
  };
}

function toFormValues(expense: ExpenseDto): FormValues {
  return {
    category: expense.category,
    descriptionAr: expense.descriptionAr,
    descriptionEn: expense.descriptionEn ?? '',
    amount: expense.amount,
    paidAt: expense.paidAt.slice(0, 10),
    warehouseId: expense.warehouseId ?? '',
    notes: expense.notes ?? '',
  };
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: ExpenseDto | null;
}): ReactElement {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = expense !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(isEdit ? updateExpenseSchema : createExpenseSchema),
    defaultValues: emptyValues(),
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses', 'expense-form'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (open) reset(expense ? toFormValues(expense) : emptyValues());
  }, [open, expense, reset]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body: CreateExpenseInput = {
        category: values.category,
        descriptionAr: values.descriptionAr.trim(),
        descriptionEn: values.descriptionEn?.trim() || undefined,
        amount: values.amount,
        paidAt: values.paidAt,
        ...(values.warehouseId ? { warehouseId: values.warehouseId } : {}),
        ...(values.notes?.trim() ? { notes: values.notes.trim() } : {}),
      };
      if (isEdit) {
        await api.expenses.update(expense!.id, body);
      } else {
        await api.expenses.create(body);
      }
      await queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onSuccess: () => {
      toast.success(isEdit ? t('expenses.updated') : t('expenses.created'));
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  const categoryOptions = EXPENSE_CATEGORIES.map((category) => ({
    value: category,
    label: locale === 'ar' ? EXPENSE_CATEGORY_LABELS_AR[category] : EXPENSE_CATEGORY_LABELS_EN[category],
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? t('expenses.edit') : t('expenses.add')}
        description={isEdit ? t('expenses.editTitle') : t('expenses.new')}
        className="max-w-2xl"
      >
        <form className="space-y-4 py-2" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor="category">{t('expenses.category')} *</Label>
              <Select
                id="category"
                className="mt-1.5"
                {...register('category')}
              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.category?.message} />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="descriptionAr">{t('expenses.descriptionAr')} *</Label>
              <Input
                id="descriptionAr"
                className="mt-1.5"
                {...register('descriptionAr')}
              />
              <FieldError message={errors.descriptionAr?.message} />
            </div>

            <div>
              <Label htmlFor="descriptionEn">{t('expenses.descriptionEn')}</Label>
              <Input id="descriptionEn" className="mt-1.5" {...register('descriptionEn')} />
            </div>

            <div>
              <Label htmlFor="amount">{t('expenses.amount')} *</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                className="numeric mt-1.5"
                dir="ltr"
                {...register('amount')}
              />
              <FieldError message={errors.amount?.message} />
            </div>

            <div>
              <Label htmlFor="paidAt">{t('expenses.paidAt')} *</Label>
              <Input
                id="paidAt"
                type="date"
                className="mt-1.5"
                {...register('paidAt')}
              />
              <FieldError message={errors.paidAt?.message} />
            </div>

            <div>
              <Label htmlFor="warehouseId">{t('inventory.warehouse')}</Label>
              <Select id="warehouseId" className="mt-1.5" {...register('warehouseId')}>
                <option value="">{t('expenses.selectWarehouse')}</option>
                {(warehouses ?? []).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.nameAr}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="notes">{t('expenses.notes')}</Label>
              <Input
                id="notes"
                className="mt-1.5"
                {...register('notes')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || mutation.isPending}
            >
              {mutation.isPending ? <span className="animate-pulse" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
