import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";

const listSchema = z.object({ userId: z.string().min(1) });
const revokeSchema = z.object({ deviceId: z.string().min(1) });

export async function GET(request: Request) {
  try {
    await requireTab("usuarios");
    const query = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const devices = await prisma.device.findMany({
      where: { userId: query.userId },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    });
    return ok({ devices });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireTab("usuarios");
    const { deviceId } = revokeSchema.parse(await request.json());
    const target = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    if (!target) throw new ApiError(404, "Dispositivo não encontrado.");

    if (!target.revokedAt) {
      const revokedAt = new Date();
      await prisma.$transaction([
        prisma.device.update({ where: { id: target.id }, data: { revokedAt } }),
        prisma.userSession.updateMany({
          where: { deviceId: target.id, revokedAt: null },
          data: { revokedAt },
        }),
      ]);
      await auditLog({
        actorId: actor.id,
        event: "DISPOSITIVO_REVOGADO",
        entity: "Device",
        entityId: target.id,
        metadata: {
          nome: target.name,
          usuarioId: target.user.id,
          usuario: target.user.name,
          username: target.user.username,
        },
      });
    }

    return ok({ revoked: true });
  } catch (error) {
    return handleApiError(error);
  }
}
