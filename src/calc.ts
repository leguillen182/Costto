// Motor de cálculo del BOQ (Tarea 1.2). Función PURA: sin DB, sin UI.
// Contrato de dato entre persistencia y editor (recomendación del panel).
//
// Reglas (docs DATA_MODEL.md):
//   line.amount  = quantity × unitRate   (0 si falta alguno)
//   group.amount = Σ amount de hijos directos (recursivo)
//   subtotal     = Σ nodos raíz
//   total        = subtotal + markups aplicados en sortOrder, cada uno según su basis
// Redondeo: cada amount se redondea a boq.roundingDecimals; los totales suman amounts redondeados.

import type { Boq, BoqItem, BoqCalcResult, MarkupResult } from "./types.js";

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // + EPSILON corrige errores de coma flotante (p. ej. 3.015 → 3.02)
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Suma de los componentes de tarifa (labor/material/equipo/subcontrato/otros).
 *  Devuelve null si NINGÚN componente está presente (la partida usa P.U. directo). */
export function componentSum(item: BoqItem): number | null {
  const parts = [item.rateLabor, item.rateMaterial, item.rateEquipment, item.rateSubcontract, item.rateOther];
  if (!parts.some((p) => p != null)) return null;
  return parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

export function recalculate(
  boq: Boq,
  items: BoqItem[],
  markups: import("./types.js").MarkupRule[] = [],
): BoqCalcResult {
  const decimals = boq.roundingDecimals ?? 2;

  // Solo ítems de este BOQ.
  const own = items.filter((it) => it.boqId === boq.id);

  // Índice hijos-por-padre (padre null = raíz), ordenados por sortOrder.
  const childrenByParent = new Map<string | null, BoqItem[]>();
  for (const it of own) {
    const key = it.parentId ?? null;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(it);
    else childrenByParent.set(key, [it]);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const amounts: Record<string, number> = {};
  const visiting = new Set<string>(); // guarda contra ciclos accidentales

  function computeNode(item: BoqItem): number {
    if (visiting.has(item.id)) return 0; // ciclo: corta
    visiting.add(item.id);

    let amount: number;
    if (item.nodeType === "line") {
      const q = item.quantity ?? 0;
      const r = item.unitRate ?? 0;
      amount = round(q * r, decimals);
    } else {
      const kids = childrenByParent.get(item.id) ?? [];
      let sum = 0;
      for (const k of kids) sum += computeNode(k);
      amount = round(sum, decimals);
    }

    visiting.delete(item.id);
    amounts[item.id] = amount;
    return amount;
  }

  const roots = childrenByParent.get(null) ?? [];
  let subtotal = 0;
  for (const root of roots) subtotal += computeNode(root);
  subtotal = round(subtotal, decimals);

  // Markups en cascada, por sortOrder.
  const sorted = [...markups]
    .filter((m) => m.boqId === boq.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const markupResults: MarkupResult[] = [];
  let running = subtotal;
  for (const m of sorted) {
    const base = m.basis === "running" ? running : subtotal;
    const amount =
      m.type === "percentage"
        ? round((base * m.value) / 100, decimals)
        : round(m.value, decimals);
    markupResults.push({ id: m.id, name: m.name, base, amount });
    running = round(running + amount, decimals);
  }

  return { amounts, subtotal, markups: markupResults, total: running };
}

/** Costo por m² construido (F4). Derivación pura sobre un resultado ya calculado.
 *  - directPerM2 = subtotal / área (costo directo de obra, sin markups)
 *  - totalPerM2  = total / área    (con markups)
 *  Devuelve null si no hay área válida (> 0). */
export interface CostPerArea { area: number; directPerM2: number; totalPerM2: number; }
export function costPerArea(
  result: BoqCalcResult,
  area: number | null | undefined,
  decimals = 2,
): CostPerArea | null {
  if (area == null || !(area > 0)) return null;
  return {
    area,
    directPerM2: round(result.subtotal / area, decimals),
    totalPerM2: round(result.total / area, decimals),
  };
}
