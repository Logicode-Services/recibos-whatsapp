import type { ExtractedReceipt } from "./extract/types.ts";

// Reglas que no dependen de dónde vienen los datos ni a dónde van. Todo puro,
// para poder probarlo con ejemplos.

// ─── Normalización ──────────────────────────────────────────────────────────

// La salida ya respeta el esquema JSON; esto corrige lo que el esquema no puede
// garantizar: fechas imposibles, montos negativos o en cero, categorías que no
// existen (si el lector no es Claude), RUT con puntos.
export function normalizeReceipt(r: ExtractedReceipt, categoryKeys: string[]): ExtractedReceipt {
  const validDate =
    r.receipt_date != null && /^\d{4}-\d{2}-\d{2}$/.test(r.receipt_date) && !Number.isNaN(Date.parse(r.receipt_date));
  const positive = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  const category = (c: string | null | undefined) => (c != null && categoryKeys.includes(c) ? c : null);
  return {
    ...r,
    receipt_date: validDate ? r.receipt_date : null,
    vendor_rut: r.vendor_rut ? r.vendor_rut.replace(/\D/g, "") || null : null,
    total: positive(r.total),
    tax_amount: positive(r.tax_amount),
    is_credit_note: Boolean(r.is_credit_note),
    category: category(r.category),
    items: (r.items ?? []).slice(0, 30).map((i) => ({ ...i, total: positive(i.total), category: category(i.category) })),
  };
}

// ─── Compras mezcladas ──────────────────────────────────────────────────────

export type CategorySplit = { category: string; amount: number };

// Un ticket de supermercado con comida y artículos de limpieza: un gasto por
// categoría, armado con los ítems. Solo se divide cuando todos los ítems se
// leyeron con importe y categoría y suman el total impreso (3 % de margen por
// descuentos y redondeos). Los montos se reparten en proporción para que
// sumen exactamente el total.
export function splitByCategory(
  items: { total: number | null; category: string | null }[],
  total: number | null,
): CategorySplit[] | null {
  if (total == null || !(total > 0) || items.length < 2) return null;
  if (items.some((i) => i.total == null || i.category == null)) return null;
  const sum = items.reduce((s, i) => s + (i.total as number), 0);
  if (!(sum > 0) || Math.abs(sum - total) / total > 0.03) return null;

  const byCategory = new Map<string, number>();
  for (const i of items) byCategory.set(i.category as string, (byCategory.get(i.category as string) ?? 0) + (i.total as number));
  if (byCategory.size < 2) return null;

  const splits = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount: Math.round((amount / sum) * total * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
  // El redondeo puede dejar unos centésimos sueltos: van a la parte más grande.
  const diff = Math.round((total - splits.reduce((s, x) => s + x.amount, 0)) * 100) / 100;
  splits[0].amount = Math.round((splits[0].amount + diff) * 100) / 100;
  return splits;
}

// ─── Duplicados ─────────────────────────────────────────────────────────────

// La misma compra fotografiada dos veces (o por los dos socios) da archivos
// distintos, así que el hash no alcanza. Se marca como posible duplicado si
// coincide el monto (con $1 de margen) y la fecha está a 3 días o menos. Si
// los dos tienen comercio, además tiene que coincidir.
export const DUPLICATE_DAYS = 3;

export type DuplicateKey = { id: string; amount: number | null; date: string | null; vendor: string | null };

export function findLikelyDuplicate(receipt: DuplicateKey, earlier: DuplicateKey[]): DuplicateKey | null {
  if (receipt.amount == null || !receipt.date) return null;
  const day = Date.parse(receipt.date);
  let best: { c: DuplicateKey; distance: number } | null = null;
  for (const c of earlier) {
    if (c.id === receipt.id || c.amount == null || !c.date) continue;
    if (Math.abs(c.amount - receipt.amount) > 1) continue;
    if (receipt.vendor && c.vendor && simplify(receipt.vendor) !== simplify(c.vendor)) continue;
    const distance = Math.abs(Date.parse(c.date) - day) / 86_400_000;
    if (distance > DUPLICATE_DAYS) continue;
    if (!best || distance < best.distance) best = { c, distance };
  }
  return best?.c ?? null;
}

function simplify(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─── Qué necesita una persona ───────────────────────────────────────────────

export type ReviewStatus = "listo" | "revisar" | "descartado";

// Nada entra como gasto "listo" si hubo que suponer algo. Las razones van a la
// planilla para que quien revisa sepa qué mirar.
export function reviewStatus(
  r: ExtractedReceipt,
  extra: { dateFromSent: boolean; duplicateOf: string | null },
): { status: ReviewStatus; reasons: string[] } {
  if (!r.is_receipt) return { status: "descartado", reasons: ["No parece un comprobante"] };
  const reasons: string[] = [];
  if (r.total == null) reasons.push("No se leyó el total");
  if (r.category == null) reasons.push("Sin categoría");
  if (extra.dateFromSent) reasons.push("Sin fecha legible: se usó la del mensaje");
  if (r.confidence !== "alta") reasons.push(`Lectura con confianza ${r.confidence}`);
  if (r.currency === "USD") reasons.push("En dólares");
  if (extra.duplicateOf) reasons.push(`Posible duplicado de ${extra.duplicateOf}`);
  if (r.review_note) reasons.push(r.review_note);
  return { status: reasons.length ? "revisar" : "listo", reasons };
}
