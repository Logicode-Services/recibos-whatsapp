import type { Category } from "../categories.ts";

// Lo que se saca de un comprobante. Todo lo que no se pudo leer va en null:
// es un borrador para que una persona lo revise, no un dato final.
export type ExtractedReceipt = {
  is_receipt: boolean;
  is_credit_note: boolean;
  receipt_date: string | null; // AAAA-MM-DD
  vendor: string | null;
  vendor_rut: string | null;
  document_number: string | null;
  description: string | null;
  items: { description: string; quantity: number | null; total: number | null; category: string | null }[];
  total: number | null;
  currency: "UYU" | "USD" | null;
  tax_amount: number | null;
  payment_method: "efectivo" | "transferencia" | "tarjeta" | null;
  category: string | null;
  confidence: "alta" | "media" | "baja";
  review_note: string | null;
};

export type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export type ExtractInput = {
  fileName: string;
  data: Uint8Array;
  mediaType: MediaType;
  sentBy: string | null;
  chatNote: string | null;
};

export type ExtractorContext = {
  businessDescription: string;
  categories: Category[];
};

// El "puerto": el resto del programa solo conoce esta forma. Hoy hay dos
// adaptadores (Claude y respuestas guardadas); mañana podría haber un OCR local.
export interface ReceiptExtractor {
  // Entra en la clave de la caché: cambiar de lector o de prompt invalida
  // las lecturas guardadas.
  readonly id: string;
  extract(input: ExtractInput): Promise<ExtractedReceipt>;
}
