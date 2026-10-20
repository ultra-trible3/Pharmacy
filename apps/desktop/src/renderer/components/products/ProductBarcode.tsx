/**
 * A reusable, read-only barcode preview for a stored product barcode.
 *
 * Resolves the value to a scannable symbology (EAN-13/EAN-8 when the value is a
 * valid GTIN, otherwise Code 128) and draws it with `BarcodeSvg`, with the
 * human-readable value underneath. When the value cannot be encoded at all it
 * renders a short, localised hint instead of a misleading decoration.
 */

import { type ReactElement } from 'react';
import { resolveLabelBarcode } from '@pharmacy/shared';
import { BarcodeSvg } from './BarcodeSvg';
import { useI18n } from '../../i18n/useI18n';

export interface ProductBarcodeProps {
  value: string | null | undefined;
  heightMm?: number;
  showText?: boolean;
  className?: string;
  textClassName?: string;
}

export function ProductBarcode({
  value,
  heightMm = 12,
  showText = true,
  className,
  textClassName,
}: ProductBarcodeProps): ReactElement {
  const { t } = useI18n();
  const raw = (value ?? '').trim();
  const barcode = resolveLabelBarcode(raw);

  if (!barcode) {
    return (
      <span className={textClassName ?? 'text-[11px] text-muted-foreground'}>
        {raw === '' ? t('products.barcodeMissing') : t('products.barcodeUnavailable')}
      </span>
    );
  }

  return (
    <div className={className}>
      <BarcodeSvg barcode={barcode} heightMm={heightMm} />
      {showText ? (
        <div
          className={`numeric text-center ${textClassName ?? 'text-[11px] text-muted-foreground'}`}
          dir="ltr"
        >
          {barcode.text}
        </div>
      ) : null}
    </div>
  );
}
