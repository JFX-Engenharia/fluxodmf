import { Role, UserStatus } from "@prisma-generated/enums";
import { handleApiError, ok } from "@/lib/api";
import { assertBodySize } from "@/lib/body-size";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";
import { CREATE_REQUEST_BODY_SIZE, createPaymentRequest, getRequestSettings, paymentRequestSchema, requestInclude, serializeRequest, validateRequestAttachments } from "@/lib/payment-requests";

export async function GET(request: Request) {
  try {
    const actor = await requireTab("solicitacoes");
    if (new URL(request.url).searchParams.get("summary") === "1") {
      const pendingCount = await prisma.paymentRequest.count({ where: { OR: [
        { status: "INFO_SOLICITADA", requestedById: actor.id },
        { status: "PENDENTE", OR: [
          ...(actor.role === Role.ADMINISTRADOR ? [{ requiresOwnerApproval: false }] : []),
          { approvals: { some: { approverId: actor.id, approvedAt: null, approver: { status: UserStatus.ATIVO, role: { not: Role.COLABORADOR } } } } },
        ] },
      ] } });
      return ok({ pendingCount });
    }
    const [requests, settings] = await Promise.all([
      prisma.paymentRequest.findMany({
        where: actor.role === Role.ADMINISTRADOR ? {} : { OR: [
          { requestedById: actor.id }, { approvals: { some: { approverId: actor.id } } },
        ] },
        include: requestInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      }),
      getRequestSettings(),
    ]);
    return ok({ requests: requests.map(row => serializeRequest(row, actor)), settings: {
      threshold: settings.threshold,
      approvers: settings.approvers.filter(a => a.status === UserStatus.ATIVO && a.role !== Role.COLABORADOR).map(({ id, name }) => ({ id, name })),
    } });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("solicitacoes");
    await requireMutationAllowed(actor);
    assertBodySize(request, CREATE_REQUEST_BODY_SIZE);
    return await withIdempotency({ request, scope: "payment-request:create", actorId: actor.id, execute: async () => {
      const form = await request.formData();
      const body = paymentRequestSchema.parse(Object.fromEntries(form));
      const attachments = await validateRequestAttachments(form.getAll("attachments").filter((file): file is File => file instanceof File));
      const saved = await createPaymentRequest(actor, body, attachments);
      return ok({ request: serializeRequest(saved, actor) }, 201);
    } });
  } catch (error) { return handleApiError(error); }
}
