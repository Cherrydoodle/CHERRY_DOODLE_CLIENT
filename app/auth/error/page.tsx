import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <section className="mx-auto mt-16 max-w-md rounded-3xl border bg-white p-8 text-center shadow-soft">
      <h1 className="font-display text-3xl font-black">That link did not work</h1>
      <p className="mt-3 text-muted-foreground">It may be invalid or expired. Request a new link and try again.</p>
      <Link href="/auth/login" className="btn-primary mt-6">Return to sign in</Link>
    </section>
  );
}
