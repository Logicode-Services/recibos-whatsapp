import ExcelJS from "exceljs";
import type { Category } from "../categories.ts";
import type { ExpenseRecord } from "./records.ts";

// Planilla para personas: "Gastos" con lo que está listo, "Para revisar" con
// lo que necesita un ojo humano y "Resumen" con fórmulas que se recalculan si
// alguien pasa una fila revisada a Gastos.

const COLUMNS: { header: string; key: keyof ExpenseRecord; width: number; money?: boolean }[] = [
  { header: "Fecha", key: "date", width: 12 },
  { header: "Comercio", key: "vendor", width: 24 },
  { header: "Descripción", key: "description", width: 34 },
  { header: "Categoría", key: "categoryLabel", width: 15 },
  { header: "Monto", key: "amount", width: 12, money: true },
  { header: "Moneda", key: "currency", width: 8 },
  { header: "IVA", key: "taxAmount", width: 10, money: true },
  { header: "Medio de pago", key: "paymentMethod", width: 14 },
  { header: "RUT", key: "vendorRut", width: 14 },
  { header: "Comprobante", key: "documentNumber", width: 13 },
  { header: "Mandó", key: "sentBy", width: 10 },
  { header: "Comentario en el chat", key: "chatNote", width: 28 },
  { header: "Archivo", key: "fileName", width: 38 },
];

const STATUS_LABEL = { listo: "Listo", revisar: "Revisar", descartado: "Descartado", error: "No se pudo leer" };

export async function writeXlsx(path: string, records: ExpenseRecord[], categories: Category[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "recibos-whatsapp";

  const ready = records.filter((r) => r.status === "listo");
  const pending = records.filter((r) => r.status !== "listo");

  const gastos = sheet(wb, "Gastos", COLUMNS);
  for (const r of ready) gastos.addRow(rowValues(r));

  const revisar = sheet(wb, "Para revisar", [
    { header: "Estado", key: "status", width: 14 },
    { header: "Qué revisar", key: "reasons", width: 44 },
    ...COLUMNS,
  ]);
  for (const r of pending) revisar.addRow({ ...rowValues(r), status: STATUS_LABEL[r.status], reasons: r.reasons.join(" · ") });

  // Resumen con SUMIF sobre la hoja Gastos (pesos): sigue siendo correcto si
  // quien revisa mueve filas de "Para revisar" a "Gastos".
  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Categoría", key: "c", width: 18 },
    { header: "Total en pesos", key: "t", width: 16 },
  ];
  resumen.getRow(1).font = { bold: true };
  categories.forEach((c, i) => {
    const row = resumen.addRow({ c: c.label });
    row.getCell(2).value = { formula: `SUMIFS(Gastos!E:E,Gastos!D:D,A${i + 2},Gastos!F:F,"UYU")` };
    row.getCell(2).numFmt = "#,##0.00";
  });
  const totalRow = resumen.addRow({ c: "Total" });
  totalRow.font = { bold: true };
  totalRow.getCell(2).value = { formula: `SUM(B2:B${categories.length + 1})` };
  totalRow.getCell(2).numFmt = "#,##0.00";

  await wb.xlsx.writeFile(path);
  return { ready: ready.length, pending: pending.length };
}

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: "#,##0.00" } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

function rowValues(r: ExpenseRecord) {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, r[c.key] ?? null]));
}
