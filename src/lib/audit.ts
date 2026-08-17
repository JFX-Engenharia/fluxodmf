import { prisma } from "@/lib/db";

type AuditEntry = {
  actorId?: string;
  event: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Varias linhas de auditoria numa insercao so. Existe para quem processa em
 * lote: a auditoria continua sendo POR ENTIDADE — um agregado por lote quebraria
 * o relatorio do fluxo diario e a aba de aprovados —, mas gravar uma a uma
 * dentro do laco desperdicaria um round-trip por item.
 *
 * `auditLog` acima segue intacta: ela tem muitos chamadores e nao ha razao para
 * mexer na assinatura deles.
 */
export async function auditLogMany(entries: AuditEntry[]) {
  if (entries.length === 0) return;

  await prisma.auditLog.createMany({
    data: entries.map((entry) => ({
      actorId: entry.actorId,
      event: entry.event,
      entity: entry.entity,
      entityId: entry.entityId,
      metadata: JSON.stringify(entry.metadata ?? {}),
    })),
  });
}

export async function auditLog(input: AuditEntry) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      event: input.event,
      entity: input.entity,
      entityId: input.entityId,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
}
