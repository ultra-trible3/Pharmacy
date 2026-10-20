/**
 * Money utilities.
 *
 * Monetary values are stored in PostgreSQL as `NUMERIC(14,2)` and are transported
 * over the API as **strings** so that no floating point rounding is ever applied
 * between the database and the client. These helpers are only used for arithmetic
 * that must be performed in JavaScript (e.g. cart totals in the renderer) and they
 * always work in integer minor units (piasters) internally.
 */

/** Number of decimal places for EGP amounts. */
export const CURRENCY_SCALE = 2;

/** Default currency configuration for Egyptian pharmacies. */
export const CURRENCY_CONFIG = {
  code: 'EGP',
  symbolAr: 'ج.م',
  symbolEn: 'EGP',
  scale: CURRENCY_SCALE,
} as const;

export type Numeric = number | string;

/** Parse a decimal-ish value into integer minor units (piasters). Throws on NaN. */
export function toMinorUnits(value: Numeric, scale = CURRENCY_SCALE): number {
  const normalised = normaliseDecimalString(value, scale);
  const negative = normalised.startsWith('-');
  const [whole = '0', frac = ''] = normalised.replace('-', '').split('.');
  const minor = Number(whole) * 10 ** scale + Number(frac.padEnd(scale, '0'));
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Monetary value out of range: ${String(value)}`);
  }
  return negative ? -minor : minor;
}

/**
 * Round an arbitrary decimal-ish value to `scale` decimals using exact string
 * arithmetic (round-half-away-from-zero), returning a fixed-scale string.
 * This is the only rounding primitive used across the system.
 */
export function normaliseDecimalString(value: Numeric, scale = CURRENCY_SCALE): string {
  if (scale < 0 || scale > 8) throw new RangeError(`Unsupported scale: ${scale}`);

  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Invalid decimal value: ${String(value)}`);
    // toFixed avoids exponential notation for realistic magnitudes.
    text = Math.abs(value) >= 1e21 ? value.toString() : value.toFixed(Math.min(scale + 6, 20));
  } else {
    text = value.trim();
  }

  if (/[eE]/u.test(text)) {
    const asNumber = Number(text);
    if (!Number.isFinite(asNumber)) throw new TypeError(`Invalid decimal value: ${String(value)}`);
    text = asNumber.toFixed(Math.min(scale + 6, 20));
  }

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/u.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new TypeError(`Invalid decimal value: ${String(value)}`);
  }
  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2] === '' ? '0' : (match[2] as string);
  const fraction = match[3] ?? '';

  const padded = fraction.padEnd(scale + 1, '0');
  const kept = `${whole}${padded.slice(0, scale)}`;
  const roundDigit = Number(padded.charAt(scale) || '0');
  let scaled = BigInt(kept === '' ? '0' : kept);
  if (roundDigit >= 5) scaled += 1n;
  if (scaled === 0n) return `${scale > 0 ? `${'0'.repeat(1)}.${'0'.repeat(scale)}` : '0'}`;

  const digits = scaled.toString().padStart(scale + 1, '0');
  const outWhole = scale > 0 ? digits.slice(0, digits.length - scale) : digits;
  const outFraction = scale > 0 ? digits.slice(digits.length - scale) : '';
  const isZero = /^0+$/u.test(outWhole) && /^0*$/u.test(outFraction);
  const formatted = scale > 0 ? `${outWhole}.${outFraction}` : outWhole;
  return `${isZero ? '' : sign}${formatted}`;
}

/** Convert integer minor units back to a fixed-scale decimal string. */
export function fromMinorUnits(minor: number, scale = CURRENCY_SCALE): string {
  if (!Number.isFinite(minor)) throw new TypeError(`Invalid minor units: ${minor}`);
  const factor = 10 ** scale;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(scale, '0');
  return `${sign}${whole}.${frac}`;
}

/** Round a decimal-ish value to the currency scale and return a fixed string. */
export function roundCurrency(value: Numeric, scale = CURRENCY_SCALE): string {
  return normaliseDecimalString(value, scale);
}

/** Sum a list of decimal-ish values without floating point drift. */
export function sumCurrency(values: readonly Numeric[], scale = CURRENCY_SCALE): string {
  const total = values.reduce<number>((acc, v) => acc + toMinorUnits(v, scale), 0);
  return fromMinorUnits(total, scale);
}

/** Multiply a decimal-ish unit price by an integer quantity. */
export function multiplyCurrency(
  unitPrice: Numeric,
  quantity: number,
  scale = CURRENCY_SCALE,
): string {
  if (!Number.isFinite(quantity)) throw new TypeError(`Invalid quantity: ${quantity}`);
  return fromMinorUnits(toMinorUnits(unitPrice, scale) * quantity, scale);
}

/** Apply a percentage discount (0-100) to an amount, rounded to currency scale. */
export function applyPercentDiscount(
  amount: Numeric,
  percent: Numeric,
  scale = CURRENCY_SCALE,
): string {
  const base = toMinorUnits(amount, scale);
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`Invalid discount percentage: ${String(percent)}`);
  }
  const discounted = Math.round((base * (100 - pct)) / 100);
  return fromMinorUnits(discounted, scale);
}

/** Compare two decimal-ish values. */
export function compareCurrency(a: Numeric, b: Numeric): number {
  return Math.sign(toMinorUnits(a) - toMinorUnits(b));
}

/** Human readable amount with Arabic-Indic grouping and currency symbol. */
export function formatEGP(value: Numeric, locale: 'ar-EG' | 'en-EG' = 'ar-EG'): string {
  const amount = roundCurrency(value);
  const numeric = Number(amount);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: CURRENCY_SCALE,
    maximumFractionDigits: CURRENCY_SCALE,
  }).format(numeric);
  return locale === 'ar-EG' ? `${formatted} ${CURRENCY_CONFIG.symbolAr}` : `${formatted} ${CURRENCY_CONFIG.symbolEn}`;
}
