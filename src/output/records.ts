import type { Category } from "../categories.ts";
import type { ReceiptRow } from "../pipeline.ts";

// Una fila de recibo → uno o más gastos (uno por categoría si la compra estaba
// mezclada). Es la forma que comparten la planilla, el JSON y el webhook.

export type ExpenseRecord = {
  id: string; // hash del archivo (+ categoría si se dividió): estable entre corridas
  status: ReceiptRow["status"];
  reasons: string[];
  date: string | null;
  vendor: string | null;
  vendorRut: string | null;
  documentNumber: string | null;
  description: string | null;
  category: string | null;
  categoryLabel: string | null;
  amount: number | null;
  currency: "UYU" | "USD" | null;
  taxAmount: number | null;
  paymentMethod: string | null;
  sentBy: string | null;
  chatNote: string | null;
  fileName: string;
};

export function toRecords(rows: ReceiptRow[], categories: Category[]): ExpenseRecord[] {
  const label = (key: string | null) => categories.find((c) => c.key === key)?.label ?? null;
  return rows.flatMap((row) => {
    const r = row.receipt;
    const base: ExpenseRecord = {
      id: row.hash,
      status: row.status,
      reasons: row.reasons,
      date: row.date,
      vendor: r?.vendor ?? null,
      vendorRut: r?.vendor_rut ?? null,
      documentNumber: r?.document_number ?? null,
      description: r?.description ?? null,
      category: r?.category ?? null,
      categoryLabel: label(r?.category ?? null),
      amount: row.amount,
      currency: r?.currency ?? null,
      taxAmount: r?.tax_amount ?? null,
      paymentMethod: r?.payment_method ?? null,
      sentBy: row.sentBy,
      chatNote: row.chatNote,
      fileName: row.fileName,
    };
    if (!row.splits) return [base];
    const sign = r?.is_credit_note ? -1 : 1;
    return row.splits.map((s) => ({
      ...base,
      id: `${row.hash}:${s.category}`,
      category: s.category,
      categoryLabel: label(s.category),
      amount: sign * s.amount,
      description: `${base.description ?? "Compra"} (${label(s.category) ?? s.category})`,
      // El IVA no viene por línea: queda solo en la primera parte.
      taxAmount: s === row.splits![0] ? base.taxAmount : null,
    }));
  });
}
