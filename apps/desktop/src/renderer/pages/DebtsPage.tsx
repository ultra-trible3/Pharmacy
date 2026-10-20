import { useState, useEffect, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, ScrollText } from 'lucide-react';
import { roundCurrency } from '@pharmacy/shared';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/dictionaries';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { api, type DebtPaymentBody, type DebtPaymentMethod, type DebtorDto } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { toast } from '../components/ui/toast';

const PAGE_SIZE = 25;

interface PayFormValues {
  amount: string;
  method: DebtPaymentMethod;
  reference: string;
  note: string;
}

const emptyPayForm: PayFormValues = { amount: '', method: 'cash', reference: '', note: '' };

const METHOD_LABEL_KEYS: Record<DebtPaymentMethod, TranslationKey> = {
  cash: 'debts.methodCash',
  card: 'debts.methodCard',
  wallet: 'debts.methodWallet',
};

export function DebtsPage(): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['debts', page, debouncedSearch],
    queryFn: () => api.debts.list({ page, pageSize: PAGE_SIZE, q: debouncedSearch || undefined }),
    placeholderData: (previous) => previous,
  });

  const [payTarget, setPayTarget] = useState<DebtorDto | null>(null);
  const [payValues, setPayValues] = useState<PayFormValues>(emptyPayForm);
  const [payError, setPayError] = useState<string | null>(null);

  const [ledgerTargetId, setLedgerTargetId] = useState<string | null>(null);
  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['debts', 'ledger', ledgerTargetId],
    queryFn: () => api.debts.ledger(ledgerTargetId!),
    enabled: ledgerTargetId !== null,
  });

  const { mutate: pay, isPending: paying } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DebtPaymentBody }) => api.debts.pay(id, body),
    onSuccess: () => {
      toast.success(t('debts.paymentRecorded'));
      setPayTarget(null);
      setPayValues(emptyPayForm);
      setPayError(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['debts', 'ledger'] });
    },
    onError: (err) => setPayError(err instanceof Error ? err.message : t('errors.generic')),
  });

  const items = data?.items ?? [];
  const summary = data?.summary;
  const totalPages = data?.totalPages ?? 1;

  const openPay = (debtor: DebtorDto) => {
    setPayTarget(debtor);
    setPayValues({ ...emptyPayForm, amount: debtor.currentBalance });
    setPayError(null);
  };

  const submitPay = () => {
    if (!payTarget) return;
    const balance = Number(payTarget.currentBalance);
    const amount = Number(payValues.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError(t('debts.amountRequired'));
      return;
    }
    if (amount > balance + 0.001) {
      setPayError(t('debts.exceedsBalance', { balance: formatMoney(payTarget.currentBalance, moneyLocale) }));
      return;
    }
    if ((payValues.method === 'card' || payValues.method === 'wallet') && !payValues.reference.trim()) {
      setPayError(t('debts.referenceRequired'));
      return;
    }
    pay({
      id: payTarget.id,
      body: {
        amount: roundCurrency(amount),
        method: payValues.method,
        reference: payValues.reference.trim() || undefined,
        note: payValues.note.trim() || undefined,
      },
    });
  };

  const payRemaining = payTarget
    ? roundCurrency(Math.max(0, Number(payTarget.currentBalance) - (Number(payValues.amount) || 0)))
    : '0.00';

  const renderField = (labelKey: TranslationKey, input: React.ReactElement) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">{t(labelKey)}</label>
      {input}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('debts.totalOutstanding')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatMoney(summary?.totalOutstanding ?? '0.00', moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('debts.debtorsCount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">{summary?.debtorsTotal ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('debts.overLimitCount')}</p>
          <p className="numeric mt-1 text-xl font-semibold text-destructive">{summary?.overLimitCount ?? 0}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('debts.searchPlaceholder')}
            aria-label={t('debts.searchPlaceholder')}
          />
        </div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? t('common.loading') : t('common.refresh')}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div> : null}
        {isError ? <div className="p-8 text-center text-destructive">{t('errors.generic')}</div> : null}
        {!isLoading && !isError && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('debts.noDebts')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('customers.name')}</TableHead>
                <TableHead>{t('customers.phone')}</TableHead>
                <TableHead className="numeric text-center">{t('customers.balance')}</TableHead>
                <TableHead className="numeric text-center">{t('customers.creditLimit')}</TableHead>
                <TableHead className="numeric text-center">{t('debts.availableCredit')}</TableHead>
                <TableHead className="text-center">{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((debtor) => (
                <TableRow key={debtor.id}>
                  <TableCell className="font-medium">{debtor.name}</TableCell>
                  <TableCell>{debtor.phone ?? '—'}</TableCell>
                  <TableCell className="numeric text-center font-medium">
                    {formatMoney(debtor.currentBalance, moneyLocale)}
                  </TableCell>
                  <TableCell className="numeric text-center">
                    {Number(debtor.creditLimit) > 0 ? formatMoney(debtor.creditLimit, moneyLocale) : '—'}
                  </TableCell>
                  <TableCell className="numeric text-center">
                    {Number(debtor.creditLimit) > 0 ? formatMoney(debtor.availableCredit, moneyLocale) : '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    {Number(debtor.creditLimit) > 0 ? (
                      debtor.isOverLimit ? (
                        <Badge variant="destructive">{t('debts.overLimit')}</Badge>
                      ) : (
                        <Badge variant="success">{t('debts.withinLimit')}</Badge>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openPay(debtor)}>
                        <HandCoins size={14} /> {t('debts.pay')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setLedgerTargetId(debtor.id)}>
                        <ScrollText size={14} /> {t('debts.ledger')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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

      <Dialog
        open={payTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPayTarget(null);
            setPayError(null);
          }
        }}
      >
        <DialogContent title={t('debts.payTitle', { name: payTarget?.name ?? '' })} description={payTarget?.phone ?? undefined}>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('debts.totalOutstanding')}</span>
              <strong className="numeric">
                {formatMoney(payTarget?.currentBalance ?? '0.00', moneyLocale)}
              </strong>
            </div>
            {renderField(
              'debts.amount',
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={payValues.amount}
                onChange={(e) => setPayValues({ ...payValues, amount: e.target.value })}
                aria-label={t('debts.amount')}
              />,
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                payTarget && setPayValues({ ...payValues, amount: payTarget.currentBalance })
              }
            >
              {t('debts.collectFull')}
            </Button>
            {renderField(
              'debts.method',
              <Select
                value={payValues.method}
                onChange={(e) =>
                  setPayValues({ ...payValues, method: e.target.value as DebtPaymentMethod })
                }
                aria-label={t('debts.method')}
              >
                {(Object.keys(METHOD_LABEL_KEYS) as DebtPaymentMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {t(METHOD_LABEL_KEYS[method])}
                  </option>
                ))}
              </Select>,
            )}
            {renderField(
              'debts.reference',
              <Input
                value={payValues.reference}
                onChange={(e) => setPayValues({ ...payValues, reference: e.target.value })}
                placeholder={t('debts.reference')}
                aria-label={t('debts.reference')}
              />,
            )}
            {renderField(
              'debts.note',
              <Input
                value={payValues.note}
                onChange={(e) => setPayValues({ ...payValues, note: e.target.value })}
                placeholder={t('debts.note')}
                aria-label={t('debts.note')}
              />,
            )}
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('debts.remaining')}</span>
              <strong className="numeric">{formatMoney(payRemaining, moneyLocale)}</strong>
            </div>
            {payError ? <p className="text-sm text-destructive">{payError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={paying} onClick={submitPay}>
              {paying ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ledgerTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setLedgerTargetId(null);
        }}
      >
        <DialogContent
          title={ledger?.customer.name ?? t('debts.ledgerTitle')}
          description={
            ledger
              ? `${t('customers.balance')}: ${formatMoney(ledger.customer.currentBalance, moneyLocale)}`
              : t('debts.ledgerTitle')
          }
        >
          {ledgerLoading ? (
            <div className="p-6 text-center text-muted-foreground">{t('common.loading')}</div>
          ) : ledger && ledger.entries.length > 0 ? (
            <ul className="divide-y divide-border">
              {ledger.entries.map((entry) => (
                <li key={`${entry.type}-${entry.id}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.type === 'sale'
                        ? `${t('debts.charge')} #${entry.invoiceNumber ?? ''}`
                        : t('debts.payment')}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt, moneyLocale)}
                      {entry.type === 'payment' && entry.method
                        ? ` · ${t(METHOD_LABEL_KEYS[entry.method as DebtPaymentMethod] ?? 'debts.payment')}`
                        : ''}
                      {entry.reference ? ` · ${entry.reference}` : ''}
                      {entry.note ? ` · ${entry.note}` : ''}
                      {entry.userName ? ` · ${entry.userName}` : ''}
                    </p>
                  </div>
                  <span
                    className={
                      entry.type === 'sale'
                        ? 'numeric shrink-0 text-sm text-destructive'
                        : 'numeric shrink-0 text-sm text-success'
                    }
                  >
                    {entry.type === 'sale' ? '+' : '−'}
                    {formatMoney(entry.amount, moneyLocale)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-muted-foreground">{t('debts.noEntries')}</div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!ledger}
              onClick={() => {
                if (!ledger) return;
                setLedgerTargetId(null);
                openPay(ledger.customer);
              }}
            >
              <HandCoins size={14} /> {t('debts.pay')}
            </Button>
            <Button onClick={() => setLedgerTargetId(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
