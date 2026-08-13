import { ApiError } from "@/lib/api";

export const MEGABYTE = 1024 * 1024;

/**
 * Recusa um envio grande demais pelo Content-Length, antes de ler o corpo.
 *
 * E defesa de CUSTO, nao de integridade: `request.formData()` materializa o
 * multipart inteiro em memoria, entao vale barrar pelo cabecalho antes de
 * bufferizar dezenas de MB ou gastar banco com a operacao.
 *
 * O cabecalho e informado pelo cliente e pode faltar (envio chunked) ou mentir.
 * Quando falta ou vem invalido, a requisicao SEGUE adiante de proposito: este
 * helper nunca substitui os limites por arquivo aplicados depois, que sao os
 * que realmente garantem o tamanho do que foi gravado.
 */
export function assertBodySize(request: Request, maxBytes: number) {
  const header = request.headers.get("content-length")?.trim();

  // Content-Length e um inteiro decimal, e so isso conta. Formas exoticas como
  // "1e3", "+1", "0x10" ou lista de valores sao ignoradas de proposito: um
  // cabecalho que nao da para ler direito nunca pode virar motivo de recusa,
  // nem ser convertido em numero por engano (Number("1e3") daria 1000).
  if (!header || !/^\d+$/.test(header)) return;

  const declared = Number(header);

  if (declared > maxBytes) {
    throw new ApiError(413, `O envio excede o limite de ${Math.floor(maxBytes / MEGABYTE)} MB.`);
  }
}
