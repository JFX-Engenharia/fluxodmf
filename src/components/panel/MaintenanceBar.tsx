"use client";

import clsx from "clsx";
import { Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePanel } from "@/components/panel/PanelContext";
import { Role } from "@/lib/permissions";

type MaintenanceNotice = {
  active: boolean;
  activatedByName: string | null;
  activatedAt: string | null;
  reason: string | null;
  estimatedEndAt: string | null;
};

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function isMaintenanceNotice(value: unknown): value is MaintenanceNotice {
  return !!value && typeof value === "object" && "active" in value && typeof value.active === "boolean";
}

export function MaintenanceBar() {
  const { user } = usePanel();
  const isAdministrator = user.role === Role.ADMINISTRADOR;
  const [notice, setNotice] = useState<MaintenanceNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/maintenance")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (
          mounted &&
          value &&
          typeof value === "object" &&
          "notice" in value &&
          isMaintenanceNotice(value.notice)
        ) {
          setNotice(value.notice);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (saving || !isAdministrator) return;
    const next = !(notice?.active ?? false);
    let reason: string | null = null;
    let estimatedEndAt: string | null = null;
    if (next) {
      reason = window.prompt("Informe o motivo da manutenção:")?.trim() ?? "";
      if (reason.length < 3) return;
      const estimate = window.prompt(
        "Previsão de retorno (opcional, formato AAAA-MM-DD HH:mm):",
      )?.trim();
      if (estimate) {
        const parsed = new Date(estimate.replace(" ", "T"));
        if (Number.isNaN(parsed.getTime())) {
          setError("Previsão de retorno inválida.");
          return;
        }
        estimatedEndAt = parsed.toISOString();
      }
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next, reason, estimatedEndAt }),
      });
      const value: unknown = await response.json();
      if (
        !response.ok ||
        !value ||
        typeof value !== "object" ||
        !("notice" in value) ||
        !isMaintenanceNotice(value.notice)
      ) {
        const detail =
          value && typeof value === "object" && "error" in value && typeof value.error === "string"
            ? value.error
            : "Não foi possível atualizar o aviso.";
        throw new Error(detail);
      }
      setNotice(value.notice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de conexão.");
    } finally {
      setSaving(false);
    }
  }, [isAdministrator, notice, saving]);

  const active = notice?.active ?? false;
  if (!active && !isAdministrator) return <div aria-hidden="true" />;

  return (
    <div className={clsx("maintenance-bar", active && "on")} role="status" aria-live="polite">
      <span className="maintenance-icon" aria-hidden="true"><Wrench size={16} /></span>
      <div className="maintenance-text">
        {active ? (
          <>
            <strong>Sistema em modo somente leitura{notice?.reason ? `: ${notice.reason}` : "."}</strong>
            <span>
              {notice?.activatedByName && notice.activatedAt
                ? `Iniciado por ${notice.activatedByName} em ${dateTimeLabel(notice.activatedAt)}.`
                : ""}
              {notice?.estimatedEndAt ? ` Previsão de retorno: ${dateTimeLabel(notice.estimatedEndAt)}.` : ""}
            </span>
          </>
        ) : <span>Nenhuma manutenção sinalizada no momento.</span>}
        {error ? <em className="maintenance-error">{error}</em> : null}
      </div>
      {isAdministrator ? (
        <button
          type="button"
          className={clsx("maintenance-toggle", active && "on")}
          role="switch"
          aria-checked={active}
          aria-label={active ? "Encerrar aviso de manutenção" : "Sinalizar manutenção"}
          disabled={saving}
          onClick={toggle}
        >
          <span className="maintenance-toggle-track" aria-hidden="true"><span className="maintenance-toggle-thumb" /></span>
          <span className="maintenance-toggle-label">{active ? "Ativa" : "Inativa"}</span>
        </button>
      ) : null}
    </div>
  );
}
