import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../src/categories.ts";
import type { ExtractedReceipt } from "../src/extract/types.ts";
import { findLikelyDuplicate, normalizeReceipt, reviewStatus, splitByCategory } from "../src/rules.ts";

const keys = DEFAULT_CATEGORIES.map((c) => c.key);

const receipt = (over: Partial<ExtractedReceipt> = {}): ExtractedReceipt => ({
  is_receipt: true,
  is_credit_note: false,
  receipt_date: "2026-11-10",
  vendor: "Carnicería El Novillo",
  vendor_rut: null,
  document_number: null,
  description: "Carne",
  items: [],
  total: 1000,
  currency: "UYU",
  tax_amount: null,
  payment_method: null,
  category: "proveedores",
  confidence: "alta",
  review_note: null,
  ...over,
});

describe("normalización", () => {
  it("descarta fechas imposibles, montos no positivos y categorías que no existen", () => {
    const r = normalizeReceipt(
      receipt({ receipt_date: "2026-13-45", total: -5, vendor_rut: "21.999.999.0011", category: "comida" }),
      keys,
    );
    expect(r.receipt_date).toBeNull();
    expect(r.total).toBeNull();
    expect(r.vendor_rut).toBe("219999990011");
    expect(r.category).toBeNull();
  });

  it("redondea a centésimos", () => {
    expect(normalizeReceipt(receipt({ total: 10.005 }), keys).total).toBe(10.01);
  });
});

describe("compras mezcladas", () => {
  it("divide por categoría y cuadra el total exacto", () => {
    const items = [
      { total: 600, category: "proveedores" },
      { total: 250, category: "insumos" },
      { total: 150, category: "proveedores" },
    ];
    // Ticket con un descuento general de $10 (1 %): se reparte en proporción.
    const splits = splitByCategory(items, 990)!;
    expect(splits.map((s) => s.category)).toEqual(["proveedores", "insumos"]);
    expect(splits.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(990, 2);
    expect(splits[1].amount).toBeCloseTo(247.5, 2);
  });

  it("no divide si falta un ítem, si no cuadra o si es una sola categoría", () => {
    expect(splitByCategory([{ total: 600, category: "proveedores" }, { total: null, category: "insumos" }], 900)).toBeNull();
    expect(splitByCategory([{ total: 600, category: "proveedores" }, { total: 100, category: "insumos" }], 900)).toBeNull();
    expect(splitByCategory([{ total: 600, category: "proveedores" }, { total: 300, category: "proveedores" }], 900)).toBeNull();
  });
});

describe("duplicados", () => {
  const earlier = [
    { id: "lejos", amount: 1500, date: "2026-11-01", vendor: "Kiosco" },
    { id: "cerca", amount: 1500.4, date: "2026-11-16", vendor: "Kiosco" },
    { id: "otro-comercio", amount: 1500, date: "2026-11-17", vendor: "Panadería" },
  ];

  it("toma el del mismo monto y comercio más cercano en fecha", () => {
    expect(findLikelyDuplicate({ id: "nuevo", amount: 1500, date: "2026-11-17", vendor: "kiosco" }, earlier)?.id).toBe("cerca");
  });

  it("no marca nada fuera de los 3 días, sin monto o con otro comercio", () => {
    expect(findLikelyDuplicate({ id: "n", amount: 1500, date: "2026-11-25", vendor: "Kiosco" }, earlier)).toBeNull();
    expect(findLikelyDuplicate({ id: "n", amount: null, date: "2026-11-17", vendor: "Kiosco" }, earlier)).toBeNull();
    expect(findLikelyDuplicate({ id: "n", amount: 1500, date: "2026-11-18", vendor: "Ferretería" }, earlier)).toBeNull();
  });
});

describe("qué va a revisión", () => {
  const none = { dateFromSent: false, duplicateOf: null };

  it("una lectura clara y completa queda lista", () => {
    expect(reviewStatus(receipt(), none)).toEqual({ status: "listo", reasons: [] });
  });

  it("cualquier suposición manda a revisar, con el motivo", () => {
    expect(reviewStatus(receipt({ confidence: "media" }), none).status).toBe("revisar");
    expect(reviewStatus(receipt({ currency: "USD" }), none).reasons).toContain("En dólares");
    expect(reviewStatus(receipt(), { dateFromSent: true, duplicateOf: null }).status).toBe("revisar");
    expect(reviewStatus(receipt(), { dateFromSent: false, duplicateOf: "a.jpg" }).reasons).toContain("Posible duplicado de a.jpg");
  });

  it("lo que no es un comprobante se descarta", () => {
    expect(reviewStatus(receipt({ is_receipt: false }), none).status).toBe("descartado");
  });
});
