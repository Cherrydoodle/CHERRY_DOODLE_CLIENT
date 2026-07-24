import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim() || "Cherry Doodle Admin";

if (!url || !url.startsWith("https://") || !secretKey || !email || !password) {
  throw new Error(
    "Set the HTTPS NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_BOOTSTRAP_EMAIL, and ADMIN_BOOTSTRAP_PASSWORD in .env.local first.",
  );
}
if (password.length < 16) throw new Error("ADMIN_BOOTSTRAP_PASSWORD must contain at least 16 characters.");

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
let user = listed.data.users.find((candidate) => candidate.email?.toLowerCase() === email);

if (user) {
  const updated = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...user.user_metadata, display_name: displayName },
    app_metadata: { ...user.app_metadata, app_role: "admin" },
  });
  if (updated.error || !updated.data.user) throw updated.error ?? new Error("The existing administrator could not be updated.");
  user = updated.data.user;
} else {
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { app_role: "admin" },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("The administrator could not be created.");
  user = created.data.user;
}

const { error: profileError } = await supabase.from("profiles").upsert(
  { user_id: user.id, display_name: displayName, deleted_at: null },
  { onConflict: "user_id" },
);
if (profileError) throw profileError;

const { error: roleError } = await supabase.from("user_roles").upsert(
  { user_id: user.id, role: "admin", assigned_by: user.id, assigned_at: new Date().toISOString() },
  { onConflict: "user_id" },
);
if (roleError) throw roleError;

process.stdout.write(`Administrator is ready.\nADMIN_BOOTSTRAP_USER_ID=${user.id}\nADMIN_BOOTSTRAP_EMAIL=${email}\n`);
