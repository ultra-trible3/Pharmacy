import { useEffect, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { api, type PurchaseReceiptBody, type PurchaseReceiptDetailDto } from '../../lib/api';
import { formatMoney } from '../../lib/format';

interface LineDraft {
  key: string;
  product: { id: string; label: string; costPrice: string; salePrice: string } | null;
  lotNumber: string;
  expiryDate: string;
  quantity: string;
  costPrice: string;
  salePrice: string;
}

interface ReceiptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  receipt?: PurchaseReceiptDetailDto | null;
  saving: boolean;
  onSave: (body: PurchaseReceiptBody) => void;
}

function newLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    product: null,
    lotNumber: '',
    expiryDate: '',
    quantity: '1',
    costPrice: '',
    salePrice: '',
  };
}

function lineFromDetail(line: PurchaseReceiptDetailDto['lines'][number]): LineDraft {
  return {
    key: crypto.randomUUID(),
    product: {
      id: line.productId,
      label: line.productNameAr,
      costPrice: line.unitCost,
      salePrice: line.unitCost,
    },
    lotNumber: line.lotNumber ?? '',
    expiryDate: line.expiryDate ?? '',
    quantity: String(line.quantity),
    costPrice: line.unitCost,
    salePrice: '',
  };
}

export function ReceiptFormDialog({
  open,
  onOpenChange,
  mode,
  receipt,
  saving,
  onSave,
}: ReceiptFormDialogProps): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';

  const { data: warehouses } = useQueryWarehouses();
  const { data: suppliers } = useQuerySuppliers();

  const [form, setForm] = useState<ReceiptFormState>({
    warehouseId: '',
    supplierId: '',
    reference: '',
    notes: '',
    items: [newLine()],
  });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && receipt) {
      const warehouseOptions = warehouses ?? [];
      setForm({
        warehouseId: receipt.warehouseId ?? warehouseOptions.find((w) => w.isDefault)?.id ?? warehouseOptions[0]?.id ?? '',
        supplierId: receipt.supplierId ?? '',
        reference: receipt.reference,
        notes: '',
        items: receipt.lines.map(lineFromDetail),
      });
    } else {
      const warehouseOptions = warehouses ?? [];
      setForm({
        warehouseId: warehouseOptions.find((w) => w.isDefault)?.id ?? warehouseOptions[0]?.id ?? '',
        supplierId: '',
        reference: '',
        notes: '',
        items: [newLine()],
      });
    }
    setFormError(null);
  }, [open, mode, receipt, warehouses]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  };

  const grandTotal = form.items.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.costPrice) || 0),
    0,
  );

  const submit = () => {
    if (!form.warehouseId) {
      setFormError(t('purchases.selectWarehouse'));
      return;
    }
    const incomplete = form.items.some(
      (line) =>
        !line.product ||
        !line.lotNumber.trim() ||
        !line.expiryDate ||
        !(Number(line.quantity) > 0) ||
        line.costPrice.trim() === '' ||
        !Number.isFinite(Number(line.costPrice)),
    );
    if (form.items.length === 0 || incomplete) {
      setFormError(t('purchases.formIncomplete'));
      return;
    }
    onSave({
      warehouseId: form.warehouseId,
      ...(form.supplierId ? { supplierId: form.supplierId } : {}),
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      items: form.items.map((line) => ({
        productId: line.product!.id,
        lotNumber: line.lotNumber.trim(),
        expiryDate: line.expiryDate,
        quantity: Number(line.quantity),
        costPrice: line.costPrice,
        ...(line.salePrice.trim() ? { salePrice: line.salePrice } : {}),
      })),
    });
  };

  const field = (label: string, input: ReactElement) => (
    <label className="block space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {input}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={mode === 'edit' ? t('purchases.edit') : t('purchases.newTitle')}
        description={
          mode === 'edit' ? t('purchases.editTitle') : t('purchases.new')
        }
        className="max-h-[85vh] max-w-4xl overflow-y-auto"
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {field(
              t('inventory.warehouse'),
              <Select
                value={form.warehouseId}
                onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}
                aria-label={t('inventory.warehouse')}
              >
                <option value="" disabled>
                  {t('purchases.selectWarehouse')}
                </option>
                {(warehouses ?? []).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.nameAr}
                  </option>
                ))}
              </Select>,
            )}
            {field(
              t('purchases.supplier'),
              <Select
                value={form.supplierId}
                onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
                aria-label={t('purchases.supplier')}
              >
                <option value="">{t('purchases.selectSupplier')}</option>
                {(suppliers?.items ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.nameAr}
                  </option>
                ))}
              </Select>,
            )}
            {field(
              t('purchases.reference'),
              <Input
                value={form.reference}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
                placeholder={t('purchases.referencePlaceholder')}
                aria-label={t('purchases.reference')}
              />,
            )}
          </div>

          {field(
            t('purchases.notes'),
            <Input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder={t('purchases.notes')}
              aria-label={t('purchases.notes')}
            />,
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('purchases.lines')}</p>
            {form.items.map((line) => (
              <div key={line.key} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <ProductPicker
                      selected={line.product ? { id: line.product.id, label: line.product.label } : null}
                      placeholder={t('purchases.productSearchPlaceholder')}
                      onSelect={(product) =>
                        updateLine(line.key, {
                          product: product
                            ? {
                                id: product.id,
                                label: `${product.nameAr} (${product.sku})`,
                                costPrice: product.costPrice,
                                salePrice: product.salePrice,
                              }
                            : null,
                          ...(product ? { costPrice: product.costPrice, salePrice: product.salePrice } : {}),
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={form.items.length <= 1}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.filter((item) => item.key !== line.key),
                      }))
                    }
                    aria-label={t('purchases.removeLine')}
                  >
                    <X size={14} />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {field(
                    t('inventory.lotNumber'),
                    <Input
                      value={line.lotNumber}
                      onChange={(event) => updateLine(line.key, { lotNumber: event.target.value })}
                      aria-label={t('inventory.lotNumber')}
                    />,
                  )}
                  {field(
                    t('inventory.expiryDate'),
                    <Input
                      type="date"
                      value={line.expiryDate}
                      onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                      aria-label={t('inventory.expiryDate')}
                    />,
                  )}
                  {field(
                    t('inventory.quantity'),
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      aria-label={t('inventory.quantity')}
                    />,
                  )}
                  {field(
                    t('products.costPrice'),
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.costPrice}
                      onChange={(event) => updateLine(line.key, { costPrice: event.target.value })}
                      aria-label={t('products.costPrice')}
                    />,
                  )}
                  {field(
                    t('purchases.salePrice'),
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.salePrice}
                      onChange={(event) => updateLine(line.key, { salePrice: event.target.value })}
                      aria-label={t('purchases.salePrice')}
                    />,
                  )}
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm((current) => ({ ...current, items: [...current.items, newLine()] }))}
            >
              <Plus size={14} /> {t('purchases.addLine')}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t('purchases.grandTotal')}</span>
            <strong className="numeric text-base">{formatMoney(grandTotal, moneyLocale)}</strong>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={saving} onClick={submit}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared product picker used inside receipt lines. */
function ProductPicker({
  selected,
  onSelect,
  placeholder,
}: {
  selected: { id: string; label: string } | null;
  onSelect: (product: { id: string; nameAr: string; sku: string; costPrice: string; salePrice: string } | null) => void;
  placeholder: string;
}): ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQueryProducts({ q: debounced, open });

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
        <span className="truncate">{selected.label}</span>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onSelect(null)}
          aria-label={t('purchases.removeLine')}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {open && debounced.trim().length >= 2 ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-md">
          {isFetching && !data ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
          ) : null}
          {data && data.items.length === 0 && !isFetching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.noResults')}</div>
          ) : null}
          {data?.items.map((product) => (
            <button
              key={product.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(product);
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="truncate">{product.nameAr}</span>
              <span className="numeric shrink-0 text-xs text-muted-foreground">{product.sku}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Thin hooks kept local so this file stays self-contained. */
function useQueryWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.warehouses.list(),
  });
}

function useQuerySuppliers() {
  return useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.suppliers.list({ pageSize: 200 }),
  });
}

function useQueryProducts({ q, open }: { q: string; open: boolean }) {
  return useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => api.products.search({ q, pageSize: 8 }),
    enabled: open && q.trim().length >= 2,
  });
}

interface ReceiptFormState {
  warehouseId: string;
  supplierId: string;
  reference: string;
  notes: string;
  items: LineDraft[];
}
