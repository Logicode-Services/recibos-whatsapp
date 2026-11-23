#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ReadCache } from "./cache.ts";
import { loadCategories } from "./categories.ts";
import { ClaudeExtractor } from "./extract/claude.ts";
import { FixtureExtractor } from "./extract/fixtures.ts";
import type { ReceiptExtractor } from "./extract/types.ts";
import { toRecords } from "./output/records.ts";
import { sendToWebhook } from "./output/webhook.ts";
import { writeXlsx } from "./output/xlsx.ts";
import { processExport } from "./pipeline.ts";

const HELP = `Uso: recibos <chat.zip> [opciones]

Lee las fotos de recibos de un chat de WhatsApp exportado ("Exportar chat →
Incluir archivos") y arma una planilla de gastos para revisar.

Opciones:
  --salida <carpeta>      Dónde dejar gastos.xlsx y gastos.json (por defecto: salida)
  --negocio <texto>       Qué negocio es, para el contexto (por defecto: "un comercio")
  --categorias <archivo>  JSON con las categorías [{ key, label, description }]
  --webhook <url>         Mandar cada gasto listo a esta URL (n8n, Make, Zapier…)
  --webhook-secreto <s>   Se manda como "Authorization: Bearer <s>"
  --concurrencia <n>      Recibos que se leen a la vez (por defecto: 3)
  --sin-cache             Volver a leer todo aunque ya se haya leído antes
  --demo                  Usar las respuestas guardadas en demo/respuestas (sin API)
  -h, --help              Esta ayuda

Para leer recibos reales hace falta ANTHROPIC_API_KEY en el entorno.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      salida: { type: "string", default: "salida" },
      negocio: { type: "string", default: "un comercio" },
      categorias: { type: "string" },
      webhook: { type: "string" },
      "webhook-secreto": { type: "string" },
      concurrencia: { type: "string", default: "3" },
      "sin-cache": { type: "boolean", default: false },
      demo: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length !== 1) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const categories = await loadCategories(values.categorias);
  const context = { businessDescription: values.negocio!, categories };

  let extractor: ReceiptExtractor;
  if (values.demo) {
    const here = dirname(fileURLToPath(import.meta.url));
    extractor = new FixtureExtractor(join(here, "..", "demo", "respuestas"));
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Falta ANTHROPIC_API_KEY. Para probar sin clave: --demo con demo/chat-demo.zip.");
      process.exit(1);
    }
    extractor = new ClaudeExtractor(context);
  }

  const outDir = values.salida!;
  await mkdir(outDir, { recursive: true });
  const cache = new ReadCache(values["sin-cache"] ? null : join(outDir, ".cache"));

  const zip = new Uint8Array(await readFile(positionals[0]));
  const { chatFile, rows } = await processExport(zip, {
    extractor,
    categories,
    cache,
    concurrency: Math.max(1, Number(values.concurrencia) || 3),
    onProgress: (done, total, row) => {
      const what = row.status === "error" ? "no se pudo leer" : row.fromCache ? "leído (caché)" : "leído";
      console.log(`  [${done}/${total}] ${row.fileName}: ${what}`);
    },
  });
  if (!chatFile) console.warn("Aviso: el zip no tiene el texto del chat; los recibos quedan sin remitente ni comentario.");

  // El estado final recién se sabe después de comparar todos los recibos
  // (duplicados), por eso se muestra al terminar y no durante la lectura.
  console.log("");
  for (const row of rows) {
    const why = row.reasons.length ? ` — ${row.reasons.join(" · ")}` : "";
    console.log(`  ${row.status.padEnd(10)} ${row.fileName}${why}`);
  }

  const records = toRecords(rows, categories);
  const xlsxPath = join(outDir, "gastos.xlsx");
  const { ready, pending } = await writeXlsx(xlsxPath, records, categories);
  await writeFile(join(outDir, "gastos.json"), JSON.stringify(records, null, 2));

  const fromCache = rows.filter((r) => r.fromCache).length;
  console.log(`\n${rows.length} archivos → ${ready} gastos listos, ${pending} para revisar o descartados.`);
  if (fromCache) console.log(`${fromCache} salieron de la caché (no se volvieron a leer).`);
  console.log(`Planilla: ${xlsxPath}`);

  if (values.webhook) {
    const toSend = records.filter((r) => r.status === "listo");
    const result = await sendToWebhook(toSend, { url: values.webhook, secret: values["webhook-secreto"] });
    console.log(`Webhook: ${result.sent} enviados, ${result.failed.length} con error.`);
    for (const f of result.failed) console.log(`  ${f.id}: ${f.error}`);
    if (result.failed.length) process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
