import { z } from "zod";
import { Role } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError, ok } from "@/lib/api";
import { getSession, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeIpAddress } from "@/lib/session-info";

const revokeSchema = z.object({ sessionId: z.string().min(1) });

export async function GET() {
  try {
    await requireRole([Role.ADMINISTRADOR]);
    const currentSession = await getSession();
    const now = new Date();
    const [sessions, loginEvents] = await Promise.all([
      prisma.userSession.findMany({
        where: { revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastSeenAt: "desc" },
        include: { user: { select: { id: true, name: true, username: true, lastLoginAt: true } } },
      }),
      prisma.loginEvent.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, username: true } } },
      }),
    ]);
    return ok({
      sessions: sessions.map((session) => ({
        ...session,
        ipAddress: normalizeIpAddress(session.ipAddress),
      })),
      loginEvents: loginEvents.map((event) => ({
        ...event,
        ipAddress: normalizeIpAddress(event.ipAddress),
      })),
      currentSessionId: currentSession?.sessionId ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const { sessionId } = revokeSchema.parse(await request.json());
    const target = await prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (target && !target.revokedAt) {
      await prisma.userSession.update({
        where: { id: target.id },
        data: { revokedAt: new Date() },
      });
      await auditLog({
        actorId: actor.id,
        event: "SESSAO_ENCERRADA_REMOTAMENTE",
        entity: "UserSession",
        entityId: target.id,
        metadata: { usuarioId: target.user.id, usuario: target.user.name },
      });
    }
    return ok({ revoked: !!target });
  } catch (error) {
    return handleApiError(error);
  }
}
