import webpush from "web-push";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";

export type PushMessage = { title: string; body: string; url: string; tag: string };
type PushConfig = { subject: string; publicKey: string; privateKey: string };
type Transport = typeof webpush.sendNotification;
const MAX_SUBSCRIPTIONS = 10;

export function getPushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    // A biblioteca valida as chaves e o contato antes de oferecermos a inscrição.
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

function isPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    // O endpoint vem do cliente, mas o servidor fará uma chamada para ele.
    // Aceitar só serviços de push evita transformar esta API em acesso à rede interna.
    const hosts = ["fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
const key = (bytes: number) => z.string().max(200).regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(value => Buffer.from(value, "base64url").length === bytes, "Chave de inscrição inválida.");
export const pushEndpointSchema = z.string().max(4096).url().refine(isPushEndpoint, "Serviço de push não suportado.");
export const pushSubscriptionSchema = z.object({ endpoint: pushEndpointSchema, keys: z.object({ p256dh: key(65), auth: key(16) }) });

export async function savePushSubscription(userId: string, input: z.input<typeof pushSubscriptionSchema>, userAgent: string | null = null) {
  const subscription = pushSubscriptionSchema.parse(input);
  return prisma.$transaction(async tx => {
    // Serializa o limite por usuário mesmo com vários aparelhos se inscrevendo juntos.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint: subscription.endpoint } });
    if (existing?.userId !== userId && await tx.pushSubscription.count({ where: { userId } }) >= MAX_SUBSCRIPTIONS) {
      throw new ApiError(409, "Você já tem avisos em 10 aparelhos. Desative em um deles antes de ativar outro.");
    }
    const data = { userId, ...subscription.keys, userAgent: userAgent?.slice(0, 1000) ?? null };
    return tx.pushSubscription.upsert({ where: { endpoint: subscription.endpoint },
      create: { ...data, endpoint: subscription.endpoint },
      update: { ...data, ...(existing?.userId !== userId ? { lastSuccessAt: null, createdAt: new Date() } : {}) },
    });
  });
}

export async function removePushSubscription(userId: string, endpoint: string) {
  return prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Executada após o commit. Falhas do serviço de push nunca revertem a compra. */
export async function sendPushToUsers(userIds: string[], message: PushMessage, options: { transport?: Transport; config?: PushConfig | null } = {}): Promise<void> {
  try {
    const config = options.config === undefined ? getPushConfig() : options.config;
    if (!config || !userIds.length) return;
    const transport = options.transport ?? webpush.sendNotification.bind(webpush);
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] }, user: { status: "ATIVO", role: { not: "COLABORADOR" } } } });
    const results = await Promise.allSettled(subscriptions.map(async subscription => {
      const current = { id: subscription.id, userId: subscription.userId, p256dh: subscription.p256dh, auth: subscription.auth };
      try {
        await transport({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(message), { vapidDetails: config, TTL: 3600, timeout: 5000 });
        await prisma.pushSubscription.updateMany({ where: current, data: { lastSuccessAt: new Date() } });
      } catch (error) {
        const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) await prisma.pushSubscription.deleteMany({ where: current });
        else console.error("Falha ao enviar aviso push.", { statusCode: typeof statusCode === "number" ? statusCode : "indisponível" });
      }
    }));
    if (results.some(result => result.status === "rejected")) console.error("Falha ao atualizar inscrições push após o envio.");
  } catch { console.error("Não foi possível processar os avisos push."); }
}
