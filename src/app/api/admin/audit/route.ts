import { z } from "zod";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { withIdempotency } from "@/lib/idempotency";
import { prisma } from "@/lib/db";

const clearSchema = z.object({ confirmation: z.literal("LIMPAR LOGS") });


export async function GET(request: Request) {
  try {
    const actor = await requireTab("logs");

    const { searchParams } = new URL(request.url);
    const event = searchParams.get("event")?.trim();
    const actorId = searchParams.get("actorId")?.trim();

    if (searchParams.get("download") === "true") {
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true, username: true, email: true } } },
      });
      const backup = {
        format: "fluxo-audit-backup/v1",
        generatedAt: new Date().toISOString(),
        generatedBy: { id: actor.id, name: actor.name },
        total: logs.length,
        logs: logs.map((log) => ({
          id: log.id,
          actorId: log.actorId,
          event: log.event,
          entity: log.entity,
          entityId: log.entityId,
          metadata: JSON.parse(log.metadata || "{}"),
          actor: log.actor,
          createdAt: log.createdAt.toISOString(),
        })),
      };
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          event: "BACKUP_LOG_GERADO",
          entity: "AuditLog",
          metadata: JSON.stringify({ total: logs.length }),
        },
      });
      return new Response(JSON.stringify(backup, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const limit = Math.min(Number(searchParams.get("limit") ?? 200) || 200, 500);

    const where = {
      ...(event ? { event } : {}),
      ...(actorId ? { actorId } : {}),
    };

    const [logs, eventGroups, actors] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true, username: true } } },
      }),
      prisma.auditLog.groupBy({ by: ["event"], _count: { _all: true } }),
      prisma.user.findMany({
        select: { id: true, name: true, username: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return ok({
      logs: logs.map((log) => ({
        id: log.id,
        event: log.event,
        entity: log.entity,
        entityId: log.entityId,
        metadata: JSON.parse(log.metadata || "{}"),
        actor: log.actor
          ? { id: log.actor.id, name: log.actor.name, username: log.actor.username }
          : null,
        createdAt: log.createdAt.toISOString(),
      })),
      events: eventGroups
        .map((row) => ({ event: row.event, count: row._count._all }))
        .sort((a, b) => a.event.localeCompare(b.event)),
      actors,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireTab("logs");
    clearSchema.parse(await request.json());
    return withIdempotency({
      request,
      scope: "audit:clear",
      actorId: actor.id,
      execute: async () => {
        const deleted = await prisma.$transaction(async (tx) => {
          const result = await tx.auditLog.deleteMany();
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              event: "AUDITORIA_LIMPA",
              entity: "AuditLog",
              metadata: JSON.stringify({ removidos: result.count }),
            },
          });
          return result.count;
        });
        return ok({ deleted });
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
