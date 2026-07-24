import Link from "next/link";

export default function CategoryNotFound() {
  return (
    <div className="p-10 text-center">
      <h1 className="font-display text-3xl font-bold">Category not found</h1>
      <Link href="/" className="btn-primary mt-4 inline-flex">Go home</Link>
    </div>
  );
}
