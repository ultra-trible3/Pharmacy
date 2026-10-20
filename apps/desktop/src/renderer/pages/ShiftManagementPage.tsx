import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Plus, RefreshCw, Search } from 'lucide-react';
import {
  fromMinorUnits,
  normaliseDecimalString,
  toMinorUnits,
  type CashDrawerDto,
  type CashDrawerSummaryDto,
  type CashMovementTypeCode,
  type ShiftReconciliationDto,
} from '@pharmacy/shared';
import { useI18n } from '../i18n/useI18n';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { toast } from '../components/ui/toast';
import { useAuthStore } from '../store/auth';

const PAGE_SIZE = 25;

const SHIFT_STATUS_LABELS_AR: Record<string, string> = {
  OPEN: 'مفتوحة',
  CLOSED: 'مغلقة',
};

const SHIFT_STATUS_LABELS_EN: Record<string, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
};

const SALE_STATUS_LABELS_AR: Record<string, string> = {
  completed: 'مكتملة',
  suspended: 'معلقة',
  voided: 'ملغاة',
};

const SALE_STATUS_LABELS_EN: Record<string, string> = {
  completed: 'Completed',
  suspended: 'Suspended',
  voided: 'Voided',
};

function shiftStatusLabel(status: string, locale: string): string {
  const map = locale === 'ar' ? SHIFT_STATUS_LABELS_AR : SHIFT_STATUS_LABELS_EN;
  return map[status] ?? status;
}

function saleStatusLabel(status: string, locale: string): string {
  const map = locale === 'ar' ? SALE_STATUS_LABELS_AR : SALE_STATUS_LABELS_EN;
  return map[status] ?? status;
}

/** Exact variance preview using integer minor units (no float drift). */
function previewVariance(counted: string, expected: string): string | null {
  const trimmed = counted.trim();
  if (!/^\d+(?:\.\d{0,2})?$/u.test(trimmed)) return null;
  try {
    return fromMinorUnits(toMinorUnits(trimmed) - toMinorUnits(expected));
  } catch {
    return null;
  }
}

type MoneyLocale = 'ar-EG' | 'en-EG';

function VarianceBadge({
  variance,
  locale,
}: {
  variance: string;
  locale: MoneyLocale;
}): ReactElement {
  const { t } = useI18n();
  const value = Number(variance);
  const variant = value === 0 ? 'success' : value < 0 ? 'destructive' : 'warning';
  const label =
    value === 0
      ? t('shifts.varianceExact')
      : value < 0
        ? t('shifts.varianceShortage')
        : t('shifts.varianceOverage');
  return (
    <span data-testid="variance-value" className="inline-flex items-center gap-2">
      <Badge variant={variant}>{label}</Badge>
      <span
        className={
          value === 0
            ? 'numeric font-medium text-success'
            : value < 0
              ? 'numeric font-medium text-destructive'
              : 'numeric font-medium text-warning'
        }
        dir="ltr"
      >
        {formatMoney(variance, locale)}
      </span>
    </span>
  );
}

function ReconciliationSummary({
  reconciliation,
  locale,
}: {
  reconciliation: ShiftReconciliationDto;
  locale: MoneyLocale;
}): ReactElement {
  const { t } = useI18n();
  const money = (value: string): string => formatMoney(value, locale);
  const rows: Array<[string, string]> = [
    ['shifts.openingCash', reconciliation.openingBalance],
    ['shifts.cashSales', reconciliation.cashSales],
    ['shifts.cardSales', reconciliation.cardSales],
    ['shifts.walletSales', reconciliation.walletSales],
    ['shifts.creditSales', reconciliation.creditSales],
    ['shifts.totalSales', reconciliation.totalSales],
    ['shifts.customerCash', reconciliation.customerCashTotal],
    ['shifts.cashRefunds', reconciliation.cashRefunds],
    ['shifts.expenses', reconciliation.expensesTotal],
    ['shifts.paidIn', reconciliation.paidInTotal],
    ['shifts.paidOut', reconciliation.paidOutTotal],
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border p-3 sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t(key as Parameters<typeof t>[0])}</span>
            <span className="numeric font-medium" dir="ltr">
              {money(value)}
            </span>
          </div>
        ))}
      </div>

      <div
        className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-3 text-sm font-semibold"
        data-testid="expected-cash"
      >
        <span>{t('shifts.expectedCash')}</span>
        <span className="numeric" dir="ltr">
          {money(reconciliation.expectedCash)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ['shifts.salesCount', reconciliation.salesCount],
          ['shifts.voidedSalesCount', reconciliation.voidedSalesCount],
          ['shifts.refundsCount', reconciliation.refundsCount],
          ['shifts.expensesCount', reconciliation.expensesCount],
          ['shifts.customerPaymentsCount', reconciliation.customerPaymentsCount],
          ['shifts.paidInCount', reconciliation.paidInCount],
          ['shifts.paidOutCount', reconciliation.paidOutCount],
          ['shifts.transactionCount', reconciliation.transactionCount],
        ].map(([key, value]) => (
          <div key={String(key)} className="rounded-md border border-border px-2 py-1.5">
            <p className="text-muted-foreground">{t(String(key) as Parameters<typeof t>[0])}</p>
            <p className="numeric text-sm font-medium">{formatNumber(Number(value), locale)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShiftManagementPage(): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale: MoneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';
  const queryClient = useQueryClient();
  const can = useAuthStore((state) => state.can);
  const canOpenClose = can('cashdrawer:open');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Open-shift form
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [openingBalance, setOpeningBalance] = useState('0.00');
  const [openNotes, setOpenNotes] = useState('');

  // Close-shift form. The counted cash is never pre-filled from the expected
  // amount: the cashier must enter the physical count.
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  // Cash movement form
  const [movementType, setMovementType] = useState<CashMovementTypeCode>('paid_in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementError, setMovementError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    includeInactive: 'false',
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['cashdrawer', params],
    queryFn: () => api.cashdrawer.list(params),
    placeholderData: (previous) => previous,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses', 'shift-form'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  const activeDetailId = closeId ?? detailId;
  const {
    data: shiftDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = useQuery({
    queryKey: ['cashdrawer', 'detail', activeDetailId],
    queryFn: () => api.cashdrawer.detail(activeDetailId!),
    enabled: Boolean(activeDetailId),
  });

  const summary = data?.summary as CashDrawerSummaryDto | undefined;

  const { mutate: openShift, isPending: opening } = useMutation({
    mutationFn: (body: unknown) => api.cashdrawer.open(body),
    onSuccess: () => {
      toast.success(t('shifts.opened'));
      setNewOpen(false);
      setFormError(null);
      setOpeningBalance('0.00');
      setOpenNotes('');
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['cashdrawer'] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const { mutate: closeShiftMutation, isPending: closing } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.cashdrawer.close(id, body),
    onSuccess: () => {
      toast.success(t('shifts.closed'));
      setCloseOpen(false);
      setCloseId(null);
      setFormError(null);
      setCountedCash('');
      setCloseNotes('');
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['cashdrawer'] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const { mutate: addMovement, isPending: addingMovement } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { type: CashMovementTypeCode; amount: string; reason: string } }) =>
      api.cashdrawer.addMovement(id, body),
    onSuccess: () => {
      toast.success(t('shifts.movementAdded'));
      setMovementAmount('');
      setMovementReason('');
      setMovementError(null);
      void queryClient.invalidateQueries({
        queryKey: ['cashdrawer', 'detail', activeDetailId],
      });
      void queryClient.invalidateQueries({ queryKey: ['cashdrawer'] });
    },
    onError: (error) =>
      setMovementError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = (data?.items ?? []) as CashDrawerDto[];
  const totalPages = data?.totalPages ?? 1;

  const openCloseDialog = (shift: CashDrawerDto): void => {
    setCloseId(shift.id);
    setDetailId(null);
    setCountedCash('');
    setCloseNotes('');
    setFormError(null);
    setCloseOpen(true);
  };

  const openDetailDialog = (shift: CashDrawerDto): void => {
    setDetailId(shift.id);
    setCloseId(null);
    setCloseOpen(false);
    setMovementAmount('');
    setMovementReason('');
    setMovementError(null);
  };

  const closeVariance =
    shiftDetail && countedCash.trim()
      ? previewVariance(countedCash, shiftDetail.reconciliation.expectedCash)
      : null;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('shifts.totalShifts')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatNumber(summary?.totalShifts ?? 0, moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('shifts.openShifts')}</p>
          <p className="numeric mt-1 text-xl font-semibold text-success">
            {formatNumber(summary?.openShifts ?? 0, moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('shifts.closedShifts')}</p>
          <p className="numeric mt-1 text-xl font-semibold text-muted-foreground">
            {formatNumber(summary?.closedShifts ?? 0, moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('shifts.netCash')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatMoney(summary?.netCash ?? '0.00', moneyLocale)}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('shifts.searchPlaceholder')}
            aria-label={t('shifts.searchPlaceholder')}
            className="ps-9"
          />
        </div>

        <Select
          value={statusFilter || 'all'}
          onValueChange={(value) => {
            setStatusFilter(value === 'all' ? '' : value);
            setPage(1);
          }}
        >
          <Select.Trigger aria-label={t('shifts.status')}>
            <Select.Value placeholder={t('common.all')} />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">{t('common.all')}</Select.Item>
            <Select.Item value="OPEN">{t('shifts.statusOpen')}</Select.Item>
            <Select.Item value="CLOSED">{t('shifts.statusClosed')}</Select.Item>
          </Select.Content>
        </Select>

        <Select
          value={warehouseFilter || 'all'}
          onValueChange={(value) => {
            setWarehouseFilter(value === 'all' ? '' : value);
            setPage(1);
          }}
        >
          <Select.Trigger aria-label={t('inventory.warehouse')}>
            <Select.Value placeholder={t('common.all')} />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">{t('common.all')}</Select.Item>
            {(warehouses ?? []).map((warehouse) => (
              <Select.Item key={warehouse.id} value={warehouse.id}>
                {warehouse.nameAr}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPage(1);
            }}
            placeholder={t('shifts.dateFrom')}
            aria-label={t('shifts.dateFrom')}
            className="w-32"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPage(1);
            }}
            placeholder={t('shifts.dateTo')}
            aria-label={t('shifts.dateTo')}
            className="w-32"
          />
        </div>

        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {isFetching ? t('common.loading') : t('common.refresh')}
        </Button>

        {canOpenClose ? (
          <Button size="sm" onClick={() => { setFormError(null); setNewOpen(true); }} disabled={opening}>
            <Plus size={14} /> {t('shifts.openShift')}
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : null}
        {isError ? <div className="p-8 text-center text-destructive">{t('errors.generic')}</div> : null}
        {!isLoading && !isError && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('shifts.noShifts')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('shifts.shift')}</TableHead>
                <TableHead>{t('shifts.user')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead>{t('shifts.openedAt')}</TableHead>
                <TableHead>{t('shifts.closedAt')}</TableHead>
                <TableHead className="numeric text-right">{t('shifts.openingBalance')}</TableHead>
                <TableHead className="numeric text-right">{t('shifts.expectedBalance')}</TableHead>
                <TableHead className="numeric text-right">{t('shifts.closingBalance')}</TableHead>
                <TableHead className="numeric text-right">{t('shifts.variance')}</TableHead>
                <TableHead className="text-center">{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((shift) => {
                const variance = shift.variance ? Number(shift.variance) : null;
                return (
                  <TableRow key={shift.id}>
                    <TableCell className="numeric font-medium" dir="ltr">
                      {shift.id.slice(-6).toUpperCase()}
                    </TableCell>
                    <TableCell className="text-sm">{shift.userName}</TableCell>
                    <TableCell className="text-sm">{shift.warehouseNameAr ?? '—'}</TableCell>
                    <TableCell className="numeric" dir="ltr">
                      {formatDateTime(shift.openedAt, moneyLocale)}
                    </TableCell>
                    <TableCell className="numeric" dir="ltr">
                      {shift.closedAt ? formatDateTime(shift.closedAt, moneyLocale) : '—'}
                    </TableCell>
                    <TableCell className="numeric text-right font-medium">
                      {formatMoney(shift.openingBalance, moneyLocale)}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {shift.status === 'CLOSED'
                        ? formatMoney(shift.expectedBalance, moneyLocale)
                        : '—'}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {shift.closingBalance ? formatMoney(shift.closingBalance, moneyLocale) : '—'}
                    </TableCell>
                    <TableCell
                      className={
                        variance === null
                          ? 'numeric text-right'
                          : variance === 0
                            ? 'numeric text-right text-success'
                            : variance < 0
                              ? 'numeric text-right text-destructive'
                              : 'numeric text-right text-warning'
                      }
                    >
                      {shift.variance ? formatMoney(shift.variance, moneyLocale) : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={shift.status === 'OPEN' ? 'success' : 'outline'}>
                        {shiftStatusLabel(shift.status, locale)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetailDialog(shift)}
                          aria-label={t('shifts.details')}
                        >
                          <Eye className="h-4 w-4" />
                          {t('shifts.details')}
                        </Button>
                        {shift.status === 'OPEN' && canOpenClose ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={closing}
                            onClick={() => openCloseDialog(shift)}
                            aria-label={t('shifts.closeShift')}
                          >
                            {t('shifts.closeShift')}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <span className="numeric text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Open shift dialog */}
      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          if (!open) setNewOpen(false);
        }}
      >
        <DialogContent
          title={t('shifts.openShift')}
          description={t('shifts.openShiftDescription')}
          className="max-w-md"
        >
          <form className="space-y-4 py-2" onSubmit={(e) => e.preventDefault()} noValidate>
            <div>
              <Label htmlFor="shift-warehouse">{t('inventory.warehouse')} *</Label>
              <Select
                value={warehouseId}
                onValueChange={setWarehouseId}
                disabled={opening}
              >
                <Select.Trigger id="shift-warehouse" className="mt-1.5">
                  <Select.Value placeholder={t('shifts.selectWarehouse')} />
                </Select.Trigger>
                <Select.Content>
                  {(warehouses ?? []).map((warehouse) => (
                    <Select.Item key={warehouse.id} value={warehouse.id}>
                      {warehouse.nameAr}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label htmlFor="shift-openingBalance">{t('shifts.openingBalance')} *</Label>
              <Input
                id="shift-openingBalance"
                type="number"
                min="0"
                step="0.01"
                value={openingBalance}
                onChange={(event) => setOpeningBalance(event.target.value)}
                className="numeric mt-1.5"
                dir="ltr"
                disabled={opening}
              />
            </div>
            <div>
              <Label htmlFor="shift-openNotes">{t('shifts.notes')}</Label>
              <Input
                id="shift-openNotes"
                value={openNotes}
                onChange={(event) => setOpenNotes(event.target.value)}
                placeholder={t('shifts.notesPlaceholder')}
                className="mt-1.5"
                disabled={opening}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={opening}
                onClick={() => {
                  if (!warehouseId) {
                    setFormError(t('shifts.selectWarehouseError'));
                    return;
                  }
                  openShift({
                    warehouseId,
                    openingBalance: normaliseDecimalString(openingBalance || '0.00'),
                    ...(openNotes.trim() ? { notes: openNotes.trim() } : {}),
                  });
                }}
              >
                {opening ? t('common.loading') : t('shifts.openShift')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Close shift dialog with live reconciliation */}
      <Dialog
        open={closeOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCloseOpen(false);
            setCloseId(null);
          }
        }}
      >
        <DialogContent
          title={t('shifts.closeReconciliation')}
          description={t('shifts.closeReconciliationHint')}
          className="max-w-2xl"
        >
          {detailLoading ? (
            <div className="p-6 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : null}
          {detailError ? (
            <div className="p-6 text-center text-destructive">{t('errors.generic')}</div>
          ) : null}

          {shiftDetail ? (
            <div className="space-y-4">
              <ReconciliationSummary
                reconciliation={shiftDetail.reconciliation}
                locale={moneyLocale}
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="shift-closingBalance">{t('shifts.countedCash')} *</Label>
                  <Input
                    id="shift-closingBalance"
                    type="number"
                    min="0"
                    step="0.01"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                    className="numeric mt-1.5"
                    dir="ltr"
                    placeholder="0.00"
                    disabled={closing}
                  />
                </div>
                <div>
                  <Label htmlFor="shift-closeNotes">{t('shifts.closeNotes')}</Label>
                  <Input
                    id="shift-closeNotes"
                    value={closeNotes}
                    onChange={(event) => setCloseNotes(event.target.value)}
                    className="mt-1.5"
                    placeholder={t('shifts.notesPlaceholder')}
                    disabled={closing}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <span className="text-muted-foreground">{t('shifts.variancePreview')}</span>
                {closeVariance !== null ? (
                  <VarianceBadge variance={closeVariance} locale={moneyLocale} />
                ) : (
                  <span className="text-muted-foreground">{t('shifts.varianceHint')}</span>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCloseOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={closing || closeVariance === null}
                  onClick={() => {
                    if (!closeId) return;
                    closeShiftMutation({
                      id: closeId,
                      body: {
                        closingBalance: normaliseDecimalString(countedCash),
                        ...(closeNotes.trim() ? { notes: closeNotes.trim() } : {}),
                      },
                    });
                  }}
                >
                  {closing ? t('common.loading') : t('shifts.closeShift')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Shift details / history dialog */}
      <Dialog
        open={Boolean(detailId)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent
          title={t('shifts.shiftDetails')}
          description={t('shifts.shiftDetailsDescription')}
          className="max-w-3xl"
        >
          {detailLoading ? (
            <div className="p-6 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : null}
          {detailError ? (
            <div className="p-6 text-center text-destructive">{t('errors.generic')}</div>
          ) : null}

          {shiftDetail && detailId ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant={shiftDetail.status === 'OPEN' ? 'success' : 'outline'}>
                  {shiftStatusLabel(shiftDetail.status, locale)}
                </Badge>
                <span className="numeric font-mono" dir="ltr">
                  {shiftDetail.id.slice(-6).toUpperCase()}
                </span>
                <span className="text-muted-foreground">
                  {t('shifts.cashier')}: {shiftDetail.userName ?? '—'}
                </span>
                <span className="text-muted-foreground">
                  {t('inventory.warehouse')}: {shiftDetail.warehouseNameAr ?? '—'}
                </span>
                {shiftDetail.terminalId ? (
                  <span className="text-muted-foreground">
                    {t('shifts.terminal')}: {shiftDetail.terminalId}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <span>
                  {t('shifts.openedAt')}: {formatDateTime(shiftDetail.openedAt, moneyLocale)}
                </span>
                <span>
                  {t('shifts.closedAt')}:{' '}
                  {shiftDetail.closedAt ? formatDateTime(shiftDetail.closedAt, moneyLocale) : '—'}
                </span>
                {shiftDetail.closedByName ? (
                  <span>
                    {t('shifts.closedBy')}: {shiftDetail.closedByName}
                  </span>
                ) : null}
                {shiftDetail.notes ? (
                  <span>
                    {t('shifts.notes')}: {shiftDetail.notes}
                  </span>
                ) : null}
              </div>

              <ReconciliationSummary
                reconciliation={shiftDetail.reconciliation}
                locale={moneyLocale}
              />

              {shiftDetail.status === 'OPEN' && canOpenClose ? (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-sm font-medium">{t('shifts.addMovement')}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Select
                      value={movementType}
                      onValueChange={(value) => setMovementType(value as CashMovementTypeCode)}
                    >
                      <Select.Trigger aria-label={t('shifts.movementType')}>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="paid_in">{t('shifts.movementPaidIn')}</Select.Item>
                        <Select.Item value="paid_out">{t('shifts.movementPaidOut')}</Select.Item>
                      </Select.Content>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={movementAmount}
                      onChange={(event) => setMovementAmount(event.target.value)}
                      placeholder={t('shifts.movementAmount')}
                      aria-label={t('shifts.movementAmount')}
                      className="numeric"
                      dir="ltr"
                    />
                    <Input
                      value={movementReason}
                      onChange={(event) => setMovementReason(event.target.value)}
                      placeholder={t('shifts.movementReasonPlaceholder')}
                      aria-label={t('shifts.movementReason')}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {movementError ? (
                      <span className="text-xs text-destructive">{movementError}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('shifts.movementReason')}
                      </span>
                    )}
                    <Button
                      size="sm"
                      disabled={addingMovement}
                      onClick={() => {
                        const amount = Number(movementAmount);
                        if (!Number.isFinite(amount) || amount <= 0) {
                          setMovementError(t('shifts.invalidAmount'));
                          return;
                        }
                        if (movementReason.trim().length < 3) {
                          setMovementError(t('shifts.movementReasonRequired'));
                          return;
                        }
                        addMovement({
                          id: shiftDetail.id,
                          body: {
                            type: movementType,
                            amount: normaliseDecimalString(movementAmount),
                            reason: movementReason.trim(),
                          },
                        });
                      }}
                    >
                      {addingMovement ? t('common.loading') : t('shifts.addMovement')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {shiftDetail.status === 'CLOSED' &&
              shiftDetail.reconciliation.countedCash !== null &&
              shiftDetail.reconciliation.variance !== null ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                  data-testid="closed-variance"
                >
                  <span>
                    {t('shifts.countedCash')}:{' '}
                    <strong className="numeric" dir="ltr">
                      {formatMoney(
                        shiftDetail.reconciliation.countedCash,
                        moneyLocale,
                      )}
                    </strong>
                  </span>
                  <VarianceBadge
                    variance={shiftDetail.reconciliation.variance}
                    locale={moneyLocale}
                  />
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-sm font-medium">{t('shifts.recentSales')}</p>
                {shiftDetail.recentSales.length === 0 ? (
                  <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                    {t('shifts.noSales')}
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('shifts.invoice')}</TableHead>
                          <TableHead>{t('shifts.time')}</TableHead>
                          <TableHead>{t('shifts.paymentMethods')}</TableHead>
                          <TableHead className="numeric text-right">{t('shifts.total')}</TableHead>
                          <TableHead className="text-center">{t('common.status')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shiftDetail.recentSales.map((sale) => (
                          <TableRow key={sale.id}>
                            <TableCell className="numeric text-xs" dir="ltr">
                              {sale.invoiceNumber}
                            </TableCell>
                            <TableCell className="numeric text-xs" dir="ltr">
                              {formatDateTime(sale.createdAt, moneyLocale)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {sale.paymentMethods.length > 0
                                ? sale.paymentMethods.join(' · ')
                                : '—'}
                            </TableCell>
                            <TableCell className="numeric text-right text-xs">
                              {formatMoney(sale.total, moneyLocale)}
                            </TableCell>
                            <TableCell className="text-center text-xs">
                              {saleStatusLabel(sale.status, locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t('shifts.cashMovements')}</p>
                {shiftDetail.movements.length === 0 ? (
                  <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                    {t('shifts.noMovements')}
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('shifts.time')}</TableHead>
                          <TableHead>{t('shifts.movementType')}</TableHead>
                          <TableHead>{t('shifts.movementReason')}</TableHead>
                          <TableHead>{t('shifts.user')}</TableHead>
                          <TableHead className="numeric text-right">
                            {t('shifts.movementAmount')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shiftDetail.movements.map((movement) => (
                          <TableRow key={movement.id}>
                            <TableCell className="numeric text-xs" dir="ltr">
                              {formatDateTime(movement.createdAt, moneyLocale)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {movement.type === 'paid_in'
                                ? t('shifts.movementPaidIn')
                                : t('shifts.movementPaidOut')}
                            </TableCell>
                            <TableCell className="text-xs">{movement.reason}</TableCell>
                            <TableCell className="text-xs">{movement.userName ?? '—'}</TableCell>
                            <TableCell className="numeric text-right text-xs">
                              {formatMoney(movement.amount, moneyLocale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {formError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {formError}
        </div>
      ) : null}
    </div>
  );
}
