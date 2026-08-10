import { Role } from "@prisma-generated/enums";

export { Role };

const PERMANENT_ACCOUNT_DELETION_USERNAME = "arthur";
export const REMOVED_USER_SENTINEL = "usuario-removido";

export function canPermanentlyDeleteUsers(username: string) {
  return username.trim().toLowerCase() === PERMANENT_ACCOUNT_DELETION_USERNAME;
}

/**
 * Fonte unica das regras de acesso (RBAC). O menu do painel e as rotas de API
 * consultam este modulo, para que esconder uma aba e bloquear o endpoint
 * correspondente nunca saiam de sincronia.
 *
 * Operador      -> painel, importação e conciliação.
 * Gestor        -> operação financeira.
 * Aprovador     -> aprova pagamentos e fecha fluxos.
 * Administrador -> acesso total, incluindo áreas críticas (usuários, permissões e logs).
 */
export const TAB_IDS = [
  "dashboard",
  "indicadores",
  "calendario",
  "importar",
  "aprovados",
  "conciliacao",
  "solicitacoes",
  "pagamentos",
  "adiantamentos",
  "dispositivos",
  "usuarios",
  "permissoes",
  "logs",
] as const;

export type TabId = (typeof TAB_IDS)[number];

const ALL_ROLES: Role[] = [
  Role.OPERADOR,
  Role.GESTOR,
  Role.APROVADOR,
  Role.ADMINISTRADOR,
];
const MANAGEMENT: Role[] = [Role.GESTOR, Role.APROVADOR, Role.ADMINISTRADOR];
const CRITICAL: Role[] = [Role.ADMINISTRADOR];

export const tabRoles: Record<TabId, Role[]> = {
  dashboard: ALL_ROLES,
  indicadores: ALL_ROLES,
  calendario: ALL_ROLES,
  importar: ALL_ROLES,
  aprovados: ALL_ROLES,
  conciliacao: ALL_ROLES,
  solicitacoes: ALL_ROLES,
  pagamentos: MANAGEMENT,
  adiantamentos: MANAGEMENT,
  dispositivos: ALL_ROLES,
  usuarios: CRITICAL,
  permissoes: CRITICAL,
  logs: CRITICAL,
};

export function canAccessTab(role: Role, tab: TabId) {
  return tabRoles[tab].includes(role);
}

export function allowedTabs(role: Role) {
  return TAB_IDS.filter((tab) => canAccessTab(role, tab));
}

/** Aba inicial do perfil: a primeira que ele pode ver. */
export function defaultTab(role: Role): TabId {
  return allowedTabs(role)[0] ?? "dashboard";
}

/** Editar pagamentos, remarcar datas, mexer em registros financeiros. */
export function canEditPayments(role: Role) {
  return MANAGEMENT.includes(role);
}


/** Gerenciar usuarios, perfis e ver auditoria. */
export function canAdminister(role: Role) {
  return CRITICAL.includes(role);
}

export const roleLabels: Record<Role, string> = {
  OPERADOR: "Operador",
  GESTOR: "Gestor",
  APROVADOR: "Aprovador",
  ADMINISTRADOR: "Administrador",
};

export const roleDescriptions: Record<Role, string> = {
  OPERADOR: "Acessa o painel, importa planilhas, acompanha aprovações, solicita pagamentos e faz a conciliação.",
  GESTOR: "Opera pagamentos e adiantamentos.",
  APROVADOR: "Aprova pagamentos e fecha fluxos em aprovação.",
  ADMINISTRADOR: "Acesso total, incluindo usuários, permissões e logs.",
};
