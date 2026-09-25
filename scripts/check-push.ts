import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { isolatedDatabase } from "./isolated-database";
import { checkPushServiceWorker } from "./check-push-service-worker";

async function main() {
  await checkPushServiceWorker();
  const cleanup = await isolatedDatabase();
  const { prisma } = await import("../src/lib/db");
  try {
    const { savePushSubscription, removePushSubscription, sendPushToUsers, getPushConfig, pushSubscriptionSchema } = await import("../src/lib/push");
    const { ApiError } = await import("../src/lib/api");
    const [first, second, inactive, limited] = await Promise.all(["first", "second", "inactive", "limited"].map(name => prisma.user.create({ data: {
      name, username: name, email: `${name}@local.test`, role: "APROVADOR", status: name === "inactive" ? "INATIVO" : "ATIVO",
    } })));
    const keys = { p256dh: webpush.generateVAPIDKeys().publicKey, auth: randomBytes(16).toString("base64url") };
    const subscription = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/test-${id}`, keys });
    const config = { ...webpush.generateVAPIDKeys(), subject: "mailto:test@local.test" };
    const message = { title: "Compra aguardando sua aprovação", body: "Obra de teste — R$ 8.000,00", url: "/painel?tab=solicitacoes&request=test", tag: "request-test" };
    let sends = 0;
    const success: typeof webpush.sendNotification = async (_subscription, payload) => { sends++; assert.deepEqual(JSON.parse(String(payload)), message); return { statusCode: 201, headers: {}, body: "" }; };

    assert.equal(pushSubscriptionSchema.safeParse({ ...subscription("bad"), endpoint: "https://127.0.0.1/internal" }).success, false);
    assert.equal(pushSubscriptionSchema.safeParse({ ...subscription("bad"), endpoint: "https://fcm.googleapis.com.attacker.test/" }).success, false);
    const original = await savePushSubscription(first.id, subscription("shared"));
    const repeat = await savePushSubscription(first.id, subscription("shared"));
    assert.equal(original.id, repeat.id);
    await savePushSubscription(second.id, subscription("shared"));
    assert.equal(await prisma.pushSubscription.count({ where: { userId: first.id } }), 0);
    await removePushSubscription(first.id, subscription("shared").endpoint);
    assert.equal(await prisma.pushSubscription.count({ where: { userId: second.id } }), 1, "outra conta não pode apagar a inscrição");
    await savePushSubscription(inactive.id, subscription("inactive"));

    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
    assert.equal(getPushConfig(), null);
    await sendPushToUsers([second.id], message, { transport: success });
    assert.equal(sends, 0, "sem VAPID o transporte não é chamado");
    await sendPushToUsers([first.id, second.id, second.id, inactive.id], message, { config, transport: success });
    assert.equal(sends, 1, "só o dono atual e ativo recebe, sem duplicar IDs");
    assert.ok((await prisma.pushSubscription.findUniqueOrThrow({ where: { id: original.id } })).lastSuccessAt);

    for (const statusCode of [404, 410]) {
      await savePushSubscription(second.id, subscription(`expired-${statusCode}`));
      await sendPushToUsers([second.id], message, { config, transport: async () => { throw Object.assign(new Error("Expired"), { statusCode }); } });
      assert.equal(await prisma.pushSubscription.count({ where: { userId: second.id } }), 0);
    }
    await savePushSubscription(second.id, subscription("failed"));
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args) => { errors.push(args); };
    try {
      await assert.doesNotReject(sendPushToUsers([second.id], message, { config, transport: async () => { throw new Error("offline"); } }));
      assert.equal(errors.length, 1);
      assert.equal(await prisma.pushSubscription.count({ where: { userId: second.id } }), 1, "falha temporária conserva inscrição");
    } finally { console.error = log; }
    // Dez aparelhos já gravados e duas inscrições simultâneas disputam a última vaga.
    for (let index = 0; index < 9; index++) await savePushSubscription(limited.id, subscription(`limited-${index}`));
    const race = await Promise.allSettled([savePushSubscription(limited.id, subscription("limit-a")), savePushSubscription(limited.id, subscription("limit-b"))]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    const rejected = race.find(r => r.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ApiError && rejected.reason.status === 409);
    await savePushSubscription(limited.id, subscription("limited-0"));
    assert.equal(await prisma.pushSubscription.count({ where: { userId: limited.id } }), 10);
    await removePushSubscription(second.id, subscription("failed").endpoint);
    assert.equal(await prisma.pushSubscription.count({ where: { userId: second.id } }), 0);
    console.log("Push: inscrição, troca de conta, limites concorrentes, expiração, inatividade e falhas validados sem serviço externo.");
  } finally { await prisma.$disconnect(); await cleanup(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
