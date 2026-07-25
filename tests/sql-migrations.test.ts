import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "pgsql-parser";
import { describe, expect, it } from "vitest";

// Enumerated from disk rather than hand-listed: a hand-listed array silently stops
// covering new migrations the moment someone forgets to append to it (it had already
// drifted by two files before this became dynamic).
const migrationDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrations = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => `supabase/migrations/${name}`);
const sqlFiles = [...migrations, "supabase/seed.sql"];

describe("PostgreSQL migrations", () => {
  for (const relativePath of sqlFiles) {
    it(`parses ${relativePath}`, async () => {
      const sql = await readFile(path.join(process.cwd(), relativePath), "utf8");
      const result = await parse(sql) as { stmts: unknown[] };
      expect(result.stmts.length).toBeGreaterThan(0);
    });
  }
});
