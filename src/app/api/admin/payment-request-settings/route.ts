import { handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { assertBodySize } from "@/lib/body-size";
import { getRequestSettings, requestSettingsSchema, saveRequestSettings } from "@/lib/payment-requests";

export async function GET() {
  try {
    await requireTab("permissoes");
    return ok({ settings: await getRequestSettings() });
  } catch (error) { return handleApiError(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireTab("permissoes");
    await requireMutationAllowed(actor);
    assertBodySize(request, 32 * 1024);
    const body = requestSettingsSchema.parse(await request.json());
    return ok({ settings: await saveRequestSettings(actor, body.threshold, body.approverIds) });
  } catch (error) { return handleApiError(error); }
}
