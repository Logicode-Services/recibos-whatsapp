import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ExtractedReceipt } from "./extract/types.ts";

// Caché de lecturas en disco. La clave es el contenido de la foto + el lector
// (modelo, versión del prompt, categorías): la misma foto con el mismo lector
// nunca se paga dos veces; si cambia el prompt, se vuelve a leer.

export function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

export class ReadCache {
  private readonly dir: string | null;

  constructor(dir: string | null) {
    this.dir = dir;
  }

  private path(extractorId: string, fileHash: string) {
    const key = createHash("sha256").update(`${extractorId}\n${fileHash}`).digest("hex");
    return join(this.dir!, `${key}.json`);
  }

  async get(extractorId: string, fileHash: string): Promise<ExtractedReceipt | null> {
    if (!this.dir) return null;
    try {
      return JSON.parse(await readFile(this.path(extractorId, fileHash), "utf8"));
    } catch {
      return null;
    }
  }

  async set(extractorId: string, fileHash: string, value: ExtractedReceipt) {
    if (!this.dir) return;
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(extractorId, fileHash), JSON.stringify(value, null, 2));
  }
}
