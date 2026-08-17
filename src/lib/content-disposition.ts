/**
 * Monta o cabecalho Content-Disposition de um download.
 *
 * Sao dois nomes de proposito: o `filename` sem acento nem aspas, que qualquer
 * cliente antigo entende, e o `filename*` em UTF-8 percent-encoded (RFC 5987),
 * que os navegadores atuais preferem e preserva o nome original.
 *
 * Aspas e barras invertidas somem do ASCII porque a quoted-string da RFC 6266 da
 * sentido especial as duas: a aspa fecharia o valor antes da hora, e a barra
 * invertida escaparia o caractere seguinte — um nome terminado em "\" comeria a
 * aspa de fechamento e emendaria o resto do cabecalho no nome do arquivo.
 */
export function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
