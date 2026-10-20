import { describe, expect, it } from 'vitest';
import {
  ean13CheckDigit,
  encodeCode128Bars,
  encodeEan13Bars,
  encodeEan8Bars,
  generateInternalEan13,
  gtinCheckDigit,
  isValidCode128,
  isValidEan13,
  isValidGtin,
  isValidProductBarcode,
  normaliseScanInput,
  resolveLabelBarcode,
} from './barcode.js';

describe('barcode helpers', () => {
  it('computes the EAN-13 check digit', () => {
    // 400638133393 -> 1  (well known reference barcode)
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('000000000000')).toBe(0);
    expect(() => ean13CheckDigit('123')).toThrow(RangeError);
  });

  it('validates EAN-13 codes', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333939')).toBe(false);
    expect(isValidEan13('40063813339')).toBe(false);
  });

  it('validates GTIN-8 / 12 / 14 as well', () => {
    // 96385074 and 12345670 are both canonical, check-digit-correct EAN-8s.
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('12345670')).toBe(true);
    // Same body with a wrong check digit is rejected.
    expect(isValidGtin('12345671')).toBe(false);
    expect(isValidGtin('4006381333931')).toBe(true);
  });

  it('accepts Code 128 alphanumerics and rejects non-encodable text', () => {
    expect(isValidCode128('PH-000123')).toBe(true);
    expect(isValidCode128('4006381333931')).toBe(true);
    // Code set B cannot draw Arabic, so it must not be stored as a barcode.
    expect(isValidCode128('صنف 100')).toBe(false);
    // Control characters are not printable Code 128 symbols.
    expect(isValidCode128('bad\u0000code')).toBe(false);
    expect(isValidCode128('x'.repeat(49))).toBe(false);
    expect(isValidCode128('')).toBe(false);
  });

  it('generates check-digit-correct internal EAN-13 labels', () => {
    const code = generateInternalEan13(42);
    expect(code).toHaveLength(13);
    expect(code.startsWith('2')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
    expect(generateInternalEan13(42)).toBe(code);
  });

  it('accepts both GTIN and internal labels as product barcodes', () => {
    expect(isValidProductBarcode('4006381333931')).toBe(true);
    expect(isValidProductBarcode(generateInternalEan13(7))).toBe(true);
    expect(isValidProductBarcode('PH-000123')).toBe(true);
    expect(isValidProductBarcode('4006381333939')).toBe(false);
    // Numeric but not a valid GTIN: rejected rather than silently accepted as a
    // Code 128 label, so mistyped barcodes never reach the database.
    expect(isValidProductBarcode('12345')).toBe(false);
    expect(isValidProductBarcode('12345671')).toBe(false);
    expect(isValidProductBarcode('')).toBe(false);
  });

  it('normalises keyboard-wedge scanner output', () => {
    expect(normaliseScanInput('4006381333931\r')).toBe('4006381333931');
    expect(normaliseScanInput('4006381333931\n')).toBe('4006381333931');
    expect(normaliseScanInput('  4006381333931 ')).toBe('4006381333931');
    expect(normaliseScanInput('4006381333931', '|')).toBe('4006381333931');
  });

  it('computes GTIN check digits for every supported length', () => {
    // Reference vectors from the GTIN/EAN check-digit examples.
    expect(gtinCheckDigit('400638133393')).toBe(1); // GTIN-13
    expect(gtinCheckDigit('7351353')).toBe(7); // GTIN-8
    expect(gtinCheckDigit('9638507')).toBe(4);
  });

  it('encodes the published EAN-13 worked example (4003994155486)', () => {
    // Module-by-module expectation, taken from the EAN-13 encoding example
    // (left group 003994 with parity LGLLGG, right group 155486).
    const expected = [
      '101', // start guard
      '0001101', // 0 (L)
      '0100111', // 0 (G)
      '0111101', // 3 (L)
      '0001011', // 9 (L)
      '0010111', // 9 (G)
      '0011101', // 4 (G)
      '01010', // centre guard
      '1100110', // 1 (R)
      '1001110', // 5 (R)
      '1001110', // 5 (R)
      '1011100', // 4 (R)
      '1001000', // 8 (R)
      '1010000', // 6 (R)
      '101', // end guard
    ].join('');

    const bars = encodeEan13Bars('4003994155486');
    expect(bars).toBe(expected);
    expect(bars).toHaveLength(95);
  });

  it('fills in the EAN-13 check digit when only 12 digits are given', () => {
    expect(encodeEan13Bars('400399415548')).toBe(encodeEan13Bars('4003994155486'));
    // Wrong check digit: refuse rather than print an unscannable label.
    expect(() => encodeEan13Bars('4003994155480')).toThrow(RangeError);
    expect(() => encodeEan13Bars('123')).toThrow(RangeError);
  });

  it('encodes the published EAN-8 worked example (73513537)', () => {
    const expected = [
      '101',
      '0111011', // 7 (L)
      '0111101', // 3 (L)
      '0110001', // 5 (L)
      '0011001', // 1 (L)
      '01010',
      '1000010', // 3 (R)
      '1001110', // 5 (R)
      '1000010', // 3 (R)
      '1000100', // 7 (R)
      '101',
    ].join('');

    expect(encodeEan8Bars('73513537')).toBe(expected);
    expect(encodeEan8Bars('73513537')).toHaveLength(67);
    expect(encodeEan8Bars('7351353')).toBe(expected); // 7 digits -> check digit added
  });

  it('resolves which stored barcodes can be drawn on a label', () => {
    expect(resolveLabelBarcode('4003994155486')).toMatchObject({
      symbology: 'EAN13',
      text: '4003994155486',
    });
    expect(resolveLabelBarcode('73513537')).toMatchObject({ symbology: 'EAN8' });
    // A 12-digit UPC-A body resolves to its 13-digit EAN form.
    expect(resolveLabelBarcode('400399415548')?.text).toBe('4003994155486');
    // The internal generator's output is always drawable.
    expect(resolveLabelBarcode(generateInternalEan13(42))?.symbology).toBe('EAN13');
    // Everything else Code 128 can represent falls back to Code 128 so no
    // product is left without a printable barcode.
    expect(resolveLabelBarcode('PH-000123')).toMatchObject({
      symbology: 'CODE128',
      text: 'PH-000123',
    });
    expect(resolveLabelBarcode('12345')).toMatchObject({ symbology: 'CODE128' });
    expect(resolveLabelBarcode('12345678901231')).toMatchObject({ symbology: 'CODE128' });
    // Neither symbology can encode these, so they stay unprintable.
    expect(resolveLabelBarcode('')).toBeNull();
    expect(resolveLabelBarcode(null)).toBeNull();
    expect(resolveLabelBarcode('صنف 100')).toBeNull();
  });

  it('encodes a published Code 128 checksum example (PJJ123C in code set B)', () => {
    const bars = encodeCode128Bars('PJJ123C');
    expect(bars).not.toBeNull();

    // Start B, the seven data symbols, the check symbol, then the stop.
    // The checksum follows ISO/IEC 15417: start 104 + weighted data symbols.
    // (The article works the same example in code set A, where the check symbol
    // is 54; with start B it is 55.)
    const expected = [
      '11010010000', // Start B (104)
      '11101110110', // P (48)
      '10110111000', // J (42)
      '10110111000', // J (42)
      '10011100110', // 1 (17)
      '11001110010', // 2 (18)
      '11001011100', // 3 (19)
      '10001000110', // C (35)
      '11101000110', // check symbol (55 = 879 mod 103)
      '1100011101011', // stop
    ].join('');

    expect(bars).toBe(expected);
    expect(bars).toHaveLength(112);
  });

  it('uses code set C for even-length numeric payloads and set B otherwise', () => {
    // Start C is one module pattern shorter in data terms: two digits per symbol.
    expect(encodeCode128Bars('1234')).toBe(
      ['11010011100', '10110011100', '10001011000', '10010011110', '1100011101011'].join(''),
    );
    // Odd-length numerics fall back to code set B.
    expect(encodeCode128Bars('123')?.startsWith('11010010000')).toBe(true);
    // Non-encodable input is refused rather than mis-drawn.
    expect(encodeCode128Bars('صنف')).toBeNull();
    expect(encodeCode128Bars('')).toBeNull();
  });
});
