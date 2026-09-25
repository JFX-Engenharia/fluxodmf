/** Aceita somente IDs; nunca um endereço arbitrário de redirecionamento. */
export function validRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined;
}

export function requestDestination(value: unknown) {
  const id = validRequestId(value);
  return id ? `/painel?tab=solicitacoes&request=${encodeURIComponent(id)}` : "/painel";
}
