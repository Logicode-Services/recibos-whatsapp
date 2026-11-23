import { readFile } from "node:fs/promises";

// Las categorías son configurables porque cambian por rubro: un taller no
// compra "proveedores" de cocina. Van al prompt y al esquema de salida, así
// Claude solo puede devolver una de estas claves.

export type Category = { key: string; label: string; description: string };

export const DEFAULT_CATEGORIES: Category[] = [
  { key: "proveedores", label: "Proveedores", description: "mercadería y materia prima para producir o vender (carne, pan, verduras, bebidas)" },
  { key: "insumos", label: "Insumos", description: "lo que se consume para operar y no es mercadería: descartables, packaging, limpieza, gas" },
  { key: "servicios", label: "Servicios", description: "UTE, OSE, Antel, internet, contador, software, comisiones de apps, fletes" },
  { key: "mantenimiento", label: "Mantenimiento", description: "reparaciones, ferretería, repuestos, equipamiento y técnicos" },
  { key: "marketing", label: "Marketing", description: "publicidad, impresiones, cartelería, redes, sorteos" },
  { key: "alquiler", label: "Alquiler", description: "alquiler del local o de equipos" },
  { key: "sueldos", label: "Sueldos", description: "pagos al personal" },
  { key: "otros", label: "Otros", description: "lo que no entra en ninguna otra" },
];

export async function loadCategories(path: string | undefined): Promise<Category[]> {
  if (!path) return DEFAULT_CATEGORIES;
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${path}: tiene que ser una lista de categorías { key, label, description }.`);
  }
  const keys = new Set<string>();
  return parsed.map((c, i) => {
    if (typeof c?.key !== "string" || !/^[a-z0-9_-]+$/.test(c.key)) {
      throw new Error(`${path}: la categoría ${i + 1} necesita una "key" en minúsculas, sin espacios.`);
    }
    if (keys.has(c.key)) throw new Error(`${path}: la categoría "${c.key}" está repetida.`);
    keys.add(c.key);
    return { key: c.key, label: String(c.label ?? c.key), description: String(c.description ?? "") };
  });
}
