import { NextRequest, NextResponse } from "next/server";
import { Role, UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { exchangeCorporateCode } from "@/lib/oidc";
import { recordLoginEvent } from "@/lib/session-info";

const corporateMessages: Record<UserStatus, string> = {
  PENDENTE: "pending",
  RECUSADO: "rejected",
  INATIVO: "inactive",
  ATIVO: "active",
};

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expectedState = request.cookies.get("fluxo_oidc_state")?.value;
    const nonce = request.cookies.get("fluxo_oidc_nonce")?.value;
    const codeVerifier = request.cookies.get("fluxo_oidc_verifier")?.value;
    if (!code || !state || state !== expectedState || !nonce || !codeVerifier) {
      throw new ApiError(401, "Estado do login corporativo inválido.");
    }

    const redirectUri = process.env.OIDC_REDIRECT_URI || new URL("/api/auth/oidc/callback", request.url).toString();
    const identity = await exchangeCorporateCode({ code, codeVerifier, nonce, redirectUri });
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { authProvider: "oidc", externalSubject: identity.subject },
          { email: identity.email },
        ],
      },
    });

    if (!user) {
      const usernameTaken = await prisma.user.findUnique({ where: { username: identity.username } });
      user = await prisma.user.create({
        data: {
          name: identity.name,
          email: identity.email,
          username: usernameTaken ? `${identity.username}-${identity.subject.slice(-6)}` : identity.username,
          passwordHash: null,
          role: Role.OPERADOR,
          status: UserStatus.PENDENTE,
          authProvider: "oidc",
          externalSubject: identity.subject,
        },
      });
    } else if (
      user.authProvider === "oidc" &&
      user.externalSubject &&
      user.externalSubject !== identity.subject
    ) {
      throw new ApiError(409, "Este e-mail já está vinculado a outra conta corporativa.");
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: identity.name,
          authProvider: "oidc",
          externalSubject: identity.subject,
        },
      });
    }

    if (user.status !== UserStatus.ATIVO) {
      await recordLoginEvent(request, {
        userId: user.id,
        identifier: identity.email,
        provider: "oidc",
        success: false,
        reason: `Status ${user.status}`,
      });
      loginUrl.searchParams.set("corporate", corporateMessages[user.status]);
      return NextResponse.redirect(loginUrl);
    }

    const requestInfo = await recordLoginEvent(request, {
      userId: user.id,
      identifier: identity.email,
      provider: "oidc",
      success: true,
    });
    const token = await createSessionToken(
      {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        provider: "oidc",
      },
      requestInfo,
    );
    await auditLog({
      actorId: user.id,
      event: "LOGIN_CORPORATIVO",
      entity: "User",
      entityId: user.id,
      metadata: { email: user.email },
    });

    const response = NextResponse.redirect(new URL("/painel", request.url));
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60,
      path: "/",
    });
    response.cookies.delete("fluxo_oidc_state");
    response.cookies.delete("fluxo_oidc_nonce");
    response.cookies.delete("fluxo_oidc_verifier");
    return response;
  } catch (error) {
    await recordLoginEvent(request, {
      identifier: "login corporativo",
      provider: "oidc",
      success: false,
      reason: error instanceof Error ? error.message : "Falha no provedor",
    }).catch(() => undefined);
    loginUrl.searchParams.set("corporate", "error");
    return NextResponse.redirect(loginUrl);
  }
}
