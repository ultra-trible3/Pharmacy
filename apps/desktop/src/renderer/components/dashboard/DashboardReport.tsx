import type { ReactElement } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import type { TranslationKey } from '../../i18n/dictionaries';
import type { PaymentMethodCode } from '@pharmacy/shared';
import type { InventoryReportDto, SalesReportDto } from '../../lib/api';

const PAYMENT_LABEL_KEYS: Record<PaymentMethodCode, TranslationKey> = {
  cash: 'pos.payment.cash',
  card: 'pos.payment.card',
  wallet: 'pos.payment.wallet',
  credit: 'pos.payment.credit',
};

const BUCKET_LABEL_KEYS: Record<string, TranslationKey> = {
  expired: 'dashboard.bucketExpired',
  d30: 'dashboard.bucket0to30',
  d60: 'dashboard.bucket31to60',
  d90: 'dashboard.bucket61to90',
};

function ReportKpi({
  labelText,
  value,
  hint,
}: {
  labelText: string;
  value: string;
  hint?: string;
}): ReactElement {
  return (
    <div className="dr-kpi">
      <p className="dr-kpi-label">{labelText}</p>
      <p className="dr-kpi-value numeric">{value}</p>
      {hint ? <p className="dr-hint">{hint}</p> : null}
    </div>
  );
}

export interface DashboardReportProps {
  sales: SalesReportDto | null;
  inventory: InventoryReportDto | null;
  canViewCost: boolean;
  /** Already-localised "From … to … • N days" line. */
  rangeLabel: string;
  generatedAt: Date;
}

/**
 * The dashboard report document: written for paper/PDF, so it uses a fixed
 * light palette (never the on-screen theme) and A4-friendly typography.
 * Rendered inside {@link DashboardReportDialog} for preview/print and used as
 * the html2pdf source for the PDF download.
 */
export function DashboardReport({
  sales,
  inventory,
  canViewCost,
  rangeLabel,
  generatedAt,
}: DashboardReportProps): ReactElement {
  const { t, tag, dir } = useI18n();

  const expiredBucket = inventory?.expiryBuckets.find((bucket) => bucket.bucket === 'expired');
  const nearExpiryBatches = inventory?.expiryBuckets
    .filter((bucket) => bucket.bucket !== 'expired')
    .reduce((sum, bucket) => sum + bucket.batches, 0);
  const hasBucketValue = inventory?.expiryBuckets.some((bucket) => bucket.value !== null) ?? false;

  return (
    <div className="dashboard-report" dir={dir}>
      <header className="dr-header">
        <div>
          <h1>{t('app.title')}</h1>
          <p className="dr-subtitle">{t('dashboard.report.title')}</p>
        </div>
        <div className="dr-meta">
          <p>{rangeLabel}</p>
          <p>
            {t('dashboard.report.generatedAt')}: {formatDateTime(generatedAt, tag)}
          </p>
        </div>
      </header>

      {sales ? (
        <section>
          <h2>{t('nav.sales')}</h2>
          <div className="dr-kpis">
            <ReportKpi
              labelText={t('dashboard.revenue')}
              value={formatMoney(sales.revenue, tag)}
              hint={
                sales.growth.revenuePct !== null
                  ? `${t('dashboard.vsPrevious')}: ${
                      sales.growth.revenuePct >= 0 ? '+' : ''
                    }${formatNumber(sales.growth.revenuePct, tag)}%`
                  : undefined
              }
            />
            <ReportKpi
              labelText={t('dashboard.transactions')}
              value={formatNumber(sales.transactions, tag)}
              hint={`${formatNumber(sales.itemsSold, tag)} ${t('dashboard.units')}`}
            />
            <ReportKpi
              labelText={t('dashboard.avgTicket')}
              value={formatMoney(sales.avgTicket, tag)}
            />
            {canViewCost && sales.profit ? (
              <ReportKpi
                labelText={t('dashboard.grossProfit')}
                value={formatMoney(sales.profit.grossProfit, tag)}
                hint={
                  sales.profit.marginPct !== null
                    ? `${t('dashboard.margin')}: ${formatNumber(sales.profit.marginPct, tag)}%`
                    : undefined
                }
              />
            ) : null}
          </div>

          {sales.daily.length > 0 ? (
            <>
              <h2>{t('dashboard.report.sheetDaily')}</h2>
              <table>
                <thead>
                  <tr>
                    <th>{t('dashboard.report.date')}</th>
                    <th>{t('dashboard.revenue')}</th>
                    <th>{t('dashboard.transactions')}</th>
                    <th>{t('dashboard.units')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.daily.map((point) => (
                    <tr key={point.date}>
                      <td className="numeric">{formatDate(point.date, tag)}</td>
                      <td className="numeric">{formatMoney(point.revenue, tag)}</td>
                      <td className="numeric">{formatNumber(point.transactions, tag)}</td>
                      <td className="numeric">{formatNumber(point.units, tag)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="dr-total-row">
                    <td>{t('dashboard.report.total')}</td>
                    <td className="numeric">{formatMoney(sales.revenue, tag)}</td>
                    <td className="numeric">{formatNumber(sales.transactions, tag)}</td>
                    <td className="numeric">{formatNumber(sales.itemsSold, tag)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          ) : (
            <p className="dr-empty">{t('dashboard.noSalesInPeriod')}</p>
          )}

          <div className="dr-grid-2">
            {sales.byCategory.length > 0 ? (
              <div>
                <h2>{t('dashboard.byCategory')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('dashboard.report.category')}</th>
                      <th>{t('dashboard.units')}</th>
                      <th>{t('dashboard.revenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.byCategory.map((row) => (
                      <tr key={row.categoryId ?? 'none'}>
                        <td>{row.nameAr ?? t('dashboard.uncategorized')}</td>
                        <td className="numeric">{formatNumber(row.units, tag)}</td>
                        <td className="numeric">{formatMoney(row.revenue, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {sales.payments.length > 0 ? (
              <div>
                <h2>{t('dashboard.payments')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('dashboard.report.paymentMethod')}</th>
                      <th>{t('dashboard.invoices')}</th>
                      <th>{t('dashboard.report.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.payments.map((row) => (
                      <tr key={row.method}>
                        <td>{t(PAYMENT_LABEL_KEYS[row.method])}</td>
                        <td className="numeric">{formatNumber(row.count, tag)}</td>
                        <td className="numeric">{formatMoney(row.amount, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {sales.topProducts.length > 0 ? (
            <>
              <h2>{t('dashboard.topProducts')}</h2>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>{t('dashboard.report.productName')}</th>
                    <th>{t('dashboard.units')}</th>
                    <th>{t('dashboard.invoices')}</th>
                    <th>{t('dashboard.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.topProducts.map((row) => (
                    <tr key={row.productId}>
                      <td className="numeric">{row.sku}</td>
                      <td>{row.nameAr}</td>
                      <td className="numeric">{formatNumber(row.units, tag)}</td>
                      <td className="numeric">{formatNumber(row.invoices, tag)}</td>
                      <td className="numeric">{formatMoney(row.revenue, tag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>
      ) : null}

      {inventory ? (
        <section>
          <h2>{t('nav.inventory')}</h2>
          <p className="dr-note">{t('dashboard.report.inventoryNote')}</p>
          <div className="dr-kpis">
            <ReportKpi
              labelText={t('dashboard.lowStock')}
              value={formatNumber(inventory.health.low + inventory.health.out, tag)}
              hint={t('dashboard.lowStockDetail', {
                count: formatNumber(inventory.health.out, tag),
              })}
            />
            <ReportKpi
              labelText={t('dashboard.nearExpiry')}
              value={formatNumber(nearExpiryBatches, tag)}
              hint={t('dashboard.nearExpiryDays', { days: inventory.nearExpiryDays })}
            />
            <ReportKpi
              labelText={t('dashboard.expired')}
              value={formatNumber(expiredBucket?.batches ?? 0, tag)}
              hint={
                expiredBucket
                  ? t('dashboard.batchesUnits', {
                      batches: formatNumber(expiredBucket.batches, tag),
                      units: formatNumber(expiredBucket.units, tag),
                    })
                  : undefined
              }
            />
            <ReportKpi
              labelText={t('dashboard.inventoryValue')}
              value={
                canViewCost && inventory.stock.costValue !== null
                  ? formatMoney(inventory.stock.costValue, tag)
                  : `${formatNumber(inventory.stock.units, tag)} ${t('dashboard.units')}`
              }
              hint={
                canViewCost && inventory.stock.costValue !== null
                  ? t('dashboard.inventoryValueCost')
                  : t('dashboard.stockUnits')
              }
            />
          </div>

          <h2>{t('dashboard.stockExpiry')}</h2>
          <table>
            <thead>
              <tr>
                <th>{t('dashboard.stockExpiry')}</th>
                <th>{t('dashboard.report.batches')}</th>
                <th>{t('dashboard.units')}</th>
                {hasBucketValue ? <th>{t('dashboard.report.amount')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {inventory.expiryBuckets.map((bucket) => (
                <tr key={bucket.bucket}>
                  <td>{t(BUCKET_LABEL_KEYS[bucket.bucket])}</td>
                  <td className="numeric">{formatNumber(bucket.batches, tag)}</td>
                  <td className="numeric">{formatNumber(bucket.units, tag)}</td>
                  {hasBucketValue ? (
                    <td className="numeric">
                      {bucket.value !== null ? formatMoney(bucket.value, tag) : '—'}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="dr-grid-2">
            {inventory.reorder.length > 0 ? (
              <div>
                <h2>{t('dashboard.reorderList')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>{t('dashboard.report.productName')}</th>
                      <th>{t('dashboard.report.stockQty')}</th>
                      <th>{t('dashboard.report.minStock')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.reorder.map((row) => (
                      <tr key={row.productId}>
                        <td className="numeric">{row.sku}</td>
                        <td>{row.nameAr}</td>
                        <td className="numeric">{formatNumber(row.totalQuantity, tag)}</td>
                        <td className="numeric">{formatNumber(row.minStock, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {inventory.upcomingExpiries.length > 0 ? (
              <div>
                <h2>{t('dashboard.upcomingExpiries')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('dashboard.report.productName')}</th>
                      <th>{t('dashboard.report.lotNumber')}</th>
                      <th>{t('dashboard.report.expiryDate')}</th>
                      <th>{t('dashboard.report.stockQty')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.upcomingExpiries.map((row) => (
                      <tr key={row.batchId}>
                        <td>{row.nameAr}</td>
                        <td className="numeric">{row.lotNumber}</td>
                        <td className="numeric">{formatDate(row.expiryDate, tag)}</td>
                        <td className="numeric">{formatNumber(row.quantity, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="dr-grid-2">
            {inventory.fastMoving.length > 0 ? (
              <div>
                <h2>{t('dashboard.fastMoving')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('dashboard.report.productName')}</th>
                      <th>{t('dashboard.units')}</th>
                      <th>{t('dashboard.invoices')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.fastMoving.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.nameAr}</td>
                        <td className="numeric">{formatNumber(row.units, tag)}</td>
                        <td className="numeric">{formatNumber(row.invoices, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {inventory.slowMoving.length > 0 ? (
              <div>
                <h2>{t('dashboard.slowMoving')}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{t('dashboard.report.productName')}</th>
                      <th>{t('dashboard.report.stockQty')}</th>
                      <th>{t('dashboard.report.units30d')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.slowMoving.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.nameAr}</td>
                        <td className="numeric">{formatNumber(row.totalQuantity, tag)}</td>
                        <td className="numeric">{formatNumber(row.units30d, tag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
