"use client";

import clsx from "clsx";
import {
  BadgeCheck,
  BanknoteArrowUp,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  FilePlus2,
  Menu,
  Scale,
  ScrollText,
  ShieldCheck,
  Smartphone,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { GlobalSearch } from "@/components/panel/GlobalSearch";
import { ImportTaskWatcher } from "@/components/panel/ImportTaskWatcher";
import { PanelContext, type PanelUser } from "@/components/panel/PanelContext";
import { AccessibilityMenu } from "@/components/panel/ThemeSwitcher";
import { ApprovedPaymentsTab } from "@/components/panel/tabs/ApprovedPaymentsTab";
import { DashboardTab } from "@/components/panel/tabs/DashboardTab";
import { DevicesTab } from "@/components/panel/tabs/DevicesTab";
import { AdvancesTab } from "@/components/panel/tabs/AdvancesTab";
import { AnalyticsTab } from "@/components/panel/tabs/AnalyticsTab";
import { FinancialCalendarTab } from "@/components/panel/tabs/FinancialCalendarTab";
import { ImportTab } from "@/components/panel/tabs/ImportTab";
import { PaymentRequestsTab } from "@/components/panel/tabs/PaymentRequestsTab";
import { LogsTab } from "@/components/panel/tabs/LogsTab";
import { PaymentsTab } from "@/components/panel/tabs/PaymentsTab";
import { PermissionsTab } from "@/components/panel/tabs/PermissionsTab";
import { ReconciliationTab } from "@/components/panel/tabs/ReconciliationTab";
import { UsersTab } from "@/components/panel/tabs/UsersTab";
import { roleLabels, TAB_IDS, type TabId } from "@/lib/permissions";

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
  icon: React.ComponentType<{ size?: number }>;
  Component: React.ComponentType;
};

const tabDefinitions: TabDefinition[] = [
  {
    id: "dashboard",
    label: "Início",
    title: "Início",
    subtitle: "Métricas do fluxo de pagamentos",
    section: "PAINEL",
    icon: LayoutDashboard,
    Component: DashboardTab,
  },
  {
    id: "indicadores",
    label: "Indicadores",
    title: "Indicadores gerenciais",
    subtitle: "Fornecedores, obras, categorias, prazos e documentos",
    section: "PAINEL",
    icon: BarChart3,
    Component: AnalyticsTab,
  },
  {
    id: "calendario",
    label: "Calendário",
    title: "Calendário financeiro",
    subtitle: "Vencimentos, aportes e prestações de contas",
    section: "PAINEL",
    icon: CalendarRange,
    Component: FinancialCalendarTab,
  },
  {
    id: "importar",
    label: "Importação",
    title: "Importação de fluxo",
    subtitle: "Entrada da planilha de pagamentos",
    section: "PAINEL",
    icon: FileSpreadsheet,
    Component: ImportTab,
  },
  {
    id: "aprovados",
    label: "Aprovados",
    title: "Pagamentos aprovados",
    subtitle: "Aprovações dos fluxos importados por você",
    section: "OPERAÇÃO",
    icon: BadgeCheck,
    Component: ApprovedPaymentsTab,
  },
  {
    id: "solicitacoes",
    label: "Solicitações",
    title: "Solicitações de pagamento",
    subtitle: "Envie pagamentos para aprovação da obra",
    section: "PAINEL",
    icon: FilePlus2,
    Component: PaymentRequestsTab,
  },
  {
    id: "conciliacao",
    label: "Conciliação",
    title: "Conciliação de despesas",
    subtitle: "Cartão CAJU x sistema interno: notas pendentes",
    section: "PAINEL",
    icon: Scale,
    Component: ReconciliationTab,
  },
  {
    id: "pagamentos",
    label: "Pagamentos",
    title: "Pagamentos",
    subtitle: "Aprovação e gestão do fluxo",
    section: "OPERAÇÃO",
    icon: ClipboardCheck,
    Component: PaymentsTab,
  },
  {
    id: "adiantamentos",
    label: "Adiantamentos",
    title: "Adiantamentos",
    subtitle: "Prestação de contas de colaboradores",
    section: "OPERAÇÃO",
    icon: BanknoteArrowUp,
    Component: AdvancesTab,
  },
  {
    id: "dispositivos",
    label: "Dispositivos",
    title: "Meus dispositivos",
    subtitle: "Dispositivos autorizados para acessar sua conta",
    section: "GESTÃO",
    icon: Smartphone,
    Component: DevicesTab,
  },
  {
    id: "usuarios",
    label: "Usuários",
    title: "Usuários",
    subtitle: "Solicitações de acesso e cadastro",
    section: "GESTÃO",
    icon: Users,
    Component: UsersTab,
  },
  {
    id: "permissoes",
    label: "Permissões",
    title: "Permissões",
    subtitle: "Níveis de acesso e contas",
    section: "GESTÃO",
    icon: ShieldCheck,
    Component: PermissionsTab,
  },
  {
    id: "logs",
    label: "Logs",
    title: "Logs de ações",
    subtitle: "Auditoria: quem alterou, o quê e quando",
    section: "GESTÃO",
    icon: ScrollText,
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
const accountNavigationIds: readonly TabId[] = ["usuarios", "permissoes", "logs", "dispositivos"];


function isTabId(value: string | null): value is TabId {
  return !!value && (TAB_IDS as readonly string[]).includes(value);
}

export function PanelShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<PanelUser | null>(null);
  const [tabs, setTabs] = useState<TabId[]>([]);
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
    if (isTabId(requestedTab) && tabs.includes(requestedTab)) return requestedTab;
    return tabs[0];
  }, [requestedTab, tabs]);

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

  if (!user || !activeTab) return null;

  const current = tabDefinitions.find((tab) => tab.id === activeTab) ?? tabDefinitions[0];
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
                .map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={clsx("nav-link", tab.id === activeTab && "active")}
                      onClick={() => goToTab(tab.id)}
                      aria-current={tab.id === activeTab ? "page" : undefined}
                    >
                      <Icon size={17} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}

              {primaryTabs.some((tab) => tab.id === "pagamentos" || tab.id === "aprovados") ||
              paymentSecondaryTabs.length ? (
                <div className="payments-group">
                  {primaryTabs
                    .filter((tab) => tab.id === "pagamentos" || tab.id === "aprovados")
                    .map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={clsx("nav-link", tab.id === activeTab && "active")}
                          onClick={() => goToTab(tab.id)}
                          aria-current={tab.id === activeTab ? "page" : undefined}
                        >
                          <Icon size={17} />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
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
                      {paymentSecondaryTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            className={clsx("nav-link", tab.id === activeTab && "active")}
                            onClick={() => goToTab(tab.id)}
                            aria-current={tab.id === activeTab ? "page" : undefined}
                          >
                            <Icon size={17} />
                            <span>{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="account-menu">
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
                    {accountTabs.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={clsx("nav-link", tab.id === activeTab && "active")}
                          onClick={() => goToTab(tab.id)}
                          aria-current={tab.id === activeTab ? "page" : undefined}
                        >
                          <Icon size={17} />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
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
