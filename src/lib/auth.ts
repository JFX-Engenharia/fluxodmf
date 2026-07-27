import { compare, hash } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { Role, UserStatus } from "@prisma-generated/enums";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { canAccessTab, type TabId } from "@/lib/permissions";
import type { SessionUser } from "@/types";
import type { SessionRequestInfo } from "@/lib/session-info";

type SessionTokenInput = Omit<SessionUser, "sessionId">;

export const SESSION_COOKIE = "fluxo_session";

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "fluxo-dev-secret-change-me",
);

export async function hashPassword(password: string) {
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export async function createSessionToken(
  user: SessionTokenInput,
  requestInfo: SessionRequestInfo,
) {
  const durationHours = user.provider === "oidc" ? 1 : 10;
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1_000);
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.userSession.create({
      data: {
        userId: user.id,
        provider: user.provider,
        ipAddress: requestInfo.ipAddress,
        userAgent: requestInfo.userAgent,
        device: requestInfo.device,
        expiresAt,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return created;
  });

  return new SignJWT({
    userId: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    sid: session.id,
    provider: user.provider,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    const sessionId = String(payload.sid ?? "");
    if (!sessionId) return null;

    const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1_000) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return {
      id: String(payload.userId),
      name: String(payload.name),
      username: String(payload.username),
      email: String(payload.email),
      role: payload.role as Role,
      sessionId,
      provider: String(payload.provider ?? session.provider),
    };
  } catch {
    return null;
  }
}

/**
 * Le o usuario da sessao direto do banco. O perfil e o status vem sempre do
 * registro atual, nunca do token: assim rebaixar ou desativar alguem tem
 * efeito imediato, sem esperar a sessao expirar.
 */
export async function requireUser() {
  const session = await getSession();

  if (!session) {
    throw new ApiError(401, "Faca login para continuar.");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: { works: { include: { work: true } } },
  });

  if (!user) {
    throw new ApiError(401, "Usuario inexistente.");
  }

  if (user.status !== UserStatus.ATIVO) {
    throw new ApiError(401, "Acesso nao liberado para este usuario.");
  }

  return user;
}

export async function requireMutationAllowed(user: { role: Role }) {
  if (user.role === Role.ADMINISTRADOR) return;
  const maintenance = await prisma.maintenanceNotice.findUnique({
    where: { id: "singleton" },
    select: { active: true, reason: true, estimatedEndAt: true },
  });
  if (!maintenance?.active) return;

  const estimate = maintenance.estimatedEndAt
    ? ` Previsão de retorno: ${maintenance.estimatedEndAt.toLocaleString("pt-BR")}.`
    : "";
  throw new ApiError(
    503,
    `Sistema em modo somente leitura${maintenance.reason ? `: ${maintenance.reason}` : "."}${estimate}`,
  );
}

export async function requireRole(roles: Role[]) {
  const user = await requireUser();

  if (!roles.includes(user.role)) {
    throw new ApiError(403, "Voce nao tem permissao para esta acao.");
  }

  return user;
}

/** Exige que o perfil tenha acesso a uma aba do painel. */
export async function requireTab(tab: TabId) {
  const user = await requireUser();

  if (!canAccessTab(user.role, tab)) {
    throw new ApiError(403, "Voce nao tem permissao para esta area.");
  }

  return user;
}
