"use client";

import clsx from "clsx";
import { Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type MaintenanceNotice = {
  active: boolean;
  activatedByName: string | null;
  activatedAt: string | null;
};

/** So a hora (HH:mm) — o texto diz "desde as {horario}". */
function hourLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(
    new Date(value),
  );
}

/**
 * Barra de manutenção do painel, visível apenas para administradores (o
 * PanelShell só a renderiza para esse perfil). O toggle liga/desliga o aviso e,
 * quando ligado, mostra quem sinalizou a manutenção e desde quando.
 */
export function MaintenanceBar() {
  const [notice, setNotice] = useState<MaintenanceNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetch("/api/maintenance")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && body?.notice) setNotice(body.notice as MaintenanceNotice);
      })
      .catch(() => {
        /* Falha ao ler nao deve derrubar o painel; o toggle segue disponivel. */
      });

    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (saving) return;
    const next = !(notice?.active ?? false);
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Não foi possível atualizar o aviso.");
      }
      setNotice(body.notice as MaintenanceNotice);
    } catch (err) {
      const message = (err as Error).message;
      setError(message === "Failed to fetch" ? "Falha de conexão." : message);
    } finally {
      setSaving(false);
    }
  }, [notice, saving]);

  const active = notice?.active ?? false;

  return (
    <div className={clsx("maintenance-bar", active && "on")} role="status" aria-live="polite">
      <span className="maintenance-icon" aria-hidden="true">
        <Wrench size={16} />
      </span>

      <div className="maintenance-text">
        {active && notice?.activatedByName && notice.activatedAt ? (
          <strong>
            o {notice.activatedByName} está sinalizando uma manutenção no sistema desde as{" "}
            {hourLabel(notice.activatedAt)}!
          </strong>
        ) : (
          <span>Nenhuma manutenção sinalizada no momento.</span>
        )}
        {error ? <em className="maintenance-error">{error}</em> : null}
      </div>

      <button
        type="button"
        className={clsx("maintenance-toggle", active && "on")}
        role="switch"
        aria-checked={active}
        aria-label={active ? "Encerrar aviso de manutenção" : "Sinalizar manutenção"}
        title={active ? "Encerrar aviso de manutenção" : "Sinalizar manutenção"}
        disabled={saving}
        onClick={toggle}
      >
        <span className="maintenance-toggle-track" aria-hidden="true">
          <span className="maintenance-toggle-thumb" />
        </span>
        <span className="maintenance-toggle-label">{active ? "Ativa" : "Inativa"}</span>
      </button>
    </div>
  );
}
