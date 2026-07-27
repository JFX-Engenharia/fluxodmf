import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "@/lib/api";

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

export type CorporateIdentity = {
  subject: string;
  email: string;
  name: string;
  username: string;
};

export function oidcSettings() {
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    issuer,
    clientId,
    clientSecret,
    providerName: process.env.OIDC_PROVIDER_NAME?.trim() || "Conta corporativa",
    allowedDomains: (process.env.OIDC_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
  };
}

export async function oidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    next: { revalidate: 3_600 },
  });
  if (!response.ok) throw new ApiError(503, "O provedor corporativo está indisponível.");
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("authorization_endpoint" in value) ||
    typeof value.authorization_endpoint !== "string" ||
    !("token_endpoint" in value) ||
    typeof value.token_endpoint !== "string" ||
    !("jwks_uri" in value) ||
    typeof value.jwks_uri !== "string" ||
    !("issuer" in value) ||
    typeof value.issuer !== "string"
  ) {
    throw new ApiError(503, "Configuração OIDC inválida.");
  }
  return {
    authorization_endpoint: value.authorization_endpoint,
    token_endpoint: value.token_endpoint,
    jwks_uri: value.jwks_uri,
    issuer: value.issuer,
  };
}

export async function exchangeCorporateCode(input: {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}): Promise<CorporateIdentity> {
  const settings = oidcSettings();
  if (!settings) throw new ApiError(503, "Login corporativo não configurado.");
  const discovery = await oidcDiscovery(settings.issuer);
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code_verifier: input.codeVerifier,
    }),
  });
  const tokens: unknown = await tokenResponse.json();
  if (
    !tokenResponse.ok ||
    !tokens ||
    typeof tokens !== "object" ||
    !("id_token" in tokens) ||
    typeof tokens.id_token !== "string"
  ) {
    throw new ApiError(401, "O provedor corporativo recusou o login.");
  }

  const { payload } = await jwtVerify(
    tokens.id_token,
    createRemoteJWKSet(new URL(discovery.jwks_uri)),
    { issuer: discovery.issuer, audience: settings.clientId },
  );
  if (payload.nonce !== input.nonce) throw new ApiError(401, "Resposta corporativa inválida.");

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || !payload.sub) throw new ApiError(401, "A conta corporativa não informou um e-mail.");
  const domain = email.split("@")[1] ?? "";
  if (settings.allowedDomains.length && !settings.allowedDomains.includes(domain)) {
    throw new ApiError(403, "Este domínio não está autorizado.");
  }

  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : email;
  const preferred = typeof payload.preferred_username === "string" ? payload.preferred_username : email;
  return {
    subject: payload.sub,
    email,
    name,
    username: preferred.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || email,
  };
}
