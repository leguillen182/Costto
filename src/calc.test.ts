import { describe, it, expect } from "vitest";
import { recalculate, componentSum, costPerArea } from "./calc.js";
import type { Boq, BoqItem, MarkupRule } from "./types.js";

// ---- Helpers de construcción ----
function boq(over: Partial<Boq> = {}): Boq {
  return {
    id: "b1",
    projectId: "p1",
    name: "Presupuesto",
    kind: "owner_budget",
    currency: "DOP",
    roundingDecimals: 2,
    ...over,
  };
}

let n = 0;
function line(over: Partial<BoqItem> = {}): BoqItem {
  return {
    id: over.id ?? `i${++n}`,
    boqId: "b1",
    parentId: over.parentId ?? null,
    sortOrder: over.sortOrder ?? 0,
    description: over.description ?? "línea",
    nodeType: "line",
    lineType: "unit_price",
    quantity: 0,
    unitRate: 0,
    ...over,
  };
}
function group(over: Partial<BoqItem> = {}): BoqItem {
  return {
    id: over.id ?? `g${++n}`,
    boqId: "b1",
    parentId: over.parentId ?? null,
    sortOrder: over.sortOrder ?? 0,
    description: over.description ?? "grupo",
    nodeType: "group",
    ...over,
  };
}

describe("recalculate — líneas", () => {
  it("calcula cantidad × precio unitario", () => {
    const items = [line({ id: "a", quantity: 10, unitRate: 5 })];
    const r = recalculate(boq(), items);
    expect(r.amounts["a"]).toBe(50);
    expect(r.subtotal).toBe(50);
    expect(r.total).toBe(50);
  });

  it("amount = 0 si falta cantidad o precio", () => {
    const items = [
      line({ id: "a", quantity: null, unitRate: 5 }),
      line({ id: "b", quantity: 10, unitRate: null }),
    ];
    const r = recalculate(boq(), items);
    expect(r.amounts["a"]).toBe(0);
    expect(r.amounts["b"]).toBe(0);
    expect(r.subtotal).toBe(0);
  });

  it("redondea half-up al número de decimales del BOQ", () => {
    // 10.125 es exactamente representable en float (0.125 = 1/8); 10.125 → 10.13
    const items = [line({ id: "a", quantity: 1, unitRate: 10.125 })];
    const r = recalculate(boq({ roundingDecimals: 2 }), items);
    expect(r.amounts["a"]).toBe(10.13);
  });

  it("CAVEAT precisión float: 3 × 1.005 = 3.0149999… → 3.01 (ver ADR-013)", () => {
    // Documenta el límite conocido de la aritmética en float para dinero.
    const items = [line({ id: "a", quantity: 3, unitRate: 1.005 })];
    const r = recalculate(boq({ roundingDecimals: 2 }), items);
    expect(r.amounts["a"]).toBe(3.01);
  });

  it("respeta roundingDecimals = 0 (moneda sin decimales)", () => {
    const items = [line({ id: "a", quantity: 1, unitRate: 1234.6 })];
    const r = recalculate(boq({ roundingDecimals: 0 }), items);
    expect(r.amounts["a"]).toBe(1235);
  });
});

describe("recalculate — grupos y jerarquía", () => {
  it("un grupo suma sus hijos directos", () => {
    const items = [
      group({ id: "g" }),
      line({ id: "a", parentId: "g", quantity: 2, unitRate: 100 }),
      line({ id: "b", parentId: "g", quantity: 1, unitRate: 50 }),
    ];
    const r = recalculate(boq(), items);
    expect(r.amounts["g"]).toBe(250);
    expect(r.subtotal).toBe(250);
  });

  it("rollup recursivo en profundidad 3", () => {
    const items = [
      group({ id: "cap" }),
      group({ id: "sub", parentId: "cap" }),
      line({ id: "x", parentId: "sub", quantity: 5, unitRate: 10 }), // 50
      line({ id: "y", parentId: "sub", quantity: 3, unitRate: 10 }), // 30
      line({ id: "z", parentId: "cap", quantity: 1, unitRate: 20 }), // 20
    ];
    const r = recalculate(boq(), items);
    expect(r.amounts["sub"]).toBe(80);
    expect(r.amounts["cap"]).toBe(100);
    expect(r.subtotal).toBe(100);
  });

  it("subtotal = suma de nodos raíz (varios capítulos)", () => {
    const items = [
      group({ id: "c1" }),
      line({ id: "a", parentId: "c1", quantity: 1, unitRate: 100 }),
      group({ id: "c2" }),
      line({ id: "b", parentId: "c2", quantity: 1, unitRate: 200 }),
      line({ id: "c", parentId: null, quantity: 1, unitRate: 50 }), // línea suelta en raíz
    ];
    const r = recalculate(boq(), items);
    expect(r.subtotal).toBe(350);
  });
});

describe("recalculate — markups", () => {
  const base = () => [line({ id: "a", quantity: 1, unitRate: 1000 })]; // subtotal 1000

  function markup(over: Partial<MarkupRule>): MarkupRule {
    return {
      id: over.id ?? "m",
      boqId: "b1",
      name: over.name ?? "Markup",
      type: over.type ?? "percentage",
      value: over.value ?? 0,
      basis: over.basis ?? "subtotal",
      sortOrder: over.sortOrder ?? 0,
      ...over,
    };
  }

  it("markup porcentual sobre el subtotal", () => {
    const r = recalculate(boq(), base(), [
      markup({ id: "ov", name: "Overhead", type: "percentage", value: 10, basis: "subtotal" }),
    ]);
    expect(r.markups[0]!.amount).toBe(100);
    expect(r.total).toBe(1100);
  });

  it("markup fijo", () => {
    const r = recalculate(boq(), base(), [
      markup({ id: "c", name: "Contingencia", type: "fixed", value: 250 }),
    ]);
    expect(r.total).toBe(1250);
  });

  it("markups en cascada respetan sort_order y basis 'running'", () => {
    // subtotal 1000 → Overhead 10% (sobre subtotal) = 100 → running 1100
    // → ITBIS 18% (sobre running) = 198 → total 1298
    const r = recalculate(boq(), base(), [
      markup({ id: "ov", name: "Overhead", type: "percentage", value: 10, basis: "subtotal", sortOrder: 1 }),
      markup({ id: "itbis", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 2 }),
    ]);
    expect(r.markups[0]!.amount).toBe(100);
    expect(r.markups[1]!.base).toBe(1100);
    expect(r.markups[1]!.amount).toBe(198);
    expect(r.total).toBe(1298);
  });

  it("aplica markups en orden aunque lleguen desordenados", () => {
    const r = recalculate(boq(), base(), [
      markup({ id: "itbis", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 2 }),
      markup({ id: "ov", name: "Overhead", type: "percentage", value: 10, basis: "subtotal", sortOrder: 1 }),
    ]);
    expect(r.markups[0]!.name).toBe("Overhead");
    expect(r.markups[1]!.name).toBe("ITBIS");
    expect(r.total).toBe(1298);
  });
});

describe("recalculate — line_type", () => {
  it("lump_sum se calcula igual (qty típicamente 1 × monto)", () => {
    const items = [line({ id: "a", lineType: "lump_sum", quantity: 1, unitRate: 75000 })];
    const r = recalculate(boq(), items);
    expect(r.amounts["a"]).toBe(75000);
  });

  it("allowance sin precio da 0 (la validación, no el cálculo, decide si es intencional)", () => {
    const items = [line({ id: "a", lineType: "allowance", quantity: 1, unitRate: null })];
    const r = recalculate(boq(), items);
    expect(r.amounts["a"]).toBe(0);
  });
});

describe("recalculate — robustez", () => {
  it("BOQ vacío → subtotal y total 0", () => {
    const r = recalculate(boq(), []);
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it("ignora ítems de otro boqId", () => {
    const items = [
      line({ id: "a", quantity: 1, unitRate: 100 }),
      line({ id: "x", boqId: "OTRO", quantity: 1, unitRate: 999 }),
    ];
    const r = recalculate(boq(), items);
    expect(r.subtotal).toBe(100);
    expect(r.amounts["x"]).toBeUndefined();
  });

  it("grupo sin hijos = 0", () => {
    const items = [group({ id: "g" })];
    const r = recalculate(boq(), items);
    expect(r.amounts["g"]).toBe(0);
  });
});

describe("componentSum", () => {
  it("null si no hay ningún componente", () => {
    expect(componentSum(line({ id: "a", unitRate: 100 }))).toBe(null);
  });
  it("suma los componentes presentes (los ausentes cuentan 0)", () => {
    expect(componentSum(line({ id: "a", rateLabor: 60, rateMaterial: 40 }))).toBe(100);
    expect(componentSum(line({ id: "a", rateLabor: 30, rateMaterial: 40, rateEquipment: 10, rateSubcontract: 15, rateOther: 5 }))).toBe(100);
  });
  it("devuelve 0 si hay un componente explícito en 0", () => {
    expect(componentSum(line({ id: "a", rateLabor: 0 }))).toBe(0);
  });
});

describe("costPerArea (F4)", () => {
  // subtotal 1000; markup 10% running → total 1100.
  const items = [line({ id: "a", quantity: 100, unitRate: 10 })];
  const mk: MarkupRule[] = [{ id: "m", boqId: "b1", name: "OH", type: "percentage", value: 10, basis: "running", sortOrder: 1 }];
  const result = recalculate(boq(), items, mk);

  it("calcula costo directo y total por m²", () => {
    const cpa = costPerArea(result, 50);
    expect(cpa).toEqual({ area: 50, directPerM2: 20, totalPerM2: 22 });
  });

  it("redondea a los decimales indicados", () => {
    // 1000 / 3 = 333.333…  → 333.33 ; 1100 / 3 = 366.666… → 366.67
    const cpa = costPerArea(result, 3, 2);
    expect(cpa).toEqual({ area: 3, directPerM2: 333.33, totalPerM2: 366.67 });
  });

  it("null si el área falta, es 0 o negativa", () => {
    expect(costPerArea(result, null)).toBeNull();
    expect(costPerArea(result, undefined)).toBeNull();
    expect(costPerArea(result, 0)).toBeNull();
    expect(costPerArea(result, -10)).toBeNull();
  });
});
