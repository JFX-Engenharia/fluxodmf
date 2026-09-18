import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { requestDestination, validRequestId } from "../src/lib/request-link";

export async function checkPushServiceWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { tag: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let focused = 0;
  let windows: { url: string; navigate: (url: string) => Promise<{ focus: () => Promise<void> }> }[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL, setTimeout, Response,
    fetch: async () => ({ ok: true, redirected: true, url: "https://fluxo.test/painel" }),
    self: {
      location: { origin: "https://fluxo.test" },
      addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; },
      skipWaiting: () => undefined,
      registration: { showNotification: async (title: string, options: typeof shown[number]["options"]) => { shown.push({ title, options }); } },
      clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url); }, claim: async () => undefined },
    },
  });
  handlers.install({ waitUntil });
  await assert.doesNotReject(pending, "o painel instala o SW mesmo sem acesso a /notas");
  handlers.push({ waitUntil, data: { json: () => ({ title: "Compra aguardando sua aprovação", body: "Obra — R$ 8.000,00", tag: "request-123", url: "/painel?tab=solicitacoes&request=123" }) } });
  await pending;
  assert.equal(shown[0].options.tag, "request-123");
  assert.equal(shown[0].options.data.url, "https://fluxo.test/painel?tab=solicitacoes&request=123");
  let closed = 0;
  const notification = { data: shown[0].options.data, close: () => { closed++; } };
  handlers.notificationclick({ notification, waitUntil }); await pending;
  assert.deepEqual(opened, [notification.data.url]);
  windows = [{ url: "https://fluxo.test/painel", navigate: async url => { navigated.push(url); return { focus: async () => { focused++; } }; } }];
  handlers.notificationclick({ notification, waitUntil }); await pending;
  assert.equal(focused, 1); assert.equal(opened.length, 1); assert.equal(closed, 2);
  assert.deepEqual(navigated, [notification.data.url]);
  handlers.push({ waitUntil, data: { json: () => ({ url: "https://attacker.test" }) } }); await pending;
  assert.equal(shown[1].options.data.url, "https://fluxo.test/painel?tab=solicitacoes");
  handlers.push({ waitUntil, data: { json: () => { throw new Error("JSON inválido"); } } }); await pending;
  assert.equal(shown[2].title, "Novidade nas solicitações");
  assert.equal(validRequestId(["a", "b"]), undefined);
  assert.equal(requestDestination("https://attacker.test"), "/painel");
  assert.equal(requestDestination("abc-123"), "/painel?tab=solicitacoes&request=abc-123");
  console.log("Service worker: instalação no painel, aviso, foco, navegação e destino seguro validados.");
}
