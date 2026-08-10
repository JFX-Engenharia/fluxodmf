import { ApiError } from "@/lib/api";

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_ATTEMPT_LIMIT = 10;
const windows = new Map<string, { count: number; resetAt: number }>();

export function enforceLoginRateLimit(ipAddress: string | null, normalizedUsername: string) {
  const now = Date.now();
  const key = `${ipAddress ?? "unknown"}:${normalizedUsername}`;
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  if (current.count >= LOGIN_ATTEMPT_LIMIT) {
    throw new ApiError(429, "Muitas tentativas. Aguarde alguns minutos.");
  }

  current.count += 1;
}
