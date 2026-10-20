import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin, Pencil, Star } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import type { StockLevelRow } from '@pharmacy/shared';
import { Badge, EmptyState, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { api, type MovementDto, type WarehouseDto } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import { cn } from '../../lib/utils';

type DetailsTab = 'stock' | 'movements';

function Stat({ label, value }: { label: string; value: ReactElement | string }): ReactElement {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="numeric mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

/**
 * Read-only warehouse sheet: identity, live counters, and the two lists an
 * operator needs when investigating a location (stock on hand and movements).
 */
export function WarehouseDetailsDialog({
  warehouse,
  onOpenChange,
  canWrite,
  canViewCost,
  onEdit,
  onSetDefault,
}: {
  warehouse: WarehouseDto | null;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  canViewCost: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
}): ReactElement {
  const { t, tag } = useI18n();
  const [tab, setTab] = useState<DetailsTab>('stock');

  useEffect(() => {
    if (warehouse) setTab('stock');
  }, [warehouse?.id]);

  const stockQuery = useQuery({
    queryKey: ['inventory', 'stock', { warehouseDetails: warehouse?.id }],
    queryFn: () =>
      api.inventory.stock({ warehouseId: warehouse!.id, page: 1, pageSize: 50 }),
    enabled: warehouse !== null && tab === 'stock',
  });

  const movementsQuery = useQuery({
    queryKey: ['inventory', 'movements', { warehouseDetails: warehouse?.id }],
    queryFn: () =>
      api.inventory.movements({ warehouseId: warehouse!.id, page: 1, pageSize: 25 }),
    enabled: warehouse !== null && tab === 'movements',
  });

  if (!warehouse) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const stats = warehouse.stats;
  const stockRows: StockLevelRow[] = stockQuery.data?.items ?? [];
  const movementRows: MovementDto[] = movementsQuery.data?.items ?? [];
  const stockTotal = stockQuery.data?.total ?? 0;
  const movementsTotal = movementsQuery.data?.total ?? 0;

  const movementLabel = (type: string): string =>
    t(`warehouses.movement.${type}` as TranslationKey);

  return (
    <Dialog open={warehouse !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        title={t('warehouses.detailsTitle')}
        description={`${warehouse.nameAr} · ${warehouse.code}`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {warehouse.isDefault ? (
              <Badge variant="default">{t('warehouses.default')}</Badge>
            ) : null}
            <Badge variant={warehouse.isActive ? 'success' : 'outline'}>
              {warehouse.isActive ? t('warehouses.active') : t('warehouses.inactive')}
            </Badge>
            {warehouse.nameEn ? (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {warehouse.nameEn}
              </span>
            ) : null}
          </div>

          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{warehouse.address ?? t('warehouses.noAddress')}</span>
          </p>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={t('warehouses.skus')} value={formatNumber(stats?.skuCount ?? 0, tag)} />
            <Stat label={t('warehouses.units')} value={formatNumber(stats?.unitCount ?? 0, tag)} />
            <Stat
              label={t('warehouses.batches')}
              value={formatNumber(stats?.batchCount ?? 0, tag)}
            />
            <Stat
              label={t('warehouses.nearExpiry')}
              value={formatNumber(stats?.expiringSoonCount ?? 0, tag)}
            />
            <Stat
              label={t('warehouses.expired')}
              value={formatNumber(stats?.expiredCount ?? 0, tag)}
            />
            {canViewCost ? (
              <Stat
                label={t('warehouses.stockValue')}
                value={
                  stats?.stockValue === null || stats?.stockValue === undefined
                    ? '—'
                    : formatMoney(stats.stockValue, tag)
                }
              />
            ) : (
              <Stat label={t('warehouses.openShift')} value={formatNumber(stats?.openShiftCount ?? 0, tag)} />
            )}
            {canViewCost && (stats?.openShiftCount ?? 0) > 0 ? (
              <Stat
                label={t('warehouses.openShift')}
                value={formatNumber(stats?.openShiftCount ?? 0, tag)}
              />
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t('warehouses.createdAt')}: {formatDateTime(warehouse.createdAt, tag)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t('warehouses.updatedAt')}: {formatDateTime(warehouse.updatedAt, tag)}
            </span>
          </div>

          <div className="flex items-center gap-1 border-b border-border pb-2">
            <Button
              type="button"
              size="sm"
              variant={tab === 'stock' ? 'default' : 'ghost'}
              onClick={() => setTab('stock')}
            >
              {t('warehouses.stockTab')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tab === 'movements' ? 'default' : 'ghost'}
              onClick={() => setTab('movements')}
            >
              {t('warehouses.movementsTab')}
            </Button>
          </div>

          {tab === 'stock' ? (
            <div>
              {stockQuery.isLoading ? <Spinner className="m-4" /> : null}
              {stockQuery.isError ? (
                <EmptyState message={t('warehouses.loadError')} />
              ) : null}
              {!stockQuery.isLoading && !stockQuery.isError && stockRows.length === 0 ? (
                <EmptyState message={t('warehouses.noStock')} />
              ) : null}
              {stockRows.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('warehouses.product')}</TableHead>
                        <TableHead className="numeric text-center">{t('inventory.quantity')}</TableHead>
                        <TableHead className="numeric text-center">{t('warehouses.minStock')}</TableHead>
                        <TableHead>{t('warehouses.nearExpiry')}</TableHead>
                        {canViewCost ? (
                          <TableHead className="numeric text-center">
                            {t('warehouses.stockValue')}
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockRows.map((row) => (
                        <TableRow key={row.productId}>
                          <TableCell>
                            <span className="block max-w-[220px] truncate">{row.nameAr}</span>
                            <span className="text-xs text-muted-foreground" dir="ltr">
                              {row.sku}
                            </span>
                          </TableCell>
                          <TableCell className="numeric text-center">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1',
                                row.isLowStock && 'font-semibold text-warning',
                              )}
                            >
                              {formatNumber(row.totalQuantity, tag)}
                              {row.isLowStock ? (
                                <Badge variant="warning">{t('warehouses.lowStock')}</Badge>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="numeric text-center">
                            {formatNumber(row.minStock, tag)}
                          </TableCell>
                          <TableCell className="numeric text-xs">
                            {row.nearestExpiry ? formatDate(row.nearestExpiry, tag) : '—'}
                          </TableCell>
                          {canViewCost ? (
                            <TableCell className="numeric text-center">
                              {formatMoney(row.stockValue, tag)}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {stockTotal > stockRows.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t('warehouses.moreStock', { count: formatNumber(stockTotal, tag) })}
                </p>
              ) : null}
              {!canViewCost ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t('warehouses.valueHidden')}
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              {movementsQuery.isLoading ? <Spinner className="m-4" /> : null}
              {movementsQuery.isError ? (
                <EmptyState message={t('warehouses.loadError')} />
              ) : null}
              {!movementsQuery.isLoading &&
              !movementsQuery.isError &&
              movementRows.length === 0 ? (
                <EmptyState message={t('warehouses.noMovements')} />
              ) : null}
              {movementRows.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('inventory.date')}</TableHead>
                        <TableHead>{t('inventory.movementType')}</TableHead>
                        <TableHead>{t('warehouses.product')}</TableHead>
                        <TableHead className="numeric text-center">{t('inventory.quantity')}</TableHead>
                        <TableHead>{t('warehouses.reason')}</TableHead>
                        <TableHead>{t('inventory.user')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movementRows.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="numeric text-xs whitespace-nowrap">
                            {formatDateTime(movement.createdAt, tag)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {movementLabel(movement.type)}
                          </TableCell>
                          <TableCell>
                            <span className="block max-w-[180px] truncate">
                              {movement.productNameAr}
                            </span>
                            <span className="text-xs text-muted-foreground" dir="ltr">
                              {movement.sku}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              'numeric text-center font-medium',
                              movement.quantity > 0 ? 'text-success' : 'text-destructive',
                            )}
                          >
                            {movement.quantity > 0 ? '+' : ''}
                            {formatNumber(movement.quantity, tag)}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs">
                            {movement.reason ?? movement.reference ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs">{movement.userName ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {movementsTotal > movementRows.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t('warehouses.moreMovements')}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          {canWrite ? (
            <Button type="button" variant="outline" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              {t('common.edit')}
            </Button>
          ) : null}
          {canWrite && !warehouse.isDefault && warehouse.isActive ? (
            <Button type="button" variant="outline" onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              {t('warehouses.setDefault')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
