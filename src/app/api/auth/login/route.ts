import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError } from "@/lib/api";
import { DEVICE_COOKIE, resolveDevice } from "@/lib/device";
import {
  createSessionToken,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceLoginRateLimit } from "@/lib/rate-limit";
import { recordLoginEvent, sessionRequestInfo } from "@/lib/session-info";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Mensagens por status, para o usuario pendente entender que falta aprovacao. */
const statusMessages: Record<Exclude<UserStatus, "ATIVO">, string> = {
  PENDENTE: "Seu acesso ainda está aguardando aprovação de um administrador.",
  RECUSADO: "Sua solicitação de acesso foi recusada.",
  INATIVO: "Seu acesso foi desativado. Procure um administrador.",
};

export async function POST(request: NextRequest) {
  try {
    const body = loginSchema.parse(await request.json());
    const username = body.username.trim().toLowerCase();
    const initialRequestInfo = sessionRequestInfo(request);
    enforceLoginRateLimit(initialRequestInfo.ipAddress, username);
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user?.passwordHash) {
      await recordLoginEvent(request, {
        userId: user?.id,
        identifier: username,
        provider: "local",
        success: false,
        reason: "Credenciais inválidas",
      });
      return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
    }

    const passwordOk = await verifyPassword(body.password, user.passwordHash);
    if (!passwordOk) {
      await recordLoginEvent(request, {
        userId: user.id,
        identifier: username,
        provider: "local",
        success: false,
        reason: "Credenciais inválidas",
      });
      return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
    }

    // Status e checado depois da senha para nao revelar a situacao de uma
    // conta a quem nao sabe a senha dela.
    if (user.status !== UserStatus.ATIVO) {
      await recordLoginEvent(request, {
        userId: user.id,
        identifier: username,
        provider: "local",
        success: false,
        reason: `Status ${user.status}`,
      });
      return NextResponse.json(
        { error: statusMessages[user.status as Exclude<UserStatus, "ATIVO">] },
        { status: 403 },
      );
    }

    const device = await resolveDevice(
      user.id,
      request.cookies.get(DEVICE_COOKIE)?.value,
      initialRequestInfo,
    );
    const requestInfo = await recordLoginEvent(request, {
      userId: user.id,
      identifier: username,
      provider: "local",
      success: true,
    });
    const token = await createSessionToken(
      {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        provider: "local",
      },
      requestInfo,
      device.deviceId,
    );

    await auditLog({
      actorId: user.id,
      event: "LOGIN",
      entity: "User",
      entityId: user.id,
      metadata: { username: user.username },
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 10,
      path: "/",
    });
    response.cookies.set(DEVICE_COOKIE, device.token, device.cookie);

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
