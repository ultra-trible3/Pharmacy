import { type ReactElement } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Label } from '../ui/label';
import { type CategoryDto } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';

export function CategoryViewDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryDto | null;
}): ReactElement | null {
  const { t, tag } = useI18n();
  if (!category) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('categories.view')}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="view-code">{t('categories.code')}</Label>
              <p id="view-code" className="mt-1.5 font-medium text-sm" dir="ltr">
                {category.code}
              </p>
            </div>
            <div>
              <Label htmlFor="view-status">{t('products.status')}</Label>
              <p id="view-status" className="mt-1.5">
                <Badge variant={category.isActive ? 'success' : 'outline'}>
                  {category.isActive ? t('products.active') : t('products.inactive')}
                </Badge>
              </p>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="view-nameAr">{t('categories.nameAr')}</Label>
              <p id="view-nameAr" className="mt-1.5 text-sm">
                {category.nameAr}
              </p>
            </div>
            <div>
              <Label htmlFor="view-nameEn">{t('categories.nameEn')}</Label>
              <p id="view-nameEn" className="mt-1.5 text-sm" dir="ltr">
                {category.nameEn ?? '—'}
              </p>
            </div>
            <div>
              <Label htmlFor="view-productCount">{t('categories.productCount')}</Label>
              <p id="view-productCount" className="mt-1.5 numeric text-sm" dir="ltr">
                {formatNumber(category.productCount, tag)}
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
