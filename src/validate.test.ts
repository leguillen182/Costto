import { describe, it, expect } from "vitest";
import { validate } from "./validate.js";
import type { Boq, BoqItem } from "./types.js";

const boq: Boq = { id: "b1", projectId: "p1", name: "P", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 };

function line(over: Partial<BoqItem>): BoqItem {
  return { id: over.id ?? "x", boqId: "b1", parentId: null, sortOrder: 1, description: "d", nodeType: "line", lineType: "unit_price", quantity: 1, unitRate: 1, ...over };
}

const rules = (boqItems: BoqItem[]) => validate(boq, boqItems).map((i) => i.rule);

describe("validate — reglas duras", () => {
  it("BOQ limpio no genera issues", () => {
    expect(validate(boq, [line({ id: "a" })])).toEqual([]);
  });

  it("marca cantidad faltante o cero (error)", () => {
    expect(rules([line({ id: "a", quantity: 0 })])).toContain("missing_quantity");
    expect(rules([line({ id: "a", quantity: null })])).toContain("missing_quantity");
  });

  it("marca precio unitario faltante o cero (error)", () => {
    expect(rules([line({ id: "a", unitRate: 0 })])).toContain("missing_rate");
  });

  it("NO marca cantidad/precio vacíos en allowance o provisional_sum", () => {
    expect(rules([line({ id: "a", lineType: "allowance", quantity: null, unitRate: null })])).not.toContain("missing_quantity");
    expect(rules([line({ id: "a", lineType: "provisional_sum", quantity: 1, unitRate: null })])).not.toContain("missing_rate");
  });

  it("detecta códigos duplicados", () => {
    const out = rules([line({ id: "a", code: "01.01" }), line({ id: "b", code: "01.01" })]);
    expect(out.filter((r) => r === "duplicate_code").length).toBe(2);
  });

  it("detecta descripción vacía", () => {
    expect(rules([line({ id: "a", description: "  " })])).toContain("empty_description");
  });

  it("detecta capítulo sin partidas", () => {
    const items: BoqItem[] = [{ id: "g", boqId: "b1", parentId: null, sortOrder: 1, description: "Cap", nodeType: "group" }];
    expect(rules(items)).toContain("empty_group");
  });

  it("NO marca capítulo con partidas", () => {
    const items: BoqItem[] = [
      { id: "g", boqId: "b1", parentId: null, sortOrder: 1, description: "Cap", nodeType: "group" },
      line({ id: "a", parentId: "g" }),
    ];
    expect(rules(items)).not.toContain("empty_group");
  });

  it("marca desglose que no suma al P. Unitario", () => {
    const it = line({ id: "a", unitRate: 100, rateLabor: 30, rateMaterial: 40, rateEquipment: 10 }); // 80 ≠ 100
    expect(rules([it])).toContain("breakdown_mismatch");
  });

  it("acepta desglose que sí suma", () => {
    const it = line({ id: "a", unitRate: 100, rateLabor: 60, rateMaterial: 40 });
    expect(rules([it])).not.toContain("breakdown_mismatch");
  });

  it("incluye 'Otros' (5º componente) en la suma del desglose", () => {
    const ok = line({ id: "a", unitRate: 100, rateLabor: 30, rateMaterial: 40, rateEquipment: 10, rateSubcontract: 15, rateOther: 5 });
    expect(rules([ok])).not.toContain("breakdown_mismatch");
    const bad = line({ id: "b", unitRate: 100, rateLabor: 30, rateOther: 5 }); // 35 ≠ 100
    expect(rules([bad])).toContain("breakdown_mismatch");
  });
});
