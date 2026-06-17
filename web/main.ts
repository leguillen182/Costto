// Editor de BOQ — keyboard-first (Tarea 1.3 + persistencia).
// Reusa el motor de cálculo puro (../src/calc). Carga/guarda vía API (/api) → SQLite.
import { recalculate, componentSum, costPerArea } from "../src/calc";
import { validate } from "../src/validate";
import * as tree from "../src/tree";
import { openQtoView, type QtoContext } from "./qto.js";
import type { Boq, BoqItem, MarkupRule } from "../src/types";

const uid = () => crypto.randomUUID();

interface BoqSummary { id: string; name: string; kind: string; currency: string; projectId: string; projectName: string; }
let currentBoqId = localStorage.getItem("boqId") ?? "";
let boqList: BoqSummary[] = [];

let boq: Boq = { id: "", projectId: "", name: "Cargando…", kind: "", currency: "DOP", roundingDecimals: 2, detailLevel: "simple" };
let items: BoqItem[] = [];
let markups: MarkupRule[] = [];
let dirty = false;
let selectedId: string | null = null;
const expanded = new Set<string>(); // partidas con el desglose abierto (solo UI)

// Componentes de tarifa (L1). Fijos: 5 categorías.
const RATE_PARTS = [
  { key: "rateLabor", label: "Mano de obra" },
  { key: "rateMaterial", label: "Material" },
  { key: "rateEquipment", label: "Equipo" },
  { key: "rateSubcontract", label: "Subcontrato" },
  { key: "rateOther", label: "Otros" },
] as const;

// ---- moneda ----
let money = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const fmt = (n: number) => money.format(n ?? 0);

const EDITABLE = ["code", "description", "unit", "quantity", "unitRate"] as const;
type Col = (typeof EDITABLE)[number];
const NUMERIC: Col[] = ["quantity", "unitRate"];

// ---- API ----
async function load() {
  try {
    const r = await fetch(`/api/boq/${currentBoqId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    boq = data.boq;
    items = data.items;
    markups = data.markups;
    money = new Intl.NumberFormat("es-DO", { style: "currency", currency: boq.currency, maximumFractionDigits: boq.roundingDecimals });
    render();
    setStatus("saved");
  } catch (e) {
    document.getElementById("app")!.innerHTML = `<div style="padding:40px;color:var(--error)">No se pudo cargar el BOQ. ¿Está corriendo la API? (<code>npm run api</code>)<br><small>${e}</small></div>`;
  }
}

async function save() {
  setStatus("saving");
  try {
    const r = await fetch(`/api/boq/${currentBoqId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, markups, detailLevel: boq.detailLevel ?? "simple", builtArea: boq.builtArea ?? null }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus("saved");
  } catch (e) {
    setStatus("error");
  }
}

// ---- diálogo modal (reemplaza alert/confirm/prompt nativos) ----
// API estilo HIG: un <dialog> nativo (atrapa el foco, Esc cierra) reutilizado.
interface DialogField { name: string; label: string; value?: string; placeholder?: string; type?: string; }
interface DialogOptions {
  title: string;
  message?: string;
  fields?: DialogField[];
  confirmLabel?: string;
  cancelLabel?: string | null; // null => sin botón cancelar (modo alerta)
  danger?: boolean;
}

let dialogEl: HTMLDialogElement | null = null;

// Resuelve con los valores de los campos al confirmar, o null al cancelar/Esc/click fuera.
export function showDialog(opts: DialogOptions): Promise<Record<string, string> | null> {
  if (!dialogEl) {
    dialogEl = document.createElement("dialog");
    dialogEl.className = "modal";
    document.body.appendChild(dialogEl);
  }
  const dlg = dialogEl;
  return new Promise((resolve) => {
    const fields = opts.fields ?? [];
    const form = document.createElement("form");
    form.method = "dialog";

    const h = document.createElement("h2");
    h.className = "modal-title";
    h.textContent = opts.title;
    form.appendChild(h);

    if (opts.message) {
      const p = document.createElement("p");
      p.className = "modal-msg";
      p.textContent = opts.message;
      form.appendChild(p);
    }

    const inputs: Record<string, HTMLInputElement> = {};
    for (const f of fields) {
      const wrap = document.createElement("label");
      wrap.className = "modal-field";
      const span = document.createElement("span");
      span.textContent = f.label;
      const inp = document.createElement("input");
      inp.type = f.type ?? "text";
      inp.value = f.value ?? "";
      if (f.placeholder) inp.placeholder = f.placeholder;
      wrap.append(span, inp);
      form.appendChild(wrap);
      inputs[f.name] = inp;
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    if (opts.cancelLabel !== null) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = opts.cancelLabel ?? "Cancelar";
      cancelBtn.addEventListener("click", () => settle(null));
      actions.appendChild(cancelBtn);
    }
    const okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.className = "primary" + (opts.danger ? " danger" : "");
    okBtn.textContent = opts.confirmLabel ?? "Aceptar";
    actions.appendChild(okBtn);
    form.appendChild(actions);

    let settled = false;
    function settle(result: Record<string, string> | null) {
      if (settled) return;
      settled = true;
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("click", onBackdrop);
      dlg.close();
      resolve(result);
    }
    const onCancel = (e: Event) => { e.preventDefault(); settle(null); }; // Esc
    const onBackdrop = (e: MouseEvent) => { if (e.target === dlg) settle(null); };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const out: Record<string, string> = {};
      for (const f of fields) out[f.name] = inputs[f.name]!.value;
      settle(out);
    });
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("click", onBackdrop);

    dlg.replaceChildren(form);
    dlg.showModal();
    const first = fields.length ? inputs[fields[0]!.name]! : okBtn;
    first.focus();
    if (first instanceof HTMLInputElement) first.select();
  });
}

export const showAlert = (message: string, title = "Aviso"): Promise<void> =>
  showDialog({ title, message, confirmLabel: "OK", cancelLabel: null }).then(() => {});

export const showConfirm = (
  message: string,
  opts: { title?: string; confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> =>
  showDialog({ title: opts.title ?? "Confirmar", message, confirmLabel: opts.confirmLabel ?? "Continuar", danger: opts.danger })
    .then((r) => r !== null);

export const showPrompt = (label: string, def = "", title = label): Promise<string | null> =>
  showDialog({ title, fields: [{ name: "value", label, value: def }], confirmLabel: "Aceptar" })
    .then((r) => (r === null ? null : r.value ?? ""));

async function exportExcel() {
  await save(); // exporta el estado persistido
  window.location.href = `/api/boq/${currentBoqId}/export`;
}

function importExcel() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!(await showConfirm(`Importar "${file.name}" reemplazará las partidas actuales del presupuesto. ¿Continuar?`, { title: "Importar Excel", confirmLabel: "Importar" }))) return;
    setStatus("saving");
    try {
      const buf = await file.arrayBuffer();
      const r = await fetch(`/api/boq/${currentBoqId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buf,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      await load();
      await showAlert(
        d.flat
          ? `Importadas ${d.rowsRead} filas sin jerarquía: todas quedaron en raíz. Si tu Excel tenía capítulos, revisa que las partidas usen indentación en la columna Descripción.`
          : `Importadas ${d.rowsRead} filas.`,
        "Importación completa",
      );
    } catch (e) {
      setStatus("error");
      await showAlert(`Error al importar: ${e}`, "Error al importar");
    }
  });
  input.click();
}

// ---- multi-proyecto (F1) ----
async function loadList() {
  const r = await fetch("/api/boqs");
  const d = await r.json();
  boqList = d.boqs ?? [];
  if (!currentBoqId || !boqList.some((b) => b.id === currentBoqId)) {
    currentBoqId = boqList[0]?.id ?? "";
  }
}
async function switchBoq(id: string) {
  if (id === currentBoqId) return;
  if (dirty && !(await showConfirm("Hay cambios sin guardar. ¿Cambiar de presupuesto y descartarlos?", { title: "Cambios sin guardar", confirmLabel: "Descartar y cambiar", danger: true }))) return;
  currentBoqId = id;
  localStorage.setItem("boqId", id);
  await load();
}
async function newBudget() {
  const r0 = await showDialog({
    title: "Nuevo presupuesto",
    fields: [
      { name: "projectName", label: "Nombre del proyecto", value: "Nuevo proyecto" },
      { name: "boqName", label: "Nombre del presupuesto", value: "Presupuesto base" },
      { name: "currency", label: "Moneda (DOP / USD)", value: "DOP" },
    ],
    confirmLabel: "Crear",
  });
  if (r0 == null) return;
  const projectName = r0.projectName!.trim() || "Nuevo proyecto";
  const boqName = r0.boqName!.trim() || "Presupuesto base";
  const currency = (r0.currency!.trim() || "DOP").toUpperCase();
  const r = await fetch("/api/boqs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName, boqName, currency }),
  });
  const d = await r.json();
  await loadList();
  currentBoqId = d.id;
  localStorage.setItem("boqId", d.id);
  await load();
}
async function init() {
  await loadList();
  if (!currentBoqId) {
    document.getElementById("app")!.innerHTML = `<div style="padding:40px">No hay presupuestos. <button id="nb">+ Nuevo presupuesto</button></div>`;
    document.getElementById("nb")!.addEventListener("click", newBudget);
    return;
  }
  await load();
}

// ---- comparación de presupuestos (B2) ----
interface CompareRow { key: string; code?: string; description: string; side: "both" | "onlyA" | "onlyB"; amountA: number | null; amountB: number | null; deltaAmount: number | null; deltaPct: number | null; }
interface CompareData { rows: CompareRow[]; totalA: number; totalB: number; deltaTotal: number; currencyA: string; currencyB: string; sameCurrency: boolean; counts: { matched: number; onlyA: number; onlyB: number }; }
let compareMode = false;
let compareWithId = "";
let compareData: CompareData | null = null;

async function openCompare() {
  const others = boqList.filter((b) => b.id !== currentBoqId);
  if (others.length === 0) { await showAlert("Necesitas al menos 2 presupuestos para comparar. Crea otro con '+ Nuevo'.", "Comparar"); return; }
  compareWithId = others.some((b) => b.id === compareWithId) ? compareWithId : others[0]!.id;
  compareMode = true;
  await loadCompare();
}
async function loadCompare() {
  const r = await fetch(`/api/compare?a=${currentBoqId}&b=${compareWithId}`);
  compareData = r.ok ? await r.json() : null;
  render();
}
function closeCompare() { compareMode = false; render(); }

// ---- versiones / snapshots (F3) ----
interface SnapshotSummary { id: string; boqId: string; label: string; note?: string; createdAt: string; frozenTotal: number; currency: string; }
type SnapshotCompareData = CompareData & { snapshotLabel: string; snapshotCreatedAt: string };
let snapshotMode = false;
let snapshots: SnapshotSummary[] = [];
let snapshotCompareId = ""; // "" = vista de lista; con id = comparación contra ese snapshot
let snapshotCompareData: SnapshotCompareData | null = null;

async function openVersiones() {
  snapshotMode = true;
  snapshotCompareId = "";
  await loadSnapshots();
}
async function loadSnapshots() {
  const r = await fetch(`/api/boq/${currentBoqId}/snapshots`);
  snapshots = r.ok ? (await r.json()).snapshots : [];
  render();
}
async function freezeSnapshot() {
  const label = await showPrompt("Etiqueta de la versión", "Rev.0 aprobado", "Congelar versión");
  if (label == null) return;
  if (dirty && !(await showConfirm("Hay cambios sin guardar. Se congelará el estado YA GUARDADO en la base, no los cambios pendientes. ¿Continuar?", { title: "Cambios sin guardar", confirmLabel: "Congelar lo guardado" }))) return;
  const r = await fetch(`/api/boq/${currentBoqId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!r.ok) { await showAlert("No se pudo congelar la versión.", "Error"); return; }
  await loadSnapshots();
}
async function compareWithSnapshot(id: string) {
  const r = await fetch(`/api/boq/${currentBoqId}/compare-snapshot?snapshot=${id}`);
  snapshotCompareData = r.ok ? await r.json() : null;
  snapshotCompareId = id;
  render();
}
function backToSnapshotList() { snapshotCompareId = ""; render(); }
function closeVersiones() { snapshotMode = false; render(); }

// ---- QTO sobre planos PDF (medición → partidas) ----
// La vista vive en web/qto.ts; aquí solo construimos el puente al estado del editor.
function buildQtoContext(): QtoContext {
  return {
    getSelectedId: () => selectedId,
    getGroups: () =>
      tree.ordered(items)
        .map((o) => o.item)
        .filter((it) => it.nodeType === "group")
        .map((g) => ({ id: g.id, label: `${g.code?.trim() ? g.code.trim() + " · " : ""}${g.description?.trim() || "(sin nombre)"}` })),
    addLineUnder: (parentId, fields) => {
      const id = uid();
      items = tree.addLine(items, boq.id, parentId, id);
      const it = items.find((i) => i.id === id);
      if (it) Object.assign(it, fields);
      return id;
    },
    updateLine: (id, patch) => {
      const it = items.find((i) => i.id === id);
      if (it) Object.assign(it, patch);
    },
    isLine: (id) => items.find((i) => i.id === id)?.nodeType === "line",
    markDirty: () => markDirty(),
    backToEditor: () => render(),
    showAlert: (msg, title) => showAlert(msg, title),
    showConfirm: (msg, opts) => showConfirm(msg, opts),
  };
}
function openQto() { openQtoView(buildQtoContext()); }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
}

// ---- estado guardado ----
let statusEl: HTMLElement | null = null;
function setStatus(s: "saved" | "dirty" | "saving" | "error") {
  dirty = s === "dirty";
  if (!statusEl) return;
  const labels = { saved: "Guardado ✓", dirty: "Sin guardar", saving: "Guardando…", error: "Error al guardar" } as const;
  statusEl.textContent = labels[s];
  statusEl.dataset.status = s;
}
function markDirty() { setStatus("dirty"); }

// ---- modelo / árbol ----
// La lógica de árbol (pura) vive en src/tree.ts; aquí solo se envuelve para
// reasignar `items`, marcar dirty, re-renderizar y reposicionar el foco.
function ordered(): { item: BoqItem; depth: number }[] {
  return tree.ordered(items);
}

function addGroup(parentId: string | null) {
  const id = uid();
  items = tree.addGroup(items, boq.id, parentId, id);
  markDirty();
  render();
  focusCell(id, "code");
}

function addLine(parentId: string | null, afterSort?: number) {
  const id = uid();
  items = tree.addLine(items, boq.id, parentId, id, afterSort);
  markDirty();
  render();
  focusCell(id, "description");
}

// Indenta: el ítem pasa a ser hijo de su hermano anterior (que se vuelve grupo si era línea).
function indent(it: BoqItem, col: Col) {
  const next = tree.indent(items, it.id);
  if (next === items) return; // sin hermano anterior → no-op
  items = next;
  markDirty();
  render();
  focusCell(it.id, col);
}

// Desindenta: el ítem sube un nivel, quedando justo después de su antiguo padre.
function outdent(it: BoqItem, col: Col) {
  const next = tree.outdent(items, it.id);
  if (next === items) return;
  items = next;
  markDirty();
  render();
  focusCell(it.id, col);
}

// Añade partida según la selección: dentro del capítulo si es grupo, o como hermana si es línea.
function addPartidaRelative() {
  const it = selectedId ? items.find((i) => i.id === selectedId) : null;
  if (!it) return addLine(null);
  if (it.nodeType === "group") addLine(it.id);
  else addLine(it.parentId, it.sortOrder);
}

// ---- selección de fila ----
function selectRow(id: string) {
  selectedId = id;
  document.querySelectorAll<HTMLElement>("tbody tr[data-id]").forEach((tr) => {
    tr.classList.toggle("selected", tr.dataset.id === id);
  });
}
function withSelected(fn: (it: BoqItem) => void) {
  if (!selectedId) return;
  const it = items.find((i) => i.id === selectedId);
  if (it) fn(it);
}
// Mueve la fila seleccionada entre sus hermanos (dir -1 sube, +1 baja).
function move(dir: -1 | 1) {
  if (!selectedId) return;
  const next = tree.move(items, selectedId, dir);
  if (next === items) return; // ya está en el extremo → no-op
  items = next;
  markDirty();
  render();
}

// ---- modo de detalle y desglose ----
function setDetailLevel(level: "simple" | "detailed") {
  boq.detailLevel = level;
  if (level === "simple") expanded.clear();
  markDirty();
  render();
}
function toggleExpand(id: string) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
}
// Actualiza un componente de tarifa y deriva el P.U. = suma de componentes.
function setRatePart(it: BoqItem, key: (typeof RATE_PARTS)[number]["key"], value: number | null) {
  it[key] = value;
  const sum = componentSum(it);
  it.unitRate = sum; // P.U. derivado (null si se borraron todos los componentes)
  // Sincronizar la celda de P.U. en vivo (sin re-render, para no perder foco).
  const puInput = document.querySelector<HTMLInputElement>(`[data-id="${it.id}"][data-col="unitRate"]`);
  if (puInput) {
    puInput.value = sum == null ? "" : String(sum);
    puInput.readOnly = sum != null;
    puInput.classList.toggle("derived", sum != null);
  }
  markDirty();
  recompute();
}
function hasBreakdown(it: BoqItem): boolean {
  return componentSum(it) != null;
}

function removeItem(id: string) {
  items = tree.removeItem(items, id);
  markDirty();
  render();
}

// ---- cálculo en vivo ----
const amountCells = new Map<string, HTMLElement>();
const markupAmountCells = new Map<string, HTMLElement>();
let subtotalEl: HTMLElement, totalEl: HTMLElement, validationEl: HTMLElement;
let m2DirectEl: HTMLElement | null = null, m2TotalEl: HTMLElement | null = null;

function recompute() {
  const r = recalculate(boq, items, markups);
  for (const [id, el] of amountCells) el.textContent = fmt(r.amounts[id] ?? 0);
  subtotalEl.textContent = fmt(r.subtotal);
  for (const mr of r.markups) {
    const el = markupAmountCells.get(mr.id);
    if (el) el.textContent = fmt(mr.amount);
  }
  totalEl.textContent = fmt(r.total);
  const cpa = costPerArea(r, boq.builtArea, boq.roundingDecimals ?? 2);
  if (m2DirectEl) m2DirectEl.textContent = cpa ? `${fmt(cpa.directPerM2)}/m²` : "—";
  if (m2TotalEl) m2TotalEl.textContent = cpa ? `${fmt(cpa.totalPerM2)}/m²` : "—";
  renderValidation();
}

function renderValidation() {
  if (!validationEl) return;
  const issues = validate(boq, items);
  const errs = issues.filter((i) => i.severity === "error").length;
  const warns = issues.length - errs;
  validationEl.innerHTML = "";

  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("span");
  title.textContent = "Validación";
  const badge = document.createElement("span");
  badge.className = "val-badge";
  if (issues.length === 0) { badge.textContent = "✓ Sin problemas"; badge.style.color = "var(--ok)"; }
  else { badge.textContent = `${errs} error(es) · ${warns} aviso(s)`; badge.style.color = errs > 0 ? "var(--error)" : "var(--warn)"; }
  head.append(title, badge);
  validationEl.appendChild(head);

  if (issues.length) {
    const list = document.createElement("div");
    list.className = "val-list";
    for (const is of issues) {
      const it = items.find((i) => i.id === is.itemId);
      const row = document.createElement("div");
      row.className = `val-item ${is.severity}`;
      const ref = it ? (it.code?.trim() || it.description?.trim() || "—") : "";
      const sev = is.severity === "error" ? "Error" : "Aviso";
      row.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="sr-only">${sev}:</span><span class="msg">${is.message}</span><span class="ref">${ref}</span>`;
      if (is.itemId) {
        row.addEventListener("click", () => { selectRow(is.itemId!); focusCell(is.itemId!, "description"); });
      }
      list.appendChild(row);
    }
    validationEl.appendChild(list);
  }
}

// ---- markups (editor) ----
function addMarkup() {
  const maxSort = markups.length ? Math.max(...markups.map((m) => m.sortOrder)) : 0;
  markups.push({ id: uid(), boqId: boq.id, name: "Nuevo markup", type: "percentage", value: 0, basis: "running", sortOrder: maxSort + 1 });
  markDirty();
  render();
}
function removeMarkup(id: string) {
  markups = markups.filter((m) => m.id !== id);
  markDirty();
  render();
}
function makeMarkupRow(m: MarkupRule): HTMLTableRowElement {
  const tr = document.createElement("tr");

  const tdName = td();
  const name = textInput(m.name);
  name.addEventListener("input", () => { m.name = name.value; markDirty(); });
  tdName.appendChild(name); tr.appendChild(tdName);

  const tdType = td();
  const type = selectInput([["percentage", "Porcentaje (%)"], ["fixed", "Monto fijo"]], m.type);
  type.addEventListener("change", () => { m.type = type.value as MarkupRule["type"]; markDirty(); recompute(); });
  tdType.appendChild(type); tr.appendChild(tdType);

  const tdVal = td("num");
  const val = numInput(m.value);
  val.addEventListener("input", () => { m.value = val.value === "" ? 0 : Number(val.value); markDirty(); recompute(); });
  tdVal.appendChild(val); tr.appendChild(tdVal);

  const tdBasis = td();
  const basis = selectInput([["subtotal", "Sobre subtotal"], ["running", "Sobre acumulado"]], m.basis);
  basis.addEventListener("change", () => { m.basis = basis.value as MarkupRule["basis"]; markDirty(); recompute(); });
  tdBasis.appendChild(basis); tr.appendChild(tdBasis);

  const tdAmt = document.createElement("td"); tdAmt.className = "amount"; markupAmountCells.set(m.id, tdAmt); tr.appendChild(tdAmt);

  const tdAct = td("actions"); tdAct.appendChild(button("×", () => removeMarkup(m.id), "icon del")); tr.appendChild(tdAct);
  return tr;
}

// ---- edición de celdas ----
function focusCell(id: string, col: Col) {
  const el = document.querySelector<HTMLInputElement>(`[data-id="${id}"][data-col="${col}"]`);
  if (el) { el.focus(); el.select?.(); }
}

// Asigna el valor editado a la propiedad de BoqItem con el tipo correcto (sin `as any`).
// `col` viene de EDITABLE (⊂ keyof BoqItem); las numéricas se parsean, el resto es texto.
function setField(it: BoqItem, col: Col, raw: string): void {
  if (col === "quantity" || col === "unitRate") {
    it[col] = raw === "" ? null : Number(raw);
  } else {
    it[col] = raw;
  }
}

function makeCell(it: BoqItem, col: Col): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "cell";
  input.dataset.id = it.id;
  input.dataset.col = col;
  const isNum = NUMERIC.includes(col);
  input.type = isNum ? "number" : "text";
  const val = it[col];
  input.value = val == null ? "" : String(val);
  if (col === "description") input.placeholder = it.nodeType === "group" ? "Nombre del capítulo…" : "Descripción de la partida…";

  // P.U. derivado: cuando la partida tiene desglose, el precio unitario es de solo lectura.
  if (col === "unitRate" && hasBreakdown(it)) {
    input.readOnly = true;
    input.classList.add("derived");
    input.title = "Precio unitario = suma de componentes (desglose)";
  }

  input.addEventListener("input", () => {
    if (input.readOnly) return;
    setField(it, col, input.value);
    markDirty();
    recompute();
  });
  input.addEventListener("focus", () => selectRow(it.id));
  input.addEventListener("keydown", (e) => onKey(e, it, col));
  return input;
}

function onKey(e: KeyboardEvent, it: BoqItem, col: Col) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); indent(it, col); }
  else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); outdent(it, col); }
  else if (e.key === "Enter") { e.preventDefault(); addLine(it.parentId, it.sortOrder); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const rows = ordered();
    const idx = rows.findIndex((r) => r.item.id === it.id);
    const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) focusCell(next.item.id, col);
  }
}

// Sub-fila con el desglose del P.U. en componentes (L1).
function makeBreakdownRow(it: BoqItem): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "detail-row";
  const td = document.createElement("td");
  td.colSpan = 7;

  const box = document.createElement("div");
  box.className = "breakdown";
  const title = document.createElement("div");
  title.className = "breakdown-title";
  title.textContent = "Desglose del precio unitario";
  box.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "breakdown-grid";
  for (const part of RATE_PARTS) {
    const field = document.createElement("label");
    field.className = "bd-field";
    const cap = document.createElement("span");
    cap.textContent = part.label;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "cell";
    const v = it[part.key];
    input.value = v == null ? "" : String(v);
    input.addEventListener("input", () => {
      setRatePart(it, part.key, input.value === "" ? null : Number(input.value));
      sumEl.textContent = fmt(componentSum(it) ?? 0);
    });
    field.append(cap, input);
    grid.appendChild(field);
  }
  box.appendChild(grid);

  const sumLine = document.createElement("div");
  sumLine.className = "breakdown-sum";
  const sumEl = document.createElement("strong");
  sumEl.textContent = fmt(componentSum(it) ?? 0);
  sumLine.append(document.createTextNode("P. Unitario (Σ componentes): "), sumEl);
  box.appendChild(sumLine);

  td.appendChild(box);
  tr.appendChild(td);
  return tr;
}

// ---- vista de comparación (B2) ----
function renderCompare() {
  const app = document.getElementById("app")!;
  app.innerHTML = "";
  const curName = boqList.find((b) => b.id === currentBoqId)?.projectName ?? "A";

  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.textContent = `Comparar — ${curName}`;
  header.append(h1, button("← Volver al editor", () => closeCompare()));
  app.appendChild(header);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  // Barra: selector del presupuesto B
  const bar = document.createElement("div");
  bar.className = "toolbar viewbar";
  const lbl = document.createElement("span"); lbl.className = "rowbar-label"; lbl.textContent = "Comparar contra:";
  const sel = document.createElement("select"); sel.className = "boq-select";
  for (const b of boqList.filter((x) => x.id !== currentBoqId)) {
    const o = document.createElement("option"); o.value = b.id;
    o.textContent = `${b.projectName} — ${b.name} (${b.currency})`;
    if (b.id === compareWithId) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => { compareWithId = sel.value; loadCompare(); });
  bar.append(lbl, sel);
  wrap.appendChild(bar);

  if (!compareData) { wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Sin datos." })); app.appendChild(wrap); return; }
  appendCompareBody(wrap, compareData, { a: "A (dueño)", b: "B (otro)", badgeA: "solo dueño", badgeB: "solo B" });
  app.appendChild(wrap);
}

// Tabla + resumen de una comparación. Reusada por B2 (presupuesto vs presupuesto)
// y F3 (estado vivo vs snapshot). L = etiquetas de los lados A/B.
interface CompareLabels { a: string; b: string; badgeA: string; badgeB: string; }
function appendCompareBody(wrap: HTMLElement, d: CompareData, L: CompareLabels) {
  if (!d.sameCurrency) {
    const warn = document.createElement("div"); warn.className = "compare-warn";
    warn.textContent = `⚠ Monedas distintas (${L.a}: ${d.currencyA} vs ${L.b}: ${d.currencyB}). La comparación es numérica, no convierte moneda.`;
    wrap.appendChild(warn);
  }

  const fA = (n: number | null) => (n == null ? "—" : money.format(n));
  const fmtDelta = (n: number | null, pct: number | null) => n == null ? "—" : `${n > 0 ? "+" : ""}${money.format(n)}${pct != null ? ` (${n > 0 ? "+" : ""}${pct}%)` : ""}`;

  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>
    <th style="width:90px">Código</th><th>Descripción</th>
    <th class="num" style="width:150px">${L.a}</th><th class="num" style="width:150px">${L.b}</th>
    <th class="num" style="width:170px">Δ (${L.b} − ${L.a})</th>
  </tr></thead>`;
  const tb = document.createElement("tbody");
  for (const r of d.rows) {
    const tr = document.createElement("tr");
    const dpos = (r.deltaAmount ?? 0) > 0, dneg = (r.deltaAmount ?? 0) < 0;
    const tag = r.side === "onlyA" ? ` <span class="badge a">${L.badgeA}</span>` : r.side === "onlyB" ? ` <span class="badge b">${L.badgeB}</span>` : "";
    tr.innerHTML = `
      <td class="code"><div class="cellpad">${r.code ?? ""}</div></td>
      <td><div class="cellpad">${r.description}${tag}</div></td>
      <td class="num"><div class="cellpad">${fA(r.amountA)}</div></td>
      <td class="num"><div class="cellpad">${fA(r.amountB)}</div></td>
      <td class="num ${dpos ? "delta-up" : dneg ? "delta-down" : ""}"><div class="cellpad">${fmtDelta(r.deltaAmount, r.deltaPct)}</div></td>`;
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  const scroll = document.createElement("div"); scroll.className = "table-scroll"; scroll.appendChild(table);
  wrap.appendChild(scroll);

  const totals = document.createElement("div");
  totals.className = "totals";
  const dpos = d.deltaTotal > 0;
  totals.innerHTML = `
    <div class="row"><span>Total ${L.a}</span><span class="v">${money.format(d.totalA)}</span></div>
    <div class="row"><span>Total ${L.b}</span><span class="v">${money.format(d.totalB)}</span></div>
    <div class="row total"><span>Δ Total</span><span class="v ${dpos ? "delta-up" : d.deltaTotal < 0 ? "delta-down" : ""}">${d.deltaTotal > 0 ? "+" : ""}${money.format(d.deltaTotal)}</span></div>
    <div class="row" style="color:var(--muted);font-size:12px"><span>${d.counts.matched} emparejadas · ${d.counts.onlyA} ${L.badgeA} · ${d.counts.onlyB} ${L.badgeB}</span></div>`;
  wrap.appendChild(totals);
}

function renderVersiones() {
  const app = document.getElementById("app")!;
  app.innerHTML = "";
  const curName = boqList.find((b) => b.id === currentBoqId)?.projectName ?? "";

  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.textContent = `Versiones — ${curName}`;
  header.append(h1, button("← Volver al editor", () => closeVersiones()));
  app.appendChild(header);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  // Vista de comparación contra un snapshot
  if (snapshotCompareId) {
    const snap = snapshots.find((s) => s.id === snapshotCompareId);
    const bar = document.createElement("div");
    bar.className = "toolbar viewbar";
    const lbl = document.createElement("span"); lbl.className = "rowbar-label";
    lbl.textContent = snap ? `Comparando estado actual contra «${snap.label}» (${fmtDate(snap.createdAt)})` : "Comparación";
    bar.append(button("← Versiones", () => backToSnapshotList()), lbl);
    wrap.appendChild(bar);

    if (!snapshotCompareData) {
      wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Sin datos." }));
    } else {
      appendCompareBody(wrap, snapshotCompareData, { a: snap?.label ?? "Rev.0", b: "Actual", badgeA: "solo Rev.0", badgeB: "nueva" });
    }
    app.appendChild(wrap);
    return;
  }

  // Vista de lista de versiones
  const bar = document.createElement("div");
  bar.className = "toolbar viewbar";
  bar.append(button("📌 Congelar versión actual", () => freezeSnapshot(), "primary"));
  wrap.appendChild(bar);

  if (snapshots.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:24px;color:var(--muted)";
    empty.textContent = "Aún no hay versiones congeladas. Congela una «Rev.0 aprobado» para tener una línea base contra la cual comparar.";
    wrap.appendChild(empty);
    app.appendChild(wrap);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>
    <th>Versión</th><th style="width:200px">Fecha</th>
    <th class="num" style="width:170px">Total congelado</th><th style="width:160px"></th>
  </tr></thead>`;
  const tb = document.createElement("tbody");
  for (const s of snapshots) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td"); td1.innerHTML = `<div class="cellpad"><strong>${s.label}</strong></div>`;
    const td2 = document.createElement("td"); td2.innerHTML = `<div class="cellpad">${fmtDate(s.createdAt)}</div>`;
    const td3 = document.createElement("td"); td3.className = "num"; td3.innerHTML = `<div class="cellpad">${money.format(s.frozenTotal)}</div>`;
    const td4 = document.createElement("td");
    const pad = document.createElement("div"); pad.className = "cellpad";
    pad.appendChild(button("⇄ Comparar con actual", () => compareWithSnapshot(s.id)));
    td4.appendChild(pad);
    tr.append(td1, td2, td3, td4);
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  const scroll = document.createElement("div"); scroll.className = "table-scroll"; scroll.appendChild(table);
  wrap.appendChild(scroll);
  app.appendChild(wrap);
}

// ---- render ----
function render() {
  if (compareMode) return renderCompare();
  if (snapshotMode) return renderVersiones();
  amountCells.clear();
  markupAmountCells.clear();
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  const cur = boqList.find((b) => b.id === currentBoqId);
  h1.textContent = cur ? cur.projectName : boq.name;
  // Selector de presupuesto (multi-proyecto, F1)
  const sel = document.createElement("select");
  sel.className = "boq-select";
  for (const b of boqList) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = `${b.projectName} — ${b.name} (${b.currency})`;
    if (b.id === currentBoqId) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => switchBoq(sel.value));
  const newBtn = button("+ Nuevo", () => newBudget(), "icon");
  const status = document.createElement("span");
  status.className = "sub"; status.id = "status"; status.style.marginLeft = "auto";
  header.append(h1, sel, newBtn, status);
  app.appendChild(header);
  statusEl = status;

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.append(
    button("+ Capítulo", () => addGroup(null), "primary"),
    button("+ Partida", () => addPartidaRelative()),
    button("💾 Guardar", () => save()),
    button("⬇ Excel", () => exportExcel()),
    button("⬆ Importar", () => importExcel()),
    button("⇄ Comparar", () => openCompare()),
    button("🔖 Versiones", () => openVersiones()),
    button("📐 QTO", () => openQto()),
  );
  wrap.appendChild(toolbar);

  // Toggle de modo (progressive disclosure): Simple vs Detallada.
  const detailed = (boq.detailLevel ?? "simple") === "detailed";
  const viewbar = document.createElement("div");
  viewbar.className = "toolbar viewbar";
  const vlabel = document.createElement("span");
  vlabel.className = "rowbar-label";
  vlabel.textContent = "Vista:";
  const seg = document.createElement("div");
  seg.className = "seg";
  const bSimple = button("Simple", () => setDetailLevel("simple"), detailed ? "" : "seg-active");
  const bDetailed = button("Detallada (desglose)", () => setDetailLevel("detailed"), detailed ? "seg-active" : "");
  seg.append(bSimple, bDetailed);
  viewbar.append(vlabel, seg);
  wrap.appendChild(viewbar);

  // Barra de acciones sobre la fila seleccionada
  const rowbar = document.createElement("div");
  rowbar.className = "toolbar rowbar";
  const lbl = document.createElement("span");
  lbl.className = "rowbar-label";
  lbl.textContent = "Fila seleccionada:";
  rowbar.append(
    lbl,
    button("↑ Subir", () => move(-1)),
    button("↓ Bajar", () => move(1)),
    button("→ Indentar", () => withSelected((it) => indent(it, "description"))),
    button("← Desindentar", () => withSelected((it) => outdent(it, "description"))),
    button("× Eliminar", () => { if (selectedId) removeItem(selectedId); }, "del"),
  );
  wrap.appendChild(rowbar);

  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>
    <th style="width:90px">Código</th><th>Descripción</th><th style="width:70px">Unidad</th>
    <th class="num" style="width:90px">Cantidad</th><th class="num" style="width:120px">P. Unitario</th>
    <th class="num" style="width:140px">Importe</th><th style="width:90px"></th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  for (const { item, depth } of ordered()) {
    const tr = document.createElement("tr");
    tr.className = item.nodeType === "group" ? "group" : "line";
    tr.dataset.id = item.id;
    if (item.id === selectedId) tr.classList.add("selected");
    tr.addEventListener("click", () => selectRow(item.id));

    const tdCode = td("code"); tdCode.appendChild(makeCell(item, "code")); tr.appendChild(tdCode);

    const tdDesc = td();
    const pad = document.createElement("span"); pad.className = "depth-pad"; pad.style.width = `${depth * 18}px`;
    const descWrap = document.createElement("div"); descWrap.style.display = "flex"; descWrap.style.alignItems = "center";
    descWrap.append(pad);
    // Chevron de desglose (solo modo Detallada, solo líneas).
    if (detailed && item.nodeType === "line") {
      const isOpen = expanded.has(item.id);
      const chev = button(isOpen ? "▾" : "▸", () => toggleExpand(item.id), "chevron");
      if (hasBreakdown(item)) chev.classList.add("has-breakdown");
      chev.title = isOpen ? "Ocultar desglose" : "Desglosar precio";
      descWrap.append(chev);
    }
    descWrap.append(makeCell(item, "description"));
    tdDesc.appendChild(descWrap); tr.appendChild(tdDesc);

    if (item.nodeType === "line") {
      const u = td(); u.appendChild(makeCell(item, "unit")); tr.appendChild(u);
      const q = td("num"); q.appendChild(makeCell(item, "quantity")); tr.appendChild(q);
      const rt = td("num"); rt.appendChild(makeCell(item, "unitRate")); tr.appendChild(rt);
    } else {
      const spacer = document.createElement("td"); spacer.colSpan = 3; tr.appendChild(spacer);
    }

    const tdAmt = document.createElement("td"); tdAmt.className = "amount"; amountCells.set(item.id, tdAmt); tr.appendChild(tdAmt);

    const tdAct = document.createElement("td"); tdAct.className = "actions";
    if (item.nodeType === "group") tdAct.appendChild(button("+ partida", () => addLine(item.id), "icon"));
    tdAct.appendChild(button("×", () => removeItem(item.id), "icon del"));
    tr.appendChild(tdAct);

    tbody.appendChild(tr);

    // Sub-fila de detalle: desglose del precio unitario en componentes (L1).
    if (detailed && item.nodeType === "line" && expanded.has(item.id)) {
      tbody.appendChild(makeBreakdownRow(item));
    }
  }
  table.appendChild(tbody);
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.appendChild(table);
  wrap.appendChild(scroll);

  // ---- Editor de markups ----
  const mkPanel = document.createElement("div");
  mkPanel.className = "markups-panel";
  const mkHead = document.createElement("div");
  mkHead.className = "panel-head";
  const mkTitle = document.createElement("span");
  mkTitle.textContent = "Markups (overhead, utilidad, ITBIS, contingencia…)";
  mkHead.append(mkTitle, button("+ Markup", () => addMarkup(), "icon"));
  mkPanel.appendChild(mkHead);
  const mkTable = document.createElement("table");
  mkTable.innerHTML = `<thead><tr>
    <th>Nombre</th><th style="width:130px">Tipo</th><th class="num" style="width:90px">Valor</th>
    <th style="width:170px">Base</th><th class="num" style="width:140px">Importe</th><th style="width:40px"></th>
  </tr></thead>`;
  const mkBody = document.createElement("tbody");
  for (const m of [...markups].sort((a, b) => a.sortOrder - b.sortOrder)) mkBody.appendChild(makeMarkupRow(m));
  mkTable.appendChild(mkBody);
  mkPanel.appendChild(mkTable);
  wrap.appendChild(mkPanel);

  const totals = document.createElement("div");
  totals.className = "totals";
  totals.innerHTML = `
    <div class="row sub"><span>Subtotal</span><span class="v" id="t-sub"></span></div>
    <div class="row total"><span>Total (con markups)</span><span class="v" id="t-total"></span></div>
    <div class="row area">
      <label for="t-area">Área construida</label>
      <span class="v"><input id="t-area" class="area-input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="—"> m²</span>
    </div>
    <div class="row m2"><span>Costo directo / m²</span><span class="v" id="t-m2-direct"></span></div>
    <div class="row m2"><span>Costo / m² (con markups)</span><span class="v" id="t-m2-total"></span></div>`;
  wrap.appendChild(totals);
  const areaInput = totals.querySelector<HTMLInputElement>("#t-area")!;
  if (boq.builtArea != null && boq.builtArea > 0) areaInput.value = String(boq.builtArea);
  areaInput.addEventListener("input", () => {
    const v = parseFloat(areaInput.value);
    boq.builtArea = Number.isFinite(v) && v > 0 ? v : null;
    markDirty();
    recompute();
  });
  m2DirectEl = totals.querySelector("#t-m2-direct");
  m2TotalEl = totals.querySelector("#t-m2-total");

  // Panel de validación
  validationEl = document.createElement("div");
  validationEl.className = "validation-panel";
  wrap.appendChild(validationEl);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.innerHTML = `<kbd>Tab</kbd> celdas · <kbd>Enter</kbd> nueva partida · <kbd>↑</kbd>/<kbd>↓</kbd> fila · <kbd>Alt</kbd>+<kbd>→</kbd>/<kbd>←</kbd> indentar · <kbd>⌘S</kbd> guardar · × elimina`;
  wrap.appendChild(hint);

  app.appendChild(wrap);
  subtotalEl = wrap.querySelector("#t-sub")!;
  totalEl = wrap.querySelector("#t-total")!;
  recompute();
  setStatus(dirty ? "dirty" : "saved");
}

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}
function td(cls = ""): HTMLTableCellElement {
  const c = document.createElement("td");
  if (cls) c.className = cls;
  return c;
}
function textInput(v: string): HTMLInputElement {
  const i = document.createElement("input");
  i.className = "cell"; i.type = "text"; i.value = v ?? "";
  return i;
}
function numInput(v: number): HTMLInputElement {
  const i = document.createElement("input");
  i.className = "cell"; i.type = "number"; i.value = v == null ? "" : String(v);
  return i;
}
function selectInput(opts: [string, string][], val: string): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "cell";
  for (const [v, label] of opts) {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    if (v === val) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

// Arranque de la app: registra el atajo global de guardado y carga los datos.
// Exportado para que los tests lo invoquen tras montar el DOM y mockear fetch.
export function start() {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });
  return init();
}

// Auto-arranque solo en el navegador real (Vite dev/build); en Vitest MODE === "test" → no arranca.
if (import.meta.env.MODE !== "test") start();
