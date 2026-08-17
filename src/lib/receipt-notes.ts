import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Colunas devolvidas em qualquer LISTAGEM de notas.
 *
 * `data` esta deliberadamente de fora e nao pode ser acrescentado aqui: os
 * bytes da foto so saem por /api/notas/[id]/foto, uma nota por requisicao.
 * Selecionar `data` numa listagem traria centenas de KB por linha para a
 * memoria do servidor e tiraria o campo do TOAST sem necessidade.
 */
export const RECEIPT_NOTE_LIST_SELECT = {
  id: true,
  /** Par local da nota: e por ele que o PWA reconhece o que ja enviou. */
  clientKey: true,
  description: true,
  fileName: true,
  mimeType: true,
  size: true,
  capturedAt: true,
  status: true,
  createdAt: true,
} as const;

type ReceiptNoteRow = {
  id: string;
  clientKey: string | null;
  description: string;
  fileName: string;
  mimeType: string;
  size: number;
  capturedAt: Date;
  status: string;
  createdAt: Date;
};

export function serializeReceiptNote(note: ReceiptNoteRow) {
  return {
    id: note.id,
    // Nulo nas notas anteriores a coluna: o cliente le isso como "sem par local"
    // e nao tenta casar com nada da fila.
    clientKey: note.clientKey,
    description: note.description,
    fileName: note.fileName,
    mimeType: note.mimeType,
    size: note.size,
    capturedAt: note.capturedAt.toISOString(),
    status: note.status,
    createdAt: note.createdAt.toISOString(),
    photoUrl: `/api/notas/${note.id}/foto`,
  };
}

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

export const noteListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  take: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE, `Peça no máximo ${MAX_PAGE_SIZE} notas por página.`)
    .optional()
    .default(DEFAULT_PAGE_SIZE),
});

/**
 * Pagina o historico de um colaborador por cursor. Ordena por createdAt e
 * desempata por id, senao notas gravadas no mesmo instante — o que acontece
 * quando a fila offline despeja varias de uma vez — poderiam repetir ou sumir
 * entre as paginas.
 */
export async function listReceiptNotes(input: { userId: string; cursor?: string; take: number }) {
  const rows = await prisma.receiptNote.findMany({
    where: { userId: input.userId },
    select: RECEIPT_NOTE_LIST_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Uma linha a mais que o pedido: e assim que se sabe se existe proxima
    // pagina sem pagar um count() na tabela inteira.
    take: input.take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > input.take;
  const page = hasMore ? rows.slice(0, input.take) : rows;

  return {
    notes: page.map(serializeReceiptNote),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
