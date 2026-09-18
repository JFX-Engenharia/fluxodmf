"use client";

import { useRef, useState, type FormEvent } from "react";
import { requestJson } from "./types";

export function ResponseForm({ id, attachmentCount, onResponded }: { id: string; attachmentCount: number; onResponded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const body = new FormData(form);
    setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try {
      await requestJson(`/api/payment-requests/${id}/respond`, { method: "POST", headers: { "Idempotency-Key": key.current }, body });
      key.current = null; form.reset(); onResponded();
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return <form className="request-response" onSubmit={submit} onChange={() => { key.current = null; }}>
    <fieldset className="request-fieldset field" disabled={busy}><legend>Responder à solicitação de informação</legend>
      <label htmlFor={`response-${id}`}>Sua resposta</label><textarea id={`response-${id}`} className="textarea" name="note" required maxLength={2000} />
      {attachmentCount < 10 && <><label htmlFor={`response-files-${id}`}>Anexos adicionais (opcionais)</label><input className="input" id={`response-files-${id}`} name="attachments" type="file" multiple accept="application/pdf,image/jpeg,image/png" /></>}
      <small className="muted">{attachmentCount} de 10 anexos utilizados. Cada arquivo deve ter até 5 MB.</small>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div><button className="button primary" disabled={busy}>{busy ? "Enviando..." : "Enviar resposta"}</button></div>
    </fieldset>
  </form>;
}
