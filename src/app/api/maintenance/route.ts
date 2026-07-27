import { z } from "zod";
import { Role } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SINGLETON_ID = "singleton";

const toggleSchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(3).max(240).nullable().optional(),
  estimatedEndAt: z.string().datetime().nullable().optional(),
});

type NoticeRecord = {
  active: boolean;
  activatedByName: string | null;
  activatedAt: Date | null;
  reason: string | null;
  estimatedEndAt: Date | null;
};

function serialize(notice: NoticeRecord | null) {
  return {
    active: notice?.active ?? false,
    activatedByName: notice?.activatedByName ?? null,
    activatedAt: notice?.activatedAt?.toISOString() ?? null,
    reason: notice?.reason ?? null,
    estimatedEndAt: notice?.estimatedEndAt?.toISOString() ?? null,
  };
}

export async function GET() {
  try {
    await requireUser();
    const notice = await prisma.maintenanceNotice.findUnique({
      where: { id: SINGLETON_ID },
    });
    return ok({ notice: serialize(notice) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const { active, reason, estimatedEndAt } = toggleSchema.parse(await request.json());

    // Ligar grava quem sinalizou e o horario; desligar limpa esses campos para
    // que a proxima manutencao nao herde o autor anterior.
    const data = active
      ? {
          active: true,
          activatedById: actor.id,
          activatedByName: actor.name,
          activatedAt: new Date(),
          reason: reason ?? null,
          estimatedEndAt: estimatedEndAt ? new Date(estimatedEndAt) : null,
        }
      : {
          active: false,
          activatedById: null,
          activatedByName: null,
          activatedAt: null,
          reason: null,
          estimatedEndAt: null,
        };

    const notice = await prisma.maintenanceNotice.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });

    await auditLog({
      actorId: actor.id,
      event: active ? "MANUTENCAO_SINALIZADA" : "MANUTENCAO_ENCERRADA",
      entity: "MaintenanceNotice",
      entityId: SINGLETON_ID,
      metadata: active ? { reason: reason ?? null, estimatedEndAt: estimatedEndAt ?? null } : undefined,
    });

    return ok({ notice: serialize(notice) });
  } catch (error) {
    return handleApiError(error);
  }
}
