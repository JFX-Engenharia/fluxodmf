import { z } from "zod";
import { Role, UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { hashPassword, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(2, "Informe o nome."),
  username: z
    .string()
    .min(3, "O usuário precisa de ao menos 3 caracteres.")
    .regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou underline."),
  email: z.email("E-mail inválido."),
  password: z.string().min(4, "A senha precisa de ao menos 4 caracteres."),
  role: z.enum(Role),
  phone: z.string().optional(),
  workIds: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).optional(),
  email: z.email().optional(),
  password: z.string().min(4).optional(),
  role: z.enum(Role).optional(),
  status: z.enum(UserStatus).optional(),
  phone: z.string().optional(),
  workIds: z.array(z.string()).optional(),
});

const deleteSchema = z.object({ id: z.string().min(1) });

type UserWithWorks = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  phone: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  works?: { work: { id: string; name: string } }[];
  reviewedBy?: { name: string } | null;
};

function serializeUser(user: UserWithWorks) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone,
    reviewedAt: user.reviewedAt?.toISOString() ?? null,
    reviewedBy: user.reviewedBy?.name ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    works: user.works?.map(({ work }) => ({ id: work.id, name: work.name })) ?? [],
  };
}

const include = {
  works: { include: { work: true } },
  reviewedBy: { select: { name: true } },
} as const;

export async function GET() {
  try {
    await requireTab("usuarios");

    const [users, works] = await Promise.all([
      prisma.user.findMany({
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include,
      }),
      prisma.work.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ]);

    return ok({
      users: users.map((user) => serializeUser(user as UserWithWorks)),
      works: works.map((work) => ({ id: work.id, name: work.name })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("usuarios");
    const body = createSchema.parse(await request.json());
    const username = body.username.trim().toLowerCase();
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true },
    });

    if (existing) {
      throw new ApiError(
        409,
        existing.username === username
          ? "Este usuário já está em uso."
          : "Este e-mail já está em uso.",
      );
    }

    // Criado pelo administrador já nasce ATIVO: não há o que aprovar.
    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        username,
        email,
        phone: body.phone?.trim() || null,
        role: body.role,
        status: UserStatus.ATIVO,
        passwordHash: await hashPassword(body.password),
        reviewedById: actor.id,
        reviewedAt: new Date(),
        works: { create: body.workIds.map((workId) => ({ workId })) },
      },
      include,
    });

    await auditLog({
      actorId: actor.id,
      event: "USUARIO_CRIADO",
      entity: "User",
      entityId: user.id,
      metadata: { username: user.username, role: user.role },
    });

    return ok({ user: serializeUser(user as UserWithWorks) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireTab("usuarios");
    const body = updateSchema.parse(await request.json());

    const current = await prisma.user.findUnique({ where: { id: body.id } });
    if (!current) throw new ApiError(404, "Usuário não encontrado.");

    // Sem esta trava, o último administrador poderia se rebaixar ou se desativar
    // e deixar o sistema sem ninguém capaz de gerenciar usuários.
    const losingAdmin =
      current.role === Role.ADMINISTRADOR &&
      current.status === UserStatus.ATIVO &&
      ((body.role !== undefined && body.role !== Role.ADMINISTRADOR) ||
        (body.status !== undefined && body.status !== UserStatus.ATIVO));

    if (losingAdmin) {
      const remaining = await prisma.user.count({
        where: {
          role: Role.ADMINISTRADOR,
          status: UserStatus.ATIVO,
          id: { not: current.id },
        },
      });

      if (remaining === 0) {
        throw new ApiError(
          400,
          "Este é o único administrador ativo. Promova outro antes de alterar este.",
        );
      }
    }

    if (body.email) {
      const taken = await prisma.user.findFirst({
        where: { email: body.email.trim().toLowerCase(), id: { not: body.id } },
        select: { id: true },
      });
      if (taken) throw new ApiError(409, "Este e-mail já está em uso.");
    }

    const reviewed = body.status !== undefined && body.status !== current.status;

    const user = await prisma.user.update({
      where: { id: body.id },
      data: {
        name: body.name?.trim(),
        email: body.email?.trim().toLowerCase(),
        phone: body.phone === undefined ? undefined : body.phone.trim() || null,
        role: body.role,
        status: body.status,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
        reviewedById: reviewed ? actor.id : undefined,
        reviewedAt: reviewed ? new Date() : undefined,
        works: body.workIds
          ? {
              deleteMany: {},
              create: body.workIds.map((workId) => ({ workId })),
            }
          : undefined,
      },
      include,
    });

    // Registra so o que mudou, para a auditoria responder "o que foi alterado".
    const changes: Record<string, { de: unknown; para: unknown }> = {};
    if (body.role && body.role !== current.role) {
      changes.perfil = { de: current.role, para: body.role };
    }
    if (body.status && body.status !== current.status) {
      changes.status = { de: current.status, para: body.status };
    }
    if (body.name && body.name.trim() !== current.name) {
      changes.nome = { de: current.name, para: body.name.trim() };
    }
    if (body.email && body.email.trim().toLowerCase() !== current.email) {
      changes.email = { de: current.email, para: body.email.trim().toLowerCase() };
    }
    if (body.phone !== undefined && (body.phone.trim() || null) !== current.phone) {
      changes.telefone = { de: current.phone ?? "-", para: body.phone.trim() || "-" };
    }
    if (body.password) changes.senha = { de: "***", para: "redefinida" };
    if (body.workIds) changes.obras = { de: "-", para: body.workIds.length };

    await auditLog({
      actorId: actor.id,
      event:
        reviewed && body.status === UserStatus.ATIVO
          ? "ACESSO_APROVADO"
          : reviewed && body.status === UserStatus.RECUSADO
            ? "ACESSO_RECUSADO"
            : "USUARIO_ATUALIZADO",
      entity: "User",
      entityId: user.id,
      metadata: { username: user.username, changes },
    });

    return ok({ user: serializeUser(user as UserWithWorks) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireTab("usuarios");
    const body = deleteSchema.parse(await request.json());

    if (body.id === actor.id) {
      throw new ApiError(400, "Você não pode excluir a própria conta.");
    }

    const target = await prisma.user.findUnique({ where: { id: body.id } });
    if (!target) throw new ApiError(404, "Usuário não encontrado.");

    if (target.role === Role.ADMINISTRADOR && target.status === UserStatus.ATIVO) {
      const remaining = await prisma.user.count({
        where: {
          role: Role.ADMINISTRADOR,
          status: UserStatus.ATIVO,
          id: { not: target.id },
        },
      });
      if (remaining === 0) {
        throw new ApiError(400, "Este é o único administrador ativo e não pode ser excluído.");
      }
    }

    // Quem ja importou ou agiu sobre pagamentos nao pode sumir sem quebrar o
    // historico; nesse caso a conta e desativada em vez de removida.
    const [payments, actions, imports, flowEvents, requestedPayments, reviewedRequests] = await Promise.all([
      prisma.payment.count({ where: { createdById: target.id } }),
      prisma.paymentAction.count({ where: { actorId: target.id } }),
      prisma.importBatch.count({ where: { importedById: target.id } }),
      prisma.dailyFlowEvent.count({ where: { actorId: target.id } }),
      prisma.paymentRequest.count({ where: { requestedById: target.id } }),
      prisma.paymentRequest.count({ where: { reviewedById: target.id } }),
    ]);

    if (payments + actions + imports + flowEvents + requestedPayments + reviewedRequests > 0) {
      const user = await prisma.user.update({
        where: { id: target.id },
        data: { status: UserStatus.INATIVO, reviewedById: actor.id, reviewedAt: new Date() },
        include,
      });

      await auditLog({
        actorId: actor.id,
        event: "USUARIO_DESATIVADO",
        entity: "User",
        entityId: target.id,
        metadata: {
          username: target.username,
          motivo: "Possui histórico vinculado (pagamentos, solicitações, ações, importações ou fluxos)",
        },
      });

      return ok({
        user: serializeUser(user as UserWithWorks),
        deactivated: true,
        message: "Usuário tem histórico no sistema, então foi desativado em vez de excluído.",
      });
    }

    await prisma.user.delete({ where: { id: target.id } });

    await auditLog({
      actorId: actor.id,
      event: "USUARIO_EXCLUIDO",
      entity: "User",
      entityId: target.id,
      metadata: { username: target.username, role: target.role },
    });

    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
