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
});
