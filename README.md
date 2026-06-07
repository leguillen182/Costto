# OwnerRep-ERP · cost-boq (código)

Módulo BOQ (Fase 1, estimador) de OwnerRep-ERP. **Código fuera de Google Drive** (convención del
workspace: node_modules + sync de Drive es problemático).

- **Docs / planificación:** `…/0 Claude/00_Tools/OwnerRep-ERP/iniciativas/cost-boq/` (en Drive).
- **Stack:** TypeScript + Node · SQLite + Drizzle (pendiente) · tests Vitest.

## Estructura
```
src/
├── types.ts        Modelo de dato (espejo de DATA_MODEL.md)
├── calc.ts         recalculate() — motor de cálculo puro (Tarea 1.2) ✅
├── calc.test.ts    Spec del cálculo (17 tests)
├── repo.ts         Persistencia + puente al cálculo (calcBoq) ✅
├── repo.test.ts    Round-trip y cálculo desde DB (6 tests)
└── db/
    ├── schema.ts   Schema Drizzle (SQLite)
    └── client.ts   Conexión + migración (CREATE TABLE)
```
Total: 23 tests verdes.

## Comandos
```
npm install
npm test          # vitest run
npm run test:watch
npm run typecheck
```

## Editor web (Tarea 1.3) + API
Necesita DOS procesos (en terminales separadas):
```
npm run api     # backend HTTP en :8787 (SQLite, data.db)
npm run dev     # editor Vite en :5173 (proxy /api → :8787)
```
`web/main.ts` — editor keyboard-first: árbol de capítulos/partidas, edición inline, recálculo en
vivo (reusa calc.ts), markups, total, y **Guardar** (⌘S) que persiste a SQLite vía `/api`.
`src/server.ts` — backend: GET/PUT `/api/boq/:id`. Siembra `data.db` si está vacío.

## Estado
- Tarea 1.2 (cálculo) ✅ — rollup recursivo + markups en cascada + redondeo configurable.
- Persistencia ✅ — SQLite + Drizzle (better-sqlite3). Round-trip y calcBoq desde DB.
- Tarea 1.3 (editor web) ✅ — render, edición en vivo, totales, persistencia SQLite vía API.
- Tarea 1.5 (markups config) ✅ — editor de markups en UI, cascada en vivo, persistido.
- Export a Excel ✅ — `GET /api/boq/:id/export` (ExcelJS). Botón "⬇ Excel" (guarda y descarga).
- **DoD de Fase 1 COMPLETO.** Siguiente (opcional): indent/outdent, import Excel (P1).
- Ver `docs/DECISIONS.md` ADR-013 (precisión monetaria en float, diferida).
