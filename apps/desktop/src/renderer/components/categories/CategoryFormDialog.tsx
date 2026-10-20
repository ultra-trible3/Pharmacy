import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createCategorySchema, updateCategorySchema } from '@pharmacy/shared';
import { Badge, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { FieldError, Label } from '../ui/label';
import { Input } from '../ui/input';
import { toast } from '../ui/toast';
import { api, type CategoryDto } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';

const categoryFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'كود التصنيف مطلوب')
    .max(30, 'كود التصنيف طويل جدًا')
    .regex(/^[A-Za-z0-9_-]+$/u, 'يُسمح بالحروف والأرقام و _ - فقط'),
  nameAr: z.string().trim().min(2, 'اسم التصنيف العربي مطلوب').max(120),
  nameEn: z.string().trim().max(120).optional(),
  isActive: z.boolean(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

function emptyValues(): CategoryFormValues {
  return { code: '', nameAr: '', nameEn: '', isActive: true };
}

function toFormValues(category: CategoryDto): CategoryFormValues {
  return {
    code: category.code,
    nameAr: category.nameAr,
    nameEn: category.nameEn ?? '',
    isActive: category.isActive,
  };
}

function compact(values: CategoryFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryDto | null;
}): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = category !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: emptyValues(),
  });

  useEffect(() => {
    if (open) reset(category ? toFormValues(category) : emptyValues());
  }, [open, category, reset]);

  const mutation = useMutation({
    mutationFn: async (values: CategoryFormValues) => {
      const payload = compact(values);
      if (isEdit) {
        const parsed = updateCategorySchema.safeParse(payload);
        if (!parsed.success) throw new Error('بيانات التصنيف غير صالحة');
        return api.categories.update(category!.id, parsed.data);
      }
      const parsed = createCategorySchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(
          first ? `${first.path.join('.')}: ${first.message}` : 'بيانات غير صالحة',
        );
      }
      return api.categories.create(parsed.data);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('categories.updated') : t('categories.created'));
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutateAsync(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? t('categories.edit') : t('categories.add')}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="code">{t('categories.code')} *</Label>
              <Input
                id="code"
                className="mt-1.5"
                dir="ltr"
                disabled={isEdit}
                {...register('code')}
              />
              <FieldError message={errors.code?.message} />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('categories.codeHint')}
              </p>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="nameAr">{t('categories.nameAr')} *</Label>
              <Input id="nameAr" className="mt-1.5" {...register('nameAr')} />
              <FieldError message={errors.nameAr?.message} />
            </div>

            <div>
              <Label htmlFor="nameEn">{t('categories.nameEn')}</Label>
              <Input id="nameEn" className="mt-1.5" dir="ltr" {...register('nameEn')} />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                id="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                {...register('isActive')}
              />
              <Label htmlFor="isActive">{t('categories.isActive')}</Label>
            </div>
          </div>

          <DialogFooter>
            <Badge variant="outline">
              {isEdit ? category.code : t('categories.add')}
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
