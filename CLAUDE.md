# CLAUDE.md — OwnerRep-ERP · cost-boq

Módulo BOQ (Fase 1, estimador): TypeScript + Node · SQLite/Drizzle (better-sqlite3) · Vite
(editor web) · ExcelJS · Vitest. El **mapa de módulos y el estado** están en `README.md` — esto
recoge solo las reglas y gotchas que se rompen sin querer.

## Comandos
```
npm install
npm start              # API (:8787) + editor Vite (:5173) juntos
npm test               # vitest run — TODOS los tests
npm run typecheck      # tsc de src/ (lib Node)
npm run typecheck:web  # tsc de web/ (lib DOM) — config aparte (web/tsconfig.json)
BOQ_SEED=1 npm run api # sembrar datos demo en local
```
**Antes de commitear, los tres en verde:** `npm test`, `npm run typecheck` **y** `npm run typecheck:web`.

## Gotchas (lo que se rompe fácil)
- **Doble typecheck.** Hay dos pasadas de `tsc` con libs distintas: `typecheck` (Node, `src/`) y
  `typecheck:web` (DOM, `web/`). Tocar `web/` y correr solo `typecheck` **no** valida la capa DOM.
- **Split de tests.** `src/*.test.ts` corren en Node; `web/*.test.ts` en jsdom (vitest projects en
  `vitest.config.ts`). El entorno cambia qué APIs existen (p. ej. `<dialog>` se polirellena en los
  tests de jsdom).
- **`src/calc.ts` y `src/tree.ts` son PUROS.** Sin DOM ni I/O — los reusan backend *y* `web/`. Meter
  `document`/`window`/fetch ahí rompe el backend y los tests de Node.
- **`recompute()` (web/main.ts) es un fast-path en vivo**, corre en cada tecla. Parchea `textContent`
  de celdas cacheadas; **no** le metas `innerHTML=""`, recorridos de árbol ni `render()` completos
  (el resumen por capítulo usa caché de filas por esto mismo).
- **Diálogos modales serializados.** `showDialog`/`showAlert`/`showConfirm`/`showPrompt` (web/main.ts)
  reemplazan a `alert/confirm/prompt` nativos y se **encolan** si ya hay uno abierto. No reintroducir
  diálogos nativos ni abrir un segundo `<dialog>` sobre el mismo elemento.
- **Migraciones SQLite:** columnas nuevas vía `addColumnIfMissing` (nullable) en `src/db/client.ts`,
  espejo del schema Drizzle en `src/db/schema.ts`. Mantener ambos sincronizados.
- **Precisión monetaria en float:** ADR-013 (diferida). Los redondeos actuales son decisión
  consciente — no "arreglarlos" sin revisar el ADR.

## Convenciones
- **Commits con código de feature:** `F4 · …`, `QTO: …`, `B2 · …`, `A1 · …`. Mantener el estilo.
- **ADR / roadmap canónico:** viven en Obsidian (`Proyectos/OwnerRep-ERP/`), no en el repo;
  `docs/DECISIONS.md` es solo un puntero. Buscar "el roadmap" en el repo no lo encuentra.
- Código keyboard-first en el editor; reusar `tree.ts` para operaciones de árbol (no reimplementar).
