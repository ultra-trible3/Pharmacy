import { CalendarDays, PackageSearch } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { BarList, ChartLegend, TrendChart } from './charts';
import { EmptyState, Spinner } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { InventoryReportDto, SalesReportDto } from '../../lib/api';
import { formatCompactNumber, formatDate, formatMoney, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';

const CURRENT_COLOR = 'hsl(var(--primary))';
const PREVIOUS_COLOR = 'hsl(var(--muted-foreground))';

/** Weekday index 0 = Sunday; 2024-01-07 was a Sunday in UTC. */
const WEEKDAY_REFERENCE_UTC = Date.UTC(2024, 0, 7);
const DAY_MS = 86_400_000;

interface OverviewAnalyticsProps {
  sales: SalesReportDto | undefined;
  inventory: InventoryReportDto | undefined;
  canSales: boolean;
  canInventory: boolean;
  salesLoading: boolean;
  salesError: boolean;
  inventoryLoading: boolean;
  inventoryError: boolean;
}

/**
 * Overview-tab charts: the revenue trend for the selected range plus two
 * at-a-glance breakdowns (stock value by category, revenue by weekday).
 * Alerts and low-stock worklists live on the Alerts page.
 */
export function OverviewAnalytics({
  sales,
  inventory,
  canSales,
  canInventory,
  salesLoading,
  salesError,
  inventoryLoading,
  inventoryError,
}: OverviewAnalyticsProps): ReactElement {
  const { t, tag } = useI18n();

  const trendLabels = (sales?.daily ?? []).map((point) => formatDate(point.date, tag));
  const trendSeries = sales
    ? [
        {
          name: t('dashboard.currentPeriod'),
          color: CURRENT_COLOR,
          values: sales.daily.map((point) => Number(point.revenue)),
          area: true,
        },
        ...(sales.dailyPrevious.length > 0
          ? [
              {
                name: t('dashboard.previousPeriod'),
                color: PREVIOUS_COLOR,
                values: sales.dailyPrevious.map((point) => Number(point.revenue)),
                dashed: true,
              },
            ]
          : []),
      ]
    : [];
  const noSales =
    sales !== undefined && sales.transactions === 0 && Number(sales.previous.revenue) === 0;

  // Revenue per weekday over the selected range — shows which days carry the week.
  const weekdayItems = useMemo(() => {
    if (!sales) return [];
    const weekdayName = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' });
    const buckets = Array.from({ length: 7 }, () => ({ revenue: 0, invoices: 0 }));
    for (const point of sales.daily) {
      const day = new Date(`${point.date.slice(0, 10)}T00:00:00Z`).getUTCDay();
      const bucket = buckets[day];
      if (!bucket) continue;
      bucket.revenue += Number(point.revenue);
      bucket.invoices += point.transactions;
    }
    return buckets
      .map((bucket, index) => ({
        label: weekdayName.format(new Date(WEEKDAY_REFERENCE_UTC + index * DAY_MS)),
        value: bucket.revenue,
        display: formatMoney(bucket.revenue.toFixed(2), tag),
        sublabel: `${formatNumber(bucket.invoices, tag)} ${t('dashboard.invoices')}`,
      }))
      .filter((row) => row.value > 0);
  }, [sales, tag, t]);

  const hasCost = (inventory?.valueByCategory ?? []).some((row) => row.value !== null);
  const categoryItems = (inventory?.valueByCategory ?? []).map((row) => ({
    label: row.nameAr ?? t('dashboard.uncategorized'),
    value: Number(row.value ?? row.units),
    display:
      row.value !== null
        ? formatMoney(row.value, tag)
        : `${formatNumber(row.units, tag)} ${t('dashboard.units')}`,
    sublabel:
      row.value !== null ? `${formatNumber(row.units, tag)} ${t('dashboard.units')}` : undefined,
  }));

  const showBreakdowns = canSales || canInventory;

  return (
    <div className="space-y-4">
      {canSales ? (
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{t('dashboard.salesTrend')}</CardTitle>
              {sales ? (
                <CardDescription>
                  {t('dashboard.rangeDescription', {
                    from: formatDate(sales.range.from, tag),
                    to: formatDate(sales.range.to, tag),
                    days: sales.range.days,
                  })}
                </CardDescription>
              ) : null}
            </div>
            <ChartLegend
              items={[
                { name: t('dashboard.currentPeriod'), color: CURRENT_COLOR },
                { name: t('dashboard.previousPeriod'), color: PREVIOUS_COLOR, dashed: true },
              ]}
            />
          </CardHeader>
          <CardContent>
            {salesError ? <EmptyState message={t('errors.network')} /> : null}
            {salesLoading ? <Spinner /> : null}
            {!salesError && !salesLoading && noSales ? (
              <EmptyState message={t('dashboard.noSalesInPeriod')} />
            ) : null}
            {!salesError && !salesLoading && sales && !noSales ? (
              <TrendChart
                labels={trendLabels}
                series={trendSeries}
                formatValue={(value) => formatMoney(String(value), tag)}
                formatAxis={(value) => formatCompactNumber(value, tag)}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showBreakdowns ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {canInventory ? (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PackageSearch className="h-4 w-4 text-primary" />
                  {hasCost ? t('dashboard.valueByCategory') : t('dashboard.valueByCategoryUnits')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {inventoryError ? (
                  <EmptyState message={t('errors.network')} />
                ) : inventoryLoading ? (
                  <Spinner />
                ) : (
                  <BarList items={categoryItems} emptyMessage={t('common.noData')} />
                )}
              </CardContent>
            </Card>
          ) : null}

          {canSales ? (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {t('dashboard.weekdayProfile')}
                </CardTitle>
                <CardDescription>{t('dashboard.weekdayProfileHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                {salesError ? (
                  <EmptyState message={t('errors.network')} />
                ) : salesLoading ? (
                  <Spinner />
                ) : (
                  <BarList items={weekdayItems} emptyMessage={t('dashboard.noSalesInPeriod')} />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
