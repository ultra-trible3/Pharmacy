import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveLabelBarcode } from '@pharmacy/shared';
import { BarcodeSvg, barRects, barcodeGuardRanges } from './BarcodeSvg';

const EAN13_REFERENCE = '4003994155486';
const CODE128_REFERENCE = 'PH-000123';

describe('BarcodeSvg', () => {
  it('collapses module runs into non-overlapping bars and flags the guards', () => {
    const barcode = resolveLabelBarcode(EAN13_REFERENCE);
    expect(barcode).not.toBeNull();

    const rects = barRects(barcode!.modules, barcode!.symbology);
    expect(rects.length).toBeGreaterThan(0);
    // Start, centre and end guards are all taller than the digit bars.
    expect(rects.filter((rect) => rect.guard).length).toBeGreaterThanOrEqual(3);

    for (let index = 1; index < rects.length; index += 1) {
      const previous = rects[index - 1]!;
      const current = rects[index]!;
      expect(current.x).toBeGreaterThan(previous.x + previous.width - 1);
    }
  });

  it('uses the correct guard ranges per symbology', () => {
    expect(barcodeGuardRanges('EAN13', 95)).toEqual([
      [0, 2],
      [45, 49],
      [92, 94],
    ]);
    expect(barcodeGuardRanges('EAN8', 67)).toEqual([
      [0, 2],
      [31, 35],
      [64, 66],
    ]);
    // Code 128 has no guard bars: every bar is the same height.
    expect(barcodeGuardRanges('CODE128', 112)).toEqual([]);
  });

  it('renders an accessible SVG carrying the human-readable digits', () => {
    const barcode = resolveLabelBarcode(EAN13_REFERENCE)!;
    const { getByRole } = render(<BarcodeSvg barcode={barcode} heightMm={13} />);

    const svg = getByRole('img', { name: EAN13_REFERENCE });
    expect(svg).toHaveAttribute('data-symbology', 'EAN13');
    // Crisp edges keep the printed bars sharp enough to scan.
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
  });

  it('draws Code 128 with uniform-height bars and no guards', () => {
    const barcode = resolveLabelBarcode(CODE128_REFERENCE)!;
    expect(barcode.symbology).toBe('CODE128');

    const rects = barRects(barcode.modules, 'CODE128');
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.some((rect) => rect.guard)).toBe(false);

    const { getByRole } = render(<BarcodeSvg barcode={barcode} heightMm={13} />);
    expect(getByRole('img', { name: CODE128_REFERENCE })).toHaveAttribute(
      'data-symbology',
      'CODE128',
    );
  });
});
