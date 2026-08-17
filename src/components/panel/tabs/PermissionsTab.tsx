"use client";

import { Check, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { OperationalExports } from "@/components/panel/OperationalExports";
import { usePanel } from "@/components/panel/PanelContext";
import type { PanelUserRow } from "@/components/panel/tabs/UsersTab";
import { useFetchData } from "@/components/panel/useFetchData";
import { userStatusLabels } from "@/lib/format";
import { Role, roleDescriptions, roleLabels, tabRoles, TAB_IDS } from "@/lib/permissions";

type UsersResponse = {
  users: PanelUserRow[];
  works: { id: string; name: string }[];
  error?: string;
};

type ManagedWork = {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  active: boolean;
  responsibleUsers: Array<{ id: string; name: string }>;
};

type ManagedWorksResponse = { works: ManagedWork[] };

const tabLabels: Record<(typeof TAB_IDS)[number], string> = {
  dashboard: "Dashboard",
  indicadores: "Indicadores",
  calendario: "Calendário",
  importar: "Importação",
  aprovados: "Aprovados",
  solicitacoes: "Solicitações",
  conciliacao: "Conciliação",
  pagamentos: "Pagamentos",
  adiantamentos: "Adiantamentos",
  dispositivos: "Dispositivos",
  usuarios: "Usuários",
  permissoes: "Permissões",
  logs: "Logs",
  notas: "Envio de notas",
  "notas-colaboradores": "Notas dos colaboradores",
};

export function PermissionsTab() {
  const { user: currentUser } = usePanel();
  const { data, error, loading, reload, setError } =
    useFetchData<UsersResponse>("/api/admin/users");
  const { data: worksData, reload: reloadWorks } =
    useFetchData<ManagedWorksResponse>("/api/admin/works");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [newWork, setNewWork] = useState({ name: "", aliases: "", responsibleUserIds: [] as string[] });

  // Solicitacao pendente ainda nao tem perfil definido: so aparece na aba Usuarios.
  const users = (data?.users ?? []).filter((item) => item.status !== "PENDENTE");
  const approverUsers = users.filter(
    (item) =>
      item.status === "ATIVO" &&
      (item.role === Role.GESTOR || item.role === Role.ADMINISTRADOR),
  );
  const works = data?.works ?? [];

  async function update(id: string, body: Record<string, unknown>, successMessage: string) {
    setBusyId(id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível alterar a permissão.");
        return;
      }

      setMessage(successMessage);
      reload();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  function toggleWork(target: PanelUserRow, workId: string) {
    const current = target.works.map((work) => work.id);
    const next = current.includes(workId)
      ? current.filter((id) => id !== workId)
      : [...current, workId];

    void update(target.id, { workIds: next }, `Contas de ${target.name} atualizadas.`);
  }

  async function toggleResponsible(work: ManagedWork, userId: string) {
    const responsibleUserIds = work.responsibleUsers.some((user) => user.id === userId)
      ? work.responsibleUsers.filter((user) => user.id !== userId).map((user) => user.id)
      : [...work.responsibleUsers.map((user) => user.id), userId];
    setBusyId(work.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/works", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: work.id,
          name: work.name,
          slug: work.slug,
          aliases: work.aliases,
          active: work.active,
          responsibleUserIds,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível definir os responsáveis.");
        return;
      }
      setMessage(`Responsáveis de ${work.name} atualizados.`);
      reloadWorks();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  async function createWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("new-work");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWork.name,
          aliases: newWork.aliases
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean),
          responsibleUserIds: newWork.responsibleUserIds,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível criar a conta.");
        return;
      }
      setNewWork({ name: "", aliases: "", responsibleUserIds: [] });
      setMessage(`Conta ${body.work.name} criada.`);
      reloadWorks();
      reload();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <section className="section">
        <div className="section-header">
          <h2>O que cada perfil acessa</h2>
        </div>
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Perfil</th>
                  {TAB_IDS.map((tab) => (
                    <th key={tab}>{tabLabels[tab]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(Role).map((role) => (
                  <tr key={role}>
                    <td>
                      <strong>{roleLabels[role]}</strong>
                      <br />
                      <small className="muted">{roleDescriptions[role]}</small>
                    </td>
                    {TAB_IDS.map((tab) => (
                      <td key={tab}>
                        {tabRoles[tab].includes(role) ? (
                          <Check size={16} color="var(--success)" aria-label="Tem acesso" />
                        ) : (
                          <span className="muted" aria-label="Sem acesso">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Perfil de cada usuário</h2>
        </div>
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Status</th>
                  <th>Perfil</th>
                  <th>Contas vinculadas</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={4}>
                      Carregando...
                    </td>
                  </tr>
                ) : null}
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <br />
                      <small className="muted">{item.username}</small>
                    </td>
                    <td>
                      <small className="muted">{userStatusLabels[item.status]}</small>
                    </td>
                    <td>
                      <select
                        className="select"
                        value={item.role}
                        disabled={busyId === item.id}
                        onChange={(event) =>
                          update(
                            item.id,
                            { role: event.target.value },
                            `${item.name} agora é ${roleLabels[event.target.value as Role]}.`,
                          )
                        }
                        aria-label={`Perfil de ${item.name}`}
                      >
                        {Object.values(Role).map((role) => (
                          <option key={role} value={role}>
                            {roleLabels[role]}
                          </option>
                        ))}
                      </select>
                      {item.id === currentUser.id ? (
                        <>
                          <br />
                          <small className="muted">
                            <ShieldCheck size={11} /> sua conta
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <div className="checkbox-grid">
                        {works.map((work) => (
                          <label className="checkbox-line" key={work.id}>
                            <input
                              type="checkbox"
                              checked={item.works.some((linked) => linked.id === work.id)}
                              disabled={busyId === item.id}
                              onChange={() => toggleWork(item, work.id)}
                            />
                            {work.name}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={4}>
                      Nenhum usuário ativo.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-header">
          <div>
            <h2>Adicionar conta manualmente</h2>
            <span className="muted">Cadastre uma obra antes da importação e defina quem aprova suas solicitações.</span>
          </div>
        </div>
        <form className="panel pad form-grid two" onSubmit={createWork}>
          <div className="field">
            <label htmlFor="new-work-name">Nome da conta ou obra</label>
            <input
              className="input"
              id="new-work-name"
              value={newWork.name}
              onChange={(event) => setNewWork({ ...newWork, name: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <span>Responsáveis pela aprovação</span>
            <div className="checkbox-grid">
              {approverUsers.map((item) => (
                <label className="checkbox-line" key={item.id}>
                  <input
                    type="checkbox"
                    checked={newWork.responsibleUserIds.includes(item.id)}
                    onChange={() =>
                      setNewWork({
                        ...newWork,
                        responsibleUserIds: newWork.responsibleUserIds.includes(item.id)
                          ? newWork.responsibleUserIds.filter((id) => id !== item.id)
                          : [...newWork.responsibleUserIds, item.id],
                      })
                    }
                  />
                  {item.name} ({roleLabels[item.role]})
                </label>
              ))}
              {!approverUsers.length ? <span className="muted">Não definido</span> : null}
            </div>
            <small className="muted">
              As pessoas indicadas precisam todas aprovar as solicitações de pagamento daquela obra.
            </small>
          </div>
          <div className="field span-2">
            <label htmlFor="new-work-aliases">Apelidos usados na planilha</label>
            <input
              className="input"
              id="new-work-aliases"
              value={newWork.aliases}
              onChange={(event) => setNewWork({ ...newWork, aliases: event.target.value })}
              placeholder="Separe os apelidos por vírgula"
            />
          </div>
          <div className="form-actions span-2">
            <button className="button primary" disabled={busyId === "new-work"}>
              Adicionar conta
            </button>
          </div>
        </form>
      </section>
      <section className="section">
        <div className="section-header">
          <div>
            <h2>Responsáveis pelas obras</h2>
            <span className="muted">As pessoas indicadas precisam todas aprovar as solicitações de pagamento daquela obra.</span>
          </div>
        </div>
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>Responsáveis pela aprovação</th>
                </tr>
              </thead>
              <tbody>
                {(worksData?.works ?? []).filter((work) => work.active).map((work) => (
                  <tr key={work.id}>
                    <td>{work.name}</td>
                    <td>
                      <div className="checkbox-grid">
                        {approverUsers.map((item) => (
                          <label className="checkbox-line" key={item.id}>
                            <input
                              type="checkbox"
                              checked={work.responsibleUsers.some((user) => user.id === item.id)}
                              disabled={busyId === work.id}
                              onChange={() => void toggleResponsible(work, item.id)}
                            />
                            {item.name} ({roleLabels[item.role]})
                          </label>
                        ))}
                        {!work.responsibleUsers.length ? <span className="muted">Não definido</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {worksData && worksData.works.filter((work) => work.active).length === 0 ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={2}>
                      Nenhuma obra ativa.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <OperationalExports />
    </>
  );
}
