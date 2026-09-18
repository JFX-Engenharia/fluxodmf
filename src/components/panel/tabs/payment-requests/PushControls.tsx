"use client";

import { useEffect, useState } from "react";
import { isInstalledPwa, isIosDevice } from "@/lib/pwa-client";
import { requestJson } from "./types";

type PushState = { kind: "loading" | "unsupported" | "install" | "disabled" | "denied" | "ready" | "active"; publicKey?: string; endpoint?: string };
type Config = { enabled: boolean; publicKey: string | null; endpoints: string[] };

function applicationKey(key: string) {
  const bytes = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}

async function inspectPush(): Promise<PushState> {
  if (isIosDevice() && !isInstalledPwa()) return { kind: "install" };
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { kind: "unsupported" };
  const config = await requestJson<Config>("/api/push/subscriptions", { cache: "no-store" });
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription && config.endpoints.includes(subscription.endpoint) ? subscription.endpoint : undefined;
  if (!config.enabled || !config.publicKey) return { kind: "disabled", endpoint };
  if (Notification.permission === "denied") return { kind: "denied", endpoint, publicKey: config.publicKey };
  const expected = applicationKey(config.publicKey);
  const current = subscription?.options.applicationServerKey;
  const matchesKey = current && new Uint8Array(current).every((byte, index) => byte === expected[index]) && current.byteLength === expected.length;
  return { kind: endpoint && matchesKey && Notification.permission === "granted" ? "active" : "ready", endpoint, publicKey: config.publicKey };
}

export function PushControls() {
  const [state, setState] = useState<PushState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const check = () => { void inspectPush().then(value => { if (active) { setState(value); setError(""); } }).catch(() => { if (active) setError("Não foi possível consultar os avisos deste aparelho."); }); };
    check(); window.addEventListener("focus", check);
    return () => { active = false; window.removeEventListener("focus", check); };
  }, []);
  async function activate() {
    if (!state.publicKey) return;
    setBusy(true); setError("");
    try {
      // Deve ser o primeiro await do clique, especialmente no iPhone instalado.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState({ ...state, kind: permission === "denied" ? "denied" : "ready" }); return; }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const expected = applicationKey(state.publicKey);
      const current = subscription?.options.applicationServerKey;
      if (subscription && (!current || current.byteLength !== expected.length || !new Uint8Array(current).every((byte, index) => byte === expected[index]))) {
        await requestJson("/api/push/subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected });
      await requestJson("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      setState({ ...state, kind: "active", endpoint: subscription.endpoint });
    } catch { setError("Não foi possível ativar os avisos. Confira a conexão e as permissões deste navegador e tente novamente."); }
    finally { setBusy(false); }
  }
  async function deactivate() {
    if (!state.endpoint) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/push/subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: state.endpoint }) });
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription?.endpoint === state.endpoint) await subscription.unsubscribe();
      setState(await inspectPush());
    } catch { setError("Não foi possível desativar os avisos. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <aside className="panel pad section request-push-controls" aria-label="Avisos neste aparelho">
    <div className="section-header"><div><strong>Avisos neste aparelho</strong><p className="muted">Receba novidades das suas solicitações. Confira também as pendências no menu.</p></div>
      {state.kind === "ready" && <button className="button primary" type="button" disabled={busy} onClick={activate}>{busy ? "Ativando..." : "Ativar avisos neste aparelho"}</button>}
      {state.kind === "active" && <span className="status APROVADO" role="status">Avisos ativos</span>}
      {state.endpoint && <button className="button secondary" type="button" disabled={busy} onClick={deactivate}>Desativar avisos</button>}
    </div>
    {state.kind === "install" && <p>No iPhone ou iPad, toque em Compartilhar e em <strong>Adicionar à Tela de Início</strong>. Abra o aplicativo por esse ícone para ativar os avisos. Requer iOS/iPadOS 16.4 ou posterior.</p>}
    {state.kind === "unsupported" && <p className="muted">Este navegador não oferece avisos push aqui. Use um navegador compatível com notificações e abra o endereço seguro (HTTPS) do sistema.</p>}
    {state.kind === "disabled" && <p className="muted">Os avisos ainda não estão disponíveis neste ambiente.</p>}
    {state.kind === "denied" && <p className="muted">As notificações estão bloqueadas. Nas permissões deste site ou nos ajustes de notificações do aplicativo, permita os avisos e volte a esta página.</p>}
    {state.kind === "loading" && !error && <p className="muted">Verificando disponibilidade...</p>}
    {error && <div className="alert error" role="alert">{error}</div>}
  </aside>;
}
