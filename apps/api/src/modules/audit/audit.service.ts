import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { redact, toJsonSafe } from '../../common/redact';

export interface AuditActor {
  id: string | null;
  name: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  operation: string;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { id: null, name: 'النظام' };

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return redact(toJsonSafe(value)) as Prisma.InputJsonValue;
}

/**
 * Append-only audit trail (spec §51). Pass the caller's transaction so the
 * audit row commits or rolls back together with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        operation: entry.operation,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldData: json(entry.oldData),
        newData: json(entry.newData),
        metadata: (redact(toJsonSafe(entry.metadata ?? {})) as Prisma.InputJsonValue),
        requestId: entry.requestId ?? null,
      },
    });
  }

  /** Returns only the fields that changed, as { field: { old, new } }. */
  static diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, { old: unknown; new: unknown }> {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const a = toJsonSafe(before) as Record<string, unknown>;
    const b = toJsonSafe(after) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // Absent and null are equivalent: neither is a change.
      const oldValue = a[key] ?? null;
      const newValue = b[key] ?? null;
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[key] = { old: oldValue, new: newValue };
      }
    }
    return changes;
  }
}
