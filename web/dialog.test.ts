// Tests del diálogo modal (#2) — reemplaza alert/confirm/prompt nativos.
// jsdom no implementa <dialog>.showModal()/close(); se polirellenan al mínimo.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  (HTMLDialogElement.prototype as unknown as { showModal(): void }).showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  (HTMLDialogElement.prototype as unknown as { close(): void }).close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => document.querySelectorAll("dialog").forEach((d) => d.remove()));

const dlg = () => document.querySelector<HTMLDialogElement>("dialog.modal")!;
const btn = (text: string) => [...dlg().querySelectorAll("button")].find((b) => b.textContent === text)!;
const submit = () => dlg().querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

describe("diálogo modal", () => {
  it("showConfirm: confirmar resuelve true", async () => {
    const { showConfirm } = await import("./main.js");
    const p = showConfirm("¿Seguro?");
    expect(dlg().open).toBe(true);
    submit();
    expect(await p).toBe(true);
  });

  it("showConfirm: cancelar resuelve false y cierra", async () => {
    const { showConfirm } = await import("./main.js");
    const p = showConfirm("¿Seguro?");
    btn("Cancelar").click();
    expect(await p).toBe(false);
    expect(dlg().open).toBe(false);
  });

  it("showPrompt: devuelve el valor editado", async () => {
    const { showPrompt } = await import("./main.js");
    const p = showPrompt("Etiqueta", "Rev.0");
    const inp = dlg().querySelector("input")!;
    expect(inp.value).toBe("Rev.0");
    inp.value = "Rev.1";
    submit();
    expect(await p).toBe("Rev.1");
  });

  it("Esc (evento cancel) descarta el prompt → null", async () => {
    const { showPrompt } = await import("./main.js");
    const p = showPrompt("Etiqueta", "Rev.0");
    dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await p).toBeNull();
  });

  it("showAlert: sin botón Cancelar; OK resuelve", async () => {
    const { showAlert } = await import("./main.js");
    const p = showAlert("Listo");
    expect([...dlg().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["OK"]);
    submit();
    await expect(p).resolves.toBeUndefined();
  });

  it("showDialog: varios campos devuelve todos los valores", async () => {
    const { showDialog } = await import("./main.js");
    const p = showDialog({
      title: "Nuevo presupuesto",
      fields: [
        { name: "projectName", label: "Proyecto", value: "P" },
        { name: "boqName", label: "Presupuesto", value: "B" },
        { name: "currency", label: "Moneda", value: "DOP" },
      ],
      confirmLabel: "Crear",
    });
    expect(dlg().querySelectorAll("input").length).toBe(3);
    submit();
    expect(await p).toEqual({ projectName: "P", boqName: "B", currency: "DOP" });
  });
});
