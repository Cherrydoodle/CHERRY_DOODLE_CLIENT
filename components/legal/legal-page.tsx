import type { ReactNode } from "react";

export const POLICY_EFFECTIVE_DATE = "18 July 2026";

export function LegalPage({
  title,
  intro,
  updated = POLICY_EFFECTIVE_DATE,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="font-display text-3xl font-black text-primary md:text-4xl">{title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">Last updated: {updated}</p>
      {intro ? <p className="mt-5 leading-relaxed text-muted-foreground">{intro}</p> : null}
      <div className="mt-8 space-y-8">{children}</div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-foreground">{heading}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}
