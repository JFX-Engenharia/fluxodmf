import { ApiError } from "@/lib/api";

/**
 * Assinaturas de arquivo (magic bytes) dos formatos aceitos em ANEXOS
 * (payment-requests). Planilhas sao tratadas mais abaixo, por funcoes proprias:
 * os dois conjuntos nao se misturam, entao um anexo nunca passa a aceitar xlsx.
 *
 * O tipo declarado no upload vem do cliente e e trivial de forjar: basta
 * renomear a extensao ou mandar outro Content-Type no multipart. Ler os
 * primeiros bytes e a unica forma de saber o que o arquivo realmente e.
 */
const SIGNATURES = [
  // "%PDF-"
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
] as const;

/** Tipos que este helper sabe reconhecer pelo conteudo. */
export const SIGNATURE_MIME_TYPES = SIGNATURES.map((signature) => signature.mimeType);

/** Como cada tipo aparece na mensagem de erro, na lingua do usuario. */
const MIME_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

/** "PDF, JPG ou PNG" — enumeracao em portugues, com "ou" antes do ultimo. */
function describeMimeTypes(mimeTypes: readonly string[]) {
  const labels = mimeTypes.map((mimeType) => MIME_TYPE_LABELS[mimeType] ?? mimeType);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} ou ${labels[labels.length - 1]}`;
}

/** Devolve o tipo real do conteudo, ou null quando nao reconhece a assinatura. */
export function detectFileSignature(bytes: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.bytes.length) continue;
    if (signature.bytes.every((byte, index) => bytes[index] === byte)) {
      return signature.mimeType;
    }
  }
  return null;
}

/**
 * Confere o conteudo contra o tipo declarado e devolve o tipo DETECTADO, que e
 * o que deve ser persistido. Recusa com 400 tanto o formato desconhecido quanto
 * a divergencia entre conteudo e declaracao.
 *
 * `accept` restringe os tipos validos NESTA chamada e e o que a mensagem de erro
 * cita. Serve para nao falar de PDF na tela de notas, que so tira foto: quem le
 * o texto e o colaborador em campo, e citar um formato que a tela nem oferece so
 * o faz procurar defeito onde nao ha. O padrao continua sendo todos os tipos
 * conhecidos, que e o caso dos anexos de solicitacao.
 */
export function assertFileSignature(
  bytes: Uint8Array,
  declaredMimeType: string,
  fileName: string,
  accept: readonly string[] = SIGNATURE_MIME_TYPES,
): string {
  const detected = detectFileSignature(bytes);

  if (!detected || !accept.includes(detected)) {
    throw new ApiError(
      400,
      `O arquivo "${fileName}" não é um ${describeMimeTypes(accept)} válido.`,
    );
  }

  if (detected !== declaredMimeType) {
    throw new ApiError(
      400,
      `O conteúdo do arquivo "${fileName}" não corresponde ao tipo informado. Envie o arquivo original, sem renomear a extensão.`,
    );
  }

  return detected;
}

/* -------------------------------------------------------------------------- */
/* Planilhas (importacao e conciliacao)                                        */
/* -------------------------------------------------------------------------- */

export type SpreadsheetKind = "csv" | "xls" | "xlsx";

/** Extensoes aceitas nas planilhas. Fonte unica para quem valida upload. */
export const SPREADSHEET_EXTENSIONS: readonly SpreadsheetKind[] = ["csv", "xls", "xlsx"];

/** Amostra lida para decidir se o conteudo e texto. Basta o inicio do arquivo. */
export const SPREADSHEET_TEXT_SAMPLE_BYTES = 64 * 1024;

// XLSX e um container ZIP (OOXML): "PK\x03\x04" no arquivo comum, e as variantes
// de arquivo vazio e spanned. Confirmar que e ZIP e o limite do magic byte — a
// estrutura interna quem valida e o parser, ao abrir a planilha.
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

// XLS antigo e um container OLE2/CFB (o mesmo do .doc e .ppt de 97-2003).
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Proporcao minima de caracteres imprimiveis para o conteudo passar por texto.
 *
 * O limiar e deliberadamente alto: uma planilha CSV real e praticamente 100%
 * imprimivel, enquanto binario decodificado a forca vira uma sopa de caracteres
 * de controle. Com 99%, uma amostra de 64 KB ainda tolera algumas centenas de
 * caracteres estranhos — o suficiente para nao recusar um arquivo legitimo com
 * sujeira pontual, e pouco demais para deixar binario passar.
 */
export const SPREADSHEET_MIN_PRINTABLE_RATIO = 0.99;

/** TAB, LF e CR sao esperados em CSV e contam como imprimiveis. */
function isPrintable(codePoint: number) {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
  if (codePoint < 0x20 || codePoint === 0x7f) return false;
  // Faixa C1: onde caem os bytes 0x80-0x9F sem correspondencia em Windows-1252.
  return codePoint < 0x80 || codePoint > 0x9f;
}

function printableRatio(text: string) {
  let printable = 0;
  let total = 0;

  for (const char of text) {
    total += 1;
    if (isPrintable(char.codePointAt(0) ?? 0)) printable += 1;
  }

  return total === 0 ? 0 : printable / total;
}

/**
 * Decodifica o conteudo de uma planilha em texto, ou devolve null quando o
 * conteudo nao passa por texto legivel. Serve tanto para decidir se um arquivo
 * e CSV quanto para ler o texto ja no encoding certo.
 *
 * Ordem: byte NUL reprova de saida; depois UTF-8 estrito; e so entao
 * Windows-1252, que e o que o Excel em portugues gera ao salvar CSV. O fallback
 * so e aceito se o texto resultante for majoritariamente imprimivel
 * (SPREADSHEET_MIN_PRINTABLE_RATIO), senao qualquer binario passaria — o
 * Windows-1252 mapeia praticamente todo byte para algum caractere.
 *
 * `truncated` diz que os bytes recebidos sao uma amostra cortada de um arquivo
 * maior. Nesse caso uma sequencia UTF-8 incompleta NO FIM e so o corte da
 * leitura e nao invalida o texto; quando os bytes sao o arquivo inteiro, a
 * mesma sequencia incompleta e corrupcao e reprova. Um arquivo Windows-1252 que
 * termine exatamente num acento sem quebra de linha cai nessa regra e e
 * recusado — caso raro o bastante para valer a troca.
 */
export function decodeSpreadsheetText(
  bytes: Uint8Array,
  options: { truncated?: boolean } = {},
): string | null {
  if (bytes.includes(0x00)) return null;

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
      stream: options.truncated === true,
    });
    return printableRatio(text) >= SPREADSHEET_MIN_PRINTABLE_RATIO ? text : null;
  } catch {
    // Nao decodificou como UTF-8. Se a unica falha for uma sequencia incompleta
    // no fim, isso e corrupcao de UTF-8 e nao outro encoding: tentar
    // Windows-1252 aqui so produziria mojibake com cara de texto valido.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
      return null;
    } catch {
      // Falha no meio do conteudo: e outro encoding mesmo.
    }
  }

  const latin1 = new TextDecoder("windows-1252").decode(bytes);
  return printableRatio(latin1) >= SPREADSHEET_MIN_PRINTABLE_RATIO ? latin1 : null;
}

/**
 * CSV nao tem assinatura: e texto puro. O que da para afirmar e que o conteudo
 * passa por texto legivel e tem ao menos uma linha com conteudo.
 */
function looksLikeText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, SPREADSHEET_TEXT_SAMPLE_BYTES);
  const text = decodeSpreadsheetText(sample, { truncated: bytes.length > sample.length });

  // O TextDecoder ja descarta o BOM inicial, entao um arquivo so com BOM vira
  // texto vazio. Vazio, so BOM ou so espaco em branco nao formam uma linha
  // sequer para o parser de CSV ler.
  return text !== null && text.trim().length > 0;
}

/** Formato real da planilha pelo conteudo, ou null quando nao reconhece. */
export function detectSpreadsheetKind(bytes: Uint8Array): SpreadsheetKind | null {
  if (!bytes.length) return null;
  if (ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature))) return "xlsx";
  if (startsWith(bytes, OLE2_SIGNATURE)) return "xls";
  return looksLikeText(bytes) ? "csv" : null;
}

function fileExtension(fileName: string) {
  if (!fileName.includes(".")) return null;
  return fileName.split(".").pop()?.toLowerCase() || null;
}

/**
 * Confere o conteudo da planilha contra a extensao do arquivo e devolve o
 * formato REAL, que e o que deve escolher o parser.
 *
 * UNICA EXCECAO GLOBAL: arquivo .xls contendo assinatura XLSX/ZIP e aceito. O
 * export do Conta Azul sai assim — extensao antiga, conteudo OOXML — e recusa-lo
 * quebraria a importacao. Todas as demais combinacoes sao estritas.
 */
export function assertSpreadsheetContent(bytes: Uint8Array, fileName: string): SpreadsheetKind {
  const extension = fileExtension(fileName);

  if (!extension || !(SPREADSHEET_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ApiError(400, `Formato inválido em "${fileName}". Use CSV, XLS ou XLSX.`);
  }

  const detected = detectSpreadsheetKind(bytes);

  if (!detected) {
    throw new ApiError(400, `O arquivo "${fileName}" não é uma planilha CSV, XLS ou XLSX válida.`);
  }

  const contaAzulExport = extension === "xls" && detected === "xlsx";
  if (detected !== extension && !contaAzulExport) {
    throw new ApiError(
      400,
      `O conteúdo do arquivo "${fileName}" não corresponde à extensão. Envie o arquivo original, sem renomear a extensão.`,
    );
  }

  return detected;
}
