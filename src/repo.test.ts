import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type AppDb } from "./db/client.js";
import {
  createProject,
  createBoq,
  insertItems,
  insertMarkups,
  getBoq,
  getItems,
  getMarkups,
  calcBoq,
  listBoqs,
  createBudget,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  saveBoqContents,
  updateBoqBuiltArea,
} from "./repo.js";
import { buildSnapshot } from "./snapshot.js";
import type { BoqItem, MarkupRule } from "./types.js";

let db: AppDb;
beforeEach(() => {
  db = createDb(":memory:").db;
  createProject(db, { id: "p1", name: "Torre A", baseCurrency: "DOP" });
  createBoq(db, {
    id: "b1",
    projectId: "p1",
    name: "Presupuesto base",
    kind: "owner_budget",
    currency: "DOP",
    roundingDecimals: 2,
  });
});

const items: BoqItem[] = [
  { id: "cap1", boqId: "b1", parentId: null, sortOrder: 1, description: "Movimiento de tierra", nodeType: "group" },
  { id: "l1", boqId: "b1", parentId: "cap1", sortOrder: 1, description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m3", unitRate: 350 },
  { id: "l2", boqId: "b1", parentId: "cap1", sortOrder: 2, description: "Relleno", nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m3", unitRate: 250 },
  { id: "cap2", boqId: "b1", parentId: null, sortOrder: 2, description: "Estudios", nodeType: "group" },
  { id: "l3", boqId: "b1", parentId: "cap2", sortOrder: 1, description: "Diseño estructural", nodeType: "line", lineType: "lump_sum", quantity: 1, unit: "global", unitRate: 75000 },
];

describe("repo — persistencia y round-trip", () => {
  it("guarda y relee el BOQ sin perder datos", () => {
    insertItems(db, items);
    const b = getBoq(db, "b1");
    expect(b?.name).toBe("Presupuesto base");
    expect(b?.roundingDecimals).toBe(2);

    const read = getItems(db, "b1");
    expect(read).toHaveLength(5);
    const excav = read.find((x) => x.id === "l1")!;
    expect(excav.quantity).toBe(100);
    expect(excav.unitRate).toBe(350);
    expect(excav.parentId).toBe("cap1");
    expect(excav.lineType).toBe("unit_price");
  });

  it("preserva custom_fields (JSON round-trip)", () => {
    const withCustom: BoqItem = {
      id: "x", boqId: "b1", parentId: null, sortOrder: 9, description: "Partida con zona",
      nodeType: "line", lineType: "unit_price", quantity: 1, unitRate: 10,
      customFields: { zona: "Nivel 3", origenRfi: "RFI-021" },
    };
    insertItems(db, [withCustom]);
    const read = getItems(db, "b1").find((x) => x.id === "x")!;
    expect(read.customFields).toEqual({ zona: "Nivel 3", origenRfi: "RFI-021" });
  });

  it("calcBoq carga desde DB y calcula correctamente", () => {
    insertItems(db, items);
    const r = calcBoq(db, "b1");
    // cap1 = 100*350 + 40*250 = 35000 + 10000 = 45000
    // cap2 = 75000
    expect(r.amounts["cap1"]).toBe(45000);
    expect(r.amounts["cap2"]).toBe(75000);
    expect(r.subtotal).toBe(120000);
    expect(r.total).toBe(120000);
  });

  it("calcBoq aplica markups persistidos en cascada", () => {
    insertItems(db, items); // subtotal 120000
    const markups: MarkupRule[] = [
      { id: "ov", boqId: "b1", name: "Overhead", type: "percentage", value: 10, basis: "subtotal", sortOrder: 1 },
      { id: "itbis", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 2 },
    ];
    insertMarkups(db, markups);
    const r = calcBoq(db, "b1");
    // 120000 + 12000 = 132000 → +18% = 23760 → 155760
    expect(r.markups[0]!.amount).toBe(12000);
    expect(r.markups[1]!.amount).toBe(23760);
    expect(r.total).toBe(155760);
  });

  it("calcBoq lanza error si el BOQ no existe", () => {
    expect(() => calcBoq(db, "noexiste")).toThrow();
  });

  it("persiste y actualiza el área construida (F4)", () => {
    createBoq(db, { id: "ba", projectId: "p1", name: "Con área", kind: "owner_budget", currency: "DOP", roundingDecimals: 2, builtArea: 500 });
    expect(getBoq(db, "ba")?.builtArea).toBe(500);
    updateBoqBuiltArea(db, "ba", 750.5);
    expect(getBoq(db, "ba")?.builtArea).toBe(750.5);
    updateBoqBuiltArea(db, "ba", null);
    expect(getBoq(db, "ba")?.builtArea).toBeNull();
  });

  it("área construida por defecto es null", () => {
    expect(getBoq(db, "b1")?.builtArea).toBeNull();
  });

  it("aísla BOQs distintos del mismo proyecto", () => {
    createBoq(db, { id: "b2", projectId: "p1", name: "Oferta Contratista X", kind: "contractor_bid", currency: "DOP", roundingDecimals: 2 });
    insertItems(db, items); // en b1
    insertItems(db, [{ id: "z1", boqId: "b2", parentId: null, sortOrder: 1, description: "otra", nodeType: "line", lineType: "unit_price", quantity: 2, unitRate: 1000 }]);
    expect(calcBoq(db, "b1").subtotal).toBe(120000);
    expect(calcBoq(db, "b2").subtotal).toBe(2000);
  });
});

describe("repo — snapshots / versiones (F3)", () => {
  function snap(id: string, label: string, createdAt: string) {
    const boq = getBoq(db, "b1")!;
    const calc = calcBoq(db, "b1");
    return buildSnapshot({ id, boqId: "b1", label, createdAt, boq, items: getItems(db, "b1"), markups: getMarkups(db, "b1"), calc });
  }

  it("guarda y relee un snapshot con payload completo", () => {
    insertItems(db, items);
    createSnapshot(db, snap("s1", "Rev.0 aprobado", "2026-06-07T12:00:00Z"));

    const read = getSnapshot(db, "s1")!;
    expect(read.label).toBe("Rev.0 aprobado");
    expect(read.frozenTotal).toBe(120000);
    expect(read.payload.items).toHaveLength(5);
    expect(read.payload.items.find((x) => x.id === "l1")!.unitRate).toBe(350);
  });

  it("el snapshot no cambia si luego se edita el presupuesto vivo", () => {
    insertItems(db, items);
    createSnapshot(db, snap("s1", "Rev.0", "2026-06-07T12:00:00Z"));

    // editar el vivo: subir la excavación a 999
    const edited = items.map((i) => (i.id === "l1" ? { ...i, unitRate: 999 } : i));
    saveBoqContents(db, "b1", edited, []);

    expect(getItems(db, "b1").find((x) => x.id === "l1")!.unitRate).toBe(999); // vivo cambió
    expect(getSnapshot(db, "s1")!.payload.items.find((x) => x.id === "l1")!.unitRate).toBe(350); // snapshot intacto
  });

  it("listSnapshots devuelve resúmenes sin payload, más reciente primero", () => {
    insertItems(db, items);
    createSnapshot(db, snap("s1", "Rev.0", "2026-06-07T10:00:00Z"));
    createSnapshot(db, snap("s2", "Rev.1", "2026-06-07T15:00:00Z"));
    const list = listSnapshots(db, "b1");
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("s2"); // más reciente primero
    expect(list[0]!).not.toHaveProperty("payload");
  });
});

describe("repo — multi-proyecto (F1)", () => {
  it("createBudget crea proyecto + BOQ y listBoqs los devuelve", () => {
    const fresh = createDb(":memory:").db;
    createBudget(fresh, { projectId: "pA", boqId: "bA", projectName: "Torre A", boqName: "Presupuesto base", currency: "DOP" });
    createBudget(fresh, { projectId: "pB", boqId: "bB", projectName: "Punta Catalina", boqName: "Presupuesto base", currency: "USD" });

    const list = listBoqs(fresh);
    expect(list).toHaveLength(2);
    const a = list.find((x) => x.id === "bA")!;
    expect(a.projectName).toBe("Torre A");
    expect(a.currency).toBe("DOP");
    expect(list.find((x) => x.id === "bB")!.currency).toBe("USD");
  });
});
