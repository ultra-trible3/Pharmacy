import { useState, type ReactElement } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { useI18n } from '../i18n/useI18n';
import { toast } from '../components/ui/toast';
import { formatMoney } from '../lib/format';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { X } from 'lucide-react';
import { api, type SaleStatusCode } from '../lib/api';

export function SalesPage(): ReactElement {
  const { t, locale, dir } = useI18n();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SaleStatusCode | undefined>('completed');
  const [dateFrom, setDateFrom] = useState<string | undefined>('');
  const [dateTo, setDateTo] = useState<string | undefined>('');

  // Dialog & Void state
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const { data: sales, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales', page, search, status, dateFrom, dateTo],
    queryFn: () =>
      api.sales.list({
        page,
        pageSize: 50,
        q: search || undefined,
        status,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      }),
    placeholderData: (previous) => previous,
  });

  const { mutate: voidSale, isPending: voiding } = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      api.sales.void(params.id, params.reason),
    onSuccess: () => {
      toast.success(t('sales.voided'));
      setVoidDialogOpen(false);
      setSelectedSaleId(null);
      setVoidReason('');
      refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('errors.generic')),
  });

  const items = sales?.items ?? [];
  const totalPages = sales?.totalPages ?? 1;

  const statusLabels: Record<SaleStatusCode, string> = {
    completed: t('sales.status.completed'),
    suspended: t('sales.status.suspended'),
    voided: t('sales.status.voided'),
  };

  return (
    <div className="space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as SaleStatusCode)}
          aria-label={t('sales.filter.all')}
        >
          <option value="completed">{t('sales.status.completed')}</option>
          <option value="suspended">{t('sales.status.suspended')}</option>
          <option value="voided">{t('sales.status.voided')}</option>
        </Select>

        <Input
          type="date"
          placeholder="من تاريخ"
          value={dateFrom ?? ''}
          onChange={(e) => setDateFrom(e.target.value)}
          className="my-2"
          aria-label={t('sales.dateFrom')}
        />
        <Input
          type="date"
          placeholder="إلى تاريخ"
          value={dateTo ?? ''}
          onChange={(e) => setDateTo(e.target.value)}
          className="my-2"
          aria-label={t('sales.dateTo')}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={voiding || items.length === 0}
          onClick={() => {
            if (items[0]) {
              setSelectedSaleId(items[0].id);
              setVoidDialogOpen(true);
            }
          }}
        >
          {voiding ? t('common.loading') : t('sales.void')}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : null}
        {isError ? (
          <div className="p-8 text-center text-destructive">{t('errors.generic')}</div>
        ) : null}
        {!isLoading && !isError && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.noResults')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sales.invoiceNumber')}</TableHead>
                <TableHead>{t('sales.date')}</TableHead>
                <TableHead>{t('sales.customer')}</TableHead>
                <TableHead>{t('sales.cashier')}</TableHead>
                <TableHead className="numeric text-center">{t('sales.items')}</TableHead>
                <TableHead className="numeric text-right">{t('sales.total')}</TableHead>
                <TableHead>{t('sales.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>{sale.invoiceNumber}</TableCell>
                  <TableCell>{sale.createdAt ? sale.createdAt.split('T')[0] : '—'}</TableCell>
                  <TableCell>{sale.customer ? sale.customer.name : t('sales.walkIn')}</TableCell>
                  <TableCell>{sale.user ? sale.user.fullName : '—'}</TableCell>
                  <TableCell className="numeric text-center">{sale.items?.length ?? 0}</TableCell>
                  <TableCell className="numeric text-right">{formatMoney(sale.total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</TableCell>
                  <TableCell>
                    <Badge variant={sale.status === 'completed' ? 'success' : 'outline'}>
                      {statusLabels[sale.status as SaleStatusCode] ?? sale.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('sales.void')}
                      onClick={() => {
                        setSelectedSaleId(sale.id);
                        setVoidDialogOpen(true);
                      }}
                    >
                      <X className="h-3 w-3 text-destructive" />
                    </Button>
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

      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent
          title={t('sales.voidConfirm')}
          description={t('sales.voidReason')}
        >
          <div className="py-4">
            <Input
              placeholder="اكتب سبب الإلغاء هنا..."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!voidReason.trim() || voiding}
            onClick={() => {
              if (selectedSaleId) {
                voidSale({ id: selectedSaleId, reason: voidReason });
              }
            }}
          >
            {voiding ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}