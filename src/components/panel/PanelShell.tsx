"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  UserRound,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { GlobalSearch } from "@/components/panel/GlobalSearch";
import { ImportTaskWatcher } from "@/components/panel/ImportTaskWatcher";
import { PanelContext, type PanelUser } from "@/components/panel/PanelContext";
import { AccessibilityMenu } from "@/components/panel/ThemeSwitcher";
import { DashboardTab } from "@/components/panel/tabs/DashboardTab";
import { roleLabels, TAB_IDS, type TabId } from "@/lib/permissions";

function TabLoading() {
  return <div className="panel pad">Carregando...</div>;
}

const ApprovedPaymentsTab = dynamic(() => import("@/components/panel/tabs/ApprovedPaymentsTab").then((m) => m.ApprovedPaymentsTab), { loading: TabLoading });
const DevicesTab = dynamic(() => import("@/components/panel/tabs/DevicesTab").then((m) => m.DevicesTab), { loading: TabLoading });
const AdvancesTab = dynamic(() => import("@/components/panel/tabs/AdvancesTab").then((m) => m.AdvancesTab), { loading: TabLoading });
const AnalyticsTab = dynamic(() => import("@/components/panel/tabs/AnalyticsTab").then((m) => m.AnalyticsTab), { loading: TabLoading });
const FinancialCalendarTab = dynamic(() => import("@/components/panel/tabs/FinancialCalendarTab").then((m) => m.FinancialCalendarTab), { loading: TabLoading });
const ImportTab = dynamic(() => import("@/components/panel/tabs/ImportTab").then((m) => m.ImportTab), { loading: TabLoading });
const PaymentRequestsTab = dynamic(() => import("@/components/panel/tabs/PaymentRequestsTab").then((m) => m.PaymentRequestsTab), { loading: TabLoading });
const LogsTab = dynamic(() => import("@/components/panel/tabs/LogsTab").then((m) => m.LogsTab), { loading: TabLoading });
const NotasColaboradoresTab = dynamic(() => import("@/components/panel/tabs/NotasColaboradoresTab").then((m) => m.NotasColaboradoresTab), { loading: TabLoading });
const PaymentsTab = dynamic(() => import("@/components/panel/tabs/PaymentsTab").then((m) => m.PaymentsTab), { loading: TabLoading });
const PermissionsTab = dynamic(() => import("@/components/panel/tabs/PermissionsTab").then((m) => m.PermissionsTab), { loading: TabLoading });
const ReconciliationTab = dynamic(() => import("@/components/panel/tabs/ReconciliationTab").then((m) => m.ReconciliationTab), { loading: TabLoading });
const UsersTab = dynamic(() => import("@/components/panel/tabs/UsersTab").then((m) => m.UsersTab), { loading: TabLoading });

type MeResponse = {
  user: PanelUser;
  tabs: TabId[];
};

type TabDefinition = {
  id: TabId;
  label: string;
  title: string;
  subtitle: string;
  section: string;
  Component: React.ComponentType;
};

const tabDefinitions: TabDefinition[] = [
  {
    id: "dashboard",
    label: "Início",
    title: "Início",
    subtitle: "Métricas do fluxo de pagamentos",
    section: "PAINEL",
    Component: DashboardTab,
  },
  {
    id: "indicadores",
    label: "Indicadores",
    title: "Indicadores gerenciais",
    subtitle: "Fornecedores, obras, categorias, prazos e documentos",
    section: "PAINEL",
    Component: AnalyticsTab,
  },
  {
    id: "calendario",
    label: "Calendário",
    title: "Calendário financeiro",
    subtitle: "Vencimentos, aportes e prestações de contas",
    section: "PAINEL",
    Component: FinancialCalendarTab,
  },
  {
    id: "importar",
    label: "Importação",
    title: "Importação de fluxo",
    subtitle: "Entrada da planilha de pagamentos",
    section: "PAINEL",
    Component: ImportTab,
  },
  {
    id: "aprovados",
    label: "Aprovados",
    title: "Pagamentos aprovados",
    subtitle: "Aprovações dos fluxos importados por você",
    section: "OPERAÇÃO",
    Component: ApprovedPaymentsTab,
  },
  {
    id: "solicitacoes",
    label: "Solicitações",
    title: "Solicitações de pagamento",
    subtitle: "Autorize compras por alçada e acompanhe pedidos de informação",
    section: "PAINEL",
    Component: PaymentRequestsTab,
  },
  {
    id: "conciliacao",
    label: "Conciliação",
    title: "Conciliação de despesas",
    subtitle: "Cartão CAJU x sistema interno: notas pendentes",
    section: "PAINEL",
    Component: ReconciliationTab,
  },
  {
    id: "pagamentos",
    label: "Pagamentos",
    title: "Pagamentos",
    subtitle: "Aprovação e gestão do fluxo",
    section: "OPERAÇÃO",
    Component: PaymentsTab,
  },
  {
    id: "adiantamentos",
    label: "Adiantamentos",
    title: "Adiantamentos",
    subtitle: "Prestação de contas de colaboradores",
    section: "OPERAÇÃO",
    Component: AdvancesTab,
  },
  {
    id: "notas-colaboradores",
    label: "Notas dos colaboradores",
    title: "Notas dos colaboradores",
    subtitle: "Histórico de notas enviadas pelo cartão CAJU",
    section: "GESTÃO",
    Component: NotasColaboradoresTab,
  },
  {
    id: "dispositivos",
    label: "Dispositivos",
    title: "Meus dispositivos",
    subtitle: "Dispositivos autorizados para acessar sua conta",
    section: "GESTÃO",
    Component: DevicesTab,
  },
  {
    id: "usuarios",
    label: "Usuários",
    title: "Usuários",
    subtitle: "Solicitações de acesso e cadastro",
    section: "GESTÃO",
    Component: UsersTab,
  },
  {
    id: "permissoes",
    label: "Permissões",
    title: "Permissões",
    subtitle: "Níveis de acesso e contas",
    section: "GESTÃO",
    Component: PermissionsTab,
  },
  {
    id: "logs",
    label: "Logs",
    title: "Logs de ações",
    subtitle: "Auditoria: quem alterou, o quê e quando",
    section: "GESTÃO",
    Component: LogsTab,
  },
];

const primaryNavigationIds: readonly TabId[] = [
  "dashboard",
  "indicadores",
  "importar",
  "solicitacoes",
  "conciliacao",
  "pagamentos",
  "aprovados",
];
const paymentSecondaryIds: readonly TabId[] = ["adiantamentos"];
const accountNavigationIds: readonly TabId[] = [
  "usuarios",
  "notas-colaboradores",
  "permissoes",
  "logs",
  "dispositivos",
];


function isTabId(value: string | null): value is TabId {
  return !!value && (TAB_IDS as readonly string[]).includes(value);
}


export function PanelShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<PanelUser | null>(null);
  const [requestPendingCount, setRequestPendingCount] = useState(0);
  const [tabs, setTabs] = useState<TabId[]>([]);
  useEffect(() => {
    if (!user || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    if (!user || !tabs.includes("solicitacoes")) return;
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching || document.visibilityState !== "visible") return;
      fetching = true;
      try {
        const response = await fetch("/api/payment-requests?summary=1", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        if (active) setRequestPendingCount(body.pendingCount ?? 0);
      } catch { /* Conserva o último contador conhecido durante falhas de conexão. */ }
      finally { fetching = false; }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("payment-requests-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false; window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("payment-requests-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, tabs]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return null;
        }
        return (await response.json()) as MeResponse;
      })
      .then((data) => {
        if (!active || !data) return;
        setUser(data.user);
        setTabs(data.tabs);
      })
      .catch(() => router.replace("/login"))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);
  useEffect(() => {
    function updateScrolledState() {
      setScrolled(window.scrollY > 12);
    }

    updateScrolledState();
    window.addEventListener("scroll", updateScrolledState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolledState);
  }, []);


  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (event.target instanceof Node && !navigationRef.current?.contains(event.target)) {
        setPaymentsOpen(false);
        setAccountOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setPaymentsOpen(false);
      setAccountOpen(false);
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const requestedTab = searchParams.get("tab");

  /**
   * A aba vem da URL, mas o perfil manda: pedir ?tab=usuarios sendo operador
   * cai na primeira aba permitida. As rotas de API revalidam de qualquer jeito.
   */
  const activeTab: TabId | null = useMemo(() => {
    if (!tabs.length) return null;
    if (
      isTabId(requestedTab) &&
      tabs.includes(requestedTab) &&
      tabDefinitions.some((tab) => tab.id === requestedTab)
    ) return requestedTab;
    return tabDefinitions.find((tab) => tabs.includes(tab.id))?.id ?? null;
  }, [requestedTab, tabs]);
  const shouldRedirectToNotas = !activeTab && tabs.includes("notas");

  useEffect(() => {
    if (!loading && user && shouldRedirectToNotas) {
      router.replace("/notas");
    }
  }, [loading, router, shouldRedirectToNotas, user]);

  const goToTab = useCallback(
    (tab: TabId) => {
      setMenuOpen(false);
      setPaymentsOpen(false);
      setAccountOpen(false);
      // replace evita empilhar uma entrada de historico por clique de aba.
      router.replace(`/painel?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  const visibleTabs = useMemo(
    () => tabDefinitions.filter((tab) => tabs.includes(tab.id)),
    [tabs],
  );
  const primaryTabs = primaryNavigationIds.flatMap((id) => {
    const tab = visibleTabs.find((item) => item.id === id);
    return tab ? [tab] : [];
  });
  const paymentSecondaryTabs = paymentSecondaryIds.flatMap((id) => {
    const tab = visibleTabs.find((item) => item.id === id);
    return tab ? [tab] : [];
  });
  const accountTabs = accountNavigationIds.flatMap((id) => {
    const tab = visibleTabs.find((item) => item.id === id);
    return tab ? [tab] : [];
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="login-shell">
        <div className="panel pad">Carregando...</div>
      </div>
    );
  }

  if (!user) return null;

  if (!activeTab) {
    return (
      <div className="login-shell">
        <div className="panel pad">
          {shouldRedirectToNotas
            ? "Redirecionando para suas notas..."
            : "Sua conta não possui acesso a nenhuma área do painel."}
        </div>
      </div>
    );
  }

  const current = tabDefinitions.find((tab) => tab.id === activeTab);
  if (!current) return null;
  const ActiveComponent = current.Component;

  return (
    <PanelContext.Provider value={{ user, tabs, goToTab }}>
      {tabs.includes("importar") ? <ImportTaskWatcher /> : null}
      <div className="app-shell">
        <a className="skip-link" href="#conteudo-principal">
          Ir para o conteúdo
        </a>

        {menuOpen ? (
          <button
            className="nav-backdrop"
            type="button"
            aria-label="Fechar menu"
            onClick={() => {
              setMenuOpen(false);
              setPaymentsOpen(false);
              setAccountOpen(false);
            }}
          />
        ) : null}

        <header
          className={clsx("top-navigation", scrolled && "scrolled")}
          ref={navigationRef}
        >
          <div className="brand-lockup">
            <BrandMark />
            <div>
              <strong>DJ Fluxo</strong>
              <span>Fluxo de pagamentos</span>
            </div>
          </div>

          <button
            className="icon-button mobile-nav-trigger"
            type="button"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            aria-controls="panel-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <nav
            className={clsx("top-nav", menuOpen && "open")}
            id="panel-navigation"
            aria-label="Menu principal"
          >
            <div className="primary-nav-items">
              {primaryTabs
                .filter((tab) => tab.id !== "pagamentos" && tab.id !== "aprovados")
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={clsx("nav-link", tab.id === activeTab && "active")}
                    onClick={() => goToTab(tab.id)}
                    aria-current={tab.id === activeTab ? "page" : undefined}
                  >
                    {tab.id === "dashboard" ? (
                      <LayoutDashboard size={17} aria-hidden="true" />
                    ) : null}
                    <span>{tab.label}</span>
                    {tab.id === "solicitacoes" && requestPendingCount > 0 && <span className="request-pending-count" aria-label={`${requestPendingCount} pendências`}>{requestPendingCount}</span>}
                  </button>
                ))}

              {primaryTabs.some((tab) => tab.id === "pagamentos" || tab.id === "aprovados") ||
              paymentSecondaryTabs.length ? (
                <div className="payments-group">
                  {primaryTabs
                    .filter((tab) => tab.id === "pagamentos" || tab.id === "aprovados")
                    .map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={clsx("nav-link", tab.id === activeTab && "active")}
                        onClick={() => goToTab(tab.id)}
                        aria-current={tab.id === activeTab ? "page" : undefined}
                      >
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  {paymentSecondaryTabs.length ? (
                    <button
                      className="nav-dropdown-toggle"
                      type="button"
                      aria-label="Abrir opções de pagamentos"
                      aria-expanded={paymentsOpen}
                      onClick={() => {
                        setPaymentsOpen((open) => !open);
                        setAccountOpen(false);
                      }}
                    >
                      <ChevronDown size={15} />
                    </button>
                  ) : null}
                  {paymentSecondaryTabs.length ? (
                    <div className={clsx("nav-submenu", paymentsOpen && "open")}>
                      {paymentSecondaryTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={clsx("nav-link", tab.id === activeTab && "active")}
                          onClick={() => goToTab(tab.id)}
                          aria-current={tab.id === activeTab ? "page" : undefined}
                        >
                          <span>{tab.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="account-menu">
              <a
                className="system-hub-link"
                href="https://gestaodj.com/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir Hub de sistemas em uma nova aba"
                title="Hub de sistemas"
              >
                <Network size={19} aria-hidden="true" />
              </a>
              <button
                className="account-trigger"
                type="button"
                aria-label={`Abrir menu da conta de ${user.name}`}
                aria-haspopup="dialog"
                aria-expanded={accountOpen}
                onClick={() => {
                  setAccountOpen((open) => !open);
                  setPaymentsOpen(false);
                }}
              >
                <span className="user-avatar" aria-hidden="true">
                  {user.name
                    .split(" ")
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="account-summary">
                  <strong>{user.name}</strong>
                  <small>{roleLabels[user.role]}</small>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              <div
                className={clsx("account-dropdown", accountOpen && "open")}
                role="dialog"
                aria-label="Conta e acessibilidade"
              >
                <div className="account-heading">
                  <UserRound size={17} />
                  <span>
                    <strong>{user.name}</strong>
                    <small>{roleLabels[user.role]}</small>
                  </span>
                </div>
                {accountTabs.length ? (
                  <div className="account-links">
                    {accountTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={clsx("nav-link", tab.id === activeTab && "active")}
                        onClick={() => goToTab(tab.id)}
                        aria-current={tab.id === activeTab ? "page" : undefined}
                      >
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <AccessibilityMenu />
                <button className="account-logout" type="button" onClick={logout}>
                  <LogOut size={17} />
                  Sair
                </button>
              </div>
            </div>
          </nav>
        </header>

        <main className="main" id="conteudo-principal" tabIndex={-1}>
          <header className="page-toolbar">
            <div className="page-title">
              <h1>{current.title}</h1>
              <p>{current.subtitle}</p>
            </div>
            <GlobalSearch />
          </header>
          <div className="content">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </PanelContext.Provider>
  );
}
