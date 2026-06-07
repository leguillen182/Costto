// Repositorio: persistencia de Project / Boq / BoqItem / MarkupRule en SQLite,
// y puente al motor de cálculo (calcBoq carga desde DB y llama recalculate).
import { eq } from "drizzle-orm";
import type { AppDb } from "./db/client.js";
import { projects, boqs, boqItems, markupRules, boqSnapshots } from "./db/schema.js";
import type { BoqSnapshot, SnapshotSummary } from "./snapshot.js";
import { recalculate } from "./calc.js";
import type {
  Project,
  Boq,
  BoqItem,
  MarkupRule,
  BoqCalcResult,
  NodeType,
  LineType,
  MarkupType,
  MarkupBasis,
} from "./types.js";

// ---------- Mappers (dominio <-> fila) ----------
function itemToRow(it: BoqItem) {
  return {
    id: it.id,
    boqId: it.boqId,
    parentId: it.parentId,
    sortOrder: it.sortOrder,
    code: it.code ?? null,
    description: it.description,
    nodeType: it.nodeType,
    lineType: it.lineType ?? null,
    quantity: it.quantity ?? null,
    unit: it.unit ?? null,
    unitRate: it.unitRate ?? null,
    rateLabor: it.rateLabor ?? null,
    rateMaterial: it.rateMaterial ?? null,
    rateEquipment: it.rateEquipment ?? null,
    rateSubcontract: it.rateSubcontract ?? null,
    rateOther: it.rateOther ?? null,
    currency: it.currency ?? null,
    customFields: it.customFields ? JSON.stringify(it.customFields) : null,
  };
}

function rowToItem(r: typeof boqItems.$inferSelect): BoqItem {
  return {
    id: r.id,
    boqId: r.boqId,
    parentId: r.parentId,
    sortOrder: r.sortOrder,
    code: r.code ?? undefined,
    description: r.description,
    nodeType: r.nodeType as NodeType,
    lineType: (r.lineType ?? undefined) as LineType | undefined,
    quantity: r.quantity,
    unit: r.unit ?? undefined,
    unitRate: r.unitRate,
    rateLabor: r.rateLabor,
    rateMaterial: r.rateMaterial,
    rateEquipment: r.rateEquipment,
    rateSubcontract: r.rateSubcontract,
    rateOther: r.rateOther,
    currency: r.currency ?? undefined,
    customFields: r.customFields ? JSON.parse(r.customFields) : undefined,
  };
}

function rowToBoq(r: typeof boqs.$inferSelect): Boq {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    kind: r.kind,
    version: r.version ?? undefined,
    status: r.status ?? undefined,
    currency: r.currency,
    roundingDecimals: r.roundingDecimals,
    detailLevel: (r.detailLevel ?? "simple") as Boq["detailLevel"],
    classificationSystem: r.classificationSystem ?? undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  };
}

function rowToMarkup(r: typeof markupRules.$inferSelect): MarkupRule {
  return {
    id: r.id,
    boqId: r.boqId,
    name: r.name,
    type: r.type as MarkupType,
    value: r.value,
    basis: r.basis as MarkupBasis,
    sortOrder: r.sortOrder,
  };
}

// ---------- Escritura ----------
export function createProject(db: AppDb, p: Project): void {
  db.insert(projects)
    .values({
      id: p.id,
      name: p.name,
      code: p.code ?? null,
      baseCurrency: p.baseCurrency,
      metadata: p.metadata ? JSON.stringify(p.metadata) : null,
    })
    .run();
}

export function createBoq(db: AppDb, b: Boq): void {
  db.insert(boqs)
    .values({
      id: b.id,
      projectId: b.projectId,
      name: b.name,
      kind: b.kind,
      version: b.version != null ? String(b.version) : null,
      status: b.status ?? null,
      currency: b.currency,
      roundingDecimals: b.roundingDecimals,
      detailLevel: b.detailLevel ?? "simple",
      classificationSystem: b.classificationSystem ?? null,
      metadata: b.metadata ? JSON.stringify(b.metadata) : null,
    })
    .run();
}

export function updateBoqDetailLevel(db: AppDb, boqId: string, level: "simple" | "detailed"): void {
  db.update(boqs).set({ detailLevel: level }).where(eq(boqs.id, boqId)).run();
}

export function insertItems(db: AppDb, items: BoqItem[]): void {
  if (items.length === 0) return;
  db.insert(boqItems).values(items.map(itemToRow)).run();
}

export function insertMarkups(db: AppDb, rules: MarkupRule[]): void {
  if (rules.length === 0) return;
  db.insert(markupRules).values(rules).run();
}

export interface BoqSummary {
  id: string;
  name: string;
  kind: string;
  currency: string;
  projectId: string;
  projectName: string;
}

/** Lista todos los presupuestos (con nombre de proyecto) para el selector de la UI. */
export function listBoqs(db: AppDb): BoqSummary[] {
  const bs = db.select().from(boqs).all();
  const ps = db.select().from(projects).all();
  const pName = new Map(ps.map((p) => [p.id, p.name]));
  return bs.map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    currency: b.currency,
    projectId: b.projectId,
    projectName: pName.get(b.projectId) ?? "",
  }));
}

/** Crea un proyecto + un presupuesto vacío y devuelve el id del BOQ. */
export function createBudget(
  db: AppDb,
  opts: { projectId: string; boqId: string; projectName: string; boqName: string; currency: string },
): string {
  createProject(db, { id: opts.projectId, name: opts.projectName, baseCurrency: opts.currency });
  createBoq(db, {
    id: opts.boqId,
    projectId: opts.projectId,
    name: opts.boqName,
    kind: "owner_budget",
    currency: opts.currency,
    roundingDecimals: 2,
    detailLevel: "simple",
  });
  return opts.boqId;
}

// ---------- Lectura ----------
export function getBoq(db: AppDb, boqId: string): Boq | undefined {
  const row = db.select().from(boqs).where(eq(boqs.id, boqId)).get();
  return row ? rowToBoq(row) : undefined;
}

export function getItems(db: AppDb, boqId: string): BoqItem[] {
  return db.select().from(boqItems).where(eq(boqItems.boqId, boqId)).all().map(rowToItem);
}

export function getMarkups(db: AppDb, boqId: string): MarkupRule[] {
  return db.select().from(markupRules).where(eq(markupRules.boqId, boqId)).all().map(rowToMarkup);
}

// Reemplaza TODO el contenido (items + markups) de un BOQ en una transacción.
// Estrategia simple para el MVP del editor: borra y reinserta.
export function saveBoqContents(db: AppDb, boqId: string, items: BoqItem[], rules: MarkupRule[]): void {
  db.transaction((tx) => {
    tx.delete(boqItems).where(eq(boqItems.boqId, boqId)).run();
    tx.delete(markupRules).where(eq(markupRules.boqId, boqId)).run();
    if (items.length) tx.insert(boqItems).values(items.map(itemToRow)).run();
    if (rules.length) tx.insert(markupRules).values(rules).run();
  });
}

// ---------- Snapshots / versiones (F3) ----------
export function createSnapshot(db: AppDb, snap: BoqSnapshot): void {
  db.insert(boqSnapshots)
    .values({
      id: snap.id,
      boqId: snap.boqId,
      label: snap.label,
      note: snap.note ?? null,
      createdAt: snap.createdAt,
      frozenTotal: snap.frozenTotal,
      currency: snap.currency,
      payload: JSON.stringify(snap.payload),
    })
    .run();
}

/** Lista los snapshots de un BOQ (sin payload), más reciente primero. */
export function listSnapshots(db: AppDb, boqId: string): SnapshotSummary[] {
  return db
    .select()
    .from(boqSnapshots)
    .where(eq(boqSnapshots.boqId, boqId))
    .all()
    .map((r) => ({
      id: r.id,
      boqId: r.boqId,
      label: r.label,
      note: r.note ?? undefined,
      createdAt: r.createdAt,
      frozenTotal: r.frozenTotal,
      currency: r.currency,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSnapshot(db: AppDb, snapshotId: string): BoqSnapshot | undefined {
  const r = db.select().from(boqSnapshots).where(eq(boqSnapshots.id, snapshotId)).get();
  if (!r) return undefined;
  return {
    id: r.id,
    boqId: r.boqId,
    label: r.label,
    note: r.note ?? undefined,
    createdAt: r.createdAt,
    frozenTotal: r.frozenTotal,
    currency: r.currency,
    payload: JSON.parse(r.payload),
  };
}

// ---------- Puente al cálculo ----------
export function calcBoq(db: AppDb, boqId: string): BoqCalcResult {
  const boq = getBoq(db, boqId);
  if (!boq) throw new Error(`BOQ no encontrado: ${boqId}`);
  return recalculate(boq, getItems(db, boqId), getMarkups(db, boqId));
}
