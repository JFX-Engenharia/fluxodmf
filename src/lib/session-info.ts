import { prisma } from "@/lib/db";

export type SessionRequestInfo = {
  ipAddress: string | null;
  userAgent: string | null;
  device: string;
};

export function normalizeIpAddress(value: string | null | undefined) {
  const address = value?.trim();
  if (!address) return null;
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return "127.0.0.1";
  if (address.toLowerCase().startsWith("::ffff:")) return address.slice(7);
  return address;
}

/**
 * Resolve o IP do cliente na ordem em que se pode confiar no cabecalho.
 *
 * CF-Connecting-IP e X-Real-IP sao reescritos pelo proxy da borda
 * (Cloudflare/Render) a cada requisicao, entao o cliente nao consegue forja-los.
 * Ja o X-Forwarded-For e uma lista acumulativa: o cliente pode mandar entradas
 * falsas, e cada proxy apenas acrescenta a sua a direita. Por isso lemos o
 * elemento MAIS A DIREITA, o unico escrito pelo proxy mais proximo da aplicacao.
 *
 * Tudo isso pressupoe um proxy confiavel na frente da aplicacao: exposta
 * diretamente a internet, qualquer um destes cabecalhos e forjavel.
 */
export function requestIpAddress(request: Request) {
  const fromEdge =
    normalizeIpAddress(request.headers.get("cf-connecting-ip")) ??
    normalizeIpAddress(request.headers.get("x-real-ip"));
  if (fromEdge) return fromEdge;

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  for (let index = forwardedFor.length - 1; index >= 0; index -= 1) {
    const candidate = normalizeIpAddress(forwardedFor[index]);
    if (candidate) return candidate;
  }

  return null;
}

export function sessionRequestInfo(request: Request): SessionRequestInfo {
  const ipAddress = requestIpAddress(request);
  const userAgent = request.headers.get("user-agent");
  const source = userAgent ?? "";

  let browser = "Navegador desconhecido";
  if (/Edg\//i.test(source)) browser = "Microsoft Edge";
  else if (/Chrome\//i.test(source)) browser = "Google Chrome";
  else if (/Firefox\//i.test(source)) browser = "Mozilla Firefox";
  else if (/Safari\//i.test(source)) browser = "Safari";

  let operatingSystem = "sistema desconhecido";
  if (/Windows/i.test(source)) operatingSystem = "Windows";
  else if (/Android/i.test(source)) operatingSystem = "Android";
  else if (/iPhone|iPad/i.test(source)) operatingSystem = "iOS/iPadOS";
  else if (/Mac OS X/i.test(source)) operatingSystem = "macOS";
  else if (/Linux/i.test(source)) operatingSystem = "Linux";

  return { ipAddress, userAgent, device: `${browser} em ${operatingSystem}` };
}

export async function recordLoginEvent(
  request: Request,
  input: {
    userId?: string;
    identifier: string;
    provider: string;
    success: boolean;
    reason?: string;
  },
) {
  const info = sessionRequestInfo(request);
  await prisma.loginEvent.create({
    data: {
      ...input,
      ipAddress: info.ipAddress,
      userAgent: info.userAgent,
      device: info.device,
    },
  });
  return info;
}
