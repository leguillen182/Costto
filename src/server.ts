// Backend HTTP ligero (módulo http nativo) para el editor de BOQ.
// Expone el repositorio sobre REST. DB persistente en data.db.
import { createServer } from "node:http";
import { createDb, type AppDb } from "./db/client.js";
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
  updateBoqBuiltArea,
  listBoqs,
  createBudget,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  listCatalog,
  saveCatalogItem,
  deleteCatalogItem,
  upsertCatalogFromItems,
  getQtoSheet,
  saveQtoSheet,
} from "./repo.js";
import { randomUUID } from "node:crypto";
import { buildWorkbook } from "./export.js";
import { parseWorkbook } from "./import.js";
import { compareBoqs } from "./compare.js";
import { buildSnapshot, snapshotToCompareInputs, toSummary } from "./snapshot.js";
import { backupDb } from "./backup.js";
import { writeBoqCsv } from "./exportCsv.js";
import type { BoqItem, MarkupRule } from "./types.js";

// Error con código HTTP para distinguir 4xx (cliente) de 5xx (interno) en el catch global.
class HttpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

// Parseo seguro del cuerpo JSON: body malformado → 400 (no 500 con stack filtrado).
function parseBody<T>(raw: string): T {
  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    throw new HttpError(400, "Cuerpo JSON inválido");
  }
}

export function seedIfEmpty(db: AppDb) {
  if (getBoq(db, "b1")) return;
  createProject(db, { id: "p1", name: "Torre A", baseCurrency: "DOP" });
  createBoq(db, { id: "b1", projectId: "p1", name: "Presupuesto base — Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2, builtArea: 1200 });
  insertItems(db, [
    { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
    { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
    { id: "l2", boqId: "b1", parentId: "c1", sortOrder: 2, code: "01.02", description: "Relleno compactado", nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m³", unitRate: 250 },
    { id: "c2", boqId: "b1", parentId: null, sortOrder: 2, code: "02", description: "Estudios y diseño", nodeType: "group" },
    { id: "l3", boqId: "b1", parentId: "c2", sortOrder: 1, code: "02.01", description: "Diseño estructural", nodeType: "line", lineType: "lump_sum", quantity: 1, unit: "global", unitRate: 75000 },
  ]);
  insertMarkups(db, [{ id: "m_itbis", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 1 }]);
}

// Límite de cuerpo: un BOQ o .xlsx real cabe de sobra; evita bufferizar bodies arbitrarios.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function readBodyBuffer(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new HttpError(413, "Cuerpo demasiado grande"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Decodifica el buffer completo de una vez: concatenar chunk.toString() por separado
// rompería un carácter multi-byte (ó, ñ…) partido entre dos chunks.
async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return (await readBodyBuffer(req)).toString("utf8");
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// `onMutate` se invoca tras cada operación que persiste cambios (guardar/importar/congelar);
// el arranque lo usa para respaldar el data.db. En tests se omite (no-op).
export function createApp(db: AppDb, onMutate: () => void = () => {}) {
  // Sidecar CSV (compatible con MS Project) tras cada guardado/importación.
  // Un fallo de escritura nunca debe romper la respuesta del guardado.
  const writeCsvSidecar = (id: string) => {
    try { writeBoqCsv(db, id, "exports"); }
    catch (e) { console.error("CSV sidecar falló:", e); }
  };
  return createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Listar presupuestos: GET /api/boqs
    if (url.pathname === "/api/boqs" && req.method === "GET") {
      return json(res, 200, { boqs: listBoqs(db) });
    }
    // Crear presupuesto (proyecto + BOQ): POST /api/boqs
    if (url.pathname === "/api/boqs" && req.method === "POST") {
      const body = parseBody<{ projectName?: string; boqName?: string; currency?: string }>(await readBody(req));
      const id = createBudget(db, {
        projectId: randomUUID(),
        boqId: randomUUID(),
        projectName: body.projectName?.trim() || "Proyecto sin nombre",
        boqName: body.boqName?.trim() || "Presupuesto base",
        currency: body.currency?.trim() || "DOP",
      });
      onMutate(); // crear un presupuesto también es una mutación: respaldar (F7)
      return json(res, 201, { id });
    }

    // ---- Catálogo de precios unitarios (F9) ----
    // Listar/buscar: GET /api/catalog?q=texto
    if (url.pathname === "/api/catalog" && req.method === "GET") {
      return json(res, 200, { items: listCatalog(db, url.searchParams.get("q") ?? undefined) });
    }
    // Crear partida maestra: POST /api/catalog
    if (url.pathname === "/api/catalog" && req.method === "POST") {
      const body = parseBody<Partial<import("./types.js").CatalogItem>>(await readBody(req));
      if (typeof body.description !== "string" || !body.description.trim()) {
        return json(res, 400, { error: "description es obligatoria" });
      }
      for (const k of ["unitRate", "rateLabor", "rateMaterial", "rateEquipment", "rateSubcontract", "rateOther"] as const) {
        if (body[k] != null && typeof body[k] !== "number") return json(res, 400, { error: `${k} debe ser un número` });
      }
      const item = {
        id: randomUUID(),
        code: typeof body.code === "string" ? body.code : undefined,
        description: body.description.trim(),
        unit: typeof body.unit === "string" ? body.unit : undefined,
        unitRate: body.unitRate ?? null,
        rateLabor: body.rateLabor ?? null,
        rateMaterial: body.rateMaterial ?? null,
        rateEquipment: body.rateEquipment ?? null,
        rateSubcontract: body.rateSubcontract ?? null,
        rateOther: body.rateOther ?? null,
        currency: typeof body.currency === "string" ? body.currency : undefined,
        updatedAt: new Date().toISOString(),
      };
      saveCatalogItem(db, item);
      onMutate();
      return json(res, 201, { item });
    }
    // Borrar partida maestra: DELETE /api/catalog/:id
    const cat = url.pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (cat && req.method === "DELETE") {
      deleteCatalogItem(db, cat[1]!);
      onMutate();
      return json(res, 200, { ok: true });
    }
    // Volcar las líneas de un BOQ al catálogo (upsert por código/descripción):
    // POST /api/catalog/from-boq/:boqId
    const catFrom = url.pathname.match(/^\/api\/catalog\/from-boq\/([^/]+)$/);
    if (catFrom && req.method === "POST") {
      const id = catFrom[1]!;
      const boq = getBoq(db, id);
      if (!boq) return json(res, 404, { error: "BOQ no encontrado" });
      const result = upsertCatalogFromItems(db, getItems(db, id), boq.currency, new Date().toISOString());
      onMutate();
      return json(res, 200, result);
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
      let parsed: Awaited<ReturnType<typeof parseWorkbook>>;
      try {
        parsed = await parseWorkbook(buf, id);
      } catch {
        throw new HttpError(400, "Archivo .xlsx inválido o corrupto");
      }
      const { items, rowsRead, flat } = parsed;
      const markups = getMarkups(db, id); // preservar markups existentes
      saveBoqContents(db, id, items, markups);
      onMutate();
      writeCsvSidecar(id);
      return json(res, 200, { ok: true, rowsRead, flat, calc: calcBoq(db, id) });
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
      const body = parseBody<{ label?: string; note?: string }>(await readBody(req));
      if (body.label != null && typeof body.label !== "string") {
        return json(res, 400, { error: "label debe ser un string" });
      }
      if (body.note != null && typeof body.note !== "string") {
        return json(res, 400, { error: "note debe ser un string" });
      }
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
      onMutate();
      return json(res, 201, { snapshot: toSummary(snap) });
    }

    // ---- Hojas QTO persistidas (F10): mediciones + escalas por (BOQ, documento) ----
    const qto = url.pathname.match(/^\/api\/boq\/([^/]+)\/qto$/);
    // GET /api/boq/:id/qto?doc=NOMBRE → estado guardado (o vacío si nunca se midió ese plano)
    if (qto && req.method === "GET") {
      const id = qto[1]!;
      if (!getBoq(db, id)) return json(res, 404, { error: "BOQ no encontrado" });
      const doc = url.searchParams.get("doc") ?? "";
      if (!doc) return json(res, 400, { error: "falta el parámetro doc" });
      const sheet = getQtoSheet(db, id, doc);
      return json(res, 200, sheet ?? { measurements: [], scales: {} });
    }
    // PUT /api/boq/:id/qto  body { doc, measurements, scales } → reemplaza la hoja del documento
    if (qto && req.method === "PUT") {
      const id = qto[1]!;
      if (!getBoq(db, id)) return json(res, 404, { error: "BOQ no encontrado" });
      const body = parseBody<{ doc?: string; measurements?: unknown[]; scales?: Record<string, unknown> }>(await readBody(req));
      if (typeof body.doc !== "string" || !body.doc.trim()) {
        return json(res, 400, { error: "doc (nombre del documento) es obligatorio" });
      }
      if (body.measurements != null && !Array.isArray(body.measurements)) {
        return json(res, 400, { error: "measurements debe ser un array" });
      }
      if (body.scales != null && (typeof body.scales !== "object" || Array.isArray(body.scales))) {
        return json(res, 400, { error: "scales debe ser un objeto" });
      }
      saveQtoSheet(db, id, body.doc, { measurements: body.measurements ?? [], scales: body.scales ?? {} }, new Date().toISOString());
      onMutate();
      return json(res, 200, { ok: true });
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
      const body = parseBody<{
        items?: BoqItem[];
        markups?: MarkupRule[];
        detailLevel?: "simple" | "detailed";
        builtArea?: number | null;
      }>(await readBody(req));
      // Toda la validación ANTES de escribir: un 400 nunca debe dejar un guardado parcial.
      if (body.items != null && !Array.isArray(body.items)) {
        return json(res, 400, { error: "items debe ser un array" });
      }
      if (body.markups != null && !Array.isArray(body.markups)) {
        return json(res, 400, { error: "markups debe ser un array" });
      }
      if ("builtArea" in body && body.builtArea !== null && typeof body.builtArea !== "number") {
        return json(res, 400, { error: "builtArea debe ser un número o null" });
      }
      // El contenido pertenece SIEMPRE al BOQ de la URL: se fuerza boqId para que un
      // cuerpo con boqId ajeno no inserte filas huérfanas en otro presupuesto.
      const items = (body.items ?? []).map((it) => ({ ...it, boqId: id }));
      const rules = (body.markups ?? []).map((r) => ({ ...r, boqId: id }));
      saveBoqContents(db, id, items, rules);
      if (body.detailLevel === "simple" || body.detailLevel === "detailed") {
        updateBoqDetailLevel(db, id, body.detailLevel);
      }
      if ("builtArea" in body) {
        const a = body.builtArea;
        // ≤ 0 / NaN → "sin área" (null): normalización consciente de F4.
        updateBoqBuiltArea(db, id, typeof a === "number" && a > 0 ? a : null);
      }
      onMutate();
      writeCsvSidecar(id);
      return json(res, 200, { ok: true, calc: calcBoq(db, id) });
    }

    json(res, 404, { error: "ruta no encontrada" });
  } catch (err) {
    // Si ya se enviaron headers (p. ej. export a Excel fallido a mitad de stream),
    // json() lanzaría ERR_HTTP_HEADERS_SENT dentro del catch → rechazo sin manejar.
    if (res.headersSent) {
      console.error("Error tras enviar headers:", err);
      return res.destroy();
    }
    if (err instanceof HttpError) return json(res, err.code, { error: err.message });
    console.error("Error no controlado:", err); // log completo del lado servidor
    json(res, 500, { error: "Error interno del servidor" }); // mensaje genérico, sin filtrar internos
  }
  });
}

const PORT = 8787;
// Arranca solo al ejecutar directamente (tsx src/server.ts); no al importar en tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, sqlite } = createDb("data.db");
  // Datos demo solo cuando se pide explícitamente (BOQ_SEED=1) — nunca por accidente en producción.
  if (process.env.BOQ_SEED === "1") seedIfEmpty(db);
  // Respaldo automático del data.db tras cada guardado (F7): conserva los 3 más recientes en backups/.
  // Encadenado en serie: dos guardados seguidos no deben rotar/borrar un respaldo aún en escritura.
  let backupChain: Promise<unknown> = Promise.resolve();
  const onMutate = () => {
    backupChain = backupChain.then(() => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return backupDb(sqlite, "backups", stamp, 3);
    }).catch((e) => console.error("Respaldo falló:", e));
  };
  createApp(db, onMutate).listen(PORT, () => console.log(`API BOQ en http://localhost:${PORT}`));
}
