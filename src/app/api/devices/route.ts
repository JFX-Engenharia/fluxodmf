import { NextRequest } from "next/server";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { DEVICE_COOKIE, hashDeviceToken } from "@/lib/device";
import { prisma } from "@/lib/db";

const revokeSchema = z.object({ deviceId: z.string().min(1) });

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const cookieToken = request.cookies.get(DEVICE_COOKIE)?.value;
    const currentTokenHash = cookieToken ? hashDeviceToken(cookieToken) : null;
    const devices = await prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        userAgent: true,
        tokenHash: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    });

    return ok({
      devices: devices.map(({ tokenHash, ...device }) => ({
        ...device,
        current: tokenHash === currentTokenHash,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const { deviceId } = revokeSchema.parse(await request.json());
    const target = await prisma.device.findFirst({
      where: { id: deviceId, userId: user.id },
    });
    if (!target) throw new ApiError(404, "Dispositivo não encontrado.");

    const cookieToken = request.cookies.get(DEVICE_COOKIE)?.value;
    const current = cookieToken ? target.tokenHash === hashDeviceToken(cookieToken) : false;
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
        actorId: user.id,
        event: "DISPOSITIVO_REVOGADO",
        entity: "Device",
        entityId: target.id,
        metadata: { nome: target.name },
      });
    }

    return ok({ revoked: true, current });
  } catch (error) {
    return handleApiError(error);
  }
}
