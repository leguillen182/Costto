// Exportación de un BOQ a CSV compatible con MS Project (y abrible en Excel).
// Una vía: Costto -> CSV. La jerarquía se codifica en la columna "Nivel de esquema"
// (Outline Level = depth + 1), que MS Project usa para reconstruir tareas resumen/subtareas.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderedItems } from "./export.js";
import { getBoq, getItems, calcBoq } from "./repo.js";
import type { AppDb } from "./db/client.js";
import type { Boq, BoqItem, BoqCalcResult } from "./types.js";

const BOM = "﻿"; // UTF-8 BOM: Excel/MS Project leen los acentos correctamente.
const EOL = "\r\n"; // CRLF: amistoso con Excel/Windows/MS Project.

// Encabezados en español (locale es-DO) alineados con los campos de importación de MS Project.
// Si el MS Project del usuario está en inglés, cambiar a:
//   ["Outline Level","WBS","Name","Unit","Quantity","Unit Price","Cost"]
const HEADERS = ["Nivel de esquema", "EDT", "Nombre", "Unidad", "Cantidad", "P. Unitario", "Costo"];

/** Escapa un campo CSV: entrecomilla si contiene coma, comilla o salto de línea. */
function csvField(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Genera el texto CSV completo (con BOM) de un BOQ ya calculado. */
export function buildCsv(boq: Boq, items: BoqItem[], calc: BoqCalcResult): string {
  const lines = [HEADERS.map(csvField).join(",")];
  for (const { item, depth } of orderedItems(items)) {
    const isGroup = item.nodeType === "group";
    // Los capítulos (tareas resumen) dejan cantidad/precio/costo en blanco: MS Project
    // calcula el rollup automáticamente y así no se duplican los totales.
    const row = [
      depth + 1, // Nivel de esquema (1 = capítulo raíz)
      item.code ?? "",
      item.description ?? "",
      isGroup ? "" : item.unit ?? "",
      isGroup ? "" : item.quantity ?? "",
      isGroup ? "" : item.unitRate ?? "",
      isGroup ? "" : calc.amounts[item.id] ?? 0,
    ];
    lines.push(row.map(csvField).join(","));
  }
  return BOM + lines.join(EOL) + EOL;
}

/** Sanitiza el nombre del BOQ para usarlo como nombre de archivo (igual que el endpoint de Excel). */
function safeName(name: string): string {
  return name.replace(/[^\w\-]+/g, "_").slice(0, 60) || "presupuesto";
}

/** Carga el BOQ, lo serializa a CSV y lo escribe (sobrescribe) en `dir/<nombre>.csv`.
 *  Devuelve la ruta escrita, o null si el BOQ no existe. */
export function writeBoqCsv(db: AppDb, boqId: string, dir: string): string | null {
  const boq = getBoq(db, boqId);
  if (!boq) return null;
  const csv = buildCsv(boq, getItems(db, boqId), calcBoq(db, boqId));
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${safeName(boq.name)}.csv`);
  writeFileSync(dest, csv, "utf8");
  return dest;
}
