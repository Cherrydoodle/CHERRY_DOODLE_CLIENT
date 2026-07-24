"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function CategoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <div className="text-5xl">🌧️</div>
      <h1 className="font-display text-xl font-bold mt-4">This collection didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted-foreground">Something went sideways while loading these products. Try again?</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className="btn-primary">Try again</button>
        <Link href="/" className="btn-ghost-pink">Go home</Link>
      </div>
    </div>
  );
}
