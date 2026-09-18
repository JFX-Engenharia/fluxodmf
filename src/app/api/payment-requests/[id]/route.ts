import { z } from "zod";
import { handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { assertBodySize } from "@/lib/body-size";
import { applyRequestAction, requestNoteSchema } from "@/lib/payment-requests";

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "request_info", "cancel"]),
  reason: requestNoteSchema.optional().default(""),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTab("solicitacoes");
    await requireMutationAllowed(actor);
    assertBodySize(request, 16 * 1024);
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    return ok(await applyRequestAction(actor, id, body.action, body.reason));
  } catch (error) { return handleApiError(error); }
}
