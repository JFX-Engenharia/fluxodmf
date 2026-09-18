import { z } from "zod";
import { handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { assertBodySize } from "@/lib/body-size";
import { withIdempotency } from "@/lib/idempotency";
import { applyRequestAction, requestNoteSchema, RESPOND_REQUEST_BODY_SIZE, validateRequestAttachments } from "@/lib/payment-requests";

const schema = z.object({ note: requestNoteSchema.min(1, "Escreva sua resposta.") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTab("solicitacoes");
    await requireMutationAllowed(actor);
    assertBodySize(request, RESPOND_REQUEST_BODY_SIZE);
    const { id } = await context.params;
    return await withIdempotency({ request, scope: `payment-request:respond:${id}`, actorId: actor.id, execute: async () => {
      const form = await request.formData();
      const { note } = schema.parse(Object.fromEntries(form));
      const attachments = await validateRequestAttachments(form.getAll("attachments").filter((file): file is File => file instanceof File), true);
      return ok(await applyRequestAction(actor, id, "respond", note, attachments));
    } });
  } catch (error) { return handleApiError(error); }
}
