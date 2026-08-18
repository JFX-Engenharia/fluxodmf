const DB_NAME = "fluxo-notas";
/**
 * v3: a descricao virou obrigatoria. As fotos ja enfileiradas com descricao
 * vazia seriam recusadas pelo servidor (400 -> erro permanente) e ficariam num
 * laco — o "Tentar de novo" reenviaria o mesmo texto vazio, e nao existe tela
 * para editar a descricao de um registro da fila. Entao a migracao as remove.
 *
 * ESTE NUMERO E DUPLICADO EM public/sw.js: os dois abrem o mesmo banco, e
 * versionar so um lado dispara onblocked e derruba a conexao do outro.
 */
const DB_VERSION = 3;
const STORE_NAME = "queue";
const STUCK_SENDING_MS = 2 * 60 * 1000;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SENT_NOTAS = 100;

export type NotaStatus = "pending" | "sending" | "sent" | "error";

export type NotaRecord = {
  id: string;
  /** Registros antigos podem não ter ownerId e ficam invisíveis para qualquer conta. */
  ownerId?: string;
  photo: Blob;
  thumb: Blob;
  capturedAt: string;
  description: string;
  status: NotaStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
  createdAt: string;
  sentAt: string | null;
};

export type AddNotaInput = {
  ownerId: string;
  photo: Blob;
  thumb: Blob;
  capturedAt: string;
  description: string;
};

export type MarkRetryOptions = {
  incrementAttempt?: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let persistRequested = false;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB não está disponível neste dispositivo."));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });

      if (!store) return;
      if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt");
      if (!store.indexNames.contains("status")) store.createIndex("status", "status");

      // Passada unica de migracao. O resto deste handler e idempotente e roda a
      // cada upgrade; esta limpeza NAO pode, senao apagaria fila legitima no dia
      // em que a versao subir de novo por outro motivo.
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value as Partial<NotaRecord> | undefined;
          if (!record?.description || !record.description.trim()) cursor.delete();
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Não foi possível abrir a fila de notas."));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("A fila de notas está aberta em outra versão do aplicativo."));
    };
  });

  return dbPromise;
}

function finishTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falha ao atualizar a fila de notas."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Atualização da fila de notas cancelada."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao ler a fila de notas."));
  });
}

async function requestPersistentStorage(): Promise<void> {
  if (persistRequested || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  persistRequested = true;
  try {
    await navigator.storage.persist();
  } catch {
    // A persistência é uma melhoria; a captura não deve falhar se o navegador negar.
  }
}

function isDue(record: NotaRecord, now: number): boolean {
  return record.nextAttemptAt === null || record.nextAttemptAt <= now;
}

export async function addNota(input: AddNotaInput): Promise<NotaRecord> {
  const record: NotaRecord = {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    photo: input.photo,
    thumb: input.thumb,
    capturedAt: input.capturedAt,
    description: input.description,
    status: "pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await finishTransaction(transaction);
  await requestPersistentStorage();
  return record;
}

export async function listNotas(ownerId: string): Promise<NotaRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  await finishTransaction(transaction);
  return records
    .filter((record) => record.ownerId === ownerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function claimNext(ownerId: string, now = Date.now()): Promise<NotaRecord | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  let claimed: NotaRecord | null = null;
  const request = store.index("createdAt").openCursor();

  request.onerror = () => transaction.abort();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value as NotaRecord;
    if (record.ownerId === ownerId && record.status === "pending" && isDue(record, now)) {
      claimed = {
        ...record,
        status: "sending",
        nextAttemptAt: now + STUCK_SENDING_MS,
      };
      cursor.update(claimed);
      return;
    }
    cursor.continue();
  };

  await finishTransaction(transaction);
  return claimed;
}

async function updateNota(id: string, update: (record: NotaRecord) => NotaRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const record = (await requestResult(store.get(id))) as NotaRecord | undefined;
  if (record) store.put(update(record));
  await finishTransaction(transaction);
}

export async function markSent(id: string, sentAt = new Date().toISOString()): Promise<void> {
  await updateNota(id, (record) => ({
    ...record,
    status: "sent",
    lastError: null,
    nextAttemptAt: null,
    sentAt,
  }));
}

export async function markError(id: string, message: string): Promise<void> {
  await updateNota(id, (record) => ({
    ...record,
    status: "error",
    lastError: message,
    nextAttemptAt: null,
  }));
}

export async function markRetry(
  id: string,
  nextAttemptAt: number,
  message: string | null = null,
  options: MarkRetryOptions = {},
): Promise<void> {
  await updateNota(id, (record) => ({
    ...record,
    status: "pending",
    attempts: record.attempts + (options.incrementAttempt === false ? 0 : 1),
    lastError: message,
    nextAttemptAt,
  }));
}

export async function deleteNota(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await finishTransaction(transaction);
}

export async function resetStuckSending(ownerId: string, now = Date.now()): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  let reset = 0;
  const request = store.index("status").openCursor(IDBKeyRange.only("sending"));

  request.onerror = () => transaction.abort();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value as NotaRecord;
    if (record.ownerId === ownerId && record.nextAttemptAt !== null && record.nextAttemptAt <= now) {
      cursor.update({ ...record, status: "pending", nextAttemptAt: null });
      reset += 1;
    }
    cursor.continue();
  };

  await finishTransaction(transaction);
  return reset;
}

export async function pruneSent(ownerId: string, now = Date.now()): Promise<number> {
  const records = await listNotas(ownerId);
  const sent = records
    .filter((record) => record.status === "sent")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const cutoff = now - SENT_RETENTION_MS;
  const expired = sent.filter((record) => Date.parse(record.sentAt ?? record.createdAt) < cutoff);
  const excess = sent.slice(0, Math.max(0, sent.length - MAX_SENT_NOTAS));
  const ids = new Set([...expired, ...excess].map((record) => record.id));

  if (ids.size === 0) return 0;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  ids.forEach((id) => store.delete(id));
  await finishTransaction(transaction);
  return ids.size;
}
