import { useQuery } from '@tanstack/react-query';
import { Banknote, Boxes, PackageX } from 'lucide-react';
import { type ReactElement } from 'react';
import { sumCurrency } from '@pharmacy/shared';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api } from '../lib/api';
import { expiryLabel, formatMoney, formatNumber } from '../lib/format';
import { useI18n } from '../i18n/useI18n';

/**
 * Operational report built entirely from live API data (no cached aggregates):
 *  - stock valuation and unit counts from \\`/inventory/stock\\`,
 *  - reorder / expiry work lists from \\`/inventory/alerts\\`.
 *
 * Financial reporting (sales, profit, VAT) lands with the POS phase; this page
 * deliberately does not display numbers it cannot compute yet.
 */
export function ReportsPage(): ReactElement {
  const { t, tag } = useI18n();

  const stock = useQuery({
    queryKey: ['reports', 'stock'],
    queryFn: () => api.inventory.stock({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });

  const alerts = useQuery({
    queryKey: ['inventory', 'alerts'],
    queryFn: () => api.inventory.alerts(),
    refetchInterval: 60_000,
  });

  const rows = stock.data?.items ?? [];
  const totalValue = rows.length > 0 ? sumCurrency(rows.map((row) => row.stockValue)) : '0.00';
  const totalUnits = rows.reduce((sum, row) => sum + row.totalQuantity, 0);
  const lowStockCount = rows.filter((row) => row.isLowStock).length;

  // ----- low-stock table -------------------------------------------------
  const lowStockRows = alerts.data?.lowStock ?? [];
  const lowStockElements = lowStockRows.map((row) => (
    <TableRow key={row.productId}>
      <TableCell className="numeric" dir="ltr">{row.sku}</TableCell>
      <TableCell className="max-w-[280px]">
        <span className="block truncate">{row.nameAr}</span>
      </TableCell>
      <TableCell className="numeric text-center font-semibold">{formatNumber(row.totalQuantity, tag)}</TableCell>
      <TableCell className="numeric text-center text-muted-foreground">{formatNumber(row.minStock, tag)}</TableCell>
    </TableRow>
  ));

  // ----- expired batches table -------------------------------------------
  const expiredRows = alerts.data?.expired ?? [];
  const expiredElements = expiredRows.map((batch) => (
    <TableRow key={batch.batchId}>
      <TableCell className="max-w-[200px] truncate">{batch.productNameAr}</TableCell>
      <TableCell className="numeric text-xs" dir="ltr">{batch.lotNumber}</TableCell>
      <TableCell className="numeric text-center">{formatNumber(batch.quantity, tag)}</TableCell>
      <TableCell>
        <Badge variant="destructive" className="w-fit">{expiryLabel(batch.daysToExpiry)}</Badge>
      </TableCell>
    </TableRow>
  ));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Banknote className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t('reports.stockValue')}</p>
              <p className="numeric text-xl font-bold">{formatMoney(totalValue, tag)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Boxes className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t('reports.stockUnits')}</p>
              <p className="numeric text-xl font-bold">{formatNumber(totalUnits, tag)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warning/10 text-warning">
              <PackageX className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t('reports.lowStock')}</p>
              <p className="numeric text-xl font-bold">{lowStockCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {stock.isLoading ? <Spinner /> : null}
      {stock.isError ? <EmptyState message={t('errors.network')} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('reports.operational')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lowStockRows.length === 0 ? (
            <EmptyState message="لا توجد أصناف تحت حد الطلب" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('products.sku')}</TableHead>
                  <TableHead>{t('products.nameAr')}</TableHead>
                  <TableHead className="text-center">{t('products.stock')}</TableHead>
                  <TableHead className="text-center">{t('products.minStock')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{lowStockElements}</TableBody>
            </Table>
          )}

          {expiredRows.length === 0 ? (
            <EmptyState message="لا توجد تشغيلات منتهية" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('products.nameAr')}</TableHead>
                  <TableHead>{t('inventory.lotNumber')}</TableHead>
                  <TableHead className="text-center">{t('inventory.quantity')}</TableHead>
                  <TableHead>{t('inventory.expiryDate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{expiredElements}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}