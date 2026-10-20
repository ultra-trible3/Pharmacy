import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Printer, RefreshCw, Search, Tag, Trash2 } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { DOSAGE_FORM_LABELS_AR, PRESCRIPTION_CLASS_LABELS_AR, type ProductListItem } from '@pharmacy/shared';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from '../components/ui/toast';
import { PrintLabelsDialog } from '../components/products/PrintLabelsDialog';
import { ProductBarcode } from '../components/products/ProductBarcode';
import { ProductFormDialog } from '../components/products/ProductFormDialog';
import { ProductThumb } from '../components/products/ProductThumb';
import { api } from '../lib/api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../store/auth';

const PAGE_SIZE = 25;

/** Small debounce so typing in the search box does not hammer the API. */
function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ProductsPage(): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();
  const canWrite = useAuthStore((state) => state.can('products:write'));
  const canDelete = useAuthStore((state) => state.can('products:delete'));
  const canViewCost = useAuthStore((state) => state.can('cost:view'));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductListItem | null>(null);
  // Label printing works on the rows the user ticks; ids (not snapshots) so the
  // selection survives a refetch (e.g. right after assigning barcodes).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // Ids targeted by the label dialog, or null when it is closed. Set from the
  // toolbar (all selected rows) or a row action (that one product).
  const [labelIds, setLabelIds] = useState<readonly string[] | null>(null);

  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, lowStockOnly]);

  // Page-scoped selection: changing the query or the page resets it so the user
  // never prints labels for rows they can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, lowStockOnly, page]);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(lowStockOnly ? { lowStock: true } : {}),
    }),
    [page, debouncedSearch, lowStockOnly],
  );

  const products = useQuery({
    queryKey: ['products', params],
    queryFn: () => api.products.list(params),
    placeholderData: (previous) => previous,
  });

  const remove = useMutation({
    mutationFn: (product: ProductListItem) => api.products.remove(product.id),
    onSuccess: async (result) => {
      toast.success(result.deactivated ? t('products.deactivated') : t('products.deleted'));
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setPendingDelete(null);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = useMemo(() => products.data?.items ?? [], [products.data]);
  const total = products.data?.total ?? 0;
  const totalPages = products.data?.totalPages ?? 1;

  const assignBarcodes = useMutation({
    mutationFn: () => api.products.assignBarcodes(),
    onSuccess: async (result) => {
      toast.success(
        result.assigned === 0
          ? t('labels.noneToAssign')
          : t('labels.assigned', { count: result.assigned }),
      );
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const selectedProducts = useMemo(
    () => items.filter((product) => selectedIds.has(product.id)),
    [items, selectedIds],
  );
  const labelProducts = useMemo(
    () => (labelIds === null ? [] : items.filter((product) => labelIds.includes(product.id))),
    [items, labelIds],
  );
  const allPageSelected = items.length > 0 && items.every((product) => selectedIds.has(product.id));

  const toggleOne = useCallback((id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllPage = useCallback((): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (items.length > 0 && items.every((product) => next.has(product.id))) {
        items.forEach((product) => next.delete(product.id));
      } else {
        items.forEach((product) => next.add(product.id));
      }
      return next;
    });
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('products.searchPlaceholder')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={lowStockOnly}
            onChange={(event) => setLowStockOnly(event.target.checked)}
          />
          {t('products.lowStockOnly')}
        </label>

        <Button variant="outline" size="sm" onClick={() => void products.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedProducts.length === 0}
          onClick={() => setLabelIds([...selectedIds])}
        >
          <Printer className="h-3.5 w-3.5" />
          {t('labels.print')}
        </Button>

        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            disabled={assignBarcodes.isPending}
            onClick={() => assignBarcodes.mutate()}
          >
            {assignBarcodes.isPending ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Tag className="h-3.5 w-3.5" />
            )}
            {t('labels.assign')}
          </Button>
        ) : null}

        {canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('products.new')}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('products.count', { count: total })}</span>
        <div className="flex items-center gap-3">
          {selectedProducts.length > 0 ? (
            <>
              <span className="font-medium text-foreground">
                {t('labels.selectedCount', { count: selectedProducts.length })}
              </span>
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                {t('labels.clear')}
              </button>
            </>
          ) : null}
          {products.isFetching ? <Spinner className="h-3 w-3" /> : null}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {products.isLoading ? <EmptyState message={t('common.loading')} /> : null}
        {products.isError ? (
          <EmptyState message={t('errors.network')} />
        ) : null}

        {!products.isLoading && !products.isError && items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={allPageSelected}
                    onChange={toggleAllPage}
                    aria-label={t('labels.selectAll')}
                  />
                </TableHead>
                <TableHead>{t('products.sku')}</TableHead>
                <TableHead>{t('products.nameAr')}</TableHead>
                <TableHead>{t('products.category')}</TableHead>
                <TableHead>{t('products.dosageForm')}</TableHead>
                <TableHead className="text-center">{t('products.stock')}</TableHead>
                <TableHead className="text-center">{t('products.minStock')}</TableHead>
                <TableHead>{t('products.salePrice')}</TableHead>
                {canViewCost ? <TableHead>{t('products.costPrice')}</TableHead> : null}
                <TableHead>{t('products.nearestExpiry')}</TableHead>
                <TableHead>{t('products.status')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => {
                const low = product.totalStock <= product.minStock;
                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleOne(product.id)}
                        aria-label={`${t('labels.column')} — ${product.nameAr}`}
                      />
                    </TableCell>
                    <TableCell className="numeric font-medium" dir="ltr">
                      {product.sku}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="flex items-center gap-2">
                        <ProductThumb
                          productId={product.id}
                          hasImage={product.hasImage}
                          alt={product.nameAr}
                          iconSize={18}
                          placeholderClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground"
                          imageClassName="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                        />
                        <div className="min-w-0">
                          <span className="block truncate">{product.nameAr}</span>
                          <ProductBarcode
                            value={product.barcode}
                            heightMm={5}
                            className="mt-1 max-w-[150px]"
                            textClassName="text-[10px] text-muted-foreground"
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {product.categoryNameAr ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {DOSAGE_FORM_LABELS_AR[product.dosageForm as never] ?? product.dosageForm}
                    </TableCell>
                    <TableCell className="numeric text-center">
                      <span className={low ? 'font-semibold text-warning' : ''}>
                        {formatNumber(product.totalStock, tag)}
                      </span>
                      {low ? <AlertTriangle className="ms-1 inline h-3 w-3 text-warning" /> : null}
                    </TableCell>
                    <TableCell className="numeric text-center text-muted-foreground">
                      {formatNumber(product.minStock, tag)}
                    </TableCell>
                    <TableCell className="numeric">{formatMoney(product.salePrice, tag)}</TableCell>
                    {canViewCost ? (
                      <TableCell className="numeric text-muted-foreground">
                        {formatMoney(product.costPrice, tag)}
                      </TableCell>
                    ) : null}
                    <TableCell className="numeric text-xs">
                      {product.nearestExpiry ? formatDate(product.nearestExpiry, tag) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={product.isActive ? 'success' : 'outline'}>
                          {product.isActive ? t('products.active') : t('products.inactive')}
                        </Badge>
                        {product.prescriptionClass !== 'OTC' ? (
                          <Badge
                            variant={product.prescriptionClass === 'CONTROLLED' ? 'destructive' : 'warning'}
                          >
                            {PRESCRIPTION_CLASS_LABELS_AR[product.prescriptionClass as never] ??
                              product.prescriptionClass}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('products.printBarcode')}
                          title={t('products.printBarcode')}
                          onClick={() => setLabelIds([product.id])}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.edit')}
                            onClick={() => {
                              setEditing(product);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.delete')}
                            onClick={() => setPendingDelete(product)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <span className="numeric text-xs text-muted-foreground">
            {t('common.page')} {formatNumber(page, tag)} {t('common.of')} {formatNumber(totalPages, tag)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />

      <PrintLabelsDialog
        open={labelIds !== null}
        onOpenChange={(open) => {
          if (!open) setLabelIds(null);
        }}
        products={labelProducts}
        canWrite={canWrite}
        onAssigned={() => queryClient.invalidateQueries({ queryKey: ['products'] })}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent title={t('common.delete')} description={t('products.deleteConfirm')}>
          {pendingDelete ? (
            <p className="text-sm">
              <span className="font-semibold">{pendingDelete.nameAr}</span>
              <span className="numeric ms-2 text-muted-foreground" dir="ltr">
                {pendingDelete.sku}
              </span>
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete)}
            >
              {remove.isPending ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
