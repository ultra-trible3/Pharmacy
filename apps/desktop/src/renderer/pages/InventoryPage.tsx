import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Boxes, CalendarClock, Eye, Plus, Pencil, RefreshCw, Search, Trash2, Warehouse } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { useAuthStore } from '../store/auth';
import {
  MOVEMENT_TYPE_LABELS_AR,
  MOVEMENT_TYPES,
  type InventoryBatchRow,
  type MovementType,
} from '@pharmacy/shared';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from '../components/ui/toast';
import { api } from '../lib/api';
import { BatchFormDialog } from '../components/inventory/BatchFormDialog';
import { BatchViewDialog } from '../components/inventory/BatchViewDialog';
import { TransferDialog } from '../components/inventory/TransferDialog';
import {
  expiryLabel,
  expirySeverity,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
} from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { cn } from '../lib/utils';

const PAGE_SIZE = 25;

type TabKey = 'batches' | 'stock' | 'movements';

const EXPIRY_BADGE: Record<ReturnType<typeof expirySeverity>, 'destructive' | 'warning' | 'success' | 'outline'> = {
  expired: 'destructive',
  critical: 'warning',
  warning: 'warning',
  ok: 'success',
};

export function InventoryPage(): ReactElement {
  const { t, tag } = useI18n();

  const [tab, setTab] = useState<TabKey>('batches');
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [movementType, setMovementType] = useState<MovementType | ''>('');
  const [page, setPage] = useState(1);

  const canWrite = useAuthStore((state) => state.can('inventory:adjust'));
  const canRead = useAuthStore((state) => state.can('inventory:read'));
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<InventoryBatchRow | null>(null);
  const [viewingBatch, setViewingBatch] = useState<InventoryBatchRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InventoryBatchRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBatch, setTransferBatch] = useState<InventoryBatchRow | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { q: search } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(tab === 'batches'
        ? {
            inStockOnly: inStockOnly ? ('true' as const) : ('false' as const),
            includeExpired: includeExpired ? ('true' as const) : ('false' as const),
          }
        : {}),
      ...(tab === 'movements' && movementType ? { type: movementType } : {}),
    }),
    [page, search, warehouseId, inStockOnly, includeExpired, movementType, tab],
  );

  const batches = useQuery({
    queryKey: ['inventory', 'batches', params],
    queryFn: () => api.inventory.batches(params),
    enabled: tab === 'batches',
    placeholderData: (previous) => previous,
  });

  const stock = useQuery({
    queryKey: ['inventory', 'stock', params],
    queryFn: () => api.inventory.stock(params),
    enabled: tab === 'stock',
    placeholderData: (previous) => previous,
  });

  const movements = useQuery({
    queryKey: ['inventory', 'movements', params],
    queryFn: () => api.inventory.movements(params),
    enabled: tab === 'movements',
    placeholderData: (previous) => previous,
  });

  const createBatch = useMutation({
    mutationFn: (body: unknown) => api.inventory.createBatch(body),
    onSuccess: async () => {
      toast.success(t('inventory.batchCreated'));
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setFormOpen(false);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const deleteBatch = useMutation({
    mutationFn: (id: string) => api.inventory.deleteBatch(id),
    onSuccess: async (result) => {
      toast.success(result.deleted ? t('inventory.batchDeleted') : t('inventory.batchDeactivated'));
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setPendingDelete(null);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const alerts = useQuery({
    queryKey: ['inventory', 'alerts', warehouseId],
    queryFn: () => api.inventory.alerts(warehouseId || undefined),
    refetchInterval: 60_000,
  });

  const active = tab === 'batches' ? batches : tab === 'stock' ? stock : movements;
  const totalPages = active.data?.totalPages ?? 1;

  const resetTo = (next: TabKey): void => {
    setTab(next);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {([
            ['batches', t('inventory.batches'), Boxes],
            ['stock', t('inventory.stockLevels'), Warehouse],
            ['movements', t('inventory.movements'), CalendarClock],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => resetTo(key)}
              aria-current={tab === key ? 'true' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t('products.searchPlaceholder')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>

        <Select
          value={warehouseId}
          onChange={(event) => {
            setWarehouseId(event.target.value);
            setPage(1);
          }}
          className="w-48"
          aria-label={t('inventory.warehouse')}
        >
          <option value="">{t('inventory.warehouse')}: {t('common.all')}</option>
          {(warehouses.data ?? []).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.nameAr}
            </option>
          ))}
        </Select>

        {tab === 'batches' ? (
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={inStockOnly}
                onChange={(event) => {
                  setInStockOnly(event.target.checked);
                  setPage(1);
                }}
              />
              {t('inventory.inStockOnly')}
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={includeExpired}
                onChange={(event) => {
                  setIncludeExpired(event.target.checked);
                  setPage(1);
                }}
              />
              {t('inventory.includeExpired')}
            </label>
          </>
        ) : null}

        {tab === 'movements' ? (
          <Select
            value={movementType}
            onChange={(event) => {
              setMovementType(event.target.value as MovementType | '');
              setPage(1);
            }}
            className="w-48"
            aria-label={t('inventory.movementType')}
          >
            <option value="">{t('inventory.movementType')}: {t('common.all')}</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_TYPE_LABELS_AR[type]}
              </option>
            ))}
          </Select>
        ) : null}

        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTransferBatch(null);
              setTransferOpen(true);
            }}
          >
            <ArrowLeftRight className="h-4 w-4" />
            {t('inventory.transfer')}
          </Button>
        ) : null}

        {canWrite ? (
          <Button
            size="sm"
            disabled={createBatch.isPending}
            onClick={() => {
              setEditingBatch(null);
              setFormOpen(true);
            }}
          >
            {createBatch.isPending ? <Spinner className="h-3 w-3" /> : null}
            <Plus className="h-4 w-4" />
            {t('inventory.newBatch')}
          </Button>
        ) : null}

        <Button variant="outline" size="sm" onClick={() => void active.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{t('inventory.fefoHint')}</span>
        {alerts.data ? (
          <>
            <Badge variant={alerts.data.summary.expiredCount > 0 ? 'destructive' : 'outline'}>
              {t('dashboard.expired')}: {formatNumber(alerts.data.summary.expiredCount, tag)}
            </Badge>
            <Badge variant={alerts.data.summary.nearExpiryCount > 0 ? 'warning' : 'outline'}>
              {t('dashboard.nearExpiry')}: {formatNumber(alerts.data.summary.nearExpiryCount, tag)}
            </Badge>
            <Badge variant={alerts.data.summary.lowStockCount > 0 ? 'warning' : 'outline'}>
              {t('dashboard.lowStock')}: {formatNumber(alerts.data.summary.lowStockCount, tag)}
            </Badge>
          </>
        ) : null}
        {active.isFetching ? <Spinner className="h-3 w-3" /> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {active.isLoading ? <EmptyState message={t('common.loading')} /> : null}
        {active.isError ? <EmptyState message={t('errors.network')} /> : null}

        {tab === 'batches' && batches.data && batches.data.items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}
        {tab === 'stock' && stock.data && stock.data.items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}
        {tab === 'movements' && movements.data && movements.data.items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}

        {tab === 'batches' && batches.data && batches.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.sku')}</TableHead>
                <TableHead>{t('products.nameAr')}</TableHead>
                <TableHead>{t('inventory.lotNumber')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead className="text-center">{t('inventory.quantity')}</TableHead>
                <TableHead>{t('inventory.expiryDate')}</TableHead>
                <TableHead>{t('products.salePrice')}</TableHead>
                <TableHead>{t('inventory.value')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.data.items.map((batch) => {
                const severity = expirySeverity(batch.daysToExpiry);
                return (
                  <TableRow key={batch.batchId}>
                    <TableCell className="numeric font-medium" dir="ltr">
                      {batch.sku}
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <span className="block truncate">{batch.productNameAr}</span>
                    </TableCell>
                    <TableCell className="numeric text-xs" dir="ltr">
                      {batch.lotNumber}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {batch.warehouseNameAr}
                    </TableCell>
                    <TableCell className="numeric text-center font-semibold">
                      {formatNumber(batch.quantity, tag)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="numeric text-xs" dir="ltr">
                          {formatDate(batch.expiryDate, tag)}
                        </span>
                        <Badge variant={EXPIRY_BADGE[severity]} className="w-fit">
                          {expiryLabel(batch.daysToExpiry)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="numeric">{formatMoney(batch.salePrice, tag)}</TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {formatMoney(batch.stockValue, tag)}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {canRead ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('inventory.view')}
                            title={t('inventory.view')}
                            onClick={() => {
                              setViewingBatch(batch);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('inventory.transfer')}
                              title={t('inventory.transfer')}
                              disabled={batch.quantity <= 0}
                              onClick={() => {
                                setTransferBatch(batch);
                                setTransferOpen(true);
                              }}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                              onClick={() => {
                                setEditingBatch(batch);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('common.delete')}
                              title={t('common.delete')}
                              onClick={() => setPendingDelete(batch)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {tab === 'stock' && stock.data && stock.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.sku')}</TableHead>
                <TableHead>{t('products.nameAr')}</TableHead>
                <TableHead className="text-center">{t('inventory.quantity')}</TableHead>
                <TableHead className="text-center">{t('products.minStock')}</TableHead>
                <TableHead>{t('products.nearestExpiry')}</TableHead>
                <TableHead>{t('inventory.value')}</TableHead>
                <TableHead>{t('products.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.data.items.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell className="numeric font-medium" dir="ltr">
                    {row.sku}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <span className="block truncate">{row.nameAr}</span>
                  </TableCell>
                  <TableCell className="numeric text-center font-semibold">
                    {formatNumber(row.totalQuantity, tag)}
                  </TableCell>
                  <TableCell className="numeric text-center text-muted-foreground">
                    {formatNumber(row.minStock, tag)}
                  </TableCell>
                  <TableCell className="numeric text-xs">
                    {row.nearestExpiry ? formatDate(row.nearestExpiry, tag) : '—'}
                  </TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    {formatMoney(row.stockValue, tag)}
                  </TableCell>
                  <TableCell>
                    {row.isLowStock ? (
                      <Badge variant="warning">{t('dashboard.lowStock')}</Badge>
                    ) : (
                      <Badge variant="success">{t('products.active')}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {tab === 'movements' && movements.data && movements.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.date')}</TableHead>
                <TableHead>{t('products.sku')}</TableHead>
                <TableHead>{t('products.nameAr')}</TableHead>
                <TableHead>{t('inventory.movementType')}</TableHead>
                <TableHead className="text-center">{t('inventory.quantity')}</TableHead>
                <TableHead>{t('inventory.reference')}</TableHead>
                <TableHead>{t('inventory.user')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.data.items.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="numeric text-xs" dir="ltr">
                    {formatDateTime(movement.createdAt, tag)}
                  </TableCell>
                  <TableCell className="numeric text-xs" dir="ltr">
                    {movement.sku}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="block truncate">{movement.productNameAr}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {MOVEMENT_TYPE_LABELS_AR[movement.type as MovementType] ?? movement.type}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'numeric text-center font-semibold',
                      movement.quantity >= 0 ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {movement.quantity > 0 ? '+' : ''}
                    {formatNumber(movement.quantity, tag)}
                  </TableCell>
                  <TableCell className="numeric text-xs" dir="ltr">
                    {movement.reference ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {movement.userName ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t('common.previous')}
          </Button>
          <span className="numeric text-xs text-muted-foreground">
            {formatNumber(page, tag)} / {formatNumber(totalPages, tag)}
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

      <BatchFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        batch={editingBatch}
      />

      <BatchViewDialog
        open={viewingBatch !== null}
        onOpenChange={(open) => !open && setViewingBatch(null)}
        batch={viewingBatch}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={(open) => {
          setTransferOpen(open);
          if (!open) setTransferBatch(null);
        }}
        initialBatch={transferBatch}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent title={t('common.delete')} description={t('inventory.deleteConfirm')}>
          {pendingDelete ? (
            <p className="text-sm">
              <span className="font-semibold">{pendingDelete.productNameAr}</span>
              <span className="numeric ms-2 text-muted-foreground" dir="ltr">
                {pendingDelete.lotNumber}
              </span>
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBatch.isPending}
              onClick={() => pendingDelete && deleteBatch.mutate(pendingDelete.batchId)}
            >
              {deleteBatch.isPending ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
