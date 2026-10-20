/**
 * The printable label sheet.
 *
 * `PrintSheet` is portaled onto `<body>` (as a direct child, outside the app
 * root and any Radix dialog portal) so the print stylesheet can hide every
 * other body child and print the labels alone.
 */

import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { BarcodeSvg } from './BarcodeSvg';
import type { LabelItem, LabelPreset } from '../../lib/labels';

export interface LabelSheetProps {
  items: readonly LabelItem[];
  preset: LabelPreset;
}

export interface LabelCellProps {
  item: LabelItem;
  preset: LabelPreset;
}

/** One physical label: name, barcode, human-readable digits, code and price. */
export function LabelCell({ item, preset }: LabelCellProps): ReactElement {
  return (
    <div
      className="label-cell"
      data-label-text={item.barcode.text}
      style={{ width: `${preset.widthMm}mm`, height: `${preset.heightMm}mm` }}
    >
      <div className="label-name">{item.nameAr}</div>
      <BarcodeSvg
        barcode={item.barcode}
        heightMm={preset.barcodeHeightMm}
        className="label-barcode"
      />
      <div className="label-text numeric">{item.barcode.text}</div>
      <div className="label-footer">
        <span className="label-sku numeric" dir="ltr">
          {item.sku}
        </span>
        <span className="label-price numeric">{item.price}</span>
      </div>
    </div>
  );
}

/** The label grid; also reused for the in-dialog preview. */
export function LabelGrid({ items, preset }: LabelSheetProps): ReactElement {
  return (
    <div
      className="label-sheet"
      data-label-count={items.length}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${preset.columns}, ${preset.widthMm}mm)`,
        justifyContent: 'center',
        alignContent: 'start',
        padding: `${preset.paddingMm}mm`,
      }}
    >
      {items.map((item) => (
        <LabelCell key={item.key} item={item} preset={preset} />
      ))}
    </div>
  );
}

/** Mounts the full sheet on `<body>` for printing; hidden on screen by CSS. */
export function PrintSheet({ items, preset }: LabelSheetProps): ReactElement | null {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="label-print-root">
      <LabelGrid items={items} preset={preset} />
    </div>,
    document.body,
  );
}
