import { beforeEach, describe, expect, it, vi } from "vitest";

// Category/subcategory feature: validate_category_tree (a DB trigger, see
// supabase/migrations/202607140002_catalog_media.sql) is the actual two-level-
// hierarchy enforcement. These tests verify createCategory/updateCategory translate
// its bare `raise exception '<CODE>'` text into friendly, typed ApiErrors instead of
// a generic "could not be created" 422 -- Supabase is mocked since there's no
// existing service-level harness for features/admin/service.ts (see the same
// rationale used throughout this session's other mocked service tests).

type TableResult = { data: unknown; error: unknown };
// A queue of results consumed in call order for the "categories" table, since
// updateCategory issues two sequential calls (a "before" select, then the update)
// that need different responses.
const tableResults: Record<string, TableResult> = {};
const tableQueues: Record<string, TableResult[]> = {};

function nextResult(table: string): TableResult {
  const queue = tableQueues[table];
  if (queue && queue.length > 0) return queue.shift()!;
  return tableResults[table] ?? { data: null, error: null };
}

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve(nextResult(table));
  builder.maybeSingle = () => Promise.resolve(nextResult(table));
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(nextResult(table)).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));
vi.mock("@/features/media/delivery", () => ({ mediaImageDto: vi.fn() }));
// revalidateTag needs a request-scoped store that only exists inside a real Next.js
// server request; outside of one (as here) it throws. Mocked like the other
// Next/Supabase boundaries above since this test exercises the service function directly.
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { createCategory, updateCategory } = await import("@/features/admin/service");

const ACTOR = { userId: "admin-1", role: "admin" as const };

beforeEach(() => {
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  for (const key of Object.keys(tableQueues)) delete tableQueues[key];
  tableResults.categories = { data: null, error: null };
});

describe("category tree error mapping (createCategory)", () => {
  it("maps CATEGORY_DEPTH_EXCEEDED to a friendly 422", async () => {
    tableResults.categories = { data: null, error: { message: "CATEGORY_DEPTH_EXCEEDED", code: "P0001" } };
    await expect(createCategory({ name: "Gel Pens", slug: "gel-pens", parentId: "sub-1" }, ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 422, code: "CATEGORY_DEPTH_EXCEEDED" });
  });

  it("maps CATEGORY_PARENT_INVALID to a friendly 422", async () => {
    tableResults.categories = { data: null, error: { message: "CATEGORY_PARENT_INVALID", code: "P0001" } };
    await expect(createCategory({ name: "Gel Pens", slug: "gel-pens", parentId: "missing" }, ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 422, code: "CATEGORY_PARENT_INVALID" });
  });

  it("still maps a slug conflict to 409 SLUG_EXISTS (unaffected by the new mapping)", async () => {
    tableResults.categories = { data: null, error: { message: "duplicate key value", code: "23505" } };
    await expect(createCategory({ name: "Gel Pens", slug: "gel-pens" }, ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 409, code: "SLUG_EXISTS" });
  });

  it("falls back to a generic 422 for an unrecognized error", async () => {
    tableResults.categories = { data: null, error: { message: "something else", code: "XX000" } };
    await expect(createCategory({ name: "Gel Pens", slug: "gel-pens" }, ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("succeeds and audits when no error occurs", async () => {
    tableResults.categories = { data: { id: "cat-1", name: "Gel Pens" }, error: null };
    const result = await createCategory({ name: "Gel Pens", slug: "gel-pens" }, ACTOR, "req-1");
    expect(result).toMatchObject({ id: "cat-1" });
  });
});

describe("category tree error mapping (updateCategory)", () => {
  it("maps CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD to a friendly 409", async () => {
    // Two sequential calls: the "before" select (must succeed so it gets past the
    // 404 check), then the update itself (returns the tree-trigger error).
    tableQueues.categories = [
      { data: { id: "cat-1", name: "Writing Tools", version: 1 }, error: null },
      { data: null, error: { message: "CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD", code: "P0001" } },
    ];
    await expect(updateCategory("cat-1", { parentId: "other-master", expectedVersion: 1 }, ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 409, code: "CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD" });
  });

  it("succeeds and audits when no tree conflict occurs", async () => {
    tableQueues.categories = [
      { data: { id: "cat-1", name: "Gel Pens", version: 1 }, error: null },
      { data: { id: "cat-1", name: "Gel Pens", version: 2 }, error: null },
    ];
    const result = await updateCategory("cat-1", { name: "Gel Pens", expectedVersion: 1 }, ACTOR, "req-1");
    expect(result).toMatchObject({ id: "cat-1", version: 2 });
  });
});
