import { Role } from "@prisma-generated/enums";
import { NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const actor = await requireUser();
    const { id, attachmentId } = await context.params;
    const attachment = await prisma.paymentRequestAttachment.findFirst({
      where: { id: attachmentId, requestId: id },
      include: { request: { select: { requestedById: true, work: { select: { responsibleUserId: true } } } } },
    });
    if (!attachment) throw new ApiError(404, "Anexo não encontrado.");

    const canRead =
      actor.role === Role.ADMINISTRADOR ||
      attachment.request.requestedById === actor.id ||
      attachment.request.work.responsibleUserId === actor.id;
    if (!canRead) throw new ApiError(403, "Você não pode acessar este anexo.");

    return new NextResponse(new Uint8Array(attachment.data), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.size),
        "Content-Disposition": contentDisposition(attachment.fileName),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
