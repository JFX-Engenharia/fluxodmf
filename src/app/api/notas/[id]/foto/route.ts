import { NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { contentDisposition } from "@/lib/content-disposition";
import { prisma } from "@/lib/db";
import { canAccessTab } from "@/lib/permissions";

/**
 * Bytes da foto — a UNICA rota que seleciona `ReceiptNote.data`. Espelha a rota
 * de anexos de solicitacao: uma nota por requisicao, com authz propria.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser();
    const { id } = await context.params;

    const note = await prisma.receiptNote.findUnique({
      where: { id },
      select: { userId: true, fileName: true, mimeType: true, size: true, data: true },
    });
    if (!note) throw new ApiError(404, "Nota não encontrada.");

    // O dono ve a propria nota; a gestao ve todas, pela mesma permissao da aba
    // de historico. Colaborador nao enxerga nota de colega.
    const canRead = note.userId === actor.id || canAccessTab(actor.role, "notas-colaboradores");
    if (!canRead) throw new ApiError(403, "Você não pode acessar esta nota.");

    return new NextResponse(new Uint8Array(note.data), {
      headers: {
        "Content-Type": note.mimeType,
        "Content-Length": String(note.size),
        "Content-Disposition": contentDisposition(note.fileName),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
