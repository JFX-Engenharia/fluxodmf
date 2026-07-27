"use client";

import { Search, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { usePanel } from "@/components/panel/PanelContext";
import { TAB_IDS, type TabId } from "@/lib/permissions";

type SearchResult = {
  id: string;
  type: "payment" | "request" | "work";
  title: string;
  subtitle: string;
  tab: TabId;
};

const typeLabels = { payment: "Pagamento", request: "Solicitação", work: "Conta" };

function isSearchResult(value: unknown): value is SearchResult {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "type" in value &&
    (value.type === "payment" || value.type === "request" || value.type === "work") &&
    "title" in value &&
    typeof value.title === "string" &&
    "subtitle" in value &&
    typeof value.subtitle === "string" &&
    "tab" in value &&
    typeof value.tab === "string" &&
    (TAB_IDS as readonly string[]).includes(value.tab)
  );
}

export function GlobalSearch() {
  const { tabs, goToTab } = usePanel();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  async function runSearch(searchQuery: string) {
    const normalized = searchQuery.trim();
    if (normalized.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const value: unknown = await response.json();
      if (currentRequest !== requestId.current) return;
      if (response.ok && value && typeof value === "object" && "results" in value && Array.isArray(value.results)) {
        setResults(value.results.filter(isSearchResult));
        setOpen(true);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  function choose(result: SearchResult) {
    setOpen(false);
    if (tabs.includes(result.tab)) goToTab(result.tab);
  }

  return (
    <div className="global-search">
      <form className="global-search-form" role="search" onSubmit={submit}>
        <Search size={17} aria-hidden="true" />
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-controls="global-search-results"
          aria-expanded={open}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Buscar fornecedor, documento, conta, valor..."
          aria-label="Busca global"
        />
        {query ? (
          <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(""); setResults([]); setOpen(false); }}>
            <X size={15} />
          </button>
        ) : null}
      </form>
      {open ? (
        <div id="global-search-results" className="global-search-results" role="listbox" aria-label="Resultados da busca">
          {loading ? <span className="muted">Buscando...</span> : null}
          {!loading && results.length === 0 ? <span className="muted">Nenhum resultado encontrado.</span> : null}
          {results.map((result) => (
            <button type="button" role="option" aria-selected="false" key={`${result.type}-${result.id}`} onClick={() => choose(result)}>
              <small>{typeLabels[result.type]}</small>
              <strong>{result.title}</strong>
              <span>{result.subtitle}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
