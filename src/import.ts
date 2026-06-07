// Importación de un BOQ desde Excel (.xlsx) con ExcelJS.
// Reconstruye la jerarquía desde la indentación de la columna Descripción.
// Formato esperado = el que exporta export.ts (round-trip), o cualquier hoja con esos encabezados.
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import type { BoqItem, NodeType } from "./types.js";

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["código", "codigo", "code"],
  description: ["descripción", "descripcion", "description", "partida"],
  unit: ["unidad", "unit", "ud", "um"],
  quantity: ["cantidad", "cant", "quantity", "qty"],
  unitRate: ["p. unitario", "p.unitario", "precio unitario", "unit rate", "pu"],
};

export interface ImportResult {
  items: BoqItem[];
  rowsRead: number;
  /** true si se importaron varias filas pero NINGUNA quedó anidada (sin jerarquía).
   *  Señal de un Excel sin indentación: el usuario esperaba capítulos y todo cayó en raíz. */
  flat: boolean;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null; // texto como "Subtotal" → null
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
};
const toStr = (v: unknown): string => (v == null ? "" : String(v).trim());

export async function parseWorkbook(buffer: Buffer, boqId: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { items: [], rowsRead: 0, flat: false };

  // Localizar la fila de encabezados (la que tiene "Descripción").
  let headerRowIdx = -1;
  const colMap: Record<string, number> = {};
  for (let r = 1; r <= ws.rowCount && headerRowIdx === -1; r++) {
    const row = ws.getRow(r);
    const found: Record<string, number> = {};
    row.eachCell((cell, col) => {
      const t = toStr(cell.value).toLowerCase();
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.includes(t)) found[key] = col;
      }
    });
    if (found.description != null) {
      headerRowIdx = r;
      Object.assign(colMap, found);
    }
  }
  if (headerRowIdx === -1) return { items: [], rowsRead: 0, flat: false };

  const items: BoqItem[] = [];
  const stack: { depth: number; id: string }[] = []; // solo grupos
  const sortCounter = new Map<string | null, number>();
  const labelish = /^(subtotal|total|itbis|overhead|utilidad|contingencia|markup|i\.?t\.?b\.?i\.?s)/i;
  let rowsRead = 0;

  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const descCell = colMap.description ? row.getCell(colMap.description) : null;
    const description = toStr(descCell?.value);
    const code = colMap.code ? toStr(row.getCell(colMap.code).value) : "";
    const unit = colMap.unit ? toStr(row.getCell(colMap.unit).value) : "";
    const quantity = colMap.quantity ? toNum(row.getCell(colMap.quantity).value) : null;
    const unitRate = colMap.unitRate ? toNum(row.getCell(colMap.unitRate).value) : null;

    if (!description && !code && quantity == null && unitRate == null) continue; // fila vacía
    if (!description && labelish.test(code)) continue; // fila de totales/markups

    const depth = descCell?.alignment?.indent ?? 0;
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1]!.id : null;

    const nodeType: NodeType = quantity != null || unitRate != null ? "line" : "group";
    const id = randomUUID();
    const so = (sortCounter.get(parentId) ?? 0) + 1;
    sortCounter.set(parentId, so);

    const item: BoqItem = {
      id, boqId, parentId, sortOrder: so,
      code: code || undefined,
      description,
      nodeType,
    };
    if (nodeType === "line") {
      item.lineType = "unit_price";
      item.quantity = quantity;
      item.unit = unit || undefined;
      item.unitRate = unitRate;
    } else {
      stack.push({ depth, id }); // solo los grupos pueden ser padres
    }
    items.push(item);
    rowsRead++;
  }

  // "Plano" = se leyeron varias filas pero ninguna quedó anidada (todas en raíz).
  const flat = items.length >= 3 && items.every((i) => i.parentId === null);
  return { items, rowsRead, flat };
}
