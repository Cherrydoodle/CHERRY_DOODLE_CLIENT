import type { ColorDTO } from "@/features/catalog/types";

// Pick<Union, K> flattens a discriminated union into one shape, which would let
// `kind: "name"` pair with a non-null `color` at the type level -- this stays a
// union of the two narrowed shapes so `variant.kind === "color"` actually narrows.
type VariantOptionLike = { kind: "color"; color: ColorDTO; label: string } | { kind: "name"; color: null; label: string };

/** The single place that switches on a variant's `kind` -- a color-backed variant
 * gets a swatch dot, a name-only variant gets just its label. Adding a future kind
 * means adding a case here, not touching every place a variant pill is rendered. */
export function VariantOption({ variant }: { variant: VariantOptionLike }) {
  return (
    <>
      {variant.kind === "color" && (
        <span className="h-4 w-4 shrink-0 rounded-full border border-border/40" style={{ background: variant.color.hex }} />
      )}
      <span className="text-xs font-semibold">{variant.label}</span>
    </>
  );
}
