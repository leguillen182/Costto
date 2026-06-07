// Schema Drizzle (SQLite) — derivado de types.ts / DATA_MODEL.md.
// Columnas en snake_case; propiedades en camelCase (mapeo automático de Drizzle).
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
