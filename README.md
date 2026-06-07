# OwnerRep-ERP · cost-boq (código)

Módulo BOQ (Fase 1, estimador) de OwnerRep-ERP. **Código fuera de Google Drive** (convención del
workspace: node_modules + sync de Drive es problemático).

- **Docs / planificación:** `…/0 Claude/tools/OwnerRep-ERP/` (en Drive) + gestión viva en Obsidian `Proyectos/OwnerRep-ERP/`.
- **Stack:** TypeScript + Node · SQLite + Drizzle (better-sqlite3) · Vite (editor web) · ExcelJS · Vitest.

## Estructura
```
src/
├── types.ts        Modelo de dato (espejo de DATA_MODEL.md)
├── calc.ts         recalculate() — motor de cálculo puro (rollup + markups en cascada)
├── validate.ts     Reglas de validación duras (A1)
├── compare.ts      compareBoqs() — comparar 2 presupuestos (B2)
├── snapshot.ts     Versiones/snapshots: congelar Rev.0 + comparar vs vivo (F3)
├── tree.ts         Operaciones de árbol del editor (indent/outdent/move/… puras)
├── import.ts       Import desde Excel (B1) · export.ts  Export a Excel
├── backup.ts       Backup automático del data.db (F7)
├── repo.ts         Persistencia (Drizzle) + puente al cálculo (calcBoq)
├── server.ts       Backend HTTP (createApp) — REST sobre el repo
└── db/{schema,client}.ts   Schema Drizzle + conexión/migración
web/
└── main.ts         Editor keyboard-first (capa DOM; reusa calc.ts y tree.ts)
```
**93 tests verdes** — `src/*.test.ts` corren en node; `web/*.test.ts` en jsdom.

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
Fase 1 (estimador) — **Hito 5 "apto para uso real" casi cerrado** (falta solo F4 costo/m²). Hecho:
- Modelo de dato genérico · cálculo (rollup + markups) · persistencia SQLite/Drizzle.
- Editor web keyboard-first: edición inline, indent/outdent, selección de fila, recálculo en vivo, **Guardar** (⌘S).
- Markups configurables · desglose escalable Simple/Detallada (A2) · export+import Excel (B1).
- Validación (A1) · multi-proyecto en la UI (F1) · comparar 2 presupuestos (B2).
- Versiones/snapshots: congelar "Rev.0 aprobado" + comparar vivo vs Rev.0 (F3).
- Backup automático del `data.db` en cada guardado, 3 rotando (F7).
- Tests del editor (C2): lógica de árbol extraída a `tree.ts` + tests jsdom del front.
- Git + remoto: **github.com/leguillen182/Costto**.

Decisiones (ADR) y estado vivo: Obsidian `Proyectos/OwnerRep-ERP/` (ADR canónico) · `docs/DECISIONS.md` = puntero.
Caveat de precisión monetaria en float: ADR-013 (diferida).
