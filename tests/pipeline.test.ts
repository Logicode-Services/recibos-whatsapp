import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReadCache } from "../src/cache.ts";
import { DEFAULT_CATEGORIES } from "../src/categories.ts";
import { FixtureExtractor } from "../src/extract/fixtures.ts";
import type { ReceiptExtractor } from "../src/extract/types.ts";
import { toRecords } from "../src/output/records.ts";
import { mapLimit, processExport } from "../src/pipeline.ts";

const demoZip = async () => new Uint8Array(await readFile(join(import.meta.dirname, "..", "demo", "chat-demo.zip")));
const fixtures = new FixtureExtractor(join(import.meta.dirname, "..", "demo", "respuestas"));

describe("flujo completo con el chat de demo", () => {
  it("clasifica cada archivo como corresponde", async () => {
    const { rows } = await processExport(await demoZip(), { extractor: fixtures, categories: DEFAULT_CATEGORIES });
    const status = Object.fromEntries(rows.map((r) => [r.fileName.slice(0, 8), r.status]));
    expect(status).toEqual({
      "00000003": "listo",
      "00000004": "listo",
      "00000006": "listo",
      "00000007": "listo",
      "00000008": "descartado",
      "00000009": "revisar",
      "00000010": "revisar",
      "00000012": "descartado",
      "00000013": "error",
    });
    const carne = rows.find((r) => r.fileName.startsWith("00000003"))!;
    expect(carne.sentBy).toBe("Ana");
    expect(carne.chatNote).toBe("carne de la semana");
  });

  it("arma los gastos: compra dividida y nota de crédito en negativo", async () => {
    const { rows } = await processExport(await demoZip(), { extractor: fixtures, categories: DEFAULT_CATEGORIES });
    const ready = toRecords(rows, DEFAULT_CATEGORIES).filter((r) => r.status === "listo");
    expect(ready.map((r) => [r.categoryLabel, r.amount])).toEqual([
      ["Proveedores", 3450],
      ["Proveedores", 1310],
      ["Insumos", 490],
      ["Servicios", 2890],
      ["Proveedores", -600],
    ]);
  });

  it("con caché, la segunda corrida no vuelve a llamar al lector", async () => {
    let calls = 0;
    const counting: ReceiptExtractor = { id: fixtures.id, extract: (i) => (calls++, fixtures.extract(i)) };
    const cache = new ReadCache(await mkdtemp(join(tmpdir(), "recibos-")));
    const options = { extractor: counting, categories: DEFAULT_CATEGORIES, cache };
    await processExport(await demoZip(), options);
    const first = calls;
    const { rows } = await processExport(await demoZip(), options);
    expect(first).toBe(7);
    expect(calls).toBe(first);
    expect(rows.filter((r) => r.fromCache)).toHaveLength(7);
  });

  it("un recibo que falla no frena a los demás", async () => {
    const flaky: ReceiptExtractor = {
      id: "flaky",
      extract: (i) => (i.fileName.startsWith("00000004") ? Promise.reject(new Error("API caída")) : fixtures.extract(i)),
    };
    const { rows } = await processExport(await demoZip(), { extractor: flaky, categories: DEFAULT_CATEGORIES });
    expect(rows.find((r) => r.fileName.startsWith("00000004"))).toMatchObject({ status: "error", reasons: ["API caída"] });
    expect(rows.filter((r) => r.status === "listo")).toHaveLength(3);
  });

  it("rechaza algo que no es un zip con un mensaje claro", async () => {
    await expect(processExport(new Uint8Array([1, 2, 3]), { extractor: fixtures, categories: DEFAULT_CATEGORIES })).rejects.toThrow(
      "no es un .zip",
    );
  });
});

describe("concurrencia", () => {
  it("nunca corre más tareas a la vez que el límite y respeta el orden", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 1], 2, async (ms) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return ms * 10;
    });
    expect(peak).toBe(2);
    expect(out).toEqual([50, 10, 40, 20, 30, 10]);
  });
});
