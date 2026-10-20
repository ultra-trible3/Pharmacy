import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api } from '../lib/api';

export function ReturnsPage(): ReactElement {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'voided' | 'stock'>('voided');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Tab 1: voided sales
  const { data: voidedSales } = useQuery({
    queryKey: ['returns', 'voided', page, debouncedSearch],
    queryFn: () =>
      api.sales.list({ page, pageSize: 25, status: 'voided', q: debouncedSearch || undefined }),
    placeholderData: (previous) => previous,
  });

  // Tab 2: stock RETURN_IN movements
  const { data: returnMovements } = useQuery({
    queryKey: ['returns', 'stock', page, debouncedSearch],
    queryFn: () =>
      api.inventory.movements({ page, pageSize: 25, type: 'RETURN_IN', q: debouncedSearch || undefined }),
    placeholderData: (previous) => previous,
  });

  const voidedItems = voidedSales?.items ?? [];
  const returnItems = returnMovements?.items ?? [];
  const totalPages = Math.max(
    voidedSales?.totalPages ?? 1,
    returnMovements?.totalPages ?? 1,
  );

  const renderVoidedTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('returns.type')}</TableHead>
          <TableHead>{t('returns.reference')}</TableHead>
          <TableHead>{t('returns.product')}</TableHead>
          <TableHead className="numeric text-center">{t('returns.quantity')}</TableHead>
          <TableHead>{t('returns.user')}</TableHead>
          <TableHead>{t('returns.reason')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {voidedItems.map((sale) => (
          <TableRow key={sale.id}>
            <TableCell>{t('returns.type.voided')}</TableCell>
            <TableCell>{sale.invoiceNumber}</TableCell>
            <TableCell>{sale.items?.[0]?.product?.nameAr ?? '—'}</TableCell>
            <TableCell className="numeric text-center">{sale.items?.length ?? 0}</TableCell>
            <TableCell>{sale.user?.fullName ?? '—'}</TableCell>
            <TableCell>{sale.note ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderStockTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('returns.type')}</TableHead>
          <TableHead>{t('returns.reference')}</TableHead>
          <TableHead>{t('returns.product')}</TableHead>
          <TableHead className="numeric text-center">{t('returns.quantity')}</TableHead>
          <TableHead>{t('returns.user')}</TableHead>
          <TableHead>{t('returns.reason')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {returnItems.map((mov) => {
          const typeLabel = mov.type === 'RETURN_IN'
            ? t('returns.type.stock')
            : t('returns.type.voided');
          return (
            <TableRow key={mov.id}>
              <TableCell>{typeLabel}</TableCell>
              <TableCell>{mov.reference ?? '—'}</TableCell>
              <TableCell>{mov.productNameAr ?? '—'}</TableCell>
              <TableCell className="numeric text-center">{mov.quantity}</TableCell>
              <TableCell>{mov.userName ?? '—'}</TableCell>
              <TableCell>{mov.reason ?? '—'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select
          value={tab}
          onChange={(e) => setTab(e.target.value as 'voided' | 'stock')}
          aria-label={t('returns.type')}
        >
          <option value="voided">{t('returns.type.voided')}</option>
          <option value="stock">{t('returns.type.stock')}</option>
        </Select>
        <Input
          placeholder="بحث..."
          value={debouncedSearch}
          onChange={(e) => setDebouncedSearch(e.target.value)}
          className="my-2"
          aria-label={t('common.search')}
        />
        <Button variant="outline" size="sm" onClick={() => setPage(1)}>
          {t('common.refresh')}
        </Button>
      </div>

      {tab === 'voided' ? renderVoidedTable() : renderStockTable()}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((c) => Math.max(1, c - 1))}
          >
            {t('common.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((c) => Math.min(totalPages, c + 1))}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}