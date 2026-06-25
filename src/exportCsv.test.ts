import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCsv, writeBoqCsv } from "./exportCsv.js";
import { recalculate } from "./calc.js";
import { createDb } from "./db/client.js";
import { createProject, createBoq, insertItems } from "./repo.js";
import type { Boq, BoqItem } from "./types.js";

const boq: Boq = { id: "b1", projectId: "p1", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 };
const items: BoqItem[] = [
  { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
  { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
  { id: "l2", boqId: "b1", parentId: "c1", sortOrder: 2, code: "01.02", description: 'Relleno, "compactado"', nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m³", unitRate: 250 },
];

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

describe("exportCsv — buildCsv", () => {
  it("empieza con BOM, usa CRLF y la cabecera esperada", () => {
    const csv = buildCsv(boq, items, recalculate(boq, items));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.includes("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe("Nivel de esquema,EDT,Nombre,Unidad,Cantidad,P. Unitario,Costo");
  });

  it("Nivel de esquema = 1 para el capítulo y 2 para sus partidas (contiguo para MS Project)", () => {
    const rows = lines(buildCsv(boq, items, recalculate(boq, items)));
    expect(rows[1]!.startsWith("1,01,Movimiento de tierra")).toBe(true);
    expect(rows[2]!.startsWith("2,01.01,Excavación")).toBe(true);
  });

  it("el capítulo deja cantidad/precio/costo en blanco; la partida los trae con Costo = importe", () => {
    const calc = recalculate(boq, items);
    const rows = lines(buildCsv(boq, items, calc));
    // capítulo: 1,01,Movimiento de tierra,,, → termina en comas vacías
    expect(rows[1]).toBe("1,01,Movimiento de tierra,,,,");
    // partida l1: Costo = 100 × 350 = 35000
    expect(rows[2]).toBe(`2,01.01,Excavación,m³,100,350,${calc.amounts.l1}`);
    expect(calc.amounts.l1).toBe(35000);
  });

  it("entrecomilla y escapa campos con coma y comillas", () => {
    const rows = lines(buildCsv(boq, items, recalculate(boq, items)));
    // descripción `Relleno, "compactado"` → "Relleno, ""compactado"""
    expect(rows[3]).toContain('"Relleno, ""compactado"""');
  });

  it("conserva los acentos verbatim", () => {
    const csv = buildCsv(boq, items, recalculate(boq, items));
    expect(csv).toContain("Excavación");
  });
});

describe("exportCsv — writeBoqCsv", () => {
  it("escribe (y sobrescribe) el archivo con el nombre saneado del BOQ", () => {
    const db = createDb(":memory:").db;
    createProject(db, { id: "p1", name: "Torre A", baseCurrency: "DOP" });
    createBoq(db, { id: "b1", projectId: "p1", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 });
    insertItems(db, items);

    const dir = mkdtempSync(join(tmpdir(), "costto-csv-"));
    const dest = writeBoqCsv(db, "b1", dir);
    expect(dest).toBe(join(dir, "Torre_A.csv"));
    expect(existsSync(dest!)).toBe(true);
    const content = readFileSync(dest!, "utf8");
    expect(content.startsWith("﻿")).toBe(true);
    expect(content).toContain("Movimiento de tierra");

    // Sobrescribe sin error y deja un único archivo actual.
    expect(writeBoqCsv(db, "b1", dir)).toBe(dest);
  });

  it("devuelve null si el BOQ no existe", () => {
    const db = createDb(":memory:").db;
    expect(writeBoqCsv(db, "nope", mkdtempSync(join(tmpdir(), "costto-csv-")))).toBeNull();
  });
});
