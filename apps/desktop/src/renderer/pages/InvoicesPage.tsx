import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { useI18n } from '../i18n/useI18n';
import { toast } from '../components/ui/toast';
import { formatMoney } from '../lib/format';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api, type SaleDto } from '../lib/api';
import { Printer } from 'lucide-react';
import { InvoicePrintSheet } from '../components/invoices/InvoicePrintSheet';

export function InvoicesPage(): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewingInvoice, setViewingInvoice] = useState<SaleDto | null>(null);
  const [printingInvoice, setPrintingInvoice] = useState<SaleDto | null>(null);
  const [printing, setPrinting] = useState(false);

  const { data: sales, isLoading, isError } = useQuery({
    queryKey: ['invoices', page, pageSize, debouncedSearch],
    queryFn: () =>
      api.sales.list({
        page,
        pageSize,
        q: debouncedSearch || undefined,
        status: 'completed',
      }),
    placeholderData: (previous) => previous,
  });

  const { mutate: reprintInvoice, isPending: reprinting } = useMutation({
    mutationFn: (id: string) => api.sales.get(id),
    onSuccess: (sale) => {
      setViewingInvoice(sale);
    },
    onError: () =>
      toast.error(t('sales.detailLoadError')),
  });

  const items = sales?.items ?? [];
  const totalPages = sales?.totalPages ?? 1;

  const handleView = (id: string) => {
    setPrintingInvoice(null);
    reprintInvoice(id);
  };

  const handlePrint = async () => {
    if (!viewingInvoice) return;
    setPrinting(true);
    try {
      setPrintingInvoice(viewingInvoice);
      // Allow the portal to mount before printing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await api.print({ silent: false, printBackground: true });
      if (result.ok) {
        toast.success(t('pos.success.receiptPrinted'));
      } else if (!result.cancelled) {
        toast.error(result.error || t('pos.errors.printFailed'));
      }
    } catch {
      toast.error(t('pos.errors.printFailed'));
    } finally {
      setPrinting(false);
      setPrintingInvoice(null);
      setViewingInvoice(null);
    }
  };

  return (
    <div className="space-y-4">
      {printingInvoice ? (
        <InvoicePrintSheet invoice={printingInvoice} locale={locale} />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDebouncedSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('invoices.searchPlaceholder')}
            aria-label={t('invoices.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <Select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          aria-label={t('common.pageSize')}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
        </Select>
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
                <TableHead>{t('invoices.invoice')}</TableHead>
                <TableHead>{t('sales.date')}</TableHead>
                <TableHead>{t('sales.customer')}</TableHead>
                <TableHead className="numeric text-right">{t('sales.total')}</TableHead>
                <TableHead className="text-center">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>{sale.invoiceNumber}</TableCell>
                  <TableCell>{sale.createdAt ? sale.createdAt.split('T')[0] : '—'}</TableCell>
                  <TableCell>{sale.customer ? sale.customer.name : '—'}</TableCell>
                  <TableCell className="numeric text-right">{formatMoney(sale.total, moneyLocale)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reprinting}
                        onClick={() => handleView(sale.id)}
                        aria-label={t('common.view')}
                      >
                        {t('common.view')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reprinting || printing}
                        onClick={() => handleView(sale.id)}
                        aria-label={t('invoices.printInvoice')}
                      >
                        <Printer className="h-4 w-4" />
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

      <Dialog
        open={viewingInvoice !== null}
        onOpenChange={(open) => !open && setViewingInvoice(null)}
      >
        <DialogContent
          title={viewingInvoice ? viewingInvoice.invoiceNumber : ''}
          description={t('invoices.invoiceDetails')}
          className="max-w-2xl"
        >
          {viewingInvoice ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.customer')}</p>
                  <p className="text-sm">{viewingInvoice.customer?.name ?? t('sales.walkIn')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.cashier')}</p>
                  <p className="text-sm">{viewingInvoice.user?.fullName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.date')}</p>
                  <p className="text-sm">{viewingInvoice.createdAt ? viewingInvoice.createdAt.split('T')[0] : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.status')}</p>
                  <p className="text-sm capitalize">{t(`sales.status.${viewingInvoice.status}`)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('sales.items')}</p>
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('purchases.product')}</TableHead>
                        <TableHead className="numeric text-center">{t('inventory.quantity')}</TableHead>
                        <TableHead className="numeric text-right">{t('products.costPrice')}</TableHead>
                        <TableHead className="numeric text-right">{t('common.total')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingInvoice.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-[160px] truncate">
                            {item.product?.nameAr ?? '—'}
                          </TableCell>
                          <TableCell className="numeric text-center">{item.quantity}</TableCell>
                          <TableCell className="numeric text-right">{formatMoney(item.unitPrice, moneyLocale)}</TableCell>
                          <TableCell className="numeric text-right">{formatMoney(item.lineTotal, moneyLocale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.subtotal')}</p>
                  <p className="numeric text-right">{formatMoney(viewingInvoice.subtotal, moneyLocale)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.discountTotal')}</p>
                  <p className="numeric text-right">{formatMoney(viewingInvoice.itemDiscount, moneyLocale)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('sales.taxAmount')}</p>
                  <p className="numeric text-right">{formatMoney(viewingInvoice.taxAmount, moneyLocale)}</p>
                </div>
                <div className="font-semibold border-t pt-3">
                  <p className="text-xs text-muted-foreground">{t('sales.total')}</p>
                  <p className="numeric text-right text-lg">{formatMoney(viewingInvoice.total, moneyLocale)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('sales.payments')}</p>
                <div className="rounded-md border border-border p-3">
                  {viewingInvoice.payments.length > 0 ? (
                    <div className="space-y-1">
                      {viewingInvoice.payments.map((p) => (
                        <div key={p.id} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t(`pos.payment.${p.method}`) ?? p.method}
                          </span>
                          <span className="numeric">{formatMoney(p.amount, moneyLocale)}</span>
                          {p.reference && <span className="text-xs text-muted-foreground">({p.reference})</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>

              {viewingInvoice.note && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">ملاحظة</p>
                  <p className="text-sm">{viewingInvoice.note}</p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingInvoice(null)}>
              {t('common.close')}
            </Button>
            <Button
              variant="outline"
              disabled={printing || reprinting || !viewingInvoice}
              onClick={handlePrint}
            >
              {printing ? (
                <>
                  <Printer className="h-4 w-4 animate-spin" /> {t('common.printing')}
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" /> {t('common.print')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
