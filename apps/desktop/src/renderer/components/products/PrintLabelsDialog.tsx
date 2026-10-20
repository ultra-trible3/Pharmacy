/**
 * "Print barcode labels" dialog for the Products screen.
 *
 * The user picks how many copies of each selected product's label to print,
 * chooses an A4 label size, and prints through Electron. Products whose barcode
 * is not an EAN symbol are listed separately and can be given an internal
 * barcode in place (when the user may write products).
 *
 * The printable sheet is mounted on <body> (see `PrintSheet`) for as long as the
 * dialog is open, so the delegated print job has real content to render.
 */

import { useMutation } from '@tanstack/react-query';
import { Printer, Tag } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { resolveLabelBarcode, type ProductListItem } from '@pharmacy/shared';
import { Badge, Spinner } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Input, Select } from '../ui/input';
import { toast } from '../ui/toast';
import { api } from '../../lib/api';
import {
  buildLabelItems,
  DEFAULT_LABEL_PRESET,
  findPreset,
  LABEL_PRESETS,
  MAX_COPIES,
  normaliseCopies,
  unprintableProducts,
  type LabelSource,
} from '../../lib/labels';
import { useI18n } from '../../i18n/useI18n';
import { LabelCell, PrintSheet } from './LabelSheet';

export interface PrintLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: readonly ProductListItem[];
  canWrite: boolean;
  /** Lets the caller refetch after an in-dialog barcode assignment. */
  onAssigned?: () => void | Promise<void>;
}

export function PrintLabelsDialog({
  open,
  onOpenChange,
  products,
  canWrite,
  onAssigned,
}: PrintLabelsDialogProps): ReactElement {
  const { t, locale } = useI18n();
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [presetId, setPresetId] = useState(DEFAULT_LABEL_PRESET.id);
  const [bulk, setBulk] = useState('6');
  const [printing, setPrinting] = useState(false);
  const wasOpen = useRef(false);

  // Seed one copy per product only on the open transition. `products` gets a new
  // identity on every refetch, so depending on it unconditionally would wipe the
  // counts the user just typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setCopies(Object.fromEntries(products.map((product) => [product.id, 1])));
    }
    wasOpen.current = open;
  }, [open, products]);

  const preset = findPreset(presetId);

  const sources = useMemo<LabelSource[]>(
    () =>
      products.map((product) => ({
        id: product.id,
        sku: product.sku,
        nameAr: product.nameAr,
        salePrice: product.salePrice,
        barcode: product.barcode,
      })),
    [products],
  );

  const unprintable = useMemo(() => unprintableProducts(sources), [sources]);
  const items = useMemo(() => buildLabelItems(sources, copies), [sources, copies]);
  const preview = items[0];

  const assign = useMutation({
    mutationFn: () => api.products.assignBarcodes(),
    onSuccess: async (result) => {
      toast.success(
        result.assigned === 0
          ? t('labels.noneToAssign')
          : t('labels.assigned', { count: result.assigned }),
      );
      await onAssigned?.();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('errors.generic')),
  });

  const setCopiesFor = (id: string, value: number): void => {
    setCopies((current) => ({ ...current, [id]: normaliseCopies(value) }));
  };

  const applyBulk = (): void => {
    const value = normaliseCopies(Number(bulk));
    setCopies(Object.fromEntries(products.map((product) => [product.id, value])));
  };

  const handlePrint = async (): Promise<void> => {
    if (items.length === 0) return;
    setPrinting(true);
    try {
      const result = await api.print({ silent: false });
      if (!result.ok && !result.cancelled) toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('errors.generic'));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      {open ? <PrintSheet items={items} preset={preset} /> : null}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={t('labels.title')} description={t('labels.description')}>
          {products.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('labels.selectHint')}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('labels.preset')}
                  <Select
                    value={presetId}
                    onChange={(event) => setPresetId(event.target.value)}
                    className="w-56"
                    aria-label={t('labels.preset')}
                  >
                    {LABEL_PRESETS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {locale === 'ar' ? option.nameAr : option.nameEn}
                      </option>
                    ))}
                  </Select>
                </label>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={MAX_COPIES}
                    value={bulk}
                    onChange={(event) => setBulk(event.target.value)}
                    className="numeric w-20"
                    aria-label={t('labels.copiesAll')}
                  />
                  <Button variant="outline" size="sm" onClick={applyBulk}>
                    {t('labels.applyAll')}
                  </Button>
                </div>

                <div className="ms-auto flex items-center gap-2">
                  <Badge variant="outline">
                    {t('labels.selectedCount', { count: products.length })}
                  </Badge>
                  <Badge>
                    {t('labels.totalLabels', { count: items.length })}
                  </Badge>
                </div>
              </div>

              {unprintable.length > 0 ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                  <p className="font-medium text-warning">
                    {t('labels.unprintable', { count: unprintable.length })}
                  </p>
                  <p className="mt-1 text-muted-foreground">{t('labels.unprintableHint')}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {unprintable.map((source) => (
                      <li key={source.id} className="rounded bg-card px-2 py-0.5">
                        {source.nameAr}
                      </li>
                    ))}
                  </ul>
                  {canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={assign.isPending}
                      onClick={() => assign.mutate()}
                    >
                      {assign.isPending ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <Tag className="h-3.5 w-3.5" />
                      )}
                      {assign.isPending ? t('labels.assigning') : t('labels.assign')}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 text-start">{t('products.nameAr')}</th>
                      <th className="p-2 text-start">{t('products.sku')}</th>
                      <th className="p-2 text-start">{t('products.barcode')}</th>
                      <th className="p-2 text-center">{t('labels.copies')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const drawable = resolveLabelBarcode(product.barcode) !== null;
                      return (
                        <tr key={product.id} className="border-t border-border">
                          <td className="p-2">{product.nameAr}</td>
                          <td className="numeric p-2 text-xs text-muted-foreground" dir="ltr">
                            {product.sku}
                          </td>
                          <td className="numeric p-2 text-xs text-muted-foreground" dir="ltr">
                            {product.barcode ?? '—'}
                          </td>
                          <td className="p-2 text-center">
                            <Input
                              type="number"
                              min={0}
                              max={MAX_COPIES}
                              className="numeric mx-auto w-20"
                              value={copies[product.id] ?? 1}
                              disabled={!drawable}
                              aria-label={`${t('labels.copies')} — ${product.nameAr}`}
                              onChange={(event) => setCopiesFor(product.id, Number(event.target.value))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {preview ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('labels.preview')}</span>
                  <div className="rounded border border-border bg-white p-2" dir="rtl">
                    <LabelCell item={preview} preset={preset} />
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            <Button disabled={printing || items.length === 0} onClick={() => void handlePrint()}>
              {printing ? (
                <Spinner className="border-white/40 border-t-white" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {printing ? t('labels.printing') : t('labels.printNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
