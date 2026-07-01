import { describe, it, expect } from "vitest";
import { compareBoqs } from "./compare.js";
import type { Boq, BoqItem } from "./types.js";

const boqA: Boq = { id: "A", projectId: "p", name: "Dueño", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 };
const boqB: Boq = { id: "B", projectId: "p", name: "Contratista", kind: "contractor_bid", currency: "DOP", roundingDecimals: 2 };

function line(boqId: string, code: string, qty: number, rate: number, desc = code): BoqItem {
  return { id: `${boqId}-${code}`, boqId, parentId: null, sortOrder: 1, code, description: desc, nodeType: "line", lineType: "unit_price", quantity: qty, unitRate: rate };
}

describe("compareBoqs", () => {
  // A: 01.01 = 100×350=35000 ; 01.02 = 40×250=10000 ; 02.01 (solo dueño) = 1×5000
  // B: 01.01 = 100×400=40000 ; 01.02 = 40×250=10000 ; 03.01 (solo contratista) = 1×8000
  const itemsA = [line("A", "01.01", 100, 350), line("A", "01.02", 40, 250), line("A", "02.01", 1, 5000)];
  const itemsB = [line("B", "01.01", 100, 400), line("B", "01.02", 40, 250), line("B", "03.01", 1, 8000)];

  it("empareja por código y calcula delta por partida", () => {
    const r = compareBoqs(boqA, itemsA, boqB, itemsB);
    const p1 = r.rows.find((x) => x.code === "01.01")!;
    expect(p1.side).toBe("both");
    expect(p1.amountA).toBe(35000);
    expect(p1.amountB).toBe(40000);
    expect(p1.deltaAmount).toBe(5000); // contratista cobra 5000 más
    expect(p1.deltaPct).toBeCloseTo(14.29, 1);

    const p2 = r.rows.find((x) => x.code === "01.02")!;
    expect(p2.deltaAmount).toBe(0); // igual
  });

  it("marca omisiones (solo dueño) y agregados (solo contratista)", () => {
    const r = compareBoqs(boqA, itemsA, boqB, itemsB);
    expect(r.rows.find((x) => x.code === "02.01")!.side).toBe("onlyA");
    expect(r.rows.find((x) => x.code === "03.01")!.side).toBe("onlyB");
    expect(r.counts).toEqual({ matched: 2, onlyA: 1, onlyB: 1 });
  });

  it("totales y delta total", () => {
    const r = compareBoqs(boqA, itemsA, boqB, itemsB);
    expect(r.totalA).toBe(50000); // 35000+10000+5000
    expect(r.totalB).toBe(58000); // 40000+10000+8000
    expect(r.deltaTotal).toBe(8000);
  });

  it("empareja por descripción si no hay código", () => {
    const a = [line("A", "", 1, 100, "Limpieza final")];
    const b = [line("B", "", 1, 150, "limpieza final")]; // distinta capitalización
    const r = compareBoqs(boqA, a, boqB, b);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.side).toBe("both");
    expect(r.rows[0]!.deltaAmount).toBe(50);
  });

  it("detecta monedas distintas", () => {
    const usd: Boq = { ...boqB, currency: "USD" };
    const r = compareBoqs(boqA, itemsA, usd, itemsB);
    expect(r.sameCurrency).toBe(false);
  });

  it("usa roundingDecimals del presupuesto base (A) para los deltas", () => {
    const a4: Boq = { ...boqA, roundingDecimals: 4 };
    const b4: Boq = { ...boqB, roundingDecimals: 4 };
    const r = compareBoqs(a4, [line("A", "X", 1, 100.1234)], b4, [line("B", "X", 1, 100.1239)]);
    // Con 4 decimales el delta sobrevive; con el viejo redondeo fijo a 2 daría 0.00.
    expect(r.rows[0]!.deltaAmount).toBeCloseTo(0.0005, 4);
  });

  it("agrega líneas con clave repetida en vez de descartarlas", () => {
    // Misma descripción sin código en dos capítulos distintos: antes una pisaba a la otra
    // y el total del lado A quedaba corto.
    const a = [
      { ...line("A", "", 1, 100, "Limpieza"), id: "A-l1" },
      { ...line("A", "", 2, 100, "Limpieza"), id: "A-l2" },
    ];
    const b = [line("B", "", 3, 120, "Limpieza")];
    const r = compareBoqs(boqA, a, boqB, b);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.amountA).toBe(300); // 100 + 200, no solo la última
    expect(r.rows[0]!.amountB).toBe(360);
    expect(r.totalA).toBe(300);
    expect(r.deltaTotal).toBe(60);
  });
});
