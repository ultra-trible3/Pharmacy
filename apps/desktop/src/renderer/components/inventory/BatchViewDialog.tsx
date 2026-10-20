import { type ReactElement } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Label } from '../ui/label';
import { type InventoryBatchRow } from '@pharmacy/shared';
import {
  expiryLabel,
  expirySeverity,
  formatDate,
  formatMoney,
  formatNumber,
} from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';

export function BatchViewDialog({
  open,
  onOpenChange,
  batch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: InventoryBatchRow | null;
}): ReactElement | null {
  const { t, tag } = useI18n();
  if (!batch) return null;
  const severity = expirySeverity(batch.daysToExpiry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('inventory.view')}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="view-sku">{t('products.sku')}</Label>
              <p id="view-sku" className="mt-1.5 font-medium text-sm" dir="ltr">
                {batch.sku}
              </p>
            </div>
            <div>
              <Label htmlFor="view-warehouse">{t('inventory.warehouse')}</Label>
              <p id="view-warehouse" className="mt-1.5 text-sm">
                {batch.warehouseNameAr}
              </p>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="view-productName">{t('products.nameAr')}</Label>
              <p id="view-productName" className="mt-1.5 text-sm">
                {batch.productNameAr}
              </p>
            </div>
            <div>
              <Label htmlFor="view-lotNumber">{t('inventory.lotNumber')}</Label>
              <p id="view-lotNumber" className="mt-1.5 text-sm" dir="ltr">
                {batch.lotNumber}
              </p>
            </div>
            <div>
              <Label htmlFor="view-quantity">{t('inventory.quantity')}</Label>
              <p id="view-quantity" className="mt-1.5 numeric text-sm" dir="ltr">
                {formatNumber(batch.quantity, tag)}
              </p>
            </div>
            <div>
              <Label htmlFor="view-expiryDate">{t('inventory.expiryDate')}</Label>
              <div className="mt-1.5 flex flex-col gap-1 text-sm">
                <span id="view-expiryDate" dir="ltr">
                  {formatDate(batch.expiryDate, tag)}
                </span>
                <Badge variant={EXPIRY_BADGE[severity]} className="w-fit">
                  {expiryLabel(batch.daysToExpiry)}
                </Badge>
              </div>
            </div>
            <div>
              <Label htmlFor="view-manufactureDate">{t('pos.inventory.manufactureDate')}</Label>
              <p id="view-manufactureDate" className="mt-1.5 text-sm" dir="ltr">
                {batch.manufactureDate ? formatDate(batch.manufactureDate, tag) : '—'}
              </p>
            </div>
            <div>
              <Label htmlFor="view-salePrice">{t('products.salePrice')}</Label>
              <p id="view-salePrice" className="mt-1.5 numeric text-sm" dir="ltr">
                {formatMoney(batch.salePrice, tag)}
              </p>
            </div>
            <div>
              <Label htmlFor="view-costPrice">{t('products.costPrice')}</Label>
              <p id="view-costPrice" className="mt-1.5 numeric text-sm" dir="ltr">
                {formatMoney(batch.costPrice, tag)}
              </p>
            </div>
            <div>
              <Label htmlFor="view-stockValue">{t('inventory.value')}</Label>
              <p id="view-stockValue" className="mt-1.5 numeric text-sm text-muted-foreground" dir="ltr">
                {formatMoney(batch.stockValue, tag)}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EXPIRY_BADGE: Record<ReturnType<typeof expirySeverity>, 'destructive' | 'warning' | 'success' | 'outline'> = {
  expired: 'destructive',
  critical: 'warning',
  warning: 'warning',
  ok: 'success',
};
