# OwnerRep-ERP · cost-boq (código)

Módulo BOQ (Fase 1, estimador) de OwnerRep-ERP. **Código fuera de Google Drive** (convención del
workspace: node_modules + sync de Drive es problemático).

- **Docs / planificación:** `…/0 Claude/tools/OwnerRep-ERP/` (en Drive) + gestión viva en Obsidian `Proyectos/OwnerRep-ERP/`.
- **Stack:** TypeScript + Node · SQLite + Drizzle (better-sqlite3) · Vite (editor web) · ExcelJS · pdf.js (QTO) · Vitest.

## Estructura
```
src/
├── types.ts        Modelo de dato (espejo de DATA_MODEL.md)
├── calc.ts         recalculate() — motor puro (rollup + markups) · costPerArea() (costo/m², F4)
├── validate.ts     Reglas de validación duras (A1)
├── compare.ts      compareBoqs() — comparar 2 presupuestos (B2)
├── snapshot.ts     Versiones/snapshots: congelar Rev.0 + comparar vs vivo (F3)
├── qto.ts          Geometría + escala para QTO (longitud/área/calibración, puro)
├── tree.ts         Operaciones de árbol del editor (indent/outdent/move/… puras)
├── import.ts       Import desde Excel (B1) · export.ts  Export a Excel
├── backup.ts       Backup automático del data.db (F7)
├── repo.ts         Persistencia (Drizzle) + puente al cálculo (calcBoq)
├── server.ts       Backend HTTP (createApp) — REST sobre el repo
└── db/{schema,client}.ts   Schema Drizzle + conexión/migración
web/
├── main.ts         Editor keyboard-first (capa DOM; reusa calc.ts y tree.ts)
└── qto.ts          Vista QTO: visor PDF (pdf.js) + medición sobre el plano → partidas
```
**Suite de tests en verde** — `src/*.test.ts` corren en node; `web/*.test.ts` en jsdom.

## Comandos
```
npm install
npm start          # API (:8787) + editor Vite (:5173) juntos (concurrently)
npm test           # vitest run (src en node + web en jsdom)
npm run typecheck      # tsc del código src/ (node)
npm run typecheck:web  # tsc de la capa DOM web/ (lib DOM)
```
Para sembrar datos demo en local: `BOQ_SEED=1 npm run api` (el `npm start`/`api` ya lo trae).

## Estado
Fase 1 (estimador) — **Hito 5 "apto para uso real" cerrado**. Hecho:
- Modelo de dato genérico · cálculo (rollup + markups) · persistencia SQLite/Drizzle.
- Editor web keyboard-first: edición inline, indent/outdent, selección de fila, recálculo en vivo, **Guardar** (⌘S).
- Markups configurables · desglose escalable Simple/Detallada (A2) · export+import Excel (B1).
- Validación (A1) · multi-proyecto en la UI (F1) · comparar 2 presupuestos (B2).
- Versiones/snapshots: congelar "Rev.0 aprobado" + comparar vivo vs Rev.0 (F3).
- Costo por m² construido (F4): área en el BOQ + costo directo y total /m² (UI + Excel).
- QTO sobre planos PDF: visor pdf.js + calibrar escala + medir longitud/área/conteo → partidas
  (nueva o rellenar la seleccionada). Pulido: imán a vértices + orto-lock (Shift) + Backspace;
  pan (espacio/arrastrar) + zoom con rueda al cursor; calibrar por escala escrita 1:n y unidades
  configurables (m/cm/ft). Fase 2: IFC vía web-ifc.
- Persistencia QTO (F10): mediciones + escalas guardadas por (presupuesto, documento) y
  restauradas al recargar el mismo plano; cada medición enlaza la partida que alimentó
  (trazabilidad) y recalibrar recalcula cantidades y partidas enlazadas.
- Deshacer/rehacer en el editor (F8): ⌘Z / ⇧⌘Z con coalescing de tecleo por celda.
- Catálogo de precios unitarios (F9): partidas maestras reutilizables; búsqueda + insertar en el
  presupuesto; volcado desde un BOQ (upsert por código).
- Backup automático del `data.db` en cada guardado, 3 rotando (F7).
- Tests del editor (C2): lógica de árbol extraída a `tree.ts` + tests jsdom del front.
- Refinamiento UI estilo Apple HIG: foco visible, diálogo modal `<dialog>` (sin alert/confirm/prompt), tokens de color, a11y.
- Git + remoto: **github.com/leguillen182/Costto**.

Decisiones (ADR) y estado vivo: Obsidian `Proyectos/OwnerRep-ERP/` (ADR canónico) · `docs/DECISIONS.md` = puntero.
Caveat de precisión monetaria en float: ADR-013 (diferida).
