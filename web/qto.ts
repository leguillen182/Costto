// QTO sobre planos PDF — capa de navegador (pdfjs + canvas + vista + salida al BOQ).
// La geometría/escala vive en ../src/qto.ts (pura, sin DOM). Aquí está todo lo efectful:
// render del PDF, overlay de medición, eventos y el volcado de cantidades a partidas.
// pdfjs se importa de forma LAZY (dentro de loadPdf) para que el módulo cargue limpio en jsdom.
import type { BoqItem } from "../src/types.js";
import { deriveQuantity, calibrationFactor, defaultUnit, type Pt, type PageScale, type MeasureKind } from "../src/qto.js";

// ---- contrato de integración con el editor (lo construye main.ts cerrando sobre sus vars) ----
export interface QtoContext {
  getSelectedId(): string | null;
  getGroups(): { id: string; label: string }[];
  addLineUnder(parentId: string | null, fields: Partial<BoqItem>): string;
  updateLine(id: string, patch: Partial<BoqItem>): void;
  isLine(id: string): boolean;
  markDirty(): void;
  backToEditor(): void;
  showAlert(msg: string, title?: string): Promise<void>;
  showConfirm(msg: string, opts?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  showPrompt(label: string, def?: string, title?: string): Promise<string | null>;
}

export type Tool = "calibrar" | "longitud" | "area" | "conteo";

export interface Measurement {
  id: string;
  kind: MeasureKind;
  page: number;
  points: Pt[];
  quantity: number; // ya escalada y redondeada
  unit: string;
  label: string;    // descripción editable para "nueva partida"
  sent?: boolean;    // ya volcada al presupuesto
}

// Subconjunto del PageViewport de pdfjs que realmente usamos (evita acoplarnos a sus tipos).
interface Viewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint(x: number, y: number): number[];
}

// ---- conversión medición → partida (PURO respecto a pdfjs/canvas; testeable en jsdom) ----
export function autoLabel(m: { kind: MeasureKind }): string {
  return m.kind === "length" ? "Longitud" : m.kind === "area" ? "Área" : "Conteo";
}

/** Crea una partida nueva (línea) bajo `parentId` con la cantidad/unidad de la medición. */
export function sendMeasurementAsNewLine(
  ctx: QtoContext,
  m: Measurement,
  parentId: string | null,
  description?: string,
): string {
  const desc = (description ?? m.label).trim() || autoLabel(m);
  const id = ctx.addLineUnder(parentId, {
    description: desc,
    nodeType: "line",
    lineType: "unit_price",
    unit: m.unit,
    quantity: m.quantity,
  });
  ctx.markDirty();
  return id;
}

/** Rellena cantidad/unidad de la línea seleccionada. Devuelve por qué no se pudo, si aplica. */
export function sendMeasurementToSelected(
  ctx: QtoContext,
  m: Measurement,
): { ok: boolean; reason?: "no-selection" | "not-line" } {
  const sel = ctx.getSelectedId();
  if (!sel) return { ok: false, reason: "no-selection" };
  if (!ctx.isLine(sel)) return { ok: false, reason: "not-line" };
  ctx.updateLine(sel, { quantity: m.quantity, unit: m.unit });
  ctx.markDirty();
  return { ok: true };
}

export function roundQ(kind: MeasureKind, q: number): number {
  return kind === "count" ? Math.round(q) : Math.round(q * 100) / 100;
}

// ============================ estado de sesión (NO persistido) ============================
let ctx: QtoContext | null = null;
let active = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfDoc: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pageObj: any = null;
let viewport: Viewport | null = null;
let currentRenderTask: { cancel(): void } | null = null; // render pdf.js en vuelo (cancelable)
let forceNewCount = false; // fuerza un grupo de conteo nuevo en el próximo click

let numPages = 0;
let pageNum = 1;
let zoom = 1.0;
const ROTATION = 0; // MVP: sin rotación

const scaleByPage = new Map<number, PageScale>();
let measurements: Measurement[] = [];
let tool: Tool | null = null;
let draft: Pt[] = [];
let cursor: Pt | null = null; // posición del ratón en espacio PDF (rubber-band)

// refs de DOM
let pageCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let listEl: HTMLElement;
let pageLabel: HTMLElement;
let zoomLabel: HTMLElement;
let scaleBadge: HTMLElement;
let toolBtns: Partial<Record<Tool, HTMLButtonElement>> = {};
let placeholder: HTMLElement;

const ACCENT = "#2563eb";
const AREA_FILL = "rgba(37,99,235,0.14)";
const CAL = "#b87400";
const COUNT = "#0f9d58";

// ============================ entrada / salida de la vista ============================
export function openQtoView(c: QtoContext): void {
  ctx = c;
  active = true;
  pdfDoc = pageObj = viewport = null;
  numPages = 0; pageNum = 1; zoom = 1.0;
  scaleByPage.clear();
  measurements = [];
  tool = null; draft = []; cursor = null;
  toolBtns = {};
  renderView();
  window.addEventListener("keydown", onKeyDown);
}

function leave(): void {
  active = false;
  window.removeEventListener("keydown", onKeyDown);
  if (currentRenderTask) { currentRenderTask.cancel(); currentRenderTask = null; }
  if (pdfDoc) { try { pdfDoc.destroy(); } catch { /* no-op */ } pdfDoc = null; pageObj = null; }
  ctx?.backToEditor();
}

// ============================ construcción del DOM de la vista ============================
function btn(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function renderView(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.textContent = "QTO — medición sobre plano";
  header.append(h1, btn("← Volver al editor", () => leave()));
  app.appendChild(header);

  const wrap = document.createElement("div");
  wrap.className = "wrap qto-wrap";

  // Fila 1: cargar PDF + navegación + zoom
  const bar1 = document.createElement("div");
  bar1.className = "toolbar";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/pdf,.pdf";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) loadPdf(f);
  });
  bar1.append(
    btn("📂 Cargar PDF", () => fileInput.click(), "primary"),
    fileInput,
    btn("◀", () => gotoPage(pageNum - 1), "icon"),
    (pageLabel = label("pág —/—")),
    btn("▶", () => gotoPage(pageNum + 1), "icon"),
    spacer(),
    btn("−", () => setZoom(zoom / 1.25), "icon"),
    (zoomLabel = label("100%")),
    btn("+", () => setZoom(zoom * 1.25), "icon"),
    btn("Ajustar", () => fitWidth()),
  );
  wrap.appendChild(bar1);

  // Fila 2: herramientas + estado de calibración
  const bar2 = document.createElement("div");
  bar2.className = "toolbar viewbar";
  const tlabel = document.createElement("span");
  tlabel.className = "rowbar-label";
  tlabel.textContent = "Herramienta:";
  const seg = document.createElement("div");
  seg.className = "seg";
  toolBtns.calibrar = btn("📏 Calibrar", () => setTool("calibrar"));
  toolBtns.longitud = btn("📐 Longitud", () => setTool("longitud"));
  toolBtns.area = btn("⬡ Área", () => setTool("area"));
  toolBtns.conteo = btn("📍 Conteo", () => setTool("conteo"));
  seg.append(toolBtns.calibrar, toolBtns.longitud, toolBtns.area, toolBtns.conteo);
  const newCountBtn = btn("＋ grupo conteo", () => { forceNewCount = true; }, "icon");
  scaleBadge = document.createElement("span");
  scaleBadge.className = "qto-scale";
  bar2.append(tlabel, seg, newCountBtn, scaleBadge);
  wrap.appendChild(bar2);

  // Cuerpo: canvas + panel de mediciones
  const main = document.createElement("div");
  main.className = "qto-main";

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "qto-canvas-wrap";
  pageCanvas = document.createElement("canvas");
  pageCanvas.className = "qto-page";
  overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "qto-overlay";
  overlayCanvas.addEventListener("click", onClick);
  overlayCanvas.addEventListener("mousemove", onMove);
  overlayCanvas.addEventListener("dblclick", onDblClick);
  placeholder = document.createElement("div");
  placeholder.className = "qto-placeholder";
  placeholder.textContent = "Carga un PDF vectorial para empezar a medir.";
  canvasWrap.append(pageCanvas, overlayCanvas, placeholder);
  main.appendChild(canvasWrap);

  const side = document.createElement("aside");
  side.className = "qto-side";
  const sh = document.createElement("div");
  sh.className = "panel-head";
  const st = document.createElement("span");
  st.textContent = "Mediciones";
  sh.appendChild(st);
  side.appendChild(sh);
  listEl = document.createElement("div");
  listEl.className = "qto-list";
  side.appendChild(listEl);
  main.appendChild(side);

  wrap.appendChild(main);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.innerHTML =
    "<kbd>Click</kbd> añade punto · <kbd>doble-click</kbd>/<kbd>Enter</kbd> cierra · " +
    "<kbd>Esc</kbd> cancela · Calibra antes de medir longitudes/áreas · " +
    "<kbd>＋ grupo conteo</kbd> para contar elementos por separado.";
  wrap.appendChild(hint);

  app.appendChild(wrap);
  refreshChrome();
  renderList();
}

function label(text: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "rowbar-label";
  s.textContent = text;
  return s;
}
function spacer(): HTMLElement {
  const s = document.createElement("span");
  s.style.flex = "1";
  return s;
}

// ============================ pdfjs: carga y render ============================
async function ensurePdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = lib;
  return lib;
}

async function loadPdf(file: File): Promise<void> {
  try {
    const lib = await ensurePdfjs();
    if (pdfDoc) { try { await pdfDoc.destroy(); } catch { /* no-op */ } pdfDoc = null; pageObj = null; }
    const data = await file.arrayBuffer();
    pdfDoc = await lib.getDocument({ data }).promise;
    numPages = pdfDoc.numPages;
    pageNum = 1;
    scaleByPage.clear();
    measurements = [];
    placeholder.style.display = "none";
    await renderPage();
    renderList();
  } catch (e) {
    await ctx?.showAlert(`No se pudo abrir el PDF: ${e}`, "Error");
  }
}

async function renderPage(): Promise<void> {
  if (!pdfDoc) return;
  // Cancela cualquier render en vuelo (zoom/página rápidos no deben solapar render() sobre el canvas).
  if (currentRenderTask) { currentRenderTask.cancel(); currentRenderTask = null; }

  const prev = pageObj;
  pageObj = await pdfDoc.getPage(pageNum);
  if (prev && prev !== pageObj) { try { prev.cleanup(); } catch { /* no-op */ } }
  const vp = pageObj.getViewport({ scale: zoom, rotation: ROTATION }) as Viewport;
  viewport = vp;
  const dpr = window.devicePixelRatio || 1;

  for (const c of [pageCanvas, overlayCanvas]) {
    c.width = Math.floor(vp.width * dpr);
    c.height = Math.floor(vp.height * dpr);
    c.style.width = `${Math.floor(vp.width)}px`;
    c.style.height = `${Math.floor(vp.height)}px`;
  }

  const cctx = pageCanvas.getContext("2d")!;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
  const task = pageObj.render({
    canvasContext: cctx,
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  currentRenderTask = task;
  try {
    await task.promise;
  } catch (e) {
    if ((e as { name?: string })?.name === "RenderingCancelledException") return; // esperado: lo relevará el render nuevo
    throw e;
  } finally {
    if (currentRenderTask === task) currentRenderTask = null;
  }

  redrawOverlay();
  refreshChrome();
}

async function gotoPage(n: number): Promise<void> {
  if (!pdfDoc || n < 1 || n > numPages || n === pageNum) return;
  pageNum = n;
  draft = []; cursor = null;
  await renderPage();
}

async function setZoom(z: number): Promise<void> {
  zoom = Math.min(8, Math.max(0.1, z));
  if (pdfDoc) await renderPage(); else refreshChrome();
}

async function fitWidth(): Promise<void> {
  if (!pdfDoc || !pageObj) return;
  const base = pageObj.getViewport({ scale: 1, rotation: ROTATION }) as Viewport;
  const avail = (overlayCanvas.parentElement?.clientWidth ?? 800) - 24;
  await setZoom(avail / base.width);
}

// ============================ overlay (dibujo de mediciones) ============================
function redrawOverlay(): void {
  if (!viewport) return;
  const octx = overlayCanvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // mediciones confirmadas de la página actual
  for (const m of measurements) {
    if (m.page !== pageNum) continue;
    if (m.kind === "count") drawMarkers(octx, m.points, COUNT);
    else drawShape(octx, m.points, m.kind === "area", ACCENT);
  }
  // borrador en curso
  if (draft.length) {
    const isArea = tool === "area";
    const col = tool === "calibrar" ? CAL : isArea ? ACCENT : ACCENT;
    const pts = cursor ? [...draft, cursor] : draft;
    drawShape(octx, pts, isArea, col, true);
  }
}

function toVp(p: Pt): [number, number] {
  const [x, y] = viewport!.convertToViewportPoint(p.x, p.y);
  return [x!, y!];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawShape(octx: any, pts: Pt[], close: boolean, color: string, dashed = false): void {
  if (!pts.length) return;
  octx.lineWidth = 2;
  octx.strokeStyle = color;
  octx.setLineDash(dashed ? [5, 4] : []);
  octx.beginPath();
  const [x0, y0] = toVp(pts[0]!);
  octx.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = toVp(pts[i]!);
    octx.lineTo(x, y);
  }
  if (close && pts.length >= 3) {
    octx.closePath();
    octx.fillStyle = AREA_FILL;
    octx.fill();
  }
  octx.stroke();
  octx.setLineDash([]);
  for (const p of pts) {
    const [x, y] = toVp(p);
    octx.beginPath();
    octx.arc(x, y, 3, 0, Math.PI * 2);
    octx.fillStyle = color;
    octx.fill();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawMarkers(octx: any, pts: Pt[], color: string): void {
  octx.fillStyle = color;
  octx.strokeStyle = "#fff";
  octx.lineWidth = 1.5;
  pts.forEach((p, i) => {
    const [x, y] = toVp(p);
    octx.beginPath();
    octx.arc(x, y, 7, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    octx.fillStyle = "#fff";
    octx.font = "10px sans-serif";
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText(String(i + 1), x, y);
    octx.fillStyle = color;
  });
}

// ============================ interacción ============================
function eventToPdf(e: MouseEvent): Pt {
  const rect = overlayCanvas.getBoundingClientRect();
  const [x, y] = viewport!.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
  return { x: x!, y: y! };
}

function onClick(e: MouseEvent): void {
  if (e.detail >= 2) return; // 2º click de un doble-click: lo cierra onDblClick (evita punto fantasma)
  if (!viewport || !tool) return;
  const p = eventToPdf(e);
  if (tool === "conteo") {
    addCountMarker(p);
    return;
  }
  draft.push(p);
  if (tool === "calibrar" && draft.length === 2) {
    finishCalibration();
    return;
  }
  redrawOverlay();
}

function onMove(e: MouseEvent): void {
  if (!viewport || !tool || tool === "conteo" || !draft.length) return;
  cursor = eventToPdf(e);
  redrawOverlay();
}

function onDblClick(e: MouseEvent): void {
  e.preventDefault();
  finishDraft();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!active) return;
  if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
  else if (e.key === "Escape") { draft = []; cursor = null; redrawOverlay(); }
}

function setTool(t: Tool): void {
  tool = tool === t ? null : t;
  draft = []; cursor = null;
  if (t === "conteo") forceNewCount = true; // (re)entrar a Conteo inicia un grupo nuevo
  refreshChrome();
  redrawOverlay();
}

async function finishCalibration(): Promise<void> {
  const [a, b] = [draft[0]!, draft[1]!];
  draft = []; cursor = null;
  const ans = await promptLength();
  if (ans == null) { redrawOverlay(); return; }
  try {
    const unitsPerPdf = calibrationFactor(a, b, ans);
    scaleByPage.set(pageNum, { unitsPerPdf, realUnit: "m" });
    tool = "longitud";
  } catch (err) {
    await ctx?.showAlert(`Calibración inválida: ${err}`, "Calibrar");
  }
  refreshChrome();
  redrawOverlay();
}

// Prompt numérico vía el <dialog> estilado del editor (ctx.showPrompt), no el window.prompt nativo.
async function promptLength(): Promise<number | null> {
  const raw = await ctx!.showPrompt("Longitud real del segmento (m):", "5", "Calibrar escala");
  if (raw == null) return null;
  const v = parseFloat(raw.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function addCountMarker(p: Pt): void {
  // forceNewCount → empieza un grupo de conteo nuevo (permite contar p.ej. ventanas y puertas aparte).
  let m = forceNewCount ? undefined : measurements.find((x) => x.kind === "count" && x.page === pageNum && !x.sent);
  forceNewCount = false;
  if (!m) {
    const n = measurements.filter((x) => x.kind === "count").length + 1;
    m = { id: crypto.randomUUID(), kind: "count", page: pageNum, points: [], quantity: 0, unit: defaultUnit("count"), label: `${autoLabel({ kind: "count" })} ${n}` };
    measurements.push(m);
  }
  m.points.push(p);
  m.quantity = m.points.length;
  redrawOverlay();
  renderList();
}

function finishDraft(): void {
  if (!tool || tool === "conteo" || tool === "calibrar") return;
  const min = tool === "area" ? 3 : 2;
  if (draft.length < min) {
    ctx?.showAlert(`Necesitas al menos ${min} puntos para ${tool === "area" ? "un área" : "una longitud"}.`, "Medir");
    return;
  }
  const kind: MeasureKind = tool === "area" ? "area" : "length";
  const scale = scaleByPage.get(pageNum) ?? null;
  try {
    const r = deriveQuantity(kind, scale, { points: draft });
    measurements.push({
      id: crypto.randomUUID(),
      kind,
      page: pageNum,
      points: [...draft],
      quantity: roundQ(kind, r.quantity),
      unit: r.unit,
      label: autoLabel({ kind }),
    });
    draft = []; cursor = null;
    redrawOverlay();
    renderList();
  } catch (err) {
    ctx?.showAlert(`${err}`, "Medir");
  }
}

// ============================ panel de mediciones ============================
function fmtQty(m: Measurement): string {
  const q = m.kind === "count" ? String(m.quantity) : m.quantity.toLocaleString("es-DO");
  return `${q} ${m.unit}`;
}

function renderList(): void {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!measurements.length) {
    const empty = document.createElement("div");
    empty.className = "qto-empty";
    empty.textContent = "Aún no hay mediciones. Calibra y mide sobre el plano.";
    listEl.appendChild(empty);
    return;
  }
  const groups = ctx?.getGroups() ?? [];
  for (const m of measurements) {
    const row = document.createElement("div");
    row.className = "qto-item" + (m.sent ? " sent" : "");

    const icon = document.createElement("span");
    icon.className = "qto-icon";
    icon.textContent = m.kind === "length" ? "📐" : m.kind === "area" ? "⬡" : "📍";

    const lbl = document.createElement("input");
    lbl.className = "qto-label";
    lbl.value = m.label;
    lbl.addEventListener("input", () => (m.label = lbl.value));

    const qty = document.createElement("span");
    qty.className = "qto-qty";
    qty.textContent = fmtQty(m);

    const sel = document.createElement("select");
    sel.className = "qto-group";
    const root = document.createElement("option");
    root.value = ""; root.textContent = "(raíz)";
    sel.appendChild(root);
    for (const g of groups) {
      const o = document.createElement("option");
      o.value = g.id; o.textContent = g.label;
      sel.appendChild(o);
    }

    const newBtn = btn("+ partida", async () => {
      sendMeasurementAsNewLine(ctx!, m, sel.value || null, lbl.value);
      m.sent = true;
      renderList();
      await ctx!.showAlert(`Partida creada: ${fmtQty(m)}.`, "QTO");
    }, "icon");

    const selBtn = btn("→ sel.", async () => {
      const res = sendMeasurementToSelected(ctx!, m);
      if (!res.ok) {
        await ctx!.showAlert(
          res.reason === "no-selection"
            ? "Primero selecciona una partida (línea) en el editor."
            : "La fila seleccionada es un capítulo, no una partida.",
          "QTO",
        );
        return;
      }
      m.sent = true;
      renderList();
      await ctx!.showAlert(`Cantidad enviada a la partida seleccionada: ${fmtQty(m)}.`, "QTO");
    }, "icon");

    const del = btn("×", () => {
      measurements = measurements.filter((x) => x.id !== m.id);
      redrawOverlay();
      renderList();
    }, "icon del");

    row.append(icon, lbl, qty, sel, newBtn, selBtn, del);
    listEl.appendChild(row);
  }
}

// ============================ chrome (etiquetas/estado) ============================
function refreshChrome(): void {
  if (pageLabel) pageLabel.textContent = numPages ? `pág ${pageNum}/${numPages}` : "pág —/—";
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  for (const [k, b] of Object.entries(toolBtns)) {
    if (b) b.classList.toggle("seg-active", tool === k);
  }
  if (scaleBadge) {
    const s = scaleByPage.get(pageNum);
    scaleBadge.textContent = s
      ? `escala pág: calibrada ✓`
      : "sin calibrar ⚠ (calibra para longitudes/áreas)";
    scaleBadge.classList.toggle("ok", !!s);
  }
}
