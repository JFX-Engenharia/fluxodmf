"use client";

import clsx from "clsx";
import {
  BanknoteArrowUp,
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  FilePlus2,
  Menu,
  Scale,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { GlobalSearch } from "@/components/panel/GlobalSearch";
import { PanelContext, type PanelUser } from "@/components/panel/PanelContext";
import { ThemeSwitcher } from "@/components/panel/ThemeSwitcher";
import { DashboardTab } from "@/components/panel/tabs/DashboardTab";
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
    label: "Dashboard",
    title: "Dashboard",
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

const navSections = ["PAINEL", "OPERAÇÃO", "GESTÃO"];

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
      // replace evita empilhar uma entrada de historico por clique de aba.
      router.replace(`/painel?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  const visibleTabs = useMemo(
    () => tabDefinitions.filter((tab) => tabs.includes(tab.id)),
    [tabs],
  );

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
      <div className="app-shell">
        <a className="skip-link" href="#conteudo-principal">
          Ir para o conteúdo
        </a>
        {menuOpen ? (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <aside className={clsx("sidebar", menuOpen && "open")}>
          <div className="sidebar-header">
            <BrandMark />
            <div className="sidebar-title">
              <strong>DJ Fluxo</strong>
              <span>Fluxo de pagamentos</span>
            </div>
            <button
              className="icon-button mobile-menu"
              type="button"
              title="Fechar menu"
              aria-label="Fechar menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <nav className="nav-list" aria-label="Menu principal">
            {navSections.map((section) => {
              const sectionItems = visibleTabs.filter((tab) => tab.section === section);
              if (!sectionItems.length) return null;

              return (
                <div className="nav-section" key={section}>
                  <span className="nav-section-title">{section}</span>
                  <div className="nav-section-items">
                    {sectionItems.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={clsx("nav-link", tab.id === activeTab && "active")}
                          onClick={() => goToTab(tab.id)}
                          aria-current={tab.id === activeTab ? "page" : undefined}
                        >
                          <Icon size={18} />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <button className="button secondary" type="button" onClick={logout}>
              <LogOut size={16} />
              Sair
            </button>
          </div>
        </aside>

        <main className="main" id="conteudo-principal" tabIndex={-1}>
          <header className="topbar">
            <div className="button-row">
              <button
                className="icon-button mobile-menu"
                type="button"
                title="Abrir menu"
                aria-label="Abrir menu"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={18} />
              </button>
              <div className="page-title">
                <h1>{current.title}</h1>
                <p>{current.subtitle}</p>
              </div>
            </div>
            <GlobalSearch />
            <ThemeSwitcher />
            <div className="topbar-user" aria-label={`Usuário: ${user.name}`}>
              <span className="user-avatar" aria-hidden="true">
                {user.name
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{roleLabels[user.role]}</small>
              </span>
            </div>
          </header>
          <div className="content">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </PanelContext.Provider>
  );
}
