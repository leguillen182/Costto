// Operaciones de árbol del BOQ (jerarquía grupo/línea) — funciones PURAS.
// Extraídas del editor (web/main.ts) para poder testearlas sin DOM ni estado global.
// Contrato: reciben el array `items` y devuelven uno NUEVO; nunca mutan la entrada
// ni el DOM. Los ids de nodos nuevos se inyectan (deterministas, sin tocar crypto).
import type { BoqItem } from "./types.js";

/** Recorre el árbol (parentId + sortOrder) y devuelve la lista aplanada en orden DFS con profundidad. */
export function ordered(items: BoqItem[]): { item: BoqItem; depth: number }[] {
  const byParent = new Map<string | null, BoqItem[]>();
  for (const it of items) {
    const arr = byParent.get(it.parentId);
    if (arr) arr.push(it);
    else byParent.set(it.parentId, [it]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
  const out: { item: BoqItem; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const it of byParent.get(parent) ?? []) {
      out.push({ item: it, depth });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Renumera los hermanos de `parentId` a 1..n (enteros) preservando el orden → evita truncado al persistir. */
export function normalizeSiblings(items: BoqItem[], parentId: string | null): BoqItem[] {
  const sibs = items.filter((i) => i.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const order = new Map(sibs.map((s, i) => [s.id, i + 1]));
  return items.map((i) => (order.has(i.id) ? { ...i, sortOrder: order.get(i.id)! } : i));
}

/** Indenta: el ítem pasa a ser hijo de su hermano anterior.
 *  Si ese hermano era una línea, se convierte en capítulo (grupo) para no romper el rollup. */
export function indent(items: BoqItem[], id: string): BoqItem[] {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  const sibs = items.filter((i) => i.parentId === it.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = sibs.findIndex((s) => s.id === id);
  if (idx <= 0) return items; // sin hermano anterior, no se puede indentar
  const newParent = sibs[idx - 1]!;
  const newSort = items.filter((i) => i.parentId === newParent.id).length + 1;
  const next = items.map((i): BoqItem => {
    if (i.id === newParent.id && i.nodeType === "line") {
      return { ...i, nodeType: "group", lineType: undefined, quantity: undefined, unit: undefined, unitRate: undefined };
    }
    if (i.id === id) {
      return { ...i, parentId: newParent.id, sortOrder: newSort };
    }
    return i;
  });
  return normalizeSiblings(next, newParent.id);
}

/** Desindenta: el ítem sube un nivel, quedando justo después de su antiguo padre. */
export function outdent(items: BoqItem[], id: string): BoqItem[] {
  const it = items.find((i) => i.id === id);
  if (!it || it.parentId === null) return items;
  const parent = items.find((i) => i.id === it.parentId);
  if (!parent) return items;
  const next = items.map((i): BoqItem =>
    i.id === id ? { ...i, parentId: parent.parentId, sortOrder: parent.sortOrder + 0.5 } : i,
  );
  return normalizeSiblings(next, parent.parentId);
}

/** Mueve el ítem entre sus hermanos (dir -1 sube, +1 baja). No-op si ya está en el extremo. */
export function move(items: BoqItem[], id: string, dir: -1 | 1): BoqItem[] {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  const sibs = items.filter((i) => i.parentId === it.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = sibs.findIndex((s) => s.id === id);
  const swap = sibs[idx + dir];
  if (!swap) return items;
  return items.map((i): BoqItem => {
    if (i.id === it.id) return { ...i, sortOrder: swap.sortOrder };
    if (i.id === swap.id) return { ...i, sortOrder: it.sortOrder };
    return i;
  });
}

/** Elimina un ítem y, en cascada, todos sus descendientes. */
export function removeItem(items: BoqItem[], id: string): BoqItem[] {
  const toDelete = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of items) {
      if (it.parentId && toDelete.has(it.parentId) && !toDelete.has(it.id)) {
        toDelete.add(it.id);
        changed = true;
      }
    }
  }
  return items.filter((i) => !toDelete.has(i.id));
}

/** Inserta un capítulo (grupo) vacío bajo `parentId` y renumera sus hermanos. */
export function addGroup(items: BoqItem[], boqId: string, parentId: string | null, newId: string): BoqItem[] {
  const it: BoqItem = { id: newId, boqId, parentId, sortOrder: 9999, code: "", description: "", nodeType: "group" };
  return normalizeSiblings([...items, it], parentId);
}

/** Inserta una partida (línea) bajo `parentId`. Si `afterSort` se da, queda justo después de esa posición. */
export function addLine(
  items: BoqItem[],
  boqId: string,
  parentId: string | null,
  newId: string,
  afterSort?: number,
): BoqItem[] {
  const it: BoqItem = {
    id: newId,
    boqId,
    parentId,
    sortOrder: afterSort != null ? afterSort + 0.5 : 9999,
    code: "",
    description: "",
    nodeType: "line",
    lineType: "unit_price",
    quantity: 0,
    unit: "",
    unitRate: 0,
  };
  return normalizeSiblings([...items, it], parentId);
}
