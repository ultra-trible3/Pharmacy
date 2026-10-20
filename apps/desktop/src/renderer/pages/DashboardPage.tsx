import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  Box,
  Boxes,
  CalendarClock,
  Coins,
  FileDown,
  FileSpreadsheet,
  HandCoins,
  LayoutDashboard,
  Loader2,
  PackagePlus,
  Pill,
  Receipt,
  RefreshCw,
  Server,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { DashboardReportDialog } from '../components/dashboard/DashboardReportDialog';
import { InventoryAnalytics } from '../components/dashboard/InventoryAnalytics';
import { KpiCard } from '../components/dashboard/KpiCard';
import { OverviewAnalytics } from '../components/dashboard/OverviewAnalytics';
import { SalesAnalytics } from '../components/dashboard/SalesAnalytics';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from '../components/ui/toast';
import { api } from '../lib/api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import {
  DEFAULT_RANGE_PRESET,
  dashboardFileName,
  presetRange,
  rangeDayCount,
  type DateRange,
  type RangePreset,
} from '../lib/reportRange';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuthStore } from '../store/auth';
import type { PageKey } from '../components/layout/AppShell';

const RANGE_PRESET_ORDER: RangePreset[] = ['today', 'last7', 'last30', 'thisMonth', 'custom'];

const RANGE_LABEL_KEYS: Record<RangePreset, TranslationKey> = {
  today: 'dashboard.range.today',
  last7: 'dashboard.range.last7',
  last30: 'dashboard.range.last30',
  thisMonth: 'dashboard.range.thisMonth',
  custom: 'dashboard.range.custom',
};

type DashboardTab = 'overview' | 'sales' | 'inventory';

const DASHBOARD_TABS: Array<{ key: DashboardTab; labelKey: TranslationKey; icon: LucideIcon }> = [
  { key: 'overview', labelKey: 'dashboard.tabOverview', icon: LayoutDashboard },
  { key: 'sales', labelKey: 'dashboard.tabSales', icon: TrendingUp },
  { key: 'inventory', labelKey: 'dashboard.tabInventory', icon: Boxes },
];

interface RangeSelectorProps {
  preset: RangePreset;
  range: DateRange;
  refreshing: boolean;
  onPreset: (preset: RangePreset) => void;
  onCustomChange: (range: DateRange) => void;
  onRefresh: () => void;
}

/** Segmented date-range control (Today / 7 / 30 / month / custom) + refresh. */
function RangeSelector({
  preset,
  range,
  refreshing,
  onPreset,
  onCustomChange,
  onRefresh,
}: RangeSelectorProps): ReactElement {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-input bg-card p-0.5" role="group">
        {RANGE_PRESET_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onPreset(option)}
            className={cn(
              'focus-ring rounded px-2.5 py-1 text-xs font-medium transition-colors',
              preset === option
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(RANGE_LABEL_KEYS[option])}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={range.from}
            max={range.to}
            aria-label={t('dashboard.from')}
            onChange={(event) => {
              if (event.target.value) onCustomChange({ ...range, from: event.target.value });
            }}
            className="focus-ring h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">{t('dashboard.to')}</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            aria-label={t('dashboard.to')}
            onChange={(event) => {
              if (event.target.value) onCustomChange({ ...range, to: event.target.value });
            }}
            className="focus-ring h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
        </div>
      ) : null}

      <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        {t('common.refresh')}
      </Button>
    </div>
  );
}

/**
 * Dashboard: a command bar (tabs, date range, PDF/Excel export) over three
 * views — overview (KPIs + charts + quick actions), sales analytics and
 * inventory analytics. Every number comes from live aggregate endpoints —
 * `/reports/sales`, `/reports/inventory` and `/health` — and the selected date
 * range drives all sales KPIs and charts consistently. Operational worklists
 * (expired, low stock, supplier payables) live on the Alerts page.
 */
export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (page: PageKey) => void;
}): ReactElement {
  const { t, tag } = useI18n();
  const can = useAuthStore((state) => state.can);

  const [preset, setPreset] = useState<RangePreset>(DEFAULT_RANGE_PRESET);
  const [customRange, setCustomRange] = useState<DateRange>(() => presetRange('last7'));
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [reportOpen, setReportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const range = useMemo(
    () => (preset === 'custom' ? customRange : presetRange(preset)),
    [preset, customRange],
  );

  const canSales = can('sales:read');
  const canInventory = can('inventory:read');
  const canCost = can('cost:view');

  const salesReport = useQuery({
    queryKey: ['reports', 'sales', range.from, range.to],
    queryFn: () => api.reports.sales(range),
    enabled: canSales,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const inventoryReport = useQuery({
    queryKey: ['reports', 'inventory'],
    queryFn: () => api.reports.inventory(),
    enabled: canInventory,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 30_000,
    retry: false,
  });

  const recentSales = useQuery({
    queryKey: ['dashboard', 'recent-sales'],
    queryFn: () => api.sales.list({ page: 1, pageSize: 5 }),
    enabled: canSales,
    staleTime: 30_000,
  });

  const refreshing =
    salesReport.isRefetching || inventoryReport.isRefetching || health.isRefetching;
  const refreshAll = (): void => {
    void salesReport.refetch();
    void inventoryReport.refetch();
    void health.refetch();
    if (canSales) void recentSales.refetch();
  };

  const salesData = salesReport.data;
  const inventoryData = inventoryReport.data;

  const nearExpiryBatches = inventoryData?.expiryBuckets
    .filter((bucket) => bucket.bucket !== 'expired')
    .reduce((sum, bucket) => sum + bucket.batches, 0);
  const expiredBatches = inventoryData?.expiryBuckets.find(
    (bucket) => bucket.bucket === 'expired',
  )?.batches;

  const rangeDescription = t('dashboard.rangeDescription', {
    from: formatDate(range.from, tag),
    to: formatDate(range.to, tag),
    days: rangeDayCount(range),
  });

  // Tabs the current role may open; the active one always falls back to the
  // overview when permissions change.
  const visibleTabs = DASHBOARD_TABS.filter((item) =>
    item.key === 'sales' ? canSales : item.key === 'inventory' ? canInventory : true,
  );
  const activeTab = visibleTabs.some((item) => item.key === tab) ? tab : 'overview';

  const hasExportData = Boolean(salesData || inventoryData);
  const exportDisabled = !hasExportData || exporting;

  const exportExcel = async (): Promise<void> => {
    if (!hasExportData) return;
    setExporting(true);
    try {
      const { buildDashboardSheets, downloadDashboardExcel } = await import(
        '../lib/dashboardExcel'
      );
      const now = new Date();
      const sheets = buildDashboardSheets({
        sales: salesData ?? null,
        inventory: inventoryData ?? null,
        canViewCost: canCost,
        t,
        tag,
        generatedAt: now,
      });
      await downloadDashboardExcel(
        sheets,
        t,
        dashboardFileName(salesData ? salesData.range : null, now, 'xlsx'),
      );
      toast.success(t('dashboard.exportExcelDone'));
    } catch (error) {
      console.error('Dashboard Excel export failed:', error);
      toast.error(t('dashboard.exportExcelFailed'));
    } finally {
      setExporting(false);
    }
  };

  const renderSalesKpis = (): ReactElement => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title={t('dashboard.revenue')}
        value={formatMoney(salesData?.revenue, tag)}
        delta={salesData ? salesData.growth.revenuePct : null}
        deltaTitle={t('dashboard.vsPrevious')}
        hint={
          salesData
            ? `${t('dashboard.previousPeriod')}: ${formatMoney(salesData.previous.revenue, tag)}`
            : undefined
        }
        icon={Banknote}
      />
      <KpiCard
        title={t('dashboard.transactions')}
        value={formatNumber(salesData?.transactions, tag)}
        delta={salesData ? salesData.growth.transactionsPct : null}
        deltaTitle={t('dashboard.vsPrevious')}
        hint={
          salesData
            ? `${formatNumber(salesData.itemsSold, tag)} ${t('dashboard.units')}`
            : undefined
        }
        icon={Receipt}
      />
      <KpiCard
        title={t('dashboard.avgTicket')}
        value={formatMoney(salesData?.avgTicket, tag)}
        icon={TrendingUp}
      />
      {canCost ? (
        <KpiCard
          title={t('dashboard.grossProfit')}
          value={formatMoney(salesData?.profit?.grossProfit, tag)}
          hint={
            salesData?.profit && salesData.profit.marginPct !== null
              ? `${t('dashboard.margin')}: ${formatNumber(salesData.profit.marginPct, tag)}%`
              : undefined
          }
          icon={Coins}
          tone="success"
          locale={tag}
        />
      ) : null}
    </div>
  );

  const renderInventoryKpis = (): ReactElement => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        title={`${t('dashboard.nearExpiry')} (${inventoryData?.nearExpiryDays ?? 90})`}
        value={formatNumber(nearExpiryBatches, tag)}
        icon={CalendarClock}
        tone={(nearExpiryBatches ?? 0) > 0 ? 'warning' : 'success'}
      />
      <KpiCard
        title={t('dashboard.expired')}
        value={formatNumber(expiredBatches, tag)}
        icon={AlertTriangle}
        tone={(expiredBatches ?? 0) > 0 ? 'destructive' : 'success'}
      />
      <KpiCard
        title={t('dashboard.inventoryValue')}
        value={
          inventoryData?.stock.costValue
            ? formatMoney(inventoryData.stock.costValue, tag)
            : formatNumber(inventoryData?.stock.units, tag)
        }
        hint={
          inventoryData?.stock.costValue
            ? t('dashboard.inventoryValueCost')
            : t('dashboard.stockUnits')
        }
        icon={Boxes}
      />
    </div>
  );

  /** Overview charts run beside the ops rail (server status + quick actions). */
  const renderOverviewBoard = (): ReactElement => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <OverviewAnalytics
          sales={salesData}
          inventory={inventoryData}
          canSales={canSales}
          canInventory={canInventory}
          salesLoading={salesReport.isLoading}
          salesError={salesReport.isError}
          inventoryLoading={inventoryReport.isLoading}
          inventoryError={inventoryReport.isError}
        />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.serverStatus')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              {health.data?.reachable ? (
                <Badge variant="success">{t('dashboard.connected')}</Badge>
              ) : (
                <Badge variant="destructive">{t('dashboard.disconnected')}</Badge>
              )}
            </div>
            {health.data?.latencyMs !== undefined ? (
              <p className="numeric text-xs text-muted-foreground">
                {health.data.latencyMs} ms
              </p>
            ) : null}
            {health.data?.error ? (
              <p className="text-xs text-destructive">{health.data.error}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.quickActions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {can('products:read') ? (
              <Button variant="outline" onClick={() => onNavigate('pos')}>
                <Box className="h-4 w-4" />
                {t('nav.pos')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => onNavigate('products')}>
              <Pill className="h-4 w-4" />
              {t('dashboard.openProducts')}
            </Button>
            <Button variant="outline" onClick={() => onNavigate('inventory')}>
              <Boxes className="h-4 w-4" />
              {t('dashboard.openInventory')}
            </Button>
            {canSales ? (
              <Button variant="outline" onClick={() => onNavigate('debts')}>
                <HandCoins className="h-4 w-4" />
                {t('nav.debts')}
              </Button>
            ) : null}
            {can('purchases:read') ? (
              <Button variant="outline" onClick={() => onNavigate('purchases')}>
                <PackagePlus className="h-4 w-4" />
                {t('nav.purchases')}
              </Button>
            ) : null}
            {canInventory ? (
              <Button variant="outline" onClick={() => onNavigate('alerts')}>
                <AlertTriangle className="h-4 w-4" />
                {t('nav.alerts')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div
            role="tablist"
            aria-label={t('dashboard.title')}
            className="inline-flex w-fit rounded-lg border border-input bg-card p-0.5 shadow-sm"
          >
            {visibleTabs.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`dashboard-tab-${key}`}
                aria-selected={activeTab === key}
                aria-controls={`dashboard-panel-${key}`}
                onClick={() => setTab(key)}
                className={cn(
                  'focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  activeTab === key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{rangeDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RangeSelector
            preset={preset}
            range={range}
            refreshing={refreshing}
            onPreset={setPreset}
            onCustomChange={(next) => {
              setPreset('custom');
              setCustomRange(next);
            }}
            onRefresh={refreshAll}
          />
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReportOpen(true)}
            disabled={!hasExportData}
            title={hasExportData ? undefined : t('dashboard.exportNoData')}
          >
            <FileDown className="h-3.5 w-3.5" />
            {t('dashboard.exportPdf')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportExcel()}
            disabled={exportDisabled}
            title={hasExportData ? undefined : t('dashboard.exportNoData')}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            {t('dashboard.exportExcel')}
          </Button>
        </div>
      </div>

      {salesReport.isError || inventoryReport.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.network')}
        </p>
      ) : null}

      {activeTab === 'overview' ? (
        <div
          role="tabpanel"
          id="dashboard-panel-overview"
          aria-labelledby="dashboard-tab-overview"
          className="space-y-5"
        >
          {canSales ? renderSalesKpis() : null}
          {canInventory ? renderInventoryKpis() : null}
          {renderOverviewBoard()}
        </div>
      ) : null}

      {activeTab === 'sales' && canSales ? (
        <div
          role="tabpanel"
          id="dashboard-panel-sales"
          aria-labelledby="dashboard-tab-sales"
          className="space-y-5"
        >
          {renderSalesKpis()}
          <SalesAnalytics
            report={salesData}
            isLoading={salesReport.isLoading}
            isError={salesReport.isError}
            canViewCost={canCost}
            recentSales={recentSales.data?.items}
            recentLoading={recentSales.isLoading}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}

      {activeTab === 'inventory' && canInventory ? (
        <div
          role="tabpanel"
          id="dashboard-panel-inventory"
          aria-labelledby="dashboard-tab-inventory"
          className="space-y-5"
        >
          {renderInventoryKpis()}
          <InventoryAnalytics
            report={inventoryData}
            isLoading={inventoryReport.isLoading}
            isError={inventoryReport.isError}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}

      <DashboardReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        sales={salesData ?? null}
        inventory={inventoryData ?? null}
        canViewCost={canCost}
        rangeLabel={rangeDescription}
        range={range}
      />
    </div>
  );
}
