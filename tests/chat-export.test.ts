import { describe, expect, it } from "vitest";
import { dateFromFileName, findChatTextFile, parseChatAttachments } from "../src/chat-export.ts";

describe("chat exportado de WhatsApp", () => {
  it("lee el formato de iPhone con marcas invisibles y comentario en la línea siguiente", () => {
    const chat = [
      "[15/11/26, 09:10:00] Ana: Buen día",
      "[17/11/26, 14:32:05] Ana: ‎<adjunto: 00000012-PHOTO-2026-11-17-14-32-05.jpg>",
      "[17/11/26, 14:32:40] Ana: pan del finde, pagué yo",
      "[17/11/26, 18:01:00] Socio: ‎<adjunto: 00000013-PHOTO-2026-11-17-18-01-00.jpg>",
    ].join("\n");
    const result = parseChatAttachments(chat);
    expect(result.get("00000012-PHOTO-2026-11-17-14-32-05.jpg")).toEqual({
      fileName: "00000012-PHOTO-2026-11-17-14-32-05.jpg",
      sentAt: "2026-11-17T14:32:05",
      sentBy: "Ana",
      note: "pan del finde, pagué yo",
    });
    expect(result.get("00000013-PHOTO-2026-11-17-18-01-00.jpg")?.sentBy).toBe("Socio");
    expect(result.get("00000013-PHOTO-2026-11-17-18-01-00.jpg")?.note).toBeNull();
  });

  it("lee el formato de Android en español", () => {
    const chat = "3/11/26 21:05 - Socio: IMG-20261103-WA0007.jpg (archivo adjunto)\nUTE";
    const a = parseChatAttachments(chat).get("IMG-20261103-WA0007.jpg");
    expect(a?.sentAt).toBe("2026-11-03T21:05:00");
    expect(a?.sentBy).toBe("Socio");
    expect(a?.note).toBe("UTE");
  });

  it("entiende AM/PM y el orden mes/día cuando el día pasa de 12", () => {
    const chat = "[11/17/26, 2:32:05 PM] Ana: <attached: 00000001-PHOTO-2026-11-17-14-32-05.jpg>";
    expect(parseChatAttachments(chat).get("00000001-PHOTO-2026-11-17-14-32-05.jpg")?.sentAt).toBe("2026-11-17T14:32:05");
  });

  it("saca la fecha del nombre del archivo", () => {
    expect(dateFromFileName("00000012-PHOTO-2026-11-17-14-32-05.jpg")).toBe("2026-11-17T14:32:05");
    expect(dateFromFileName("IMG-20261103-WA0007.jpg")).toBe("2026-11-03T00:00:00");
    expect(dateFromFileName("recibo.jpg")).toBeNull();
  });

  it("encuentra el texto del chat dentro del zip", () => {
    expect(findChatTextFile(["a.jpg", "__MACOSX/._chat.txt", "_chat.txt"])).toBe("_chat.txt");
    expect(findChatTextFile(["Chat de WhatsApp con Socios.txt", "x.jpg"])).toBe("Chat de WhatsApp con Socios.txt");
  });
});
