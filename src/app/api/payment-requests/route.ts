import { Role, UserStatus } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { assertBodySize, MEGABYTE } from "@/lib/body-size";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertFileSignature } from "@/lib/file-signature";
import { withIdempotency } from "@/lib/idempotency";

const requestSchema = z.object({
  supplierName: z.string().trim().min(2, "Informe o fornecedor.").max(160),
  description: z.string().trim().min(5, "Descreva o pagamento.").max(2_000),
  amount: z.coerce.number().positive("Informe um valor maior que zero.").max(10_000_000),
  dueDate: z.string().date("Informe a data de vencimento."),
  category: z.string().trim().max(120).optional().default(""),
  workId: z.string().min(1, "Selecione a obra."),
});

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
/** Teto do multipart: todos os anexos no limite + folga para campos e overhead. */
const MAX_BODY_SIZE = MAX_ATTACHMENTS * MAX_ATTACHMENT_SIZE + 5 * MEGABYTE;
const allowedMimeTypes: Record<string, true> = {
  "application/pdf": true,
  "image/jpeg": true,
  "image/png": true,
};

function serializeRequest(request: {
  id: string;
  supplierName: string;
  description: string;
  amount: { toString(): string } | number;
  dueDate: Date;
  category: string;
  status: string;
  reviewReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  work: {
    id: string;
    name: string;
    approvers: Array<{ user: { id: string; name: string } }>;
  };
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number }>;
  approvals: Array<{ approvedAt: Date | null; approver: { id: string; name: string } }>;
}) {
  return {
    id: request.id,
    supplierName: request.supplierName,
    description: request.description,
    amount: Number(request.amount),
    dueDate: request.dueDate.toISOString(),
    category: request.category,
    status: request.status,
    reviewReason: request.reviewReason,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    work: {
      id: request.work.id,
      name: request.work.name,
      responsibles: request.work.approvers.map(({ user }) => user),
    },
    requestedBy: request.requestedBy,
    reviewedBy: request.reviewedBy,
    approvals: request.approvals.map((approval) => ({
      approver: approval.approver,
      approvedAt: approval.approvedAt?.toISOString() ?? null,
    })),
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/payment-requests/${request.id}/attachments/${attachment.id}`,
    })),
  };
}

const include = {
  work: {
    select: {
      id: true,
      name: true,
      approvers: { select: { user: { select: { id: true, name: true } } } },
    },
  },
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
  approvals: {
    select: {
      approvedAt: true,
      approver: { select: { id: true, name: true } },
    },
  },
} as const;

export async function GET() {
  try {
    const actor = await requireTab("solicitacoes");
    const where =
      actor.role === Role.ADMINISTRADOR
        ? {}
        : {
            OR: [
              { requestedById: actor.id },
              { approvals: { some: { approverId: actor.id } } },
            ],
          };
    const requests = await prisma.paymentRequest.findMany({
      where,
      include,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return ok({ requests: requests.map(serializeRequest) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("solicitacoes");
    await requireMutationAllowed(actor);
    // Barra o envio pelo cabecalho antes de bufferizar o multipart e antes de
    // reservar chave de idempotencia. Os limites por anexo continuam valendo.
    assertBodySize(request, MAX_BODY_SIZE);
    return await withIdempotency({
      request,
      scope: "payment-request:create",
      actorId: actor.id,
      execute: async () => {
    const formData = await request.formData();
    const body = requestSchema.parse(Object.fromEntries(formData));
    const attachments = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File);

    if (!attachments.length) {
      throw new ApiError(400, "Anexe ao menos um documento (PDF, JPG ou PNG).");
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new ApiError(400, `Anexe no máximo ${MAX_ATTACHMENTS} documentos.`);
    }
    // Object.hasOwn e nao indexacao: `allowedMimeTypes["constructor"]` acharia o
    // que veio do prototype e um Content-Type desses passaria pela allowlist.
    if (attachments.some((file) => !Object.hasOwn(allowedMimeTypes, file.type) || file.size === 0 || file.size > MAX_ATTACHMENT_SIZE)) {
      throw new ApiError(400, "Cada anexo deve ser PDF, JPG ou PNG de até 5 MB.");
    }

    const work = await prisma.work.findUnique({
      where: { id: body.workId },
      include: {
        approvers: {
          include: { user: { select: { id: true, status: true } } },
        },
      },
    });
    if (!work?.active) throw new ApiError(404, "Obra não encontrada ou inativa.");
    if (actor.role !== Role.ADMINISTRADOR && !actor.works.some(({ work: assignedWork }) => assignedWork.id === work.id)) {
      throw new ApiError(403, "Você só pode solicitar pagamentos para obras vinculadas a você.");
    }
    const activeApprovers = work.approvers.filter(({ user }) => user.status === UserStatus.ATIVO);
    if (!activeApprovers.length) {
      throw new ApiError(409, "Esta obra ainda não possui responsáveis ativos para aprovar a solicitação.");
    }

    // O tipo declarado no upload nao vale como prova: confere-se a assinatura do
    // conteudo antes de gravar, e persiste-se o tipo detectado. O buffer e lido
    // uma unica vez e serve tanto para a checagem quanto para a gravacao.
    const attachmentData = await Promise.all(
      attachments.map(async (file) => {
        const data = Buffer.from(await file.arrayBuffer());
        return {
          fileName: file.name.slice(0, 255),
          mimeType: assertFileSignature(data, file.type, file.name),
          size: file.size,
          data,
        };
      }),
    );
    const saved = await prisma.paymentRequest.create({
      data: {
        supplierName: body.supplierName,
        description: body.description,
        amount: body.amount,
        dueDate: new Date(`${body.dueDate}T00:00:00.000Z`),
        category: body.category,
        workId: work.id,
        requestedById: actor.id,
        attachments: { create: attachmentData },
        approvals: {
          create: activeApprovers.map(({ userId }) => ({ approverId: userId })),
        },
      },
      include,
    });

    await auditLog({
      actorId: actor.id,
      event: "SOLICITACAO_PAGAMENTO_CRIADA",
      entity: "PaymentRequest",
      entityId: saved.id,
      metadata: { obra: work.name, fornecedor: saved.supplierName, valor: Number(saved.amount), anexos: attachments.length },
    });
    return ok({ request: serializeRequest(saved) }, 201);
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
