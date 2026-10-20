import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  HandCoins,
  PackageX,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { type ReactElement } from 'react';
import { KpiCard } from '../components/dashboard/KpiCard';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { expiryLabel, formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../store/auth';
import type { PageKey } from '../components/layout/AppShell';

/**
 * Alerts worklist — everything the dashboard overview used to surface as an
 * alert strip, with the full lists instead of a five-row preview: expired and
 * near-expiry batches, low/out-of-stock products and supplier payables. Every
 * row navigates to the screen that can resolve it.
 */
export function AlertsPage({
  onNavigate,
}: {
  onNavigate: (page: PageKey) => void;
}): ReactElement {
  const { t, tag } = useI18n();
  const canInventory = useAuthStore((state) => state.can('inventory:read'));
  const canSuppliers = useAuthStore((state) => state.can('suppliers:read'));

  const alerts = useQuery({
    queryKey: ['inventory', 'alerts'],
    queryFn: () => api.inventory.alerts(),
    enabled: canInventory,
    refetchInterval: 60_000,
  });

  // Reuses the suppliers cache key already used by the dashboard/purchases page.
  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.suppliers.list({ pageSize: 200 }),
    enabled: canSuppliers,
    staleTime: 60_000,
  });

  const owing = [...(suppliers.data?.items ?? [])]
    .filter((supplier) => Number(supplier.balance) > 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance));
  const payablesTotal = owing.reduce((sum, supplier) => sum + Number(supplier.balance), 0);

  const expired = alerts.data?.expired ?? [];
  const nearExpiry = alerts.data?.nearExpiry ?? [];
  const lowStock = [...(alerts.data?.lowStock ?? [])].sort(
    (a, b) => a.totalQuantity - b.totalQuantity,
  );
  const expiredCount = alerts.data?.summary.expiredCount ?? expired.length;
  const nearExpiryCount = alerts.data?.summary.nearExpiryCount ?? nearExpiry.length;
  const lowStockCount = alerts.data?.summary.lowStockCount ?? lowStock.length;
  const outOfStockCount = lowStock.filter((row) => row.totalQuantity <= 0).length;

  const loading = alerts.isLoading || (canSuppliers && suppliers.isLoading);
  const empty =
    !loading &&
    !alerts.isError &&
    expired.length === 0 &&
    nearExpiry.length === 0 &&
    lowStock.length === 0 &&
    owing.length === 0;

  const refresh = (): void => {
    void alerts.refetch();
    if (canSuppliers) void suppliers.refetch();
  };

  const sectionHeader = (
    icon: ReactElement,
    label: string,
    count: number,
  ): ReactElement => (
    <CardHeader className="flex-row items-center justify-between">
      <CardTitle className="flex items-center gap-2">
        {icon}
        {label}
        <Badge variant="outline" className="numeric">
          {formatNumber(count, tag)}
        </Badge>
      </CardTitle>
      <Button variant="ghost" size="sm" onClick={() => onNavigate('inventory')}>
        {t('common.view')}
      </Button>
    </CardHeader>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.alerts')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('alerts.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          {alerts.data ? (
            <span className="numeric hidden text-xs text-muted-foreground sm:inline">
              {t('alerts.updatedAt', { time: formatDateTime(alerts.data.generatedAt, tag) })}
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={refresh} disabled={alerts.isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', alerts.isFetching && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {alerts.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.network')}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('dashboard.expired')}
          value={formatNumber(expiredCount, tag)}
          icon={AlertTriangle}
          tone={expiredCount > 0 ? 'destructive' : 'success'}
          locale={tag}
        />
        <KpiCard
          title={`${t('dashboard.nearExpiry')} (${alerts.data?.nearExpiryDays ?? 90})`}
          value={formatNumber(nearExpiryCount, tag)}
          icon={CalendarClock}
          tone={nearExpiryCount > 0 ? 'warning' : 'success'}
          locale={tag}
        />
        <KpiCard
          title={t('dashboard.lowStock')}
          value={formatNumber(lowStockCount, tag)}
          hint={t('dashboard.lowStockDetail', { count: formatNumber(outOfStockCount, tag) })}
          icon={PackageX}
          tone={lowStockCount > 0 ? 'warning' : 'success'}
          locale={tag}
        />
        {canSuppliers ? (
          <KpiCard
            title={t('dashboard.supplierPayables')}
            value={formatMoney(payablesTotal.toFixed(2), tag)}
            hint={t('alerts.suppliersOwing', { count: formatNumber(owing.length, tag) })}
            icon={HandCoins}
            tone={payablesTotal > 0 ? 'warning' : 'success'}
            locale={tag}
          />
        ) : null}
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <Spinner />
          </CardContent>
        </Card>
      ) : null}

      {empty ? (
        <Card>
          <CardContent>
            <EmptyState message={t('dashboard.emptyAlerts')} />
          </CardContent>
        </Card>
      ) : null}

      {expired.length > 0 ? (
        <Card>
          {sectionHeader(
            <AlertTriangle className="h-4 w-4 text-destructive" />,
            t('dashboard.expired'),
            expiredCount,
          )}
          <CardContent className="space-y-2">
            {expired.map((batch) => (
              <button
                key={batch.batchId}
                type="button"
                onClick={() => onNavigate('inventory')}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-start transition-colors hover:bg-destructive/10"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{batch.productNameAr}</span>
                  <span className="numeric block text-[11px] text-muted-foreground">
                    {batch.sku} • {batch.lotNumber} • {formatDate(batch.expiryDate, tag)} •{' '}
                    {formatNumber(batch.quantity, tag)} {t('dashboard.units')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="numeric text-sm font-semibold">
                    {formatMoney(batch.stockValue, tag)}
                  </span>
                  <Badge variant="destructive">{t('inventory.expired')}</Badge>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {nearExpiry.length > 0 ? (
        <Card>
          {sectionHeader(
            <CalendarClock className="h-4 w-4 text-warning" />,
            t('dashboard.nearExpiry'),
            nearExpiryCount,
          )}
          <CardContent className="space-y-2">
            {nearExpiry.map((batch) => (
              <button
                key={batch.batchId}
                type="button"
                onClick={() => onNavigate('inventory')}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-start transition-colors hover:bg-warning/10"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{batch.productNameAr}</span>
                  <span className="numeric block text-[11px] text-muted-foreground">
                    {batch.sku} • {batch.lotNumber} • {formatDate(batch.expiryDate, tag)} •{' '}
                    {formatNumber(batch.quantity, tag)} {t('dashboard.units')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="numeric text-sm font-semibold">
                    {formatMoney(batch.stockValue, tag)}
                  </span>
                  <Badge variant="warning">{expiryLabel(batch.daysToExpiry)}</Badge>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {lowStock.length > 0 ? (
        <Card>
          {sectionHeader(
            <PackageX className="h-4 w-4 text-warning" />,
            t('dashboard.lowStock'),
            lowStockCount,
          )}
          <CardContent className="space-y-2">
            {lowStock.map((row) => (
              <button
                key={row.productId}
                type="button"
                onClick={() => onNavigate('inventory')}
                className={cn(
                  'focus-ring flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-start transition-colors',
                  row.totalQuantity <= 0
                    ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                    : 'border-warning/30 bg-warning/5 hover:bg-warning/10',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{row.nameAr}</span>
                  <span className="numeric block text-[11px] text-muted-foreground">
                    {row.sku} • {formatNumber(row.totalQuantity, tag)} /{' '}
                    {formatNumber(row.minStock, tag)}
                    {row.nearestExpiry ? ` • ${formatDate(row.nearestExpiry, tag)}` : ''}
                  </span>
                </span>
                {row.totalQuantity <= 0 ? (
                  <Badge variant="destructive">{t('dashboard.outOfStock')}</Badge>
                ) : (
                  <Badge variant="warning">{t('dashboard.lowStock')}</Badge>
                )}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {owing.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              {t('dashboard.supplierPayables')}
              <Badge variant="outline" className="numeric">
                {formatNumber(owing.length, tag)}
              </Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('suppliers')}>
              {t('common.view')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {owing.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => onNavigate('suppliers')}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-start transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{supplier.nameAr}</span>
                  <span className="numeric block text-[11px] text-muted-foreground">
                    {supplier.code}
                    {supplier.phone ? ` • ${supplier.phone}` : ''}
                  </span>
                </span>
                <span className="numeric shrink-0 text-sm font-semibold">
                  {formatMoney(supplier.balance, tag)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
