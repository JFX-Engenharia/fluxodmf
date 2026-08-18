import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  ActionType,
  AdvanceStatus,
  AllocationSource,
  DailyFlowEventType,
  DailyFlowStatus,
  ImportStatus,
  PaymentRequestStatus,
  PaymentStatus,
  Role,
} from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";

const date = z.coerce.date();
const decimal = z.union([z.string(), z.number()]);
const nullableDate = date.nullable();
const work = z.object({ id: z.string(), name: z.string(), slug: z.string(), costCenterAliases: z.string(), active: z.boolean(), createdAt: date, updatedAt: date });
const workApprover = z.object({ workId: z.string(), userId: z.string() });
const userWork = z.object({ userId: z.string(), workId: z.string() });
const approvalRuleLink = z.object({ id: z.string(), workId: z.string().nullable() }).passthrough();
const allocationRuleSplit = z.object({ id: z.string(), ruleId: z.string(), workId: z.string(), percentage: decimal });
const importBatch = z.object({
  id: z.string(),
  fileName: z.string(),
  totalRows: z.number(),
  validRows: z.number(),
  invalidRows: z.number(),
  status: z.nativeEnum(ImportStatus),
  importedById: z.string(),
  sourceFileName: z.string(),
  flowName: z.string(),
  processedRows: z.number(),
  importedRows: z.number(),
  importedContributions: z.number(),
  createdAccounts: z.string(),
  attempts: z.number(),
  error: z.string(),
  startedAt: nullableDate,
  finishedAt: nullableDate,
  createdAt: date,
});
const contribution = z.object({ id: z.string(), accountLabel: z.string(), amount: decimal, workId: z.string(), importBatchId: z.string(), createdAt: date });
const payment = z.object({
  id: z.string(), externalReference: z.string().nullable(), supplierName: z.string(), description: z.string(), amount: decimal,
  originalDueDate: date, currentDueDate: date, costCenter: z.string(), category: z.string(), uniqueKey: z.string(), status: z.nativeEnum(PaymentStatus),
  workId: z.string(), importBatchId: z.string(), createdById: z.string(), hasReceipt: z.boolean(), receiptReceivedAt: nullableDate,
  appliedApprovalRuleId: z.string().nullable(), requiredApprovals: z.number(), requiredApprovalRole: z.nativeEnum(Role), createdAt: date, updatedAt: date,
});
const paymentAction = z.object({ id: z.string(), paymentId: z.string(), actorId: z.string(), type: z.nativeEnum(ActionType), previousStatus: z.nativeEnum(PaymentStatus).nullable(), newStatus: z.nativeEnum(PaymentStatus), reason: z.string().nullable(), newDueDate: nullableDate, note: z.string().nullable(), createdAt: date });
const attachment = z.object({ id: z.string(), paymentId: z.string(), fileName: z.string(), url: z.string(), uploadedBy: z.string(), createdAt: date });
const paymentApproval = z.object({ id: z.string(), paymentId: z.string(), actorId: z.string(), approvalRuleId: z.string().nullable(), createdAt: date });
const paymentTag = z.object({ paymentId: z.string(), tagId: z.string() });
const paymentAllocation = z.object({ id: z.string(), paymentId: z.string(), workId: z.string(), percentage: decimal, amount: decimal, source: z.nativeEnum(AllocationSource), createdAt: date, updatedAt: date });
const advance = z.object({ id: z.string(), collaboratorName: z.string(), description: z.string(), amount: decimal, spentAmount: decimal, returnedAmount: decimal, grantedAt: date, dueDate: date, settledAt: nullableDate, status: z.nativeEnum(AdvanceStatus), notes: z.string().nullable(), documents: z.string(), workId: z.string().nullable(), createdById: z.string(), createdAt: date, updatedAt: date });
const paymentRequest = z.object({ id: z.string(), supplierName: z.string(), description: z.string(), amount: decimal, dueDate: date, category: z.string(), workId: z.string(), requestedById: z.string(), status: z.nativeEnum(PaymentRequestStatus), reviewedById: z.string().nullable(), reviewedAt: nullableDate, reviewReason: z.string().nullable(), createdAt: date, updatedAt: date });
const paymentRequestApproval = z.object({ id: z.string(), requestId: z.string(), approverId: z.string(), approvedAt: nullableDate, createdAt: date });
const requestAttachment = z.object({ id: z.string(), requestId: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number(), data: z.string(), createdAt: date });
const dailyFlow = z.object({ id: z.string(), importBatchId: z.string(), status: z.nativeEnum(DailyFlowStatus), startedById: z.string().nullable(), startedAt: nullableDate, closedById: z.string().nullable(), closedAt: nullableDate, finalSummary: z.string(), createdAt: date, updatedAt: date });
const dailyFlowEvent = z.object({ id: z.string(), dailyFlowId: z.string(), actorId: z.string(), type: z.nativeEnum(DailyFlowEventType), reason: z.string().nullable(), metadata: z.string(), createdAt: date });

const backupSchema = z.object({
  format: z.literal("fluxo-backup/v1"),
  data: z.object({
    works: z.array(work), workApprovers: z.array(workApprover), userWorks: z.array(userWork), approvalRules: z.array(approvalRuleLink), allocationRuleSplits: z.array(allocationRuleSplit),
    importBatches: z.array(importBatch), contributions: z.array(contribution), payments: z.array(payment), paymentActions: z.array(paymentAction),
    attachments: z.array(attachment), paymentApprovals: z.array(paymentApproval), paymentTags: z.array(paymentTag),
    paymentAllocations: z.array(paymentAllocation), advances: z.array(advance), paymentRequests: z.array(paymentRequest),
    paymentRequestApprovals: z.array(paymentRequestApproval), paymentRequestAttachments: z.array(requestAttachment), dailyFlows: z.array(dailyFlow), dailyFlowEvents: z.array(dailyFlowEvent),
  }).passthrough(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const backup = backupSchema.parse(await request.json());
    return await withIdempotency({
      request,
      scope: "system:restore",
      actorId: actor.id,
      execute: async () => {
        // Operacao rara sobre um backup de tamanho arbitrario; o default
        // global de 15 s nao basta.
        const counts = await prisma.$transaction(async (tx) => {
          await tx.paymentRequestApproval.deleteMany();
          await tx.paymentRequestAttachment.deleteMany();
          await tx.paymentRequest.deleteMany();
          await tx.dailyFlowEvent.deleteMany();
          await tx.dailyFlow.deleteMany();
          await tx.paymentAction.deleteMany();
          await tx.attachment.deleteMany();
          await tx.paymentApproval.deleteMany();
          await tx.paymentTag.deleteMany();
          await tx.paymentAllocation.deleteMany();
          await tx.payment.deleteMany();
          await tx.contribution.deleteMany();
          await tx.importBatch.deleteMany();
          await tx.advance.deleteMany();
          await tx.allocationRuleSplit.deleteMany();
          await tx.userWork.deleteMany();
          await tx.workApprover.deleteMany();
          await tx.work.deleteMany();

          await tx.work.createMany({ data: backup.data.works });
          await tx.workApprover.createMany({ data: backup.data.workApprovers });
          await Promise.all(
            backup.data.approvalRules.map((rule) =>
              tx.approvalRule.updateMany({ where: { id: rule.id }, data: { workId: rule.workId } }),
            ),
          );
          await tx.allocationRuleSplit.createMany({ data: backup.data.allocationRuleSplits });
          await tx.userWork.createMany({ data: backup.data.userWorks });
          await tx.importBatch.createMany({
            data: backup.data.importBatches.map((batch) => ({ ...batch, payload: "" })),
          });
          await tx.contribution.createMany({ data: backup.data.contributions });
          await tx.payment.createMany({ data: backup.data.payments });
          await tx.paymentAction.createMany({ data: backup.data.paymentActions });
          await tx.attachment.createMany({ data: backup.data.attachments });
          await tx.paymentApproval.createMany({ data: backup.data.paymentApprovals });
          await tx.paymentTag.createMany({ data: backup.data.paymentTags });
          await tx.paymentAllocation.createMany({ data: backup.data.paymentAllocations });
          await tx.advance.createMany({ data: backup.data.advances });
          await tx.paymentRequest.createMany({ data: backup.data.paymentRequests });
          await tx.paymentRequestApproval.createMany({ data: backup.data.paymentRequestApprovals });
          await tx.paymentRequestAttachment.createMany({ data: backup.data.paymentRequestAttachments.map((item) => ({ ...item, data: Buffer.from(item.data, "base64") })) });
          await tx.dailyFlow.createMany({ data: backup.data.dailyFlows });
          await tx.dailyFlowEvent.createMany({ data: backup.data.dailyFlowEvents });

          return {
            works: backup.data.works.length,
            payments: backup.data.payments.length,
            requests: backup.data.paymentRequests.length,
            advances: backup.data.advances.length,
          };
        }, { timeout: 120_000, maxWait: 10_000 });
        await auditLog({ actorId: actor.id, event: "BACKUP_RESTAURADO", entity: "SystemBackup", metadata: counts });
        return ok({ restored: counts });
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
