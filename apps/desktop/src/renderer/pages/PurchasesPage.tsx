import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Plus, Trash2, X } from 'lucide-react';
import type { ProductListItem } from '@pharmacy/shared';
import { useI18n } from '../i18n/useI18n';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { api, type PurchaseReceiptBody } from '../lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { toast } from '../components/ui/toast';
import { useAuthStore } from '../store/auth';
import { ReceiptFormDialog } from '../components/purchases/ReceiptFormDialog';

const PAGE_SIZE = 25;

interface LineDraft {
  key: string;
  product: { id: string; label: string; costPrice: string; salePrice: string } | null;
  lotNumber: string;
  expiryDate: string;
  quantity: string;
  costPrice: string;
  salePrice: string;
}

interface ReceiptForm {
  warehouseId: string;
  supplierId: string;
  reference: string;
  notes: string;
  items: LineDraft[];
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

/** Debounced product lookup used inside the receipt lines. */
function ProductPicker({
  selected,
  onSelect,
  placeholder,
}: {
  selected: { id: string; label: string } | null;
  onSelect: (product: ProductListItem | null) => void;
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

  const { data, isFetching } = useQuery({
    queryKey: ['products', 'picker', debounced],
    queryFn: () => api.products.search({ q: debounced, pageSize: 8 }),
    enabled: open && debounced.trim().length >= 2,
  });

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

export function PurchasesPage(): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';
  const queryClient = useQueryClient();
  const can = useAuthStore((state) => state.can);
  const canWrite = can('purchases:write');
  const canDelete = can('purchases:delete');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editReference, setEditReference] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteReference, setDeleteReference] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['purchases', page, debouncedSearch],
    queryFn: () => api.purchases.list({ page, pageSize: PAGE_SIZE, q: debouncedSearch || undefined }),
    placeholderData: (previous) => previous,
  });

  const [detailReference, setDetailReference] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['purchases', 'detail', detailReference],
    queryFn: () => api.purchases.get(detailReference!),
    enabled: detailReference !== null,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.warehouses.list(),
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.suppliers.list({ pageSize: 200 }),
  });

  const { data: editDetail } = useQuery({
    queryKey: ['purchases', 'edit-detail', editReference],
    queryFn: () => api.purchases.get(editReference!),
    enabled: editReference !== null,
  });

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<ReceiptForm>({
    warehouseId: '',
    supplierId: '',
    reference: '',
    notes: '',
    items: [newLine()],
  });
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: createPurchase, isPending: creating } = useMutation({
    mutationFn: (body: PurchaseReceiptBody) => api.purchases.create(body),
    onSuccess: (result) => {
      toast.success(t('purchases.created', { reference: result.reference }));
      setNewOpen(false);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const { mutate: updatePurchase, isPending: updating } = useMutation({
    mutationFn: ({ reference, body }: { reference: string; body: PurchaseReceiptBody }) =>
      api.purchases.update(reference, body),
    onSuccess: (result) => {
      toast.success(t('purchases.updated', { reference: result.reference }));
      setEditOpen(false);
      setEditReference(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const { mutate: removePurchase, isPending: removing } = useMutation({
    mutationFn: (reference: string) => api.purchases.remove(reference),
    onSuccess: () => {
      toast.success(t('purchases.deleted'));
      setDeleteReference(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = data?.items ?? [];
  const summary = data?.summary;
  const totalPages = data?.totalPages ?? 1;

  const openNew = () => {
    const warehouseOptions = warehouses ?? [];
    setForm({
      warehouseId:
        warehouseOptions.find((warehouse) => warehouse.isDefault)?.id ??
        warehouseOptions[0]?.id ??
        '',
      supplierId: '',
      reference: '',
      notes: '',
      items: [newLine()],
    });
    setFormError(null);
    setNewOpen(true);
  };

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

  const submitNew = () => {
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
    createPurchase({
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('purchases.totalCost')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatMoney(summary?.totalCost ?? '0.00', moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('purchases.receiptsCount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">{summary?.receiptsTotal ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('purchases.unitsTotal')}</p>
          <p className="numeric mt-1 text-xl font-semibold">{summary?.unitsTotal ?? 0}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('purchases.searchPlaceholder')}
            aria-label={t('purchases.searchPlaceholder')}
          />
        </div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? t('common.loading') : t('common.refresh')}
        </Button>
        {canWrite ? (
          <Button size="sm" onClick={openNew}>
            <PackagePlus size={14} /> {t('purchases.new')}
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : null}
        {isError ? <div className="p-8 text-center text-destructive">{t('errors.generic')}</div> : null}
        {!isLoading && !isError && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('purchases.noReceipts')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('purchases.reference')}</TableHead>
                <TableHead>{t('purchases.supplier')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead>{t('purchases.date')}</TableHead>
                <TableHead className="numeric text-center">{t('purchases.lines')}</TableHead>
                <TableHead className="numeric text-center">{t('purchases.units')}</TableHead>
                <TableHead className="numeric text-center">{t('common.total')}</TableHead>
                <TableHead className="text-center">{t('purchases.receivedBy')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((receipt) => (
                <TableRow key={receipt.reference}>
                  <TableCell className="numeric font-medium">{receipt.reference}</TableCell>
                  <TableCell>{receipt.supplierNameAr ?? '—'}</TableCell>
                  <TableCell>{receipt.warehouseNameAr ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(receipt.createdAt, moneyLocale)}</TableCell>
                  <TableCell className="numeric text-center">{receipt.linesCount}</TableCell>
                  <TableCell className="numeric text-center">{formatNumber(receipt.unitsCount, moneyLocale)}</TableCell>
                  <TableCell className="numeric text-center font-medium">
                    {formatMoney(receipt.totalCost, moneyLocale)}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {receipt.userName ?? '—'}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    <div className="flex gap-1">
                      {canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updating}
                          onClick={() => {
                            setEditReference(receipt.reference);
                            setEditOpen(true);
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={removing}
                          onClick={() => setDeleteReference(receipt.reference)}
                          aria-label={t('common.delete')}
                        >
                          {t('common.delete')}
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => setDetailReference(receipt.reference)}>
                        {t('common.view')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <span className="numeric text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={detailReference !== null}
        onOpenChange={(open) => {
          if (!open) setDetailReference(null);
        }}
      >
        <DialogContent
          title={detailReference ?? ''}
          description={t('purchases.detailsTitle')}
          className="max-w-3xl"
        >
          {detailLoading ? (
            <div className="p-6 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : detail ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t('purchases.supplier')}</p>
                  <p>{detail.supplierNameAr ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('inventory.warehouse')}</p>
                  <p>{detail.warehouseNameAr ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('purchases.date')}</p>
                  <p className="numeric">{formatDateTime(detail.createdAt, moneyLocale)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('purchases.receivedBy')}</p>
                  <p>{detail.userName ?? '—'}</p>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('purchases.product')}</TableHead>
                      <TableHead>{t('inventory.lotNumber')}</TableHead>
                      <TableHead>{t('inventory.expiryDate')}</TableHead>
                      <TableHead className="numeric text-center">{t('inventory.quantity')}</TableHead>
                      <TableHead className="numeric text-center">{t('products.costPrice')}</TableHead>
                      <TableHead className="numeric text-center">{t('common.total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{line.productNameAr}</p>
                          <p className="numeric text-xs text-muted-foreground">{line.sku}</p>
                        </TableCell>
                        <TableCell className="numeric">{line.lotNumber ?? '—'}</TableCell>
                        <TableCell className="numeric">
                          {line.expiryDate ? formatDate(line.expiryDate, moneyLocale) : '—'}
                        </TableCell>
                        <TableCell className="numeric text-center">{line.quantity}</TableCell>
                        <TableCell className="numeric text-center">
                          {formatMoney(line.unitCost, moneyLocale)}
                        </TableCell>
                        <TableCell className="numeric text-center font-medium">
                          {formatMoney(line.lineTotal, moneyLocale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-6 rounded-md border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {t('purchases.lines')}: <strong className="numeric">{detail.linesCount}</strong>
                </span>
                <span className="text-muted-foreground">
                  {t('purchases.units')}: <strong className="numeric">{formatNumber(detail.unitsCount, moneyLocale)}</strong>
                </span>
                <span>
                  {t('common.total')}:{' '}
                  <strong className="numeric text-base">{formatMoney(detail.totalCost, moneyLocale)}</strong>
                </span>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">{t('errors.generic')}</div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailReference(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewOpen(false);
            setFormError(null);
          }
        }}
      >
        <DialogContent
          title={t('purchases.newTitle')}
          description={t('purchases.new')}
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
                            ...(product
                              ? { costPrice: product.costPrice, salePrice: product.salePrice }
                              : {}),
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
                      <Trash2 size={14} />
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
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={creating} onClick={submitNew}>
              {creating ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        receipt={editDetail ?? null}
        saving={updating}
        onSave={(body) => updatePurchase({ reference: editReference!, body })}
      />

      <Dialog
        open={deleteReference !== null}
        onOpenChange={(open) => !open && setDeleteReference(null)}
      >
        <DialogContent title={t('common.delete')} description={t('purchases.deleteConfirm', { reference: deleteReference ?? '' })}>
          <p className="text-sm">
            {t('purchases.deleteWarning')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteReference(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => deleteReference && removePurchase(deleteReference)}
            >
              {removing ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
