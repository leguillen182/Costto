// Respaldo automático del data.db (F7). Usa el backup ONLINE de better-sqlite3
// (seguro con WAL, no requiere parar la BD) y rota: conserva solo los N más recientes.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

const BACKUP_RE = /^data-.*\.db$/;

/** Copia la BD a `dir/data-<stamp>.db` y borra los respaldos más viejos hasta dejar `keep`.
 *  `stamp` se inyecta (no usa el reloj aquí) para que la rotación sea testeable y determinista. */
export async function backupDb(
  sqlite: Database.Database,
  dir: string,
  stamp: string,
  keep = 3,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `data-${stamp}.db`);
  await sqlite.backup(dest);
  // El stamp ISO ordena lexicográficamente = cronológicamente; los primeros son los más viejos.
  const files = readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(join(dir, old), { force: true });
  }
  return dest;
}
