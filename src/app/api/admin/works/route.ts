import { z } from "zod";
import { Role, UserStatus } from "@prisma-generated/enums";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab, requireUser } from "@/lib/auth";
import { uniqueSlug } from "@/lib/cost-center";
import { prisma } from "@/lib/db";

const workSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  aliases: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  responsibleUserId: z.string().nullable().optional(),
});

type WorkRecord = {
  id: string;
  name: string;
  slug: string;
  costCenterAliases: string;
  active: boolean;
  createdAt: Date;
  responsibleUserId: string | null;
  responsibleUser?: { id: string; name: string } | null;
  updatedAt: Date;
};

function serializeWork(work: WorkRecord) {
  return {
    ...work,
    responsibleUser: work.responsibleUser
      ? { id: work.responsibleUser.id, name: work.responsibleUser.name }
      : null,
    aliases: JSON.parse(work.costCenterAliases || "[]"),
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  };
}

async function assertResponsibleUser(id: string | null | undefined) {
  if (!id) return;
  const user = await prisma.user.findFirst({
    where: {
      id,
      status: UserStatus.ATIVO,
      role: { in: [Role.GESTOR, Role.ADMINISTRADOR] },
    },
    select: { id: true },
  });
  if (!user) {
    throw new ApiError(400, "O responsável precisa ser um gestor ou administrador ativo.");
  }
}

export async function GET() {
  try {
    await requireUser();
    const works = await prisma.work.findMany({
      orderBy: { name: "asc" },
      include: { responsibleUser: { select: { id: true, name: true } } },
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

    await assertResponsibleUser(body.responsibleUserId);
    const existingSlugs = new Set(
      (await prisma.work.findMany({ select: { slug: true } })).map((work) => work.slug),
    );
    const work = await prisma.work.create({
      data: {
        name: body.name,
        slug: body.slug?.trim() || uniqueSlug(body.name, existingSlugs),
        costCenterAliases: JSON.stringify(body.aliases),
        active: body.active ?? true,
        responsibleUserId: body.responsibleUserId ?? null,
      },
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

    await assertResponsibleUser(body.responsibleUserId);
    const work = await prisma.work.update({
      where: { id: body.id },
      data: {
        name: body.name,
        slug: body.slug,
        costCenterAliases: JSON.stringify(body.aliases),
        active: body.active ?? true,
        responsibleUserId: body.responsibleUserId ?? null,
      },
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
