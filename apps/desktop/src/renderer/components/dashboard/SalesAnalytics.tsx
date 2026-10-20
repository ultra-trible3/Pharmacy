import { Coins, ReceiptText, Percent, TrendingUp } from 'lucide-react';
import { type ReactElement } from 'react';
import type { PaymentMethodCode } from '@pharmacy/shared';
import { BarList, ChartLegend, DonutChart, TrendChart } from './charts';
import { Badge, EmptyState, Spinner } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import type { SaleDto, SalesReportDto } from '../../lib/api';
import { formatCompactNumber, formatDate, formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import type { PageKey } from '../layout/AppShell';

const PAYMENT_LABEL_KEYS: Record<PaymentMethodCode, TranslationKey> = {
  cash: 'pos.payment.cash',
  card: 'pos.payment.card',
  wallet: 'pos.payment.wallet',
  credit: 'pos.payment.credit',
};

const PAYMENT_COLORS: Record<PaymentMethodCode, string> = {
  cash: 'hsl(var(--primary))',
  card: 'hsl(var(--success))',
  wallet: 'hsl(var(--warning))',
  credit: 'hsl(var(--muted-foreground))',
};

const CURRENT_COLOR = 'hsl(var(--primary))';
const PREVIOUS_COLOR = 'hsl(var(--muted-foreground))';

interface SalesAnalyticsProps {
  report: SalesReportDto | undefined;
  isLoading: boolean;
  isError: boolean;
  canViewCost: boolean;
  recentSales: SaleDto[] | undefined;
  recentLoading: boolean;
  onNavigate: (page: PageKey) => void;
}

/** Sales half of the dashboard: trend vs previous period, profit, categories, products, payments. */
export function SalesAnalytics({
  report,
  isLoading,
  isError,
  canViewCost,
  recentSales,
  recentLoading,
  onNavigate,
}: SalesAnalyticsProps): ReactElement {
  const { t, tag } = useI18n();
  const loading = isLoading && !report;

  const trendLabels = (report?.daily ?? []).map((point) => formatDate(point.date, tag));
  const trendSeries = report
    ? [
        {
          name: t('dashboard.currentPeriod'),
          color: CURRENT_COLOR,
          values: report.daily.map((point) => Number(point.revenue)),
          area: true,
        },
        ...(report.dailyPrevious.length > 0
          ? [
              {
                name: t('dashboard.previousPeriod'),
                color: PREVIOUS_COLOR,
                values: report.dailyPrevious.map((point) => Number(point.revenue)),
                dashed: true,
              },
            ]
          : []),
      ]
    : [];
  const noSales =
    report !== undefined && report.transactions === 0 && Number(report.previous.revenue) === 0;

  const profit = report?.profit ?? null;
  const profitComposition = (() => {
    if (!profit) return null;
    const net = Number(profit.netRevenue);
    if (!Number.isFinite(net) || net <= 0) return null;
    const costPercent = Math.min(100, Math.max(0, (Number(profit.cogs) / net) * 100));
    return { costPercent, profitPercent: 100 - costPercent };
  })();

  const paymentSegments = (report?.payments ?? []).map((payment) => ({
    label: t(PAYMENT_LABEL_KEYS[payment.method]),
    value: Number(payment.amount),
    display: formatMoney(payment.amount, tag),
    color: PAYMENT_COLORS[payment.method],
  }));
  const paymentsTotal = (report?.payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );

  const categoryItems = (report?.byCategory ?? []).map((row) => ({
    label: row.nameAr ?? t('dashboard.uncategorized'),
    value: Number(row.revenue),
    display: formatMoney(row.revenue, tag),
    sublabel: `${formatNumber(row.units, tag)} ${t('dashboard.units')}`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{t('dashboard.salesTrend')}</CardTitle>
              {report ? (
                <CardDescription>
                  {t('dashboard.rangeDescription', {
                    from: formatDate(report.range.from, tag),
                    to: formatDate(report.range.to, tag),
                    days: report.range.days,
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
            {isError ? <EmptyState message={t('errors.network')} /> : null}
            {loading ? <Spinner /> : null}
            {!isError && noSales ? <EmptyState message={t('dashboard.noSalesInPeriod')} /> : null}
            {!isError && !loading && report && !noSales ? (
              <TrendChart
                labels={trendLabels}
                series={trendSeries}
                formatValue={(value) => formatMoney(String(value), tag)}
                formatAxis={(value) => formatCompactNumber(value, tag)}
              />
            ) : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {canViewCost && !isError ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{t('dashboard.grossProfit')}</CardTitle>
                {profit?.marginPct !== null && profit?.marginPct !== undefined ? (
                  <Badge
                    variant={profit.marginPct >= 0 ? 'success' : 'destructive'}
                    title={t('dashboard.margin')}
                  >
                    <Percent className="h-3 w-3" />
                    <span className="numeric">{formatNumber(profit.marginPct, tag)}%</span>
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? <Spinner /> : null}
                {!loading && profit ? (
                  <>
                    <p className="numeric text-2xl font-bold">
                      {formatMoney(profit.grossProfit, tag)}
                    </p>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('dashboard.netRevenue')}</span>
                        <span className="numeric font-semibold">
                          {formatMoney(profit.netRevenue, tag)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('dashboard.cogs')}</span>
                        <span className="numeric font-semibold">{formatMoney(profit.cogs, tag)}</span>
                      </div>
                    </div>

                    {profitComposition ? (
                      <div className="space-y-1.5">
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-warning"
                            style={{ width: `${profitComposition.costPercent}%` }}
                          />
                          <div
                            className="h-full bg-success"
                            style={{ width: `${profitComposition.profitPercent}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-success" />
                            {t('dashboard.grossProfit')}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-warning" />
                            {t('dashboard.cogs')}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <p className="text-[11px] text-muted-foreground">
                      {t('dashboard.previousPeriod')}: {formatMoney(profit.previous.grossProfit, tag)}
                      {profit.previous.marginPct !== null
                        ? ` • ${formatNumber(profit.previous.marginPct, tag)}%`
                        : ''}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t('dashboard.profitNote')}
                    </p>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                {t('dashboard.payments')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isError ? null : loading ? (
                <Spinner />
              ) : (
                <DonutChart
                  segments={paymentSegments}
                  centerLabel={t('common.total')}
                  centerValue={formatCompactNumber(paymentsTotal, tag)}
                  emptyMessage={t('dashboard.noSalesInPeriod')}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('dashboard.byCategory')}</CardTitle>
            <CardDescription>{t('dashboard.byCategoryHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (
              <BarList items={categoryItems} emptyMessage={t('dashboard.noSalesInPeriod')} />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t('dashboard.topProducts')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? null : loading ? (
              <Spinner />
            ) : (report?.topProducts.length ?? 0) === 0 ? (
              <EmptyState message={t('dashboard.noSalesInPeriod')} />
            ) : (
              <ul className="space-y-2">
                {(report?.topProducts ?? []).map((product, index) => (
                  <li key={product.productId} className="flex items-center gap-3">
                    <span className="numeric flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={product.nameAr}>
                        {product.nameAr}
                      </p>
                      <p className="numeric text-[11px] text-muted-foreground">
                        {product.sku} • {formatNumber(product.units, tag)} {t('dashboard.units')} •{' '}
                        {formatNumber(product.invoices, tag)} {t('dashboard.invoices')}
                      </p>
                    </div>
                    <span className="numeric shrink-0 text-sm font-semibold">
                      {formatMoney(product.revenue, tag)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-primary" />
              {t('dashboard.recentInvoices')}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('sales')}>
              {t('common.view')}
            </Button>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <Spinner />
            ) : (recentSales?.length ?? 0) === 0 ? (
              <EmptyState message={t('common.noData')} />
            ) : (
              <ul className="space-y-2">
                {(recentSales ?? []).map((sale) => (
                  <li key={sale.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="numeric truncate text-sm font-medium" dir="ltr" title={sale.invoiceNumber}>
                        {sale.invoiceNumber}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {sale.customer?.name ?? sale.user?.fullName ?? '—'} •{' '}
                        <span className="numeric">{formatDateTime(sale.createdAt, tag)}</span>
                      </p>
                    </div>
                    <span className="numeric shrink-0 text-sm font-semibold">
                      {formatMoney(sale.total, tag)}
                    </span>
                    <Badge variant={sale.status === 'completed' ? 'success' : sale.status === 'voided' ? 'destructive' : 'warning'}>
                      {t(
                        sale.status === 'completed'
                          ? 'sales.status.completed'
                          : sale.status === 'voided'
                            ? 'sales.status.voided'
                            : 'sales.status.suspended',
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
