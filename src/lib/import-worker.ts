import { z } from "zod";
import {
  ActionType,
  AllocationSource,
  DailyFlowEventType,
  ImportStatus,
  PaymentStatus,
} from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { matchWork, normalizeName, uniqueSlug } from "@/lib/cost-center";
import { prisma } from "@/lib/db";
import { allocationRows, chooseAllocationRule } from "@/lib/finance-management";

const rowSchema = z.object({
  externalReference: z.string().optional(),
  supplierName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().default(""),
  originalDueDate: z.string().min(1),
  currentDueDate: z.string().min(1),
  costCenter: z.string().min(1),
  workId: z.string().optional(),
  uniqueKey: z.string().min(1),
  errors: z.array(z.string()),
  duplicate: z.boolean(),
});

const contributionSchema = z.object({
  accountLabel: z.string().min(1),
  amount: z.number().positive(),
  workId: z.string().optional(),
  errors: z.array(z.string()),
});

export const confirmSchema = z.object({
  fileName: z.string().min(1),
  importName: z.string().trim().max(120).optional(),
  totalRows: z.number().int().nonnegative(),
  rows: z.array(rowSchema),
  contributions: z.array(contributionSchema).default([]),
});

export type ConfirmImport = z.infer<typeof confirmSchema>;
type ImportTaskPayload = Pick<ConfirmImport, "rows" | "contributions">;

const taskPayloadSchema = z.object({
  rows: z.array(rowSchema),
  contributions: z.array(contributionSchema),
});

const CHUNK_SIZE = 100;
const STALE_AFTER_MS = 15 * 60_000;

function dateFromIsoDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

export async function processImportTask(batchId: string): Promise<void> {
  const startedAt = new Date();
  const claimed = await prisma.importBatch.updateMany({
    where: {
      id: batchId,
      OR: [
        { status: ImportStatus.PENDENTE },
        { status: ImportStatus.FALHOU },
        {
          status: ImportStatus.PROCESSANDO,
          startedAt: { lt: new Date(startedAt.getTime() - STALE_AFTER_MS) },
        },
      ],
    },
    data: {
      status: ImportStatus.PROCESSANDO,
      startedAt,
      finishedAt: null,
      attempts: { increment: 1 },
      error: "",
    },
  });
  if (claimed.count === 0) return;

  try {
    const alreadyImportedByBatch = await prisma.payment.count({
      where: { importBatchId: batchId },
    });
    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        processedRows: alreadyImportedByBatch,
        importedRows: alreadyImportedByBatch,
      },
    });

    const batch = await prisma.importBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: {
        id: true,
        importedById: true,
        sourceFileName: true,
        flowName: true,
        payload: true,
        validRows: true,
        createdAccounts: true,
      },
    });
    const payload: ImportTaskPayload = taskPayloadSchema.parse(JSON.parse(batch.payload));
    const existingWorks = await prisma.work.findMany();
    const allocationRules = await prisma.allocationRule.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
      include: { splits: true },
    });
    const takenSlugs = new Set(existingWorks.map((work) => work.slug));
    const resolved = new Map<string, string>();
    const previousCreatedAccounts = JSON.parse(batch.createdAccounts || "[]");
    const createdAccounts = Array.isArray(previousCreatedAccounts)
      ? previousCreatedAccounts.filter((value): value is string => typeof value === "string")
      : [];

    async function resolveWorkId(costCenter: string) {
      const key = normalizeName(costCenter);
      const cached = resolved.get(key);
      if (cached) return cached;

      const match = matchWork(costCenter, existingWorks);
      if (match) {
        resolved.set(key, match.id);
        return match.id;
      }

      const slug = uniqueSlug(costCenter, takenSlugs);
      takenSlugs.add(slug);
      const created = await prisma.work.create({
        data: {
          name: costCenter.trim(),
          slug,
          costCenterAliases: JSON.stringify([costCenter.trim()]),
        },
      });
      existingWorks.push(created);
      resolved.set(key, created.id);
      if (!createdAccounts.includes(created.name)) createdAccounts.push(created.name);
      return created.id;
    }

    const accountLabels = new Map<string, string>();
    for (const row of payload.rows) {
      accountLabels.set(normalizeName(row.costCenter), row.costCenter);
    }
    for (const contribution of payload.contributions) {
      accountLabels.set(normalizeName(contribution.accountLabel), contribution.accountLabel);
    }
    for (const accountLabel of accountLabels.values()) {
      await resolveWorkId(accountLabel);
    }
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { createdAccounts: JSON.stringify(createdAccounts) },
    });

    function resolvedWorkId(accountLabel: string) {
      const workId = resolved.get(normalizeName(accountLabel));
      if (!workId) {
        throw new ApiError(400, `Não foi possível resolver a conta ${accountLabel}.`);
      }
      return workId;
    }

    const existingPayments = await prisma.payment.findMany({
      where: { uniqueKey: { in: payload.rows.map((row) => row.uniqueKey) } },
      select: { uniqueKey: true },
    });
    const existingKeys = new Set(existingPayments.map(({ uniqueKey }) => uniqueKey));
    const rowsToProcess = payload.rows.filter((row) => !existingKeys.has(row.uniqueKey));

    for (let offset = 0; offset < rowsToProcess.length; offset += CHUNK_SIZE) {
      const chunk = rowsToProcess.slice(offset, offset + CHUNK_SIZE);
      await prisma.$transaction(async (tx) => {
        const payments = await tx.payment.createManyAndReturn({
          data: chunk.map((row) => ({
            externalReference: row.externalReference,
            supplierName: row.supplierName,
            description: row.description,
            amount: row.amount,
            category: row.category,
            originalDueDate: dateFromIsoDay(row.originalDueDate),
            currentDueDate: dateFromIsoDay(row.currentDueDate),
            costCenter: row.costCenter,
            uniqueKey: row.uniqueKey,
            workId: resolvedWorkId(row.costCenter),
            importBatchId: batch.id,
            createdById: batch.importedById,
            status: PaymentStatus.PENDENTE,
          })),
          select: {
            id: true,
            amount: true,
            category: true,
            supplierName: true,
          },
        });

        await tx.paymentAction.createMany({
          data: payments.map((payment) => ({
            paymentId: payment.id,
            actorId: batch.importedById,
            type: ActionType.IMPORTAR,
            newStatus: PaymentStatus.PENDENTE,
            note: `Importado no fluxo ${batch.flowName}`,
          })),
        });

        const allocations = payments.flatMap((payment) => {
          const allocationRule = chooseAllocationRule(payment, allocationRules);
          if (!allocationRule) return [];
          return allocationRows(payment.amount, allocationRule.splits).map((split) => ({
            paymentId: payment.id,
            ...split,
            source: AllocationSource.REGRA,
          }));
        });
        if (allocations.length > 0) {
          await tx.paymentAllocation.createMany({ data: allocations });
        }

        await tx.importBatch.update({
          where: { id: batch.id },
          data: {
            processedRows: { increment: chunk.length },
            importedRows: { increment: payments.length },
          },
        });
      });
    }

    const importedRows = await prisma.payment.count({ where: { importBatchId: batch.id } });
    const { dailyFlow } = await prisma.$transaction(async (tx) => {
      const dailyFlow = await tx.dailyFlow.upsert({
        where: { importBatchId: batch.id },
        update: {},
        create: {
          importBatchId: batch.id,
          events: {
            create: {
              actorId: batch.importedById,
              type: DailyFlowEventType.CRIADO,
              metadata: JSON.stringify({ arquivoOrigem: batch.sourceFileName }),
            },
          },
        },
      });

      if (payload.contributions.length > 0) {
        await tx.contribution.createMany({
          data: payload.contributions.map((contribution) => ({
            accountLabel: contribution.accountLabel,
            amount: contribution.amount,
            workId: resolvedWorkId(contribution.accountLabel),
            importBatchId: batch.id,
          })),
        });
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportStatus.CONFIRMADO,
          processedRows: batch.validRows,
          importedRows,
          importedContributions: payload.contributions.length,
          createdAccounts: JSON.stringify(createdAccounts),
          finishedAt: new Date(),
          error: "",
        },
      });
      return { dailyFlow };
    });

    const amount = await prisma.payment.aggregate({
      where: { importBatchId: batch.id },
      _sum: { amount: true },
    });
    await auditLog({
      actorId: batch.importedById,
      event: "IMPORT_CONFIRM",
      entity: "ImportBatch",
      entityId: batch.id,
      metadata: {
        fileName: batch.flowName,
        arquivoOrigem: batch.sourceFileName,
        fluxoDiarioId: dailyFlow.id,
        importedRows,
        skippedRows: batch.validRows - importedRows,
        contributions: payload.contributions.length,
        totalAmount: Number(amount._sum.amount ?? 0),
        ...(createdAccounts.length ? { contasCriadas: createdAccounts } : {}),
      },
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    await prisma.importBatch.updateMany({
      where: { id: batchId, status: { not: ImportStatus.CONFIRMADO } },
      data: { status: ImportStatus.FALHOU, error: message, finishedAt: new Date() },
    });
  }
}
