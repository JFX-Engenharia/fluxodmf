import { Role } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { handleApiError, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

const resetSchema = z.object({
  action: z.literal("reset"),
  confirmation: z.literal("RESETAR"),
});


function asBackupValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(asBackupValue);
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") {
      const jsonValue = value.toJSON();
      if (jsonValue !== value) return asBackupValue(jsonValue);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asBackupValue(item)]));
  }
  return value;
}

/** Exporta os dados administráveis para recuperação manual, sem hashes de senha. */
export async function GET() {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const [
      users,
      works,
      userWorks,
      importBatches,
      contributions,
      payments,
      paymentActions,
      attachments,
      paymentApprovals,
      tags,
      paymentTags,
      approvalRules,
      standardReasons,
      allocationRules,
      allocationRuleSplits,
      paymentAllocations,
      advances,
      paymentRequests,
      paymentRequestAttachments,
      dailyFlows,
      dailyFlowEvents,
      auditLogs,
      maintenanceNotices,
    ] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          status: true,
          phone: true,
          reviewedById: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.work.findMany(),
      prisma.userWork.findMany(),
      prisma.importBatch.findMany(),
      prisma.contribution.findMany(),
      prisma.payment.findMany(),
      prisma.paymentAction.findMany(),
      prisma.attachment.findMany(),
      prisma.paymentApproval.findMany(),
      prisma.tag.findMany(),
      prisma.paymentTag.findMany(),
      prisma.approvalRule.findMany(),
      prisma.standardReason.findMany(),
      prisma.allocationRule.findMany(),
      prisma.allocationRuleSplit.findMany(),
      prisma.paymentAllocation.findMany(),
      prisma.advance.findMany(),
      prisma.paymentRequest.findMany(),
      prisma.paymentRequestAttachment.findMany(),
      prisma.dailyFlow.findMany(),
      prisma.dailyFlowEvent.findMany(),
      prisma.auditLog.findMany(),
      prisma.maintenanceNotice.findMany(),
    ]);

    const backup = {
      format: "fluxo-backup/v1",
      generatedAt: new Date().toISOString(),
      generatedBy: { id: actor.id, name: actor.name },
      note: "Hashes de senha não são incluídos neste arquivo.",
      data: asBackupValue({
        users,
        works,
        userWorks,
        importBatches,
        contributions,
        payments,
        paymentActions,
        attachments,
        paymentApprovals,
        tags,
        paymentTags,
        approvalRules,
        standardReasons,
        allocationRules,
        allocationRuleSplits,
        paymentAllocations,
        advances,
        paymentRequests,
        paymentRequestAttachments,
        dailyFlows,
        dailyFlowEvents,
        auditLogs,
        maintenanceNotices,
      }),
    };

    await auditLog({
      actorId: actor.id,
      event: "BACKUP_GERADO",
      entity: "SystemBackup",
      metadata: { generatedAt: backup.generatedAt },
    });

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fluxo-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Remove registros operacionais e contas financeiras. Usuários e regras são
 * preservados para manter o acesso administrativo e a configuração do sistema.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    resetSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const paymentRequestAttachments = await tx.paymentRequestAttachment.deleteMany();
      const paymentRequests = await tx.paymentRequest.deleteMany();
      const dailyFlowEvents = await tx.dailyFlowEvent.deleteMany();
      const dailyFlows = await tx.dailyFlow.deleteMany();
      const paymentActions = await tx.paymentAction.deleteMany();
      const attachments = await tx.attachment.deleteMany();
      const paymentApprovals = await tx.paymentApproval.deleteMany();
      const paymentTags = await tx.paymentTag.deleteMany();
      const paymentAllocations = await tx.paymentAllocation.deleteMany();
      const payments = await tx.payment.deleteMany();
      const contributions = await tx.contribution.deleteMany();
      const importBatches = await tx.importBatch.deleteMany();
      const advances = await tx.advance.deleteMany();
      // Regras de rateio apontam para contas e impedem sua exclusão.
      const allocationRuleSplits = await tx.allocationRuleSplit.deleteMany();
      const userWorks = await tx.userWork.deleteMany();
      const works = await tx.work.deleteMany();

      return {
        paymentRequestAttachments: paymentRequestAttachments.count,
        paymentRequests: paymentRequests.count,
        dailyFlowEvents: dailyFlowEvents.count,
        dailyFlows: dailyFlows.count,
        paymentActions: paymentActions.count,
        attachments: attachments.count,
        paymentApprovals: paymentApprovals.count,
        paymentTags: paymentTags.count,
        paymentAllocations: paymentAllocations.count,
        payments: payments.count,
        importBatches: importBatches.count,
        contributions: contributions.count,
        advances: advances.count,
        allocationRuleSplits: allocationRuleSplits.count,
        userWorks: userWorks.count,
        works: works.count,
      };
    });

    await auditLog({
      actorId: actor.id,
      event: "DADOS_OPERACIONAIS_RESETADOS",
      entity: "SystemData",
      metadata: result,
    });

    return ok({ result });
  } catch (error) {
    return handleApiError(error);
  }
}
