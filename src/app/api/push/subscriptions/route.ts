import { z } from "zod";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireUser } from "@/lib/auth";
import { assertBodySize } from "@/lib/body-size";
import { prisma } from "@/lib/db";
import { getPushConfig, pushEndpointSchema, pushSubscriptionSchema, removePushSubscription, savePushSubscription } from "@/lib/push";

export async function GET() {
  try {
    const actor = await requireUser();
    const config = getPushConfig();
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: actor.id }, select: { endpoint: true } });
    return ok({ enabled: !!config, publicKey: config?.publicKey ?? null, endpoints: subscriptions.map(s => s.endpoint) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser();
    await requireMutationAllowed(actor);
    assertBodySize(request, 16 * 1024);
    if (!getPushConfig()) throw new ApiError(409, "Os avisos push ainda não foram configurados neste ambiente.");
    const body = pushSubscriptionSchema.parse(await request.json());
    await savePushSubscription(actor.id, body, request.headers.get("user-agent"));
    return ok({ subscribed: true });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireUser();
    await requireMutationAllowed(actor);
    assertBodySize(request, 16 * 1024);
    const { endpoint } = z.object({ endpoint: pushEndpointSchema }).parse(await request.json());
    await removePushSubscription(actor.id, endpoint);
    return ok({ subscribed: false });
  } catch (error) { return handleApiError(error); }
}
