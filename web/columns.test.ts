// Tests de la preferencia mostrar/ocultar columnas (capa DOM, jsdom).
// Reusan el patrón de main.test.ts: montan #app, mockean fetch y arrancan start().
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const boq = { id: "b1", projectId: "p1", name: "Torre A", kind: "owner_budget", currency: "DOP", roundingDecimals: 2, detailLevel: "simple" };
const items = [
  { id: "c1", boqId: "b1", parentId: null, sortOrder: 1, code: "01", description: "Movimiento de tierra", nodeType: "group" },
  { id: "l1", boqId: "b1", parentId: "c1", sortOrder: 1, code: "01.01", description: "Excavación", nodeType: "line", lineType: "unit_price", quantity: 100, unit: "m³", unitRate: 350 },
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

async function boot() {
  const m = await import("./main.js");
  await m.start();
  return m;
}

// La primera <table> del DOM es la tabla del BOQ (la de markups viene después).
const mainTable = () => document.querySelector("table")!;
const headers = () => [...mainTable().querySelectorAll("thead th")].map((th) => th.textContent?.trim());
const colCheckbox = (label: string) =>
  [...document.querySelectorAll<HTMLLabelElement>(".colpicker-item")]
    .find((l) => l.textContent?.trim() === label)!
    .querySelector<HTMLInputElement>("input")!;
const toggle = (label: string, on: boolean) => {
  const cb = colCheckbox(label);
  cb.checked = on;
  cb.dispatchEvent(new Event("change"));
};

describe("columnas — mostrar/ocultar", () => {
  it("por defecto muestra las 7 columnas", async () => {
    await boot();
    expect(headers()).toEqual(["Código", "Descripción", "Unidad", "Cantidad", "P. Unitario", "Importe", ""]);
  });

  it("ocultar Cantidad elimina su encabezado y sus celdas", async () => {
    await boot();
    toggle("Cantidad", false);
    expect(headers()).not.toContain("Cantidad");
    expect(mainTable().querySelectorAll("tbody [data-col=quantity]").length).toBe(0);
    // El resto de columnas sigue presente.
    expect(mainTable().querySelector("tbody [data-col=code]")).toBeTruthy();
  });

  it("el spacer del grupo encoge con las columnas medias ocultas", async () => {
    await boot();
    const groupSpacer = () =>
      mainTable().querySelector<HTMLTableCellElement>('tbody tr.group td[colspan]');
    expect(groupSpacer()?.colSpan).toBe(3); // unit + quantity + unitRate
    toggle("Unidad", false);
    toggle("Cantidad", false);
    expect(groupSpacer()?.colSpan).toBe(1); // solo unitRate
    toggle("P. Unitario", false);
    expect(groupSpacer()).toBeNull(); // sin columnas medias → sin spacer
  });

  it("la preferencia persiste en localStorage", async () => {
    await boot();
    toggle("Importe", false);
    expect(JSON.parse(localStorage.getItem("colVisible")!).amount).toBe(false);
  });

  it("ocultar Importe no rompe el recálculo en vivo", async () => {
    await boot();
    toggle("Importe", false);
    expect(mainTable().querySelectorAll("tbody td.amount").length).toBe(0);
    const q = document.querySelector<HTMLInputElement>('[data-id="l1"][data-col="quantity"]')!;
    q.value = "200";
    expect(() => q.dispatchEvent(new Event("input"))).not.toThrow();
    // El subtotal global se sigue actualizando aunque la columna Importe esté oculta.
    expect(document.querySelector("#t-sub")?.textContent).toContain("70,000"); // 200 × 350
  });
});
