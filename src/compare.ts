// Comparación de dos presupuestos (B2) — función PURA.
// Empareja partidas (líneas) por código (o descripción si no hay código) y calcula deltas.
// Caso de uso dueño: presupuesto del dueño (A) vs. oferta del contratista (B).
import { recalculate } from "./calc.js";
import type { Boq, BoqItem } from "./types.js";

export type CompareSide = "both" | "onlyA" | "onlyB";

export interface CompareRow {
  key: string;
  code?: string;
  description: string;
  side: CompareSide;
  amountA: number | null;
  amountB: number | null;
  deltaAmount: number | null; // B - A (positivo = el contratista cobra más)
  deltaPct: number | null;
}

export interface CompareResult {
  rows: CompareRow[];
  totalA: number;
  totalB: number;
  deltaTotal: number;
  currencyA: string;
  currencyB: string;
  sameCurrency: boolean;
  counts: { matched: number; onlyA: number; onlyB: number };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Clave de emparejamiento: código normalizado, o descripción normalizada si no hay código.
function keyOf(it: BoqItem): string {
  const code = it.code?.trim();
  if (code) return "c:" + code.toLowerCase();
  return "d:" + (it.description ?? "").trim().toLowerCase();
}

export function compareBoqs(boqA: Boq, itemsA: BoqItem[], boqB: Boq, itemsB: BoqItem[]): CompareResult {
  const calcA = recalculate(boqA, itemsA);
  const calcB = recalculate(boqB, itemsB);
  // Precisión monetaria = la del presupuesto base (A); los % siempre a 2 decimales.
  const decimals = boqA.roundingDecimals ?? 2;

  const linesA = itemsA.filter((i) => i.boqId === boqA.id && i.nodeType === "line");
  const linesB = itemsB.filter((i) => i.boqId === boqB.id && i.nodeType === "line");
  // Varias líneas pueden compartir clave (código duplicado, o misma descripción en
  // capítulos distintos): se agregan sus importes para no perder partidas del total.
  type Agg = { item: BoqItem; amount: number };
  const aggregate = (lines: BoqItem[], amounts: Record<string, number>): Map<string, Agg> => {
    const map = new Map<string, Agg>();
    for (const it of lines) {
      const k = keyOf(it);
      const amount = amounts[it.id] ?? 0;
      const prev = map.get(k);
      if (prev) prev.amount += amount;
      else map.set(k, { item: it, amount });
    }
    return map;
  };
  const mapA = aggregate(linesA, calcA.amounts);
  const mapB = aggregate(linesB, calcB.amounts);

  const rows: CompareRow[] = [];
  let totalA = 0;
  let totalB = 0;
  let matched = 0;
  let onlyA = 0;
  let onlyB = 0;

  for (const k of new Set([...mapA.keys(), ...mapB.keys()])) {
    const a = mapA.get(k);
    const b = mapB.get(k);
    const amountA = a ? round(a.amount, decimals) : null;
    const amountB = b ? round(b.amount, decimals) : null;
    if (amountA != null) totalA += amountA;
    if (amountB != null) totalB += amountB;

    const side: CompareSide = a && b ? "both" : a ? "onlyA" : "onlyB";
    if (side === "both") matched++;
    else if (side === "onlyA") onlyA++;
    else onlyB++;

    const deltaAmount = amountA != null && amountB != null ? round(amountB - amountA, decimals) : null;
    const deltaPct = deltaAmount != null && amountA ? round((deltaAmount / amountA) * 100, 2) : null;

    rows.push({
      key: k,
      code: (a ?? b)?.item.code,
      description: (a ?? b)?.item.description ?? "",
      side,
      amountA,
      amountB,
      deltaAmount,
      deltaPct,
    });
  }

  // Orden: primero las emparejadas, luego solo-A (omitidas), luego solo-B (agregadas); por código/descripción.
  const sideRank = { both: 0, onlyA: 1, onlyB: 2 } as const;
  rows.sort((x, y) => sideRank[x.side] - sideRank[y.side] || (x.code ?? x.description).localeCompare(y.code ?? y.description));

  return {
    rows,
    totalA: round(totalA, decimals),
    totalB: round(totalB, decimals),
    deltaTotal: round(totalB - totalA, decimals),
    currencyA: boqA.currency,
    currencyB: boqB.currency,
    sameCurrency: boqA.currency === boqB.currency,
    counts: { matched, onlyA, onlyB },
  };
}
