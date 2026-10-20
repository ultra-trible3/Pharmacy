/**
 * Barcode label geometry + payload building for the Products screen.
 *
 * Pure functions only: given the selected products and a copy count per
 * product, this module produces the flat list of printable labels. Products
 * whose barcode cannot be drawn by any supported symbology (EAN-13/EAN-8 or
 * Code 128) are reported separately so the UI can warn instead of printing a
 * barcode that will not scan.
 */

import {
  CURRENCY_CONFIG,
  normaliseDecimalString,
  resolveLabelBarcode,
  type LabelBarcode,
} from '@pharmacy/shared';

export interface LabelPreset {
  id: string;
  nameAr: string;
  nameEn: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  /** Sheet padding; keeps content inside the printer's printable area. */
  paddingMm: number;
  barcodeHeightMm: number;
}

/**
 * `a4-safe` fits inside the printable area of an ordinary office printer.
 * `a4-70x37` tiles A4 edge to edge for pre-cut 70 × 37 mm label sheets.
 */
export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    id: 'a4-safe',
    nameAr: 'A4 · 3×8 · 64×34 مم',
    nameEn: 'A4 · 3×8 · 64×34 mm',
    widthMm: 64,
    heightMm: 34,
    columns: 3,
    paddingMm: 8,
    barcodeHeightMm: 13,
  },
  {
    id: 'a4-70x37',
    nameAr: 'A4 · 3×8 · 70×37 مم',
    nameEn: 'A4 · 3×8 · 70×37 mm',
    widthMm: 70,
    heightMm: 37,
    columns: 3,
    paddingMm: 0,
    barcodeHeightMm: 15,
  },
];

export const DEFAULT_LABEL_PRESET = LABEL_PRESETS[0] as LabelPreset;

export function findPreset(id: string): LabelPreset {
  return LABEL_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_LABEL_PRESET;
}

/** The subset of a product the label sheet needs. */
export interface LabelSource {
  id: string;
  /** Product code, printed on the label alongside the name and barcode. */
  sku: string;
  nameAr: string;
  salePrice: string;
  barcode: string | null;
}

export interface LabelItem {
  key: string;
  sku: string;
  nameAr: string;
  /** Pre-formatted price with Latin digits (scanner/label friendly). */
  price: string;
  barcode: LabelBarcode;
}

export const MIN_COPIES = 0;
export const MAX_COPIES = 200;

/** Coerce a user-entered copy count into a safe integer in range. */
export function normaliseCopies(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.trunc(value)));
}

/** Labels whose barcode no supported symbology can draw cannot be printed. */
export function unprintableProducts(sources: readonly LabelSource[]): LabelSource[] {
  return sources.filter((source) => resolveLabelBarcode(source.barcode) === null);
}

/**
 * Expand the selected products into the ordered list of labels to print.
 * Unprintable products are skipped here (callers surface them separately).
 */
export function buildLabelItems(
  sources: readonly LabelSource[],
  copies: Record<string, number>,
): LabelItem[] {
  const items: LabelItem[] = [];
  for (const source of sources) {
    const barcode = resolveLabelBarcode(source.barcode);
    if (!barcode) continue;
    const count = normaliseCopies(copies[source.id]);
    for (let index = 0; index < count; index += 1) {
      items.push({
        key: `${source.id}:${index}`,
        sku: source.sku,
        nameAr: source.nameAr,
        price: `${normaliseDecimalString(source.salePrice, 2)} ${CURRENCY_CONFIG.symbolAr}`,
        barcode,
      });
    }
  }
  return items;
}
