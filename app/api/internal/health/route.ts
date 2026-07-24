import { getPublicSupabaseConfig } from "@/lib/public-env";

export function GET() {
  const configured = Boolean(getPublicSupabaseConfig() && process.env.SUPABASE_SECRET_KEY);
  const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  return Response.json({ status: "ok", version: process.env.DEPLOYMENT_VERSION ?? "development", checks: { supabaseConfigured: configured, cloudinaryConfigured } }, {
    status: configured ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
