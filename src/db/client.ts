// Conexión SQLite + Drizzle. Local, stand-alone (un archivo .db, o :memory: en tests).
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type AppDb = BetterSQLite3Database<typeof schema>;

export function createDb(file = ":memory:"): { db: AppDb; sqlite: Database.Database } {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

// Migración mínima: crea las tablas si no existen (espejo de schema.ts).
function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      base_currency TEXT NOT NULL,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS boqs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      version TEXT,
      status TEXT,
      currency TEXT NOT NULL,
      rounding_decimals INTEGER NOT NULL DEFAULT 2,
      detail_level TEXT NOT NULL DEFAULT 'simple',
      built_area REAL,
      classification_system TEXT,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS boq_items (
      id TEXT PRIMARY KEY,
      boq_id TEXT NOT NULL REFERENCES boqs(id),
      parent_id TEXT REFERENCES boq_items(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      code TEXT,
      description TEXT NOT NULL,
      node_type TEXT NOT NULL,
      line_type TEXT,
      quantity REAL,
      unit TEXT,
      unit_rate REAL,
      rate_labor REAL,
      rate_material REAL,
      rate_equipment REAL,
      rate_subcontract REAL,
      rate_other REAL,
      currency TEXT,
      custom_fields TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_boq_items_boq ON boq_items(boq_id);
    CREATE INDEX IF NOT EXISTS idx_boq_items_parent ON boq_items(parent_id);
    CREATE TABLE IF NOT EXISTS markup_rules (
      id TEXT PRIMARY KEY,
      boq_id TEXT NOT NULL REFERENCES boqs(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      basis TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_markup_boq ON markup_rules(boq_id);
    CREATE TABLE IF NOT EXISTS units_of_measure (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dimension TEXT
    );
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      code TEXT,
      description TEXT NOT NULL,
      unit TEXT,
      unit_rate REAL,
      rate_labor REAL,
      rate_material REAL,
      rate_equipment REAL,
      rate_subcontract REAL,
      rate_other REAL,
      currency TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_code ON catalog_items(code);
    CREATE TABLE IF NOT EXISTS qto_sheets (
      boq_id TEXT NOT NULL REFERENCES boqs(id),
      doc_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (boq_id, doc_name)
    );
    CREATE TABLE IF NOT EXISTS boq_snapshots (
      id TEXT PRIMARY KEY,
      boq_id TEXT NOT NULL REFERENCES boqs(id),
      label TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      frozen_total REAL NOT NULL,
      currency TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_boq ON boq_snapshots(boq_id);
  `);

  // Migración aditiva para data.db existentes (CREATE TABLE IF NOT EXISTS no altera tablas previas).
  addColumnIfMissing(sqlite, "boq_items", "rate_other", "REAL");
  addColumnIfMissing(sqlite, "boqs", "detail_level", "TEXT NOT NULL DEFAULT 'simple'");
  addColumnIfMissing(sqlite, "boqs", "built_area", "REAL");
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, decl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl};`);
  }
}
