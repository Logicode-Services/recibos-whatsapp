import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { ExtractedReceipt, ExtractInput, ExtractorContext, ReceiptExtractor } from "./types.ts";

// Lectura de recibos con Claude: visión + salida estructurada, una llamada por
// foto. Se prioriza no inventar: lo que no se lee queda en null y pasa a
// revisión.

const MODEL = "claude-opus-5-5";
// Subir este número cuando cambia el prompt: invalida la caché de lecturas.
const PROMPT_VERSION = 1;

const nullable = (type: string) => ({ type: [type, "null"] });

function buildSchema(categoryKeys: string[]) {
  const category = { enum: [...categoryKeys, null] };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "is_receipt", "is_credit_note", "receipt_date", "vendor", "vendor_rut", "document_number", "description",
      "items", "total", "currency", "tax_amount", "payment_method", "category", "confidence", "review_note",
    ],
    properties: {
      is_receipt: { type: "boolean" },
      is_credit_note: { type: "boolean" },
      receipt_date: { ...nullable("string"), description: "Fecha del comprobante, AAAA-MM-DD" },
      vendor: nullable("string"),
      vendor_rut: nullable("string"),
      document_number: nullable("string"),
      description: nullable("string"),
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "quantity", "total", "category"],
          properties: {
            description: { type: "string" },
            quantity: nullable("number"),
            total: nullable("number"),
            category,
          },
        },
      },
      total: nullable("number"),
      currency: { enum: ["UYU", "USD", null] },
      tax_amount: nullable("number"),
      payment_method: { enum: ["efectivo", "transferencia", "tarjeta", null] },
      category,
      confidence: { enum: ["alta", "media", "baja"] },
      review_note: nullable("string"),
    },
  };
}

// Fijo para toda la tanda (sin datos de la foto), así se cachea entre recibos.
function buildSystem({ businessDescription, categories }: ExtractorContext) {
  const list = categories.map((c) => `  - ${c.key}: ${c.description}`).join("\n");
  return `Leés comprobantes de gastos de ${businessDescription} en Uruguay. Te llega la foto (o PDF) de un recibo que alguien pasó por WhatsApp, a veces con un comentario.

Devolvé los datos del comprobante tal como aparecen. Si un dato no se ve o no se puede leer con seguridad, ponelo en null; nunca lo adivines, porque va a ir a las finanzas del negocio.

- is_receipt: true si es un ticket, factura, e-Ticket, e-Factura, boleta, comprobante de transferencia o recibo de pago. false si es cualquier otra cosa (foto de un producto, captura de una conversación, meme). Si es false, el resto puede ir en null.
- is_credit_note: true si es una nota de crédito, devolución o reintegro (plata que vuelve al negocio). El total va igual en positivo.
- receipt_date: la fecha de emisión impresa, en formato AAAA-MM-DD. En Uruguay las fechas se escriben día/mes/año.
- vendor: nombre comercial de quien vende (el de fantasía si lo hay). vendor_rut: el RUT del emisor, solo dígitos.
- document_number: serie y número del comprobante (ej. "A 123456") si figura.
- description: qué se compró, en pocas palabras. En un supermercado donde no se distinguen los productos, "Supermercado" y el nombre del comercio.
- items: las líneas legibles (como mucho 30), cada una con su importe final y su propia categoría. Si una línea no se lee, su total y su categoría van en null. Los descuentos generales no son ítems.
- total: el importe final pagado, IVA incluido, el que está junto a "TOTAL". No sumes vos los ítems si el total está impreso.
- currency: "UYU" para pesos ($, $U, UYU) y "USD" para dólares (U$S, US$, USD).
- tax_amount: el IVA total si está discriminado.
- payment_method: "efectivo", "tarjeta" o "transferencia" si el comprobante o el comentario lo dicen; si no, null.
- category: la categoría de lo que más pesa en el total. Una de estas:
${list}
- confidence: "alta" si total, fecha y comercio se leen claros; "media" si alguno es dudoso; "baja" si la foto está borrosa, cortada o hay que revisarla entera.
- review_note: una frase corta si hay algo que revisar (total tapado, dos comprobantes en la misma foto, moneda dudosa, el comentario contradice el recibo). Si está todo bien, null.`;
}

export class ClaudeExtractor implements ReceiptExtractor {
  readonly id: string;
  private readonly client: Anthropic;
  private readonly system: string;
  private readonly schema: ReturnType<typeof buildSchema>;

  constructor(context: ExtractorContext, client?: Anthropic) {
    // El SDK ya reintenta 429 (límite de pedidos), 529 (sobrecarga) y cortes de
    // red con espera creciente; en una tanda grande conviene darle más intentos.
    this.client = client ?? new Anthropic({ maxRetries: 4 });
    this.system = buildSystem(context);
    this.schema = buildSchema(context.categories.map((c) => c.key));
    const promptHash = createHash("sha256").update(this.system).digest("hex").slice(0, 8);
    this.id = `claude:${MODEL}:v${PROMPT_VERSION}:${promptHash}`;
  }

  async extract({ data, mediaType, sentBy, chatNote }: ExtractInput): Promise<ExtractedReceipt> {
    const base64 = Buffer.from(data).toString("base64");
    const fileBlock: Anthropic.Beta.BetaContentBlockParam =
      mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    const context = [
      sentBy ? `Lo mandó: ${sentBy}.` : null,
      chatNote ? `Comentario en el chat: "${chatNote.slice(0, 500)}"` : "Sin comentario en el chat.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Si el filtro de seguridad rechazara una foto, se reintenta en otro
      // modelo dentro de la misma llamada en vez de volver vacío.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: this.schema } },
      system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: context }] }],
    });

    if (response.stop_reason === "refusal") throw new Error("No se pudo leer este archivo.");
    if (response.stop_reason === "max_tokens") throw new Error("La lectura quedó incompleta.");

    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) throw new Error("La respuesta vino vacía.");
    return JSON.parse(text) as ExtractedReceipt;
  }
}
