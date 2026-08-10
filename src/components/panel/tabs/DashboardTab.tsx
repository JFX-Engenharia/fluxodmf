"use client";

import { ArrowRight, CheckCircle2, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Money } from "@/components/Money";
import { StatusBadge } from "@/components/StatusBadge";
import { usePanel } from "@/components/panel/PanelContext";
import { money, shortDate, statusLabels } from "@/lib/format";

type StatusKey = keyof typeof statusLabels;

type AccountMetric = {
  workId: string;
  name: string;
  count: number;
  totalAmount: number;
  openAmount: number;
  contribution: number;
  balance: number;
  coverage: number | null;
};

type PaymentRow = {
  id: string;
  supplierName: string;
  description: string;
  amount: number;
  category: string;
  currentDueDate: string;
  status: StatusKey;
  work: { name: string };
  overdue: boolean;
  dueToday: boolean;
};

type DashboardResponse = {
  totals: {
    count: number;
    amount: number;
    openAmount: number;
    contribution: number;
    overdueCount: number;
    overdueAmount: number;
    todayCount: number;
    todayAmount: number;
  };
  referenceDate: string;
  statusCards: { status: StatusKey; count: number; amount: number }[];
  byAccount: AccountMetric[];
  byCategory: { category: string; count: number; amount: number }[];
  flow: PaymentRow[];
};

/** Dias de atraso entre o vencimento e a data de referencia do servidor. */
function daysLate(dueDate: string, referenceDate: string) {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00.000Z`);
  const reference = Date.parse(`${referenceDate}T00:00:00.000Z`);
  return Math.round((reference - due) / 86_400_000);
}

export function DashboardTab() {
  const { goToTab, tabs } = usePanel();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    fetch("/api/dashboard")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Falha ao carregar métricas.");
        return body as DashboardResponse;
      })
      .then((body) => active && setData(body))
      .catch((err: Error) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="panel pad loading-card" role="status">
        <span className="loading-dot" aria-hidden="true" />
        Carregando métricas...
      </div>
    );
  }
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!data) return null;

  const { totals } = data;
  const balance = Number((totals.contribution - totals.openAmount).toFixed(2));
  const maxCategory = data.byCategory[0]?.amount ?? 0;
  const maxStatusCount = Math.max(...data.statusCards.map((card) => card.count), 1);
  const coverage =
    totals.openAmount > 0
      ? Math.max(0, Math.min(100, (totals.contribution / totals.openAmount) * 100))
      : 100;
  const detailsTab = tabs.includes("pagamentos") ? "pagamentos" : "aprovados";

  if (totals.count === 0) {
    return (
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-copy">
          <span className="eyebrow">PRIMEIRO FLUXO</span>
          <h2 id="onboarding-title">Comece o ciclo financeiro do dia</h2>
          <p>
            Importe a planilha para calcular a cobertura por conta e liberar a conferência e a
            aprovação dos pagamentos.
          </p>
          <button className="button" type="button" onClick={() => goToTab("importar")}>
            Importar planilha
            <ArrowRight size={16} />
          </button>
        </div>

        <ol className="journey-list" aria-label="Etapas do fluxo de pagamentos">
          <li>
            <span><FileSpreadsheet size={18} /></span>
            <div><strong>1. Importe e valide</strong><small>Confira linhas, contas e aportes.</small></div>
          </li>
          <li>
            <span><CheckCircle2 size={18} /></span>
            <div><strong>2. Aprove o fluxo</strong><small>Decida individualmente ou em lote.</small></div>
          </li>
          <li>
            <span><ShieldCheck size={18} /></span>
            <div><strong>3. Feche e audite</strong><small>Gere o relatório com todo o histórico.</small></div>
          </li>
        </ol>
      </section>
    );
  }

  return (
    <section className="finance-dashboard-grid" aria-label="Resumo financeiro">
      <article className="finance-card finance-balance-card">
        <header className="finance-card-header">
          <div>
            <span className="finance-card-kicker">Visão financeira</span>
            <h2>Saldo projetado</h2>
          </div>
          <span className="finance-card-count">{totals.count} pagamentos</span>
        </header>

        <div className="finance-balance-total">
          <strong style={{ color: balance < 0 ? "var(--danger)" : "var(--text)" }}>
            {money(balance)}
          </strong>
          <small>{money(totals.amount)} no fluxo total</small>
        </div>

        <div className="finance-summary-pills">
          <div>
            <span>Em aberto</span>
            <strong>{money(totals.openAmount)}</strong>
          </div>
          <div>
            <span>Aportes</span>
            <strong>{money(totals.contribution)}</strong>
          </div>
        </div>

        <div className="finance-card-subheading">
          <h3>Cobertura por conta</h3>
          <span>{data.byAccount.length} contas</span>
        </div>
        <div className="finance-account-list">
          {data.byAccount.slice(0, 3).map((account) => (
            <div className="finance-account-card" key={account.workId}>
              <span>{account.name}</span>
              <strong style={{ color: account.balance < 0 ? "var(--danger)" : undefined }}>
                <Money value={account.balance} />
              </strong>
              <small>
                {account.coverage === null ? "Sem movimento" : `${account.coverage.toFixed(0)}% coberto`}
              </small>
            </div>
          ))}
          {data.byAccount.length === 0 ? (
            <p className="finance-card-empty">Nenhuma conta com movimento.</p>
          ) : null}
        </div>
      </article>

      <article className="finance-card finance-distribution-card">
        <header className="finance-card-header">
          <h2>Distribuição</h2>
          <span className="finance-card-count">Por status</span>
        </header>
        <div className="finance-status-chart" aria-label="Pagamentos por status">
          {data.statusCards.slice(0, 6).map((card) => (
            <div className="finance-status-column" key={card.status} title={statusLabels[card.status]}>
              <div className="finance-status-track">
                <span
                  style={{
                    height: `${Math.max(16, (card.count / maxStatusCount) * 100)}%`,
                  }}
                >
                  <i>{card.count}</i>
                </span>
              </div>
              <small>{statusLabels[card.status]}</small>
            </div>
          ))}
          {data.statusCards.length === 0 ? (
            <p className="finance-card-empty">Sem pagamentos para distribuir.</p>
          ) : null}
        </div>
      </article>

      <article className="finance-card finance-transactions-card">
        <header className="finance-card-header">
          <div>
            <span className="finance-card-kicker">Próximos compromissos</span>
            <h2>Fluxo em aberto</h2>
          </div>
          <button className="finance-card-link" type="button" onClick={() => goToTab(detailsTab)}>
            Ver todos
          </button>
        </header>
        <div className="finance-transaction-list">
          {data.flow.slice(0, 5).map((payment) => {
            const late = payment.overdue
              ? daysLate(payment.currentDueDate, data.referenceDate)
              : 0;
            return (
              <div className="finance-transaction" key={payment.id}>
                <span className="finance-transaction-avatar" aria-hidden="true">
                  {payment.supplierName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{payment.supplierName}</strong>
                  <small>
                    {payment.overdue
                      ? `Vencido há ${late} ${late === 1 ? "dia" : "dias"}`
                      : payment.dueToday
                        ? "Vence hoje"
                        : shortDate(payment.currentDueDate)}
                  </small>
                </div>
                <div className="finance-transaction-value">
                  <strong><Money value={payment.amount} /></strong>
                  <StatusBadge status={payment.status} />
                </div>
              </div>
            );
          })}
          {data.flow.length === 0 ? (
            <p className="finance-card-empty">Nenhum pagamento em aberto.</p>
          ) : null}
        </div>
      </article>

      <article className="finance-card finance-insight-card">
        <span className="finance-card-kicker">Leitura rápida</span>
        <h2>Como está o fluxo?</h2>
        <strong>
          {totals.overdueCount > 0
            ? `${totals.overdueCount} vencido${totals.overdueCount === 1 ? "" : "s"}`
            : balance < 0
              ? "Aporte insuficiente"
              : "Fluxo coberto"}
        </strong>
        <p>
          {totals.overdueCount > 0
            ? `${money(totals.overdueAmount)} aguardando regularização.`
            : balance < 0
              ? `Faltam ${money(Math.abs(balance))} para cobrir o fluxo.`
              : "Os aportes previstos cobrem os pagamentos em aberto."}
        </p>
        <button className="button secondary" type="button" onClick={() => goToTab("importar")}>
          Revisar fluxo <ArrowRight size={15} />
        </button>
      </article>

      <article className="finance-card finance-expenses-card">
        <header className="finance-card-header">
          <div>
            <span className="finance-card-kicker">Composição das despesas</span>
            <h2>Por categoria</h2>
          </div>
          <strong>{money(totals.amount)}</strong>
        </header>
        <div className="finance-expense-chart">
          {data.byCategory.slice(0, 7).map((row) => (
            <div className="finance-expense-row" key={row.category}>
              <div>
                <span>{row.category}</span>
                <strong><Money value={row.amount} /></strong>
              </div>
              <div className="finance-expense-track" aria-hidden="true">
                <span
                  style={{
                    width: `${maxCategory > 0 ? (row.amount / maxCategory) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {data.byCategory.length === 0 ? (
            <p className="finance-card-empty">Sem categorias importadas ainda.</p>
          ) : null}
        </div>
      </article>

      <article className="finance-card finance-coverage-card">
        <header className="finance-card-header">
          <h2>Cobertura do fluxo</h2>
          <span className="finance-card-count">Aportes ÷ aberto</span>
        </header>
        <div
          className="finance-coverage-ring"
          style={{
            background: `conic-gradient(var(--primary) ${coverage}%, var(--surface-muted) 0)`,
          }}
          aria-label={`${coverage.toFixed(0)}% do fluxo coberto`}
        >
          <div>
            <strong>{coverage.toFixed(0)}%</strong>
            <span>{coverage >= 100 ? "Coberto" : coverage >= 70 ? "Atenção" : "Crítico"}</span>
          </div>
        </div>
        <div className="finance-coverage-summary">
          <div><span>Aportes</span><strong>{money(totals.contribution)}</strong></div>
          <div><span>Em aberto</span><strong>{money(totals.openAmount)}</strong></div>
        </div>
      </article>
    </section>
  );
}
