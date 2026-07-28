"use client";

import { CheckCircle2, RefreshCw, Search } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Money } from "@/components/Money";
import { useFetchData } from "@/components/panel/useFetchData";
import { dateTime, shortDate } from "@/lib/format";

type ApprovedPayment = {
  id: string;
  supplierName: string;
  description: string;
  amount: number;
  category: string;
  currentDueDate: string;
  costCenter: string;
  work: { id: string; name: string };
  flow: { id: string | null; batchId: string; name: string };
  approvedAt: string;
  approvedBy: { id: string; name: string } | null;
};

type ApprovedPaymentsResponse = {
  payments: ApprovedPayment[];
  summary: { count: number; amount: number; flows: number };
};

export function ApprovedPaymentsTab() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const url = useMemo(() => {
    const parameters = new URLSearchParams();
    if (appliedSearch) parameters.set("search", appliedSearch);
    const query = parameters.toString();
    return `/api/payments/approved${query ? `?${query}` : ""}`;
  }, [appliedSearch]);
  const { data, error, loading, reload } = useFetchData<ApprovedPaymentsResponse>(url);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  const payments = data?.payments ?? [];
  const summary = data?.summary ?? { count: 0, amount: 0, flows: 0 };

  return (
    <>
      <section className="approval-stats approved-payments-stats" aria-label="Resumo dos pagamentos aprovados">
        <div className="approval-stat approval-stat-success">
          <span>Pagamentos aprovados</span>
          <strong>{summary.count}</strong>
          <small>dos fluxos que você importou</small>
        </div>
        <div className="approval-stat approval-stat-success">
          <span>Valor aprovado</span>
          <strong><Money value={summary.amount} /></strong>
          <small>liberado para pagamento</small>
        </div>
        <div className="approval-stat approval-stat-success">
          <span>Fluxos com aprovação</span>
          <strong>{summary.flows}</strong>
          <small>lotes importados por você</small>
        </div>
      </section>

      <form className="panel pad toolbar approved-payments-filters" onSubmit={applySearch}>
        <div className="field">
          <label htmlFor="approved-search">Buscar</label>
          <input
            className="input"
            id="approved-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Fornecedor, descrição, conta ou fluxo"
          />
        </div>
        <div className="approved-payments-filter-actions">
          <button className="button" type="submit"><Search size={16} /> Buscar</button>
          <button className="button secondary" type="button" onClick={reload}>
            <RefreshCw size={16} /> Atualizar
          </button>
        </div>
      </form>

      {error ? <div className="alert error">{error}</div> : null}

      <section className="panel">
        <div className="section-header approved-payments-header">
          <div>
            <h2><CheckCircle2 size={20} /> Aprovações recebidas</h2>
            <span className="muted">Somente pagamentos dos fluxos importados pela sua conta.</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table approved-payments-table">
            <colgroup>
              <col className="approved-supplier-column" />
              <col className="approved-flow-column" />
              <col className="approved-account-column" />
              <col className="approved-date-column" />
              <col className="approved-approval-column" />
              <col className="approved-amount-column" />
            </colgroup>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Fluxo</th>
                <th>Conta</th>
                <th>Vencimento</th>
                <th>Aprovação</th>
                <th className="amount">Valor</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>Carregando pagamentos aprovados...</td></tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {appliedSearch
                      ? "Nenhum pagamento aprovado corresponde à busca."
                      : "Nenhum pagamento dos seus fluxos foi aprovado até agora."}
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <strong>{payment.supplierName}</strong>
                      <small className="muted">{payment.description}</small>
                      {payment.category ? <small className="muted">{payment.category}</small> : null}
                    </td>
                    <td><strong>{payment.flow.name}</strong></td>
                    <td>{payment.work.name || payment.costCenter}</td>
                    <td className="approved-payment-date">{shortDate(payment.currentDueDate)}</td>
                    <td className="approved-payment-approval">
                      <span className="status APROVADO">Aprovado</span>
                      <small className="muted">
                        {payment.approvedBy?.name ?? "Aprovador"} · {dateTime(payment.approvedAt)}
                      </small>
                    </td>
                    <td className="amount"><Money value={payment.amount} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
