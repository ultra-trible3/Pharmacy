import { Pencil } from 'lucide-react';
import { type ReactElement, type ReactNode } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import type { SupplierDto } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{children}</p>
    </div>
  );
}

/** Read-only supplier details, with an optional shortcut into the edit form. */
export function SupplierViewDialog({
  supplier,
  onOpenChange,
  onEdit,
}: {
  supplier: SupplierDto | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
}): ReactElement {
  const { t, tag } = useI18n();

  return (
    <Dialog open={supplier !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('suppliers.details')}</DialogTitle>
          <DialogDescription>{supplier?.code}</DialogDescription>
        </DialogHeader>
        {supplier ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={t('suppliers.nameAr')}>{supplier.nameAr}</Field>
              <Field label={t('suppliers.nameEn')}>{supplier.nameEn ?? '—'}</Field>
              <Field label={t('suppliers.phone')}>
                <span className="numeric" dir="ltr">
                  {supplier.phone ?? '—'}
                </span>
              </Field>
              <Field label={t('suppliers.email')}>
                <span dir="ltr">{supplier.email ?? '—'}</span>
              </Field>
              <Field label={t('suppliers.taxNumber')}>
                <span className="numeric" dir="ltr">
                  {supplier.taxNumber ?? '—'}
                </span>
              </Field>
              <Field label={t('suppliers.balance')}>
                <span className="numeric font-semibold">{formatMoney(supplier.balance, tag)}</span>
              </Field>
              <div className="md:col-span-2">
                <Field label={t('suppliers.address')}>{supplier.address ?? '—'}</Field>
              </div>
              <Field label={t('products.status')}>
                <Badge variant={supplier.isActive ? 'success' : 'outline'}>
                  {supplier.isActive ? t('products.active') : t('products.inactive')}
                </Badge>
              </Field>
              <Field label={t('suppliers.createdAt')}>
                <span className="numeric text-xs">{formatDate(supplier.createdAt, tag)}</span>
              </Field>
              <Field label={t('suppliers.updatedAt')}>
                <span className="numeric text-xs">{formatDate(supplier.updatedAt, tag)}</span>
              </Field>
            </div>

            <DialogFooter>
              {onEdit ? (
                <Button variant="outline" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('common.edit')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
