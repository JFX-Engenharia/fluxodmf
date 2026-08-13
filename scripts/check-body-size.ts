import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import { assertBodySize, MEGABYTE } from "../src/lib/body-size";

const LIMITE = 30 * MEGABYTE;

function requestWith(contentLength: string | null) {
  const headers = new Headers({ "content-type": "multipart/form-data; boundary=x" });
  if (contentLength !== null) headers.set("content-length", contentLength);
  const request = new Request("https://fluxo.local/api/payment-requests", {
    method: "POST",
    headers,
  });
  // Garante que o teste esta mesmo exercitando o cabecalho, e nao um Request
  // que o silenciou. Headers apara espaços das pontas, entao a comparacao usa o
  // valor ja normalizado.
  assert.equal(request.headers.get("content-length"), contentLength?.trim() ?? null);
  return request;
}

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, "deveria lancar ApiError");
    return error as ApiError;
  }
  throw new Error("deveria ter recusado o envio");
}

// Dentro do teto: passa.
assertBodySize(requestWith("0"), LIMITE);
assertBodySize(requestWith(String(1_024)), LIMITE);
assertBodySize(requestWith(String(LIMITE - 1)), LIMITE);
// Exatamente no teto ainda e valido: o corte e no que EXCEDE.
assertBodySize(requestWith(String(LIMITE)), LIMITE);

// Acima do teto: 413 com o limite em MB na mensagem.
const excedeu = rejection(() => assertBodySize(requestWith(String(LIMITE + 1)), LIMITE));
assert.equal(excedeu.status, 413);
assert.match(excedeu.message, /excede o limite de 30 MB/);
assert.equal(
  rejection(() => assertBodySize(requestWith(String(500 * MEGABYTE)), LIMITE)).status,
  413,
);

// Sem Content-Length (envio chunked): segue adiante de proposito.
assertBodySize(requestWith(null), LIMITE);

// Cabecalho invalido tambem segue adiante — quem garante o tamanho gravado sao
// as validacoes por arquivo, ja aplicadas depois.
const INVALIDOS = [
  "",
  "abc",
  "12.5",
  "-1",
  "1e3",
  "+1",
  "0x10",
  " 1e100",
  "1_000",
  "  ",
  "10, 20",
  // Digitos nao-ASCII nao entram na lista: Headers so aceita ByteString, entao
  // um valor desses nem chega a existir num request real.
];
for (const invalido of INVALIDOS) {
  assertBodySize(requestWith(invalido), LIMITE);
}

// Com teto BAIXO, um cabecalho invalido nao pode ser convertido em numero e
// virar 413: e o caso do "1e3", que Number() leria como 1000. Prova de que
// nenhum deles chega a ser comparado com o teto.
const TETO_BAIXO = 10;
for (const invalido of INVALIDOS) {
  assertBodySize(requestWith(invalido), TETO_BAIXO);
}
// Controle: o mesmo teto baixo recusa um valor decimal legitimo equivalente.
assert.equal(rejection(() => assertBodySize(requestWith("1000"), TETO_BAIXO)).status, 413);
assert.equal(rejection(() => assertBodySize(requestWith("11"), TETO_BAIXO)).status, 413);
assertBodySize(requestWith("10"), TETO_BAIXO);
// Digitos puros gigantes continuam sendo recusados (nao sao "invalidos").
assert.equal(
  rejection(() => assertBodySize(requestWith("9".repeat(30)), LIMITE)).status,
  413,
);

// O teto e parametro: um limite menor recusa o mesmo envio que 30 MB aceitava.
assertBodySize(requestWith(String(6 * MEGABYTE)), 30 * MEGABYTE);
assert.match(
  rejection(() => assertBodySize(requestWith(String(6 * MEGABYTE)), 5 * MEGABYTE)).message,
  /excede o limite de 5 MB/,
);

console.log("OK: Content-Length acima do teto recusado com 413; ausente ou invalido segue adiante.");
