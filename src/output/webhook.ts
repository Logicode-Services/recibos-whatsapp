import type { ExpenseRecord } from "./records.ts";

// Manda cada gasto a una URL (un nodo Webhook de n8n, Make, Zapier o una API
// propia). Pensado para que el otro lado pueda recibir lo mismo dos veces sin
// duplicar: cada envío lleva Idempotency-Key = id estable del gasto.

export type WebhookOptions = {
  url: string;
  secret?: string; // va en el encabezado Authorization: Bearer
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch; // para los tests
  sleep?: (ms: number) => Promise<void>;
};

export type WebhookResult = { sent: number; failed: { id: string; error: string }[] };

class PermanentError extends Error {}

export async function sendToWebhook(records: ExpenseRecord[], options: WebhookOptions): Promise<WebhookResult> {
  const result: WebhookResult = { sent: 0, failed: [] };
  // De a uno y en orden: un receptor chico (una planilla) no aguanta ráfagas,
  // y así el orden de llegada es el del chat.
  for (const record of records) {
    try {
      await postWithRetry(record, options);
      result.sent++;
    } catch (error) {
      result.failed.push({ id: record.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

async function postWithRetry(record: ExpenseRecord, o: WebhookOptions) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = o.maxAttempts ?? 4;
  const baseDelay = o.baseDelayMs ?? 1000;

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(o.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": record.id,
          ...(o.secret ? { Authorization: `Bearer ${o.secret}` } : {}),
        },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      // 4xx (salvo 408 y 429) = el pedido está mal; reintentar no lo arregla.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new PermanentError(`El webhook respondió ${res.status}`);
      }
      if (attempt >= maxAttempts) throw new Error(`El webhook respondió ${res.status} después de ${attempt} intentos`);
      await sleep(retryDelay(res.headers.get("retry-after"), baseDelay, attempt));
    } catch (error) {
      if (error instanceof PermanentError || attempt >= maxAttempts) throw error;
      // Corte de red o timeout: se reintenta igual que un 5xx.
      await sleep(retryDelay(null, baseDelay, attempt));
    }
  }
}

// Espera creciente (1 s, 2 s, 4 s…) con un poco de azar, para que varios
// clientes que fallaron juntos no reintenten todos en el mismo instante.
// Si el servidor dice cuánto esperar (Retry-After), se le hace caso.
export function retryDelay(retryAfter: string | null, baseMs: number, attempt: number) {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  return baseMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4);
}
