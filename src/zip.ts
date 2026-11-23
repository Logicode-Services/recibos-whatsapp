import { unzipSync } from "fflate";
import { findChatTextFile, isReceiptFileName, parseChatAttachments, type ChatAttachment } from "./chat-export.ts";
import type { MediaType } from "./extract/types.ts";

// Abre el .zip de "Exportar chat → Incluir archivos" y devuelve cada adjunto
// que puede ser un recibo, con lo que dice el chat sobre él.

export type ExportFile = ChatAttachment & {
  data: Uint8Array;
  mediaType: MediaType | null; // null = formato que Claude no lee
};

const MEDIA_TYPES: Record<string, MediaType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

export function readExport(zipBytes: Uint8Array): { chatFile: string | null; files: ExportFile[] } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error("El archivo no es un .zip válido. Exportá el chat con \"Incluir archivos\".");
  }

  const names = Object.keys(entries).filter((n) => !n.startsWith("__MACOSX/"));
  const chatFile = findChatTextFile(names);
  const attachments = chatFile ? parseChatAttachments(new TextDecoder().decode(entries[chatFile])) : new Map();

  const files = names
    .filter((n) => isReceiptFileName(n))
    .map((n): ExportFile => {
      const base = n.split("/").pop()!;
      const ext = base.split(".").pop()!.toLowerCase();
      // Una foto sin línea en el chat (chat recortado) igual se lee, sin remitente.
      const meta: ChatAttachment = attachments.get(base) ?? { fileName: base, sentAt: null, sentBy: null, note: null };
      return { ...meta, fileName: base, data: entries[n], mediaType: MEDIA_TYPES[ext] ?? null };
    })
    .sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? "") || a.fileName.localeCompare(b.fileName));

  return { chatFile, files };
}
