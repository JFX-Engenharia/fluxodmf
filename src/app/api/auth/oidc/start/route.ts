import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { oidcDiscovery, oidcSettings } from "@/lib/oidc";

export async function GET(request: NextRequest) {
  try {
    const settings = oidcSettings();
    if (!settings) return NextResponse.redirect(new URL("/login?corporate=disabled", request.url));

    const discovery = await oidcDiscovery(settings.issuer);
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = process.env.OIDC_REDIRECT_URI || new URL("/api/auth/oidc/callback", request.url).toString();
    const authorization = new URL(discovery.authorization_endpoint);
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const response = NextResponse.redirect(authorization);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/api/auth/oidc",
    };
    response.cookies.set("fluxo_oidc_state", state, cookieOptions);
    response.cookies.set("fluxo_oidc_nonce", nonce, cookieOptions);
    response.cookies.set("fluxo_oidc_verifier", verifier, cookieOptions);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
