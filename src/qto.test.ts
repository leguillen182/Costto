import { describe, it, expect } from "vitest";
import {
  segmentLength,
  polylineLength,
  polygonArea,
  calibrationFactor,
  applyLength,
  applyArea,
  deriveQuantity,
  defaultUnit,
  orthoConstrain,
  nearestPointIndex,
  scaleRatioToFactor,
  PDF_UNIT_M,
  type Pt,
  type PageScale,
} from "./qto.js";

const p = (x: number, y: number): Pt => ({ x, y });

describe("qto — geometría", () => {
  it("segmentLength: triángulo 3-4-5", () => {
    expect(segmentLength(p(0, 0), p(3, 4))).toBe(5);
  });

  it("polylineLength: suma de segmentos", () => {
    expect(polylineLength([p(0, 0), p(3, 0), p(3, 4)])).toBe(7); // 3 + 4
  });

  it("polylineLength: 0 con menos de 2 puntos", () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([p(1, 1)])).toBe(0);
  });

  it("polygonArea: cuadrado unidad = 1", () => {
    expect(polygonArea([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])).toBe(1);
  });

  it("polygonArea: triángulo base 4 altura 3 = 6", () => {
    expect(polygonArea([p(0, 0), p(4, 0), p(0, 3)])).toBe(6);
  });

  it("polygonArea: el sentido de giro no cambia el valor (abs)", () => {
    const cw = [p(0, 0), p(0, 1), p(1, 1), p(1, 0)];
    const ccw = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    expect(polygonArea(cw)).toBe(polygonArea(ccw));
  });

  it("polygonArea: 0 con menos de 3 puntos", () => {
    expect(polygonArea([p(0, 0), p(1, 1)])).toBe(0);
  });

  it("polygonArea: puntos colineales → 0", () => {
    expect(polygonArea([p(0, 0), p(1, 0), p(2, 0)])).toBe(0);
  });

  it("polylineLength: punto repetido aporta 0", () => {
    expect(polylineLength([p(1, 1), p(1, 1)])).toBe(0);
  });
});

describe("qto — calibración y escala", () => {
  it("calibrationFactor: 200 px-PDF = 10 m → 0.05", () => {
    expect(calibrationFactor(p(0, 0), p(200, 0), 10)).toBeCloseTo(0.05, 12);
  });

  it("calibrationFactor: lanza si el segmento tiene longitud 0", () => {
    expect(() => calibrationFactor(p(5, 5), p(5, 5), 10)).toThrow();
  });

  it("calibrationFactor: lanza si la longitud real no es > 0", () => {
    expect(() => calibrationFactor(p(0, 0), p(100, 0), 0)).toThrow();
    expect(() => calibrationFactor(p(0, 0), p(100, 0), -3)).toThrow();
    expect(() => calibrationFactor(p(0, 0), p(100, 0), NaN)).toThrow();
  });

  it("applyLength: 200 × 0.05 = 10", () => {
    const scale: PageScale = { unitsPerPdf: 0.05, realUnit: "m" };
    expect(applyLength(200, scale)).toBeCloseTo(10, 12);
  });

  it("applyArea escala con factor² (no con factor)", () => {
    const scale: PageScale = { unitsPerPdf: 0.05, realUnit: "m" };
    // 400 unidades-PDF² × 0.05² = 400 × 0.0025 = 1.0  (con factor sería 20 → guarda contra ese bug)
    expect(applyArea(400, scale)).toBeCloseTo(1.0, 12);
    expect(applyArea(400, scale)).not.toBeCloseTo(20, 6);
  });
});

describe("qto — deriveQuantity", () => {
  const scale: PageScale = { unitsPerPdf: 0.05, realUnit: "m" };

  it("length: usa la polilínea × factor y unidad m", () => {
    const r = deriveQuantity("length", scale, { points: [p(0, 0), p(200, 0)] });
    expect(r).toEqual({ kind: "length", quantity: 10, unit: "m" });
  });

  it("area: usa el polígono × factor² y unidad m²", () => {
    const r = deriveQuantity("area", scale, { points: [p(0, 0), p(20, 0), p(20, 20), p(0, 20)] });
    // área-PDF = 400; × 0.0025 = 1.0
    expect(r.kind).toBe("area");
    expect(r.unit).toBe("m²");
    expect(r.quantity).toBeCloseTo(1.0, 12);
  });

  it("count: ignora la escala y cuenta marcas (unidad un)", () => {
    const r = deriveQuantity("count", null, { count: 7 });
    expect(r).toEqual({ kind: "count", quantity: 7, unit: "un" });
  });

  it("count: sin `count` usa el nº de puntos (fallback)", () => {
    const r = deriveQuantity("count", null, { points: [p(0, 0), p(1, 0), p(2, 2)] });
    expect(r).toEqual({ kind: "count", quantity: 3, unit: "un" });
  });

  it("length/area sin escala lanza", () => {
    expect(() => deriveQuantity("length", null, { points: [p(0, 0), p(1, 0)] })).toThrow();
    expect(() => deriveQuantity("area", null, { points: [p(0, 0), p(1, 0), p(1, 1)] })).toThrow();
  });

  it("unitOverride fuerza la unidad", () => {
    const r = deriveQuantity("length", scale, { points: [p(0, 0), p(200, 0)] }, "ml");
    expect(r.unit).toBe("ml");
  });

  it("defaultUnit por tipo", () => {
    expect(defaultUnit("length")).toBe("m");
    expect(defaultUnit("area")).toBe("m²");
    expect(defaultUnit("count")).toBe("un");
  });

  it("la unidad de length/area sale de la calibración (realUnit)", () => {
    const cm: PageScale = { unitsPerPdf: 0.02, realUnit: "cm" };
    expect(deriveQuantity("length", cm, { points: [p(0, 0), p(100, 0)] }).unit).toBe("cm");
    expect(deriveQuantity("area", cm, { points: [p(0, 0), p(10, 0), p(10, 10), p(0, 10)] }).unit).toBe("cm²");
  });
});

describe("qto — ayudas de dibujo (snap/orto)", () => {
  it("orthoConstrain: |dx|≥|dy| → horizontal (fija y)", () => {
    expect(orthoConstrain(p(0, 0), p(5, 2))).toEqual({ x: 5, y: 0 });
  });
  it("orthoConstrain: |dy|>|dx| → vertical (fija x)", () => {
    expect(orthoConstrain(p(0, 0), p(2, 5))).toEqual({ x: 0, y: 5 });
  });
  it("orthoConstrain: empate → horizontal", () => {
    expect(orthoConstrain(p(1, 1), p(4, 4))).toEqual({ x: 4, y: 1 });
  });

  it("nearestPointIndex: devuelve el más cercano dentro de la tolerancia", () => {
    const cands = [p(0, 0), p(10, 0), p(3, 4)];
    expect(nearestPointIndex(p(3.5, 4.2), cands, 1)).toBe(2);
  });
  it("nearestPointIndex: −1 si ninguno entra en la tolerancia", () => {
    expect(nearestPointIndex(p(5, 5), [p(0, 0), p(10, 0)], 1)).toBe(-1);
  });
  it("nearestPointIndex: lista vacía → −1", () => {
    expect(nearestPointIndex(p(0, 0), [], 10)).toBe(-1);
  });
});

describe("qto — escala escrita 1:n", () => {
  it("scaleRatioToFactor: 1:50 y 1:100 (métrico, 1u=1/72\")", () => {
    expect(scaleRatioToFactor(50)).toBeCloseTo(50 * PDF_UNIT_M, 12);
    expect(scaleRatioToFactor(50)).toBeCloseTo(0.0176389, 6);
    expect(scaleRatioToFactor(100)).toBeCloseTo(0.0352778, 6);
  });
  it("scaleRatioToFactor: lanza si n no es > 0", () => {
    expect(() => scaleRatioToFactor(0)).toThrow();
    expect(() => scaleRatioToFactor(-5)).toThrow();
    expect(() => scaleRatioToFactor(NaN)).toThrow();
  });
});
