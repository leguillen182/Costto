// Tests de integración del editor (capa DOM, jsdom). Montan un #app, mockean fetch
// con un BOQ sembrado, arrancan la app real (start()) y ejercitan render/edición/atajos.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Fixture = el seed del server (Torre A).
const boq = { id: "b1", projectId: "p1", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2, detailLevel: "simple" };
const items = [
  { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
  { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
  { id: "l2", boqId: "b1", parentId: "c1", sortOrder: 2, code: "01.02", description: "Relleno", nodeType: "line", lineType: "unit_price", quantity: 40, unit: "m³", unitRate: 250 },
  { id: "c2", boqId: "b1", parentId: null, sortOrder: 2, code: "02", description: "Estudios", nodeType: "group" },
  { id: "l3", boqId: "b1", parentId: "c2", sortOrder: 1, code: "02.01", description: "Diseño estructural", nodeType: "line", lineType: "lump_sum", quantity: 1, unit: "global", unitRate: 75000 },
];
const markups = [{ id: "m", boqId: "b1", name: "ITBIS", type: "percentage", value: 18, basis: "running", sortOrder: 1 }];

function mockFetch(input: RequestInfo | URL, opts?: RequestInit) {
  const path = new URL(String(input), "http://localhost").pathname;
  const method = opts?.method ?? "GET";
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  if (path === "/api/boqs") return ok({ boqs: [{ id: "b1", name: "Presupuesto base", kind: boq.kind, currency: boq.currency, projectId: "p1", projectName: "Torre A" }] });
  if (path === "/api/boq/b1/snapshots") return ok({ snapshots: [] });
  if (path === "/api/boq/b1" && method === "PUT") return ok({ ok: true, calc: {} });
  if (path === "/api/boq/b1") return ok({ boq, items, markups });
  return ok({});
}

let uidN = 0;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  localStorage.setItem("boqId", "b1");
  uidN = 0;
  vi.stubGlobal("fetch", vi.fn(mockFetch));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("prompt", vi.fn(() => "x"));
  vi.stubGlobal("crypto", { randomUUID: () => `test-uid-${uidN++}` });
});
afterEach(() => vi.unstubAllGlobals());

// Arranca la app real (no auto-arranca bajo MODE==="test") y espera al render.
async function boot() {
  const m = await import("./main.js");
  await m.start();
  return m;
}

const rowIds = () => [...document.querySelectorAll<HTMLElement>("tbody tr[data-id]")].map((tr) => tr.dataset.id);
const cell = (id: string, col: string) => document.querySelector<HTMLInputElement>(`[data-id="${id}"][data-col="${col}"]`)!;
const clickBtn = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)?.click();

describe("editor — render", () => {
  it("renderiza la tabla del BOQ sembrado", async () => {
    await boot();
    const codes = [...document.querySelectorAll<HTMLInputElement>("tbody [data-col=code]")].map((i) => i.value);
    expect(codes).toEqual(["01", "01.01", "01.02", "02", "02.01"]);
  });

  it("muestra la barra de herramientas con Comparar y Versiones", async () => {
    await boot();
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).toContain("⇄ Comparar");
    expect(labels).toContain("🔖 Versiones");
  });

  it("calcula el subtotal inicial (120,000)", async () => {
    await boot();
    expect(document.querySelector("#t-sub")?.textContent).toContain("120,000");
  });
});

describe("editor — edición", () => {
  it("editar una cantidad recalcula el subtotal en vivo", async () => {
    await boot();
    const q = cell("l3", "quantity"); // Diseño: 1 × 75000 = 75000
    q.value = "2"; // → 150000 ; subtotal 120000 → 195000
    q.dispatchEvent(new Event("input"));
    expect(document.querySelector("#t-sub")?.textContent).toContain("195,000");
  });
});

describe("editor — atajos de teclado", () => {
  it("Enter agrega una partida hermana", async () => {
    await boot();
    const before = rowIds().length;
    cell("l1", "description").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(rowIds().length).toBe(before + 1);
  });

  it("Alt+→ indenta: la línea anterior se vuelve grupo", async () => {
    await boot();
    // indentar 01.02 (l2) bajo 01.01 (l1) → l1 deja de tener celda de cantidad (es grupo)
    cell("l2", "description").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    const l1Row = [...document.querySelectorAll<HTMLElement>("tbody tr[data-id]")].find((tr) => tr.dataset.id === "l1")!;
    expect(l1Row.querySelector("[data-col=quantity]")).toBeNull(); // ya es grupo
    expect(cell("l2", "code")).toBeTruthy(); // l2 sigue presente (reparentada)
  });
});

describe("editor — vista Versiones (F3)", () => {
  it("abrir Versiones renderiza el panel de congelar", async () => {
    await boot();
    clickBtn("🔖 Versiones");
    await Promise.resolve(); // dejar resolver el fetch de snapshots
    await Promise.resolve();
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).toContain("📌 Congelar versión actual");
  });
});
