const HTML_CACHE = "notas-html-v1";
const STATIC_CACHE = "notas-static";
const DB_NAME = "fluxo-notas";
// DUPLICADO de src/lib/notas-db.ts de proposito: o service worker nao importa
// modulo. Os dois abrem o mesmo banco, entao este numero tem que subir JUNTO —
// versionar so um lado dispara onblocked e derruba a conexao do outro.
// A migracao em si (limpar fila sem descricao) roda de um lado so, o que abrir
// primeiro; aqui basta acompanhar a versao.
const DB_VERSION = 3;
const STORE_NAME = "queue";
const STUCK_SENDING_MS = 2 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShellAndStaticAssets());
  self.skipWaiting();
});

async function cacheShellAndStaticAssets() {
  const shellResponse = await fetch("/notas");
  if (!shellResponse.ok) throw new Error("Não foi possível cachear o shell de notas.");
  const finalUrl = new URL(shellResponse.url, self.location.origin);
  if (shellResponse.redirected || finalUrl.origin !== self.location.origin || finalUrl.pathname !== "/notas") {
    throw new Error("O shell de notas redirecionou para uma rota diferente.");
  }

  const html = await shellResponse.clone().text();
  const shellCache = await caches.open(HTML_CACHE);
  await shellCache.put("/notas", shellResponse);

  const staticUrls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .map((value) => new URL(value, self.location.origin))
    .filter((url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/"));
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.allSettled(staticUrls.map(async (url) => {
    const response = await fetch(url);
    if (response.ok) await staticCache.put(url, response.clone());
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith("notas-html-") && key !== HTML_CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function networkFirst(request) {
  try {
    const response = await Promise.race([fetch(request), timeout(3500)]);
    if (response.ok) {
      const cache = await caches.open(HTML_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("/notas")) || new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("RSC")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/painel" ||
    url.pathname.startsWith("/painel/") ||
    url.pathname === "/login" ||
    url.pathname.startsWith("/login/")
  ) return;

  if (request.mode === "navigate" && url.pathname === "/notas") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt");
      if (!store.indexNames.contains("status")) store.createIndex("status", "status");

      // A MESMA limpeza de src/lib/notas-db.ts, e nao um espelho decorativo:
      // quem dispara o upgrade e quem abrir o banco primeiro. Se o Background
      // Sync chegar antes da pagina e so este lado subisse a versao, a fila
      // sem descricao sobreviveria e a pagina nunca mais rodaria a migracao —
      // as fotos ficariam presas em 400 permanente.
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value;
          if (!record || !record.description || !String(record.description).trim()) cursor.delete();
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB indisponível"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Falha na fila"));
    transaction.onabort = () => reject(transaction.error || new Error("Fila cancelada"));
  });
}

async function claimNext(ownerId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  let claimed = null;
  const request = store.index("createdAt").openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value;
    if (
      !claimed &&
      record.ownerId === ownerId &&
      record.status === "pending" &&
      (record.nextAttemptAt === null || record.nextAttemptAt <= Date.now())
    ) {
      claimed = { ...record, status: "sending", nextAttemptAt: Date.now() + STUCK_SENDING_MS };
      cursor.update(claimed);
      return;
    }
    cursor.continue();
  };
  await transactionDone(transaction);
  return claimed;
}

async function updateRecord(id, ownerId, update) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(id);
  request.onsuccess = () => {
    if (request.result && request.result.ownerId === ownerId) store.put(update(request.result));
  };
  await transactionDone(transaction);
}

async function resetStuckSending(ownerId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.index("status").openCursor(IDBKeyRange.only("sending"));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value;
    if (
      record.ownerId === ownerId &&
      record.nextAttemptAt !== null &&
      record.nextAttemptAt <= Date.now()
    ) {
      cursor.update({ ...record, status: "pending", nextAttemptAt: null });
    }
    cursor.continue();
  };
  await transactionDone(transaction);
}

async function getCurrentUserId() {
  let response;
  try {
    response = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    throw new Error("Não foi possível validar a sessão para sincronizar.", { cause: error });
  }
  if (response.status === 401 || response.status === 403) return { kind: "paused" };
  if (!response.ok) throw new Error("Validação temporária da sessão indisponível.");
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("Resposta inválida na validação da sessão.", { cause: error });
  }
  if (!body?.user || typeof body.user.id !== "string") {
    throw new Error("Resposta incompleta na validação da sessão.");
  }
  return { kind: "ok", userId: body.user.id };
}

function retryDelay(attempts) {
  const exponential = Math.min(900000, 5000 * 2 ** Math.min(attempts, 8));
  return exponential + Math.floor(Math.random() * 1000);
}

async function sendRecord(record) {
  if (!record.ownerId) return null;
  const body = new FormData();
  const extension = record.photo.type === "image/png" ? "png" : "jpg";
  body.append("foto", record.photo, `${record.id}.${extension}`);
  body.append("ownerId", record.ownerId);
  body.append("capturedAt", record.capturedAt);
  body.append("description", record.description);
  return fetch("/api/notas", { method: "POST", headers: { "Idempotency-Key": record.id }, body });
}

async function syncQueue() {
  const auth = await getCurrentUserId();
  if (auth.kind === "paused") return;
  const ownerId = auth.userId;
  await resetStuckSending(ownerId);

  while (true) {
    const record = await claimNext(ownerId);
    if (!record) return;
    let sendAuth;
    try {
      sendAuth = await getCurrentUserId();
    } catch (error) {
      await updateRecord(record.id, ownerId, (value) => ({
        ...value,
        status: "pending",
        nextAttemptAt: Date.now(),
        lastError: "Não foi possível validar a sessão. Tentaremos novamente.",
      }));
      throw error;
    }
    if (sendAuth.kind === "paused" || sendAuth.userId !== ownerId) {
      await updateRecord(record.id, ownerId, (value) => ({
        ...value,
        status: "pending",
        nextAttemptAt: Date.now(),
        lastError: sendAuth.kind === "paused"
          ? "Sua sessão expirou. Entre novamente para enviar suas fotos."
          : "Sua sessão mudou. Entre novamente para enviar suas fotos.",
      }));
      return;
    }
    let response;
    try {
      response = await sendRecord(record);
    } catch {
      await updateRecord(record.id, ownerId, (value) => ({
        ...value,
        status: "pending",
        nextAttemptAt: Date.now() + retryDelay(value.attempts + 1),
        attempts: value.attempts + 1,
        lastError: "Falha temporária. Tentaremos novamente.",
      }));
      throw new Error("Falha de rede; Background Sync tentará novamente.");
    }
    if (!response) return;
    if (response.ok) {
      await updateRecord(record.id, ownerId, (value) => ({ ...value, status: "sent", sentAt: new Date().toISOString(), nextAttemptAt: null, lastError: null }));
      continue;
    }
    if (response.status === 401) {
      await updateRecord(record.id, ownerId, (value) => ({ ...value, status: "pending", nextAttemptAt: Date.now(), lastError: "Sua sessão expirou. Entre novamente para enviar suas fotos." }));
      return;
    }
    if (response.status === 403) {
      await updateRecord(record.id, ownerId, (value) => ({
        ...value,
        status: "pending",
        nextAttemptAt: Date.now(),
        lastError: "Sua conta não tem acesso para enviar notas agora. A fila foi preservada.",
      }));
      return;
    }
    if ([400, 413, 415].includes(response.status)) {
      const message = response.status === 413
        ? "A foto ficou grande demais. Tire outra foto."
        : response.status === 415
          ? "Formato de foto não suportado. Use JPG ou PNG."
          : "Não foi possível enviar esta foto. Tente novamente.";
      await updateRecord(record.id, ownerId, (value) => ({ ...value, status: "error", nextAttemptAt: null, lastError: message }));
      continue;
    }
    await updateRecord(record.id, ownerId, (value) => ({
      ...value,
      status: "pending",
      nextAttemptAt: Date.now() + retryDelay(value.attempts + 1),
      attempts: value.attempts + 1,
      lastError: "Falha temporária. Tentaremos novamente.",
    }));
    throw new Error("Servidor temporariamente indisponível; Background Sync tentará novamente.");
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "notas-sync") event.waitUntil(syncQueue());
});
