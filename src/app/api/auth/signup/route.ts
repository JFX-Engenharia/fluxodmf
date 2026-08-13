import { NextResponse } from "next/server";
import { z } from "zod";
import { Role, UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { handleApiError, ok } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceSignupRateLimit } from "@/lib/rate-limit";
import { sessionRequestInfo } from "@/lib/session-info";
import { passwordSchema } from "@/lib/validation";

const signupSchema = z.object({
  username: z
    .string()
    .min(3, "O usuário precisa de ao menos 3 caracteres.")
    .max(30, "O usuário pode ter no máximo 30 caracteres.")
    .regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou underline."),
  email: z.email("E-mail inválido.").max(254, "O e-mail pode ter no máximo 254 caracteres."),
  password: passwordSchema,
});

/**
 * Autocadastro público. A conta nasce PENDENTE como OPERADOR (menor privilégio);
 * o administrador que a aprova define o perfil real.
 */
export async function POST(request: Request) {
  try {
    // Cadastro e rota publica: limita por IP antes de tocar no banco.
    enforceSignupRateLimit(sessionRequestInfo(request).ipAddress);
    const body = signupSchema.parse(await request.json());
    const username = body.username.trim().toLowerCase();
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true, email: true },
    });

    if (existing) {
      const field = existing.username === username ? "usuário" : "e-mail";
      return NextResponse.json(
        { error: `Este ${field} já está em uso.` },
        { status: 409 },
      );
    }

    const user = await prisma.user.create({
      data: {
        name: username,
        username,
        email,
        passwordHash: await hashPassword(body.password),
        role: Role.OPERADOR,
        status: UserStatus.PENDENTE,
      },
    });

    await auditLog({
      actorId: user.id,
      event: "SOLICITACAO_ACESSO",
      entity: "User",
      entityId: user.id,
      metadata: { username: user.username, email: user.email },
    });

    return ok(
      { message: "Solicitação enviada. Aguarde a aprovação de um administrador." },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
