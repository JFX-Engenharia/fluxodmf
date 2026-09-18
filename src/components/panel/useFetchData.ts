"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Busca JSON de uma rota do painel e devolve o estado de carregamento.
 *
 * O setState fica dentro dos callbacks da promise, nunca no corpo do efeito:
 * chamar setState sincronamente ali dispara render em cascata. Trocar a `url`
 * (ex.: mudar um filtro) refaz a busca sozinho, e `reload` forca uma nova.
 */
export function useFetchData<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    fetch(url)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Não foi possível carregar os dados.");
        }
        return body as T;
      })
      .then((body) => {
        if (!active) return;
        setData(body);
        setError("");
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message === "Failed to fetch" ? "Falha de conexão." : err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [url, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  return { data, error, loading, reload, setError };
}
