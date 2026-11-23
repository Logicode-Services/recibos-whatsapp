import { ReadCache, sha256 } from "./cache.ts";
import type { Category } from "./categories.ts";
import type { ExtractedReceipt, ReceiptExtractor } from "./extract/types.ts";
import { findLikelyDuplicate, normalizeReceipt, reviewStatus, splitByCategory, type CategorySplit, type ReviewStatus } from "./rules.ts";
import { readExport, type ExportFile } from "./zip.ts";

// El flujo completo: zip → adjuntos → lectura (con caché) → reglas → filas.
// No sabe de planillas ni de webhooks: eso lo hacen las salidas.

// Claude acepta hasta 5 MB por imagen.
const MAX_BYTES = 5 * 1024 * 1024;

export type ReceiptRow = {
  fileName: string;
  hash: string;
  sentAt: string | null;
  sentBy: string | null;
  chatNote: string | null;
  status: ReviewStatus | "error";
  reasons: string[];
  receipt: ExtractedReceipt | null;
  date: string | null; // la del comprobante o, si no se leyó, la del mensaje
  dateFromSent: boolean;
  amount: number | null; // negativo en notas de crédito
  splits: CategorySplit[] | null;
  duplicateOf: string | null;
  fromCache: boolean;
};

export type ProcessOptions = {
  extractor: ReceiptExtractor;
  categories: Category[];
  cache?: ReadCache;
  concurrency?: number;
  onProgress?: (done: number, total: number, row: ReceiptRow) => void;
};

export async function processExport(zipBytes: Uint8Array, options: ProcessOptions) {
  const { chatFile, files } = readExport(zipBytes);
  const cache = options.cache ?? new ReadCache(null);
  const categoryKeys = options.categories.map((c) => c.key);

  // La misma foto reenviada al grupo es el mismo archivo: se lee una vez.
  const seen = new Map<string, string>();
  const unique: { file: ExportFile; hash: string }[] = [];
  const copies: ReceiptRow[] = [];
  for (const file of files) {
    const hash = sha256(file.data);
    const first = seen.get(hash);
    if (first) {
      copies.push({ ...emptyRow(file, hash), status: "descartado", reasons: [`Copia exacta de ${first}`] });
    } else {
      seen.set(hash, file.fileName);
      unique.push({ file, hash });
    }
  }

  let done = 0;
  const read = await mapLimit(unique, options.concurrency ?? 3, async ({ file, hash }) => {
    const row = await readOne(file, hash, options.extractor, cache, categoryKeys);
    options.onProgress?.(++done, unique.length, row);
    return row;
  });

  // Duplicados probables: se compara cada recibo con los anteriores, en el
  // orden del chat, para marcar el segundo y no el primero.
  const earlier: { id: string; amount: number | null; date: string | null; vendor: string | null }[] = [];
  for (const row of read) {
    if (!row.receipt) continue; // errores: ya traen su motivo
    if (row.receipt.is_receipt) {
      const key = { id: row.fileName, amount: row.amount, date: row.date, vendor: row.receipt.vendor };
      row.duplicateOf = findLikelyDuplicate(key, earlier)?.id ?? null;
      earlier.push(key);
    }
    const { status, reasons } = reviewStatus(row.receipt, row);
    row.status = status;
    row.reasons = reasons;
  }

  return { chatFile, rows: [...read, ...copies] };
}

async function readOne(
  file: ExportFile,
  hash: string,
  extractor: ReceiptExtractor,
  cache: ReadCache,
  categoryKeys: string[],
): Promise<ReceiptRow> {
  const row = emptyRow(file, hash);
  if (!file.mediaType) {
    return { ...row, status: "error", reasons: ["Formato que no se puede leer (HEIC). En el iPhone: Ajustes → Cámara → Formatos → Más compatible."] };
  }
  if (file.data.byteLength > MAX_BYTES) {
    return { ...row, status: "error", reasons: ["El archivo pesa más de 5 MB."] };
  }

  try {
    let raw = await cache.get(extractor.id, hash);
    row.fromCache = raw != null;
    if (!raw) {
      raw = await extractor.extract({ fileName: file.fileName, data: file.data, mediaType: file.mediaType, sentBy: file.sentBy, chatNote: file.note });
      await cache.set(extractor.id, hash, raw);
    }
    const receipt = normalizeReceipt(raw, categoryKeys);
    const dateFromSent = receipt.is_receipt && !receipt.receipt_date && file.sentAt != null;
    const amount = receipt.total == null ? null : receipt.is_credit_note ? -receipt.total : receipt.total;
    return {
      ...row,
      receipt,
      status: receipt.is_receipt ? "listo" : "descartado",
      date: receipt.receipt_date ?? file.sentAt?.slice(0, 10) ?? null,
      dateFromSent,
      amount,
      splits: splitByCategory(receipt.items, receipt.total),
    };
  } catch (error) {
    // Un recibo que falla no frena la tanda: queda como fila con el motivo.
    return { ...row, status: "error", reasons: [error instanceof Error ? error.message : String(error)] };
  }
}

function emptyRow(file: ExportFile, hash: string): ReceiptRow {
  return {
    fileName: file.fileName,
    hash,
    sentAt: file.sentAt,
    sentBy: file.sentBy,
    chatNote: file.note,
    status: "error",
    reasons: [],
    receipt: null,
    date: null,
    dateFromSent: false,
    amount: null,
    splits: null,
    duplicateOf: null,
    fromCache: false,
  };
}

// Como Promise.all, pero con un máximo de tareas a la vez: 50 fotos no salen
// juntas contra la API. Devuelve los resultados en el orden de entrada.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
