"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/store";

type Mode = "login" | "register" | "forgot" | "reset";
type Problem = { detail?: string; errors?: Array<{ path: string; message: string }> };

const modeContent: Record<Mode, { title: string; submit: string; endpoint: string }> = {
  login: { title: "Welcome back", submit: "Sign in", endpoint: "/api/v1/auth/login" },
  register: { title: "Create your account", submit: "Create account", endpoint: "/api/v1/auth/register" },
  forgot: { title: "Reset your password", submit: "Send reset link", endpoint: "/api/v1/auth/password/forgot" },
  reset: { title: "Choose a new password", submit: "Update password", endpoint: "/api/v1/auth/password/reset" },
};

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const { claimGuestActivity } = useShop();
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const content = modeContent[mode];

  async function continueWithGoogle() {
    setGoogleSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start Google sign-in.");
      setGoogleSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) body[key] = value;
    if (mode === "register") body.marketingConsent = data.get("marketingConsent") === "on";
    if (mode === "login" && next) body.next = next;

    try {
      const response = await fetch(content.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(mode === "register" ? { "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({})) as Problem;
        throw new Error(problem.errors?.[0]?.message ?? problem.detail ?? "The request could not be completed.");
      }
      if (mode === "login") {
        const payload = await response.json() as { data?: { next?: string } };
        await claimGuestActivity().catch(() => {});
        router.replace(payload.data?.next ?? "/account");
        router.refresh();
        return;
      }
      if (mode === "register") {
        const payload = await response.json() as { data?: { verificationRequired?: true } };
        if (!payload.data?.verificationRequired) {
          await claimGuestActivity().catch(() => {});
          router.replace(next ?? "/account");
          router.refresh();
          return;
        }
        form.reset();
        setMessage("Check your inbox to verify your email.");
        return;
      }
      if (mode === "reset") {
        router.replace("/auth/login?password=updated");
        router.refresh();
        return;
      }
      form.reset();
      setMessage("If that account exists, a reset link is on its way.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-3xl border bg-white p-7 shadow-soft">
      <h1 className="font-display text-3xl font-black">{content.title}</h1>
      {(mode === "login" || mode === "register") && (
        <>
          <button
            type="button"
            onClick={continueWithGoogle}
            disabled={googleSubmitting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border bg-white px-4 py-3 font-bold outline-none transition hover:bg-muted disabled:opacity-60"
          >
            <GoogleIcon />
            {googleSubmitting ? "Redirecting…" : "Continue with Google"}
          </button>
          <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form onSubmit={submit} className={`${mode === "login" || mode === "register" ? "" : "mt-6"} space-y-4`}>
        {mode === "register" && <Field name="displayName" label="Display name" autoComplete="name" minLength={2} />}
        {mode !== "reset" && <Field name="email" label="Email" type="email" autoComplete="email" />}
        {(mode === "login" || mode === "register" || mode === "reset") && (
          <Field name="password" label={mode === "reset" ? "New password" : "Password"} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} />
        )}
        {mode === "reset" && <Field name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" minLength={12} />}
        {mode === "register" && (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input name="marketingConsent" type="checkbox" className="mt-1" />
            Email me occasional product news and offers.
          </label>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
          {submitting ? "Please wait…" : content.submit}
        </button>
      </form>
      <div className="mt-4 min-h-5 text-sm" aria-live="polite">
        {message && <p className="text-emerald-700">{message}</p>}
        {error && <p className="text-destructive">{error}</p>}
      </div>
      <AuthLinks mode={mode} />
    </section>
  );
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input {...props} required className="mt-1.5 w-full rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary" />
    </label>
  );
}

function AuthLinks({ mode }: { mode: Mode }) {
  return (
    <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-muted-foreground">
      {mode === "login" && <><Link href="/auth/forgot-password" className="hover:text-primary">Forgot password?</Link><Link href="/auth/register" className="hover:text-primary">Create account</Link></>}
      {mode !== "login" && <Link href="/auth/login" className="hover:text-primary">Back to sign in</Link>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C12.94.9 11.14 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}
