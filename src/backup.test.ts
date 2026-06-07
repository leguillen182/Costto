import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./db/client.js";
import { createProject } from "./repo.js";
import { backupDb } from "./backup.js";

let dir = "";
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe("backupDb", () => {
  it("conserva solo los 3 respaldos más recientes (rota los viejos)", async () => {
    const { sqlite } = createDb(":memory:");
    dir = mkdtempSync(join(tmpdir(), "boqbk-"));
    const stamps = ["2026-06-07T10-00-00", "2026-06-07T11-00-00", "2026-06-07T12-00-00", "2026-06-07T13-00-00", "2026-06-07T14-00-00"];
    for (const s of stamps) await backupDb(sqlite, dir, s, 3);

    const files = readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toContain("12-00-00"); // 10 y 11 (los más viejos) se borraron
    expect(files[2]).toContain("14-00-00");
  });

  it("el respaldo es una BD restaurable con los datos", async () => {
    const { sqlite, db } = createDb(":memory:");
    createProject(db, { id: "pX", name: "Restore", baseCurrency: "USD" });
    dir = mkdtempSync(join(tmpdir(), "boqbk-"));
    const dest = await backupDb(sqlite, dir, "2026-06-07T10-00-00", 3);

    const restored = createDb(dest);
    const row = restored.sqlite.prepare("SELECT name FROM projects WHERE id = 'pX'").get() as { name: string };
    expect(row.name).toBe("Restore");
    restored.sqlite.close();
  });
});
