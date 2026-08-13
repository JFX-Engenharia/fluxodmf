"use client";

import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { usePanel } from "@/components/panel/PanelContext";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime, userStatusLabels } from "@/lib/format";
import { Role, roleLabels } from "@/lib/permissions";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { UserStatus } from "@prisma-generated/enums";

export type PanelUserRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  status: keyof typeof userStatusLabels;
  phone: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  works: { id: string; name: string }[];
};

type UsersResponse = {
  users: PanelUserRow[];
  works: { id: string; name: string }[];
  permissions: { canPermanentlyDeleteUsers: boolean };
  error?: string;
};

type AdminDeviceRow = {
  id: string;
  name: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

/** Cor do badge por status, reaproveitando as classes de status de pagamento. */
const statusClass: Record<PanelUserRow["status"], string> = {
  PENDENTE: "PENDENTE",
  ATIVO: "APROVADO",
  RECUSADO: "REPROVADO",
  INATIVO: "CANCELADO",
};

const emptyForm = {
  name: "",
  username: "",
  email: "",
  password: "",
  phone: "",
  role: Role.OPERADOR as Role,
};

/** Campos que a edicao rapida altera. Senha em branco mantem a atual. */
type EditForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  status: PanelUserRow["status"];
  workIds: string[];
};

function editFormFor(user: PanelUserRow): EditForm {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    password: "",
    role: user.role,
    status: user.status,
    workIds: user.works.map((work) => work.id),
  };
}

export function UsersTab() {
  const { user: currentUser } = usePanel();
  const { data, error, loading, reload, setError } =
    useFetchData<UsersResponse>("/api/admin/users");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<PanelUserRow | null>(null);
  const [editing, setEditing] = useState<PanelUserRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [devices, setDevices] = useState<AdminDeviceRow[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceBusyId, setDeviceBusyId] = useState("");
  const deviceRequestId = useRef(0);

  const users = data?.users ?? [];
  const works = data?.works ?? [];
  const canPermanentlyDeleteUsers = data?.permissions.canPermanentlyDeleteUsers ?? false;

  function startEditing(target: PanelUserRow) {
    setEditing(target);
    setEditForm(editFormFor(target));
    setError("");
    setMessage("");
    void loadDevices(target.id);
  }

  function closeEditing() {
    deviceRequestId.current += 1;
    setEditing(null);
    setEditForm(null);
    setDevices([]);
    setDevicesLoading(false);
  }

  async function loadDevices(userId: string) {
    const requestId = ++deviceRequestId.current;
    setDevicesLoading(true);
    setDevices([]);
    try {
      const response = await fetch(`/api/admin/devices?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      const value = (await response.json()) as {
        devices?: AdminDeviceRow[];
        error?: string;
      };
      if (!response.ok) throw new Error(value.error ?? "Não foi possível carregar os dispositivos.");
      if (requestId === deviceRequestId.current) setDevices(value.devices ?? []);
    } catch (caught) {
      if (requestId === deviceRequestId.current) {
        setError(caught instanceof Error ? caught.message : "Falha de conexão.");
      }
    } finally {
      if (requestId === deviceRequestId.current) setDevicesLoading(false);
    }
  }

  async function revokeDevice(device: AdminDeviceRow) {
    if (!editing || !window.confirm(`Revogar ${device.name} de ${editing.name}?`)) return;
    setDeviceBusyId(device.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      const value = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Não foi possível revogar o dispositivo.");
      setMessage(`Dispositivo de ${editing.name} revogado.`);
      await loadDevices(editing.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de conexão.");
    } finally {
      setDeviceBusyId("");
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !editForm) return;

    const body: Record<string, unknown> = {
      name: editForm.name,
      email: editForm.email,
      phone: editForm.phone,
      role: editForm.role,
      status: editForm.status,
      workIds: editForm.workIds,
    };
    // Enviar senha vazia redefiniria a senha do usuario para nada.
    if (editForm.password) body.password = editForm.password;

    const saved = await patchUser(editing.id, body, `${editForm.name} atualizado.`);
    if (saved) closeEditing();
  }

  async function patchUser(id: string, body: Record<string, unknown>, successMessage: string) {
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
        setError(data.error ?? "Não foi possível atualizar o usuário.");
        return false;
      }

      setMessage(successMessage);
      reload();
      return true;
    } catch {
      setError("Falha de conexão.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusyId("new");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível criar o usuário.");
        return;
      }

      setForm(emptyForm);
      setCreating(false);
      setMessage("Usuário criado e já ativo.");
      reload();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteUser(target: PanelUserRow) {
    setBusyId(target.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível excluir o usuário.");
        return;
      }

      setMessage(data.message ?? "Usuário excluído.");
      setConfirmDelete(null);
      reload();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setBusyId("");
    }
  }

  const pending = users.filter((item) => item.status === "PENDENTE");
  const others = users.filter((item) => item.status !== "PENDENTE");

  return (
    <>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {message ? <div className="alert success" role="status">{message}</div> : null}

      <section className="section">
        <div className="section-header">
          <h2>Solicitações de acesso ({pending.length})</h2>
          <button className="button ghost" type="button" onClick={reload}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>

        {pending.length === 0 ? (
          <div className="panel pad">
            <span className="muted">Nenhuma solicitação aguardando aprovação.</span>
          </div>
        ) : (
          <div className="panel">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Usuário</th>
                    <th>E-mail</th>
                    <th>Solicitado em</th>
                    <th>Aprovar como</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((item) => (
                    <PendingRow
                      key={item.id}
                      user={item}
                      busy={busyId === item.id}
                      onApprove={(role) =>
                        patchUser(
                          item.id,
                          { status: "ATIVO", role },
                          `Acesso de ${item.name} aprovado como ${roleLabels[role]}.`,
                        )
                      }
                      onReject={() =>
                        patchUser(
                          item.id,
                          { status: "RECUSADO" },
                          `Solicitação de ${item.name} recusada.`,
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Usuários ({others.length})</h2>
          <button
            className="button"
            type="button"
            onClick={() => setCreating((value) => !value)}
          >
            <Plus size={16} />
            {creating ? "Fechar" : "Novo usuário"}
          </button>
        </div>

        {creating ? (
          <form className="panel pad form-grid" onSubmit={createUser}>
            <div className="field">
              <label htmlFor="new-name">Nome</label>
              <input
                className="input"
                id="new-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-username">Usuário</label>
              <input
                className="input"
                id="new-username"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-email">E-mail</label>
              <input
                className="input"
                id="new-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-password">Senha</label>
              <input
                className="input"
                id="new-password"
                type="password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                aria-describedby="new-password-help"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
              />
              <small id="new-password-help" className="muted">
                Use entre {PASSWORD_MIN_LENGTH} e {PASSWORD_MAX_LENGTH} caracteres.
              </small>
            </div>
            <div className="field">
              <label htmlFor="new-role">Perfil</label>
              <select
                className="select"
                id="new-role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              >
                {Object.values(Role).map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </div>
            <button className="button success" type="submit" disabled={busyId === "new"}>
              {busyId === "new" ? "Criando..." : "Criar usuário"}
            </button>
          </form>
        ) : null}

        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Usuário</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Revisado por</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={6}>
                      Carregando...
                    </td>
                  </tr>
                ) : null}
                {others.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {item.id === currentUser.id ? (
                        <>
                          {" "}
                          <small className="muted">(você)</small>
                        </>
                      ) : null}
                      <br />
                      <small className="muted">{item.email}</small>
                    </td>
                    <td>{item.username}</td>
                    <td>{roleLabels[item.role]}</td>
                    <td>
                      <span className={`status ${statusClass[item.status]}`}>
                        {userStatusLabels[item.status]}
                      </span>
                    </td>
                    <td>
                      {item.reviewedBy ? (
                        <>
                          {item.reviewedBy}
                          <br />
                          <small className="muted">
                            {item.reviewedAt ? dateTime(item.reviewedAt) : ""}
                          </small>
                        </>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button"
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => startEditing(item)}
                          title="Editar cadastro"
                        >
                          <Pencil size={14} />
                          Editar
                        </button>
                        {item.status === "ATIVO" ? (
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() =>
                              patchUser(
                                item.id,
                                { status: "INATIVO" },
                                `${item.name} desativado.`,
                              )
                            }
                          >
                            Desativar
                          </button>
                        ) : (
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() =>
                              patchUser(item.id, { status: "ATIVO" }, `${item.name} ativado.`)
                            }
                          >
                            Ativar
                          </button>
                        )}
                        {canPermanentlyDeleteUsers ? (
                          <button
                            className="button danger"
                            type="button"
                            disabled={busyId === item.id || item.id === currentUser.id}
                            onClick={() => setConfirmDelete(item)}
                            title={
                              item.id === currentUser.id
                                ? "Você não pode excluir a própria conta"
                                : "Excluir usuário"
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && others.length === 0 ? (
                  <tr>
                    <td className="daily-flow-empty" colSpan={6}>
                      Nenhum usuário cadastrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {editing && editForm ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
        >
          <form className="modal" onSubmit={saveEdit}>
            <h2 id="edit-user-title">Editar usuário</h2>
            <p>{editing.username}</p>

            <div className="field">
              <label htmlFor="edit-name">Nome</label>
              <input
                className="input"
                id="edit-name"
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                required
                minLength={2}
              />
            </div>

            <div className="field">
              <label htmlFor="edit-email">E-mail</label>
              <input
                className="input"
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="edit-phone">Telefone</label>
              <input
                className="input"
                id="edit-phone"
                value={editForm.phone}
                onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                placeholder="(11) 98765-4321"
              />
            </div>

            <div className="field">
              <label htmlFor="edit-role">Perfil</label>
              <select
                className="select"
                id="edit-role"
                value={editForm.role}
                onChange={(event) =>
                  setEditForm({ ...editForm, role: event.target.value as Role })
                }
              >
                {Object.values(Role).map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="edit-status">Status</label>
              <select
                className="select"
                id="edit-status"
                value={editForm.status}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    status: event.target.value as PanelUserRow["status"],
                  })
                }
              >
                {Object.values(UserStatus).map((status) => (
                  <option key={status} value={status}>
                    {userStatusLabels[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" role="group" aria-labelledby="edit-works-label">
              {/* Rotulo de grupo: nao aponta para um controle unico, entao e um
                  span com aria-labelledby em vez de um label solto. */}
              <span id="edit-works-label" className="field-label">
                Contas
              </span>
              <div className="checkbox-grid">
                {works.map((work) => (
                  <label className="checkbox-line" key={work.id}>
                    <input
                      type="checkbox"
                      checked={editForm.workIds.includes(work.id)}
                      onChange={() =>
                        setEditForm({
                          ...editForm,
                          workIds: editForm.workIds.includes(work.id)
                            ? editForm.workIds.filter((id) => id !== work.id)
                            : [...editForm.workIds, work.id],
                        })
                      }
                    />
                    {work.name}
                  </label>
                ))}
                {works.length === 0 ? <span className="muted">Nenhuma conta cadastrada.</span> : null}
              </div>
              <small className="muted">
                Gestor sem conta atribuída não entra na notificação do fluxo.
              </small>
            </div>

            <div className="field" role="group" aria-labelledby="edit-devices-label">
              <span id="edit-devices-label" className="field-label">Dispositivos</span>
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
                    {devices.map((device) => (
                      <tr key={device.id}>
                        <td title={device.userAgent ?? undefined}>{device.name}</td>
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
                            disabled={!!device.revokedAt || deviceBusyId === device.id}
                            onClick={() => void revokeDevice(device)}
                          >
                            <Trash2 size={14} />
                            {deviceBusyId === device.id ? "Revogando..." : "Revogar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!devicesLoading && devices.length === 0 ? (
                      <tr>
                        <td className="daily-flow-empty" colSpan={5}>
                          Nenhum dispositivo registrado.
                        </td>
                      </tr>
                    ) : null}
                    {devicesLoading ? (
                      <tr>
                        <td className="daily-flow-empty" colSpan={5}>
                          Carregando dispositivos...
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="field">
              <label htmlFor="edit-password">Nova senha</label>
              <input
                className="input"
                id="edit-password"
                type="password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                aria-describedby="edit-password-help"
                value={editForm.password}
                onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
                placeholder="Em branco mantém a senha atual"
              />
              <small id="edit-password-help" className="muted">
                Deixe em branco para manter a senha atual; se preencher, use entre {PASSWORD_MIN_LENGTH} e {PASSWORD_MAX_LENGTH} caracteres.
              </small>
            </div>

            <div className="button-row">
              <button className="button success" type="submit" disabled={busyId === editing.id}>
                {busyId === editing.id ? "Salvando..." : "Salvar"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={closeEditing}
                disabled={busyId === editing.id}
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
        >
          <div className="modal">
            <h2 id="delete-user-title">Excluir usuário</h2>
            <p>
              Excluir <strong>{confirmDelete.name}</strong> ({confirmDelete.username})
              permanentemente? O histórico financeiro dele será mantido como &quot;Usuário removido&quot;.
            </p>
            <div className="button-row">
              <button
                className="button danger"
                type="button"
                disabled={busyId === confirmDelete.id}
                onClick={() => void deleteUser(confirmDelete)}
              >
                {busyId === confirmDelete.id ? "Excluindo..." : "Excluir"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setConfirmDelete(null)}
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PendingRow({
  user,
  busy,
  onApprove,
  onReject,
}: {
  user: PanelUserRow;
  busy: boolean;
  onApprove: (role: Role) => void;
  onReject: () => void;
}) {
  // O perfil e escolhido no momento da aprovacao, nao no autocadastro.
  const [role, setRole] = useState<Role>(Role.OPERADOR);

  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.username}</td>
      <td>{user.email}</td>
      <td>{dateTime(user.createdAt)}</td>
      <td>
        <select
          className="select"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          aria-label={`Perfil para ${user.name}`}
        >
          {Object.values(Role).map((value) => (
            <option key={value} value={value}>
              {roleLabels[value]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="button-row">
          <button
            className="button success"
            type="button"
            disabled={busy}
            onClick={() => onApprove(role)}
          >
            <Check size={14} />
            Aprovar
          </button>
          <button className="button danger" type="button" disabled={busy} onClick={onReject}>
            <X size={14} />
            Recusar
          </button>
        </div>
      </td>
    </tr>
  );
}
