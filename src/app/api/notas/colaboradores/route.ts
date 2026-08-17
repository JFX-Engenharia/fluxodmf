import { Role } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { REMOVED_USER_SENTINEL } from "@/lib/permissions";

/**
 * Lista de colaboradores para a gestao, com total de notas e data da ultima.
 * Inclui INATIVO e PENDENTE de proposito — o historico de quem foi desativado
 * continua importando, e o status vai junto para a tela mostrar a situacao.
 */
export async function GET() {
  try {
    await requireTab("notas-colaboradores");

    const collaborators = await prisma.user.findMany({
      where: { role: Role.COLABORADOR, username: { not: REMOVED_USER_SENTINEL } },
      select: { id: true, name: true, username: true, status: true, createdAt: true },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    if (!collaborators.length) return ok({ collaborators: [] });

    // Uma agregacao para todos, em vez de uma consulta por colaborador.
    const stats = await prisma.receiptNote.groupBy({
      by: ["userId"],
      where: { userId: { in: collaborators.map(({ id }) => id) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const byUser = new Map(stats.map((row) => [row.userId, row]));

    return ok({
      collaborators: collaborators.map((collaborator) => {
        const summary = byUser.get(collaborator.id);
        return {
          id: collaborator.id,
          name: collaborator.name,
          username: collaborator.username,
          status: collaborator.status,
          createdAt: collaborator.createdAt.toISOString(),
          totalNotes: summary?._count._all ?? 0,
          lastNoteAt: summary?._max.createdAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
