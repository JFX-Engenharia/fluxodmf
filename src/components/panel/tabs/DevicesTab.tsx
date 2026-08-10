"use client";

import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime } from "@/lib/format";

type DeviceRow = {
  id: string;
  name: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
};

type DevicesResponse = {
  devices: DeviceRow[];
  error?: string;
};

export function DevicesTab() {
  const { data, error, loading, reload, setError } =
    useFetchData<DevicesResponse>("/api/devices");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function revokeDevice(device: DeviceRow) {
    const warning = device.current
      ? "Revogar este dispositivo encerrará sua sessão atual. Continuar?"
      : `Revogar ${device.name}? As sessões abertas nele serão encerradas.`;
    if (!window.confirm(warning)) return;

    setBusyId(device.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      const value = (await response.json()) as { error?: string; current?: boolean };
      if (!response.ok) throw new Error(value.error ?? "Não foi possível revogar o dispositivo.");
      if (value.current) {
        window.location.assign("/login");
        return;
      }
      setMessage("Dispositivo revogado.");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="section">
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <div className="section-heading">
        <div>
          <h2>Meus dispositivos</h2>
          <p>Revogar um dispositivo encerra todas as sessões abertas nele.</p>
        </div>
        <button className="button secondary" type="button" onClick={reload} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>Registrado em</th>
                <th>Último acesso</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    <strong title={device.userAgent ?? undefined}>{device.name}</strong>
                    {device.current ? <div className="muted">Este dispositivo</div> : null}
                  </td>
                  <td>{dateTime(device.createdAt)}</td>
                  <td>{dateTime(device.lastSeenAt)}</td>
                  <td>
                    <span className={`status ${device.revokedAt ? "CANCELADO" : "APROVADO"}`}>
                      {device.revokedAt ? "Revogado" : "Ativo"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="button danger"
                      type="button"
                      disabled={!!device.revokedAt || busyId === device.id}
                      onClick={() => void revokeDevice(device)}
                    >
                      <Trash2 size={14} />
                      {busyId === device.id ? "Revogando..." : "Revogar"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !data?.devices.length ? (
                <tr><td className="daily-flow-empty" colSpan={5}>Nenhum dispositivo registrado.</td></tr>
              ) : null}
              {loading ? (
                <tr><td className="daily-flow-empty" colSpan={5}>Carregando dispositivos...</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
