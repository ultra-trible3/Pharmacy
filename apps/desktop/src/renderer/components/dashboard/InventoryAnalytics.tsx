import { Activity, CalendarClock, PackageSearch, PackageX } from 'lucide-react';
import { type ReactElement } from 'react';
import { BarList, DonutChart } from './charts';
import { Badge, EmptyState, Spinner } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import type { ExpiryBucketKey, InventoryReportDto } from '../../lib/api';
import { expiryLabel, formatDate, formatMoney, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import type { PageKey } from '../layout/AppShell';

const BUCKET_LABEL_KEYS: Record<ExpiryBucketKey, TranslationKey> = {
  expired: 'dashboard.bucketExpired',
  d30: 'dashboard.bucket0to30',
  d60: 'dashboard.bucket31to60',
  d90: 'dashboard.bucket61to90',
};

const BUCKET_TONES: Record<ExpiryBucketKey, 'destructive' | 'warning' | 'muted'> = {
  expired: 'destructive',
  d30: 'destructive',
  d60: 'warning',
  d90: 'warning',
};

interface InventoryAnalyticsProps {
  report: InventoryReportDto | undefined;
  isLoading: boolean;
  isError: boolean;
  onNavigate: (page: PageKey) => void;
}

/** Inventory half of the dashboard: valuation, health, expiry and movement. */
export function InventoryAnalytics({
  report,
  isLoading,
  isError,
  onNavigate,
}: InventoryAnalyticsProps): ReactElement {
  const { t, tag } = useI18n();
  const loading = isLoading && !report;

  const healthSegments = report
    ? [
        {
          label: t('dashboard.healthy'),
          value: report.health.healthy,
          display: formatNumber(report.health.healthy, tag),
          color: 'hsl(var(--success))',
        },
        {
          label: t('dashboard.lowStock'),
          value: report.health.low,
          display: formatNumber(report.health.low, tag),
          color: 'hsl(var(--warning))',
        },
        {
          label: t('dashboard.outOfStock'),
          value: report.health.out,
          display: formatNumber(report.health.out, tag),
          color: 'hsl(var(--destructive))',
        },
      ]
    : [];

  const bucketItems = (report?.expiryBuckets ?? []).map((bucket) => ({
    label: t(BUCKET_LABEL_KEYS[bucket.bucket]),
    value: bucket.batches,
    display: t('dashboard.batchesUnits', {
      batches: formatNumber(bucket.batches, tag),
      units: formatNumber(bucket.units, tag),
    }),
    sublabel: bucket.value !== null ? formatMoney(bucket.value, tag) : undefined,
    tone: BUCKET_TONES[bucket.bucket],
  }));

  const reorderItems = (report?.reorder ?? []).slice(0, 6).map((row) => ({
    label: row.nameAr,
    value: Math.max(0, row.minStock - row.totalQuantity),
    display: `${formatNumber(row.totalQuantity, tag)} / ${formatNumber(row.minStock, tag)}`,
    sublabel: row.sku,
    tone: row.totalQuantity <= 0 ? ('destructive' as const) : ('warning' as const),
  }));

  const hasCost = (report?.valueByCategory ?? []).some((row) => row.value !== null);
  const categoryItems = (report?.valueByCategory ?? []).map((row) => ({
    label: row.nameAr ?? t('dashboard.uncategorized'),
    value: Number(row.value ?? row.units),
    display:
      row.value !== null
        ? formatMoney(row.value, tag)
        : `${formatNumber(row.units, tag)} ${t('dashboard.units')}`,
    sublabel:
      row.value !== null ? `${formatNumber(row.units, tag)} ${t('dashboard.units')}` : undefined,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-primary" />
              {t('dashboard.stockHealth')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isError ? <EmptyState message={t('errors.network')} /> : null}
            {loading ? <Spinner /> : null}
            {!isError && !loading ? (
              <>
                <DonutChart
                  segments={healthSegments}
                  centerValue={formatNumber(report?.health.total ?? 0, tag)}
                  centerLabel={t('nav.products')}
                  size={132}
                  emptyMessage={t('common.noData')}
                />
                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t('dashboard.stockUnits')}</span>
                    <span className="numeric font-semibold">
                      {formatNumber(report?.stock.units ?? 0, tag)}
                    </span>
                  </div>
                  {report?.stock.costValue !== null && report?.stock.costValue !== undefined ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('dashboard.inventoryValueCost')}</span>
                      <span className="numeric font-semibold">
                        {formatMoney(report.stock.costValue, tag)}
                      </span>
                    </div>
                  ) : null}
                  {report?.stock.retailValue !== null && report?.stock.retailValue !== undefined ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('dashboard.inventoryValueRetail')}</span>
                      <span className="numeric font-semibold">
                        {formatMoney(report.stock.retailValue, tag)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageX className="h-4 w-4 text-warning" />
              {t('dashboard.stockExpiry')}
            </CardTitle>
            {report ? (
              <CardDescription>
                {t('dashboard.nearExpiryDays', { days: report.nearExpiryDays })}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (
              <BarList items={bucketItems} emptyMessage={t('dashboard.emptyAlerts')} />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('dashboard.reorderList')}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('inventory')}>
              {t('common.view')}
            </Button>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (
              <BarList items={reorderItems} emptyMessage={t('dashboard.emptyAlerts')} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-warning" />
              {t('dashboard.upcomingExpiries')}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('inventory')}>
              {t('common.view')}
            </Button>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (report?.upcomingExpiries.length ?? 0) === 0 ? (
              <EmptyState message={t('dashboard.emptyAlerts')} />
            ) : (
              <ul className="space-y-2">
                {(report?.upcomingExpiries ?? []).map((batch) => (
                  <li key={batch.batchId} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={batch.nameAr}>
                        {batch.nameAr}
                      </p>
                      <p className="numeric text-[11px] text-muted-foreground">
                        {batch.sku} • {batch.lotNumber} • {formatNumber(batch.quantity, tag)}{' '}
                        {t('dashboard.units')}
                        {batch.value !== null ? ` • ${formatMoney(batch.value, tag)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <Badge variant="warning">{expiryLabel(batch.daysToExpiry)}</Badge>
                      <p className="numeric mt-1 text-[10px] text-muted-foreground">
                        {formatDate(batch.expiryDate, tag)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              {hasCost ? t('dashboard.valueByCategory') : t('dashboard.valueByCategoryUnits')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (
              <BarList items={categoryItems} emptyMessage={t('dashboard.emptyAlerts')} />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              {t('dashboard.movement')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    {t('dashboard.fastMoving')}
                  </p>
                  {(report?.fastMoving.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('common.noData')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(report?.fastMoving ?? []).slice(0, 5).map((row) => (
                        <li key={row.productId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate" title={row.nameAr}>
                            {row.nameAr}
                          </span>
                          <span className="numeric shrink-0 text-xs text-muted-foreground">
                            {formatNumber(row.units, tag)} {t('dashboard.units')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    {t('dashboard.slowMoving')}
                  </p>
                  {(report?.slowMoving.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('common.noData')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(report?.slowMoving ?? []).slice(0, 5).map((row) => (
                        <li key={row.productId} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate" title={row.nameAr}>
                              {row.nameAr}
                            </span>
                            <span className="numeric shrink-0 text-xs text-muted-foreground">
                              {formatNumber(row.totalQuantity, tag)}
                            </span>
                          </div>
                          <p className="numeric text-[10px] text-muted-foreground">
                            {row.units30d === 0
                              ? t('dashboard.neverSoldPeriod')
                              : `${formatNumber(row.units30d, tag)} ${t('dashboard.units')}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
