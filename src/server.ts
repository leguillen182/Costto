// Backend HTTP ligero (módulo http nativo) para el editor de BOQ.
// Expone el repositorio sobre REST. DB persistente en data.db.
import { createServer } from "node:http";
import { createDb } from "./db/client.js";
import {
  getBoq,
  getItems,
  getMarkups,
  calcBoq,
  createProject,
  createBoq,
  insertItems,
  insertMarkups,
  saveBoqContents,
  updateBoqDetailLevel,
  listBoqs,
  createBudget,
  createSnapshot,
  listSnapshots,
  getSnapshot,
} from "./repo.js";
import { randomUUID } from "node:crypto";
import { buildWorkbook } from "./export.js";
import { parseWorkbook } from "./import.js";
import { compareBoqs } from "./compare.js";
import { buildSnapshot, snapshotToCompareInputs, toSummary } from "./snapshot.js";
import type { BoqItem, MarkupRule } from "./types.js";

const { db } = createDb("data.db");
seedIfEmpty();

function seedIfEmpty() {
  if (getBoq(db, "b1")) return;
  createProject(db, { id: "p1", name: "Torre A", baseCurrency: "DOP" });
  createBoq(db, { id: "b1", projectId: "p1", name: "Presupuesto base — Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2 });
  insertItems(db, [
    { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
    { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
    { id: "l2", boqId: "b1", parentId: "c1", sortOrder: 2, code: "01.02", description: "Relleno compactado", nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m³", unitRate: 250 },
    { id: "c2", boqId: "b1", parentId: null, sortOrder: 2, code: "02", description: "Estudios y diseño", nodeType: "group" },
    { id: "l3", boqId: "b1", parentId: "c2", sortOrder: 1, code: "02.01", description: "Diseño estructural", nodeType: "line", lineType: "lump_sum", quantity: 1, unit: "global", unitRate: 75000 },
  ]);
  insertMarkups(db, [{ id: "m_itbis", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 1 }]);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function readBodyBuffer(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Listar presupuestos: GET /api/boqs
    if (url.pathname === "/api/boqs" && req.method === "GET") {
      return json(res, 200, { boqs: listBoqs(db) });
    }
    // Crear presupuesto (proyecto + BOQ): POST /api/boqs
    if (url.pathname === "/api/boqs" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { projectName?: string; boqName?: string; currency?: string };
      const id = createBudget(db, {
        projectId: randomUUID(),
        boqId: randomUUID(),
        projectName: body.projectName?.trim() || "Proyecto sin nombre",
        boqName: body.boqName?.trim() || "Presupuesto base",
        currency: body.currency?.trim() || "DOP",
      });
      return json(res, 201, { id });
    }

    // Comparar 2 presupuestos: GET /api/compare?a=ID&b=ID
    if (url.pathname === "/api/compare" && req.method === "GET") {
      const a = url.searchParams.get("a") ?? "";
      const b = url.searchParams.get("b") ?? "";
      const ba = getBoq(db, a);
      const bb = getBoq(db, b);
      if (!ba || !bb) return json(res, 404, { error: "BOQ no encontrado" });
      return json(res, 200, compareBoqs(ba, getItems(db, a), bb, getItems(db, b)));
    }

    // Export a Excel: GET /api/boq/:id/export
    const ex = url.pathname.match(/^\/api\/boq\/([^/]+)\/export$/);
    if (ex && req.method === "GET") {
      const id = ex[1]!;
      const boq = getBoq(db, id);
      if (!boq) return json(res, 404, { error: "BOQ no encontrado" });
      const wb = await buildWorkbook(boq, getItems(db, id), calcBoq(db, id));
      const safe = boq.name.replace(/[^\w\-]+/g, "_").slice(0, 60) || "presupuesto";
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
      });
      await wb.xlsx.write(res);
      return res.end();
    }

    // Import desde Excel: POST /api/boq/:id/import (cuerpo = bytes del .xlsx)
    const im = url.pathname.match(/^\/api\/boq\/([^/]+)\/import$/);
    if (im && req.method === "POST") {
      const id = im[1]!;
      if (!getBoq(db, id)) return json(res, 404, { error: "BOQ no encontrado" });
      const buf = await readBodyBuffer(req);
      const { items, rowsRead } = await parseWorkbook(buf, id);
      const markups = getMarkups(db, id); // preservar markups existentes
      saveBoqContents(db, id, items, markups);
      return json(res, 200, { ok: true, rowsRead, calc: calcBoq(db, id) });
    }

    // Versiones / snapshots (F3)
    const snapList = url.pathname.match(/^\/api\/boq\/([^/]+)\/snapshots$/);
    // Listar snapshots: GET /api/boq/:id/snapshots
    if (snapList && req.method === "GET") {
      const id = snapList[1]!;
      if (!getBoq(db, id)) return json(res, 404, { error: "BOQ no encontrado" });
      return json(res, 200, { snapshots: listSnapshots(db, id) });
    }
    // Congelar estado actual: POST /api/boq/:id/snapshots  body { label, note }
    if (snapList && req.method === "POST") {
      const id = snapList[1]!;
      const boq = getBoq(db, id);
      if (!boq) return json(res, 404, { error: "BOQ no encontrado" });
      const body = JSON.parse((await readBody(req)) || "{}") as { label?: string; note?: string };
      const snap = buildSnapshot({
        id: randomUUID(),
        boqId: id,
        label: body.label ?? "",
        note: body.note,
        createdAt: new Date().toISOString(),
        boq,
        items: getItems(db, id),
        markups: getMarkups(db, id),
        calc: calcBoq(db, id),
      });
      createSnapshot(db, snap);
      return json(res, 201, { snapshot: toSummary(snap) });
    }

    // Comparar estado vivo contra un snapshot: GET /api/boq/:id/compare-snapshot?snapshot=SNAPID
    const snapCmp = url.pathname.match(/^\/api\/boq\/([^/]+)\/compare-snapshot$/);
    if (snapCmp && req.method === "GET") {
      const id = snapCmp[1]!;
      const live = getBoq(db, id);
      if (!live) return json(res, 404, { error: "BOQ no encontrado" });
      const snap = getSnapshot(db, url.searchParams.get("snapshot") ?? "");
      if (!snap || snap.boqId !== id) return json(res, 404, { error: "Snapshot no encontrado" });
      // A = snapshot congelado (baseline); B = estado vivo → Δ = vivo − Rev.0
      const base = snapshotToCompareInputs(snap);
      const result = compareBoqs(base.boq, base.items, live, getItems(db, id));
      return json(res, 200, { ...result, snapshotLabel: snap.label, snapshotCreatedAt: snap.createdAt });
    }

    const m = url.pathname.match(/^\/api\/boq\/([^/]+)$/);

    if (m && req.method === "GET") {
      const id = m[1]!;
      const boq = getBoq(db, id);
      if (!boq) return json(res, 404, { error: "BOQ no encontrado" });
      return json(res, 200, { boq, items: getItems(db, id), markups: getMarkups(db, id), calc: calcBoq(db, id) });
    }

    if (m && req.method === "PUT") {
      const id = m[1]!;
      if (!getBoq(db, id)) return json(res, 404, { error: "BOQ no encontrado" });
      const body = JSON.parse((await readBody(req)) || "{}") as {
        items?: BoqItem[];
        markups?: MarkupRule[];
        detailLevel?: "simple" | "detailed";
      };
      saveBoqContents(db, id, body.items ?? [], body.markups ?? []);
      if (body.detailLevel === "simple" || body.detailLevel === "detailed") {
        updateBoqDetailLevel(db, id, body.detailLevel);
      }
      return json(res, 200, { ok: true, calc: calcBoq(db, id) });
    }

    json(res, 404, { error: "ruta no encontrada" });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

const PORT = 8787;
server.listen(PORT, () => console.log(`API BOQ en http://localhost:${PORT}`));
