// Tests de integración HTTP (C2, primera pasada). Arranca createApp(db) sobre
// una BD en memoria y un puerto efímero (listen 0), y hace peticiones reales con fetch.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createDb, type AppDb } from "./db/client.js";
import { createApp, seedIfEmpty } from "./server.js";

let server: Server;
let base: string;
let db: AppDb;

beforeEach(async () => {
  db = createDb(":memory:").db;
  seedIfEmpty(db); // siembra b1 (Torre A) con datos
  server = createApp(db);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://localhost:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("server — endpoints HTTP", () => {
  it("GET /api/boqs lista presupuestos", async () => {
    const r = await fetch(`${base}/api/boqs`);
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.boqs.some((b: { id: string }) => b.id === "b1")).toBe(true);
  });

  it("GET /api/boq/:id devuelve boq + items + calc", async () => {
    const r = await fetch(`${base}/api/boq/b1`);
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.boq.id).toBe("b1");
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.calc.total).toBeGreaterThan(0);
  });

  it("GET /api/boq/:id → 404 si no existe", async () => {
    const r = await fetch(`${base}/api/boq/noexiste`);
    expect(r.status).toBe(404);
  });

  it("PUT con JSON malformado → 400 (no 500)", async () => {
    const r = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{ esto no es json",
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/JSON/i);
  });

  it("ruta desconocida → 404", async () => {
    const r = await fetch(`${base}/api/desconocida`);
    expect(r.status).toBe(404);
  });

  it("ciclo snapshot F3: congelar → listar → comparar sin cambios (Δ 0)", async () => {
    const c = await fetch(`${base}/api/boq/b1/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Rev.0 aprobado" }),
    });
    expect(c.status).toBe(201);
    const { snapshot } = await c.json();
    expect(snapshot.label).toBe("Rev.0 aprobado");
    expect(snapshot.frozenTotal).toBeGreaterThan(0);

    const l = await fetch(`${base}/api/boq/b1/snapshots`);
    const { snapshots } = await l.json();
    expect(snapshots).toHaveLength(1);

    const cmp = await fetch(`${base}/api/boq/b1/compare-snapshot?snapshot=${snapshot.id}`);
    expect(cmp.status).toBe(200);
    const data = await cmp.json();
    expect(data.deltaTotal).toBe(0);
    expect(data.snapshotLabel).toBe("Rev.0 aprobado");
  });

  it("compare-snapshot → 404 si el snapshot no existe", async () => {
    const r = await fetch(`${base}/api/boq/b1/compare-snapshot?snapshot=noexiste`);
    expect(r.status).toBe(404);
  });

  it("PUT persiste builtArea y GET lo devuelve (F4)", async () => {
    const put = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], markups: [], builtArea: 850 }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${base}/api/boq/b1`);
    expect((await get.json()).boq.builtArea).toBe(850);
  });

  it("PUT con builtArea 0 o negativa la normaliza a null (F4)", async () => {
    await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], markups: [], builtArea: 0 }),
    });
    const get = await fetch(`${base}/api/boq/b1`);
    expect((await get.json()).boq.builtArea).toBeNull();
  });

  it("PUT con builtArea no numérica responde 400 (F4)", async () => {
    const put = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], markups: [], builtArea: "850" }),
    });
    expect(put.status).toBe(400);
  });

  it("PUT inválido (400) no deja un guardado parcial", async () => {
    const before = await (await fetch(`${base}/api/boq/b1`)).json();
    const put = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], markups: [], builtArea: "850" }),
    });
    expect(put.status).toBe(400);
    // Los items NO deben haberse borrado: la validación va antes de escribir.
    const after = await (await fetch(`${base}/api/boq/b1`)).json();
    expect(after.items).toHaveLength(before.items.length);
  });

  it("PUT con items no-array responde 400", async () => {
    const put = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: "hola" }),
    });
    expect(put.status).toBe(400);
  });

  it("PUT fuerza el boqId de la URL: un boqId ajeno no contamina otro presupuesto", async () => {
    // Crear un segundo presupuesto b2.
    const c = await fetch(`${base}/api/boqs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: "P2", boqName: "B2", currency: "DOP" }),
    });
    const { id: b2 } = await c.json();
    const b2Before = await (await fetch(`${base}/api/boq/${b2}`)).json();

    // Guardar en b1 un ítem que dice pertenecer a b2.
    const put = await fetch(`${base}/api/boq/b1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: "intruso", boqId: b2, parentId: null, sortOrder: 1, description: "Intruso", nodeType: "line", lineType: "unit_price", quantity: 1, unit: "un", unitRate: 100 }],
        markups: [],
      }),
    });
    expect(put.status).toBe(200);

    const b1After = await (await fetch(`${base}/api/boq/b1`)).json();
    const b2After = await (await fetch(`${base}/api/boq/${b2}`)).json();
    expect(b1After.items.map((i: { id: string }) => i.id)).toContain("intruso");
    expect(b2After.items).toHaveLength(b2Before.items.length); // b2 intacto
  });

  it("POST /api/boq/:id/import con bytes que no son .xlsx responde 400", async () => {
    const r = await fetch(`${base}/api/boq/b1/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("esto no es un xlsx"),
    });
    expect(r.status).toBe(400);
  });

  it("ciclo catálogo F9: crear → buscar → volcar desde BOQ → borrar", async () => {
    // Crear a mano.
    const c = await fetch(`${base}/api/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "HA-01", description: "Hormigón armado f'c=210", unit: "m³", unitRate: 9500 }),
    });
    expect(c.status).toBe(201);

    // Volcar las líneas del BOQ sembrado (3 líneas nuevas).
    const up = await fetch(`${base}/api/catalog/from-boq/b1`, { method: "POST" });
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ added: 3, updated: 0 });

    // Re-volcar: ahora todas existen → updated.
    const up2 = await fetch(`${base}/api/catalog/from-boq/b1`, { method: "POST" });
    expect(await up2.json()).toEqual({ added: 0, updated: 3 });

    // Buscar por texto.
    const q = await fetch(`${base}/api/catalog?q=excav`);
    const { items } = await q.json();
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe("01.01");
    expect(items[0].unitRate).toBe(350);

    // Borrar.
    const del = await fetch(`${base}/api/catalog/${items[0].id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const all = await (await fetch(`${base}/api/catalog`)).json();
    expect(all.items).toHaveLength(3); // 4 − 1
  });

  it("POST /api/catalog sin descripción responde 400", async () => {
    const r = await fetch(`${base}/api/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitRate: 100 }),
    });
    expect(r.status).toBe(400);
  });

  it("ciclo QTO F10: PUT hoja → GET la restaura por (boq, documento)", async () => {
    const sheet = {
      doc: "plano-A1.pdf",
      measurements: [
        { id: "m1", kind: "area", page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], quantity: 24.5, unit: "m²", label: "Losa", color: "#2563eb", sent: true, itemId: "l1" },
      ],
      scales: { "1": { unitsPerPdf: 0.05, realUnit: "m" } },
    };
    const put = await fetch(`${base}/api/boq/b1/qto`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sheet),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${base}/api/boq/b1/qto?doc=${encodeURIComponent("plano-A1.pdf")}`);
    expect(get.status).toBe(200);
    const d = await get.json();
    expect(d.measurements).toHaveLength(1);
    expect(d.measurements[0].itemId).toBe("l1"); // trazabilidad medición → partida
    expect(d.scales["1"].unitsPerPdf).toBe(0.05);

    // Otro documento del mismo BOQ empieza vacío.
    const other = await (await fetch(`${base}/api/boq/b1/qto?doc=otro.pdf`)).json();
    expect(other.measurements).toHaveLength(0);
  });

  it("PUT /api/boq/:id/qto sin doc o con measurements no-array responde 400", async () => {
    const sinDoc = await fetch(`${base}/api/boq/b1/qto`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measurements: [] }),
    });
    expect(sinDoc.status).toBe(400);
    const malForma = await fetch(`${base}/api/boq/b1/qto`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: "x.pdf", measurements: "hola" }),
    });
    expect(malForma.status).toBe(400);
  });

  it("POST snapshot con label no-string responde 400 (no 500)", async () => {
    const r = await fetch(`${base}/api/boq/b1/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: 5 }),
    });
    expect(r.status).toBe(400);
  });
});
