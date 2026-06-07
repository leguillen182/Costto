// Versiones / snapshots del presupuesto (F3) — lógica PURA.
// Un snapshot = copia INMUTABLE del contenido de un BOQ en un momento dado
// (boq + items + markups + total congelado). Sirve para congelar un "Rev.0 aprobado"
// y comparar el estado vivo contra él reusando el motor de comparación (compareBoqs, B2).
import type { Boq, BoqItem, MarkupRule, BoqCalcResult } from "./types.js";

/** Contenido congelado del BOQ. Self-contained: no depende de las filas vivas. */
export interface BoqSnapshotPayload {
  boq: Boq;
  items: BoqItem[];
  markups: MarkupRule[];
}

export interface BoqSnapshot {
  id: string;
  boqId: string; // BOQ vivo del que se tomó
  label: string; // "Rev.0 aprobado", "Pre-licitación"…
  note?: string;
  createdAt: string; // ISO 8601 (lo provee quien llama; la lógica pura no usa el reloj)
  frozenTotal: number; // total con markups al momento de congelar (para la lista)
  currency: string;
  payload: BoqSnapshotPayload;
}

/** Metadatos del snapshot sin el payload (para listar en la UI). */
export interface SnapshotSummary {
  id: string;
  boqId: string;
  label: string;
  note?: string;
  createdAt: string;
  frozenTotal: number;
  currency: string;
}

export interface BuildSnapshotInput {
  id: string;
  boqId: string;
  label: string;
  note?: string;
  createdAt: string;
  boq: Boq;
  items: BoqItem[];
  markups: MarkupRule[];
  calc: BoqCalcResult;
}

/** Copia profunda — garantiza que mutar las filas vivas luego no toque el snapshot. */
function freeze<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Arma un snapshot inmutable a partir del estado actual del BOQ y su cálculo. */
export function buildSnapshot(input: BuildSnapshotInput): BoqSnapshot {
  return {
    id: input.id,
    boqId: input.boqId,
    label: input.label.trim() || "Sin etiqueta",
    note: input.note?.trim() || undefined,
    createdAt: input.createdAt,
    frozenTotal: input.calc.total,
    currency: input.boq.currency,
    payload: {
      boq: freeze(input.boq),
      items: freeze(input.items),
      markups: freeze(input.markups),
    },
  };
}

/** Rehidrata el snapshot como entradas para compareBoqs (lado A = baseline congelado). */
export function snapshotToCompareInputs(snap: BoqSnapshot): { boq: Boq; items: BoqItem[] } {
  return { boq: snap.payload.boq, items: snap.payload.items };
}

/** Proyecta el snapshot a su resumen (sin payload). */
export function toSummary(snap: BoqSnapshot): SnapshotSummary {
  return {
    id: snap.id,
    boqId: snap.boqId,
    label: snap.label,
    note: snap.note,
    createdAt: snap.createdAt,
    frozenTotal: snap.frozenTotal,
    currency: snap.currency,
  };
}
