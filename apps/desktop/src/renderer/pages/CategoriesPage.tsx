import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Spinner } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from '../components/ui/toast';
import { api, type CategoryDto } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../store/auth';
import { CategoryFormDialog } from '../components/categories/CategoryFormDialog';
import { CategoryViewDialog } from '../components/categories/CategoryViewDialog';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function CategoriesPage(): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();
  const canWrite = useAuthStore((state) => state.can('products:write'));
  const canDelete = useAuthStore((state) => state.can('products:delete'));
  const canRead = useAuthStore((state) => state.can('products:read'));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [viewing, setViewing] = useState<CategoryDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CategoryDto | null>(null);

  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, includeInactive]);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(includeInactive ? { includeInactive: 'true' } : {}),
    }),
    [page, debouncedSearch, includeInactive],
  );

  const categories = useQuery({
    queryKey: ['categories', params],
    queryFn: () => api.categories.list(params),
    placeholderData: (previous) => previous,
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => api.categories.remove(id),
    onSuccess: async (result) => {
      toast.success(result.deleted ? t('categories.deleted') : t('categories.deactivated'));
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      setPendingDelete(null);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const items = useMemo(() => categories.data?.items ?? [], [categories.data]);
  const totalPages = categories.data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={includeInactive}
            onChange={(event) => {
              setIncludeInactive(event.target.checked);
              setPage(1);
            }}
          />
          {t('suppliers.includeInactive')}
        </label>

        <Button variant="outline" size="sm" onClick={() => void categories.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>

        {canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('categories.add')}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('categories.productCount')}</span>
        {categories.isFetching ? <Spinner className="h-3 w-3" /> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {categories.isLoading ? <EmptyState message={t('common.loading')} /> : null}
        {categories.isError ? <EmptyState message={t('errors.network')} /> : null}

        {!categories.isLoading && !categories.isError && items.length === 0 ? (
          <EmptyState message={t('common.noData')} />
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('categories.code')}</TableHead>
                <TableHead>{t('categories.nameAr')}</TableHead>
                <TableHead>{t('categories.nameEn')}</TableHead>
                <TableHead className="text-center">{t('categories.productCount')}</TableHead>
                <TableHead>{t('products.status')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((category) => {
                return (
                  <TableRow key={category.id}>
                    <TableCell className="numeric font-medium" dir="ltr">
                      {category.code}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <span className="block truncate">{category.nameAr}</span>
                    </TableCell>
                    <TableCell className="max-w-[200px] text-muted-foreground">
                      {category.nameEn ?? '—'}
                    </TableCell>
                    <TableCell className="numeric text-center">
                      {formatNumber(category.productCount, tag)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={category.isActive ? 'success' : 'outline'}>
                        {category.isActive ? t('products.active') : t('products.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {canRead ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('categories.view')}
                            title={t('categories.view')}
                            onClick={() => {
                              setViewing(category);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                            onClick={() => {
                              setEditing(category);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('categories.delete')}
                            title={t('categories.delete')}
                            onClick={() => setPendingDelete(category)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <span className="numeric text-xs text-muted-foreground">
            {t('common.page')} {formatNumber(page, tag)} {t('common.of')} {formatNumber(totalPages, tag)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
      />

      <CategoryViewDialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        category={viewing}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent title={t('common.delete')} description={t('categories.deleteConfirm', { name: pendingDelete?.nameAr ?? '' })}>
          {pendingDelete ? (
            <p className="text-sm">
              <span className="font-semibold">{pendingDelete.nameAr}</span>
              <span className="numeric ms-2 text-muted-foreground" dir="ltr">
                {pendingDelete.code}
              </span>
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removeCategory.isPending}
              onClick={() => pendingDelete && removeCategory.mutate(pendingDelete.id)}
            >
              {removeCategory.isPending ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
