import type { MovementType } from '@pharmacy/shared';
import { isInbound } from '@pharmacy/shared';
import { ValidationError } from '../../lib/errors.js';

export interface FefoCandidate {
  batchId: string;
  expiryDate: string;
  quantity: number;
}

export interface FefoAllocation {
  batchId: string;
  expiryDate: string;
  quantity: number;
}

/**
 * Allocate `requested` units across batches using **FEFO** (First Expired,
 * First Out) — the mandatory batch-selection policy for Egyptian pharmacies.
 *
 * Rules:
 *  - near-expiry-first ordering by `expiryDate` ascending, then by `batchId`
 *    for a deterministic result when dates tie;
 *  - batches with zero/negative quantity are ignored;
 *  - allocation never exceeds the requested quantity;
 *  - insufficient total stock throws, so callers cannot silently oversell.
 */
export function allocateFefo(
  candidates: readonly FefoCandidate[],
  requested: number,
): FefoAllocation[] {
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new ValidationError('الكمية المطلوبة يجب أن تكون رقمًا صحيحًا أكبر من صفر');
  }

  const available = candidates
    .filter((batch) => batch.quantity > 0)
    .slice()
    .sort((a, b) =>
      a.expiryDate === b.expiryDate
        ? a.batchId.localeCompare(b.batchId)
        : a.expiryDate.localeCompare(b.expiryDate),
    );

  const totalAvailable = available.reduce((sum, batch) => sum + batch.quantity, 0);
  if (totalAvailable < requested) {
    throw new ValidationError('الكمية المتاحة غير كافية', {
      requested,
      available: totalAvailable,
      shortages: [{ requested, available: totalAvailable }],
    });
  }

  const allocations: FefoAllocation[] = [];
  let remaining = requested;
  for (const batch of available) {
    if (remaining === 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: take });
    remaining -= take;
  }
  return allocations;
}

/** Signed quantity for a movement type (inbound positive, outbound negative). */
export function signedQuantity(type: MovementType, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('الكمية يجب أن تكون رقمًا صحيحًا أكبر من صفر');
  }
  return isInbound(type) ? quantity : -quantity;
}
