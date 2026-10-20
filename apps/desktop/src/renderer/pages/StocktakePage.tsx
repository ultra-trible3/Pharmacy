import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { InventoryBatchRow } from '@pharmacy/shared';
import { Button } from '../components/ui/button';
import { Spinner, EmptyState } from '../components/ui/badge';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from '../components/ui/toast';
import { api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { cn } from '../lib/utils';

/** Raw counted quantities keyed by batch id (kept as text while editing). */
type Counts = Record<string, string>;

function loadCounts(warehouseId: string): Counts {
  if (!warehouseId) return {};
  try {
    const raw = localStorage.getItem(`stocktake_${warehouseId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Array<{ batchId: string; count: string | number }>;
    const result: Counts = {};
    for (const entry of parsed) {
      if (typeof entry.batchId === 'string') result[entry.batchId] = String(entry.count ?? '');
    }
    return result;
  } catch {
    return {};
  }
}

function parseCount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Stocktake: count the physical quantity of each batch, then post one
 * COUNT_GAIN / COUNT_LOSS adjustment per difference against the live balance.
 */
export function StocktakePage(): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Counts>({});
  const [isSaving, setIsSaving] = useState(false);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  const batches = useQuery({
    queryKey: ['inventory', 'batches', { stocktake: true, warehouseId }],
    queryFn: () =>
      api.inventory.batches({
        warehouseId,
        inStockOnly: 'true',
        includeExpired: 'true',
        pageSize: 200,
      }),
    enabled: warehouseId !== '',
    staleTime: 30_000,
  });

  const batchRows = batches.data?.items ?? [];

  useEffect(() => {
    if (!warehouseId) return;
    const entries = Object.entries(counts).filter(([, value]) => value.trim() !== '');
    if (entries.length === 0) {
      localStorage.removeItem(`stocktake_${warehouseId}`);
      return;
    }
    localStorage.setItem(
      `stocktake_${warehouseId}`,
      JSON.stringify(entries.map(([batchId, count]) => ({ batchId, count }))),
    );
  }, [counts, warehouseId]);

  const changed = useMemo(() => {
    return batchRows.flatMap((row) => {
      const counted = parseCount(counts[row.batchId]);
      if (counted === null) return [];
      const delta = counted - row.quantity;
      if (delta === 0) return [];
      return [{ row, counted, delta }];
    });
  }, [batchRows, counts]);

  const hasInvalidCount = useMemo(
    () =>
      Object.entries(counts).some(
        ([batchId, raw]) =>
          raw.trim() !== '' &&
          batchRows.some((row) => row.batchId === batchId) &&
          parseCount(raw) === null,
      ),
    [batchRows, counts],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return batchRows;
    return batchRows.filter((row) =>
      `${row.productNameAr} ${row.productNameEn ?? ''} ${row.sku} ${row.lotNumber}`
        .toLowerCase()
        .includes(term),
    );
  }, [batchRows, search]);

  const setCount = (batchId: string, value: string): void => {
    setCounts((previous) => ({ ...previous, [batchId]: value }));
  };

  const saveCounts = async (): Promise<void> => {
    if (hasInvalidCount) {
      toast.error(t('stocktake.invalidCount'));
      return;
    }
    if (changed.length === 0) {
      toast.info(t('stocktake.noVariance'));
      return;
    }

    setIsSaving(true);
    try {
      const results = await Promise.allSettled(
        changed.map(({ row, delta }) =>
          api.inventory.adjust({
            productId: row.productId,
            warehouseId,
            batchId: row.batchId,
            type: delta > 0 ? 'COUNT_GAIN' : 'COUNT_LOSS',
            quantity: Math.abs(delta),
            reason: t('stocktake.reason'),
          }),
        ),
      );

      const failed = changed.filter((_, index) => results[index]?.status === 'rejected');
      if (failed.length === 0) {
        toast.success(t('stocktake.done'));
        setCounts({});
      } else {
        toast.error(t('stocktake.partial', { count: failed.length }));
        const remaining: Counts = {};
        for (const entry of failed) remaining[entry.row.batchId] = String(entry.counted);
        setCounts(remaining);
      }
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t('stocktake.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('stocktake.description')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <Select
          value={warehouseId}
          onChange={(event) => {
            const next = event.target.value;
            setWarehouseId(next);
            setCounts(loadCounts(next));
            setSearch('');
          }}
          aria-label={t('inventory.warehouse')}
          className="w-56"
        >
          <option value="">{t('inventory.selectWarehouse')}</option>
          {(warehouses.data ?? []).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.nameAr}
            </option>
          ))}
        </Select>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('stocktake.searchPlaceholder')}
            aria-label={t('stocktake.searchPlaceholder')}
            className="ps-9"
            disabled={!warehouseId}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!warehouseId || batches.isFetching}
          onClick={() => void batches.refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {batches.isFetching ? t('common.loading') : t('common.refresh')}
        </Button>

        <Button
          size="sm"
          disabled={!warehouseId || isSaving || changed.length === 0}
          onClick={() => void saveCounts()}
        >
          {isSaving ? <Spinner className="h-3 w-3" /> : <Check className="h-3.5 w-3.5" />}
          {t('stocktake.save')}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={isSaving || Object.keys(counts).length === 0}
          onClick={() => setCounts({})}
        >
          {t('stocktake.clear')}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {!warehouseId ? (
          <EmptyState message={t('inventory.selectWarehouse')} />
        ) : null}
        {warehouseId && batches.isLoading ? <Spinner className="m-6" /> : null}
        {warehouseId && batches.isError ? (
          <EmptyState message={t('errors.network')} />
        ) : null}
        {warehouseId && !batches.isLoading && !batches.isError && visibleRows.length === 0 ? (
          <EmptyState message={t('stocktake.noBatches')} />
        ) : null}

        {visibleRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('stocktake.product')}</TableHead>
                <TableHead>{t('stocktake.lot')}</TableHead>
                <TableHead>{t('inventory.expiryDate')}</TableHead>
                <TableHead className="numeric text-center">{t('stocktake.current')}</TableHead>
                <TableHead className="text-center">{t('stocktake.counted')}</TableHead>
                <TableHead className="numeric text-center">{t('stocktake.variance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((batch: InventoryBatchRow) => {
                const raw = counts[batch.batchId] ?? '';
                const counted = parseCount(raw);
                const variance = counted === null ? null : counted - batch.quantity;
                return (
                  <TableRow key={batch.batchId}>
                    <TableCell>
                      <span className="block max-w-[240px] truncate">{batch.productNameAr}</span>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {batch.sku}
                      </span>
                    </TableCell>
                    <TableCell className="numeric text-xs" dir="ltr">
                      {batch.lotNumber}
                    </TableCell>
                    <TableCell className="numeric text-xs" dir="ltr">
                      {formatDate(batch.expiryDate, tag)}
                    </TableCell>
                    <TableCell className="numeric text-center">{formatNumber(batch.quantity, tag)}</TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={raw}
                        onChange={(event) => setCount(batch.batchId, event.target.value)}
                        aria-label={`${t('stocktake.counted')}: ${batch.productNameAr}`}
                        className="numeric mx-auto w-24 text-center"
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'numeric text-center font-medium',
                        variance === null
                          ? 'text-muted-foreground'
                          : variance > 0
                            ? 'text-success'
                            : variance < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                      )}
                    >
                      {variance === null ? '—' : `${variance > 0 ? '+' : ''}${formatNumber(variance, tag)}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
