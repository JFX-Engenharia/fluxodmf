"use client";

import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useFetchData } from "@/components/panel/useFetchData";

type Work = { id: string; name: string };
type Tag = { id: string; name: string; color: string; active: boolean };
type ReasonAction = "REPROVAR" | "TRANSFERIR" | "CANCELAR" | "SOLICITAR_INFO" | "REABRIR";
type Reason = { id: string; action: ReasonAction; label: string; active: boolean; sortOrder: number };
type Config = { works: Work[]; tags: Tag[]; reasons: Reason[] };
const emptyTag = { id: "", name: "", color: "#3157A4", active: true };
const emptyReason = { id: "", reasonAction: "REPROVAR" as ReasonAction, label: "", sortOrder: "0", active: true };
const reasonLabels: Record<ReasonAction, string> = { REPROVAR: "Reprovação", TRANSFERIR: "Remarcação", CANCELAR: "Cancelamento", SOLICITAR_INFO: "Solicitação de informação", REABRIR: "Reabertura" };

export function FinanceConfigTab() {
  const { data, error, loading, reload, setError } = useFetchData<Config>("/api/admin/finance-config");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState(emptyTag);
  const [reason, setReason] = useState(emptyReason);

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/admin/finance-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) { setError(result.error ?? "Não foi possível salvar a configuração."); return false; } setMessage(body.action === "delete" ? "Configuração excluída." : "Configuração salva."); reload(); return true; }
    catch { setError("Falha de conexão ao salvar a configuração."); return false; } finally { setBusy(false); }
  }
  async function remove(resource: string, id: string) { if (confirm("Excluir esta configuração?")) await send({ resource, action: "delete", id }); }
  async function saveTag(e: FormEvent) { e.preventDefault(); if (await send({ resource: "tag", action: "save", ...tag, id: tag.id || undefined })) setTag(emptyTag); }
  async function saveReason(e: FormEvent) { e.preventDefault(); if (await send({ resource: "reason", action: "save", ...reason, id: reason.id || undefined, sortOrder: Number(reason.sortOrder) })) setReason(emptyReason); }

  if (loading || !data) return <div className="panel pad">Carregando configurações financeiras...</div>;
  return <>
    {error ? <div className="alert error">{error}</div> : null}{message ? <div className="alert success">{message}</div> : null}

    <section className="split-grid"><div className="panel pad form-grid"><h2>Tags personalizadas</h2><form className="toolbar" onSubmit={saveTag}><input className="input" placeholder="Nome da tag" value={tag.name} onChange={(e) => setTag({ ...tag, name: e.target.value })} required /><input className="input color-input" type="color" value={tag.color} onChange={(e) => setTag({ ...tag, color: e.target.value })} /><button className="button" disabled={busy}><Plus size={16} /> Salvar</button></form><div className="tag-list">{data.tags.map((item) => <span className="tag-chip" style={{ borderColor: item.color }} key={item.id}><i style={{ background: item.color }} />{item.name}<button type="button" onClick={() => setTag({ id: item.id, name: item.name, color: item.color, active: item.active })}><Pencil size={12} /></button><button type="button" onClick={() => void remove("tag", item.id)}><Trash2 size={12} /></button></span>)}</div></div>
      <div className="panel pad form-grid"><h2>Motivos padronizados</h2><form className="form-grid" onSubmit={saveReason}><select className="select" value={reason.reasonAction} onChange={(e) => setReason({ ...reason, reasonAction: e.target.value as ReasonAction })}>{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="input" placeholder="Motivo" value={reason.label} onChange={(e) => setReason({ ...reason, label: e.target.value })} required /><button className="button" disabled={busy}><Save size={16} /> Salvar motivo</button></form><div className="detail-list">{data.reasons.map((item) => <div className="detail-item" key={item.id}><span>{reasonLabels[item.action]}</span><strong>{item.label}</strong><div className="button-row"><button className="icon-button" type="button" onClick={() => setReason({ id: item.id, reasonAction: item.action, label: item.label, sortOrder: String(item.sortOrder), active: item.active })}><Pencil size={14} /></button><button className="icon-button" type="button" onClick={() => void remove("reason", item.id)}><Trash2 size={14} /></button></div></div>)}</div></div></section>

  </>;
}
