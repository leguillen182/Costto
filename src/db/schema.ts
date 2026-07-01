// Schema Drizzle (SQLite) — derivado de types.ts / DATA_MODEL.md.
// Columnas en snake_case; propiedades en camelCase (mapeo automático de Drizzle).
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  baseCurrency: text("base_currency").notNull(),
  metadata: text("metadata"), // JSON serializado
});

export const boqs = sqliteTable("boqs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  version: text("version"),
  status: text("status"),
  currency: text("currency").notNull(),
  roundingDecimals: integer("rounding_decimals").notNull().default(2),
  detailLevel: text("detail_level").notNull().default("simple"),
  builtArea: real("built_area"), // m² construidos (F4)
  classificationSystem: text("classification_system"),
  metadata: text("metadata"),
});

export const boqItems = sqliteTable("boq_items", {
  id: text("id").primaryKey(),
  boqId: text("boq_id").notNull(),
  parentId: text("parent_id"), // null = raíz
  sortOrder: integer("sort_order").notNull().default(0),
  code: text("code"),
  description: text("description").notNull(),
  nodeType: text("node_type").notNull(), // group | line
  lineType: text("line_type"), // unit_price | lump_sum | provisional_sum | allowance
  quantity: real("quantity"),
  unit: text("unit"),
  unitRate: real("unit_rate"),
  rateLabor: real("rate_labor"),
  rateMaterial: real("rate_material"),
  rateEquipment: real("rate_equipment"),
  rateSubcontract: real("rate_subcontract"),
  rateOther: real("rate_other"),
  currency: text("currency"),
  customFields: text("custom_fields"), // JSON serializado
});

export const markupRules = sqliteTable("markup_rules", {
  id: text("id").primaryKey(),
  boqId: text("boq_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // percentage | fixed
  value: real("value").notNull(),
  basis: text("basis").notNull(), // subtotal | running
  sortOrder: integer("sort_order").notNull().default(0),
});

export const unitsOfMeasure = sqliteTable("units_of_measure", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  dimension: text("dimension"),
});

// Catálogo de precios unitarios (F9): partidas maestras reutilizables entre
// presupuestos. Se alimenta a mano o desde las líneas de un BOQ (upsert por código).
export const catalogItems = sqliteTable("catalog_items", {
  id: text("id").primaryKey(),
  code: text("code"),
  description: text("description").notNull(),
  unit: text("unit"),
  unitRate: real("unit_rate"),
  rateLabor: real("rate_labor"),
  rateMaterial: real("rate_material"),
  rateEquipment: real("rate_equipment"),
  rateSubcontract: real("rate_subcontract"),
  rateOther: real("rate_other"),
  currency: text("currency"),
  updatedAt: text("updated_at").notNull(),
});

// Hojas QTO persistidas (F10): mediciones + escalas por (presupuesto, documento PDF).
// El payload es el estado completo en JSON (misma estrategia que los snapshots);
// el enlace medición→partida (itemId) da trazabilidad "¿de dónde salió esta cantidad?".
export const qtoSheets = sqliteTable(
  "qto_sheets",
  {
    boqId: text("boq_id").notNull(),
    docName: text("doc_name").notNull(),
    updatedAt: text("updated_at").notNull(),
    payload: text("payload").notNull(), // JSON: { measurements: [...], scales: { "1": {unitsPerPdf, realUnit} } }
  },
  (t) => ({ pk: primaryKey({ columns: [t.boqId, t.docName] }) }),
);

// Versiones / snapshots congelados del presupuesto (F3). El payload guarda el
// contenido completo (boq + items + markups) como JSON inmutable.
export const boqSnapshots = sqliteTable("boq_snapshots", {
  id: text("id").primaryKey(),
  boqId: text("boq_id").notNull(),
  label: text("label").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  frozenTotal: real("frozen_total").notNull(),
  currency: text("currency").notNull(),
  payload: text("payload").notNull(), // JSON: { boq, items, markups }
});
