/**
 * Draws a barcode as an inline SVG from the module pattern produced by
 * `@pharmacy/shared` (EAN-13, EAN-8 or Code 128).
 *
 * `preserveAspectRatio="none"` lets the symbol stretch to the label width while
 * `shapeRendering="crispEdges"` keeps the bars sharp when printed; without it a
 * scaled SVG blurs the edges and can defeat a scanner.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { LabelBarcode, LabelSymbology } from '@pharmacy/shared';

/**
 * Quiet zone drawn on each side, in modules. 11 modules clears EAN-13's 11/7
 * requirement and Code 128's 10-module minimum, so one constant serves all.
 */
const QUIET_MODULES = 11;
const BAR_HEIGHT = 100;
/** Guard bars run taller than the digit bars, as on the printed symbol. */
const GUARD_HEIGHT = 108;

/** Start, centre and end guard module ranges of an EAN-13 / EAN-8 symbol. */
const EAN13_GUARDS: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [45, 49],
  [92, 94],
];
const EAN8_GUARDS: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [31, 35],
  [64, 66],
];

/**
 * The guard ranges for a symbology, or an empty list when every bar is the same
 * height (Code 128 has no guard bars).
 */
export function barcodeGuardRanges(
  symbology: LabelSymbology,
  moduleCount: number,
): ReadonlyArray<readonly [number, number]> {
  if (symbology === 'EAN13' && moduleCount === 95) return EAN13_GUARDS;
  if (symbology === 'EAN8' && moduleCount === 67) return EAN8_GUARDS;
  return [];
}

export interface BarRect {
  x: number;
  width: number;
  guard: boolean;
}

/** Collapse runs of black modules into single bars (fewer nodes when printing). */
export function barRects(modules: string, symbology: LabelSymbology): BarRect[] {
  const guards = barcodeGuardRanges(symbology, modules.length);
  const rects: BarRect[] = [];
  let index = 0;
  while (index < modules.length) {
    if (modules.charAt(index) !== '1') {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < modules.length && modules.charAt(end + 1) === '1') end += 1;
    const guard = guards.some(([from, to]) => index <= to && end >= from);
    rects.push({ x: index, width: end - index + 1, guard });
    index = end + 1;
  }
  return rects;
}

export interface BarcodeSvgProps {
  barcode: LabelBarcode;
  heightMm: number;
  className?: string;
  style?: CSSProperties;
}

export function BarcodeSvg({ barcode, heightMm, className, style }: BarcodeSvgProps): ReactElement {
  const width = barcode.modules.length + QUIET_MODULES * 2;
  const rects = barRects(barcode.modules, barcode.symbology);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${GUARD_HEIGHT}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={barcode.text}
      data-symbology={barcode.symbology}
      style={{ display: 'block', width: '100%', height: `${heightMm}mm`, ...style }}
    >
      <rect x={0} y={0} width={width} height={GUARD_HEIGHT} fill="#ffffff" />
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.width}`}
          x={QUIET_MODULES + rect.x}
          y={0}
          width={rect.width}
          height={rect.guard ? GUARD_HEIGHT : BAR_HEIGHT}
          fill="#000000"
        />
      ))}
    </svg>
  );
}
