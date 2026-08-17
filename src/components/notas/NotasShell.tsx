"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaptureButton } from "@/components/notas/CaptureButton";
import { ConfirmCapture } from "@/components/notas/ConfirmCapture";
import { InstallHint } from "@/components/notas/InstallHint";
import {
  NotaList,
  type ServerNotaRecord,
} from "@/components/notas/NotaList";
import {
  addNota,
  deleteNota,
  listNotas,
  markRetry,
  type NotaRecord,
} from "@/lib/notas-db";
import { compressImage } from "@/lib/image-compress";
import {
  getNotaSyncSnapshot,
  kickNotaSync,
  startNotaSync,
  subscribeNotaSync,
} from "@/lib/notas-sync";

const emptySyncSnapshot = getNotaSyncSnapshot();

// Teto por selecao: a compressao roda no canvas da main thread, um lote grande
// travaria a tela no celular. Tambem conversa com o limite do servidor de 30
// envios por 10 minutos por usuario (src/lib/rate-limit.ts) — 10 por lote deixa
// margem para tres lotes seguidos.
const MAX_BATCH = 10;

// Espelha a allowlist e o teto por arquivo de POST /api/notas: o que nao passa
// aqui nunca entra na fila, senao viraria nota em erro que o colaborador nao
// sabe resolver.
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const AUTH_CONFIRM_TIMEOUT_MS = 3_500;
const HISTORY_PAGE_SIZE = 30;

type NotasShellProps = {
  ownerId: string;
};

type OwnerState = "checking" | "ready" | "offline" | "blocked";

type ReceiptNoteListResponse = {
  notes: ServerNotaRecord[];
  nextCursor: string | null;
};

const LAST_CONFIRMED_OWNER_STORAGE_KEY = "fluxo-notas:last-confirmed-owner";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseServerNote(value: unknown): ServerNotaRecord | null {
  if (!isObject(value)) return null;
  const { id, clientKey, description, capturedAt, createdAt, photoUrl } = value;
  if (
    typeof id !== "string" ||
    (clientKey !== undefined && clientKey !== null && typeof clientKey !== "string") ||
    typeof description !== "string" ||
    typeof capturedAt !== "string" ||
    typeof createdAt !== "string" ||
    typeof photoUrl !== "string"
  ) return null;

  return {
    source: "server",
    id,
    clientKey: typeof clientKey === "string" ? clientKey : null,
    description,
    capturedAt,
    createdAt,
    sentAt: createdAt,
    status: "sent",
    photoUrl,
  };
}

function parseServerHistory(value: unknown): ReceiptNoteListResponse | null {
  if (!isObject(value) || !Array.isArray(value.notes)) return null;
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") return null;

  const notes = value.notes.map(parseServerNote);
  if (notes.some((note) => note === null)) return null;

  return {
    notes: notes as ServerNotaRecord[],
    nextCursor: value.nextCursor,
  };
}

function getLastConfirmedOwnerId(): string | null {
  try {
    return window.localStorage.getItem(LAST_CONFIRMED_OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveLastConfirmedOwnerId(ownerId: string): void {
  try {
    window.localStorage.setItem(LAST_CONFIRMED_OWNER_STORAGE_KEY, ownerId);
  } catch {
    // O cache de identidade só melhora o uso offline; a sessão continua sendo a fonte de verdade.
  }
}

function subscribeOnlineStatus(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function getOnlineStatus(): boolean {
  return navigator.onLine;
}

export function NotasShell({ ownerId }: NotasShellProps) {
  const syncSnapshot = useSyncExternalStore(
    subscribeNotaSync,
    getNotaSyncSnapshot,
    () => emptySyncSnapshot,
  );
  const [localRecords, setLocalRecords] = useState<NotaRecord[]>([]);
  const [localRecordsOwnerId, setLocalRecordsOwnerId] = useState<string | null>(null);
  const [serverRecords, setServerRecords] = useState<ServerNotaRecord[]>([]);
  const [serverRecordsOwnerId, setServerRecordsOwnerId] = useState<string | null>(null);
  const [serverNextCursor, setServerNextCursor] = useState<string | null>(null);
  const [serverNextCursorOwnerId, setServerNextCursorOwnerId] = useState<string | null>(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(null);
  const [ownerState, setOwnerState] = useState<OwnerState>("checking");
  const [ownerMessage, setOwnerMessage] = useState("");
  const [capture, setCapture] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const online = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const historyRequestId = useRef(0);
  const ownerStateRef = useRef(ownerState);
  const [ownerRetryKey, setOwnerRetryKey] = useState(0);
  const canCapture = activeOwnerId !== null && (ownerState === "ready" || ownerState === "offline");

  const records = useMemo(() => {
    if (!activeOwnerId) return [];
    const local = localRecordsOwnerId === activeOwnerId ? localRecords : [];
    const localKeys = new Set(local.map((record) => record.id));
    const server = (serverRecordsOwnerId === activeOwnerId ? serverRecords : [])
      .filter((record) => !record.clientKey || !localKeys.has(record.clientKey));
    return [...server, ...local].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [activeOwnerId, localRecords, localRecordsOwnerId, serverRecords, serverRecordsOwnerId]);

  const reload = useCallback(async () => {
    if (!activeOwnerId) return;
    try {
      setLocalRecords(await listNotas(activeOwnerId));
      setLocalRecordsOwnerId(activeOwnerId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir suas fotos.");
    }
  }, [activeOwnerId]);

  const reloadServerHistory = useCallback(async () => {
    if (!activeOwnerId) return;
    const requestId = ++historyRequestId.current;
    setLoadingMoreHistory(false);

    try {
      const query = new URLSearchParams({ take: String(HISTORY_PAGE_SIZE) });
      const response = await fetch(`/api/notas?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Não foi possível carregar o histórico de notas.");
      const page = parseServerHistory(await response.json());
      if (!page) throw new Error("O histórico de notas recebido é inválido.");

      if (historyRequestId.current === requestId) {
        setServerRecords(page.notes);
        setServerRecordsOwnerId(activeOwnerId);
        setServerNextCursor(page.nextCursor);
        setServerNextCursorOwnerId(activeOwnerId);
      }
    } catch {
      // Sem rede, a fila local continua visível como antes; não apaga o último histórico carregado.
    }
  }, [activeOwnerId]);

  const loadMoreServerHistory = useCallback(async () => {
    if (
      !activeOwnerId ||
      serverNextCursorOwnerId !== activeOwnerId ||
      !serverNextCursor ||
      loadingMoreHistory
    ) return;
    const requestId = historyRequestId.current;
    setLoadingMoreHistory(true);

    try {
      const query = new URLSearchParams({ take: String(HISTORY_PAGE_SIZE), cursor: serverNextCursor });
      const response = await fetch(`/api/notas?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Não foi possível carregar mais notas.");
      const page = parseServerHistory(await response.json());
      if (!page) throw new Error("O histórico de notas recebido é inválido.");

      if (historyRequestId.current === requestId) {
        setServerRecords((current) => {
          const byId = new Map(current.map((record) => [record.id, record]));
          page.notes.forEach((record) => byId.set(record.id, record));
          return [...byId.values()];
        });
        setServerRecordsOwnerId(activeOwnerId);
        setServerNextCursor(page.nextCursor);
        setServerNextCursorOwnerId(activeOwnerId);
      }
    } catch {
      // O botão permanece disponível para uma nova tentativa sem esconder a página já carregada.
    } finally {
      if (historyRequestId.current === requestId) setLoadingMoreHistory(false);
    }
  }, [activeOwnerId, loadingMoreHistory, serverNextCursor, serverNextCursorOwnerId]);

  useEffect(() => {
    const onOnline = () => {
      if (ownerStateRef.current !== "ready") setOwnerRetryKey((current) => current + 1);
    };
    window.addEventListener("online", onOnline);
    void navigator.serviceWorker?.register("/sw.js", { scope: "/" }).catch(() => undefined);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    ownerStateRef.current = ownerState;
  }, [ownerState]);

  useEffect(() => {
    historyRequestId.current += 1;
    let active = true;
    let retryTimer: number | undefined;

    const activateOfflineOwner = () => {
      if (!active) return;
      const lastConfirmedOwnerId = getLastConfirmedOwnerId();
      if (lastConfirmedOwnerId && lastConfirmedOwnerId !== ownerId) {
        setActiveOwnerId(null);
        setOwnerState("blocked");
        setOwnerMessage("Conecte-se para confirmar a conta antes de guardar novas fotos neste aparelho.");
        return;
      }
      setActiveOwnerId(ownerId);
      setOwnerState("offline");
      setOwnerMessage("");
      if (online) {
        retryTimer = window.setTimeout(() => {
          if (active) setOwnerRetryKey((current) => current + 1);
        }, 30_000);
      }
    };

    if (!online) {
      queueMicrotask(activateOfflineOwner);
    } else {
      queueMicrotask(() => {
        if (!active) return;
        if (ownerStateRef.current !== "ready" && ownerStateRef.current !== "offline") {
          setOwnerState("checking");
        }
        setOwnerMessage("");
      });

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), AUTH_CONFIRM_TIMEOUT_MS);
      void fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Não foi possível confirmar a sessão.");
          const body: unknown = await response.json();
          const liveOwnerId = isObject(body) && isObject(body.user) && typeof body.user.id === "string"
            ? body.user.id
            : null;
          if (!liveOwnerId) throw new Error("Não foi possível confirmar a sessão.");
          return liveOwnerId;
        })
        .then((liveOwnerId) => {
          if (!active) return;
          saveLastConfirmedOwnerId(liveOwnerId);
          setActiveOwnerId(liveOwnerId);
          setOwnerState("ready");
        })
        .catch(() => {
          activateOfflineOwner();
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
        });

      return () => {
        active = false;
        controller.abort();
        window.clearTimeout(timeoutId);
        if (retryTimer) window.clearTimeout(retryTimer);
      };
    }

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [online, ownerId, ownerRetryKey]);

  useEffect(() => {
    if (!activeOwnerId) return;
    const stopSync = startNotaSync(activeOwnerId);
    queueMicrotask(() => {
      void reload();
      void reloadServerHistory();
    });
    return stopSync;
  }, [activeOwnerId, reload, reloadServerHistory]);

  useEffect(() => {
    if (!activeOwnerId) return;
    queueMicrotask(() => {
      void reload();
    });
  }, [activeOwnerId, reload, syncSnapshot.status, syncSnapshot.pendingCount]);

  function startCapture(files: File[]) {
    if (!canCapture) {
      setError("Aguarde a confirmação da sua conta antes de guardar novas fotos.");
      return;
    }
    setNotice("");
    if (files.length > MAX_BATCH) {
      setCapture([]);
      setError(`Você pode enviar até ${MAX_BATCH} fotos por vez. Escolha menos fotos e repita depois.`);
      return;
    }
    setError("");
    setCapture(files);
  }

  async function confirmCapture(files: File[], description: string) {
    if (!canCapture || !activeOwnerId) {
      setCapture([]);
      setError("Aguarde a confirmação da sua conta antes de guardar novas fotos.");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    setError("");
    // Sequencial de proposito: compressImage usa canvas na main thread, em
    // paralelo travaria a tela. Cada addNota gera seu proprio uuid, que vira a
    // Idempotency-Key daquela foto — nenhuma coordenacao entre elas e precisa.
    let saved = 0;
    let rejected = 0;
    try {
      for (const file of files) {
        const image = await compressImage(file);
        // compressImage devolve o arquivo original quando nao consegue decodificar
        // (HEIC do iPhone, imagem gigante). Recusar aqui em vez de enfileirar.
        if (!ACCEPTED_TYPES.has(image.photo.type) || image.photo.size > MAX_PHOTO_SIZE) {
          rejected += 1;
          setProgress({ done: saved + rejected, total: files.length });
          continue;
        }
        const fileDate = new Date(file.lastModified);
        const capturedAt = file.lastModified > 0 && Number.isFinite(file.lastModified) && !Number.isNaN(fileDate.getTime())
          ? fileDate.toISOString()
          : new Date().toISOString();
        await addNota({
          ownerId: activeOwnerId,
          photo: image.photo,
          thumb: image.thumb,
          capturedAt,
          description,
        });
        saved += 1;
        setProgress({ done: saved + rejected, total: files.length });
      }
      setCapture([]);
      if (saved > 0) {
        setNotice(saved === 1
          ? "Foto guardada. Ela será enviada quando houver sinal."
          : `${saved} fotos guardadas. Elas serão enviadas quando houver sinal.`);
      }
      if (rejected > 0) {
        setError(rejected === 1
          ? "Não consegui preparar 1 foto. Tente tirar uma foto nova dela."
          : `Não consegui preparar ${rejected} fotos. Tente tirar fotos novas delas.`);
      }
      await reload();
      if (saved > 0) {
        void kickNotaSync(activeOwnerId).finally(() => void reloadServerHistory());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível guardar a foto.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function retry(id: string) {
    if (!activeOwnerId) return;
    await markRetry(id, Date.now(), null);
    await reload();
    void kickNotaSync(activeOwnerId).finally(() => void reloadServerHistory());
  }

  async function remove(id: string) {
    await deleteNota(id);
    await reload();
  }

  const localQueue = activeOwnerId && localRecordsOwnerId === activeOwnerId ? localRecords : [];
  const queueLoaded = activeOwnerId !== null && localRecordsOwnerId === activeOwnerId;
  const waitingCount = queueLoaded ? syncSnapshot.pendingCount : 0;
  const errorCount = localQueue.filter((record) => record.status === "error").length;
  const queueMessage = !activeOwnerId
    ? ownerState === "blocked"
      ? "Aguardando confirmação da conta para exibir a fila"
      : "Confirmando sua conta e sua fila..."
    : !queueLoaded
      ? "Carregando sua fila..."
      : waitingCount > 0
        ? `${waitingCount} foto${waitingCount === 1 ? "" : "s"} aguardando sinal`
        : errorCount > 0
          ? `Veja abaixo a${errorCount === 1 ? " foto" : "s fotos"} com erro`
          : ownerState === "ready"
            ? "Tudo enviado ✓"
            : "Fila disponível neste aparelho";
  const canLoadMoreHistory =
    activeOwnerId !== null &&
    serverNextCursorOwnerId === activeOwnerId &&
    serverNextCursor !== null;

  return (
    <main className="notas-shell">
      <header className="notas-header">
        <div>
          <span className="notas-eyebrow">DJ Fluxo</span>
          <h1>Notas do cartão</h1>
        </div>
      </header>

      {!online ? (
        <div className="notas-offline-banner" role="status">
          Sem internet. Pode tirar fotos normalmente — elas serão enviadas quando o sinal voltar.
        </div>
      ) : null}
      {ownerState === "checking" ? (
        <div className="alert success" role="status">Confirmando sua conta antes de liberar novas fotos...</div>
      ) : null}
      {ownerMessage ? <div className="alert error" role="alert">{ownerMessage}</div> : null}
      {syncSnapshot.status === "auth-expired" || syncSnapshot.status === "access-paused" ? (
        <div className="alert error" role="alert">{syncSnapshot.message}</div>
      ) : null}
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {notice ? <div className="alert success" role="status">{notice}</div> : null}

      {capture.length === 0 ? (
        <CaptureButton disabled={busy || !canCapture} onCapture={startCapture} />
      ) : (
        <ConfirmCapture
          files={capture}
          busy={busy}
          progress={progress}
          onConfirm={confirmCapture}
          onRemove={(index) => setCapture((current) => current.filter((_, i) => i !== index))}
          onCancel={() => setCapture([])}
        />
      )}

      <p className="notas-queue-count" aria-live="polite">
        {queueMessage}
      </p>
      <InstallHint />
      <NotaList records={records} onRetry={retry} onDelete={remove} />
      {canLoadMoreHistory ? (
        <div className="button-row">
          <button
            className="button secondary"
            type="button"
            disabled={loadingMoreHistory}
            onClick={() => void loadMoreServerHistory()}
          >
            {loadingMoreHistory ? "Carregando..." : "Carregar mais fotos"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
