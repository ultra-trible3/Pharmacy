import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import type { ExpenseDto, ExpenseSummaryDto } from '@pharmacy/shared';
import { useI18n } from '../i18n/useI18n';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
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
import { api } from '../lib/api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import { toast } from '../components/ui/toast';
import { useAuthStore } from '../store/auth';
import { ExpenseFormDialog } from '../components/expenses/ExpenseFormDialog';

const PAGE_SIZE = 25;

const CATEGORY_LABELS_AR: Record<string, string> = {
  RENT: 'إيجار',
  SALARY: 'رواتب',
  UTILITIES: 'مرافق',
  MAINTENANCE: 'صيانة',
  MARKETING: 'تسويق',
  OTHER: 'أخرى',
};

const CATEGORY_LABELS_EN: Record<string, string> = {
  RENT: 'Rent',
  SALARY: 'Salaries',
  UTILITIES: 'Utilities',
  MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing',
  OTHER: 'Other',
};

function categoryLabel(category: string, locale: string): string {
  const map = locale === 'ar' ? CATEGORY_LABELS_AR : CATEGORY_LABELS_EN;
  return map[category] ?? category;
}

export function ExpensesPage(): ReactElement {
  const { t, locale } = useI18n();
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';
  const queryClient = useQueryClient();
  const can = useAuthStore((state) => state.can);
  const canWrite = can('expenses:write');
  const canDelete = can('expenses:delete');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(PAGE_SIZE);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    includeInactive: includeInactive ? 'true' : 'false',
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['expenses', params],
    queryFn: () => api.expenses.list(params),
    placeholderData: (previous) => previous,
  });

  const { data: editExpense } = useQuery({
    queryKey: ['expenses', 'edit', editId],
    queryFn: () => api.expenses.get(editId!),
    enabled: editId !== null,
  });

  const summary = data?.summary as ExpenseSummaryDto | undefined;

  const { mutate: removeExpense, isPending: removing } = useMutation({
    mutationFn: (id: string) => api.expenses.remove(id),
    onSuccess: () => {
      toast.success(t('expenses.deleted'));
      setDeleteId(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = (data?.items ?? []) as ExpenseDto[];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('expenses.totalAmount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatMoney(summary?.totalAmount ?? '0.00', moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('expenses.totalCount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatNumber(summary?.totalCount ?? 0, moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('expenses.thisMonthAmount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatMoney(summary?.thisMonthAmount ?? '0.00', moneyLocale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('expenses.thisMonthCount')}</p>
          <p className="numeric mt-1 text-xl font-semibold">
            {formatNumber(summary?.thisMonthCount ?? 0, moneyLocale)}
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
            placeholder={t('expenses.searchPlaceholder')}
            aria-label={t('expenses.searchPlaceholder')}
            className="ps-9"
          />
        </div>

        <Select
          value={categoryFilter}
          onChange={(event) => {
            setCategoryFilter(event.target.value);
            setPage(1);
          }}
          aria-label={t('expenses.category')}
        >
          <option value="">{t('common.all')}</option>
          {Object.entries(CATEGORY_LABELS_AR).map(([key, labelAr]) => (
            <option key={key} value={key}>
              {locale === 'ar' ? labelAr : CATEGORY_LABELS_EN[key]}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPage(1);
            }}
            placeholder={t('expenses.dateFrom')}
            aria-label={t('expenses.dateFrom')}
            className="w-32"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPage(1);
            }}
            placeholder={t('expenses.dateTo')}
            aria-label={t('expenses.dateTo')}
            className="w-32"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={includeInactive}
            onChange={(event) => {
              setIncludeInactive(event.target.checked);
              setPage(1);
            }}
          />
          {t('common.includeInactive')}
        </label>

        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {isFetching ? t('common.loading') : t('common.refresh')}
        </Button>

        {canWrite ? (
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus size={14} /> {t('expenses.add')}
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
          <div className="p-8 text-center text-muted-foreground">{t('expenses.noExpenses')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('expenses.reference')}</TableHead>
                <TableHead>{t('expenses.paidAt')}</TableHead>
                <TableHead>{t('expenses.category')}</TableHead>
                <TableHead>{t('expenses.description')}</TableHead>
                <TableHead className="numeric text-right">{t('common.total')}</TableHead>
                <TableHead>{t('expenses.paidBy')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead className="text-center">{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="numeric font-medium" dir="ltr">
                    {expense.reference}
                  </TableCell>
                  <TableCell className="numeric" dir="ltr">
                    {formatDate(expense.paidAt, moneyLocale)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {categoryLabel(expense.category, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {expense.descriptionAr}
                  </TableCell>
                  <TableCell className="numeric text-right font-medium">
                    {formatMoney(expense.amount, moneyLocale)}
                  </TableCell>
                  <TableCell className="text-sm">{expense.paidBy}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {expense.warehouseNameAr ?? '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={expense.isActive ? 'success' : 'outline'}
                    >
                      {expense.isActive ? t('products.active') : t('products.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1">
                      {canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditId(expense.id);
                            setEditOpen(true);
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={removing}
                          onClick={() => setDeleteId(expense.id)}
                          aria-label={t('common.delete')}
                        >
                          {t('common.delete')}
                        </Button>
                      ) : null}
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

      {/* Add / Edit dialog */}
      <ExpenseFormDialog
        open={newOpen || editOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewOpen(false);
            setEditOpen(false);
            setEditId(null);
          }
        }}
        expense={editExpense ?? null}
      />

      {/* Delete confirmation */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent title={t('common.delete')} description={t('expenses.deleteConfirm')}>
          <p className="text-sm">{t('expenses.deleteWarning')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => deleteId && removeExpense(deleteId)}
            >
              {removing ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
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
