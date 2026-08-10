import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { SessionRequestInfo } from "@/lib/session-info";

export const DEVICE_COOKIE = "fluxo_device";

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
};

const DEVICE_LIMIT_MESSAGE =
  "Limite de dispositivos atingido. Revogue um dispositivo antigo ou contate o administrador.";


export function generateDeviceToken() {
  return randomBytes(32).toString("hex");
}

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveDevice(
  userId: string,
  cookieToken: string | undefined,
  requestInfo: SessionRequestInfo,
) {
  const suppliedHash = cookieToken ? hashDeviceToken(cookieToken) : null;
  const configuredLimit = Number(process.env.MAX_DEVICES_PER_USER ?? "3");
  const deviceLimit =
    Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 3;

  const result = await prisma.$transaction(async (tx) => {
    // Serializa registros concorrentes da mesma conta para o limite nunca ser
    // ultrapassado por dois primeiros logins simultâneos.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

    const suppliedDevice = suppliedHash
      ? await tx.device.findUnique({
          where: { userId_tokenHash: { userId, tokenHash: suppliedHash } },
        })
      : null;

    if (suppliedDevice && !suppliedDevice.revokedAt) {
      const device = await tx.device.update({
        where: { id: suppliedDevice.id },
        data: {
          lastSeenAt: new Date(),
          userAgent: requestInfo.userAgent,
          name: requestInfo.device,
        },
      });
      return { device, token: cookieToken!, registered: false };
    }

    const activeCount = await tx.device.count({ where: { userId, revokedAt: null } });
    if (activeCount >= deviceLimit) {
      throw new ApiError(403, DEVICE_LIMIT_MESSAGE);
    }

    // A token já revogado para esta conta não volta a ser válido. Um token
    // desconhecido por ela é reutilizado para o navegador poder vincular
    // contas independentes sem trocar de identidade a cada login.
    const token = !cookieToken || suppliedDevice?.revokedAt ? generateDeviceToken() : cookieToken;
    const device = await tx.device.create({
      data: {
        userId,
        tokenHash: hashDeviceToken(token),
        name: requestInfo.device,
        userAgent: requestInfo.userAgent,
      },
    });
    return { device, token, registered: true };
  });

  if (result.registered) {
    await auditLog({
      actorId: userId,
      event: "DISPOSITIVO_REGISTRADO",
      entity: "Device",
      entityId: result.device.id,
      metadata: { nome: result.device.name },
    });
  }

  return {
    deviceId: result.device.id,
    token: result.token,
    cookie: DEVICE_COOKIE_OPTIONS,
  };
}
