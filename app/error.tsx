"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl font-bold">This page didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went sideways. Try again?</p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={reset} className="btn-primary">Try again</button>
          <Link href="/" className="btn-ghost-pink">Go home</Link>
        </div>
      </div>
    </div>
  );
}
