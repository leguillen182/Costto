import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "./export.js";
import { parseWorkbook } from "./import.js";
import { recalculate } from "./calc.js";
import type { Boq, BoqItem } from "./types.js";

const boq: Boq = { id: "b1", projectId: "p1", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 };

const items: BoqItem[] = [
  { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
  { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
  { id: "l2", boqId: "b1", parentId: "c1", sortOrder: 2, code: "01.02", description: "Relleno", nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m³", unitRate: 250 },
  { id: "c2", boqId: "b1", parentId: null, sortOrder: 2, code: "02", description: "Estudios", nodeType: "group" },
  { id: "l3", boqId: "b1", parentId: "c2", sortOrder: 1, code: "02.01", description: "Diseño estructural", nodeType: "line", lineType: "lump_sum", quantity: 1, unit: "global", unitRate: 75000 },
];

describe("import — round-trip export→import", () => {
  it("reconstruye estructura, jerarquía y valores desde el Excel exportado", async () => {
    const calc = recalculate(boq, items);
    const wb = await buildWorkbook(boq, items, calc);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const { items: parsed, rowsRead, flat } = await parseWorkbook(buf, "b1");

    expect(rowsRead).toBe(5);
    expect(parsed).toHaveLength(5);
    expect(flat).toBe(false); // el export trae jerarquía (indentación) → no es plano

    const byDesc = (d: string) => parsed.find((p) => p.description === d)!;
    const mov = byDesc("Movimiento de tierra");
    const exc = byDesc("Excavación");
    const est = byDesc("Estudios");

    expect(mov.nodeType).toBe("group");
    expect(exc.nodeType).toBe("line");
    expect(exc.quantity).toBe(100);
    expect(exc.unitRate).toBe(350);
    expect(exc.unit).toBe("m³");
    // jerarquía: Excavación cuelga de Movimiento de tierra
    expect(exc.parentId).toBe(mov.id);
    // Estudios es raíz, su hijo Diseño estructural cuelga de él
    expect(est.parentId).toBe(null);
    expect(byDesc("Diseño estructural").parentId).toBe(est.id);

    // El total recalculado tras importar coincide con el original
    const reparsed = recalculate(boq, parsed.map((p) => ({ ...p, boqId: "b1" })));
    expect(reparsed.subtotal).toBe(calc.subtotal); // 120000
  });

  it("ignora filas de totales/markups (Subtotal, ITBIS, TOTAL)", async () => {
    const calc = recalculate(boq, items, [{ id: "m", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 1 }]);
    const wb = await buildWorkbook(boq, items, calc);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { items: parsed } = await parseWorkbook(buf, "b1");
    // No debe aparecer ninguna "partida" llamada ITBIS/Subtotal/TOTAL
    expect(parsed.some((p) => /itbis|subtotal|total/i.test(p.description))).toBe(false);
  });
});

describe("import — detección de import plano (#8)", () => {
  // Excel de terceros SIN indentación en la columna Descripción → no se reconstruye jerarquía.
  async function flatWorkbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");
    ws.addRow(["Código", "Descripción", "Unidad", "Cantidad", "P. Unitario"]);
    ws.addRow(["01.01", "Excavación", "m³", 100, 350]);
    ws.addRow(["01.02", "Relleno", "m³", 40, 250]);
    ws.addRow(["02.01", "Diseño", "global", 1, 75000]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("marca flat=true cuando varias filas quedan todas en raíz", async () => {
    const { items: parsed, rowsRead, flat } = await parseWorkbook(await flatWorkbook(), "b1");
    expect(rowsRead).toBe(3);
    expect(flat).toBe(true);
    expect(parsed.every((p) => p.parentId === null)).toBe(true);
  });
});
