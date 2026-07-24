import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "pgsql-parser";
import { describe, expect, it } from "vitest";

const sqlFiles = [
  "supabase/migrations/202607140001_identity_rbac.sql",
  "supabase/migrations/202607140002_catalog_media.sql",
  "supabase/migrations/202607140003_engagement_operations.sql",
  "supabase/migrations/202607140004_views_rls.sql",
  "supabase/migrations/202607140005_atomic_operations.sql",
  "supabase/migrations/202607150001_admin_enum_extensions.sql",
  "supabase/migrations/202607150002_admin_commerce.sql",
  "supabase/migrations/202607150003_checkout_razorpay.sql",
  "supabase/migrations/202607150004_r2_object_storage.sql",
  "supabase/migrations/202607150005_cloudinary_media.sql",
  "supabase/migrations/202607150006_app_metadata_role_fallback.sql",
  "supabase/migrations/202607180001_atomic_product_create.sql",
  "supabase/migrations/202607180002_contact_and_store_identity.sql",
  "supabase/migrations/202607180003_currency_inr.sql",
  "supabase/migrations/202607180004_refunds_and_returns.sql",
  "supabase/migrations/202607180005_requires_review_resolution.sql",
  "supabase/migrations/202607180006_checkout_compliance.sql",
  "supabase/migrations/202607210001_google_display_name_fallback.sql",
  "supabase/migrations/202607210002_order_delivery_tracking.sql",
  "supabase/seed.sql",
];

describe("PostgreSQL migrations", () => {
  for (const relativePath of sqlFiles) {
    it(`parses ${relativePath}`, async () => {
      const sql = await readFile(path.join(process.cwd(), relativePath), "utf8");
      const result = await parse(sql) as { stmts: unknown[] };
      expect(result.stmts.length).toBeGreaterThan(0);
    });
  }
});
