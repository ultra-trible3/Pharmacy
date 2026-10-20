import { useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { toast } from '../ui/toast';

/** Supplier return document (RETURN_OUT movement). */
export function ReturnDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const returnTitle = 'مرتجع مشتريات';
  const returnDescription = 'مرتجع مشتريات إلى المورد';

  // State for the return form
  const [warehouseId, setWarehouseId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reference, setReference] = useState(''); // invoice/reference number
  const [isSaving, setIsSaving] = useState(false);

  // Mock warehouse data - in real app, fetch from api.warehouses.list()
  const warehouses = [
    { id: 'wh_1', nameAr: 'المخزن الرئيسي', nameEn: 'Main Warehouse' },
    { id: 'wh_2', nameAr: 'مخزن الفرع', nameEn: 'Branch Warehouse' },
  ];

  // Mock batch data - in real app, fetch from api.inventory.batches()
  const batches = [
    { id: 'bat_1', productNameAr: 'باراسيتامول 500', lotNumber: 'P-2411', expiryDate: '2027-08-31', quantity: 240 },
    { id: 'bat_2', productNameAr: 'أموكسيسيلين 250', lotNumber: 'AM-2509', expiryDate: '2026-12-31', quantity: 36 },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={returnTitle}
        description={returnDescription}
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{'اختر مخزناً'}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </select>

            <select
              onChange={(e) => setBatchId(e.target.value)}
              disabled={warehouseId === ''}
            >
              <option value="">{'اختر دفعة'}</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.productNameAr} ({b.lotNumber})
                </option>
              ))}
            </select>

            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-label={ 'الكمية' }
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground">{ 'رقم الفاتورة' }</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={ 'رقم الفاتورة أو المرجع' }
              aria-label={ 'رقم الفاتورة' }
            />
          </div>

          {warehouseId && batchId && (
            <p className="text-sm text-muted-foreground">
              { 'المتاح' }: <span className="numeric">{batches.find((b) => b.id === batchId)?.quantity ?? 0}</span>
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              { 'إلغاء' }
            </Button>
            <Button
              disabled={isSaving}
              onClick={async () => {
                setIsSaving(true);
                try {
                  // In real app: call API with RETURN_OUT movement
                  toast.success('تم تسجيل المرتجع للفاتورة: ' + reference);
                  onOpenChange(false);
                } catch (e: any) {
                  toast.error(e instanceof Error ? e.message : 'خطأ عام');
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              {isSaving ? 'جاري التسجيل' : 'تسجيل'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** i18n keys for supplier returns. */
export const returnStrings = {
  returnTitle: 'مرتجع مشتريات',
  returnDescription: 'مرتجع مشتريات إلى المورد',
  returnWarehouse: 'المخزن',
  returnBatch: 'الدفعة',
  returnQuantity: 'الكمية',
  returnInvoice: 'رقم الفاتورة',
  returnSave: 'تسجيل',
  returnCancel: 'إلغاء',
};