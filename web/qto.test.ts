// Tests de la capa QTO en jsdom: SOLO la conversión medición→BoqItem (pdfjs/canvas no son
// testeables aquí). Se usa un QtoContext falso con items en memoria que reusa tree.addLine real.
import { describe, it, expect, beforeEach } from "vitest";
import * as tree from "../src/tree.js";
import type { BoqItem } from "../src/types.js";
import {
  sendMeasurementAsNewLine,
  sendMeasurementToSelected,
  autoLabel,
  roundQ,
  type QtoContext,
  type Measurement,
} from "./qto.js";

let items: BoqItem[];
let selectedId: string | null;
let dirty: boolean;
let n: number;

function makeCtx(): QtoContext {
  return {
    getBoqId: () => "b1",
    getSelectedId: () => selectedId,
    getGroups: () => items.filter((i) => i.nodeType === "group").map((g) => ({ id: g.id, label: g.description })),
    addLineUnder: (parentId, fields) => {
      const id = `L${++n}`;
      items = tree.addLine(items, "b1", parentId, id);
      const it = items.find((i) => i.id === id);
      if (it) Object.assign(it, fields);
      return id;
    },
    updateLine: (id, patch) => {
      const it = items.find((i) => i.id === id);
      if (it) Object.assign(it, patch);
    },
    isLine: (id) => items.find((i) => i.id === id)?.nodeType === "line",
    markDirty: () => { dirty = true; },
    backToEditor: () => {},
    showAlert: async () => {},
    showConfirm: async () => true,
    showPrompt: async () => null,
  };
}

const measurement = (over: Partial<Measurement> = {}): Measurement => ({
  id: "m1", kind: "length", page: 1, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
  quantity: 10, unit: "m", label: "Muro eje A", color: "#2563eb", ...over,
});

beforeEach(() => {
  n = 0;
  dirty = false;
  selectedId = null;
  items = [
    { id: "cap1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Albañilería", nodeType: "group" },
    { id: "lin1", boqId: "b1", parentId: "cap1", sortOrder: 1, description: "Existente", nodeType: "line", lineType: "unit_price", quantity: 5, unit: "m" },
  ];
});

describe("QTO — nueva partida", () => {
  it("crea una línea bajo el capítulo con cantidad/unidad de la medición", () => {
    const ctx = makeCtx();
    const id = sendMeasurementAsNewLine(ctx, measurement(), "cap1", "Muro eje A");
    const it = items.find((i) => i.id === id)!;
    expect(it.parentId).toBe("cap1");
    expect(it.nodeType).toBe("line");
    expect(it.lineType).toBe("unit_price");
    expect(it.description).toBe("Muro eje A");
    expect(it.unit).toBe("m");
    expect(it.quantity).toBe(10);
    expect(dirty).toBe(true);
  });

  it("usa autoLabel cuando la descripción viene vacía", () => {
    const ctx = makeCtx();
    const id = sendMeasurementAsNewLine(ctx, measurement({ label: "" }), null, "");
    expect(items.find((i) => i.id === id)!.description).toBe(autoLabel({ kind: "length" })); // "Longitud"
  });

  it("área→m², conteo→un se reflejan en la partida", () => {
    const ctx = makeCtx();
    const aId = sendMeasurementAsNewLine(ctx, measurement({ kind: "area", unit: "m²", quantity: 24.5 }), null);
    const cId = sendMeasurementAsNewLine(ctx, measurement({ kind: "count", unit: "un", quantity: 7 }), null);
    expect(items.find((i) => i.id === aId)!.unit).toBe("m²");
    expect(items.find((i) => i.id === cId)!.quantity).toBe(7);
  });

  it("inserta en raíz (parentId null) cuando no se elige capítulo", () => {
    const ctx = makeCtx();
    const id = sendMeasurementAsNewLine(ctx, measurement(), null);
    expect(items.find((i) => i.id === id)!.parentId).toBeNull();
  });
});

describe("QTO — helpers", () => {
  it("autoLabel por tipo", () => {
    expect(autoLabel({ kind: "length" })).toBe("Longitud");
    expect(autoLabel({ kind: "area" })).toBe("Área");
    expect(autoLabel({ kind: "count" })).toBe("Conteo");
  });

  it("roundQ: conteo→entero, longitud/área→2 decimales", () => {
    expect(roundQ("count", 3.7)).toBe(4);
    expect(roundQ("length", 3.456)).toBe(3.46);
    expect(roundQ("area", 12.005)).toBeCloseTo(12.01, 5);
  });
});

describe("QTO — rellenar partida seleccionada", () => {
  it("actualiza cantidad/unidad de la línea seleccionada", () => {
    selectedId = "lin1";
    const ctx = makeCtx();
    const res = sendMeasurementToSelected(ctx, measurement({ quantity: 42, unit: "m" }));
    expect(res.ok).toBe(true);
    const it = items.find((i) => i.id === "lin1")!;
    expect(it.quantity).toBe(42);
    expect(dirty).toBe(true);
  });

  it("falla sin selección (no-selection)", () => {
    selectedId = null;
    const res = sendMeasurementToSelected(makeCtx(), measurement());
    expect(res).toEqual({ ok: false, reason: "no-selection" });
  });

  it("falla si la selección es un capítulo (not-line)", () => {
    selectedId = "cap1";
    const res = sendMeasurementToSelected(makeCtx(), measurement());
    expect(res).toEqual({ ok: false, reason: "not-line" });
  });
});
