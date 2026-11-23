// Lee el texto de un chat exportado de WhatsApp ("Exportar chat → Incluir
// archivos") y devuelve, por cada archivo adjunto, quién lo mandó y cuándo.
// Funciones puras: no leen archivos ni llaman a nada externo, así se prueban
// con texto de ejemplo.
//
// Formatos que aparecen según el teléfono y el idioma:
//   iPhone:  [17/11/26, 14:32:05] Ana: ‎<adjunto: 00000012-PHOTO-2026-11-17-14-32-05.jpg>
//   Android: 17/11/26 14:32 - Ana: IMG-20261117-WA0003.jpg (archivo adjunto)
// WhatsApp usa el orden día/mes/año en español; si el chat está en inglés de
// EE. UU. viene mes/día, y para eso se prefiere la fecha del nombre del archivo.

export type ChatAttachment = {
  fileName: string;
  sentAt: string | null; // ISO local sin zona: "2026-11-17T14:32:05"
  sentBy: string | null;
  note: string | null;
};

const RECEIPT_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;

export function isReceiptFileName(name: string) {
  const base = name.split("/").pop() ?? name;
  return RECEIPT_EXTENSIONS.test(base) && !base.startsWith(".");
}

// Marcas invisibles de dirección de texto que WhatsApp mete en el export.
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;

const HEADER_IOS = /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]\s*([^:]+?):\s?(.*)$/i;
const HEADER_ANDROID = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\s*[-–]\s*([^:]+?):\s?(.*)$/i;

const ATTACHMENT_NAME = /([\w.-]+\.(?:jpe?g|png|webp|heic|heif|pdf))/i;
const ATTACHMENT_MARKERS =
  /<\s*(?:adjunto|attached|anexo)\s*:\s*[^>]+>|\((?:archivo adjunto|file attached|arquivo anexado)\)|(?:archivo adjunto|file attached)/gi;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Fecha que WhatsApp pone en el nombre: PHOTO-2026-11-17-14-32-05 / IMG-20261117-WA0003.
export function dateFromFileName(fileName: string): string | null {
  const ios = fileName.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (ios) return `${ios[1]}-${ios[2]}-${ios[3]}T${ios[4]}:${ios[5]}:${ios[6]}`;
  const android = fileName.match(/(?:IMG|DOC|PTT|VID)-(\d{4})(\d{2})(\d{2})-WA/i);
  if (android) return `${android[1]}-${android[2]}-${android[3]}T00:00:00`;
  return null;
}

function headerDate(m: RegExpMatchArray): string | null {
  let day = Number(m[1]);
  let month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  // Si el "mes" no puede ser mes, el chat viene en orden mes/día.
  if (month > 12 && day <= 12) [day, month] = [month, day];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const ampm = m[7]?.toLowerCase().replace(/[.\s]/g, "");
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

type Message = { sentAt: string | null; sentBy: string; text: string };

export function parseChatMessages(chatText: string): Message[] {
  const messages: Message[] = [];
  for (const rawLine of chatText.split(/\r?\n/)) {
    const line = rawLine.replace(INVISIBLE, "");
    const m = line.match(HEADER_IOS) ?? line.match(HEADER_ANDROID);
    if (m) {
      messages.push({ sentAt: headerDate(m), sentBy: m[8].trim(), text: m[9] });
    } else if (messages.length > 0 && line.trim()) {
      // Mensaje de varias líneas: sigue el anterior.
      messages[messages.length - 1].text += "\n" + line;
    }
  }
  return messages;
}

export function parseChatAttachments(chatText: string): Map<string, ChatAttachment> {
  const byFile = new Map<string, ChatAttachment>();
  const messages = parseChatMessages(chatText);

  messages.forEach((msg, i) => {
    const name = msg.text.match(ATTACHMENT_NAME)?.[1];
    if (!name || !isReceiptFileName(name)) return;

    // El texto que acompaña la foto ("pan del viernes", "pagué yo") sirve para
    // categorizar. En iPhone suele venir en el mismo mensaje; si no, se mira el
    // mensaje siguiente del mismo remitente, cuando no es otra foto.
    let note = msg.text.replace(ATTACHMENT_MARKERS, "").replace(name, "").trim();
    const next = messages[i + 1];
    if (!note && next && next.sentBy === msg.sentBy && !ATTACHMENT_NAME.test(next.text) && next.sentAt?.slice(0, 13) === msg.sentAt?.slice(0, 13)) {
      note = next.text.trim();
    }

    byFile.set(name, {
      fileName: name,
      sentAt: msg.sentAt ?? dateFromFileName(name),
      sentBy: msg.sentBy,
      note: note || null,
    });
  });

  return byFile;
}

// Busca el .txt del chat entre los archivos del .zip.
export function findChatTextFile(names: string[]): string | null {
  const txt = names.filter((n) => /\.txt$/i.test(n) && !n.split("/").pop()!.startsWith("."));
  return txt.find((n) => /_?chat\.txt$/i.test(n) || /whatsapp/i.test(n)) ?? txt[0] ?? null;
}
