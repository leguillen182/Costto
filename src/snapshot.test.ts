import { describe, it, expect } from "vitest";
import { buildSnapshot, snapshotToCompareInputs, toSummary } from "./snapshot.js";
import { recalculate } from "./calc.js";
import { compareBoqs } from "./compare.js";
import type { Boq, BoqItem, MarkupRule } from "./types.js";

const boq: Boq = { id: "b1", projectId: "p", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 };

function line(code: string, qty: number, rate: number, desc = code): BoqItem {
  return { id: `b1-${code}`, boqId: "b1", parentId: null, sortOrder: 1, code, description: desc, nodeType: "line", lineType: "unit_price", quantity: qty, unitRate: rate };
}

const markups: MarkupRule[] = [{ id: "m1", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 1 }];

function snapOf(items: BoqItem[], rules: MarkupRule[] = markups) {
  const calc = recalculate(boq, items, rules);
  return buildSnapshot({ id: "s1", boqId: "b1", label: "Rev.0 aprobado", createdAt: "2026-06-07T12:00:00Z", boq, items, markups: rules, calc });
}

describe("buildSnapshot", () => {
  it("congela el total con markups y la moneda", () => {
    const items = [line("01.01", 100, 350), line("01.02", 40, 250)]; // 35000 + 10000 = 45000; +18% = 53100
    const snap = snapOf(items);
    expect(snap.frozenTotal).toBe(53100);
    expect(snap.currency).toBe("DOP");
    expect(snap.label).toBe("Rev.0 aprobado");
    expect(snap.payload.items).toHaveLength(2);
    expect(snap.payload.markups).toHaveLength(1);
  });

  it("es inmutable: mutar las filas vivas no altera el snapshot", () => {
    const items = [line("01.01", 100, 350)];
    const snap = snapOf(items);
    items[0]!.unitRate = 999; // edición posterior del presupuesto vivo
    expect(snap.payload.items[0]!.unitRate).toBe(350);
  });

  it("etiqueta vacía cae a un valor por defecto", () => {
    const calc = recalculate(boq, [], []);
    const snap = buildSnapshot({ id: "s", boqId: "b1", label: "   ", createdAt: "t", boq, items: [], markups: [], calc });
    expect(snap.label).toBe("Sin etiqueta");
  });

  it("toSummary omite el payload", () => {
    const s = toSummary(snapOf([line("01.01", 1, 100)]));
    expect(s).not.toHaveProperty("payload");
    expect(s.frozenTotal).toBeGreaterThan(0);
  });
});

describe("snapshot vs estado vivo (reusa compareBoqs)", () => {
  const baseItems = [line("01.01", 100, 350), line("01.02", 40, 250)];
  const snap = snapOf(baseItems);

  it("sin cambios → delta total 0 y todas emparejadas", () => {
    const a = snapshotToCompareInputs(snap);
    const r = compareBoqs(a.boq, a.items, boq, baseItems);
    expect(r.deltaTotal).toBe(0);
    expect(r.counts).toEqual({ matched: 2, onlyA: 0, onlyB: 0 });
  });

  it("subir un precio en el vivo → delta positivo respecto al Rev.0", () => {
    const live = [line("01.01", 100, 400), line("01.02", 40, 250)]; // 01.01 sube 5000
    const a = snapshotToCompareInputs(snap);
    const r = compareBoqs(a.boq, a.items, boq, live);
    expect(r.rows.find((x) => x.code === "01.01")!.deltaAmount).toBe(5000);
    expect(r.deltaTotal).toBe(5000);
  });

  it("partida nueva en el vivo → onlyB (agregada después del Rev.0)", () => {
    const live = [...baseItems, line("01.03", 1, 7000)];
    const a = snapshotToCompareInputs(snap);
    const r = compareBoqs(a.boq, a.items, boq, live);
    expect(r.rows.find((x) => x.code === "01.03")!.side).toBe("onlyB");
    expect(r.counts.onlyB).toBe(1);
  });
});
