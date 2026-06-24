// Exportación de un BOQ a Excel (.xlsx) con ExcelJS.
import ExcelJS from "exceljs";
import type { Boq, BoqItem, BoqCalcResult } from "./types.js";
import { costPerArea } from "./calc.js";

function orderedItems(items: BoqItem[]): { item: BoqItem; depth: number }[] {
  const byParent = new Map<string | null, BoqItem[]>();
  for (const it of items) {
    const arr = byParent.get(it.parentId);
    if (arr) arr.push(it);
    else byParent.set(it.parentId, [it]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
  const out: { item: BoqItem; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const it of byParent.get(parent) ?? []) {
      out.push({ item: it, depth });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export async function buildWorkbook(boq: Boq, items: BoqItem[], calc: BoqCalcResult): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OwnerRep-ERP";
  const ws = wb.addWorksheet("Presupuesto");

  const MONEY = '#,##0.00';
  ws.columns = [
    { header: "Código", key: "code", width: 12 },
    { header: "Descripción", key: "description", width: 46 },
    { header: "Unidad", key: "unit", width: 10 },
    { header: "Cantidad", key: "quantity", width: 12 },
    { header: "P. Unitario", key: "unitRate", width: 14 },
    { header: "Importe", key: "amount", width: 16 },
  ];

  // Encabezado del documento
  ws.spliceRows(1, 0, [boq.name], [`${boq.kind} · ${boq.currency}`], []);
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").font = { color: { argb: "FF6B7785" } };

  // Fila de encabezados de columna (ahora en la fila 4)
  const headerRow = ws.getRow(4);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  ["D", "E", "F"].forEach((c) => (ws.getCell(`${c}4`).alignment = { horizontal: "right" }));

  // Filas de partidas
  for (const { item, depth } of orderedItems(items)) {
    const amount = calc.amounts[item.id] ?? 0;
    const isGroup = item.nodeType === "group";
    const row = ws.addRow({
      code: item.code ?? "",
      description: item.description,
      unit: isGroup ? "" : item.unit ?? "",
      quantity: isGroup ? null : item.quantity ?? null,
      unitRate: isGroup ? null : item.unitRate ?? null,
      amount,
    });
    row.getCell("description").alignment = { indent: depth };
    row.getCell("quantity").numFmt = MONEY;
    row.getCell("unitRate").numFmt = MONEY;
    row.getCell("amount").numFmt = MONEY;
    if (isGroup) {
      row.font = { bold: true };
      row.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } }));
    }
  }

  ws.addRow([]);
  const sub = ws.addRow({ unitRate: "Subtotal", amount: calc.subtotal });
  sub.getCell("amount").numFmt = MONEY;
  sub.getCell("unitRate").font = { bold: true };

  for (const m of calc.markups) {
    const r = ws.addRow({ unitRate: m.name, amount: m.amount });
    r.getCell("amount").numFmt = MONEY;
  }

  const total = ws.addRow({ unitRate: "TOTAL", amount: calc.total });
  total.font = { bold: true, size: 12 };
  total.getCell("amount").numFmt = MONEY;

  // Costo por m² construido (F4), solo si hay área definida.
  const cpa = costPerArea(calc, boq.builtArea, boq.roundingDecimals ?? 2);
  if (cpa) {
    ws.addRow([]);
    const area = ws.addRow({ unitRate: "Área construida (m²)", amount: cpa.area });
    area.getCell("amount").numFmt = "#,##0.00";
    const direct = ws.addRow({ unitRate: "Costo directo / m²", amount: cpa.directPerM2 });
    direct.getCell("amount").numFmt = MONEY;
    const perM2 = ws.addRow({ unitRate: "Costo / m² (con markups)", amount: cpa.totalPerM2 });
    perM2.font = { bold: true };
    perM2.getCell("amount").numFmt = MONEY;
  }

  return wb;
}
