import { z } from "zod";
import { Role, UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { UNDEFINED_WORK_SLUG, uniqueSlug } from "@/lib/cost-center";
import { prisma } from "@/lib/db";

const workSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  aliases: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  responsibleUserIds: z.array(z.string()).default([]),
});

type WorkRecord = {
  id: string;
  name: string;
  slug: string;
  costCenterAliases: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  approvers?: Array<{ user: { id: string; name: string } }>;
};

function serializeWork(work: WorkRecord) {
  const { approvers = [], ...record } = work;
  return {
    ...record,
    responsibleUsers: approvers.map(({ user }) => user),
    aliases: JSON.parse(work.costCenterAliases || "[]"),
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  };
}

async function assertResponsibleUsers(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return uniqueIds;
  const users = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      status: UserStatus.ATIVO,
      role: { in: [Role.GESTOR, Role.ADMINISTRADOR] },
    },
    select: { id: true },
  });
  if (users.length !== uniqueIds.length) {
    throw new ApiError(400, "Todos os responsáveis precisam ser gestores ou administradores ativos.");
  }
  return uniqueIds;
}

export async function GET() {
  try {
    // Lista as obras para os formularios de solicitacao do painel.
    await requireTab("solicitacoes");
    const works = await prisma.work.findMany({
      orderBy: { name: "asc" },
      include: { approvers: { include: { user: { select: { id: true, name: true } } } } },
    });
    return ok({ works: works.map(serializeWork) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("permissoes");
    const body = workSchema.parse(await request.json());
    const responsibleUserIds = await assertResponsibleUsers(body.responsibleUserIds);
    const existingSlugs = new Set(
      (await prisma.work.findMany({ select: { slug: true } })).map((work) => work.slug),
    );
    const work = await prisma.$transaction(async (tx) => {
      const created = await tx.work.create({
        data: {
          name: body.name,
          slug: body.slug?.trim() || uniqueSlug(body.name, existingSlugs),
          costCenterAliases: JSON.stringify(body.aliases),
          active: body.active ?? true,
        },
      });
      if (responsibleUserIds.length) {
        await tx.workApprover.createMany({
          data: responsibleUserIds.map((userId) => ({ workId: created.id, userId })),
        });
      }
      return tx.work.findUniqueOrThrow({
        where: { id: created.id },
        include: { approvers: { include: { user: { select: { id: true, name: true } } } } },
      });
    });

    await auditLog({
      actorId: actor.id,
      event: "CONTA_CRIADA",
      entity: "Work",
      entityId: work.id,
    });

    return ok({ work: serializeWork(work) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireTab("permissoes");
    const body = workSchema.extend({ id: z.string() }).parse(await request.json());
    const responsibleUserIds = await assertResponsibleUsers(body.responsibleUserIds);
    const work = await prisma.$transaction(async (tx) => {
      const existing = await tx.work.findUniqueOrThrow({ where: { id: body.id } });
      if (
        existing.slug === UNDEFINED_WORK_SLUG &&
        !existing.active &&
        body.active === true
      ) {
        throw new ApiError(400, "A conta INDEFINIDO nao pode ser reativada.");
      }
      await tx.work.update({
        where: { id: body.id },
        data: {
          name: body.name,
          slug: body.slug,
          costCenterAliases: JSON.stringify(body.aliases),
          active: body.active ?? existing.active,
        },
      });
      await tx.workApprover.deleteMany({ where: { workId: body.id } });
      if (responsibleUserIds.length) {
        await tx.workApprover.createMany({
          data: responsibleUserIds.map((userId) => ({ workId: body.id, userId })),
        });
      }
      return tx.work.findUniqueOrThrow({
        where: { id: body.id },
        include: { approvers: { include: { user: { select: { id: true, name: true } } } } },
      });
    });

    await auditLog({
      actorId: actor.id,
      event: "CONTA_ATUALIZADA",
      entity: "Work",
      entityId: work.id,
    });

    return ok({ work: serializeWork(work) });
  } catch (error) {
    return handleApiError(error);
  }
}
