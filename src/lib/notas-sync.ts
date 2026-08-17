import {
  claimNext,
  listNotas,
  markError,
  markRetry,
  markSent,
  pruneSent,
  resetStuckSending,
  type NotaRecord,
} from "@/lib/notas-db";

const SYNC_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const SYNC_TAG = "notas-sync";

export type NotaSyncStatus = "idle" | "syncing" | "offline" | "auth-expired" | "access-paused";

export type NotaSyncSnapshot = {
  pendingCount: number;
  status: NotaSyncStatus;
  message?: string;
};

type BackgroundSyncRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

type AuthCheck =
  | { kind: "ok"; userId: string }
  | { kind: "paused"; message: string }
  | { kind: "temporary"; message: string };

type SendResult =
  | { kind: "sent" }
  | { kind: "auth-expired"; message: string }
  | { kind: "access-paused"; message: string }
  | { kind: "permanent-error"; message: string }
  | { kind: "retry" };

let snapshot: NotaSyncSnapshot = { pendingCount: 0, status: "idle" };
const listeners = new Set<() => void>();
let kickInFlight: Promise<void> | null = null;
let syncCleanup: (() => void) | null = null;
let backoffAttempt = 0;
let pausedUserId: string | null = null;

function emit(next: NotaSyncSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getNotaSyncSnapshot(): NotaSyncSnapshot {
  return snapshot;
}

export function subscribeNotaSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function pendingCount(records: NotaRecord[]): number {
  return records.filter((record) => record.status === "pending" || record.status === "sending").length;
}

async function refreshSnapshot(
  ownerId: string,
  status = snapshot.status,
  message = snapshot.message,
): Promise<void> {
  try {
    const records = await listNotas(ownerId);
    emit({ pendingCount: pendingCount(records), status, ...(message ? { message } : {}) });
  } catch {
    emit({ pendingCount: snapshot.pendingCount, status, ...(message ? { message } : {}) });
  }
}

function retryDelay(attempts: number): number {
  const exponential = Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.min(attempts, 8));
  return exponential + Math.floor(Math.random() * 1_000);
}

async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  try {
    const registration = await Promise.race<BackgroundSyncRegistration | null>([
      navigator.serviceWorker.ready as Promise<BackgroundSyncRegistration>,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1_500)),
    ]);
    if (!registration) return;
    await registration.sync?.register(SYNC_TAG);
  } catch {
    // Background Sync is optional; open-app triggers continue to handle iOS and browsers without it.
  }
}

async function getCurrentUserId(): Promise<AuthCheck> {
  try {
    const response = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) {
      return { kind: "paused", message: "Sua sessão expirou. Entre novamente para enviar suas fotos." };
    }
    if (response.status === 403) {
      return { kind: "paused", message: "Sua conta não tem acesso para enviar notas agora. A fila foi preservada." };
    }
    if (!response.ok) {
      return { kind: "temporary", message: "Não foi possível validar sua sessão agora." };
    }
    const body: unknown = await response.json();
    const userId = body && typeof body === "object" && "user" in body && body.user && typeof body.user === "object" &&
      "id" in body.user && typeof body.user.id === "string"
      ? body.user.id
      : null;
    return userId
      ? { kind: "ok", userId }
      : { kind: "temporary", message: "Não foi possível validar sua sessão agora." };
  } catch {
    return { kind: "temporary", message: "Não foi possível validar sua sessão agora." };
  }
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Respostas sem JSON usam a mensagem local.
  }
  return fallback;
}

async function sendNota(record: NotaRecord): Promise<SendResult> {
  if (!record.ownerId) {
    return {
      kind: "access-paused",
      message: "Esta foto antiga não está vinculada a uma conta e foi preservada na fila.",
    };
  }
  const body = new FormData();
  const extension = record.photo.type === "image/png" ? "png" : "jpg";
  body.append("foto", record.photo, `${record.id}.${extension}`);
  body.append("ownerId", record.ownerId);
  body.append("capturedAt", record.capturedAt);
  body.append("description", record.description);

  try {
    const response = await fetch("/api/notas", {
      method: "POST",
      headers: { "Idempotency-Key": record.id },
      body,
    });

    if (response.ok) return { kind: "sent" };
    if (response.status === 401) {
      return {
        kind: "auth-expired",
        message: "Sua sessão expirou. Entre novamente para enviar suas fotos.",
      };
    }
    if (response.status === 403) {
      return {
        kind: "access-paused",
        message: await responseMessage(
          response,
          "Sua conta não tem acesso para enviar notas agora. A fila foi preservada.",
        ),
      };
    }
    if (response.status === 400) {
      return {
        kind: "permanent-error",
        message: await responseMessage(response, "Não foi possível enviar esta foto. Tente novamente."),
      };
    }
    if (response.status === 413) {
      return { kind: "permanent-error", message: "A foto ficou grande demais. Tire outra foto." };
    }
    if (response.status === 415) {
      return { kind: "permanent-error", message: "Formato de foto não suportado. Use JPG ou PNG." };
    }
    return { kind: "retry" };
  } catch {
    return { kind: "retry" };
  }
}

async function runSync(ownerId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const backgroundSyncPromise = registerBackgroundSync();
  await resetStuckSending(ownerId);
  if (pausedUserId === ownerId) {
    await refreshSnapshot(ownerId);
    return;
  }
  if (!navigator.onLine) {
    await refreshSnapshot(ownerId, "offline");
    return;
  }
  const auth = await getCurrentUserId();
  if (auth.kind === "temporary") {
    await refreshSnapshot(ownerId, "idle", auth.message);
    return;
  }
  if (auth.kind === "paused" || auth.userId !== ownerId) {
    pausedUserId = ownerId;
    await refreshSnapshot(ownerId, auth.kind === "paused" ? "auth-expired" : "auth-expired", auth.kind === "paused" ? auth.message : "Sua sessão mudou. Entre novamente para enviar suas fotos.");
    return;
  }

  emit({ ...snapshot, status: "syncing", message: undefined });
  await backgroundSyncPromise;

  while (true) {
    const record = await claimNext(ownerId);
    if (!record) break;

    const sendAuth = await getCurrentUserId();
    if (sendAuth.kind === "temporary") {
      await markRetry(record.id, Date.now(), sendAuth.message, { incrementAttempt: false });
      await refreshSnapshot(ownerId, "idle", sendAuth.message);
      return;
    }
    if (sendAuth.kind === "paused" || sendAuth.userId !== ownerId) {
      await markRetry(record.id, Date.now(), null, { incrementAttempt: false });
      pausedUserId = ownerId;
      await refreshSnapshot(ownerId, "auth-expired", sendAuth.kind === "paused" ? sendAuth.message : "Sua sessão mudou. Entre novamente para enviar suas fotos.");
      return;
    }

    const result = await sendNota(record);
    if (result.kind === "sent") {
      await markSent(record.id);
      backoffAttempt = 0;
      continue;
    }
    if (result.kind === "auth-expired") {
      await markRetry(record.id, Date.now(), result.message, { incrementAttempt: false });
      pausedUserId = ownerId;
      await refreshSnapshot(ownerId, "auth-expired", result.message);
      return;
    }
    if (result.kind === "access-paused") {
      await markRetry(record.id, Date.now(), result.message, { incrementAttempt: false });
      pausedUserId = ownerId;
      await refreshSnapshot(ownerId, "access-paused", result.message);
      return;
    }
    if (result.kind === "permanent-error") {
      await markError(record.id, result.message);
      continue;
    }

    backoffAttempt += 1;
    await markRetry(record.id, Date.now() + retryDelay(backoffAttempt), "Falha temporária. Tentaremos novamente.");
    break;
  }

  await refreshSnapshot(ownerId, "idle");
}

export function kickNotaSync(ownerId: string): Promise<void> {
  if (kickInFlight) return kickInFlight;
  kickInFlight = runSync(ownerId).catch(async () => {
    await refreshSnapshot(ownerId, "idle", "Não foi possível atualizar o envio agora.");
  }).finally(() => {
    kickInFlight = null;
  });
  return kickInFlight;
}

export function startNotaSync(ownerId: string): () => void {
  if (typeof window === "undefined" || syncCleanup) return () => undefined;

  pausedUserId = null;
  backoffAttempt = 0;
  const onOnline = () => {
    backoffAttempt = 0;
    void kickNotaSync(ownerId);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void kickNotaSync(ownerId);
  };
  const interval = window.setInterval(() => void kickNotaSync(ownerId), SYNC_INTERVAL_MS);

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);
  syncCleanup = () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.clearInterval(interval);
    syncCleanup = null;
  };

  void Promise.all([resetStuckSending(ownerId), pruneSent(ownerId)])
    .catch(() => undefined)
    .then(() => kickNotaSync(ownerId));
  return syncCleanup;
}
