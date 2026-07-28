"use client";

export type DeliverToAddress = {
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
};

export function DeliverToCard({ address, onChange }: { address: DeliverToAddress; onChange: () => void }) {
  return (
    <section className="card-soft p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold">Deliver to</h2>
            {address.label && <span className="chip bg-blush text-primary">{address.label}</span>}
          </div>
          <p className="mt-2 text-sm font-bold">{address.recipientName}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
          </p>
          {address.phone && <p className="mt-1 text-sm text-muted-foreground">{address.phone}</p>}
        </div>
        <button type="button" onClick={onChange} className="shrink-0 text-sm font-bold text-primary hover:underline">
          Change
        </button>
      </div>
    </section>
  );
}
