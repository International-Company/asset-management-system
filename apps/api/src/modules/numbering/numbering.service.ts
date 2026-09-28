import { Injectable } from '@nestjs/common';
import { formatNumber, MainCategoryCode, OperationSequence } from '@osooli/shared';
import { Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

export function assetSequenceKey(category: MainCategoryCode): string {
  return `ASSET:${category}`;
}

export function operationSequenceKey(op: OperationSequence): string {
  return `OP:${op}`;
}

/**
 * Atomic, never-reused number allocation (spec §7, §60).
 *
 * `UPDATE … RETURNING` takes a row lock on the sequence, so concurrent
 * allocations are serialized and each caller receives a distinct value.
 * Numbers must be allocated inside the caller's transaction; a rolled-back
 * transaction may leave a gap, which is acceptable per spec.
 */
@Injectable()
export class NumberingService {
  async allocate(tx: Tx, sequenceKey: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ prefix: string; value: bigint; digits: number }>>`
      UPDATE number_sequences
         SET next_value = next_value + 1, updated_at = now()
       WHERE key = ${sequenceKey}
   RETURNING prefix, next_value - 1 AS value, digits`;
    const row = rows[0];
    if (!row) {
      throw new AppError('SERVER_ERROR', undefined, { internal: `Missing number sequence ${sequenceKey}` });
    }
    return formatNumber(row.prefix, Number(row.value), row.digits);
  }

  allocateAssetNumber(tx: Tx, category: MainCategoryCode): Promise<string> {
    return this.allocate(tx, assetSequenceKey(category));
  }

  allocateOperationNumber(tx: Tx, op: OperationSequence): Promise<string> {
    return this.allocate(tx, operationSequenceKey(op));
  }

  /** Previews the next number without allocating it (used for confirmation screens only). */
  async peek(tx: Tx, sequenceKey: string): Promise<string> {
    const row = await tx.numberSequence.findUnique({ where: { key: sequenceKey } });
    if (!row) throw new AppError('SERVER_ERROR', undefined, { internal: `Missing number sequence ${sequenceKey}` });
    return formatNumber(row.prefix, Number(row.nextValue), row.digits);
  }
}
