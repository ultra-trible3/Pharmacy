import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CircleDollarSign,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Star,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { sumCurrency } from '@pharmacy/shared';
import { Badge, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { toast } from '../components/ui/toast';
import { WarehouseDetailsDialog } from '../components/warehouses/WarehouseDetailsDialog';
import { WarehouseFormDialog } from '../components/warehouses/WarehouseFormDialog';
import { api, type WarehouseDto } from '../lib/api';
import { formatMoney, formatNumber } from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../store/auth';
import { cn } from '../lib/utils';

/** Small debounce so typing in the search box does not hammer the API. */
function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}): ReactElement {
  return (
    <div className="rounded-[10px] border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <p className="mt-3 truncate text-xl font-semibold leading-tight">{value}</p>
      {hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CardSkeleton(): ReactElement {
  return (
    <div className="animate-pulse rounded-[10px] border border-border bg-card p-5 ps-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-md bg-muted" />
        <div className="flex-1 space-y-2">
          <span className="block h-4 w-2/3 rounded bg-muted" />
          <span className="block h-3 w-1/3 rounded bg-muted" />
        </div>
      </div>
      <span className="mt-4 block h-3 w-1/2 rounded bg-muted" />
      <div className="mt-5 grid grid-cols-3 gap-3">
        <span className="h-10 rounded bg-muted" />
        <span className="h-10 rounded bg-muted" />
        <span className="h-10 rounded bg-muted" />
      </div>
      <div className="mt-5 flex gap-2">
        <span className="h-8 w-20 rounded bg-muted" />
        <span className="h-8 w-20 rounded bg-muted" />
      </div>
    </div>
  );
}

export function WarehousesPage(): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();
  const canWrite = useAuthStore((state) => state.can('inventory:adjust'));
  const canViewCost = useAuthStore((state) => state.can('cost:view'));

  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseDto | null>(null);
  const [details, setDetails] = useState<WarehouseDto | null>(null);
  const [pendingToggle, setPendingToggle] = useState<WarehouseDto | null>(null);

  const debouncedSearch = useDebounced(search);

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'management', debouncedSearch, includeInactive],
    queryFn: () =>
      api.warehouses.list({
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        includeInactive,
        withStats: true,
      }),
    placeholderData: (previous) => previous,
  });

  const setDefault = useMutation({
    mutationFn: (warehouse: WarehouseDto) =>
      api.warehouses.update(warehouse.id, { isDefault: true }),
    onSuccess: async () => {
      toast.success(t('warehouses.defaultUpdated'));
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      setDetails(null);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const toggleActive = useMutation({
    mutationFn: (warehouse: WarehouseDto) =>
      api.warehouses.update(warehouse.id, { isActive: !warehouse.isActive }),
    onSuccess: async (updated) => {
      toast.success(updated.isActive ? t('warehouses.activated') : t('warehouses.deactivated'));
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      setPendingToggle(null);
    },
    // A 409 (default / stock / open shift / last active) keeps the dialog open
    // so the operator can read the server message and adjust their plan.
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    },
  });

  const items = warehousesQuery.data ?? [];
  const activeItems = items.filter((warehouse) => warehouse.isActive);
  const inactiveCount = items.length - activeItems.length;
  const defaultWarehouse = items.find((warehouse) => warehouse.isDefault && warehouse.isActive);
  const totalUnits = activeItems.reduce(
    (sum, warehouse) => sum + (warehouse.stats?.unitCount ?? 0),
    0,
  );
  const totalSkus = activeItems.reduce(
    (sum, warehouse) => sum + (warehouse.stats?.skuCount ?? 0),
    0,
  );
  const totalValue = sumCurrency(
    activeItems.map((warehouse) => warehouse.stats?.stockValue ?? '0.00'),
  );

  const hasSearch = debouncedSearch.trim().length > 0;

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (warehouse: WarehouseDto): void => {
    setDetails(null);
    setEditing(warehouse);
    setFormOpen(true);
  };

  const isDeactivating = pendingToggle?.isActive === true;

  return (
    <div className="space-y-4">
      <section className="rounded-[10px] border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
              <WarehouseIcon className="h-5 w-5" />
            </span>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t('warehouses.subtitle')}
            </p>
          </div>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void warehousesQuery.refetch()}
              disabled={warehousesQuery.isFetching}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', warehousesQuery.isFetching && 'animate-spin')}
              />
              {t('common.refresh')}
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('warehouses.new')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('warehouses.searchPlaceholder')}
              aria-label={t('common.search')}
              className="ps-9"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {t('warehouses.includeInactive')}
          </label>
        </div>
      </section>

      {warehousesQuery.isLoading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-[112px] animate-pulse rounded-[10px] border border-border bg-card p-4"
              >
                <span className="block h-3 w-1/2 rounded bg-muted" />
                <span className="mt-5 block h-6 w-2/3 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <CardSkeleton key={key} />
            ))}
          </div>
        </>
      ) : warehousesQuery.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <p className="text-base font-medium">{t('warehouses.loadError')}</p>
          <Button variant="outline" size="sm" onClick={() => void warehousesQuery.refetch()}>
            {t('warehouses.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div
            className={cn(
              'grid gap-3 sm:grid-cols-2',
              canViewCost ? 'xl:grid-cols-4' : 'xl:grid-cols-3',
            )}
          >
            <KpiCard
              icon={<WarehouseIcon className="h-3.5 w-3.5" />}
              label={t('warehouses.activeWarehouses')}
              value={<span className="numeric">{formatNumber(activeItems.length, tag)}</span>}
              hint={t('warehouses.inactiveCount', {
                count: formatNumber(inactiveCount, tag),
              })}
            />
            <KpiCard
              icon={<Star className="h-3.5 w-3.5" />}
              label={t('warehouses.defaultReceivingPoint')}
              value={
                defaultWarehouse ? (
                  <span className="text-base">{defaultWarehouse.nameAr}</span>
                ) : (
                  <span className="text-base text-muted-foreground">{t('warehouses.notSet')}</span>
                )
              }
              hint={
                defaultWarehouse ? (
                  <span className="numeric" dir="ltr">
                    {defaultWarehouse.code}
                  </span>
                ) : (
                  t('warehouses.defaultHint')
                )
              }
            />
            <KpiCard
              icon={<Boxes className="h-3.5 w-3.5" />}
              label={t('warehouses.totalUnits')}
              value={<span className="numeric">{formatNumber(totalUnits, tag)}</span>}
              hint={t('warehouses.unitsHint', { count: formatNumber(totalSkus, tag) })}
            />
            {canViewCost ? (
              <KpiCard
                icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                label={t('warehouses.inventoryValue')}
                value={<span className="numeric">{formatMoney(totalValue, tag)}</span>}
                hint={t('warehouses.valueHint')}
              />
            ) : null}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('warehouses.count', { count: formatNumber(items.length, tag) })}</span>
            {warehousesQuery.isFetching ? (
              <span className="flex items-center gap-1.5">
                <Spinner className="h-3 w-3" />
                {t('common.loading')}
              </span>
            ) : null}
          </div>

          {items.length === 0 ? (
            hasSearch ? (
              <div className="rounded-[10px] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
                <p className="text-base font-medium">{t('warehouses.noMatches')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('warehouses.searchPlaceholder')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearch('');
                    setIncludeInactive(false);
                  }}
                >
                  {t('warehouses.clearFilters')}
                </Button>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-border bg-card px-6 py-14 text-center">
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <WarehouseIcon className="h-8 w-8" />
                  <Boxes className="absolute -bottom-1 -end-1 h-6 w-6 rounded-md bg-card p-1 text-primary/70 shadow-sm" />
                  <ArrowLeftRight className="absolute -top-1 -start-1 h-6 w-6 rounded-md bg-card p-1 text-primary/50 shadow-sm" />
                </div>
                <h2 className="mt-4 text-base font-semibold">{t('warehouses.emptyTitle')}</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {t('warehouses.emptyDescription')}
                </p>
                {canWrite ? (
                  <Button className="mt-4" size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" />
                    {t('warehouses.new')}
                  </Button>
                ) : null}
              </div>
            )
          ) : (
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {items.map((warehouse) => {
                const stats = warehouse.stats;
                const nearExpiry = stats?.expiringSoonCount ?? 0;
                const expired = stats?.expiredCount ?? 0;
                return (
                  <article
                    key={warehouse.id}
                    aria-label={warehouse.nameAr}
                    className={cn(
                      'group relative flex flex-col overflow-hidden rounded-[10px] border p-5 ps-6 shadow-sm transition-all hover:border-primary/50 hover:shadow-md',
                      warehouse.isDefault
                        ? 'border-primary/40 bg-primary/[0.03]'
                        : 'border-border bg-card',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-y-0 start-0 w-1',
                        warehouse.isDefault
                          ? 'bg-primary'
                          : warehouse.isActive
                            ? 'bg-primary/30'
                            : 'border-e border-dashed border-muted-foreground/50 bg-transparent',
                      )}
                    />

                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <WarehouseIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h2 className="truncate text-base font-semibold">{warehouse.nameAr}</h2>
                          <span
                            className="numeric rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground"
                            dir="ltr"
                          >
                            {warehouse.code}
                          </span>
                        </div>
                        {warehouse.nameEn ? (
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {warehouse.nameEn}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {warehouse.isDefault ? (
                        <Badge variant="default">{t('warehouses.default')}</Badge>
                      ) : null}
                      {!warehouse.isActive ? (
                        <Badge variant="outline">{t('warehouses.inactive')}</Badge>
                      ) : null}
                      {(stats?.openShiftCount ?? 0) > 0 ? (
                        <Badge variant="warning">
                          <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-warning" />
                          {t('warehouses.openShift')}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="mt-3 flex min-h-[18px] items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {warehouse.address ?? t('warehouses.noAddress')}
                      </span>
                    </p>

                    <dl
                      className={cn(
                        'mt-4 grid gap-2 border-y border-border/70 py-3',
                        canViewCost ? 'grid-cols-4' : 'grid-cols-3',
                      )}
                    >
                      <div>
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('warehouses.skus')}
                        </dt>
                        <dd className="numeric mt-1 text-sm font-semibold">
                          {formatNumber(stats?.skuCount ?? 0, tag)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('warehouses.units')}
                        </dt>
                        <dd className="numeric mt-1 text-sm font-semibold">
                          {formatNumber(stats?.unitCount ?? 0, tag)}
                        </dd>
                      </div>
                      {canViewCost ? (
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t('warehouses.stockValue')}
                          </dt>
                          <dd className="numeric mt-1 truncate text-sm font-semibold">
                            {stats?.stockValue === null
                              ? '—'
                              : formatMoney(stats?.stockValue ?? '0.00', tag)}
                          </dd>
                        </div>
                      ) : null}
                      <div
                        title={
                          expired > 0
                            ? `${t('warehouses.expired')}: ${formatNumber(expired, tag)}`
                            : undefined
                        }
                      >
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('warehouses.nearExpiry')}
                        </dt>
                        <dd
                          className={cn(
                            'numeric mt-1 text-sm font-semibold',
                            nearExpiry > 0 ? 'text-warning' : 'text-muted-foreground',
                          )}
                        >
                          {formatNumber(nearExpiry, tag)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetails(warehouse)}
                      >
                        {t('warehouses.details')}
                      </Button>

                      {canWrite && !warehouse.isDefault && warehouse.isActive ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setDefault.isPending}
                          onClick={() => setDefault.mutate(warehouse)}
                        >
                          <Star className="h-3.5 w-3.5" />
                          {t('warehouses.setDefault')}
                        </Button>
                      ) : null}

                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(warehouse)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t('common.edit')}
                        </Button>
                      ) : null}

                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'ms-auto',
                            warehouse.isActive
                              ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                              : 'text-success hover:bg-success/10 hover:text-success',
                          )}
                          onClick={() => setPendingToggle(warehouse)}
                        >
                          {warehouse.isActive ? (
                            <PowerOff className="h-3.5 w-3.5" />
                          ) : (
                            <Power className="h-3.5 w-3.5" />
                          )}
                          {warehouse.isActive
                            ? t('warehouses.deactivate')
                            : t('warehouses.activate')}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <WarehouseFormDialog open={formOpen} onOpenChange={setFormOpen} warehouse={editing} />

      <WarehouseDetailsDialog
        warehouse={details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        canWrite={canWrite}
        canViewCost={canViewCost}
        onEdit={() => {
          if (details) openEdit(details);
        }}
        onSetDefault={() => {
          if (details) setDefault.mutate(details);
        }}
      />

      <Dialog
        open={pendingToggle !== null}
        onOpenChange={(open) => {
          if (!open && !toggleActive.isPending) setPendingToggle(null);
        }}
      >
        <DialogContent
          title={isDeactivating ? t('warehouses.deactivateTitle') : t('warehouses.activateTitle')}
          description={
            isDeactivating
              ? t('warehouses.deactivateDescription')
              : t('warehouses.activateDescription')
          }
        >
          {pendingToggle ? (
            <p className="text-sm">
              <span className="font-semibold">{pendingToggle.nameAr}</span>
              <span className="numeric ms-2 text-muted-foreground" dir="ltr">
                {pendingToggle.code}
              </span>
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={toggleActive.isPending}
              onClick={() => setPendingToggle(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant={isDeactivating ? 'destructive' : 'success'}
              disabled={toggleActive.isPending}
              onClick={() => {
                if (pendingToggle) toggleActive.mutate(pendingToggle);
              }}
            >
              {toggleActive.isPending ? (
                <Spinner className="border-white/40 border-t-white" />
              ) : null}
              {isDeactivating ? t('warehouses.deactivate') : t('warehouses.activate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
