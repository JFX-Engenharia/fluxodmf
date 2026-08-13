import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import {
  assertFileSignature,
  assertSpreadsheetContent,
  decodeSpreadsheetText,
  detectFileSignature,
  detectSpreadsheetKind,
  SPREADSHEET_MIN_PRINTABLE_RATIO,
  SIGNATURE_MIME_TYPES,
  SPREADSHEET_EXTENSIONS,
  SPREADSHEET_TEXT_SAMPLE_BYTES,
} from "../src/lib/file-signature";
import { parseCsvRows } from "../src/lib/spreadsheet";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, "deveria lancar ApiError");
    return error;
  }
  throw new Error("deveria ter recusado o arquivo");
}

// Formatos aceitos sao reconhecidos pelo conteudo.
assert.equal(detectFileSignature(PDF), "application/pdf");
assert.equal(detectFileSignature(JPEG), "image/jpeg");
assert.equal(detectFileSignature(PNG), "image/png");
assert.deepEqual(SIGNATURE_MIME_TYPES, ["application/pdf", "image/jpeg", "image/png"]);

// Assinatura correta com lixo depois continua valendo: so o inicio importa.
assert.equal(detectFileSignature(Buffer.concat([PDF, Buffer.alloc(4_096, 0x41)])), "application/pdf");

// Conteudo nao reconhecido.
assert.equal(detectFileSignature(Buffer.alloc(0)), null, "arquivo vazio");
assert.equal(detectFileSignature(Buffer.from([0xff, 0xd8])), null, "menor que a assinatura");
assert.equal(detectFileSignature(Buffer.from("<!doctype html><script>")), null, "html");
// Prefixo parcial nao pode passar por PNG.
assert.equal(detectFileSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])), null);

// Conteudo batendo com o declarado: devolve o tipo detectado, que e o gravado.
assert.equal(assertFileSignature(PDF, "application/pdf", "nota.pdf"), "application/pdf");
assert.equal(assertFileSignature(JPEG, "image/jpeg", "foto.jpg"), "image/jpeg");
assert.equal(assertFileSignature(PNG, "image/png", "print.png"), "image/png");

// Formato desconhecido: recusa citando os aceitos.
const desconhecido = rejection(() =>
  assertFileSignature(Buffer.from("<!doctype html><script>"), "application/pdf", "boleto.pdf"),
);
assert.equal((desconhecido as ApiError).status, 400);
assert.match((desconhecido as ApiError).message, /não é um PDF, JPG ou PNG válido/);
assert.match((desconhecido as ApiError).message, /boleto\.pdf/);

// Arquivo vazio cai na mesma recusa.
assert.equal((rejection(() => assertFileSignature(Buffer.alloc(0), "image/png", "vazio.png")) as ApiError).status, 400);

// Divergencia entre conteudo e tipo declarado: PNG enviado como PDF.
const divergente = rejection(() => assertFileSignature(PNG, "application/pdf", "contrato.pdf"));
assert.equal((divergente as ApiError).status, 400);
assert.match((divergente as ApiError).message, /não corresponde ao tipo informado/);

// Divergencia no sentido inverso: PDF declarado como imagem.
assert.match(
  (rejection(() => assertFileSignature(PDF, "image/jpeg", "recibo.jpg")) as ApiError).message,
  /não corresponde ao tipo informado/,
);

/* -------------------------------------------------------------------------- */
/* Planilhas                                                                   */
/* -------------------------------------------------------------------------- */

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00]);
const ZIP_VAZIO = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00]);
const ZIP_SPANNED = Buffer.from([0x50, 0x4b, 0x07, 0x08, 0x00, 0x00, 0x00, 0x00]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
const CSV = Buffer.from("data;valor\n2026-01-05;1234,56\n", "utf8");
const CSV_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CSV]);

assert.deepEqual(SPREADSHEET_EXTENSIONS, ["csv", "xls", "xlsx"]);

// Deteccao por conteudo: as tres variantes de ZIP valem como OOXML.
assert.equal(detectSpreadsheetKind(ZIP), "xlsx");
assert.equal(detectSpreadsheetKind(ZIP_VAZIO), "xlsx");
assert.equal(detectSpreadsheetKind(ZIP_SPANNED), "xlsx");
assert.equal(detectSpreadsheetKind(OLE2), "xls");
assert.equal(detectSpreadsheetKind(CSV), "csv");
assert.equal(detectSpreadsheetKind(CSV_BOM), "csv", "BOM UTF-8 nao pode invalidar o CSV");
// Acentuacao valida em UTF-8 continua sendo texto.
assert.equal(detectSpreadsheetKind(Buffer.from("descrição;valor\naçaí;10\n", "utf8")), "csv");

// Nao e planilha: vazio, binario com NUL e UTF-8 quebrado.
assert.equal(detectSpreadsheetKind(Buffer.alloc(0)), null, "arquivo vazio");
assert.equal(detectSpreadsheetKind(Buffer.from([0x64, 0x00, 0x61, 0x74])), null, "byte NUL");
// MUDANCA DELIBERADA DA ETAPA 1: bytes invalidos em UTF-8 mas imprimiveis em
// Windows-1252 agora contam como texto — e exatamente esse o encoding que o
// fallback passou a atender. Quem barra binario e o limiar de imprimiveis.
assert.equal(detectSpreadsheetKind(Buffer.from([0xc3, 0x28, 0x41, 0x42])), "csv", "Windows-1252");
assert.equal(decodeSpreadsheetText(Buffer.from([0xc3, 0x28, 0x41, 0x42])), "Ã(AB");
assert.equal(detectSpreadsheetKind(PNG), null, "PNG nao e planilha");

// Arquivo curto terminando em sequencia UTF-8 incompleta: aqui o fim da amostra
// E o fim do arquivo, entao e corrupcao e nao corte de leitura.
assert.equal(detectSpreadsheetKind(Buffer.from([0xc3])), null, "multibyte incompleto no EOF");
assert.equal(
  detectSpreadsheetKind(Buffer.concat([Buffer.from("data;valor\n", "utf8"), Buffer.from([0xe2, 0x82])])),
  null,
  "3 bytes truncados em 2 no EOF",
);

// Texto sem conteudo util nao e CSV plausivel.
assert.equal(detectSpreadsheetKind(Buffer.from([0xef, 0xbb, 0xbf])), null, "so BOM");
assert.equal(detectSpreadsheetKind(Buffer.from("   \n\t\r\n  ", "utf8")), null, "so whitespace");
assert.equal(
  detectSpreadsheetKind(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("  \n", "utf8")])),
  null,
  "BOM + whitespace",
);

/* --- decodeSpreadsheetText: UTF-8, Windows-1252 e recusa de binario --------- */

assert.ok(SPREADSHEET_MIN_PRINTABLE_RATIO >= 0.9, "limiar precisa ser conservador");

// UTF-8 continua sendo o caminho principal, com os acentos preservados.
assert.equal(decodeSpreadsheetText(Buffer.from("descrição;valor\naçaí;10\n", "utf8")),
  "descrição;valor\naçaí;10\n");

// CSV salvo em Windows-1252 (o que o Excel em portugues gera): reconhecido como
// planilha CSV e decodificado com os acentos CERTOS, nao como mojibake.
const CSV_1252 = Buffer.from("descrição;valor\naçaí;10,50\nsão paulo;3\n", "latin1");
assert.ok(!CSV_1252.includes(0x00));
assert.equal(detectSpreadsheetKind(CSV_1252), "csv", "CSV Windows-1252 e planilha");
assert.equal(assertSpreadsheetContent(CSV_1252, "extrato.csv"), "csv");
assert.equal(decodeSpreadsheetText(CSV_1252), "descrição;valor\naçaí;10,50\nsão paulo;3\n");

// O parser precisa consumir o MESMO decoder do gate: sem isso, um CSV que
// passa como Windows-1252 chegaria aqui como UTF-8 e teria chaves e valores
// corrompidos por mojibake.
const csv1252ArrayBuffer = CSV_1252.buffer.slice(
  CSV_1252.byteOffset,
  CSV_1252.byteOffset + CSV_1252.byteLength,
) as ArrayBuffer;
assert.deepEqual(parseCsvRows(csv1252ArrayBuffer), [
  { "descrição": "açaí", valor: "10,50" },
  { "descrição": "são paulo", valor: "3" },
]);

// Byte 0x80 do Windows-1252 e o simbolo do euro (nao existe em ISO-8859-1).
assert.equal(decodeSpreadsheetText(Buffer.from([0x76, 0x61, 0x6c, 0x3b, 0x80, 0x31, 0x30])), "val;€10");

// Binario SEM byte NUL, mas cheio de caracteres de controle: nao e texto.
const binario = Buffer.from(
  Array.from({ length: 512 }, (_, index) => (index % 2 === 0 ? 0x01 + (index % 0x1f) : 0x80 + (index % 0x1f))),
);
assert.ok(!binario.includes(0x00), "o teste precisa ser sem NUL");
assert.equal(decodeSpreadsheetText(binario), null, "binario sem NUL nao e texto");
assert.equal(detectSpreadsheetKind(binario), null);

// NUL continua reprovando de saida.
assert.equal(decodeSpreadsheetText(Buffer.from([0x64, 0x00, 0x61])), null);

// Sequencia UTF-8 incompleta no fim do ARQUIVO continua null (nao cai no
// Windows-1252 para virar mojibake com cara de texto valido).
assert.equal(decodeSpreadsheetText(Buffer.from([0xc3])), null);
assert.equal(decodeSpreadsheetText(Buffer.from("a;b\n", "utf8")), "a;b\n");
// A mesma sequencia incompleta, agora declarada como corte de amostra: vale.
assert.equal(decodeSpreadsheetText(Buffer.from([0x61, 0xc3]), { truncated: true }), "a");

// Arquivo MAIOR que a amostra, com multibyte partido exatamente no limite da
// leitura: continua valido, porque ali o corte e da amostra e nao do arquivo.
const cortadoNoLimite = Buffer.concat([
  Buffer.alloc(SPREADSHEET_TEXT_SAMPLE_BYTES - 1, 0x61),
  Buffer.from("çambo;10\n", "utf8"),
]);
assert.ok(cortadoNoLimite.length > SPREADSHEET_TEXT_SAMPLE_BYTES);
assert.equal(detectSpreadsheetKind(cortadoNoLimite), "csv", "multibyte cortado no limite da amostra");

// Extensao batendo com o conteudo: devolve o formato real.
assert.equal(assertSpreadsheetContent(CSV, "extrato.csv"), "csv");
assert.equal(assertSpreadsheetContent(ZIP, "modelo.xlsx"), "xlsx");
assert.equal(assertSpreadsheetContent(OLE2, "antigo.xls"), "xls");
assert.equal(assertSpreadsheetContent(CSV, "EXTRATO.CSV"), "csv", "extensao maiuscula");

// EXCECAO GLOBAL: .xls com conteudo xlsx (export do Conta Azul) e aceito e
// devolve 'xlsx', para o chamador escolher o parser certo.
assert.equal(assertSpreadsheetContent(ZIP, "conta-azul.xls"), "xlsx");

// Demais divergencias sao estritas.
const xlsxComOle2 = rejection(() => assertSpreadsheetContent(OLE2, "planilha.xlsx"));
assert.equal((xlsxComOle2 as ApiError).status, 400);
assert.match((xlsxComOle2 as ApiError).message, /não corresponde à extensão/);
assert.match(
  (rejection(() => assertSpreadsheetContent(ZIP, "extrato.csv")) as ApiError).message,
  /não corresponde à extensão/,
);
assert.match(
  (rejection(() => assertSpreadsheetContent(CSV, "extrato.xlsx")) as ApiError).message,
  /não corresponde à extensão/,
);

// Extensao fora do conjunto, ou ausente.
assert.match(
  (rejection(() => assertSpreadsheetContent(CSV, "extrato.txt")) as ApiError).message,
  /Use CSV, XLS ou XLSX/,
);
assert.match(
  (rejection(() => assertSpreadsheetContent(CSV, "extrato")) as ApiError).message,
  /Use CSV, XLS ou XLSX/,
);

// Conteudo irreconhecivel com extensao valida.
assert.match(
  (rejection(() => assertSpreadsheetContent(Buffer.alloc(0), "vazio.csv")) as ApiError).message,
  /não é uma planilha CSV, XLS ou XLSX válida/,
);
assert.match(
  (rejection(() => assertSpreadsheetContent(PNG, "disfarce.xlsx")) as ApiError).message,
  /não é uma planilha CSV, XLS ou XLSX válida/,
);

/* -------------------------------------------------------------------------- */
/* Nao-regressao: o caminho de ANEXO nao passou a aceitar planilha              */
/* -------------------------------------------------------------------------- */

assert.equal(detectFileSignature(ZIP), null, "anexo nao reconhece ZIP");
assert.equal(detectFileSignature(OLE2), null, "anexo nao reconhece OLE2");
assert.equal(detectFileSignature(CSV), null, "anexo nao reconhece CSV");
assert.deepEqual(SIGNATURE_MIME_TYPES, ["application/pdf", "image/jpeg", "image/png"]);
for (const [conteudo, declarado, nome] of [
  [ZIP, "application/pdf", "planilha.pdf"],
  [OLE2, "image/png", "planilha.png"],
  [CSV, "application/pdf", "texto.pdf"],
] as const) {
  assert.match(
    (rejection(() => assertFileSignature(conteudo, declarado, nome)) as ApiError).message,
    /não é um PDF, JPG ou PNG válido/,
    `anexo deveria recusar ${nome}`,
  );
}

console.log(
  "OK: magic bytes de PDF/JPEG/PNG e de CSV/XLS/XLSX, excecao .xls do Conta Azul e anexos inalterados.",
);
