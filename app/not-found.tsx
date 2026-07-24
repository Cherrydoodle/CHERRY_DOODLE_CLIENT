import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="text-7xl">🌸</div>
      <h1 className="mt-4 font-display text-4xl font-black text-primary">404</h1>
      <p className="mt-2 text-muted-foreground">This page wandered off — try heading home.</p>
      <Link href="/" className="btn-primary mt-6">Go home</Link>
    </div>
  );
}
