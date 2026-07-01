// Repositorio: persistencia de Project / Boq / BoqItem / MarkupRule en SQLite,
// y puente al motor de cálculo (calcBoq carga desde DB y llama recalculate).
import { and, eq, like, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AppDb } from "./db/client.js";
import { projects, boqs, boqItems, markupRules, boqSnapshots, catalogItems, qtoSheets } from "./db/schema.js";
import type { BoqSnapshot, SnapshotSummary } from "./snapshot.js";
import { recalculate } from "./calc.js";
import type {
  Project,
  Boq,
  BoqItem,
  MarkupRule,
  BoqCalcResult,
  CatalogItem,
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
    builtArea: r.builtArea ?? null,
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
      builtArea: b.builtArea ?? null,
      classificationSystem: b.classificationSystem ?? null,
      metadata: b.metadata ? JSON.stringify(b.metadata) : null,
    })
    .run();
}

export function updateBoqDetailLevel(db: AppDb, boqId: string, level: "simple" | "detailed"): void {
  db.update(boqs).set({ detailLevel: level }).where(eq(boqs.id, boqId)).run();
}

/** Actualiza el área construida (m²) del BOQ (F4). null = borrar. */
export function updateBoqBuiltArea(db: AppDb, boqId: string, area: number | null): void {
  db.update(boqs).set({ builtArea: area }).where(eq(boqs.id, boqId)).run();
}

// Inserta por lotes: un INSERT multi-fila con miles de ítems (~18 parámetros por fila)
// excede el límite de variables ligadas de SQLite y el guardado fallaría entero.
const INSERT_CHUNK = 500;
function chunked<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += INSERT_CHUNK) out.push(arr.slice(i, i + INSERT_CHUNK));
  return out;
}

export function insertItems(db: AppDb, items: BoqItem[]): void {
  if (items.length === 0) return;
  for (const chunk of chunked(items)) db.insert(boqItems).values(chunk.map(itemToRow)).run();
}

export function insertMarkups(db: AppDb, rules: MarkupRule[]): void {
  if (rules.length === 0) return;
  for (const chunk of chunked(rules)) db.insert(markupRules).values(chunk).run();
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
    for (const chunk of chunked(items)) tx.insert(boqItems).values(chunk.map(itemToRow)).run();
    for (const chunk of chunked(rules)) tx.insert(markupRules).values(chunk).run();
  });
}

// ---------- Catálogo de precios unitarios (F9) ----------
function rowToCatalog(r: typeof catalogItems.$inferSelect): CatalogItem {
  return {
    id: r.id,
    code: r.code ?? undefined,
    description: r.description,
    unit: r.unit ?? undefined,
    unitRate: r.unitRate,
    rateLabor: r.rateLabor,
    rateMaterial: r.rateMaterial,
    rateEquipment: r.rateEquipment,
    rateSubcontract: r.rateSubcontract,
    rateOther: r.rateOther,
    currency: r.currency ?? undefined,
    updatedAt: r.updatedAt,
  };
}

function catalogToRow(c: CatalogItem) {
  return {
    id: c.id,
    code: c.code?.trim() || null,
    description: c.description,
    unit: c.unit ?? null,
    unitRate: c.unitRate ?? null,
    rateLabor: c.rateLabor ?? null,
    rateMaterial: c.rateMaterial ?? null,
    rateEquipment: c.rateEquipment ?? null,
    rateSubcontract: c.rateSubcontract ?? null,
    rateOther: c.rateOther ?? null,
    currency: c.currency ?? null,
    updatedAt: c.updatedAt,
  };
}

/** Lista/busca el catálogo. `q` filtra por código o descripción (contiene, sin mayúsculas). */
export function listCatalog(db: AppDb, q?: string): CatalogItem[] {
  const base = db.select().from(catalogItems);
  const rows = q?.trim()
    ? base.where(or(like(catalogItems.code, `%${q.trim()}%`), like(catalogItems.description, `%${q.trim()}%`))).all()
    : base.all();
  return rows
    .map(rowToCatalog)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") || a.description.localeCompare(b.description));
}

/** Inserta o actualiza (por id) una partida del catálogo. */
export function saveCatalogItem(db: AppDb, item: CatalogItem): void {
  db.insert(catalogItems)
    .values(catalogToRow(item))
    .onConflictDoUpdate({ target: catalogItems.id, set: catalogToRow(item) })
    .run();
}

export function deleteCatalogItem(db: AppDb, id: string): void {
  db.delete(catalogItems).where(eq(catalogItems.id, id)).run();
}

// Clave de emparejamiento con el catálogo: código normalizado, o descripción si no hay código.
// (Mismo criterio que compareBoqs: el código manda cuando existe.)
function catalogKey(code: string | undefined, description: string): string {
  const c = code?.trim();
  return c ? "c:" + c.toLowerCase() : "d:" + description.trim().toLowerCase();
}

/** Vuelca las líneas de un BOQ al catálogo: actualiza precio/unidad/desglose de las
 *  existentes (emparejadas por código, o descripción si no hay código) y crea las nuevas.
 *  Ignora capítulos y líneas sin descripción. Devuelve cuántas agregó y actualizó. */
export function upsertCatalogFromItems(
  db: AppDb,
  items: BoqItem[],
  currency: string,
  updatedAt: string,
): { added: number; updated: number } {
  const existing = new Map(listCatalog(db).map((c) => [catalogKey(c.code, c.description), c]));
  let added = 0;
  let updated = 0;
  db.transaction(() => {
    for (const it of items) {
      if (it.nodeType !== "line" || !it.description?.trim()) continue;
      const key = catalogKey(it.code, it.description);
      const prev = existing.get(key);
      const entry: CatalogItem = {
        id: prev?.id ?? randomUUID(),
        code: it.code?.trim() || undefined,
        description: it.description,
        unit: it.unit || undefined,
        unitRate: it.unitRate ?? null,
        rateLabor: it.rateLabor ?? null,
        rateMaterial: it.rateMaterial ?? null,
        rateEquipment: it.rateEquipment ?? null,
        rateSubcontract: it.rateSubcontract ?? null,
        rateOther: it.rateOther ?? null,
        currency: it.currency ?? currency,
        updatedAt,
      };
      saveCatalogItem(db, entry);
      existing.set(key, entry); // dos líneas iguales en el mismo BOQ: la última manda
      if (prev) updated++;
      else added++;
    }
  });
  return { added, updated };
}

// ---------- Hojas QTO persistidas (F10) ----------
// El payload viaja opaco (JSON del front): el backend solo lo guarda y devuelve.
// Se valida la forma mínima en el server; la semántica vive en web/qto.ts.

export interface QtoSheetPayload {
  measurements: unknown[];
  scales: Record<string, unknown>;
}

export function getQtoSheet(db: AppDb, boqId: string, docName: string): QtoSheetPayload | undefined {
  const r = db
    .select()
    .from(qtoSheets)
    .where(and(eq(qtoSheets.boqId, boqId), eq(qtoSheets.docName, docName)))
    .get();
  return r ? (JSON.parse(r.payload) as QtoSheetPayload) : undefined;
}

export function saveQtoSheet(
  db: AppDb,
  boqId: string,
  docName: string,
  payload: QtoSheetPayload,
  updatedAt: string,
): void {
  const row = { boqId, docName, updatedAt, payload: JSON.stringify(payload) };
  db.insert(qtoSheets)
    .values(row)
    .onConflictDoUpdate({ target: [qtoSheets.boqId, qtoSheets.docName], set: { updatedAt: row.updatedAt, payload: row.payload } })
    .run();
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
