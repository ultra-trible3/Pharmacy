import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, RefreshCw, Search, Trash2, Truck } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from '../components/ui/toast';
import { SupplierFormDialog } from '../components/suppliers/SupplierFormDialog';
import { SupplierViewDialog } from '../components/suppliers/SupplierViewDialog';
import { api, type SupplierDto } from '../lib/api';
import { formatMoney, formatNumber } from '../lib/format';
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

export function SuppliersPage(): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();
  const canWrite = useAuthStore((state) => state.can('suppliers:write'));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const [viewing, setViewing] = useState<SupplierDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierDto | null>(null);

  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, showInactive]);

  const suppliers = useQuery({
    queryKey: ['suppliers', page, debouncedSearch, showInactive],
    queryFn: () =>
      api.suppliers.list({
        page,
        pageSize: PAGE_SIZE,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        includeInactive: showInactive,
      }),
    placeholderData: (previous) => previous,
  });

  const remove = useMutation({
    mutationFn: (supplier: SupplierDto) => api.suppliers.remove(supplier.id),
    onSuccess: async (result) => {
      toast.success(result.deactivated ? t('suppliers.deactivated') : t('suppliers.deleted'));
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setPendingDelete(null);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = suppliers.data?.items ?? [];
  const total = suppliers.data?.total ?? 0;
  const totalPages = suppliers.data?.totalPages ?? 1;

  const openEdit = (supplier: SupplierDto): void => {
    setViewing(null);
    setEditing(supplier);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('suppliers.searchPlaceholder')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          {t('suppliers.includeInactive')}
        </label>

        <Button variant="outline" size="sm" onClick={() => void suppliers.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>

        {canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('suppliers.new')}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('suppliers.count', { count: total })}</span>
        {suppliers.isFetching ? <Spinner className="h-3 w-3" /> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {suppliers.isLoading ? <EmptyState message={t('common.loading')} /> : null}
        {suppliers.isError ? <EmptyState message={t('errors.network')} /> : null}
        {!suppliers.isLoading && !suppliers.isError && items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('suppliers.code')}</TableHead>
                <TableHead>{t('nav.suppliers')}</TableHead>
                <TableHead>{t('suppliers.phone')}</TableHead>
                <TableHead>{t('suppliers.email')}</TableHead>
                <TableHead className="text-center">{t('suppliers.balance')}</TableHead>
                <TableHead>{t('products.status')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="numeric font-medium" dir="ltr">
                    {supplier.code}
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate">{supplier.nameAr}</span>
                        {supplier.nameEn ? (
                          <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                            {supplier.nameEn}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="numeric text-xs" dir="ltr">
                    {supplier.phone ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground" dir="ltr">
                    {supplier.email ?? '—'}
                  </TableCell>
                  <TableCell className="numeric text-center">
                    {formatMoney(supplier.balance, tag)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={supplier.isActive ? 'success' : 'outline'}>
                      {supplier.isActive ? t('products.active') : t('products.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('suppliers.view')}
                        title={t('suppliers.view')}
                        onClick={() => setViewing(supplier)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.edit')}
                          title={t('common.edit')}
                          onClick={() => openEdit(supplier)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          onClick={() => setPendingDelete(supplier)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <span className="numeric text-xs text-muted-foreground">
            {t('common.page')} {formatNumber(page, tag)} {t('common.of')}{' '}
            {formatNumber(totalPages, tag)}
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

      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} supplier={editing} />

      <SupplierViewDialog
        supplier={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
        onEdit={
          canWrite
            ? () => {
                if (viewing) openEdit(viewing);
              }
            : undefined
        }
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.delete')}</DialogTitle>
            <DialogDescription>{t('suppliers.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          {pendingDelete ? (
            <p className="text-sm">
              <span className="font-semibold">{pendingDelete.nameAr}</span>
              <span className="numeric ms-2 text-muted-foreground" dir="ltr">
                {pendingDelete.code}
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
