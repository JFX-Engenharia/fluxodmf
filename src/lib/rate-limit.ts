import { ApiError } from "@/lib/api";

type RateLimitRule = {
  /** Tentativas permitidas dentro da janela. */
  limit: number;
  /** Duracao da janela em milissegundos. */
  windowMs: number;
  /** Mensagem devolvida ao cliente quando o limite estoura (HTTP 429). */
  message: string;
};

/**
 * Regras nomeadas. Cada regra tem seu proprio espaco de chaves, entao o
 * contador de login nunca se mistura com o de cadastro mesmo com o mesmo IP.
 */
const RULES = {
  login: {
    limit: 10,
    windowMs: 15 * 60 * 1_000,
    message: "Muitas tentativas. Aguarde alguns minutos.",
  },
  signup: {
    limit: 5,
    windowMs: 60 * 60 * 1_000,
    message: "Muitas solicitações de cadastro deste endereço. Tente novamente mais tarde.",
  },
  // Envio de notas do PWA. Conta por USUARIO, nao por IP: o colaborador esta em
  // rede movel, onde a operadora compartilha o mesmo IP entre muitos aparelhos
  // (CGNAT) e um limite por IP puniria a equipe inteira. O teto e folgado de
  // proposito — quem volta de uma area sem sinal despeja a fila acumulada.
  "nota-upload": {
    limit: 30,
    windowMs: 10 * 60 * 1_000,
    message: "Muitos envios seguidos. Aguarde alguns minutos e tente de novo.",
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RULES;

/**
 * LIMITACAO CONHECIDA: o estado vive neste Map, ou seja, na memoria de uma
 * unica instancia do processo Node. As consequencias praticas sao:
 *
 * - Com varias instancias (escala horizontal, serverless, rolling deploy) cada
 *   processo conta em separado, e o limite efetivo vira `limite x instancias`.
 * - Todo restart/deploy zera os contadores.
 *
 * Serve como freio contra forca bruta trivial, nao como defesa distribuida.
 * Para valer no cluster inteiro, trocar este Map por armazenamento
 * compartilhado (Redis, ou uma tabela no Postgres) mantendo esta mesma API.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

/** Teto rigido de chaves vivas: o Map nunca passa disso. */
const MAX_TRACKED_KEYS = 10_000;

function pruneExpired(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Garante espaco para mais uma chave. Primeiro descarta o que ja expirou; se
 * ainda estiver no teto, despeja as janelas que expiram primeiro (as mais
 * antigas) ate abrir uma vaga.
 *
 * O despejo zera o contador de quem foi removido, entao sob enxurrada de chaves
 * novas o limite afrouxa para os mais antigos. E a troca consciente: preferimos
 * afrouxar a deixar o Map crescer sem limite e derrubar o processo por memoria.
 */
function makeRoom(now: number) {
  pruneExpired(now);
  if (windows.size < MAX_TRACKED_KEYS) return;

  const oldestFirst = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const excess = windows.size - MAX_TRACKED_KEYS + 1;
  for (let index = 0; index < excess; index += 1) {
    windows.delete(oldestFirst[index][0]);
  }
}

/**
 * Conta uma tentativa e lanca ApiError 429 quando a chave estoura a regra.
 * `identifier` e o que separa um cliente do outro (IP, IP:usuario, etc.).
 */
export function enforceRateLimit(name: RateLimitName, identifier: string) {
  const rule = RULES[name];
  const now = Date.now();
  const key = `${name}:${identifier}`;
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    // So precisa de vaga quando a chave ainda nao existe; reaproveitar uma
    // janela vencida nao aumenta o tamanho do Map.
    if (!current) makeRoom(now);
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }

  if (current.count >= rule.limit) {
    throw new ApiError(429, rule.message);
  }

  current.count += 1;
}

/** Login: 10 tentativas a cada 15 minutos por IP + usuario informado. */
export function enforceLoginRateLimit(ipAddress: string | null, normalizedUsername: string) {
  enforceRateLimit("login", `${ipAddress ?? "unknown"}:${normalizedUsername}`);
}

/** Autocadastro: 5 solicitacoes por hora por IP (nao ha usuario ainda). */
export function enforceSignupRateLimit(ipAddress: string | null) {
  enforceRateLimit("signup", ipAddress ?? "unknown");
}
