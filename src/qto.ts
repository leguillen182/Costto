// QTO (Quantity Take-Off) — geometría y escala para medir sobre planos. Funciones PURAS:
// sin DOM, sin pdfjs, sin canvas (testeables en node). Toda coordenada está en ESPACIO PDF
// (user units), invariante al zoom: el navegador convierte pantalla↔PDF y aquí solo medimos.

export interface Pt { x: number; y: number }

export type MeasureKind = "length" | "area" | "count";

/** Escala de una página: unidades reales por unidad-PDF (derivada de una calibración). */
export interface PageScale {
  unitsPerPdf: number; // p. ej. metros por unidad-PDF
  realUnit: string;    // etiqueta de la unidad real ("m")
}

export interface QtoResult {
  kind: MeasureKind;
  quantity: number;
  unit: string;
}

/** Unidad por defecto según el tipo de medición. */
export function defaultUnit(kind: MeasureKind): string {
  return kind === "length" ? "m" : kind === "area" ? "m²" : "un";
}

// ---- geometría básica (espacio PDF) ----

/** Distancia euclídea entre dos puntos. */
export function segmentLength(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Longitud total de una polilínea (Σ de segmentos). 0 si hay menos de 2 puntos. */
export function polylineLength(pts: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += segmentLength(pts[i - 1]!, pts[i]!);
  return sum;
}

/** Área de un polígono por la fórmula del cordón de zapato (shoelace), en valor ABSOLUTO
 *  (independiente del sentido de giro). Cierra implícitamente el último vértice con el primero.
 *  0 si hay menos de 3 puntos. */
export function polygonArea(pts: Pt[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    acc += a.x * b.y - b.x * a.y;
  }
  return Math.abs(acc) / 2;
}

// ---- calibración ----

/** Factor de escala = longitud real conocida / distancia-PDF del segmento de calibración.
 *  Lanza si la distancia PDF es 0 o la longitud real no es > 0. */
export function calibrationFactor(a: Pt, b: Pt, knownRealLength: number): number {
  const d = segmentLength(a, b);
  if (d === 0) throw new Error("El segmento de calibración tiene longitud cero.");
  if (!(knownRealLength > 0)) throw new Error("La longitud real debe ser > 0.");
  return knownRealLength / d;
}

// ---- aplicar escala ----

/** Longitud-PDF → longitud real (× factor lineal). */
export function applyLength(pdfLen: number, scale: PageScale): number {
  return pdfLen * scale.unitsPerPdf;
}

/** Área-PDF → área real (× factor²: el área escala con el cuadrado del factor lineal). */
export function applyArea(pdfArea: number, scale: PageScale): number {
  return pdfArea * scale.unitsPerPdf * scale.unitsPerPdf;
}

/** Deriva {kind, quantity, unit} de una medición ya definida en espacio PDF.
 *  - length: requiere escala; quantity = longitud de la polilínea × factor.
 *  - area:   requiere escala; quantity = área del polígono × factor².
 *  - count:  ignora la escala; quantity = nº de marcas.
 *  Lanza si length/area no tienen escala. `unitOverride` permite forzar la unidad. */
export function deriveQuantity(
  kind: MeasureKind,
  scale: PageScale | null,
  geom: { points?: Pt[]; count?: number },
  unitOverride?: string,
): QtoResult {
  const unit = unitOverride ?? defaultUnit(kind);
  if (kind === "count") {
    return { kind, quantity: geom.count ?? (geom.points?.length ?? 0), unit };
  }
  if (!scale) throw new Error("Falta calibrar la escala de la página para medir longitudes/áreas.");
  const pts = geom.points ?? [];
  const quantity =
    kind === "length"
      ? applyLength(polylineLength(pts), scale)
      : applyArea(polygonArea(pts), scale);
  return { kind, quantity, unit };
}
