"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { resetGuestActivityClaim } from "@/lib/store";

type Profile = { email: string; displayName: string; locale: string; role: string };

export function AccountPanel({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: values.get("displayName"), locale: values.get("locale") }),
    });
    setMessage(response.ok ? "Profile updated." : "Profile could not be updated.");
    if (response.ok) router.refresh();
  }

  async function logout() {
    const response = await fetch("/api/v1/auth/logout", { method: "POST" });
    if (response.ok) {
      resetGuestActivityClaim();
      router.replace("/");
      router.refresh();
    } else setMessage("Sign out could not be completed.");
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typedEmail = String(new FormData(event.currentTarget).get("confirmEmail") || "").trim().toLowerCase();
    if (typedEmail !== profile.email.toLowerCase()) {
      setDeleteError("That doesn't match your account email.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/v1/me", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.detail || "Your account could not be deleted.");
      await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
      resetGuestActivityClaim();
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Your account could not be deleted.");
      setDeleting(false);
    }
  }

  return (
    <section className="mx-auto mt-12 max-w-xl rounded-3xl border bg-white p-8 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="font-display text-3xl font-black">Your account</h1><p className="mt-1 text-sm text-muted-foreground">{profile.email} · {profile.role}</p></div>
        <button type="button" onClick={logout} className="btn-ghost-pink text-sm">Sign out</button>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/account/orders" className="btn-ghost-pink text-sm">View your orders</Link>
        <Link href="/account/addresses" className="btn-ghost-pink text-sm">Manage addresses</Link>
      </div>
      <form onSubmit={update} className="mt-7 space-y-4">
        <label className="block text-sm font-bold">Display name<input name="displayName" defaultValue={profile.displayName} minLength={2} maxLength={80} required className="mt-1.5 w-full rounded-2xl border px-4 py-3 font-normal outline-none focus:border-primary" /></label>
        <label className="block text-sm font-bold">Locale<input name="locale" defaultValue={profile.locale} pattern="[a-z]{2}(-[A-Z]{2})?" required className="mt-1.5 w-full rounded-2xl border px-4 py-3 font-normal outline-none focus:border-primary" /></label>
        <button type="submit" className="btn-primary">Save profile</button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">{message}</p>

      <div className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="font-bold text-destructive">Danger zone</h2>
        {!showDeleteConfirm ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently delete your account and personal data. Orders already placed are retained for our
              business records (see our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>).
            </p>
            <button type="button" onClick={() => setShowDeleteConfirm(true)} className="btn-ghost-pink mt-3 text-sm text-destructive">
              Delete my account
            </button>
          </>
        ) : (
          <form onSubmit={deleteAccount} className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              This cannot be undone. Type <strong>{profile.email}</strong> to confirm.
            </p>
            <input
              name="confirmEmail"
              type="email"
              required
              placeholder={profile.email}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-destructive"
            />
            {deleteError && <p className="text-sm text-destructive" role="alert">{deleteError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={deleting} className="rounded-full bg-destructive px-5 py-2 text-sm font-bold text-white disabled:opacity-60">
                {deleting ? "Deleting…" : "Permanently delete my account"}
              </button>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className="btn-ghost-pink text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
