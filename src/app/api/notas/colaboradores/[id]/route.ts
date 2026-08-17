import { Role } from "@prisma-generated/enums";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listReceiptNotes, noteListQuerySchema } from "@/lib/receipt-notes";

/**
 * Historico de um colaborador, para a gestao.
 *
 * Nao e filtro por perfil: se a pessoa mudar de papel, as notas que ela enviou
 * continuam consultaveis — isso e decisao explicita do plano. O que a regra
 * abaixo impede e outra coisa: esta aba e liberada de GESTOR para cima, mas a
 * ficha de usuario (username, situacao) e area de ADMINISTRADOR. Sem a trava,
 * qualquer id colhido em outra rota — os responsibleUsers de /api/admin/works,
 * por exemplo — viraria consulta de cadastro alheio por aqui.
 *
 * Passa quem e COLABORADOR ou quem ja enviou ao menos uma nota; quem nunca
 * mandou nota e nao e colaborador responde 404, indistinguivel de id inexistente.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTab("notas-colaboradores");
    const { id } = await context.params;
    const query = noteListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    const collaborator = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        status: true,
        role: true,
        _count: { select: { receiptNotes: true } },
      },
    });

    const hasHistory =
      collaborator?.role === Role.COLABORADOR || (collaborator?._count.receiptNotes ?? 0) > 0;
    if (!collaborator || !hasHistory) throw new ApiError(404, "Colaborador não encontrado.");

    return ok({
      // `role` fica fora: a tela nao mostra o perfil, e devolve-lo entregaria a
      // gestao um jeito de descobrir quem e administrador.
      collaborator: {
        id: collaborator.id,
        name: collaborator.name,
        username: collaborator.username,
        status: collaborator.status,
      },
      ...(await listReceiptNotes({ userId: collaborator.id, ...query })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
