/**
 * Barcode helpers: GTIN/EAN-13 and Code 128 friendly validation + label payloads.
 *
 * USB HID scanners behave as keyboards: they emit the digits then a configurable
 * suffix (most commonly Enter). The renderer therefore treats scan input as text
 * and validates it here before hitting the API.
 */

/** Compute the EAN-13 / GTIN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(twelveDigits: string): number {
  if (!/^\d{12}$/u.test(twelveDigits)) {
    throw new RangeError('EAN-13 check digit requires exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = twelveDigits.charCodeAt(i) - 48;
    // Positions with an even index (0-based) are weighted x1, odd ones x3.
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * GTIN check digit for the data digits (everything but the final check digit).
 * Weights run 3/1 alternating from the right-most data digit, so the same
 * routine covers GTIN-8, GTIN-12, GTIN-13 and GTIN-14.
 */
export function gtinCheckDigit(dataDigits: string): number {
  let sum = 0;
  for (let i = dataDigits.length - 1, position = 1; i >= 0; i -= 1, position += 1) {
    sum += (dataDigits.charCodeAt(i) - 48) * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True when `code` is a structurally valid 13-digit EAN with a correct check digit. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/u.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code.charCodeAt(12) - 48;
}

/** True when `code` is a valid GTIN of length 8, 12, 13 or 14. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/u.test(code)) return false;
  const check = code.charCodeAt(code.length - 1) - 48;
  return gtinCheckDigit(code.slice(0, -1)) === check;
}

/** Longest Code 128 payload we store (characters). */
export const MAX_CODE128_LENGTH = 48;

/**
 * Code 128 (code set B) can only represent printable ASCII, so Arabic text is
 * NOT accepted here — `encodeCode128Bars` cannot draw it, and a stored-but-
 * unprintable barcode is worse than a rejected one. Input is rejected when
 * empty, longer than `MAX_CODE128_LENGTH`, or containing anything outside ASCII
 * 32–126. Spaces are legal Code 128 symbols and are therefore allowed
 * (e.g. `PH-000123`).
 */
export function isValidCode128(code: string): boolean {
  return code.length > 0 && code.length <= MAX_CODE128_LENGTH && /^[\x20-\x7E]+$/u.test(code);
}

/**
 * Any barcode we accept for a product.
 *
 * - An all-digit code must be a structurally valid GTIN (8/12/13/14 digits with
 *   a correct check digit). Numeric codes are never treated as Code 128 labels,
 *   so a mistyped barcode is rejected at the schema boundary instead of
 *   silently persisted and only failing at scan time.
 * - Anything else must satisfy the Code 128 rules, covering internal
 *   `PH-…`-style labels and Arabic label text.
 */
export function isValidProductBarcode(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed === '') return false;
  if (/^\d+$/u.test(trimmed)) return isValidGtin(trimmed);
  return isValidCode128(trimmed);
}

export const INTERNAL_BARCODE_PREFIX = '2';

/**
 * Deterministically generate an internal, check-digit-correct EAN-13 barcode
 * from a numeric sequence. Used for in-house labelling of loose/unbranded items.
 */
export function generateInternalEan13(sequence: number | string): string {
  const seq = String(sequence).replace(/\D/gu, '');
  const body = `${INTERNAL_BARCODE_PREFIX}${seq.padStart(11, '0')}`.slice(0, 12);
  return `${body}${ean13CheckDigit(body)}`;
}

/** Normalise scanner input: strips the configured suffix and surrounding space. */
export function normaliseScanInput(raw: string, suffix = '\r'): string {
  let value = raw;
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return value.replace(/[\r\n\t]/gu, '').trim();
}

// ---------------------------------------------------------------------------
// Symbology encoders (label printing)
// ---------------------------------------------------------------------------
//
// Printing a label needs the raw module pattern, not just validation. The
// tables below are the standard EAN/UPC element patterns; `R` is the bitwise
// complement of `L` and `G` is `R` reversed. The first EAN-13 digit is not
// drawn directly — it selects the L/G parity sequence for the left group.
//
// `encodeEan13Bars('4003994155486')` reproduces the published worked example
// (parity LGLLGG) and is asserted in the unit tests, so a mistyped pattern can
// never silently ship an unscannable label.

const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const;

const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
] as const;

const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
] as const;

/** Left-group (L/G) parity chosen by the implicit first EAN-13 digit. */
const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const;

const EAN_GUARD = '101';
const EAN_CENTRE = '01010';

function pattern(table: readonly string[], digit: number): string {
  const value = table[digit];
  if (value === undefined) throw new RangeError(`unknown barcode digit: ${digit}`);
  return value;
}

/**
 * Encode a 12- or 13-digit number as the 95-module EAN-13 pattern ('1' is a
 * black bar, '0' a white space). A 12-digit input has its check digit computed.
 */
export function encodeEan13Bars(code: string): string {
  const digits = code.trim();
  if (!/^\d{12}$|^\d{13}$/u.test(digits)) {
    throw new RangeError('EAN-13 requires 12 or 13 digits');
  }
  const full = digits.length === 12 ? `${digits}${ean13CheckDigit(digits)}` : digits;
  if (!isValidEan13(full)) throw new RangeError(`EAN-13 check digit is invalid: ${digits}`);

  const parity = pattern(EAN13_PARITY, full.charCodeAt(0) - 48);
  let bars = EAN_GUARD;
  for (let i = 0; i < 6; i += 1) {
    const digit = full.charCodeAt(i + 1) - 48;
    bars += parity.charAt(i) === 'L' ? pattern(EAN_L, digit) : pattern(EAN_G, digit);
  }
  bars += EAN_CENTRE;
  for (let i = 0; i < 6; i += 1) {
    bars += pattern(EAN_R, full.charCodeAt(i + 7) - 48);
  }
  return `${bars}${EAN_GUARD}`;
}

/** Encode a 7- or 8-digit number as the 67-module EAN-8 pattern. */
export function encodeEan8Bars(code: string): string {
  const digits = code.trim();
  if (!/^\d{7}$|^\d{8}$/u.test(digits)) {
    throw new RangeError('EAN-8 requires 7 or 8 digits');
  }
  const full = digits.length === 7 ? `${digits}${gtinCheckDigit(digits)}` : digits;
  if (!isValidGtin(full)) throw new RangeError(`EAN-8 check digit is invalid: ${digits}`);

  let bars = EAN_GUARD;
  for (let i = 0; i < 4; i += 1) bars += pattern(EAN_L, full.charCodeAt(i) - 48);
  bars += EAN_CENTRE;
  for (let i = 4; i < 8; i += 1) bars += pattern(EAN_R, full.charCodeAt(i) - 48);
  return `${bars}${EAN_GUARD}`;
}

// ---------------------------------------------------------------------------
// Code 128 (ISO/IEC 15417)
// ---------------------------------------------------------------------------
//
// Code 128 is the fallback symbology for any product code the EAN family cannot
// represent: non-GTIN numerics, GTIN-14 cartons and free-form alphanumeric
// `PH-…` labels. The table below holds the 107 standard symbols (0–102 data,
// 103–105 the three start codes, 106 the stop). It is the same table published
// in the ISO/IEC 15417 reference material; the unit tests cross-check every
// entry against its run-length ("widths") form and reproduce a published
// checksum example, so a mistyped pattern cannot ship an unscannable symbol.

const CODE128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '11000111010',
] as const;

const CODE128_START_B = 104;
const CODE128_START_C = 105;
/** Stop symbol 106 plus its trailing 2-module bar. */
const CODE128_STOP = '1100011101011';

function code128Symbol(value: number): string {
  const symbol = CODE128_PATTERNS[value];
  if (symbol === undefined) throw new RangeError(`unknown Code 128 symbol: ${value}`);
  return symbol;
}

/**
 * Encode a payload as a scannable Code 128 symbol ('1' = bar, '0' = space).
 *
 * Even-length numeric payloads use code set C (two digits per symbol, half the
 * width); everything else uses code set B (ASCII 32–126). Returns `null` for
 * anything code set B cannot represent so callers can report the barcode as
 * unprintable instead of drawing a corrupt symbol.
 */
export function encodeCode128Bars(value: string): string | null {
  if (!isValidCode128(value)) return null;

  const symbols: number[] = [];
  let start: number;
  if (/^\d+$/u.test(value) && value.length % 2 === 0) {
    start = CODE128_START_C;
    for (let i = 0; i < value.length; i += 2) symbols.push(Number(value.slice(i, i + 2)));
  } else {
    start = CODE128_START_B;
    for (let i = 0; i < value.length; i += 1) symbols.push(value.charCodeAt(i) - 32);
  }

  // Weighted modulo-103 checksum: the start code counts once, then each data
  // symbol is multiplied by its 1-based position (ISO/IEC 15417 §4.3.6.1).
  let checksum = start;
  symbols.forEach((symbol, index) => {
    checksum += symbol * (index + 1);
  });

  let bars = code128Symbol(start);
  for (const symbol of symbols) bars += code128Symbol(symbol);
  bars += code128Symbol(checksum % 103);
  return `${bars}${CODE128_STOP}`;
}

export type LabelSymbology = 'EAN13' | 'EAN8' | 'CODE128';

export interface LabelBarcode {
  symbology: LabelSymbology;
  /** Module pattern to draw ('1' = bar, '0' = space). */
  modules: string;
  /** Digits printed under the barcode, including the check digit. */
  text: string;
}

/**
 * Decide how a stored product barcode should be drawn on a label.
 *
 * The EAN family is preferred wherever the value is a valid GTIN (8/12/13
 * digits) because it is what GS1 retail packaging and the app's own internal
 * generator produce, and what every retail scanner reads. Everything else that
 * Code 128 can represent — non-GTIN numerics, GTIN-14 cartons and free-form
 * alphanumeric codes — falls back to Code 128 so that *every* product with a
 * barcode can still be printed and scanned. Only values that neither symbology
 * can encode (empty, too long, non-ASCII) return `null`.
 */
export function resolveLabelBarcode(code: string | null | undefined): LabelBarcode | null {
  const value = (code ?? '').trim();
  if (value === '') return null;

  if (/^\d+$/u.test(value)) {
    if (value.length === 12 || value.length === 13) {
      const text = value.length === 12 ? `${value}${ean13CheckDigit(value)}` : value;
      if (isValidEan13(text)) {
        return { symbology: 'EAN13', modules: encodeEan13Bars(text), text };
      }
    }
    if (value.length === 7 || value.length === 8) {
      const text = value.length === 7 ? `${value}${gtinCheckDigit(value)}` : value;
      if (isValidGtin(text)) {
        return { symbology: 'EAN8', modules: encodeEan8Bars(text), text };
      }
    }
  }

  const modules = encodeCode128Bars(value);
  return modules === null ? null : { symbology: 'CODE128', modules, text: value };
}
