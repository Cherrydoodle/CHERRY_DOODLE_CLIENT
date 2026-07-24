"use client";

import Link from "next/link";
import { useState } from "react";

export function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");

  async function unsubscribe() {
    setStatus("working");
    const response = await fetch("/api/v1/newsletter/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setStatus(response.ok ? "done" : "error");
  }

  return (
    <section className="mx-auto mt-16 max-w-md rounded-3xl border bg-white p-8 text-center shadow-soft">
      <h1 className="font-display text-3xl font-black">Newsletter preferences</h1>
      {status === "done" ? (
        <><p className="mt-4 text-muted-foreground">You have been unsubscribed.</p><Link href="/" className="btn-primary mt-6">Back to the shop</Link></>
      ) : (
        <>
          <p className="mt-4 text-muted-foreground">You can stop Cherry Doodle newsletter emails at any time.</p>
          <button type="button" onClick={unsubscribe} disabled={status === "working" || token.length === 0} className="btn-primary mt-6 disabled:opacity-60">
            {status === "working" ? "Updating…" : "Unsubscribe"}
          </button>
          {status === "error" && <p className="mt-4 text-sm text-destructive">This link is invalid or expired.</p>}
        </>
      )}
    </section>
  );
}
