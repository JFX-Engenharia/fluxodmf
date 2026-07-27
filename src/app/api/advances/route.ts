import { AdvanceStatus } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { numberValue } from "@/lib/finance-management";
import { prisma } from "@/lib/db";

const saveSchema = z.object({
  action: z.literal("save"),
  id: z.string().optional(),
  collaboratorName: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(200),
  amount: z.number().positive(),
  spentAmount: z.number().nonnegative().default(0),
  returnedAmount: z.number().nonnegative().default(0),
  grantedAt: z.string().min(1),
  dueDate: z.string().min(1),
  status: z.nativeEnum(AdvanceStatus).default(AdvanceStatus.ABERTO),
  notes: z.string().trim().max(1000).nullable().optional(),
  documents: z.string().trim().max(1000).default(""),
  workId: z.string().nullable().optional(),
});
const cancelSchema = z.object({ action: z.literal("cancel"), id: z.string().min(1) });
const bodySchema = z.discriminatedUnion("action", [saveSchema, cancelSchema]);

function day(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "Informe uma data válida.");
  return date;
}

function serialize(row: Awaited<ReturnType<typeof prisma.advance.findMany>>[number] & { work?: { id: string; name: string } | null }) {
  const amount = numberValue(row.amount);
  const spentAmount = numberValue(row.spentAmount);
  const returnedAmount = numberValue(row.returnedAmount);
  return {
    ...row,
    amount,
    spentAmount,
    returnedAmount,
    balance: Number((amount - spentAmount - returnedAmount).toFixed(2)),
    grantedAt: row.grantedAt.toISOString(),
    dueDate: row.dueDate.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  try {
    await requireTab("adiantamentos");
    const advances = await prisma.advance.findMany({
      where: { status: { not: AdvanceStatus.CANCELADO } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: { work: true, createdBy: { select: { id: true, name: true } } },
    });
    return ok({ advances: advances.map(serialize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("adiantamentos");
    await requireMutationAllowed(actor);
    const body = bodySchema.parse(await request.json());
    if (body.action === "cancel") {
      const updated = await prisma.advance.update({
        where: { id: body.id },
        data: { status: AdvanceStatus.CANCELADO, settledAt: new Date() },
        include: { work: true, createdBy: { select: { id: true, name: true } } },
      });
      await auditLog({ actorId: actor.id, event: "ADIANTAMENTO_CANCELADO", entity: "Advance", entityId: body.id });
      return ok({ advance: serialize(updated) });
    }

    if (body.spentAmount + body.returnedAmount > body.amount + 0.01) {
      throw new ApiError(400, "Gasto mais devolução não pode superar o adiantamento.");
    }
    const closed = body.status === AdvanceStatus.FECHADO;
    const data = {
      collaboratorName: body.collaboratorName,
      description: body.description,
      amount: body.amount,
      spentAmount: body.spentAmount,
      returnedAmount: body.returnedAmount,
      grantedAt: day(body.grantedAt),
      dueDate: day(body.dueDate),
      status: body.status,
      notes: body.notes || null,
      documents: body.documents,
      workId: body.workId || null,
      settledAt: closed ? new Date() : null,
    };
    const saved = body.id
      ? await prisma.advance.update({
          where: { id: body.id },
          data,
          include: { work: true, createdBy: { select: { id: true, name: true } } },
        })
      : await prisma.advance.create({
          data: { ...data, createdById: actor.id },
          include: { work: true, createdBy: { select: { id: true, name: true } } },
        });
    await auditLog({
      actorId: actor.id,
      event: body.id ? "ADIANTAMENTO_ATUALIZADO" : "ADIANTAMENTO_CRIADO",
      entity: "Advance",
      entityId: saved.id,
      metadata: { colaborador: saved.collaboratorName, valor: body.amount, status: body.status },
    });
    return ok({ advance: serialize(saved) }, body.id ? 200 : 201);
  } catch (error) {
    return handleApiError(error);
  }
}
