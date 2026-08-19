import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireMutationAllowed, requireTab } from "@/lib/auth";
import { assertBodySize, MEGABYTE } from "@/lib/body-size";
import { prisma } from "@/lib/db";
import { assertFileSignature } from "@/lib/file-signature";
import { withIdempotency } from "@/lib/idempotency";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  listReceiptNotes,
  noteListQuerySchema,
  RECEIPT_NOTE_LIST_SELECT,
  serializeReceiptNote,
} from "@/lib/receipt-notes";

const MAX_PHOTO_SIZE = 5 * MEGABYTE;
/** Foto no limite + folga para os campos de texto e o overhead do multipart. */
const MAX_BODY_SIZE = 6 * MEGABYTE;

/**
 * Saida de camera: so JPEG e PNG. Nao ha PDF neste fluxo — por isso a lista vai
 * junto para o assertFileSignature, que so fala dos tipos desta chamada quando
 * recusa o arquivo.
 */
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png"] as const;

/**
 * Set, e nao objeto: indexar um objeto com string vinda do cliente encontraria
 * tambem o que veio do prototype — "constructor" ou "toString" passariam pela
 * checagem como se fossem tipos permitidos. O Set so conhece o que foi posto
 * nele.
 */
const allowedMimeTypes = new Set<string>(ACCEPTED_MIME_TYPES);

/** Vale para campo ausente e para vazio: sem ela, faltar o campo devolveria a
 * mensagem padrao do zod, em ingles. */
const MISSING_OWNER_MESSAGE = "Envio sem identificação da conta de origem.";

const createSchema = z.object({
  /**
   * Obrigatoria: sem ela o painel recebe a foto da nota sem saber do que se
   * trata e precisa abrir a imagem para descobrir. O minimo de 3 espelha o do
   * cliente (MIN_DESCRIPTION em ConfirmCapture) — um campo obrigatorio que
   * aceita um caractere nao informa nada, so cria ritual.
   */
  description: z
    .string()
    .trim()
    .min(3, "Escreva o que você comprou.")
    .max(500, "A descrição pode ter no máximo 500 caracteres."),
  capturedAt: z.string().optional(),
  /**
   * Dono da foto no momento da captura, gravado na fila offline. Sem formato
   * assumido de proposito: e o id que o servidor emitiu, e validar o formato
   * aqui so criaria acoplamento com o gerador de id.
   */
  ownerId: z
    .string({ error: MISSING_OWNER_MESSAGE })
    .min(1, MISSING_OWNER_MESSAGE),
});

/** Tolerancia para relogio adiantado do celular. */
const CLOCK_SKEW_MS = 10 * 60 * 1_000;
const EARLIEST_CAPTURE_MS = Date.UTC(2020, 0, 1);

/**
 * A data de captura vem do relogio do celular, que pode estar errado — e a foto
 * pode ter ficado dias na fila offline antes de chegar. Valor absurdo (futuro
 * alem da tolerancia, ou anterior a 2020) e substituido pela hora do servidor:
 * nunca se recusa uma nota por causa do relogio do aparelho.
 */
function resolveCapturedAt(value: string | undefined, now: Date) {
  if (!value) return now;

  const parsed = new Date(value);
  const time = parsed.getTime();

  if (Number.isNaN(time)) return now;
  if (time > now.getTime() + CLOCK_SKEW_MS) return now;
  if (time < EARLIEST_CAPTURE_MS) return now;

  return parsed;
}

/**
 * Violacao do UNIQUE de `clientKey`. P2002 e o codigo do Prisma para conflito de
 * chave unica; o nome da coluna distingue esta daqui de qualquer outro unique
 * que a tabela venha a ganhar, para nao tratar um conflito diferente como
 * duplicata de envio. Checagem estrutural em vez de `instanceof`: o erro
 * atravessa o adapter e o driver, e so o formato e garantido.
 */
function isClientKeyConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as {
    code?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: unknown; originalMessage?: unknown } };
    };
  };
  if (code !== "P2002") return false;

  // De onde o nome da coluna PODE vir. `target` e o campo classico do Prisma,
  // mas com o driver adapter (@prisma/adapter-pg) ele nao vem preenchido: o
  // unico lugar onde o indice aparece e no erro cru do Postgres, dentro de
  // driverAdapterError. Sem esta segunda fonte o conflito passava batido e o
  // reenvio recebia 500 — que o cliente trata como "tentar de novo", ou seja,
  // fila offline em retry infinito exatamente no caso que este bloco existe
  // para resolver.
  const cause = meta?.driverAdapterError?.cause;
  const constraint = cause?.constraint;
  const candidates = [
    ...(Array.isArray(meta?.target) ? meta.target : [meta?.target]),
    ...(Array.isArray(constraint) ? constraint : [constraint]),
    // Mensagem do Postgres: o texto e traduzido conforme o locale do servidor,
    // mas o nome do indice ("ReceiptNote_clientKey_key") sai igual em qualquer
    // idioma.
    cause?.originalMessage,
  ];

  return candidates.some(
    (candidate) => typeof candidate === "string" && candidate.includes("clientKey"),
  );
}

/**
 * A nota que ja ocupava o clientKey. So devolve se for do mesmo autor: chave
 * repetida entre contas diferentes nao e reenvio, e sim um cliente mandando um
 * identificador que nao gerou — nesse caso nao ha o que devolver, e entregar a
 * nota do outro vazaria a foto de um colaborador para outro.
 */
async function findByClientKey(clientKey: string, userId: string) {
  const existing = await prisma.receiptNote.findUnique({
    where: { clientKey },
    select: { ...RECEIPT_NOTE_LIST_SELECT, userId: true },
  });

  if (!existing || existing.userId !== userId) {
    throw new ApiError(409, "Já existe um envio com esta identificação. Tire a foto novamente.");
  }

  return existing;
}

export async function POST(request: Request) {
  try {
    const actor = await requireTab("notas");
    await requireMutationAllowed(actor);
    // Barra o envio pelo cabecalho antes de bufferizar o multipart.
    assertBodySize(request, MAX_BODY_SIZE);

    return await withIdempotency({
      request,
      // A chave e o uuid gerado na captura: reenvio da fila offline nunca
      // duplica a nota, e a resposta gravada volta identica no replay.
      scope: "nota:create",
      actorId: actor.id,
      execute: async () => {
        // DENTRO do execute, e nao antes do withIdempotency: replay nao pode
        // consumir cota. A pagina e o service worker disputam o mesmo envio, e o
        // Background Sync repete o POST quando o 201 se perde na volta — cobrar
        // esses reenvios daria 429 por notas que o servidor ja gravou, e o
        // colaborador ficaria em backoff com a fila cheia. Aqui so paga quem
        // trouxe uma chave nova, ou seja, uma nota nova de verdade.
        //
        // Por usuario, e nao por IP: em rede movel a operadora compartilha o
        // mesmo endereco entre muitos aparelhos (CGNAT).
        //
        // O 429 sai como excecao, entao withIdempotency apaga a reserva da chave
        // (status 102) e o mesmo Idempotency-Key volta a valer na proxima
        // tentativa — a nota nao fica queimada.
        enforceRateLimit("nota-upload", actor.id);

        const formData = await request.formData();
        const body = createSchema.parse(Object.fromEntries(formData));

        // A fila offline sobrevive a troca de conta no mesmo aparelho: uma foto
        // capturada por um colaborador pode ser despejada quando ja ha outra
        // sessao ativa. Recusar aqui, antes de olhar o arquivo, evita que a nota
        // seja atribuida a quem nao a tirou. A foto continua na fila do dono.
        if (body.ownerId !== actor.id) {
          throw new ApiError(
            403,
            "Esta foto pertence a outra conta. Entre com a conta correta para enviá-la.",
          );
        }

        const photo = formData.get("foto");

        if (!(photo instanceof File)) {
          throw new ApiError(400, "Envie a foto da nota.");
        }
        if (!allowedMimeTypes.has(photo.type) || photo.size === 0) {
          throw new ApiError(400, "A foto precisa ser uma imagem JPG ou PNG.");
        }
        if (photo.size > MAX_PHOTO_SIZE) {
          throw new ApiError(400, "A foto pode ter no máximo 5 MB.");
        }

        const now = new Date();
        const data = Buffer.from(await photo.arrayBuffer());
        // O tipo declarado nao vale como prova: grava-se o detectado no conteudo.
        const mimeType = assertFileSignature(data, photo.type, photo.name, ACCEPTED_MIME_TYPES);

        // O mesmo valor da idempotencia vira o vinculo permanente com a foto da
        // fila local. withIdempotency ja recusou o pedido sem cabecalho valido
        // antes de chegar aqui, entao na pratica isto nunca e nulo — o `?? null`
        // existe para nao inventar string vazia se algum dia essa ordem mudar.
        const clientKey = request.headers.get("Idempotency-Key")?.trim() || null;

        let note;
        try {
          note = await prisma.receiptNote.create({
            data: {
              userId: actor.id,
              clientKey,
              description: body.description,
              fileName: photo.name.slice(0, 255),
              mimeType,
              size: photo.size,
              data,
              capturedAt: resolveCapturedAt(body.capturedAt, now),
            },
            select: RECEIPT_NOTE_LIST_SELECT,
          });
        } catch (error) {
          if (!isClientKeyConflict(error) || !clientKey) throw error;
          // A foto ja estava gravada: nada foi criado agora, entao nao ha evento
          // novo para auditar. Devolver a nota existente (200, nao 201) fecha o
          // ciclo do cliente, que marca o item da fila como enviado e para de
          // reenviar.
          return ok({ note: serializeReceiptNote(await findByClientKey(clientKey, actor.id)) });
        }

        await auditLog({
          actorId: actor.id,
          event: "NOTA_ENVIADA",
          entity: "ReceiptNote",
          entityId: note.id,
          metadata: {
            arquivo: note.fileName,
            tamanho: note.size,
            capturadaEm: note.capturedAt.toISOString(),
          },
        });

        return ok({ note: serializeReceiptNote(note) }, 201);
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Historico do proprio colaborador. */
export async function GET(request: Request) {
  try {
    const actor = await requireTab("notas");
    const query = noteListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    return ok(await listReceiptNotes({ userId: actor.id, ...query }));
  } catch (error) {
    return handleApiError(error);
  }
}
