import { ok } from "@/lib/api";
import { oidcSettings } from "@/lib/oidc";

export async function GET() {
  const settings = oidcSettings();
  return ok({ enabled: !!settings, providerName: settings?.providerName ?? null });
}
