import { describe, expect, it } from 'vitest';
import { allocateFefo, signedQuantity, type FefoCandidate } from './fefo.js';

const candidate = (batchId: string, expiryDate: string, quantity: number): FefoCandidate => ({
  batchId,
  expiryDate,
  quantity,
});

describe('allocateFefo', () => {
  it('takes the earliest-expiring batch first', () => {
    const plan = allocateFefo(
      [candidate('late', '2030-01-01', 10), candidate('early', '2027-01-01', 5)],
      6,
    );

    expect(plan).toEqual([
      { batchId: 'early', expiryDate: '2027-01-01', quantity: 5 },
      { batchId: 'late', expiryDate: '2030-01-01', quantity: 1 },
    ]);
  });

  it('spills across as many batches as needed', () => {
    const plan = allocateFefo(
      [
        candidate('a', '2027-01-01', 2),
        candidate('b', '2027-02-01', 2),
        candidate('c', '2027-03-01', 2),
      ],
      5,
    );

    expect(plan.map((entry) => entry.batchId)).toEqual(['a', 'b', 'c']);
    expect(plan.map((entry) => entry.quantity)).toEqual([2, 2, 1]);
  });

  it('ignores empty batches', () => {
    const plan = allocateFefo(
      [candidate('empty', '2026-01-01', 0), candidate('full', '2027-01-01', 4)],
      3,
    );

    expect(plan).toEqual([{ batchId: 'full', expiryDate: '2027-01-01', quantity: 3 }]);
  });

  it('breaks ties deterministically by batch id', () => {
    const plan = allocateFefo(
      [candidate('zzz', '2027-01-01', 1), candidate('aaa', '2027-01-01', 1)],
      2,
    );

    expect(plan.map((entry) => entry.batchId)).toEqual(['aaa', 'zzz']);
  });

  it('exhausts the stock exactly when the request matches availability', () => {
    const plan = allocateFefo([candidate('only', '2027-01-01', 7)], 7);
    expect(plan).toEqual([{ batchId: 'only', expiryDate: '2027-01-01', quantity: 7 }]);
  });

  it('throws when the total available stock is short', () => {
    expect(() => allocateFefo([candidate('a', '2027-01-01', 2)], 3)).toThrowError(/غير كافية/u);
  });

  it('rejects a non-positive or fractional request', () => {
    expect(() => allocateFefo([candidate('a', '2027-01-01', 5)], 0)).toThrowError();
    expect(() => allocateFefo([candidate('a', '2027-01-01', 5)], -1)).toThrowError();
    expect(() => allocateFefo([candidate('a', '2027-01-01', 5)], 1.5)).toThrowError();
  });

  it('never mutates the caller-supplied candidates array', () => {
    const candidates = [candidate('late', '2030-01-01', 1), candidate('early', '2027-01-01', 1)];
    const snapshot = [...candidates];
    allocateFefo(candidates, 2);
    expect(candidates).toEqual(snapshot);
  });
});

describe('signedQuantity', () => {
  it('is positive for inbound movement types', () => {
    expect(signedQuantity('RECEIPT', 5)).toBe(5);
    expect(signedQuantity('ADJUSTMENT_IN', 5)).toBe(5);
    expect(signedQuantity('COUNT_GAIN', 5)).toBe(5);
    expect(signedQuantity('TRANSFER_IN', 5)).toBe(5);
    expect(signedQuantity('RETURN_IN', 5)).toBe(5);
  });

  it('is negative for outbound movement types', () => {
    expect(signedQuantity('ISSUE', 5)).toBe(-5);
    expect(signedQuantity('ADJUSTMENT_OUT', 5)).toBe(-5);
    expect(signedQuantity('COUNT_LOSS', 5)).toBe(-5);
    expect(signedQuantity('TRANSFER_OUT', 5)).toBe(-5);
    expect(signedQuantity('RETURN_OUT', 5)).toBe(-5);
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(() => signedQuantity('ISSUE', 0)).toThrowError();
    expect(() => signedQuantity('ISSUE', -3)).toThrowError();
    expect(() => signedQuantity('ISSUE', 2.5)).toThrowError();
  });
});
