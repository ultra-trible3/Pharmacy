import { describe, expect, it } from 'vitest';
import {
  buildLabelItems,
  findPreset,
  normaliseCopies,
  unprintableProducts,
  type LabelSource,
} from './labels';

const sources: LabelSource[] = [
  { id: 'p1', sku: 'AUG-0001', nameAr: 'أوجمنتين 1 جم', salePrice: '125', barcode: '6221000000010' },
  { id: 'p2', sku: 'NO-BAR', nameAr: 'صنف بدون باركود', salePrice: '9.5', barcode: null },
  { id: 'p3', sku: 'PH-000123', nameAr: 'باركود داخلي نصي', salePrice: '3', barcode: 'PH-000123' },
];

describe('label building', () => {
  it('coerces copy counts into a safe range', () => {
    expect(normaliseCopies(undefined)).toBe(1);
    expect(normaliseCopies(3)).toBe(3);
    expect(normaliseCopies(-2)).toBe(0);
    expect(normaliseCopies(2.9)).toBe(2);
    expect(normaliseCopies(1_000_000)).toBe(200);
    expect(normaliseCopies(Number.NaN)).toBe(1);
  });

  it('expands each product into the requested number of labels', () => {
    const items = buildLabelItems(sources, { p1: 2, p2: 5, p3: 1 });

    // p1 was asked for twice and p3 once; p2 has no barcode at all.
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.nameAr)).toEqual([
      'أوجمنتين 1 جم',
      'أوجمنتين 1 جم',
      'باركود داخلي نصي',
    ]);
    // Prices use Latin digits + the Arabic currency symbol so they stay legible.
    expect(items[0]?.price).toBe('125.00 ج.م');
    expect(items[0]?.barcode.symbology).toBe('EAN13');
    expect(items[0]?.barcode.text).toBe('6221000000010');
    // The product code travels with every label.
    expect(items.map((item) => item.sku)).toEqual(['AUG-0001', 'AUG-0001', 'PH-000123']);
    // A non-GTIN code still prints, drawn as Code 128.
    expect(items[2]?.barcode.symbology).toBe('CODE128');
    // Keys must be unique so React can render the copies.
    expect(new Set(items.map((item) => item.key)).size).toBe(3);
  });

  it('honours a zero copy count', () => {
    expect(buildLabelItems(sources, { p1: 0, p3: 0 })).toHaveLength(0);
  });

  it('reports only products whose barcode no symbology can draw', () => {
    expect(unprintableProducts(sources).map((source) => source.id)).toEqual(['p2']);
  });

  it('falls back to the default preset for an unknown id', () => {
    expect(findPreset('does-not-exist').id).toBe('a4-safe');
    expect(findPreset('a4-70x37').widthMm).toBe(70);
  });
});
