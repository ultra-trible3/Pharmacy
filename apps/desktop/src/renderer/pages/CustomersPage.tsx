import { useState, useEffect, type ReactElement } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/dictionaries';
import { formatMoney } from '../lib/format';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { ChevronDown, Trash2, Eye, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../components/ui/toast';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog';

interface FormValues {
  name: string;
  phone: string;
  notes: string;
  loyaltyPoints: number;
  creditLimit: string;
  currentBalance: string;
}

const emptyForm: FormValues = { name: '', phone: '', notes: '', loyaltyPoints: 0, creditLimit: '0.00', currentBalance: '0.00' };

export function CustomersPage(): ReactElement {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: customersData, isLoading, isError, refetch } = useQuery({
    queryKey: ['customers', page, debouncedSearch],
    queryFn: () =>
      api.customers.list({ page, pageSize: 25, q: debouncedSearch || undefined, includeInactive: false }),
    placeholderData: (previous) => previous,
  });

  const { mutate: addCustomer, isPending: adding } = useMutation({
    mutationFn: (body: FormValues) => api.customers.create(body),
    onSuccess: () => {
      toast.success(t('customers.created'));
      setAddFormOpen(false);
      setAddValues(emptyForm);
      refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('errors.generic')),
  });

  const { mutate: updateCustomer, isPending: updating } = useMutation({
    mutationFn: ({ id, ...body }: FormValues & { id: string }) =>
      api.customers.update(id, body),
    onSuccess: (_data) => {
      toast.success(t('customers.updated'));
      setEditFormOpen(false);
      setEditValues(emptyForm);
      refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('errors.generic')),
  });

  const { mutate: deleteCustomer, isPending: deleting } = useMutation({
    mutationFn: (id: string) => api.customers.delete(id),
    onSuccess: () => {
      toast.success(t('customers.deleted'));
      setDeleteConfirmOpen(false);
      setDeleteTargetId(null);
      refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('customers.deleteError')),
  });

  const items = customersData?.items ?? [];
  const totalPages = customersData?.totalPages ?? 1;

  const [addFormOpen, setAddFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [viewFormOpen, setViewFormOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [addValues, setAddValues] = useState<FormValues>(emptyForm);
  const [editValues, setEditValues] = useState<FormValues>(emptyForm);

  const handleEdit = (id: string) => {
    setEditingId(id);
    const item = items.find((it) => it.id === id);
    if (item) {
      setEditValues({
        name: item.name,
        phone: item.phone ?? '',
        notes: item.notes ?? '',
        loyaltyPoints: item.loyaltyPoints ?? 0,
        creditLimit: item.creditLimit ?? '0.00',
        currentBalance: item.currentBalance ?? '0.00',
      });
    }
    setEditFormOpen(true);
  };

  const handleView = (id: string) => {
    setViewingId(id);
    setViewFormOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  useEffect(() => {
    if (editingId) {
      const item = items.find((it) => it.id === editingId);
      if (item) {
        setEditValues({
          name: item.name,
          phone: item.phone ?? '',
          notes: item.notes ?? '',
          loyaltyPoints: item.loyaltyPoints ?? 0,
          creditLimit: item.creditLimit ?? '0.00',
          currentBalance: item.currentBalance ?? '0.00',
        });
      }
    }
  }, [editingId, items]);

  const viewCustomer = items.find((c) => c.id === viewingId);

  const renderField = (labelKey: TranslationKey, inputProps: React.ReactElement) => (
    <div className="space-y-1" key={labelKey}>
      <label className="block text-sm font-medium text-foreground">{t(labelKey)}</label>
      {inputProps}
    </div>
  );

  return (
    <div className="space-y-4">
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
        <Button variant="outline" size="sm" onClick={() => setAddFormOpen(true)}>
          <Plus size={16} /> {t('customers.add')}
        </Button>
        <Button variant="outline" size="sm" disabled={adding} onClick={() => refetch()}>
          {adding ? t('common.loading') : t('common.refresh')}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div> : null}
        {isError ? <div className="p-8 text-center text-destructive">{t('errors.generic')}</div> : null}
        {!isLoading && !isError && items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.noResults')}</div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('customers.name')}</TableHead>
                <TableHead>{t('customers.phone')}</TableHead>
                <TableHead className="numeric text-center">{t('customers.points')}</TableHead>
                <TableHead className="numeric text-center">{t('common.balance')}</TableHead>
                <TableHead className="numeric text-center">{t('customers.creditLimit')}</TableHead>
                <TableHead>{t('customers.notes')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((cust) => (
                <TableRow key={cust.id}>
                  <TableCell>{cust.name}</TableCell>
                  <TableCell>{cust.phone ?? '—'}</TableCell>
                  <TableCell className="numeric text-center">{cust.loyaltyPoints ?? 0}</TableCell>
                  <TableCell className="numeric text-center">{formatMoney(cust.currentBalance ?? '0.00', locale === 'ar' ? 'ar-EG' : 'en-EG')}</TableCell>
                  <TableCell className="numeric text-center">{formatMoney(cust.creditLimit ?? '0.00', locale === 'ar' ? 'ar-EG' : 'en-EG')}</TableCell>
                  <TableCell>{cust.notes ?? '—'}</TableCell>
                  <TableCell className="numeric text-right">
                    <Button variant="ghost" size="icon" aria-label={t('customers.view')} onClick={() => handleView(cust.id)}>
                      <Eye size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('customers.edit')} onClick={() => handleEdit(cust.id)}>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button variant="destructive" size="icon" aria-label={t('customers.delete')} onClick={() => handleDelete(cust.id)}>
                      <Trash2 size={16} />
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

      <Dialog open={addFormOpen} onOpenChange={setAddFormOpen}>
        <DialogContent title={t('customers.add')} description={t('customers.details')}>
          <div className="space-y-3 py-2">
            {renderField('customers.name', (
              <Input
                placeholder={t('customers.name')}
                value={addValues.name}
                onChange={(e) => setAddValues({ ...addValues, name: e.target.value })}
                aria-label={t('customers.name')}
                required
              />
            ))}
            {renderField('customers.phone', (
              <Input
                placeholder={t('customers.phone')}
                value={addValues.phone}
                onChange={(e) => setAddValues({ ...addValues, phone: e.target.value })}
                aria-label={t('customers.phone')}
              />
            ))}
            {renderField('customers.points', (
              <Input
                type="number"
                placeholder={t('customers.points')}
                value={String(addValues.loyaltyPoints)}
                onChange={(e) => setAddValues({ ...addValues, loyaltyPoints: Number(e.target.value) || 0 })}
                aria-label={t('customers.points')}
              />
            ))}
            {renderField('customers.creditLimit', (
              <Input
                type="number"
                step="0.01"
                placeholder={t('customers.creditLimit')}
                value={addValues.creditLimit}
                onChange={(e) => setAddValues({ ...addValues, creditLimit: e.target.value })}
                aria-label={t('customers.creditLimit')}
              />
            ))}
            {renderField('customers.balance', (
              <Input
                type="number"
                step="0.01"
                placeholder={t('customers.balance')}
                value={addValues.currentBalance}
                onChange={(e) => setAddValues({ ...addValues, currentBalance: e.target.value })}
                aria-label={t('customers.balance')}
              />
            ))}
            {renderField('customers.notes', (
              <Input
                placeholder={t('customers.notes')}
                value={addValues.notes}
                onChange={(e) => setAddValues({ ...addValues, notes: e.target.value })}
                aria-label={t('customers.notes')}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFormOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={adding} onClick={() => addCustomer(addValues)}>
              {adding ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editFormOpen} onOpenChange={setEditFormOpen}>
        <DialogContent title={t('customers.edit')} description={t('customers.details')}>
          <div className="space-y-3 py-2">
            {renderField('customers.name', (
              <Input
                placeholder={t('customers.name')}
                value={editValues.name}
                onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                aria-label={t('customers.name')}
                required
              />
            ))}
            {renderField('customers.phone', (
              <Input
                placeholder={t('customers.phone')}
                value={editValues.phone}
                onChange={(e) => setEditValues({ ...editValues, phone: e.target.value })}
                aria-label={t('customers.phone')}
              />
            ))}
            {renderField('customers.points', (
              <Input
                type="number"
                placeholder={t('customers.points')}
                value={String(editValues.loyaltyPoints)}
                onChange={(e) => setEditValues({ ...editValues, loyaltyPoints: Number(e.target.value) || 0 })}
                aria-label={t('customers.points')}
              />
            ))}
            {renderField('customers.creditLimit', (
              <Input
                type="number"
                step="0.01"
                placeholder={t('customers.creditLimit')}
                value={editValues.creditLimit}
                onChange={(e) => setEditValues({ ...editValues, creditLimit: e.target.value })}
                aria-label={t('customers.creditLimit')}
              />
            ))}
            {renderField('customers.balance', (
              <Input
                type="number"
                step="0.01"
                placeholder={t('customers.balance')}
                value={editValues.currentBalance}
                onChange={(e) => setEditValues({ ...editValues, currentBalance: e.target.value })}
                aria-label={t('customers.balance')}
              />
            ))}
            {renderField('customers.notes', (
              <Input
                placeholder={t('customers.notes')}
                value={editValues.notes}
                onChange={(e) => setEditValues({ ...editValues, notes: e.target.value })}
                aria-label={t('customers.notes')}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFormOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={updating || !editingId} onClick={() => editingId && updateCustomer({ id: editingId, ...editValues })}>
              {updating ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewFormOpen} onOpenChange={setViewFormOpen}>
        <DialogContent title={viewCustomer?.name ?? t('customers.details')} description={t('customers.purchaseHistory')} className="max-w-md">
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">{t('customers.phone')}</p>
                <p>{viewCustomer?.phone ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('customers.points')}</p>
                <p className="font-medium">{viewCustomer?.loyaltyPoints ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('common.balance')}</p>
                <p className="font-medium">{formatMoney(viewCustomer?.currentBalance ?? '0.00', locale === 'ar' ? 'ar-EG' : 'en-EG')}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('customers.creditLimit')}</p>
                <p className="font-medium">{formatMoney(viewCustomer?.creditLimit ?? '0.00', locale === 'ar' ? 'ar-EG' : 'en-EG')}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('customers.notes')}</p>
                <p>{viewCustomer?.notes ?? '—'}</p>
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-muted-foreground text-xs font-medium mb-2">{t('customers.invoices')}</p>
              <p className="text-muted-foreground text-xs">{t('customers.noPurchases')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setViewFormOpen(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent title={t('customers.delete')} description={t('customers.deleteConfirm')}>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteTargetId && deleteCustomer(deleteTargetId)}
            >
              {deleting ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
