import { describe, expect, it, vi } from "vitest";
import type { ExpenseRecord } from "../src/output/records.ts";
import { retryDelay, sendToWebhook } from "../src/output/webhook.ts";

const record = (id: string) => ({ id, status: "listo", amount: 100 }) as ExpenseRecord;
const noWait = async () => {};
const reply = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("webhook", () => {
  it("manda cada gasto con su Idempotency-Key", async () => {
    const fetchImpl = vi.fn(async () => reply(200));
    const result = await sendToWebhook([record("a"), record("b")], { url: "https://x.test/hook", fetchImpl, sleep: noWait });
    expect(result).toEqual({ sent: 2, failed: [] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("a");
  });

  it("reintenta errores pasajeros (503, corte de red) hasta que anda", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply(503))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(reply(200));
    const result = await sendToWebhook([record("a")], { url: "https://x.test", fetchImpl, sleep: noWait });
    expect(result.sent).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("no reintenta un 400: el pedido está mal y repetirlo no lo arregla", async () => {
    const fetchImpl = vi.fn(async () => reply(400));
    const result = await sendToWebhook([record("a")], { url: "https://x.test", fetchImpl, sleep: noWait });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.failed[0].error).toContain("400");
  });

  it("se rinde después del máximo de intentos y sigue con el próximo gasto", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      (init?.headers as Record<string, string>)["Idempotency-Key"] === "a" ? reply(500) : reply(200),
    );
    const result = await sendToWebhook([record("a"), record("b")], { url: "https://x.test", fetchImpl, sleep: noWait, maxAttempts: 3 });
    expect(result.sent).toBe(1);
    expect(result.failed.map((f) => f.id)).toEqual(["a"]);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 3 intentos de "a" + 1 de "b"
  });

  it("respeta Retry-After y si no, espera el doble cada vez", () => {
    expect(retryDelay("7", 1000, 1)).toBe(7000);
    const third = retryDelay(null, 1000, 3);
    expect(third).toBeGreaterThanOrEqual(3200);
    expect(third).toBeLessThanOrEqual(4800);
  });
});
