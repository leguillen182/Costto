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
  if (kind === "count") {
    return { kind, quantity: geom.count ?? (geom.points?.length ?? 0), unit: unitOverride ?? defaultUnit("count") };
  }
  if (!scale) throw new Error("Falta calibrar la escala de la página para medir longitudes/áreas.");
  const pts = geom.points ?? [];
  // La unidad sale de la calibración: longitud → realUnit; área → realUnit².
  const unit = unitOverride ?? (kind === "length" ? scale.realUnit : `${scale.realUnit}²`);
  const quantity =
    kind === "length"
      ? applyLength(polylineLength(pts), scale)
      : applyArea(polygonArea(pts), scale);
  return { kind, quantity, unit };
}

// ---- ayudas de dibujo (puras; usadas por la capa de navegador para snap/orto) ----

/** Restringe `p` a un segmento horizontal o vertical respecto a `prev`
 *  (orto-lock): si |dx| ≥ |dy| → horizontal (fija y); si no → vertical (fija x). */
export function orthoConstrain(prev: Pt, p: Pt): Pt {
  return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y)
    ? { x: p.x, y: prev.y }
    : { x: prev.x, y: p.y };
}

/** Índice del candidato más cercano a `target` dentro de `maxDist` (o −1 si ninguno).
 *  Pensado para usarse en espacio PANTALLA (tolerancia en px constante con el zoom). */
export function nearestPointIndex(target: Pt, candidates: Pt[], maxDist: number): number {
  let best = -1;
  let bestD = maxDist;
  for (let i = 0; i < candidates.length; i++) {
    const d = segmentLength(target, candidates[i]!);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

/** 1 unidad PDF = 1/72" ; en metros. */
export const PDF_UNIT_M = 0.0254 / 72;

/** Factor de escala a partir de una escala escrita 1:n (asume export a escala real, métrico).
 *  `unitsPerPdf (m) = n × (0.0254/72)`. Lanza si n no es > 0. */
export function scaleRatioToFactor(denominator: number): number {
  if (!(denominator > 0)) throw new Error("La escala 1:n debe tener n > 0.");
  return denominator * PDF_UNIT_M;
}
