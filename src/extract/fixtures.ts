import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtractedReceipt, ExtractInput, ReceiptExtractor } from "./types.ts";

// Lector de mentira para la demo y los tests: devuelve la respuesta guardada en
// <carpeta>/<archivo>.json. No llama a ninguna API ni necesita clave.
export class FixtureExtractor implements ReceiptExtractor {
  readonly id = "fixtures-v1";
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async extract(input: ExtractInput): Promise<ExtractedReceipt> {
    const path = join(this.dir, `${input.fileName}.json`);
    try {
      return JSON.parse(await readFile(path, "utf8")) as ExtractedReceipt;
    } catch {
      throw new Error(`No hay respuesta de demo para ${input.fileName} (${path}).`);
    }
  }
}
