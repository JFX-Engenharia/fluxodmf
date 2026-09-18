"use client";

import { useState, type FormEvent } from "react";
import type { PanelUserRow } from "@/components/panel/tabs/UsersTab";
import { useFetchData } from "@/components/panel/useFetchData";
import { roleLabels } from "@/lib/permissions";

type Settings = { threshold: number | null; approvers: Pick<PanelUserRow, "id" | "name" | "status" | "role">[]; updatedAt: string };

export function HighValueSettings({ users }: { users: PanelUserRow[] }) {
  const { data, error, loading, reload } = useFetchData<{ settings: Settings }>("/api/admin/payment-request-settings");
  return <section className="section">
    <div className="section-header"><div><h2>Aprovação de alto valor</h2><span className="muted">Acima do limite, a compra vai direto ao Dono ou a um substituto designado.</span></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {loading && !data ? <div className="panel pad">Carregando alçada...</div> : null}
    {data && <SettingsForm key={data.settings.updatedAt} settings={data.settings} users={users} onSaved={reload} />}
  </section>;
}

function SettingsForm({ settings, users, onSaved }: { settings: Settings; users: PanelUserRow[]; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.threshold !== null);
  const [threshold, setThreshold] = useState(settings.threshold?.toString() ?? "");
  const [ids, setIds] = useState(settings.approvers.map(a => a.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const eligible = users.filter(u => u.status === "ATIVO" && u.role !== "COLABORADOR");
  const activeIds = ids.filter(id => eligible.some(u => u.id === id));
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/payment-request-settings", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: enabled ? Number(threshold) : null, approverIds: activeIds }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a alçada.");
      setMessage("Alçada salva. Os pedidos de alto valor abertos foram atualizados para os designados selecionados.");
      // Não remonta o formulário: conserva a confirmação visível após o salvamento.
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return <form className="panel pad form-grid two" onSubmit={save}>
    <label className="checkbox-line span-2"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} /> Usar limite para aprovação de alto valor</label>
    <div className="field"><label htmlFor="high-value-threshold">Valor limite (R$)</label><input id="high-value-threshold" className="input" type="number" min="0" max="999999999999.99" step="0.01" value={threshold} onChange={e => setThreshold(e.target.value)} disabled={!enabled || busy} required={enabled} /><small className="muted">Até este valor, todos os responsáveis da obra aprovam.</small></div>
    <fieldset className="field request-fieldset"><legend>Designados: Dono e substitutos</legend><div className="checkbox-grid">
      {eligible.map(u => <label className="checkbox-line" key={u.id}><input type="checkbox" checked={ids.includes(u.id)} disabled={busy} onChange={() => setIds(ids.includes(u.id) ? ids.filter(id => id !== u.id) : [...ids, u.id])} />{u.name} ({roleLabels[u.role]})</label>)}
    </div><small className="muted">Qualquer designado decide sozinho. O perfil Administrador não dispensa esta designação.</small></fieldset>
    {!activeIds.length && <div className="alert warning span-2" role="alert">Nenhum designado ativo selecionado. Selecione alguém para receber e decidir pedidos de alto valor.</div>}
    <p className="muted span-2">Alterar o limite vale para novos pedidos. Trocar os designados atualiza os pedidos de alto valor ainda abertos, inclusive os que aguardam informação.</p>
    {error && <div className="alert error span-2" role="alert">{error}</div>}
    {message && <div className="alert success span-2" role="status">{message}</div>}
    <div className="form-actions span-2"><button className="button primary" disabled={busy || (enabled && !activeIds.length)}>{busy ? "Salvando..." : "Salvar alçada"}</button><button type="button" className="button secondary" disabled={busy} onClick={onSaved}>Recarregar configuração</button></div>
  </form>;
}
