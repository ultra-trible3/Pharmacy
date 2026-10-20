import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { InventoryBatchRow } from '@pharmacy/shared';
import { Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, Select } from '../ui/input';
import { toast } from '../ui/toast';
import { api, type TransferBody } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';

interface LineDraft {
  key: string;
  batchId: string;
  quantity: string;
}

interface TransferFormState {
  fromWarehouseId: string;
  toWarehouseId: string;
  reference: string;
  notes: string;
  items: LineDraft[];
}

function newLine(batchId = ''): LineDraft {
  return { key: crypto.randomUUID(), batchId, quantity: '1' };
}

/**
 * Batch-level warehouse transfer document.
 *
 * A transfer moves whole batches — the lot number and expiry travel with the
 * stock and merge into a matching destination batch — so every line picks an
 * existing batch of the source warehouse instead of a product + FEFO
 * allocation. The document is all-or-nothing: the server rejects the whole
 * transfer when any line is short.
 */
export function TransferDialog({
  open,
  onOpenChange,
  initialBatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Batch preselected when the dialog is opened from a row action. */
  initialBatch?: InventoryBatchRow | null;
}): ReactElement {
  const { t, tag } = useI18n();
  const queryClient = useQueryClient();

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.warehouses.list(),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = useState<TransferFormState>({
    fromWarehouseId: '',
    toWarehouseId: '',
    reference: '',
    notes: '',
    items: [newLine()],
  });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const options = warehouses.data ?? [];
    const fallback = options.find((warehouse) => warehouse.isDefault)?.id ?? options[0]?.id ?? '';
    setForm({
      fromWarehouseId: initialBatch?.warehouseId ?? fallback,
      toWarehouseId: '',
      reference: '',
      notes: '',
      items: [newLine(initialBatch?.batchId ?? '')],
    });
    setFormError(null);
  }, [open, initialBatch, warehouses.data]);

  const sourceBatches = useQuery({
    queryKey: ['inventory', 'batches', 'transfer', form.fromWarehouseId],
    queryFn: () =>
      api.inventory.batches({
        warehouseId: form.fromWarehouseId,
        inStockOnly: 'true',
        includeExpired: 'true',
        pageSize: 200,
      }),
    enabled: open && form.fromWarehouseId !== '',
  });

  const batchRows = sourceBatches.data?.items ?? [];
  const batchById = useMemo(
    () => new Map(batchRows.map((row) => [row.batchId, row])),
    [batchRows],
  );

  const mutation = useMutation({
    mutationFn: (body: TransferBody) => api.inventory.transfer(body),
    onSuccess: async (result) => {
      toast.success(`${t('inventory.transferCreated')}: ${result.reference}`);
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  };

  const submit = () => {
    if (!form.fromWarehouseId || !form.toWarehouseId) {
      setFormError(t('inventory.transferIncomplete'));
      return;
    }
    if (form.fromWarehouseId === form.toWarehouseId) {
      setFormError(t('inventory.transferSameWarehouse'));
      return;
    }
    const incomplete = form.items.some(
      (line) => !line.batchId || !(Number(line.quantity) > 0),
    );
    if (form.items.length === 0 || incomplete) {
      setFormError(t('inventory.transferIncomplete'));
      return;
    }
    const overAvailable = form.items.some((line) => {
      const batch = batchById.get(line.batchId);
      return batch !== undefined && Number(line.quantity) > batch.quantity;
    });
    if (overAvailable) {
      setFormError(t('inventory.transferInsufficient'));
      return;
    }
    mutation.mutate({
      fromWarehouseId: form.fromWarehouseId,
      toWarehouseId: form.toWarehouseId,
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      items: form.items.map((line) => ({
        batchId: line.batchId,
        quantity: Number(line.quantity),
      })),
    });
  };

  const field = (label: string, input: ReactElement) => (
    <label className="block space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {input}
    </label>
  );

  const warehouseOptions = warehouses.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('inventory.transferTitle')}</DialogTitle>
          <DialogDescription>{t('inventory.transferDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {field(
              t('inventory.transferFrom'),
              <Select
                value={form.fromWarehouseId}
                aria-label={t('inventory.transferFrom')}
                onChange={(event) => {
                  const value = event.target.value;
                  // Batches belong to a warehouse, so switching the source
                  // invalidates every picked line; the destination may not
                  // equal the source either.
                  setForm((current) => ({
                    ...current,
                    fromWarehouseId: value,
                    toWarehouseId: current.toWarehouseId === value ? '' : current.toWarehouseId,
                    items: [newLine()],
                  }));
                }}
              >
                <option value="" disabled>
                  {t('inventory.selectWarehouse')}
                </option>
                {warehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.nameAr}
                  </option>
                ))}
              </Select>,
            )}
            {field(
              t('inventory.transferTo'),
              <Select
                value={form.toWarehouseId}
                aria-label={t('inventory.transferTo')}
                onChange={(event) => setForm({ ...form, toWarehouseId: event.target.value })}
              >
                <option value="">{t('inventory.selectWarehouse')}</option>
                {warehouseOptions
                  .filter((warehouse) => warehouse.id !== form.fromWarehouseId)
                  .map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.nameAr}
                    </option>
                  ))}
              </Select>,
            )}
            {field(
              t('inventory.reference'),
              <Input
                value={form.reference}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
                placeholder={t('purchases.referencePlaceholder')}
                aria-label={t('inventory.reference')}
              />,
            )}
          </div>

          {field(
            t('inventory.transferNotes'),
            <Input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              aria-label={t('inventory.transferNotes')}
            />,
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('inventory.transferLines')}</p>
            {form.items.map((line, index) => {
              const selectedBatch = batchById.get(line.batchId);
              return (
                <div
                  key={line.key}
                  className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-[240px] flex-1">
                    {field(
                      `${t('inventory.transferBatch')} ${index + 1}`,
                      <Select
                        value={line.batchId}
                        aria-label={`${t('inventory.transferBatch')} ${index + 1}`}
                        disabled={sourceBatches.isLoading || batchRows.length === 0}
                        onChange={(event) => updateLine(line.key, { batchId: event.target.value })}
                      >
                        <option value="">{t('inventory.transferSelectBatch')}</option>
                        {batchRows.map((row) => (
                          <option key={row.batchId} value={row.batchId}>
                            {`${row.productNameAr} — ${row.lotNumber} (${row.quantity})`}
                          </option>
                        ))}
                      </Select>,
                    )}
                  </div>
                  <div className="w-32">
                    {field(
                      `${t('inventory.quantity')} ${index + 1}`,
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        className="numeric"
                        dir="ltr"
                        value={line.quantity}
                        aria-label={`${t('inventory.quantity')} ${index + 1}`}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />,
                    )}
                  </div>
                  <div className="flex min-w-[150px] flex-col gap-1 pb-1.5 text-xs text-muted-foreground">
                    {selectedBatch ? (
                      <>
                        <span>
                          {t('inventory.transferAvailable')}:{' '}
                          <span className="numeric">{formatNumber(selectedBatch.quantity, tag)}</span>
                        </span>
                        <span>
                          {t('inventory.expiryDate')}:{' '}
                          <span className="numeric">
                            {formatDate(selectedBatch.expiryDate, tag)}
                          </span>
                        </span>
                      </>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-0.5"
                    disabled={form.items.length <= 1}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.filter((item) => item.key !== line.key),
                      }))
                    }
                    aria-label={t('purchases.removeLine')}
                  >
                    <X size={14} />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((current) => ({ ...current, items: [...current.items, newLine()] }))
              }
            >
              <Plus size={14} /> {t('purchases.addLine')}
            </Button>
            {form.fromWarehouseId !== '' && !sourceBatches.isLoading && batchRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('inventory.transferNoBatches')}</p>
            ) : null}
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? <Spinner className="border-white/40 border-t-white" /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
